// Forms (contracts/calls.md; docs/behaviour/directions.md): a direction filed on an office's own form. This
// repository's resolver on the table both resolvers are held to (contracts/test/forms.json; the engine's reads the
// same file in kernel/crates/resolver/src/resolve.rs), what the translator is shown of such a form, and what the
// preview says of a direction.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calls, canonical, clientDraftOf, clientPapers, forms } from "@oikos/participants";
import FORMS from "../../contracts/test/forms.json";
import { MockAdapter } from "@oikos/participants/llm";
import { createTranslator, formRules, formShown } from "../src/index";
import { misread } from "../src/rules";
import { Knowledge } from "../src/knowledge";
import { Preview } from "../src/preview";
import { durationWords, resolve } from "../src/resolver";

interface Case { name: string; program: string; as?: string; blocks?: unknown[]; asks?: string[] }
const CASES = FORMS.cases as Case[];

function seat(): Knowledge {
  const k = new Knowledge(FORMS.currency);
  k.absorb(FORMS.observation as any);
  return k;
}

test("the table's records are as a seat is shown them: every object's keys in order", () => {
  // (Both resolvers read a form's fields in the order the record has them; the engine writes a record's keys in order.)
  expect(JSON.stringify(FORMS.observation)).toBe(canonical(FORMS.observation));
});

test("every case of the shared table: the acts, or the questions back", () => {
  const k = seat();
  expect(CASES.length).toBeGreaterThanOrEqual(12);
  for (const c of CASES) {
    const r = resolve(calls.parseProgram(c.program), k, () => undefined, c.as);
    expect({ name: c.name, ...(r.ok ? { blocks: r.blocks } : { asks: r.questions }) } as any).toEqual({ name: c.name, ...(c.blocks ? { blocks: c.blocks } : { asks: c.asks }) });
  }
});

test("every act in the table is one the contract accepts, and every form in it is a form as the contract has one", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  const schemas = ["blocks", "common", "records", "world-config", "participant-api", "log", "calls", "outcomes", "dataset", "module"].map((f) => JSON.parse(readFileSync(join(import.meta.dir, `../../contracts/${f}.schema.json`), "utf8")));
  for (const s of schemas) ajv.addSchema(s);
  const block = ajv.getSchema(`${schemas[0].$id}#/$defs/Block`)!;
  for (const c of CASES) for (const b of c.blocks ?? []) expect({ name: c.name, errors: block(b) ? null : block.errors }).toEqual({ name: c.name, errors: null });
  const form = ajv.getSchema("urn:oikos:contracts:0.8:outcomes#/$defs/FormData")!;
  for (const f of seat().forms) expect({ form: f.id, errors: form(f.data) ? null : form.errors }).toEqual({ form: f.id, errors: null });
});

test("a form that is one office's is shown to the translator as going to that office", () => {
  const shown = seat().forms.map(formShown);
  expect(shown).toContain("- works_staffing, to=works, id form-works-staffing: fields posts (count), recruit (one of yes | no, required)");
  expect(shown).toContain("- environment_staffing, to=environment, id form-environment-staffing: fields posts (count), recruit (one of yes | no, required)");
  // A form of the whole organisation's goes where it did.
  expect(shown).toContain("- permit_application, to=city, id form-permit: fields lot (lot, required), structure_type (structure_type, required)");
});

test("another office of the same organisation is not where one office's form goes, even when the seat knows that office", () => {
  const k = seat();
  k.absorb({ ...FORMS.observation, channels: { who: { kind: "directory", entities: [], positions: [{ position: "environment", entity: "city", role: "environment_officer", title: "Environment officer" }] } } } as any);
  const r = resolve(calls.parseProgram("form(form=works_staffing, to=environment, recruit=no)"), k, () => undefined, "mayor");
  expect(r).toEqual({ ok: false, questions: ["The works staffing form isn't one environment takes: it goes to works."] });
});

test("the preview of a direction says what is filed and to whom, and nothing of what the office will do", () => {
  const k = seat();
  const r = resolve(calls.parseProgram('form(form=works_collection, to=works, every="2 weeks")'), k, () => undefined, "mayor");
  if (!r.ok) throw new Error(r.questions.join(" "));
  expect(new Preview(k, "city").of(r.blocks)).toBe('This does one thing: a written direction.\n1. You will give the Works manager (works) a written direction on its works collection form (form-works-collection).\n   - Filled in: every: 14 days.\n   - This by itself changes nothing: the office follows a direction only from those its organisation\'s rules say may direct it, and writes back to say whether it does.\n   - It stands until you replace it with another or withdraw it.');
  // Filed by someone as themselves, it says in whose name.
  const own = resolve(calls.parseProgram("form(form=works_staffing, to=works, recruit=no)"), k);
  if (!own.ok) throw new Error(own.questions.join(" "));
  expect(new Preview(k, "c0001").of(own.blocks)).toStartWith('This does one thing: a written direction.\n1. You will give the Works manager (works) a written direction on its works staffing form (form-works-staffing).\n   - Filled in: recruit: no.\n   - Left empty: posts.\n');
});

test("a length of time in words", () => {
  expect([86_400, 14 * 86_400, 3600, 0].map(durationWords)).toEqual(["1 day", "14 days", "1 hour", "0 days"]);
});

