// An office held by a seat gets its work done (docs/decisions.md, 2026-10-09, "An office held by a seat gets its work
// done"). In the wave's first works pilot a model works manager advertised, took on a crew of five and set two standing
// work orders, and in 180 days nothing was collected: its offers of employment, as the translator wrote them, named the
// pay and the advertisement and no place of work, so nobody ever came to the depot; and nothing it was shown said so.
// Here a seat that follows a script asks for the same things in the same shapes, in a small town whose crew is still
// to be taken on:
//  - offers made on the office's advertisement: the crew comes to work where the advertisement says, the round is
//    collected, and the seat is shown who is in post, when each last worked and how each standing order stands;
//  - offers that cite nothing: the preview says the offer names no place of work, nobody comes, and the crew's report
//    and the seat's roster say that the order is not being carried out, and why.
// No model is called.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { applicantsTo, offeredTo, postingFor, scriptedSeats, type Sitting } from "../../scripts/scripted-seats";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

async function worksSeat(citing: boolean) {
  const config = generate({ ...spec, model_seats: ["works"], works_crew_at_start: 0 });
  const own = config.participants.find((p: any) => p.id === "works-staff-system").controller.params;
  const wage = (own.wage / 100).toFixed(2), period = `${own.period / DAY} days`;
  const works: Sitting[] = [
    { day: 0, asks: () => [
      { what: "Advertise three posts on the works crew.", program: `form(account=acc-city, form=job_advertisement, period="${period}", posts="3", to=works, wage="${wage}")` },
      { what: "The crew collects from every address each week.", program: 'work(at=town-hall, every="once a week", task=collect)' },
      { what: "The crew keeps the town's assets up each day.", program: 'work(at=town-hall, every="every day", task=maintain)' }] },
    // An offer to each of up to three applicants on its own advertisement: the pay, and (or not) the advertisement.
    { day: 2, asks: (seen, me) => {
      const post = postingFor(seen, "works crew", me, "works/works-business");
      const had = offeredTo(me);
      const apps = post ? applicantsTo(seen, post.id).filter((a) => !had.has(a.speaks_for)).slice(0, 3) : [];
      return apps.length ? apps.map((a) => ({ what: `Offer ${a.speaks_for} employment on the works crew.`,
        program: `agreement(${citing ? `basis=${post.id}, ` : ""}template=employment, we_do=money(amount="${wage}", every="${period}", from=acc-city, to=acc-${a.speaks_for}), with=${a.speaks_for})` })) : undefined;
    } },
    ...[6, 9, 12, 15, 18].map((day) => ({ day, asks: () => [] })),
  ];
  const seats = scriptedSeats({ works });
  const s = await runWorld({ config, runId: "office-work", outDir: mkdtempSync(join(tmpdir(), "oikos-office-work-")), until: 20 * DAY, adapter: seats.adapter, recordObservations: "none", recordDecisions: "none" });
  expect(s.participantErrors).toBe(0);
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const events = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const records = events.filter((e) => e.event === "recorded").map((e) => e.record);
  const hired = records.filter((r) => r.record === "agreement" && r.terms.template === "employment" && r.in_position === "works").map((r) => String(r.terms.parties[1]));
  return { seats, events, records, hired, depot: String(own.workplace), shown: seats.shown.map((x) => x.text) };
}

