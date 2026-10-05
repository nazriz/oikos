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
const positional = () => rest.filter((x, i) => !x.startsWith("--") && !(i > 0 && rest[i - 1]!.startsWith("--") && !["--no-measure", "--list", "--compress", "--no-compress", "--actions", "--consult", "--overwrite", "--force", "--real", "--only-real"].includes(rest[i - 1]!)));

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

const usage = "usage: oikos run <world> [--seeds N] [--parallel P] [--out DIR] [--until S] [--set k=v] [--modules FILE] [--translator-model m] [--no-measure] [--overwrite] [--model provider/model --budget USD [--base-url URL]] | resume <log.jsonl[.zst]|DIR> [--until S] [--model ... as for run] | measure <DIR> [QUERY...] [--sql SQL] [--list] | diff <BASELINE> <CHANGE> [QUERY...] | health <DIR> [--profile NAME] | cost <DIR> [--translator-model m] | translator-eval --model provider/model [--budget USD] [--out FILE] [--real | --only-real] [--jobs N] | replay <log.jsonl> | story <log.jsonl> [participant]";

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
  } else if (cmd === "translator-data" && positional()[0] && flags("model").length && flag("out")) {
    // Training data for the local translation model, from runs' logs (training.ts).
    const { trainingData } = await import("./training");
    const pick = (name: string) => chooseModel(name, { budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url") });
    const num = (name: string) => (flag(name) ? Number(flag(name)) : undefined);
    const r = await trainingData({
      sources: positional(), writers: flags("model").map(pick), backs: flags("back-model").map(pick), out: flag("out")!,
      perShape: num("per-shape"), perGold: num("per-gold"), refusalsPerLabel: num("refusals"), limit: num("limit"), seed: num("seed"), log: console.log,
    });
    console.log(`${r.examples} examples written to ${r.out} (examples.jsonl, manifest.json)${r.stopped ? `; writing stopped early: ${r.stopped}` : ""}`);
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
