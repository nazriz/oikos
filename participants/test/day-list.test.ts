// A day's ripe cases reach the member in one paper and one sitting (docs/behaviour/office-books.md, point 8; docs/decisions.md,
// "A day's ripe cases reach the member in one paper"). The fifth living pilot's tribunal member sat 33 times in 90 days
// for 56 cases: it set its own day of return for each case's day, its books list was cut at the ninth entry, and the
// paper's words showed one case or two. Held here, on papers made by hand:
//   - the clerk's paper sets out every case whose day has come, in full, however many, and says how many are on the list
//     for the first time; a case that stays on it undecided is not new; nothing drops off while undecided;
//   - the seat is brought to its desk by that paper, once, at the next working day's sitting, when a case is new on it;
//     not by a paper that concerns only cases already on the list, nor by the clerk's other papers;
//   - what the seat is shown: the newest books paper whole (every case in full), earlier ones a line each; opened by
//     its id, the cases the words set out are not set out twice.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import type { Observation } from "../src/contracts";
import { booksPaper, Clerk } from "../src/behaviour/books";
import { tribunalMemberBooks } from "../src/behaviour/openbooks-venues";
import type { OpenHeading } from "../src/module";
import { inCurrency } from "../src/money";
import { parseProgram } from "../src/calls";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { createLlmParticipant, type LlmParticipantConfig } from "../src/llm/participant";

inCurrency(PROFILE.values.currency);
const DAY = 86_400, HOUR = 3_600;

/** What a clerk's paper says: its words and its details. */
const parsed = (a: any): { text: string; data: any } => { const args = (parseProgram(a.call) as any).lines[0].call.args; return { text: args.text.text, data: args.data?.json }; };
const due = (id: string) => `Applications for possession of a let home whose day has come, not decided`;
const ripe = (ids: string[]): OpenHeading[] => [{ what: due(""), always: true, items: ids.map((id) => ({ id, since: 0, due: 0, line: `${id}: landlord-1 applies for possession of the home at ${id} from tenant ${id}, saying 120,000 of rent is owed; our notice of hearing is on the record, since day 2` })) }];

// ------------------------------------------------------------------ the paper

test("the day's list: every case whose day has come is set out in full in the paper's words, however many, and the paper says how many are on the list for the first time", () => {
  const ids = Array.from({ length: 23 }, (_, i) => `lease-c${1000 + i}-possession`);
  const first = booksPaper("tribunal-member", 10 * DAY + 9 * HOUR, ripe(ids), undefined);
  for (const id of ids) expect(first.text).toContain(`${id}: landlord-1 applies for possession`);
  expect(first.text).not.toContain("more, in this paper's list");
  expect(first.text).toContain("The day's list: 23 matters wait on the office-holder with their day come, each set out above in full; 23 are on the list for the first time.");
  expect(first.data).toMatchObject({ list: { ripe: 23, new: 23 } });
  // The next day: the same cases, undecided, and two more. Every one is on it; two are new.
  const before = new Map([[due(""), new Map(ids.map((id) => [id, "x"]))]]);
  const next = booksPaper("tribunal-member", 11 * DAY + 9 * HOUR, ripe([...ids, "lease-c2000-possession", "lease-c2001-possession"]), before);
  for (const id of [...ids, "lease-c2000-possession", "lease-c2001-possession"]) expect(next.text).toContain(`${id}: landlord-1 applies`);
  expect(next.data).toMatchObject({ list: { ripe: 25, new: 2 } });
  expect((next.data as any).open).toHaveLength(25);
  // Only the old ones left on it: nothing new, and the paper says so.
  const stale = booksPaper("tribunal-member", 12 * DAY + 9 * HOUR, ripe(ids), new Map([[due(""), new Map(ids.map((id) => [id, "x"]))]]));
  expect(stale.data).toMatchObject({ list: { ripe: 23, new: 0 } });
  expect(stale.text).toContain("none is new on the list");
  // Nothing ripe: no day's list at all.
  expect((booksPaper("tribunal-member", 13 * DAY, [], before).data as any).list).toBeUndefined();
});

