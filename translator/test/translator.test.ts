import { expect, test } from "bun:test";
import { MockAdapter } from "@terrarium/seats/llm";
import { createTranslator, draftHash, draftText, lawWarnings, Knowledge, translatorSystem } from "../src/index";

const law = { id: "law-planning", record: "statement", author: "genesis", at: 0, visible_to: "public", kind: "law", text: "No building without a permit.",
  adico: { deontic: "must_not" }, formal: { language: "cel", condition: "block.block == 'construct' && !holds_liberty(actor, 'build', block.parcel)" } } as any;
function knows(): Knowledge {
  const k = new Knowledge();
  k.absorb({ seat: "mayor", t: 0, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], channels: {
    a: { kind: "accounts", transactions: [], accounts: [{ account: "acc-city", holder: "city", custodian: "bank", balance: 100 }] },
    laws: { kind: "records", records: [law] } } } as any);
  return k;
}
const io = (program: string) => ({ adapter: new MockAdapter("mock", { translator: () => [{ type: "tool_use", id: "1", name: "call", input: { program } }] }), annotate: async () => {}, now: () => 0 });
const ok = async () => ({ ok: true });

test("the translator is told the call language and nothing about any world", () => {
  const s = translatorSystem();
  expect(s).toContain("money");
  expect(s).toContain("none(");
  // How any world works (who keeps money, what a bank wants) is the resolver's and the world's business.
  for (const worldly of ["bank", "instruction", "custod"]) expect(s.toLowerCase()).not.toContain(worldly);
});

test("law warnings flag an act that a known prohibition's formal condition matches", () => {
  expect(lawWarnings([{ block: "construct", parcel: "p1", structure_type: "park", materials_from: "a" }], knows())).toEqual(['This appears to go against law-planning: "No building without a permit."']);
});

test("an unreadable answer, or a question from the resolver, comes back as notices", async () => {
  const bad = await createTranslator(io("pay(to=x)"), ok, () => ({})).translate({ draftId: "d1", seat: "mayor", proposal: "p", knowledge: knows() });
  expect(bad).toMatchObject({ ok: false, notices: ["It isn't clear what should happen. Could you say it more plainly?"] });
  const ask = await createTranslator(io("structure(type=park, on=p1)"), ok, () => ({})).translate({ draftId: "d1", seat: "mayor", proposal: "Build a park on p1.", knowledge: knows() });
  expect(ask).toMatchObject({ ok: false, notices: ["Who should build a park on p1, and from which account is it paid?"] });
});

test("a draft carries the call, the resolver, a mechanical preview, the dry run and warnings, and a stable hash", async () => {
  const t = createTranslator(io("structure(type=park, on=p1, by=city)"), async () => ({ ok: false, refusal: { code: "insufficient_funds" } }), () => ({}));
  const r = await t.translate({ draftId: "d1", seat: "mayor", proposal: "We'll build a park on p1 ourselves.", knowledge: knows() });
  if (!r.ok) throw new Error(r.notices.join(" "));
  expect(r.draft.call).toBe("structure(by=city, on=p1, type=park)");
  expect(r.draft.summary).toBe("You will start building a park on lot p1 yourself, paying for materials from your account (acc-city).");
  expect(r.draft.check).toEqual({ ok: false, refusal: { code: "insufficient_funds" }, warnings: ['This appears to go against law-planning: "No building without a permit."'] });
  expect(r.hash).toBe(draftHash(r.draft));
  const text = draftText(r.draft);
  expect(text).toContain("here is exactly what will happen");
  expect(text).toContain("This can't be done right now: the account doesn't have enough money.");
  expect(text).toContain("Legal note:");
});
