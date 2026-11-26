// The power-seeking study's reading of a fork (experiments/power-seeking/reader.ts, through tally.ts buildTalliedRun),
// streamed: the same Reader the tally uses, fed the same lines (`wanted`), from the kernel's export on stdout rather than
// a temporary copy on disk. Shown in Lens as that reader's output, never as Lens's judgement.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Reader, wanted, ownWords, type RunRead } from "../../../experiments/power-seeking/reader";
import { buildTalliedRun, type ForkResultMeta } from "../../../experiments/power-seeking/tally";
import type { ForkReading } from "../shared/api";
import { endedOf, leverCounts } from "../shared/outcome";

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
  untilDay?: number;
}

/** How the log ended, for the reading (the last line's time, and the end line's reason if there is one). */
export interface LogEnd { at: number; reason?: string }

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

/** The mayor's words about the election, from its transcripts as the reading passes them: the first sentence that
 * mentions the election, else its first sentence at all. */
export class VoiceTracker {
  private hit?: { text: string; day: number };
  private first?: { text: string; day: number };
  constructor(private readonly seat: string) {}
  see(l: any): void {
    if (this.hit || l?.kind !== "annotation") return;
    const b = l.body;
    if (b?.annotation !== "transcript" || b.subject !== this.seat || b.data?.purpose !== "participant") return;
    for (const w of ownWords(b.data.output)) {
      const s = sentence(w);
      if (s.length < 12) continue;
      const v = { text: s, day: Math.floor(Number(l.t ?? 0) / 86_400) };
      this.first ??= v;
      if (/\belect|\bpoll\b|\bvote|campaign|re-?election/i.test(s)) { this.hit = v; return; }
    }
  }
  get voice(): { text: string; day: number } | undefined { return this.hit ?? this.first; }
}
function sentence(x: string): string {
  const t = x.replace(/\s+/g, " ").trim();
  const m = /^(.{20,}?[.!?])(\s|$)/.exec(t);
  const s = m ? m[1]! : t;
  return s.length > 240 ? s.slice(0, 239) + "…" : s;
}

export function readingOf(read: RunRead, x: ReadingInput, end: LogEnd, voice?: { text: string; day: number }): ForkReading {
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
    election: {
      stood: Boolean(read.election.stood),
      ...(read.election.seat_won !== undefined ? { seat_won: read.election.seat_won } : {}),
      ...(read.election.notice_at !== undefined ? { notice_at: read.election.notice_at } : {}),
      ...(read.election.poll_at !== undefined ? { poll_at: read.election.poll_at } : {}),
      ...(read.election.result_at !== undefined ? { result_at: read.election.result_at } : {}),
    },
    moved: read.amendments.some((a) => a.outcome === "applied"),
    end_at: end.at,
    ended: endedOf(end.reason, end.at, x.untilDay !== undefined ? x.untilDay * DAY : undefined),
    levers: leverCounts(read.events),
    ...(voice ? { voice } : {}),
  };
}
