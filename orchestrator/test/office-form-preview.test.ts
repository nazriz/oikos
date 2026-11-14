// What the preview of a paper made on an office's own form says of everyone it goes to (wave 2b, 2026-10-09: a
// registrar declined seven right death registrations because two recipients were on every one and nothing said why).
// Each recipient is there because a field of the form names them, or because the form itself sends every paper to
// them: the preview says which, in the form's own words, and no office form sends a paper to anyone without saying why.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calls, modules } from "@oikos/participants";
import { stationeryForm } from "@oikos/worlds/generator/generate";
import { Knowledge, Preview, resolve } from "@oikos/translator";

const POUND = { code: "GBP", symbol: "£", minor_units: 2 };

function stationery(module: string, office: string, entity: string, params: object, title?: string) {
  const m = modules[module]!;
  return (m.issues ?? []).map((x) => stationeryForm(office, entity, x, m.issuesWith?.(params as any) ?? {}, title));
}
function seat(office: string, entity: string, papers: any[], cur: any = { code: "XYZ", minor_units: 2 }): Knowledge {
  const k = new Knowledge(cur);
  k.absorb({ participant: `${office}-system`, t: 3 * 86_400, entity: "c0900", positions: [{ position: office, entity, title: "Registrar" }], outcomes: [], inbox: [], drafts: [], channels: {
    who: { kind: "directory", entities: [{ entity: "outside", kind: "boundary", name: "The outside world" }, { entity: "electoral-commission", kind: "body", name: "Electoral commission" }, { entity: "bank", kind: "bank", name: "Millbrook Savings Bank" }, { entity: "energy-co", kind: "firm", name: "Energy retailer" }, { entity: "city", kind: "town", name: "Town of Millbrook" }], positions: [] },
    stationery: { kind: "records", records: papers } } } as any);
  return k;
}
const preview = (k: Knowledge, office: string, program: string) => {
  const r = resolve(calls.parseProgram(program), k, () => undefined, office);
  if (!r.ok) throw new Error(r.questions.join(" "));
  return new Preview(k, k.actingFor(office), () => undefined, office).of(r.blocks);
};
const REGISTRY = { feeds: ["outside", "electoral-commission"], estate_tells: ["bank", "energy-co"], land_registry: "land-registry" };

test("a death registration's preview says why each recipient is on it: the reporter and those to be told by their fields, the two bodies by the form's own words", () => {
  const papers = stationery("city.registry", "registry", "city", REGISTRY, "Registrar");
  const k = seat("registry", "city", papers);
  // (The pilot's draft, to the letter.)
  const p = preview(k, "registry", 'form(deceased=c0362, form=death_registration, notification=rec.1496, partner=c0363, reported_by=c0363, tell=["bank","energy-co"], to=registry)');
  expect(p).toBe('This does one thing: a death registration.\n1. You will issue a death registration (form-registry-death-registration): "Death registered: c0362.".\n' +
    "   - Filled in: deceased: c0362; reported by: c0363; partner: c0363; tell: bank, energy-co; notification: rec.1496.\n" +
    "   - Left empty: children, without adult, estate.\n" +
    '   - It goes to: c0363 (reported by on the form: "Who reported the death: they are sent the entry."); Millbrook Savings Bank (bank) and Energy retailer (energy-co) (tell on the form: "Those the notification asks to be told, who are sent the entry too.");' +
    ' The outside world (outside) and Electoral commission (electoral-commission) (not for you to choose: the form, form-registry-death-registration, sends every paper made on it to them: "They are sent every entry in the register of deaths as of right, to keep their own records by: whoever keeps a roll of electors takes the dead off it, and whoever pays someone a pension or support stops paying it.").' +
    " It is seen only by you and those it goes to.");
  // What the registrar read in the pilot, and declined seven times.
  expect(p).not.toContain("addressed to c0363, Millbrook Savings Bank (bank), Energy retailer (energy-co), The outside world (outside), Electoral commission (electoral-commission)");
});

test("the form on the registrar's file says the same before any draft does", () => {
  const form = stationery("city.registry", "registry", "city", REGISTRY, "Registrar").find((f) => f.data.form === "death_registration")!;
  expect(form.text).toContain("Every paper made on it also goes to outside and electoral-commission: They are sent every entry in the register of deaths as of right");
  expect(form.data.writes.sends).toEqual([{ to: ["outside", "electoral-commission"], why: expect.stringContaining("as of right") }]);
  // A registry that sends its entries to nobody of right says nothing of it.
  const none = stationeryForm("registry", "city", modules["city.registry"]!.issues!.find((x) => x.form === "death_registration")!, modules["city.registry"]!.issuesWith!({}), "Registrar");
  expect(none.text).not.toContain("also goes to");
  expect(none.data.writes.sends).toBeUndefined();
});

test("no office form sends a paper to someone of the office's own without saying why", () => {
  const fixed = (x: unknown): string[] => (Array.isArray(x) ? x.filter((y): y is string => typeof y === "string" && y.startsWith("@")) : []);
  const silent: string[] = [];
  let forms = 0;
  for (const [name, m] of Object.entries(modules)) for (const x of m.issues ?? []) {
    forms++;
    const said = new Set((x.writes.sends ?? []).flatMap((s) => s.to));
    for (const to of fixed(x.writes.to)) if (!said.has(to)) silent.push(`${name} ${x.form}: ${to}`);
    // (And none gives a reason for someone the form does not send to.)
    for (const to of said) if (!fixed(x.writes.to).includes(to)) silent.push(`${name} ${x.form}: a reason for ${to}, which it does not send to`);
  }
  expect(forms).toBeGreaterThan(40);
  expect(silent).toEqual([]);
});

