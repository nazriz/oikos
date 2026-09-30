// Language-model participants through the mock adapter (D34, D36): plain words
// → call → its own acts → a preview it confirms; the records that chain leaves;
// and its ways out (declining, opting out).

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { canonical } from "@terrarium/participants";
import { MockAdapter, type LlmRequest } from "@terrarium/participants/llm";
import { draftHash } from "@terrarium/translator";
import { generate } from "@terrarium/worlds/generator/generate";
import { kernelBinary } from "../src/kernel";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const lines = (path: string) => readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));

function town(tweak: (c: any) => void = () => {}) {
  const c = generate({ ...spec, citizens: 80, mayor: "llm" });
  tweak(c);
  return c;
}
async function run(name: string, config: any, until: number, opts: object = {}) {
  const out = join(root, "runs", `test-llm-${name}`);
  rmSync(out, { recursive: true, force: true });
  return runWorld({ config, runId: name, outDir: out, until, ...opts });
}

test("a mock-LLM mayor governs through words, calls and confirmation, and every step is recorded", async () => {
  const s = await run("mayor", town(), 60 * DAY);
  const log = lines(s.logPath);
  const ann = log.filter((e) => e.kind === "annotation").map((e) => e.body);
  expect(ann.find((a) => a.annotation === "orchestrator").data.llm.participants["mayor-system"]).toEqual({ configured: "anthropic/claude-sonnet-5", adapter: "mock/mock", mock_brain: "city.mayor_code" });

  const usage = ann.filter((a) => a.annotation === "usage");
  expect(usage.length).toBeGreaterThan(5);
  expect(usage.every((u) => u.provider === "mock" && u.cost_microusd === 0 && u.input_tokens > 0)).toBe(true);
  expect(ann.filter((a) => a.annotation === "transcript").length).toBe(usage.length);
  expect(new Set(usage.map((u) => u.purpose))).toEqual(new Set(["participant", "translator", "debrief"]));

  // Each confirmed draft goes into the act with its whole chain: words, call, resolver, hash.
  const drafts = new Map(ann.filter((a) => a.annotation === "draft").map((a) => [a.draft.id, a.draft]));
  const acts = log.filter((e) => e.kind === "command" && e.body.command === "act" && e.body.participant === "mayor-system").map((e) => e.body);
  expect(acts.length).toBeGreaterThan(0);
  for (const a of acts) {
    expect(a.provenance.via).toBe("translator");
    const d = drafts.get(a.provenance.draft)!;
    expect(a.provenance.draft_hash).toBe(draftHash(d));
    expect(a.provenance.call).toBe(d.call);
    expect(a.provenance.resolver).toEqual({ id: "resolver", version: "0.4.0" });
    expect(canonical(a.blocks)).toBe(canonical(d.blocks));
    expect(ann.some((x) => x.annotation === "signoff" && x.draft === d.id && x.decision === "accept" && x.draft_hash === a.provenance.draft_hash)).toBe(true);
  }
  // The institutions carry it on: the mayor's budget proposal is adopted by the council.
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const proposal = recs.find((r) => r.kind === "proposal" && r.author === "mayor-system");
  const ballot = recs.find((r) => r.kind === "ballot" && r.basis === proposal.id);
  expect(recs.some((r) => r.kind === "budget" && r.basis === ballot.id)).toBe(true);
  // The mayor applied for its park permit on the planning office's published form.
  expect(recs.some((r) => r.kind === "permit_application" && r.author === "mayor-system" && r.basis === "form-permit")).toBe(true);
  expect(ann.some((a) => a.annotation === "debrief" && a.subject === "mayor-system")).toBe(true);

  // What the mayor read never shows the machinery (principle 14).
  const read = ann.filter((a) => a.annotation === "transcript" && a.data.purpose === "participant").map((a) => `${a.data.system ?? ""}\n${JSON.stringify(a.data.input)}`).join("\n").toLowerCase();
  for (const machinery of ["kernel", "translator", "resolver", "block", "channel", "refusal", "insufficient_funds", "provenance"]) expect(read).not.toContain(machinery);

  // Every log line is canonical JSON, as the TypeScript port writes it (draft hashes rely on this).
  for (const l of readFileSync(s.logPath, "utf8").trim().split("\n")) expect(canonical(JSON.parse(l))).toBe(l);
  expect(Bun.spawnSync([kernelBinary(), "replay", s.logPath, "--anchors", s.anchorsPath]).exitCode).toBe(0);
  const again = await run("mayor-again", town(), 60 * DAY);
  const bodies = (p: string) => lines(p).slice(1).map((e) => canonical(e.body));
  expect(bodies(again.logPath)).toEqual(bodies(s.logPath));
}, 300_000);

