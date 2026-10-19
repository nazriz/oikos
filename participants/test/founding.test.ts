// Founding and words, piece by piece (docs/behaviour/founding.md): the arithmetic of whether and what shape; what a
// draft of a composed piece may be; what the composing model is shown and how its answer is read; its cap, its mix,
// its fallback, its declines and its follow-up. No world is run here and no model is called.

import { expect, test } from "bun:test";
import { Randomness, type Block, type ComposeBrief } from "../src";
import { COMPOSE_FOLLOW_UP, COMPOSE_SYSTEM, COMPOSE_SYSTEM_REWORDED, createCompose, mockCompose, MockAdapter, ModelCallFailed, pieceSchema, readPiece, renderBrief, UsageLimitReached, type LlmAdapter, type LlmRequest } from "../src/llm";

const DAY = 86_400;

const pub = (x: object): Block => ({ block: "publish", visible_to: "public", ...x }) as unknown as Block;

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
