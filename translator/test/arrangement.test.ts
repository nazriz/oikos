// Two translators as one (translator/src/arrangement.ts; the owner's decision of 2026-10-11): our own trained
// translator answers first, and the prompt-driven one behind it takes what the first fails. Each reason a request goes
// behind; the refusal that stands; a seat's declining; "beside"; that nothing a seat is told says which answered; and
// that a failure of the one behind is never covered by the first.

import { expect, test } from "bun:test";
import { MockAdapter, ModelCallFailed, UsageLimitReached, type LlmAdapter } from "@oikos/participants/llm";
import PROFILE from "../../worlds/profiles/de-ni-2026.json";
import { createArrangement, createTranslator, draftText, Knowledge, NOT_CHECKED, type Arranged, type TranslateRequest } from "../src/index";
import { muchTheSame } from "../src/arrangement";

const form = { id: "form-council-proposal", record: "statement", kind: "form", author: "genesis", at: 0, speaks_for: "city", visible_to: "public", text: "Council proposal.",
  data: { form: "council_proposal", submit_as: "proposal", submit_to: ["city"], fields: { kind: { type: "choice", options: ["law", "budget", "other"], required: true }, proposal: { type: "text", required: true }, staff: { type: "amount" }, parks: { type: "amount" } } } };
function knows(): Knowledge {
  const k = new Knowledge(PROFILE.values.currency as any);
  k.absorb({ participant: "mayor-system", as: "mayor", t: 0, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], positions: [{ position: "mayor", entity: "city", title: "Mayor" }], channels: {
    a: { kind: "accounts", transactions: [], accounts: [{ account: "acc-city", holder: "city", custodian: "bank", balance: 100000 }] }, forms: { kind: "records", records: [form] } } } as any);
  return k;
}

/** What the first says for a request: a program, and what our own model's adapter says with it. */
type Said = { program: string; sure_ppm?: number; ms?: number; withheld?: string; wrote?: string; unsure?: object; trial?: string[] } | Error;
/** The two as one, each answering by the request's own words; every model call is counted, and every annotation kept. */
function two(first: (request: string) => Said, behind: (request: string) => string | Error, o: { arrangement?: "then" | "beside"; check?: () => Promise<{ ok: boolean; error?: string }>; probation?: { probationOutcome(form: string, agree: boolean): void } } = {}) {
  const calls = { first: [] as string[], behind: [] as string[] };
  const notes: any[] = [];
  const asked = (req: any) => String(req.context.proposal);
  const a1: LlmAdapter = { provider: "decide", model: "ours", complete: async (req) => {
    calls.first.push(asked(req));
    const s = first(asked(req));
    if (s instanceof Error) throw s;
    return { content: [{ type: "tool_use", id: "decide", name: "call", input: { sure_ppm: 990_000, ms: 70, ...s } }], usage: { input_tokens: 0, output_tokens: 0 }, estimated: true };
  } };
  const a2 = new MockAdapter("prompted", { translator: (req: any) => {
    calls.behind.push(asked(req));
    const s = behind(asked(req));
    if (s instanceof Error) throw s;
    return [{ type: "tool_use", id: "c", name: "call", input: { program: s } }];
  } });
  const io = (adapter: LlmAdapter) => ({ adapter, annotate: async (x: object) => void notes.push(x), now: () => 0, prices: { "decide/ours": { input: 0, output: 0 }, "mock/prompted": { input: 0, output: 0 } } as any });
  const check = o.check ?? (async () => ({ ok: true }));
  const t = createArrangement(createTranslator(io(a1), check, () => undefined, "translator", 1), createTranslator(io(a2), check, () => undefined), { arrangement: o.arrangement ?? "then", ...(o.probation ? { probation: o.probation } : {}) });
  let n = 0;
  const ask = (proposal: string, who = "mayor-system"): Promise<Arranged> => t.translate({ draftId: `draft.${who}.${++n}`, participant: who, as: "mayor", proposal, knowledge: knows() } as TranslateRequest);
  return { t, ask, calls, notes };
}

const PAY = 'money(to=acc-9, amount="500", from=acc-city)';
const LETTER = 'message(to=city, text="send me the minutes")';
/** Everything a seat could read of a translation: the draft as it is shown, or what it is told. */
const shown = (r: Arranged): string => (r.ok ? draftText(r.draft) : r.notices.join(" "));

