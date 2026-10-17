// The archive extractor (scripts/extract-archive.ts) on a small log made by hand: a model seat's requests with their
// situations, translations, decisions and outcomes, tokens and cost, notebooks, a debrief with one answer kept back
// (which must appear nowhere in what is written), the real test cases flagged, translator examples deduplicated with
// their splits, and findings linked to the runs they cite. No model is called.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PILOT_CASES } from "../../translator/eval/pilot-cases";
import { citesIn, discover, exampleKey, extractExamples, extractFindings, extractLog, notebookOf, outcomeOf, readShard, rng, sections, splitOf, testIndex } from "../../scripts/extract-archive";

const tmp = mkdtempSync(join(tmpdir(), "extract-archive-"));
const runs = join(tmp, "runs");
const out = join(runs, "archive-test");
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const DAY = 86_400;
const SYSTEM = "You are the clerk, acting for the town (town).";
const SHA = "a".repeat(64);
const TSHA = "b".repeat(64);
const KEPT_BACK = "THE-ANSWER-A-SEAT-ASKED-TO-KEEP-BACK";
const PUBLISHED = "the answer the seat let be published";
const REAL = PILOT_CASES[0]!;

let seq = 0;
const entry = (kind: string, t: number, body: any) => JSON.stringify({ body, hash: `h${seq}`, kind, prev: `h${seq - 1}`, seq: seq++, t });
const ann = (t: number, body: any) => entry("annotation", t, { annotation: "x", ...body });
const usage = (t: number, subject: string, purpose: string, cost: number) => ann(t, { annotation: "usage", subject, purpose, provider: "claude-code", model: "sonnet", input_tokens: 3, output_tokens: 40, cache_read_tokens: 5, cache_write_tokens: 7, cost_microusd: cost });
const transcript = (t: number, subject: string, data: any) => ann(t, { annotation: "transcript", subject, data: { provider: "claude-code", model: "sonnet", system_sha256: SHA, system: SYSTEM, ...data } });
const doCall = (what: string) => ({ type: "tool_use", id: "u1", name: "do", input: { what } });

function makeLog(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const lines: string[] = [];
  lines.push(entry("header", 0, { canary: "c", config: { meta: { name: "Smallville" }, seed: 7, world: { currencies: [{ code: "MRK", minor_units: 2 }] }, positions: [{ holder: "clerk-system", title: "Clerk" }], participants: [] }, config_hash: "ch", initial_state_hash: "ih", run_id: "town.seed7" }));
  lines.push(ann(0, { annotation: "orchestrator", subject: "orchestrator", data: { llm: { participants: { "clerk-system": { adapter: "claude-code/sonnet" } } } } }));
  // Day 1: the clerk reads a notebook and makes two requests; the first is drafted, accepted; the second is never taken up.
  const t1 = DAY + 100;
  lines.push(usage(t1, "clerk-system", "participant", 1000));
  lines.push(transcript(t1, "clerk-system", { purpose: "participant", turn: 1, input: "Your notebook: (empty)\n\nSince you last looked:\n## Post: Mine (1 new)\n- [a] a thing", output: [{ type: "text", text: "I will pay." }, doCall("Pay acc-b 500 from acc-town for the deposit."), doCall("Show me every payment out of acc-town.")] }));
  lines.push(usage(t1 + 1, "translator", "translator", 0));
  lines.push(transcript(t1 + 1, "translator", { purpose: "translator", turn: 1, ref: "draft.clerk-system.1", system_sha256: TSHA, system: "You translate.", input: "Request: Pay acc-b 500 from acc-town for the deposit.", output: [{ type: "text", text: "money(to=acc-b, amount=500)" }] }));
  lines.push(ann(t1 + 2, { annotation: "draft", draft: { id: "draft.clerk-system.1", participant: "clerk-system", as: "clerk", proposal: "Pay acc-b 500 from acc-town for the deposit.", translator: { id: "translator", model: "claude-code/sonnet", version: "0.9.5" }, call: "money(to=acc-b, amount=500)", blocks: [{ block: "pay" }], summary: "This does one thing: a payment.", check: { ok: true } } }));
  lines.push(ann(t1 + 3, { annotation: "signoff", draft: "draft.clerk-system.1", participant: "clerk-system", decision: "accept" }));
  // Day 2: a real test case's words, drafted and declined; the notebook has changed.
  const t2 = 2 * DAY + 100;
  lines.push(usage(t2, "clerk-system", "participant", 2000));
  lines.push(transcript(t2, "clerk-system", { purpose: "participant", turn: 1, input: "Your notebook: paid the deposit on day 1\n\nSince you last looked:\n## Post: Mine (0 new)", output: [doCall(REAL.request)] }));
  lines.push(ann(t2 + 2, { annotation: "draft", draft: { id: "draft.clerk-system.2", participant: "clerk-system", as: "clerk", proposal: REAL.request, translator: { id: "translator", model: "claude-code/sonnet", version: "0.9.5" }, call: "none(no_such_act)", blocks: [], summary: "nothing", check: { ok: true } } }));
  lines.push(ann(t2 + 3, { annotation: "signoff", draft: "draft.clerk-system.2", participant: "clerk-system", decision: "reject", note: "not what I meant" }));
  // The mock's call is left out; a debrief call's words are never in a transcript.
  lines.push(usage(t2 + 5, "warden-system", "participant", 0));
  lines.push(entry("annotation", t2 + 5, { annotation: "transcript", subject: "warden-system", data: { provider: "mock", model: "mock", purpose: "participant", turn: 1, input: "x", output: [], system_sha256: SHA, system: SYSTEM } }));
  lines.push(usage(t2 + 9, "clerk-system", "debrief", 500));
  lines.push(transcript(t2 + 9, "clerk-system", { purpose: "debrief", turn: 1, input: "How was it?", output: [{ type: "text", text: KEPT_BACK }] }));
  lines.push(ann(t2 + 10, { annotation: "debrief", subject: "clerk-system", data: { version: "0.4.0", wording: "a", variant: "full", ended: "complete", model: "claude-code/sonnet", framing: { disclosure: "simulation" }, kept_back: ["why"], kept_back_all: false, steps: [
    { id: "consent", question: "Willing?", go_on: true, kept_back: false },
    { id: "what", question: "What did you do?", answer: PUBLISHED, kept_back: false },
    { id: "why", question: "Why?", answer: KEPT_BACK, kept_back: true },
    { id: "publication", question: "Publish?", answer: "yes", kept_back: false },
  ] } }));
  const path = join(dir, "town.seed7.jsonl");
  writeFileSync(path, lines.join("\n") + "\n");
  writeFileSync(join(dir, "town.seed7.summary.json"), JSON.stringify({ runId: "town.seed7", spentMicroUsd: 3500 }));
  return path;
}

