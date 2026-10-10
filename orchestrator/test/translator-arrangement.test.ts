// Two translators as one, in a run (translator/src/arrangement.ts; orchestrator/src/run.ts): a scripted seat's
// requests go to a first translator and, where that one fails or the seat declines its draft, to the one behind. The
// log says for every request who answered and what each said; the pilot report and the dataset read it; nothing the
// seat was shown names either; a run that stopped resumes with both translators' answers served from its log; and a
// run with no first translator is as it was.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAdapter, type LlmAdapter, type LlmRequest } from "@oikos/participants/llm";
import { generate } from "@oikos/worlds/generator/generate";
import { resumeCommand, translatorArrangement } from "../src/batch";
import { exportDataset } from "../src/dataset";
import { clearForFreshRun, realModelIn } from "../src/logs";
import { pilotReport, renderReport } from "../src/pilot-report";
import { prepareResume, recordedCalls, Serving } from "../src/resume";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const dir = (name: string) => mkdtempSync(join(tmpdir(), `oikos-arrangement-${name}-`));
const lines = (log: string) => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const PRICES = { "decide/trained-x1": { input: 0, output: 0, cache_read: 0, cache_write: 0 } };

/** What the seat asks for, in order; it confirms every draft but the one of its third request, which it declines. */
const ASKS = [
  "Publish a notice: the hall opens at nine.", // the first drafts it; confirmed
  "Publish a notice for whoever asked about the hall.", // the first refuses (look_first); behind drafts; confirmed
  "Publish a notice: the baths are shut.", // the first drafts it; DECLINED
  "Publish a notice that the baths are shut on Friday.", // the seat's next request: behind
  "Show me the ledger of the town account.", // the first: not_an_act, which stands
  "Publish a notice: the market is on Sunday.", // the first is unsure (under its cut-off): behind
];
const notice = (text: string) => `statement(kind=notice, text="${text}")`;
/** The seat and the translator behind it (the mock), and the translator that answers first. */
function cast() {
  let n = 0, asked = 0;
  const calls = { seat: 0, behind: 0, first: 0 };
  const today = new Map<number, number>();
  const use = (name: string, input: object) => ({ type: "tool_use" as const, id: `t${++n}`, name, input });
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      calls.seat++;
      const draft = req.context.observation.drafts[0];
      if (draft) return [use("confirm", { ref: draft.id, decision: draft.id.endsWith(".3") ? "decline" : "confirm" })];
      // (Two requests a sitting, so that its requests fall on several days.)
      const day = Math.floor(req.context.observation.t / DAY);
      if (asked >= ASKS.length || (today.get(day) ?? 0) >= 2) return [use("done_for_now", {})];
      today.set(day, (today.get(day) ?? 0) + 1);
      return [use("do", { what: ASKS[asked++]! })];
    },
    translator: (req: LlmRequest) => {
      calls.behind++;
      const q = String(req.context.proposal);
      return [use("call", { program: q.includes("ledger") ? "none(not_an_act)" : notice(q.includes("whoever") ? "The hall opens at nine." : q.includes("Friday") ? "The baths are shut on Friday." : q.includes("market") ? "The market is on Sunday." : "?") })];
    },
    debrief: () => [{ type: "text", text: "Thanks." }],
  });
  const first: LlmAdapter = { provider: "decide", model: "trained-x1", complete: async (req) => {
    calls.first++;
    const q = String(req.context.proposal);
    const input = q.includes("whoever") ? { program: "none(look_first)", sure_ppm: 910_000, ms: 60 }
      : q.includes("ledger") ? { program: "none(not_an_act)", sure_ppm: 999_000, ms: 20 }
      : q.includes("market") ? { program: "none(unclear)", sure_ppm: 50_000, ms: 80, withheld: "cut_off", wrote: notice("The market is on Sunday."), unsure: { kind: "words" } }
      : { program: notice(q.includes("hall") ? "The hall opens at nine." : q.includes("Friday") ? "The baths are shut." : "The baths are shut."), sure_ppm: 970_000, ms: 70 };
    return { content: [{ type: "tool_use", id: "decide", name: "call", input }], usage: { input_tokens: 0, output_tokens: 0 }, estimated: true };
  } };
  return { adapter, first, calls };
}
const config = () => {
  const c = generate({ ...spec, citizens: 20, mayor: "llm" });
  // (No debrief: a run that is stopped and resumed has none at its stop, and this one is compared with a whole one.)
  for (const p of [...c.participants, ...c.positions]) if (p.framing?.debrief) p.framing = { ...p.framing, debrief: false };
  return c;
};
const routesOf = (log: string) => lines(log).filter((e) => e.body?.data?.translation_route).map((e) => e.body.data.translation_route);

