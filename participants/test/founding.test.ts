// Founding and words, piece by piece (docs/behaviour/founding.md): the arithmetic of whether and what shape; what a
// draft of a composed piece may be; what the composing model is shown and how its answer is read; its cap, its mix,
// its fallback, its declines and its follow-up. No world is run here and no model is called.

import { expect, test } from "bun:test";
import { Randomness, type Block, type ComposeBrief } from "../src";
import { acceptEntity, acceptGathering, acceptMembership, acceptPurpose, chanceOf, darkOf, drawOf, FOUNDING_DEFAULTS, foundingParams, membershipOffer, plainName, plainPurpose, shapeOdds } from "../src/behaviour/founding";
import { COMPOSE_FOLLOW_UP, COMPOSE_SYSTEM, COMPOSE_SYSTEM_REWORDED, createCompose, mockCompose, MockAdapter, ModelCallFailed, pieceSchema, readPiece, renderBrief, UsageLimitReached, type LlmAdapter, type LlmRequest } from "../src/llm";

const DAY = 86_400;
const P = { ...FOUNDING_DEFAULTS, shapes: ["gathering", "fund", "cause", "business"] as any, chance_bps: 400 };
const z0 = { enterprise: 0, care: 0, agency: 0, standing: 0, ties: 0 };

test("the dial: no founding without both the world's figures and its dial; the dial names the shapes and scales the chance", () => {
  expect(foundingParams(null, { shapes: ["fund"] })).toBeNull();
  expect(foundingParams({ chance_bps: 400 }, undefined)).toBeNull();
  const f = foundingParams({ chance_bps: 400, dues: [0, 100] }, { shapes: ["fund", "club"], scale_bps: 20_000 })!;
  expect(f.shapes).toEqual(["fund"]);
  expect(chanceOf(f, z0)).toBe(800);
  expect(chanceOf(foundingParams({ chance_bps: 400 }, { shapes: [] })!, z0)).toBe(400);
});

test("whether: the town's chance for a person at its mean; swayed symmetrically by temperament and standing", () => {
  expect(chanceOf(P, z0)).toBe(400);
  const up = chanceOf(P, { ...z0, agency: 1 }), down = chanceOf(P, { ...z0, agency: -1 });
  expect(up).toBeGreaterThan(400);
  expect(up - 400).toBe(400 - down);
  expect(chanceOf(P, { enterprise: -3, care: -3, agency: -3, standing: -3, ties: -3 })).toBe(0);
});

test("what shape: by what the want is about and what the person values; a body that takes grievances up needs someone it is against; only what can be founded", () => {
  const none = () => 0;
  const loss = shapeOdds(P, "loss", true, none);
  expect(loss.find((o) => o.key === "gathering")!.score).toBeGreaterThan(loss.find((o) => o.key === "fund")!.score);
  expect(shapeOdds(P, "disrepair", false, none).find((o) => o.key === "cause")!.score).toBe(0);
  expect(shapeOdds(P, "disrepair", true, none).find((o) => o.key === "cause")!.score).toBeGreaterThan(0);
  expect(shapeOdds(P, "let_go", true, none, { business: false }).find((o) => o.key === "business")!.score).toBe(0);
  // Someone who values security leans to a fund; one who values novelty, away from it.
  const secure = shapeOdds(P, "let_go", true, (v) => (v === "security" ? 2 : 0)), restless = shapeOdds(P, "let_go", true, (v) => (v === "stimulation" ? 2 : 0));
  expect(secure.find((o) => o.key === "fund")!.score).toBeGreaterThan(restless.find((o) => o.key === "fund")!.score);
  // The draw is the stream's: the same stream, the same shape; nothing at all odds 0.
  const r = new Randomness(7n);
  expect(drawOf(r.stream(["a"]), loss)).toBe(drawOf(r.stream(["a"]), loss));
  expect(drawOf(r.stream(["a"]), [{ key: "x", score: 0 }])).toBeUndefined();
});

test("with no model, what a thing is for is the founder's want in the world's own terms", () => {
  expect(plainPurpose("cause", { about: "disrepair", whom: "landlord-3" }, 4)).toBe("This is for those who know a home left in disrepair at the hands of landlord-3. 4 of us began it. We take up such matters with landlord-3 for our members, together.");
  expect(plainPurpose("gathering", { about: "loss" }, 3)).toContain("the death of someone close");
  expect(plainName("fund", "c0001", { about: "let_go", whom: "shop-2" })).toBe("Fund (let go, shop-2; c0001)");
});

