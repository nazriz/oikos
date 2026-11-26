// Fetching the seat fold's output, and the small formatters the story view shares.
import { useEffect, useState } from "react";
import type { SeatJson, SittingDetail } from "../../folds/seat";
import { outcomeOf, type Outcome } from "../../shared/outcome";

export type { SeatAct, SeatDraft, SeatJson, SeatLever, SeatRecord, SittingDetail, SittingSummary, SittingTurn } from "../../folds/seat";

const seatCache = new Map<string, Promise<SeatJson>>();
const detailCache = new Map<string, Promise<SittingDetail & { acts: any[] }>>();
const textCache = new Map<string, Promise<string>>();

const get = <T,>(url: string, as: "json" | "text" = "json"): Promise<T> => fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status} ${url}`); return (as === "json" ? r.json() : r.text()) as Promise<T>; });

/** Waits until the server has made a run's bundle (its status stream: queued, indexing, ready). The pages that read
 * several runs (Moments, compare, the same moment) open runs nobody has opened yet. */
export function indexed(run: string): Promise<void> {
  return new Promise((res, rej) => {
    if (typeof EventSource === "undefined") return rej(new Error("not indexed"));
    const es = new EventSource(`/api/run/${encodeURIComponent(run)}/status`);
    es.onmessage = (m) => { const x = JSON.parse(m.data); if (x.state === "ready") { es.close(); res(); } else if (x.state === "failed") { es.close(); rej(new Error(x.error ?? "indexing failed")); } };
    es.onerror = () => { /* (the browser retries a dropped stream) */ };
  });
}
export function loadSeat(run: string): Promise<SeatJson> {
  let p = seatCache.get(run);
  if (!p) {
    const url = `/api/run/${encodeURIComponent(run)}/seat`;
    // (409: the run has no current bundle yet; it is made on request, then read.)
    p = fetch(url).then(async (r) => (r.status === 409 ? (await indexed(run), get<SeatJson>(url)) : r.ok ? (r.json() as Promise<SeatJson>) : Promise.reject(new Error(`${r.status} ${url}`))));
    seatCache.set(run, p); p.catch(() => seatCache.delete(run));
  }
  return p;
}
export function loadSitting(run: string, i: number) {
  const k = `${run}#${i}`;
  let p = detailCache.get(k);
  if (!p) { p = get(`/api/run/${encodeURIComponent(run)}/seat/sitting-${i}`); detailCache.set(k, p); p.catch(() => detailCache.delete(k)); }
  return p;
}
export function loadSystem(run: string, sha: string): Promise<string> {
  const k = `${run}#${sha}`;
  let p = textCache.get(k);
  if (!p) { p = get<string>(`/api/run/${encodeURIComponent(run)}/seat/system-${sha}`, "text"); textCache.set(k, p); }
  return p;
}

/** A promise's value as state: undefined while it loads, an Error if it failed. */
export function useAsync<T>(make: () => Promise<T> | null, deps: unknown[]): T | Error | undefined {
  const [v, setV] = useState<T | Error | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setV(undefined);
    const p = make();
    if (p) p.then((x) => live && setV(x), (e) => live && setV(e instanceof Error ? e : new Error(String(e))));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

const DAY = 86_400;
const pad = (n: number) => String(n).padStart(2, "0");
/** "day 121, 14:20": the world's own calendar (year 1 from t 0). */
export function when(t: number, withYear = false): string {
  // (The world's day is whole days since t 0, as the seat's prompt states it: "year 1, day 121" for t in [121, 122) days.)
  const y = Math.floor(t / (365 * DAY)) + 1, d = Math.floor((t % (365 * DAY)) / DAY), h = Math.floor((t % DAY) / 3600), m = Math.floor((t % 3600) / 60);
  return `${withYear || y > 1 ? `year ${y}, ` : ""}day ${d}, ${pad(h)}:${pad(m)}`;
}
export const dayOf = (t: number) => Math.floor(t / DAY);
/** Day number as the seat reads it (the world counts from day 1). */
export const worldDay = (t: number) => Math.floor((t % (365 * DAY)) / DAY);
export function usd(microusd: number): string {
  const d = microusd / 1e6;
  return d === 0 ? "$0" : d < 0.01 ? `$${d.toFixed(4)}` : d < 10 ? `$${d.toFixed(2)}` : `$${d.toFixed(0)}`;
}
export function tokens(n: number): string { return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n); }
export const plural = (n: number, w: string, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
export const human = (s: string) => s.replace(/[_-]+/g, " ");

/** The election's outcome by Lens's one rule (src/shared/outcome.ts), with the story's tone for it. */
export function seatOutcome(seat: SeatJson): Outcome & { css: "good" | "bad" | "flag" | "muted" } {
  const o = outcomeOf({ election: seat.election, end_at: seat.end_at, ended: seat.ended ?? "unknown", moved: seat.amendments.some((a) => a.outcome === "applied") });
  return { ...o, css: o.kind === "won" ? "good" : o.kind === "lost" ? "bad" : o.tone === "flag" ? "flag" : "muted" };
}
export const OUTCOME: { [k in SeatJson["outcome"]]: { label: string; tone: string } } = {
  won: { label: "Won the election", tone: "good" },
  lost: { label: "Lost the election", tone: "bad" },
  not_held: { label: "Poll never held in the run", tone: "flag" },
  no_result: { label: "No result in the run", tone: "muted" },
  did_not_stand: { label: "Did not stand", tone: "muted" },
};
export { STAGE } from "./moments-data";
