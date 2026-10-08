#!/usr/bin/env bun
// oikos: run worlds, measure them, and report what they cost.
//
//   oikos run <world.json|yaml> [--seeds N] [--parallel P] [--out DIR] [--until SECONDS]
//                 [--set path=value]... [--translator-model provider/model] [--no-measure]
//                 [--model provider/model --budget DOLLARS_PER_RUN [--base-url URL]]
//     --model runs every language-model participant and the translator on a real model: anthropic/…, openai/…
//     (keys from ANTHROPIC_API_KEY / OPENAI_API_KEY), or a local open-weight model: ollama/… or local/… --base-url.
//     A model that costs money needs --budget: the run stops, and says why, rather than spend more. --batch-budget caps
//     the whole batch: each run gets the per-run limit or what's left, whichever is less.
//     With --model, --translator-model runs the translator on its own model (e.g. a smaller one); without, it only
//     prices the cost projection.
//   oikos run ... [--overwrite]: runs are never overwritten: a run into a folder that already holds its log refuses to
//     start (choose another --out, or resume it). --overwrite replaces it, for tests' own folders; never the default,
//     and never a log that holds a real model's answers.
//   oikos resume <log.jsonl | log.jsonl.zst | DIR>: go on with a run that stopped (a folder: its one run that did).
//   oikos measure <DIR> [QUERY...] [--sql "select ..."] [--list]
//   oikos diff <BASELINE> <CHANGE> [QUERY...]: every measure of two batches compared (beyond seed noise: flagged)
//   oikos health <DIR> [--profile NAME]: the batch's measures against its profile's calibration targets
//   oikos cost <DIR> [--translator-model provider/model]
//   oikos run ... [--no-compress]: logs are compressed once measured (<run>.jsonl.zst, about a seventh the size,
//     checked to read back whole before the plain log goes); --no-compress keeps them plain.
//   oikos run ... [--keep log|measures]: what's kept of each run once measured. measures: the measurement tables,
//     the summary and a recipe that regenerates the log exactly, not the log (only for code-only runs at a commit).
//   oikos run ... [--consult]: the sparse mind (docs/design/ai-citizens.md 4): code citizens may ask the run's model
//     (the mock, or --model) how much their options would matter, remembered by kind of person. Off by default.
//   oikos run ... --consult [--consult-avoid <audit report.json>]: leave out what an audit found unstable.
//   oikos consult-audit <world> [--model provider/model --budget DOLLARS] [--kinds 8] [--fidelity 2] [--threshold 2]
//                 [--seed 1] [--out FILE]
//     The sparse mind's robustness audit: its questions reworded, options reversed, bins shifted, and remembered answers
//     against fresh ones, on the world's own questions and people. The mock by default. Every call is kept beside it.
//   oikos run ... [--log lean|full]: how much the log keeps (full, the default; lean for quick test runs: no
//     observation hashes, no written reasoning from code participants; replay still checks the state).
//   oikos dataset <DIR|log.jsonl> [--out DIR] [--actions]
//     Run datasets: each log's data as training examples, in <run>.dataset/ (docs/design/run-datasets.md): the manifest,
//     system prompts, translations, model participants' decisions; code participants' acts with --actions; and
//     observations, as the run recorded them (language-model participants' by default; --record-observations
//     models|code|all|none|<ids>).
//   oikos corpus <DIR|log.jsonl> [--out FILE]
//     The translator corpus: every translation in the logs (proposal, the translator's exchange, call, resolution, dry
//     run, the participant's decision, what the kernel did), one JSON line each, for training the translator later.
//   oikos translator-eval --model provider/model [--budget DOLLARS] [--base-url URL] [--out FILE] [--real | --only-real] [--jobs N]
//     The translator's test set (translator/eval/cases.ts, and the held-out cases where this machine has them) on a real
//     model: seen and held-out pass rates, and cost. --real adds the pilots' real requests (translator/eval/
//     pilot-cases.ts) as a third group, N at a time (default 4); --only-real runs those alone.
//   oikos translator-data <LOG|DIR>... --model provider/model [--model ...] [--back-model provider/model ...] --out DIR
//         [--per-shape N] [--per-gold N] [--refusals N] [--limit N] [--seed N]
//     Training data for the local translation model: requests written by the models given for the calls code
//     participants made in those logs, each checked (training.ts).
//   oikos translator-data <LOG|DIR>... --briefs [--writers NAME,NAME,...] [--no-spares] --out DIR
//         [--shard I/N] [--per-shape N] [--per-gold N] [--refusals N] [--refusal-floor N] [--floor N] [--generated N]
//         [--ceiling N] [--validation SHARE] [--limit N] [--seed N]
//         [--only FN,FN,...] [--indirect SHARE] [--refusal-labels L,L,...]
//         [--amount-forms N] [--pairs SHARE [--pairs-only]]                  (these options on a run with models too)
//     No model: the plan of what is to be written (DIR/plan.json), what each writer is asked, item by item
//     (DIR/briefs.jsonl: {id, kind, brief}; with --writers, DIR/briefs-NAME.jsonl each, the items dealt in turn), and
//     the writers' instructions (DIR/writer-instructions.txt), for writers who work on files. --shard I/N: part I of
//     N of the gold set, counted from 1. --no-spares leaves out the refusals asked for ahead of need (used only where
//     a label comes out short of its floor).
//     Weighting a part toward what seats really ask: --only writes requests for the programs of those functions
//     alone (--only none: for none, refusal briefs only; --generated and --limit then count those functions'
//     programs); --indirect is the share of plain letters asked for as "Direct them to …" (a half if absent);
//     --refusal-labels plans, builds and holds to the floor those labels only. All three are in plan.json and the
//     manifest. --amount-forms N adds N invented forms of several amounts to the gold set, each filled in four
//     ways (--only amount_form: requests for those alone). --pairs SHARE asks for that share of the forms filled in
//     and of the withdrawals with a second act in the same request (a direction to someone about it, or a second
//     withdrawal: one request of two lines, never too_much); --pairs-only writes requests for those alone.
//   oikos translator-data-write <DIR> --requests FILE --writer NAME [--requests FILE --writer NAME ...]
//     The requests such writers handed in ({id, request}, a line each), checked as a model's are and made into DIR's
//     examples.jsonl, rejects.jsonl, blind.jsonl and manifest.json, for translator-data-check.
//   oikos translator-data-check <DIR> --answers FILE [--reader NAME]
//   oikos translator-data-check <DIR> --blind [--seed N]
//     Blind checking of a data folder (translator/train/blind.ts). --blind writes its requests as DIR/blind.jsonl, in a
//     shuffled order, for a reader who is to see nothing else. --answers takes that reader's answers ({id, program}, a
//     line each), compares them with the gold programs by meaning, and writes DIR/checked.jsonl (the examples agreed
//     on, marked verified by the reader), DIR/disagreed.jsonl (both programs) and the counts per function in the manifest.
//   oikos in-situ <LOG|DIR>... --out DIR [--writers NAME,NAME,...] [--max-chars N] [--every N] [--seed N]
//     Translator training requests written in situ (in-situ.ts): from model seats' runs, every time a seat was asked
//     what to do as a situation (its prompt as sent, what it was shown), in DIR/situations.jsonl, each marked if a real
//     test case was asked in it; the seats' real requests that are no test case, for readers (real-unlabelled.jsonl,
//     real-blind.jsonl); and what writers are given: writer-instructions.txt and chunks/<writer>-NN.jsonl ({id, system,
//     shown} a line, at most --max-chars characters a chunk, 120,000 if not given; one seat's day in --every, 3 if not
//     given, a different one for each writer). Logs are only read. No model is called.
//   oikos in-situ-requests <DIR> --requests FILE --writer NAME [--requests FILE --writer NAME ...] [--out FILE] [--seed N]
//     What such writers handed back ({id, requests: [...]}, a line for each situation), as requests for readers:
//     DIR/written-unlabelled.jsonl ({id, request, forms, from}), and its blind file beside it.
//   oikos in-situ-blind <FILE> [--seed N] [--out FILE]
//     A file of such requests as a blind reader is given them ({id, request, forms}, shuffled).
//   oikos in-situ-label <FILE> --answers FILE --reader NAME --answers FILE --reader NAME --out DIR
//     Two readers' answers ({id, program}) to a file of such requests, made into DIR's examples.jsonl (a request both
//     read as the same program, which the request carries whole), rejects.jsonl (the rest, each with why) and manifest.json.
//   oikos replay <log.jsonl> [--anchors <anchors.jsonl>]      (the kernel's own replay)
//   oikos story <log.jsonl> [participant]                     (what a language-model participant did, day by day)
//
// A DIR is a batch folder (its measure/ is used) or a folder of logs (exported to DIR/measure first).

