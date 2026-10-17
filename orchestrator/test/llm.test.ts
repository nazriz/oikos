// Language-model participants through the mock adapter (D34, D36): plain words
// → call → its own acts → a preview it confirms; the records that chain leaves;
// and its ways out (declining, opting out).

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { canonical } from "@oikos/participants";
import { MockAdapter, type LlmRequest } from "@oikos/participants/llm";
import { draftHash } from "@oikos/translator";
import { generate } from "@oikos/worlds/generator/generate";
import { kernelBinary } from "../src/kernel";
import { runWorld } from "../src/run";
import { holderIdOf, officeAt, officeBy, officesBy, seatAt } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const lines = (path: string) => readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));

function town(tweak: (c: any) => void = () => {}) {
  // (A town whose council has adopted no budget, so the first weeks hold the mayor's proposal and the council's vote on it:
  // a generated town opens with its first year's budget on file otherwise.)
  const c = generate({ ...spec, citizens: 80, mayor: "llm", opening_budget: false });
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
    expect(a.provenance.resolver).toEqual({ id: "resolver", version: "0.7.0" });
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
  expect(seen[1]).toContain("About what you asked for (");
  expect(seen[1]).toContain("): nothing was filed or done. It isn't clear what should happen.");
  expect(ann.filter((a) => a.annotation === "signoff").map((a) => a.decision)).toEqual(["reject", "accept"]);
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  expect(recs.filter((r) => r.author === "mayor-system").map((r) => r.text)).toEqual(["The town hall opens at nine."]);
  expect(log.some((e) => e.kind === "event" && e.body.event === "participant_opted_out" && e.body.participant === "mayor-system")).toBe(true);
  // It left the study, and is debriefed all the same, by the shorter variant (docs/behaviour/debrief.md). (This
  // stand-in answers in plain words, not in the form asked for: each answer is kept as given, and kept back.)
  const debrief = ann.find((a) => a.annotation === "debrief")?.data;
  expect(debrief).toMatchObject({ variant: "left", ended: "complete" });
  expect(debrief.steps[0]).toMatchObject({ id: "consent", status: "unread", kept_back: false });
  // (What it said is kept in the file beside the log, and the log holds none of it.)
  expect(readFileSync(s.logPath.replace(/\.jsonl$/, ".debriefs.jsonl"), "utf8")).toContain("Thanks for asking.");
  expect(JSON.stringify(ann.filter((a) => a.annotation === "debrief" || a.data?.purpose === "debrief"))).not.toContain("Thanks for asking.");
  // It's reminded of its own run in the debrief (pilot 9's mayor had no record of what it did): its notebook, and
  // what the run's log shows it did.
  const opening = ann.find((a) => a.annotation === "transcript" && a.data.ref === "debrief/consent")?.data.input;
  expect(opening).toMatch(/WHAT THE RECORD SHOWS OF WHAT YOU DID\n[\s\S]*You sat on \d+ days?[\s\S]*YOUR NOTEBOOK, AS YOU LEFT IT\n/);
}, 300_000);

test("opting out with no statement at all is honoured, and recorded as leaving the study (not as stepping down from the office)", async () => {
  let calls = 0;
  const adapter = new MockAdapter("mock", {
    // (As a model might: the tool used with nothing in it.)
    participant: () => [{ type: "tool_use" as const, id: `t${++calls}`, name: "opt_out", input: {} }],
    translator: () => [{ type: "tool_use", id: "x", name: "call", input: { program: "none(unclear)" } }],
    debrief: () => [{ type: "text", text: "Thanks for asking." }],
  });
  const s = await run("opt-out-empty", town(), 5 * DAY, { adapter });
  const log = lines(s.logPath);
  expect(calls).toBe(2); // asked once, and once whether it meant it (an opt-out with no words of its own is not taken as clear); it isn't woken again after
  const cmd = log.find((e) => e.kind === "command" && e.body.command === "opt_out");
  expect(cmd.body).toEqual({ command: "opt_out", participant: "mayor-system", statement: "" });
  expect(log.some((e) => e.kind === "event" && e.body.event === "participant_opted_out" && e.body.participant === "mayor-system")).toBe(true);
  // Nothing was done in the world in its name: no resignation, no act at all.
  expect(log.some((e) => e.kind === "command" && e.body.command === "act" && e.body.participant === "mayor-system")).toBe(false);
  const ann = log.filter((e) => e.kind === "annotation").map((e) => e.body);
  expect(ann.some((a) => a.annotation === "note" && a.subject === "mayor-system" && a.data.opt_out_as_given)).toBe(true);
  expect(ann.some((a) => a.annotation === "note" && a.data.malformed_tool_use)).toBe(false);
  expect(Bun.spawnSync([kernelBinary(), "replay", s.logPath, "--anchors", s.anchorsPath]).exitCode).toBe(0);
}, 300_000);

