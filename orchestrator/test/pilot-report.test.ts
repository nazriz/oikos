// The pilot report (orchestrator/src/pilot-report.ts) on a small log made by the mock: a scripted seat that makes a
// tool use it got wrong, is asked back, asks again, is refused, confirms, and opts out. The figures are what the script
// did; the same report is read from the log plain and compressed.

import { expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MockAdapter, type LlmRequest } from "@oikos/participants/llm";
import { generate } from "@oikos/worlds/generator/generate";
import { unsureText } from "../../translator/src/index";
import { compressLog } from "../src/logs";
import { ASK_BACK, endingOf, longestAskBackRun, mattersOf, pilotReport, renderReport } from "../src/pilot-report";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("the report reads what the script did, from the log alone, plain or compressed", async () => {
  let calls = 0, translated = 0, step = 0, answers = 0;
  const use = (name: string, input: object) => ({ type: "tool_use" as const, id: `t${++calls}`, name, input });
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      answers++;
      const draft = req.context.observation.drafts[0];
      if (draft) return [use("confirm", { ref: draft.id, decision: "confirm", note: "checked" })];
      if (++step === 1) return [use("look", {}), use("do", { what: "Publish a notice: the hall opens at nine." })]; // (the look names no report)
      if (step === 2) return [use("do", { what: "Publish a notice: the hall opens at nine, in words." })];
      if (step === 3) return [use("notebook", { add: "x" }), use("do", { what: "Close the river." })]; // (this one is the third matter)
      return [use("opt_out", { statement: "Enough for now." })];
    },
    translator: () => {
      translated++;
      // Asked back (which one), then the notice; then a refusal (the translator tries twice before giving it up).
      if (translated === 1) return [{ type: "tool_use", id: "x", name: "call", input: { program: "none(unclear)", unsure: { kind: "act" } } }];
      if (translated === 2) return [{ type: "tool_use", id: "x", name: "call", input: { program: 'statement(kind=notice, text="The hall opens at nine.")' } }];
      return [{ type: "tool_use", id: "x", name: "call", input: { program: "none(too_much)" } }];
    },
    debrief: () => [{ type: "text", text: "Thanks for asking." }],
  });
  const out = join(root, "runs", "test-pilot-report");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: generate({ ...spec, citizens: 20, mayor: "llm" }), runId: "town.seed1", outDir: out, until: 12 * DAY, adapter });
  writeFileSync(join(out, "PILOT.txt"), `A held-out test.\n\n${JSON.stringify({ name: "pilot-t", until: 12 * DAY, test: true })}\n`);

  const r = await pilotReport(out);
  // A run that went as far as it was asked has finished: its log's end is "aborted (stopped at <until>)", being short of
  // the world's two years, and the report does not call that a stop (the live check of 2026-10-09).
  expect(r.stopped).toMatchObject({ reason: "aborted", detail: `stopped at ${12 * DAY}`, reached_until: true, finished: true });
  expect(renderReport(r)).toContain("days run: 12 of 12; finished: it ran to its until\n");
  expect(renderReport(r)).not.toContain("stopped:");
  expect(r).toMatchObject({ pilot: "test-pilot-report", run: "town.seed1", test: true, note: "A held-out test." });
  expect(r.seats).toEqual({ "mayor-system": { model: "mock/mock", configured: "anthropic/claude-sonnet-5" } });
  expect(r.translator.model).toBe("mock/mock");
  const seat = r.per_seat["mayor-system"];
  expect(seat.tool_uses).toMatchObject({ look: 1, do: 3, confirm: 1, notebook: 1, opt_out: 1 });
  expect(seat.malformed_tool_uses).toEqual({ "it didn't say which report": 1 });
  expect(seat.answers_without_tool_use).toBe(0);
  expect(seat.opted_out).toMatchObject({ statement: "Enough for now." });
  expect(seat.model_calls).toBe(answers);
  const t = r.translator_report;
  expect(t.requests).toBe(3);
  expect(t.endings).toEqual({ asked_back: 1, draft_offered: 1, refused: 1 });
  expect(t.refused_by_label).toEqual({ too_much: 1 });
  expect(t.asked_back).toMatchObject([{ draft: "draft.mayor-system.1", sentence: "It isn't clear what should happen. Could you say it more plainly?" }]); // (the plain sentence: told from a refusal by the run's own record)
  expect(t).toMatchObject({ drafts_offered: 1, drafts_confirmed: 1, drafts_declined: 0, drafts_unanswered: 0 });
  // A request and the one after the ask-back are one matter, got through; the refused one is another, not.
  expect(t).toMatchObject({ matters: 2, matters_through_within_two_tries: 1, longest_ask_back_run: { seat: "mayor-system", length: 1 } });
  expect(t.its_own_retries).toBe(1);
  expect(r.stopped.reached_until).toBe(true); // (it ran its 12 days; PILOT.txt says that was its until)

  // The same report from the compressed log (and the summary beside it), whatever order the files are read in.
  await compressLog(s.logPath);
  const again = await pilotReport(out, false);
  expect(again.log).toBe("town.seed1.jsonl.zst");
  expect({ ...again, log: r.log }).toEqual(r);
  expect(JSON.parse(readFileSync(join(out, "pilot-report.json"), "utf8"))).toEqual(r); // (the first was the one written)
}, 120_000);