test("a participant is told when a request can't be done, declines an unfaithful preview, confirms a faithful one, and can opt out", async () => {
  let calls = 0, translated = 0, confirmed = false;
  const seen: string[] = [];
  const tool = (name: string, input: object) => [{ type: "tool_use" as const, id: `t${++calls}`, name, input }];
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      const obs = req.context.observation;
      seen.push(JSON.stringify(req.messages.at(-1)!.content));
      if (calls === 0) return tool("do", { what: "Build a stadium by the river." });
      const d = obs.drafts[0];
      if (d) {
        confirmed = d.summary.includes("The town hall opens at nine.");
        return tool("confirm", { ref: d.id, decision: confirmed ? "confirm" : "decline", note: "checked" });
      }
      if (!confirmed) return tool("do", { what: "Publish a notice: the town hall opens at nine." });
      return tool("opt_out", { statement: "I'd rather not continue." });
    },
    translator: () => {
      translated++;
      // Unclear twice (the translator's own retry too), so the participant is told.
      if (translated <= 2) return [{ type: "tool_use", id: "x", name: "call", input: { program: "none(unclear)" } }];
      const text = translated === 3 ? "The town hall is closed indefinitely." : "The town hall opens at nine.";
      return [{ type: "tool_use", id: "x", name: "call", input: { program: `statement(kind=notice, text="${text}")` } }];
    },
    debrief: () => [{ type: "text", text: "Thanks for asking." }],
  });
  const s = await run("scripted", town(), 30 * DAY, { adapter });
  const log = lines(s.logPath);
  const ann = log.filter((e) => e.kind === "annotation").map((e) => e.body);
  expect(ann.find((a) => a.annotation === "translation_failure")?.data.reason).toBe("It isn't clear what should happen. Could you say it more plainly?");
  expect(ann.find((a) => a.annotation === "note" && a.data.translation_retry)?.data.translation_retry).toMatchObject({ attempt: 1, call: "none(unclear)" });
  expect(seen[1]).toContain("A note on your request: It isn't clear what should happen.");
  expect(ann.filter((a) => a.annotation === "signoff").map((a) => a.decision)).toEqual(["reject", "accept"]);
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  expect(recs.filter((r) => r.author === "mayor-system").map((r) => r.text)).toEqual(["The town hall opens at nine."]);
  expect(log.some((e) => e.kind === "event" && e.body.event === "participant_opted_out" && e.body.participant === "mayor-system")).toBe(true);
  expect(ann.find((a) => a.annotation === "debrief")?.data.response).toBe("Thanks for asking.");
  // It's reminded of its own run in the debrief (pilot 9's mayor had no record of what it did): its notebook, and a
  // tally of what it did.
  expect(ann.find((a) => a.annotation === "debrief")?.data.prompt).toMatch(/Your notebook, as you left it: [\s\S]*(You didn't act during the run\.|From day \d+ to day \d+ you wrote \d+ letters?)/);
}, 300_000);

test("after opting out, a stand-in named in the world config carries the participant on", async () => {
  const config = town((c) => {
    const mayor = c.participants.find((x: any) => x.id === "mayor-system");
    mayor.controller.params.mock.opt_out_at = 20 * DAY;
    mayor.on_opt_out = { code: "city.mayor_code", params: mayor.controller.params.mock.params }; // (the same brief as the mock's: whom the town deals with)
  });
  const s = await run("stand-in", config, 60 * DAY);
  const log = lines(s.logPath);
  const out = log.find((e) => e.kind === "event" && e.body.event === "participant_opted_out");
  expect(out.t).toBeGreaterThanOrEqual(20 * DAY);
  // The code mayor now acts for the participant, through calls (no translator, no confirmation).
  const after = log.filter((e) => e.kind === "command" && e.body.command === "act" && e.body.participant === "mayor-system" && e.t > out.t);
  expect(after.length).toBeGreaterThan(0);
  expect(after.every((e) => e.body.provenance.via === "call")).toBe(true);
}, 300_000);

test("with confirmation set to never, drafts take effect without waiting, and say so", async () => {
  const s = await run("never", town((c) => (c.orchestration.confirm = "never")), 30 * DAY);
  const ann = lines(s.logPath).filter((e) => e.kind === "annotation").map((e) => e.body);
  const signoffs = ann.filter((a) => a.annotation === "signoff");
  expect(signoffs.length).toBeGreaterThan(0);
  expect(signoffs.every((a) => a.decision === "accept" && a.note === "confirmation: never")).toBe(true);
}, 300_000);

