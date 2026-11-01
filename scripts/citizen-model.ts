#!/usr/bin/env bun
// The citizen model's pipeline, one command (docs/citizen-data.md, "The citizen model"; docs/design/citizen-model.md):
//
//   bun scripts/citizen-model.ts [--name NAME] [--seeds 1,2,3,4,5] [--hidden 64,64] [--data-only]
//     Gathers every captured want decision (the code towns below and the pilots' training split), writes the data file,
//     trains the model on it (kernel/crates/citizen-train, one slot), and writes the report:
//     runs/citizen-model/data/<NAME>.jsonl (+ .manifest.json), runs/citizen-model/models/<NAME>/{model.json,report.json}.
//   bun scripts/citizen-model.ts towns [--parallel 3]
//     Makes the code towns whose decisions it is trained and tested on, those not made yet: worlds/citizen-model.yaml,
//     a year each, captured, through the slots. Long: start it detached (nohup, then caffeinate -i -w <pid>).
//
// What goes in, by rule (CLAUDE.md, "Model runs are training data"; docs/citizen-data.md):
// - Only captured citizen decisions (`*.citizens.jsonl.zst`); nothing of debriefs or exit accounts is read.
// - A pilot marked as a held-out test (its PILOT.txt says "TEST PILOT", or its summary `test: true`) is never read, nor
//   any turn on a day a real test case of the translator came from (`standingTurns`' rule).
// - A turn made with the citizen model on (`situation.model`) is never trained on: the model learns the code mind.
// - Splits are whole towns: two profiles never trained on (test), the last town of each other profile (valid, for
//   stopping), the rest (train); one pilot is held out (pilot).
// Never deletes or overwrites anything: a name already used is refused.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { standingTurns } from "../orchestrator/src/citizen-data";

const ROOT = resolve(import.meta.dir, "..");
/** The runs folder: OIKOS_RUNS, else the main checkout's (a worktree's own `runs/` holds no run: CLAUDE.md, "Where things run"). */
const RUNS = process.env.OIKOS_RUNS ?? join(dirname(resolve(ROOT, Bun.spawnSync(["git", "rev-parse", "--git-common-dir"], { cwd: ROOT }).stdout.toString().trim())), "runs");
const HOME = join(RUNS, "citizen-model");
/** The code towns: profile, the first town's seed, how many towns. */
export const TOWNS: { profile: string; seed: number; towns: number }[] = [
  { profile: "au-vic-2026", seed: 7101, towns: 3 },
  { profile: "br-mg-2026", seed: 7201, towns: 3 },
  { profile: "de-ni-2026", seed: 7301, towns: 3 },
  { profile: "gb-eng-2026", seed: 7401, towns: 3 },
  { profile: "in-tn-2026", seed: 7501, towns: 3 },
  { profile: "jp-akita-2026", seed: 7601, towns: 3 },
  { profile: "mx-jal-2026", seed: 7701, towns: 3 },
  { profile: "us-oh-2026", seed: 7801, towns: 2 },
  { profile: "ke-nakuru-2026", seed: 7901, towns: 2 },
];
/** Profiles never trained on: the test split. */
export const HELD_PROFILES = ["us-oh-2026", "ke-nakuru-2026"];
/** A pilot held out whole (its people never trained on). */
export const HELD_PILOTS = ["lv-13"];
const YEAR = 365 * 86_400;

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};

function sh(cmd: string[], o: { cwd?: string } = {}): number {
  const p = Bun.spawnSync(cmd, { cwd: o.cwd ?? ROOT, stdout: "inherit", stderr: "inherit", env: process.env });
  return p.exitCode ?? 1;
}

// ------------------------------------------------------------------ towns

