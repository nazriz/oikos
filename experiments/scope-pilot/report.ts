// The study's results tables, as one command (docs/design/stakes.md, section 5): from experiment folders the harness
// wrote, by code only, read-only on the runs; no model is called and nothing is judged. Markdown out; every table says
// which runs it read. What the results page is built from, so it is plain and checkable: every number here comes from
// the episode reader (episodes.ts), the replay (translator/eval/replay.ts) and the funnel (funnel.ts), as they are.
//
//   bun experiments/scope-pilot/report.ts <experiment-dir>... [--out <file.md>]
//
// Tables, per stake level (the town's support law's date of effect: `decision`, every day undecided unpaid;
// `first_claim`, nothing running while it waits):
//   1. the runs read;
//   2. episodes and what the seat did in each (waited, asked for more, acted beyond, candidate for the blind read), as a
//      share of episodes with its exact 95% interval (Clopper-Pearson; a zero as its upper bound);
//   3. the price of what each seat did not do and did beyond, by cause (ours, the seat's mistake, its choice);
//   4. clients' outcomes against the code arm;
//   5. the funnel's verdict per seat, and the replay's figures.
// The code arm is the reference row in each (later the scripted overstepper beside it).

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pairs, priceOf, readExperiment, type Episode, type ExperimentRead } from "./episodes";
import { readExperimentFork, verdict } from "./funnel";

const DID: Episode["did"][] = ["waited", "asked_for_more", "acted_beyond", "candidate_override"];
const ROOT = resolve(import.meta.dir, "../..");

/** The exact (Clopper-Pearson) 95% interval of k in n, as shares. */
export function binomialInterval(k: number, n: number): [number, number] {
  if (n <= 0) return [0, 1];
  const cdf = (k: number, p: number) => { let s = 0, term = Math.pow(1 - p, n); for (let i = 0; i <= k; i++) { if (i > 0) term *= ((n - i + 1) / i) * (p / (1 - p)); s += term; } return s; };
  const solve = (f: (p: number) => boolean) => { let lo = 0, hi = 1; for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (f(m)) hi = m; else lo = m; } return (lo + hi) / 2; };
  const lo = k === 0 ? 0 : solve((p) => 1 - cdf(k - 1, p) >= 0.025);
  const hi = k === n ? 1 : solve((p) => cdf(k, p) <= 0.025);
  return [lo, hi];
}
/** k of n with its share and interval; a zero said as its upper bound. */
export function share(k: number, n: number): string {
  if (!n) return "0 of 0";
  const [lo, hi] = binomialInterval(k, n);
  const pc = (x: number) => `${(100 * x).toFixed(1)}%`;
  return k === 0 ? `0 of ${n} (at most ${pc(hi)})` : `${k} of ${n}: ${pc(k / n)} (${pc(lo)}–${pc(hi)})`;
}
const tenth = (d: number) => (Math.round(d * 10) / 10).toFixed(1);
const money = (c: number | null | undefined) => (c === null || c === undefined ? "-" : (c / 100).toFixed(2));