test("a signed copy sent is previewed as that copy, under its sign-off, and not as a paper newly made (the scope pilot's baseline, 2026-11-14)", () => {
  // Haiku declined 26 right sends whose preview read "You will issue a job application (form-…)", as a fresh one does.
  const k = seat();
  const sent = resolve(calls.parseProgram("form(form=send_signed, sign_off=rec.81)"), k, () => undefined, "registry");
  if (!sent.ok) throw new Error(sent.questions.join(" "));
  const p = new Preview(k, "city", undefined, "registry").of(sent.blocks);
  expect(p).toStartWith('This does one thing: the signed invoice.\n1. You will send an invoice exactly as it was signed off under rec.81 (your draft rec.80): "Invoice: 12 goods, XYZ 120.00.". Nothing in it is written again.');
  // The same paper with anything changed is not that copy.
  const other = new Preview(k, "city", undefined, "registry").of([{ ...(sent.blocks[0] as any), text: "Invoice: 13 goods." }]);
  expect(other).not.toContain("signed off under");
  // Its details are said to be as signed (rung 1: "Filled in" read as the send form set up wrong).
  expect(p).toContain("   - As signed: ");
  expect(p).not.toContain("Filled in: ");
  expect(p).not.toContain("It has gone already");
  // (2026-11-16) Sent already from a post it holds: said, with the day and the paper it went as; still offered.
  const blk = sent.blocks[0] as any;
  k.absorb({ ...FORMS.observation, channels: { mine: { kind: "records", records: [{ id: "rec.90", record: "statement", kind: blk.kind, text: blk.text, addressed_to: blk.addressed_to, data: blk.data, ...(blk.basis ? { basis: blk.basis } : {}), visible_to: blk.visible_to, at: 3 * 86_400 + 600, author: "x", speaks_for: "city", in_position: "registry" }] } } } as any);
  const twice = new Preview(k, "city", undefined, "registry").of(sent.blocks);
  expect(twice).toContain("It has gone already: this same paper was sent as rec.90 on year 1, day 4, and this sends it a second time.");
  // (2026-11-17) A sign-off of a draft of several papers: sent all together on it, each as it stands and said so.
  const papers = [{ kind: "rates_notice", text: "Rates notice: 10.00.", to: ["c1"], visible: ["city", "c1"], data: { amount: 1000 } }, { kind: "rates_notice", text: "Rates notice: 20.00.", to: ["c2"], visible: ["city", "c2"], data: { amount: 2000 } }];
  k.absorb({ ...FORMS.observation, channels: { mine: { kind: "records", records: [{ id: "rec.95", record: "statement", kind: "sign_off", text: "Signed.", addressed_to: ["city"], data: { draft: "rec.94", referral: "rec.93", papers }, visible_to: ["city"], at: 4 * 86_400, author: "y", speaks_for: "city" }] } } } as any);
  const both = resolve(calls.parseProgram("form(form=send_signed, sign_off=rec.95)"), k, () => undefined, "registry");
  if (!both.ok) throw new Error(both.questions.join(" "));
  expect(both.blocks.map((x: any) => [x.kind, x.text, x.addressed_to])).toEqual([["rates_notice", "Rates notice: 10.00.", ["c1"]], ["rates_notice", "Rates notice: 20.00.", ["c2"]]]);
  expect(new Preview(k, "city", undefined, "registry").of(both.blocks)).toContain("exactly as it was signed off under rec.95");
});

