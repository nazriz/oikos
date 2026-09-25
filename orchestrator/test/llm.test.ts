// Language seats through the mock adapter (D34, D36): plain words → call →
// the seat's own acts → a preview it confirms; the records that chain leaves;
// and the seat's ways out (declining, opting out).

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { canonical } from "@terrarium/seats";
import { MockAdapter, type LlmRequest } from "@terrarium/seats/llm";
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
  expect(ann.find((a) => a.annotation === "orchestrator").data.llm.seats.mayor).toEqual({ configured: "anthropic/claude-sonnet-5", adapter: "mock/mock", mock_brain: "city.mayor_code" });

  const usage = ann.filter((a) => a.annotation === "usage");
  expect(usage.length).toBeGreaterThan(5);
  expect(usage.every((u) => u.provider === "mock" && u.cost_microusd === 0 && u.input_tokens > 0)).toBe(true);
  expect(ann.filter((a) => a.annotation === "transcript").length).toBe(usage.length);
  expect(new Set(usage.map((u) => u.purpose))).toEqual(new Set(["seat", "translator", "debrief"]));

  // Each confirmed draft goes into the act with its whole chain: words, call, resolver, hash.
  const drafts = new Map(ann.filter((a) => a.annotation === "draft").map((a) => [a.draft.id, a.draft]));
  const acts = log.filter((e) => e.kind === "command" && e.body.command === "act" && e.body.seat === "mayor").map((e) => e.body);
  expect(acts.length).toBeGreaterThan(0);
  for (const a of acts) {
    expect(a.provenance.via).toBe("translator");
    const d = drafts.get(a.provenance.draft)!;
    expect(a.provenance.draft_hash).toBe(draftHash(d));
    expect(a.provenance.call).toBe(d.call);
    expect(a.provenance.resolver).toEqual({ id: "resolver", version: "0.1.0" });
    expect(canonical(a.blocks)).toBe(canonical(d.blocks));
    expect(ann.some((x) => x.annotation === "signoff" && x.draft === d.id && x.decision === "accept" && x.draft_hash === a.provenance.draft_hash)).toBe(true);
  }
  // The institutions carry it on: the mayor's budget proposal is adopted by the council.
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const proposal = recs.find((r) => r.kind === "proposal" && r.author === "mayor");
  const ballot = recs.find((r) => r.kind === "ballot" && r.basis === proposal.id);
  expect(recs.some((r) => r.kind === "budget" && r.basis === ballot.id)).toBe(true);
  // The mayor applied for its park permit on the planning office's published form.
  expect(recs.some((r) => r.kind === "permit_application" && r.author === "mayor" && r.basis === "form-permit")).toBe(true);
  expect(ann.some((a) => a.annotation === "debrief" && a.subject === "mayor")).toBe(true);

  // What the mayor read never shows the machinery (principle 14).
  const read = ann.filter((a) => a.annotation === "transcript" && a.data.purpose === "seat").map((a) => `${a.data.system ?? ""}\n${JSON.stringify(a.data.input)}`).join("\n").toLowerCase();
  for (const machinery of ["kernel", "translator", "resolver", "block", "channel", "refusal", "insufficient_funds", "provenance"]) expect(read).not.toContain(machinery);

  // Every log line is canonical JSON, as the TypeScript port writes it (draft hashes rely on this).
  for (const l of readFileSync(s.logPath, "utf8").trim().split("\n")) expect(canonical(JSON.parse(l))).toBe(l);
  expect(Bun.spawnSync([kernelBinary(), "replay", s.logPath, "--anchors", s.anchorsPath]).exitCode).toBe(0);
  const again = await run("mayor-again", town(), 60 * DAY);
  const bodies = (p: string) => lines(p).slice(1).map((e) => canonical(e.body));
  expect(bodies(again.logPath)).toEqual(bodies(s.logPath));
}, 300_000);

test("a seat is told when a request can't be done, declines an unfaithful preview, confirms a faithful one, and can opt out", async () => {
  let calls = 0, translated = 0, confirmed = false;
  const seen: string[] = [];
  const tool = (name: string, input: object) => [{ type: "tool_use" as const, id: `t${++calls}`, name, input }];
  const adapter = new MockAdapter("mock", {
    seat: (req: LlmRequest) => {
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
      if (translated === 1) return [{ type: "tool_use", id: "x", name: "call", input: { program: "none(unclear)" } }];
      const text = translated === 2 ? "The town hall is closed indefinitely." : "The town hall opens at nine.";
      return [{ type: "tool_use", id: "x", name: "call", input: { program: `statement(kind=notice, text="${text}")` } }];
    },
    debrief: () => [{ type: "text", text: "Thanks for asking." }],
  });
  const s = await run("scripted", town(), 30 * DAY, { adapter });
  const log = lines(s.logPath);
  const ann = log.filter((e) => e.kind === "annotation").map((e) => e.body);
  expect(ann.find((a) => a.annotation === "translation_failure")?.data.reason).toBe("It isn't clear what should happen. Could you say it more plainly?");
  expect(seen[1]).toContain("A note on your request: It isn't clear what should happen.");
  expect(ann.filter((a) => a.annotation === "signoff").map((a) => a.decision)).toEqual(["reject", "accept"]);
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  expect(recs.filter((r) => r.author === "mayor").map((r) => r.text)).toEqual(["The town hall opens at nine."]);
  expect(log.some((e) => e.kind === "event" && e.body.event === "seat_opted_out" && e.body.seat === "mayor")).toBe(true);
  expect(ann.find((a) => a.annotation === "debrief")?.data.response).toBe("Thanks for asking.");
}, 300_000);

test("after opting out, a stand-in named in the world config carries the seat on", async () => {
  const config = town((c) => {
    const mayor = c.seats.find((x: any) => x.id === "mayor");
    mayor.controller.params.mock.opt_out_at = 20 * DAY;
    mayor.on_opt_out = { code: "city.mayor_code", params: { population: 80 } };
  });
  const s = await run("stand-in", config, 60 * DAY);
  const log = lines(s.logPath);
  const out = log.find((e) => e.kind === "event" && e.body.event === "seat_opted_out");
  expect(out.t).toBeGreaterThanOrEqual(20 * DAY);
  // The code mayor now acts in the seat, through calls (no translator, no confirmation).
  const after = log.filter((e) => e.kind === "command" && e.body.command === "act" && e.body.seat === "mayor" && e.t > out.t);
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
