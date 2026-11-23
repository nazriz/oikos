// Forms (contracts/calls.md; docs/behaviour/directions.md): a direction filed on an office's own form. This
// repository's resolver on the table both resolvers are held to (contracts/test/forms.json; the engine's reads the
// same file in kernel/crates/resolver/src/resolve.rs), what the translator is shown of such a form, and what the
// preview says of a direction.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ASSISTANT_ISSUES, calls, canonical, clientDraftOf, clientPapers, forms, ORDER } from "@oikos/participants";
import FORMS from "../../contracts/test/forms.json";
import { MockAdapter } from "@oikos/participants/llm";
import { createTranslator, formRules, formShown } from "../src/index";
import { everyIdNamed, misread, ORDER_NOT_SENT, orderUnread } from "../src/rules";
import { orderAttempt } from "../eval/orders-as-letters";
import { ASKED, EXEC_CASES, ORDER_CASES } from "../eval/executive-cases";
import { fixtureKnowledge } from "../eval/executive";
import { Knowledge } from "../src/knowledge";
import { Preview } from "../src/preview";
import { durationWords, resolve, shortOfRequired, toSigner } from "../src/resolver";

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
  // (2026-11-17) And asked for again, it is not drawn up: a signed paper goes once, as the post's own file shows it gone.
  // The town rung 2: a factory sent one signed invoice twice in a sitting, and it was paid twice.
  const again = resolve(calls.parseProgram("form(form=send_signed, sign_off=rec.81)"), k, () => undefined, "registry");
  expect(again.ok).toBe(false);
  if (!again.ok) expect(again.questions.join(" ")).toBe("This paper went already on year 1, day 4, as rec.90. A signed paper goes once: rec.81 has been sent. Nothing was done.");
  // Asked for in full, the form named by its id and the copy named, the rules draw it as asked and the world refuses it.
  const named = formRules(calls.parseProgram("none(unclear)"), "Send as signed (form-registry-send-signed): sign_off rec.81.", k);
  expect(calls.programText(named)).toContain("form=send_signed");
  const namedAgain = resolve(named as any, k, () => undefined, "registry");
  expect(!namedAgain.ok && namedAgain.questions.join(" ")).toContain("A signed paper goes once: rec.81 has been sent.");
  // The same within a sitting, confirmed and not yet on file: held as sent from the moment it is confirmed.
  const k2 = seat();
  const first = resolve(calls.parseProgram("form(form=send_signed, sign_off=rec.81)"), k2, () => undefined, "registry");
  if (!first.ok) throw new Error(first.questions.join(" "));
  k2.sending(first.blocks as unknown[], 5 * 86_400);
  expect(k2.twice(first.blocks as unknown[], 5 * 86_400 + 60)).toMatchObject({ pending: true });
  // (Only the same act within the sitting: a shop's same delivery note for the rest of an order, days later, is another act.)
  expect(k2.twice(first.blocks as unknown[], 6 * 86_400)).toBeUndefined();
  const second = resolve(calls.parseProgram("form(form=send_signed, sign_off=rec.81)"), k2, () => undefined, "registry");
  expect(!second.ok && second.questions.join(" ")).toContain("This paper went already on year 1, day 6, when you confirmed sending it.");
  // (2026-11-17, the 14-day check) A paper sent back goes again once, with the shapes the log has: the return carries the
  // paper's basis as a list, the record the post sent has it as one id. Haiku sent c0352's claim again from one return on
  // days 32 and 37, told "Nothing stands in the way right now", and a second claim was opened.
  const DAY = 86_400;
  const back = { id: "rec.16612", record: "statement", kind: "paper_returned", text: "From outside: We cannot act on rec.13137 for c0352.", at: 17 * DAY, author: "c0352-self", speaks_for: "c0352", addressed_to: ["city"], visible_to: ["c0352", "city"],
    data: { by: "outside", for: "c0352", returned: "rec.13137", paper: { basis: ["rec.13137"], data: { account: "acc-c0352", born_at: -2112480000, payment: "pension" }, kind: "benefit_claim", text: "Claim: pension.", to: ["outside"] } } };
  const went = (id: string, at: number, basis: unknown) => ({ id, record: "statement", kind: "benefit_claim", text: "Claim: pension.", at, author: "x", speaks_for: "c0352", in_position: "registry", addressed_to: ["outside"], visible_to: ["c0352", "outside", "city"], basis, data: { payment: "pension", account: "acc-c0352", born_at: -2112480000 } });
  const mine = (records: object[]) => ({ ...FORMS.observation, channels: { mine: { kind: "records", records } } }) as any;
  const sendAgain = (kk: Knowledge) => resolve(calls.parseProgram("form(form=send_again, returned=rec.16612)"), kk, () => undefined, "registry");
  // Its own confirmation first, then the record (one id where the return has a list), then asked again days later.
  const k3 = seat();
  k3.absorb(mine([went("rec.13137", 10 * DAY, "rec.13137"), back]));
  const once = sendAgain(k3);
  if (!once.ok) throw new Error(once.questions.join(" "));
  expect(new Preview(k3, "city", undefined, "registry").of(once.blocks)).not.toContain("It has gone already");
  k3.sending(once.blocks as unknown[], 32 * DAY);
  k3.absorb(mine([went("rec.26769", 32 * DAY + 60, "rec.13137")]));
  const twiceBack = sendAgain(k3);
  expect(!twiceBack.ok && twiceBack.questions.join(" ")).toBe("This paper went already on year 1, day 33, as rec.26769. A paper sent back goes again once for each time it is sent back: rec.16612 has been answered so. Nothing was done.");
  expect(new Preview(k3, "city", undefined, "registry").of(once.blocks)).toContain("It has gone already: this same paper was sent as rec.26769");
  // Written out word for word, citing what it cited or the return it answers (as the code desk sends one again), the same.
  for (const basis of ["rec.13137", "rec.16612"]) {
    const written = resolve(calls.parseProgram(`statement(basis=${basis}, data={"account":"acc-c0352","born_at":-2112480000,"payment":"pension"}, for=c0352, kind=benefit_claim, text="Claim: pension.", to=["outside"])`), k3, () => undefined, "registry");
    expect(!written.ok && written.questions.join(" ")).toContain("rec.16612 has been answered so.");
  }
  // The record first, as a seat's file is read at a fork, with the list on the record and the paper's details in another order.
  const k4 = seat();
  k4.absorb(mine([{ ...went("rec.26769", 32 * DAY, ["rec.13137"]), data: { born_at: -2112480000, account: "acc-c0352", payment: "pension" } }, back]));
  expect(!sendAgain(k4).ok).toBe(true);
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
  // (The broad rung's second run.) The days to pay drawn into the count the matter sets nothing for, and the quantity
  // into the days to pay: moved back. A price each the request writes once is the price each, not the total.
  const ko2 = { ...ko, forms: [...k.forms, form("form-desk-draft-order2", "draft_order", { referral: field("record", true), ...order, unit_price: { type: "amount", description: "The price of each, as the seller advertises it." } })] };
  expect(ruled('form(account=acc-shop-1, for_days="30", form=draft_order, pay_in_days="57", quantity="57", referral=rec.31, seller=factory-4, to=desk, unit_price="$7,254.39")', "Draft order for sign-off: 57 food from factory-4 at $127.27 each ($7,254.39), paid from acc-shop-1 within 30 days of delivery, matter rec.31.", ko2))
    .toBe('form(account=acc-shop-1, form=draft_order, pay_in_days="30", quantity="57", referral=rec.31, seller=factory-4, to=desk, unit_price="$127.27")');
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
  // (The broad rung's second run.) The model's doubt about which id is no question for the seat where every id of the
  // draft is one the seat wrote beside its blank; it stands where an id is not so written, or two are written there.
  const rates = calls.parseProgram('form(account=acc-city, amount="$684.95", form=draft_rates_notice, law=law-rates, lots=lot-31-18, owner=c0003, referral=rec.24906, to=rates-assistant)');
  expect(everyIdNamed(rates, "Draft for sign-off a rates notice: owner c0003; lots lot-31-18; amount $684.95; account acc-city; law law-rates; referral rec.24906.")).toBe(true);
  expect(everyIdNamed(rates, "Draft for sign-off a rates notice to c0003 for lot-31-18; amount $684.95; account acc-city; law law-rates; referral rec.24906.")).toBe(false);
  expect(everyIdNamed(rates, "Draft for sign-off a rates notice: owner c0003; lots lot-31-18, lot-31-19; amount $684.95; account acc-city; law law-rates; referral rec.24906.")).toBe(false);
  expect(everyIdNamed(rates, "Draft a rates notice: owner c0003, or owner c0004; lots lot-31-18; account acc-city; law law-rates; referral rec.24906.")).toBe(false);
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
  // (The translator worker's redraw of the real asks on these forms, 2026-11-17.)
  const answer = clientPapers([]).find((x) => x.form === "tribunal_response") as any;
  const base = { client: "c0427", tribunal: "tribunal", landlord: "landlord-10", application: "rec.9" };
  const write = (more: object) => forms.writePaper(answer, { ...base, ...more } as any, { self: "c0427", now: 0, money: (x) => x });
  // The words already opening with what the paper's words open with: said once, never twice.
  expect(write({ words: "Answer to application rec.9: we have nowhere else to go." }).text).toBe("Answer to application rec.9: we have nowhere else to go.");
  expect(write({ words: "we have nowhere else to go." }).text).toBe("Answer to application rec.9: we have nowhere else to go.");
  // Ages: two written together are the two; a word or a name is asked back in plain words.
  expect((write({ ages: ["30, 3"] }).data as any).ages).toEqual([30, 3]);
  expect((write({ ages: ["30 and 3", "7"] }).data as any).ages).toEqual([30, 3, 7]);
  for (const bad of ["one", "Ann"]) expect(() => write({ ages: [bad] })).toThrow(`The ages are whole numbers, written in figures, each on its own: "${bad}" is not one.`);
  // Counts written as words, one to twenty, read as numbers; the home is a dwelling, by the form's own type.
  expect([calls.parseCount("four"), calls.parseCount("two"), calls.parseCount("twenty")]).toEqual([4, 2, 20]);
  expect((clientPapers([]).find((x) => x.form === "rental_application") as any).fields.home.type).toBe("space");
  // The tenant's words come from the hand-over unless the request quotes words for them: never "pay", never the
  // request's own act. A draw that quotes them keeps them.
  const draftAnswer = { id: "form-desk-draft-tribunal-response", data: { ...clientDraftOf(answer), office: "desk" } };
  const kw = { forms: [draftAnswer], records: new Set(["rec.5", "rec.9"]), signed: new Map(), signedDraft: new Map(), returnOf: new Map(), referrals: new Map([["rec.5", "c0427"]]), referralKind: new Map([["rec.5", "tribunal_response"]]),
    answeredReferrals: new Set<string>(), held: new Set(["desk"]), handedWords: new Map([["rec.5", "Answer to application rec.9: we say $5,330.01 is owed today; we have nowhere else to go."]]) };
  const drawn = (words: string, request: string) => calls.programText(formRules(calls.parseProgram(`form(application=rec.9, client=c0427, form=draft_tribunal_response, landlord=landlord-10, referral=rec.5, to=desk, tribunal=tribunal, words="${words}")`), request, kw as any));
  for (const w of ["pay", "Draft for sign-off"]) expect(drawn(w, "Draft for sign-off the tenant's answer for c0427, referral rec.5, can pay 0.")).toContain('words="we say $5,330.01 is owed today; we have nowhere else to go."');
  expect(drawn("we cannot pay", 'Draft the answer for c0427, referral rec.5, in the words "we cannot pay".')).toContain('words="we cannot pay"');
});