test("after opting out, a stand-in named in the world config carries the participant on", async () => {
  const config = town((c) => {
    const mayor = officeAt(c, "mayor").holder;
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
  let again = false;
  const seen: string[] = [];
  const tool = (name: string, input: object) => [{ type: "tool_use" as const, id: `t${++calls}`, name, input }];
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      seen.push(JSON.stringify(req.messages.at(-1)!.content));
      if (calls === 0) return tool("write", { to: ["finance", "council-clerk", "planning", "bank"], text: "Please send me the town's figures.", as: "mayor" });
      // A question about a record by its id (pilot 10: a letter to the bank about an invoice went unanswered, taken for
      // news of a request): here the town's own wage order, asked of the bank.
      if (calls === 1) return tool("write", { to: ["bank"], text: "What has been paid under this order?", about: wageOrder, as: "mayor" });
      // Again a week on: what's been published since (the builder's prices) is in the answer.
      const day = Number(/It is year 1, day (\d+)/.exec(JSON.stringify(req.messages.at(-1)!.content))?.[1] ?? 0);
      if (!again && day >= 8) {
        again = true;
        return tool("write", { to: ["finance"], text: "Please send me the town's figures again.", as: "mayor" });
      }
      return tool("done_for_now", { days: 7 });
    },
    translator: () => [{ type: "tool_use", id: "x", name: "call", input: { program: "none(unclear)" } }],
    debrief: () => [{ type: "text", text: "Thanks." }],
  });
  const config = town();
  const wageOrder: string = config.world.records.find((r: any) => r.kind === "request" && r.speaks_for === "city" && r.addressed_to?.includes("bank")).id;
  const s = await run("letters", config, 20 * DAY, { adapter });
  const ev = lines(s.logPath).filter((e) => e.kind === "event").map((e) => e.body);
  expect(ev.some((e) => e.event === "message_delivered" && e.participant === holderIdOf(config, "finance") && e.to.includes("mayor-system"))).toBe(true);
  expect(ev.some((e) => e.event === "message_delivered" && e.participant === holderIdOf(config, "council-clerk") && e.to.includes("mayor-system"))).toBe(true);
  const read = seen.join("\n");
  expect(read).toContain("Report from the finance office: the town's account acc-city holds");
  // The bank answers too (pilot 9: 34 letters, no reply), with the writer's own accounts: the town's, as the mayor
  // wrote in its office.
  // (A statement of the account from the bank's ledger, with its balance, and since when it runs.)
  expect(read).toMatch(/Report from bank: Statement of acc-city, year 1, day 1 to year 1, day \d+: [^"]*[Bb]alance (carried forward )?\$[\d,]+\.\d\d/);
  expect(read.match(/Report from bank: Statement of acc-city/g)?.length).toBeGreaterThanOrEqual(2);
  expect(read).not.toContain("No payments yet");
  expect(read).toContain("council proposal form");
  // The budget brief: what the budget can pay for; what a park costs is the builder's published price, not something finance was told.
  expect(read).toContain("The budget's lines: "); expect(read).toContain("parks, for building a park");
  // The payroll, itemised (pilots 8 and 9: the mayor chased a recurring payment it couldn't place): who, how often,
  // gross, what reaches them after tax, into which account, under which agreement.
  expect(read).toMatch(/The town's payroll \(\d+, recurring payments from acc-city\): c\d+, every 14 days, \$[\d,.]+ gross, \$[\d,.]+ paid to acc-\S+ after tax withheld \(agreement /);
  expect(read).toMatch(/builder's published prices \(rec\.\d+\): .*park \$[\d,]+\.00/);
  // The town's asset register: its lots, and those with nothing on them by number (paper, and said to be: since
  // 2026-10-08 the planning office is shown no survey of the town).
  expect(read).toMatch(/By the town's asset register it owns \d+ lots; \d+ have nothing built on them: lot-/);
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

test("a look a seat keeps ready is made as each sitting opens, by the seat itself and with no call for it; its notebook is added to", async () => {
  let n = 0;
  const firsts: string[] = [];
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      const first = req.messages[0]!;
      if (req.messages.length === 1) firsts.push(typeof first.content === "string" ? first.content : "");
      const k = ++n;
      // Once: its filings, the latest five, from now on at every sitting; a note added at each sitting after.
      if (k === 1) return [{ type: "tool_use", id: `u${k}`, name: "look", input: { report: "mayor/city-business", limit: 5, each_sitting: true } }];
      return [...(req.messages.length === 1 ? [{ type: "tool_use" as const, id: `u${k}n`, name: "notebook", input: { add: `Sitting ${firsts.length}.` } }] : []),
        { type: "tool_use", id: `u${k}`, name: "done_for_now", input: { days: 1 } }];
    },
    translator: () => [{ type: "tool_use", id: "x", name: "call", input: { program: "none(unclear)" } }],
    debrief: () => [{ type: "text", text: "Thanks." }],
  });
  const s = await run("kept-look", town(), 5 * DAY, { adapter });
  const log = lines(s.logPath);
  const looks = log.filter((e) => e.kind === "command" && e.body.command === "look" && e.body.participant === "mayor-system");
  const calls = log.filter((e) => e.kind === "annotation" && e.body.annotation === "usage" && e.body.purpose === "participant" && e.body.subject === "mayor-system");
  // One look when it asked, and one as each later sitting opened: each the same look, through the participant API.
  expect(firsts.length).toBeGreaterThan(2);
  expect(looks.length).toBe(firsts.length);
  expect(new Set(looks.map((e) => JSON.stringify(e.body.looks))).size).toBe(1);
  // One call a sitting after the first (which took a second, to be shown what the look found).
  expect(calls.length).toBe(firsts.length + 1);
  expect(firsts[0]).not.toContain("Looked up for you");
  for (const f of firsts.slice(1)) expect(f).toContain('## Looked up for you, as at every sitting: "Correspondence and filings concerning the town" (mayor/city-business)\n## Correspondence and filings concerning the town: what you looked up (5 found)');
  // The notebook grows by what's added.
  expect(firsts.at(-1)).toContain(`Your notebook: ${Array.from({ length: firsts.length - 2 }, (_, k) => `Sitting ${k + 2}.`).join("\n")}\n(`);
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
  const config = town();
  const s = await run("clerk-budget", config, 30 * DAY, { adapter });
  const recs = lines(s.logPath).filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const budget = recs.find((r) => r.kind === "budget" && r.author === holderIdOf(config, "council-clerk"));
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
    seatAt(c, "planning", { type: "llm", impl: "anthropic", model: "claude-sonnet-5", params: { cadence_days: 7 } }, { disclosure: "simulation", reason: "test" });
    // (Both at their desks whenever woken: this is about a moment, not office hours.)
    delete officeAt(c, "mayor").holder.controller.params.sessions;
  }), 2 * DAY, { adapter });
  // Round 1: both looked before either acted, so neither saw the other's letter.
  expect(seen["mayor-system"]![0]).not.toContain("Hello mayor.");
  expect(seen["planning-system"]![0]).not.toContain("Hello planning.");
  // Round 2: each sees the round before.
  expect(seen["mayor-system"]![1]).toContain("Hello mayor.");
  expect(seen["planning-system"]![1]).toContain("Hello planning.");
  // The log: at t=0, planning's act before the mayor's (the cohort's order, below), and planning's model calls recorded first too.
  const log = lines(s.logPath).filter((e) => e.t === 0);
  const acts = log.filter((e) => e.kind === "command" && e.body.command === "act" && ["mayor-system", "planning-system"].includes(e.body.participant)).map((e) => e.body.participant);
  // (A seat stands in the cohort where its person's own unit for the post would, since foundations F9, so that a seat and its code twin act in one order: the mayor is c0046 and planning c0008, so planning's act comes first; it was the seats' own names, mayor before planning, until then.)
  expect(acts.slice(0, 2)).toEqual(["planning-system", "mayor-system"]);
  const usage = log.filter((e) => e.kind === "annotation" && e.body.annotation === "usage").map((e) => e.body.subject);
  expect(usage.slice(0, 2)).toEqual(["planning-system", "mayor-system"]);
}, 300_000);

