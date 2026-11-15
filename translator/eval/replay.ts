// A run's requests replayed through the translator's rules as they are now (docs/handover.md: after a rung, and
// before rerunning one, run this). Read-only on the run: its logs are exported to a scratch folder, never written to.
//
// For each model seat's request (the translator's own transcript in the log: the words, and the call it first wrote),
// what the seat was shown and did (the draft, its preview, the seat's yes or no and why, or what it was asked back),
// and what the rules now in this checkout would draw: the same call through `formRules` and `ruled`, resolved on the
// seat's knowledge rebuilt from what it was shown before it asked, and previewed as the seat would read it.
//
// Per seat model, two figures as logged and as now: drafts the seat would accept, and right on first asking. "Now" is
// a range: its low end counts what the seat accepted and is drawn the same now; its high end adds every request now
// drawn or previewed differently, each listed with the seat's reason, for a reader to check. Then every request still
// wrong (drawn the same, and declined or asked back), with a one-line class. No model is called.
//
//   bun translator/eval/replay.ts <run folder> [--json <file>]
//
// The regression check (docs/handover.md; translator/src/rules.ts, its order of precedence): every request a seat
// confirmed as drawn, in every model arm of the runs named, drawn and previewed by the rules now; each one drawn or
// shown differently is listed with the rules that touched it, and it exits 1 if any is not in the explained file
// (translator/test/regress-explained.json, each entry pointing at its docs/decisions.md entry). With `--extract` it
// also writes the compact extract the gate's check reads (translator/test/regress.test.ts): the requests and what each
// seat was shown, each record once, gzipped. A `.json.gz` extract may be named in place of a run.
//
//   bun translator/eval/replay.ts --regress <run folders or extract...> [--extract <file.json.gz>] [--explained <file>]
//
// It refuses a run whose seat-days hold the pilot cases (translator/eval/pilot-cases.ts): those stay out of all of it.

import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as pathResolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { PILOT_CASES } from "./pilot-cases";
import { canon, changesBetween, compact, expand, explainedKeys, keyOf, readArm, regressions, replayOne, withKnowledge, type ArmLog, type CompactArm, type Difference, type Explained, explainedOf } from "./requests";

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
// (`--json <file>`: each request's class, by arm and reference, for the episode reader's price table: "still_wrong",
// "changed" or "right" (accepted and drawn the same).)
const jsonOut = flag("--json");
const extractOut = flag("--extract");
const explainAs = flag("--explain");
const explainedAt = flag("--explained") ?? join(import.meta.dir, "..", "test", "regress-explained.json");
const regress = argv[0] === "--regress" ? (argv.shift(), true) : false;
if (!argv.length) {
  console.error("usage: bun translator/eval/replay.ts <run folder> [--json <file>]\n       bun translator/eval/replay.ts --regress <run folders or extract...> [--extract <file.json.gz>] [--explained <file>]");
  process.exit(2);
}
// (The pilot cases' runs, by their folder as the cases name it: refused, folder and any folder inside one.)
const held = [...new Set(PILOT_CASES.map((c) => c.from.run.replace(/\/+$/, "")))];
function runOf(folder: string): { run: string; logs: string[] } {
  const run = realpathSync(pathResolve(folder));
  if (held.some((h) => run.endsWith(`/${h}`) || run.includes(`/${h}/`))) {
    console.error(`${run} holds the pilot cases' seat-days (translator/eval/pilot-cases.ts): they stay out of all of it.`);
    process.exit(3);
  }
  const seeds = readdirSync(run).filter((d) => d.startsWith("seed-")).map((d) => join(run, d));
  const logs = (seeds.length ? seeds : [run]).flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".oklog") && f !== "base.oklog" && f !== "code.oklog").map((f) => join(d, f)));
  if (!logs.length) { console.error(`no model arm's log in ${run}`); process.exit(2); }
  return { run, logs };
}

