// Votes and ballots as a seat is shown them (participants/src/llm/render.ts; live check 2 of 2026-10-09, finding 3). A
// clerk saw "vote ... from city" for every councillor's vote and could not reconcile a count; two councillors voted on
// a ballot shown as "closing year 1, day 1" beside its result. A vote is shown as from the post it was cast in; a
// closed ballot as closed, with where its result is; a council's result with who voted which way. An election's votes
// are secret: cast in no post, they are counted and nothing more.

import { expect, test } from "bun:test";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { inCurrency } from "../src/money";
import { renderObservation } from "../src/llm/render";

inCurrency(PROFILE.values.currency as any);
const obs = (records: object[], search = false) => ({ participant: "clerk", t: 5 * 86_400, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], channels: { "council-clerk/votes": { kind: "records", records, ...(search ? { search: true } : {}) } } }) as any;
const whoIs = (id: string) => (id.endsWith("-system") ? { id: id.replace(/-system$/, ""), of: "city" } : /^councillor-\d$/.test(id) ? { id, name: `Councillor ${id.slice(-1)}`, of: "city" } : undefined);
const vote = (n: number, choice: string, more: object = {}) => ({ id: `rec.${1300 + n}`, record: "vote", author: `councillor-${n}-system`, in_position: `councillor-${n}`, speaks_for: "city", at: 86_400, visible_to: ["city"], ballot: "rec.900", choice, ...more });

test("a vote is shown as from the post it was cast in, not from the organisation the post is of; a tally of a council's votes says whose they are", () => {
  // One by one, as a look into the votes lists them.
  const listed = renderObservation(obs([vote(1, "yes"), vote(2, "no")], true), { whoIs, looked: new Map([["council-clerk/votes", { limit: 20 }]]) });
  expect(listed).toContain('- [rec.1301] vote, year 1, day 2, from councillor-1: "yes" on rec.900');
  expect(listed).toContain('- [rec.1302] vote, year 1, day 2, from councillor-2: "no" on rec.900');
  expect(listed).not.toContain("from city");
  // As they come, tallied: how many each way, and which posts.
  const tallied = renderObservation(obs([vote(1, "yes"), vote(2, "no"), vote(3, "yes")]), { whoIs });
  expect(tallied).toContain("- 3 votes on rec.900: no 1 (councillor-2), yes 2 (councillor-1, councillor-3)");
  // An elector's vote is cast in no post: counted, and nobody is named.
  const secret = (n: number, choice: string) => ({ id: `rec.${2000 + n}`, record: "vote", author: `c000${n}-self`, at: 86_400, visible_to: ["electoral"], ballot: "rec.950", choice });
  const poll = renderObservation(obs([secret(1, "c0007"), secret(2, "c0007"), secret(3, "c0009")]), { whoIs });
  expect(poll).toContain("- 3 votes on rec.950: c0007 2, c0009 1");
  expect(poll).not.toMatch(/c0001|c0002|c0003/);
});

test("a closed ballot is shown as closed, with its result, never as closing on a day gone by; a council's result says who voted which way, an election's does not", () => {
  const ballot = (data: object) => ({ id: "budget-year-1-ballot", record: "statement", kind: "ballot", author: "genesis", speaks_for: "city", at: 0, visible_to: "public", text: "Council ballot: the town's budget for year 1.", data });
  const closed = renderObservation(obs([ballot({ proposal: "budget-year-1-proposal", options: ["yes", "no"], closes_at: 0, closed: true, result: "budget-year-1-result", electorate: "council" })]), { whoIs });
  expect(closed).toContain("(closed: no more votes are taken; its result is budget-year-1-result; ");
  expect(closed).not.toMatch(/closes at|closes_at|year 1, day 1\b.*closes/);
  // One still open says when it closes, as before.
  const open = renderObservation(obs([ballot({ proposal: "p", options: ["yes", "no"], closes_at: 14 * 86_400, electorate: "council" })]), { whoIs });
  expect(open).toContain("year 1, day 15");
  expect(open).not.toContain("closed: no more votes");
  // The council's result: the count, and who voted which way.
  const result = (data: object) => ({ id: "budget-year-1-result", record: "statement", kind: "ballot_result", author: "council-clerk-system", speaks_for: "city", at: 0, visible_to: "public", text: "Passed: 4 for, 1 against.", data });
  const council = renderObservation(obs([result({ ballot: "budget-year-1-ballot", yes: 4, no: 1, passed: true, voted_for: ["councillor-1", "councillor-2", "councillor-3", "councillor-4"], voted_against: ["councillor-5"] })]), { whoIs });
  expect(council).toContain("voted for: councillor-1, councillor-2, councillor-3, councillor-4; voted against: councillor-5");
  expect(council).toContain("ballot: budget-year-1-ballot");
  const unanimous = renderObservation(obs([result({ ballot: "b", yes: 5, no: 0, passed: true, voted_for: ["councillor-1"], voted_against: [] })]), { whoIs });
  expect(unanimous).toContain("voted against: nobody");
  // An election's result names no voter, and none is shown.
  const election = renderObservation(obs([result({ ballot: "rec.950", winner: "c0007", counts: "c0007 212, c0009 180" })]), { whoIs });
  expect(election).not.toContain("voted for");
});