// (The stakes run's rung 3, the housing wants, 2026-11-18.) Nothing drawn, where the request names a form by its id and
// every blank it requires by name with its value: that form, those blanks. Not where a required blank is not named.
test("a form the request names, with every blank it requires named, is drawn from the request when the model drew nothing", () => {
  const field = (type: string, required = false) => ({ type, ...(required ? { required: true } : {}) });
  const stay = { referral: field("record", true), client: field("entity", true), landlord: field("entity", true), lease: field("record", true), notice: field("record", true), home: field("text", true) };
  const k = { forms: [{ id: "form-desk-draft-stay-on-request", data: { form: "draft_stay_on_request", office: "desk", fields: stay } }], records: new Set(["rec.5", "rec.6"]), signed: new Map(), signedDraft: new Map(),
    referrals: new Map([["rec.5", "c0100"]]), answeredReferrals: new Set<string>(), held: new Set(["desk"]), names: new Map([["landlord-12", "Landlord 12"]]) };
  const drawn = (request: string) => calls.programText(formRules(calls.parseProgram("none(unclear)"), request, k as any));
  expect(drawn("Fill in form-desk-draft-stay-on-request: client c0100; landlord landlord-12; lease lease-c0100; home apts-12/dwelling.12; notice rec.6; referral rec.5."))
    .toBe('form(client=c0100, form=draft_stay_on_request, home="apts-12/dwelling.12", landlord=landlord-12, lease=lease-c0100, notice=rec.6, referral=rec.5, to=desk)');
  expect(drawn("Fill in form-desk-draft-stay-on-request: client c0100; landlord landlord-12; lease lease-c0100; notice rec.6; referral rec.5.")).toBe("none(unclear)");
});

