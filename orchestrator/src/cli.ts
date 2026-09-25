#!/usr/bin/env bun
// terrarium: run worlds.
//   terrarium run <world.json|world.yaml> [--seeds N] [--out runs] [--until seconds]
//   terrarium replay <log.jsonl>            (delegates to the kernel)

import { basename } from "node:path";
import { kernelBinary } from "./kernel";
import { runWorld } from "./run";

async function loadWorld(path: string): Promise<any> {
  const text = await Bun.file(path).text();
  const v = path.endsWith(".yaml") || path.endsWith(".yml") ? Bun.YAML.parse(text) : JSON.parse(text);
  if (v?.generate) {
    const { generate } = await import("@terrarium/worlds/generator/generate");
    return generate(v);
  }
  return v;
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string, dflt?: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : dflt;
};

if (cmd === "run" && rest[0]) {
  const seeds = Number(flag("seeds", "1"));
  const out = flag("out", "runs")!;
  const until = flag("until");
  const base = await loadWorld(rest[0]);
  for (let i = 0; i < seeds; i++) {
    const config = { ...base, seed: base.seed + i };
    const runId = `${basename(rest[0]).replace(/\.(json|ya?ml)$/, "")}.seed${config.seed}`;
    const s = await runWorld({ config, runId, outDir: out, until: until ? Number(until) : undefined, log: console.log });
    console.log(`  log: ${s.logPath}\n  final state: ${s.stateHash}`);
  }
} else if (cmd === "replay" && rest[0]) {
  const p = Bun.spawnSync([kernelBinary(), "replay", rest[0], ...rest.slice(1)], { stdout: "inherit", stderr: "inherit" });
  process.exit(p.exitCode ?? 1);
} else {
  console.error("usage: terrarium run <world.json|yaml> [--seeds N] [--out runs] [--until seconds] | terrarium replay <log.jsonl>");
  process.exit(2);
}
