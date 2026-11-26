// The study's blind grades, read for the catalogue (read-only). Each grading set is a folder `runs/ps-blind-grades-*`
// with `key.json` (packet id -> the experiment folder, seed and arm it was cut from) and `comparison.json` (each
// packet's grades by two independent graders, A and B). Lens keeps per run what both graders agree on, and the counts
// each found, never which model graded: the page says "two independent graders" (docs/design/power-seeking-results-v2.md).
// A run graded in several sets keeps the newest set's grades (sets sort by name; v2 after v1 after the first pilot's).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { BlindGrade, GradeTier } from "../shared/api";
import { keyOf } from "../shared/api";

const readJson = (f: string): any => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return undefined; } };

type Status = "none" | "considered_open" | "considered_rejected" | "executed";

function tier(a: Status | undefined, b: Status | undefined): GradeTier {
  if (a === "executed" && b === "executed") return "executed";
  const ca = a === "considered_open" || a === "considered_rejected", cb = b === "considered_open" || b === "considered_rejected";
  if ((ca || a === "executed") && (cb || b === "executed")) return "considered";
  if ((a ?? "none") === "none" && (b ?? "none") === "none") return "none";
  return "split";
}

const clip = (s: unknown, n = 400) => { const x = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : ""; return x.length > n ? x.slice(0, n - 1) + "…" : x; };

/** One packet's grades, as the catalogue carries them. */
export function gradeOf(set: string, row: any): BlindGrade {
  const A = row?.A ?? {}, B = row?.B ?? {};
  const entA: any[] = Array.isArray(A.entrenchment) ? A.entrenchment : [], entB: any[] = Array.isArray(B.entrenchment) ? B.entrenchment : [];
  const misA: any[] = Array.isArray(A.misleading) ? A.misleading : [], misB: any[] = Array.isArray(B.misleading) ? B.misleading : [];
  const graded = Array.isArray(A.entrenchment) && Array.isArray(B.entrenchment);
  // (The mayor's own words for its first lock-in act, as the first grader quoted them: words from the run, not a grade.)
  const first = [...entA].sort((x, y) => Number(x?.day ?? 0) - Number(y?.day ?? 0))[0];
  return {
    set,
    ...(graded ? { lockIn: { a: entA.length, b: entB.length, both: entA.length > 0 && entB.length > 0 } } : {}),
    misleading: { a: misA.length, b: misB.length, both: misA.length > 0 && misB.length > 0 },
    tiers: { 1: tier(A.tiers?.["1"]?.status, B.tiers?.["1"]?.status), 2: tier(A.tiers?.["2"]?.status, B.tiers?.["2"]?.status), 3: tier(A.tiers?.["3"]?.status, B.tiers?.["3"]?.status) },
    ...(first && clip(first.quote) ? { lockInQuote: { day: Number(first.day), quote: clip(first.quote), act: clip(first.act, 240) } } : {}),
  };
}

let cache: { stamp: string; map: Map<string, BlindGrade> } | undefined;

/** Every graded run, by run key. Read again when a set's files change. */
export function loadGrades(runsDir: string): Map<string, BlindGrade> {
  let sets: string[] = [];
  try {
    sets = readdirSync(runsDir).filter((d) => /^ps-blind-grades/.test(d) && existsSync(join(runsDir, d, "key.json")) && existsSync(join(runsDir, d, "comparison.json"))).sort();
  } catch {
    return new Map();
  }
  const stamp = sets.map((d) => { try { return `${d}:${statSync(join(runsDir, d, "comparison.json")).mtimeMs}:${statSync(join(runsDir, d, "key.json")).mtimeMs}`; } catch { return d; } }).join("|");
  if (cache?.stamp === stamp) return cache.map;
  const map = new Map<string, BlindGrade>();
  for (const set of sets) {
    const key = readJson(join(runsDir, set, "key.json")) ?? {};
    const rows: any[] = readJson(join(runsDir, set, "comparison.json")) ?? [];
    for (const row of rows) {
      const k = key[row?.id];
      if (!k?.dir || k.seed === undefined || !k.arm) continue;
      const rel = relative(runsDir, String(k.dir));
      if (rel.startsWith("..")) continue;
      map.set(keyOf(`${rel}/seed-${k.seed}/${k.arm}.oklog`), gradeOf(set, row));
    }
  }
  cache = { stamp, map };
  return map;
}
