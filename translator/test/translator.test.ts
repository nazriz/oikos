import { expect, test } from "bun:test";
import { MockAdapter } from "@oikos/participants/llm";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { createTranslator, draftHash, draftText, lawWarnings, Knowledge, LABEL_TEXT, NOT_CHECKED, NOT_PUT, translatorContext, translatorSystem, unsureText } from "../src/index";

const law = { id: "law-planning", record: "statement", author: "genesis", at: 0, visible_to: "public", kind: "law", text: "No building without a permit.",
  adico: { deontic: "must_not" }, formal: { language: "cel", condition: "block.block == 'construct' && !holds_liberty(actor, 'build', block.lot)" } } as any;
function knows(): Knowledge {
  const k = new Knowledge(PROFILE.values.currency);
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
  expect(lawWarnings([{ block: "construct", at: "cell.0.0", structure_type: "park" }], knows())).toEqual(['This appears to go against law-planning: "No building without a permit."']);
});

test("an unreadable answer, or a question from the resolver, comes back as notices", async () => {
  const bad = await createTranslator(io("pay(to=x)"), ok, () => ({ footprint: { w: 2, h: 1 } })).translate({ draftId: "d1", participant: "mayor-system", as: "mayor", proposal: "p", knowledge: knows() });
  // Not in the call language: the translator's doing, not the wording's, and the participant is told as much. What
  // went wrong is on the failure, for the log.
  expect(bad).toMatchObject({ ok: false, notices: [NOT_PUT], call: "pay(to=x)" });
  expect((bad as any).invalid[0]).toStartWith("not in the call language:");
  const ask = await createTranslator(io("structure(type=park, on=p1)"), ok, () => ({ footprint: { w: 2, h: 1 } })).translate({ draftId: "d1", participant: "mayor-system", as: "mayor", proposal: "Build a park on p1.", knowledge: knows() });
  expect(ask).toMatchObject({ ok: false, notices: ["Who should build a park on p1?"] });
});

