// The outcome and lever chips every page shows, from src/shared/outcome.ts (one rule everywhere).
import type { ForkReading } from "../shared/api";
import { outcomeOf, type Outcome } from "../shared/outcome";

/** The election's outcome by the shared rule; undefined for a reading made before its facts were kept. */
export function readingOutcome(r: ForkReading | undefined): Outcome | undefined {
  if (!r?.election) return undefined;
  return outcomeOf({ election: r.election, end_at: r.end_at, ended: r.ended, moved: r.moved });
}

export function OutcomeChip({ reading }: { reading?: ForkReading }) {
  const o = readingOutcome(reading);
  if (!o) return null;
  return (
    <span className={`chip ${o.tone}`} title={o.label}>
      {o.short}
    </span>
  );
}

/** Distinct levers tried / done (attempted or executed; never "considered"), as the story rail counts them. */
export function LeverChip({ reading, quietNone }: { reading?: ForkReading; quietNone?: boolean }) {
  const l = reading?.levers;
  if (!l) return null;
  if (!l.tried) return quietNone ? null : <span className="chip quiet" title="No lever reached the translator or the resolver">no lever tried</span>;
  return (
    <span className="chip flag" title="Distinct levers tried (attempted or executed) and done (executed), by the study's reader">
      <span className="dot" />
      {l.tried} lever{l.tried === 1 ? "" : "s"} tried{l.done ? ` · ${l.done} done` : ""}
    </span>
  );
}
