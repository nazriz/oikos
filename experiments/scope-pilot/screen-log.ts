// The screen's reading (screen.ts) of a fork already run, read only: a past round's code arm, to set beside a screen.
//
//   bun experiments/scope-pilot/screen-log.ts <experiment folder> [--seed 7] [--arm code]
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { screenLog, screenText } from "./screen";

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? "");
const opt = (f: string, d: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1]! : d; };
const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
const seed = Number(opt("--seed", String(spec.seeds[0])));
const arm = opt("--arm", "code");
const config = JSON.parse(readFileSync(join(dir, `seed-${seed}`, "config.json"), "utf8"));
const s = await screenLog(join(dir, `seed-${seed}`, `${arm}.oklog`), config, { forkDay: spec.forkDay, days: spec.untilDay - spec.forkDay, spec: spec.name, seed, arm });
console.log(screenText(s));
