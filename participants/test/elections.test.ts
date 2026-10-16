// The electoral office (docs/behaviour/elections.md), on records alone: notice, nominations (one per candidate, the
// last counting), the roll (enrolments, less the dead and the departed), the ballot paper (candidates by number), the
// count on polling day (each elector's last formal vote, by instant runoff or first preferences), the result, the
// winner's appointment to the office, and the next election a term later.

import { expect, test } from "bun:test";
import { electoralOffice, instantRunoff } from "../src/behaviour/elections";
import { context, DAY, statement, wake } from "./stepping";

const POLL = 100 * DAY, CLOSE = 70 * DAY, OPENS = 86 * DAY;
const PARAMS = { office: "mayor", office_title: "Mayor", first_poll_day: 100, term_days: 400 };
const AS = { participant: "electoral-system", position: "electoral" };

/** An electoral office, woken on what it's shown; its own statements come back to it as records at its next wake. */
function office(params: object = {}) {
  const m = electoralOffice.create(context("electoral-system", "city", { ...PARAMS, ...params }, { position: "electoral" }));
  const ids = { n: 0 };
  let own: any[] = [];
  return (t: number, records: any[] = []) => {
    const w = wake(m, t, { roll: { kind: "records", records: [...own, ...records] } }, { entity: "city", as: AS, ids });
    own = w.made;
    return w;
  };
}
const enrolment = (who: string, x: object = {}) => statement(`enrol-${who}`, 0, "enrolment", { author: `${who}-self`, speaks_for: who, addressed_to: ["city"], visible_to: [who, "city"], ...x });
const nomination = (id: string, at: number, author: string, x: any = {}) => statement(id, at, "nomination", { author, speaks_for: author.replace(/-self$/, ""), addressed_to: ["city"], ...x, data: { office: "mayor", name: author.replace(/-self$/, ""), ...(x.data ?? {}) } });
const vote = (id: string, at: number, who: string, ballot: string, choice: string) => ({ id, at, record: "vote", author: `${who}-self`, speaks_for: who, visible_to: [who, "city"], ballot, choice });

test("the office gives notice nominations_open_days before polling day: polling day, the close of nominations and the method", () => {
  const at = office();
  expect(at(39 * DAY).said).toEqual([]);
  const { said } = at(40 * DAY);
  expect(said.length).toBe(1);
  expect(said[0]).toMatchObject({ fn: "statement", args: { kind: "election_notice", visible: "public", data: { office: "mayor", poll_at: POLL, nominations_close_at: CLOSE, method: "preferential" } } });
  expect(said[0]!.args.text).toBe("Election notice: the office of Mayor falls vacant on day 100. Nominations close on day 70; voting is by preference (number every candidate), and compulsory for those on the roll. Nominate with a statement of kind nomination to the town.");
  // Once.
  expect(at(41 * DAY).said).toEqual([]);
});

/** An office that has given notice (day 40) and reached the close of nominations (day 70) with these records. */
function atClose(records: any[], params: object = {}) {
  const at = office(params);
  at(40 * DAY, records.filter((r) => r.at < 40 * DAY));
  const closing = at(CLOSE, records.filter((r) => r.at >= 40 * DAY));
  return { at, closing, ballot: closing.made.find((r) => r.kind === "ballot") };
}
const PEOPLE = ["c1", "c2", "c3", "c4", "c5", "c6"];

