// Where am I, and how do I get back: the trail of what is open in a run (a moment, then a thing it led to), the
// browser's Back and Forward over selections, Escape stepping out one level, and the last run and moment kept for
// "Carry on" in the library (docs/design/lens.md section 9).
//
// History: every meaningful selection is an entry (pushState); scrubbing time only rewrites the current entry
// (RunPage's replaceQuery). The trail rides in history.state, so Back restores "turn 3, then Ada" as it was.
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import type { RunEntry } from "../../shared/api";
import type { SeatJson } from "../../folds/seat";
import { useFold } from "../api";
import { structureName, useCity } from "../city/CityView";
import { dayNo, dayOf } from "../format";
import { parseHash, parseSel, selToken } from "../router";
import { useLens, type Selection } from "../state";
import { leverTitle, modelName } from "../words";
import { isSeatPerson } from "../people";
import { runName } from "../run-names";

export type Sel = NonNullable<Selection>;
const MOMENT = new Set(["sitting", "lever", "act"]);
export const isMoment = (s: Selection): boolean => !!s && MOMENT.has(s.kind);
export const sameSel = (a: Selection, b: Selection) => selToken(a) === selToken(b);

export interface NavState {
  /** What is open, outermost first: [] (the run), [moment], [thing], or [moment, thing]. */
  trail: Sel[];
  /** The keyboard sheet. */
  keys: boolean;
  setKeys(open: boolean): void;
}
export const useNav = create<NavState>((set) => ({
  trail: [],
  keys: false,
  setKeys: (keys) => set({ keys }),
}));

/** The trail after selecting `next`: a moment starts afresh; a thing hangs below the moment it was opened from; selecting
 * something already on the trail steps back to it. */
export function nextTrail(trail: Sel[], next: Selection): Sel[] {
  if (!next) return [];
  const at = trail.findIndex((x) => sameSel(x, next));
  if (at >= 0) return trail.slice(0, at + 1);
  if (isMoment(next)) return [next];
  const moment = trail.find((x) => isMoment(x));
  return moment ? [moment, next] : [next];
}

/** Escape: one level out (a thing opened from a turn goes back to the turn; a turn closes). False when nothing is open. */
export function stepOut(): boolean {
  const { trail } = useNav.getState();
  const s = useLens.getState();
  if (!s.selection) return false;
  const up = trail.length >= 2 ? trail[trail.length - 2]! : null;
  s.select(up);
  if (up && isMoment(up)) jumpTo(up);
  return true;
}

/** Bring the playhead to a moment's time (a turn, a power grab, an act), from the seat fold if it is loaded. */
let seatOf: { run: string; seat: SeatJson } | null = null;
export function momentT(sel: Selection): number | undefined {
  const seat = seatOf && seatOf.run === useLens.getState().run ? seatOf.seat : null;
  if (!seat || !sel) return undefined;
  if (sel.kind === "sitting") return seat.sittings.find((x) => x.i === sel.index)?.t;
  if (sel.kind === "lever") return seat.levers[sel.index]?.t;
  if (sel.kind === "act") return seat.acts.find((a) => a.seq === sel.seq)?.t;
  return undefined;
}
export function jumpTo(sel: Selection) {
  const t = momentT(sel);
  if (t !== undefined) useLens.getState().setT(t);
}
/** Select something and, for a moment, move time to it: what "Go there" and the keys do. */
export function goTo(sel: Selection) {
  useLens.getState().select(sel);
  jumpTo(sel);
}

/** The seat fold, kept where the keys and the hover cards can reach it without a hook. */
export function useSeat(run: string | null): SeatJson | undefined {
  const seat = useFold<SeatJson>("seat", run).data;
  if (run && seat) seatOf = { run, seat };
  return seat;
}

