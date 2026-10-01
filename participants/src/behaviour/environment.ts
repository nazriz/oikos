// city.environment: the town's environment office (docs/behaviour/environment.md; docs/design/world-expansion.md 2.2).
// Nobody sees wildlife's numbers for free: the office hires the surveyors the adopted budget's line pays for, and each
// round (a quarter, by default) sends them over a sample of each species' habitat, as many cells as their hours allow.
// A survey is work whose estimate only the office learns (each animal there found with the species' detection chance).
// At a round's end it publishes what it found, as a report put forward to be believed (an assertion: an honest office
// reports what it counted), and a habitat register for planning: the lots where it found a listed species.

import * as C from "../calls";
import { cents } from "../money";
import type { SiteStructure } from "../contracts";
import { channels } from "../contracts";
import { need, params, type BehaviourModule, type ParticipantContext } from "../module";
import { nextLook, because, Book, DAY, lotOf, MONTH, say, type Step, usd, withdraw, outOfTime, team } from "./common";
import { Staffing, stepper } from "./firms";

const YEAR = 365 * DAY;

export const environment: BehaviourModule = {
  name: "city.environment",
  version: "0.2.0",
  doc: "docs/behaviour/environment.md",
  cadence: () => DAY,
  firstWake: (ctx) => 8 * 3600 + ctx.rng("first-wake").below(3600),
  create(ctx: ParticipantContext) {
    const p = params({
      depot: "", workplace: "", // where the office's staff work (the world must say)
      role: "environmental scientist", wage: 0, period: 14 * DAY, notice_days: 14,
      industry: "", // what the work is (its postings say)
      working_day: 8 * 3600, work_days: 5, look_at: 0, look_days: 5, // when its staff are in (a time of day on working days: the world's; 0, whenever it wakes)
      staff_line: "environment", // the adopted budget's line that pays the staff
      survey_task: "survey", survey_labour: 0, // seconds of fieldwork a cell (the world's task)
      // The species it surveys, where each lives (its covers), and whether it's listed as threatened (the world gives).
      species: [] as { id: string; name: string; covers: string[]; listed?: boolean }[],
      survey_every_days: 91, // a round of surveys: a quarter (placeholder)
      sample_cells: 60, // at most this many of a species' habitat cells a round (placeholder; hours permitting)
      planning: "", // whom the habitat register is for (the planning office's entity)
      decline_flag_bps: 2000, // a fall this large since the last round is flagged in the report (placeholder)
      depot_channel: "depot", land_channel: "land",
    }, ctx.params);
    need(p, ["depot", "workplace", "planning"], "city.environment");
    const me = ctx.entity;
    const book = new Book();
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, workplace: p.workplace, role: p.role, ...(p.industry ? { industry: p.industry } : {}), does: { hire: true, pay: false }, own: "role" });
    const cover = new Map<string, string>(); // cell -> its cover, as last seen
    let depotView: SiteStructure | undefined;
    const used = new Map<string, number>(); // staff -> seconds worked today
    let usedDay = -1;
    // The round under way: what's left to survey, and what's been found.
    let round = 0;
    let nextRound = 30 * DAY; // (a month in, to have seen the land and hired)
    let queue: { species: string; cells: string[] }[] = [];
    const found = new Map<string, Map<string, number>>(); // species -> cell -> estimate
    let pending = 0; // surveys sent whose results haven't come
    const last = new Map<string, { cells: number; found: number }>(); // species -> the last round's
    let register: string | undefined; // our standing habitat register
    const recorded = new Set<string>(); // lots where we've ever recorded a listed species (records accumulate, as an atlas's do)
    const annual = Math.floor((p.wage * YEAR) / p.period);
    return stepper(
      (obs) => {
        book.absorb(obs);
        staffing.absorb(obs);
        const land = obs.channels[p.land_channel];
        if (land?.kind === "sites") for (const c of land.cells) cover.set(c.cell, c.structure ? "built" : (c.terrain ?? ""));
        const depot = obs.channels[p.depot_channel];
        if (depot?.kind === "sites") for (const c of depot.cells) if (c.structure?.structure === p.depot) depotView = c.structure;
        // What our surveys found (only we see it).
        for (const o of obs.outcomes) {
          if (!o.surveyed) continue;
          pending = Math.max(0, pending - 1);
          const m = found.get(o.surveyed.of) ?? new Map<string, number>();
          for (const [cell, n] of Object.entries(o.surveyed.cells)) m.set(cell, n);
          found.set(o.surveyed.of, m);
        }
      },
      (obs) => {
        const t = obs.t;
        const steps: Step[] = [];
        // ---- staff: what the adopted budget's line pays for ----
        const year = Math.floor(t / YEAR) + 1;
        const budget = book.open("budget").filter((b) => b.data?.year === year).sort((a, b) => b.at - a.at)[0];
        const line = budget ? cents(budget.data?.lines?.[p.staff_line] ?? 0) : 0;
        const workers = staffing.workers(book, t);
        const room = depotView?.spaces.find((sp) => sp.space === p.workplace);
        const target = budget ? Math.min(room?.capacity ?? Infinity, annual > 0 ? Math.floor(line / annual) : 0) : workers.length;
        if (workers.length > target && t % MONTH < DAY) steps.push(...staffing.letGo(book, t, `The adopted budget's ${p.staff_line} line (${usd(line)}) pays for ${target} staff, and we have ${workers.length}: letting one go.`, "Redundancy: the budget doesn't pay for the position."));
        steps.push(...staffing.routine(obs, book, "", { target, wage: p.wage, canPost: !!budget && target > workers.length,
          why: `The adopted budget's ${p.staff_line} line (${usd(line)}) pays for ${target} staff; we have ${workers.length}: posting a job.` }));

        // ---- a new round: a sample of each species' habitat, as we've seen the land ----
        if (t >= nextRound && queue.length === 0 && pending === 0) {
          if (round > 0) steps.push(...report());
          round += 1;
          nextRound = t + p.survey_every_days * DAY;
          found.clear();
          for (const s of p.species) {
            const habitat = [...cover].filter(([, c]) => s.covers.includes(c)).map(([cell]) => cell).sort();
            const r = ctx.rng(`sample-${s.id}-${round}`);
            const cells: string[] = [];
            while (cells.length < p.sample_cells && habitat.length) cells.push(habitat.splice(r.below(habitat.length), 1)[0]!);
            if (cells.length) queue.push({ species: s.id, cells });
          }
        }

        // ---- a working day's fieldwork: as many cells as the staff's hours allow ----
        const day = Math.floor(t / DAY);
        if (day !== usedDay) {
          usedDay = day;
          used.clear();
        }
        if (queue.length && day % 7 < p.work_days && p.survey_labour > 0) {
          const mine = new Set(workers);
          const here = [...new Set(depotView?.spaces.find((sp) => sp.space === p.workplace)?.occupants ?? [])].filter((w) => mine.has(w)).sort();
          const crew = team(here, (w) => p.working_day - (used.get(w) ?? 0));
          let cellsToday = Math.floor((crew.each * crew.who.length) / p.survey_labour);
          while (cellsToday > 0 && queue.length) {
            const q = queue[0]!;
            const batch = q.cells.splice(0, cellsToday);
            if (!q.cells.length) queue.shift();
            cellsToday -= batch.length;
            const share = Math.ceil((batch.length * p.survey_labour) / crew.who.length);
            for (const w of crew.who) used.set(w, (used.get(w) ?? 0) + share);
            pending += 1;
            const st = because(`Round ${round}'s fieldwork: surveying ${batch.length} cells of habitat for the ${nameOf(q.species)}.`,
              C.call("work", { task: p.survey_task, at: p.depot, by: C.json(crew.who), survey: q.species, cells: C.json(batch) }));
            st.then = (out) => {
              if (out.status === "applied") return;
              pending = Math.max(0, pending - 1);
              // (Not done: back to the queue for another day, the staff's day as the world counts it.)
              queue.push({ species: q.species, cells: batch });
              const short = outOfTime(out);
              if (short?.who) used.set(short.who, p.working_day - short.left);
              else for (const w of crew.who) used.set(w, p.working_day);
            };
            steps.push(st);
          }
        }
        return steps;
      },
      p.look_at ? (obs) => nextLook(obs.t, p.look_at, p.look_days) : undefined,
    );

    function nameOf(species: string): string {
      return p.species.find((s) => s.id === species)?.name ?? species;
    }

    /** The round's report, put forward to be believed, and the habitat register for planning. */
    function report(): Step[] {
      const lines: string[] = [];
      const data: { [species: string]: { cells: number; found: number; per_100_cells: number; change_bps?: number } } = {};
      for (const s of p.species) {
        const m = found.get(s.id);
        if (!m?.size) continue;
        const n = [...m.values()].reduce((a, b) => a + b, 0);
        const per100 = Math.round((n * 100) / m.size);
        const before = last.get(s.id);
        const beforePer100 = before && before.cells ? Math.round((before.found * 100) / before.cells) : undefined;
        const change = beforePer100 !== undefined && beforePer100 > 0 ? Math.round(((per100 - beforePer100) * 10_000) / beforePer100) : undefined;
        data[s.id] = { cells: m.size, found: n, per_100_cells: per100, ...(change !== undefined ? { change_bps: change } : {}) };
        lines.push(`${s.name}${s.listed ? " (listed as threatened)" : ""}: ${n} found in ${m.size} cells surveyed (${per100} per 100 cells)` +
          (change !== undefined ? `, ${change >= 0 ? "up" : "down"} ${Math.abs(change) / 100}% since the last round${change <= -p.decline_flag_bps ? ": a decline to watch" : ""}` : ""));
        last.set(s.id, { cells: m.size, found: n });
        if (s.listed) for (const [cell, k] of m) if (k > 0) { const lot = lotOf(book, cell); if (lot) recorded.add(lot); }
      }
      if (!lines.length) return [];
      const text = `State of the environment, round ${round}: ${lines.join("; ")}.`;
      const steps: Step[] = [because(`Round ${round}'s surveys are done: publishing what we found.`, say("environment_report", text, { visible: "public", data: { round: round, species: data }, assertion: { that: text } }))];
      const lots = [...recorded].sort();
      steps.push(because(`The lots where we've recorded a listed species, this round or before: telling planning (${lots.length} lots).`,
        ...(register ? [withdraw(register, "Superseded by this round's register.")] : []),
        ["register", say("habitat_register", `Habitat register, round ${round}: listed species recorded on ${lots.length} lots${lots.length ? ` (${lots.slice(0, 20).join(", ")}${lots.length > 20 ? ", ..." : ""})` : ""}.`,
          { to: [p.planning], visible: "public", data: { round: round, lots } })]));
      steps.at(-1)!.then = (out) => {
        if (out.created?.register) register = out.created.register;
      };
      return steps;
    }
  },
};