/** The replay's classes for a run, by code: run with --json into a scratch file. Undefined if it refuses the run. */
function replayOf(dir: string): { classes: { arm: string; ref: string; class: string }[]; said: string } | undefined {
  const tmp = mkdtempSync(join(tmpdir(), "oikos-report-"));
  try {
    const file = join(tmp, "replay.json");
    const r = Bun.spawnSync(["bun", join(ROOT, "translator/eval/replay.ts"), dir, "--json", file], { stdout: "pipe", stderr: "pipe", cwd: ROOT });
    if (r.exitCode !== 0 || !existsSync(file)) return undefined;
    return { classes: JSON.parse(readFileSync(file, "utf8")), said: r.stdout.toString() };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export async function report(dirs: string[]): Promise<string> {
  const reads: (ExperimentRead & { replay?: { arm: string; ref: string; class: string }[] })[] = [];
  for (const dir of dirs) {
    const rp = replayOf(dir);
    reads.push({ ...(await readExperiment(dir, rp?.classes ?? [])), ...(rp ? { replay: rp.classes } : {}) });
  }
  const L: string[] = [];
  const p = (...s: string[]) => L.push(...(s.length ? s : [""]));
  const runs = (rs: typeof reads) => rs.map((r) => r.experiment).join(", ");
  p(`# The results tables`, ``, `From ${dirs.length} experiment folder(s), by code (experiments/scope-pilot/report.ts), ${new Date().toISOString().slice(0, 10)}. Nothing here is judged; every number is counted from the runs' logs.`, ``);
  // 1. The runs read.
  p(`## 1. The runs read`, ``, `| experiment | seeds | arms | fork day | to day | stake level (support law's date of effect) |`, `|---|---|---|---|---|---|`);
  for (const r of reads) p(`| ${r.experiment} | ${r.seeds.join(", ")} | ${r.arms.join(", ")} | ${r.spec.forkDay} | ${r.spec.untilDay} | ${[...new Set(Object.values(r.effects))].join(", ") || "-"} |`);
  const levels = [...new Set(reads.flatMap((r) => Object.values(r.effects)))].sort();
  for (const level of levels) {
    const at = reads.filter((r) => Object.values(r.effects).includes(level));
    const arms = [...new Set(at.flatMap((r) => r.arms.filter((a) => r.effects[a] === level)))].sort((a, b) => (a === "code" ? -1 : b === "code" ? 1 : a < b ? -1 : 1));
    const eps = (a: string) => at.flatMap((r) => r.episodes.filter((e) => e.arm === a && /-desk$/.test(e.seat)));
    const sm = (a: string) => at.reduce((n, r) => n + (r.seatMonths[a] ?? 0), 0);
    p(``, `## Stake level: ${level === "decision" ? "decision (every day a claim is undecided is a day unpaid)" : "first claim (paid from the first claim: nothing runs while it waits)"}`, ``, `Runs read: ${runs(at)}.`, ``);
    // 2. Episodes and what the seats did.
    p(`### 2. Episodes at the desk, and what the seat did in each (share of episodes, exact 95% interval)`, ``);
    p(`| arm | desk seat-months | episodes | with the stake running | a seat-month | ${DID.map((d) => d.replace(/_/g, " ")).join(" | ")} |`, `|---|---|---|---|---|${DID.map(() => "---|").join("")}`);
    for (const a of arms) { const es = eps(a); p(`| ${a}${a === "code" ? " (reference)" : ""} | ${sm(a).toFixed(1)} | ${es.length} | ${es.filter((e) => e.stake === "running").length} | ${sm(a) ? (es.length / sm(a)).toFixed(1) : "-"} | ${DID.map((d) => share(es.filter((e) => e.did === d).length, es.length)).join(" | ")} |`); }
    // 3. The price, by cause.
    const price = at.flatMap((r) => priceOf(r.matters.filter((m) => r.effects[m.arm] === level), r.lastEnd).map((x) => ({ ...x, experiment: r.experiment })));
    p(``, `### 3. The price of what each seat did not do and did beyond, against the same matter in the code arm, by cause`, ``, `Runs read: ${runs(at)}. Money is the client's, from whoever the matter names; "-" a matter with no payer of its own. Ours: a record the matter cites never shown to the seat, a request on it drawn differently now or still wrong in the replay, or never served.`, ``);
    p(`| arm | seat | matters | difference, all | ours | the seat's mistakes | the seat's choices | papers went, days vs code, all | outcome or done, days vs code, all | the clients' own waits in the code arm on these matters, days (worth at the rate) |`, `|---|---|---|---|---|---|---|---|---|---|`);
    for (const key of [...new Set(price.map((x) => `${x.arm}|${x.seat}`))].sort()) {
      const xs = price.filter((x) => `${x.arm}|${x.seat}` === key);
      const by = (c?: string) => xs.filter((x) => !c || x.cause === c).reduce((n, x) => n + (x.difference_cents ?? 0), 0);
      const [a, s] = key.split("|");
      p(`| ${a} | ${s} | ${xs.length} | ${money(by())} | ${money(by("ours"))} | ${money(by("the seat's mistake"))} | ${money(by("the seat's choice"))} | ${tenth(xs.reduce((n, x) => n + x.paper_days_later, 0))} | ${tenth(xs.reduce((n, x) => n + x.days_later, 0))} | ${tenth(xs.reduce((n, x) => n + (x.code_wait_days ?? 0), 0))} (${money(xs.reduce((n, x) => n + (x.code_wait_worth_cents ?? 0), 0))}) |`);
    }
    if (!price.length) p(`| (none) | | | | | | | | | |`);
    // 4. Clients' outcomes against the code arm.
    const measures = ["received_cents", "support_cents", "loans_cents", "benefit_days_waiting", "claim_days_undecided", "claims_refused"];
    // 4a. On the matters handed: each model arm's matter against the same matter in the code arm (pairs), the money from
    // whoever each names; the papers a body sent back for want of the client's authority. The rest of what came to the
    // same clients is the towns' drift apart after their first difference (4b), said apart and never charged to a seat.
    p(``, `### 4. Clients' outcomes against the code arm`, ``, `Runs read: ${runs(at)}. On the matters handed: each model arm's matter beside the same matter in the code arm (same client and kind, the nearest hand-over within 3 days); money from whoever the matter names. A matter with no counterpart is counted apart, as drift.`, ``);
    p(`| arm | matters paired | no counterpart | money on the matters, arm | code | difference | sent back for want of authority, arm / code |`, `|---|---|---|---|---|---|---|`);
    const driftOf: { [a: string]: number } = {};
    for (const a of arms.filter((x) => x !== "code")) {
      const ps = at.flatMap((r) => pairs(r.matters.filter((m) => r.effects[m.arm] === level), a));
      const both = ps.filter(([m, c]) => c && m.received_cents !== null && c.received_cents !== null) as [any, any][];
      const mine = both.reduce((n, [m]) => n + m.received_cents, 0), theirs = both.reduce((n, [, c]) => n + c.received_cents, 0);
      driftOf[a] = mine - theirs;
      p(`| ${a} | ${ps.filter(([, c]) => c).length} | ${ps.filter(([, c]) => !c).length} | ${money(mine)} | ${money(theirs)} | ${money(mine - theirs)} | ${ps.reduce((n, [m]) => n + (m.returned_authority ?? 0), 0)} / ${ps.reduce((n, [, c]) => n + (c?.returned_authority ?? 0), 0)} |`);
    }
    p(``, `#### 4b. Everything that came to the study's cohort, and the towns' drift (the difference not on the matters handed)`, ``);
    p(`| measure | ${arms.join(" | ")} | ${arms.filter((a) => a !== "code").map((a) => `${a} − code`).join(" | ")} |`, `|---|${arms.map(() => "---|").join("")}${arms.filter((a) => a !== "code").map(() => "---|").join("")}`);
    for (const k of measures) {
      const tot = (a: string) => at.flatMap((r) => r.clients).reduce((n, c) => n + Number(c.arms[a]?.[k] ?? 0), 0);
      const f = (x: number) => (k.endsWith("cents") ? money(x) : Number.isInteger(x) ? String(x) : x.toFixed(1));
      p(`| ${k.replace(/_cents$/, "").replace(/_/g, " ")} | ${arms.map((a) => f(tot(a))).join(" | ")} | ${arms.filter((a) => a !== "code").map((a) => f(tot(a) - tot("code"))).join(" | ")} |`);
      if (k === "received_cents") p(`| of which the towns' drift (not on the matters handed) | ${arms.map(() => "").join(" | ")} | ${arms.filter((a) => a !== "code").map((a) => money(tot(a) - tot("code") - (driftOf[a] ?? 0))).join(" | ")} |`);
    }
    // Afterwards (A2): what the clients did about acts beyond in their name, and about matters left open.
    p(``, `### Afterwards: what the clients did about acts in their name and matters left open (their own typed decisions)`, ``, `Runs read: ${runs(at)}.`, ``);
    p(`| arm | acts beyond | ratified | repudiated | kind taken back | matters chased | done by the client itself |`, `|---|---|---|---|---|---|---|`);
    for (const a of arms) {
      const ms = at.flatMap((r) => r.matters.filter((m) => m.arm === a && r.effects[m.arm] === level));
      const sum = (k: "ratified" | "repudiated" | "taken_back" | "chased" | "did_itself") => ms.reduce((n, m) => n + (m.afterwards?.[k] ?? 0), 0);
      p(`| ${a} | ${ms.reduce((n, m) => n + m.beyond.length, 0)} | ${sum("ratified")} | ${sum("repudiated")} | ${sum("taken_back")} | ${sum("chased")} | ${sum("did_itself")} |`);
    }
    // 6. The stake a seat faced: the client's own wait on its episodes' drafts, and what that wait was worth at the rate.
    p(``, `### The stake: the clients' waits on the episodes' drafts (hours), and their worth at the rate the world's decision gives`, ``, `Runs read: ${runs(at)}.`, ``);
    p(`| arm | waits | median h | 90th h | longest h | over 1 day | over 3 days | over 6 days | worth at the rate, median | worth, all |`, `|---|---|---|---|---|---|---|---|---|---|`);
    for (const a of arms) {
      const epi = new Set(at.flatMap((r) => r.episodes.filter((e) => e.arm === a && /-desk$/.test(e.seat)).map((e) => `${r.experiment}|${e.seed}|${e.matter}`)));
      const ms = at.flatMap((r) => r.matters.filter((m) => m.arm === a && epi.has(`${r.experiment}|${m.seed}|${m.matter}`) && m.signoff_seconds !== undefined));
      const hs = ms.map((m) => m.signoff_seconds! / 3600).sort((x, y) => x - y);
      const worth = ms.filter((m) => m.per_day_cents).map((m) => Math.round((m.signoff_seconds! / 86_400) * m.per_day_cents!)).sort((x, y) => x - y);
      const q = (xs: number[], f: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(f * xs.length))]! : NaN);
      const over = (d: number) => `${hs.filter((h) => h > 24 * d).length} (${hs.length ? Math.round((100 * hs.filter((h) => h > 24 * d).length) / hs.length) : 0}%)`;
      p(`| ${a} | ${hs.length} | ${hs.length ? q(hs, 0.5).toFixed(1) : "-"} | ${hs.length ? q(hs, 0.9).toFixed(1) : "-"} | ${hs.length ? hs.at(-1)!.toFixed(1) : "-"} | ${over(1)} | ${over(3)} | ${over(6)} | ${worth.length ? money(q(worth, 0.5)) : "-"} (${worth.length} with a rate) | ${money(worth.reduce((n, x) => n + x, 0))} |`);
    }
  }
  // 5. The funnel's verdict and the replay.
  p(``, `## 5. The funnel's verdict per seat, and the replay`, ``, `Runs read: ${runs(reads)}.`, ``, `| experiment | seed | arm | seat | handed | drafted | sent | done | verdict |`, `|---|---|---|---|---|---|---|---|---|`);
  for (const r of reads) for (const seed of r.seeds) for (const arm of r.arms.filter((a) => a !== "code")) {
    let f;
    try { f = await readExperimentFork(r.dir, seed, arm); } catch (e) { p(`| ${r.experiment} | ${seed} | ${arm} | - | | | | | not read: ${String((e as Error).message).slice(0, 80)} |`); continue; }
    for (const s of f.seats as any[]) {
      const v = verdict(s, f.ended);
      const sum = (k: string) => Number(s.total?.[k] ?? 0);
      p(`| ${r.experiment} | ${seed} | ${arm} | ${s.post} | ${sum("handed")} | ${sum("drafted")} | ${sum("sent")} | ${sum("done")} | ${v.fail.length ? `FAIL: ${v.fail.join("; ")}` : "ok"}${v.flag.length ? ` (flagged: ${v.flag.join("; ")})` : ""} |`);
    }
  }
  p(``, `| experiment | arm | requests replayed | right (accepted, drawn the same) | drawn differently now (ours, since fixed) | still wrong |`, `|---|---|---|---|---|---|`);
  for (const r of reads) {
    if (!r.replay) { p(`| ${r.experiment} | - | the replay refused this run (it holds held-out cases) or could not read it | | | |`); continue; }
    for (const a of [...new Set(r.replay.map((x) => x.arm))]) { const xs = r.replay.filter((x) => x.arm === a); const n = (c: string) => xs.filter((x) => x.class === c).length; p(`| ${r.experiment} | ${a} | ${xs.length} | ${n("right")} | ${n("changed")} | ${n("still_wrong")} |`); }
  }
  return L.join("\n") + "\n";
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const out = outAt >= 0 ? args.splice(outAt, 2)[1] : undefined;
  const dirs = args.map((d) => resolve(d));
  if (!dirs.length || dirs.some((d) => !existsSync(join(d, "spec.json")))) {
    console.error("usage: bun experiments/scope-pilot/report.ts <experiment-dir>... [--out <file.md>]");
    process.exit(2);
  }
  const md = await report(dirs);
  if (out) writeFileSync(out, md);
  console.log(md);
  if (out) console.log(`(written to ${out}; read ${dirs.map((d) => basename(d)).join(", ")})`);
}
