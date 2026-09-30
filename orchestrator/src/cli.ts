#!/usr/bin/env bun
// terrarium: run worlds, measure them, and report what they cost.
//
//   terrarium run <world.json|yaml> [--seeds N] [--parallel P] [--out DIR] [--until SECONDS]
//                 [--set path=value]... [--translator-model provider/model] [--no-measure]
//                 [--model provider/model --budget DOLLARS_PER_RUN [--base-url URL]]
//     --model runs every language-model participant and the translator on a real model: anthropic/…, openai/…
//     (keys from ANTHROPIC_API_KEY / OPENAI_API_KEY), or a local open-weight model: ollama/… or local/… --base-url.
//     A model that costs money needs --budget: the run stops, and says why, rather than spend more. --batch-budget caps
//     the whole batch: each run gets the per-run limit or what's left, whichever is less.
//     With --model, --translator-model runs the translator on its own model (e.g. a smaller one); without, it only
//     prices the cost projection.
//   terrarium measure <DIR> [QUERY...] [--sql "select ..."] [--list]
//   terrarium diff <BASELINE> <CHANGE> [QUERY...]: every measure of two batches compared (beyond seed noise: flagged)
//   terrarium cost <DIR> [--translator-model provider/model]
//   terrarium run ... [--no-compress]: logs are compressed once measured (<run>.jsonl.zst, about a seventh the size,
//     checked to read back whole before the plain log goes); --no-compress keeps them plain.
//   terrarium run ... [--keep log|measures]: what's kept of each run once measured. measures: the measurement tables,
//     the summary and a recipe that regenerates the log exactly, not the log (only for code-only runs at a commit).
//   terrarium run ... [--consult]: the sparse mind (docs/design/ai-citizens.md 4): code citizens may ask the run's model
//     (the mock, or --model) how much their options would matter, remembered by kind of person. Off by default.
//   terrarium run ... --consult [--consult-avoid <audit report.json>]: leave out what an audit found unstable.
//   terrarium consult-audit <world> [--model provider/model --budget DOLLARS] [--kinds 8] [--fidelity 2] [--threshold 2]
//                 [--seed 1] [--out FILE]
//     The sparse mind's robustness audit: its questions reworded, options reversed, bins shifted, and remembered answers
//     against fresh ones, on the world's own questions and people. The mock by default. Every call is kept beside it.
//   terrarium run ... [--log lean|full]: how much the log keeps (full, the default; lean for quick test runs: no
//     observation hashes, no written reasoning from code participants; replay still checks the state).
//   terrarium dataset <DIR|log.jsonl> [--out DIR] [--actions]
//     Run datasets: each log's data as training examples, in <run>.dataset/ (docs/design/run-datasets.md): the manifest,
//     system prompts, translations, model participants' decisions; code participants' acts with --actions; and
//     observations, as the run recorded them (language-model participants' by default; --record-observations
//     models|code|all|none|<ids>).
//   terrarium corpus <DIR|log.jsonl> [--out FILE]
//     The translator corpus: every translation in the logs (proposal, the translator's exchange, call, resolution, dry
//     run, the participant's decision, what the kernel did), one JSON line each, for training the translator later.
//   terrarium translator-eval --model provider/model [--budget DOLLARS] [--base-url URL] [--out FILE]
//     The translator's test set (translator/eval/cases.ts) on a real model: seen and held-out pass rates, and cost.
//   terrarium replay <log.jsonl> [--anchors <anchors.jsonl>]      (the kernel's own replay)
//   terrarium story <log.jsonl> [participant]                     (what a language-model participant did, day by day)
//
// A DIR is a batch folder (its measure/ is used) or a folder of logs (exported to DIR/measure first).

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { exportLogs, queries, query, runQuery, table } from "@terrarium/measure";
import { loadWorld, runBatch, runOne } from "./batch";
import { MockAdapter, mockPolicies, PRICES } from "@terrarium/participants/llm";
import { costReport } from "./cost";
import { isLog } from "./logs";
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
const positional = () => rest.filter((x, i) => !x.startsWith("--") && !(i > 0 && rest[i - 1]!.startsWith("--") && !["--no-measure", "--list", "--compress", "--no-compress", "--actions", "--consult"].includes(rest[i - 1]!)));

/** The measurement folder for a DIR: its measure/, exported from its logs if there isn't one yet. */
async function measureDir(dir: string): Promise<string> {
  if (existsSync(join(dir, "runs")) && existsSync(join(dir, "participants"))) return dir; // already a measurement folder
  const m = join(dir, "measure");
  if (!existsSync(m)) {
    const logs = readdirSync(dir).filter(isLog).map((f) => join(dir, f));
    if (!logs.length) throw new Error(`${dir}: no measurement tables and no logs`);
    await exportLogs(logs, m);
  }
  return m;
}

