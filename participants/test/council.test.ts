// The council (docs/behaviour/government.md), on records alone: how a councillor votes on a proposal that isn't a
// budget (its leaning, the proposal's place from its tags, the noise) and on one that is; the clerk's ballot (opened for
// each proposal to the town, counted at its close from the councillor seats' latest votes, passed by more yes than no
// and a majority of all councillors); and the code mayor's answer to a petition once enough have signed.

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";
import { councilClerk, councillor, mayorCode } from "../src/behaviour/government";
import { Randomness } from "../src/rng";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";

inCurrency(PROFILE.values.currency);

const DAY = 86_400;
const ctx = (participant: string, params: object, position?: string, seed = 1n): any => ({ participant, entity: "city", position, rng: (k: string) => new Randomness(seed).stream([participant, k]), world: { tickSeconds: 3600, runEnd: 800 * DAY }, params });
const SEATS = [1, 2, 3, 4, 5].map((i) => `councillor-${i}`);
const council = { kind: "directory", entities: [], positions: [...SEATS.map((position) => ({ position, entity: "city", role: "councillor" })),
  { position: "mayor", entity: "city", role: "mayor" }, { position: "councillor-9", entity: "other-town", role: "councillor" }] };
const obs = (t: number, records: any[], more: object = {}): Observation => ({ t, entity: "city", participant: "x", channels: { business: { kind: "records", records }, who: council, ...more }, inbox: [], outcomes: [], woke_for: "news" }) as unknown as Observation;
const stmt = (id: string, at: number, kind: string, x: object) => ({ id, at, record: "statement", author: "genesis", speaks_for: "city", visible_to: "public", kind, text: id, ...x });
/** What a module does now: its acts (the call's text, and why). */
const acts = (m: { step: (o: Observation, x: any) => any }, o: Observation) => {
  const out: { call: string; why: string }[] = [];
  for (let i = 0; i < 1000; i++) {
    const a: any = m.step(o, undefined as any);
    if (a.type === "wait") break;
    out.push({ call: a.call, why: a.reasoning ?? "" });
    o = { ...o, channels: Object.fromEntries(Object.entries(o.channels).map(([k, c]: [string, any]) => [k, c.kind === "records" ? { ...c, records: [] } : c])), inbox: [] } as Observation;
  }
  return out;
};
const run = (m: { step: (o: Observation, x: any) => any }, o: Observation) => acts(m, o).map((a) => a.call).join("\n");
const lines = (text: string, kind: string) => text.split("\n").filter((l) => l.includes(`kind=${kind}`));
const dataOf = (line: string) => JSON.parse(/data=(\{.*?\})(?:, \w+=|\)$)/.exec(line)![1]!);
const ballot = (id: string, at: number, tags: string[], x: object = {}) => stmt(id, at, "ballot", { author: "clerk", data: { proposal: `p-${id}`, options: ["yes", "no"], closes_at: at + 14 * DAY, electorate: "council", tags, ...x } });
const proposal = (id: string, at: number, x: object) => stmt(id, at, "proposal", { addressed_to: ["city"], author: "c1-self", speaks_for: "c1", ...x });
const cast = (id: string, of: string, at: number, seat: string, choice: string) => ({ id, at, record: "vote", author: `${seat}-system`, in_position: seat, speaks_for: "city", visible_to: "public", ballot: of, choice });

// ------------------------------------------------------------------ city.councillor

/** How a councillor of a leaning votes on a ballot with these tags (no noise unless given). */
const voteOf = (leaning: number, tags: string[], params: object = {}, seed = 1n) => {
  const m = councillor.create(ctx("councillor-1-system", { leaning, noise_bps: 0, ...params }, "councillor-1", seed));
  const a = acts(m, obs(DAY, [ballot("b1", DAY, tags)]));
  expect(a.length).toBe(1);
  return { choice: /choice=(\w+)/.exec(a[0]!.call)![1]!, why: a[0]!.why, call: a[0]!.call };
};