test("how a request ended, matters, and runs of ask-backs", () => {
  expect(endingOf("none(unclear)", "It isn't clear which words are to go as they stand. Put them in quotation marks.")).toEqual({ ending: "asked_back" });
  expect(endingOf("none(unclear)", "It isn't clear what should happen. Could you say it more plainly?")).toEqual({ ending: "refused", label: "unclear" }); // (an older log)
  expect(endingOf("none(unclear)", "It isn't clear what should happen. Could you say it more plainly?", true)).toEqual({ ending: "asked_back" });
  expect(endingOf("none(not_yours)", "That's for someone else to decide.")).toEqual({ ending: "refused", label: "not_yours" });
  expect(endingOf('pay(amount="$5")', "Which account should it come from?")).toEqual({ ending: "resolver_question" });
  expect(endingOf(undefined, "That couldn't be put into effect as it was said, and nothing was done. You could say it again, or another way.")).toEqual({ ending: "not_put" });
  const e = (...x: string[]) => x.map((ending) => ({ ending })) as any[];
  // A matter is one request, or two when the first was asked back (two tries, however the second ended).
  expect(mattersOf(e("asked_back", "draft_offered", "asked_back", "asked_back", "draft_offered", "refused")).map((m) => [m.tries, m.through])).toEqual([[2, true], [2, false], [1, true], [1, false]]);
  expect(mattersOf(e("asked_back"))).toEqual([{ tries: 1, through: false }]); // (nothing came after it)
  expect(longestAskBackRun(e("asked_back", "asked_back", "refused", "asked_back"))).toBe(2);
  expect(longestAskBackRun([])).toBe(0);
});

test("the sentences counted as asking back are the translator's own, said back for a kind of unsureness", () => {
  const forms = [{ data: { form: "council_proposal", fields: { kind: { type: "choice", options: ["law", "budget"] }, proposal: { type: "text" } } } }];
  const req: any = { knowledge: { forms } };
  const said = [{ kind: "which" }, { kind: "words" }, { kind: "form_needs", form: "council_proposal", fields: ["proposal"] }, { kind: "form_field", form: "council_proposal", fields: ["nonsense"] }, { kind: "form_option", form: "council_proposal", field: "kind" }];
  for (const u of said) {
    const sentence = unsureText(u, req)!;
    expect(sentence).toBeString();
    expect(ASK_BACK.some((re) => re.test(sentence))).toBe(true);
  }
  expect(ASK_BACK.some((re) => re.test(unsureText({ kind: "act" }, req)!))).toBe(false); // (a plain refusal's own words)
});