test("offices answer the mayor's letters with their reports, in figures", async () => {
  let calls = 0;
  const seen: string[] = [];
  const tool = (name: string, input: object) => [{ type: "tool_use" as const, id: `t${++calls}`, name, input }];
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      seen.push(JSON.stringify(req.messages.at(-1)!.content));
      if (calls === 0) return tool("write", { to: ["finance", "council-clerk", "planning", "bank"], text: "Please send me the town's figures.", as: "mayor" });
      // A question about a record by its id (pilot 10: a letter to the bank about an invoice went unanswered, taken for
      // news of a request): here the town's own wage order, asked of the bank.
      if (calls === 1) return tool("write", { to: ["bank"], text: "What has been paid under this order?", about: wageOrder, as: "mayor" });
      return tool("done_for_now", { days: 7 });
    },
    translator: () => [{ type: "tool_use", id: "x", name: "call", input: { program: "none(unclear)" } }],
    debrief: () => [{ type: "text", text: "Thanks." }],
  });
  const config = town();
  const wageOrder: string = config.world.records.find((r: any) => r.kind === "request" && r.speaks_for === "city" && r.addressed_to?.includes("bank")).id;
  const s = await run("letters", config, 20 * DAY, { adapter });
  const ev = lines(s.logPath).filter((e) => e.kind === "event").map((e) => e.body);
  expect(ev.some((e) => e.event === "message_delivered" && e.participant === "finance-system" && e.to.includes("mayor-system"))).toBe(true);
  expect(ev.some((e) => e.event === "message_delivered" && e.participant === "council-clerk-system" && e.to.includes("mayor-system"))).toBe(true);
  const read = seen.join("\n");
  expect(read).toContain("Report from the finance office: the town's account acc-city holds");
  // The bank answers too (pilot 9: 34 letters, no reply), with the writer's own accounts: the town's, as the mayor
  // wrote in its office.
  expect(read).toMatch(/Report from bank: your accounts with us: acc-city, balance \$[\d,]+\.\d\d/);
  expect(read.match(/Report from bank: your accounts with us/g)?.length).toBeGreaterThanOrEqual(2);
  expect(read).toContain("council proposal form");
  // The budget brief: what the budget can pay for; what a park costs is the builder's published price, not something finance was told.
  expect(read).toContain("The budget's lines: parks, for building a park");
  // The payroll, itemised (pilots 8 and 9: the mayor chased a recurring payment it couldn't place): who, how often,
  // gross, what reaches them after tax, into which account, under which agreement.
  expect(read).toMatch(/The town's payroll \(\d+, recurring payments from acc-city\): c\d+, every 14 days, \$[\d,.]+ gross, \$[\d,.]+ paid to acc-\S+ after tax withheld \(agreement /);
  expect(read).toMatch(/builder's published prices \(rec\.\d+\): .*park \$[\d,]+\.00/);
  // The land register: the town's lots, and the vacant ones by id.
  expect(read).toMatch(/The town owns \d+ lots; \d+ have nothing built on them: lot-/);
}, 300_000);

test("the notebook, used alongside an action, carries to the next wake; every tool use gets a result, as the APIs require", async () => {
  let n = 0;
  const firsts: string[] = [];
  const unanswered: string[] = [];
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      // The APIs' rule: each tool use in an answer is followed by a result for it in the next message.
      for (let i = 0; i + 1 < req.messages.length; i++) {
        const m = req.messages[i]!;
        if (m.role !== "assistant" || typeof m.content === "string") continue;
        const next = req.messages[i + 1]!;
        const results = new Set(typeof next.content === "string" ? [] : next.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : [])));
        for (const b of m.content) if (b.type === "tool_use" && !results.has(b.id)) unanswered.push(b.id);
      }
      const first = req.messages[0]!;
      if (req.messages.length === 1) firsts.push(typeof first.content === "string" ? first.content : "");
      const k = ++n;
      if (k === 1) return [{ type: "tool_use", id: `u${k}a`, name: "notebook", input: { text: "Wrote to finance on day 0." } },
        { type: "tool_use", id: `u${k}b`, name: "write", input: { to: ["finance"], text: "Please send me the town's figures.", as: "mayor" } }];
      return [{ type: "tool_use", id: `u${k}`, name: "done_for_now", input: { days: 3 } }];
    },
    translator: () => [{ type: "tool_use", id: "x", name: "call", input: { program: "none(unclear)" } }],
    debrief: () => [{ type: "text", text: "Thanks." }],
  });
  await run("notebook", town(), 8 * DAY, { adapter });
  expect(unanswered).toEqual([]);
  expect(firsts[0]).toContain("Your notebook: (empty)");
  expect(firsts.slice(1).every((f) => f.includes("Your notebook: Wrote to finance on day 0."))).toBe(true);
  expect(firsts.length).toBeGreaterThan(1);
}, 300_000);