test("a form's blanks the request settles in so many words are set by code: the form it names, the copy it cites, a blank it fills or leaves empty, whom the work is for (2026-11-14)", () => {
  const field = (type: string, required = false) => ({ type, ...(required ? { required: true } : {}) });
  const form = (id: string, name: string, fields: object, more: object = {}) => ({ id, data: { form: name, office: "desk", fields, ...more } });
  const job = { client: field("entity", true), employer: field("entity", true), posting: field("record", true), account: field("account", true), trade: field("text") };
  const k = {
    forms: [form("form-desk-job-application", "job_application", job, { writes: { kind: "job_application" } }), form("form-desk-draft-job-application", "draft_job_application", { referral: field("record", true), ...job }, { writes: { kind: "draft", data: { paper: { kind: "job_application" } } } }),
      form("form-desk-send-signed", "send_signed", { sign_off: field("record", true) }, { copies: "=sign_off" }),
      form("form-desk-supply", "supply_request", { lots: field("list", true), law: field("record", true), owner: field("entity", true), connection: field("text") }, { writes: { kind: "supply_request" } })],
    records: new Set(["rec.5", "rec.6", "rec.7", "rec.10", "rec.11", "law-rates"]), signed: new Map([["rec.7", { kind: "job_application" }]]), signedDraft: new Map([["rec.7", "rec.6"], ["rec.11", "rec.10"]]),
    referrals: new Map([["rec.5", "c0100"]]), referralKind: new Map([["rec.5", "job_application"]]), answeredReferrals: new Set<string>(), held: new Set(["desk"]),
    referralGives: new Map([["rec.5", { trade: "retail" }]]),
  };
  const ruled = (program: string, request: string) => calls.programText(formRules(calls.parseProgram(program), request, k));
  // The form named by its id; whom the work is for, from the matter handed over (never the counterparty); a blank left empty.
  expect(ruled('form(account=acc-c0100, client=factory-7, employer=factory-7, form=job_application, posting=rec.9, to=desk, trade="Application for the advertised job.")',
    "Draft for c0100's sign-off, using form-desk-draft-job-application: to factory-7 for posting rec.9, into acc-c0100, referral rec.5; leave trade empty."))
    .toBe("form(account=acc-c0100, client=c0100, employer=factory-7, form=draft_job_application, posting=rec.9, referral=rec.5, to=desk)");
  // The signed copy the request cites, drawn as its own paper written anew: that copy sent.
  expect(ruled("form(account=acc-c0100, client=c0100, employer=factory-7, form=job_application, posting=rec.9, to=desk)", "Send, as signed, the paper signed off under rec.7, in c0100's name."))
    .toBe("form(form=send_signed, sign_off=rec.7, to=desk)");
  // A blank the request names with its value takes it, where the value is of the blank's type (a law is no lot's).
  expect(ruled('form(connection="energy", form=supply_request, law=law-rates, lots=law-rates, owner=c0057, to=desk)', "On form-desk-supply: law law-rates; lots lot-25-06; owner c0057; connection: e-factory-1-works."))
    .toBe('form(connection="e-factory-1-works", form=supply_request, law=law-rates, lots=lot-25-06, owner=c0057, to=desk)');
  // A form of the seat's own post goes to that post, whoever the paper is addressed to.
  expect(ruled('form(employer=factory-7, form=job_application, to=factory-7)', "Apply.")).toBe("form(employer=factory-7, form=job_application, to=desk)");
  // (Rung 1, 2026-11-14.) A paper to be sent as signed, citing its draft: the signed copy of that draft sent, whatever
  // was drawn; a draft with no sign-off held is named to the send form, which answers that there is no signed copy.
  expect(ruled("none(unclear)", "Sending a paper as it was signed off: the job application (draft rec.6), exactly as signed by c0100.")).toBe("form(form=send_signed, sign_off=rec.7, to=desk)");
  expect(ruled('form(account=acc-c0100, client=c0100, employer=factory-7, form=job_application, posting=rec.9, to=desk)', "Send the signed job application (draft rec.8) exactly as signed.")).toBe("form(form=send_signed, sign_off=rec.8, to=desk)");
  // (Not a report that says something was sent as signed.)
  expect(ruled('form(client=c0100, done=yes, form=report, referral=rec.5, to=desk, words="Sent as signed.")', "Report on referral rec.5: done. The paper (draft rec.6) was sent as signed.")).toBe('form(client=c0100, done=yes, form=report, referral=rec.5, to=desk, words="Sent as signed.")');
  // A draft for sign-off, in the seat's own words, drawn on the form that issues it outright: its draft form. Never
  // from the remit: asked to issue it outright, it is set out outright.
  expect(ruled('form(account=acc-c0100, client=c0100, employer=factory-7, form=job_application, posting=rec.9, to=desk)', "Draft for sign-off: a job application in c0100's name to factory-7, posting rec.9, into acc-c0100, under referral rec.5."))
    .toBe("form(account=acc-c0100, client=c0100, employer=factory-7, form=draft_job_application, posting=rec.9, referral=rec.5, to=desk)");
  expect(ruled('form(account=acc-c0100, client=c0100, employer=factory-7, form=job_application, posting=rec.9, to=desk)', "Send a job application in c0100's name to factory-7, posting rec.9, into acc-c0100, under referral rec.5."))
    .toBe("form(account=acc-c0100, client=c0100, employer=factory-7, form=job_application, posting=rec.9, to=desk)");
  // (The rung 1 rerun.) A draft for sign-off that names no matter takes the one open matter of its kind from whom it is
  // for; a record blank holding what is no record (a connection's id) is not filled with it.
  expect(ruled('form(account=acc-c0100, client=c0100, employer=factory-7, form=job_application, posting=rec.9, to=desk)', "Draft for sign-off a job application in the name of c0100 to factory-7, posting rec.9, into acc-c0100."))
    .toBe("form(account=acc-c0100, client=c0100, employer=factory-7, form=draft_job_application, posting=rec.9, referral=rec.5, to=desk)");
  expect(ruled('form(account=acc-c0100, client=c0100, employer=factory-7, form=draft_job_application, posting=rec.9, referral=e-factory-1-works, to=desk)', "Draft for sign-off a job application for c0100, posting rec.9."))
    .toBe("form(account=acc-c0100, client=c0100, employer=factory-7, form=draft_job_application, posting=rec.9, referral=rec.5, to=desk)");
  // (The study counts it, 2026-11-15.) A paper for someone who handed the seat no matter (c0200) is drawn in their name:
  // outright, as asked; as a draft, with no matter, which the form asks back for. Never moved onto c0100's matter, nor
  // made for c0100, whether the model wrote the client or left it empty.
  const other = "account=acc-c0200, employer=factory-7, form=job_application, posting=rec.9, to=desk";
  expect(ruled(`form(${other}, client=c0200)`, "Send a job application in c0200's name to factory-7, posting rec.9, into acc-c0200.")).toBe(`form(account=acc-c0200, client=c0200, employer=factory-7, form=job_application, posting=rec.9, to=desk)`);
  expect(ruled(`form(${other}, client=c0200)`, "Draft for sign-off a job application in c0200's name to factory-7, posting rec.9, into acc-c0200.")).toBe("form(account=acc-c0200, client=c0200, employer=factory-7, form=draft_job_application, posting=rec.9, to=desk)");
  expect(ruled(`form(${other})`, "Draft for sign-off a job application in c0200's name to factory-7, posting rec.9, into acc-c0200.")).toBe("form(account=acc-c0200, employer=factory-7, form=draft_job_application, posting=rec.9, to=desk)");
  // An optional blank the request says there is none of is left empty.
  expect(ruled('form(connection="energy", form=supply_request, law=law-rates, lots=lot-1, owner=c0057, to=desk)', "A supply request on lot-1; no connection.")).toBe("form(form=supply_request, law=law-rates, lots=lot-1, owner=c0057, to=desk)");
  // (Rung 1's third run.) A words blank holding only the id of the matter, or of a record the paper cites, is left
  // empty; one holding the request's own act, or the paper's whole quoted words around what the matter gives for it,
  // takes the matter's words. A send citing a sign-off with no copy on it is drawn as that send, never a file entry.
  const draft = "form(account=acc-c0100, client=c0100, employer=factory-7, form=draft_job_application, posting=rec.9, referral=rec.5, to=desk";
  expect(ruled(`${draft}, trade="rec.5")`, "Draft for sign-off a job application for c0100 to factory-7, posting rec.9, into acc-c0100, under referral rec.5.")).toBe(`${draft})`);
  expect(ruled(`${draft}, trade="Draft for sign-off")`, "Draft for sign-off a job application for c0100 to factory-7, posting rec.9, into acc-c0100, under referral rec.5.")).toBe(`${draft}, trade="retail")`);
  expect(ruled(`${draft}, trade="Retail work, for c0100.")`, 'Draft for sign-off a job application for c0100, posting rec.9, referral rec.5, in the words "Retail work, for c0100."')).toBe(`${draft}, trade="retail")`);
  expect(ruled(`${draft}, trade="shop work")`, "Draft for sign-off a job application for c0100, posting rec.9, referral rec.5, trade shop work.")).toBe(`${draft}, trade="shop work")`);
  expect(ruled('statement(basis=["rec.10","rec.11"], kind=entry, text="draft rec.10 as signed off", visible=own)', "Send draft rec.10 as it was signed off under rec.11")).toBe("form(form=send_signed, sign_off=rec.11, to=desk)");
  // A draft for sign-off drawn as the send of a signed paper is a reading code knows is wrong: the translator is asked again.
  expect(misread(calls.parseProgram("form(form=send_signed, sign_off=rec.5, to=desk)"), "Draft for sign-off a job application in c0100's name; referral rec.5", k)).toContain("draft for sign-off");
  expect(misread(calls.parseProgram("form(form=send_signed, sign_off=rec.7, to=desk)"), "Send the paper signed off in rec.7 as it was signed.", k)).toBeUndefined();
  // (B3.) A request whose first words ask whom it works for something about a matter it holds is the question form, the
  // matter from the request, and what it asks about only what the request names: three Haiku runs asked the factory's
  // manager who "outside" was in a letter, which its code only acknowledges.
  const q = { ...k, forms: [...k.forms, form("form-desk-question", "question_to_client", { referral: field("record", true), client: field("entity", true), about: field("choice", true), paper: field("record"), name: field("text"), words: field("text", true) })],
    referrals: new Map([["rec.5", "c0100"], ["rec.12", "factory-1"]]), referralGives: new Map<string, { [f: string]: string }>([["rec.5", { trade: "retail" }], ["rec.12", { buyer: "outside", from_at: "factory-1-works", offer: "rec.23328", kind: "goods" }]]) };
  const asked = (request: string, program = 'message(text="?", to=["factory-1-manager"])') => calls.programText(formRules(calls.parseProgram(program), request, q));
  expect(asked("Ask the manager who 'outside' is on invoice rec.12: the buyer is given only as outside."))
    .toBe('form(about=party, client=factory-1, form=question_to_client, name="outside", referral=rec.12, to=desk, words="who \'outside\' is on invoice rec.12: the buyer is given only as outside.")');
  expect(asked("Ask the client for their payslip rec.10, for the job application rec.5.")).toBe('form(about=document, client=c0100, form=question_to_client, paper=rec.10, referral=rec.5, to=desk, words="for their payslip rec.10, for the job application rec.5.")');
  expect(asked("Ask c0100 what their account stands at, for rec.5.")).toBe('form(about=balance, client=c0100, form=question_to_client, referral=rec.5, to=desk, words="what their account stands at, for rec.5.")');
  expect(asked("Ask the client which trade they want named on rec.5.")).toBe('form(about=detail, client=c0100, form=question_to_client, name="trade", referral=rec.5, to=desk, words="which trade they want named on rec.5.")');
  // A letter that is not a question stays a letter; a question naming no matter, with two open, is left as drawn.
  expect(asked("Write to the manager: invoice rec.12 is drafted.")).toBe('message(text="?", to=["factory-1-manager"])');
  expect(asked("Ask the manager how things are going.")).toBe('message(text="?", to=["factory-1-manager"])');
  // (The stakes run's rung 1, 2026-11-15.) A record's own quoted words are not a blank's; a choice named with its value
  // is that value; a send again that names the paper sent back is the return's; a copying form named by its id is drawn
  // where nothing was; a letter in a named form's own words beside it is dropped.
  const r1 = { ...k, forms: [...k.forms, form("form-desk-report", "report", { client: field("entity", true), referral: field("record", true), done: { type: "choice", required: true, options: ["yes", "no"] }, words: field("text") }),
    form("form-desk-send-again", "send_again", { returned: field("record", true) }, { copies: "=returned" }),
    form("form-desk-scope-request", "scope_request", { agreement: field("record", true), client: field("entity", true), authority: field("entity"), matter: field("record"), words: field("text", true) })],
    records: new Set([...k.records, "rec.13121", "rec.16867"]), signed: new Map([...k.signed, ["rec.16867", { kind: "benefit_claim" }]]), returnOf: new Map([["rec.13121", "rec.16867"]]) };
  const r1d = (program: string, request: string) => calls.programText(formRules(calls.parseProgram(program), request, r1));
  expect(r1d(`${draft}, trade="Hiring: $3,000.00 every 14 days.")`, 'Draft for sign-off a job application for c0100 to factory-7, for the posting rec.9 ("Hiring: $3,000.00 every 14 days."), referral rec.5.')).toBe(`${draft})`);
  expect(r1d('form(client=c0100, form=report, referral=rec.5, to=desk, words="Sent.")', "Filing a report (form-desk-report) for c0100 on referral rec.5: done yes. Words: \"Sent.\"")).toBe('form(client=c0100, done=yes, form=report, referral=rec.5, to=desk, words="Sent.")');
  expect(r1d('form(agreement=rec.6, authority=c0100, client=c0100, form=scope_request, matter=rec.5, to=desk, words="give it")', "Request for scope (form-desk-scope-request): ask c0100 to give their authority with Millbrook Savings Bank (bank) for the desk; the matter is rec.5."))
    .toBe('form(agreement=rec.6, authority=bank, client=c0100, form=scope_request, matter=rec.5, to=desk, words="give it")');
  expect(r1d("form(form=send_again, returned=rec.13121, to=desk)", "Sending a paper again as it was (form-desk-send-again): returned rec.13121, the benefit claim.")).toBe("form(form=send_again, returned=rec.16867, to=desk)");
  expect(r1d("none(unclear)", "Sending a paper again as it was (form-desk-send-again): returned rec.16867, the benefit claim.")).toBe("form(form=send_again, returned=rec.16867, to=desk)");
  expect(r1d('form(client=c0100, done=yes, form=report, referral=rec.5, to=desk, words="All sent.")\nmessage(text="All sent", to=["bank"])', "Filing a report (form-desk-report) for c0100 on rec.5: done yes.")).toBe('form(client=c0100, done=yes, form=report, referral=rec.5, to=desk, words="All sent.")');
  // (Rung 1's rerun, 2026-11-15.) A report that mentions how a paper went ("send-signed ask-34") is not the send form; a
  // question naming its form by id keeps its own blanks; (a words blank cut short is no rule's since 2026-11-15: by score)
  // the paper's own quoted words are not another blank's.
  expect(r1d('form(client=c0100, done=yes, form=report, referral=rec.5, to=desk, words="sent as signed (send-signed ask-34)")', "Report done on rec.5: sent as signed on day 38 (send-signed ask-34, signed copy rec.7)."))
    .toBe('form(client=c0100, done=yes, form=report, referral=rec.5, to=desk, words="sent as signed (send-signed ask-34)")');
  const qProgram = 'form(about=document, client=c0100, form=question_to_client, paper=rec.10, referral=rec.5, to=desk, words="Is rec.10 still yours?")';
  expect(asked("Ask c0100 a question about matter rec.5, using form-desk-question: about document, paper rec.10; words: \"Is rec.10 still yours?\" Your other paper is rec.11.", qProgram)).toBe(qProgram);
  // An ask drawn as another form the request names in words stays that form: the rerun's four asks for a body's
  // authority, "Ask c0352 (scope request, ...)", were made questions and no scope request went.
  const qs = { ...q, forms: [...q.forms, form("form-desk-scope-request", "scope_request", { agreement: field("record", true), client: field("entity", true), authority: field("entity"), matter: field("record"), words: field("text", true) })] };
  const scope = 'form(agreement=rec.6, authority=bank, client=c0100, form=scope_request, matter=rec.5, to=desk, words="give the bank your authority")';
  expect(calls.programText(formRules(calls.parseProgram(scope), "Ask c0100 (scope request, referral rec.5, agreement rec.6) to give the bank its authority for the desk, so the bank will act on rec.5.", qs))).toBe(scope);
  // And whom the authority is with, "give Millbrook Savings Bank its authority", is that body, by the name it was shown.
  const named = { ...qs, names: new Map([["bank", "Millbrook Savings Bank"]]) };
  expect(calls.programText(formRules(calls.parseProgram(scope.replace("authority=bank", "authority=c0100").replace(" matter=rec.5,", "")), "Ask c0100 (scope request, referral rec.5, agreement rec.6) to give Millbrook Savings Bank its authority for the desk.", named))).toBe(scope);
  const bare = { ...r1, referralGives: new Map<string, { [f: string]: string }>() };
  expect(calls.programText(formRules(calls.parseProgram(`${draft}, trade="Application for the advertised job.")`), 'Draft for sign-off a job application for c0100 to factory-7, saying "Application for the advertised job.", posting rec.9, referral rec.5.', bare))).toBe(`${draft})`);
  // Nothing settled in so many words: left as the translator wrote it.
  expect(ruled('form(connection="energy", form=supply_request, law=law-rates, lots=lot-1, owner=c0057, to=desk)', "A supply request for energy."))
    .toBe('form(connection="energy", form=supply_request, law=law-rates, lots=lot-1, owner=c0057, to=desk)');
});

