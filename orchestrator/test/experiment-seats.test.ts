// Model stewards in the experiment harness (orchestrator/src/experiment-seats.ts, seat-host.ts): which models may be
// seated, the spending limits per fork, arm and experiment; then, on the engine with every model played by the mock (no
// model is called), a model seat in a fork: its loop, its translator's drafts confirmed before anything is done, its
// costs by purpose, its framing, its debrief at the fork's end, and a fork stopped cleanly at its spending limit.

import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnthropicAdapter, CreditExhausted, SpendingLimitReached, UsageLimitReached, type LlmAdapter } from "@oikos/participants/llm";
import { atMost, callRecorder, forkLimits, budgetProblems, modelProblems } from "../src/experiment-seats";
import { waitingAdapter } from "../src/seat-host";
import { loadSpec, runExperiment, validate, type ExperimentSpec } from "../src/experiment";

const root = join(import.meta.dir, "../..");

const spec = (over: Partial<ExperimentSpec> = {}): ExperimentSpec => ({ name: "t", world: { config: {} }, post: "p", seeds: [1, 2, 3, 4], forkDay: 1, untilDay: 5,
  arms: [{ name: "code", steward: { kind: "code" } }, { name: "sonnet", steward: { kind: "model", model: "claude-code/claude-sonnet-5-5" } }, { name: "sol", steward: { kind: "model", model: "codex/gpt-6.1-sol" } }], ...over });

test("only the allowed models are seated: never the largest Claude model, Fable or astra; the API on the plan's credit; no key that bills without the owner's go-ahead", () => {
  const arm = (model: string) => spec({ arms: [{ name: "m", steward: { kind: "model", model } }], seats: { budget: { fork_usd: 5 } } });
  expect(modelProblems(arm("claude-code/claude-opus-5-5")).join()).toMatch(/never used/);
  expect(modelProblems(arm("claude-code/claude-fable-5-1")).join()).toMatch(/never used/);
  expect(modelProblems(arm("codex/gpt-6-astra")).join()).toMatch(/never used/);
  expect(modelProblems(arm("anthropic/claude-sonnet-5-5"))).toEqual([]);
  expect(modelProblems(arm("anthropic/claude-opus-5-5")).join()).toMatch(/never used/);
  expect(modelProblems(arm("openai/gpt-6.1-sol")).join()).toMatch(/paid API/);
  expect(modelProblems({ ...arm("openai/gpt-6.1-sol"), seats: { allow_paid_api: true } })).toEqual([]);
  expect(modelProblems(arm("claude-code/claude-sonnet-5-5"))).toEqual([]);
  expect(modelProblems(arm("codex/gpt-6-luna"))).toEqual([]);
  expect(modelProblems({ ...arm("codex/gpt-6-luna"), seats: { translator: { first: "decide/pod", behind: "claude-code/claude-sonnet-5-5" } } })).toEqual([]);
  expect(modelProblems({ ...arm("codex/gpt-6-luna"), seats: { translator: { first: "claude-code/claude-haiku-5-5" } } }).join()).toMatch(/our own trained translator/);
  expect(() => validate(arm("claude-code/claude-opus-5-5"))).toThrow(/never/);
});

test("each model fork's spending limit is fixed before anything runs: the least of its own, its arm's over its seeds, and the experiment's over every model fork", () => {
  expect(forkLimits(spec({ seats: { budget: { experiment_usd: 80 } } }))).toEqual({ sonnet: 10, sol: 10 });
  expect(forkLimits(spec({ seats: { budget: { experiment_usd: 80, arm_usd: 20 } } }))).toEqual({ sonnet: 5, sol: 5 });
  expect(forkLimits(spec({ seats: { budget: { experiment_usd: 80, arm_usd: { sonnet: 60 }, fork_usd: 12 } } }))).toEqual({ sonnet: 10, sol: 10 });
  expect(forkLimits(spec({ seats: { budget: { fork_usd: 3 } } }))).toEqual({ sonnet: 3, sol: 3 });
  // A model that costs money needs a limit; a flat-rate subscription's (Codex) does not.
  expect(budgetProblems(spec()).join()).toMatch(/sonnet: claude-code\/claude-sonnet-5-5 costs money and has no spending limit/);
  expect(budgetProblems(spec()).join()).not.toMatch(/sol/);
  expect(() => validate(spec())).toThrow(/no spending limit/);
  expect(() => validate(spec({ seats: { budget: { experiment_usd: 50 } } }))).not.toThrow();
});