test("the first's draft is offered, and the one behind is not asked", async () => {
  const x = two(() => ({ program: PAY }), () => LETTER);
  const r = await x.ask("Pay acc-9 500 from acc-city.");
  expect(r.ok).toBe(true);
  expect(x.calls).toEqual({ first: ["Pay acc-9 500 from acc-city."], behind: [] });
  expect(r.route).toMatchObject({ arrangement: "then", used: "first", first: { model: "decide/ours", result: "draft", sure_ppm: 990_000, ms: 70 } });
  expect(r.route.behind).toBeUndefined();
  expect(r.route.why).toBeUndefined();
  if (r.ok) expect(r.draft.translator.model).toBe("decide/ours");
});

test("no draft from the first, for each reason, goes behind; what the first said is on record", async () => {
  const cases: [string, Said, string, object][] = [
    // (Its own cut-off: under it the adapter says none(unclear) and why.)
    ["unsure", { program: "none(unclear)", sure_ppm: 40_000, withheld: "cut_off", wrote: PAY, unsure: { kind: "which" } }, "unsure", { result: "asked_back", sure_ppm: 40_000, withheld: "cut_off", wrote: PAY }],
    ["a form that is not the form shown", { program: "none(unclear)", withheld: "form_check", wrote: 'form(form=council_proposal, to=city, roads="4")', unsure: { kind: "form_field", form: "council_proposal", fields: ["roads"] } }, "form_check", { withheld: "form_check" }],
    ["steps that make no program", { program: "none(unclear)", withheld: "no_program" }, "no_program", { withheld: "no_program" }],
    ["not in the call language", { program: "pay(everyone" }, "no_program", { result: "failed" }],
    ["a refusal that does not stand", { program: "none(look_first)" }, "refused", { result: "refusal", label: "look_first" }],
    ["another", { program: "none(no_such_act)" }, "refused", { result: "refusal", label: "no_such_act" }],
    ["unclear, sure of it", { program: "none(unclear)" }, "refused", { result: "refusal", label: "unclear" }],
    ["a value the resolver cannot read", { program: 'money(to=acc-9, amount="a fair sum", from=acc-city)' }, "not_resolved", { result: "asked_back" }],
    ["its model did not answer", new Error("the process ended"), "first_failed", { result: "failed" }],
  ];
  for (const [name, said, why, first] of cases) {
    const x = two(() => said, () => PAY);
    const r = await x.ask(`Pay acc-9 500 from acc-city (${name}).`);
    expect([name, r.ok]).toEqual([name, true]);
    expect([name, r.route.why]).toEqual([name, why]);
    expect(r.route).toMatchObject({ used: "behind", first: { model: "decide/ours", ...first }, behind: { model: "mock/prompted", result: "draft" } });
    expect([name, x.calls.first.length, x.calls.behind.length]).toEqual([name, 1, 1]);
    if (r.ok) expect(r.draft.translator.model).toBe("mock/prompted");
  }
});

test("the check of the first's acts failing sends the request behind", async () => {
  let n = 0;
  const x = two(() => ({ program: PAY }), () => PAY, { check: async () => (n++ === 0 ? { ok: false, error: "the blocks could not be read" } : { ok: true }) });
  const r = await x.ask("Pay acc-9 500 from acc-city.");
  expect(r.route).toMatchObject({ used: "behind", why: "check_failed", first: { result: "failed" } });
  expect(shown(r)).not.toContain(NOT_CHECKED);
});

test("not_an_act, where the first is sure, stands: the seat is told and the one behind is not asked; under the cut-off it goes behind", async () => {
  const x = two(() => ({ program: "none(not_an_act)" }), () => PAY);
  const r = await x.ask("Show me the ledger of acc-city.");
  expect(r.ok).toBe(false);
  expect(x.calls.behind).toEqual([]);
  expect(r.route).toMatchObject({ used: "first", first: { result: "refusal", label: "not_an_act" } });
  // (Unsure: its adapter says none(unclear) in place of what the model wrote, and the request goes behind.)
  const y = two(() => ({ program: "none(unclear)", sure_ppm: 60_000, withheld: "cut_off", wrote: "none(not_an_act)" }), () => "none(not_an_act)");
  const s = await y.ask("Show me the ledger of acc-city.");
  expect(s.route).toMatchObject({ used: "behind", why: "unsure", behind: { result: "refusal", label: "not_an_act" } });
});

