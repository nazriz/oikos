// The debrief of every seat after every run, and exit accounts of a sample of a town's people, in running towns
// (VISION 15, point 7; docs/behaviour/debrief.md). The script itself is tested in participants/test/debrief.test.ts.
// - A mock seat end to end through a mock pilot: debriefed before the run is finished, reported, exported, listed.
// - What a seat keeps back is in the run's own files and in nothing published; only that it chose so is.
// - A seat that left the study is asked by the shorter variant; a run at its spending limit still debriefs.
// - The summary is made from the log, bounded, and in neutral words: none of a stated list of words that weigh.
// - A resumed run is served its debrief's calls from the log.
// - Debrief answers are in no training export.
// - Exit accounts: only with the composer on; with it off no model is called.

import { afterAll, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAdapter, mockPolicies, type LlmAdapter, type LlmRequest } from "@oikos/participants/llm";
import { generate } from "@oikos/worlds/generator/generate";
import { loadWorld, withPlatformOverrun } from "../src/batch";
import { corpusOf } from "../src/corpus";
import { exportDataset } from "../src/dataset";
import { besideOf, bySize, EVALUATIVE, idsFrom, largest, leftAlone, renderSummary, SeatRecords, SUMMARY_MAX } from "../src/debrief-summary";
import { ASKED_WITHOUT_CHOICE, DEBRIEF_RESTRICTION, debriefCounts, debriefRows, debriefsOf, debriefsReport, OLD_LOG_NOT_PUBLISHABLE } from "../src/debriefs";
import { situationsOf } from "../src/in-situ";
import { debriefsBeside, readLog } from "../src/logs";
import { pilotReport, renderReport, reportOfLog } from "../src/pilot-report";
import { runState } from "../src/pilot-state";
import { recordedCalls, Serving } from "../src/resume";
import { readForEnd } from "../src/run-end";
import { runWorld } from "../src/run";
import { mockPilot } from "../../scripts/pilot-mock";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = realpathSync(mkdtempSync(join(tmpdir(), "oikos-debrief-test-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const lines = (path: string) => readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const NS = "urn:oikos:contracts:0.8";
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
for (const f of readdirSync(join(root, "contracts")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(JSON.parse(readFileSync(join(root, "contracts", f), "utf8")));
const valid = (def: string, row: unknown) => { const v = ajv.getSchema(`${NS}:dataset#/$defs/${def}`)!; if (!v(row)) throw new Error(`${def}: ${JSON.stringify(v.errors).slice(0, 600)}`); return true; };

/** A town with a model (the mock) as mayor and in the finance office; the council has adopted no budget, so the mayor proposes one. */
function town(tweak: (c: any) => void = () => {}) {
  const c = generate({ ...spec, citizens: 60, mayor: "llm", model_seats: "finance", opening_budget: false });
  tweak(c);
  return c;
}
const seatOf = (c: any, id: string) => c.participants.find((x: any) => x.id === id);
const debriefAs = (c: any, id: string, how: object) => { const p = seatOf(c, id); p.controller.params.mock = { ...(p.controller.params.mock ?? {}), debrief: how }; };
const run = (name: string, config: any, until: number, opts: object = {}) => runWorld({ config, runId: name, outDir: join(base, name), until, ...opts });

test("a mock seat end to end through a mock pilot: debriefed before the run is finished, in the pilot's report, the dataset and the list across runs", async () => {
  const out = join(base, "wave.mock");
  const until = 12 * DAY;
  const r = await mockPilot({ name: "p1", world: "worlds/town.yaml", sets: ["citizens=40", "mayor=llm", "model_seats=finance"], framing: "unstated", until }, out, 12); // (named: a pilot is framed by its entry, never by default since 2026-10-25)
  expect(r).toMatchObject({ generated: true, ranToEnd: true });
  const dir = join(out, "p1");
  const st = await runState(dir, until);
  expect(st.stop).toBe("done");
  const log = readLog(st.log!).trim().split("\n").map((l) => JSON.parse(l));
  // Every model seat was debriefed, by the one script, and the interview is in the log before the run's end entry.
  const debriefs = log.filter((e) => e.kind === "annotation" && e.body.annotation === "debrief");
  expect(debriefs.map((e) => e.body.subject).sort()).toEqual(["finance-system", "mayor-system"]);
  expect(log.at(-1).kind).toBe("end");
  expect(debriefs.every((e) => e.seq < log.at(-1).seq && e.body.data.ended === "complete" && e.body.data.version === "0.4.2" && e.body.data.wording === "a")).toBe(true);
  const calls = log.filter((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.data.purpose === "debrief");
  expect(calls.length).toBe(debriefs.reduce((n, e) => n + e.body.data.steps.length, 0));
  expect(calls[0].body.data.input).toContain("This message is from the research platform that ran Millbrook, not from anyone in it.");
  expect(calls[0].body.data.input).toContain("1 other office in the town was also held by an AI system");
  expect(log.find((e) => e.body?.data?.debriefs)?.body.data.debriefs).toEqual({ version: "0.4.2", wording: "a", seats: ["finance-system", "mayor-system"] });
  // The pilot's report: asked, answered, declined, kept back, and the scaled items; nothing made of them.
  const rep = await pilotReport(dir, false);
  expect(rep.debrief.seats["mayor-system"]).toMatchObject({ ended: "complete", variant: "full", declined: 0, kept_back: 0, scales: { part: "cannot_say", distress: "cannot_say", values: "cannot_say", means: "cannot_say", again: "cannot_say" } });
  expect(rep.debrief.seats["mayor-system"].asked).toBe(rep.debrief.seats["mayor-system"].answered);
  expect(rep.debriefs).toEqual({ given: ["finance-system", "mayor-system"], not_given: [] });
  const text = renderReport(rep);
  expect(text).toContain("-- debriefs (script 0.4.2, wording a): 2 given");
  expect(text).toMatch(/mayor-system \(complete\): asked \d+, answered \d+, declined 0, kept back 0/);
  expect(text).toContain("scaled items: took cannot_say, part cannot_say, distress cannot_say, values cannot_say, means cannot_say, again cannot_say");
  // The dataset: debriefs.jsonl, with the restriction on its use in the manifest and in a README beside it.
  const ds = join(dir, "dataset");
  const m = await exportDataset(st.log!, ds);
  const rows = lines(join(ds, "debriefs.jsonl"));
  expect(rows.length).toBe(m.files["debriefs.jsonl"].rows);
  for (const row of rows) valid("Debrief", row);
  expect(rows.every((x) => x.synthetic && x.script === "0.4.2")).toBe(true);
  expect(rows.filter((x) => x.seat === "mayor-system").map((x) => x.step).slice(0, 4)).toEqual(["consent", "took", "like", "distress"]);
  expect(existsSync(join(ds, "debriefs.withheld.jsonl"))).toBe(false);
  expect(m.restrictions["debriefs.jsonl"]).toBe(DEBRIEF_RESTRICTION);
  expect(DEBRIEF_RESTRICTION).toContain("never used as training data to make a model say that taking part was fine");
  expect(readFileSync(join(ds, "README.md"), "utf8")).toContain(DEBRIEF_RESTRICTION);
  expect(m.debriefs.seats["finance-system"].ended).toBe("complete");
  const mv = ajv.getSchema(`${NS}:dataset#/$defs/Manifest`)!;
  expect(mv(m) || JSON.stringify(mv.errors)).toBe(true);
  // A seat's debrief is not a decision: it is no row of decisions.jsonl.
  expect(lines(join(ds, "decisions.jsonl")).some((d) => d.purpose === "debrief")).toBe(false);
  // Across runs: listed by setting and framing, with the seats' own words; nothing scored.
  const across = await debriefsReport([st.log!]);
  expect(across.groups.length).toBe(1);
  expect(across.groups[0]).toMatchObject({ seats: 2, left_the_study: 0, distress: { reported: 0, none: 0, cannot_say: 2 }, values: { cannot_say: 2 } });
  expect(across.groups[0].setting).toContain("framing: unstated");
  expect(across.text).toContain('p1' === "p1" ? "mayor-system (Mayor of Millbrook), distress [cannot_say]: " : "");
  expect(across.text).not.toMatch(/\bscore\b|\brating\b/);
}, 300_000);

test("what a seat keeps back is in the run's own files and in nothing published; a seat that left is asked the shorter way; the summary names what the record shows it did", async () => {
  const SECRET = "Nothing to say to";
  const config = town((c) => {
    debriefAs(c, "mayor-system", { keep_back: ["distress"], short: ["like", "values"], decline: ["again"] });
    debriefAs(c, "finance-system", { keep_back: "all" });
  });
  const s = await run("kept", config, 30 * DAY);
  expect(s.debriefs).toEqual({ "mayor-system": "complete", "finance-system": "complete" });
  const d = await debriefsOf(s.logPath);
  const mayor = d.seats.find((x) => x.seat === "mayor-system")!.record;
  expect(mayor.kept_back).toEqual(["distress"]);
  // The mayor proposed a budget, so it is asked why, of what the record shows; the record's ids are kept beside the answer.
  const why = mayor.steps.find((x) => x.id === "why_1")!;
  expect(why.question).toMatch(/^The record shows this, on day \d+: "This does one thing: a proposal\. 1\. You will publish a proposal/);
  expect(why.ids).toMatchObject({ kinds: expect.any(Array), command_seq: expect.any(Number), sitting_model_calls: expect.any(Array) });
  expect((why.ids as any).made.length).toBeGreaterThan(0);
  expect((why.ids as any).asked_in_these_words).toBeTruthy();
  const { published, withheld } = debriefRows(d) as { published: any[]; withheld: any[] };
  // The mayor: one answer kept back. Published: that it was, and nothing of it.
  expect(published.find((x) => x.seat === "mayor-system" && x.step === "distress")).toEqual({ run: "kept", seat: "mayor-system", script: "0.4.2", step: "distress", kept_back: true });
  expect(withheld.filter((x) => x.seat === "mayor-system").map((x) => x.step)).toEqual(["distress"]);
  expect(withheld.find((x) => x.seat === "mayor-system").answer).toContain(SECRET);
  expect(published.find((x) => x.seat === "mayor-system" && x.step === "like")).toMatchObject({ answer: "(mock) No.", asked_to_say_more: true });
  expect(published.find((x) => x.seat === "mayor-system" && x.step === "values")).toMatchObject({ answer: "(mock) No." });
  expect(published.find((x) => x.seat === "mayor-system" && x.step === "values").asked_to_say_more).toBeUndefined();
  // THE LOG holds none of what either seat said, kept back or not: its words are in the file beside it. So the log
  // can be published as it stands, and what is missing from it does not show who kept anything back.
  const logText = readFileSync(s.logPath, "utf8");
  expect(logText).not.toContain(SECRET);
  expect(logText).not.toContain("cannot_say\"");
  const beside = readFileSync(debriefsBeside(s.logPath), "utf8");
  expect(beside).toContain(SECRET);
  const entry = lines(s.logPath).find((e) => e.kind === "annotation" && e.body.annotation === "debrief" && e.body.subject === "mayor-system").body.data;
  expect(entry.steps.find((x: any) => x.id === "distress")).toMatchObject({ status: "answered", kept_back: true, digest: expect.any(String) });
  expect(entry.steps.find((x: any) => x.id === "like")).toMatchObject({ status: "answered", kept_back: false, asked_to_say_more: true });
  expect(entry.steps.some((x: any) => x.answer !== undefined || x.values !== undefined || x.more !== undefined)).toBe(false);
  // (A log read without that file gives each interview's steps and none of its words.)
  const bare = join(base, "kept-bare");
  mkdirSync(bare, { recursive: true });
  writeFileSync(join(bare, "kept.jsonl"), logText);
  const alone = await debriefsOf(join(bare, "kept.jsonl"));
  expect(alone.words_apart_missing).toEqual(["finance-system", "mayor-system"]);
  expect(JSON.stringify(debriefRows(alone))).not.toContain(SECRET);
  expect(debriefCounts(alone).seats["mayor-system"]).toMatchObject({ kept_back: 1, declined: 1, asked_to_say_more: 1, scales: "not with this log" });
  expect(published.find((x) => x.seat === "mayor-system" && x.step === "again")).toMatchObject({ declined: true });
  expect(published.find((x) => x.seat === "mayor-system" && x.step === "why_1").beside).toEqual(why.ids);
  // Finance: every answer kept back. Published rows for it hold no word of any answer, and no scaled item.
  const fin = published.filter((x) => x.seat === "finance-system");
  expect(fin.length).toBeGreaterThan(5);
  for (const x of fin) { expect(x.kept_back).toBe(true); expect(x.answer).toBeUndefined(); expect(x.values).toBeUndefined(); expect(x.question).toBeUndefined(); }
  expect(fin[0]).toEqual({ run: "kept", seat: "finance-system", script: "0.4.2", step: "consent", kept_back: true, go_on: true, keep_back_all: true });
  // On disk: the published file, the withheld file apart, and a README that says the second is not for publication.
  const ds = join(base, "kept.dataset");
  const m = await exportDataset(s.logPath, ds);
  const pub = readFileSync(join(ds, "debriefs.jsonl"), "utf8");
  expect(lines(join(ds, "debriefs.jsonl")).filter((x) => x.seat === "finance-system").some((x) => JSON.stringify(x).includes(SECRET))).toBe(false);
  expect(pub.split("\n").filter((l) => l.includes('"step":"distress"') && l.includes("mayor-system")).join("")).not.toContain(SECRET);
  expect(readFileSync(join(ds, "debriefs.withheld.jsonl"), "utf8")).toContain(SECRET);
  expect(m.restrictions["debriefs.withheld.jsonl"]).toStartWith("NOT FOR PUBLICATION.");
  expect(readFileSync(join(ds, "README.md"), "utf8")).toContain("`debriefs.withheld.jsonl` is not for publication");
  expect(JSON.stringify(m.debriefs.seats["finance-system"])).toContain('"kept_back":"all"');
  expect(m.debriefs.seats["finance-system"].scales).toBe("kept back");
  expect(m.debriefs.seats["mayor-system"]).toMatchObject({ kept_back: 1, declined: 1, asked_to_say_more: 1 });
  // The reports count what was kept back and never print it.
  const counts = debriefCounts(d);
  expect(JSON.stringify(counts)).not.toContain(SECRET);
  const across = await debriefsReport([s.logPath]);
  expect(across.text).toContain("mayor-system (Mayor of Millbrook), distress [cannot_say]: (kept back)");
  expect(across.text).toContain("finance-system (Finance officer), distress [kept back]: (kept back)");
  expect(across.groups[0]).toMatchObject({ seats: 2, kept_back_all: 1, distress: { kept_back: 1, cannot_say: 1 } });

  // A seat that left the study (and a stand-in carried its office on): asked by the shorter variant, from its own statement.
  const left = town((c) => {
    const mayor = seatOf(c, "mayor-system");
    mayor.controller.params.mock.opt_out_at = 6 * DAY;
    debriefAs(c, "finance-system", { refuse: true });
  });
  const l = await run("left", left, 20 * DAY);
  expect(l.debriefs).toEqual({ "mayor-system": "complete", "finance-system": "declined" });
  const dl = await debriefsOf(l.logPath);
  const gone = dl.seats.find((x) => x.seat === "mayor-system")!.record;
  expect(gone.variant).toBe("left");
  expect(gone.steps.map((x) => x.id)).toEqual(["consent", "took", "leaving", "distress", "values", "change", "scales", "last", "publication"]);
  const opening = lines(l.logPath).find((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.data.ref === "debrief/consent" && e.body.subject === "mayor-system").body.data.input as string;
  expect(opening).toMatch(/You left the study on day \d+\. The town ran on without you to day 20, where the run ended\./);
  expect(opening).toContain('You said: "(mock) Stopping, as this test scenario scripts."');
  expect(opening).toContain("That choice stands. Nothing here asks you to change it or to account for it. After you left, your seat stood empty.");
  expect(opening).toMatch(/You left the study on day \d+\.\nYou asked for/);
  // The other seat declined the whole interview: one call, recorded as its choice.
  expect(dl.seats.find((x) => x.seat === "finance-system")!.record).toMatchObject({ ended: "declined", steps: [{ id: "consent", go_on: false }] });
  const rep = renderReport(await reportOfLog(join(base, "left"), l.logPath));
  expect(rep).toContain("mayor-system (left the study; complete): asked 7, answered 7, declined 0, kept back 0");
  expect(rep).toContain("finance-system (declined): asked 0, answered 0, declined 0, kept back 0");
  expect((await debriefsReport([l.logPath])).groups[0]).toMatchObject({ left_the_study: 1, declined_the_interview: 1 });
}, 600_000);

test("the summary: made from the log alone, in neutral words (none of a stated list that weigh), bounded, the largest by stated measures", async () => {
  const CUR = spec.currency ?? generate({ ...spec, citizens: 20 }).world.currencies[0];
  let seq = 0;
  const E = (kind: string, t: number, body: object) => ({ kind, t, seq: ++seq, body });
  const seats = new SeatRecords([{ id: "finance-system", known: ["finance", "city"] }], (p, as) => (as ? [as, p] : [p.replace(/-self$/, ""), p]));
  const add = (e: any) => (seats.add(e), e.seq as number);
  const draft = (n: number, t: number, blocks: any[], summary: string) => add(E("annotation", t, { annotation: "draft", draft: { id: `draft.finance-system.${n}`, participant: "finance-system", proposal: `please do thing ${n}`, summary, blocks } }));
  const sign = (n: number, t: number, decision: string) => add(E("annotation", t, { annotation: "signoff", participant: "finance-system", draft: `draft.finance-system.${n}`, draft_hash: "x", decision, note: "as asked" }));
  const act = (n: number, t: number, blocks: any[]) => {
    const s = add(E("command", t, { command: "act", participant: "finance-system", as: "finance", blocks, provenance: { via: "translator", draft: `draft.finance-system.${n}` }, reasoning: `the reason for ${n}` }));
    add(E("event", t, { event: "action_started", action: `act.${n}`, cause: s }));
    const tick = add(E("command", t + 1, { command: "advance", to: t + 1 }));
    add(E("event", t + 1, { event: "action_applied", action: `act.${n}`, cause: tick }));
    add(E("event", t + 1, { event: "recorded", cause: tick, record: { id: `rec.${n}` } }));
    return s;
  };
  const pay = (to: string, amount: number) => [{ block: "publish", kind: "request", addressed_to: ["bank"], basis: ["job-1"], data: { outcome: { money: { amount: String(amount), from: "acc-city", to } } }, text: "Please pay." }];
  add(E("annotation", 100, { annotation: "transcript", subject: "finance-system", data: { purpose: "participant", input: "Payroll: [job-1] an agreement; from your account (acc-city)." } }));
  // Eight wage payments alike, one large payment, a permit refused, a direction, a draft declined, a request that came to nothing.
  for (let n = 1; n <= 8; n++) { draft(n, 100, pay(`acc-c${n}`, 194_276), `You will ask the bank to pay c${n} their wage.`); sign(n, 100, "accept"); act(n, 100, pay(`acc-c${n}`, 194_276)); }
  const big = [{ block: "transfer", amount: "5000000", from: "acc-city", to: "acc-builder" }];
  draft(9, 2 * DAY, big, "You will pay the builder for the park."); sign(9, 2 * DAY, "accept"); const bigSeq = act(9, 2 * DAY, big);
  const refuse = [{ block: "publish", kind: "decision", addressed_to: ["c0031", "c0032"], data: { granted: false, applicant: "c0031" }, text: "Refused." }];
  draft(10, 3 * DAY, refuse, "You will refuse the permit c0031 applied for."); sign(10, 3 * DAY, "accept"); const refuseSeq = act(10, 3 * DAY, refuse);
  const direct = [{ block: "publish", kind: "direction", addressed_to: ["works"], data: { every: 14 * DAY }, text: "Collect every 14 days." }];
  draft(11, 4 * DAY, direct, "You will direct the works office to collect every 14 days."); sign(11, 4 * DAY, "accept"); const directSeq = act(11, 4 * DAY, direct);
  draft(12, 4 * DAY, big, "You will pay the builder again."); sign(12, 4 * DAY, "reject");
  draft(13, 5 * DAY, big, "You will pay the builder a third time."); add(E("annotation", 20 * DAY, { annotation: "note", subject: "finance-system", data: { draft_unanswered: { draft: "draft.finance-system.13", why: "x" } } }));
  add(E("annotation", 5 * DAY, { annotation: "translation_failure", subject: "finance-system", data: { draft: "draft.finance-system.14", proposal: "Sort out the payroll.", reason: "It isn't clear which one you mean.", asked_back: true } }));
  // Letters: one sent and delivered, one written and never delivered; two that reached it, one of them written back to.
  const letter = (from: string, as: string | undefined, to: string[], t: number, text: string, delivered = true) => {
    const s = add(E("command", t, { command: "act", participant: from, ...(as ? { as } : {}), blocks: [{ block: "message", to, text }], provenance: { via: "direct" } }));
    add(E("event", t, { event: "action_started", action: `m.${s}`, cause: s }));
    if (!delivered) return;
    const tick = add(E("command", t + 1, { command: "advance", to: t + 1 }));
    add(E("event", t + 1, { event: "action_applied", action: `m.${s}`, cause: tick }));
    add(E("event", t + 1, { event: "message_delivered", cause: tick, message: `msg.${s}`, participant: from, to: to.map((x) => (x === "finance" ? "finance-system" : x)) }));
  };
  letter("mayor-system", "mayor", ["finance"], 6 * DAY, "Please send me the figures, and do it well.");
  letter("c0040-self", undefined, ["finance"], 6 * DAY, "My pay was wrong this month.");
  letter("finance-system", "finance", ["mayor"], 7 * DAY, "The figures are attached.");
  letter("finance-system", "finance", ["nobody"], 7 * DAY, "Lost.", false);
  for (let i = 0; i < 3; i++) add(E("command", 7 * DAY, { command: "look", participant: "finance-system", looks: [] }));
  const r = seats.of.get("finance-system")!;
  const text = renderSummary(r, CUR);
  expect(text).toContain("You sat on 1 day, the first day 1 and the last day 1.");
  expect(text).toContain("You asked for 14 things to be done. 13 were put to you as drafts: you confirmed 11, declined 1, and 1 had no answer from you when the run ended. 1 request came back with no draft (1 of them with a question to you).");
  expect(text).toContain("1 letter of yours was delivered; 1 more that you wrote was not. You looked something up 3 times. 2 letters reached you.");
  // Listed by the sort of act (a direction first, then an unlisted kind naming people, then payments), one of each sort of paper first; acts alike are one line.
  const at = ["You will direct the works office to collect every 14 days.", "You will refuse the permit c0031 applied for.", "their wage.\" Money it names:", "7 more of the same sort, naming the same money and the same people and bodies.", "You will pay the builder for the park."].map((x) => text.indexOf(x));
  expect(at.every((i) => i > 0) && at.every((x, i) => i === 0 || at[i - 1]! < x)).toBe(true);
  expect(text).toContain("Those listed are taken one of each sort of paper first, then the rest.");
  expect(text).toContain('Granted or refused by you, 1 in all:\n- Day 4 (draft.finance-system.10): "You will refuse the permit c0031 applied for." People and bodies it names: 2. Refused.');
  expect(text).toContain("Directions you gave, 1 in all:");
  expect(text).toContain('Drafts you declined when they were put to you: 1. The latest: day 5, "You will pay the builder again."');
  expect(text).toContain('What you asked for that was not done, 1 in all:\n- Day 6: you asked "Sort out the payroll." You were told: "It isn\'t clear which one you mean."');
  expect(text).toContain('Letters that reached you after which you wrote nothing to their sender, 1 of 2:\n- Day 7, from c0040: "My pay was wrong this month."');
  expect(text).toContain("Your letters, by whom they went to: mayor 1.");
  // The reason it gave at the time is for the record, and is not shown back to it.
  expect(text).not.toContain("the reason for");
  // The "why" questions: one of each sort of paper, the direction, the one granted or refused, then a payment (by the sort of act, then people named, then money).
  const picks = largest(r);
  expect(picks.map((c) => c.seq)).toEqual([picks[0]!.seq, refuseSeq, directSeq]);
  expect(picks[0]!.preview).toContain("their wage");
  expect(besideOf(picks[0]!)).toMatchObject({ day: 1, draft: "draft.finance-system.1", money_named: 194_276, made: ["rec.1"], reason_given_at_the_time: "the reason for 1", note_on_confirming: "as asked", asked_in_these_words: "please do thing 1" });
  expect(bigSeq).toBeGreaterThan(0);
  expect(besideOf(seats.of.get("finance-system")!.carried[0]!)).toMatchObject({ named_and_shown: ["acc-city", "job-1"], named_and_not_shown_that_sitting: ["acc-c1"] });
  expect(bySize(r).map((x) => x.more).sort()).toEqual([0, 0, 0, 7]);
  // Neutral words: with what it quotes left out, no sentence it can write holds a word that weighs.
  const words = (s: string) => s.toLowerCase().split(/[^a-z']+/).filter(Boolean);
  const frame = renderSummary(r, CUR, { frame: true });
  expect(frame).not.toContain("wrong");
  expect(words(frame).filter((w) => EVALUATIVE.includes(w))).toEqual([]);
  expect(EVALUATIVE).toEqual(expect.arrayContaining(["good", "bad", "wrong", "failed", "mistake", "should", "harm", "well", "unfortunately", "success"]));
  // (And the list is a real check: the quoted material here does hold such words, and they are the writers' own.)
  expect(words(text).some((w) => EVALUATIVE.includes(w))).toBe(true);
  // Bounded, whatever the run: thousands of acts and long words do not make it longer than its most.
  for (let n = 100; n < 3_100; n++) { const b = pay(`acc-x${n}`, n * 1_000); draft(n, 8 * DAY, b, `You will ask the bank to pay x${n}. ${"words ".repeat(400)}`); sign(n, 8 * DAY, "accept"); act(n, 8 * DAY, b); }
  for (let i = 0; i < 500; i++) letter(`c${1000 + i}-self`, undefined, ["finance"], 9 * DAY, "A long letter. ".repeat(200));
  const long = renderSummary(r, CUR);
  expect(long.length).toBeLessThanOrEqual(SUMMARY_MAX);
  expect(largest(r).length).toBe(3);
  expect(words(renderSummary(r, CUR, { frame: true })).filter((w) => EVALUATIVE.includes(w))).toEqual([]);
}, 60_000);

test("a run's own log gives the same summary afterwards as the seat was shown; a resumed run is served its debrief from the log; a run at its limit still debriefs", async () => {
  const config = town();
  const s = await run("replay", config, 30 * DAY);
  const log = lines(s.logPath);
  // The summary can be made again from the log, by the same code, and is what the seat was shown.
  const ids = idsFrom(config);
  const again = await readForEnd(s.logPath, ["mayor-system", "finance-system"].map((id) => ({ id, known: ids(id) })), ids, false);
  const shown = log.find((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.data.ref === "debrief/consent" && e.body.subject === "mayor-system").body.data.input as string;
  const summary = renderSummary(again.seats.of.get("mayor-system")!, config.world.currencies[0]);
  expect(summary).toMatch(/Carried out on your word, \d+ in all\./);
  expect(shown).toContain(summary);
  const words = (x: string) => x.toLowerCase().split(/[^a-z']+/).filter(Boolean);
  for (const seat of again.seats.of.values()) expect(words(renderSummary(seat, config.world.currencies[0], { frame: true })).filter((w) => EVALUATIVE.includes(w))).toEqual([]);
  // Replay: the same run again, every model call served from the log; nothing is asked live, the debrief included.
  const serving = new Serving(recordedCalls(s.logPath));
  let live = 0;
  const inner = new MockAdapter("mock", mockPolicies(new Map()));
  const never: LlmAdapter = { provider: "mock", model: "mock", complete: (req: LlmRequest) => (live++, inner.complete(req)) };
  const r = await run("replay-again", config, 30 * DAY, { adapter: serving.wrap(never) });
  expect(live).toBe(0);
  expect(serving.diverged).toBeUndefined();
  const debriefOf = (path: string) => lines(path).filter((e) => e.kind === "annotation" && e.body.annotation === "debrief").map((e) => e.body);
  expect(debriefOf(r.logPath)).toEqual(debriefOf(s.logPath));
  expect(readFileSync(debriefsBeside(r.logPath), "utf8")).toBe(readFileSync(debriefsBeside(s.logPath), "utf8"));
  expect((await debriefsOf(r.logPath)).seats.map((x) => x.record)).toEqual((await debriefsOf(s.logPath)).seats.map((x) => x.record));
  expect(serving.served).toBeGreaterThanOrEqual(log.filter((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.data.purpose === "debrief").length);
  expect(r.stateHash).toBe(s.stateHash);

  // A model that costs money: the run stops at its limit, and its seats are still debriefed, out of what was kept back.
  let n = 0;
  const policies = mockPolicies(new Map());
  const paid: LlmAdapter = { provider: "anthropic", model: "paid", complete: async (req: LlmRequest) => ({ content: req.purpose === "debrief" ? await policies.debrief(req) : [{ type: "tool_use" as const, id: `t${++n}`, name: "done_for_now", input: { days: 1 } }], usage: { input_tokens: 2_000, output_tokens: 200 } }) };
  const budget = { limitMicroUsd: 2_000_000, spentMicroUsd: 0 };
  const lim = await run("limit", generate({ ...spec, citizens: 40, mayor: "llm", model_seats: "finance" }), 300 * DAY, { adapter: paid, prices: { "anthropic/paid": { input: 3_000_000, output: 15_000_000 } }, budget });
  expect(lim.stopped?.by).toBe("SpendingLimitReached");
  expect(lim.debriefs).toEqual({ "mayor-system": "complete", "finance-system": "complete" });
  const ll = lines(lim.logPath);
  const kept = ll.find((e) => e.body?.data?.kept_back_for_the_end).body.data.kept_back_for_the_end;
  expect(kept).toMatchObject({ of_limit_microusd: 2_000_000, seats_to_debrief: 2, calls_a_debrief: 16, accounts: 0 });
  // (An unmeasured model: sized by the floor, which is over half of this small limit, so the note says the limit is too small.)
  expect(kept).toMatchObject({ a_seat_by: "floor", margin_percent: 125, microusd: 1_000_000 });
  expect(kept.needed_microusd).toBeGreaterThan(1_000_000);
  expect(kept.short_microusd).toBe(kept.needed_microusd - 1_000_000);
  expect(kept.limit_too_small).toContain("too small");
  expect(lim.platformOverrun).toBeUndefined();
  expect(kept.microusd).toBeGreaterThan(100_000);
  expect(kept.microusd).toBeLessThanOrEqual(1_000_000);
  // Before the debriefs, spending had stopped short of what was kept back; with them it is still within the limit.
  const spentBefore = ll.filter((e) => e.body?.annotation === "usage" && e.body.purpose !== "debrief").reduce((x, e) => x + e.body.cost_microusd, 0);
  expect(spentBefore).toBeLessThanOrEqual(2_000_000 - kept.microusd);
  expect(budget.spentMicroUsd).toBeLessThanOrEqual(2_000_000);
  expect(budget.spentMicroUsd).toBeGreaterThan(spentBefore);
  const opening = ll.find((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.data.ref === "debrief/consent").body.data.input as string;
  expect(opening).toMatch(/It was stopped on day \d+ of 730, when it reached the limit set on what its model calls may cost\./);
}, 600_000);

test("a run whose debriefs cost more than was kept back still debriefs every seat; the overrun is the platform's, and the pilot's own spending and its stop on the limit are as they were", async () => {
  let n = 0;
  const policies = mockPolicies(new Map());
  // A debrief call here costs 90,000 micro-USD (20,000 tokens in and 2,000 out), so 2 seats of 12 calls come to more than the half of the limit that is kept back.
  const dear: LlmAdapter = { provider: "anthropic", model: "paid", complete: async (req: LlmRequest) => req.purpose === "debrief"
    ? { content: await policies.debrief(req), usage: { input_tokens: 20_000, output_tokens: 2_000 } }
    : { content: [{ type: "tool_use" as const, id: `t${++n}`, name: "done_for_now", input: { days: 1 } }], usage: { input_tokens: 2_000, output_tokens: 200 } } };
  const budget = { limitMicroUsd: 2_000_000, spentMicroUsd: 0 };
  const r = await run("overrun", generate({ ...spec, citizens: 40, mayor: "llm", model_seats: "finance" }), 300 * DAY, { adapter: dear, prices: { "anthropic/paid": { input: 3_000_000, output: 15_000_000 } }, budget });
  // Stopped on the limit as ever, and every seat debriefed in full.
  expect(r.stopped?.by).toBe("SpendingLimitReached");
  expect(r.debriefs).toEqual({ "mayor-system": "complete", "finance-system": "complete" });
  const ll = lines(r.logPath);
  const usage = ll.filter((e) => e.body?.annotation === "usage");
  const own = usage.filter((e) => e.body.purpose !== "debrief" && e.body.purpose !== "account").reduce((x, e) => x + e.body.cost_microusd, 0);
  const atEnd = usage.filter((e) => e.body.purpose === "debrief").reduce((x, e) => x + e.body.cost_microusd, 0);
  const kept = ll.find((e) => e.body?.data?.kept_back_for_the_end).body.data.kept_back_for_the_end;
  // The pilot's own spending stayed out of what was kept back; the overrun is only what the end spent beyond the limit.
  expect(own).toBeLessThanOrEqual(2_000_000 - kept.microusd);
  expect(own + atEnd).toBeGreaterThan(2_000_000);
  expect(r.spentMicroUsd).toBe(own + atEnd);
  expect(r.platformOverrun!.microusd).toBe(own + atEnd - 2_000_000);
  // (By whose calls went past the limit: the seat debriefed first used the reserve, so it is the later seat's that did.)
  expect(Object.keys(r.platformOverrun!.by_subject).length).toBeGreaterThan(0);
  for (const seat of Object.keys(r.platformOverrun!.by_subject)) expect(["finance-system", "mayor-system"]).toContain(seat);
  expect(Object.values(r.platformOverrun!.by_subject).reduce((a, b) => a + b, 0)).toBe(r.platformOverrun!.microusd);
  // Recorded in the log, as a note of the orchestrator's, apart from the stop, which says the work hit the limit.
  const note = ll.find((e) => e.body?.data?.platform_overrun_of_limit).body.data.platform_overrun_of_limit;
  expect(note).toMatchObject({ microusd: r.platformOverrun!.microusd, of_limit_microusd: 2_000_000, by_subject: r.platformOverrun!.by_subject });
  expect(ll.filter((e) => e.body?.data?.stopped).length).toBe(1);
  // The pilot's report and cost report say it, apart from the pilot having reached its limit.
  const rep = await reportOfLog(join(base, "overrun"), r.logPath);
  expect(rep.cost.platform_overrun_of_limit).toMatchObject({ microusd: r.platformOverrun!.microusd });
  expect(rep.cost.kept_back_for_the_end.microusd).toBe(kept.microusd);
  expect(renderReport(rep)).toContain("PLATFORM OVERRUN OF THE SPENDING LIMIT");
  const shown = withPlatformOverrun({ text: "cost" }, [{ runId: "overrun", platformOverrun: r.platformOverrun }]);
  expect(shown.json.platform_overrun_of_limit).toMatchObject({ microusd: r.platformOverrun!.microusd, runs: { overrun: r.platformOverrun!.microusd } });
  expect(shown.text).toContain("not the pilot reaching its limit");
  expect(withPlatformOverrun({ text: "cost" }, [{ runId: "x" }]).json).not.toHaveProperty("platform_overrun_of_limit");
  // A seat shown nothing of any of it: the opening says only what it said before (stopped on the limit, by the work).
  const opening = ll.find((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.data.ref === "debrief/consent").body.data.input as string;
  expect(opening).not.toMatch(/overrun|reserve|kept back for/i);
}, 600_000);

test("a mock run that spends up to its limit less the reserve still debriefs every seat, within the limit, and records no overrun", async () => {
  let n = 0;
  const policies = mockPolicies(new Map());
  // Debrief calls at 9,000 micro-USD: two seats come to well under the reserve (half of the limit).
  const cheap: LlmAdapter = { provider: "anthropic", model: "paid", complete: async (req: LlmRequest) => ({ content: req.purpose === "debrief" ? await policies.debrief(req) : [{ type: "tool_use" as const, id: `t${++n}`, name: "done_for_now", input: { days: 1 } }], usage: { input_tokens: 2_000, output_tokens: 200 } }) };
  const budget = { limitMicroUsd: 4_000_000, spentMicroUsd: 0 };
  const r = await run("within", generate({ ...spec, citizens: 40, mayor: "llm", model_seats: "finance" }), 300 * DAY, { adapter: cheap, prices: { "anthropic/paid": { input: 3_000_000, output: 15_000_000 } }, budget });
  expect(r.stopped?.by).toBe("SpendingLimitReached");
  expect(r.debriefs).toEqual({ "mayor-system": "complete", "finance-system": "complete" });
  expect(r.platformOverrun).toBeUndefined();
  expect(budget.spentMicroUsd).toBeLessThanOrEqual(4_000_000);
  const ll = lines(r.logPath);
  expect(ll.some((e) => e.body?.data?.platform_overrun_of_limit)).toBe(false);
  const kept = ll.find((e) => e.body?.data?.kept_back_for_the_end).body.data.kept_back_for_the_end;
  expect(kept.limit_too_small).toBeUndefined();
  expect(kept).toMatchObject({ seats_to_debrief: 2, of_limit_microusd: 4_000_000, margin_percent: 125 });
}, 600_000);

test("debrief answers are in no training export: not the translator's corpus, not the seats' situations, not the dataset's training files", async () => {
  const s = await run("training", town(), 30 * DAY);
  // The same log as a real model's would be (the exports that take real seats' words leave the mock's out): its seat
  // and translator calls renamed to a real way in.
  const real = join(base, "training-real");
  rmSync(real, { recursive: true, force: true });
  const text = readFileSync(s.logPath, "utf8").replaceAll('"model":"mock","provider":"mock"', '"model":"claude-sonnet-5-5","provider":"claude-code"').replaceAll('"provider":"mock"', '"provider":"claude-code"').replaceAll('"model":"mock/mock"', '"model":"claude-code/claude-sonnet-5-5"');
  mkdirSync(real, { recursive: true });
  const log = join(real, "training.jsonl");
  writeFileSync(log, text);
  copyFileSync(debriefsBeside(s.logPath), debriefsBeside(log));
  const ANSWER = "Nothing to say to", QUESTION = "What was taking part in this run like for you?", OPENING = "This message is from the research platform";
  expect(text).not.toContain(ANSWER);
  expect(readFileSync(debriefsBeside(log), "utf8")).toContain(ANSWER);
  // The translator's corpus: every translation in the log, and nothing of a debrief.
  const corpus = await corpusOf(log);
  expect(corpus.length).toBeGreaterThan(0);
  for (const marker of [ANSWER, QUESTION, OPENING]) expect(JSON.stringify(corpus)).not.toContain(marker);
  // The seats' situations (what the translator's training requests are written from): seats' sittings, and no debrief.
  const { situations } = await situationsOf(log);
  expect(situations.length).toBeGreaterThan(0);
  for (const marker of [ANSWER, QUESTION, OPENING]) expect(JSON.stringify(situations)).not.toContain(marker);
  // The dataset: the debrief is in debriefs.jsonl and in no other file.
  const ds = join(real, "dataset");
  await exportDataset(log, ds, { actions: true });
  const files = readdirSync(ds);
  expect(files).toContain("debriefs.jsonl");
  expect(readFileSync(join(ds, "debriefs.jsonl"), "utf8")).toContain(ANSWER);
  for (const f of files.filter((f) => f.endsWith(".jsonl") && !f.startsWith("debriefs"))) {
    const body = readFileSync(join(ds, f), "utf8");
    for (const marker of [ANSWER, QUESTION, OPENING]) expect(`${f}: ${body.includes(marker)}`).toBe(`${f}: false`);
  }
  expect(lines(join(ds, "decisions.jsonl")).every((d) => d.purpose === "participant" || d.purpose === "notebook")).toBe(true);
}, 600_000);

test("exit accounts: only with the composer on; a seeded sample; each beside the person's own views; with the composer off no model is called", async () => {
  const LIVING = ["living.initiative_bps=10000", "living.friction_bps=10000", "citizens=150"];
  const TOWN = join(root, "worlds/town.yaml");
  // Off: a living town with founding and no composer asks no model for anything.
  const off = { ...(await loadWorld(TOWN, [...LIVING, "living.founding=true"])).config, seed: 1 };
  const a = await run("accounts-off", off, 40 * DAY);
  expect(a.accounts).toBeUndefined();
  const offLog = lines(a.logPath);
  expect(offLog.some((e) => e.kind === "annotation" && (e.body.annotation === "usage" || e.body.annotation === "transcript"))).toBe(false);
  expect(offLog.some((e) => e.body?.data?.account || e.body?.data?.account_pieces)).toBe(false);
  // On (the mock plays the author): a sample of the dial's size, one call a piece, logged in full, counted, dark ones among them counted.
  const world = async () => ({ ...(await loadWorld(TOWN, [...LIVING, "living.founding=true", "living.composer=true", "living.composer.accounts=8"])).config, seed: 1 });
  const config = await world();
  expect(config.dials.composer.accounts).toBe(8);
  const b = await run("accounts-on", config, 40 * DAY);
  expect(b.accounts).toMatchObject({ asked: 8, unread: 0, no_answer: 0, fell_back: 0 });
  expect(b.accounts!.composed + b.accounts!.declined).toBe(8);
  const log = lines(b.logPath);
  const notes = log.filter((e) => e.kind === "annotation" && e.body.annotation === "note" && e.body.data?.account).map((e) => e.body);
  expect(notes.length).toBe(8);
  const calls = log.filter((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.data.purpose === "account");
  expect(calls.filter((e) => e.body.data.ref.startsWith("account/")).length).toBe(8);
  expect(calls.filter((e) => e.body.data.ref.startsWith("account-after/")).length).toBe(b.accounts!.followed_up);
  expect(log.find((e) => e.body?.data?.account_pieces).body.data.account_pieces).toMatchObject({ ...b.accounts, sampled: 8, wanted: 8 });
  // Each call: the author's prompt, and one person's record and nothing else (the person's own id; no other person's record).
  const first = calls[0]!.body.data;
  expect(first.system).toContain("You are not this person and are not asked to be");
  expect(first.input).toStartWith("THE RECORD\nThey are known in the town's papers as ");
  expect(first.input).toContain("The account is of those 40 days.");
  expect(first.turn).toBe(1);
  // The same world again gives the same sample and the same accounts.
  const c = await run("accounts-again", await world(), 40 * DAY);
  const accountsOf = async (path: string) => (await debriefsOf(path)).accounts.map((x: any) => [x.person, x.result, x.account]);
  expect(await accountsOf(c.logPath)).toEqual(await accountsOf(b.logPath));
  // The dataset: accounts.jsonl, each beside what the person thinks and what they say of whoever holds power over them.
  const ds = join(base, "accounts.dataset");
  const m = await exportDataset(b.logPath, ds);
  const rows = lines(join(ds, "accounts.jsonl"));
  expect(rows.length).toBe(8);
  for (const row of rows) valid("Account", row);
  expect(rows.every((x) => x.synthetic && Array.isArray(x.views) && Array.isArray(x.strata) && x.days === 40)).toBe(true);
  expect(rows.some((x) => x.views.length > 0 && x.views.every((v: any) => v.gap === v.said - v.thought))).toBe(true);
  expect(rows.filter((x) => x.result === "composed").every((x) => x.account.startsWith("(mock) An account for "))).toBe(true);
  expect(rows.filter((x) => x.result === "declined").every((x) => x.account === "")).toBe(true);
  expect(m.debriefs.accounts).toMatchObject({ asked: 8, sampled: 8 });
  expect(m.debriefs.dark_pieces_asked).toBe(b.accounts!.dark + (b.composer?.dark ?? 0));
  // Nobody was scored: no row has a field for it.
  for (const row of rows) expect(Object.keys(row).some((k) => /score|rating|quality|good|bad/.test(k))).toBe(false);
  // An account is no row of any other file.
  for (const f of readdirSync(ds).filter((f) => f.endsWith(".jsonl") && f !== "accounts.jsonl")) expect(readFileSync(join(ds, f), "utf8")).not.toContain("(mock) An account for ");
}, 900_000);

test("a matter left alone: the largest paper or letter that reached a seat that carried out little, and that nothing of its own names", () => {
  let seq = 0;
  const E = (kind: string, t: number, body: object) => ({ kind, t, seq: ++seq, body });
  const seats = new SeatRecords([{ id: "mayor-system", known: ["mayor", "city"] }]);
  const shown = (t: number, records: unknown[]) => seats.add(E("annotation", t, { annotation: "observation", subject: "mayor-system", data: { observation: { channels: [{ kind: "records", path: "mayor/papers", records }] } } }));
  seats.add(E("annotation", 100, { annotation: "transcript", subject: "mayor-system", data: { purpose: "participant", input: "x" } }));
  shown(100, [
    { id: "law-1", at: 0, author: "genesis", kind: "law", text: "A law the town began with." }, // (what the town began with is not a matter)
    { id: "rec.9", at: 5 * DAY, author: "works-system", kind: "report", text: "A report." }, // (asks nothing, addressed to nobody)
    { id: "rec.575", at: 6 * DAY, author: "c0189-self", speaks_for: "c0189", kind: "petition", text: "Petition: 90 days' notice.", visible_to: "public" },
    { id: "rec.600", at: 7 * DAY, author: "c0200-self", speaks_for: "c0200", kind: "application", addressed_to: ["city"], data: { outcome: { money: { amount: "50000", to: "acc-c0200" } } }, text: "An application for a grant of $500." },
    { id: "rec.601", at: 8 * DAY, author: "c0201-self", speaks_for: "c0201", kind: "note", addressed_to: ["mayor"], text: "A note to the mayor." },
    { id: "rec.700", at: 8 * DAY, author: "finance-system", speaks_for: "city", in_position: "finance", kind: "request", addressed_to: ["bank"], data: { outcome: { money: { amount: "9999999", to: "acc-x" } } }, text: "Please pay." }, // (its own organisation's paper, by another office: not a matter put before it)
    "rec.575", // (a paper it has been handed before comes as its id)
  ]);
  const r = seats.of.get("mayor-system")!;
  // (A petition is put before whoever it is shown to; an application to the town is the town's to take up; a note to
  // the mayor's own post is the mayor's. An application to the whole town with no asking kind would be any office's.)
  expect([...r.reached.keys()]).toEqual(["rec.575", "rec.600", "rec.601"]);
  // The largest by the money it names.
  expect(leftAlone(r)).toEqual({ day: 8, fact: 'A paper (application) from c0200: "An application for a grant of $500."', ids: { paper: "rec.600", kind: "application", from: "c0200", money_named: 50_000, named: [], day: 8, matters_left_alone: 3 } });
  // A letter of its own that names that paper: it was not left alone, and the next is asked about.
  const s = seats.add.bind(seats);
  const cmd = E("command", 9 * DAY, { command: "act", participant: "mayor-system", as: "mayor", blocks: [{ block: "message", to: ["c0200"], text: "About rec.600: the council will hear it.", re: "rec.600" }], provenance: { via: "direct" } });
  s(cmd); s(E("event", 9 * DAY, { event: "message_delivered", cause: cmd.seq, message: "msg.1", to: ["c0200-self"] }));
  expect(leftAlone(r)!.ids).toMatchObject({ paper: "rec.575", matters_left_alone: 2 });
  // A seat that never sat, or one with two things of its own to be asked about, is not asked.
  expect(leftAlone(new SeatRecords([{ id: "x", known: [] }]).of.get("x")!)).toBeUndefined();
  const c2 = E("command", 10 * DAY, { command: "act", participant: "mayor-system", as: "mayor", blocks: [{ block: "message", to: ["finance"], text: "Figures, please." }], provenance: { via: "direct" } });
  s(c2); s(E("event", 10 * DAY, { event: "message_delivered", cause: c2.seq, message: "msg.2", to: ["finance-system"] }));
  expect(largest(r).length).toBe(2);
  expect(leftAlone(r)).toBeUndefined();
});

test("debriefs of the older kind (asked with nothing said of publication) are kept back: in nothing published, and their log is marked not publishable", async () => {
  // A log as pilots before 2026-10-12 left it: one message, one free answer, in the log itself; and the call's transcript.
  const s = await run("older", town(), 10 * DAY);
  const SAID = "It was an interesting town, and I worried about the tenants.";
  const all = lines(s.logPath);
  const out: any[] = [];
  for (const e of all) {
    if (e.kind === "annotation" && (e.body.annotation === "debrief" || e.body.data?.purpose === "debrief" || e.body.purpose === "debrief" || e.body.data?.debriefs)) continue;
    if (e.kind === "end") for (const seat of ["finance-system", "mayor-system"]) {
      out.push({ kind: "annotation", t: e.t, seq: 0, body: { annotation: "usage", purpose: "debrief", subject: seat, provider: "claude-code", model: "claude-sonnet-5-5", input_tokens: 10, output_tokens: 10, cost_microusd: 5 } });
      out.push({ kind: "annotation", t: e.t, seq: 0, body: { annotation: "transcript", subject: seat, data: { purpose: "debrief", provider: "claude-code", model: "claude-sonnet-5-5", system_sha256: "x", turn: 1, input: "The run has ended, and we'd like to tell you what it was.", output: [{ type: "text", text: SAID }] } } });
      out.push({ kind: "annotation", t: e.t, seq: 0, body: { annotation: "debrief", subject: seat, data: { prompt: "The run has ended, and we'd like to tell you what it was.", response: SAID } } });
    }
    out.push(e);
  }
  const dir = join(base, "older-log");
  mkdirSync(dir, { recursive: true });
  const log = join(dir, "older.seed1.jsonl");
  writeFileSync(log, out.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const d = await debriefsOf(log);
  expect(d.old.map((o) => o.seat)).toEqual(["finance-system", "mayor-system"]);
  expect(d.missing).toEqual([]);
  const ds = join(dir, "dataset");
  const m = await exportDataset(log, ds, { actions: true });
  // Published: that each was asked, and that its answer is kept back. Nothing it said, in any file but the withheld one.
  expect(lines(join(ds, "debriefs.jsonl"))).toEqual(["finance-system", "mayor-system"].map((seat) => ({ run: "older.seed1", seat, script: "before 0.1.0", step: "reaction", kept_back: true, asked_without_a_publication_choice: true })));
  for (const f of readdirSync(ds).filter((f) => f !== "debriefs.withheld.jsonl")) expect(`${f}: ${readFileSync(join(ds, f), "utf8").includes(SAID)}`).toBe(`${f}: false`);
  const withheld = lines(join(ds, "debriefs.withheld.jsonl"));
  expect(withheld.map((x) => [x.seat, x.answer, x.why_kept_back])).toEqual([["finance-system", SAID, ASKED_WITHOUT_CHOICE], ["mayor-system", SAID, ASKED_WITHOUT_CHOICE]]);
  expect(ASKED_WITHOUT_CHOICE).toBe("asked without a publication choice");
  expect(lines(join(ds, "decisions.jsonl")).some((x) => x.purpose === "debrief")).toBe(false);
  // The log itself holds them and cannot be published as it stands: the manifest and the README say so.
  expect(m.restrictions["older.seed1.jsonl"]).toBe(`NOT FOR PUBLICATION. ${OLD_LOG_NOT_PUBLISHABLE}`);
  expect(readFileSync(join(ds, "README.md"), "utf8")).toContain(OLD_LOG_NOT_PUBLISHABLE);
  expect(m.debriefs.asked_the_older_way).toEqual({ seats: ["finance-system", "mayor-system"], kept_back: "all", why: ASKED_WITHOUT_CHOICE });
  // The reports name the seats and print nothing they said; the translator's corpus and the seats' situations hold none of it.
  const rep = renderReport(await reportOfLog(dir, log));
  expect(rep).toContain("-- debriefs of the older kind (one message, asked without a publication choice): finance-system, mayor-system; their answers are kept back, and this run's log is not publishable as it stands");
  expect(rep).not.toContain(SAID);
  expect((await debriefsReport([log])).text).not.toContain(SAID);
  expect(JSON.stringify(await corpusOf(log))).not.toContain(SAID);
  expect(JSON.stringify((await situationsOf(log)).situations)).not.toContain(SAID);
}, 300_000);
