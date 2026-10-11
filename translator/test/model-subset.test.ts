// More forms than a trained reader takes (translator/model/subset.ts; docs/real-models.md, "More forms than the
// reader takes"): which are shown, by a stated rule; what the route records; when no draft is offered.
import { expect, test } from "bun:test";
import { DecideAdapter } from "../model/adapter";
import { namedAmong, overlap, partsOf, ranked, taken, wordsOf, type FormFacts } from "../model/subset";

const town = [
  "- works_collection, to=works, id form-works-collection: fields every (duration, required)",
  "- council_proposal, to=city, id form-council-proposal: fields kind (one of law | budget | other, required), proposal (text, required)",
  "- permit_application, to=city, id form-permit: fields lot (lot, required), notes (text), structure_type (structure_type, required)",
];
const office = [
  "- rental_listing, to=landlord-1-office, id form-landlord-1-office-rental-listing: fields account (account, required), rent (amount, required), space (space, required)",
  "- rent_reminder, to=landlord-1-office, id form-landlord-1-office-rent-reminder: fields account (account), amount (amount, required), lease (record, required), tenant (entity, required)",
  "- notice_to_vacate, to=landlord-1-office, id form-landlord-1-office-notice-to-vacate: fields arrears (amount, required), by (date, required), lease (record, required), tenant (entity, required)",
];
const facts: FormFacts[] = [...town.map((line) => ({ line, own: false, about: "" })), ...office.map((line, i) => ({ line, own: true, about: ["Lists a home to let.", "Asks a tenant in writing for rent that is owed.", "Tells a tenant behind with the rent to leave by a date."][i]! }))];

test("a form's parts are read off its line; a request's words leave out what every form shares", () => {
  expect(partsOf(office[1]!)).toEqual({ name: "rent_reminder", id: "form-landlord-1-office-rent-reminder", fields: ["account", "amount", "lease", "tenant"] });
  expect([...wordsOf("Fill in the rent reminder form for c0701, KSh 14,000.00 owed under lease-c0701.")]).toEqual(["rent", "reminder", "c0701", "owed", "under", "lease"]);
  expect(overlap(wordsOf("send a rent reminder to the tenant"), facts[4]!)).toBe(5); // rent, reminder (the name's, twice each), tenant (a field)
});

test("the office's own forms come before the town's, then the forms that share the request's words, then as they came", () => {
  const order = ranked("Give c0701 notice to vacate by day 77 for arrears of KSh 28,000.00 under lease-c0701.", facts);
  expect(order).toEqual([5, 4, 3, 0, 1, 2]); // own: the notice (most words), the reminder (lease), the listing; then the town's, as they came
  expect(taken(order, 4)).toEqual([0, 3, 4, 5]); // shown in the order they came in
  // (The same request gives the same order: nothing is drawn.)
  expect(ranked("Give c0701 notice to vacate by day 77 for arrears of KSh 28,000.00 under lease-c0701.", facts)).toEqual(order);
  // With nothing said of whose a form is, the request's words alone order them.
  expect(ranked("Put a proposal to the council: a law.", facts.map(({ line }) => ({ line })))[0]).toBe(1);
});

test("a request that names a form by its name or its record's id, where that form was not shown", () => {
  expect(namedAmong("Fill in the council proposal form: kind law.", facts, [1, 2])).toEqual(["form-council-proposal"]);
  expect(namedAmong("Fill in form-permit for lot-01-01.", facts, [1, 2])).toEqual(["form-permit"]);
  expect(namedAmong("Pay the council what the proposal said.", facts, [1, 2])).toEqual([]);
});

test("the adapter shows as many forms as the reader takes, says which on its answer, and offers no draft for a form it was not shown", async () => {
  const a = new DecideAdapter("none", { first: true });
  (a as any).reader = { most: 100 };
  const asked: string[][] = [];
  // (A reader that takes 100 of its tokens: here, a form's line is 30 and the request 10.)
  let wants = "rent_reminder";
  (a as any).ask = async (o: { pieces: string[]; at: [number, number][]; breaks: number[] }) => {
    const lines = o.breaks.length; // the request, then a line a form
    asked.push([String(lines)]);
    const read = 10 + 30 * Math.max(0, lines);
    if (read > 100) return { steps: ["none:unclear", "eos"], sure: 1, ms: 0, too_long: true, read };
    // (The form's name on its line, as a run of pieces: the first piece of a line is its dash.)
    let span: [number, number] | undefined;
    for (let i = 1; i < o.pieces.length && !span; i++) for (let j = i; j < i + 4 && j < o.pieces.length; j++) if (o.pieces[i - 1] === "-" && o.pieces.slice(i, j + 1).join("") === wants) span = [i, j];
    return { steps: !span ? ["none:unclear", "eos"] : ["fn:form", "arg:form", ["id", ...span], ")", "eos"], sure: 0.9, ms: 5, read };
  };
  const content = (request: string) => `Request: ${request}\n\nForms this person knows of:\n${facts.map((f) => f.line).join("\n")}`;
  const ask = async (request: string) => (await a.complete({ purpose: "translator", subject: "translator", ref: "draft.landlord-1-office-system.1", system: "", maxTokens: 10, messages: [{ role: "user", content: content(request) }], context: { forms: facts.map(({ own, about }) => ({ own, about })) } })).content[0] as any;
  const r = await ask("Fill in the rent reminder for c0701.");
  // Six forms are 190: it was asked with six, five, four and three, and three fit (the office's own).
  expect(asked.map((x) => x[0])).toEqual(["6", "5", "4", "3"]);
  expect(r.input).toMatchObject({ forms_shown: ["form-landlord-1-office-rental-listing", "form-landlord-1-office-rent-reminder", "form-landlord-1-office-notice-to-vacate"], forms_of: 6 });
  // (It filled in a form it was shown; the check of the form is made against the lines shown, as ever: here the
  // stand-in model left the required fields out.)
  expect(r.input).toMatchObject({ wrote: "form(form=rent_reminder)", withheld: "form_check" });
  // A form of the town's that was not shown, named in the request: no draft from this model, and why.
  wants = "none";
  const s = await ask("Fill in the council proposal form: kind law, proposal \"A park.\"");
  expect(s.input).toMatchObject({ program: "none(unclear)", withheld: "form_not_shown", forms_of: 6 });
  // Shown them all (they fit): nothing is said of a subset.
  (a as any).reader = { most: 1000 };
  wants = "rent_reminder";
  const all = await ask("Fill in the rent reminder for c0701.");
  expect(all.input.forms_shown).toBeUndefined();
});