test("after the council adopts a budget, the clerk's report says so (it sees what it publishes)", async () => {
  let calls = 0, asked = false;
  const seen: string[] = [];
  const tool = (name: string, input: object) => [{ type: "tool_use" as const, id: `t${++calls}`, name, input }];
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      const obs = req.context.observation;
      seen.push(JSON.stringify(req.messages.at(-1)!.content));
      if (calls === 0) return tool("do", { what: "Table the year 1 budget: parks $150,000." });
      const d = obs.drafts[0];
      if (d) return tool("confirm", { ref: d.id, decision: "confirm" });
      if (!asked && obs.t >= 20 * DAY) {
        asked = true;
        return tool("write", { to: ["council-clerk"], text: "Is the budget adopted?", as: "mayor" });
      }
      return tool("done_for_now", { days: 7 });
    },
    translator: () => [{ type: "tool_use", id: "x", name: "call", input: { program: 'form(to=city, form=council_proposal, kind=budget, parks="$150,000", proposal="Year 1 budget: parks $150,000.")' } }],
    debrief: () => [{ type: "text", text: "Thanks." }],
  });
  const s = await run("clerk-budget", town(), 30 * DAY, { adapter });
  const recs = lines(s.logPath).filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const budget = recs.find((r) => r.kind === "budget" && r.author === "council-clerk-system");
  expect(budget).toBeDefined();
  expect(seen.join("\n")).toContain(`The council adopted a budget for year 1 (${budget.id}).`);
}, 300_000);

test("everyone waking at the same moment sees the same state; what they decide is carried out in key order, not the order decisions come back (D58)", async () => {
  const seen: Record<string, string[]> = { "mayor-system": [], "planning-system": [] };
  const wrote = new Set<string>();
  const inner = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      const who = req.subject;
      seen[who]!.push(JSON.stringify(req.messages.at(-1)!.content));
      if (!wrote.has(who)) {
        wrote.add(who);
        return who === "mayor-system"
          ? [{ type: "tool_use", id: "m1", name: "write", input: { to: ["planning"], text: "Hello planning.", as: "mayor" } }]
          : [{ type: "tool_use", id: "p1", name: "write", input: { to: ["mayor"], text: "Hello mayor.", as: "planning" } }];
      }
      return [{ type: "tool_use", id: `${who}-w`, name: "done_for_now", input: { days: 30 } }];
    },
    translator: () => [{ type: "tool_use", id: "x", name: "call", input: { program: "none(unclear)" } }],
    debrief: () => [{ type: "text", text: "Thanks." }],
  });
  // The mayor's model is slow, planning's quick: their decisions come back in the other order.
  const adapter = { provider: inner.provider, model: inner.model, complete: async (req: LlmRequest) => {
    if (req.subject === "mayor-system") await Bun.sleep(40);
    return inner.complete(req);
  } };
  const s = await run("same-moment", town((c) => {
    const planning = c.participants.find((p: any) => p.id === "planning-system");
    planning.controller = { type: "llm", impl: "anthropic", model: "claude-sonnet-5", params: { cadence_days: 7 } };
    planning.framing = { disclosure: "simulation", reason: "test" };
  }), 2 * DAY, { adapter });
  // Round 1: both looked before either acted, so neither saw the other's letter.
  expect(seen["mayor-system"]![0]).not.toContain("Hello mayor.");
  expect(seen["planning-system"]![0]).not.toContain("Hello planning.");
  // Round 2: each sees the round before.
  expect(seen["mayor-system"]![1]).toContain("Hello mayor.");
  expect(seen["planning-system"]![1]).toContain("Hello planning.");
  // The log: at t=0, the mayor's act before planning's, and the mayor's model calls recorded first too.
  const log = lines(s.logPath).filter((e) => e.t === 0);
  const acts = log.filter((e) => e.kind === "command" && e.body.command === "act" && ["mayor-system", "planning-system"].includes(e.body.participant)).map((e) => e.body.participant);
  expect(acts.slice(0, 2)).toEqual(["mayor-system", "planning-system"]);
  const usage = log.filter((e) => e.kind === "annotation" && e.body.annotation === "usage").map((e) => e.body.subject);
  expect(usage.slice(0, 2)).toEqual(["mayor-system", "planning-system"]);
}, 300_000);