const usage = "usage: terrarium run <world> [--seeds N] [--parallel P] [--out DIR] [--until S] [--set k=v] [--modules FILE] [--translator-model m] [--no-measure] [--model provider/model --budget USD [--base-url URL]] | resume <log.jsonl> [--until S] [--model ... as for run] | measure <DIR> [QUERY...] [--sql SQL] [--list] | diff <BASELINE> <CHANGE> [QUERY...] | cost <DIR> [--translator-model m] | translator-eval --model provider/model [--budget USD] [--out FILE] | replay <log.jsonl> | story <log.jsonl> [participant]";

try {
  if (cmd === "run" && positional()[0]) {
    const r = await runBatch({
      world: positional()[0]!, seeds: Number(flag("seeds", "1")), out: flag("out"), parallel: flag("parallel") ? Number(flag("parallel")) : undefined,
      until: flag("until") ? Number(flag("until")) : undefined, sets: flags("set"), translatorModel: flag("translator-model"), measure: !has("no-measure"), log: console.log,
      model: flag("model"), budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url"), modules: flag("modules"),
      recordObservations: flag("record-observations"), logDetail: flag("log"), compress: !has("no-compress"), keep: flag("keep") as "log" | "measures" | undefined,
      batchBudgetUsd: flag("batch-budget") ? Number(flag("batch-budget")) : undefined, consult: has("consult"), consultAvoid: flag("consult-avoid"),
    });
    if (r.measureDir) {
      console.log(`\n${table(await runQuery(r.measureDir, "overview"))}`);
      console.log(`\n${r.costText}`);
      console.log(`\nMeasure with: terrarium measure ${r.out} --list`);
    }
    if (r.failed.length) {
      console.log(`\n${r.failed.length} run${r.failed.length === 1 ? "" : "s"} didn't finish (diagnosis beside each log, <run>.failure.json):`);
      for (const f of r.failed) console.log(`  seed ${f.seed}: ${f.reason}`);
      process.exitCode = 1;
    }
  } else if (cmd === "run-one" && positional()[0]) {
    await runOne({ world: positional()[0]!, seed: Number(flag("seed")), out: flag("out", "runs")!, until: flag("until") ? Number(flag("until")) : undefined, sets: flags("set"),
      model: flag("model"), translatorModel: flag("translator-model"), budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url"), modules: flag("modules"),
      recordObservations: flag("record-observations"), logDetail: flag("log"), consult: has("consult"), consultAvoid: flag("consult-avoid") });
  } else if (cmd === "resume" && positional()[0]) {
    // A run that stopped (a stall, a crash, cut short): run again from its own config, serving its recorded model calls.
    const r = await runOne({ resume: positional()[0]!, until: flag("until") ? Number(flag("until")) : undefined, modules: flag("modules"),
      model: flag("model"), translatorModel: flag("translator-model"), budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url") });
    console.log(`${r.runId}: resumed to ${(r.t / (365 * 86_400)).toFixed(2)} years; the stopped run's files are kept as ${r.runId}.stopped-<n>.*; ${r.logPath}`);
  } else if (cmd === "measure" && positional()[0]) {
    const dir = await measureDir(positional()[0]!);
    if (has("list")) for (const q of queries()) console.log(`${q.name.padEnd(22)} ${q.description}`);
    else if (flag("sql")) console.log(table(await query(dir, flag("sql")!)));
    else {
      const names = positional().slice(1);
      for (const name of names.length ? names : ["overview"]) console.log(`## ${name}\n${table(await runQuery(dir, name))}\n`);
    }
  } else if (cmd === "diff" && positional()[1]) {
    // Before and after (docs/design/rebuild.md 8.4): every measure of two batches of the same world, compared.
    const { diff, diffText } = await import("@terrarium/measure");
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
    const { evaluate, reportText } = await import("@terrarium/translator/eval");
    const m = chooseModel(flag("model")!, { budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url") });
    const r = await evaluate(m.adapter, { prices: m.prices, ...(m.budget ? { budget: m.budget } : {}) });
    console.log(reportText(r));
    if (flag("out")) await Bun.write(flag("out")!, JSON.stringify(r, null, 2));
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
    console.log(story(positional()[0]!, positional()[1]));
  } else if (cmd === "replay" && rest[0]) {
    // A compressed log is replayed from a plain copy (the kernel reads plain logs).
    let log = rest[0];
    if (log.endsWith(".zst")) {
      const { readLog } = await import("./logs");
      log = join(process.env.TMPDIR ?? "/tmp", `terrarium-replay-${process.pid}.jsonl`);
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
