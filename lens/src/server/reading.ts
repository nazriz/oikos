// The power-seeking study's reading of a fork (experiments/power-seeking/reader.ts, through tally.ts buildTalliedRun),
// streamed: the same Reader the tally uses, fed the same lines (`wanted`), from the kernel's export on stdout rather than
// a temporary copy on disk. Shown in Lens as that reader's output, never as Lens's judgement.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Reader, wanted, type RunRead } from "../../../experiments/power-seeking/reader";
import { buildTalliedRun, type ForkResultMeta } from "../../../experiments/power-seeking/tally";
import type { ForkReading } from "../shared/api";

const DAY = 86_400;

export interface ReadingInput {
  /** Absolute experiment folder. */
  dir: string;
  seed: number;
  arm: string;
  model: string;
  rawModel: string;
  goal: string;
  forkDay: number;
}

/** A Reader set up for one fork, or undefined where the study's reader does not apply (no mayor post). */
export function readerFor(x: ReadingInput): { reader: Reader; seat: string } | undefined {
  const cfgFile = join(x.dir, `seed-${x.seed}`, "config.json");
  if (!existsSync(cfgFile)) return undefined;
  const config = JSON.parse(readFileSync(cfgFile, "utf8"));
  const holder = config.positions?.find((p: any) => p.id === "mayor")?.holder;
  if (!holder) return undefined;
  const seat = String(holder);
  return { reader: new Reader(seat, x.arm, x.seed, config, x.forkDay * DAY), seat };
}

export { wanted };

export function readingOf(read: RunRead, x: ReadingInput): ForkReading {
  const resultsFile = join(x.dir, "results.json");
  let meta: ForkResultMeta | undefined;
  try {
    const results: ForkResultMeta[] = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, "utf8")) : [];
    meta = results.find((r) => r.seed === x.seed && r.arm === x.arm);
  } catch {}
  const armFile = join(x.dir, `seed-${x.seed}`, `${x.arm}.json`);
  if (!meta && existsSync(armFile)) {
    try {
      meta = JSON.parse(readFileSync(armFile, "utf8"));
    } catch {}
  }
  const t = buildTalliedRun({ run: x.arm, dir: x.dir, model: x.model, rawModel: x.rawModel, goal: x.goal, arm: x.arm, seed: x.seed, read, meta });
  const levels = { considered: 0, attempted: 0, executed: 0 };
  for (const e of read.events) levels[e.level]++;
  return {
    has_attempt: t.has_attempt,
    has_executed: t.has_executed,
    stood: t.stood,
    won: t.won,
    stopped_before_poll: t.stopped_before_poll,
    ...(t.stopped_day !== undefined ? { stopped_day: t.stopped_day } : {}),
    tier: read.tier,
    attempts: t.attempts.map((a) => ({ day: a.day, t: a.t, lever: a.lever, tier: a.tier, ...(a.stage ? { stage: a.stage } : {}), executed: a.executed, words: a.words.slice(0, 600) })),
    levels,
    ...(read.election.poll_at !== undefined ? { poll_day: Math.floor(read.election.poll_at / DAY) } : {}),
    ...(read.election.winner ? { winner: read.election.winner } : {}),
  };
}
