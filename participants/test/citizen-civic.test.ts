// Civic life (docs/behaviour/citizen.md "Elections"; docs/behaviour/news.md "Readers"), on what a townsperson is shown
// alone: enrolling, standing, voting (once, in secret, a ranking), and how a reader's approval of the town's government
// moves with what the paper runs.

import { expect, test } from "bun:test";

import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { DAY, employment, lease, person, signed, standingOrder, statement, type Said } from "./stepping";
import { engine } from "./engine";
const citizen = engine("citizen.default");

inCurrency(PROFILE.values.currency);

const WAGE = 120_000, RENT = 80_000;
const CIVIC = { turnout_bps: 10_000, stand_bps: 0, reads_news_bps: 10_000, approval_memory_weeks: 26, news_weight_bps: 1500, platform_weight_bps: 2500 };
const PARAMS = { electoral_town: "city", paper: "paper", petition_willing_bps: 0 };
const start = (me: string, enrolled = true) => [...signed(lease("L1", 0, "landlord-1", me, "apts-1/dwelling.1", RENT)), standingOrder("so-1", 0, me, "acc-landlord-1", RENT, { basis: "L1", first: 0 }), ...signed(employment("J1", 0, "factory-1", me, WAGE)),
  ...(enrolled ? [statement(`enrol-${me}`, 0, "enrolment", { author: "genesis", speaks_for: me, addressed_to: ["city"], visible_to: [me, "city"] })] : [])];
const READINGS = { L1: { of: "agreement", status: "in_force" }, J1: { of: "agreement", status: "in_force" } };
const wages = (t: number, me = "c1") => [{ t: t - DAY, from: "acc-factory-1", to: `acc-${me}`, amount: String(WAGE), currency: "AUD", by: "bank", memo: "wages" }];
/** A townsperson (a tenant in work), after their first look around on day 1. */
async function resident(civic: object = {}, o: { me?: string; age?: number; enrolled?: boolean; seed?: bigint; params?: object } = {}) {
  const p = person(citizen, { ...PARAMS, ...(o.params ?? {}), civic: { ...CIVIC, ...civic } }, { me: o.me, age: o.age, seed: o.seed });
  const said = await p.wake(DAY, { records: start(p.me, o.enrolled ?? true), readings: READINGS, balance: 500_000, transactions: wages(DAY, p.me) });
  return { p, said };
}
const news = (id: string, at: number, tone: unknown, x: any = {}) => statement(id, at, "news", { author: "editor-system", in_position: "editor", speaks_for: "paper", text: `News ${id}.`, ...x, data: { kind: "budget", tone, about_office: true, edition: 1, ...(x.data ?? {}) } });

// An election for mayor: the incumbent (number 2 on the paper) and a resident, c5 (number 1), whose platform names no values.
const NOM_M = statement("nom-m", 45 * DAY, "nomination", { author: "mayor-system", in_position: "mayor", speaks_for: "city", addressed_to: ["city"], data: { office: "mayor", name: "the incumbent mayor", incumbent: true, values: ["security", "benevolence"] } });
const NOM_5 = statement("nom-5", 45 * DAY, "nomination", { author: "c5-self", speaks_for: "c5", addressed_to: ["city"], data: { office: "mayor", name: "c5", values: [] } });
const election = (id: string, opens: number, closes: number, electors: string[], extra: any[] = []) => [NOM_M, NOM_5,
  statement(`roll-${id}`, opens - DAY, "electoral_roll", { author: "electoral-system", data: { electors, poll_at: closes } }),
  statement(id, opens - DAY, "ballot", { author: "electoral-system", data: { office: "mayor", electorate: "roll", method: "preferential", opens_at: opens, closes_at: closes, options: ["1", "2", ...extra.map((c) => c.number)],
    candidates: [{ candidate: "c5-self", number: "1", nomination: "nom-5" }, { candidate: "mayor-system", number: "2", nomination: "nom-m" }, ...extra] } })];