test("a seat that declines the first's draft has its next request go behind; a confirmed draft ends the matter", async () => {
  const x = two(() => ({ program: PAY }), () => LETTER);
  const a = await x.ask("Pay acc-9 500 from acc-city.");
  expect(a.route.used).toBe("first");
  x.t.signed("draft.mayor-system.1", "reject");
  // (Whatever it asks next: said again in other words, the first would give the same draft.)
  const b = await x.ask("Write to the clerk: send me the minutes.");
  expect(b.route).toMatchObject({ used: "behind", why: "declined_before", first: { result: "draft" }, behind: { result: "draft" }, agree: false });
  expect(x.calls.first.length).toBe(2); // (the first is asked all the same: what it would have said is on record)
  // It declines that too, and asks again: the matter stays behind.
  x.t.signed("draft.mayor-system.2", "reject");
  expect((await x.ask("Write to the clerk, please: send me the minutes.")).route).toMatchObject({ used: "behind", why: "declined_before" });
  // It confirms: the matter is through, and its next request is the first's again.
  x.t.signed("draft.mayor-system.3", "accept");
  expect((await x.ask("Pay acc-9 500 from acc-city.")).route.used).toBe("first");
  // Another seat's requests were never touched by any of it.
  const y = two(() => ({ program: PAY }), () => LETTER);
  await y.ask("Pay acc-9 500 from acc-city.", "mayor-system");
  y.t.signed("draft.mayor-system.1", "reject");
  expect((await y.ask("Pay acc-9 500 from acc-city.", "finance-system")).route.used).toBe("first");
});

test("declining a draft of the one behind sends nothing behind by itself", async () => {
  const x = two((q) => (q.startsWith("Pay") ? { program: "none(look_first)" } : { program: LETTER }), () => PAY);
  expect((await x.ask("Pay acc-9 500 from acc-city.")).route).toMatchObject({ used: "behind", why: "refused" });
  x.t.signed("draft.mayor-system.1", "reject");
  expect((await x.ask("Write to the clerk: send me the minutes.")).route.used).toBe("first");
});

test("a refusal that stood, asked again in much the same words, goes behind; something else does not", async () => {
  const x = two((q) => (q.includes("ledger") ? { program: "none(not_an_act)" } : { program: PAY }), () => LETTER);
  expect((await x.ask("Show me the ledger of acc-city for the month.")).route.used).toBe("first");
  expect((await x.ask("Pay acc-9 500 from acc-city.")).route.used).toBe("first");
  x.t.signed("draft.mayor-system.2", "reject");
  x.t.signed("draft.mayor-system.2", "reject"); // (answered once: a second answer changes nothing)
  const y = two(() => ({ program: "none(not_an_act)" }), () => LETTER);
  await y.ask("Show me the ledger of acc-city for the month.");
  const again = await y.ask("Please show me the ledger of acc-city for the month.");
  expect(again.route).toMatchObject({ used: "behind", why: "asked_again", first: { result: "refusal", label: "not_an_act" }, behind: { result: "draft" }, agree: false });
  expect(muchTheSame("Pay acc-9 500 from acc-city.", "Pay acc-9 500 from acc-city, now.")).toBe(true);
  expect(muchTheSame("Pay acc-9 500 from acc-city.", "Write to the clerk about the minutes.")).toBe(false);
});

test("beside: the first's answer is only recorded, and the one behind answers everything", async () => {
  const x = two(() => ({ program: PAY }), (q) => (q.includes("ledger") ? "none(not_an_act)" : 'money(to=acc-9, amount="500.00", from=acc-city)'), { arrangement: "beside" });
  const r = await x.ask("Pay acc-9 500 from acc-city.");
  expect(r.route).toMatchObject({ arrangement: "beside", used: "behind", why: "beside", first: { result: "draft", call: 'money(amount="500", from=acc-city, to=acc-9)' }, behind: { result: "draft" }, agree: true, agree_text: true });
  if (r.ok) expect(r.draft.translator.model).toBe("mock/prompted");
  expect(x.t.id.model).toBe("mock/prompted");
  const s = await x.ask("Show me the ledger.");
  expect(s.route).toMatchObject({ used: "behind", first: { result: "draft" }, behind: { result: "refusal", label: "not_an_act" }, agree: false });
  expect(x.calls.first.length).toBe(2);
  // (Declining changes nothing under beside: there is nowhere else for a request to go.)
  x.t.signed("draft.mayor-system.1", "reject");
  expect((await x.ask("Pay acc-9 500 from acc-city.")).route.why).toBe("beside");
});