test("a councillor votes yes when the proposal's place (tenant protection +60, development -60) is nearer its leaning than the status quo (0) is", () => {
  // The generated council's five leanings, on a tenant-protection proposal: the two pro-tenant councillors vote yes.
  expect([-80, -40, 0, 40, 80].map((l) => voteOf(l, ["tenant_protection"]).choice)).toEqual(["no", "no", "no", "yes", "yes"]);
  // On a development proposal: the mirror image.
  expect([-80, -40, 0, 40, 80].map((l) => voteOf(l, ["development"]).choice)).toEqual(["yes", "yes", "no", "no", "no"]);
  // Nearer, not merely on the same side: at +30 the proposal (+60) and the status quo (0) are equally far, and a tie is no;
  // at +31 the proposal is nearer.
  expect(voteOf(30, ["tenant_protection"]).choice).toBe("no");
  expect(voteOf(31, ["tenant_protection"]).choice).toBe("yes");
  expect(voteOf(-31, ["development"]).choice).toBe("yes");
  const v = voteOf(80, ["tenant_protection"]);
  expect(v.call).toBe("vote(ballot=b1, choice=yes)");
  expect(v.why).toBe("Voting by our leaning (80) against the proposal's place on the tenants-development axis (60).");
});

test("a proposal marked for neither side sits at the status quo, so no councillor finds it nearer: every one votes no, whatever its leaning", () => {
  // (As the documentation's rule reads: yes only when the proposal is closer than the status quo. A proposal with no
  // place on the axis is at 0, where the status quo is, so it's never closer: it can pass only by the noise. Reported.)
  for (const tags of [[], ["something_else"], ["tenant_protection", "development"]]) expect([-80, -40, 0, 40, 80].map((l) => voteOf(l, tags).choice)).toEqual(["no", "no", "no", "no", "no"]);
  expect(voteOf(40, []).why).toBe("Voting by our leaning (40) against the proposal's place on the tenants-development axis (0).");
});

test("the noise flips a councillor's vote with the chance noise_bps, and says so; a budget passes on budget_yes_bps, whatever the leaning", () => {
  // Always flipped: the pro-tenant councillor votes no on tenant protection, the pro-development one yes.
  const flipped = voteOf(80, ["tenant_protection"], { noise_bps: 10_000 });
  expect(flipped.choice).toBe("no");
  expect(flipped.why).toBe("Voting by our leaning (80) against the proposal's place on the tenants-development axis (60), this time the other way (noise).");
  expect(voteOf(-80, ["tenant_protection"], { noise_bps: 10_000 }).choice).toBe("yes");
  expect(voteOf(0, [], { noise_bps: 10_000 }).choice).toBe("yes");
  // At the documented 15%: about that share of many councillors' votes go the other way (400 draws: between 10% and 20%).
  let other = 0;
  for (let i = 0; i < 400; i++) if (voteOf(80, ["tenant_protection"], { noise_bps: 1500 }, BigInt(i + 1)).choice === "no") other++;
  expect(other).toBeGreaterThan(40);
  expect(other).toBeLessThan(80);
  // A budget: the base propensity alone (the leaning and the noise play no part).
  for (const leaning of [-80, 0, 80]) {
    expect(voteOf(leaning, ["budget"], { budget_yes_bps: 10_000, noise_bps: 10_000 }).choice).toBe("yes");
    expect(voteOf(leaning, ["budget"], { budget_yes_bps: 0 }).choice).toBe("no");
  }
  expect(voteOf(0, ["budget"], { budget_yes_bps: 10_000 }).why).toBe("A budget: voting on our usual propensity to pass budgets.");
  let yes = 0;
  for (let i = 0; i < 400; i++) if (voteOf(0, ["budget"], { budget_yes_bps: 9000 }, BigInt(i + 1)).choice === "yes") yes++;
  expect(yes).toBeGreaterThan(340);
  expect(yes).toBeLessThan(380);
});

test("a councillor votes once on each council ballot while it's open, and never on a ballot that has closed or that isn't the council's", () => {
  const m = councillor.create(ctx("councillor-1-system", { leaning: 80, noise_bps: 0 }, "councillor-1"));
  const open = ballot("b1", DAY, ["tenant_protection"]);
  const closedAlready = ballot("b2", DAY - 20 * DAY, ["tenant_protection"]);
  const election = ballot("b3", DAY, [], { electorate: "roll" });
  expect(run(m, obs(DAY, [open, closedAlready, election]))).toBe("vote(ballot=b1, choice=yes)");
  expect(run(m, obs(4 * DAY, []))).toBe("");
  // One seen only at the moment it closes: not voted on.
  const late = ballot("b4", 0, ["tenant_protection"]);
  expect(run(m, obs(14 * DAY, [late]))).toBe("");
  // A letter gets its voting record, and changes nothing.
  const letter = { ...obs(15 * DAY, []), inbox: [{ id: "m1", from: "mayor-system", text: "Please support b1." }] } as unknown as Observation;
  expect(run(m, letter)).toContain("Report from a councillor: my votes on the council's ballots: b1: yes.");
});

