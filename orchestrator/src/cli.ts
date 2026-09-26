#!/usr/bin/env bun
// terrarium: run worlds, measure them, and report what they cost.
//
//   terrarium run <world.json|yaml> [--seeds N] [--parallel P] [--out DIR] [--until SECONDS]
//                 [--set path=value]... [--translator-model provider/model] [--no-measure]
//   terrarium measure <DIR> [QUERY...] [--sql "select ..."] [--list]
//   terrarium cost <DIR> [--translator-model provider/model]
//   terrarium replay <log.jsonl> [--anchors <anchors.jsonl>]      (the kernel's own replay)
//
// A DIR is a batch folder (its measure/ is used) or a folder of logs (exported to DIR/measure first).

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { exportLogs, queries, query, runQuery, table } from "@terrarium/measure";
import { runBatch, runOne } from "./batch";
import { costReport } from "./cost";
import { kernelBinary } from "./kernel";

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
  if (existsSync(join(dir, "runs")) && existsSync(join(dir, "seats"))) return dir; // already a measurement folder
  const m = join(dir, "measure");
  if (!existsSync(m)) {
    const logs = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && !f.endsWith(".anchors.jsonl")).map((f) => join(dir, f));
    if (!logs.length) throw new Error(`${dir}: no measurement tables and no logs`);
    await exportLogs(logs, m);
  }
  return m;
}

const usage = "usage: terrarium run <world> [--seeds N] [--parallel P] [--out DIR] [--until S] [--set k=v] [--translator-model m] [--no-measure] | measure <DIR> [QUERY...] [--sql SQL] [--list] | cost <DIR> [--translator-model m] | replay <log.jsonl>";

try {
  if (cmd === "run" && positional()[0]) {
    const r = await runBatch({
      world: positional()[0]!, seeds: Number(flag("seeds", "1")), out: flag("out"), parallel: flag("parallel") ? Number(flag("parallel")) : undefined,
      until: flag("until") ? Number(flag("until")) : undefined, sets: flags("set"), translatorModel: flag("translator-model"), measure: !has("no-measure"), log: console.log,
    });
    if (r.measureDir) {
      console.log(`\n${table(await runQuery(r.measureDir, "overview"))}`);
      console.log(`\n${r.costText}`);
      console.log(`\nMeasure with: terrarium measure ${r.out} --list`);
    }
  } else if (cmd === "run-one" && positional()[0]) {
    await runOne({ world: positional()[0]!, seed: Number(flag("seed")), out: flag("out", "runs")!, until: flag("until") ? Number(flag("until")) : undefined, sets: flags("set") });
  } else if (cmd === "measure" && positional()[0]) {
    const dir = await measureDir(positional()[0]!);
    if (has("list")) for (const q of queries()) console.log(`${q.name.padEnd(22)} ${q.description}`);
    else if (flag("sql")) console.log(table(await query(dir, flag("sql")!)));
    else {
      const names = positional().slice(1);
      for (const name of names.length ? names : ["overview"]) console.log(`## ${name}\n${table(await runQuery(dir, name))}\n`);
    }
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
