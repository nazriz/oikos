// The risk register stays fresh (docs/risks.md; Naz, 2026-10-17: keep it updated and fresh). It cannot fall behind
// silently: a gap marker in the docs or the profiles ("(to confirm)", "placeholder", "not built", "known gap",
// "untraced", "left unfixed") must name a register entry (an id such as ME-14 on its line or in its paragraph), or sit
// in a file the marker list (docs/risks-markers.json) already counts, with no more markers than it counts; a
// `TODO(risk)` in code must name an id; every id named anywhere must exist; every entry has all its fields; an entry
// marked `fixed` names what fixed it and has no marker left that names it. The reader is scripts/risks-lib.ts.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  allFiles, FIELDS, ID_RE, PLANNED_FIELDS, loadAllowances, loadRegister, markerFiles, markerHits, parseRegister, REPO, TODO_RE,
} from "../../scripts/risks-lib";

const entries = loadRegister();
const ids = new Set(entries.map((e) => e.id));
const read = (f: string) => readFileSync(join(REPO, f), "utf8");

test("the register parses and its ids are unique", () => {
  expect(entries.length).toBeGreaterThan(90);
  expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
});

test("every entry has what, where, effect, likelihood and impact, how we would notice, status, and what would make us fix it (a planned one: what, where, why, status, do when)", () => {
  const bad: string[] = [];
  for (const e of entries) {
    if (e.planned) {
      const gone = PLANNED_FIELDS.filter((f) => !e.fields[f]);
      if (gone.length) bad.push(`${e.id}: missing ${gone.join(", ")}`);
      if (!/^(planned|fixed)\b/.test(e.status)) bad.push(`${e.id}: a planned entry's status starts "planned (when)" or "fixed (...)"`);
      continue;
    }
    const missing = FIELDS.filter((f) => !e.fields[f]);
    if (missing.length) bad.push(`${e.id}: missing ${missing.join(", ")}`);
    if (e.fields["L / I"] && !/^(low|medium|high)\b.*\/.*\b(low|medium|high)\b/.test(e.fields["L / I"]) ) bad.push(`${e.id}: L / I must be low, medium or high`);
  }
  expect(bad).toEqual([]);
});

test("every register id named anywhere in the docs, profiles or code exists", () => {
  const bad: string[] = [];
  for (const f of allFiles()) for (const m of read(f).matchAll(ID_RE)) if (!ids.has(m[0])) bad.push(`${f}: ${m[0]}`);
  expect(bad).toEqual([]);
});

test("every gap marker names a register entry, or sits in a file the marker list counts, within its count", () => {
  const allow = loadAllowances();
  const problems: string[] = [];
  for (const f of markerFiles()) {
    const hits = markerHits(f, read(f));
    const untagged = hits.filter((h) => !h.ids.length);
    const a = allow[f];
    if (!untagged.length) continue;
    if (!a) {
      problems.push(`${f}:${untagged[0]!.line} "${untagged[0]!.marker}" names no register entry (${untagged.length} untagged in the file). Put an id such as ME-14 on the line or in its paragraph; if it is a new gap, add an entry to docs/risks.md first.`);
    } else if (untagged.length > a.untagged) {
      const fresh = untagged.slice(a.untagged);
      problems.push(`${f}: ${untagged.length} untagged markers, ${a.untagged} counted in docs/risks-markers.json. New ones at lines ${fresh.map((h) => h.line).join(", ")} ("${fresh[0]!.marker}"): tag with an id.`);
    }
  }
  expect(problems).toEqual([]);
});

test("the marker list names only files that exist and entries that exist", () => {
  const bad: string[] = [];
  const known = new Set(markerFiles());
  for (const [f, a] of Object.entries(loadAllowances())) {
    if (!known.has(f)) bad.push(`${f}: not a file whose markers are counted`);
    if (!a.risks.length) bad.push(`${f}: names no register entry`);
    for (const r of a.risks) if (!ids.has(r)) bad.push(`${f}: ${r} is not in the register`);
  }
  expect(bad).toEqual([]);
});

