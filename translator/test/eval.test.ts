import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import { MockAdapter } from "@oikos/participants/llm";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CASES, type Case } from "../eval/cases";
import { evaluate, heldOutPath, leaks, loadHeldOut, passes, publicReport, reportText, shape } from "../eval/run";
import { translatorSystem } from "../src/index";

const root = join(import.meta.dir, "../..");

test("every case's accepted answers are valid call-language programs, and every case in the repository is a seen one", () => {
  for (const c of CASES) for (const e of c.expect) expect(() => calls.parseProgram(e)).not.toThrow();
  // The held-out cases live outside the repository (eval/held-out.ts): one marked held out here would be read by
  // whoever works on the prompt.
  expect(CASES.filter((c) => c.held_out).map((c) => c.id)).toEqual([]);
});

// Stand-ins for held-out cases, for testing the harness (the real ones are never in the repository).
const STAND_INS: Case[] = [
  { id: "x-1", request: "Kindly forward forty dollars to the bakery's account for the bread order.", expect: ['money(to=bakery, amount="$40", for="the bread order")'] },
  { id: "x-2", request: "Somebody ought to deal with the drains, I suppose.", expect: ["none(unclear)"] },
];

test("the harness: a model answering with the accepted call passes; one answering otherwise fails", async () => {
  // A stand-in model that answers each seen request with its case's first accepted answer, and each held-out one with a refusal.
  const byRequest = new Map(CASES.map((c) => [c.request, c]));
  const adapter = new MockAdapter("mock", {
    translator: (req) => [{ type: "tool_use", id: "1", name: "call", input: { program: byRequest.get(req.context.proposal)?.expect[0] ?? "none(unclear)" } }],
  });
  const r = await evaluate(adapter, { heldOut: STAND_INS });
  expect(r.seen).toEqual({ passed: CASES.length, of: CASES.length, no_draft: 0, wrong_draft: 0 });
  expect(r.held_out).toEqual({ passed: 1, of: 2, no_draft: 1, wrong_draft: 0 }); // a refusal where a call was wanted is no draft, not a wrong one
  expect(r.held_out_leaks).toBeUndefined();
  expect(reportText(r)).toContain("held out 1/2 right");
  // Without the held-out cases, the report says they weren't run rather than showing an empty score.
  expect(reportText(await evaluate(adapter))).toContain("held out not run");
});

test("the name a program gives what it makes is no part of the answer", () => {
  const c: Case = { id: "b", request: "…", expect: ['t = entity(kind=trust, name="River Land Trust")\nstatement(kind=charter, for=t, text="It holds land.")'] };
  expect(passes(c, 'trust = entity(kind=trust, name="River Land Trust")\nstatement(kind=charter, for=trust, text="It holds land.")')).toBe(true);
  expect(passes(c, 'trust = entity(kind=trust, name="River Land Trust")\nstatement(kind=charter, for=city, text="It holds land.")')).toBe(false);
});

test("what's reported of a held-out case never includes its wording", async () => {
  const adapter = new MockAdapter("mock", { translator: () => [{ type: "tool_use", id: "1", name: "call", input: { program: 'message(to=bakery, text="About the bread order.")' } }] });
  const r = await evaluate(adapter, { cases: [], heldOut: STAND_INS });
  const shown = reportText(r) + JSON.stringify(publicReport(r));
  for (const secret of ["bread", "bakery", "drains", "$40", "forty"]) expect(shown).not.toContain(secret);
  // What is shown: the id, the outcome, and the shape of what was wanted and what came back.
  expect(reportText(r)).toContain("- [wrong_draft] x-1 (held out): got message; wanted money");
  expect(reportText(r)).toContain("- [wrong_draft] x-2 (held out): got message; wanted none(unclear)");
  expect(shape("a = entity(kind=trust, name=\"T\")\nstatement(kind=charter, for=a, text=\"x\")")).toBe("entity+statement");
});

test("shared wording between a held-out case and the prompt or a seen case is found, and the report says so", async () => {
  expect(leaks(STAND_INS, [{ name: "a prompt", text: "…e.g. \"forward forty dollars to the bakery's account\"…" }])).toEqual([{ id: "x-1", source: "a prompt" }]);
  expect(leaks(STAND_INS, [{ name: "a prompt", text: "Forward the minutes to the bakery." }])).toEqual([]); // four words in a row aren't five
  const adapter = new MockAdapter("mock", { translator: () => [{ type: "tool_use", id: "1", name: "call", input: { program: "none(unclear)" } }] });
  const seen: Case[] = [{ id: "s-1", request: "Somebody ought to deal with the drains today.", expect: ["none(unclear)"] }];
  const r = await evaluate(adapter, { cases: seen, heldOut: STAND_INS });
  expect(r.held_out_leaks).toEqual([{ id: "x-2", source: "the seen cases" }]);
  expect(reportText(r)).toContain("NOT A HELD-OUT RESULT");
});

// On a machine that has the held-out cases (the run server): they are well formed, and nothing in the repository that a
// prompt's author reads shares their wording. Elsewhere there is nothing to check.
test.skipIf(!existsSync(heldOutPath()))("the held-out cases share no wording with the prompt, the seen cases, the call language or the docs", () => {
  const heldOut = loadHeldOut()!;
  for (const c of heldOut) for (const e of c.expect) expect(() => calls.parseProgram(e)).not.toThrow();
  const seenIds = new Set(CASES.map((c) => c.id));
  expect(heldOut.filter((c) => seenIds.has(c.id)).map((c) => c.id)).toEqual([]);
  const doc = (f: string) => ({ name: f, text: readFileSync(join(root, f), "utf8") });
  expect(leaks(heldOut, [
    { name: "the translator's prompt", text: translatorSystem() },
    { name: "the seen cases", text: CASES.map((c) => c.request).join("\n") },
    ...["contracts/calls.md", "docs/real-models.md", "docs/decisions.md", "docs/gaps.md", "docs/design/translator-and-resolver.md", "docs/design/llm-readiness.md"].map(doc),
  ])).toEqual([]);
});
