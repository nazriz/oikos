// A standing work order follows the rhythm its office's procedure states (wave 2b's review, fault 4). A rates seat
// asked four times in one sitting for its levy "at each instalment the rating law sets" and never had an order in 30
// days: an order had to give a number of days, the law gives instalments, and the seat rightly declined to invent an
// interval. Here the same requests, as the pilot's translator wrote them, each become the order the seat meant, the
// preview says whose the time is, the clerks follow it, and what cannot be read is answered from the office's own
// procedure. No model is called.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { MockAdapter } from "@oikos/participants/llm";
import { generate } from "@oikos/worlds/generator/generate";
import { createTranslator, Knowledge, Preview, resolve } from "@oikos/translator";
import { runWorld } from "../src/run";
import { scriptedSeats } from "../../scripts/scripted-seats";
import { officeAt, officeBy, officesBy } from "./lib/offices";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const config = generate({ ...spec, model_seats: ["rates", "works", "principal", "water-operations"] });
const paper = (id: string) => config.world.records.find((r: any) => r.id === id);

/** A seat that has its office's procedure on file. */
function seat(office: string): Knowledge {
  const k = new Knowledge(config.world.currencies[0]);
  k.absorb({ participant: `${office}-system`, t: 0, entity: "c0900", positions: [{ position: office, entity: paper(`proc-${office}-routines`).speaks_for }], outcomes: [], inbox: [], drafts: [], channels: { standing: { kind: "records", records: [paper(`proc-${office}-routines`)] } } } as any);
  return k;
}
const made = (office: string, program: string) => {
  const k = seat(office);
  const r = resolve(calls.parseProgram(program), k, () => undefined, office);
  return r.ok ? { block: r.blocks[0] as any, preview: new Preview(k, k.actingFor(office), () => undefined, office).of(r.blocks) } : { asks: r.questions };
};

test("an office's procedure states each routine's rhythm: how often, or the paper that sets when", () => {
  expect(paper("proc-rates-routines").data.routines).toEqual([{ task: "levy", at: "rates", schedule: "law-rates" }]);
  expect(paper("proc-rates-routines").text).toContain('When it is done is set by law-rates: an order for it says "as law-rates sets" in place of how often, or says nothing of how often.');
  expect(paper("proc-rates-routines").text).toContain("the first once the valuer has valued the town's properties and not before the office's first levy day, then one for each instalment the law sets, evenly through the year");
  expect(paper("proc-works-routines").data.routines.map((r: any) => [r.task, r.every])).toEqual([["collect", 7 * DAY], ["maintain", DAY]]);
  expect(paper("proc-works-routines").text).toContain("The office's own rhythm for it is every 7 days: an order that does not say how often follows that.");
  expect(paper("proc-water-operations-routines").data.routines.map((r: any) => [r.task, r.every])).toEqual([["draw_water", DAY], ["bill", 91 * DAY]]);
  // Every routine every module declares has one or the other: none is left for a seat to guess.
  for (const p of config.world.records.filter((r: any) => r.kind === "procedure" && Array.isArray(r.data?.routines))) for (const r of p.data.routines) expect({ p: p.id, task: r.task, stated: r.every !== undefined || r.schedule !== undefined }).toEqual({ p: p.id, task: r.task, stated: true });
});

test("the rates seat's four requests of the pilot, as its translator wrote them: each is the order it meant, or an answer from its own procedure", () => {
  // 1. `every="2 a year"`: told what how often can be for this routine, from the procedure on its file.
  expect(made("rates", 'work(at=rates, every="2 a year", task=levy)')).toEqual({ asks: ['"2 a year" could not be read as how often. By your office\'s procedure (proc-rates-routines) the staff do levy when law-rates sets: say "as law-rates sets", or leave how often out and the order follows it.'] });
  // 3. No how often at all ("at each instalment the rating law sets"): the order follows the law, and says so.
  const none = made("rates", "work(at=rates, task=levy)");
  expect(none.block.data).toEqual({ work: { task: "levy", at: "rates" }, schedule: "law-rates", by_procedure: "proc-rates-routines" });
  expect(none.block.text).toBe("Standing work order: levy at rates, as law-rates sets.");
  expect(none.preview).toContain('You will put a standing work order on your own file: "Standing work order: levy at rates, as law-rates sets.".');
  expect(none.preview).toContain("It gives no rhythm of its own: when levy is done is set by law-rates, as your office's procedure (proc-rates-routines) says: \"At each instalment the rating law sets, the rates clerks send every owner on the rate book a notice of their share");
  expect(none.preview).toContain("the first once the valuer has valued the town's properties and not before the office's first levy day, then one for each instalment the law sets, evenly through the year (two instalments a year are 182 days apart, four are 91).");
  expect(none.preview).not.toContain("an order for it says");
  // The paper named, in the seat's own words for it.
  expect(made("rates", 'work(at=rates, every="as law-rates sets", task=levy)').block.data).toEqual({ work: { task: "levy", at: "rates" }, schedule: "law-rates" });
  // 2 and 4. An interval of its own making ("every 182 days", "every day"): taken as given, and the preview says the
  // staff keep the law's time whatever the order says (what the seat declined both drafts for, not knowing).
  const days = made("rates", 'work(at=rates, every="every 182 days", task=levy)');
  expect(days.block.data).toEqual({ work: { task: "levy", at: "rates" }, every: 182 * DAY });
  expect(days.preview).toContain("By your office's procedure (proc-rates-routines) when levy is done is set by law-rates, whatever an order says of how often: the staff keep to that.");
});

