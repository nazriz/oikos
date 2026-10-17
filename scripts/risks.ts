// The risk register's staleness report (docs/risks.md; docs/risks-process.md in the register's header): `bun scripts/risks.ts`.
//   (no flag)           entries by status and by age, the entries whose "where" files changed since the entry was last
//                       touched (likely stale), the marker slack, and the five top risks.
//   --md [FILE]         the same as a Markdown summary the maintainer can paste (to FILE, or to stdout).
//   --touched [REF]     the entries whose "where" files a branch touched since REF (default origin/main): what the
//                       maintainer should update before a merge. scripts/merge.ts can print this.
// Age comes from `git blame` of the entry's lines (the newest line counts); a file named in "where" is "changed since"
// when `git log` shows a commit touching it after that date. A directory or a path in backticks counts; prose does not.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAllowances, loadRegister, markerFiles, markerHits, REPO, type Entry } from "./risks-lib";

const git = (args: string[], cwd = REPO) => {
  const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString() : "";
};

/** The paths an entry's "where" names in backticks that exist in the repo (a file or a directory; globs and prose left out). */
export function wherePaths(e: Entry, root = REPO): string[] {
  const w = e.fields["Where"] ?? "";
  const out = new Set<string>();
  for (const m of w.matchAll(/`([^`\s]+)`/g)) {
    const p = m[1]!.replace(/[.,;:]+$/, "");
    if (/[*{}()]/.test(p) || !/[\/.]/.test(p)) continue;
    if (existsSync(join(root, p))) out.add(p);
  }
  for (const m of w.matchAll(/\b((?:docs|worlds|participants|orchestrator|kernel|measure|translator|scripts|contracts|runs)\/[\w./-]+?\.(?:md|ts|rs|json|yaml))\b/g)) if (existsSync(join(root, m[1]!))) out.add(m[1]!);
  return [...out];
}

/** Unix time each line of docs/risks.md was last changed (uncommitted lines count as now). */
export function lineTimes(): number[] {
  const text = git(["blame", "--line-porcelain", "docs/risks.md"]);
  const times: number[] = [];
  let cur = 0, uncommitted = false;
  for (const line of text.split("\n")) {
    if (/^[0-9a-f]{40} /.test(line)) { uncommitted = /^0{40} /.test(line); }
    else if (line.startsWith("committer-time ")) cur = Number(line.slice(15));
    else if (line.startsWith("\t")) times.push(uncommitted ? Math.floor(Date.now() / 1000) : cur);
  }
  return times;
}

export interface Row { e: Entry; touched: number; changed: { path: string; at: number }[] }

export function rows(): Row[] {
  const entries = loadRegister();
  const times = lineTimes();
  return entries.map((e) => {
    const ts = times.slice(e.start - 1, e.end);
    const touched = ts.length ? Math.max(...ts) : 0;
    const changed: Row["changed"] = [];
    for (const p of wherePaths(e)) {
      const at = Number(git(["log", "-1", "--format=%ct", "--", p]).trim() || 0);
      if (at > touched) changed.push({ path: p, at });
    }
    return { e, touched, changed };
  });
}

const SCORE: Record<string, number> = { low: 1, medium: 2, high: 3 };
const open = (e: Entry) => !e.planned && !/^fixed\b/i.test(e.status) && !/^accepted\b/i.test(e.status);
/** The top risks: likelihood times impact, open ones (to fix, to source, to decide) before accepted, then by id. */
export function topRisks(es: Entry[], n = 5): Entry[] {
  const score = (e: Entry) => (SCORE[e.likelihood] ?? 2) * (SCORE[e.impact] ?? 2) * 10 + (open(e) ? 5 : 0) + (/^fixed/i.test(e.status) ? -100 : 0);
  return [...es].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id)).slice(0, n);
}

const statusWord = (e: Entry) => (e.status.match(/^(partly fixed|fixed|accepted|to fix|to source|to decide|to fit)/i)?.[1] ?? e.status.split(/[\s;(]/)[0] ?? "").toLowerCase();
const days = (t: number) => Math.floor((Date.now() / 1000 - t) / 86400);
const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

/** Markers beyond a file's count, and counts higher than the markers (slack: lower the number). */
export function slack(): { file: string; counted: number; actual: number }[] {
  const out: { file: string; counted: number; actual: number }[] = [];
  const allow = loadAllowances();
  for (const f of markerFiles()) {
    const a = allow[f]; if (!a) continue;
    const actual = markerHits(f, readFileSync(join(REPO, f), "utf8")).filter((h) => !h.ids.length).length;
    if (actual < a.untagged) out.push({ file: f, counted: a.untagged, actual });
  }
  return out;
}

export function report(md: boolean): string {
  const all = rows();
  const planned = all.filter((r) => r.e.planned);
  const rs = all.filter((r) => !r.e.planned);
  const es = rs.map((r) => r.e);
  const by = new Map<string, Row[]>();
  for (const r of rs) (by.get(statusWord(r.e)) ?? by.set(statusWord(r.e), []).get(statusWord(r.e))!).push(r);
  const h = (t: string) => (md ? `\n## ${t}\n` : `\n${t}:`);
  const li = (s: string) => (md ? `- ${s}` : `  ${s}`);
  const out: string[] = [md ? `# Risk register summary, ${date(Date.now() / 1000)}` : `Risk register: ${es.length} risks, ${planned.length} planned, ${date(Date.now() / 1000)}`];
  out.push(h("By status"));
  for (const [s, v] of [...by].sort((a, b) => b[1].length - a[1].length)) out.push(li(`${s}: ${v.length}`));
  out.push(h(`Planned work (the backlog): ${planned.length}`));
  for (const r of planned) out.push(li(`${r.e.id} ${r.e.title}: ${r.e.status}${r.e.fields["Do when"] ? `; do when: ${r.e.fields["Do when"]}` : ""}`));
  out.push(h("Top five risks"));
  for (const e of topRisks(es)) out.push(li(`${e.id} ${e.title} (${e.likelihood} / ${e.impact}, ${statusWord(e)})`));
  const stale = rs.filter((r) => r.changed.length).sort((a, b) => b.changed.length - a.changed.length);
  out.push(h(`Likely stale: ${stale.length} entries whose "where" changed after the entry was last touched`));
  for (const r of stale) out.push(li(`${r.e.id} (entry ${date(r.touched)}, ${days(r.touched)} days): ${r.changed.map((c) => `${c.path} ${date(c.at)}`).join("; ")}`));
  const old = rs.filter((r) => open(r.e)).sort((a, b) => a.touched - b.touched).slice(0, 10);
  out.push(h("Oldest open entries"));
  for (const r of old) out.push(li(`${r.e.id} ${r.e.title}: last touched ${date(r.touched)} (${days(r.touched)} days), ${statusWord(r.e)}`));
  const sl = slack();
  out.push(h(`Marker list slack: ${sl.length} files hold fewer untagged markers than docs/risks-markers.json counts (lower the number)`));
  for (const s of sl) out.push(li(`${s.file}: counted ${s.counted}, found ${s.actual}`));
  return out.join("\n") + "\n";
}

