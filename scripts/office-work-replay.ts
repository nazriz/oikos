// What real seats did in the wave's first pilots, replayed through mock seats (no model is called): the same forms,
// the same wording of each request and of the call the translator wrote for it, on the same days, taken from the
// pilots' logs. It shows whether an office held by a seat gets its work done (docs/decisions.md, 2026-10-09, "An
// office held by a seat gets its work done").
//
//   bun scripts/office-work-replay.ts works --out DIR [--days 180]
//
// - works: the works manager of the first works pilot, in the town of that pilot (the same description, seed and
//   profile), whose crew is still to be taken on. Day 1: an advertisement for six on the office's form, and two
//   standing work orders (the second asked twice, as it was). Days 4 and 5: an offer of employment to each of five
//   applicants, in the words the translator wrote (the pay, and the advertisement cited; nothing of a place of work).
//   Day 8: a payroll notice for each. The environment officer advertises and takes on one, as it did.
// It prints the work done and the complaints by week, and what the seat was shown of its staff and its orders.
// DIR must not exist and must not be under runs/; remove it when read.

import { existsSync } from "node:fs";
import { join, resolve as path } from "node:path";
import { loadWorld } from "../orchestrator/src/batch";
import { logLines } from "../orchestrator/src/logs";
import { runWorld } from "../orchestrator/src/run";
import { applicantsTo, offeredTo, postingFor, scriptedSeats, type Sitting } from "./scripted-seats";

const DAY = 86_400;
const root = join(import.meta.dir, "..");

// ---- the plays: what each seat asked for, in its words, with the call the translator wrote (from the pilots' logs)
export const PLAYS: { [name: string]: { world: string; sets: string[]; days: number; seats: { [office: string]: Sitting[] } } } = {
  works: {
    world: "worlds/town-1000.yaml", sets: ["seed=110", "profile=gb-eng-2026", "model_seats=works,registry,environment", "works_crew_at_start=0"], days: 180,
    seats: {
      works: [
        { day: 0, asks: () => [
          { what: "Fill in the job advertisement form (form-works-job-advertisement) for 6 works crew posts, at a wage of £8,643.66 for each pay period of 73 days (five pay periods across the 365-day year, £43,218.30 a year each, within the staff line of budget-year-1), paid from account acc-city.",
            program: 'form(account=acc-city, form=job_advertisement, period="73 days", posts="6", to=works, wage="£8,643.66")' },
          { what: "Make a standing work order for the task collect at town-hall: the crew collects waste from each address on the round (round-house-1 onward) once a week, homes complained about first, and takes the load to the landfill each week with a docket. In force from now, no end date.",
            program: 'work(at=town-hall, every="once a week", task=collect)' },
          { what: "Make a standing work order for the task maintain at town-hall: with the hours the round leaves, the crew keeps up the most worn of the town's own assets, and someone is sent to inspect an asset nobody has seen. In force from now, no end date.",
            program: "work(at=town-hall, task=maintain)" },
          { what: "Make a standing work order for the task maintain at town-hall, every day: with the hours the round leaves, the crew keeps up the most worn of the town's own assets, and someone is sent to inspect an asset nobody has seen. In force from now, no end date.",
            program: 'work(at=town-hall, every="every day", task=maintain)' },
        ] },
        // Day 4 (three applicants on its own posting) and day 5 (two more): an offer to each, the pay and the posting.
        { day: 3, asks: (seen, me) => {
          const post = postingFor(seen, "works crew", me, "works/works-business");
          const apps = post ? applicantsTo(seen, post.id).slice(0, 3) : [];
          return apps.length ? apps.map((a, i) => ({
            what: `Offer employment as works crew to ${a.speaks_for} (account acc-${a.speaks_for}) on my posting ${post.id}, £8,643.66 every 73 days, paid from acc-city.`,
            program: `agreement(basis=${post.id}, template=employment, ${i === 1 ? 'terms="works crew", ' : ""}we_do=money(amount="£8,643.66", every="every 73 days", from=acc-city, to=acc-${a.speaks_for}), with=${a.speaks_for})` })) : undefined;
        } },
        { day: 4, asks: (seen, me) => {
          const post = postingFor(seen, "works crew", me, "works/works-business");
          const had = offeredTo(me);
          const apps = post ? applicantsTo(seen, post.id).filter((a) => !had.has(a.speaks_for)).slice(0, Math.max(0, 5 - had.size)) : [];
          return had.size + apps.length >= 5 || apps.length ? apps.map((a) => ({
            what: `Offer ${a.speaks_for} an employment agreement: pay £8,643.66 from acc-city to acc-${a.speaks_for} every 73 days, terms works crew, citing ${post.id} (application ${a.id}), signed on my side.`,
            program: `agreement(basis=["${post.id}","${a.id}"], template=employment, terms="works crew", we_do=money(amount="£8,643.66", every="every 73 days", from=acc-city, to=acc-${a.speaks_for}), with=${a.speaks_for})` })) : undefined;
        } },
        { day: 7, asks: (seen, me) => [...seen.values()].filter((r) => r.record === "agreement" && r.terms?.template === "employment" && offeredTo(me).has(String(r.terms.parties[1]))).sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => {
          const who = String(r.terms.parties[1]);
          return { what: `Fill in payroll starter notice (form-works-payroll-starter) for ${who}: agreement ${r.id}, account acc-${who}, post works crew, wage £8,643.66 per 73 days, period 73 days, first pay year 1, day 78.`,
            program: `form(account=acc-${who}, agreement=${r.id}, employee=${who}, first_pay="year 1, day 78", form=payroll_starter, period="73 days", post="works crew", to=works, wage="£8,643.66")` };
        }) },
      ],
      environment: [
        { day: 0, asks: () => [{ what: "Fill in the job advertisement form (form-environment-job-advertisement) for 1 post of environmental scientist, wage £43,218.34 for each pay period, pay period 365 days (a year), which is what the environment line of budget-year-1 pays for.",
          program: 'form(form=job_advertisement, period="365 days", posts="1", to=environment, wage="£43,218.34")' }] },
        { day: 1, asks: (seen, me) => {
          const post = postingFor(seen, "environmental scientist", me, "environment/environment-business");
          const a = post ? applicantsTo(seen, post.id)[0] : undefined;
          return a ? [{ what: `Offer employment as environmental scientist to ${a.speaks_for} (account acc-${a.speaks_for}), on their application ${a.id} for posting ${post.id}, at £43,218.34 per 365 days.`,
            program: `agreement(basis=["${a.id}","${post.id}"], template=employment, we_do=money(amount="£43,218.34", every="365 days", to=acc-${a.speaks_for}), with=${a.speaks_for})` }] : undefined;
        } },
      ],
    },
  },
};

