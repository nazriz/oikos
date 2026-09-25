import { expect, test } from "bun:test";
import { mockPolicies } from "../src/llm/mock";
import { Randomness } from "../src/rng";

test("the mock seat proposes its brain's acts in words, and signs only a faithful draft", async () => {
  const blocks = [{ block: "publish", kind: "notice", text: "Hello." }];
  let fired = false;
  const brain = { step: () => (fired ? { type: "wait" as const } : ((fired = true), { type: "act" as const, blocks })) };
  const ctx = { seat: "mayor", entity: "city", rng: (p: string) => new Randomness(1n).stream([p]), world: {} as any, params: {} };
  const p = mockPolicies(new Map([["mayor", { controller: brain, ctx }]]));
  const obs = (drafts: any[]) => ({ context: { seat: "mayor", observation: { t: 0, drafts } } }) as any;
  const first = (await p.seat(obs([]))) as any[];
  const propose = first.find((b) => b.name === "propose");
  expect(propose.input.text).toBe('Please do the following:\n1. Publish a notice: "Hello.".');
  // The mock translator drafts exactly what was asked, once.
  const drafted = (await p.translator({ context: { proposal: propose.input.text } } as any)) as any[];
  expect(drafted[0].input.blocks).toEqual(blocks);
  expect(((await p.translator({ context: { proposal: propose.input.text } } as any)) as any[])[0].name).toBe("cannot_draft");
  // A draft that differs from what was asked is rejected; the faithful one accepted.
  const bad = (await p.seat(obs([{ id: "d1", proposal: propose.input.text, blocks: [{ ...blocks[0], text: "Goodbye." }] }]))) as any[];
  expect(bad[0].input).toMatchObject({ draft: "d1", decision: "reject" });
  const good = (await p.seat(obs([{ id: "d2", proposal: propose.input.text, blocks }]))) as any[];
  expect(good[0].input).toMatchObject({ draft: "d2", decision: "accept" });
});
