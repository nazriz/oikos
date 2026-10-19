// An office's own papers, as forms (docs/behaviour/office-papers.md; contracts: FormWrites). For the offices whose
// work is typed papers: what the office's code module writes as a statement, a seat writes by filling in the office's
// form for it, and the two are the same act to the letter. Checked here by taking each module's own statements,
// turning each into its form (as a mock seat's brain does: `onOwnForms`), and resolving both.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calls, forms, modules } from "@oikos/participants";
import { engine } from "../../participants/test/engine";
import { onOwnForms } from "@oikos/participants/llm";
import { inCurrency } from "../../participants/src/money";
import { context, DAY, statement } from "../../participants/test/stepping";
import { stationeryForm } from "@oikos/worlds/generator/generate";
import { formShown, Knowledge, Preview, resolve } from "@oikos/translator";

const CURRENCY = { code: "XYZ", minor_units: 2 };
inCurrency(CURRENCY);

/** An office's stationery as the world publishes it for whoever holds the office. */
function stationery(module: string, office: string, entity: string, params: object) {
  const m = modules[module]!;
  return (m.issues ?? []).map((x) => stationeryForm(office, entity, x, m.issuesWith?.(params as any) ?? {}));
}

/** Every program a module says in one wake on what it is shown. */
function said(module: string, office: string, entity: string, params: object, t: number, records: object[], more: object = {}): string[] {
  const m = engine(module).create(context(`${office}-system`, entity, params, { position: office, currency: CURRENCY }));
  const out: string[] = [];
  let obs: any = { t, entity, participant: `${office}-system`, channels: { all: { kind: "records", records }, ...more }, inbox: [], outcomes: [], woke_for: "cadence" };
  for (let i = 0; i < 50; i++) {
    const a: any = m.step(obs, undefined as any);
    if (a.type !== "call") break;
    out.push(a.call);
    obs = { ...obs, woke_for: "done", outcomes: [{ action: `act.${i}`, t, status: "applied" }], channels: { all: { kind: "records", records: [] }, ...more } };
  }
  return out;
}

/** The seat that holds the office, knowing its stationery. */
function seat(office: string, entity: string, t: number, papers: any[]): Knowledge {
  const k = new Knowledge(CURRENCY);
  k.absorb({ participant: `${office}-system`, t, entity: "c0900", positions: [{ position: office, entity }], outcomes: [], inbox: [], drafts: [], channels: { stationery: { kind: "records", records: papers } } } as any);
  return k;
}

/** Each program as the module said it and as a seat says it on the office's forms: the acts each resolves to. */
function both(office: string, entity: string, t: number, papers: any[], programs: string[]) {
  const k = seat(office, entity, t, papers);
  return programs.map((program) => {
    const turned = onOwnForms(program, papers.map((p) => p.data), { self: entity, now: t, currency: CURRENCY });
    const acts = (text: string) => { const r = resolve(calls.parseProgram(text), k, () => undefined, office); if (!r.ok) throw new Error(`${text}: ${r.questions.join(" ")}`); return r.blocks; };
    return { program, turned, module: acts(program), form: acts(turned.program) };
  });
}