/** Every model arm of these runs, read from their logs, or from an extract (a `.json.gz` named in place of a run). */
async function arms(folders: string[]): Promise<ArmLog[]> {
  const out: ArmLog[] = [];
  const scratch = mkdtempSync(join(tmpdir(), "oikos-replay-"));
  try {
    for (const folder of folders) {
      if (folder.endsWith(".json.gz")) { out.push(...(JSON.parse(gunzipSync(await Bun.file(folder).bytes()).toString()) as CompactArm[]).map(expand)); continue; }
      const { run, logs } = runOf(folder);
      for (const log of logs) out.push(await readArm(log, run.split("/").pop()!, scratch));
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return out;
}

if (regress) {
  const all = await arms(argv);
  if (extractOut) {
    const bytes = gzipSync(JSON.stringify(all.map(compact)), { level: 9 });
    await Bun.write(extractOut, bytes);
    console.log(`extract: ${extractOut}, ${(bytes.length / 1e6).toFixed(2)} MB, ${all.reduce((n, a) => n + a.requests.length, 0)} requests in ${all.length} arms`);
  }
  const explained = await explainedKeys(explainedAt);
  let confirmed = 0;
  const open: Difference[] = [], known: Difference[] = [];
  for (const a of all) {
    const r = regressions(a);
    confirmed += r.confirmed;
    for (const d of r.differences) (explained.has(keyOf(d)) ? known : open).push(d);
  }
  console.log(`Regression check: ${confirmed} requests the seats confirmed as drawn, in ${all.length} arms; drawn or shown differently now: ${open.length + known.length} (${known.length} explained in docs/decisions.md).`);
  for (const d of [...open, ...known]) console.log(describe(d, explained.has(keyOf(d))));
  // (`--explain "<decisions.md heading>"`: every difference not yet explained written into the explained file as a
  // correction under that entry; only once the entry says why each is right. A regression is fixed, never explained.)
  if (explainAs && open.length) {
    const was: Explained[] = (await Bun.file(explainedAt).exists()) ? await Bun.file(explainedAt).json() : [];
    const add: Explained[] = open.map((d) => explainedOf(d, explainAs));
    await Bun.write(explainedAt, `[\n${[...was, ...add].map((x) => JSON.stringify(x)).join(",\n")}\n]\n`);
    console.log(`\n${add.length} written to ${explainedAt} as explained by "${explainAs}".`);
    process.exit(0);
  }
  process.exit(open.length ? 1 : 0);
}

const { run } = runOf(argv[0]!);
const totals = new Map<string, { offered: number; accepted: number; first: number; firstAccepted: number; low: number; high: number; firstLow: number; firstHigh: number }>();
const wrong: string[] = [];
const classes: { arm: string; ref: string; class: "still_wrong" | "changed" | "right" }[] = [];
const changed: string[] = [];
for (const a of await arms([argv[0]!])) {
  const arm = a.arm;
  for (const [r, k] of withKnowledge(a)) {
    const who = `${arm}: ${a.model[r.seat] ?? r.seat}`;
    const t = totals.get(who) ?? { offered: 0, accepted: 0, first: 0, firstAccepted: 0, low: 0, high: 0, firstLow: 0, firstHigh: 0 };
    totals.set(who, t);
    const { now, preview } = replayOne(r, k);
    const logged = r.call ?? r.failedCall ?? "";
    // (Accepted and drawn the same: accepted now, whatever the preview's wording. Not accepted: the same only where both
    // the call and what the seat would be shown are.)
    const same = canon(now) === canon(logged) && (r.decision === "accept" || r.summary === undefined || preview === r.summary);
    const first = (r.stage ?? "first") === "first";
    if (r.call) t.offered++;
    if (first) t.first++;
    if (r.decision === "accept") { t.accepted++; if (first) t.firstAccepted++; }
    if (r.decision === "accept" && same) { t.low++; if (first) t.firstLow++; t.high++; if (first) t.firstHigh++; classes.push({ arm, ref: r.ref, class: "right" }); continue; }
    classes.push({ arm, ref: r.ref, class: same ? "still_wrong" : "changed" });
    if (!same) {
      t.high++; if (first) t.firstHigh++;
      changed.push(`${who} ${r.ref}${first ? "" : " (restated)"}: ${r.decision === "accept" ? "accepted" : r.decision === "reject" ? `declined ("${cut(r.note ?? "", 110)}")` : `asked back ("${cut(r.failure ?? "", 110)}")`}\n    logged: ${cut(logged, 160)}\n    now:    ${cut(now, 160)}${newLines(r.summary ?? "", preview).map((x) => `\n    shown:  ${cut(x, 220)}`).join("")}`);
      continue;
    }
    wrong.push(`${who} ${r.ref}: ${r.decision === "reject" ? `declined, drawn the same now: "${cut(r.note ?? "", 140)}"` : r.failure ? `asked back, the same now: "${cut(r.failure, 140)}"` : "drafted, not answered"}  [${cut(r.request, 100)}]`);
  }
}

if (jsonOut) await Bun.write(jsonOut, JSON.stringify(classes, null, 1));
console.log(`Replay of ${run}, with the rules of this checkout.\n`);
for (const [who, t] of totals) {
  const range = (lo: number, hi: number) => (lo === hi ? `${lo}` : `${lo} to ${hi}`);
  console.log(`${who}\n  drafts the seat would accept: as logged ${t.accepted} of ${t.offered} offered; now ${range(t.low, t.high)}\n  right on first asking: as logged ${t.firstAccepted} of ${t.first}; now ${range(t.firstLow, t.firstHigh)}`);
}
console.log(`\nDrawn or shown differently now (${changed.length}), each to be checked against the seat's reason:`);
for (const c of changed) console.log(`- ${c}`);
console.log(`\nStill wrong (${wrong.length}): drawn and shown the same now, and declined or asked back:`);
for (const w of wrong) console.log(`- ${w}`);

function describe(d: Difference, explained: boolean): string {
  return `\n- ${explained ? "(explained) " : ""}${d.run} ${d.arm} ${d.ref}, by ${d.rules.join(", ") || "(no rule: the preview or the resolver)"}\n    asked:  ${cut(d.request, 220)}\n    logged: ${cut(d.logged, 220)}\n    now:    ${cut(d.now, 220)}\n    change: ${cut(changesBetween(d.logged, d.now), 300)}${newLines(d.shownThen, d.shownNow).map((x) => `\n    shown:  ${cut(x, 220)}`).join("")}`;
}
/** The lines of what the seat would be shown now that it was not shown then (the first three). */
function newLines(was: string, now: string): string[] {
  const old = new Set(was.split("\n").map((x) => x.trim()));
  return now.split("\n").map((x) => x.trim()).filter((x) => x && !old.has(x)).slice(0, 3);
}
function cut(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, n - 1)}…`;
}