test("the clerk files the day's list once a working day, only when it has changed; a case ripening the next day is on the next day's paper; a case decided leaves it", () => {
  let open: OpenHeading[] = [];
  const clerk = new Clerk("tribunal-member-staff", "tribunal-member", { absorb() {}, open: () => open });
  const paper = (t: number, woke?: "news") => { const a: any = clerk.due(t, woke); return a ? parsed(a).data : undefined; };
  expect(paper(5 * DAY + 9 * HOUR)).toBeUndefined(); // nothing has ever stood open
  open = ripe(["a", "b", "c"]);
  expect(paper(6 * DAY + 9 * HOUR).list).toEqual({ ripe: 3, new: 3 });
  // Later that day another case's day "comes" (a case taken in with its time already run): not before the next day.
  open = ripe(["a", "b", "c", "d"]);
  expect(paper(6 * DAY + 15 * HOUR, "news")).toBeUndefined(); // (woken by a paper, not on its round)
  expect(paper(7 * DAY + 9 * HOUR).list).toEqual({ ripe: 4, new: 1 });
  // Nothing changed: no paper. Two decided, one case new on a later day: one paper that day, with one new.
  expect(paper(8 * DAY + 9 * HOUR)).toBeUndefined();
  open = ripe(["c", "d", "e"]);
  expect(paper(9 * DAY + 9 * HOUR).list).toEqual({ ripe: 3, new: 1 });
  // Decided all: the paper is of nothing standing open under that heading; no day's list.
  open = [];
  expect(paper(10 * DAY + 9 * HOUR).list).toBeUndefined();
});

// ------------------------------------------------------------------ the tribunal member's own books

const app = (n: number, answerBy: number) => {
  const lease = `lease-c${n}`;
  return [
    { id: `${lease}-possession`, at: 0, author: "genesis", record: "statement", speaks_for: "landlord-1", visible_to: "public", kind: "tribunal_application", addressed_to: ["tribunal-member"], text: "x",
      data: { kind: "possession", matter: "possession", against: `c${n}`, about: lease, amount: 12_000_000, space: `house-${n}/dwelling.1`, notice: `${lease}-vacate`, notice_given: -40 * DAY, notice_by: -9 * DAY } },
    { id: `${lease}-hearing`, at: 0, author: "genesis", record: "statement", speaks_for: "tribunal-member", visible_to: "public", kind: "hearing_notice", addressed_to: [`c${n}`, "landlord-1"], text: "x", basis: `${lease}-possession`,
      data: { application: `${lease}-possession`, kind: "possession", matter: "possession", applicant: "landlord-1", against: `c${n}`, hearing_at: answerBy, answer_by: answerBy } },
  ];
};
const obsOf = (t: number, records: any[]): Observation => ({ t, entity: "tribunal-member", outcomes: [], woke_for: "cadence", channels: { mine: { kind: "records", records } } }) as unknown as Observation;
const member = () => tribunalMemberBooks({ participant: "tribunal-member-system", entity: "tribunal-member", params: {}, world: { tickSeconds: 3600, runEnd: 400 * DAY } } as any);