test("then: each request's route is in the log; the report and the dataset read it; the seat is shown no trace of two", async () => {
  const out = dir("then");
  const c = cast();
  const s = await runWorld({ config: config(), runId: "town.seed1", outDir: out, until: 30 * DAY, adapter: c.adapter, translatorFirst: c.first, translatorArrangement: "then", prices: PRICES });
  const routes = routesOf(s.logPath);
  expect(routes.map((r) => [r.draft.replace("draft.mayor-system.", ""), r.used, r.why ?? "", r.first.result, r.behind?.result ?? ""])).toEqual([
    ["1", "first", "", "draft", ""],
    ["2", "behind", "refused", "refusal", "draft"],
    ["3", "first", "", "draft", ""],
    ["4", "behind", "declined_before", "draft", "draft"],
    ["5", "first", "", "refusal", ""],
    ["6", "behind", "unsure", "asked_back", "draft"],
  ]);
  // The first's sureness, time and what it withheld are on record; and whether the two agreed where both answered.
  expect(routes[1]).toMatchObject({ arrangement: "then", first: { model: "decide/trained-x1", label: "look_first", sure_ppm: 910_000, ms: 60 }, behind: { model: "mock/mock" }, agree: false });
  expect(routes[3]).toMatchObject({ agree: true, agree_text: false }); // (the same notice, in other words)
  expect(routes[5]).toMatchObject({ first: { withheld: "cut_off", wrote: 'statement(kind=notice, text="The market is on Sunday.")', sure_ppm: 50_000 } });
  expect(c.calls.first).toBe(6); // once a request, also where the request was going behind anyway
  expect(c.calls.behind).toBe(3);
  // The run's own record of the arrangement, and every model call of either with its model and cost.
  const all = lines(s.logPath);
  const orch = all.find((e) => e.body?.annotation === "orchestrator").body.data.llm;
  expect(orch.translator).toMatchObject({ id: "translator", model: "decide/trained-x1" });
  expect(orch.translator_arrangement).toEqual({ arrangement: "then", first: orch.translator, behind: { ...orch.translator, model: "mock/mock" }, stands: ["not_an_act"] });
  const usage = all.filter((e) => e.body?.annotation === "usage" && e.body.purpose === "translator").map((e) => `${e.body.provider}/${e.body.model}`);
  expect(usage.filter((m) => m === "decide/trained-x1").length).toBe(6);
  expect(usage.filter((m) => m === "mock/mock").length).toBe(3);
  // A draft says who drew it up, and an act carries that with it.
  const drafts = all.filter((e) => e.body?.annotation === "draft").map((e) => [e.body.draft.id.replace("draft.mayor-system.", ""), e.body.draft.translator.model]);
  expect(drafts).toEqual([["1", "decide/trained-x1"], ["2", "mock/mock"], ["3", "decide/trained-x1"], ["4", "mock/mock"], ["6", "mock/mock"]]);
  // Nothing the seat was shown (every prompt its model was given) names a translator, a model of one, or that there are two.
  const shown = all.filter((e) => e.body?.annotation === "transcript" && e.body.data.purpose === "participant").map((e) => JSON.stringify([e.body.data.system ?? "", e.body.data.input]));
  expect(shown.length).toBeGreaterThan(8);
  for (const text of shown) expect(text).not.toMatch(/decide\/|trained-x1|mock\/mock|sure_ppm|translation_route|look_first|cut_off|behind it|answers first/);
  expect(shown.some((x) => x.includes("That's something to look up or read"))).toBe(true); // (the refusal that stood, in the world's words)

  // The pilot report: one line, and the counts behind it.
  const r = await pilotReport(out, false);
  expect(r.translator_arrangement).toMatchObject({
    arrangement: "then", first: "decide/trained-x1", behind: "mock/mock", requests: 6, answered_by_first: 3, first_refusals_that_stood: 1, handed_behind: 3,
    handed_behind_why: { refused: 1, declined_before: 1, unsure: 1 }, both_answered: 3, agreed: 1,
    agreed_by_what_the_first_answered: { "refusal:look_first": { agreed: 0, of: 1 }, draft: { agreed: 1, of: 1 }, asked_back: { agreed: 0, of: 1 } },
    seats_answers: { first: { drafts: 2, confirmed: 1, declined: 1, unanswered: 0 }, behind: { drafts: 3, confirmed: 3, declined: 0, unanswered: 0 } },
    first_calls: { calls: 6, cost_microusd: 0, ms: 370, mean_ms: 62 }, behind_calls: { calls: 3 },
  });
  expect(renderReport(r)).toContain("   two translators (then): 6 requests; the first (decide/trained-x1) answered 3 (drafts 2: confirmed 1, declined 1; refusals that stood 1; 62 ms a request); behind (mock/mock) 3: refused 1, declined_before 1, unsure 1 (drafts 3: confirmed 3, declined 0; 0 microusd); both answered 3, agreed 1\n");

  // The dataset: each translation with its route, valid against the contract; its exchange is that of whoever answered.
  const data = join(out, "d.dataset");
  await exportDataset(s.logPath, data, {});
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  for (const f of readdirSync(join(root, "contracts")).filter((f) => f.endsWith(".schema.json"))) ajv.addSchema(JSON.parse(readFileSync(join(root, "contracts", f), "utf8")));
  const valid = ajv.getSchema("urn:oikos:contracts:0.8:dataset#/$defs/Translation")!;
  const rows = readFileSync(join(data, "translations.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const x of rows) expect([x.draft, valid(x)]).toEqual([x.draft, true]);
  expect(rows.map((x) => [x.model, x.route.used, x.exchange.length, x.result])).toEqual([
    ["decide/trained-x1", "first", 1, "drafted"], ["mock/mock", "behind", 1, "drafted"], ["decide/trained-x1", "first", 1, "drafted"], ["mock/mock", "behind", 1, "drafted"], ["decide/trained-x1", "first", 1, "failed"], ["mock/mock", "behind", 1, "drafted"],
  ]);
  expect(rows[1].route.first).toMatchObject({ model: "decide/trained-x1", call: "none(look_first)", sure_ppm: 910_000 });
  expect(rows[1].synthetic).toBe(true);
  expect(rows[0].synthetic).toBe(false);
  // (A log of the mock and our own model alone can be made again: it is no real model's run.)
  expect(await realModelIn(s.logPath)).toBeUndefined();
}, 120_000);

test("beside: the one behind answers every request and the first is only recorded; the world is the one it is without a first", async () => {
  const a = cast(), b = cast();
  const beside = await runWorld({ config: config(), runId: "town.seed1", outDir: dir("beside"), until: 30 * DAY, adapter: a.adapter, translatorFirst: a.first, translatorArrangement: "beside", prices: PRICES });
  const alone = await runWorld({ config: config(), runId: "town.seed1", outDir: dir("alone"), until: 30 * DAY, adapter: b.adapter });
  const routes = routesOf(beside.logPath);
  expect(routes.length).toBe(6);
  expect(routes.every((r) => r.arrangement === "beside" && r.used === "behind" && r.why === "beside" && r.first.model === "decide/trained-x1" && r.behind.model === "mock/mock")).toBe(true);
  expect(a.calls.first).toBe(6);
  expect(a.calls.behind).toBe(b.calls.behind);
  // Every draft is the one behind's, and the world ends as it does with that translator alone.
  const drafts = lines(beside.logPath).filter((e) => e.body?.annotation === "draft");
  expect(drafts.every((e) => e.body.draft.translator.model === "mock/mock")).toBe(true);
  expect(beside.stateHash).toBe(alone.stateHash);
  const orch = lines(beside.logPath).find((e) => e.body?.annotation === "orchestrator").body.data.llm;
  expect(orch.translator.model).toBe("mock/mock");
  expect(orch.translator_arrangement.arrangement).toBe("beside");
  // A run with no first translator says nothing of an arrangement, and notes no route.
  expect(routesOf(alone.logPath)).toEqual([]);
  expect(lines(alone.logPath).find((e) => e.body?.annotation === "orchestrator").body.data.llm.translator_arrangement).toBeUndefined();
  expect((await pilotReport(join(alone.logPath, ".."), false)).translator_arrangement).toBeUndefined();
}, 120_000);

test("a stopped run resumes with both translators' answers served from its log, to the same world", async () => {
  const whole = cast();
  const u = await runWorld({ config: config(), runId: "town.seed1", outDir: dir("whole"), until: 30 * DAY, adapter: whole.adapter, translatorFirst: whole.first, prices: PRICES });
  const d = dir("cut");
  const before = cast();
  await runWorld({ config: config(), runId: "town.seed1", outDir: d, until: 12 * DAY, adapter: before.adapter, translatorFirst: before.first, prices: PRICES });
  const had = { ...before.calls };
  expect(had.first).toBe(4); // (two sittings of two requests)
  const r0 = prepareResume(join(d, "town.seed1.jsonl"));
  const serving = new Serving(recordedCalls(r0.stoppedLog));
  // (The same seat and translators go on live, from where the stopped run left them: what it had asked is served.)
  const r = await runWorld({ config: r0.config, runId: r0.runId, outDir: d, until: 30 * DAY, adapter: serving.wrap(before.adapter), translatorFirst: serving.wrap(before.first), prices: PRICES, resumedFrom: { log: "town.seed1.stopped-1.jsonl", serving } });
  expect(serving.diverged).toBeUndefined();
  expect(serving.served).toBe(had.seat + had.behind + had.first);
  expect(before.calls.first).toBe(6); // (asked live only for what the stopped run had not asked)
  expect(before.calls.behind).toBe(whole.calls.behind);
  expect(r.stateHash).toBe(u.stateHash);
  expect(routesOf(r.logPath).map((x) => [x.used, x.why ?? ""])).toEqual(routesOf(u.logPath).map((x) => [x.used, x.why ?? ""]));
}, 120_000);

test("naming the arrangement: then unless beside is said, nothing without a first, and the resume command says it again", () => {
  expect(translatorArrangement({ translatorFirst: "decide/x" })).toBe("then");
  expect(translatorArrangement({ translatorFirst: "decide/x", translatorArrangement: "beside" })).toBe("beside");
  expect(translatorArrangement({})).toBe("then");
  expect(() => translatorArrangement({ translatorArrangement: "beside" })).toThrow("needs --translator-first");
  expect(() => translatorArrangement({ translatorFirst: "decide/x", translatorArrangement: "both" })).toThrow("then or beside");
  expect(resumeCommand("runs/p/town.seed1.jsonl", { model: "claude-code/claude-sonnet-5-5", translatorFirst: "decide/pod-small-r2-s1", translatorArrangement: "then", budgetUsd: 12 }))
    .toBe("oikos resume runs/p/town.seed1.jsonl --model claude-code/claude-sonnet-5-5 --translator-first decide/pod-small-r2-s1 --translator-arrangement then --budget 12");
  expect(resumeCommand("runs/p/town.seed1.jsonl", { model: "claude-code/claude-sonnet-5-5", budgetUsd: 12 })).toBe("oikos resume runs/p/town.seed1.jsonl --model claude-code/claude-sonnet-5-5 --budget 12");
});

test("a log whose only model is our own trained one may be made again; one with any real seat's or prompt-driven translator's call is never overwritten", async () => {
  const usage = (provider: string, model: string, purpose: string, subject: string) => JSON.stringify({ kind: "annotation", t: 0, body: { annotation: "usage", purpose, subject, provider, model, input_tokens: 0, output_tokens: 0, cost_microusd: 0 } });
  const header = JSON.stringify({ kind: "header", t: 0, body: {} });
  const ours = usage("decide", "trained-x1", "translator", "translator"), mock = usage("mock", "mock", "participant", "mayor-system");
  const cases: [string, string[], string | undefined][] = [
    ["the mock and our own model", [mock, ours, usage("mock", "mock", "translator", "translator")], undefined],
    ["a prompt-driven translator behind ours", [mock, ours, usage("claude-code", "claude-sonnet-5-5", "translator", "translator")], "claude-code/claude-sonnet-5-5"],
    ["a real seat, ours the only translator", [usage("claude-code", "claude-sonnet-5-5", "participant", "mayor-system"), ours], "claude-code/claude-sonnet-5-5"],
    ["a real seat on another sign-in", [ours, usage("codex", "gpt-6.1-sol", "participant", "finance-system")], "codex/gpt-6.1-sol"],
  ];
  for (const [name, entries, real] of cases) {
    const d = dir("guard");
    const log = join(d, "town.seed1.jsonl");
    writeFileSync(log, [header, ...entries].join("\n") + "\n");
    expect([name, await realModelIn(log)]).toEqual([name, real]);
    // (Asked to overwrite: only the log that can be made again goes.)
    if (real) await expect(clearForFreshRun(d, "town.seed1", true)).rejects.toThrow("holds a real model's answers");
    else await clearForFreshRun(d, "town.seed1", true);
    expect([name, existsSync(log)]).toEqual([name, !!real]);
    // (And not asked to: nothing is ever overwritten.)
    if (real) await expect(clearForFreshRun(d, "town.seed1")).rejects.toThrow("runs are never overwritten");
  }
});
