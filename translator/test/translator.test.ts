import { expect, test } from "bun:test";
import { MockAdapter } from "@terrarium/participants/llm";
import { createTranslator, draftHash, draftText, lawWarnings, Knowledge, translatorContext, translatorSystem } from "../src/index";

const law = { id: "law-planning", record: "statement", author: "genesis", at: 0, visible_to: "public", kind: "law", text: "No building without a permit.",
  adico: { deontic: "must_not" }, formal: { language: "cel", condition: "block.block == 'construct' && !holds_liberty(actor, 'build', block.lot)" } } as any;
function knows(): Knowledge {
  const k = new Knowledge();
  k.absorb({ participant: "mayor-system", as: "mayor", t: 0, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], channels: {
    a: { kind: "accounts", transactions: [], accounts: [{ account: "acc-city", holder: "city", custodian: "bank", balance: 100 }] },
    land: { kind: "sites", as_of: 0, cells: [{ cell: "cell.0.0", x: 0, y: 0 }, { cell: "cell.1.0", x: 1, y: 0 }] },
    laws: { kind: "records", records: [law, { id: "p1", record: "statement", author: "genesis", at: 0, visible_to: "public", kind: "lot", text: "Lot p1.", data: { cells: ["cell.0.0", "cell.1.0"] } }] } } } as any);
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
  expect(lawWarnings([{ block: "construct", at: "cell.0.0", structure_type: "park", materials_from: "a" }], knows())).toEqual(['This appears to go against law-planning: "No building without a permit."']);
});

test("an unreadable answer, or a question from the resolver, comes back as notices", async () => {
  const bad = await createTranslator(io("pay(to=x)"), ok, () => ({ footprint: { w: 2, h: 1 } })).translate({ draftId: "d1", participant: "mayor-system", as: "mayor", proposal: "p", knowledge: knows() });
  expect(bad).toMatchObject({ ok: false, notices: ["It isn't clear what should happen. Could you say it more plainly?"] });
  const ask = await createTranslator(io("structure(type=park, on=p1)"), ok, () => ({ footprint: { w: 2, h: 1 } })).translate({ draftId: "d1", participant: "mayor-system", as: "mayor", proposal: "Build a park on p1.", knowledge: knows() });
  expect(ask).toMatchObject({ ok: false, notices: ["Who should build a park on p1, and from which account is it paid?"] });
});

test("a draft carries the call, the resolver, a mechanical preview, the dry run and warnings, and a stable hash", async () => {
  const t = createTranslator(io("structure(type=park, on=p1, by=city)"), async () => ({ ok: false, refusal: { code: "insufficient_funds" } }), () => ({ footprint: { w: 2, h: 1 } }));
  const r = await t.translate({ draftId: "d1", participant: "mayor-system", as: "mayor", proposal: "We'll build a park on p1 ourselves.", knowledge: knows() });
  if (!r.ok) throw new Error(r.notices.join(" "));
  expect(r.draft.call).toBe("structure(by=city, on=p1, type=park)");
  expect(r.draft.blocks).toEqual([{ block: "construct", at: "cell.0.0", structure_type: "park", materials_from: "acc-city" }]);
  expect(r.draft.summary).toBe("You will start building a park with its corner at cell.0.0 yourself, paying for materials from your account (acc-city).");
  expect(r.draft.check).toEqual({ ok: false, refusal: { code: "insufficient_funds" }, warnings: ['This appears to go against law-planning: "No building without a permit."'] });
  expect(r.hash).toBe(draftHash(r.draft));
  const text = draftText(r.draft);
  expect(text).toContain("here is exactly what will happen");
  expect(text).toContain("This can't be done right now: the account doesn't have enough money.");
  expect(text).toContain("Legal note:");
});

test("the translator is shown where each form goes (the `to` to write) and a choice field's options", () => {
  const k = knows();
  k.absorb({ participant: "mayor-system", t: 0, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], channels: {
    forms: { kind: "records", records: [{ id: "form-council-proposal", record: "statement", author: "genesis", at: 0, visible_to: "public", speaks_for: "city", kind: "form", text: "Council proposal.",
      data: { form: "council_proposal", submit_as: "proposal", submit_to: ["city"], fields: { proposal: { type: "text", required: true }, kind: { type: "choice", required: true, options: ["law", "budget", "other"] }, parks: { type: "amount" } } } }] } } } as any);
  expect(translatorContext({ draftId: "d1", participant: "mayor-system", proposal: "Table the budget.", knowledge: k }))
    .toContain("- council_proposal, to=city: fields proposal (text, required), kind (one of law | budget | other, required), parks (amount)");
});

test("a request the translator can't turn into a working call is tried once more, with what went wrong", async () => {
  const asked: any[] = [];
  const answers = ["none(unclear)", "structure(type=park, on=p1)", "notice(text=hi)"];
  const scripted = (programs: string[]) => {
    let i = 0;
    return { adapter: new MockAdapter("mock", { translator: (req: any) => { asked.push(req.messages); return [{ type: "tool_use", id: `c${i}`, name: "call", input: { program: programs[i++] } }]; } }), annotate: async () => {}, now: () => 0 };
  };
  // Refused, then a call the resolver has a question about: two attempts, the last one's question comes back, the first is kept.
  const r = await createTranslator(scripted(answers), ok, () => ({ footprint: { w: 2, h: 1 } })).translate({ draftId: "d1", participant: "mayor-system", as: "mayor", proposal: "Build a park on p1.", knowledge: knows() });
  expect(r).toMatchObject({ ok: false, notices: ["Who should build a park on p1, and from which account is it paid?"], retries: [{ call: "none(unclear)", reason: "It isn't clear what should happen. Could you say it more plainly?" }] });
  expect(asked).toHaveLength(2);
  const feedback = asked[1].at(-1).content[0];
  expect(feedback).toMatchObject({ type: "tool_result", tool_use_id: "c0" });
  expect(feedback.content).toContain("That didn't work: It isn't clear what should happen.");
  // A refusal, then a good call: a draft, with the refusal on record.
  asked.length = 0;
  const good = await createTranslator(scripted(["none(too_much)", 'statement(kind=notice, text="The hall opens at nine.")']), ok, () => undefined).translate({ draftId: "d2", participant: "mayor-system", as: "mayor", proposal: "Publish a notice.", knowledge: knows() });
  expect(good.ok).toBe(true);
  expect(good.retries).toHaveLength(1);
  // Only two attempts by default.
  asked.length = 0;
  await createTranslator(scripted(["none(unclear)", "none(unclear)", "none(unclear)"]), ok, () => undefined).translate({ draftId: "d3", participant: "mayor-system", proposal: "?", knowledge: knows() });
  expect(asked).toHaveLength(2);
});
