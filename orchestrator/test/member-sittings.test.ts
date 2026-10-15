// A day's ripe cases reach the tribunal's member in one paper and one sitting (docs/behaviour/office-books.md, point 8),
// in a run: a living town of 300 whose tribunal has 24 more tenancies before it than it opens with (test-only papers,
// answer-by days drawn over the first 40 days, so that several fall ripe on some days and none on others), the member
// a seat (the mock, with a reader in it: scripts/member-sittings.ts) and the office's code acting. Held:
//   - on every day on which the member sat for the list, its first prompt names every case that was ripe and undecided
//     in full (so no further look was needed for the ripe cases), and the clerk filed that paper once that day;
//   - the seat sat once on a day, and on a day with nothing ripe and nothing else it did not sit on that account;
//   - no case is lost or left undecided past the working day after its day (a weekend counts as none);
//   - a code tribunal in the same town decides the same cases on the same days with or without the change in the
//     seat's side (it has no clerk and no list; its decisions are the office's code, as ever).

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { heavyCaseload, readerOf, type Tally } from "../../scripts/member-sittings";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const living = { ...spec, citizens: 300, profile: "ke-nakuru-2026", opening_caseload: true, living: { initiative_bps: 10_000, friction_bps: 60_000 } };
const DAYS = 45;

async function walk(seated: boolean) {
  const config = generate({ ...living, mayor: "code", ...(seated ? { model_seats: "tribunal-member" } : {}) }) as any;
  const added = heavyCaseload(config, 24, 40);
  expect(added).toBeGreaterThan(15);
  const tally: Tally = { sittings: 0, calls: 0, prompts: [], messages: [], fromEntry: 0, looks: 0, sittingDays: [] };
  const prompts: { day: number; text: string }[] = [];
  const out = mkdtempSync(join(tmpdir(), "oikos-member-sittings-"));
  const recs: any[] = [];
  // (An application its landlord withdrew, the rent owed having been paid, is no longer a case: nothing is decided on it.)
  const withdrawn = new Set<string>();
  try {
    const watch = (inner: any) => (req: any) => { if (req.subject === "tribunal-member-system" && req.messages.length === 1 && req.purpose === "participant") prompts.push({ day: Math.floor(req.context.observation.t / DAY), text: String(req.messages[0].content) }); return inner(req); };
    const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: "member-sittings", outDir: out, until: DAYS * DAY, recordObservations: "none", ...(seated ? { mockParticipant: (inner: any) => watch(readerOf({ reader: "plain", returns: "list" }, tally)(inner)) } : {}) });
    expect(s.participantErrors).toBe(0);
    for (const l of readFileSync(s.logPath, "utf8").split("\n")) if (l.includes('"event":"recorded"')) { const r = JSON.parse(l).body.record; if (r?.record === "statement") recs.push(r); else if (r?.record === "withdrawal") withdrawn.add(String(r.withdraws)); }
  } finally { rmSync(out, { recursive: true, force: true }); }
  const answerBy = new Map<string, number>();
  for (const r of config.world.records as any[]) if (r.kind === "hearing_notice" && r.data?.application && r.data.answer_by > 0) answerBy.set(r.data.application, r.data.answer_by);
  for (const r of recs) if (r.kind === "hearing_notice" && r.data?.application && r.data.answer_by !== undefined && !answerBy.has(r.data.application)) answerBy.set(r.data.application, r.data.answer_by);
  for (const app of withdrawn) answerBy.delete(app);
  const orders = new Map<string, number>();
  for (const r of recs) if (r.kind === "tribunal_order" && r.in_position?.startsWith("tribunal-member") && r.data?.application) orders.set(r.data.application, r.at);
  return { recs, tally, prompts, answerBy, orders };
}

