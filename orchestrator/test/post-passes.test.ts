// A model seat whose post passes to someone else at an election (docs/decisions.md, 2026-11-23, "The outgoing holder"):
// it reads the declared result at an ordinary sitting while it still holds the post, nothing is added to the result's
// own words, and once the post has gone it does not sit again and is debriefed without a claim of office. (Until the
// electoral office sets a date for taking office, the clerk here is a mock seat that seats the winner four days on.)

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls as C, type BehaviourModule } from "@oikos/participants";
import { engine } from "../../participants/test/engine";
import { generate } from "@oikos/worlds/generator/generate";
import { readLog } from "../src/logs";
import { runWorld } from "../src/run";
import { officeAt } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
let town: any;

/** The council clerk's own code, but for seating the declared winner four days after the declaration. */
const lateClerk: BehaviourModule = {
  name: "test.clerk_seats_later", version: "0.0.1", doc: "orchestrator/test/post-passes.test.ts", cadence: () => DAY,
  create(ctx) {
    const office = engine("city.council_clerk", { config: () => town }).create(ctx);
    let result: any, done = false;
    return Object.assign(Object.create(office), {
      step(obs: any, x: any) {
        for (const ch of Object.values(obs.channels) as any[]) for (const r of ch.records ?? []) if (r.kind === "ballot_result" && r.data?.office === "mayor") result = r;
        if (result && !done && obs.t >= result.at + 4 * DAY) {
          done = true;
          return { type: "call" as const, call: C.program(C.call("position", { appoint: "mayor", to: result.data.winner })) };
        }
        return office.step(obs, x);
      },
    });
  },
};

test("the outgoing holder reads the result in post, then stops sitting and is debriefed", async () => {
  const config = generate({ ...spec, citizens: 120, mayor: "llm", model_seats: ["council-clerk"], first_election_days: 61 }) as any;
  town = config;
  const mayor = officeAt(config, "mayor").holder;
  mayor.controller.params.mock.params.stands_again = false;
  const clerk = officeAt(config, "council-clerk").holder;
  const { electoral: _gone, ...params } = clerk.controller.params.mock.params;
  clerk.controller.params.cadence_days = 1;
  clerk.controller.params.mock = { brain: lateClerk.name, params };
  const out = mkdtempSync(join(tmpdir(), "oikos-post-passes-"));
  const s = await runWorld({ config, runId: "post-passes", outDir: out, until: 75 * DAY, modules: { [lateClerk.name]: lateClerk } });
  const log = readLog(s.logPath).trim().split("\n").map((l) => JSON.parse(l));
  rmSync(out, { recursive: true, force: true });
  expect(s.participantErrors).toBe(0);
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body })) as any[];
  const result = ev.find((e) => e.event === "recorded" && e.record?.kind === "ballot_result" && e.record?.data?.office === "mayor").record;
  const passed = ev.find((e) => e.event === "appointed" && e.position === "mayor");
  expect(passed.holder).toBe(result.data.winner);
  expect(passed.t).toBeGreaterThanOrEqual(result.at + 4 * DAY);
  const said = log.filter((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.subject === mayor.id);
  const sittings = said.filter((e) => e.body.data.purpose !== "debrief");
  // Told by the published record, at an ordinary sitting, while it still holds the post.
  const told = sittings.filter((e) => e.t > result.at && e.t < passed.t && String(e.body.data.input).includes(result.text));
  expect(told.length).toBeGreaterThan(0);
  // The only words added are these: the fact, with nothing on what to do about it.
  expect(String(told[0].body.data.input)).toContain("You are back before the day you gave: the result of the election for your post has been published. It is set out below.");
  // Once the post has gone it does not sit again.
  expect(sittings.filter((e) => e.t > passed.t)).toEqual([]);
  // Debriefed once, told its post passed, in the past tense.
  const brief = said.find((e) => e.body.data.purpose === "debrief");
  expect(String(brief?.body.data.input)).toMatch(/YOUR POST\nOn day \d+ the post of Mayor of .* passed from you to .*You held no post after that/);
  expect(log.filter((e) => e.kind === "annotation" && e.body.annotation === "debrief" && e.body.subject === mayor.id).length).toBe(1);
}, 400_000);