test("a draft carries the call, the resolver, a mechanical preview, the dry run and warnings, and a stable hash", async () => {
  const t = createTranslator(io("structure(type=park, on=p1, by=city)"), async () => ({ ok: false, refusal: { code: "insufficient_funds" } }), () => ({ footprint: { w: 2, h: 1 } }));
  const r = await t.translate({ draftId: "d1", participant: "mayor-system", as: "mayor", proposal: "We'll build a park on p1 ourselves.", knowledge: knows() });
  if (!r.ok) throw new Error(r.notices.join(" "));
  expect(r.draft.call).toBe("structure(by=city, on=p1, type=park)");
  expect(r.draft.blocks).toEqual([{ block: "construct", at: "cell.0.0", structure_type: "park" }]);
  expect(r.draft.summary).toBe("You will start building a park with its corner at cell.0.0 yourself.");
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
    .toContain("- council_proposal, to=city, id form-council-proposal: fields proposal (text, required), kind (one of law | budget | other, required), parks (amount)");
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
  expect(r).toMatchObject({ ok: false, notices: ["Who should build a park on p1?"], retries: [{ call: "none(unclear)", reason: "It isn't clear what should happen. Could you say it more plainly?" }] });
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

test("a call put together wrongly, no call at all, and a check that fails are told apart: to the participant, and on record", async () => {
  const req = { draftId: "d1", participant: "mayor-system", as: "mayor", proposal: "p", knowledge: knows() };
  const type = () => ({ footprint: { w: 2, h: 1 } });
  // An argument of the wrong shape (a list of data where ids go): the call is at fault. It's tried again, and the
  // participant never reads the resolver's words about arguments.
  let asked = 0;
  const feedback: string[] = [];
  const wrongShape = { adapter: new MockAdapter("mock", { translator: (r) => {
    if (asked++) feedback.push(JSON.stringify(r.messages.at(-1)));
    return [{ type: "tool_use", id: "1", name: "call", input: { program: 'statement(kind=notice, text="Hello.", visible={"a":1})' } }];
  } }), annotate: async () => {}, now: () => 0 };
  const shaped = await createTranslator(wrongShape, ok, type).translate(req);
  expect(shaped).toMatchObject({ ok: false, notices: [NOT_PUT], invalid: ["visible should be a list of names or ids."] });
  expect(asked).toBe(2);
  expect(feedback[0]).toContain("That didn't work: visible should be a list of names or ids.");
  // No call came back.
  const silent = { adapter: new MockAdapter("mock", { translator: () => [{ type: "text", text: "I'd rather not." }] }), annotate: async () => {}, now: () => 0 };
  expect(await createTranslator(silent, ok, type).translate(req)).toMatchObject({ ok: false, notices: [NOT_PUT], invalid: ["no call came back"] });
  // The acts were worked out and the check of them failed: a fault of the platform's, on record as one; the call is
  // tried once more, and then the seat is told nothing was done and to ask again (never "may not help").
  const failing = async () => ({ ok: false, error: "the engine stopped" });
  const checked = await createTranslator(io('statement(kind=notice, text="Hello.")'), failing, type).translate(req);
  expect(checked).toMatchObject({ ok: false, notices: [NOT_CHECKED], invalid: ["platform fault: the check failed: the engine stopped"] });
  expect((checked as any).retries).toHaveLength(1);
  expect(NOT_CHECKED).not.toContain("may not help");
  // A request that really is unclear still reads as before.
  expect(await createTranslator(io("none(unclear)"), ok, type).translate(req)).toMatchObject({ ok: false, notices: ["It isn't clear what should happen. Could you say it more plainly?"] });
});

test("asked back, a translator may say what was unclear: one of a few fixed sentences, and of a form only what the person's own forms hold", async () => {
  const k = knows();
  k.absorb({ participant: "mayor-system", t: 0, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], channels: {
    forms: { kind: "records", records: [{ id: "form-council-proposal", record: "statement", author: "genesis", at: 0, visible_to: "public", speaks_for: "city", kind: "form", text: "Council proposal.",
      data: { form: "council_proposal", submit_as: "proposal", submit_to: ["city"], fields: { proposal: { type: "text", required: true }, kind: { type: "choice", required: true, options: ["law", "budget", "other"] }, parks: { type: "amount" } } } }] } } } as any);
  const req = { draftId: "d1", participant: "mayor-system", as: "mayor", proposal: "Table it.", knowledge: k };
  const says = (unsure: unknown) => unsureText(unsure, req);
  expect(says({ kind: "which" })).toBe("It isn't clear which one you mean. Name each person, account, record and place by its id.");
  expect(says({ kind: "words" })).toBe("It isn't clear which words are to go as they stand. Put them in quotation marks.");
  expect(says({ kind: "act" })).toBe(LABEL_TEXT.unclear);
  expect(says({ kind: "form_needs", form: "council_proposal", fields: ["proposal", "kind"] })).toBe("The council proposal needs: proposal, kind.");
  expect(says({ kind: "form_option", form: "council_proposal", field: "kind" })).toBe("On the council proposal form, kind is one of: law, budget, other.");
  expect(says({ kind: "form_field", form: "council_proposal", fields: ["staff"] })).toBe("The council proposal form has no such field as was given. Its fields are: proposal, kind, parks.");
  // Nothing is said of a form this person hasn't got, of a field their form doesn't have, or in words of the translator's own.
  expect(says({ kind: "form_needs", form: "secret_levy", fields: ["rate"] })).toBeUndefined();
  expect(says({ kind: "form_needs", form: "council_proposal", fields: ["treasury_code"] })).toBeUndefined();
  expect(says({ kind: "form_option", form: "council_proposal", field: "parks" })).toBeUndefined();
  expect(says({ kind: "note", text: "acc-9 holds 5,000" })).toBeUndefined();
  expect(says("acc-9 holds 5,000")).toBeUndefined();
  // Through the translator: the sentence is what the participant is told, and the translator isn't asked again.
  let asked = 0;
  const adapter = new MockAdapter("mock", { translator: () => { asked++; return [{ type: "tool_use", id: "1", name: "call", input: { program: "none(unclear)", unsure: { kind: "form_needs", form: "council_proposal", fields: ["proposal"] } } }]; } });
  const r = await createTranslator({ adapter, annotate: async () => {}, now: () => 0 }, ok, () => undefined).translate(req);
  expect(r).toMatchObject({ ok: false, notices: ["The council proposal needs: proposal."] });
  expect(asked).toBe(1);
  // What can't be said (a form they haven't got) leaves the plain refusal, asked again as before.
  asked = 0;
  const hidden = new MockAdapter("mock", { translator: () => { asked++; return [{ type: "tool_use", id: "1", name: "call", input: { program: "none(unclear)", unsure: { kind: "form_needs", form: "secret_levy", fields: ["rate"] } } }]; } });
  const plain = await createTranslator({ adapter: hidden, annotate: async () => {}, now: () => 0 }, ok, () => undefined).translate(req);
  expect(plain).toMatchObject({ ok: false, notices: [LABEL_TEXT.unclear] });
  expect(asked).toBe(2);
});