// The first utilities pilot: its town (seed, profile and the scenario that makes the grid dear), each seat's standing
// work orders as it made them on day 1, and the energy seat's order to the grid on day 15, in its words. `energy`: the
// call a translator writes for those words now that the office has an order form; `energy-as-drafted`: the call the
// pilot's translator wrote, a payment alone, which the market sent back.
const UTILITIES = { world: "worlds/town-1000.yaml", sets: ["seed=144", "profile=au-vic-2026", "model_seats=water-operations,energy-operations,rates", "scenario=energy-price-shock"], days: 45 };
const ASKED = "Order 60000 energy from outside at $0.36 each (total $21600), paying with the order from acc-energy-co to acc-outside, per price list rec.4, delivered to the substation.";
const utilities = (order: string): { [office: string]: Sitting[] } => ({
  "energy-operations": [
    { day: 0, asks: () => [
      { what: "Make a standing work order for the office staff: task supply_energy, at substation, every day, from now, until withdrawn.", program: 'work(at=substation, every="every day", task=supply_energy)' },
      { what: "Make a standing work order for the office staff: task bill, at substation, every 30 days, from now, until withdrawn.", program: 'work(at=substation, every="every 30 days", task=bill)' }] },
    { day: 14, asks: () => [{ what: ASKED, program: order }] },
    ...[15, 21, 28, 35, 42].map((day) => ({ day, asks: () => [] })),
  ],
  "water-operations": [
    { day: 0, asks: () => [
      { what: "Make a standing work order for the office staff: task draw_water, at water-works (lot-19-28), every 1 day, starting today, on the published population estimate rec.5 (1001 residents), with no end date.", program: 'work(at=lot-19-28, every="every 1 day", on=rec.5, task=draw_water)' },
      { what: "Make a standing work order for the office staff: task bill, at water-works (lot-19-28), every 30 days, starting today, with a meter reading round before each round of bills, with no end date.", program: 'work(at=lot-19-28, every="every 30 days", task=bill)' }] },
    ...[8, 29, 32, 35, 42].map((day) => ({ day, asks: () => [] })),
  ],
  rates: [
    { day: 0, asks: () => [{ what: "Make a standing work order for the rates clerks: task levy, at rates, every 91 days, in force now with no end. The notices go out as the rating law (law-rates) sets.", program: 'work(at=rates, every="every 91 days", task=levy)' }] },
    ...[7, 14, 21, 28, 35, 42].map((day) => ({ day, asks: () => [] })),
  ],
});
PLAYS.energy = { ...UTILITIES, seats: utilities('form(account=acc-energy-co, at=substation, deliver_to=energy-co, form=order, kind="energy", quantity="60000", seller=outside, to=energy-operations, unit_price="$0.36")\nmoney(amount="$21600", basis=rec.4, for="Order: 60000 energy.", from=acc-energy-co, to=acc-outside)') };
PLAYS["energy-as-drafted"] = { ...UTILITIES, seats: utilities('money(amount="$21600", basis=rec.4, for="60000 energy", from=acc-energy-co, to=acc-outside)') };

