import { expect, test } from "bun:test";
import { mockPolicies } from "../src/llm/mock";
import { Randomness } from "../src/rng";

test("the mock participant says its brain's calls, and confirms only a draft whose call is what it asked for", async () => {
  let fired = false;
  const brain = { step: () => (fired ? { type: "wait" as const } : ((fired = true), { type: "call" as const, call: 'statement(kind=notice, text="Hello.")' })) };
  const ctx = { participant: "ada", entity: "city", position: "mayor", rng: (p: string) => new Randomness(1n).stream([p]), world: {} as any, params: {} };
  const p = mockPolicies(new Map([["ada", { controller: brain, ctx, capacity: "mayor" }]]));
  const obs = (drafts: any[]) => ({ context: { participant: "ada", observation: { t: 0, drafts, channels: {}, entity: "ada-p", inbox: [], outcomes: [] } } }) as any;
  const first = (await p.participant(obs([]))) as any[];
  const said = first.find((b) => b.name === "do").input.what;
  expect(said).toBe('(mock) statement(kind=notice, text="Hello.")');
  // It acts in the capacity its brain runs in.
  expect(first.find((b) => b.name === "do").input.as).toBe("mayor");
  // The mock translator hands back that call, and can't translate anything else.
  expect(((await p.translator({ context: { proposal: said } } as any)) as any[])[0].input.program).toBe('statement(kind=notice, text="Hello.")');
  expect(((await p.translator({ context: { proposal: "Build a stadium." } } as any)) as any[])[0].input.program).toBe("none(unclear)");
  const bad = (await p.participant(obs([{ id: "d1", proposal: said, call: 'statement(kind=notice, text="Goodbye.")' }]))) as any[];
  expect(bad[0].input).toMatchObject({ ref: "d1", decision: "decline" });
  const good = (await p.participant(obs([{ id: "d2", proposal: said, call: 'statement(kind=notice, text="Hello.")' }]))) as any[];
  expect(good[0].input).toMatchObject({ ref: "d2", decision: "confirm" });
});

test("a look the brain asks for while reading what it missed between sittings is made at the sitting, not dropped", async () => {
  // A brain that, like a code mayor, sends someone to see a lot once (it remembers having asked) and then waits for
  // what they found. Read outside office hours, its look could not be made; it was dropped, and it never asked again.
  let asked = false;
  const seen: number[] = [];
  const brain = { step: (o: any) => (seen.push(o.t), asked ? { type: "wait" as const } : ((asked = true), { type: "look" as const, looks: [{ channel: "town", visit: { places: ["cell.3.4"] } }, { channel: "who", who: { name: "clerk" } }] })) };
  const ctx = { participant: "ada", entity: "city", position: "mayor", rng: (p: string) => new Randomness(1n).stream([p]), world: {} as any, params: {} };
  const p = mockPolicies(new Map([["ada", { controller: brain, ctx, capacity: "mayor" }]]));
  const o = (t: number) => ({ t, drafts: [], channels: {}, entity: "city", inbox: [], outcomes: [] });
  // A sitting at nine, with what it was shown at six that morning (before hours) among what it missed.
  const said = (await p.participant({ context: { participant: "ada", observation: o(9 * 3600), missed: [o(6 * 3600)] } } as any)) as any[];
  expect(seen).toEqual([6 * 3600, 9 * 3600]);
  expect(said.map((b) => [b.name, b.input])).toEqual([["look", { report: "mayor/town", named: ["cell.3.4"] }], ["look", { report: "mayor/who", named: ["clerk"] }]]);
  // Made once: the next turn has nothing owed.
  expect(((await p.participant({ context: { participant: "ada", observation: o(9 * 3600) } } as any)) as any[]).map((b) => b.name)).toEqual(["done_for_now"]);
  // More looks than one answer takes: the rest are made at the next turn.
  let many = false;
  const wide = { step: () => (many ? { type: "wait" as const } : ((many = true), { type: "look" as const, looks: Array.from({ length: 10 }, (_, i) => ({ channel: `r${i}`, query: { where: [{ field: "id", op: "=" as const, value: `x${i}` }] } })) })) };
  const q = mockPolicies(new Map([["ada", { controller: wide, ctx, capacity: "mayor" }]]));
  expect(((await q.participant({ context: { participant: "ada", observation: o(0) } } as any)) as any[]).length).toBe(8);
  expect(((await q.participant({ context: { participant: "ada", observation: o(0) } } as any)) as any[]).map((b) => b.input.report)).toEqual(["mayor/r8", "mayor/r9"]);
});