test("the registrar's papers: a death registered, the land's transmission applied for, a birth registered and a certified copy, each on its form, are the papers the module writes", () => {
  const params = { feeds: ["outside", "electoral"], estate_tells: ["bank", "energy-co"], land_registry: "land-registry" };
  const papers = stationery("city.registry", "registry", "city", params);
  expect(papers.map((p) => p.data.form)).toEqual(["death_registration", "death_certificate", "birth_registration", "transmission_application"]);
  const note = (id: string, by: string, data: object, kind = "death_notification") => ({ id, at: 100, author: `${by}-self`, record: "statement", speaks_for: by, kind, addressed_to: ["city"], visible_to: ["city"], text: "x", data });
  const entry = { id: "rec.9", at: 50, author: "registry-system", record: "statement", speaks_for: "city", kind: "death_registration", addressed_to: ["police"], visible_to: ["city", "police"], text: "x", data: { deceased: "c0700", reported_by: "police" } };
  const programs = said("city.registry", "registry", "city", params, 20 * DAY, [
    note("rec.5", "c0002", { deceased: "c0001", partner: "c0002", children: ["c0003", "c0004"], adult_children: ["c0003"], tell: ["landlord-1", "clinic"] }),
    note("rec.6", "police", { deceased: "c0010", found_at: "apts-1/dwelling.2" }),
    note("rec.7", "c0020", { child: "par.12", born_at: 1_700_123, mother: "c0020" }, "birth_notification"),
    entry, note("rec.10", "landlord-2", { deceased: "c0700" }),
  ]);
  const r = both("registry", "city", 20 * DAY, papers, programs);
  // Every typed paper it wrote was turned, and none was left a plain statement.
  expect(r.reduce((n, x) => n + x.turned.turned, 0)).toBe(6);
  expect(r.flatMap((x) => x.turned.kept)).toEqual([]);
  for (const x of r) expect({ program: x.program, acts: x.form }).toEqual({ program: x.program, acts: x.module });
  // As a seat says the first: the form, to its own office, with what the notification says.
  expect(r.map((x) => x.turned.program).find((p) => p.includes("form=death_registration") && p.includes("c0001"))).toBe(
    'form(children=["c0003","c0004"], deceased=c0001, form=death_registration, notification=rec.5, partner=c0002, reported_by=c0002, tell=["landlord-1","clinic"], to=registry, without_adult=[])');
  // Where nobody of the family reported it, those the town writes to as the estate's administrator are told.
  const alone = r.find((x) => x.turned.program.includes("deceased=c0010") && x.turned.program.includes("death_registration"))!;
  expect(alone.turned.program).toContain('estate=["bank","energy-co"]');
  expect(alone.form[0]).toMatchObject({ block: "publish", kind: "death_registration", basis: "rec.6", addressed_to: ["police", "outside", "electoral", "bank", "energy-co"], visible_to: ["city", "police", "outside", "electoral", "bank", "energy-co"], data: { deceased: "c0010", reported_by: "police" } });
});

test("the works office's advertisement for crew, on its form, is the advertisement the module posts: its terms, its offer, and where the work is", () => {
  const WAGE = 300_000, PERIOD = 14 * DAY;
  const params = { depot: "town-hall", workplace: "town-hall/workplace.1", landfill: "outside", wage: WAGE, period: PERIOD, industry: "public_administration" };
  const papers = stationery("city.works", "works", "city", params);
  const budget = statement("budget-1", 0, "budget", { data: { year: 1, lines: { staff: 3 * Math.floor((WAGE * 365 * DAY) / PERIOD) } } });
  const programs = said("city.works", "works", "city", params, 10 * DAY, [budget]);
  const r = both("works", "city", 10 * DAY, papers, programs).filter((x) => x.program.includes("job_posting"));
  expect(r).toHaveLength(1);
  expect(r[0]!.turned).toMatchObject({ turned: 1, kept: [] });
  expect(r[0]!.form).toEqual(r[0]!.module);
  expect(r[0]!.turned.program).toBe('form(form=job_advertisement, period="14 days", posts="1", to=works, wage="XYZ 3000.00")');
  expect(r[0]!.form[0]).toMatchObject({ kind: "job_posting", data: { wage: WAGE, period: PERIOD, role: "works crew", industry: "public_administration", workplace: "town-hall", space: "town-hall/workplace.1" },
    offer: { by: "city", take_up: "apply", available: 1, terms: { template: "employment" } } });
  // A seat that fills it in with only what the form requires gets the same paper, in the form's own words.
  const k = seat("works", "city", 10 * DAY, papers);
  const plainly = resolve(calls.parseProgram('form(form=job_advertisement, wage="3,000", period="14 days", posts="1")'), k, () => undefined, "works");
  expect(plainly.ok && plainly.blocks[0]).toEqual({ ...r[0]!.module[0]!, text: "Hiring: XYZ 3,000.00 every 14 days." });
  // Eight posts in one advertisement: what pilot 12's works manager asked for and could not say.
  const eight = resolve(calls.parseProgram('form(form="job advertisement", to=works, wage="3,000", period="fortnightly", posts="8")'), k, () => undefined, "works");
  expect(eight.ok && (eight.blocks[0] as any).offer.available).toBe(8);
  expect(new Preview(k, "city").of(eight.ok ? eight.blocks : [])).toStartWith('This does one thing: a job posting.\n1. You will issue a job posting (form-works-job-advertisement): "Hiring: XYZ 3,000.00 every 14 days."');
  // (What it offers reads in words, whoever takes it coming to the place of work: it read as raw data, and "let someone live or be in".)
  expect(new Preview(k, "city").of(eight.ok ? eight.blocks : [])).toContain("   - It offers an employment agreement, by you (8 available), taken up by applying: you will pay XYZ 3,000.00 to someone every 14 days, for wages; whoever takes it will come to town-hall/workplace.1. You may end it on 14 days' notice; whoever takes it may end it on 14 days' notice. Open to: min age years: 18.");
});