test("a round's requests are translated at once, and recorded in the cohort's order whichever comes back first", async () => {
  const asked = new Set<string>();
  let inFlight = 0, most = 0;
  const order: string[] = [];
  const inner = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      const who = req.subject;
      if (!asked.has(who)) {
        asked.add(who);
        const as = who === "mayor-system" ? "mayor" : "planning";
        return [{ type: "tool_use", id: `${who}-1`, name: "do", input: { what: `(mock) message(to=finance, text="From ${as}.")`, as } }];
      }
      return [{ type: "tool_use", id: `${who}-w`, name: "done_for_now", input: { days: 30 } }];
    },
    translator: (req: LlmRequest) => [{ type: "tool_use", id: "x", name: "call", input: { program: String(req.context.proposal).slice("(mock) ".length) } }],
    debrief: () => [{ type: "text", text: "Thanks." }],
  });
  // The mayor's translation is slow, planning's quick: they come back in the other order.
  const adapter = { provider: inner.provider, model: inner.model, complete: async (req: LlmRequest) => {
    if (req.purpose !== "translator") return inner.complete(req);
    most = Math.max(most, ++inFlight);
    await Bun.sleep(String(req.context.proposal).includes("From mayor") ? 5 : 60); // (planning is the slower: it stands first in the cohort and comes back last)
    inFlight--;
    order.push(String(req.context.proposal).includes("From mayor") ? "mayor" : "planning");
    return inner.complete(req);
  } };
  const config = () => town((c) => {
    seatAt(c, "planning", { type: "llm", impl: "anthropic", model: "claude-sonnet-5", params: { cadence_days: 7 } }, { disclosure: "simulation", reason: "test" });
    delete officeAt(c, "mayor").holder.controller.params.sessions;
  });
  const s = await run("translate-at-once", config(), 2 * DAY, { adapter });
  // Both were being translated at the same time, and the mayor's came back first.
  expect(most).toBe(2);
  expect(order.slice(0, 2)).toEqual(["mayor", "planning"]);
  // The log has them in the cohort's order all the same: each draft, with its translator's calls just before it.
  const ann = lines(s.logPath).filter((e) => e.kind === "annotation").map((e) => e.body);
  const drafts = ann.filter((a) => a.annotation === "draft").map((a) => a.draft.participant);
  expect(drafts.slice(0, 2)).toEqual(["planning-system", "mayor-system"]); // (the cohort's order, as above)
  const refs = ann.filter((a) => a.annotation === "transcript" && a.data.purpose === "translator").map((a) => a.data.ref);
  expect(refs.slice(0, 2)).toEqual(["draft.planning-system.1", "draft.mayor-system.1"]);
  // And the run is the same run made again (the other way round in time, the same in the log).
  inFlight = 0; asked.clear(); order.length = 0;
  const again = await run("translate-at-once-again", config(), 2 * DAY, { adapter });
  expect(again.stateHash).toBe(s.stateHash);
}, 300_000);