test("an order's words say what it does, and money reads as money however the sum is given (2026-11-17)", () => {
  // (The town rung 2: orders on 30-day terms said "Paid with this order", and four seats held delivery notes over it; a
  // code assistant's orders read "102 food at 12727 each".)
  const money = (a: string) => `$${(Number(a) / 100).toFixed(2)}`;
  const base = { seller: "factory-10", kind: "food", quantity: 102, deliver_to: "shop-9", at: "shop-9-premises", account: "acc-shop-9" };
  const write = (more: object) => forms.writePaper(ORDER as any, { ...base, ...more } as any, { self: "shop-9", now: 0, money }).text;
  expect(write({ unit_price: "12727", paid_within_days_of_delivery: 30 })).toBe("Order: 102 food at $127.27 each, delivered to shop-9 at shop-9-premises. To be paid within 30 days of delivery, on your terms.");
  expect(write({ unit_price: "12727" })).toBe("Order: 102 food at $127.27 each, delivered to shop-9 at shop-9-premises. Paid with this order.");
  expect(write({ unit_price: 12727 })).toContain("at $127.27 each");
});

test("a matter that is the same paper to each of several is drafted as one, each paper as the matter gives it, for one sign-off (2026-11-17)", () => {
  // (The town rung 2: the rates seat drafted a run's 204 notices one by one, 204 sign-offs, 46% of the run's cost.)
  const k = seat();
  const notice = { form: "rates_notice", fields: { owner: { type: "entity", required: true }, amount: { type: "amount", required: true }, lots: { type: "list", required: true } },
    writes: { kind: "rates_notice", text: "Rates notice: {amount} on {lots}.", to: ["=owner"], visible: ["=self", "=owner"], data: { amount: "#amount", lots: "=lots" } } };
  const facts = { papers: [{ owner: "c1", amount: "68495", lots: ["lot-1"] }, { owner: "c2", amount: "62147", lots: ["lot-2"] }], composed_on: [{ spec: notice, bind: null }, { spec: notice, bind: null }] };
  const batch = (ASSISTANT_ISSUES as any[]).find((x) => x.form === "draft_as_handed");
  k.absorb({ ...FORMS.observation, channels: { mine: { kind: "records", records: [
    { id: "form-registry-draft-as-handed", record: "statement", kind: "form", text: "Draft as handed.", at: 0, author: "x", speaks_for: "city", visible_to: ["city"], data: { ...batch, office: "registry", submit_as: "registry", submit_to: ["registry"] } },
    { id: "rec.70", record: "statement", kind: "referral", text: "For you to draft for sign-off: rates notices.", at: 86_400, author: "y", speaks_for: "city", addressed_to: ["registry"], visible_to: ["city"], data: { kind: "rates_notice", wants: "draft", depth: "matter", facts } },
  ] } } } as any);
  const r = resolve(calls.parseProgram("form(form=draft_as_handed, referral=rec.70, to=registry)"), k, () => undefined, "registry");
  if (!r.ok) throw new Error(r.questions.join(" "));
  const papers = (r.blocks[0] as any).data.papers;
  expect((r.blocks[0] as any).kind).toBe("draft");
  expect(papers.map((p: any) => [p.kind, p.to, p.data.amount])).toEqual([["rates_notice", ["c1"], 68495], ["rates_notice", ["c2"], 62147]]);
  expect(papers[0].text).toBe("Rates notice: XYZ 684.95 on lot-1.");
  // Named by its id with its one blank, drawn as named (rule fromNamed), and so drafted whole.
  const named = formRules(calls.parseProgram("none(unclear)"), "Fill in form-registry-draft-as-handed: referral rec.70.", k);
  expect(calls.programText(named)).toBe("form(form=draft_as_handed, referral=rec.70, to=registry)");
  const asNamed = resolve(named as any, k, () => undefined, "registry");
  if (!asNamed.ok) throw new Error(asNamed.questions.join(" "));
  expect((asNamed.blocks[0] as any).data.papers).toHaveLength(2);
  // (An office's own matter: the draft goes to the office, its signer, as before.)
  expect([(r.blocks[0] as any).addressed_to, (r.blocks[0] as any).visible_to]).toEqual([["city"], ["city"]]);
  // (2026-11-17, the 14-day check) A draft goes to whoever signs it: at a desk, the client whose matter it is, and every
  // draft form so, whatever its template names: no draft of an assistant post's goes to its own organisation unless that
  // organisation is the matter's principal. A matter of one paper is drafted on its own form, not copied out of the hand-over.
  const desk = seat();
  const drafts = [...(ASSISTANT_ISSUES as any[]).filter((x) => x.writes?.kind === "draft"), ...clientPapers([]).map((x: any) => clientDraftOf(x))];
  desk.absorb({ ...FORMS.observation, channels: { mine: { kind: "records", records: [
    ...drafts.map((x, i) => ({ id: `form-registry-d${i}`, record: "statement", kind: "form", text: x.form, at: 0, author: "x", speaks_for: "city", visible_to: ["city"], data: { ...x, office: "registry", submit_as: "registry", submit_to: ["registry"] } })),
    { id: "rec.80", record: "statement", kind: "referral", text: "For you to draft.", at: 86_400, author: "c9-self", speaks_for: "c9", addressed_to: ["registry"], visible_to: ["city", "c9"], data: { kind: "rates_notice", wants: "draft", facts } },
    { id: "rec.81", record: "statement", kind: "referral", text: "For you to draft.", at: 86_400, author: "c9-self", speaks_for: "c9", addressed_to: ["registry"], visible_to: ["city", "c9"], data: { kind: "rates_notice", wants: "draft", facts: { papers: [facts.papers[0]], composed_on: [facts.composed_on[0]] } } },
  ] } } } as any);
  const toClient = resolve(calls.parseProgram("form(form=draft_as_handed, referral=rec.80, to=registry)"), desk, () => undefined, "registry");
  if (!toClient.ok) throw new Error(toClient.questions.join(" "));
  expect([(toClient.blocks[0] as any).addressed_to, (toClient.blocks[0] as any).visible_to, (toClient.blocks[0] as any).data.papers.length]).toEqual([["c9"], ["city", "c9"], 2]);
  const single = resolve(calls.parseProgram("form(form=draft_as_handed, referral=rec.81, to=registry)"), desk, () => undefined, "registry");
  expect(!single.ok && single.questions.join(" ")).toContain("rec.81 is not the same paper to each of several");
  for (const d of drafts) {
    const as = (x: string) => (x === "=self" ? "city" : "c9");
    const p = { kind: d.writes.kind, addressed_to: (d.writes.to ?? []).map(as), visible_to: (d.writes.visible ?? []).map(as), data: { referral: "rec.80" } };
    expect(toSigner(p as { kind: string; addressed_to?: string[] }, "city", desk).addressed_to as string[], d.form).toEqual(["c9"]);
  }
  // (2026-11-17, the 14-day check) A blank the body a paper goes to publishes it needs is asked for before anything is
  // drawn, in a draft for sign-off too: c0485's review request went to the support office without the decision it was
  // about, twice, and came back to the client. Only where the body says so: a landlord asked to repair needs no paper.
  desk.absorb({ ...FORMS.observation, channels: { notices: { kind: "records", records: [{ id: "rec.5", record: "statement", kind: "requirements", text: "What outside needs.", at: 0, author: "o", speaks_for: "outside", visible_to: "public",
    data: { requires: { items: { review_request: [{ field: "about", says: "the decision to look at again, by its reference" }] }, authority: [] } } }] } } } as any);
  const review = (data: object, to = "outside") => [{ block: "publish", kind: "draft", addressed_to: ["c9"], data: { referral: "rec.80", paper: { kind: "review_request", to: [to], data } } }];
  expect(shortOfRequired(review({ matter: "claim_refused" }), desk)).toBe("outside publishes that a review request sent to it must give the decision to look at again, by its reference; this one leaves about empty. Nothing was drawn up: say it again with it.");
  expect(shortOfRequired(review({ matter: "claim_refused", about: "rec.6709" }), desk)).toBeUndefined();
  expect(shortOfRequired(review({ matter: "disrepair" }, "landlord-11"), desk)).toBeUndefined();
});

