import { expect, test } from "bun:test";
import { calls } from "@terrarium/participants";
import { MockAdapter } from "@terrarium/participants/llm";
import { CASES } from "../eval/cases";
import { evaluate, reportText } from "../eval/run";

test("every case's accepted answers are valid call-language programs", () => {
  for (const c of CASES) for (const e of c.expect) expect(() => calls.parseProgram(e)).not.toThrow();
  expect(CASES.filter((c) => c.held_out).length).toBeGreaterThanOrEqual(5);
});

test("the harness: a model answering with the accepted call passes; one answering otherwise fails", async () => {
  // A stand-in model that answers each request with its case's first accepted answer (or, for held-out cases, nonsense).
  const byRequest = new Map(CASES.map((c) => [c.request, c]));
  const adapter = new MockAdapter("mock", {
    translator: (req) => {
      const c = byRequest.get(req.context.proposal)!;
      return [{ type: "tool_use", id: "1", name: "call", input: { program: c.held_out ? "none(unclear)" : c.expect[0] } }];
    },
  });
  const r = await evaluate(adapter);
  const seen = CASES.filter((c) => !c.held_out).length;
  expect(r.seen).toEqual({ passed: seen, of: seen, no_draft: 0, wrong_draft: 0 });
  expect(r.held_out.passed).toBeLessThan(r.held_out.of); // "none(unclear)" is right for none of them
  expect(r.held_out.wrong_draft).toBe(0); // a refusal where a call was wanted is no draft, not a wrong one
  expect(reportText(r)).toContain("held out");
});