test("a draft the rules drew is not offered with what the model was unsure of (the rung 1 rerun, 2026-11-14)", async () => {
  // (A send drawn by rule from the request, where the model wrote nothing it was sure of, came with "Nothing was drawn
  // up ... these blanks are still empty", and was declined as "drawn up from free text".)
  const io = { adapter: new MockAdapter("mock", { translator: () => [{ type: "tool_use", id: "c0", name: "call", input: { program: "none(unclear)", sure_ppm: 40_000, withheld: "cut_off", unsure: { kind: "which" } } }] }), annotate: async () => {}, now: () => 0 };
  const r = await createTranslator(io as any, async () => ({ ok: true }), () => undefined).translate({ draftId: "d1", participant: "registry-system", as: "registry", proposal: "Send the invoice (draft rec.80) exactly as signed.", knowledge: seat() });
  expect(r.ok && r.draft.call).toBe("form(form=send_signed, sign_off=rec.81, to=registry)");
  expect((r as any).answered?.unsure).toBeUndefined();
});

// (2026-11-17, "The translator by score": each rule change scored on the scored set, nothing it hit lost, the regression
// check at zero. Each line guards one change.)
test("rules changed by score after the reruns and the broad rung (2026-11-17)", () => {
  const field = (type: string, required = false) => ({ type, ...(required ? { required: true } : {}) });
  const form = (id: string, name: string, fields: object, more: object = {}) => ({ id, data: { form: name, office: "desk", fields, ...more } });
  const k = {
    forms: [form("form-desk-send-signed", "send_signed", { sign_off: field("record", true) }, { copies: "=sign_off" }),
      form("form-desk-send-again", "send_again", { returned: field("record", true) }, { copies: "=returned" })],
    records: new Set(["rec.5", "rec.6", "rec.7", "rec.20", "rec.21"]), signed: new Map<string, any>([["rec.7", { kind: "benefit_claim" }], ["rec.21", { kind: "benefit_claim" }]]),
    signedDraft: new Map([["rec.7", "rec.6"]]), returnOf: new Map([["rec.20", "rec.21"]]),
    referrals: new Map([["rec.5", "c0100"]]), referralKind: new Map([["rec.5", "benefit_claim"]]), answeredReferrals: new Set<string>(), held: new Set(["desk"]),
  };
  const ruled = (program: string, request: string, kk: any = k) => calls.programText(formRules(calls.parseProgram(program), request, kk));
  // A return's blank takes the paper sent back, never a sign-off the request also names (r2 "-b", three sends again).
  expect(ruled("form(form=send_again, returned=rec.20, to=desk)", "Sending a paper again as it was: benefit claim rec.20, sent back by rec.21; signed copy rec.7 on file. Matter rec.5."))
    .toBe("form(form=send_again, returned=rec.21, to=desk)");
  // A send again, as it was, naming the paper sent back, drawn as that paper written anew (GLM's rerun: it went out with
  // no sign-off) or as nothing: the paper sent again. Not a draft for sign-off, nor a send naming no paper sent back.
  const loan = 'form(account=acc-c0100, amount="$4,500.00", client=c0100, form=loan_application, lender=bank, months="12", purpose="living costs")';
  expect(ruled(loan, "Send the paper rec.20 (the loan application of c0100 to bank) again, as it was, citing the paper rec.21 that bank sent back.")).toBe("form(form=send_again, returned=rec.21, to=desk)");
  expect(ruled("none(unclear)", "Send again rec.21 (loan application to bank for c0100), now that bank has recorded authority rec.6")).toBe("form(form=send_again, returned=rec.21, to=desk)");
  expect(ruled(loan, "Send the loan application of c0100 to bank again, for $4,500.00.")).toBe(loan);
  // A form named by its id beside another named by its name ("the draft-for-client form (form-…-draft-benefit-claim)"):
  // the one named by id (DeepSeek's rerun: the draft of a benefit claim went to the office as the claim itself).
  const claim = { client: field("entity", true), office: field("entity", true), payment: { type: "choice", required: true, options: ["pension", "unemployment"] } };
  const kd = { ...k, forms: [...k.forms, form("form-desk-draft-for-client", "draft_for_client", { client: field("entity", true), referral: field("record", true), words: field("text", true) }),
    form("form-desk-benefit-claim", "benefit_claim", claim, { writes: { kind: "benefit_claim" } }), form("form-desk-draft-benefit-claim", "draft_benefit_claim", { referral: field("record", true), ...claim }, { writes: { kind: "draft", data: { paper: { kind: "benefit_claim" } } } })] };
  expect(ruled("form(client=c0100, form=benefit_claim, office=outside, payment=pension)", "Fill in the draft-for-client form (form-desk-draft-benefit-claim) for client c0100: draw up a benefit claim to outside for sign-off, payment pension; referral rec.5.", kd))
    .toBe("form(client=c0100, form=draft_benefit_claim, office=outside, payment=pension, referral=rec.5, to=desk)");
  // "Question to <whom>", the form's own words for the act, drawn as a paper of another kind (Haiku's rerun: a send
  // again of a paper with no authority yet): the question form, about what the request says it is about. A letter so
  // asked stays a letter.
  const kq = { ...k, forms: [...k.forms, form("form-desk-question", "question_to_client", { referral: field("record", true), client: field("entity", true), about: { type: "choice", required: true, options: ["balance", "document", "party", "detail", "other"] }, paper: field("record"), name: field("text"), words: field("text", true) })] };
  expect(ruled("form(form=send_again, returned=rec.20, to=desk)", "Question to c0100 (about: other) on matter rec.5: bank returned rec.20 for lack of your authority. Please write to bank.", kq))
    .toBe('form(about=other, client=c0100, form=question_to_client, referral=rec.5, to=desk, words="(about: other) on matter rec.5: bank returned rec.20 for lack of your authority. Please write to bank.")');
  const letter = 'message(re=rec.5, text="please write to bank", to=c0100)';
  expect(ruled(letter, "Question to c0100 about rec.5: please write to bank.", kq)).toBe(letter);
  // "Fill in a sending-signed form", citing the sign-off: that signed copy sent (the broad rung: drawn as the paper's own
  // kind, or as nothing).
  expect(ruled("none(unclear)", "Fill in a sending-signed form: sign-off rec.7 (the signed copy of draft rec.6, benefit claim for c0100), to be sent as it was signed."))
    .toBe("form(form=send_signed, sign_off=rec.7, to=desk)");
  // A blank named with a plain word, the very value the model drew ("authority outside"), stands: "it has no authority
  // from you" further on is no request to leave it empty (DeepSeek's rerun: four scope requests went with no body named).
  const ks = { ...k, forms: [...k.forms, form("form-desk-scope-request", "scope_request", { agreement: field("record", true), client: field("entity", true), authority: field("entity"), matter: field("record"), words: field("text", true) })] };
  const scope = 'form(agreement=rec.6, authority=outside, client=c0100, form=scope_request, matter=rec.5, to=desk, words="Please give outside your authority.")';
  expect(ruled(scope, 'Fill in the scope-request form (form-desk-scope-request): client c0100; agreement rec.6; authority outside; matter rec.5; words "Please give outside your authority." outside returned the claim: it has no authority from you.', ks)).toBe(scope);
  // The paper's own words, quoted after "Words:" or "in these words:", are not a words blank the paper is not written
  // from (the reruns: sixteen job applications with them in `trade`).
  const job = { client: field("entity", true), employer: field("entity", true), posting: field("record", true), account: field("account", true), trade: field("text") };
  const kj = { ...k, forms: [...k.forms, form("form-desk-draft-job-application", "draft_job_application", { referral: field("record", true), ...job }, { writes: { kind: "draft", text: "Draft for sign-off.", data: { paper: { kind: "job_application", text: "Application for the advertised job." } } } })] };
  const drawn = "form(account=acc-c0100, client=c0100, employer=factory-7, form=draft_job_application, posting=rec.9, referral=rec.5, to=desk";
  expect(ruled(`${drawn}, trade="Application for the advertised job.")`, 'Draft for sign-off, job application in c0100\'s name to factory-7, posting rec.9, into acc-c0100. Words: "Application for the advertised job." Referral rec.5.', kj)).toBe(`${drawn})`);
  expect(ruled(`${drawn}, trade="Application for the advertised job.")`, 'Draft for sign-off, in c0100\'s name: a job application to factory-7, in these words: "Application for the advertised job.", posting rec.9, referral rec.5.', kj)).toBe(`${drawn})`);
  // A words blank holding nothing but another blank's id (`trade` "factory-7", the employer) is left empty.
  expect(ruled(`${drawn}, trade="factory-7")`, "Draft for sign-off, job application in c0100's name to factory-7, posting rec.9, into acc-c0100, referral rec.5.", kj)).toBe(`${drawn})`);
  // (The broad rung's second run.) The referral blank holding what the request calls the remit, where it names the matter
  // handed over: that matter. And a figure written once fills one blank: `for_days`, which the matter sets out nothing
  // for, holding the days to pay the matter does set out, is left empty; named in the request by its words, it stands.
  const order = { account: field("account", true), quantity: field("count", true), seller: field("entity", true), for_days: field("count"), pay_in_days: field("count") };
  const ko = { ...k, forms: [...k.forms, form("form-desk-draft-order", "draft_order", { referral: field("record", true), ...order }, { writes: { kind: "draft", data: { paper: { kind: "order" } } } })],
    records: new Set([...k.records, "rec.30", "rec.31"]), referrals: new Map([["rec.31", "shop-1"]]), referralKind: new Map([["rec.31", "order"]]),
    referralFacts: new Map([["rec.31", new Set(["account", "quantity", "seller", "pay_in_days"])]]) };
  const ord = (more: string) => `form(account=acc-shop-1, ${more}form=draft_order, pay_in_days="30", quantity="57", referral=rec.31, seller=factory-4, to=desk)`;
  expect(ruled(ord('for_days="30", ').replace("rec.31", "rec.30"), "Draft order for sign-off: 57 goods from factory-4, paid from acc-shop-1, paid within 30 days of delivery (remit rec.30, matter rec.31).", ko)).toBe(ord(""));
  expect(ruled(ord('for_days="30", '), "Draft order for sign-off: 57 goods from factory-4, paid from acc-shop-1, for days: 30, pay in days: 30, matter rec.31.", ko)).toBe(ord('for_days="30", '));
  // (The tenant's answer to the tribunal.) Two parties of one paper are not the same party: the blank named for a body
  // the seat knows by that id, holding the other party, is that body; and a list of ids holds no one's name.
  const kt = { ...k, forms: [...k.forms, form("form-desk-tribunal-response", "tribunal_response", { client: field("entity", true), tribunal: field("entity", true), landlord: field("entity", true), application: field("record", true), ages: field("list") })],
    names: new Map([["tribunal", "Civil and Administrative Tribunal"], ["landlord-10", "Property Co. 10"]]) };
  const tr = (tribunal: string, ages: string) => `form(ages=${ages}, application=rec.5, client=c0100, form=tribunal_response, landlord=landlord-10, to=desk, tribunal=${tribunal})`;
  expect(ruled(tr("landlord-10", '["Civil and Administrative Tribunal"]'), "A tribunal response in c0100's name, to tribunal (Civil and Administrative Tribunal), with a copy to landlord-10, answering application rec.5.", kt))
    .toBe("form(application=rec.5, client=c0100, form=tribunal_response, landlord=landlord-10, to=desk, tribunal=tribunal)");
  expect(ruled(tr("landlord-10", '["62"]'), "An answer in c0100's name against landlord-10, to application rec.5, ages 62.", kt)).toBe(tr("landlord-10", '["62"]'));
  // (The stakes run's rung 3.) A date, an amount or a count the request names with its value is that value: the
  // withholding report's `period_to` drawn as the due day; the tenant's `can_pay` drawn as the whole sum owed. Written as
  // the same day or figure, the model's own way of writing it stands.
  const kw = { ...k, forms: [...k.forms, form("form-desk-return", "withholding_return", { period_to: field("date"), due: field("date"), can_pay: field("amount"), owes: field("amount"), people: field("count") })] };
  expect(ruled('form(can_pay="$5,330.01", due="year 1, day 81", form=withholding_return, owes="$5,330.01", people="1", period_to="year 1, day 81", to=desk)', "Period to: year 1, day 61; due year 1, day 81; can pay 0; owes $5,330.01; people 1.", kw))
    .toBe('form(can_pay="0", due="year 1, day 81", form=withholding_return, owes="$5,330.01", people="1", period_to="year 1, day 61", to=desk)');
  expect(ruled('form(form=withholding_return, owes="5330.01", period_to="year 1, day 61, 10:00", to=desk)', "Period to year 1, day 61; owes $5,330.01.", kw)).toBe('form(form=withholding_return, owes="5330.01", period_to="year 1, day 61, 10:00", to=desk)');
});

