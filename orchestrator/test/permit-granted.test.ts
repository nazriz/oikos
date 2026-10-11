// A permit granted on the planning office's own form is a permit (contracts: FormWrites `claim`; docs/decisions.md,
// "A permit granted on the planning office's form is a permit", 2026-10-11). The form records the applicant's liberty
// to build beside the decision, and the building inspector, who reads liberties, leaves the building alone. A decision
// with no liberty recorded (what the form wrote before, and what a pilot's seat granted) is no permit: the same
// building is fined and ordered down. A small town, a planning seat that says what it is told to, no model.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAdapter, type LlmRequest } from "@oikos/participants/llm";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;

/** The town with a planning seat that grants the first application it is shown, in the words `grant` gives. */
async function town(name: string, grant: (app: { id: string; lot: string; type: string; applicant: string }) => string) {
  const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
  const config = generate({ ...spec, model_seats: ["planning"] });
  let n = 0, decided = false, program = "";
  const use = (tool: string, input: object) => ({ type: "tool_use" as const, id: `t${++n}`, name: tool, input });
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      if (req.subject !== "planning-system") return [use("done_for_now", { days: 1 })];
      const text = req.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
      const waiting = /\((draft\.planning\.\d+)\)|Before this goes ahead \((draft\.planning\.\d+)\)/.exec(text);
      if (waiting) return [use("confirm", { ref: waiting[1] ?? waiting[2], decision: "confirm" }), use("done_for_now", { days: 1 })];
      const app = /\[(rec\.\d+)\] permit application from (\S+?)[,:]?\s[^\n]*?lot: (lot-\d+-\d+)[^\n]*?structure type: (\w+)/.exec(text) ?? /\[(rec\.\d+)\] permit application from (\S+?)[,:]?\s[^\n]*?structure type: (\w+)[^\n]*?lot: (lot-\d+-\d+)/.exec(text);
      if (decided || !app) return [use("done_for_now", { days: 1 })];
      decided = true;
      const lotFirst = app[3]!.startsWith("lot-");
      program = grant({ id: app[1]!, applicant: app[2]!, lot: lotFirst ? app[3]! : app[4]!, type: lotFirst ? app[4]! : app[3]! });
      return [use("do", { what: "Decide the permit application.", as: "planning" })];
    },
    translator: () => [{ type: "tool_use" as const, id: `x${++n}`, name: "call", input: { program } }],
    debrief: () => [{ type: "text", text: "Noted." }],
  });
  const s = await runWorld({ config, runId: name, outDir: mkdtempSync(join(tmpdir(), `oikos-${name}-`)), until: 12 * DAY, adapter, recordObservations: "none", recordDecisions: "none" });
  expect(s.participantErrors).toBe(0);
  const recs = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  return { program: () => program, recs };
}
const fines = (recs: any[]) => recs.filter((r) => r.record === "claim" && r.about?.kind === "fine");
const orders = (recs: any[]) => recs.filter((r) => r.kind === "demolition_order");
const liberties = (recs: any[]) => recs.filter((r) => r.record === "claim" && r.position === "liberty" && r.about?.action === "build");

test("granted on the planning office's form, the building is permitted: the liberty is recorded with the decision, and the inspector fines nothing", async () => {
  const { recs, program } = await town("permit-on-form", (a) => `form(form=permit_decision, to=planning, application=${a.id}, applicant=${a.applicant}, decision=granted, lot=${a.lot}, structure_type=${a.type})`);
  expect(program()).toContain("form(form=permit_decision");
  const decision = recs.find((r) => r.kind === "permit_decision" && r.author === "planning-system");
  expect(decision?.data).toMatchObject({ decision: "granted" });
  const liberty = liberties(recs).find((r) => r.author === "planning-system");
  expect(liberty).toMatchObject({ position: "liberty", holder: decision.addressed_to[0], basis: decision.data.application, about: { action: "build" } });
  // (Recorded before the decision that says so, in one act of the seat's.)
  expect(liberty.at).toBeLessThanOrEqual(decision.at);
  // The building went up (the builder gave notice and the inspector went to see), and nothing was fined or ordered down.
  expect(recs.some((r) => r.kind === "building_notice" || r.kind === "valuation_request")).toBe(true);
  expect(fines(recs)).toEqual([]);
  expect(orders(recs)).toEqual([]);
}, 600_000);

test("a decision that says granted with no liberty recorded is no permit: the same building is fined and ordered down", async () => {
  // (What the form wrote until 2026-10-11, and what stands in a run begun before it: the decision paper alone.)
  const { recs } = await town("permit-in-words", (a) => `statement(kind=permit_decision, text="Permit granted: application ${a.id}.", to=${a.applicant}, basis=${a.id}, data={"application":"${a.id}","decision":"granted"})`);
  expect(recs.find((r) => r.kind === "permit_decision" && r.author === "planning-system")?.data).toMatchObject({ decision: "granted" });
  expect(liberties(recs).filter((r) => r.author === "planning-system")).toEqual([]);
  expect(fines(recs).length).toBeGreaterThan(0);
  expect(orders(recs).length).toBeGreaterThan(0);
}, 600_000);