test("the works office's payroll notice of a new starter, on its form, is the notice the module sends the finance office", () => {
  const WAGE = 300_000, PERIOD = 14 * DAY;
  const params = { depot: "town-hall", workplace: "town-hall/workplace.1", landfill: "outside", wage: WAGE, period: PERIOD, industry: "public_administration", payroll_office: "finance" };
  const papers = stationery("city.works", "works", "city", params);
  expect(papers.map((x) => x.data.form)).toContain("payroll_starter");
  expect(papers.map((x) => x.data.form)).toContain("payroll_leaver");
  const job = { id: "job-9", at: 8 * DAY, author: "works-system", record: "agreement", visible_to: ["city", "c9"], terms: { template: "employment", parties: ["city", "c9"],
    text: "c9 works for city as works crew for 300000 cents every 14 days. First pay 14 days after both have signed.", commitments: [{ who: "city", does: { outcome: { money: { to: "acc-c9", amount: String(WAGE), for: "wages" } } }, every: PERIOD }] } };
  const signatures = ["city", "c9"].map((as) => ({ id: `sig-${as}`, at: 9 * DAY, author: `${as}-x`, record: "signature", agreement: "job-9", as, visible_to: ["city", "c9"] }));
  const programs = said("city.works", "works", "city", params, 10 * DAY, [job, ...signatures]);
  const r = both("works", "city", 10 * DAY, papers, programs).filter((x) => x.program.includes("payroll_notice"));
  expect(r).toHaveLength(1);
  expect(r[0]!.turned).toMatchObject({ turned: 1, kept: [] });
  expect(r[0]!.form).toEqual(r[0]!.module);
  // (In the form's own words: the module's are the same, so none are given.)
  const [onForm, letter] = r[0]!.turned.program.split("\n");
  expect(onForm).toBe('form(account=acc-c9, agreement=job-9, employee=c9, first_pay="1987200", form=payroll_starter, period="14 days", post="works crew", to=works, wage="XYZ 3000.00")');
  // (With it, a letter to the finance office's post in the notice's words: a paper on the town's own file is not
  // put in front of anyone, and a letter is.)
  expect(letter).toStartWith('message(re=job-9, text="Payroll notice from the hiring office, new starter: c9, works crew, under employment agreement job-9. Pay: XYZ 3,000.00 every 14 days before tax, into acc-c9; first pay day year 1, day 24');
  expect(letter).toEndWith('to=["finance"])');
  expect(r[0]!.form[0]).toMatchObject({ kind: "payroll_notice", addressed_to: ["city"], visible_to: ["city"], basis: "job-9",
    text: "Payroll notice, new starter: c9, works crew, under employment agreement job-9. Pay: XYZ 3,000.00 every 14 days before tax, into acc-c9; first pay day year 1, day 24, then every 14 days. The post is one of those the staff line of the adopted budget pays for: the wage is on that line. For the finance office: the wage payment is to be set up from that day.",
    data: { notice: "starter", office: "finance", employee: "c9", post: "works crew", agreement: "job-9", wage: "300000", period: PERIOD, first_pay: 23 * DAY, account: "acc-c9" } });
});