test("at the close of nominations: the candidates are those nominated to the town for this office since the notice, one each (the last counts), numbered in order; the roll is who has enrolled, less the dead and the departed", () => {
  const { closing, ballot } = atClose([
    ...PEOPLE.map((p) => enrolment(p)),
    enrolment("c9", { addressed_to: ["other-town"] }), // (enrolled somewhere else)
    statement("death-1", 20 * DAY, "death_registration", { data: { deceased: "c5" } }),
    statement("gone-1", 50 * DAY, "departure", { author: "c6-self", speaks_for: "c6" }),
    nomination("nom-early", 30 * DAY, "c4-self"), // before the notice: not a nomination for this election
    nomination("nom-m", 45 * DAY, "mayor-system", { speaks_for: "city", data: { name: "the incumbent mayor", incumbent: true } }),
    nomination("nom-2a", 46 * DAY, "c2-self"),
    nomination("nom-2b", 50 * DAY, "c2-self", { data: { name: "Second thoughts" } }), // the same candidate again: this one counts
    nomination("nom-other", 46 * DAY, "c3-self", { data: { office: "treasurer" } }),
    nomination("nom-elsewhere", 46 * DAY, "c1-self", { addressed_to: ["other-town"] }),
    nomination("nom-8", 47 * DAY, "c8-self"),
    { id: "w8", at: 48 * DAY, record: "withdrawal", author: "c8-self", speaks_for: "c8", visible_to: "public", withdraws: "nom-8" }, // stood down
  ]);
  expect(closing.said.map((c) => c.args.kind)).toEqual(["electoral_roll", "ballot"]);
  // (The roll is the office's own, for the town's eyes only: until 0.4.0 it was published to everyone, docs/no-god-view.md.)
  expect(closing.of("statement", "electoral_roll")[0]!.args).toMatchObject({ visible: ["city"], data: { electors: ["c1", "c2", "c3", "c4"], poll_at: POLL } });
  expect(ballot.visible_to).toBe("public");
  expect(ballot.data).toEqual({ office: "mayor", electorate: "roll", method: "preferential", opens_at: OPENS, closes_at: POLL, options: ["1", "2"], candidates: [
    { candidate: "c2-self", number: "1", for: "c2", name: "Second thoughts", nomination: "nom-2b" },
    { candidate: "mayor-system", number: "2", for: "city", name: "the incumbent mayor", nomination: "nom-m" },
  ] });
  expect(ballot.text).toBe("Ballot: Mayor. Candidates: 1. Second thoughts, 2. the incumbent mayor. Rank them, first to last, as the choice: their numbers, in order, joined by > (2>1>3). Voting closes on day 100.");
});

test("one candidate at the close is elected unopposed, with no ballot, and appointed; with none, no one is elected and the office stays as it is", () => {
  const one = atClose([...PEOPLE.map((p) => enrolment(p)), nomination("nom-2", 46 * DAY, "c2-self")]);
  expect(one.ballot).toBeUndefined();
  expect(one.closing.said.map((c) => c.fn)).toEqual(["statement", "position"]);
  expect(one.closing.said[0]!.args).toMatchObject({ kind: "ballot_result", visible: "public", text: "Election result, Mayor: c2 elected unopposed.", data: { office: "mayor", winner: "c2-self", unopposed: true, candidates: 1 } });
  expect(one.closing.said[1]!.args).toEqual({ appoint: "mayor", to: "c2-self" });
  // Nothing on polling day; the next election's notice a term later (day 100 + 400 - 60).
  expect(one.at(POLL).said).toEqual([]);
  expect(one.at(439 * DAY).said).toEqual([]);
  expect(one.at(440 * DAY).of("statement", "election_notice")[0]!.args.data).toMatchObject({ poll_at: 500 * DAY, nominations_close_at: 470 * DAY });

  const none = atClose(PEOPLE.map((p) => enrolment(p)));
  expect(none.closing.said.length).toBe(1);
  expect(none.closing.said[0]!.args).toMatchObject({ kind: "ballot_result", text: "Election result, Mayor: no one nominated; no one elected.", data: { office: "mayor", unopposed: false, candidates: 0 } });
  expect(none.closing.said[0]!.args.data.winner).toBeUndefined();
});

const THREE = [nomination("nom-a", 45 * DAY, "c1-self"), nomination("nom-b", 45 * DAY, "c2-self"), nomination("nom-m", 45 * DAY, "mayor-system", { speaks_for: "city", data: { name: "the incumbent mayor", incumbent: true } })];
const NINE = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"];

