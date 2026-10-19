// The smaller faults of wave 2b's review (fault 6): a withdrawal's preview says what is withdrawn and what stops; an
// offer of employment may say the work and where it is done; a draft left unanswered when a run ends is on record as
// unanswered. (A return's sum read as money is in office-form-preview.test.ts.) No model is called.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { MockAdapter, type LlmRequest } from "@oikos/participants/llm";
import { jobTerms } from "../../participants/src/shared/common";
import { generate } from "@oikos/worlds/generator/generate";
import { Knowledge, Preview, resolve } from "@oikos/translator";
import HOLDS from "../../contracts/test/holds.json";
import { corpusOf } from "../src/corpus";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;

function seat(records: object[] = []): Knowledge {
  const k = new Knowledge(HOLDS.currency);
  k.absorb(HOLDS.observation as any);
  k.absorb({ ...(HOLDS.observation as any), channels: { more: { kind: "records", records } } });
  return k;
}
const preview = (k: Knowledge, program: string) => {
  const r = resolve(calls.parseProgram(program), k, () => undefined, "finance");
  if (!r.ok) throw new Error(r.questions.join(" "));
  return new Preview(k, k.actingFor("finance"), () => undefined, "finance").of(r.blocks);
};

test("a withdrawal says what it withdraws and what stops: a standing payment, an agreement, a hold, a paper not among the seat's own", () => {
  const job = { id: "job-c0004", record: "agreement", author: "genesis", at: 0, visible_to: ["city", "c0004"], terms: { template: "employment", parties: ["city", "c0004"], commitments: [{ who: "city", does: { outcome: { money: { to: "acc-c0004", amount: "108081" } } }, every: 14 * DAY }] } };
  const hold = { id: "rec.61", record: "statement", author: "finance-system", in_position: "finance", speaks_for: "city", at: 5, kind: "hold", text: "Please hold rec.45: nothing is to be done under it until this is withdrawn.", addressed_to: ["bank"], visible_to: ["city", "bank"], data: { holds: ["rec.45"] } };
  const k = seat([job, hold]);
  // The standing wage: its own words, and that what it pays stops.
  expect(preview(k, "statement(withdraw=rec.44)")).toBe('This does one thing: a withdrawal.\n1. You will withdraw rec.44.\n   - It is your standing request to Millbrook Bank (bank): "Please pay XYZ 2393.34 from acc-city to acc-c0003 every 14 days, for Wages.". Once it is withdrawn nothing more is to be done under it: what it pays or has done stops.');
  // The pilot's draft: the agreement's id where the wage under it was meant.
  expect(preview(k, "statement(withdraw=job-c0004)")).toBe("This does one thing: a withdrawal.\n1. You will withdraw job-c0004.\n   - It is the employment agreement itself, between you and c0004: not a payment or an order made under it. Anything standing under it is a paper of its own, and goes on until that paper is withdrawn.");
  expect(preview(k, "statement(withdraw=rec.61)")).toContain("It is your hold to Millbrook Bank (bank): \"Please hold rec.45: nothing is to be done under it until this is withdrawn.\". Withdrawing it lifts the hold: what it held is acted on again.");
  expect(preview(k, "statement(withdraw=rec.50)")).toContain('It is your notice: "The hall is closed.". Once it is withdrawn it no longer stands.');
  expect(preview(k, "statement(withdraw=rec.48)")).toContain("It has been withdrawn already.");
  expect(preview(k, "statement(withdraw=rec.900)")).toBe("This does one thing: a withdrawal.\n1. You will withdraw rec.900.\n   - No paper by that id is among your own papers as you have been shown them: check that it is the one you mean.");
  // Someone else's paper is not described: the seat was shown it, and it is not its own to withdraw.
  expect(preview(k, "statement(withdraw=rec.47)")).toContain("No paper by that id is among your own papers");
});

test("an offer of employment that says the work and where: resolved, no place-of-work warning, and the worker's place of work is read from it", () => {
  const k = seat();
  const program = 'agreement(basis=rec.50, template=employment, they_do=work(at=town-hall/workplace.1, task="works crew"), we_do=money(amount="XYZ 5127.38", every="every 30 days", to=acc-c0003), with=c0003)';
  const r = resolve(calls.parseProgram(program), k, () => undefined, "finance");
  if (!r.ok) throw new Error(r.questions.join(" "));
  const terms = (r.blocks[0] as any).terms;
  expect(terms.commitments[1]).toEqual({ who: "c0003", does: { outcome: { work: { task: "works_crew", at: "town-hall/workplace.1" } } } });
  const p = new Preview(k, k.actingFor("finance"), () => undefined, "finance").of(r.blocks);
  expect(p).toContain("   - c0003 would be bound to: do works_crew at town-hall/workplace.1.");
  expect(p).not.toContain("It names no place of work");
  expect(jobTerms({ id: "rec.9", record: "agreement", author: "x", at: 0, visible_to: "public", terms } as any, "c0003")).toMatchObject({ wage: 512738, period: 30 * DAY, workplace: "town-hall/workplace.1" });
  // Coming to a place is still read first, where both are said.
  const both = { ...terms, commitments: [...terms.commitments, { who: "c0003", does: { outcome: { occupancy: { who: "c0003", in: "depot/workplace.2" } } } }] };
  expect(jobTerms({ id: "rec.9", record: "agreement", author: "x", at: 0, visible_to: "public", terms: both } as any, "c0003").workplace).toBe("depot/workplace.2");
});

test("a draft a seat never answered before the run ended is on record as unanswered, and read as that: neither declined nor confirmed", async () => {
  const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
  let n = 0, asked = false;
  const use = (name: string, input: object) => ({ type: "tool_use" as const, id: `t${++n}`, name, input });
  // A finance seat that asks for one payment at its first sitting and then leaves the draft on its desk.
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      if (req.subject !== "finance-system" || asked) return [use("done_for_now", { days: 30 })];
      asked = true;
      return [use("do", { what: "Pay acc-outside 10.00 from acc-city for the licence.", as: "finance" })];
    },
    translator: () => [{ type: "tool_use" as const, id: `x${++n}`, name: "call", input: { program: 'money(amount="10.00", for="the licence", from=acc-city, to=acc-outside)' } }],
    debrief: () => [{ type: "text", text: "Noted." }],
  });
  const s = await runWorld({ config: generate({ ...spec, model_seats: ["finance"] }), runId: "unanswered", outDir: mkdtempSync(join(tmpdir(), "oikos-unanswered-")), until: 3 * DAY, adapter, recordObservations: "none", recordDecisions: "none" });
  expect(s.participantErrors).toBe(0);
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const drafts = log.filter((e) => e.kind === "annotation" && e.body.annotation === "draft").map((e) => e.body.draft.id);
  expect(drafts).toHaveLength(1);
  expect(log.filter((e) => e.kind === "annotation" && e.body.annotation === "signoff")).toHaveLength(0);
  const notes = log.filter((e) => e.kind === "annotation" && e.body.annotation === "note" && e.body.data?.draft_unanswered).map((e) => [e.body.subject, e.body.data.draft_unanswered]);
  expect(notes).toEqual([["finance-system", { draft: drafts[0], why: "the run ended before the seat sat again" }]]);
  const row = (await corpusOf(s.logPath)).find((x) => x.draft === drafts[0])!;
  expect(row.signoff).toEqual({ decision: "unanswered", note: "the run ended before the seat sat again" });
}, 600_000);
