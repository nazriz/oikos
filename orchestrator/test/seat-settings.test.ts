// A seat's settings, as a town's description gives them (docs/real-models.md, "A seat's settings"): whether a paper
// filed with its office brings it back (`wake_on_papers`, on unless set false), and how hard its model reasons
// (`seat_effort`, the model's own default unless set). A queue entry sets either with `sets`.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeAdapter, CodexCliAdapter, type LlmRequest } from "@oikos/participants/llm";
import { generate } from "@oikos/worlds/generator/generate";
import { setPath } from "../src/batch";
import { runWorld } from "../src/run";
import { officeAt, officeBy, officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = () => Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const seatsOf = (config: any) => Object.fromEntries(config.participants.filter((p: any) => p.controller.type === "llm").map((p: any) => [p.id, p.controller.params]));

test("a town's description sets each seat's effort (one word for all, or by office) and whether papers bring seats back; neither is set unless given", () => {
  const plain = seatsOf(generate({ ...spec(), model_seats: "finance,works" }));
  for (const p of Object.values<any>(plain)) { expect(p.effort).toBeUndefined(); expect(p.wake_on_papers).toBeUndefined(); }
  // As a queue entry writes them: "sets": ["seat_effort.finance=low", "wake_on_papers=false"].
  const s = { ...spec(), mayor: "llm", model_seats: "finance,works" };
  setPath(s, "seat_effort.finance=low");
  setPath(s, "wake_on_papers=false");
  const set = seatsOf(generate(s));
  expect(set["finance-system"]).toMatchObject({ effort: "low", wake_on_papers: false });
  expect(set["works-system"].effort).toBeUndefined();
  expect(set["mayor-system"]).toMatchObject({ wake_on_papers: false });
  const all = seatsOf(generate({ ...spec(), model_seats: "finance", seat_effort: "low" }));
  expect(Object.values<any>(all).map((p) => p.effort)).toEqual(Object.values(all).map(() => "low"));
});

test("a call's effort is the seat's where it has one, before the one named with the model; with neither, none is passed", async () => {
  const req: LlmRequest = { purpose: "participant", subject: "finance-system", system: "You are the finance officer.", maxTokens: 100, messages: [{ role: "user", content: "It is day 1." }], tools: [{ name: "do", description: "Say what you do.", input_schema: { type: "object", properties: { what: { type: "string" } } } }] };
  const asked: string[][] = [];
  const claude = async (args: string[]) => (asked.push(args), { code: 0, stderr: "", stdout: JSON.stringify({ type: "result", is_error: false, result: "", structured_output: { tool: "do", input_json: '{"what":"x"}', also: [], text: "" }, usage: {} }) });
  const effortOf = (args: string[]) => (args.includes("--effort") ? args[args.indexOf("--effort") + 1] : undefined);
  await new ClaudeCodeAdapter("claude-haiku-5-5", claude).complete(req);
  await new ClaudeCodeAdapter("claude-haiku-5-5", claude).complete({ ...req, effort: "low" });
  await new ClaudeCodeAdapter("claude-haiku-5-5@high", claude).complete({ ...req, effort: "low" });
  await new ClaudeCodeAdapter("claude-haiku-5-5@high", claude).complete(req);
  expect(asked.map(effortOf)).toEqual([undefined, "low", "low", "high"]);
  const codexArgs: string[][] = [];
  const codex = async (args: string[], _stdin: string, cwd: string) => {
    codexArgs.push(args);
    await Bun.write(args[args.indexOf("--output-last-message") + 1]!.startsWith("/") ? args[args.indexOf("--output-last-message") + 1]! : join(cwd, args[args.indexOf("--output-last-message") + 1]!), JSON.stringify({ tool: "do", input_json: '{"what":"x"}', also: [], text: "" }));
    return { code: 0, stdout: "", stderr: "" };
  };
  await new CodexCliAdapter("gpt-6.1-sol", codex).complete({ ...req, effort: "low" });
  await new CodexCliAdapter("gpt-6.1-sol", codex).complete(req);
  expect(codexArgs[0]).toContain('model_reasoning_effort="low"');
  expect(codexArgs[1]!.some((a) => a.includes("model_reasoning_effort"))).toBe(false);
});

test("in a run: a seat's effort goes with each of its calls and is on record; a clerk who comes back weekly sits the working day after votes are cast with it, unless papers are set not to bring it back", async () => {
  const run = async (wake: boolean) => {
    const s = { ...spec(), opening_budget: false, mayor: "code", model_seats: "council-clerk", seat_effort: { "council-clerk": "low" }, ...(wake ? {} : { wake_on_papers: false }) };
    const config = generate(s);
    const clerk = officeAt(config, "council-clerk").holder;
    clerk.controller.params.mock.back_days = 7; // (a seat that says it is back in a week, as the model seats of the live checks did)
    const r = await runWorld({ config, runId: "settings", outDir: mkdtempSync(join(tmpdir(), "oikos-seat-settings-")), until: 7 * DAY });
    const log = readFileSync(r.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const voted = log.filter((e) => e.kind === "command" && (e.body.blocks ?? []).some((b: any) => b.block === "vote")).map((e) => Math.floor(e.t / DAY));
    const sat = [...new Set(log.filter((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.subject === "council-clerk-system" && e.body.data.purpose === "participant").map((e) => Math.floor(e.t / DAY)))];
    return { log, voted, sat };
  };
  const on = await run(true);
  // The councillors vote in the first days; the clerk said a week, and is back the working day after votes came in.
  expect(on.voted.length).toBeGreaterThan(0);
  const first = Math.min(...on.voted);
  expect(first).toBeLessThan(4);
  const back = on.sat.filter((d) => d > first);
  expect(back.length).toBeGreaterThan(0);
  expect(Math.min(...back) - first).toBeLessThanOrEqual(3); // (the next working day: three days on over a weekend)
  expect(on.log.some((e) => e.kind === "annotation" && e.body.data?.back_for_papers?.papers.some((p: any) => p.kind === "vote"))).toBe(true);
  // On record: the seat's effort, with the run's account of who sat and with each of its calls.
  const who = on.log.find((e) => e.kind === "annotation" && e.body.annotation === "orchestrator")!.body.data.llm.participants["council-clerk-system"];
  expect(who.effort).toBe("low");
  const calls = on.log.filter((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.subject === "council-clerk-system");
  for (const c of calls) expect(c.body.data.effort).toBe("low");
  // Set not to be brought back: it sits on its first day and not again in the week.
  const off = await run(false);
  expect(off.voted).toEqual(on.voted);
  expect(off.sat.filter((d) => d > first)).toEqual([]);
  expect(off.log.find((e) => e.kind === "annotation" && e.body.annotation === "orchestrator")!.body.data.llm.participants["council-clerk-system"].wake_on_papers).toBe(false);
}, 300_000);