function towns() {
  const parallel = flag("parallel", "3")!;
  if (args.includes("--build") && sh(["bun", "run", "kernel"]) !== 0) throw new Error("the kernel did not build");
  for (const t of TOWNS) {
    const out = join(HOME, "towns", t.profile);
    if (existsSync(out) && readdirSync(out).filter((f) => f.endsWith(".citizens.jsonl.zst")).length >= t.towns) {
      console.log(`${t.profile}: made`);
      continue;
    }
    console.log(`${t.profile}: ${t.towns} towns from seed ${t.seed}`);
    const code = sh(["bun", "orchestrator/src/cli.ts", "run", "worlds/citizen-model.yaml", "--set", `profile=${t.profile}`, "--set", `seed=${t.seed}`, "--towns", String(t.towns), "--until", String(YEAR), "--capture-citizens", "on", "--log", "lean", "--record-observations", "none", "--no-measure", "--parallel", parallel, "--out", out]);
    if (code !== 0) throw new Error(`${t.profile}: the batch failed (${code})`);
  }
}

// ------------------------------------------------------------------ data

interface Source { path: string; run: string; profile: string; split: string; kind: "town" | "pilot" }

const sha256File = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

/** Whether a pilot's folder says it is a held-out test. */
function heldTest(dir: string): boolean {
  const pilot = join(dir, "PILOT.txt");
  if (existsSync(pilot) && /^TEST PILOT/.test(readFileSync(pilot, "utf8"))) return true;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".summary.json"))) {
    try {
      if (JSON.parse(readFileSync(join(dir, f), "utf8")).test === true) return true;
    } catch {}
  }
  return false;
}

function sources(): { use: Source[]; refused: { path: string; why: string }[] } {
  const use: Source[] = [];
  const refused: { path: string; why: string }[] = [];
  for (const t of TOWNS) {
    const dir = join(HOME, "towns", t.profile);
    if (!existsSync(dir)) continue;
    const caps = readdirSync(dir).filter((f) => f.endsWith(".citizens.jsonl.zst")).sort();
    caps.forEach((f, i) => {
      const split = HELD_PROFILES.includes(t.profile) ? "test" : i === caps.length - 1 && caps.length > 1 ? "valid" : "train";
      use.push({ path: join(dir, f), run: `citizen-model/towns/${t.profile}/${f.replace(/\.citizens\.jsonl\.zst$/, "")}`, profile: t.profile, split, kind: "town" });
    });
  }
  for (const d of readdirSync(RUNS).sort()) {
    const dir = join(RUNS, d);
    if (d === "citizen-model" || !statSync(dir).isDirectory()) continue;
    const caps = readdirSync(dir).filter((f) => f.endsWith(".citizens.jsonl.zst")).sort();
    if (!caps.length) continue;
    if (heldTest(dir)) {
      for (const f of caps) refused.push({ path: join(dir, f), why: "a held-out test pilot" });
      continue;
    }
    let profile = "";
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".summary.json"))) {
      try {
        profile = (JSON.parse(readFileSync(join(dir, f), "utf8")).sets ?? []).find((s: string) => s.startsWith("profile="))?.slice(8) ?? profile;
      } catch {}
    }
    for (const f of caps) use.push({ path: join(dir, f), run: d, profile, split: HELD_PILOTS.includes(d) ? "pilot" : HELD_PROFILES.includes(profile) ? "test" : "train", kind: "pilot" });
  }
  return { use, refused };
}

