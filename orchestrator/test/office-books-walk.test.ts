// Every office's books against its code twin, in a run (docs/behaviour/office-books.md, "Held to the code in a run").
// A mock seat's brain is its office's code: what the brain acts on a given day is what the code would act on. The
// clerk's reader is a second reading of the same papers. So a living town is walked with its offices in mock seats,
// and for every paper a brain acts on (the invoice it pays, the request it answers, the application it decides, the
// lease it gives notice on) the test asks whether the clerk had put that paper in the office's books no later than
// the day the brain acted. Until 2026-10-12 only the landlord's and the support office's readers were held this way;
// the rest were held on papers made by hand, and finance's figure of tax withheld stood still for 84 days of a pilot.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
// (The town opens in the middle of things, docs/behaviour/generator.md: its tribunal has cases listed from the first
// day, with days to answer by spread over the weeks ahead, so that cases fall ripe all through the run.)
const living = { ...spec, citizens: 300, profile: "ke-nakuru-2026", opening_caseload: true, living: { initiative_bps: 10_000, friction_bps: 60_000 } };

/** What an office's act of each kind rests on: the field of its paper that names the paper it answers, pays or decides. */
const RESTS_ON: { [kind: string]: (r: any) => string | undefined } = {
  remedy_request: (r) => (r.data?.matter === "arrears" ? r.data.about : undefined),
  notice_to_vacate: (r) => r.data?.lease,
  tribunal_application: (r) => (r.data?.kind === "possession" || r.data?.kind === "arrears" ? r.data.about : undefined),
  remedy_answer: (r) => r.data?.request,
  variation_answer: (r) => r.basis,
  tribunal_order: (r) => r.data?.application,
  venue_decision: (r) => r.data?.application,
  warrant: (r) => r.basis,
  garnishee_order: (r) => r.data?.order,
  approval: (r) => r.data?.invoice,
  petition_response: (r) => r.data?.petition,
  permit_decision: (r) => r.data?.application,
  loan_decision: (r) => r.data?.application,
  loan_arrears: (r) => r.data?.loan,
  benefit_decision: (r) => r.data?.claim,
  ballot: (r) => r.data?.proposal,
  ballot_result: (r) => r.data?.ballot,
  offer_accepted: (r) => r.basis,
};

