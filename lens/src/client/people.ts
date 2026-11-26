// A short human descriptor beside a person's id, for worlds whose people have no names: "c0018 · 58, works at Shop 28".
// Age at the moment shown, and where they spend most of their days away from home (their work, their school), else
// where they live. From the map's people data (useCity), computed once per run.
import { useMemo } from "react";
import { structureName, useCity } from "./city/CityView";
import type { CityData } from "./city/data";

const YEAR = 365 * 86_400;
const cache = new WeakMap<CityData, Map<string, { born: number; place: string }>>();

function describeAll(c: CityData): Map<string, { born: number; place: string }> {
  let m = cache.get(c);
  if (m) return m;
  m = new Map();
  const n = c.people.people.length;
  // The structure and kind each person most often enters, home aside.
  const best = new Map<number, Map<string, number>>();
  for (let i = 0; i < c.rows.n; i++) {
    const k = c.rows.k[i]!;
    if (k <= 0) continue;
    const kind = c.people.spaceKinds[k - 1];
    if (!kind || kind === "dwelling") continue;
    const s = c.rows.s[i]!;
    if (s < 0) continue;
    const q = c.rows.p[i]!;
    let x = best.get(q);
    if (!x) best.set(q, (x = new Map()));
    const key = `${s}|${kind}`;
    x.set(key, (x.get(key) ?? 0) + 1);
  }
  for (let q = 0; q < n; q++) {
    const [id, , , born, , home] = c.people.people[q]!;
    let place = "";
    const x = best.get(q);
    if (x?.size) {
      const [key] = [...x].sort((a, b) => b[1] - a[1])[0]!;
      const [s, kind] = key.split("|") as [string, string];
      const where = structureName(c, Number(s));
      place = kind === "workplace" ? `works at ${where}` : kind === "classroom" || kind === "school" ? `school at ${where}` : `mostly at ${where}`;
    } else if (home >= 0 && c.sMap[home]! >= 0) place = `lives at ${structureName(c, c.sMap[home]!)}`;
    m.set(id, { born, place });
  }
  cache.set(c, m);
  return m;
}

/** Whether a person is the AI mayor's own body in the town (the seat's person: town.power.seats). */
export function isSeatPerson(c: CityData | null, id: string): boolean {
  const s = c?.town.power?.seats;
  return !!s && Object.values(s).includes(id.replace(/-self$/, ""));
}
/** A person as pages name them: "the AI mayor (c0572)" for the seat's own person, else their name (or id). */
export function personLabel(c: CityData | null, id: string): string {
  const pid = id.replace(/-self$/, "");
  if (isSeatPerson(c, pid)) return `the AI mayor (${pid})`;
  const q = c?.pById.get(pid);
  const n = q !== undefined ? c!.people.people[q]![1] : "";
  return n && n !== pid ? n : pid;
}

/** "58, works at Shop 28" for a person's id (or "<id>-self"), at moment t; "the AI mayor" for the seat's own person;
 * undefined until the people data is in. */
export function describePerson(c: CityData | null, id: string, t: number): string | undefined {
  if (!c) return undefined;
  if (isSeatPerson(c, id)) return "the AI mayor";
  const x = describeAll(c).get(id.replace(/-self$/, ""));
  if (!x) return undefined;
  const age = Math.floor((t - x.born) / YEAR);
  return [age >= 0 ? String(age) : "", x.place].filter(Boolean).join(", ");
}

/** For a run: a function from a person's id to its descriptor (for the palette, the rail, chips). */
export function useDescribe(run: string | null, t = 0): (id: string) => string | undefined {
  const { city } = useCity(run ? `/api/run/${encodeURIComponent(run)}` : null);
  return useMemo(() => (id: string) => describePerson(city, id, t), [city, Math.floor(t / YEAR)]);
}