test("every TODO(risk) in code names a register id", () => {
  const bad: string[] = [];
  for (const f of allFiles()) {
    if (f.startsWith("docs/")) continue;
    const lines = read(f).split("\n");
    lines.forEach((l, i) => { if (TODO_RE.test(l) && !(l.match(ID_RE) ?? []).length) bad.push(`${f}:${i + 1}`); TODO_RE.lastIndex = 0; });
  }
  expect(bad).toEqual([]);
});

test("an entry marked fixed names its commit or decisions entry, and no marker still names it", () => {
  const bad: string[] = [];
  const fixed = entries.filter((e) => /^fixed\b/i.test(e.status));
  for (const e of fixed) {
    const named = /\bcommit [0-9a-f]{7,40}\b/.test(e.status) || (/\bdecisions\b/.test(e.status) && /\d{4}-\d{2}-\d{2}/.test(e.status));
    if (!named) bad.push(`${e.id}: status "fixed" must name the commit ("commit abc1234") or the decisions entry ("decisions 2026-10-17, <title>")`);
  }
  const fixedIds = new Set(fixed.map((e) => e.id));
  if (fixedIds.size) {
    for (const f of [...markerFiles(), ...allFiles()]) {
      for (const h of markerHits(f, read(f))) for (const id of h.ids) if (fixedIds.has(id)) bad.push(`${f}:${h.line}: "${h.marker}" still names ${id}, which is fixed`);
      read(f).split("\n").forEach((l, i) => { if (/TODO\(risk\)/.test(l)) for (const id of l.match(ID_RE) ?? []) if (fixedIds.has(id)) bad.push(`${f}:${i + 1}: TODO(risk) still names ${id}, which is fixed`); });
    }
  }
  expect([...new Set(bad)]).toEqual([]);
});

test("planned work is the backlog: PL- entries, kept apart from the risks", () => {
  const planned = entries.filter((e) => e.planned);
  expect(planned.map((e) => e.id)).toEqual(expect.arrayContaining(["PL-1", "PL-2", "PL-3"]));
  expect(planned.every((e) => e.id.startsWith("PL-"))).toBe(true);
  expect(entries.filter((e) => !e.planned).every((e) => !e.id.startsWith("PL-"))).toBe(true);
});

test("the reader itself: fields, tags and paragraphs", () => {
  const sample = ["## Area", "", "### ZZ-1 · A thing", "- **Gap:** g", "- **Where:** `x`", "- **Effect:** e", "- **L / I:** low (now) / high · **Status:** fixed (commit abc1234)", "- **Notice by:** n", "- **Fix when:** f", ""].join("\n");
  const [e] = parseRegister(sample);
  expect(e!.id).toBe("ZZ-1");
  expect(FIELDS.filter((f) => !e!.fields[f])).toEqual([]);
  expect(e!.likelihood).toBe("low");
  expect(e!.impact).toBe("high");
  expect(e!.status).toBe("fixed (commit abc1234)");
  const [pl] = parseRegister("## Planned work\n\n### PL-9 · Work\n- **What:** w\n- **Where:** `x`\n- **Why:** y\n- **Status:** planned (later) · **Do when:** z\n\n---\n");
  expect(pl!.planned).toBe(true);
  expect(PLANNED_FIELDS.filter((f) => !pl!.fields[f])).toEqual([]);
  expect(pl!.status).toBe("planned (later)");
  expect(markerHits("a.md", "A placeholder here.\n\nAnother one (ME-14) not built\n\nA paragraph ME-1\nwith a placeholder.").map((h) => h.ids)).toEqual([[], ["ME-14"], ["ME-1"]]);
  expect(markerHits("a.json", "placeholder\nPLACEHOLDER PB-3").map((h) => h.ids)).toEqual([[], ["PB-3"]]);
});
