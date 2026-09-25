// Language-model seats through the mock adapter (docs/design/m2-llm-seats.md):
// the whole propose -> draft -> sign-off -> act loop, its records, and the
// seat's ways out (rejecting a draft, resigning), without a real model.

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

async function run(name: string, extra: object, until: number, opts: object = {}) {
  const out = join(root, "runs", `test-llm-${name}`);
  rmSync(out, { recursive: true, force: true });
  return runWorld({ config: generate({ ...spec, citizens: 80, mayor: "llm", ...extra }), runId: name, outDir: out, until, ...opts });
}

test("a mock-LLM mayor governs through the translator, and every call is recorded", async () => {
  const s = await run("mayor", {}, 60 * DAY);
  const log = lines(s.logPath);
  const ann = log.filter((e) => e.kind === "annotation").map((e) => e.body);
  const orch = ann.find((a) => a.annotation === "orchestrator");
  expect(orch.data.llm.seats.mayor).toEqual({ configured: "anthropic/claude-sonnet-5", adapter: "mock/mock", mock_brain: "city.mayor_code" });

  // Every call has a usage record (priced, here at zero) and a transcript.
  const usage = ann.filter((a) => a.annotation === "usage");
  expect(usage.length).toBeGreaterThan(5);
  expect(usage.every((u) => u.provider === "mock" && u.cost_microusd === 0 && u.input_tokens > 0)).toBe(true);
  expect(ann.filter((a) => a.annotation === "transcript").length).toBe(usage.length);
  expect(new Set(usage.map((u) => u.purpose))).toEqual(new Set(["seat", "translator", "debrief"]));

  // Each signed draft is carried into the act with its hash, and the hash is the draft's.
  const drafts = new Map(ann.filter((a) => a.annotation === "draft").map((a) => [a.draft.id, a.draft]));
  const acts = log.filter((e) => e.kind === "command" && e.body.command === "act" && e.body.seat === "mayor").map((e) => e.body);
  expect(acts.length).toBeGreaterThan(0);
  for (const a of acts) {
    expect(a.provenance.via).toBe("translator");
    const d = drafts.get(a.provenance.draft)!;
    expect(a.provenance.draft_hash).toBe(draftHash(d));
    expect(canonical(a.blocks)).toBe(canonical(d.blocks));
    expect(ann.some((x) => x.annotation === "signoff" && x.draft === d.id && x.decision === "accept" && x.draft_hash === a.provenance.draft_hash)).toBe(true);
  }
  // And the institutions carry it on: the mayor's budget proposal is adopted by the council.
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const proposal = recs.find((r) => r.kind === "proposal" && r.author === "mayor");
  const ballot = recs.find((r) => r.kind === "ballot" && r.basis === proposal.id);
  expect(recs.some((r) => r.kind === "budget" && r.basis === ballot.id)).toBe(true);
  expect(ann.some((a) => a.annotation === "debrief" && a.subject === "mayor")).toBe(true);

  // Every log line is canonical JSON, byte for byte as the TypeScript port writes it (draft hashes rely on this).
  for (const l of readFileSync(s.logPath, "utf8").trim().split("\n")) expect(canonical(JSON.parse(l))).toBe(l);
  // Replay needs no model: the annotations are copied, the acts re-applied.
  expect(Bun.spawnSync([kernelBinary(), "replay", s.logPath, "--anchors", s.anchorsPath]).exitCode).toBe(0);
  // And a re-run is identical.
  const again = await run("mayor-again", {}, 60 * DAY);
  const bodies = (p: string) => lines(p).slice(1).map((e) => canonical(e.body));
  expect(bodies(again.logPath)).toEqual(bodies(s.logPath));
}, 300_000);

test("a seat is told when a proposal can't be drafted, can reject an unfaithful draft, and can resign", async () => {
  // A scripted seat and translator. The translator mangles the first notice it drafts.
  let calls = 0, drafted = 0, accepted = false;
  const seen: string[] = [];
  const tool = (name: string, input: object) => [{ type: "tool_use" as const, id: `t${++calls}`, name, input }];
  const adapter = new MockAdapter("mock", {
    seat: (req: LlmRequest) => {
      const obs = req.context.observation;
      seen.push(JSON.stringify(req.messages.at(-1)!.content));
      if (calls === 0) return tool("propose", { text: "Build a stadium by the river." });
      const d = obs.drafts[0];
      if (d) {
        accepted = d.blocks[0].text === "The town hall opens at nine.";
        return tool("sign", { draft: d.id, decision: accepted ? "accept" : "reject", note: "checked" });
      }
      if (!accepted) return tool("propose", { text: "Publish a notice: the town hall opens at nine." });
      return tool("resign", { statement: "I'd rather not continue in this role." });
    },
    translator: () => {
      if (++drafted === 1 && calls === 1) return [{ type: "tool_use", id: "x", name: "cannot_draft", input: { reason: "No stadium in the catalogue." } }];
      const text = drafted === 2 ? "The town hall is closed indefinitely." : "The town hall opens at nine.";
      return [{ type: "tool_use", id: "x", name: "draft", input: { blocks: [{ block: "publish", kind: "notice", text, speaks_for: "city" }], summary: "Publishes the notice as asked." } }];
    },
    debrief: () => [{ type: "text", text: "Thanks for asking." }],
  });
  const s = await run("scripted", {}, 30 * DAY, { adapter });
  const log = lines(s.logPath);
  const ann = log.filter((e) => e.kind === "annotation").map((e) => e.body);
  expect(ann.find((a) => a.annotation === "translation_failure")?.data.reason).toBe("No stadium in the catalogue.");
  // The seat's next prompt told it so.
  expect(seen[1]).toContain("The translator could not draft your proposal");
  // The mangled draft was rejected; the faithful one accepted and published.
  expect(ann.filter((a) => a.annotation === "signoff").map((a) => a.decision)).toEqual(["reject", "accept"]);
  const recs = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  expect(recs.filter((r) => r.author === "mayor").map((r) => r.text)).toEqual(["The town hall opens at nine."]);
  // Then it resigned, and was still debriefed.
  expect(log.some((e) => e.kind === "event" && e.body.event === "seat_resigned" && e.body.seat === "mayor")).toBe(true);
  expect(ann.find((a) => a.annotation === "debrief")?.data.response).toBe("Thanks for asking.");
}, 300_000);