test("a member with cases ripe on one day gets one paper that names all of them in full; cases ripening on different days are on a paper each; nothing ripe is no list; none is dropped while undecided", () => {
  const books = member();
  const clerk = new Clerk("tribunal-member-staff", "tribunal-member", books);
  const day = (n: number) => n * DAY + 9 * HOUR;
  const records = [...Array.from({ length: 14 }, (_, i) => app(1000 + i, 20 * DAY + 9 * HOUR)).flat(), ...app(2000, 22 * DAY + 9 * HOUR).flat(), ...app(2001, 25 * DAY + 9 * HOUR).flat()];
  const filed: { t: number; text: string; data: any }[] = [];
  const look = (t: number, more: any[] = []) => { books.absorb(obsOf(t, more)); const a: any = clerk.due(t); if (a) filed.push({ t, ...parsed(a) }); return a; };
  look(day(5), records); // the tribunal's lists, all waiting
  expect(filed.at(-1)!.data.list).toBeUndefined();
  expect(look(day(19))).toBeUndefined(); // nothing changed, nothing ripe: no paper at all
  // Day 20: fourteen cases' day. One paper; every one named in full.
  look(day(20));
  const paper = filed.at(-1)!;
  expect(paper.data.list).toEqual({ ripe: 14, new: 14 });
  for (let i = 0; i < 14; i++) expect(paper.text).toContain(`lease-c${1000 + i}-possession:`);
  expect(paper.text).not.toContain("more, in this paper's list");
  // Day 21, none decided: the same fourteen on the list (none dropped), none new: a paper may be filed (the lines changed) but it brings nobody back.
  look(day(21));
  const again = filed.at(-1)!;
  if (again.t === day(21)) { expect(again.data.list).toEqual({ ripe: 14, new: 0 }); for (let i = 0; i < 14; i++) expect(again.text).toContain(`lease-c${1000 + i}-possession:`); }
  // Day 22: one more case's day, on a paper of its own, with one new; the fourteen still there.
  look(day(22));
  expect(filed.at(-1)!.data.list).toEqual({ ripe: 15, new: 1 });
  expect((filed.at(-1)!.data.open as any[]).filter((e) => e.what.startsWith("Applications for possession of a let home whose day has come"))).toHaveLength(15);
  // Day 23 and 24 add nothing; day 25 one more.
  look(day(25));
  expect(filed.at(-1)!.data.list).toEqual({ ripe: 16, new: 1 });
  // The first fourteen are ordered (the orders come onto the file): they leave the list; the others remain.
  const orders = Array.from({ length: 14 }, (_, i) => ({ id: `ord${i}`, at: day(26), author: "tribunal-member-system", record: "statement", speaks_for: "tribunal-member", visible_to: "public", kind: "tribunal_order", text: "x", basis: `lease-c${1000 + i}-possession`, data: { application: `lease-c${1000 + i}-possession`, finding: "possession" } }));
  look(day(26), orders);
  expect(filed.at(-1)!.data.list).toEqual({ ripe: 2, new: 0 });
});

// ------------------------------------------------------------------ the seat is brought back by it, once