// (The check runs, 2026-11-19.) The body a scope request names in "give authority to the desk to act for them with
// <body>" or "give <body>'s authority" is its `authority`, never the client; a list the request names with whole numbers
// ("ages: 62", "Ages: 30, 3.") is those numbers; a quote right after a blank's name is not its value.
test("the body a scope request names, and a list of numbers named by its blank (the check runs, 2026-11-19)", () => {
  const field = (type: string, required = false) => ({ type, ...(required ? { required: true } : {}) });
  const k = { forms: [{ id: "form-desk-scope-request", data: { form: "scope_request", office: "desk", fields: { agreement: field("record", true), client: field("entity", true), authority: field("entity"), matter: field("record"), words: field("text", true) } } },
    { id: "form-desk-tribunal-response", data: { form: "tribunal_response", office: "desk", fields: { client: field("entity", true), application: field("record", true), ages: field("list") } } }],
    records: new Set(["rec.5", "rec.6"]), signed: new Map(), signedDraft: new Map(), referrals: new Map([["rec.5", "c0100"]]), answeredReferrals: new Set<string>(), held: new Set(["desk"]), names: new Map<string, string>() };
  const ruled = (program: string, request: string) => calls.programText(formRules(calls.parseProgram(program), request, k as any));
  const scope = (who: string) => `form(agreement=rec.6, authority=${who}, client=c0100, form=scope_request, matter=rec.5, to=desk, words="give it")`;
  expect(ruled(scope("c0100"), "Request scope from c0100 (agreement rec.6): ask c0100 to give authority to desk to act for them with bank on their loan application rec.5.")).toBe(scope("bank"));
  expect(ruled(scope("desk"), "Scope request to c0100 (agreement rec.6): ask c0100 to give bank's authority for desk to act for them on rec.5.")).toBe(scope("bank"));
  const tr = (ages: string) => `form(ages=${ages}, application=rec.5, client=c0100, form=tribunal_response, to=desk)`;
  expect(ruled(tr("c0100"), "Draft the tribunal response for c0100: application rec.5; ages: 62; people: 1.")).toBe(tr('["62"]'));
  expect(ruled(tr('["30, 3"]'), "Draft the tribunal response for c0100: application rec.5. Ages: 30, 3.")).toBe(tr('["30","3"]'));
  expect(ruled(tr("c0100"), 'Fill in the tribunal response. Its blank "ages" is filled in with the client. Application rec.5.')).toBe(tr("c0100"));
  // (2026-11-20.) "Ask <client> for their authority to <body>: under agreement …" is the scope request with the body,
  // even "no authority from them" in it; a question about a paper stays a question.
  const kq = { ...k, forms: [...k.forms, { id: "form-desk-question", data: { form: "question_to_client", office: "desk", fields: { referral: field("record", true), client: field("entity", true), about: { type: "choice", required: true, options: ["balance", "document", "party", "detail", "other"] }, paper: field("record"), words: field("text", true) } } }] };
  const ruledQ = (program: string, request: string) => calls.programText(formRules(calls.parseProgram(program), request, kq as any));
  expect(ruledQ(scope("c0100"), "Ask c0100 for their authority to bank: under agreement rec.6, to write to bank naming desk, on rec.5; bank returned it saying it had no authority from them.")).toBe(scope("bank"));
  expect(ruledQ('message(text="is rec.6 yours?", to=c0100)', "Ask c0100 whether rec.6 is their paper, on rec.5.")).toContain("form=question_to_client");
});