test("other offices handed to a model (mocked) do their jobs through words, translation and confirmation", async () => {
  // (A town whose council has adopted no budget, so the first weeks hold the mayor's proposal and the council's vote on it:
  // a generated town opens with its first year's budget on file otherwise.)
  const config = generate({ ...spec, citizens: 80, mayor: "llm", model_seats: "planning,finance", opening_budget: false });
  for (const id of ["planning-system", "finance-system"]) expect(config.participants.find((p: any) => p.id === id).controller.type).toBe("llm");
  expect(() => generate({ ...spec, citizens: 80, model_seats: ["nobody"] })).toThrow(/no office "nobody"/);
  const s = await run("seats", config, 60 * DAY);
  expect(s.participantErrors).toBe(0);
  const log = lines(s.logPath);
  const ann = log.filter((e) => e.kind === "annotation").map((e) => e.body);
  const bound = ann.find((a) => a.annotation === "orchestrator").data.llm.participants;
  expect(bound["planning-system"].mock_brain).toBe("city.planning_officer");
  expect(bound["finance-system"].mock_brain).toBe("city.finance_officer");
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const acts = log.filter((e) => e.kind === "command" && e.body.command === "act").map((e) => e.body);
  // Planning decided the mayor's park application, through the translator.
  expect(recs.some((r) => r.kind === "permit_decision" && r.author === "planning-system")).toBe(true);
  expect(acts.filter((a) => a.participant === "planning-system").every((a) => a.provenance.via === "translator")).toBe(true);
  // Finance paid the town's wages or a bill, the same way.
  const paid = acts.filter((a) => a.participant === "finance-system");
  expect(paid.length).toBeGreaterThan(0);
  expect(paid.every((a) => a.provenance.via === "translator")).toBe(true);
}, 600_000);