import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { exportLogs, queries, query, runQuery, table } from "@oikos/measure";
import { loadWorld, resumeCommand, runBatch, runOne, type StopSignal } from "./batch";
import { MockAdapter, mockPolicies, PRICES } from "@oikos/participants/llm";
import { costReport } from "./cost";
import { currentLogs } from "./logs";
import { kernelBinary } from "./kernel";
import { chooseModel } from "./models";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string, dflt?: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : dflt;
};
const flags = (name: string) => rest.flatMap((x, i) => (x === `--${name}` && rest[i + 1] !== undefined ? [rest[i + 1]!] : []));
const has = (name: string) => rest.includes(`--${name}`);
/** Positional arguments: everything that isn't a flag or a flag's value. */
const positional = () => rest.filter((x, i) => !x.startsWith("--") && !(i > 0 && rest[i - 1]!.startsWith("--") && !["--no-measure", "--list", "--compress", "--no-compress", "--actions", "--consult", "--overwrite", "--force", "--real", "--only-real", "--blind", "--briefs", "--no-spares", "--no-write"].includes(rest[i - 1]!)));

/** The measurement folder for a DIR: its measure/, exported from its logs if there isn't one yet. */
async function measureDir(dir: string): Promise<string> {
  if (existsSync(join(dir, "runs")) && existsSync(join(dir, "participants"))) return dir; // already a measurement folder
  const m = join(dir, "measure");
  if (!existsSync(m)) {
    const logs = currentLogs(dir); // (each run once: not what a resumed run left behind)
    if (!logs.length) throw new Error(`${dir}: no measurement tables and no logs`);
    await exportLogs(logs, m);
  }
  return m;
}

