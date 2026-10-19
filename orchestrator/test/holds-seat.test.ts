// A hold by a seat, end to end (docs/design/call-language-gaps.md B.1 and B.2: "a mock-seat run"): the town's finance
// office is held by the mock. It does not know the standing wage payment's id: it looks in the office's files for the
// town's standing payment requests, as a person would; names the one it means by its id; puts a hold on it; and later
// lifts the hold. The request goes through the whole seat loop (said in words, drafted, previewed, confirmed). The
// bank passes over the pay day that falls under the hold and pays again from the next.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls as C, type BehaviourModule } from "@oikos/participants";
import { engine } from "../../participants/test/engine";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { officeAt, officeBy, officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

/** The town the run is of (the engine's office is made on it when the run asks for the seat's brain). */
let town: any;

/** The finance officer's own code, and of its own: a look in the office's files for the town's standing payment
 * requests; a hold on the one that pays `to`, by the id the look found; and the hold's withdrawal. */
const holding: BehaviourModule = {
  name: "test.finance_seat_holding", version: "0.0.1", doc: "orchestrator/test/holds-seat.test.ts", cadence: () => DAY,
  create(ctx) {
    const { script, ...rest } = ctx.params as { script: { to: string; hold_day: number; lift_day: number } };
    const office = engine("city.finance_officer", { config: () => town }).create({ ...ctx, params: rest });
    const done = new Set<string>();
    let found: string | undefined, hold: string | undefined;
    return Object.assign(Object.create(office), {
      step(obs: any, x: any) {
        for (const [name, ch] of Object.entries(obs.channels) as [string, any][]) for (const r of ch.records ?? []) {
          // (Only what the look into the files brings back: it acts on nothing it has not looked up.)
          if (name === "files" && r.record === "statement" && r.kind === "request" && r.speaks_for === obs.entity && r.data?.every && r.data?.outcome?.money?.to === script.to) found = r.id;
          if (r.record === "statement" && r.kind === "hold" && r.speaks_for === obs.entity) hold = r.id;
        }
        // (Asked again until it is answered: a look asked for outside a sitting is not made.)
        if (obs.t >= script.hold_day * DAY && !found) {
          done.add("look");
          return { type: "look" as const, looks: [{ channel: "files", query: { where: [{ field: "kind", op: "=", value: "request" }], limit: 50 } }] };
        }
        if (found && done.has("look") && !done.has("hold")) {
          done.add("hold");
          return { type: "call" as const, call: C.program(C.call("statement", { hold: found })) };
        }
        if (hold && !done.has("lift") && obs.t >= script.lift_day * DAY) {
          done.add("lift");
          return { type: "call" as const, call: C.program(C.call("statement", { withdraw: hold })) };
        }
        return office.step(obs, x);
      },
    });
  },
};

test("a seat looks the standing payment up in its files, holds it by its id and lifts the hold; the bank passes over the pay day under it", async () => {
  const config = generate({ ...spec, citizens: 40, nature: false, model_seats: ["finance"] });
  const order = (config.world.records as any[]).filter((r) => r.kind === "request" && r.speaks_for === "city" && r.data?.every === 14 * DAY && /-wages$/.test(r.id)).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  const F = order.data.first / DAY, to: string = order.data.outcome.money.to;
  const finance = officeAt(config, "finance").holder; // (the person the seat is, in the finance post)
  const financeId: string = finance.id;
  finance.controller.params.cadence_days = 1;
  finance.controller.params.mock = { brain: holding.name, params: { ...finance.controller.params.mock.params, script: { to, hold_day: F + 3, lift_day: F + 16 } } };
  town = config;
  const s = await runWorld({ config, runId: "holds-seat", outDir: mkdtempSync(join(tmpdir(), "oikos-holds-seat-")), until: (F + 45) * DAY, modules: { [holding.name]: holding } });
  expect(s.participantErrors).toBe(0);
  const lines = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const events = lines.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const records = events.filter((e) => e.event === "recorded").map((e) => e.record);
  const day = (t: number) => Math.floor(t / DAY);
  // What the seat said: it looked into its files, then asked for the hold in a request that names the record by id.
  const said = lines.filter((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.subject === financeId).flatMap((e) => ((e.body.data.output ?? []) as any[]).filter((b) => b.type === "tool_use"));
  const look = said.findIndex((u) => u.name === "look" && String(u.input.report).endsWith("files"));
  const ask = said.findIndex((u) => u.name === "do" && String(u.input.what).includes(`hold=${order.id}`));
  expect(look).toBeGreaterThanOrEqual(0);
  expect(ask).toBeGreaterThan(look);
  // The hold: on that record, to the bank, confirmed by the seat.
  const hold = records.find((r) => r.kind === "hold")!;
  expect(hold).toMatchObject({ author: financeId, in_position: "finance", speaks_for: "city", addressed_to: ["bank"], data: { holds: [order.id] } });
  const lifted = records.find((r) => r.record === "withdrawal" && r.withdraws === hold.id)!;
  expect(lifted).toBeDefined();
  // The bank: paid on the first pay day, not on the one under the hold, and again after it was lifted.
  const paid = events.filter((e) => e.event === "transfer" && e.per_instruction === order.id).map((e) => day(e.t));
  expect(paid).toContain(F);
  expect(paid.filter((d) => d > day(hold.at) && d <= day(lifted.at))).toEqual([]);
  expect(day(hold.at)).toBeLessThan(F + 14);
  expect(day(lifted.at)).toBeGreaterThanOrEqual(F + 14);
  expect(paid.some((d) => d > day(lifted.at))).toBe(true);
}, 600_000);