test("a planning decision on its form is the decision the module sends, and the liberty granted with it is unchanged", () => {
  const papers = stationery("city.planning_officer", "planning", "city", {});
  const app = { id: "rec.30", at: 100, author: "c0005-self", record: "statement", speaks_for: "c0005", kind: "permit_application", addressed_to: ["city"], visible_to: ["city", "c0005"], text: "x", basis: "form-permit", data: { lot: "lot-01-02", structure_type: "house" } };
  const bad = { ...app, id: "rec.31", data: { lot: "lot-01-03" } };
  const r = both("planning", "city", 10 * DAY, papers, said("city.planning_officer", "planning", "city", {}, 10 * DAY, [app, bad]));
  expect(r.reduce((n, x) => n + x.turned.turned, 0)).toBe(2);
  for (const x of r) expect(x.form).toEqual(x.module);
  expect(r.map((x) => x.turned.program).join("\n")).toContain("form(applicant=c0005, application=rec.30, decision=granted, form=permit_decision");
  expect(r.map((x) => x.turned.program).join("\n")).toContain('missing=["structure_type"]');
  // The liberty is the form's own to record (contracts: FormWrites `claim`): one form says both, and what it makes
  // is what the module made, the liberty first and then the decision.
  expect(r.map((x) => x.turned.program).join("\n")).not.toContain("claim(");
  expect(r.map((x) => x.turned.program).join("\n")).toContain("form(applicant=c0005, application=rec.30, decision=granted, form=permit_decision, lot=lot-01-02, structure_type=house,");
  expect(r.flatMap((x) => x.form).filter((b: any) => b.block === "record_claim")).toEqual([{ block: "record_claim", position: "liberty", holder: "c0005", about: { action: "build", object: "lot-01-02", structure_type: "house" }, basis: "rec.30", speaks_for: "city" }]);
  // And the form says so of itself (wave 2c: a planning seat granted a park on a form that wrote the decision alone,
  // and the inspector fined the town and ordered the park down the same day).
  const form = papers.find((f: any) => f.data.form === "permit_decision") as any;
  expect(form.text).toContain("A decision to grant records the permission with it: the applicant's liberty to build that kind of building on that lot, which the building inspector reads.");
  expect(form.data.writes.claim).toEqual({ when: { decision: "granted" }, position: "liberty", holder: "=applicant", about: { action: "build", object: "=lot", structure_type: "=structure_type" }, basis: "=application" });
});

test("every paper a module declares is a form the contract accepts, names fields it has, and is shown to the translator as its office's", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  for (const f of ["blocks", "common", "records", "world-config", "participant-api", "log", "calls", "outcomes", "dataset", "module"]) ajv.addSchema(JSON.parse(readFileSync(join(import.meta.dir, `../../contracts/${f}.schema.json`), "utf8")));
  const valid = ajv.getSchema("urn:oikos:contracts:0.8:outcomes#/$defs/FormData")!;
  let n = 0;
  for (const m of Object.values(modules)) {
    const names = (m.issues ?? []).map((x) => x.form);
    expect(new Set(names).size).toBe(names.length);
    for (const x of m.issues ?? []) {
      n++;
      const record = stationeryForm("office", "org", x, m.issuesWith?.({}) ?? {});
      expect({ module: m.name, form: x.form, errors: valid(record.data) ? null : valid.errors }).toEqual({ module: m.name, form: x.form, errors: null });
      // Every field a template or the words name is a field of the form (or whoever it is made for).
      const named = [...JSON.stringify(record.data.writes).matchAll(/"[=#?+]([a-z_][a-z0-9_]*)"|\{([a-z_][a-z0-9_]*)\}/g)].map((x2) => x2[1] ?? x2[2]!);
      for (const name of named) expect({ module: m.name, form: x.form, field: name, known: name === "self" || name in x.fields }).toMatchObject({ known: true });
      // (Nothing of the office's own is left unfilled, and the words name no money.)
      expect(JSON.stringify(record.data)).not.toMatch(/"@|\{@/);
      expect(`${x.title} ${Object.values(x.fields).map((y) => y.description).join(" ")}`).not.toMatch(/\$|dollar|cents/i);
      expect(formShown(record)).toStartWith(`- ${x.form}, to=office, id form-office-${x.form.replace(/_/g, "-")}: fields `);
    }
  }
  expect(n).toBeGreaterThan(40);
});

test("a paper is turned into its form only when the form writes it back to the letter", () => {
  const [spec] = stationery("city.registry", "registry", "city", { feeds: ["outside"], land_registry: "land-registry" }).map((p) => p.data as forms.FormData);
  const o = { self: "city", now: 5 * DAY, money: (a: string) => a };
  const paper: forms.Paper = { kind: "death_registration", text: "Death registered: c0001.", basis: "rec.5", addressed_to: ["c0002", "outside"], visible_to: ["city", "c0002", "outside"], data: { deceased: "c0001", reported_by: "c0002", children: [], without_adult: [] } };
  expect(forms.fieldsFor(spec!, paper, o)).toEqual({ fields: { deceased: "c0001", reported_by: "c0002", children: [], without_adult: [], notification: "rec.5" } });
  // Its own words kept where they are not the form's.
  expect(forms.fieldsFor(spec!, { ...paper, text: "Entered in the register." }, o)?.text).toBe("Entered in the register.");
  // Something the form does not write: a key it has no field for, an addressee out of place, another kind.
  expect(forms.fieldsFor(spec!, { ...paper, data: { ...(paper.data as object), cause: "unknown" } }, o)).toBeUndefined();
  expect(forms.fieldsFor(spec!, { ...paper, addressed_to: ["outside", "c0002"] }, o)).toBeUndefined();
  expect(forms.fieldsFor(spec!, { ...paper, kind: "death_certificate" }, o)).toBeUndefined();
  expect(forms.fieldsFor(spec!, { ...paper, visible_to: "public" }, o)).toBeUndefined();
});