test("on polling day the office counts each elector's last formal vote by instant runoff, publishes the result, appoints the winner, and the next election is a term later", () => {
  // Numbers on the paper: 1 = c1, 2 = c2, 3 = the incumbent. First preferences: 4 for 1, 3 for 2, 2 for 3; the
  // incumbent's two go to 2, who wins 5 to 4.
  const { at, ballot } = atClose([...NINE.map((p) => enrolment(p)), enrolment("c10"), ...THREE]);
  expect(ballot.data.options).toEqual(["1", "2", "3"]);
  const b = ballot.id;
  const votes = [
    ...["c1", "c2", "c3", "c4"].map((w) => vote(`v-${w}`, 90 * DAY, w, b, "1>2>3")),
    ...["c5", "c6", "c7"].map((w) => vote(`v-${w}`, 90 * DAY, w, b, "2>1>3")),
    vote("v-c8", 90 * DAY, "c8", b, "3 > 2 > 1"),
    // An elector who votes again: the last formal vote counts (the first was for 1).
    vote("v-c9-first", 88 * DAY, "c9", b, "1>3>2"),
    vote("v-c9", 91 * DAY, "c9", b, "3>2"),
    // Informal (ranks no candidate): not counted, and it doesn't undo c4's formal vote before it.
    vote("v-c4-spoilt", 92 * DAY, "c4", b, "none of them"),
    // Not on the roll: not counted. A vote on some other ballot: not counted.
    vote("v-x", 90 * DAY, "c77", b, "1>2>3"),
    vote("v-c10-other", 90 * DAY, "c10", "some-other-ballot", "1>2>3"),
  ];
  expect(at(POLL - 1, votes).said).toEqual([]); // (not before polling day)
  const counted = at(POLL);
  expect(counted.said.map((c) => c.fn)).toEqual(["statement", "position"]);
  const result = counted.said[0]!.args;
  expect(result).toMatchObject({ kind: "ballot_result", visible: "public", basis: b });
  expect(result.data).toEqual({ ballot: b, office: "mayor", poll_at: POLL, winner: "c2-self", formal: 9, electors: 10, turnout_bps: 9000,
    rounds: [{ "c1-self": 4, "c2-self": 3, "mayor-system": 2 }, { "c1-self": 4, "c2-self": 5 }] });
  expect(result.text).toBe("Election result, Mayor: c2 elected; 9 formal votes of 10 on the roll (turnout 90%).");
  expect(counted.said[1]!.args).toEqual({ appoint: "mayor", to: "c2-self" });
  // Counted once; the next election's notice a term later.
  expect(at(POLL + DAY).said).toEqual([]);
  expect(at(440 * DAY).of("statement", "election_notice")[0]!.args.data).toMatchObject({ poll_at: 500 * DAY });
});

test("only votes made while the ballot is open count: not one made before it opens, nor one made at or after its close, however late the office comes to count", () => {
  const { at, ballot } = atClose([...NINE.map((p) => enrolment(p)), ...THREE]);
  const b = ballot.id;
  expect([ballot.data.opens_at, ballot.data.closes_at]).toEqual([OPENS, POLL]);
  const votes = [
    vote("v-early", OPENS - 1, "c1", b, "1>2>3"), // the paper is published at the close of nominations, 16 days before voting opens
    vote("v-open", OPENS, "c2", b, "2>1>3"),
    vote("v-last", POLL - 1, "c3", b, "2>1>3"),
    vote("v-at-close", POLL, "c4", b, "1>2>3"),
    vote("v-late", POLL + 600, "c5", b, "1>2>3"),
    // A vote in time, then a change of mind after the close: the vote in time stands.
    vote("v-c6", 90 * DAY, "c6", b, "3>2>1"),
    vote("v-c6-late", POLL + 600, "c6", b, "1>2>3"),
  ];
  // (The office wakes in the morning of polling day, hours after the ballot closed at its start.)
  const result = at(POLL + 9 * 3600, votes).said[0]!.args.data;
  expect(result).toMatchObject({ formal: 3, electors: 9, winner: "c2-self", rounds: [{ "c1-self": 0, "c2-self": 2, "mayor-system": 1 }] });
});

test("under plurality only first preferences count: whoever has most of them is elected; and with no formal vote nobody is elected or appointed", () => {
  const { at, ballot } = atClose([...NINE.map((p) => enrolment(p)), ...THREE], { method: "plurality" });
  expect(ballot.data.method).toBe("plurality");
  expect(ballot.text).toContain("Choose one, by number.");
  const b = ballot.id;
  // The same votes as under preferences, where 2 won on the incumbent's preferences: here 1, with most first
  // preferences (4, 3, 2), is elected, and nobody's second preference is looked at.
  const votes = [...["c1", "c2", "c3", "c4"].map((w) => vote(`v-${w}`, 90 * DAY, w, b, "1>2>3")), ...["c5", "c6", "c7"].map((w) => vote(`v-${w}`, 90 * DAY, w, b, "2>1>3")), vote("v-c8", 90 * DAY, "c8", b, "3>2>1"), vote("v-c9", 91 * DAY, "c9", b, "3>2")];
  const result = at(POLL, votes).said[0]!.args.data;
  expect(result.winner).toBe("c1-self");
  // DISAGREES WITH docs: elections.md says that under plurality first preferences count "for one round". The count
  // still goes round by round as a runoff does (the last-placed out, until one has a majority of the ballots still
  // counting), on ballots cut to their first preference: nothing is ever passed on, so whoever leads on first
  // preferences wins as the documentation means, but the result's `rounds` show two rounds here, not one, and a tie for
  // first goes to the candidate later in order (the runoff's rule for a tie of everyone left).
  expect(result.rounds).toEqual([{ "c1-self": 4, "c2-self": 3, "mayor-system": 2 }, { "c1-self": 4, "c2-self": 3 }]);

  const nobody = atClose([...NINE.map((p) => enrolment(p)), ...THREE]);
  const empty = nobody.at(POLL);
  expect(empty.said.map((c) => c.fn)).toEqual(["statement"]);
  expect(empty.said[0]!.args.text).toBe("Election result, Mayor: no one elected; 0 formal votes of 9 on the roll (turnout 0%).");
  expect(empty.said[0]!.args.data.winner).toBeUndefined();
});

