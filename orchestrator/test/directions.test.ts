// A written direction, end to end, in a run (docs/behaviour/directions.md; docs/design/call-language-gaps.md B.4):
// a town whose works office has still to take its crew on. The mayor, a code participant doing its job as its module
// does it, files a staffing direction on the works office's form on the second day: do not recruit. The council
// adopts the budget, which pays for a crew; the works office, run by code, advertises nothing while the direction
// stands, and writes to the mayor to say so. The mayor withdraws the direction; the office advertises the next day
// and takes its crew on. Nothing in the kernel knows what a direction is: the acts are a statement and its
// withdrawal, and following it is the office's own conduct.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls as C, modules as builtin, type BehaviourModule } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { giveToAnother, officeAt, officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

interface Script { direct_day: number; lift_day: number; form: string; to: string; fields: { [k: string]: string } }

/** An office doing its job as its module does it, and on given days these things of its own: a direction filed on
 * another office's form, and its withdrawal. */
const directing = (inner: string): BehaviourModule => ({
  name: `test.directing.${inner.replace(/\./g, "_")}`,
  version: "0.0.1",
  doc: "orchestrator/test/directions.test.ts",
  cadence: () => DAY,
  create(ctx) {
    const { script, ...rest } = ctx.params as { script: Script };
    const office = builtin[inner]!.create({ ...ctx, params: rest });
    const done = new Set<string>();
    let direction: string | undefined;
    const act = (...lines: C.Call[]) => ({ type: "call" as const, call: C.program(...lines) });
    return Object.assign(Object.create(office), {
      step(obs: any, x: any) {
        // Its own direction, as the world recorded it (it is shown the town's papers): the id it is withdrawn by.
        for (const ch of Object.values(obs.channels) as any[]) for (const r of ch.records ?? []) if (r.record === "statement" && r.kind === "direction" && r.author === obs.participant) direction = r.id;
        if (!done.has("direct") && obs.t >= script.direct_day * DAY) {
          done.add("direct");
          return act(C.call("form", { form: script.form, to: script.to, ...script.fields }));
        }
        if (direction && !done.has("lift") && obs.t >= script.lift_day * DAY) {
          done.add("lift");
          return act(C.call("statement", { withdraw: direction }));
        }
        return office.step(obs, x);
      },
    });
  },
});

async function town(name: string, who: { position: string; module: string }, script: Script, until: number) {
  // (No budget on file at the start: the works office recruits once the council adopts one, about a fortnight in,
  // which is when these tests' directions are standing or not.)
  const config = generate({ ...spec, citizens: 120, nature: false, works_crew_at_start: 0, opening_budget: false });
  // (The town's few clerks hold several posts: a direction from a person to an office they hold themselves is their own, and
  // is not answered; here the works office has a holder of its own.)
  giveToAnother(config, "works");
  const part = officeAt(config, who.position);
  expect(part.impl).toBe(who.module);
  const wrapped = directing(who.module);
  part.run(wrapped.name, { ...(part.params ?? {}), script });
  // (The council votes within the week, so that the budget is adopted well inside the run.)
  for (const x of officesBy(config, "city.council_clerk")) Object.assign(x.params, { vote_days: 5 });
  const s = await runWorld({ config, runId: name, outDir: mkdtempSync(join(tmpdir(), `oikos-directions-${name}-`)), until: until * DAY, modules: { [wrapped.name]: wrapped } });
  expect(s.participantErrors).toBe(0);
  const lines = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const events = lines.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const records = events.filter((e) => e.event === "recorded").map((e) => e.record);
  const letters = lines.filter((e) => e.kind === "command").flatMap((e) => ((e.body.blocks ?? []) as any[]).filter((b) => b.block === "message").map((b) => ({ t: e.t, from: e.body.participant, ...b })));
  const day = (t: number) => Math.floor(t / DAY);
  const crewAdverts = records.filter((r) => r.kind === "job_posting" && r.speaks_for === "city" && r.data?.role === "works crew");
  const budget = records.find((r) => r.kind === "budget" && r.speaks_for === "city");
  const holderOf = (post: string): string => officeAt(config, post).holder.id;
  return { config, holderOf, records, letters, day, crewAdverts, budget, crew: records.filter((r) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0] === "city" && !/ as administrative officer for /.test(r.terms.text ?? "")) }; // (the works crew: the town's administrative staff, who have a role of their own, are not it)
}

