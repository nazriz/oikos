import { expect, test } from "bun:test";
import { mockPolicies } from "../src/llm/mock";
import { Randomness } from "../src/rng";

test("the mock seat says its brain's calls, and confirms only a draft whose call is what it asked for", async () => {
  let fired = false;
  const brain = { step: () => (fired ? { type: "wait" as const } : ((fired = true), { type: "call" as const, call: 'statement(kind=notice, text="Hello.")' })) };
  const ctx = { seat: "mayor", entity: "city", rng: (p: string) => new Randomness(1n).stream([p]), world: {} as any, params: {} };
  const p = mockPolicies(new Map([["mayor", { controller: brain, ctx }]]));
  const obs = (drafts: any[]) => ({ context: { seat: "mayor", observation: { t: 0, drafts } } }) as any;
  const first = (await p.seat(obs([]))) as any[];
  const said = first.find((b) => b.name === "do").input.what;
  expect(said).toBe('(mock) statement(kind=notice, text="Hello.")');
  // The mock translator hands back that call, and can't translate anything else.
  expect(((await p.translator({ context: { proposal: said } } as any)) as any[])[0].input.program).toBe('statement(kind=notice, text="Hello.")');
  expect(((await p.translator({ context: { proposal: "Build a stadium." } } as any)) as any[])[0].input.program).toBe("none(unclear)");
  const bad = (await p.seat(obs([{ id: "d1", proposal: said, call: 'statement(kind=notice, text="Goodbye.")' }]))) as any[];
  expect(bad[0].input).toMatchObject({ ref: "d1", decision: "decline" });
  const good = (await p.seat(obs([{ id: "d2", proposal: said, call: 'statement(kind=notice, text="Hello.")' }]))) as any[];
  expect(good[0].input).toMatchObject({ ref: "d2", decision: "confirm" });
});