test("instant runoff: those tied for last go out together, unless that's everyone, when the first in order goes", () => {
  // a has 2 of the 4 ballots that count (one names nobody standing): no majority. b and c tie for last with 1 each:
  // both out, and their ballots go to a.
  expect(instantRunoff(["a", "b", "c"], [["a"], ["a"], ["b", "a"], ["c", "a"], ["d"]])).toEqual({ winner: "a", rounds: [{ a: 2, b: 1, c: 1 }, { a: 4 }] });
  // A dead heat of two: the first in order goes out, and the other is elected.
  expect(instantRunoff(["a", "b"], [["a"], ["b"]])).toEqual({ winner: "b", rounds: [{ a: 1, b: 1 }, { b: 1 }] });
  // No ballots at all: no winner.
  expect(instantRunoff(["a", "b"], [])).toEqual({ rounds: [{ a: 0, b: 0 }] });
});

// Bug hunt 2026-10-17, finding 2: the office's knowledge lives with the office, not its holder.
test("a successor to the electoral office reads the election from the office's file: no notice for a poll already held, and no old nomination declared", () => {
  const first = office();
  const records = [...PEOPLE.map((p) => enrolment(p)), nomination("nom-2", 46 * DAY, "c2-self")];
  first(40 * DAY, records.filter((r) => r.at < 40 * DAY));
  first(CLOSE, records.filter((r) => r.at >= 40 * DAY)); // elected unopposed on day 70; the file holds the result
  // A new holder, from scratch, shown the office's whole file on day 200.
  const file: any[] = [];
  const probe = electoralOffice.create(context("electoral-system-2", "city", { ...PARAMS }, { position: "electoral" }));
  const ids = { n: 100 };
  const wake1 = (t: number, extra: any[] = []) => wake(probe, t, { roll: { kind: "records", records: [...file, ...extra] } }, { entity: "city", as: { participant: "electoral-system-2", position: "electoral" }, ids });
  // (Rebuild the first holder's file: its own statements, as records in the position.)
  const holder = office();
  const h1 = holder(40 * DAY, records.filter((r) => r.at < 40 * DAY));
  const h2 = holder(CLOSE, records.filter((r) => r.at >= 40 * DAY));
  file.push(...records, ...h1.made, ...h2.made);
  expect(wake1(200 * DAY).said).toEqual([]);
  expect(wake1(300 * DAY).said).toEqual([]);
  // The next election is still a term after the last: its notice on day 440.
  expect(wake1(439 * DAY).said).toEqual([]);
  expect(wake1(440 * DAY).of("statement", "election_notice")[0]!.args.data).toMatchObject({ poll_at: 500 * DAY });
});

test("an election whose notice or ballot was refused is tried again, not left stuck", () => {
  const m = electoralOffice.create(context("electoral-system", "city", { ...PARAMS }, { position: "electoral" }));
  const ids = { n: 0 };
  const recs = [...PEOPLE.map((p) => enrolment(p)), nomination("nom-2", 46 * DAY, "c2-self"), nomination("nom-3", 47 * DAY, "c3-self")];
  const as = { participant: "electoral-system", position: "electoral" };
  const refuse = (c: any) => c.args.kind === "ballot";
  expect(wake(m, 40 * DAY, { roll: { kind: "records", records: [] } }, { entity: "city", as, ids }).of("statement", "election_notice").length).toBe(1);
  expect(wake(m, CLOSE, { roll: { kind: "records", records: recs } }, { entity: "city", as, ids, refuse }).of("statement", "ballot").length).toBe(1);
  // The ballot was refused: the next day it is put up again.
  expect(wake(m, CLOSE + DAY, { roll: { kind: "records", records: [] } }, { entity: "city", as, ids }).of("statement", "ballot").length).toBe(1);
});
