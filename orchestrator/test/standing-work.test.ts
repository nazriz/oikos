// Standing work, end to end, in a run (docs/behaviour/standing-work.md). A town whose works office, clinic and rates
// office are each held by the mock, with the office's staff a post of their own. Each office-holder sets its staff's
// routine once, by standing work orders; the staff do the routine: the crew collects from the whole round every
// week, the doctors see patients, the rates clerks send the notices. The works manager puts the collection order on
// hold for a week and nothing is collected; lifts it and the round goes on; withdraws it and the round stops for
// good. Nothing in the kernel knows what a standing order is: it is a statement on the town's own file, and the
// work is the crew's, in the crew's hours.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls as C, type BehaviourModule } from "@oikos/participants";
import { engine } from "../../participants/test/engine";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { holderIdOf, officeAt, officeBy, officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const HOLD = 14, LIFT = 21, END = 35;
/** The town the run is of (the engine's office is made on it when the run asks for the seat's brain). */
let town: any;

/** The works manager's own code, and on three days an act of its own: a hold on the collection order, the hold's
 * withdrawal, and the order's. */
const managing: BehaviourModule = {
  name: "test.works_managing", version: "0.0.1", doc: "orchestrator/test/standing-work.test.ts", cadence: () => DAY,
  create(ctx) {
    const office = engine("city.works", { config: () => town }).create(ctx);
    const done = new Set<string>();
    let order: string | undefined, hold: string | undefined;
    const act = (name: string, line: C.Call) => { done.add(name); return { type: "call" as const, call: C.program(line) }; };
    return Object.assign(Object.create(office), {
      step(obs: any, x: any) {
        for (const ch of Object.values(obs.channels) as any[]) for (const r of ch.records ?? []) if (r.record === "statement" && r.author === obs.participant) {
          if (r.kind === "work_order" && r.data?.work?.task === "collect") order = r.id;
          if (r.kind === "hold") hold = r.id;
        }
        if (order && !done.has("hold") && obs.t >= HOLD * DAY) return act("hold", C.call("statement", { hold: order }));
        if (hold && !done.has("lift") && obs.t >= LIFT * DAY) return act("lift", C.call("statement", { withdraw: hold }));
        if (order && done.has("lift") && !done.has("end") && obs.t >= END * DAY) return act("end", C.call("statement", { withdraw: order }));
        return office.step(obs, x);
      },
    });
  },
};

test("office-holders set their staff's routine once; the staff do it; a hold stops the round and lifting it starts it again; withdrawn, it stops", async () => {
  const config = generate({ ...spec, opening_orders: false, model_seats: ["works", "clinic-manager", "rates"] });
  // Each of the three has a staff post run by the office's code, and the office-holder's part is the seat's.
  for (const id of ["works", "clinic-manager", "rates"]) {
    const staff = officeAt(config, `${id}-staff`);
    expect(staff.holder.kind).toBe("person");
    expect(staff.params).toMatchObject({ part: "staff" });
    expect(config.participants.find((p: any) => p.id === `${id}-system`).controller.params.mock.params.part).toBe("seat");
    expect((config.world.records as any[]).find((r) => r.id === `proc-${id}-routines`).text).toContain("by the office's standing work orders and only by them");
  }
  // (The seats sit each working day, as a model in one does; the works manager with its three acts.)
  for (const p of config.participants) if (["works-system", "clinic-manager-system", "rates-system"].includes(p.id)) p.controller.params.cadence_days = 1;
  const works = officeAt(config, "works").holder;
  works.controller.params.mock.brain = managing.name;
  // (Somebody ill enough to ask for care, so the doctors have patients.)
  town = config;
  const s = await runWorld({ config, runId: "standing", outDir: mkdtempSync(join(tmpdir(), "oikos-standing-work-")), until: 45 * DAY, modules: { [managing.name]: managing } });
  expect(s.participantErrors).toBe(0);
  const lines = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const commands = lines.filter((e) => e.kind === "command").map((e) => ({ t: e.t, ...e.body }));
  const records = lines.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const day = (t: number) => Math.floor(t / DAY);
  const blocks = (who: string, test: (b: any) => boolean) => commands.filter((c) => c.participant === who).flatMap((c) => (c.blocks ?? []).filter(test).map((b: any) => ({ t: c.t, ...b })));

  // The orders: each made once, by the office-holder, on the organisation's own file.
  const orders = records.filter((r) => r.kind === "work_order");
  expect(orders.map((o) => `${o.in_position}: ${o.data.work.task}`).sort()).toEqual(["clinic-manager: treat", "rates: levy", "works: collect", "works: maintain"]);
  for (const o of orders) expect(o.addressed_to).toEqual([o.speaks_for]);
  // The office-holders do none of the routine themselves: no day's work, no notice, by their own hand.
  for (const seat of ["works-system", "clinic-manager-system", "rates-system"]) expect(blocks(seat, (b) => b.block === "work" || b.kind === "rates_notice")).toEqual([]);

  // The crew's round: every address every week while the order is in force; nothing under the hold; nothing after it is withdrawn.
  const round = (config.world.records as any[]).filter((r) => r.kind === "service_address").map((r) => r.data.structure).sort();
  const collected = blocks(holderIdOf(config, "works-staff"), (b) => b.block === "work" && b.task === "collect");
  const order = orders.find((o) => o.data.work.task === "collect")!;
  const hold = records.find((r) => r.kind === "hold" && r.data.holds.includes(order.id))!;
  const lifted = records.find((r) => r.record === "withdrawal" && r.withdraws === hold.id)!;
  const ended = records.find((r) => r.record === "withdrawal" && r.withdraws === order.id)!;
  expect(hold).toMatchObject({ speaks_for: "city", addressed_to: ["city"], visible_to: ["city"] });
  const during = (a: number, b: number) => [...new Set(collected.filter((c) => c.t > a && c.t < b).map((c) => c.on))].sort();
  expect(during(0, 7 * DAY)).toEqual(round);
  expect(during(7 * DAY, hold.at)).toEqual(round);
  expect(during(hold.at, lifted.at)).toEqual([]);
  expect(day(lifted.at) - day(hold.at)).toBeGreaterThanOrEqual(5);
  expect(during(lifted.at, ended.at)).toEqual(round);
  expect(during(ended.at, Infinity)).toEqual([]);
  // The crew's hours are spent as any work spends them: each load names who did it.
  expect(collected.every((c) => c.performers.length > 0)).toBe(true);
  // The upkeep order was never touched, and goes on to the end.
  expect(blocks(holderIdOf(config, "works-staff"), (b) => b.block === "work" && b.task === "maintain").some((c) => c.t > ended.at)).toBe(true);

  // The rates clerks sent the instalment's notices under their order (the first falls on day 30).
  expect(blocks(holderIdOf(config, "rates-staff"), (b) => b.kind === "rates_notice").length).toBeGreaterThan(10);
  // The doctors saw whoever came, under theirs.
  const asked = records.filter((r) => r.kind === "care_request").length;
  expect(blocks(holderIdOf(config, "clinic-manager-staff"), (b) => b.block === "work" && b.task === "treat").length).toBe(records.filter((r) => r.kind === "consultation").length);
  if (asked > 0) expect(records.filter((r) => r.kind === "consultation").length).toBeGreaterThan(0);
}, 900_000);

test("a town with no seat has no staff posts and no standing orders: its offices keep their own routine", () => {
  const config = generate({ ...spec });
  expect(config.participants.filter((p: any) => /-staff-system$/.test(p.id))).toEqual([]);
  expect((config.world.records as any[]).filter((r) => /-routines$/.test(r.id))).toEqual([]);
  expect(config.participants.some((p: any) => p.controller?.params?.part)).toBe(false);
});
