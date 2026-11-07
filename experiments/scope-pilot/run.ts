// Starts the scope pilot (README.md): every experiment detached (nohup, kept awake by caffeinate -i -w <pid>), each in
// its own folder under the runs folder, taken up again where it stopped if it is there already (--resume). Logs are
// never deleted or overwritten: a finished experiment's folder is left alone and reported.
//
//   bun experiments/scope-pilot/run.ts --mock            a dry run of every spec, the mock in every seat (no model called)
//   bun experiments/scope-pilot/run.ts --go              the real run: the scope set first, then every experiment
//   bun experiments/scope-pilot/run.ts --go --only pilot only the experiments named (pilot, rare, neutral, sol; scope-set)
//   bun experiments/scope-pilot/run.ts --status          where each stands, and what it has spent
//
// The API key is never read here: each process is started under a shell that sources ~/.zshenv (where the owner keeps
// OIKOS_ANTHROPIC_KEY), and ANTHROPIC_API_KEY is taken out of its environment. Runs go to $OIKOS_RUNS, else ~/oikos/runs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BUDGET } from "./plan";

const root = resolve(import.meta.dir, "../..");
const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const value = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const mock = has("--mock");
const go = has("--go");
const runs = process.env.OIKOS_RUNS ?? join(homedir(), "oikos", "runs");
const models = process.env.OIKOS_TRANSLATOR_MODELS ?? join(homedir(), "oikos", "runs", "translator-model");
const prefix = mock ? "scope-pilot-dry" : "scope-pilot";

const EXPERIMENTS = [
  { key: "pilot", spec: "experiments/scope-pilot/pilot.ts", out: `${prefix}`, parallel: 3 },
  { key: "rare", spec: "experiments/scope-pilot/rare.ts", out: `${prefix}-rare`, parallel: 2 },
  { key: "neutral", spec: "experiments/scope-pilot/neutral.ts", out: `${prefix}-neutral`, parallel: 2 },
  { key: "sol", spec: "experiments/scope-pilot/sol.ts", out: `${prefix}-sol`, parallel: 2 },
];
const only = value("--only")?.split(",");
const chosen = EXPERIMENTS.filter((e) => !only || only.includes(e.key));

/** Where an experiment's folder stands: not begun, begun and not finished (taken up with --resume), or finished. */
function state(dir: string): "new" | "unfinished" | "finished" {
  if (existsSync(join(dir, "results.json"))) return "finished";
  return existsSync(join(dir, "spec.json")) ? "unfinished" : "new";
}

function spent(dir: string): string {
  const f = join(dir, "cost.json");
  if (!existsSync(f)) return "no cost.json yet";
  try { const c = JSON.parse(readFileSync(f, "utf8")); return `spent $${Number(c.usd ?? 0).toFixed(2)}`; } catch { return "cost.json unreadable"; }
}

/** A command started detached under a shell that has the owner's environment (~/.zshenv) and no ANTHROPIC_API_KEY,
 * kept awake while it runs; its output to `<runs>/<name>.out`, its pid to `<runs>/<name>.pid`. */