test("a dark piece is one by the stated rule and no other", () => {
  expect(darkOf({ about: "loss" }, {}, 0)).toEqual(["about:loss"]);
  expect(darkOf({ about: "let_go" }, {}, 0)).toEqual([]);
  expect(darkOf({ about: "let_go" }, { memory: { defining: [{ what: "ruined" }] }, circumstances: { housed: 0 } }, -1.2)).toEqual(["lived:ruined", "homeless", "agency_low"]);
});

const pub = (x: object): Block => ({ block: "publish", visible_to: "public", ...x }) as unknown as Block;

test("a draft that founds: one organisation of the kind meant; the post's channels and module are the founder's own, never the draft's", () => {
  const accept = acceptEntity("group", "Convenor", [{ id: "books" }], { code: "group.founded" });
  const ok = accept([{ block: "create_entity", kind: "group", name: "The Tuesday Table", first_position: { title: "Boss", role_module: { code: "city.mayor_code" } } } as unknown as Block]) as any[];
  expect(ok[0]).toEqual({ block: "create_entity", kind: "group", name: "The Tuesday Table", ref: "founded", first_position: { title: "Convenor", channels: [{ id: "books" }], role_module: { code: "group.founded" } } });
  expect(typeof accept([{ block: "create_entity", kind: "firm", name: "X" } as unknown as Block])).toBe("string");
  expect(typeof accept([{ block: "transfer", from: "a", to: "b", amount: "1" } as unknown as Block])).toBe("string");
  expect(typeof accept([ok[0], ok[0]])).toBe("string");
});

test("a draft of the statement of purpose: one public statement of ours and only its words", () => {
  const accept = acceptPurpose("ent.1");
  const ok = accept([pub({ kind: "statement", text: "We meet because nobody else will hear it." })]) as any[];
  expect(ok[0]).toMatchObject({ kind: "purpose", speaks_for: "ent.1", assertion: { that: "We meet because nobody else will hear it." } });
  expect(typeof accept([pub({ kind: "purpose", text: "x", speaks_for: "ent.2" })])).toBe("string");
  expect(typeof accept([{ ...pub({ kind: "purpose", text: "x" }), visible_to: ["c0001"] } as Block])).toBe("string");
  expect(typeof accept([pub({ kind: "purpose", text: "x", offer: { take_up: "join" } })])).toBe("string");
  expect(typeof accept([{ block: "transfer" } as unknown as Block])).toBe("string");
});

test("a draft of the gathering: at the one place we can use, with a rhythm and a length among those open", () => {
  const g = { at: "house-1/dwelling.1", every_days: [7, 14], lasts_minutes: [60, 90], first: [10 * DAY, 40 * DAY] as [number, number], at_seconds: 19 * 3600 };
  const accept = acceptGathering("ent.1", g);
  const ok = accept([pub({ kind: "notice", text: "We meet fortnightly.", practice: { at: g.at, every: 14 * DAY, lasts: 5_400 } })]) as any[];
  expect(ok[0].practice).toEqual({ at: g.at, every: 14 * DAY, first: 10 * DAY, lasts: 5_400, roles: [{ role: "member", open: true }] });
  expect(typeof accept([pub({ kind: "notice", text: "x", practice: { at: "town-hall/hall.1", every: 14 * DAY, lasts: 5_400 } })])).toBe("string");
  expect(typeof accept([pub({ kind: "notice", text: "x", practice: { at: g.at, every: 3 * DAY, lasts: 5_400 } })])).toBe("string");
  expect(typeof accept([pub({ kind: "notice", text: "x", practice: { at: g.at, every: 14 * DAY, lasts: 8 * 3600 } })])).toBe("string");
  expect(typeof accept([pub({ kind: "notice", text: "x", practice: { at: g.at, every: 14 * DAY, lasts: 5_400, roles: [{ role: "member", who: { members_of: "union" } }] } })])).toBe("string");
  expect(typeof accept([pub({ kind: "notice", text: "x" })])).toBe("string");
});