test("a member's seat with cases ripe: the day's list is one paper naming every ripe case in full, it brings the seat once, and no case is lost or late", async () => {
  const { recs, tally, prompts, answerBy, orders } = await walk(true);
  const lists = recs.filter((r) => r.kind === "office_books" && r.in_position === "tribunal-member-staff" && r.data?.list);
  // One paper a day at most, by the clerk.
  const days = lists.map((r) => Math.floor(r.at / DAY));
  expect(new Set(days).size).toBe(days.length);
  expect(lists.length).toBeGreaterThan(5);
  // On a day when several cases were ripe, one paper names them all, in full.
  const widest = [...lists].sort((a, b) => b.data.list.ripe - a.data.list.ripe)[0]!;
  expect(widest.data.list.ripe).toBeGreaterThanOrEqual(2);
  for (const e of (widest.data.open as any[]).filter((x) => x.what.includes("whose day has come"))) expect(widest.text).toContain(e.says);
  // The seat sat once on a day.
  expect(new Set(tally.sittingDays).size).toBe(tally.sittingDays.length);
  // The seat sat on the working day after a list with a case new on it, and on no other day but the one it chose (back in a
  // week, the reader's return): a sitting is the first, or follows a list with something new on it, or is its own.
  const working = (d: number) => d % 7 < 5;
  const nextWorking = (d: number) => { let x = d + 1; while (!working(x)) x++; return x; };
  // (A list filed before the day's sitting opens (08:00 in this town) is for that day's; otherwise for the next working day's.)
  const forDay = (r: any) => (working(Math.floor(r.at / DAY)) && r.at % DAY < 8 * 3600 ? Math.floor(r.at / DAY) : nextWorking(Math.floor(r.at / DAY)));
  const wanted = new Set(lists.filter((r) => r.data.list.new > 0).map(forDay));
  const sat = tally.sittingDays;
  for (let i = 1; i < sat.length; i++) {
    let own = sat[i - 1]! + 7;
    while (!working(own)) own++;
    expect(wanted.has(sat[i]!) || sat[i] === own).toBe(true);
  }
  for (const d of wanted) if (d < DAYS - 1) expect(sat).toContain(d);
  // What it was shown at a sitting that a list brought it to: the newest paper of the clerk's whole, so every ripe case in full.
  const books = recs.filter((r) => r.kind === "office_books" && r.in_position === "tribunal-member-staff").sort((x, y) => x.at - y.at);
  let checked = 0;
  for (const d of wanted) {
    const shown = prompts.find((p) => p.day === d)?.text;
    if (shown === undefined) continue;
    const newest = books.filter((r) => r.at < d * DAY + 8 * 3600).at(-1)!;
    for (const e of (newest.data.open as any[]).filter((x) => x.what.includes("whose day has come"))) expect(shown).toContain(e.says);
    checked++;
  }
  expect(checked).toBeGreaterThan(3);
  // No case lost: each case whose day was over by day 40 is decided, no later than the next working day after its day (a weekend gives up to three).
  let late = 0, measured = 0;
  for (const [app, by] of answerBy) {
    if (by > (DAYS - 6) * DAY) continue;
    expect(orders.has(app)).toBe(true);
    measured++;
    const after = Math.floor(orders.get(app)! / DAY) - Math.floor(by / DAY);
    if (after > 3) late++;
  }
  expect(measured).toBeGreaterThan(15);
  expect(late).toBe(0);
}, 600_000);

test("a code tribunal in the same town files no list, has no clerk, and decides each case on the day it is ripe", async () => {
  const { recs, answerBy, orders } = await walk(false);
  expect(recs.filter((r) => r.kind === "office_books" && r.in_position?.startsWith("tribunal-member")).length).toBe(0);
  let measured = 0;
  for (const [app, by] of answerBy) {
    if (by > (DAYS - 3) * DAY) continue;
    measured++;
    const o = orders.get(app);
    expect(o).toBeDefined();
    expect(o! - by).toBeLessThan(2 * DAY);
  }
  expect(measured).toBeGreaterThan(15);
}, 600_000);