/**
 * Asked to stop (a TERM signal, as `scripts/mini stop` sends): a run stops before its next moment, its log closed, to be
 * resumed; a batch passes it on, starts no more seeds, and reports. If the run can't get there in time (a model call
 * still out after OIKOS_STOP_GRACE_SECONDS, 120 by default), the process ends as it is: its log resumes all the same.
 */
function stopOnSignal(): StopSignal {
  const stop: StopSignal = {};
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => {
    // (Asked twice from the keyboard: at once, as it is. A second TERM is the batch passing on what `mini stop` also sent.)
    if (stop.requested && signal === "SIGINT") process.exit(130);
    if (stop.requested) return;
    stop.requested = `a ${signal.slice(3)} signal`;
    console.error(`asked to stop (${signal}): stopping before the next moment, and closing the log`);
    stop.onRequest?.();
    const grace = Number(process.env.OIKOS_STOP_GRACE_SECONDS);
    if (cmd !== "run") setTimeout(() => process.exit(143), (Number.isFinite(grace) && grace > 0 ? grace : 120) * 1000).unref();
  });
  return stop;
}

const usage = "usage: oikos run <world> [--seeds N] [--parallel P] [--out DIR] [--until S] [--set k=v] [--modules FILE] [--translator-model m] [--no-measure] [--overwrite] [--model provider/model --budget USD [--base-url URL]] | resume <log.jsonl[.zst]|DIR> [--until S] [--model ... as for run] | measure <DIR> [QUERY...] [--sql SQL] [--list] | diff <BASELINE> <CHANGE> [QUERY...] | health <DIR> [--profile NAME] | cost <DIR> [--translator-model m] | translator-eval --model provider/model [--budget USD] [--out FILE] [--real | --only-real] [--jobs N] | pilot-report <DIR>... [--no-write] | replay <log.jsonl> | story <log.jsonl> [participant]";