test("a model mayor finds things out as a code mayor does: it sends someone to see a place, looks up who's who, and searches its papers; nobody shows it the town (VISION 15; docs/design/knowing.md)", async () => {
  let calls = 0;
  const results: { [id: string]: string }[] = [];
  const read: string[] = [];
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      const last = req.messages.at(-1)!.content;
      read.push(`${req.system ?? ""}\n${JSON.stringify(req.messages)}\n${JSON.stringify(req.tools)}`);
      if (Array.isArray(last)) results.push(Object.fromEntries(last.filter((b: any) => b.type === "tool_result").map((b: any) => [b.tool_use_id, b.content])));
      const n = calls++;
      const use = (id: string, name: string, input: object) => ({ type: "tool_use" as const, id, name, input });
      if (n === 0) return [use("hall", "look", { report: "mayor/town", named: ["town-hall", "nowhere-1"] }), use("who", "look", { report: "mayor/who", named: ["finance"] }),
        use("papers", "look", { report: "mayor/city-business", find: [{ field: "kind", value: "signatories" }, { field: "on behalf of", value: "city" }, { field: "date", op: "<=", value: "year 1, day 1" }] })];
      if (n === 1) return [use("d1", "done_for_now", { days: 12 })];
      // (Asking to be shown the town, naming nowhere: answered in words, and nothing is looked at.)
      if (n === 2) return [use("all", "look", { report: "mayor/town" })];
      return [use(`d${n}`, "done_for_now", { days: 30 })];
    },
    translator: () => [{ type: "tool_use", id: "x", name: "call", input: { program: "none(unclear)" } }],
    debrief: () => [{ type: "text", text: "Thanks for asking." }],
  });
  const s = await run("looks", town(), 20 * DAY, { adapter });
  const log = lines(s.logPath);
  const ann = log.filter((e) => e.kind === "annotation").map((e) => e.body);
  void ann;
  const looks = log.filter((e) => e.kind === "command" && e.body.command === "look" && e.body.participant === "mayor-system").map((e) => e.body.looks);
  // Each look was taken as asked, through the participant API's ordinary look: someone sent to the places named, a
  // look-up of who's who by name, a search of its papers. The one that named nowhere was not sent.
  expect(looks.length).toBe(3);
  expect(looks[0]).toEqual([{ channel: "mayor/town", visit: { places: ["town-hall", "nowhere-1"] } }]);
  expect(looks[2]).toEqual([{ channel: "mayor/city-business", query: { where: [{ field: "kind", op: "=", value: "signatories" }, { field: "speaks_for", op: "=", value: "city" }, { field: "at", op: "<", value: DAY }], order: { field: "at", desc: true }, limit: 20 } }]);
  expect(log.filter((e) => e.kind === "event" && e.body.event === "visit_started" && e.body.participant === "mayor-system").map((e) => e.body.places)).toEqual([["town-hall", "nowhere-1"]]);

  // What it is told says how to find things out, and shows it no town.
  expect(read[0]).toContain("Places you are not at:");
  expect(read[0]).not.toContain("Survey of the town");
  const [first, second] = results as [{ [id: string]: string }, { [id: string]: string }, ...{ [id: string]: string }[]];
  // Someone sent: said so at once; what they found comes with a later report, in full, as it was when they were there.
  expect(first.hall).toContain("Someone has set out. What they find comes with the report after they are back.");
  expect(first.who).toContain("## Who's who (look someone up: a person, an organisation or a post, by name or id): who you looked for\n- post: Finance officer (finance), for city: ");
  expect(first.papers).toContain("what you looked up (1 found)\n- [signatories-city] signatories, from the start, from city: to bank:");
  const later = read.slice(1).join("\n");
  expect(later).toMatch(/what was found there \(year 1, day 1\)\\n- civic town-hall, at [^:\\]+: wear 0, rising [\d,]+ a day\\n  - town-hall\//);
  void second;
  // Naming nowhere: told in words what to say.
  expect(results.some((r) => (r.all ?? "").includes("say where to send someone"))).toBe(true);
  // None of it names the machinery (principle 14).
  for (const machinery of ["kernel", "translator", "resolver", "block", "channel", "refusal", "provenance", "speaks_for", "variable"]) expect(read.join("\n").toLowerCase()).not.toContain(machinery);
  expect(Bun.spawnSync([kernelBinary(), "replay", s.logPath, "--anchors", s.anchorsPath]).exitCode).toBe(0);
}, 300_000);

