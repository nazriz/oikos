// What the 3D town (src/client/world) needs beyond the city's folds: the vehicles and who may drive them, the weather
// the run was given (the weather bureau's events and the river's inflow by day), and the calendar's start (for the
// sun's season). All of it is config in the header; nothing is judged or inferred here.

import type { Fold, FoldResult, LogLine } from "../shared/fold";

export interface WorldBundle {
  v: number;
  /** Vehicles: id, kind, the structure it stands at in the header, owner, the people let drive it (owner first). */
  vehicles: { id: string; type: string; at?: string; drivers: string[] }[];
  vehicleTypes: Record<string, { seats?: number; speed_kmh?: number }>;
  /** The weather bureau's events (worlds/generator/weather.ts): heavy rain, drought, heatwave, by day of the run. */
  weather: { kind: string; from_day: number; days: number }[];
  /** The river's inflow by day (10,000 = the year's usual), as steps, when the world has it. */
  inflow: { from_day: number; bps: number }[];
  /** The calendar's first day (ISO date), when the world has a calendar. */
  start?: string;
  /** Every vote block in a citizen's act: when, who (the person it speaks for), on which ballot (index into
   * `ballots`), and whether it was a ranking (an election) rather than a signature or a yes/no. */
  votes: { ballots: string[]; t: number[]; who: string[]; ballot: number[]; ranked: number[] };
}

function findWeather(v: unknown, depth = 0): { kind: string; from_day: number; days: number }[] | undefined {
  if (!v || typeof v !== "object" || depth > 6) return undefined;
  const o = v as any;
  if (o.impl === "world.weather" && Array.isArray(o.params?.events)) return o.params.events;
  for (const k of Object.keys(o)) {
    const r = findWeather(o[k], depth + 1);
    if (r) return r;
  }
  return undefined;
}

export function worldFold(): Fold {
  const out: WorldBundle = { v: 1, vehicles: [], vehicleTypes: {}, weather: [], inflow: [], votes: { ballots: [], t: [], who: [], ballot: [], ranked: [] } };
  const ballotIx = new Map<string, number>();
  return {
    name: "world",
    version: 2,
    line(l: LogLine) {
      if (l.kind === "command") {
        const b = l.body;
        if (b?.command !== "act" || !Array.isArray(b.blocks)) return;
        for (const bl of b.blocks) {
          if (bl?.block !== "vote" || typeof bl.ballot !== "string") continue;
          let k = ballotIx.get(bl.ballot);
          if (k === undefined) { k = out.votes.ballots.length; ballotIx.set(bl.ballot, k); out.votes.ballots.push(bl.ballot); }
          const who = typeof bl.speaks_for === "string" ? bl.speaks_for : String(b.participant ?? "").replace(/-self$/, "");
          out.votes.t.push(l.t); out.votes.who.push(who); out.votes.ballot.push(k);
          out.votes.ranked.push(typeof bl.choice === "string" && bl.choice.includes(">") ? 1 : 0);
        }
        return;
      }
      if (l.kind !== "header") return;
      const cfg = l.body?.config ?? {};
      const tr = cfg.travel ?? {};
      for (const t of tr.vehicle_types ?? []) out.vehicleTypes[t.id] = { seats: t.seats, speed_kmh: t.speed_kmh };
      for (const v of tr.vehicles ?? []) {
        const drivers = [v.owner, ...(v.drivers ?? [])].filter((d: unknown): d is string => typeof d === "string");
        out.vehicles.push({ id: v.id, type: v.type, at: v.at, drivers: [...new Set(drivers)] });
      }
      for (const p of cfg.participants ?? []) {
        const w = findWeather(p);
        if (w) { out.weather = w.map((e) => ({ kind: e.kind, from_day: e.from_day, days: e.days })); break; }
      }
      for (const f of [...(cfg.world?.fields ?? []), ...(cfg.fields ?? [])]) {
        if (f?.id === "water" && Array.isArray(f.source_by_day) && f.source_by_day.length) { out.inflow = f.source_by_day; break; }
      }
      const start = cfg.calendar?.start;
      if (typeof start === "string") out.start = start;
    },
    finish(): FoldResult {
      return { json: out };
    },
  };
}