/** The entries whose "where" paths a branch touched since `ref`. */
export function touchedBy(ref: string, cwd = REPO): { e: Entry; paths: string[] }[] {
  const changed = new Set(git(["diff", "--name-only", `${ref}...HEAD`], cwd).split("\n").filter(Boolean));
  if (!changed.size) return [];
  const res: { e: Entry; paths: string[] }[] = [];
  for (const e of loadRegister(cwd)) {
    const hit = wherePaths(e, cwd).filter((p) => [...changed].some((c) => c === p || c.startsWith(p.endsWith("/") ? p : p + "/")));
    if (hit.length) res.push({ e, paths: hit });
  }
  return res;
}

export function touchedText(ref: string, cwd = REPO): string {
  const t = touchedBy(ref, cwd);
  if (!t.length) return `Risk register: no entry's "where" is touched by this branch.\n`;
  return [`Risk register: ${t.length} entries whose "where" this branch touched (update status and evidence in docs/risks.md):`, ...t.map((x) => `  ${x.e.id} ${x.e.title} [${statusWord(x.e)}]: ${x.paths.join(", ")}`), ""].join("\n");
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const ti = a.indexOf("--touched");
  if (ti >= 0) { process.stdout.write(touchedText(a[ti + 1] && !a[ti + 1]!.startsWith("--") ? a[ti + 1]! : "origin/main")); process.exit(0); }
  const mi = a.indexOf("--md");
  if (mi >= 0) {
    const text = report(true);
    const file = a[mi + 1] && !a[mi + 1]!.startsWith("--") ? a[mi + 1]! : "";
    if (file) await Bun.write(file, text); else process.stdout.write(text);
  } else process.stdout.write(report(false));
}
