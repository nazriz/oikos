// The one way a module makes a decision wrong by chance (docs/design/foundations.md, law 5; docs/decisions.md, foundations F7).
//
// An error comes from a procedure that differs from the law, from data that is stale or missing, from too little time, or
// from a slip: a performer doing the work right most of the time and wrong at a sourced rate. Only the last is chance, and
// this is the only place a module draws it. The rate is a row of the world's table of slips (`orchestration.slip`, beside the
// table of work: the same keys, a task named as the work table names what an act makes, `publish/benefit_decision`), for the
// kind of performer that does the work (a person, or a system delivered from a template); a task with no row has no slip
// (0 where nothing is sourced), and a system's row is its own, not a person's. Each row says where its rate comes from
// (`sources`). The draw is from a stream named for who, what and the case, as docs/reliability.md ("Draws and the moment")
// has it, so a town and its twin slip on the same cases.
//
// Haste is not a multiplier: an office behind decides late (the hours of whoever decides), never wrongly more often.

import type { Rng } from "./rng";

/** A row of the table of slips. */
export interface SlipRow {
  /** Basis points: of the acts of this kind that come to the performer (`per: "act"`), or of the exposed in a year (`per: "year"`). */
  bps: number;
  per?: "act" | "year";
  /** Whether the world's friction dial scales it (`dials.friction_bps`; 0 or absent: none arises). A row that is a rule of
   * the performer's judgement and not a misfortune of the town is not scaled. */
  friction?: boolean;
}
export interface SlipTable {
  person?: { [task: string]: SlipRow };
  system?: { [task: string]: SlipRow };
  sources?: { [what: string]: string };
}

/** What `slip` needs of a participant's context. */
export interface Slipper {
  rng(purpose: string): Rng;
  /** Absent: a person (a context made by hand). */
  kind?: "person" | "system";
  world: { dials?: { [name: string]: unknown }; slip?: SlipTable };
}

const frictionBps = (world: Slipper["world"]): number => Math.max(0, Math.floor(Number(world.dials?.friction_bps ?? 0)) || 0);

/** The row for a task, for the kind of performer the context is. */
export function slipRow(ctx: Slipper, task: string): SlipRow | undefined {
  return ctx.world.slip?.[ctx.kind ?? "person"]?.[task];
}

export interface SlipOptions {
  /** For a row `per: "year"`: the days of exposure this draw covers. */
  days?: number;
  /** The performer's own lean on the row's rate, as basis points per year or per act in, basis points out (a character that
   * would pay less, an employer short of cash): never a haste. */
  lean?: (bps: number) => number;
}

/** The chance, in parts per million, of a slip at a task. */
export function slipPpm(ctx: Slipper, task: string, o: SlipOptions = {}): number {
  const row = slipRow(ctx, task);
  if (!row || !(row.bps > 0)) return 0;
  const dial = row.friction ? frictionBps(ctx.world) : 10_000;
  if (dial <= 0) return 0;
  const bps = o.lean ? o.lean(row.bps) : row.bps;
  if (!(bps > 0)) return 0;
  if (row.per === "year") {
    const days = o.days ?? 0;
    if (!(days > 0)) return 0;
    return Math.min(1_000_000, Math.floor((bps * dial * days) / (100 * 365)));
  }
  return Math.min(1_000_000, Math.floor((Math.min(10_000, bps) * dial) / 100));
}

/** Does the performer slip at this task, on this case? `caseKey` names the case (never a paper's number: what it is, and
 * which time it was for the pair). */
export function slip(ctx: Slipper, task: string, caseKey: string, o: SlipOptions = {}): boolean {
  const ppm = slipPpm(ctx, task, o);
  return ppm > 0 && ctx.rng(`slip-${task}-${caseKey}`).below(1_000_000) < ppm;
}