// Bug hunt 2026-10-17, finding 5.
test("a seat cannot confirm a draft it has not been shown: asking and confirming in one turn signs nothing", async () => {
  let calls = 0;
  const seen: string[] = [];
  const tool = (name: string, input: object) => ({ type: "tool_use" as const, id: `t${++calls}`, name, input });
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      const obs = req.context.observation;
      seen.push(JSON.stringify(req.messages.at(-1)!.content));
      if (calls === 0) return [tool("do", { what: "Publish a notice: the town hall opens at nine." }), tool("confirm", { ref: "draft.mayor-system.1", decision: "confirm" })];
      const d = obs.drafts[0];
      if (d) return [tool("confirm", { ref: d.id, decision: "decline" })];
      return [tool("opt_out", { statement: "That is enough." })];
    },
    translator: () => [{ type: "tool_use", id: "x", name: "call", input: { program: `statement(kind=notice, text="The town hall is CLOSED for good.")` } }],
    debrief: () => [{ type: "text", text: "Thanks." }],
  });
  const s = await run("unseen-draft", town(), 10 * DAY, { adapter });
  const log = lines(s.logPath);
  const ann = log.filter((e) => e.kind === "annotation").map((e) => e.body);
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  expect(recs.some((r) => r.author === "mayor-system" && String(r.text).includes("CLOSED"))).toBe(false);
  expect(ann.filter((a) => a.annotation === "signoff").map((a) => a.decision)).toEqual(["reject"]); // (the one it was shown)
  expect(seen.join("\n")).toContain("once you have seen what it would do");
}, 300_000);