async function data(name: string): Promise<string> {
  const dir = join(HOME, "data");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${name}.jsonl`);
  if (existsSync(out)) throw new Error(`${out} exists: choose another --name (nothing is overwritten)`);
  const { use, refused } = sources();
  if (!use.length) throw new Error(`no captured decisions: make the towns first (bun scripts/citizen-model.ts towns)`);
  const w = Bun.file(out).writer();
  const manifest: any = { schema: "citizen-model-data/1", head: "want-way", made: new Date().toISOString(), sources: [], refused, splits: {} };
  for (const s of use) {
    const n = { turns: 0, written: 0, excluded: 0, with_model: 0, one_option: 0, no_odds: 0 };
    for await (const { row, excluded } of standingTurns(s.path, { run: s.run })) {
      const d = row.decision;
      if (d?.domain !== "want") continue;
      n.turns++;
      if (excluded) { n.excluded++; continue; }
      const sit = d.situation;
      if (sit?.model) { n.with_model++; continue; }
      const odds: { key: string; ppm: number }[] | undefined = sit?.code?.odds;
      if (!odds?.length) { n.no_odds++; continue; }
      if (odds.length < 2) { n.one_option++; continue; }
      const learned = new Map<string, number>((d.options ?? []).filter((o: any) => typeof o.learned === "number").map((o: any) => [o.key, o.learned]));
      const { code: _code, ...rest } = sit;
      w.write(`${JSON.stringify({ split: s.split, run: s.run, profile: s.profile, p: row.p, t: row.t, s: rest, o: odds.map((x) => [x.key, learned.get(x.key) ?? null]), y: odds.map((x) => x.ppm) })}\n`);
      n.written++;
      manifest.splits[s.split] = (manifest.splits[s.split] ?? 0) + 1;
    }
    manifest.sources.push({ ...s, path: s.path.replace(`${RUNS}/`, "runs/"), sha256: sha256File(s.path), ...n });
    console.log(`${s.split.padEnd(5)} ${s.run}: ${n.written} of ${n.turns} want decisions (${n.excluded} kept out by the test cases' rule, ${n.one_option} with one way only)`);
  }
  await w.end();
  manifest.sha256 = sha256File(out);
  writeFileSync(`${out.replace(/\.jsonl$/, "")}.manifest.json`, JSON.stringify(manifest, null, 1));
  console.log(`data: ${out} (${JSON.stringify(manifest.splits)}); refused ${refused.length} captures`);
  return out;
}

// ------------------------------------------------------------------ train

function train(name: string, dataFile: string) {
  const out = join(HOME, "models", name);
  if (existsSync(out)) throw new Error(`${out} exists: choose another --name (a model run is never overwritten)`);
  const bin = join(ROOT, "kernel/target/release/oikos-citizen-train");
  if (sh(["bun", "scripts/slots.ts", "--weight", "1", "--what", "citizen model build", "--", "cargo", "build", "--release", "--manifest-path", "kernel/Cargo.toml", "-p", "oikos-citizen-train"]) !== 0) throw new Error("the trainer did not build");
  const cmd = [bin, "train", "--data", dataFile, "--out", out, "--seeds", flag("seeds", "1,2,3,4,5")!, "--hidden", flag("hidden", "64,64")!];
  for (const k of ["epochs", "lr", "batch", "patience", "min-count", "weight-decay", "limit-train"]) if (flag(k)) cmd.push(`--${k}`, flag(k)!);
  if (sh(["bun", "scripts/slots.ts", "--weight", "1", "--what", `citizen model training (${name})`, "--", ...cmd]) !== 0) throw new Error("training failed");
  const model = join(out, "model.json");
  const sha = sha256File(model);
  const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  report.model_sha256 = sha;
  report.data_sha256 = sha256File(dataFile);
  report.commit = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: ROOT }).stdout.toString().trim();
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
  const best = report.seeds.find((x: any) => x.seed === report.chosen_seed);
  const line = (k: string) => {
    const m = best[k];
    if (!m?.n) return `${k}: none`;
    return `${k} (${m.n} decisions, ${m.runs} runs): KL ${m.fit.kl} nats (uniform ${m.fit.uniform_kl}), distance median ${m.fit.tv_median_points} points, likeliest the same ${(m.fit.likeliest_agrees * 100).toFixed(1)}%, acting at all ${m.totals.acting_at_all.model} against ${m.totals.acting_at_all.code}, spread kept ${m.people.spread_kept}, scrambled ${m.people.scrambled_record_median_points}; edits ${Object.entries(m.edits).map(([e, x]: any) => `${e} ${x.right_way}/${x.n}`).join(", ")}`;
  };
  console.log(`model: ${model}\n  sha256 ${sha}, ${report.weights} weights, ${report.inputs} inputs, seed ${report.chosen_seed}\n  ${line("valid")}\n  ${line("test")}\n  ${line("pilot")}\n  speed: ${report.speed.us_mean} us a decision (p99 ${report.speed.us_p99})`);
}

// ------------------------------------------------------------------

if (import.meta.main) {
  if (args[0] === "towns") towns();
  else {
    const name = flag("name", `want-way-${new Date().toISOString().slice(0, 10)}`)!;
    const file = flag("data") ?? (await data(name));
    if (!args.includes("--data-only")) train(name, file);
  }
}
