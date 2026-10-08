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
import { ask, Asked, nextLook, because, Book, DAY, Directions, lotOf, MONTH, say, type Step, usd, withdraw, outOfTime, team } from "./common";
import { Staffing, staffingForm, staffingUnder, stepper } from "./firms";
import * as P from "./papers";

const YEAR = 365 * DAY;

export const environment: BehaviourModule = {
  name: "city.environment",
  issues: [P.JOB_ADVERTISEMENT, ...P.PAYROLL, ...P.ENVIRONMENT],
  issuesWith: (p) => ({ ...P.staffingOwn({ role: p.role ?? "environmental scientist", industry: p.industry, workplace: p.workplace, notice_days: p.notice_days ?? 14 }), planning: p.planning, payroll_office: p.payroll_office || undefined }),
  takes: [staffingForm("environment_staffing", "the environment office", "environmental scientists")],
  version: "0.5.0", // 0.5.0: sends the office that pays the town's staff a payroll notice of each new starter and each leaver (docs/behaviour/firms.md, "Payroll notices"); 0.4.0: takes a written direction on its staffing (docs/behaviour/directions.md); 0.3.0: samples habitat from its own habitat map and asks the land registry which lot a cell is on; no longer shown the district or the register of lots
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
      depot_channel: "depot",
      // The land register's plans, asked which lot a cell of ground is on (none: its habitat register names no lots).
      lots: "",
      // Whose written directions it follows (docs/behaviour/directions.md): the town's own rule, a record the world
      // names (none: it follows nobody's); and how often it follows one it is given.
      directed_under: "", direction_compliance_bps: 10_000,
      payroll_office: "", // the office of the town that pays its staff, which is sent notice of starters and leavers (the world says; none: no notice is sent)
    }, ctx.params);
    need(p, ["depot", "workplace", "planning"], "city.environment");
    const me = ctx.entity;
    const book = new Book();
    const directions = new Directions(ctx, { under: p.directed_under, compliance_bps: p.direction_compliance_bps, office_words: "the environment office" });
    const staffing = new Staffing(ctx, me, { period: p.period, notice_days: p.notice_days, workplace: p.workplace, role: p.role, ...(p.industry ? { industry: p.industry } : {}), does: { hire: true, pay: false }, own: "role", ...(p.payroll_office ? { payroll: p.payroll_office } : {}) });
    // cell -> its cover: by the office's own habitat map (its own paper, made up from where its scientists have been),
    // less what the town has since had notice of being built on.
    const cover = new Map<string, string>();
    const mapped = new Set<string>();
    const asked = new Asked();
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
        for (const r of book.open("habitat_map")) {
          if (mapped.has(r.id) || r.speaks_for !== me) continue;
          mapped.add(r.id);
          // (Area by area, a later area over an earlier one, as a map is drawn; then what was built on when it was made.)
          for (const a of (r.data?.areas ?? []) as { cover: string; x: number; y: number; w: number; h: number }[]) for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) cover.set(`cell.${x}.${y}`, a.cover);
          for (const c of (r.data?.built ?? []) as string[]) cover.set(c, "built");
        }
        for (const n of book.open("building_notice")) if (!mapped.has(n.id) && typeof n.data?.at === "string") { mapped.add(n.id); cover.set(n.data.at, "built"); }
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
        // A staffing direction that stands (from whoever the town says may direct us): whether to recruit, and how many.
        const staffingDir = directions.standing(book, "environment_staffing");
        const directed = staffingUnder(staffingDir);
        const hireTo = Math.min(target, directed.posts ?? Infinity);
        steps.push(...staffing.routine(obs, book, "", { target: hireTo, wage: p.wage, canPost: !!budget && hireTo > workers.length, recruit: directed.recruit,
          ...(staffingDir ? { stopped: `Direction ${staffingDir.id} says not to recruit: taking our advertisements down.` } : {}),
          why: `The adopted budget's ${p.staff_line} line (${usd(line)}) pays for ${target} staff${hireTo < target ? ` (and direction ${staffingDir!.id} says to fill ${hireTo})` : ""}; we have ${workers.length}: posting a job.` }));
        steps.push(...directions.letters(book, (d) => (staffingUnder(d).recruit ? `The office recruits up to ${Math.min(target, staffingUnder(d).posts ?? Infinity)} staff.` : "The office advertises no post, takes down the advertisements it has out and takes nobody on.")));

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
      // Which lot each cell is on where we found a listed species: the land registry's to say, asked about the one
      // cell (once each), before the round's report names the lots.
      () => {
        // (One search of the register is answered to a look: one cell now, and the next as this is asked again.)
        if (!p.lots) return [];
        for (const s of p.species) {
          if (!s.listed) continue;
          for (const [cell, k] of found.get(s.id) ?? []) if (k > 0 && !lotOf(book, cell) && asked.first(`ground:${cell}`)) return [ask.about(p.lots, "data.cells", cell, { most: 1 })];
        }
        return [];
      },
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
