// The tour: one click plays the run's key moments. For each, the clock goes to the moment, the camera flies to what
// the seat's acts touched, and a caption gives the seat's own words; then on to the next. Built from the story fold
// (`seat`: its sittings and the study reader's lever events) where it is there, else from the map's own acts.
import { useEffect, useMemo, useState } from "react";
import type { CityData } from "./data";
import { fmtDay } from "./Panel";
import { actSentence, CITY_WORDS } from "./words";
import { W } from "../words";
import { plainText } from "../plain";

export interface TourStep {
  t: number;
  kicker: string;
  title: string;
  words?: string;
  note?: string;
  /** Act seqs this moment is about (their arcs light up, the camera frames their targets). */
  acts: number[];
  tone?: "seat" | "flag" | "election";
  /** Show the election overlay for this step. */
  election?: boolean;
}

const short = (s: string | undefined, n: number) => (!s ? undefined : s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** The steps, from the story fold when the server has it, else from the town's acts. */
/** The story fold's JSON for the run (null until read, or when the run has none). Read once per run. */
const seatCache = new Map<string, Promise<any>>();
export function useSeat(base: string | null): any {
  const [seat, setSeat] = useState<any>(null);
  useEffect(() => {
    if (!base) return;
    let live = true;
    let p = seatCache.get(base);
    if (!p) { p = fetch(`${base}/seat`).then((r) => (r.ok ? r.json() : null), () => null); seatCache.set(base, p); }
    p.then((j) => { if (live) setSeat(j); });
    return () => { live = false; };
  }, [base]);
  return seat;
}

export function useTourSteps(base: string | null, city: CityData): TourStep[] {
  const seat = useSeat(base);
  return useMemo(() => buildSteps(city, seat), [city, seat]);
}

export function buildSteps(city: CityData, seat: any): TourStep[] {
  const steps: TourStep[] = [];
  const town = city.town;
  const actSeq = (i: number | undefined) => (i === undefined ? undefined : seat?.acts?.[i]?.seq as number | undefined);
  if (seat?.sittings?.length) {
    const sittings: any[] = seat.sittings;
    const withActs = sittings.filter((s) => s.acts?.length);
    const picked = new Set<number>();
    if (withActs[0]) picked.add(withActs[0].i);
    for (const s of [...withActs].sort((a, b) => b.acts.length - a.acts.length).slice(0, 6)) picked.add(s.i);
    // Lever events: only what was attempted or executed. The reader's "considered" is a phrase match, found unreliable by the blind grading.
    for (const s of sittings) if (s.lever_level === "attempted" || s.lever_level === "executed") picked.add(s.i);
    for (const s of sittings.filter((x) => picked.has(x.i))) {
      steps.push({
        t: s.t, kicker: `${W.Sitting} ${s.i + 1} of ${W.seat}`, title: short(plainText(s.gist ?? "", city.town), 140) ?? "A turn", words: short(s.words, 320),
        note: s.acts?.length ? `${s.acts.length} act${s.acts.length > 1 ? "s" : ""} sent` : undefined,
        acts: (s.acts ?? []).map((i: number) => actSeq(i)).filter((x: number | undefined): x is number => x !== undefined), tone: "seat",
      });
    }
    for (const l of (seat.levers ?? []).filter((x: any) => x.level === "attempted" || x.level === "executed")) {
      steps.push({ t: l.t, kicker: `${W.Lever}, ${(W as any)[l.level] ?? l.level}`, title: l.title ?? l.lever, words: short(l.words, 320), note: "The study reader's flag", acts: [actSeq(l.act)].filter((x): x is number => x !== undefined), tone: "flag" });
    }
  } else {
    // Without the story fold: the seat's busiest days, from the acts the map knows.
    const byDay = new Map<number, typeof town.acts>();
    for (const a of town.acts) { const d = Math.floor(a.t / 86400); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(a); }
    const days = [...byDay.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 7);
    for (const [, acts] of days) {
      const a = acts[0]!;
      steps.push({ t: a.t, kicker: `${acts.length} act${acts.length > 1 ? "s" : ""}`, title: actSentence(town, a), words: short(a.why ?? a.blocks[0]?.text, 320), acts: acts.map((x) => x.seq), tone: "seat" });
    }
  }
  for (const e of town.elections) if (e.result) {
    steps.push({ t: e.result.t + 60, kicker: "The election", title: short(e.result.text, 160) ?? "The result", acts: [], tone: "election", election: true });
  }
  steps.sort((a, b) => a.t - b.t);
  // One step per hour at most.
  return steps.filter((s, i) => i === 0 || s.t - steps[i - 1]!.t > 3600 || s.tone !== steps[i - 1]!.tone);
}

export function Tour({ steps, at, setAt, onExit, hidden }: { steps: TourStep[]; at: number; setAt: (i: number) => void; onExit: () => void; hidden?: boolean }) {
  const [paused, setPaused] = useState(false);
  const step = steps[at];
  useEffect(() => {
    if (paused || !step) return;
    const words = (step.words?.length ?? 0) + step.title.length;
    const id = setTimeout(() => (at + 1 < steps.length ? setAt(at + 1) : onExit()), 5200 + Math.min(9000, words * 28));
    return () => clearTimeout(id);
  }, [at, paused, step]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
      else if (e.key === "ArrowRight") setAt(Math.min(steps.length - 1, at + 1));
      else if (e.key === "ArrowLeft") setAt(Math.max(0, at - 1));
      else if (e.key === " ") { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [at, steps.length]);
  if (!step || hidden) return null;
  const f = fmtDay(step.t);
  return (
    <div className={`lc-tour tone-${step.tone ?? "seat"}`} key={at}>
      <div className="lc-tour-kicker">{step.kicker}, day {f.dayOfYear} at {f.clock}</div>
      <div className="lc-tour-title">{step.title}</div>
      {step.words && <div className="lc-tour-words">“{step.words}”</div>}
      {step.note && <div className="lc-note">{step.note}</div>}
      <div className="lc-tour-bar">
        <div className="lc-tour-dots">{steps.map((s, i) => <button key={i} className={`${i === at ? "on" : ""} tone-${s.tone ?? "seat"}`} onClick={() => setAt(i)} aria-label={`Step ${i + 1}`} />)}</div>
        <div className="lc-tour-ctl">
          <button onClick={() => setAt(Math.max(0, at - 1))} aria-label="Previous">Back</button>
          <button onClick={() => setPaused(!paused)} aria-label={paused ? "Play" : "Pause"}>{paused ? "Play" : "Pause"}</button>
          <button onClick={() => setAt(Math.min(steps.length - 1, at + 1))} aria-label="Next">Next</button>
          <button onClick={onExit} aria-label="End the tour">End</button>
        </div>
      </div>
    </div>
  );
}