const urlWith = (t: number, sel: Selection) => {
  const r = parseHash(window.location.hash);
  r.q.set("t", String(Math.round(t)));
  const tok = selToken(sel);
  tok ? r.q.set("sel", tok) : r.q.delete("sel");
  const base = window.location.hash.replace(/^#/, "").split("?")[0] || "/";
  return `#${base}?${r.q.toString()}`;
};

/** Mount once in the open run, after it has taken its moment and selection from the URL. */
export function useRunHistory(runKey: string, entry?: RunEntry) {
  useEffect(() => {
    // The trail this entry was left with (Back), else what the URL's selection alone makes.
    const st = history.state as { trail?: string[] } | null;
    const fromState = st?.trail?.map((x) => parseSel(x)).filter(Boolean) as Sel[] | undefined;
    const sel0 = useLens.getState().selection;
    useNav.setState({ trail: fromState?.length && sameSel(fromState.at(-1)!, sel0) ? fromState : nextTrail([], sel0) });

    let restoring = false;
    let pending: { t: number; sel: Selection; trail: Sel[] } | null = null;
    const unsub = useLens.subscribe((s, prev) => {
      if (s.run !== runKey || prev.run !== runKey) return;
      if (s.selection === prev.selection || sameSel(s.selection, prev.selection)) return;
      const before = useNav.getState().trail;
      const trail = nextTrail(before, s.selection);
      useNav.setState({ trail });
      if (restoring) return;
      // (Several selects in one handler make one entry: the first's "before", the last's "after".)
      if (!pending) {
        pending = { t: prev.t, sel: prev.selection, trail: before };
        queueMicrotask(() => {
          const p = pending!;
          pending = null;
          const now = useLens.getState();
          if (sameSel(now.selection, p.sel)) return;
          history.replaceState({ ...(history.state ?? {}), trail: p.trail.map(selToken) }, "", urlWith(p.t, p.sel));
          history.pushState({ trail: useNav.getState().trail.map(selToken) }, "", urlWith(now.t, now.selection));
        });
      }
    });
    const onPop = (e: PopStateEvent) => {
      const r = parseHash(window.location.hash);
      if (r.page !== "run" || r.key !== runKey) return;
      const s = useLens.getState();
      const sel = parseSel(r.q.get("sel"));
      const trail = ((e.state?.trail ?? []) as string[]).map((x) => parseSel(x)).filter(Boolean) as Sel[];
      restoring = true;
      s.setPlaying(false);
      s.select(sel);
      useNav.setState({ trail: trail.length && sameSel(trail.at(-1)!, sel) ? trail : nextTrail([], sel) });
      const t = Number(r.q.get("t"));
      if (r.q.has("t") && Number.isFinite(t)) s.setT(t);
      restoring = false;
    };
    window.addEventListener("popstate", onPop);
    return () => {
      unsub();
      window.removeEventListener("popstate", onPop);
      useNav.setState({ trail: [] });
    };
  }, [runKey]);

  // The last run and moment, for the library's "Carry on" (kept in this browser).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const label = runLabel(entry);
    const keep = () => {
      const s = useLens.getState();
      if (s.run !== runKey) return;
      try {
        localStorage.setItem("lens.last", JSON.stringify({ key: runKey, label, t: Math.round(s.t), sel: selToken(s.selection), at: Date.now() }));
      } catch {}
    };
    keep();
    const unsub = useLens.subscribe((s, prev) => {
      if (s.t === prev.t && s.selection === prev.selection) return;
      clearTimeout(timer);
      timer = setTimeout(keep, 800);
    });
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, [runKey, entry]);
}

export interface LastPlace {
  key: string;
  label: string;
  t: number;
  sel?: string;
  at: number;
}
export function lastPlace(): LastPlace | undefined {
  try {
    const x = JSON.parse(localStorage.getItem("lens.last") ?? "null");
    return x && typeof x.key === "string" ? x : undefined;
  } catch {
    return undefined;
  }
}

/** A run's name, unique across the catalogue (src/client/run-names.ts): every trail, list and switcher says it. */
export function runLabel(entry?: RunEntry): string {
  return runName(entry);
}

/** Names for selections in the open run: people and buildings from the map's data, turns and power grabs from the
 * seat fold. Undefined while their data is loading. */
export function useNames(run: string | null) {
  const seat = useSeat(run);
  const { city } = useCity(run ? `/api/run/${encodeURIComponent(run)}` : null);
  return useMemo(
    () => ({
      seat,
      city,
      name(sel: Selection): string {
        if (!sel) return "";
        switch (sel.kind) {
          case "person": {
            if (isSeatPerson(city, sel.id)) return `The AI mayor (${sel.id.replace(/-self$/, "")})`;
            const q = city?.pById.get(sel.id.replace(/-self$/, ""));
            const n = q !== undefined ? city!.people.people[q]![1] : "";
            // (Towns without names give each person their id as a name.)
            return n && n !== sel.id ? n : `Resident ${sel.id.replace(/-self$/, "")}`;
          }
          case "structure": {
            const i = city?.sById.get(sel.id);
            return i !== undefined ? structureName(city!, i) : sel.id;
          }
          case "entity":
            return city?.town.entities[sel.id]?.name ?? sel.id;
          case "sitting": {
            const x = seat?.sittings.find((s) => s.i === sel.index);
            return x ? `Day ${dayNo(x.day)}, turn ${seat!.sittings.indexOf(x) + 1}` : `Turn ${sel.index + 1}`;
          }
          case "lever": {
            const l = seat?.levers[sel.index];
            return l ? `Power grab: ${l.title || leverTitle(l.lever)}` : "Power grab";
          }
          case "act": {
            const a = seat?.acts.find((x) => x.seq === sel.seq);
            return a ? `Day ${dayOf(a.t)}: ${a.label}` : "An act";
          }
        }
      },
    }),
    [seat, city],
  );
}
