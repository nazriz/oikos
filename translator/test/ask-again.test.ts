// A draft that fails the form's own checks is never surfaced as if the seat had said the wrong thing (the live check
// of 2026-10-09, finding 7: a trained translator wrote `form(... parks="c0007" ...)` for a budget proposal, and two
// days later the seat read "A note on your request: not an amount: c0007. Please say it another way." It had named no
// such amount, and in the same sitting said it had filed the proposal). The seat is asked for its request again, in
// words that draw only on its own request and the form it can see; nothing of the failed draft is said.

import { expect, test } from "bun:test";
import { MockAdapter } from "@oikos/participants/llm";
import PROFILE from "../../worlds/profiles/de-ni-2026.json";
import { askAgain, createTranslator, Knowledge } from "../src/index";

const form = { id: "form-council-proposal", record: "statement", kind: "form", author: "genesis", at: 0, speaks_for: "city", visible_to: "public", text: "Council proposal.",
  data: { form: "council_proposal", submit_as: "proposal", submit_to: ["city"], fields: { kind: { type: "choice", options: ["law", "budget", "other"], required: true }, proposal: { type: "text", required: true },
    environment: { type: "amount" }, parks: { type: "amount" }, roads: { type: "amount" }, services: { type: "amount" }, staff: { type: "amount" }, notice: { type: "duration" } } } };
function knows(): Knowledge {
  const k = new Knowledge(PROFILE.values.currency as any);
  k.absorb({ t: 0, entity: "city", outcomes: [], inbox: [], drafts: [], positions: [{ position: "mayor", entity: "city", title: "Mayor" }], channels: { forms: { kind: "records", records: [form] } } } as any);
  return k;
}
const ok = async () => ({ ok: true });
/** A translator that answers each attempt with the next of the programs given (the last, from then on). */
function scripted(programs: string[]) {
  let n = 0;
  const seen: string[] = [];
  const adapter = new MockAdapter("mock", { translator: (req: any) => (seen.push(JSON.stringify(req.messages)), [{ type: "tool_use", id: `c${n}`, name: "call", input: { program: programs[Math.min(n++, programs.length - 1)]! } }]) });
  return { io: { adapter, annotate: async () => {}, now: () => 0 }, calls: () => n, seen };
}
const request = "File the year 1 budget proposal: staff 303,335.76 EUR for the six employment agreements, nothing for the other lines yet.";
const wrong = 'form(form=council_proposal, to=city, kind=budget, parks="c0007", proposal="Year 1 budget for staff.")';

test("a figure the draft got wrong, that the seat never wrote, is not put to the seat: it is asked again by the form it can see", async () => {
  const t = scripted([wrong]);
  const r = await createTranslator(t.io, ok, () => undefined).translate({ draftId: "draft.mayor-system.1", participant: "mayor-system", as: "mayor", proposal: request, knowledge: knows() });
  expect(r.ok).toBe(false);
  if (r.ok) return;
  // What the seat reads: nothing of the draft's fault, only its own request's terms and the form's.
  expect(r.notices).toEqual(["It could not be set out on the council proposal form from what you said: the form takes these amounts: environment, parks, roads, services, staff. Please say it again, giving each one you mean as a figure and leaving out any you don't."]);
  expect(r.notices.join(" ")).not.toContain("c0007");
  expect(r.notices.join(" ")).not.toContain("not an amount");
  // It is an asking back, and the fault is on record as the call's: the translator was asked once more first.
  expect(r.asked_back).toBe(true);
  expect(t.calls()).toBe(2);
  expect(r.invalid).toEqual(["the call gave something the request did not: not an amount: c0007. Please say it another way."]);
  expect((r as any).retries).toEqual([{ call: 'form(form=council_proposal, kind=budget, parks="c0007", proposal="Year 1 budget for staff.", to=city)', reason: "the call gave something the request did not: not an amount: c0007. Please say it another way." }]);
  // Asked again, a translator that then gets it right gives a draft, and the seat is told nothing of the first.
  const second = scripted([wrong, 'form(form=council_proposal, to=city, kind=budget, staff="303.335,76 €", proposal="Year 1 budget for staff.")']);
  const good = await createTranslator(second.io, ok, () => undefined).translate({ draftId: "draft.mayor-system.2", participant: "mayor-system", as: "mayor", proposal: request, knowledge: knows() });
  expect(good.ok).toBe(true);
});

test("a figure the seat did write, and that cannot be read, is put to it in its own words", async () => {
  const mine = "File the year 1 budget proposal with staff at about three hundred or so.";
  const t = scripted(['form(form=council_proposal, to=city, kind=budget, staff="about three hundred or so", proposal="Year 1 budget.")']);
  const r = await createTranslator(t.io, ok, () => undefined).translate({ draftId: "draft.mayor-system.1", participant: "mayor-system", as: "mayor", proposal: mine, knowledge: knows() });
  expect(r).toMatchObject({ ok: false, asked_back: true, notices: ['"about three hundred or so", in what you asked, could not be read as an amount. Please say it again with that amount written in figures.'] });
  // (The call is tried once more first: it is the call that put those words where a figure goes, and a second reading
  // may set them right. Only then is the seat asked, about its own words: translator/test/when.test.ts.)
  expect(t.calls()).toBe(2);
});

test("the words for asking again: by what the form takes, or without a form", () => {
  expect(askAgain("a length of time", { name: "amend tenancy", fields: { notice: { type: "duration" }, tenant_notice: { type: "duration" }, affects: { type: "choice" } } }))
    .toBe("It could not be set out on the amend tenancy form from what you said: the form takes these lengths of time: notice, tenant notice. Please say it again, giving each one you mean as a figure and leaving out any you don't.");
  expect(askAgain("an amount")).toBe("It could not be drawn up from what you said: an amount in it could not be made out. Please say it again, with each figure written out.");
});
