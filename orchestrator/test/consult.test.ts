// The sparse mind (docs/design/ai-citizens.md 4): code citizens, deliberating about joining the union or starting a
// business, ask the run's model how much each option would matter to someone like them. Answers are remembered by kind
// of person and thing, logged in full, and a run with it replays exactly. Off unless a run turns it on.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { createConsult, kindOf, MockAdapter, mockPolicies, PRICES, readJudgements } from "@terrarium/participants/llm";
import type { ConsultQuestion } from "@terrarium/participants";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

const question = (security: number): ConsultQuestion => ({
  thing: "Joining the workers' union.", about: "join:union", options: [{ key: "join", words: "join" }, { key: "not", words: "don't" }],
  person: { values: { security, benevolence: 6_000 }, needs: { social: 3_000, security: 8_000 }, monthly_income: 400_000, savings: 800_000, household: 2 },
});

test("answers are asked once for a kind of person and thing, remembered after, and read as scores with a spread", async () => {
  const notes: any[] = [];
  const io = { adapter: new MockAdapter("mock", mockPolicies(new Map())), annotate: async (a: object) => void notes.push(a), now: () => 0, prices: PRICES };
  const consult = createConsult(io);
  const a = await consult(question(7_000), "c1-self");
  expect(a?.asked).toBe(true);
  expect(Object.keys(a!.scores).sort()).toEqual(["join", "not"]);
  for (const x of Object.values(a!.scores)) expect(x.sd).toBeGreaterThan(0); // three judgements, a point apart
  // Someone of the same kind (the same most-valued, least-met, means and household): remembered, no call.
  const b = await consult(question(7_500), "c2-self");
  expect(b?.asked).toBe(false);
  expect(b!.scores).toEqual(a!.scores);
  // Another kind (security no longer what they value most): asked.
  expect(kindOf(question(5_000))).not.toBe(kindOf(question(7_000)));
  expect((await consult(question(5_000), "c3-self"))?.asked).toBe(true);
  // Every call is logged: usage and transcript, marked as a consultation.
  expect(notes.filter((n) => n.annotation === "usage").length).toBe(2);
  expect(notes.filter((n) => n.annotation === "transcript").every((n) => String(n.data.ref).startsWith("consult/"))).toBe(true);
  // Answers a model might give, read or not.
  expect(readJudgements([{ type: "text", text: 'Sure: {"judgements": [{"join": 7, "not": 2}, {"join": 12, "not": 3}], "why": "x"}' }], ["join", "not"])).toEqual({ join: [7_000, 10_000], not: [2_000, 3_000] });
  expect(readJudgements([{ type: "text", text: "no idea" }], ["join", "not"])).toBeUndefined();
});

test("a town with the sparse mind on: citizens ask about joining the union, decide with the answer, and it replays exactly", async () => {
  const run = async (name: string, consult: boolean) => {
    const out = join(root, "runs", `test-consult-${name}`);
    rmSync(out, { recursive: true, force: true });
    const s = await runWorld({ config: generate(spec), runId: name, outDir: out, until: 120 * DAY, consult });
    expect(s.participantErrors).toBe(0);
    return { s, log: readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)) };
  };
  const on = await run("on", true);
  const asked = on.log.filter((e) => e.kind === "annotation" && e.body.annotation === "transcript" && String(e.body.data?.ref ?? "").startsWith("consult/"));
  expect(asked.length).toBeGreaterThan(0);
  // Decided with the answer; and remembered by kind: each kind of person asked once.
  // Joining decided once answered: someone who asked makes the decision (recorded as the mind's) after the answer.
  const thought = on.log.filter((e) => e.kind === "annotation" && e.body.annotation === "decision" && e.body.data?.domain === "membership" &&
    asked.some((a) => a.body.subject === e.body.subject && a.t <= e.t));
  expect(thought.length).toBeGreaterThan(0);
  const kinds = new Set(asked.map((e) => e.body.data.ref));
  expect(kinds.size).toBe(asked.length); // each kind asked once
  expect(on.log.some((e) => e.kind === "annotation" && e.body.annotation === "note" && e.body.data?.consult)).toBe(true);
  // The same run again: the same world, to the hash.
  const again = await run("again", true);
  expect(again.s.stateHash).toBe(on.s.stateHash);
  // Off (the default): no consultations.
  const off = await run("off", false);
  expect(off.log.some((e) => e.kind === "annotation" && String(e.body.data?.ref ?? "").startsWith("consult/"))).toBe(false);
}, 900_000);
