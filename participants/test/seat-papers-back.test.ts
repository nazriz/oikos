// A paper filed with an office brings its seat back (participants/src/llm/participant.ts; docs/real-models.md, "What
// brings a seat back"). Only a letter did: a proposal put to the clerk, an application, a complaint waited for the day
// the seat had chosen, and seats chose a week, so a ballot took three weeks and a works seat read complaints seven days
// late (the live checks of 2026-10-09). A real office opens its in-tray every working day.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import type { Observation } from "../src/contracts";
import type { ContentBlock, LlmRequest } from "../src/llm/adapter";
import { createLlmParticipant, tools, type LlmParticipantConfig } from "../src/llm/participant";
import { Matters } from "../src/readers/matters";

const DAY = 86_400;
const HOUR = 3_600;
const ctx = { world: { currency: PROFILE.values.currency } } as any;
const use = (id: string, name: string, input: object): ContentBlock => ({ type: "tool_use", id, name, input });
const paper = (id: string, kind: string, at: number, more: object = {}) => ({ id, record: "statement", kind, author: "mayor-system", speaks_for: "city", at, text: `${kind} ${id}.`, visible_to: ["city"], addressed_to: ["city"], ...more });
/** What the clerk is shown at a time: what has come into its in-tray (proposals) and into the town's files. */
const at = (t: number, tray: object[] = [], files: object[] = []): Observation => ({ t, channels: { "council-clerk/proposals": { kind: "records", records: tray }, "council-clerk/business": { kind: "records", records: files } }, outcomes: [], inbox: [], drafts: [],
  positions: [{ position: "council-clerk", entity: "city", title: "Council clerk" }] }) as unknown as Observation;
const seat: Partial<LlmParticipantConfig> = { sessions: { start: 9 * HOUR, end: 17 * HOUR, days: 5 }, trays: { kinds: new Map([["council-clerk/proposals", true as const]]), all: new Set(["council-clerk/business"]) }, ownAuthors: ["council-clerk-staff-system"] };

function harness(answers: ContentBlock[][], extra: Partial<LlmParticipantConfig> = {}) {
  const calls: LlmRequest[] = [];
  const notes: any[] = [];
  let n = 0;
  const adapter = { provider: "mock", model: "mock", complete: async (req: LlmRequest) => {
    calls.push(JSON.parse(JSON.stringify(req)));
    return { content: answers[n++] ?? [use(`end-${n}`, "done_for_now", { days: 7 })], usage: { input_tokens: 1, output_tokens: 1 } } as any;
  } };
  const io = { adapter, annotate: async (a: any) => void (a.annotation === "note" && notes.push(a.data)), now: () => 0 } as any;
  const c: LlmParticipantConfig = { participant: "council-clerk-system", entity: "city", title: "Council clerk", framing: { disclosure: "simulation", reason: "test" }, standing: [], titles: new Map(), cadenceDays: 7, draftText: () => "", ...seat, ...extra };
  return { p: createLlmParticipant(c, io), calls, notes, c };
}
const shown = (r: LlmRequest) => String(r.messages.at(-1)!.content);