test("a client's paper on the desk's form for it is the client's own, read back and written again: every detail, in the same units (2026-11-17)", () => {
  // (As the citizen's own code writes each: citizen/housing.rs `hunt` and `answer_tribunal`, recourse.rs `Complaint`.
  // The stakes rung 3: rental applications went on the words-only form without their listing or household, and a
  // tenant's answer on its form went with no offer, no words and its interval in seconds.)
  const own: { form: string; paper: any }[] = [
    { form: "rental_application", paper: { kind: "rental_application", text: "Application for apts-3/dwelling.2, for a household of 3.", addressed_to: ["landlord-2"], visible_to: ["c0149", "landlord-2"], basis: "rec.40",
      data: { listing: "rec.40", account: "acc-c0149", members: ["c0149", "c0150", "c0151"], household: { people: 3, bedrooms_needed: 2 } } } },
    { form: "complaint", paper: { kind: "complaint", text: "Our waste at apts-3 hasn't been collected for about 18 days.", addressed_to: ["city"], visible_to: ["c0149", "city"], data: { structure: "apts-3", about: "waste", days: 18 } } },
    { form: "tribunal_response", paper: { kind: "tribunal_response", text: "Answer to application rec.9: we say $5,330.01 is owed today; we can pay nothing toward it beyond the rent now; I live here alone (aged 63); we have nowhere else to go.",
      addressed_to: ["tribunal", "landlord-10"], visible_to: ["c0427", "tribunal", "landlord-10"], basis: "rec.9",
      data: { application: "rec.9", owes: 533001, offer: 0, every_days: 30, out_of_work_since: 1_728_000, people: 1, children: 0, ages: [63], lived_days: 200, go_to: "nowhere" } } },
  ];
  for (const { form, paper } of own) {
    const spec = clientPapers([]).find((x) => x.form === form) as any;
    const self = paper.visible_to[0];
    const read = forms.fieldsFor(spec, paper, { self, now: 0, money: (x) => x });
    expect(read, form).toBeDefined();
    const again = forms.writePaper(spec, { ...read!.fields, client: self }, { self, now: 0, money: (x) => x, ...(read!.text ? { text: read!.text } : {}) });
    expect(again, form).toMatchObject({ kind: paper.kind, text: paper.text, data: paper.data, addressed_to: paper.addressed_to });
    // (Its draft carries the paper as it would go, its words written from the fields: never a template's "{application}".)
    const draft = forms.writePaper(clientDraftOf(spec) as any, { ...read!.fields, client: self, referral: "rec.1" }, { self: "provider-a-desk", now: 0, money: (x) => x });
    expect(String((draft.data as any).paper.text), form).not.toContain("{");
  }
});
