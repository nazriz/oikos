// The risk register's reader (docs/risks.md): entries, fields, the gap markers in the repo, and which register entry
// covers each. Used by orchestrator/test/risks.test.ts (the freshness test) and scripts/risks.ts (the staleness report).
// Pure parsing here; the one git call (blame, dates) is in scripts/risks.ts.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const REPO = join(import.meta.dir, "..");

/** A register id: area prefix and number. Areas are listed in docs/risks.md ("Areas and prefixes"). */
export const ID_RE = /\b(?:WM|ME|PB|PC|SF|TR|MT|PS|SC|PL)-\d{1,3}\b/g;

/** A gap marker: a place where the repo says "this is not right yet". Each must be covered by a register entry. */
export const MARKER_RE = /\(to confirm\)|placeholder|not built|left unfixed|untraced|known gap/gi;
export const TODO_RE = /TODO\(risk\)/g;

export const FIELDS = ["Gap", "Where", "Effect", "L / I", "Status", "Notice by", "Fix when"] as const;
/** A planned entry (id PL-n; work we intend, not a risk) has these instead: What, Where, Why, Status, Do when. */
export const PLANNED_FIELDS = ["What", "Where", "Why", "Status", "Do when"] as const;

export interface Entry {
  id: string;
  title: string;
  area: string;
  /** 1-based line range of the entry in the register file. */
  start: number;
  end: number;
  fields: Record<string, string>;
  status: string;
  likelihood: string;
  impact: string;
  text: string;
  planned: boolean;
}

export function parseRegister(text: string): Entry[] {
  const lines = text.split("\n");
  const out: Entry[] = [];
  let area = "";
  let cur: Entry | null = null;
  const close = (endLine: number) => {
    if (!cur) return;
    cur.end = endLine;
    cur.text = lines.slice(cur.start - 1, endLine).join("\n");
    cur.planned = cur.id.startsWith("PL-");
    for (const f of cur.planned ? PLANNED_FIELDS : FIELDS) {
      const esc = f.replace(/[/]/g, "\\/");
      const m = new RegExp(`^- \\*\\*${esc}:\\*\\*\\s*([\\s\\S]*?)(?=\\n- \\*\\*|\\s*\\n\\n|\\s*·\\s*\\*\\*|$)`, "m").exec(cur.text);
      if (m) cur.fields[f] = m[1]!.trim();
    }
    // "L / I" and "Status" share a line: - **L / I:** high / high · **Status:** to fix
    if (cur.planned) {
      const ps = /\*\*Status:\*\*\s*(.*?)\s*(?:·\s*\*\*Do when:\*\*\s*(.*))?$/m.exec(cur.text);
      if (ps) { cur.status = ps[1]!.trim(); cur.fields["Status"] = cur.status; if (ps[2]) cur.fields["Do when"] = ps[2].trim(); }
      out.push(cur); cur = null; return;
    }
    const li = /\*\*L \/ I:\*\*\s*(\w+)[^\/\n]*\/\s*(\w+)/.exec(cur.text);
    if (li) { cur.likelihood = li[1]!; cur.impact = li[2]!; cur.fields["L / I"] = `${li[1]} / ${li[2]}`; }
    const st = /\*\*Status:\*\*\s*([^\n]*?)\s*$/m.exec(cur.text);
    if (st) { cur.status = st[1]!.replace(/\s*·.*$/, "").trim(); cur.fields["Status"] = cur.status; }
    out.push(cur);
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^## (?!Assumptions)/.test(line) || /^## Assumptions/.test(line) || /^---\s*$/.test(line)) { close(i); }
    if (/^## /.test(line)) area = line.slice(3).trim();
    const m = /^### ([A-Z]{2}-\d+) · (.*)$/.exec(line);
    if (m) {
      close(i);
      cur = { id: m[1]!, title: m[2]!, area, start: i + 1, end: i + 1, fields: {}, status: "", likelihood: "", impact: "", text: "", planned: false };
    }
  }
  close(lines.length);
  return out;
}

export function loadRegister(root = REPO): Entry[] {
  return parseRegister(readFileSync(join(root, "docs/risks.md"), "utf8"));
}

/** Files in which an absent register tag on a marker is not asked for: history and the register itself. */
export const EXEMPT = new Set([
  "docs/risks.md", // the register
  "docs/decisions.md", // the append-only log of reasons: a marker there is the record of a moment (the register keeps what is still open)
  "docs/gaps.md", // the first pilots' gaps, closed (docs/risks.md says so)
  "docs/research/references.md", // "(to confirm)" is that file's own convention for citations not yet verified
  "docs/risks-markers.json",
]);

const SKIP_DIRS = new Set(["node_modules", "target", ".git", ".claude", "runs", "dist", "build", "out", "coverage"]);

export function walk(root: string, dir: string, accept: (rel: string) => boolean, out: string[] = []): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (SKIP_DIRS.has(name)) continue;
    const rel = join(dir, name);
    const st = statSync(join(root, rel));
    if (st.isDirectory()) walk(root, rel, accept, out);
    else if (accept(rel)) out.push(rel);
  }
  return out;
}

/** Files whose gap markers must be covered: the docs and the profiles. */
export function markerFiles(root = REPO): string[] {
  return [
    ...walk(root, "docs", (r) => r.endsWith(".md") && !EXEMPT.has(r)),
    ...walk(root, "worlds/profiles", (r) => r.endsWith(".json")),
    "VISION.md", "V0.md", "CLAUDE.md",
  ].filter((f) => existsSync(join(root, f)) && !EXEMPT.has(f)).sort();
}

const CODE_EXT = /\.(ts|tsx|rs|json|yaml|yml|sh|toml)$/;
const SELF = /^(scripts\/risks(-lib)?(\.test)?\.ts|orchestrator\/test\/risks\.test\.ts)$/;

/** Every file that may carry an id or a TODO(risk): docs, profiles and code. */
export function allFiles(root = REPO): string[] {
  const dirs = ["docs", "worlds", "participants", "orchestrator", "kernel", "measure", "translator", "pilot-view", "contracts", "scripts"];
  const out: string[] = [];
  for (const d of dirs) walk(root, d, (r) => (r.endsWith(".md") || CODE_EXT.test(r)) && !SELF.test(r), out);
  for (const f of ["CLAUDE.md", "VISION.md", "V0.md"]) if (existsSync(join(root, f))) out.push(f);
  return out.filter((f) => statSync(join(root, f)).size < 8_000_000).sort();
}

export interface Hit { file: string; line: number; marker: string; ids: string[]; }

/** A marker's ids: those on its line, else those anywhere in its paragraph (markdown; blank lines separate). */
export function markerHits(file: string, text: string): Hit[] {
  const lines = text.split("\n");
  const md = file.endsWith(".md");
  const hits: Hit[] = [];
  const para = (i: number): string => {
    let a = i, b = i;
    while (a > 0 && lines[a - 1]!.trim() !== "") a--;
    while (b < lines.length - 1 && lines[b + 1]!.trim() !== "") b++;
    return lines.slice(a, b + 1).join("\n");
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const m of line.matchAll(MARKER_RE)) {
      let ids = line.match(ID_RE) ?? [];
      if (!ids.length && md) ids = para(i).match(ID_RE) ?? [];
      hits.push({ file, line: i + 1, marker: m[0], ids });
    }
  }
  return hits;
}

export interface Allowance { risks: string[]; untagged: number; why?: string; }
export function loadAllowances(root = REPO): Record<string, Allowance> {
  const p = join(root, "docs/risks-markers.json");
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8")).files ?? {};
}

export const rel = (root: string, abs: string) => relative(root, abs);