test("each school day and each working day are read; a routine with its own rhythm takes it where the order gives none; what cannot be read says what it can be", () => {
  const school = officeAt(config, "principal-staff").params.building;
  expect(made("principal", `work(at=${school}, every="each school day", task=teach)`).block.data).toEqual({ work: { task: "teach", at: school }, every: DAY });
  expect(made("works", 'work(at=town-hall, every="every working day", task=maintain)').block.data.every).toBe(DAY);
  // The principal's second request of the pilot: "enrol ... for each enrolment received", with no how often.
  const enrol = made("principal", `work(at=${school}, task=enrol)`);
  expect(enrol.block.data).toEqual({ work: { task: "enrol", at: school }, every: DAY, by_procedure: "proc-principal-routines" });
  expect(enrol.preview).toContain("It gives no rhythm of its own: every 1 day is the office's own rhythm for enrol, by its procedure (proc-principal-routines).");
  expect(made("works", 'work(at=town-hall, every="twice a week", task=collect)')).toEqual({ asks: ['"twice a week" could not be read as how often. Say it as a length of time ("every 7 days", "each working day"), or leave it out: by your office\'s procedure (proc-works-routines) the staff do collect every 7 days, and an order that does not say how often follows that.'] });
  // A rhythm given is the rhythm, with nothing said of the procedure.
  const weekly = made("works", 'work(at=town-hall, every="every 14 days", task=collect)');
  expect(weekly.block.data).toEqual({ work: { task: "collect", at: "town-hall" }, every: 14 * DAY });
  expect(weekly.preview).not.toContain("procedure");
  // Work asked for once is as it was.
  expect((made("works", 'work(at=town-hall, units="3", task=collect)').block as any).block).toBe("work");
});

test("a how often that is neither, of a task no procedure speaks of: the seat is told what how often can be, never to write days for a schedule", async () => {
  const io = { adapter: new MockAdapter("mock", { translator: () => [{ type: "tool_use", id: "1", name: "call", input: { program: 'work(at=str.7, every="2 a year", task=sweep)' } }] }), annotate: async () => {}, now: () => 0 };
  const k = new Knowledge(config.world.currencies[0]);
  const r = await createTranslator(io, async () => ({ ok: true }), () => undefined).translate({ draftId: "d1", participant: "x", proposal: "Have the yard swept at str.7, 2 a year.", knowledge: k });
  expect(r.ok).toBe(false);
  expect((r as any).notices).toEqual(['"2 a year", in what you asked, could not be read as how often. How often can be a length of time ("every 7 days", "weekly", "each working day"); or, where a law or a paper on your file sets when the work is done, that paper named by its id ("as" and the id, then "sets"). Please say it again one of those ways.']);
  expect((r as any).notices[0]).not.toContain("number of days, weeks or months");
});

test("a rates seat that asks for its levy with no how often has an order from its first sitting, and its clerks follow it as the law's instalments fall", async () => {
  const seats = scriptedSeats({ rates: [{ day: 0, asks: () => [{ what: "The clerks send the notices at each instalment the rating law sets.", program: "work(at=rates, task=levy)" }] }, ...[4, 8, 11, 14, 20, 26, 33, 40].map((day) => ({ day, asks: () => [] }))] });
  const s = await runWorld({ config: generate({ ...spec, opening_orders: false, model_seats: ["rates"] }), runId: "office-rhythm", outDir: mkdtempSync(join(tmpdir(), "oikos-office-rhythm-")), until: 44 * DAY, adapter: seats.adapter, recordObservations: "none", recordDecisions: "none" });
  expect(s.participantErrors).toBe(0);
  const records = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const order = records.find((r) => r.kind === "work_order")!;
  expect(order).toMatchObject({ in_position: "rates", text: "Standing work order: levy at rates, as law-rates sets.", data: { schedule: "law-rates", by_procedure: "proc-rates-routines" } });
  expect(order.at).toBeLessThan(2 * DAY); // (two days where it was one: the seat is a person of the town now, and its first day is spent on the town's as well: foundations F5)
  // The clerks' report names the order as it stands, and the notices go out on the office's first levy day.
  const reports = records.filter((r) => r.kind === "staff_report" && r.data.office === "rates");
  expect(reports.find((r) => /levy \(rec\./.test(r.text))!.text).toMatch(/levy \(rec\.\d+, as law-rates sets\): in force; nothing fell due; (no property has been valued yet|the next notices go out on year 1, day \d+)/);
  const notices = records.filter((r) => r.kind === "rates_notice" && r.in_position === "rates-staff");
  expect(notices.length).toBeGreaterThan(10);
  expect(Math.min(...notices.map((n) => n.at))).toBeLessThan(32 * DAY);
  expect(reports.some((r) => r.data.orders.some((o: any) => o.task === "levy" && o.state === "followed" && o.times === 1))).toBe(true);
}, 600_000);