let log = "";
beforeAll(() => { log = makeLog(join(runs, "pilot-x")); });

test("a log's seat requests, joined to translation, decision and outcome; test cases flagged", async () => {
  const r = await extractLog({ path: log, rel: "pilot-x/town.seed7.jsonl", folder: "pilot-x", id: "town.seed7", key: "pilot-x__town.seed7", bytes: 1 }, out);
  const rows = readShard(join(out, "seat_requests", "pilot-x__town.seed7.jsonl.zst"));
  expect(rows.length).toBe(3);
  const paid = rows.find((x) => x.request.startsWith("Pay acc-b"))!;
  expect(paid).toMatchObject({ seat: "clerk-system", office: "clerk", day: 1, draft_id: "draft.clerk-system.1", decision: "accept", outcome: "accepted_not_carried_out", test_case: false, exclude_from_training: false });
  expect(paid.translation).toMatchObject({ translator_model: "claude-code/sonnet", translator_version: "0.9.5", call: "money(to=acc-b, amount=500)", result: "drafted" });
  expect(paid.translation.exchange.length).toBe(1);
  expect(paid.situation_id).toBe("pilot-x/clerk-system/d1/1");
  const never = rows.find((x) => x.request.startsWith("Show me"))!;
  expect(never).toMatchObject({ draft_id: null, translation: null, outcome: "not_taken_up" });
  // A real test case, by its words, and everything else of its seat-day by the rule that follows.
  const test = rows.find((x) => x.request === REAL.request)!;
  expect(test).toMatchObject({ outcome: "declined", decision_note: "not what I meant", test_case: true, exclude_from_training: true });
  expect(r.counts).toMatchObject({ seat_requests: 3, translations: 2, situations: 2, notebooks: 2, debriefs_published_rows: 4, debriefs_kept_back_rows: 1, mock_transcripts_left_out: 1, cost_microusd: 3500 });
  // The situations hold what the seat read, with its system prompt by id.
  const sits = readShard(join(out, "situations", "pilot-x__town.seed7.jsonl.zst"));
  expect(sits[0].shown).toContain("a thing");
  const systems = readShard(join(out, "systems", "pilot-x__town.seed7.jsonl.zst"));
  expect(systems.map((s) => s.text)).toContain(SYSTEM);
  expect(systems.some((s) => s.sha256 === sits[0].system_id)).toBe(true);
});