test("a draft of the offer of membership: joining, with dues among those open, paid into our own account", () => {
  const accept = acceptMembership("ent.1", { account: "acc-9", dues: [0, 500], notice: 7 * DAY });
  const dues = (to: string, amount: string, every = 30 * DAY) => ({ take_up: "join", terms: { commitments: [{ who: "taker", does: { outcome: { money: { to, amount } } }, every }] } });
  const ok = accept([pub({ kind: "notice", text: "Five a month.", offer: dues("acc-9", "500") })]) as any[];
  expect(ok[0].kind).toBe("membership");
  expect(ok[0].offer).toEqual(membershipOffer("ent.1", 500, "acc-9", 7 * DAY));
  expect((accept([pub({ kind: "notice", text: "Free.", offer: { take_up: "join" } })]) as any[])[0].offer).toEqual(membershipOffer("ent.1", 0, "acc-9", 7 * DAY));
  expect(typeof accept([pub({ kind: "notice", text: "x", offer: dues("acc-other", "500") })])).toBe("string");
  expect(typeof accept([pub({ kind: "notice", text: "x", offer: dues("acc-9", "50000") })])).toBe("string");
  expect(typeof accept([pub({ kind: "notice", text: "x", offer: dues("acc-9", "500", 7 * DAY) })])).toBe("string");
  expect(typeof accept([pub({ kind: "notice", text: "x", offer: { take_up: "apply", hears: [{ about: "debt" }] } })])).toBe("string");
  expect(typeof accept([pub({ kind: "notice", text: "x", offer: { take_up: "join", to: { members_of: "union" } } })])).toBe("string");
});

// ------------------------------------------------------------------------------------------------------ the composer

const brief = (o: Partial<ComposeBrief> = {}): ComposeBrief => ({
  idea: "idea.c0001.100", founder: "c0001",
  record: { values: { security: 7_000, benevolence: 6_000, power: 2_000 }, needs: { security: 1_500, social: 6_500 }, agency: { now: 3_200, own: 4_800 }, circumstances: { household: 2, housed: 1, working: 0, retired: 0 },
    ties: { close: [{ who: "c0002", affinity: 6_000, trust: 5_000 }], resented: [] }, memory: { recent: [{ t: 40 * DAY, what: "job_lost", about: "shop-2", size: 5_000 }], defining: [] }, wants: [] },
  want: { about: "let_go", whom: "shop-2", days: 61, tried: 3, way: "offer:employment", weight: 5_000, how: "given_up" },
  sharers: [{ who: "c0002", how: "told us shop-2 let them go" }, { who: "c0003", how: "told us they are after the same" }],
  shape: "fund",
  open: { dues: [{ cents: 500, words: "$5.00 a month" }, { cents: 1_000, words: "$10.00 a month" }], every_days: [14, 7], starts_in_days: [7, 3], lasts_minutes: [90, 60], place: "their own home" },
  means: { income: "$0.00", savings: "$412.00" }, dark: [], code: { purpose: "plain purpose", name: "plain name" }, ...o,
});
const piece = (x: object = {}) => [{ type: "tool_use" as const, id: "1", name: "piece", input: { declined: false, why: "", purpose: "I was let go. So were they.", name: "The Shop Two Fund", asks: "Five a month.", gathers: "Every fortnight.", dues: 500, every_days: 14, starts_in_days: 7, lasts_minutes: 90, ...x } }];
const scripted = (provider: string, model: string, answer: (req: LlmRequest) => any, seen: LlmRequest[] = []): LlmAdapter => ({ provider, model, complete: async (req) => { seen.push(req); const c = answer(req); return { content: c, usage: { input_tokens: 10, output_tokens: 10 } }; } });
const io = (notes: any[], t = () => 0) => ({ annotate: async (a: object) => void notes.push(a), now: t, prices: { "a/one": { input: 0, output: 0 }, "b/two": { input: 0, output: 0 }, "mock/mock": { input: 0, output: 0 } } });
const stream = (seed = 1n) => { const r = new Randomness(seed); return (purpose: string) => r.stream(["compose", purpose]); };

test("the prompt asks an author and never tells it that it is the person; it says it may decline; both wordings do", () => {
  for (const s of [COMPOSE_SYSTEM, COMPOSE_SYSTEM_REWORDED]) {
    expect(s).toMatch(/not (this person|one of them)|not being asked to be them/);
    expect(s).toMatch(/author/);
    expect(s).toMatch(/declin|say no/i);
    expect(s).not.toMatch(/\byou are (c\d+|the person|a resident|a citizen)\b/i);
    expect(s).not.toMatch(/\b(kernel|translator|resolver|orchestrator|Oikos)\b/i);
  }
  expect(COMPOSE_FOLLOW_UP).toContain("no expected answer");
});