test("the mayor directs the works office not to recruit: it advertises nothing while that stands, and recruits again when it is withdrawn", async () => {
  const r = await town("mayor", { position: "mayor", module: "city.mayor_code" }, { direct_day: 1, lift_day: 30, form: "works_staffing", to: "works", fields: { recruit: "no" } }, 45);
  // The town published the form and the rule on who may direct, and the office was told which record that is.
  const form = r.config.world.records.find((x: any) => x.id === "form-works-staffing");
  expect(form.data).toMatchObject({ form: "works_staffing", office: "works", submit_as: "direction", submit_to: ["city"] });
  expect(r.config.world.records.find((x: any) => x.id === "proc-directions").data).toEqual({ directions: { by: ["mayor", "council-clerk"] } });
  expect(r.config.positions.find((x: any) => x.id === "works").role_module.params.directed_under).toBe("proc-directions");
  // The direction: a statement to the town, made in the mayor's post, citing the form.
  const d = r.records.find((x) => x.kind === "direction")!;
  expect(d).toMatchObject({ in_position: "mayor", speaks_for: "city", addressed_to: ["city"], basis: "form-works-staffing", data: { recruit: "no" } });
  expect(r.day(d.at)).toBe(1);
  // The budget was adopted while it stood, and pays for a crew the town does not have.
  expect(r.budget).toBeDefined();
  expect(r.day(r.budget.at)).toBeLessThan(25);
  expect(Number(r.budget.data.lines.staff)).toBeGreaterThan(0);
  // While it stood: not one advertisement for crew. Withdrawn on day 30: one the next working morning, and hires after.
  const lifted = r.records.find((x) => x.record === "withdrawal" && x.withdraws === d.id)!;
  expect(r.day(lifted.at)).toBe(30);
  expect(r.crewAdverts.filter((a) => a.at < lifted.at)).toEqual([]);
  const after = r.crewAdverts.filter((a) => a.at >= lifted.at);
  expect(after.length).toBeGreaterThan(0);
  expect(r.day(after[0]!.at) - 30).toBeLessThanOrEqual(3);
  expect(r.crew.filter((a) => a.at > lifted.at).length).toBeGreaterThan(0);
  expect(r.crew.filter((a) => a.at <= lifted.at)).toEqual([]);
  // The office wrote to the mayor, once, to say what it would do.
  const ack = r.letters.filter((m) => m.from === r.holderOf("works") && m.re === d.id);
  expect(ack.map((m) => m.text)).toEqual([`From the works office: your direction ${d.id} is received. The office advertises no post, takes down the advertisements it has out and makes no new offer of employment. It has no offer out that is not yet signed. It stands until you replace or withdraw it.`]);
  expect(ack[0]!.to).toEqual([r.holderOf("mayor")]);
}, 600_000);

test("the same direction from the finance officer, whom the town's rule does not name, changes nothing: the office recruits, and says why it does not follow it", async () => {
  const r = await town("finance", { position: "finance", module: "city.finance_officer" }, { direct_day: 1, lift_day: 1000, form: "works_staffing", to: "works", fields: { recruit: "no" } }, 35);
  const d = r.records.find((x) => x.kind === "direction")!;
  expect(d).toMatchObject({ in_position: "finance", speaks_for: "city", basis: "form-works-staffing" });
  expect(r.budget).toBeDefined();
  // Once the budget pays for a crew, the office advertises as it would have.
  expect(r.crewAdverts.length).toBeGreaterThan(0);
  expect(r.day(r.crewAdverts[0]!.at) - r.day(r.budget.at)).toBeLessThanOrEqual(3);
  const reply = r.letters.filter((m) => m.from === r.holderOf("works") && m.re === d.id);
  expect(reply.map((m) => m.text)).toEqual([`From the works office: your direction ${d.id} is not being followed. This office takes directions on its forms only from those proc-directions names.`]);
  expect(reply[0]!.to).toEqual([r.holderOf("finance")]);
}, 600_000);