test("what pilot 12's works manager and registrar asked for and could not say (16 requests, none drafted) is each a form filled in", () => {
  // The requests were of five shapes (docs/behaviour/office-papers.md has each of the sixteen beside its program).
  const works = seat("works", "city", 37 * DAY, stationery("city.works", "works", "city", { depot: "town-hall", workplace: "town-hall/workplace.1", landfill: "outside" }));
  const registry = seat("registry", "city", 56 * DAY, stationery("city.registry", "registry", "city", { feeds: ["outside"], land_registry: "land-registry" }));
  registry.absorb({ participant: "registry-system", t: 56 * DAY, entity: "c0900", positions: [{ position: "registry", entity: "city" }], outcomes: [], inbox: [], drafts: [], channels: { who: { kind: "directory", entities: [{ entity: "police", kind: "police", name: "Police" }], positions: [] } } } as any);
  const acts = (k: Knowledge, office: string, program: string) => { const r = resolve(calls.parseProgram(program), k, () => undefined, office); return r.ok ? r.blocks : r.questions; };
  // "Hire 8 waste collection crew at 78,214 each per year, paid from the staff budget ..." (eleven wordings), and
  // "Post 8 vacancies for works crew ... paid from account acc-city" (two): an advertisement for eight posts.
  expect(acts(works, "works", 'form(form=job_advertisement, to=works, wage="78,214", period="a year", posts="8")')[0]).toMatchObject({ kind: "job_posting", data: { wage: 7_821_400, period: 365 * DAY, role: "works crew" }, offer: { available: 8 } });
  expect(acts(works, "works", 'form(form=job_advertisement, wage="3,008.23", period="14 days", posts="8", account=acc-city)')[0]).toMatchObject({ kind: "job_posting", data: { wage: 300_823, period: 14 * DAY }, offer: { available: 8, terms: { commitments: [{ does: { outcome: { money: { from: "acc-city", amount: "300823" } } } }, {}] } } });
  // "Hire one member of the town's works crew at 78,214 a year ...": one post.
  expect((acts(works, "works", 'form(form=job_advertisement, wage="78,214", period="a year", posts="1")')[0] as any).offer.available).toBe(1);
  // "Register the death of c0242 on the strength of the death notification rec.17236 from partner c0243 (no children)".
  expect(acts(registry, "registry", "form(form=death_registration, deceased=c0242, notification=rec.17236, reported_by=c0243, partner=c0243)")[0]).toMatchObject({ kind: "death_registration", basis: "rec.17236", addressed_to: ["c0243", "outside"], data: { deceased: "c0242", partner: "c0243", reported_by: "c0243" } });
  // "Register the death of c0228 ... on the strength of the police notification rec.26147": who reported it, by name.
  expect(acts(registry, "registry", 'form(form=death_registration, deceased=c0228, notification=rec.26147, reported_by="the police")')[0]).toMatchObject({ kind: "death_registration", basis: "rec.26147", data: { deceased: "c0228", reported_by: "police" } });
  // Said without it, the form asks for what it needs, in its own words.
  expect(acts(registry, "registry", "form(form=death_registration, deceased=c0228, notification=rec.26147)")).toEqual(["The death registration needs: reported_by."]);
});

// ---- the fourth living pilot: a mayor's answer to a petition was "Answer to petition rec.X." and nothing more. A form
// whose act in the world is to say something must carry what is said.