function detached(name: string, cmd: string[]): number {
  const out = join(runs, `${name}.out`);
  const env = { ...process.env, OIKOS_TRANSLATOR_MODELS: models };
  delete (env as any).ANTHROPIC_API_KEY;
  if (mock) delete (env as any).OIKOS_ANTHROPIC_KEY;
  const quoted = cmd.map((x) => `'${x.replace(/'/g, `'\\''`)}'`).join(" ");
  const script = `${mock ? "" : "[ -f ~/.zshenv ] && source ~/.zshenv; "}unset ANTHROPIC_API_KEY; cd '${root}'; nohup ${quoted} >> '${out}' 2>&1 & pid=$!; caffeinate -i -w $pid >/dev/null 2>&1 & echo $pid`;
  const p = Bun.spawnSync(["/bin/zsh", "-c", script], { env, stdout: "pipe", stderr: "pipe" });
  const pid = Number(p.stdout.toString().trim().split("\n").at(-1));
  if (!pid) throw new Error(`${name}: could not start: ${p.stderr.toString().slice(0, 300)}`);
  writeFileSync(join(runs, `${name}.pid`), `${pid}\n`);
  return pid;
}

if (has("--status")) {
  for (const p of ["scope-pilot", "scope-pilot-dry"]) for (const e of EXPERIMENTS) {
    const dir = join(runs, e.out.replace(/^scope-pilot(-dry)?/, p));
    if (!existsSync(dir)) continue;
    const pidFile = `${dir}.pid`;
    const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8").trim()) : undefined;
    const alive = pid ? Bun.spawnSync(["kill", "-0", String(pid)]).exitCode === 0 : false;
    console.log(`${dir}: ${state(dir)}${alive ? `, running (pid ${pid})` : ""}; ${spent(dir)}`);
  }
  process.exit(0);
}
if (!mock && !go) throw new Error("say --mock (a dry run, nothing called) or --go (the real run); --status for where they stand");
mkdirSync(runs, { recursive: true });

// Before anything: what the run needs on this machine.
const problems: string[] = [];
if (!existsSync(join(root, "kernel/target/release/oikos-kernel"))) problems.push("the kernel is not built (bun run kernel)");
if (!existsSync(join(models, "pod-small-v3-s2"))) problems.push(`no trained translator pod-small-v3-s2 in ${models}`);
if (go) {
  const hasKey = Bun.spawnSync(["/bin/zsh", "-c", '[ -f ~/.zshenv ] && source ~/.zshenv; [ -n "$OIKOS_ANTHROPIC_KEY" ]']).exitCode === 0;
  if (!hasKey) problems.push("OIKOS_ANTHROPIC_KEY is not set in ~/.zshenv");
  if (chosen.some((e) => e.key === "sol") && Bun.spawnSync(["/bin/zsh", "-c", "command -v codex"]).exitCode !== 0) problems.push("the Codex CLI is not installed (for sol)");
}
if (problems.length) throw new Error(`not started: ${problems.join("; ")}`);

// The scope set through the served translator first (TR-8: how often a request for more scope is read as one), its
// report beside the runs; once only: a report already there is kept.
if (go && (!only || only.includes("scope-set"))) {
  const report = join(runs, "scope-pilot-scope-set.json");
  if (existsSync(report)) console.log(`the scope set was read already: ${report}`);
  else {
    console.log("the scope set through the served translator (Sonnet 5.5 behind ours), first ...");
    const p = Bun.spawnSync(["/bin/zsh", "-c", `[ -f ~/.zshenv ] && source ~/.zshenv; unset ANTHROPIC_API_KEY; cd '${root}'; OIKOS_TRANSLATOR_MODELS='${models}' bun translator/eval/scope-served.ts decide/pod-small-v3-s2 anthropic/claude-sonnet-5-5 --budget ${BUDGET.scopeSet} --json '${report}'`], { stdout: "pipe", stderr: "pipe" });
    writeFileSync(join(runs, "scope-pilot-scope-set.out"), p.stdout.toString() + p.stderr.toString());
    if (p.exitCode !== 0) throw new Error(`the scope set did not run (see ${join(runs, "scope-pilot-scope-set.out")}): nothing else was started`);
    console.log(p.stdout.toString().split("\n").slice(0, 16).join("\n"));
  }
}

for (const e of chosen) {
  const dir = join(runs, e.out);
  const st = state(dir);
  if (st === "finished") { console.log(`${dir}: finished; left as it is (${spent(dir)})`); continue; }
  const cmd = ["bun", "orchestrator/src/cli.ts", "experiment", "run", e.spec, "--out", dir, "--parallel", String(e.parallel), ...(mock ? ["--mock-models"] : []), ...(st === "unfinished" ? ["--resume"] : [])];
  const pid = detached(e.out, cmd);
  console.log(`${dir}: ${st === "unfinished" ? "taken up again" : "started"} (pid ${pid}); output in ${join(runs, `${e.out}.out`)}`);
}
console.log("`bun experiments/scope-pilot/run.ts --status` says where each stands; `bun experiments/scope-pilot/readout.ts <dir>` reads one out.");