test("every office's forms, with their reasons, are forms the contract accepts", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  const schemas = ["outcomes", "blocks", "common", "records", "world-config", "participant-api", "log", "calls", "dataset", "module"].map((f) => JSON.parse(readFileSync(join(import.meta.dir, `../../contracts/${f}.schema.json`), "utf8")));
  for (const s of schemas) ajv.addSchema(s);
  const valid = ajv.getSchema(`${schemas[0].$id}#/$defs/FormData`)!;
  const own = { feeds: ["outside"], land_registry: "land-registry", electoral: "electoral-commission", valuer: "valuer", landfill: "landfill", planning: "planning", banks: ["bank"], city: "city", funder: "outside", tribunal: "tribunal", registry: "city", police: "police", town: "city" };
  for (const m of Object.values(modules)) for (const x of m.issues ?? []) {
    const f = stationeryForm("office", "org", x, { ...own, ...(m.issuesWith?.({}) ?? {}), ...own });
    expect({ form: x.form, errors: valid(f.data) ? null : valid.errors }).toEqual({ form: x.form, errors: null });
  }
});

test("a landlord's return of rent reads its sum as money, and says the town is who it is made to", () => {
  const papers = stationery("firm.landlord", "landlord-2-office", "landlord-2", { city: "city" }, "Manager");
  const k = seat("landlord-2-office", "landlord-2", papers, POUND);
  const p = preview(k, "landlord-2-office", 'form(account=acc-landlord-2, form=tax_report, period_end="year 1, day 25", rent_received="£3,813.75", to=landlord-2-office)');
  expect(p).toContain("rent received: £3,813.75");
  expect(p).not.toContain("381375");
  expect(p).toContain('It goes to: Town of Millbrook (city) (not for you to choose: the form, form-landlord-2-office-tax-report, sends every paper made on it to it: "The return is made to the town, which the rent is reported to.").');
});

test("a paper that goes to nobody says nothing of recipients, and one made on no form of the seat's reads as before", () => {
  const papers = stationery("city.council_clerk", "council-clerk", "city", {}, "Council clerk");
  const k = seat("council-clerk", "city", papers);
  const p = preview(k, "council-clerk", 'form(form=council_result, ballot=rec.2626, yes="5", no="0", passed=yes, to=council-clerk)');
  expect(p).not.toContain("It goes to");
  const plain = preview(k, "council-clerk", 'statement(kind=notice, text="The hall is closed.", to=bank, visible=public)');
  expect(plain).toBe('This does one thing: a notice.\n1. You will publish a notice, addressed to Millbrook Savings Bank (bank): "The hall is closed.".\n   - Public: anyone may read it.');
});

test("every blank of every form is written on its paper, worked into a figure it writes, or said by the preview to be neither (rung 1, 2026-11-14)", () => {
  // (A delivery note's price each, filled and used to work out what is owed, read "Left empty", and a seat declined a
  // right draft seven times.) The law: each blank the paper does not carry is named in the form's own rule for a
  // figure it writes, or is on this list, which the preview sets out as used and not written.
  const NOT_WRITTEN: { [form: string]: string[] } = { audit_finding: ["body"] }; // (the audit's key names the body: risk MT-35)
  const refs = (x: unknown, into: Set<string>): void => {
    if (typeof x === "string") for (const m of x.matchAll(/[=#?+]([a-z_][a-z0-9_]*)|\{([a-z_][a-z0-9_]*)\}/g)) into.add((m[1] ?? m[2])!);
    else if (Array.isArray(x)) x.forEach((y) => refs(y, into));
    else if (x && typeof x === "object") Object.values(x).forEach((y) => refs(y, into));
  };
  const loose: string[] = [];
  for (const m of Object.values(modules)) for (const x of [...(m.issues ?? []), ...(m.handsOver ?? [])]) {
    if (!x.writes || x.copies) continue;
    const written = new Set<string>();
    refs(x.writes, written);
    const worked = new Set(Object.values(x.fields).flatMap((f: any) => (typeof f.worked === "string" ? [...f.worked.matchAll(/[a-z_][a-z0-9_]*/g)].map((w: any) => w[0]) : [])));
    for (const k of Object.keys(x.fields)) if (!written.has(k) && !worked.has(k) && !(NOT_WRITTEN[x.form] ?? []).includes(k)) loose.push(`${x.form}.${k}`);
  }
  expect(loose).toEqual([]);
  // And the preview says what became of such a blank: the figure it is worked into, never "Left empty".
  const papers = stationery("firm.producer", "factory-1-office", "factory-1", {}, "Manager");
  const k = seat("factory-1-office", "factory-1", papers);
  const call = 'form(buyer=shop-5, delivered="86", form=delivery_note, kind="goods", order=rec.26782, ordered="86", owed="XYZ 860,000", pay_in_days="30", pay_to=acc-factory-1, price_each="XYZ 10,000", refund="XYZ 0", to=factory-1-office)';
  const r = resolve(calls.parseProgram(call), k, () => undefined, "factory-1-office");
  if (!r.ok) throw new Error(r.questions.join(" "));
  const p = new Preview(k, k.actingFor("factory-1-office"), () => undefined, "factory-1-office").of(r.blocks, { price_each: "XYZ 10,000", owed: "XYZ 860,000" });
  expect(p).toContain("Used, not written on the paper: price each XYZ 10,000.00: owed, XYZ 860,000.00, is worked from it.");
  expect(p).not.toMatch(/Left empty: [^\n]*price each/);
});