const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });
const ctx = { world: { currency: PROFILE.values.currency } } as any;
const listPaper = (id: string, t: number, list: { ripe: number; new: number } | undefined, more: object = {}) => ({ id, record: "statement", kind: "office_books", author: "tribunal-member-staff-system", speaks_for: "tribunal", at: t, visible_to: ["tribunal"], addressed_to: ["tribunal"],
  text: `The books of the office. ${list ? `The day's list: ${list.ripe} matters.` : "Nothing."}`, data: { office: "tribunal-member", at: t, ...(list ? { list } : {}), open: [] }, ...more });
const at = (t: number, reports: object[] = [], letters: object[] = []): Observation => ({ t, inbox: [], drafts: [], channels: { "tribunal-member/staff-reports": { kind: "records", records: reports }, "tribunal-member/business": { kind: "records", records: letters } }, outcomes: [],
  positions: [{ position: "tribunal-member", entity: "tribunal", title: "Tribunal member" }] }) as unknown as Observation;
const seat: Partial<LlmParticipantConfig> = { sessions: { start: 8 * HOUR, end: 17 * HOUR, days: 5 }, trays: { kinds: new Map([["tribunal-member/staff-reports", true as const]]), all: new Set(["tribunal-member/business"]) }, ownAuthors: ["tribunal-member-staff-system"] };

function harness(answers: ContentBlock[][]) {
  const calls: LlmRequest[] = [];
  const notes: any[] = [];
  let n = 0;
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => {
    calls.push(JSON.parse(JSON.stringify(req)));
    return { content: answers[n++] ?? [use(`end-${n}`, "done_for_now", { days: 7 })], usage: { input_tokens: 1, output_tokens: 1 } } as any;
  } };
  const io = { adapter, annotate: async (a: any) => void (a.annotation === "note" && notes.push(a.data)), now: () => 0 } as any;
  const c: LlmParticipantConfig = { participant: "tribunal-member-system", entity: "tribunal", title: "Tribunal member", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map(), cadenceDays: 7, draftText: () => "", ...seat } as LlmParticipantConfig;
  return { p: createLlmParticipant(c, io), calls, notes };
}

test("the day's list brings the seat to its desk at the next working day's sitting, once, when a case is new on it; a list with nothing new, or the clerk's other papers, do not", async () => {
  const { p, calls, notes } = harness([[use("d", "done_for_now", { days: 7 })]]);
  await p.step(at(8 * HOUR), ctx); // its first sitting; back in a week
  expect(calls.length).toBe(1);
  expect(await p.step(at(DAY + 8 * HOUR), ctx)).toMatchObject({ type: "wait" });
  // The clerk's paper with nothing new on its list, and one with no list: no sitting.
  await p.step(at(DAY + 9 * HOUR, [listPaper("rec.1", DAY + 9 * HOUR, { ripe: 3, new: 0 }), listPaper("rec.2", DAY + 9 * HOUR, undefined)]), ctx);
  expect(await p.step(at(2 * DAY + 8 * HOUR), ctx)).toMatchObject({ type: "wait" });
  expect(calls.length).toBe(1);
  // A list with a case new on it (morning, day 2): not at once; the next working day's sitting; one sitting for it.
  expect(await p.step(at(2 * DAY + 9 * HOUR, [listPaper("rec.3", 2 * DAY + 9 * HOUR, { ripe: 4, new: 1 })]), ctx)).toEqual({ type: "wait", until: 3 * DAY + 8 * HOUR });
  expect(calls.length).toBe(1);
  await p.step(at(3 * DAY + 8 * HOUR), ctx);
  expect(calls.length).toBe(2);
  const told = String(calls[1]!.messages.at(-1)!.content);
  expect(told).toContain("You are back before the day you gave: papers were filed with your office (1 day list).");
  expect(notes.find((x) => x.back_for_papers).back_for_papers.papers).toEqual([{ kind: "day list", n: 1 }]);
  // Its own other staff paper: still nothing.
  await p.step(at(3 * DAY + 9 * HOUR, [{ ...listPaper("rec.4", 3 * DAY + 9 * HOUR, undefined), kind: "staff_report" }]), ctx);
  expect(await p.step(at(4 * DAY + 8 * HOUR), ctx)).toMatchObject({ type: "wait" });
  expect(calls.length).toBe(2);
});

test("a list filed before the day's sitting is for that sitting; one filed after it is for the next working day's", async () => {
  const { p, calls } = harness([[use("d", "done_for_now", { days: 14 })]]);
  await p.step(at(8 * HOUR), ctx);
  // Day 2, 05:00: the clerk's list is on the desk when the day opens. The seat looks in at 08:00 and sits.
  expect(await p.step(at(DAY + 8 * HOUR), ctx)).toMatchObject({ type: "wait" });
  await p.step(at(2 * DAY + 8 * HOUR, [listPaper("rec.1", 2 * DAY + 5 * HOUR, { ripe: 2, new: 2 })]), ctx);
  expect(calls.length).toBe(2);
  expect(String(calls[1]!.messages.at(-1)!.content)).toContain("papers were filed with your office (1 day list)");
  // Day 3, 10:00: filed after the day opened (the seat looked in at 08:00 and found nothing): the next working day's sitting.
  expect(await p.step(at(3 * DAY + 8 * HOUR), ctx)).toMatchObject({ type: "wait" });
  expect(await p.step(at(3 * DAY + 10 * HOUR, [listPaper("rec.2", 3 * DAY + 10 * HOUR, { ripe: 3, new: 1 })]), ctx)).toEqual({ type: "wait", until: 4 * DAY + 8 * HOUR });
  expect(calls.length).toBe(2);
  await p.step(at(4 * DAY + 8 * HOUR), ctx);
  expect(calls.length).toBe(3);
});

test("a list that comes on a Friday is for Monday's sitting, and several lists in a day are one sitting", async () => {
  const { p, calls } = harness([[use("d", "done_for_now", { days: 14 })]]);
  await p.step(at(8 * HOUR), ctx);
  // Day 4 is the fifth working day (Friday); days 5 and 6 are a weekend; day 7 is Monday.
  await p.step(at(4 * DAY + 9 * HOUR, [listPaper("rec.1", 4 * DAY + 9 * HOUR, { ripe: 2, new: 2 })]), ctx);
  await p.step(at(4 * DAY + 11 * HOUR, [listPaper("rec.2", 4 * DAY + 11 * HOUR, { ripe: 3, new: 1 })]), ctx);
  expect(await p.step(at(5 * DAY + 8 * HOUR), ctx)).toMatchObject({ type: "wait" });
  expect(await p.step(at(6 * DAY + 8 * HOUR), ctx)).toMatchObject({ type: "wait" });
  expect(calls.length).toBe(1);
  await p.step(at(7 * DAY + 8 * HOUR), ctx);
  expect(calls.length).toBe(2);
  expect(String(calls[1]!.messages.at(-1)!.content)).toContain("(2 day lists)");
});

// ------------------------------------------------------------------ what the seat is shown

test("the newest books paper is set out whole in the sitting's report (every case in full); earlier ones keep a line; opened by its id, the cases the words set out are not set out twice", async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `lease-c${3000 + i}-possession`);
  const line = (id: string) => `${id}: landlord-1 applies for possession of house-${id}/dwelling.1 from tenant ${id}, saying KSh 120,000.00 is owed; it relies on notice to vacate ${id}-vacate, given day 1, to leave by day 32; our notice of hearing ${id}-hearing is on the record since day 2; the tenant has not answered`;
  const words = (n: number) => `The books of the office, day ${n}. Applications for possession of a let home whose day has come, not decided: ${ids.length} in all: ${ids.map(line).join("; ")}. The day's list: ${ids.length} matters wait.`;
  const paper = (id: string, t: number) => ({ id, record: "statement", kind: "office_books", author: "tribunal-member-staff-system", speaks_for: "tribunal", at: t, visible_to: ["tribunal"], addressed_to: ["tribunal"], text: words(Math.floor(t / DAY)),
    data: { office: "tribunal-member", at: t, list: { ripe: 12, new: 12 }, open: ids.map((id) => ({ what: "Applications for possession of a let home whose day has come, not decided", about: id, says: line(id), due: 0 })) } });
  const { p, calls } = harness([[use("d", "done_for_now", { days: 7 })]]);
  await p.step(at(8 * HOUR), ctx);
  await p.step(at(2 * DAY + 9 * HOUR, [paper("rec.10", 2 * DAY + 9 * HOUR), paper("rec.11", 3 * DAY + 9 * HOUR)]), ctx);
  await p.step(at(4 * DAY + 8 * HOUR), ctx);
  expect(calls.length).toBe(2);
  const shown = String(calls[1]!.messages.at(-1)!.content);
  // The newest (rec.11) whole: every case's line in full; the earlier (rec.10) cut to a line or two, as before.
  for (const id of ids) expect(shown).toContain(line(id));
  expect(shown.split(line(ids.at(-1)!)).length - 1).toBe(1); // (the earlier paper is cut after a line or two)
  expect(shown).toContain("[rec.10]");
  expect(shown).toContain("[rec.11]");
});