test("what each office's code acts on was in that office's books, as its clerk keeps them, no later than the day it acted", async () => {
  const base = generate(living) as any;
  const landlords: string[] = base.positions.filter((p: any) => p.role_module?.code === "firm.landlord").map((p: any) => p.id);
  const others = ["finance", "tribunal-member", "tribunal-registrar", "planning", "outside-support", "union-organiser", "bank-lending", "council-clerk", "complaints", "ombudsman-officer", "consumer-officer"].filter((id) => base.positions.some((p: any) => p.id === id));
  const seats = [...landlords, ...others];
  const config = generate({ ...living, mayor: "llm", model_seats: seats }) as any;
  // (A brain acts the hour a paper comes; a seat sits now and then. So that what a brain acts on has stood open, as it
  // does for a seat, each mock is back at its desk every third day, whatever its brain would; the clerks look in daily.)
  for (const p of config.participants) if (p.controller?.type === "llm") p.controller.params.mock = { ...p.controller.params.mock, back_days: 3 };
  const out = mkdtempSync(join(tmpdir(), "oikos-books-walk-"));
  let recs: any[] = [];
  const withdrawals: any[] = []; // (a withdrawal is a record of its own, not a statement: `withdrawnAt` below looked among statements and could never find one, until the day a landlord withdrew a case the member had listed, 2026-10-12)
  try {
    const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: "books-walk", outDir: out, until: Number(process.env.WALK_DAYS ?? 520) * DAY, recordObservations: "none" });
    expect(s.participantErrors).toBe(0);
    for (const l of readFileSync(s.logPath, "utf8").split("\n")) if (l.includes('"event":"recorded"')) { const r = JSON.parse(l).body.record; if (r?.record === "statement") recs.push(r); else if (r?.record === "withdrawal") withdrawals.push(r); }
  } finally { rmSync(out, { recursive: true, force: true }); }
  const seatOf = new Map<string, string>(["mayor", ...seats].map((id) => [`${id}-system`, id]));
  const books = recs.filter((r) => r.kind === "office_books");
  // (Each paper of the books, as text: what it lists and what it says has gone from the list.)
  const text = new Map<string, { at: number; words: string }[]>();
  for (const b of books) { const k = String(b.data.office); if (!text.has(k)) text.set(k, []); text.get(k)!.push({ at: b.at, words: `${b.text} ${JSON.stringify(b.data.open)}` }); }
  const names = (words: string, id: string) => new RegExp(`(^|[^A-Za-z0-9.-])${id.replace(/[.]/g, "\\.")}($|[^A-Za-z0-9-])`).test(words);
  const byId = new Map(recs.map((r) => [r.id, r]));
  const tally = new Map<string, { acts: number; inBooks: number; missed: string[] }>();
  for (const r of recs) {
    const office = seatOf.get(r.author);
    const on = office ? RESTS_ON[r.kind]?.(r) : undefined;
    if (!office || typeof on !== "string" || !on) continue;
    // (Only what had stood open through a whole day of the clerk's: a paper that came, or a thing that fell due, the
    // day the brain acted or the day before was the seat's post, which brings it back, and the clerk, who looks in
    // once a day and often at the seat's own hour, had no day to list it in. A petition falls due when its
    // organiser's count reaches the town's threshold: the count is the paper that came.)
    const rested = byId.get(on);
    const came = r.kind === "petition_response" ? Math.max(0, ...recs.filter((c) => c.kind === "petition_count" && c.data?.petition === on && c.at <= r.at).map((c) => c.at)) : rested?.at ?? 0;
    if (came >= (Math.floor(r.at / DAY) - 1) * DAY) continue;
    const key = `${config.positions.find((p: any) => p.id === office).role_module.code}: ${r.kind}`;
    const x = tally.get(key) ?? { acts: 0, inBooks: 0, missed: [] };
    x.acts++;
    // (The brain acts at a sitting; the clerk files once a day, when the staff's work for its wake is done: so "no
    // later than the day it acted" is the end of that day.)
    const day = (Math.floor(r.at / DAY) + 1) * DAY;
    if ((text.get(office) ?? []).some((b) => b.at < day && names(b.words, on))) x.inBooks++;
    else {
      x.missed.push(`${office} ${r.id} day ${Math.floor(r.at / DAY)} on ${on}`);
      if (process.env.WALK_DEBUG) console.log("MISSED", office, r.kind, r.at / DAY, "on", JSON.stringify(rested).slice(0, 700), "\nBOOKS", (text.get(office) ?? []).filter((b) => Math.abs(b.at - r.at) < 4 * DAY).map((b) => `${(b.at / DAY).toFixed(2)}: ${b.words.slice(0, 500)}`).join("\n   "));
    }
    tally.set(key, x);
  }
  const lines = [...tally].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${k}: ${x.inBooks} of ${x.acts}${x.missed.length ? ` (not in the books: ${x.missed.slice(0, 3).join("; ")})` : ""}`);
  console.log(`books against the code, ${seats.length + 1} offices seated, ${books.length} papers of the clerks':\n  ${lines.join("\n  ")}`);
  // Enough happened to say something of several offices.
  expect(tally.size).toBeGreaterThanOrEqual(5);
  expect([...tally.values()].reduce((n, x) => n + x.acts, 0)).toBeGreaterThan(40);
  for (const [k, x] of tally) expect(`${k}: ${x.inBooks} of ${x.acts}`).toBe(`${k}: ${x.acts} of ${x.acts}`);

  // ---- What stands open is shown until it no longer stands open (docs/behaviour/office-books.md): for every office,
  // whatever is on one paper's list and not on the next is said by the next to be no longer open. Nothing drops off a
  // list for being old, or for the list being long.
  const papers = new Map<string, any[]>();
  for (const b of books) { const k = String(b.data.office); if (!papers.has(k)) papers.set(k, []); papers.get(k)!.push(b); }
  let dropped = 0, closures = 0;
  const silently: string[] = [];
  for (const [office, list] of papers) {
    list.sort((x, y) => x.at - y.at);
    for (let i = 1; i < list.length; i++) {
      const now = new Set((list[i].data.open as any[]).map((x) => String(x.about)));
      for (const was of new Set((list[i - 1].data.open as any[]).map((x) => String(x.about)))) {
        if (now.has(was)) continue;
        closures++;
        // (A paper names the first few that have gone and counts the rest: "no longer open: a, b and 3 more".)
        if (!names(String(list[i].text), was) && !/no longer open: [^;]*? and \d+ more/.test(String(list[i].text)) && !(list[i].data.over ?? []).length) { dropped++; silently.push(`${office} day ${Math.floor(list[i].at / DAY)}: ${was}`); }
      }
    }
  }
  console.log(`  what left a list: ${closures} in all, ${dropped} without the next paper saying so${silently.length ? ` (${silently.slice(0, 5).join("; ")})` : ""}`);
  expect(closures).toBeGreaterThan(20);
  expect(silently).toEqual([]);

  // ---- The tribunal member's list is a standing list (the fourth living pilot's member missed the one case whose
  // day had come: its books named only what had changed since the clerk's last paper). Every case listed and not
  // decided is on every paper's list with its day; and from the morning of its day until it is decided, every paper
  // names it in its own words, first.
  const tribunal = papers.get("tribunal-member") ?? [];
  // (Those listed in the run, and those on the tribunal's file as the year began with the tenant's time still running.)
  const listed = [...(config.world.records as any[]).filter((r) => r.kind === "hearing_notice" && Number(r.data?.answer_by) > 0), ...recs].filter((r) => r.kind === "hearing_notice" && r.speaks_for === "tribunal" && typeof r.data?.application === "string");
  const orderAt = (app: string) => Math.min(Infinity, ...recs.filter((r) => r.kind === "tribunal_order" && r.data?.application === app).map((r) => r.at));
  const withdrawnAt = (app: string) => Math.min(Infinity, ...withdrawals.filter((r) => r.withdraws === app).map((r) => r.at));
  // (A tenant who answers that they have left the home is the end of the case on the list: the member's books drop it, as its code does. Found 2026-10-12, "Returns on the law's days": a changed town had one such case.)
  const leftAt = (app: string) => Math.min(Infinity, ...recs.filter((r) => r.kind === "tribunal_response" && r.data?.application === app && r.data?.left === true).map((r) => r.at));
  let onList = 0, ripeNamed = 0, ripeCases = 0;
  const missing: string[] = [];
  for (const n of listed) {
    const app = n.data.application as string, day = Number(n.data.answer_by ?? n.data.hearing_at), closed = Math.min(orderAt(app), withdrawnAt(app), leftAt(app));
    const ids = [app, n.id];
    let ripe = false;
    for (const b of tribunal) {
      if (b.at <= n.at || b.at >= closed) continue;
      const items = (b.data.open as any[]).filter((x) => ids.includes(String(x.about)));
      if (!items.length) { missing.push(`day ${Math.floor(b.at / DAY)}: ${app} is not on the list (notice ${n.id} at ${(n.at / DAY).toFixed(3)}, paper at ${(b.at / DAY).toFixed(3)})`); continue; }
      onList++;
      if (Number.isFinite(day) && Math.floor(day / DAY) <= Math.floor(b.at / DAY)) {
        ripe = true;
        if (ids.some((id) => names(String(b.text), id)) && /day has come|time to answer has run/.test(String(items[0].what))) ripeNamed++;
        else missing.push(`day ${Math.floor(b.at / DAY)}: ${app}, whose day was ${Math.floor(day / DAY)}, is not named in the paper's words`);
      }
    }
    if (ripe) ripeCases++;
  }
  console.log(`  the tribunal's list: ${listed.length} cases listed, ${tribunal.length} papers; a case on a paper's list ${onList} times; ${ripeCases} cases stood with their day come at some paper, named there ${ripeNamed} times; faults ${missing.length}${missing.length ? ` (${missing.slice(0, 5).join("; ")})` : ""}`);
  // (520 days where it was 400 since foundations F6 (2026-10-16): the world differs again and in this town no case stood with its day come in 400 days; two do in 520.)
  // (400 days where it was 250 since foundations F5 (2026-10-16): the tribunal's staff are people now, each with a body's one timeline, and in this town no case stood with its day come in 250 days; one does in 400.)
  // (250 days where it was 150: with draws named for the day, 2026-10-12, no case in this town stood with its day come before day 150.)
  // (More than 2 where it was more than 3: with homes dealt by income, 2026-10-12, this town opens with the cases its
  // own households make, those where someone is out of work as the year begins, not a quarter of its tenancies.)
  expect(listed.length).toBeGreaterThan(2);
  expect(ripeCases).toBeGreaterThan(0);
  expect(missing).toEqual([]);
}, 1_800_000);