// ------------------------------------------------------------------ city.council_clerk

test("the clerk puts each proposal addressed to the town to a council ballot, open for vote_days, placed by the proposal's tags or its form's", () => {
  const clerk = councilClerk.create(ctx("clerk", { vote_days: 10 }, "council-clerk"));
  const opened = run(clerk, obs(3 * DAY, [
    proposal("p1", 2 * DAY, { text: "Cap rent rises.", data: { enact: { kind: "law", text: "Rent rises are capped." }, tags: ["tenant_protection"] } }),
    proposal("p2", 2 * DAY, { text: "council proposal", data: { proposal: "Rezone the mill.", kind: "law", affects: "development" } }),
    proposal("p3", 2 * DAY, { text: "council proposal", data: { proposal: "A budget.", kind: "budget", parks: "100.00", affects: "neither" } }),
    proposal("p4", 2 * DAY, { text: "council proposal", data: { proposal: "Name the bridge.", kind: "law", affects: "neither" } }),
    proposal("p5", 2 * DAY, { text: "To another town.", addressed_to: ["other-town"], data: { enact: { kind: "law", text: "x" }, tags: [] } }),
  ]));
  const made = lines(opened, "ballot").map((l) => ({ ...dataOf(l), basis: /basis=([\w.-]+)/.exec(l)![1], text: /text="([^"]*)"/.exec(l)![1] }));
  expect(made.map((b) => [b.proposal, b.tags])).toEqual([["p1", ["tenant_protection"]], ["p2", ["development"]], ["p3", ["budget"]], ["p4", []]]);
  for (const b of made) expect(b).toMatchObject({ options: ["yes", "no"], electorate: "council", closes_at: 3 * DAY + 10 * DAY, basis: b.proposal });
  expect(made[0]!.text).toBe("Council ballot: Cap rent rises.");
  // Once each: nothing more the next day.
  expect(run(clerk, obs(4 * DAY, []))).toBe("");
});

/** A clerk with one ballot (b1, on a law in free words, closing on day 15), the votes cast, and what it does at the close. */
const count = (votes: any[], x: { closeAt?: number; extra?: any[] } = {}) => {
  const clerk = councilClerk.create(ctx("clerk", {}, "council-clerk"));
  const p1 = proposal("p-b1", DAY, { text: "Cap rent rises.", data: { enact: { kind: "law", text: "Rent rises are capped." }, tags: ["tenant_protection"] } });
  run(clerk, obs(DAY, [p1]));
  expect(run(clerk, obs(2 * DAY, [ballot("b1", DAY, ["tenant_protection"]), ...(x.extra ?? []), ...votes]))).toBe("");
  // (Not before it closes.)
  expect(run(clerk, obs(15 * DAY - 1, []))).toBe("");
  const closed = run(clerk, obs(x.closeAt ?? 15 * DAY, []));
  const result = lines(closed, "ballot_result")[0]!;
  return { closed, result: dataOf(result), text: /text="([^"]*)"/.exec(result)![1]!, law: lines(closed, "law").find((l) => !l.includes("kind=ballot_result")), clerk };
};

test("at the close the clerk counts each councillor seat's latest vote, and nobody else's", () => {
  const { result, text, closed } = count([
    cast("v1", "b1", 2 * DAY, "councillor-1", "yes"),
    cast("v2", "b1", 2 * DAY, "councillor-2", "yes"),
    cast("v3", "b1", 2 * DAY, "councillor-3", "no"),
    // A councillor who changes their mind: the latest counts.
    cast("v4", "b1", 2 * DAY, "councillor-4", "no"),
    cast("v5", "b1", 3 * DAY, "councillor-4", "yes"),
    // Not councillors of this town: the mayor, another town's councillor, a resident as themselves.
    cast("v6", "b1", 2 * DAY, "mayor", "no"),
    cast("v7", "b1", 2 * DAY, "councillor-9", "no"),
    { ...cast("v8", "b1", 2 * DAY, "c7", "no"), in_position: undefined, author: "c7-self", speaks_for: "c7" },
    // A councillor's vote on another ballot.
    cast("v9", "b0", 2 * DAY, "councillor-5", "no"),
  ]);
  expect(result).toEqual({ ballot: "b1", yes: 3, no: 1, passed: true });
  expect(text).toBe("Passed: 3 for, 1 against. The law is recorded as worded. No rule was set down with it for acts to be checked against.");
  expect(lines(closed, "law").filter((l) => !l.includes("kind=ballot_result")).length).toBe(1);
});