test("a crew taken on by offers of the pay alone, made on the office's advertisement, comes to work and carries out the standing orders; the seat sees who worked and how each order stands", async () => {
  const { seats, events, records, hired, depot, shown } = await worksSeat(true);
  expect(hired.length).toBeGreaterThan(0);
  // The offers were of the pay alone: no place of work in them. Their preview says where the work is, by the advertisement.
  const offers = records.filter((r) => r.record === "agreement" && r.in_position === "works");
  for (const a of offers) expect(a.terms.commitments.map((c: any) => Object.keys(c.does.outcome)[0])).toEqual(["money"]);
  const preview = seats.previews.find((p) => p.text.includes("employment agreement"))!.text;
  expect(preview).toMatch(new RegExp(`It names no place of work: it is made on the job advertisement rec\\.\\d+, so the work is where that advertisement says \\(${depot.replace(/[.\/]/g, "\\$&")}\\)\\.`));
  // The crew comes in, and the round is collected by them.
  const came = new Set(events.filter((e) => e.event === "occupied" && e.space === depot).map((e) => e.occupant));
  expect(hired.filter((w) => came.has(w)).length).toBe(hired.length);
  const collected = events.filter((e) => e.event === "worked" && e.by === "works-staff-system" && e.task === "collect");
  expect(collected.length).toBeGreaterThan(20);
  for (const c of collected) expect(c.performers.every((w: string) => hired.includes(w))).toBe(true);
  expect(records.filter((r) => r.kind === "complaint" && (r.addressed_to ?? []).includes("city"))).toEqual([]);
  // The crew's reports, on the town's own file: the first when the work began, and one a week after.
  const reports = records.filter((r) => r.kind === "staff_report");
  expect(reports.length).toBeGreaterThanOrEqual(2);
  expect(reports.length).toBeLessThanOrEqual(5);
  for (const r of reports) expect(r).toMatchObject({ speaks_for: "city", in_position: "works-staff", addressed_to: ["city"], visible_to: ["city"], data: { office: "works" } });
  expect(reports.some((r) => r.data.orders.some((o: any) => o.task === "collect" && o.state === "followed" && o.times > 0))).toBe(true);
  // What the seat is shown: with nobody in post, that its orders are carried out by nobody; then who is in post and
  // when each last worked, and each order as the crew last reported it; and the report itself, as a paper.
  expect(shown.some((x) => /Your standing work orders:\n- rec\.\d+, collect every 7 days: carried out by nobody: there is nobody in post\./.test(x))).toBe(true);
  const last = shown.filter((x) => x.includes("Staff of your office")).at(-1)!;
  expect(last).toMatch(/In post \(\d\): c\d+, since year 1, day \d+, under rec\.\d+, last at work year 1, day \d+ \((collect|maintain)\)/);
  expect(last).toMatch(/Your standing work orders, as your staff reported on year 1, day \d+ \(rec\.\d+\):\n- rec\.\d+, collect every 7 days: carried out: \d+ calls at addresses, \d+ loads/);
  expect(shown.some((x) => x.includes("Reports from the staff on the work under the standing work orders") && x.includes("Report of the works crew, year 1, day"))).toBe(true);
}, 600_000);

test("offers that cite no advertisement: the preview says there is no place of work, nobody comes, and the crew's report and the seat's roster say the order is not carried out and why", async () => {
  const { seats, events, records, hired, depot, shown } = await worksSeat(false);
  expect(hired.length).toBeGreaterThan(0);
  expect(seats.previews.find((p) => p.text.includes("employment agreement"))!.text).toContain("It names no place of work and cites no job advertisement that does: whoever signs it is paid and has nowhere to come to work.");
  expect(events.filter((e) => e.event === "occupied" && e.space === depot && hired.includes(e.occupant))).toEqual([]);
  expect(events.filter((e) => e.event === "worked" && e.by === "works-staff-system")).toEqual([]);
  const reports = records.filter((r) => r.kind === "staff_report");
  expect(reports.length).toBeGreaterThanOrEqual(1);
  const collect = reports[0]!.data.orders.find((o: any) => o.task === "collect");
  expect(collect).toMatchObject({ state: "not_carried_out" });
  expect(collect.why).toMatch(new RegExp(`^none of the \\d in post was at the depot \\(${depot.replace(/[.\/]/g, "\\$&")}\\) when the day's work was set out$`));
  expect(reports[0]!.data.staff.every((x: any) => x.no_place === true && x.last === undefined)).toBe(true);
  // At the seat's next sitting: each in post has not come in, and why; each order is not carried out, and why.
  const last = shown.filter((x) => x.includes("Staff of your office")).at(-1)!;
  expect(last).toMatch(/under rec\.\d+, has not come in to work: no place of work in the employment agreement or in an advertisement it cites/);
  expect(last).toMatch(/- rec\.\d+, collect every 7 days: not carried out: none of the \d in post was at the depot/);
}, 600_000);