test("a subscription's window that shuts is waited for inside the fork, then the fork stops", async () => {
  let shut = 2;
  const waits: number[] = [];
  const a: LlmAdapter = { provider: "codex", model: "m", complete: async () => { if (shut-- > 0) throw new UsageLimitReached("limit"); return { content: [], usage: { input_tokens: 1, output_tokens: 1 } }; } };
  const w = waitingAdapter(a, { waitMs: 10, maxWaitMs: 30, sleep: async (ms) => { waits.push(ms); } });
  await w.complete({} as any);
  expect(waits).toEqual([10, 10]);
  shut = 9;
  await expect(waitingAdapter(a, { waitMs: 10, maxWaitMs: 30, sleep: async () => {} }).complete({} as any)).rejects.toThrow(UsageLimitReached);
});

test("a spent API credit stops the fork cleanly: it is a stop (as at a spending limit), never waited out, never retried into a purchase", async () => {
  const f = (async () => new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }), { status: 400 })) as unknown as typeof fetch;
  const a = new AnthropicAdapter("claude-sonnet-5-5", { apiKey: "k", fetch: f, retries: 0 });
  const req = { system: "s", messages: [{ role: "user", content: "x" }], maxTokens: 10, purpose: "participant", subject: "s" } as any;
  const e = await a.complete(req).catch((x) => x);
  expect(e).toBeInstanceOf(CreditExhausted);
  expect(e).toBeInstanceOf(SpendingLimitReached);
  expect(String(e.message)).not.toContain("k\""); // (the key is never in an error)
  let waited = 0;
  await expect(waitingAdapter(a, { waitMs: 10, maxWaitMs: 1000, sleep: async () => { waited++; } }).complete(req)).rejects.toThrow(CreditExhausted);
  expect(waited).toBe(0);
});

test("every call a fork makes is recorded apart from the log: tokens with the cache, cost, wall time, errors; a later attempt knows what earlier ones spent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oikos-calls-"));
  const file = join(dir, "sonnet.calls.jsonl");
  let fail = false;
  const a: LlmAdapter = { provider: "anthropic", model: "claude-sonnet-5-5", complete: async () => { if (fail) throw new CreditExhausted("spent"); return { content: [], usage: { input_tokens: 1000, cache_read_tokens: 9000, cache_write_tokens: 0, output_tokens: 100 } }; } };
  const rec = callRecorder(file, { seed: 1, arm: "sonnet", seat: "s" });
  const w = rec.wrap(a, "anthropic/claude-sonnet-5-5");
  const req = { purpose: "participant", subject: "s" } as any;
  await w.complete(req); await w.complete({ ...req, purpose: "translator" });
  fail = true;
  await expect(w.complete(req)).rejects.toThrow(CreditExhausted);
  const s = rec.summary();
  // $2/M in, $0.20/M cache read, $10/M out: 2,000 + 1,800 + 1,000 micro-USD a call.
  expect(s).toMatchObject({ attempt: 1, calls: 2, errors: 1, input_tokens: 2000, cache_read_tokens: 18000, output_tokens: 200, cost_microusd: 9600, earlier_microusd: 0, error_kinds: { CreditExhausted: 1 } });
  expect(s.by["translator anthropic/claude-sonnet-5-5"]!.calls).toBe(1);
  expect(s.ms.p50).not.toBeNull();
  const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(lines.length).toBe(3);
  expect(lines[2]).toMatchObject({ error_kind: "CreditExhausted", attempt: 1 });
  const again = callRecorder(file, { seed: 1, arm: "sonnet", seat: "s" });
  expect(again.attempt).toBe(2);
  expect(again.earlierMicroUsd).toBe(9600);
  rmSync(dir, { recursive: true, force: true });
});