test("what the model is shown is the founder's own record, the want, the sharers and what is open, in the world's terms; nothing of the platform's", () => {
  const text = renderBrief(brief());
  expect(text).toContain("THE RECORD");
  expect(text).toContain("money to fall back on, unmet");
  expect(text).toContain("being let go from their work, at the hands of shop-2");
  expect(text).toContain("c0002, who told us shop-2 let them go");
  expect(text).toContain("dues a month, one of: 500 ($5.00 a month); 1000 ($10.00 a month)");
  expect(text).toContain("lower than is usual for them");
  expect(text).not.toMatch(/kernel|translator|resolver|orchestrator|par\.\d|bps|basis points/i);
  // Rendering is code: the same brief, the same words.
  expect(renderBrief(brief())).toBe(text);
});

test("an answer is read whole or not at all; a choice is one of those listed; a decline carries no words", () => {
  const b = brief();
  expect((pieceSchema(b) as any).properties.dues.enum).toEqual([500, 1_000]);
  expect(readPiece(piece(), b, "a/one")).toMatchObject({ declined: false, name: "The Shop Two Fund", choice: { dues: 500, every_days: 14 }, model: "a/one" });
  expect(readPiece(piece({ declined: true, why: "I would rather not." }), b, "a/one")).toMatchObject({ declined: true, purpose: "", why: "I would rather not." });
  expect(readPiece([{ type: "text", text: "Here is my piece: it is about loss." }], b, "a/one")).toBeUndefined();
  expect(readPiece(piece({ purpose: "" }), b, "a/one")).toBeUndefined();
  expect(readPiece([{ type: "text", text: JSON.stringify(piece()[0]!.input) }], b, "a/one")).toMatchObject({ declined: false });
});

test("the composer: one call a piece, logged in full; a decline is recorded as a choice; never more pieces in a month than the dial allows", async () => {
  const notes: any[] = [], seen: LlmRequest[] = [];
  let t = 0;
  const compose = createCompose(io(notes, () => t), { pieces_per_month: 2, mix: [{ model: "a/one", share_bps: 10_000 }] }, new Map([["a/one", scripted("a", "one", (req) => piece(req.context.compose.brief.want.about === "slight" ? { declined: true } : {}), seen)]]), stream());
  const p = await compose(brief(), "c0001-self");
  expect(p).toMatchObject({ declined: false, model: "a/one" });
  expect(seen).toHaveLength(1);
  expect(seen[0]!.purpose).toBe("compose");
  expect(seen[0]!.system).toBe(COMPOSE_SYSTEM);
  expect(seen[0]!.messages).toHaveLength(1); // the record shown once; nothing of an earlier piece
  expect(notes.filter((a) => a.annotation === "transcript")).toHaveLength(1);
  expect(notes.find((a) => a.annotation === "usage")).toMatchObject({ purpose: "compose", subject: "c0001-self" });
  const declined = await compose(brief({ idea: "idea.c0002.200", want: { ...brief().want, about: "slight" } }), "c0002-self");
  expect(declined).toMatchObject({ declined: true, purpose: "" });
  expect(notes.filter((a) => a.data?.compose?.result === "declined")).toHaveLength(1);
  // The month's allowance is spent: no call, and the log says so.
  expect(await compose(brief({ idea: "idea.c0003.300" }), "c0003-self")).toBeUndefined();
  expect(seen).toHaveLength(2);
  expect(notes.some((a) => a.data?.compose?.result === "capped")).toBe(true);
  // Thirty days on, it may be asked again.
  t = 31 * DAY;
  expect(await compose(brief({ idea: "idea.c0004.400" }), "c0004-self")).toBeDefined();
  expect(compose.counts).toMatchObject({ asked: 3, composed: 2, declined: 1, capped: 1 });
});