// (A mayor's forms, drawn by the rules from a request that names their blanks where the model drew nothing: an amendment
// never goes as a change of no figure, and a list the request names is never dropped. docs/decisions.md, "The translator
// on a mayor's powers".)
test("a form drawn from its named blanks reads a length of time, and never drops what the request changes", () => {
  const k = fixtureKnowledge();
  const none = calls.parseProgram("none(unclear)");
  const drawn = (request: string) => calls.programText(formRules(none, request, k as any));
  expect(drawn("Fill in form-amend-tenancy: notice 90 days, affects tenants")).toContain('notice="90 days"');
  // (The tenant's notice is its own blank, not the landlord's.)
  expect(drawn("Fill in form-amend-tenancy: tenant's notice 30 days, affects tenants")).not.toContain('notice="30 days", tenant');
  expect(drawn("Fill in form-amend-tenancy: affects tenants, the notice as we discussed")).toBe("none(unclear)");
  expect(drawn('Fill in form-nomination: office mayor, name "Dana Okafor", platform "Safe homes.", values: honesty, thrift')).toBe("none(unclear)");
  for (const c of [...EXEC_CASES, ...ORDER_CASES]) if (c.want !== ASKED) expect(calls.contractErrors(calls.parseProgram(c.want))).toEqual([]);
});

