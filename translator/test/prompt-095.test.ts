// The translator's instructions, 0.9.5 (docs/design/translator-round-3.md, section 1): the call language gained since
// 0.9.4, taught. A payment's budget line, an agreement's hours, a notice of a practice and an offer anyone may take up.
// Sentences and worked examples only; nothing removed. No model is called.

import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import { rustRule } from "../../orchestrator/src/rust-world";
import TABLE from "../../contracts/test/payments.json";
import { CASES } from "../eval/cases";
import { translatorSystem, TRANSLATOR_VERSION } from "../src/index";
import { Knowledge } from "../src/knowledge";
import { resolve } from "../src/resolver";

const seat = () => { const k = new Knowledge(TABLE.currency as any); k.absorb(TABLE.seats.finance as any); return k; };
const system = translatorSystem();
const worked = (needle: string) => {
  const l = system.split("\n").find((x) => x.includes(needle) && x.includes("  ->  "));
  if (!l) throw new Error(`no worked example with ${needle}`);
  return l.split("  ->  ")[1]!;
};

test("0.9.5: the sentences are there, in general words", () => {
  expect(TRANSLATOR_VERSION).toBe("0.9.5");
  for (const said of [
    "carries line=<that line, as the request names it>",
    "a request that names no line gives none",
    "A line is not an account",
    "hours= is the job's ordinary hours in a week",
    "only where the request states them",
    "A notice of something held again and again at a place",
    "one statement, never an agreement and never a form",
    "An offer that anyone may take up",
    "which is between named parties",
    "amounts and lengths of time are copied as the request writes them, as text",
  ]) expect(system).toContain(said);
  // `line` is taught: it is in the functions' list, and nothing is code's alone now.
  expect(system).toMatch(/- money\(to\*, amount\*, from, every, first, for, settles, basis, per_request, line\)/);
  // (Since 2026-10-17 one argument is code's alone: `system(..., to=)`, the client a vendor delivers a system to; nothing else, and none the prompt shows.)
  expect(Object.fromEntries(Object.entries(calls.CODE_ARGS).map(([k, v]) => [k, [...v]]))).toEqual({ system: ["to"] });
});

test("0.9.5: every new worked example is a program of the contract, and the line, hours, practice and offer are in them", () => {
  for (const needle of ["line=parks", "hours=\"40 hours\"", "practice={", "offer={"]) {
    const program = worked(needle);
    expect(calls.contractErrors(calls.parseProgram(program))).toEqual([]);
  }
  // (And the same request without a line gives a payment without one.)
  expect(system).toContain('->  money(to=acc-9, amount="4,200", from=acc-1, for="the mowing")');
});

test("0.9.5: the seen cases r95-* have each ruling both ways, every accepted answer a program of the contract", () => {
  const added = CASES.filter((c) => c.id.startsWith("r95-"));
  expect(added.length).toBe(10);
  for (const c of added) for (const e of c.expect) expect({ id: c.id, errors: calls.contractErrors(calls.parseProgram(e)) }).toEqual({ id: c.id, errors: [] });
  const has = (id: string, text: string) => expect(CASES.find((c) => c.id === id)!.expect.some((e) => e.includes(text))).toBe(true);
  const lacks = (id: string, text: string) => expect(CASES.find((c) => c.id === id)!.expect.every((e) => !e.includes(text))).toBe(true);
  has("r95-line-named", "line=parks"); lacks("r95-line-none", "line=");
  lacks("r95-line-not-account", "line=");
  has("r95-hours-stated", "hours="); lacks("r95-hours-none", "hours=");
  has("r95-practice", "practice="); lacks("r95-practice", "agreement(");
  has("r95-offer-join", "offer="); has("r95-offer-to-named", "agreement(");
});