if (import.meta.main) {
  const play = process.argv[2] ?? "";
  const arg = (name: string, d?: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : d; };
  const out = arg("out");
  if (!out || existsSync(out) || /(^|\/)runs(\/|$)/.test(path(out))) throw new Error("--out DIR: a folder that does not exist yet, outside runs/");
  const P = PLAYS[play];
  if (!P) throw new Error(`which play? one of: ${Object.keys(PLAYS).join(", ")}`);
  const days = Number(arg("days", String(P.days)));
  const seats = scriptedSeats(P.seats);
  const { config } = await loadWorld(join(root, P.world), P.sets);
  config.log = { ...config.log, detail: "lean" };
  const s = await runWorld({ config, runId: `replay-${play}`, outDir: out, until: days * DAY, adapter: seats.adapter, recordObservations: "none", recordDecisions: "none" });

  // ---- what came of it
  const offices = Object.keys(P.seats);
  const ours = (participant: string) => offices.some((o) => participant === `${o}-system` || participant === `${o}-staff-system`);
  const weeks = Math.ceil(days / 7);
  const byWeek = () => Array.from({ length: weeks }, () => 0);
  const worked: { [k: string]: number[] } = {};
  const complaints = byWeek(), came = byWeek();
  const lastOf = new Map<string, string>();
  const orders: string[] = [], reports: string[] = [], refused: string[] = [], notDrafted: string[] = [], bought: string[] = [];
  const entities = new Set<string>(offices.map((o) => config.participants.find((p: any) => p.id === `${o}-staff-system`)?.owner ?? (config.world.positions ?? []).find((p: any) => p.id === o)?.entity).filter(Boolean));
  const bills: { [who: string]: number[] } = {};
  const depot = config.participants.find((p: any) => p.id === "works-staff-system")?.controller?.params?.workplace as string | undefined;
  for await (const line of logLines(s.logPath)) {
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    const b = e.body, w = Math.min(weeks - 1, Math.floor(e.t / (7 * DAY)));
    if (e.kind === "event" && b.event === "worked" && ours(b.by)) (worked[`${b.by.replace(/-system$/, "")} ${b.task}`] ??= byWeek())[w]!++;
    else if (e.kind === "event" && b.event === "occupied" && depot && b.space === depot) came[w]!++;
    else if (e.kind === "event" && b.event === "action_refused" && ours(b.participant)) refused.push(`day ${Math.floor(e.t / DAY) + 1} ${b.participant}: ${b.code} ${b.detail}`);
    else if (e.kind === "event" && b.event === "goods_moved" && b.from === "outside" && entities.has(b.to)) bought.push(`day ${Math.floor(e.t / DAY) + 1}: ${b.quantity} ${b.kind} delivered to ${b.to} at ${b.to_at}`);
    else if (e.kind === "event" && b.event === "transfer" && [b.from, b.to].includes("acc-outside") && [b.from, b.to].includes("acc-energy-co")) bought.push(`day ${Math.floor(e.t / DAY) + 1}: ${b.amount} (in the smallest unit of money) from ${b.from} to ${b.to}`);
    else if (e.kind === "event" && b.event === "recorded") {
      const r = b.record;
      if (r.kind === "complaint" && (r.addressed_to ?? []).includes("city")) complaints[w]!++;
      if (r.kind === "invoice" && /-staff$/.test(String(r.in_position)) && offices.includes(String(r.in_position).replace(/-staff$/, ""))) (bills[r.in_position] ??= byWeek())[w]!++;
      if (r.kind === "work_order") orders.push(`day ${Math.floor(r.at / DAY) + 1} ${r.id} (${r.in_position}): "${r.text}"`);
      if (r.kind === "staff_report" && offices.includes(String(r.data?.office))) { reports.push(`day ${Math.floor(r.at / DAY) + 1} ${r.id}: ${r.text}`); lastOf.set(String(r.data.office), reports.at(-1)!); }
    } else if (e.kind === "annotation" && b.annotation === "translation_failure" && ours(b.subject)) notDrafted.push(`day ${Math.floor(e.t / DAY) + 1} ${b.subject}: ${b.data?.call} -> ${b.data?.reason}`);
  }
  const row = (xs: number[]) => xs.map((x, i) => `w${i + 1}:${x}`).join(" ");
  console.log(`Replay "${play}": ${config.meta?.description ?? ""} ${days} days; final state ${s.stateHash.slice(0, 16)}; participant errors ${s.participantErrors}.`);
  for (const office of offices) console.log(`\nAsked for by the ${office} seat (${seats.made(office).length}):\n${seats.made(office).map((a) => `  ${a.program}`).join("\n")}`);
  console.log(`\nStanding work orders:\n${orders.map((x) => `  ${x}`).join("\n") || "  none"}`);
  console.log(`\nNot drafted (asked back or refused):\n${notDrafted.map((x) => `  ${x}`).join("\n") || "  none"}`);
  console.log(`\nWork done by week (acts):`);
  for (const [k, v] of Object.entries(worked).sort()) console.log(`  ${k.padEnd(34)} total ${v.reduce((a, x) => a + x, 0)}: ${row(v)}`);
  if (!Object.keys(worked).length) console.log("  none");
  if (depot) console.log(`\nArrivals at the depot (${depot}) by week: total ${came.reduce((a, x) => a + x, 0)}: ${row(came)}`);
  if (depot) console.log(`\nComplaints to the town by week: total ${complaints.reduce((a, x) => a + x, 0)}: ${row(complaints)}`);
  for (const [k, v] of Object.entries(bills).sort()) console.log(`\nBills sent by ${k}, by week: total ${v.reduce((a, x) => a + x, 0)}: ${row(v)}`);
  if (bought.length) console.log(`\nBetween the office and the outside world (${bought.length}):\n${bought.map((x) => `  ${x}`).join("\n")}`);
  if (refused.length) console.log(`\nActs refused (${refused.length}); the first few:\n${refused.slice(0, 6).map((x) => `  ${x}`).join("\n")}`);
  console.log(`\nThe staff's reports to their office (${reports.length}); the first four and the last:\n${[...reports.slice(0, 4), ...(reports.length > 5 ? ["  ..."] : []), ...reports.slice(4).slice(-1)].map((x) => `  ${x}`).join("\n") || "  none"}`);
  for (const o of offices) { const last = reports.filter((x) => x.includes(`Report of`) && lastOf.get(o) === x).at(-1); if (last && offices.length > 2) console.log(`\nThe last report of the ${o} office's staff:\n  ${last}`); }
  const offers = seats.previews.filter((p) => /employment agreement/.test(p.text));
  if (offers.length) console.log(`\nThe preview of the first offer of employment (day ${offers[0]!.day + 1}):\n  ${offers[0]!.text}`);
  for (const seat of offices) {
    const mine = seats.shown.filter((x) => x.seat === seat && x.text.includes("Staff of your office"));
    if (!mine.length) continue;
    console.log(`\nWhat the ${seat} seat was shown of its staff (at ${mine.length} of ${seats.shown.filter((x) => x.seat === seat).length} sittings); the first, and the last two:`);
    for (const x of [...mine.slice(0, 1), ...mine.slice(1).slice(-2)]) console.log(`--- day ${x.day + 1}\n${x.text.slice(x.text.indexOf("## ", x.text.indexOf("Staff of your office") - 80))}`);
  }
}