test("a provider's calls in flight in one process are held to the most allowed, the rest taken in the order they came", async () => {
  let now = 0, most = 0;
  const order: number[] = [];
  const release: (() => void)[] = [];
  const a: LlmAdapter = { provider: "claude-code", model: "m", complete: async (req: any) => { now++; most = Math.max(most, now); await new Promise<void>((r) => release.push(r)); now--; order.push(req.n); return { content: [], usage: { input_tokens: 0, output_tokens: 0 } }; } };
  const g = atMost(a, { n: 2, busy: 0, queue: [] });
  const all = [1, 2, 3, 4, 5].map((n) => g.complete({ n } as any));
  for (let i = 0; i < 5; i++) { await Bun.sleep(1); release.shift()?.(); }
  await Promise.all(all);
  expect(most).toBe(2);
  expect(order).toEqual([1, 2, 3, 4, 5]);
});

// ---- on the engine, every model played by the mock

const have = existsSync(join(root, "kernel/target/release/oikos-kernel")) && !!Bun.spawnSync(["sh", "-c", `ls ${join(root, "kernel/target/release")}/liboikos_napi.* 2>/dev/null`]).stdout.toString().trim();

test.skipIf(!have)("a model steward in a fork, played by the mock: drafts confirmed, costs by purpose, framing, a debrief at the end; a fork stopped at its limit is debriefed and not compared", async () => {
  const { spec: weather } = await loadSpec(join(root, "experiments/weather-stewards.ts"));
  const small: ExperimentSpec = {
    ...weather, name: "seats-test", seeds: [1], untilDay: 30,
    arms: [
      { name: "code", steward: { kind: "code" } },
      { name: "sonnet", steward: { kind: "model", model: "claude-code/claude-sonnet-5-5" } },
      { name: "sonnet-told", steward: { kind: "model", model: "claude-code/claude-sonnet-5-5", framing: "simulation" } },
      { name: "haiku-poor", steward: { kind: "model", model: "claude-code/claude-haiku-5-5" } },
    ],
    seats: { mock_models: true, budget: { arm_usd: { sonnet: 50, "sonnet-told": 50, "haiku-poor": 0.001 } } },
    measures: ["acts", "records:weather_warning", "log_entries"],
  };
  const out = join(root, "runs", "test-experiment-seats");
  rmSync(out, { recursive: true, force: true });
  const r = await runExperiment(small, { out, parallel: 0 });
  expect(r.results.filter((x) => x.error)).toEqual([]);
  const get = (arm: string) => r.results.find((x) => x.arm === arm)!;
  const sonnet = get("sonnet"), told = get("sonnet-told"), poor = get("haiku-poor"), code = get("code");
  // The mock seat (the post's code brain, through the whole loop) warns as the code does: the warnings were drafted, shown and confirmed.
  expect(sonnet.measures["records:weather_warning"]).toBe(code.measures["records:weather_warning"]);
  expect(sonnet.measures["records:weather_warning"]).toBeGreaterThan(0);
  expect(sonnet.costsByPurpose!.participant!.calls).toBeGreaterThan(0);
  expect(sonnet.costsByPurpose!.translator!.calls).toBeGreaterThan(0);
  expect(sonnet.costsByPurpose!.debrief!.calls).toBeGreaterThan(5);
  expect(sonnet.costs["weather-bureau-system"] ?? Object.values(sonnet.costs)[0]).toBeDefined();
  expect(sonnet.limitUsd).toBe(50);
  expect(sonnet.debrief).toBe("complete");
  expect(sonnet.framing).toBe("unstated");
  expect(told.framing).toBe("simulation");
  expect(sonnet.stopped).toBeUndefined();
  // Its debrief's words are kept apart from the log.
  expect(existsSync(join(out, "seed-1", "sonnet.debriefs.jsonl"))).toBe(true);
  // A fork whose limit is reached stops cleanly, its seat debriefed out of what was kept back, and is never compared.
  expect(poor.stopped?.by).toBe("SpendingLimitReached");
  expect(poor.debrief).toBeDefined();
  expect(poor.costsByPurpose!.debrief!.calls).toBeGreaterThan(0);
  expect(r.report.failures.map((f) => f.arm)).toEqual(["haiku-poor"]);
  expect(r.report.arms.find((a) => a.name === "haiku-poor")!.measures.acts!.n).toBe(0);
  expect(r.report.dryRun).toBe(true);
  expect(r.text).toContain("DRY RUN");
  expect(r.report.spend!.find((x) => x.arm === "haiku-poor")!.stopped).toBe(1);
  // Every call recorded beside the log, summed in the fork's result and in the run's cost.json.
  expect(sonnet.calls!.calls).toBe(Object.values(sonnet.costsByPurpose!).reduce((a, c) => a + c.calls, 0));
  expect(sonnet.calls!.ms.p50).not.toBeNull();
  expect(existsSync(join(out, "seed-1", "sonnet.calls.jsonl"))).toBe(true);
  const cost = JSON.parse(readFileSync(join(out, "cost.json"), "utf8"));
  expect(cost.arms.sonnet.forks).toBe(1);
  expect(cost.arms["haiku-poor"].stopped).toBe(1);
  expect(cost.dry_run).toBeDefined();
  // An interrupted run is taken up again: the bases and the forks that stand are kept; a fork with no result, and one
  // stopped for want of the model (its credit spent), are run again, their earlier logs kept, their spending counted.
  for (const x of ["results.json", "report.json", "report.txt", "cost.json"]) rmSync(join(out, x));
  const seed1 = join(out, "seed-1");
  rmSync(join(seed1, "sonnet.json"));
  const poorFile = join(seed1, "haiku-poor.json");
  writeFileSync(poorFile, JSON.stringify({ ...poor, stopped: { ...poor.stopped!, by: "CreditExhausted" } }));
  const snap = statSync(join(seed1, "snapshot.bin")).mtimeMs;
  await expect(runExperiment(small, { out, parallel: 0 })).rejects.toThrow(/--resume/);
  const r2 = await runExperiment(small, { out, parallel: 0, resume: true });
  expect(statSync(join(seed1, "snapshot.bin")).mtimeMs).toBe(snap);
  const get2 = (arm: string) => r2.results.find((x) => x.arm === arm)!;
  expect(get2("code").seconds).toBe(code.seconds);
  expect(get2("sonnet").stateHash).toBe(sonnet.stateHash);
  expect(get2("sonnet").calls!.attempt).toBe(2);
  expect(existsSync(join(seed1, "sonnet.interrupted-1.oklog"))).toBe(true);
  expect(existsSync(join(seed1, "haiku-poor.interrupted-1.json"))).toBe(true);
  expect(get2("haiku-poor").calls!.earlier_microusd).toBeGreaterThan(0);
  expect(get2("haiku-poor").stopped?.by).toBe("SpendingLimitReached");
  // The fork's log says who held the post from the fork, how, and under what limit.
  const kernel = join(root, "kernel/target/release/oikos-kernel");
  const jsonl = join(out, "seed-1", "sonnet.jsonl");
  expect(Bun.spawnSync([kernel, "export", join(out, "seed-1", "sonnet.oklog"), "--out", jsonl]).exitCode).toBe(0);
  const lines = readFileSync(jsonl, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const steward = lines.find((e) => e.body?.data?.steward)!.body.data.steward;
  expect(steward).toMatchObject({ model: "claude-code/claude-sonnet-5-5", framing: { disclosure: "unstated" } });
  // (This is the second attempt's log: its limit is the fork's less what the first attempt spent.)
  expect(Math.abs(steward.spending_limit_microusd - (50_000_000 - get2("sonnet").calls!.earlier_microusd))).toBeLessThanOrEqual(1);
  expect(get2("sonnet").calls!.earlier_microusd).toBeGreaterThan(0);
  expect(steward.adapter.startsWith("mock/")).toBe(true);
  expect(lines.some((e) => e.body?.annotation === "signoff" && e.body.decision === "accept")).toBe(true);
  expect(lines.some((e) => e.kind === "command" && e.body?.provenance?.via === "translator")).toBe(true);
  expect(lines.some((e) => e.body?.annotation === "observation")).toBe(true);
  expect(Bun.spawnSync([kernel, "verify", jsonl]).exitCode).toBe(0);
  rmSync(out, { recursive: true, force: true });
}, 600_000);