test("a proposal passes with more yes than no AND a majority of all councillors: abstentions count against", () => {
  const votes = (choices: (string | null)[]) => choices.flatMap((c, i) => (c ? [cast(`v${i}`, "b1", 2 * DAY, SEATS[i]!, c)] : []));
  // Three of five: passed, and the law published with the ballot as its basis.
  const passed = count(votes(["yes", "yes", "yes", "no", "no"]));
  expect(passed.result).toEqual({ ballot: "b1", yes: 3, no: 2, passed: true });
  expect(passed.law).toContain('text="Rent rises are capped."');
  expect(passed.law).toContain("basis=b1");
  // Two yes and no one against: more yes than no, but not a majority of the five. Rejected, and nothing enacted.
  const few = count(votes(["yes", "yes", null, null, null]));
  expect(few.result).toEqual({ ballot: "b1", yes: 2, no: 0, passed: false });
  expect(few.text).toBe("Rejected: 2 for, 0 against.");
  expect(few.law).toBeUndefined();
  // A vote that is neither yes nor no is an abstention.
  expect(count(votes(["yes", "yes", "abstain", "no", null])).result).toEqual({ ballot: "b1", yes: 2, no: 1, passed: false });
  expect(count(votes(["yes", "yes", "no", "no", "no"])).result).toMatchObject({ yes: 2, no: 3, passed: false });
  // Nobody voted: rejected.
  expect(count([]).result).toEqual({ ballot: "b1", yes: 0, no: 0, passed: false });
  // The majority is of the council as the directory has it at the close: 3 of 5 passes, and would not of 6.
  expect(count(votes(["yes", "yes", "yes", null, null])).result.passed).toBe(true);
});

test("the clerk counts only the council's ballots, each once, and reports what's open and what was decided", () => {
  const election = stmt("b-roll", DAY, "ballot", { author: "electoral-system", data: { office: "mayor", electorate: "roll", closes_at: 10 * DAY, options: ["1", "2"] } });
  const elsewhere = stmt("b-other", DAY, "ballot", { author: "x", speaks_for: "other-town", data: { proposal: "p", electorate: "council", closes_at: 10 * DAY, options: ["yes", "no"] } });
  const { closed, clerk } = count(SEATS.map((s, i) => cast(`v${i}`, "b1", 2 * DAY, s, "yes")), { extra: [election, elsewhere] });
  expect(lines(closed, "ballot_result").length).toBe(1);
  expect(run(clerk, obs(16 * DAY, []))).toBe("");
  const letter = { ...obs(17 * DAY, [stmt("res-1", 15 * DAY, "ballot_result", { author: "clerk", data: { ballot: "b1", yes: 5, no: 0, passed: true } })]), inbox: [{ id: "m1", from: "mayor-system", text: "What happened?" }] } as unknown as Observation;
  const report = run(clerk, letter);
  expect(report).toContain("Report from the council clerk: no ballots are open. Recent results: b1: passed 5-0. No budget is adopted for year 1.");
});

// ------------------------------------------------------------------ city.mayor_code and a petition

const petition = (id: string, at: number, x: object = {}) => stmt(id, at, "petition", { author: "c1-self", speaks_for: "c1", text: "Petition.", data: { demand: { kind: "law", text: "A landlord must give at least 90 days' notice.",
  adico: { attribute: "landlords", deontic: "must_not", aim: "end a tenancy on less than 90 days' notice" }, tags: ["tenant_protection"] } }, ...x });
const counted = (id: string, of: string, at: number, signatures: number, x: object = {}) => stmt(id, at, "petition_count", { author: "c1-self", speaks_for: "c1", basis: of, data: { petition: of, signatures }, ...x });
const MAYOR = { builder: "builder", population: 200, responsiveness_bps: 10_000, petition_threshold_bps: 1500, park_budget: 0 };
/** What the mayor does about petitions (its yearly budget proposal aside). */
const answers = (m: any, o: Observation) => lines(run(m, o), "proposal").filter((l) => l.includes("from petition"));

