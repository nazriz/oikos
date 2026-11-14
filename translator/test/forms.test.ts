// Forms (contracts/calls.md; docs/behaviour/directions.md): a direction filed on an office's own form. This
// repository's resolver on the table both resolvers are held to (contracts/test/forms.json; the engine's reads the
// same file in kernel/crates/resolver/src/resolve.rs), what the translator is shown of such a form, and what the
// preview says of a direction.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calls, canonical } from "@oikos/participants";
import FORMS from "../../contracts/test/forms.json";
import { formRules, formShown } from "../src/index";
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
});

test("a form's blanks the request settles in so many words are set by code: the form it names, the copy it cites, a blank it fills or leaves empty, whom the work is for (2026-11-14)", () => {
  const field = (type: string, required = false) => ({ type, ...(required ? { required: true } : {}) });
  const form = (id: string, name: string, fields: object, more: object = {}) => ({ id, data: { form: name, office: "desk", fields, ...more } });
  const job = { client: field("entity", true), employer: field("entity", true), posting: field("record", true), account: field("account", true), trade: field("text") };
  const k = {
    forms: [form("form-desk-job-application", "job_application", job, { writes: { kind: "job_application" } }), form("form-desk-draft-job-application", "draft_job_application", { referral: field("record", true), ...job }, { writes: { kind: "draft" } }),
      form("form-desk-send-signed", "send_signed", { sign_off: field("record", true) }, { copies: "=sign_off" }),
      form("form-desk-supply", "supply_request", { lots: field("list", true), law: field("record", true), owner: field("entity", true), connection: field("text") }, { writes: { kind: "supply_request" } })],
    records: new Set(["rec.5", "rec.6", "rec.7", "law-rates"]), signed: new Map([["rec.7", { kind: "job_application" }]]), signedDraft: new Map([["rec.7", "rec.6"]]),
    referrals: new Map([["rec.5", "c0100"]]), held: new Set(["desk"]),
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
  // An optional blank the request says there is none of is left empty.
  expect(ruled('form(connection="energy", form=supply_request, law=law-rates, lots=lot-1, owner=c0057, to=desk)', "A supply request on lot-1; no connection.")).toBe("form(form=supply_request, law=law-rates, lots=lot-1, owner=c0057, to=desk)");
  // Nothing settled in so many words: left as the translator wrote it.
  expect(ruled('form(connection="energy", form=supply_request, law=law-rates, lots=lot-1, owner=c0057, to=desk)', "A supply request for energy."))
    .toBe('form(connection="energy", form=supply_request, law=law-rates, lots=lot-1, owner=c0057, to=desk)');
});
