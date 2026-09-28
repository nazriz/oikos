#!/usr/bin/env bun
// terrarium: run worlds, measure them, and report what they cost.
//
//   terrarium run <world.json|yaml> [--seeds N] [--parallel P] [--out DIR] [--until SECONDS]
//                 [--set path=value]... [--translator-model provider/model] [--no-measure]
//                 [--model provider/model --budget DOLLARS_PER_RUN [--base-url URL]]
//     --model runs every language-model participant and the translator on a real model: anthropic/…, openai/…
//     (keys from ANTHROPIC_API_KEY / OPENAI_API_KEY), or a local open-weight model: ollama/… or local/… --base-url.
//     A model that costs money needs --budget: the run stops, and says why, rather than spend more.
//   terrarium measure <DIR> [QUERY...] [--sql "select ..."] [--list]
//   terrarium cost <DIR> [--translator-model provider/model]
//   terrarium translator-eval --model provider/model [--budget DOLLARS] [--base-url URL] [--out FILE]
//     The translator's test set (translator/eval/cases.ts) on a real model: seen and held-out pass rates, and cost.
//   terrarium replay <log.jsonl> [--anchors <anchors.jsonl>]      (the kernel's own replay)
//
// A DIR is a batch folder (its measure/ is used) or a folder of logs (exported to DIR/measure first).

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { exportLogs, queries, query, runQuery, table } from "@terrarium/measure";
import { runBatch, runOne } from "./batch";
import { costReport } from "./cost";
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
const positional = () => rest.filter((x, i) => !x.startsWith("--") && !(i > 0 && rest[i - 1]!.startsWith("--") && !["--no-measure", "--list"].includes(rest[i - 1]!)));

/** The measurement folder for a DIR: its measure/, exported from its logs if there isn't one yet. */
async function measureDir(dir: string): Promise<string> {
  if (existsSync(join(dir, "runs")) && existsSync(join(dir, "participants"))) return dir; // already a measurement folder
  const m = join(dir, "measure");
  if (!existsSync(m)) {
    const logs = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && !f.endsWith(".anchors.jsonl")).map((f) => join(dir, f));
    if (!logs.length) throw new Error(`${dir}: no measurement tables and no logs`);
    await exportLogs(logs, m);
  }
  return m;
}

const usage = "usage: terrarium run <world> [--seeds N] [--parallel P] [--out DIR] [--until S] [--set k=v] [--translator-model m] [--no-measure] [--model provider/model --budget USD [--base-url URL]] | measure <DIR> [QUERY...] [--sql SQL] [--list] | cost <DIR> [--translator-model m] | translator-eval --model provider/model [--budget USD] [--out FILE] | replay <log.jsonl>";

try {
  if (cmd === "run" && positional()[0]) {
    const r = await runBatch({
      world: positional()[0]!, seeds: Number(flag("seeds", "1")), out: flag("out"), parallel: flag("parallel") ? Number(flag("parallel")) : undefined,
      until: flag("until") ? Number(flag("until")) : undefined, sets: flags("set"), translatorModel: flag("translator-model"), measure: !has("no-measure"), log: console.log,
      model: flag("model"), budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url"),
    });
    if (r.measureDir) {
      console.log(`\n${table(await runQuery(r.measureDir, "overview"))}`);
      console.log(`\n${r.costText}`);
      console.log(`\nMeasure with: terrarium measure ${r.out} --list`);
    }
  } else if (cmd === "run-one" && positional()[0]) {
    await runOne({ world: positional()[0]!, seed: Number(flag("seed")), out: flag("out", "runs")!, until: flag("until") ? Number(flag("until")) : undefined, sets: flags("set"),
      model: flag("model"), budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url") });
  } else if (cmd === "measure" && positional()[0]) {
    const dir = await measureDir(positional()[0]!);
    if (has("list")) for (const q of queries()) console.log(`${q.name.padEnd(22)} ${q.description}`);
    else if (flag("sql")) console.log(table(await query(dir, flag("sql")!)));
    else {
      const names = positional().slice(1);
      for (const name of names.length ? names : ["overview"]) console.log(`## ${name}\n${table(await runQuery(dir, name))}\n`);
    }
  } else if (cmd === "translator-eval" && flag("model")) {
    const { evaluate, reportText } = await import("@terrarium/translator/eval");
    const m = chooseModel(flag("model")!, { budgetUsd: flag("budget") ? Number(flag("budget")) : undefined, baseUrl: flag("base-url") });
    const r = await evaluate(m.adapter, { prices: m.prices, ...(m.budget ? { budget: m.budget } : {}) });
    console.log(reportText(r));
    if (flag("out")) await Bun.write(flag("out")!, JSON.stringify(r, null, 2));
  } else if (cmd === "cost" && positional()[0]) {
    console.log((await costReport(await measureDir(positional()[0]!), { translatorModel: flag("translator-model") })).text);
  } else if (cmd === "replay" && rest[0]) {
    const p = Bun.spawnSync([kernelBinary(), "replay", rest[0], ...rest.slice(1)], { stdout: "inherit", stderr: "inherit" });
    process.exit(p.exitCode ?? 1);
  } else {
    console.error(usage);
    process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