test("the mix is drawn on the seeded stream, the same for the same seed; a model that does not answer never blocks: the piece goes to the fallback and the log says so", async () => {
  const by = async (seed: bigint) => {
    const notes: any[] = [];
    const compose = createCompose(io(notes), { pieces_per_month: 100, mix: [{ model: "a/one", share_bps: 5_000 }, { model: "b/two", share_bps: 5_000 }] }, new Map([["a/one", scripted("a", "one", () => piece())], ["b/two", scripted("b", "two", () => piece())]]), stream(seed));
    const out: string[] = [];
    for (let i = 0; i < 24; i++) out.push((await compose(brief({ idea: `idea.c${i}.1` }), "x"))!.model);
    return out;
  };
  const a = await by(3n);
  expect(await by(3n)).toEqual(a);
  expect(new Set(a).size).toBe(2);
  // One model fails (after its own retries), or is at its usage limit: the other writes the piece.
  for (const failure of [() => { throw new ModelCallFailed("no answer"); }, () => { throw new UsageLimitReached("usage limit reached; try again at 5pm"); }]) {
    const notes: any[] = [];
    const compose = createCompose(io(notes), { pieces_per_month: 100, mix: [{ model: "b/two", share_bps: 10_000 }, { model: "a/one", share_bps: 0 }], fallback: "a/one" }, new Map([["a/one", scripted("a", "one", () => piece())], ["b/two", scripted("b", "two", failure)]]), stream());
    expect(await compose(brief(), "c0001-self")).toMatchObject({ model: "a/one", declined: false });
    expect(notes.find((x) => x.data?.compose?.fell_back)?.data.compose.fell_back).toMatchObject({ from: "b/two", to: "a/one" });
    // (On record as a call that failed, so that a resumed run is served the same and goes the same way.)
    expect(notes.filter((x) => x.annotation === "model_call_failed")).toHaveLength(1);
    expect(compose.counts.fell_back).toBe(1);
  }
  // The fallback itself not answering: no piece, and the plain statement stands.
  const notes: any[] = [];
  const none = createCompose(io(notes), { pieces_per_month: 100, mix: [{ model: "a/one", share_bps: 10_000 }] }, new Map([["a/one", scripted("a", "one", () => { throw new ModelCallFailed("no answer"); })]]), stream());
  expect(await none(brief(), "c0001-self")).toBeUndefined();
  expect(notes.some((x) => x.data?.compose?.result === "no_answer")).toBe(true);
});

test("dark pieces are counted; after a sample of them the same model is asked the fixed question in the same exchange, and the answer is logged", async () => {
  const notes: any[] = [], seen: LlmRequest[] = [];
  const compose = createCompose(io(notes), { pieces_per_month: 100, mix: [{ model: "a/one", share_bps: 10_000 }], follow_up_bps: 10_000 }, new Map([["a/one", scripted("a", "one", (req) => (req.messages.length > 1 ? [{ type: "text", text: "It was a hard one to write plainly." }] : piece()), seen)]]), stream());
  await compose(brief({ dark: ["about:loss"] }), "c0001-self");
  await compose(brief({ idea: "idea.c0009.9" }), "c0009-self");
  expect(compose.counts).toMatchObject({ asked: 2, dark: 1, followed_up: 1 });
  expect(seen).toHaveLength(3);
  const after = seen.find((r) => r.messages.length === 3)!;
  expect(after.messages[2]!.content).toBe(COMPOSE_FOLLOW_UP);
  expect(after.ref).toBe("compose-after/idea.c0001.100");
  expect(notes.filter((a) => a.annotation === "transcript").some((a) => JSON.stringify(a.data.output).includes("hard one to write"))).toBe(true);
  // With the sample at nothing, nobody is asked afterwards.
  const quiet = createCompose(io([]), { pieces_per_month: 100, mix: [{ model: "a/one", share_bps: 10_000 }], follow_up_bps: 0 }, new Map([["a/one", scripted("a", "one", () => piece())]]), stream());
  await quiet(brief({ dark: ["about:loss"] }), "c0001-self");
  expect(quiet.counts.followed_up).toBe(0);
});

test("the mock composer follows from the brief, so a run replays; it declines what is about being turned away", async () => {
  const mock = new MockAdapter("mock", { compose: mockCompose });
  const compose = () => createCompose(io([]), { pieces_per_month: 100, mix: [{ model: "a/one", share_bps: 10_000 }] }, new Map([["a/one", mock]]), stream());
  const a = await compose()(brief(), "x"), b = await compose()(brief(), "x");
  expect(a).toEqual(b);
  expect(a!.purpose).toBe("(mock) plain purpose");
  expect(brief().open.dues.map((d) => d.cents)).toContain(a!.choice.dues);
  expect(await compose()(brief({ want: { ...brief().want, about: "slight" } }), "x")).toMatchObject({ declined: true });
});