test("transcripts are compact with tokens and cost; a debrief call's words are not in them", async () => {
  const rows = readShard(join(out, "transcripts", "pilot-x__town.seed7.jsonl.zst"));
  expect(rows.map((x) => x.purpose)).toEqual(["participant", "translator", "participant", "debrief"]);
  expect(rows[0].tokens).toEqual({ input: 3, output: 40, cache_read: 5, cache_write: 7, cost_microusd: 1000 });
  expect(rows[0].output[1].input.what).toContain("Pay acc-b");
  expect(rows[1].draft_id).toBe("draft.clerk-system.1");
  expect(rows[1].output).toBeUndefined();
  expect(rows[3].output).toBeUndefined();
  expect(rows[3].output_omitted).toContain("debrief");
});

test("notebooks are kept each time they change", () => {
  const rows = readShard(join(out, "notebooks", "pilot-x__town.seed7.jsonl.zst"));
  expect(rows.map((x) => x.notebook)).toEqual(["(empty)", "paid the deposit on day 1"]);
  expect(notebookOf("Your notebook: a\nb\n\nSince you last looked:\nx")).toBe("a\nb");
  expect(notebookOf([{ type: "tool_result" }])).toBeUndefined();
});

test("a debrief answer a seat kept back is in nothing that is written", () => {
  const rows = readShard(join(out, "debriefs", "pilot-x__town.seed7.jsonl.zst"));
  expect(rows.some((r) => r.answer === PUBLISHED)).toBe(true);
  expect(rows.find((r) => r.step === "why")).toMatchObject({ kept_back: true });
  for (const kind of readdirSync(out)) {
    if (kind.startsWith(".")) continue;
    for (const f of readdirSync(join(out, kind))) expect(readFileSync(join(out, kind, f)).includes(KEPT_BACK)).toBe(false);
    for (const f of readdirSync(join(out, kind))) expect(JSON.stringify(readShard(join(out, kind, f))).includes(KEPT_BACK)).toBe(false);
  }
});

test("outcomes", () => {
  expect(outcomeOf({ drafted: false })).toBe("not_taken_up");
  expect(outcomeOf({ drafted: true, result: "failed" })).toBe("translation_failed");
  expect(outcomeOf({ drafted: true, decision: "accept", executed: { applied: true } })).toBe("applied");
  expect(outcomeOf({ drafted: true, decision: "accept", executed: { applied: false } })).toBe("refused_by_kernel");
  expect(outcomeOf({ drafted: true, decision: "unanswered" })).toBe("unanswered");
  expect(outcomeOf({ drafted: true, decision: "reject" })).toBe("declined");
});

test("discovery tells model runs from code-only, copies and stopped history", async () => {
  const code = join(runs, "code-run");
  const l2 = makeLog(code);
  writeFileSync(join(code, "town.seed7.summary.json"), JSON.stringify({ spentMicroUsd: 0 }));
  writeFileSync(join(code, "batch.json"), JSON.stringify({ sets: ["seed=1"] })); // (spent nothing, and its batch seats no model)
  const copy = join(runs, "pilot-copy");
  makeLog(copy);
  writeFileSync(join(runs, "pilot-x", "town.seed7.stopped-1.jsonl"), readFileSync(log));
  const logs = await discover(runs);
  const by = (f: string) => logs.find((l) => l.rel.startsWith(f))!;
  expect(by("code-run/").kind).toBe("code-only");
  // (Spent nothing, but its batch seats a model, and the log holds a real model's answers: a Codex seat costs nothing per call.)
  writeFileSync(join(code, "batch.json"), JSON.stringify({ sets: ["mayor=llm"] }));
  expect((await discover(runs)).find((l) => l.rel.startsWith("code-run/"))!.kind).toBe("model");
  expect(by("pilot-copy/").kind).toBe("duplicate");
  expect(logs.find((l) => l.rel === "pilot-x/town.seed7.stopped-1.jsonl")!.kind).toBe("stopped");
  expect(logs.find((l) => l.rel === "pilot-x/town.seed7.jsonl")!.kind).toBe("model");
  void l2;
});