test("0.9.5: the line resolves onto the payment, and a statement with a practice or an offer resolves to the notice the founding module accepts", () => {
  const k = seat();
  // The line, on a payment from an account the seat's office keeps.
  const pay = resolve(calls.parseProgram('money(to=acc-c0003, amount="XYZ 42.00", from=acc-city, for="the mowing", line=parks)'), k, () => undefined, "finance");
  expect(pay.ok ? [] : pay.questions).toEqual([]);
  expect(JSON.stringify(pay.ok ? pay.blocks : [])).toContain('"line":"parks"');
  // The worked gathering and offer, as the translator would write them for the founding requests, resolve to a notice the module accepts.
  const gather = resolve(calls.parseProgram('statement(kind=notice, visible=public, text="The Circle gathers every fortnight.", on=cell.4.7, practice={"at":"apts-3/dwelling.2","every":"14 days","lasts":"90 minutes"})'), k, () => undefined, "finance", { written: true });
  expect(gather.ok ? [] : gather.questions).toEqual([]);
  // (What the founding module accepts is the engine's: kernel/crates/actors/src/mind/founding.rs, by the shared rules.)
  const blocks = (gather.ok ? gather.blocks : []).map((b: any) => ({ ...b, speaks_for: "org-1" }));
  expect(rustRule("founding.accept_gathering", { me: "org-1", at: "apts-3/dwelling.2", every_days: [14], lasts_minutes: [90], first: [0, 30 * 86_400], at_seconds: 68_400, blocks })).toHaveProperty("ok");
  const join = resolve(calls.parseProgram('statement(kind=notice, visible=public, text="Anyone may join.", offer={"take_up":"join","terms":{"commitments":[{"who":"taker","does":{"outcome":{"money":{"to":"acc-9","amount":"20","for":"dues"}}},"every":"a month"}],"termination":[{"party":"taker","notice":"7 days"}]}})'), k, () => undefined, "finance", { written: true });
  expect(join.ok ? [] : join.questions).toEqual([]);
  const offered = (join.ok ? join.blocks : []).map((b: any) => ({ ...b, speaks_for: "org-1" }));
  expect(rustRule("founding.accept_membership", { me: "org-1", account: "acc-9", dues: [2000], notice: 604800, blocks: offered })).toHaveProperty("ok");
});

test("0.9.5: a practice's and an offer's amounts and lengths of time are as the request wrote them, read in the world's money and in seconds; whole numbers pass as they are", () => {
  const k = seat();
  const gather = resolve(calls.parseProgram('statement(kind=notice, visible=public, text="x", on=cell.4.7, practice={"at":"apts-3/dwelling.2","every":"14 days","lasts":"90 minutes"})'), k, () => undefined, "finance", { written: true });
  expect((gather.ok ? (gather.blocks[0] as any) : {}).practice).toEqual({ at: "apts-3/dwelling.2", every: 1_209_600, lasts: 5400 });
  const seconds = resolve(calls.parseProgram('statement(kind=notice, visible=public, text="x", practice={"at":"apts-3/dwelling.2","every":1209600})'), k, () => undefined, "finance", { written: true });
  expect((seconds.ok ? (seconds.blocks[0] as any) : {}).practice).toEqual({ at: "apts-3/dwelling.2", every: 1_209_600 });
  const notTime = resolve(calls.parseProgram('statement(kind=notice, visible=public, text="x", practice={"at":"apts-3/dwelling.2","every":"often"})'), k, () => undefined, "finance", { written: true });
  expect(notTime.ok).toBe(false);
  const join0 = resolve(calls.parseProgram('statement(kind=notice, visible=public, text="Anyone may join.", offer={"take_up":"join","terms":{"commitments":[{"who":"taker","does":{"outcome":{"money":{"to":"acc-9","amount":"XYZ 20.00","for":"dues"}}},"every":"a month"}],"termination":[{"party":"taker","notice":"7 days"}]}})'), k, () => undefined, "finance", { written: true });
  expect((join0.ok ? (join0.blocks[0] as any) : {}).offer.terms).toMatchObject({ commitments: [{ every: 2_592_000 }], termination: [{ notice: 604_800 }] });
  const join = resolve(calls.parseProgram('statement(kind=notice, visible=public, text="Anyone may join.", offer={"take_up":"join","terms":{"commitments":[{"who":"taker","does":{"outcome":{"money":{"to":"acc-9","amount":"XYZ 20.00","for":"dues"}}},"every":2592000}]}})'), seat(), () => undefined, "finance", { written: true });
  expect(join.ok ? [] : join.questions).toEqual([]);
  const money = (join.ok ? (join.blocks[0] as any) : {}).offer.terms.commitments[0].does.outcome.money;
  expect(money).toEqual({ to: "acc-9", amount: "2000", for: "dues" });
  // (A code participant's offer already says the smallest unit, and is passed on as it is.)
  const code = resolve(calls.parseProgram('statement(kind=notice, visible=public, text="x", offer={"take_up":"join","terms":{"commitments":[{"who":"taker","does":{"outcome":{"money":{"to":"acc-9","amount":"2000"}}}}]}})'), seat(), () => undefined, "finance");
  expect((code.ok ? (code.blocks[0] as any) : {}).offer.terms.commitments[0].does.outcome.money.amount).toBe("2000");
  // (Not an amount: the seat is asked to say it another way.)
  const bad = resolve(calls.parseProgram('statement(kind=notice, visible=public, text="x", offer={"take_up":"join","terms":{"commitments":[{"who":"taker","does":{"outcome":{"money":{"to":"acc-9","amount":"plenty"}}}}]}})'), seat(), () => undefined, "finance", { written: true });
  expect(bad.ok).toBe(false);
});
