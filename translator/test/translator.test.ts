import { expect, test } from "bun:test";
import { MockAdapter } from "@terrarium/seats/llm";
import { blockReference, createTranslator, draftHash, lawWarnings } from "../src/index";

const obs = { seat: "mayor", t: 0, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], channels: {} } as any;
const law = { id: "law-planning", record: "statement", author: "genesis", at: 0, visible_to: "public", kind: "law", text: "No building without a permit.",
  adico: { deontic: "must_not" }, formal: { language: "cel", condition: "block.block == 'construct' && !holds_liberty(actor, 'build', block.parcel)" } } as any;
const io = (translator: any) => ({ adapter: new MockAdapter("mock", { translator }), annotate: async () => {}, now: () => 0 });
const ok = async () => ({ ok: true });

test("the block reference is generated from the contract: all 18 blocks", () => {
  const ref = blockReference();
  expect(ref.split("\n").length).toBe(18);
  expect(ref).toContain("- transfer {from, to, amount, settles?, per_instruction?, memo?}: PHYSICAL.");
});

test("law warnings flag a block that a known prohibition's formal condition matches", () => {
  const known = new Map([[law.id, law]]);
  const w = lawWarnings([{ block: "publish", kind: "note", text: "x" }, { block: "construct", parcel: "p1", structure_type: "park", materials_from: "a" }], "city", 0, known);
  expect(w).toEqual(['Block 2 appears to breach law-planning: "No building without a permit."']);
});

test("a draft outside the contract is a translation failure, not a draft", async () => {
  const t = createTranslator(io(() => [{ type: "tool_use", id: "1", name: "draft", input: { blocks: [{ block: "teleport" }], summary: "s" } }]), ok);
  const r = await t.translate({ draftId: "d1", seat: "mayor", entity: "city", proposal: "p", observation: obs, known: new Map() });
  expect(r.ok).toBe(false);
});

test("a good draft carries the kernel check, warnings and a stable hash", async () => {
  const blocks = [{ block: "construct", parcel: "p1", structure_type: "park", materials_from: "acc-city" }];
  const t = createTranslator(io(() => [{ type: "tool_use", id: "1", name: "draft", input: { blocks, summary: "Build a park." } }]), async () => ({ ok: false, refusal: { code: "insufficient_funds" } }));
  const r = await t.translate({ draftId: "d1", seat: "mayor", entity: "city", proposal: "Build a park on p1.", observation: obs, known: new Map([[law.id, law]]) });
  if (!r.ok) throw new Error(r.reason);
  expect(r.draft.check).toEqual({ ok: false, refusal: { code: "insufficient_funds" }, warnings: ['Block 1 appears to breach law-planning: "No building without a permit."'] });
  expect(r.hash).toBe(draftHash(r.draft));
  expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
});