test("the mayor's answer to a petition carries the answer in full: required, in the paper's text, and shown whole in the draft the seat confirms", () => {
  const papers = stationery("city.mayor_code", "mayor", "city", {});
  const spec = papers.find((p: any) => p.data.form === "petition_response")!.data as forms.FormData;
  expect(spec.fields.answer).toMatchObject({ type: "text", required: true });
  const k = seat("mayor", "city", 40 * DAY, papers);
  // Without the answer the form asks for it.
  const bare = resolve(calls.parseProgram("form(form=petition_response, petition=rec.40, organiser=c0007)"), k, () => undefined, "mayor");
  expect(bare.ok ? [] : bare.questions.join(" ")).toContain("needs: answer");
  // A long answer (well past a sentence or two) is kept whole in the paper, in its text and its data.
  const long = Array.from({ length: 40 }, (_, i) => `Point ${i + 1}: the council has had the petition put to it and will take it up at its next sitting.`).join(" ");
  expect(long.length).toBeGreaterThan(3000);
  const r = resolve(calls.parseProgram(`form(form=petition_response, petition=rec.40, organiser=c0007, answer="${long}")`), k, () => undefined, "mayor");
  expect(r.ok).toBe(true);
  const block: any = r.ok ? r.blocks[0] : undefined;
  expect(block).toMatchObject({ block: "publish", kind: "petition_response", basis: "rec.40", addressed_to: ["c0007"], visible_to: "public", text: `Answer to petition rec.40: ${long}`, data: { petition: "rec.40", answer: long } });
  // The draft shows the words, whole.
  const shown = new Preview(k, "city").of(r.ok ? r.blocks : []);
  expect(shown).toContain(`Answer to petition rec.40: ${long}`);
  // And the paper reads back as the form's, answer and all (what the mock seat's turning relies on).
  const o = { self: "city", now: 40 * DAY, money: (a: string) => a };
  expect(forms.fieldsFor(spec, { kind: "petition_response", text: block.text, basis: "rec.40", addressed_to: ["c0007"], visible_to: "public", data: block.data }, o)?.fields).toMatchObject({ petition: "rec.40", answer: long });
});

test("a form that says something to someone can carry what it says: each of these has a text field that reaches the paper it writes", () => {
  // (Per form: the text field, and where it lands. Only the mayor's answer is required, and lands in the paper's words: the
  // others say a decision's reasons, which a form's template has no way to leave out when empty, so they are in the paper's data.)
  const SAYING: { [form: string]: { field: string; in: "text" | "data"; required?: boolean } } = {
    petition_response: { field: "answer", in: "text", required: true },
    nomination: { field: "platform", in: "text", required: true },
    remedy_answer: { field: "reason", in: "data" },
    variation_answer: { field: "reason", in: "data" },
    complaint_answer: { field: "statement", in: "data" },
    tribunal_answer: { field: "statement", in: "data" },
    permit_decision: { field: "reason", in: "data" },
    possession_order: { field: "reason", in: "data" },
    tribunal_order: { field: "reason", in: "data" },
    venue_decision: { field: "reason", in: "data" },
    loan_decision: { field: "reason", in: "data" },
    benefit_decision: { field: "reason", in: "data" },
    wage_offer: { field: "why", in: "data" },
  };
  const all = new Map<string, forms.FormData>();
  for (const m of Object.values(modules)) for (const x of m.issues ?? []) all.set(x.form, stationeryForm("office", "org", x, m.issuesWith?.({}) ?? {}).data as forms.FormData);
  for (const [form, how] of Object.entries(SAYING)) {
    const spec = all.get(form);
    expect({ form, has: !!spec }).toEqual({ form, has: true });
    const field = spec!.fields[how.field];
    expect({ form, field: how.field, type: field?.type }).toEqual({ form, field: how.field, type: "text" });
    expect({ form, required: !!field!.required }).toEqual({ form, required: !!how.required });
    // Filled in with a long, distinctive set of words, the paper written carries them whole.
    const words = `${form} words: ${"the reasons, at length; ".repeat(60)}`;
    const given: forms.Filled = {};
    for (const [name, fd] of Object.entries(spec!.fields)) if (fd.required) given[name] = fd.type === "choice" ? fd.options![0]! : fd.type === "count" ? 1 : fd.type === "list" ? ["c0001"] : fd.type === "date" ? 100 * DAY : fd.type === "duration" ? DAY : fd.type === "amount" ? "100" : "x1";
    given[how.field] = words;
    const paper = forms.writePaper(spec!, given, { self: "org", now: 100 * DAY, money: (a) => a });
    expect({ form, carried: JSON.stringify(how.in === "text" ? paper.text : paper.data).includes(words) }).toEqual({ form, carried: true });
  }
});