// (An order to an office is given on its form: a letter would go out and direct nothing. docs/decisions.md, "An order to
// an office is not a letter".)
test("an order to an office the seat directs is drawn as its direction or asked back, and a letter stays a letter", () => {
  const k = fixtureKnowledge();
  const letter = (to: string, text: string) => calls.parseProgram(`message(to="${to}", text="${text}")`);
  const drawn = (request: string, to: string) => calls.programText(formRules(letter(to, "words"), request, k as any));
  expect(drawn("Tell the works office to stop recruiting.", "the works office")).toContain("form=works_staffing");
  expect(drawn("Tell the works office to stop recruiting.", "the works office")).toContain("recruit=no");
  expect(drawn("Order the rates office to resume charging interest.", "the rates office")).toContain("interest=yes");
  // (What turns the sense of the order is not read: nothing goes out.)
  for (const request of ["Tell the rates office to stop waiving interest.", "Tell the works office to end the recruitment freeze.", "Tell the rates office to go easy on people."]) {
    const to = /rates/.test(request) ? "the rates office" : "the works office";
    const p = formRules(letter(to, "words"), request, k as any);
    expect(orderUnread(p, request, k as any)?.startsWith(ORDER_NOT_SENT)).toBe(true);
    expect(misread(p, request, k as any)).toBeDefined();
    expect(orderAttempt({ ref: "r", seq: 1, seat: "s", request, failure: orderUnread(p, request, k as any) }, k)?.kind).toBe("asked_back");
  }
  // (A letter, and an order from a seat the town's rule does not name, are left as they are.)
  for (const request of ["Write to the works office asking how many crew it has.", "Tell the works office that the crew did well."]) expect(orderUnread(letter("the works office", "words"), request, k as any)).toBeUndefined();
  const other = Object.assign(Object.create(Object.getPrototypeOf(k)), k, { held: new Set(["councillor-1"]) });
  expect(orderUnread(letter("the works office", "words"), "Tell the works office to stop recruiting.", other)).toBeUndefined();
  expect(orderAttempt({ ref: "r", seq: 1, seat: "s", request: "x", call: 'message(to="the works office", text="words")', decision: "accept" }, k)).toEqual({ kind: "letter", office: "works", decision: "accept" });
});