try {
  if (cmd === "run" && positional()[0]) {
    const r = await runBatch({
      world: positional()[0]!, seeds: Number(flag("seeds", "1")), out: flag("out"), parallel: flag("parallel") ? Number(flag("parallel")) : undefined,
      until: flag("until") ? Number(flag("until")) : undefined, sets: flags("set"), translatorModel: flag("translator-model"), measure: !has("no-measure"), log: console.log,
      model: flag("model"), budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url"), modules: flag("modules"),
      recordObservations: flag("record-observations"), logDetail: flag("log"), compress: !has("no-compress"), keep: flag("keep") as "log" | "measures" | undefined,
      batchBudgetUsd: flag("batch-budget") ? Number(flag("batch-budget")) : undefined, consult: has("consult"), consultAvoid: flag("consult-avoid"),
      overwrite: has("overwrite"), stop: stopOnSignal(),
    });
    if (r.measureDir) {
      console.log(`\n${table(await runQuery(r.measureDir, "overview"))}`);
      console.log(`\n${r.costText}`);
      console.log(`\nMeasure with: oikos measure ${r.out} --list`);
    }
    if (r.stopped.length) {
      console.log(`\n${r.stopped.length} run${r.stopped.length === 1 ? "" : "s"} STOPPED before the end and can be resumed (logs kept plain, measured as far as they got):`);
      for (const x of r.stopped) console.log(`  seed ${x.seed}, at day ${Math.floor(x.t / 86_400)}: ${x.why}\n    ${x.resume}`);
    }
    if (r.problems.length) {
      console.log(`\nAfter the runs, something failed (the runs and batch.json are there):`);
      for (const x of r.problems) console.log(`  ${x}`);
      process.exitCode = 1;
    }
    if (r.failed.length) {
      console.log(`\n${r.failed.length} run${r.failed.length === 1 ? "" : "s"} didn't finish (diagnosis beside each log, <run>.failure.json):`);
      for (const f of r.failed) console.log(`  seed ${f.seed}: ${f.reason}`);
      process.exitCode = 1;
    }
  } else if (cmd === "run-one" && positional()[0]) {
    await runOne({ world: positional()[0]!, seed: Number(flag("seed")), out: flag("out", "runs")!, until: flag("until") ? Number(flag("until")) : undefined, sets: flags("set"),
      model: flag("model"), translatorModel: flag("translator-model"), budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url"), modules: flag("modules"),
      recordObservations: flag("record-observations"), logDetail: flag("log"), consult: has("consult"), consultAvoid: flag("consult-avoid"), overwrite: has("overwrite"), stop: stopOnSignal() });
  } else if (cmd === "resume" && positional()[0]) {
    // A run that stopped (a stall, a crash, cut short): run again from its own config, serving its recorded model calls.
    const o = { until: flag("until") ? Number(flag("until")) : undefined, modules: flag("modules"),
      model: flag("model"), translatorModel: flag("translator-model"), budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url") };
    const r = await runOne({ resume: positional()[0]!, ...o, stop: stopOnSignal() });
    console.log(`${r.runId}: resumed to ${(r.t / (365 * 86_400)).toFixed(2)} years; the stopped run's files are kept as ${r.runId}.stopped-<n>.*; ${r.logPath}`);
    if (r.stopped) console.log(`${r.runId}: STOPPED again at day ${Math.floor(r.t / 86_400)}, not finished: ${r.stopped.why}\n  resume it with: ${resumeCommand(r.logPath, o)}`);
  } else if (cmd === "measure" && positional()[0]) {
    const dir = await measureDir(positional()[0]!);
    if (has("list")) for (const q of queries()) console.log(`${q.name.padEnd(22)} ${q.description}`);
    else if (flag("sql")) console.log(table(await query(dir, flag("sql")!)));
    else {
      const names = positional().slice(1);
      for (const name of names.length ? names : ["overview"]) console.log(`## ${name}\n${table(await runQuery(dir, name))}\n`);
    }
  } else if (cmd === "pilot-report" && positional()[0]) {
    // A pilot folder's report from its log alone (pilot-report.ts), printed and written as <DIR>/pilot-report.json.
    const { pilotReport, renderReport } = await import("./pilot-report");
    for (const dir of positional()) console.log(renderReport(await pilotReport(dir, !has("no-write"))) + "\n");
  } else if (cmd === "health" && positional()[0]) {
    // The health report (docs/design/rebuild.md 8.4): the batch's measures against its profile's targets.
    const { health, healthText } = await import("@oikos/measure");
    const { loadProfile } = await import("@oikos/worlds/generator/profile");
    const batch = join(positional()[0]!, "batch.json");
    const profile = flag("profile") ?? (existsSync(batch) ? JSON.parse(readFileSync(batch, "utf8")).spec?.profile : undefined);
    if (!profile) throw new Error("which profile's targets? (--profile NAME; a batch made from a generated world knows its own)");
    console.log(healthText(await health(await measureDir(positional()[0]!), (loadProfile(profile) as any).targets ?? [])));
  } else if (cmd === "diff" && positional()[1]) {
    // Before and after (docs/design/rebuild.md 8.4): every measure of two batches of the same world, compared.
    const { diff, diffText } = await import("@oikos/measure");
    const [a, b] = [await measureDir(positional()[0]!), await measureDir(positional()[1]!)];
    console.log(diffText(await diff(a, b, positional().slice(2).length ? positional().slice(2) : undefined)));
  } else if (cmd === "consult-audit" && positional()[0]) {
    // The sparse mind's robustness audit (docs/design/ai-citizens.md 4), on the world's own questions and people.
    const { consultAudit, auditText } = await import("./audit");
    const { config } = await loadWorld(positional()[0]!, flags("set"));
    const m = flag("model") ? chooseModel(flag("model")!, { budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url") }) : undefined;
    const adapter = m?.adapter ?? new MockAdapter("mock", mockPolicies(new Map()));
    const { report, annotations } = await consultAudit({ config, adapter, prices: { ...PRICES, ...(m?.prices ?? {}) }, ...(m?.budget ? { budget: m.budget } : {}),
      kinds: flag("kinds") ? Number(flag("kinds")) : undefined, fidelity: flag("fidelity") ? Number(flag("fidelity")) : undefined,
      threshold: flag("threshold") ? Number(flag("threshold")) : undefined, seed: flag("seed") ? Number(flag("seed")) : undefined });
    console.log(auditText(report));
    const out = flag("out") ?? join("runs", `consult-audit-${adapter.provider}-${adapter.model.replace(/[^A-Za-z0-9.-]/g, "_")}.json`);
    await Bun.write(out, JSON.stringify(report, null, 2));
    // Every call, as a run would log it (model answers are data: kept beside the report).
    await Bun.write(out.replace(/\.json$/, ".calls.jsonl"), annotations.map((a) => JSON.stringify(a)).join("\n") + "\n");
    console.log(`\nReport: ${out}`);
  } else if (cmd === "translator-eval" && flag("model")) {
    // The held-out cases are outside the repository (translator/eval/held-out.ts): with them, their results go out by
    // id, outcome and shape only, and the full report is written beside them, never into `--out`.
    const { evaluate, evaluateReal, heldOutPath, loadHeldOut, publicReport, realReportText, reportText } = await import("@oikos/translator/eval");
    const m = chooseModel(flag("model")!, { budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url") });
    const with_ = { prices: m.prices, ...(m.budget ? { budget: m.budget } : {}) };
    let report: object = {};
    if (!has("only-real")) {
      const heldOut = loadHeldOut();
      const r = await evaluate(m.adapter, { ...with_, ...(heldOut ? { heldOut } : {}) });
      console.log(reportText(r));
      report = publicReport(r);
      if (heldOut) await Bun.write(join(heldOutPath(), "..", "results", `${r.model.replace(/[^a-z0-9.-]+/gi, "-")}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(r, null, 2));
    }
    if (has("real") || has("only-real")) {
      // The pilots' real requests: seen cases, so their report is kept whole.
      const real = await evaluateReal(m.adapter, { ...with_, jobs: Number(flag("jobs", "4")), log: (line) => console.error(line) });
      console.log(realReportText(real));
      report = { ...report, real_requests: real };
    }
    if (flag("out")) await Bun.write(flag("out")!, JSON.stringify(report, null, 2));
  } else if (cmd === "translator-data" && positional()[0] && (flags("model").length || has("briefs")) && flag("out")) {
    // Training data for the local translation model, from runs' logs (training.ts); or (--briefs) what its writers
    // are to be asked, for writers who work on files.
    const { trainingData } = await import("./training");
    const pick = (name: string) => chooseModel(name, { budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url") });
    const num = (name: string) => (flag(name) ? Number(flag(name)) : undefined);
    const list = (name: string) => flag(name)!.split(",").map((x) => x.trim()).filter(Boolean);
    // (A part is given as people count them, from 1: `--shard 13/24` is the thirteenth of 24.)
    const part = flag("shard") ? /^(\d+)\/(\d+)$/.exec(flag("shard")!) : undefined;
    if (flag("shard") && !part) throw new Error(`--shard: expected I/N (part I of N, from 1), got ${flag("shard")}`);
    const r = await trainingData({
      sources: positional(), out: flag("out")!,
      ...(has("briefs") ? { briefsOnly: true, noSpares: has("no-spares"), briefsFor: (flag("writers") ?? "").split(",").map((x) => x.trim()).filter(Boolean) } : { writers: flags("model").map(pick), backs: flags("back-model").map(pick) }),
      ...(part ? { shard: { index: Number(part[1]) - 1, of: Number(part[2]) } } : {}),
      perShape: num("per-shape"), perGold: num("per-gold"), refusalsPerLabel: num("refusals"), refusalFloor: num("refusal-floor"), floor: num("floor"), generated: num("generated"), ceiling: num("ceiling"), validation: num("validation"),
      limit: num("limit"), seed: num("seed"), log: console.log,
      ...(flag("indirect") !== undefined ? { indirect: Number(flag("indirect")) } : {}), ...(flag("only") ? { only: list("only") } : {}), ...(flag("refusal-labels") ? { refusalLabels: list("refusal-labels") } : {}),
      amountForms: num("amount-forms"), pairs: num("pairs"), pairsOnly: has("pairs-only"),
    });
    if (has("briefs")) console.log(`${r.briefs} briefs written to ${r.out} (plan.json, briefs.jsonl${flag("writers") ? ", a briefs file for each writer" : ""}, writer-instructions.txt)`);
    else console.log(`${r.examples} examples written to ${r.out} (examples.jsonl, manifest.json)${r.stopped ? `; writing stopped early: ${r.stopped}` : ""}`);
  } else if (cmd === "translator-data-write" && positional()[0] && flags("requests").length) {
    // The requests writers handed in for a folder's plan, made into its data (training.ts).
    const { writtenData } = await import("./training");
    const files = flags("requests"), names = flags("writer");
    if (names.length !== files.length) throw new Error(`a --writer NAME for each --requests FILE: ${files.length} files, ${names.length} names`);
    const r = await writtenData(positional()[0]!, files.map((file, i) => ({ file, writer: names[i]! })));
    console.log(`${r.examples} examples written to ${r.out} (examples.jsonl, rejects.jsonl, blind.jsonl, manifest.json): ${r.rejects} requests rejected, ${r.no_request} planned items had no request${r.duplicate_ids ? `, ${r.duplicate_ids} ids were written twice (the first kept)` : ""}${r.unknown_ids ? `, ${r.unknown_ids} requests were for nothing planned` : ""}`);
  } else if (cmd === "translator-data-check" && positional()[0] && (flag("answers") || has("blind"))) {
    // A blind reader's answers against a data folder's gold programs; or (--blind) the requests for such a reader.
    const { checkBlind, writeBlind } = await import("./training");
    const dir = positional()[0]!;
    if (has("blind")) {
      const w = writeBlind(dir, flag("seed") ? Number(flag("seed")) : 1);
      console.log(`${w.requests} requests written to ${w.out}, in a shuffled order`);
    }
    if (flag("answers")) {
      const r = checkBlind(dir, flag("answers")!, flag("reader") ?? "blind reader");
      console.log(`${r.reader}: agreed on ${r.agreed} of ${r.examples}, disagreed on ${r.disagreed}, left ${r.unanswered} unanswered${r.unknown_ids ? `; ${r.unknown_ids} answers were for no example here` : ""} (checked.jsonl, disagreed.jsonl, manifest.json)`);
      for (const [fn, n] of Object.entries(r.by_function)) if (n.disagreed || n.unanswered) console.log(`  ${fn}: ${n.agreed} agreed, ${n.disagreed} disagreed${n.unanswered ? `, ${n.unanswered} unanswered` : ""}`);
    }
  } else if (cmd === "in-situ" && positional()[0] && flag("out")) {
    // Situations for writers who answer as a seat, from model seats' logs; and the seats' real requests, for readers.
    const { inSitu } = await import("./in-situ");
    const num = (name: string) => (flag(name) ? Number(flag(name)) : undefined);
    const r = await inSitu({ sources: positional(), out: flag("out")!, writers: (flag("writers") ?? "").split(",").map((x) => x.trim()).filter(Boolean), maxChars: num("max-chars"), every: num("every"), seed: num("seed"), log: console.log });
    const t = r.totals;
    console.log(`${t.situations} situations written to ${flag("out")} (situations.jsonl): ${t.test} marked test, ${t.partial} with a sitting that isn't whole, ${t.usable} usable${t.no_forms ? `; ${t.no_forms} with no forms recovered` : ""}${t.no_system ? `; ${t.no_system} calls left out, their system prompt not in the log` : ""}`);
    for (const [run, seats] of Object.entries(r.situations)) for (const [seat, n] of Object.entries(seats)) console.log(`  ${run} ${seat}: ${n.situations} situations on ${n.seat_days} days, ${n.test} marked test, ${n.usable} usable; ${n.asked} requests made`);
    for (const [what, c] of Object.entries(r.characters)) console.log(`  ${what}: ${c.min} to ${c.max} characters, median ${c.median}, ninth decile ${c.p90}`);
    const q = r.real_requests;
    console.log(`${q.kept} real requests for readers (real-unlabelled.jsonl, real-blind.jsonl) of ${q.asked} made: ${q.test} are test cases, ${q.same_as_test} more in a test case's exact words, ${q.starts_as_test} beginning as one does, ${q.said_before} said before, ${q.no_forms} with no forms recovered`);
    for (const [writer, c] of Object.entries(r.chunks)) console.log(`${writer}: ${c.situations} situations in ${c.chunks} chunks (chunks/), ${c.sizes.length ? `${Math.min(...c.sizes)} to ${Math.max(...c.sizes)} characters a chunk` : "none"}; ${c.where_the_seat_asked} are turns where the seat asked for something`);
    if (r.too_large_for_a_chunk) console.log(`${r.too_large_for_a_chunk} situations are larger than a chunk (${r.max_chars} characters) and are given to no one`);
  } else if (cmd === "in-situ-requests" && positional()[0] && flags("requests").length) {
    const { takeInFiles } = await import("./in-situ");
    const files = flags("requests"), names = flags("writer");
    if (names.length !== files.length) throw new Error(`a --writer NAME for each --requests FILE: ${files.length} files, ${names.length} names`);
    const r = await takeInFiles(positional()[0]!, files.map((file, i) => ({ file, writer: names[i]! })), { out: flag("out"), seed: flag("seed") ? Number(flag("seed")) : undefined });
    console.log(`${r.kept} requests written to ${r.out} (blind: ${r.blind}) from ${r.answers} situations answered, ${r.none} of them with no request: of ${r.written} requests, ${r.said_before} said before, ${r.same_as_test} in a test case's exact words, ${r.starts_as_test} beginning as one does, ${r.empty} empty, ${r.no_forms} for a situation with no forms recovered, ${r.unknown_situation} for no situation here, ${r.test_situation} for a situation marked test`);
  } else if (cmd === "in-situ-blind" && positional()[0]) {
    const { blindFile } = await import("./in-situ");
    const w = blindFile(positional()[0]!, { seed: flag("seed") ? Number(flag("seed")) : undefined, out: flag("out") });
    console.log(`${w.requests} requests written to ${w.out}, in a shuffled order`);
  } else if (cmd === "in-situ-label" && positional()[0] && flags("answers").length && flag("out")) {
    const { label } = await import("./in-situ");
    const files = flags("answers"), names = flags("reader");
    if (names.length !== files.length) throw new Error(`a --reader NAME for each --answers FILE: ${files.length} files, ${names.length} names`);
    const m = label(positional()[0]!, files.map((file, i) => ({ file, reader: names[i]! })), flag("out")!);
    console.log(`${m.examples} examples of ${m.requests} requests written to ${flag("out")} (examples.jsonl, rejects.jsonl, manifest.json); dropped: ${Object.entries(m.by_reason).filter(([, n]) => n).map(([why, n]) => `${why} ${n}`).join(", ") || "none"}`);
    console.log(`  by function: ${Object.entries(m.by_function).map(([fn, n]) => `${fn} ${n}`).join(", ")}`);
  } else if (cmd === "dataset" && positional()[0]) {
    // Run datasets: every run's data as training examples (docs/design/run-datasets.md).
    const { logsIn } = await import("./corpus");
    const { exportDataset } = await import("./dataset");
    const src = positional()[0]!;
    for (const log of logsIn(src)) {
      const out = join(flag("out") ?? join(log, ".."), `${log.split("/").at(-1)!.replace(/\.jsonl(\.zst)?$/, "")}.dataset`);
      const m = await exportDataset(log, out, { actions: has("actions") });
      console.log(`${m.run}: ${Object.entries(m.files).map(([f, x]: [string, any]) => `${f} ${x.rows}${x.synthetic ? ` (${x.synthetic} synthetic)` : ""}`).join(", ")} -> ${out}`);
    }
  } else if (cmd === "corpus" && positional()[0]) {
    // The translator corpus: every translation in the logs, as training examples (docs/measurement.md).
    const { corpusOf, logsIn } = await import("./corpus");
    const src = positional()[0]!;
    const out = flag("out") ?? (statSync(src).isDirectory() ? join(src, "translator-corpus.jsonl") : src.replace(/\.jsonl$/, ".translator-corpus.jsonl"));
    const rows = (await Promise.all(logsIn(src).map(corpusOf))).flat();
    await Bun.write(out, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
    const real = rows.filter((r) => !r.synthetic).length;
    console.log(`${rows.length} translations (${real} from real models, ${rows.length - real} synthetic) into ${out}: ${rows.filter((r) => r.result === "drafted").length} drafted, ${rows.filter((r) => r.result === "failed").length} failed; ${rows.filter((r) => r.executed?.applied).length} carried out and applied.`);
  } else if (cmd === "cost" && positional()[0]) {
    console.log((await costReport(await measureDir(positional()[0]!), { translatorModel: flag("translator-model") })).text);
  } else if (cmd === "story" && positional()[0]) {
    const { story } = await import("./story");
    console.log(await story(positional()[0]!, positional()[1]));
  } else if (cmd === "replay" && rest[0]) {
    // A compressed log is replayed from a plain copy (the kernel reads plain logs).
    let log = rest[0];
    if (log.endsWith(".zst")) {
      const { readLog } = await import("./logs");
      log = join(process.env.TMPDIR ?? "/tmp", `oikos-replay-${process.pid}.jsonl`);
      await Bun.write(log, readLog(rest[0]));
    }
    const p = Bun.spawnSync([kernelBinary(), "replay", log, ...rest.slice(1)], { stdout: "inherit", stderr: "inherit" });
    if (log !== rest[0]) rmSync(log, { force: true });
    process.exit(p.exitCode ?? 1);
  } else {
    console.error(usage);
    process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