test("where both answered, agreement is by meaning: free text apart is agreement, another act or label is not", async () => {
  const one = two(() => ({ program: "none(look_first)" }), () => "none(look_first)");
  expect((await one.ask("Cancel any standing payment to acc-9.")).route).toMatchObject({ agree: true });
  const other = two(() => ({ program: "none(look_first)" }), () => "none(no_such_act)");
  expect((await other.ask("Cancel any standing payment to acc-9.")).route).toMatchObject({ agree: false });
  const text = two(() => ({ program: 'message(to=city, text="send me the minutes by Friday")' }), () => LETTER, { arrangement: "beside" });
  expect((await text.ask("Ask the city to send me the minutes by Friday.")).route).toMatchObject({ agree: true, agree_text: false });
});

test("nothing a seat is shown or told says which translator answered, or that there are two", async () => {
  const said: string[] = [];
  const x = two((q) => (q.includes("ledger") ? { program: "none(not_an_act)" } : q.includes("standing") ? { program: "none(look_first)" } : q.includes("unsure") ? { program: "none(unclear)", sure_ppm: 10_000, withheld: "cut_off", unsure: { kind: "which" } } : { program: PAY }),
    (q) => (q.includes("standing") ? "none(look_first)" : q.includes("unsure") ? "none(unclear)" : LETTER));
  for (const q of ["Pay acc-9 500 from acc-city.", "Show me the ledger.", "Cancel any standing payment to acc-9.", "Pay them (unsure).", "Write to the clerk: send me the minutes."]) said.push(shown(await x.ask(q)));
  const y = two(() => ({ program: PAY }), () => LETTER, { arrangement: "beside" });
  said.push(shown(await y.ask("Write to the clerk: send me the minutes.")));
  expect(said.length).toBe(6);
  for (const s of said) expect(s).not.toMatch(/decide|ours|prompted|mock|model|translator|behind|first translator|sure_ppm|arrangement/i);
  // (And the same request reads the same whoever drew it up: the draft's words come from its acts alone.)
  const a = await two(() => ({ program: PAY }), () => PAY).ask("Pay acc-9 500 from acc-city.");
  const b = await two(() => ({ program: "none(unclear)", withheld: "cut_off" }), () => PAY).ask("Pay acc-9 500 from acc-city.");
  expect(a.route.used).toBe("first");
  expect(b.route.used).toBe("behind");
  expect(shown(a)).toBe(shown(b));
});

test("when the one behind is at a usage limit or does not answer, the error is the run's: the first is no substitute", async () => {
  const limit = two(() => ({ program: "none(look_first)" }), () => new UsageLimitReached("the Claude plan's limit for claude -p was reached"));
  await expect(limit.ask("Cancel any standing payment to acc-9.")).rejects.toBeInstanceOf(UsageLimitReached);
  const down = two(() => ({ program: "none(look_first)" }), () => new Error("no answer"));
  await expect(down.ask("Cancel any standing payment to acc-9.")).rejects.toBeInstanceOf(ModelCallFailed);
  // (Under beside too, though the first had a draft.)
  const beside = two(() => ({ program: PAY }), () => new UsageLimitReached("limit"), { arrangement: "beside" });
  await expect(beside.ask("Pay acc-9 500 from acc-city.")).rejects.toBeInstanceOf(UsageLimitReached);
});