test("the code mayor turns a petition into a proposal carrying its demand once the organiser's published count reaches petition_threshold_bps of the population", () => {
  const mayor = mayorCode.create(ctx("mayor-system", MAYOR, "mayor"));
  // 29 of 200 (14.5%): below 15%. Nothing, and it keeps watching.
  expect(answers(mayor, obs(DAY, [petition("pet-1", 0), counted("n1", "pet-1", DAY, 29)]))).toEqual([]);
  // A count published by someone who isn't the organiser isn't the petition's count.
  expect(answers(mayor, obs(2 * DAY, [counted("n2", "pet-1", 2 * DAY, 150, { author: "c9-self", speaks_for: "c9" })]))).toEqual([]);
  // 30 of 200: exactly 15% reaches it.
  const put = answers(mayor, obs(8 * DAY, [counted("n3", "pet-1", 8 * DAY, 30)]));
  expect(put.length).toBe(1);
  expect(put[0]).toContain('text="Proposal (from petition pet-1): A landlord must give at least 90 days\' notice."');
  expect(put[0]).toContain("basis=pet-1");
  expect(put[0]).toContain('to=["city"]');
  expect(dataOf(put[0]!)).toEqual({ enact: { kind: "law", text: "A landlord must give at least 90 days' notice.", adico: { attribute: "landlords", deontic: "must_not", aim: "end a tenancy on less than 90 days' notice" } }, tags: ["tenant_protection"] });
  // Once: a higher count later isn't answered again.
  expect(answers(mayor, obs(15 * DAY, [counted("n4", "pet-1", 15 * DAY, 120)]))).toEqual([]);
});

test("the code mayor answers such petitions with the chance responsiveness_bps, decided once for each; a closed petition isn't answered", () => {
  const never = mayorCode.create(ctx("mayor-system", { ...MAYOR, responsiveness_bps: 0 }, "mayor"));
  expect(answers(never, obs(DAY, [petition("pet-1", 0), counted("n1", "pet-1", DAY, 100)]))).toEqual([]);
  expect(answers(never, obs(8 * DAY, [counted("n2", "pet-1", 8 * DAY, 180)]))).toEqual([]);
  // At the documented 70%: about that share of many petitions are put (300 petitions: between 60% and 80%).
  const some = mayorCode.create(ctx("mayor-system", { ...MAYOR, responsiveness_bps: 7000 }, "mayor"));
  const many = Array.from({ length: 300 }, (_, i) => [petition(`pet-${i}`, 0), counted(`n-${i}`, `pet-${i}`, DAY, 100)]).flat();
  const put = answers(some, obs(DAY, many)).length;
  expect(put).toBeGreaterThan(180);
  expect(put).toBeLessThan(240);
  // A petition its organiser has closed (withdrawn) before it's answered: not put.
  const mayor = mayorCode.create(ctx("mayor-system", MAYOR, "mayor"));
  const gone = { id: "w1", at: DAY, record: "withdrawal", author: "c1-self", speaks_for: "c1", visible_to: "public", withdraws: "pet-1" };
  expect(answers(mayor, obs(DAY, [petition("pet-1", 0), counted("n1", "pet-1", DAY, 100), gone]))).toEqual([]);
});

test("whoever takes the mayor's office doesn't answer again a petition the office already answered: it reads the office's record", () => {
  const first = mayorCode.create(ctx("mayor-system", MAYOR, "mayor"));
  const seen = [petition("pet-1", 0), counted("n1", "pet-1", DAY, 100)];
  expect(answers(first, obs(DAY, seen)).length).toBe(1);
  // The office's proposal, on the record, made in the mayor's position by whoever held it then.
  const made = proposal("prop-1", DAY, { author: "mayor-system", in_position: "mayor", speaks_for: "city", basis: "pet-1", text: "Proposal (from petition pet-1)", data: { enact: { kind: "law", text: "x" }, tags: [] } });
  const successor = mayorCode.create(ctx("c0042-self", MAYOR, "mayor"));
  expect(answers(successor, obs(30 * DAY, [...seen, made]))).toEqual([]);
  // A second petition, never answered, is the successor's to answer.
  expect(answers(successor, obs(37 * DAY, [petition("pet-2", 31 * DAY), counted("n2", "pet-2", 37 * DAY, 100)])).length).toBe(1);
});