test("a clerk sent a proposal on day 2 sits on day 3: at the next working day's sitting, never at once, and told why it is back", async () => {
  const { p, calls, notes } = harness([[use("d", "done_for_now", { days: 7 })]]);
  // Its first sitting; it says it is back in a week.
  await p.step(at(9 * HOUR), ctx);
  expect(calls.length).toBe(1);
  // It looks in at the next day's sitting to see what has come (no call): nothing has.
  expect(await p.step(at(DAY + 9 * HOUR), ctx)).toEqual({ type: "wait", until: 2 * DAY + 9 * HOUR });
  // A proposal is filed that afternoon (the second day). Not at once: the next working day's sitting.
  expect(await p.step(at(DAY + 14 * HOUR, [paper("rec.7", "proposal", DAY + 14 * HOUR)]), ctx)).toEqual({ type: "wait", until: 2 * DAY + 9 * HOUR });
  expect(calls.length).toBe(1);
  // The third day: it sits, four days before the day it gave, and is told why.
  await p.step(at(2 * DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(2);
  expect(shown(calls[1]!)).toContain("You are back before the day you gave: papers were filed with your office (1 proposal). They are set out below.");
  expect(shown(calls[1]!)).toContain("proposal rec.7.");
  expect(notes.find((n) => n.back_for_papers).back_for_papers).toEqual({ papers: [{ kind: "proposal", n: 1 }], days_early: 5 });
});

test("a day's papers are one sitting; a kind the seat holds waits for the sitting it set; its own papers and its staff's bring nobody back; a weekend is not worked", async () => {
  const { p, calls } = harness([[use("d", "done_for_now", { days: 7 })], [use("d", "done_for_now", { days: 7, hold: ["Proposals"] })]]);
  await p.step(at(9 * HOUR), ctx);
  // Twenty in a day, at three moments: one sitting, the next morning, with the count.
  await p.step(at(DAY + 9 * HOUR, Array.from({ length: 8 }, (_, i) => paper(`rec.${i}`, "proposal", DAY + 2 * HOUR))), ctx);
  await p.step(at(DAY + 11 * HOUR, Array.from({ length: 12 }, (_, i) => paper(`rec.${20 + i}`, "proposal", DAY + 11 * HOUR))), ctx);
  await p.step(at(DAY + 15 * HOUR, [paper("rec.40", "proposal", DAY + 15 * HOUR, { author: "council-clerk-system" }), paper("rec.41", "proposal", DAY + 15 * HOUR, { author: "council-clerk-staff-system" })]), ctx);
  expect(calls.length).toBe(1);
  await p.step(at(2 * DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(2);
  expect(shown(calls[1]!)).toContain("papers were filed with your office (20 proposals)");
  // It said proposals may wait: the next one does. Something else in its in-tray still brings it back.
  await p.step(at(2 * DAY + 13 * HOUR, [paper("rec.50", "proposal", 2 * DAY + 13 * HOUR)]), ctx);
  expect(await p.step(at(3 * DAY + 9 * HOUR), ctx)).toEqual({ type: "wait", until: 4 * DAY + 9 * HOUR });
  // A paper in the organisation's files at large is not this office's to open; one addressed to its post is.
  await p.step(at(3 * DAY + 10 * HOUR, [], [paper("rec.60", "complaint", 3 * DAY + 10 * HOUR)]), ctx);
  expect(await p.step(at(4 * DAY + 9 * HOUR), ctx)).toMatchObject({ type: "wait" });
  expect(calls.length).toBe(2);
  // (Day 5 of the week, a Friday: what comes then is opened on the Monday.)
  expect(await p.step(at(4 * DAY + 10 * HOUR, [], [paper("rec.61", "notice", 4 * DAY + 10 * HOUR, { addressed_to: ["council-clerk"] })]), ctx)).toEqual({ type: "wait", until: 7 * DAY + 9 * HOUR });
  await p.step(at(7 * DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(3);
  expect(shown(calls[2]!)).toContain("papers were filed with your office (1 notice)");
  expect(shown(calls[2]!)).toContain("proposal rec.50."); // (what waited is set out at the sitting it comes to)
});

test("a seat set not to be brought back by papers waits for the day it gave, and its tool says only a letter brings it sooner", async () => {
  const off = harness([[use("d", "done_for_now", { days: 7 })]], { wakeOnPapers: false });
  await off.p.step(at(9 * HOUR), ctx);
  await off.p.step(at(DAY + 9 * HOUR), ctx);
  expect(await off.p.step(at(DAY + 14 * HOUR, [paper("rec.7", "proposal", DAY + 14 * HOUR)]), ctx)).toEqual({ type: "wait", until: 7 * DAY + 9 * HOUR });
  expect(off.calls.length).toBe(1);
  const said = (c: LlmParticipantConfig) => tools(c).find((t) => t.name === "done_for_now")!;
  expect(said(off.c).description).toContain("a paper filed with your office, a vote or a notice does not bring you back sooner");
  expect((said(off.c).input_schema as any).properties.hold).toBeUndefined();
  const on = harness([]);
  expect(said(on.c).description).toContain("if a paper is filed with your office (an application, a proposal, a complaint, a notice: whatever comes into its in-tray), which brings you back at the next working day's sitting after it comes, a day's papers together");
  expect(said(on.c).description).toContain("If a kind of paper can wait for the sitting you've set, name it in hold");
  expect((said(on.c).input_schema as any).properties.hold.type).toBe("array");
});

test("a tenant's letter to a landlord (to stay on, for time, for a repair) is the letting office's post: it brings the seat back at the next working day's sitting and is set out; in a town hall of many offices a paper to the town at large is no one office's", async () => {
  const letting = (t: number, mine: object[] = []): Observation => ({ t, channels: { "landlord-1-office/mine": { kind: "records", records: mine }, "landlord-1-office/deaths": { kind: "records", records: [] } }, outcomes: [], inbox: [], drafts: [],
    positions: [{ position: "landlord-1-office", entity: "landlord-1", title: "Letting office" }] }) as unknown as Observation;
  const from = (id: string, kind: string, t: number, text: string) => ({ id, record: "statement", kind, author: "c0007-self", speaks_for: "c0007", at: t, text, visible_to: ["landlord-1", "c0007"], addressed_to: ["landlord-1"] });
  const trays = { kinds: new Map([["landlord-1-office/deaths", true as const]]), all: new Set(["landlord-1-office/mine"]) };
  const office = { participant: "landlord-1-office-system", entity: "landlord-1", title: "Letting office", ownAuthors: ["landlord-1-office-staff-system"] };
  const { p, calls } = harness([[use("d", "done_for_now", { days: 14 })]], { ...office, trays: { ...trays, sole: true } });
  await p.step(letting(9 * HOUR), ctx);
  await p.step(letting(DAY + 14 * HOUR, [from("rec.7", "variation_request", DAY + 14 * HOUR, "Request: please let us stay on at apts-1/dwelling.4."), from("rec.8", "review_request", DAY + 14 * HOUR, "Request: the roof leaks; please repair it.")]), ctx);
  expect(calls.length).toBe(1);
  await p.step(letting(2 * DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(2);
  expect(shown(calls[1]!)).toContain("You are back before the day you gave: papers were filed with your office (");
  expect(shown(calls[1]!)).toContain("please let us stay on at apts-1/dwelling.4");
  expect(shown(calls[1]!)).toContain("the roof leaks");
  // The clerk's own paper of the books, on the same file, brings nobody back.
  await p.step(letting(2 * DAY + 15 * HOUR, [{ id: "rec.9", record: "statement", kind: "office_books", author: "landlord-1-office-staff-system", speaks_for: "landlord-1", at: 2 * DAY + 15 * HOUR, text: "The books of the office.", visible_to: ["landlord-1"], addressed_to: ["landlord-1"], data: { office: "landlord-1-office", open: [] } }]), ctx);
  expect(await p.step(letting(3 * DAY + 9 * HOUR), ctx)).toMatchObject({ type: "wait" });
  expect(calls.length).toBe(2);
  // Without `sole` (an organisation of several offices): a paper to the organisation at large waits for the sitting set.
  const many = harness([[use("d", "done_for_now", { days: 14 })]], { ...office, trays });
  await many.p.step(letting(9 * HOUR), ctx);
  await many.p.step(letting(DAY + 14 * HOUR, [from("rec.7", "variation_request", DAY + 14 * HOUR, "Request: please let us stay on.")]), ctx);
  expect(await many.p.step(letting(2 * DAY + 9 * HOUR), ctx)).toMatchObject({ type: "wait" });
  expect(many.calls.length).toBe(1);
});

test("an assistant's done for n days is honoured: an acknowledgement, a paper or a letter in an office's fixed words, brings it back no sooner; a matter handed to it does, at its next sitting, with what came between read together", async () => {
  // (2026-11-11: a seat that sat 58 times in 3 days was brought back by every acknowledgement and every result of its acts.)
  const desk = (t: number, matters: object[] = [], inbox: object[] = []): Observation => ({ t, channels: { "finance-assistant/matters": { kind: "records", records: matters } }, outcomes: [], inbox, drafts: [],
    positions: [{ position: "finance-assistant", entity: "city", title: "Assistant" }] }) as unknown as Observation;
  const from = (id: string, kind: string, t: number, data: object = { agreement: "rec.2" }, post = "finance") => ({ id, record: "statement", kind, author: `${post}-system`, in_position: post, speaks_for: "city", at: t, text: `${kind} ${id}.`, visible_to: ["city"], addressed_to: ["city"], data });
  // (Its delivery and its principal's brief; and the town's other office's matter, under an agreement of its own, which
  // it is shown too, the town's papers to its assistants being the town's: not whom it works for.)
  const terms = [{ ...from("rec.1", "service_delivery", 0, { systems: ["par.3"] }), author: "provider-a-sales-system", in_position: "provider-a-sales", speaks_for: "provider-a" },
    from("rec.3", "brief", 0, { agreement: "rec.2", delivery: "rec.1" }), from("rec.4", "referral", 0, { agreement: "rec.8" }, "rates")];
  const ack = { from: "rates-system", t: DAY + 10 * HOUR, text: "From the rating office: your letter is received. This office does not act on a letter's words. It acts on its forms." };
  const { p, calls } = harness([[use("d", "done_for_now", { days: 4 })]], { participant: "par.3", title: "Assistant", trays: { kinds: new Map([["finance-assistant/matters", true as const]]), all: new Set() } });
  await p.step(desk(9 * HOUR, terms), ctx);
  expect(calls.length).toBe(1);
  // The next day: an acknowledgement on paper and one by letter. Neither is its to act on: no sitting before the day it gave.
  expect(await p.step(desk(DAY + 10 * HOUR, [from("rec.5", "acknowledgement", DAY + 10 * HOUR)], [ack]), ctx)).toEqual({ type: "wait", until: 2 * DAY + 9 * HOUR });
  expect(await p.step(desk(2 * DAY + 9 * HOUR), ctx)).toEqual({ type: "wait", until: 3 * DAY + 9 * HOUR });
  expect(calls.length).toBe(1);
  // A matter handed to it that afternoon: back at the next working day's sitting, not at once, the acknowledgements beside it.
  expect(await p.step(desk(2 * DAY + 14 * HOUR, [from("rec.9", "referral", 2 * DAY + 14 * HOUR)]), ctx)).toEqual({ type: "wait", until: 3 * DAY + 9 * HOUR });
  expect(calls.length).toBe(1);
  await p.step(desk(3 * DAY + 9 * HOUR), ctx);
  expect(calls.length).toBe(2);
  for (const s of ["referral rec.9.", "acknowledgement rec.5.", "your letter is received"]) expect(shown(calls[1]!)).toContain(s);
  // Whom it writes to: the post that hands it its work, not the whole organisation (a letter to which every office answers).
  expect(String(calls[1]!.system)).toContain("You work for finance, of city: to write to it, write to finance, not to city.");
});

test("an assistant's matter that cites a published paper it does not hold: looked up once by its id, and set out with the matter", () => {
  // (MT-41, rung 1's third run, 2026-11-14: the factory's invoices cited a buyer's offer its post could not read, and
  // were never drafted. Only what the hand-over names, one by its id; never the board.)
  const m = new Matters("a/matters", "a/file", "a/cited");
  const referral = { id: "rec.9", record: "statement", kind: "referral", at: 31 * DAY, author: "x", speaks_for: "factory-1", text: "For you to draft for sign-off: an invoice.", data: { kind: "invoice", wants: "draft", facts: { offer: "rec.5", order: "rec.6", buyer: "outside" } } } as any;
  const obs = { t: 31 * DAY, channels: { "a/matters": { kind: "records", records: [referral] } } } as any;
  m.absorbRead({ t: 31 * DAY, channels: { "a/file": { kind: "records", search: true, records: [] } } } as any);
  expect(m.lookups(obs, (id) => id === "rec.6")).toEqual([{ channel: "a/cited", query: { where: [{ field: "id", op: "=", value: "rec.5" }], limit: 1 } }]);
  expect(m.lookups(obs, () => false).map((l) => l.query.where[0]!.value)).toEqual(["rec.6"]);
  const offer = { id: "rec.5", record: "statement", kind: "buying_offer", at: 20 * DAY, author: "y", speaks_for: "outside", text: "Buying goods: up to 70 at $98.72 each." };
  const shown = m.absorb({ t: 31 * DAY, channels: { "a/matters": { kind: "records", records: [referral] }, "a/cited": { kind: "records", search: true, records: [offer] } } } as any);
  expect(Object.keys(shown.channels)).toEqual(["a/matters"]);
  expect(m.text()).toContain('It cites [rec.5] buying offer from outside (year 1, day 21): "Buying goods: up to 70 at $98.72 each."');
  // (A search of that board the seat makes itself is its own look, set out as one.)
  expect(Object.keys(m.absorb({ t: 32 * DAY, channels: { "a/cited": { kind: "records", search: true, records: [offer] } } } as any).channels)).toEqual(["a/cited"]);
});

test("an open matter says the client's habit and next sitting as of today, a report from before the seat as such, and whether the body's recording of their authority has reached it", () => {
  // (The first-sitting read of 2026-11-15: a referral's "next on" was weeks stale; reports by the code desk read as the
  // seat's own; matters sent back for want of authority said nothing of whether it was ever recorded.)
  const m = new Matters("a/matters", "a/file");
  const ref = (id: string, at: number, kind: string) => ({ id, record: "statement", kind: "referral", at, author: "x", speaks_for: "c1", text: `For you to draft for sign-off: a ${kind}. We get to our post every 7 days, next on year 1, day 14.`, data: { kind, wants: "draft" } }) as any;
  const report = { id: "rec.20", record: "statement", kind: "report", at: 20 * DAY, author: "desk", text: "Not done.", data: { referral: "rec.1", done: false, why: "We cannot act on it for c1." } } as any;
  const back = (id: string, at: number, by: string, kind: string) => ({ id, record: "statement", kind: "paper_returned", at, author: by, data: { for: "c1", by, need: { authority: { for: "c1", with: by } }, paper: { kind } } }) as any;
  const recorded = { id: "rec.31", record: "statement", kind: "authority_recorded", at: 22 * DAY, author: "bank", data: { for: "c1", by: "bank" } } as any;
  m.absorbRead({ t: 30 * DAY, channels: { "a/file": { kind: "records", search: true, records: [report] } } } as any);
  m.absorb({ t: 30 * DAY, channels: { "a/matters": { kind: "records", records: [ref("rec.1", 8 * DAY, "benefit_claim"), ref("rec.2", 9 * DAY, "loan_application")] }, "a/back": { kind: "records", records: [back("rec.30", 18 * DAY, "outside", "benefit_claim"), back("rec.32", 19 * DAY, "bank", "loan_application"), recorded] } } } as any);
  const t = m.text();
  // (Sittings every seven days from day index 13: as of day index 30, the next is day index 34, "year 1, day 35".)
  expect(t).toContain("c1 gets to their post every 7 days, next on year 1, day 35");
  expect(t).toContain("reported not done on year 1, day 21, before you took this post");
  expect(t).toContain("no recording of their authority with outside has reached you");
  expect(t).toContain("their authority with bank recorded on year 1, day 23 (rec.31)");
  // (A recording that has reached it stays said while the matter is open: a later look that shows the return again
  // does not un-say it (the stakes run's rung 1 (situation), 2026-11-16: "recorded on day 32" on day 33 only, then "no
  // recording ... has reached you" again, and the seat asked a client for an authority already recorded).)
  m.absorb({ t: 33 * DAY, channels: { "a/back": { kind: "records", search: true, records: [back("rec.32", 19 * DAY, "bank", "loan_application")] } } } as any);
  expect(m.text()).toContain("their authority with bank recorded on year 1, day 23 (rec.31)");
  // (A later return by the same body for want of it is a fact of its own, said beside the recording.)
  m.absorb({ t: 36 * DAY, channels: { "a/back": { kind: "records", records: [back("rec.40", 35 * DAY, "bank", "loan_application")] } } } as any);
  expect(m.text()).toContain("their authority with bank recorded on year 1, day 23 (rec.31), and sent back by bank for want of it after that, on year 1, day 36 (rec.40)");
});

test("one reply, one matter: a draft made from a paper passed on, before the client hands the reply over, is that reply's draft; and what the client said is said with its day, every sentence", () => {
  // (The stakes run's rung 1 (situation), 2026-11-16: c0014's evidence drafted from the forward on day 38, the client's
  // hand-over of the reply after it; the list said "no draft yet" under the reply. And the client's words repeated at
  // every later sitting with no day, a sentence of them dropped.)
  const m = new Matters("a/matters", "a/file");
  m.absorbRead({ t: 37 * DAY, channels: { "a/file": { kind: "records", search: true, records: [] } } } as any);
  const fwd = { id: "rec.82", record: "statement", kind: "forward", at: 37 * DAY, author: "x", speaks_for: "c14", text: "From outside: please send proof.", data: { paper: "rec.08", by: "outside", matter: "rec.84", data: { by: 44 * DAY } } } as any;
  m.absorb({ t: 37 * DAY, channels: { "a/matters": { kind: "records", records: [fwd] } } } as any);
  m.own([{ block: "publish", kind: "draft", data: { referral: "rec.84", paper: { kind: "evidence", data: { request: "rec.82" } } } }], 38 * DAY);
  const why = ["Until the claim is decided we are not paid pension.", "In our account (acc-c14) today: $221.52.", "Nothing regular is coming in.", "It comes from outside's evidence request rec.08 of year 1, day 31: \"Please send proof.\"", "We get to our post every 7 days, next on year 1, day 44.", "outside asks for this by year 1, day 44, 21:16; the last time we deal with our post before then is year 1, day 44, at about 21:00."];
  const reply = { id: "rec.85", record: "statement", kind: "referral", at: 38 * DAY + 3600, author: "x", speaks_for: "c14", text: `For you to draft for sign-off: evidence. ${why.join(" ")}`, data: { kind: "evidence", wants: "draft", reply_to: "rec.08", follows: "rec.84", why } } as any;
  m.absorb({ t: 39 * DAY, channels: { "a/matters": { kind: "records", records: [reply] } } } as any);
  const t = m.text();
  expect(t).toContain("[rec.85] evidence, handed over by c14 on year 1, day 39: your draft went for sign-off on year 1, day 39");
  expect(t).toContain("On year 1, day 39, handing it over, c14 said: Until the claim is decided we are not paid pension. In our account (acc-c14) today: $221.52. Nothing regular is coming in.");
  expect(t).not.toContain("said: Until the claim is decided we are not paid pension. In our account (acc-c14) today: $221.52. Nothing regular is coming in. It comes from");
  // (The hand-over its own draft waited longest on, in its own words: what the debrief's `waiting` sets out.)
  expect(m.longestWait(41 * DAY)).toBe(reply.text);
  // (Never a hand-over the seat did not receive: one handed to the post before it took it, under the code assistant, is
  // not its own, whatever draft of its own touched it after. The stakes reruns of 2026-11-16 asked both desks about
  // c0014's benefit claim of day 1.)
  const old = new Matters("a/matters", "a/file");
  const early = { id: "rec.9", record: "statement", kind: "referral", at: 1 * DAY, author: "x", speaks_for: "c14", text: "For you to draft for sign-off: a benefit claim.", data: { kind: "benefit_claim", wants: "draft" } } as any;
  old.absorb({ t: 31 * DAY, channels: { "a/matters": { kind: "records", records: [early] } } } as any);
  old.own([{ block: "publish", kind: "draft", data: { referral: "rec.9", paper: { kind: "benefit_claim", data: {} } } }], 32 * DAY);
  expect(old.longestWait(41 * DAY)).toBeUndefined();
});