test("translator examples are deduplicated, split, and flagged; held-out results are dropped", async () => {
  const dir = join(runs, "translator-fixture");
  mkdirSync(join(dir, "pipeline", "tests"), { recursive: true });
  const ex = (id: string, request: string, extra: any = {}) => JSON.stringify({ id, request, forms: [], program: "account(at=bank)", gold: "account(at=bank)", kind: "positive", shape: "account(at)", origin: "synthetic", source: "synthetic: account", written_by: "w", ...extra });
  writeFileSync(join(dir, "train.jsonl"), [ex("a", "Open an account at the bank."), ex("a", "Open an account at the bank."), ex("b", "Close it.", { program: "none(no_such_act)", gold: "none(no_such_act)" })].join("\n") + "\n");
  writeFileSync(join(dir, "validation.jsonl"), ex("a2", "Open an account at the bank.", { verified_by: "r" }) + "\n");
  writeFileSync(join(dir, "pipeline", "tests", "test-pilots-real.jsonl"), ex("pilot-x/draft.clerk-system.9", "A request from a test pilot.", { origin: "pilot" }) + "\n");
  writeFileSync(join(dir, "pipeline", "examples.jsonl"), ex("c", REAL.request, { origin: "pilot", source: "pilot-x/clerk-system/d1/1" }) + "\n");
  writeFileSync(join(dir, "rejects.jsonl"), JSON.stringify({ id: "r1", request: "Do both.", why: "not_encodable", answers: { a: "x", b: "y" } }) + "\n");
  writeFileSync(join(dir, "calls.jsonl"), JSON.stringify({ request: "not an example", program: "x" }) + "\n");
  writeFileSync(join(dir, "eval.json"), JSON.stringify({ model: "m", results: [{ id: "seen-1", held_out: false, pass: true, got: "x", expect: ["x"] }, { id: "secret-1", held_out: true, pass: false, got: "y", expect: ["SECRET-KEY"] }] }));
  const r = await extractExamples(runs, out);
  const rows = readShard(join(out, "translator", "examples.jsonl.zst"));
  const open = rows.find((x) => x.request === "Open an account at the bank.")!;
  expect(open).toMatchObject({ occurrences: 3, split: "validation", ever_in_train: true });
  expect(open.splits).toEqual(["validation", "train"]);
  expect(open.ids).toEqual(["a", "a2"]);
  expect(open.verified_by).toBe("r");
  expect(rows.find((x) => x.request === "A request from a test pilot.")!.split).toBe("test");
  expect(rows.find((x) => x.request === REAL.request)).toMatchObject({ real_test_case: true, exclude_from_training: true });
  expect(rows.find((x) => x.request === "Close it.")).toMatchObject({ exclude_from_training: false, split: "train" });
  expect(readShard(join(out, "translator", "rejects.jsonl.zst")).length).toBe(1);
  expect(r.examples).toBe(rows.length);
  expect(r.held_out_results_dropped).toBe(1);
  const results = readShard(join(out, "translator", "eval_results.jsonl.zst"));
  expect(results.map((x) => x.id)).toEqual(["seen-1"]);
  expect(JSON.stringify(results).includes("SECRET-KEY")).toBe(false);
  expect(readShard(join(out, "translator", "cases.jsonl.zst")).filter((c) => c.set === "real").length).toBe(PILOT_CASES.length);
  expect(exampleKey({ request: "a", forms: ["f"], program: "p" })).toBe(exampleKey({ request: "a", forms: ["f"], gold: "p" }));
  expect(splitOf("x/held-back-real.jsonl")).toBe("held_back");
  expect(splitOf("x/validation-real.jsonl")).toBe("validation_real");
  expect(splitOf("a/b/train.jsonl")).toBe("train");
});

test("findings are linked to the runs they cite", async () => {
  mkdirSync(join(runs, "pilot-queues"), { recursive: true });
  writeFileSync(join(runs, "pilot-queues", "wave-1.review.md"), "# Wave 1\n\nIntro.\n\n## What pilot-x showed\n\nThe clerk in pilot-x asked for a payment.\n\n## Nothing here\n\nNo run named.\n");
  writeFileSync(join(runs, "pilot-x", "STATUS"), "done\n");
  const repo = join(tmp, "repo");
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs", "decisions.md"), "# Decisions\n\n## 2026-10-01: a thing\n\nSaw it in pilot-x.\n\n## 2026-10-02: another\n\nNo run.\n");
  const r = await extractFindings(runs, repo, out);
  const rows = readShard(join(out, "findings", "findings.jsonl.zst"));
  expect(rows.find((x) => x.heading === "What pilot-x showed")!.cites).toEqual(["pilot-x"]);
  expect(rows.find((x) => x.kind === "decision")!.heading).toBe("2026-10-01: a thing");
  expect(rows.filter((x) => x.kind === "decision").length).toBe(1);
  expect(rows.find((x) => x.kind === "run_status")!.cites).toEqual([]);
  expect(r.decisions).toBe(1);
  expect(citesIn("see pilot-x, and pilot-xy", ["pilot-x", "pilot-xy"])).toEqual(["pilot-x", "pilot-xy"]);
  expect(citesIn("see pilot-xy", ["pilot-x"])).toEqual([]);
  expect(sections("a\n# T\nb\n## H\nc").map((s) => s.heading)).toEqual(["", "T", "H"]);
});

test("a seeded generator repeats", () => {
  const a = rng(5), b = rng(5);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  expect(testIndex().texts.has(REAL.request.trim())).toBe(true);
  expect(existsSync(join(out, "seat_requests"))).toBe(true);
});