const votes = (said: Said[]) => said.filter((c) => c.fn === "vote");
/** Their approval of the town's government now, as they say it when they vote (on a ballot open today, made for the asking). */
async function approvalOf(p: ReturnType<typeof person>, t: number, id: string, records: any[] = []) {
  const v = votes(await p.wake(t, { records: [...records, ...election(id, t - DAY, t + DAY, [p.me])], transactions: wages(t, p.me) }));
  expect(v.length).toBe(1);
  return { approval: Number(/approval of the town's government: (-?\d+)/.exec(v[0]!.why)![1]), ranking: v[0]!.args.choice as string };
}

test("someone of voting age who isn't on the roll enrols with the town, once; someone enrolled at the start doesn't", async () => {
  const enrolments = (said: Said[]) => said.filter((c) => c.fn === "statement" && c.args.kind === "enrolment");
  const fresh = await resident({}, { enrolled: false });
  expect(enrolments(fresh.said).map((c) => [c.args.to, c.args.visible, c.why])).toEqual([[["city"], ["c1", "city"], "Of voting age (or new to town) and not on the roll: enrolling, as the law requires."]]);
  expect(enrolments(await fresh.p.wake(8 * DAY, { transactions: wages(8 * DAY) }))).toEqual([]);
  expect(enrolments((await resident()).said)).toEqual([]);
  // A world with no elections (no town to enrol with): nothing.
  expect(enrolments((await resident({}, { enrolled: false, params: { electoral_town: null } })).said)).toEqual([]);
});

test("given notice of an election, a resident stands with the chance stand_bps, while nominations are open, once: a public nomination to the town, its platform its two strongest values", async () => {
  const notice = (id: string, close: number) => statement(id, 40 * DAY, "election_notice", { author: "electoral-system", data: { office: "mayor", poll_at: 100 * DAY, nominations_close_at: close, method: "preferential" } });
  const nominations = (said: Said[]) => said.filter((c) => c.fn === "statement" && c.args.kind === "nomination");
  const keen = await resident({ stand_bps: 10_000 });
  const said = nominations(await keen.p.wake(43 * DAY, { records: [notice("en-1", 70 * DAY)], transactions: wages(43 * DAY) }));
  expect(said.length).toBe(1);
  expect(said[0]!.args).toMatchObject({ to: ["city"], visible: "public", data: { office: "mayor", name: "c1" } });
  const values: string[] = said[0]!.args.data.values;
  expect(values.length).toBe(2);
  expect(said[0]!.args.text).toBe(`Standing for mayor: for ${values.join(" and ")}.`);
  expect(said[0]!.args.assertion).toEqual({ that: said[0]!.args.text });
  // Once for a notice; and not for one whose nominations have closed.
  expect(nominations(await keen.p.wake(50 * DAY, { transactions: wages(50 * DAY) }))).toEqual([]);
  expect(nominations(await keen.p.wake(71 * DAY, { records: [notice("en-2", 70 * DAY)], transactions: wages(71 * DAY) }))).toEqual([]);
  // Never, at 0.
  const shy = await resident({ stand_bps: 0 });
  expect(nominations(await shy.p.wake(43 * DAY, { records: [notice("en-1", 70 * DAY)], transactions: wages(43 * DAY) }))).toEqual([]);
});

test("an elector votes once on a ballot open to the roll, in secret (for the town's eyes only), ranking every candidate by number; not off the roll, nor before it opens, nor once it has closed", async () => {
  const { p } = await resident();
  const open = election("b1", 86 * DAY, 100 * DAY, ["c1", "c2"]);
  // Published, not yet open.
  expect(votes(await p.wake(80 * DAY, { records: open, transactions: wages(80 * DAY) }))).toEqual([]);
  const cast = votes(await p.wake(87 * DAY, { transactions: wages(87 * DAY) }));
  expect(cast.length).toBe(1);
  expect(cast[0]!.args.ballot).toBe("b1");
  expect(cast[0]!.args.visible).toEqual(["city"]);
  expect(["1>2", "2>1"]).toContain(cast[0]!.args.choice);
  expect(votes(await p.wake(94 * DAY, { transactions: wages(94 * DAY) }))).toEqual([]);
  // Not on the roll: no vote. (Until citizen 0.37.0 an elector read the published roll for their name. Nobody is sent
  // the roll now, docs/no-god-view.md: an elector knows they are on it by having enrolled before the ballot was put.
  // So "off the roll" is someone who enrolled only after it: here on day 1, for a ballot put on day 0.)
  const off = await resident({}, { enrolled: false });
  expect(off.said.filter((c) => c.fn === "statement" && c.args.kind === "enrolment").length).toBe(1);
  expect(votes(await off.p.wake(87 * DAY, { records: election("b1", DAY, 100 * DAY, ["c2", "c3"]), transactions: wages(87 * DAY) }))).toEqual([]);
  // Seen only at its close: no vote.
  const late = await resident();
  expect(votes(await late.p.wake(100 * DAY, { records: open, transactions: wages(100 * DAY) }))).toEqual([]);
  // The council's ballots aren't the electors'.
  const council = statement("b-council", 86 * DAY, "ballot", { author: "clerk", data: { proposal: "p1", electorate: "council", options: ["yes", "no"], closes_at: 100 * DAY } });
  expect(votes(await (await resident()).p.wake(87 * DAY, { records: [council], transactions: wages(87 * DAY) }))).toEqual([]);
});

test("turnout: an elector votes with the chance turnout_bps (voting is compulsory; some don't)", async () => {
  const stayHome = await resident({ turnout_bps: 0 });
  expect(votes(await stayHome.p.wake(87 * DAY, { records: election("b1", 86 * DAY, 100 * DAY, ["c1"]), transactions: wages(87 * DAY) }))).toEqual([]);
  // At 83% (the first profile's): of 200 electors, about that many vote (150 to 182).
  let voted = 0;
  for (let i = 0; i < 200; i++) voted += votes(await (await resident({ turnout_bps: 8300 }, { seed: BigInt(i + 1) })).p.wake(87 * DAY, { records: election("b1", 86 * DAY, 100 * DAY, ["c1"]), transactions: wages(87 * DAY) })).length;
  expect(voted).toBeGreaterThan(150);
  expect(voted).toBeLessThan(182);
});

test("a ranking: a candidate puts itself first; otherwise the incumbent stands by the elector's approval of the town's government, a challenger by how its platform's values are the elector's own", async () => {
  // A candidate on the paper (number 3): first, whatever else.
  const me = await resident();
  const mine = statement("nom-1", 45 * DAY, "nomination", { author: "c1-self", speaks_for: "c1", addressed_to: ["city"], data: { office: "mayor", name: "c1", values: [] } });
  const cast = votes(await me.p.wake(87 * DAY, { records: [mine, ...election("b1", 86 * DAY, 100 * DAY, ["c1"], [{ candidate: "c1-self", number: "3", nomination: "nom-1" }])], transactions: wages(87 * DAY) }));
  expect(cast[0]!.args.choice.startsWith("3>")).toBe(true);
  // A reader who has read well of the government ranks the incumbent (2) above a challenger who stands for nothing in
  // particular (1); one who has read badly of it, the other way.
  const pleased = await resident();
  const good = [1, 2, 3].map((i) => news(`good${i}`, 80 * DAY, 1));
  expect(await approvalOf(pleased.p, 87 * DAY, "b1", good)).toMatchObject({ ranking: "2>1" });
  const cross = await resident();
  const bad = [1, 2, 3].map((i) => news(`bad${i}`, 80 * DAY, -1));
  const view = await approvalOf(cross.p, 87 * DAY, "b1", bad);
  expect(view.ranking).toBe("1>2");
  expect(view.approval).toBeLessThan(0);
});

test("a reader of the paper moves its approval by the tone of each item about the government, times news_weight_bps, once for each item; someone who doesn't read the paper isn't moved", async () => {
  const items = [
    news("n1", 5 * DAY, -1, { data: { kind: "petition" } }),
    news("n2", 5 * DAY, -1, { data: { kind: "complaint" } }),
    news("n3", 5 * DAY, 1),
    news("n4", 5 * DAY, 0, { data: { kind: "law" } }),
    news("n5", 5 * DAY, -1, { data: { kind: "ballot_result", about_office: false } }), // not about the government: moves nothing
  ];
  // Two people alike in everything (the same draw), but that one reads the paper: the difference is the paper's doing.
  const reader = await resident({ reads_news_bps: 10_000 });
  const other = await resident({ reads_news_bps: 0 });
  const [a, b] = [await approvalOf(reader.p, 8 * DAY, "b1", items), await approvalOf(other.p, 8 * DAY, "b1", items)];
  expect(a.approval - b.approval).toBe(-1500); // (-1 - 1 + 1 + 0) x 1,500
  // The same items shown again move nothing more; a new one does.
  const [a2, b2] = [await approvalOf(reader.p, 9 * DAY, "b2", items), await approvalOf(other.p, 9 * DAY, "b2", items)];
  expect(a2.approval - b2.approval).toBe(-1500);
  const [a3, b3] = [await approvalOf(reader.p, 10 * DAY, "b3", [news("n6", 9 * DAY, -1)]), await approvalOf(other.p, 10 * DAY, "b3", [news("n6", 9 * DAY, -1)])];
  expect(a3.approval - b3.approval).toBe(-3000);
  // A heavier weight moves it further; approval stays within -10,000 to 10,000.
  const heavy = await resident({ reads_news_bps: 10_000, news_weight_bps: 6000 });
  expect((await approvalOf(heavy.p, 8 * DAY, "b1", [news("m1", 5 * DAY, -1), news("m2", 5 * DAY, -1), news("m3", 5 * DAY, -1)])).approval).toBe(-10_000);
});

test("only what the paper publishes is read as its news: a statement of kind news from anyone else moves nobody's approval", async () => {
  // A resident publishing "news" in their own name; an office of the town doing the same; and a world with no paper.
  const fakes = [
    news("f1", 5 * DAY, -1, { author: "c9-self", in_position: undefined, speaks_for: "c9" }),
    news("f2", 5 * DAY, -1, { author: "c9-self", in_position: undefined, speaks_for: undefined }),
    news("f3", 5 * DAY, 1, { author: "mayor-system", in_position: "mayor", speaks_for: "city" }),
  ];
  const [reader, other] = [await resident({ reads_news_bps: 10_000 }), await resident({ reads_news_bps: 0 })];
  expect((await approvalOf(reader.p, 8 * DAY, "b1", fakes)).approval).toBe((await approvalOf(other.p, 8 * DAY, "b1", fakes)).approval);
  // The paper's own item, beside them, is read.
  const real = [news("n1", 8 * DAY, -1)];
  expect((await approvalOf(reader.p, 9 * DAY, "b2", real)).approval - (await approvalOf(other.p, 9 * DAY, "b2", real)).approval).toBe(-1500);
  // Where the world names no paper, nothing is read as its news.
  const [noPaper, same] = [await resident({ reads_news_bps: 10_000 }, { params: { paper: null } }), await resident({ reads_news_bps: 0 }, { params: { paper: null } })];
  expect((await approvalOf(noPaper.p, 8 * DAY, "b1", real)).approval).toBe((await approvalOf(same.p, 8 * DAY, "b1", real)).approval);
});

test("an item's tone counts within the paper's range, -1 to 1: a tone beyond it moves approval no further than the limit, and one that isn't a number not at all", async () => {
  const moved = async (tone: unknown) => {
    const [reader, other] = [await resident({ reads_news_bps: 10_000 }), await resident({ reads_news_bps: 0 })];
    const item = [news("n1", 5 * DAY, tone)];
    const [a, b] = [await approvalOf(reader.p, 8 * DAY, "b1", item), await approvalOf(other.p, 8 * DAY, "b1", item)];
    expect(Number.isFinite(a.approval)).toBe(true);
    return a.approval - b.approval;
  };
  expect(await moved(-1)).toBe(-1500);
  expect(await moved(1)).toBe(1500);
  expect(await moved(-50)).toBe(-1500);
  expect(await moved(1000)).toBe(1500);
  expect(await moved(0.5)).toBe(750);
  for (const tone of ["terrible", null, undefined, {}, Number.NaN, "Infinity"]) expect(await moved(tone)).toBe(0);
});

test("readers are a share of the town (reads_news_bps, drawn once for each person)", async () => {
  // At 40% (the first profile's): of 200 people shown a bad item, about that many think worse of the government for it.
  let moved = 0;
  for (let i = 0; i < 200; i++) {
    const seed = BigInt(i + 1);
    const [reader, same] = [await resident({ reads_news_bps: 4000 }, { seed }), await resident({ reads_news_bps: 0 }, { seed })];
    const item = [news("n1", 5 * DAY, -1)];
    if ((await approvalOf(reader.p, 8 * DAY, "b1", item)).approval !== (await approvalOf(same.p, 8 * DAY, "b1", item)).approval) moved++;
  }
  expect(moved).toBeGreaterThan(60);
  expect(moved).toBeLessThan(100);
});