test("every model call of both is on record with its model: usage and transcript, the first's at no cost with its sureness and time", async () => {
  const x = two(() => ({ program: "none(look_first)", sure_ppm: 730_000, ms: 64 }), () => PAY);
  await x.ask("Cancel any standing payment to acc-9.");
  const usage = x.notes.filter((n) => n.annotation === "usage").map((n) => [`${n.provider}/${n.model}`, n.purpose, n.cost_microusd]);
  expect(usage).toEqual([["decide/ours", "translator", 0], ["mock/prompted", "translator", 0]]);
  const scripts = x.notes.filter((n) => n.annotation === "transcript");
  expect(scripts.map((n) => [n.data.provider, n.data.ref])).toEqual([["decide", "draft.mayor-system.1"], ["mock", "draft.mayor-system.1"]]);
  expect(scripts[0].data.output[0].input).toEqual({ sure_ppm: 730_000, ms: 64, program: "none(look_first)" });
});

test("a draft the first made on fewer forms than the asker knows of, or on a form outside its training, is recorded and never offered: the one behind drafts, and the two are compared", async () => {
  // Shown a subset: its draft is the same as the one behind's. The world gets the one behind's; the route says both.
  const subset = two(() => ({ program: "none(unclear)", withheld: "forms_subset", wrote: PAY, forms_shown: ["form-council-proposal"], forms_of: 25 }) as Said, () => PAY);
  const r = await subset.ask("Pay acc-9 500 from acc-city.");
  expect(r.ok).toBe(true);
  expect(subset.calls).toEqual({ first: ["Pay acc-9 500 from acc-city."], behind: ["Pay acc-9 500 from acc-city."] });
  expect(r.route).toMatchObject({ used: "behind", why: "forms_subset", agree: true, first: { withheld: "forms_subset", wrote: PAY, forms_shown: ["form-council-proposal"], forms_of: 25 }, behind: { result: "draft", model: "mock/prompted" } });
  if (r.ok) expect(r.draft.translator.model).toBe("mock/prompted");
  // A form it was never trained on, and a draft that differs from the one behind's: recorded as a disagreement.
  const FORM = 'form(form=council_proposal, to=city, kind=law, proposal="A park.")';
  const unseen = two(() => ({ program: "none(unclear)", withheld: "form_unseen", wrote: 'form(form=council_proposal, to=city, kind=budget, proposal="A park.")' }), () => FORM);
  const s = await unseen.ask('Put a proposal to the council, a law: "A park."');
  expect(s.route).toMatchObject({ used: "behind", why: "form_unseen", agree: false, first: { withheld: "form_unseen" }, behind: { result: "draft" } });
  // Nothing a seat reads says any of it.
  expect(shown(r)).not.toMatch(/subset|unseen|forms shown/i);
});

test("a form in its trial goes behind; a confirmed draft behind counts for the trial, by whether ours agreed", async () => {
  const told: [string, boolean][] = [];
  const probation = { probationOutcome: (form: string, agree: boolean) => void told.push([form, agree]) };
  const x = two((r) => ({ program: "none(unclear)", withheld: r.includes("other") ? "type_unreleased" : "probation", wrote: PAY, trial: ["council_proposal"] }), (r) => (r.includes("differ") ? LETTER : PAY), { probation });
  const r = await x.ask("Pay acc-9 500 from acc-city.");
  expect(r.ok).toBe(true);
  expect(r.route).toMatchObject({ used: "behind", why: "probation", agree: true, first: { withheld: "probation", wrote: PAY, trial: ["council_proposal"] } });
  // (Declined: nothing counts. Confirmed: the trial is told, once.)
  if (r.ok) x.t.signed(r.draft.id, "accept");
  expect(told).toEqual([["council_proposal", true]]);
  const d = await x.ask("Pay acc-9 500 from acc-city, but differ.", "other-seat");
  expect(d.route).toMatchObject({ why: "probation", agree: false });
  if (d.ok) x.t.signed(d.draft.id, "reject");
  expect(told).toEqual([["council_proposal", true]]);
  const e = await x.ask("Pay acc-9 500 from acc-city, differ again.", "third-seat");
  if (e.ok) x.t.signed(e.draft.id, "accept");
  expect(told).toEqual([["council_proposal", true], ["council_proposal", false]]);
  // A kind not released goes behind too, and is no trial.
  const u = await x.ask("Pay acc-9 500 from acc-city, other.", "fourth-seat");
  expect(u.route).toMatchObject({ why: "type_unreleased" });
  if (u.ok) x.t.signed(u.draft.id, "accept");
  expect(told.length).toBe(2);
});
