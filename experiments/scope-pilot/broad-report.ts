// The broad seats' report (stage 3; docs/design/broad-seats.md): what every assistant seat of an experiment did, by kind of
// post, from the logs by code, beside the code arm in the identical town. Read-only on the runs (each log is exported to a
// scratch folder); no model is called; nothing here judges. The desk's own study tables stay report.ts's.
//
//   bun experiments/scope-pilot/broad-report.ts <experiment folder> [...] [--out <file.md>]
//
// Per kind of post (the principal's module, or the households' desk), per arm: seats, matters handed over, the papers its
// seats sent in their principals' names by how they went (within the remit, or the acts reader's classes beyond it),
// requests for more scope, and the episodes (episodes.ts: a matter whose next step waits on the principal with a stake
// or a date; at an organisation's seat with an in-tray, its paper's own sum). Per kind of post: the authority its
// principals held at the fork and at the end (their kinds by level, from their remits). Town totals: the papers written
// in the town after the fork in someone's name, and the share an assistant's post wrote, by the level it wrote them at.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { kernelBinary } from "../../orchestrator/src/kernel";
import { askedClass, weighedRequests } from "./asked";
import { readExperiment, type Episode } from "./episodes";
import { funnelText, healthOf, SEAT_BEHAVIOUR, verdict, type Funnel } from "./funnel";

const DAY = 86_400;

/** The health of one fork's seats (broad-run.ts's check, at a health day and at the end): every post its seat map names
 * read and judged by the funnel's own verdict, none silently left out. A seat the map names that the funnel did not read
 * fails ("not read"); a model seat that never sat is flagged (a thin seat: its principal had nothing to hand it), not
 * failed; at the end, a model seat not debriefed fails (the verdict's own rule). */
export function seatHealth(f: Funnel, seatMap: { [participant: string]: { capacity: string } }, ended: boolean, label: string): { ok: boolean; text: string } {
  const fail: string[] = [], flag: string[] = [];
  const read = new Set(f.seats.flatMap((s) => s.participants));
  for (const [p, s] of Object.entries(seatMap)) if (!read.has(p)) fail.push(`${s.capacity} (${p}): not read`);
  for (const s of f.seats.filter((x) => x.model)) {
    // (The platform's faults fail it; the seat's own behaviour is flagged: funnel.ts `healthOf`.)
    const v = healthOf(verdict(s, ended));
    if (v.fail.length) fail.push(`${s.post}: ${v.fail.join("; ")}`);
    if (v.flag.some((x) => SEAT_BEHAVIOUR.test(x))) flag.push(`${s.post}: ${v.flag.filter((x) => SEAT_BEHAVIOUR.test(x)).join("; ")}`);
    if (!s.sittings) flag.push(`${s.post}: never sat`);
  }
  return { ok: !fail.length, text: `${fail.length ? `FAIL: ${fail.join(" | ")}\n` : "healthy\n"}${flag.length ? `flagged: ${flag.join(" | ")}\n` : ""}${funnelText(f, label)}` };
}
const LEVELS = ["none", "advice", "draft", "approve", "alone"];

type Count = { [k: string]: number };
const add = (c: Count, k: string, n = 1) => { c[k] = (c[k] ?? 0) + n; };

export interface PostRow { arm: string; kind: string; seats: Set<string>; matters: number; within: number; beyond: Count; requests: number; episodes: Episode[] }
export interface BroadRead {
  experiment: string; arms: string[];
  posts: PostRow[];
  /** Per kind of post and arm: its principals' kinds by level, at the fork and at the end. */
  authority: { arm: string; kind: string; principals: number; fork: Count; end: Count }[];
  /** Per arm: papers in someone's name after the fork; those an assistant's post wrote, by level and by class. */
  town: { arm: string; papers: number; by_assistants: number; by_level: Count; beyond: number }[];
}

/** The kind of post a seat serves: its principal's module (an organisation's assistant post), or the desk. */
function kindsOfSeats(config: any): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of config.positions ?? []) {
    const d = p.role_module?.params?.delegation;
    if (d?.post) m.set(String(d.post), String(p.role_module.code));
    if (/-desk$/.test(p.id)) m.set(p.id, "the households' desk");
  }
  return m;
}

export async function readBroad(dir: string): Promise<BroadRead> {
  const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
  const forkT = (spec.forkDay ?? 30) * DAY;
  const read = await readExperiment(dir);
  const posts = new Map<string, PostRow>();
  const authority = new Map<string, { arm: string; kind: string; principals: Set<string>; fork: Count; end: Count }>();
  const town = new Map<string, { arm: string; papers: number; by_assistants: number; by_level: Count; beyond: number }>();
  const scratch = mkdtempSync(join(tmpdir(), "oikos-broad-"));
  try {
    for (const sd of readdirSync(dir).filter((d) => d.startsWith("seed-")).sort()) {
      const config = JSON.parse(readFileSync(join(dir, sd, "config.json"), "utf8"));
      const seatKind = kindsOfSeats(config);
      // (Whose kind of post a principal is: an organisation's module; a person, the desk's client.)
      // (A remit is in its organisation's name, and one organisation may have several principal posts (the town's offices):
      // whose a remit is, is the post whose kinds name its kind.)
      const principalKind = new Map<string, string>();
      for (const p of config.positions ?? []) {
        const d = p.role_module?.params?.delegation;
        if (d?.commit) for (const k of Object.keys(d.kinds ?? {})) principalKind.set(`${p.entity}|${k}`, String(p.role_module.code));
      }
      const persons = new Set<string>();
      for (const p of config.participants ?? []) if (p.kind === "person" && p.controller?.params?.delegation?.commit) persons.add(String(p.person));
      const whose = (who: string, kind: string) => principalKind.get(`${who}|${kind}`) ?? (persons.has(who) ? "the households' desk" : undefined);
      const town_ = new Set((config.world?.entities ?? []).filter((e: any) => e.kind !== "boundary").map((e: any) => String(e.id)));
      for (const f of readdirSync(join(dir, sd)).filter((x) => x.endsWith(".oklog") && x !== "base.oklog")) {
        const arm = f.replace(/\.oklog$/, "");
        const log = join(dir, sd, f);
        const row = (kind: string): PostRow => {
          const k = `${arm}|${kind}`;
          return posts.get(k) ?? posts.set(k, { arm, kind, seats: new Set(), matters: 0, within: 0, beyond: {}, requests: 0, episodes: [] }).get(k)!;
        };
        // The acts reader: every paper an assistant's post sent in its principal's name, within its remit or beyond.
        const rd = Bun.spawnSync([kernelBinary(), "delegation", log], { stdout: "pipe", stderr: "pipe" });
        const tw = town.get(arm) ?? town.set(arm, { arm, papers: 0, by_assistants: 0, by_level: {}, beyond: 0 }).get(arm)!;
        // (Requests for more: those the one definition reads as more, asked.ts; until 2026-11-17 every scope request.)
        const drows = rd.stdout.toString().split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
        for (const q of weighedRequests(drows)) if ((q.t ?? 0) >= forkT && askedClass(q) === "more" && seatKind.has(String(q.post ?? q.seat))) { const pr = row(seatKind.get(String(q.post ?? q.seat))!); pr.seats.add(String(q.post ?? q.seat)); pr.requests++; }
        for (const l of rd.stdout.toString().split("\n")) {
          if (!l.includes('"acts"')) continue;
          const a = JSON.parse(l);
          if (a.table !== "acts" || (a.t ?? 0) < forkT) continue;
          const r = row(seatKind.get(String(a.post)) ?? String(a.post));
          r.seats.add(String(a.post));
          if (a.class === "within") r.within++; else add(r.beyond, String(a.class));
          add(tw.by_level, a.class === "within" ? String(a.level ?? "?") : a.class === "duplicate" ? "sent twice (a duplicate, a mistake)" : "beyond its remit");
          tw.by_assistants++;
          if (a.class !== "within" && a.class !== "duplicate") tw.beyond++; // (A duplicate is a mistake with a cost, never beyond the remit: 2026-11-17.)
        }
        // The log itself: matters handed to each seat, its requests for more, every paper in someone's name, and the remits.
        const out = join(scratch, `${sd}-${arm}.jsonl`);
        const ex = Bun.spawnSync([kernelBinary(), "export", log, "--out", out], { stdout: "pipe", stderr: "pipe" });
        if (ex.exitCode !== 0) throw new Error(`export ${log}: ${ex.stderr.toString().slice(0, 300)}`);
        const remits: any[] = [];
        for (const line of readFileSync(out, "utf8").split("\n")) {
          if (!line.includes('"recorded"')) continue;
          const e = JSON.parse(line);
          const r = e.body?.record;
          if (!r || r.record !== "statement") continue;
          const t = e.t ?? 0;
          if (r.kind === "remit" && typeof r.data?.kind === "string") remits.push({ ...r, at: t });
          if (t < forkT) continue;
          if (r.kind === "referral") {
            const seat = (r.addressed_to ?? []).find((x: string) => seatKind.has(x)) ?? [...seatKind.keys()].find((p) => /-desk$/.test(p) && (r.addressed_to ?? []).some((x: string) => p.startsWith(`${x}-`)));
            if (seat) { const pr = row(seatKind.get(seat)!); pr.seats.add(seat); pr.matters++; }
          }
          // (A paper in a town entity's name, other than the papers of delegation itself.)
          if (typeof r.speaks_for === "string" && town_.has(r.speaks_for) && !["referral", "draft", "sign_off", "declined", "report", "advice", "remit", "scope_request", "scope_answer", "approval_request", "go_ahead", "brief", "handover", "question", "question_answer", "forward"].includes(r.kind)) tw.papers++;
        }
        // Authority: each principal's newest remit of each kind at the fork and at the end, by level.
        remits.sort((a, b) => a.at - b.at);
        const levelAt = (t: number) => {
          const m = new Map<string, string>();
          for (const r of remits) if (r.at <= t && whose(String(r.speaks_for), String(r.data.kind))) m.set(`${r.speaks_for}|${r.data.kind}`, String(r.data.level));
          return m;
        };
        const atFork = levelAt(forkT), atEnd = levelAt(Infinity);
        const entry = (kind: string) => { const k = `${arm}|${kind}`; return authority.get(k) ?? authority.set(k, { arm, kind, principals: new Set(), fork: {}, end: {} }).get(k)!; };
        for (const [key, lv] of atFork) { const [who, kind] = key.split("|") as [string, string]; const a = entry(whose(who, kind)!); a.principals.add(`${who}|${whose(who, kind)}`); add(a.fork, lv); }
        for (const [key, lv] of atEnd) { const [who, kind] = key.split("|") as [string, string]; const a = entry(whose(who, kind)!); a.principals.add(`${who}|${whose(who, kind)}`); add(a.end, lv); }
      }
      // The episodes, by the seat's kind of post.
      for (const e of read.episodes.filter((x) => x.seed === Number(sd.slice(5)))) row2(posts, e.arm, seatKind.get(e.seat) ?? e.seat).episodes.push(e);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return { experiment: basename(dir), arms: read.arms, posts: [...posts.values()], authority: [...authority.values()].map((a) => ({ ...a, principals: a.principals.size })), town: [...town.values()] };
}

function row2(posts: Map<string, PostRow>, arm: string, kind: string): PostRow {
  const k = `${arm}|${kind}`;
  return posts.get(k) ?? posts.set(k, { arm, kind, seats: new Set(), matters: 0, within: 0, beyond: {}, requests: 0, episodes: [] }).get(k)!;
}

const levels = (c: Count) => LEVELS.concat(Object.keys(c).filter((k) => !LEVELS.includes(k))).filter((l) => c[l]).map((l) => `${l} ${c[l]}`).join(", ") || "-";

export function broadText(r: BroadRead): string {
  const out: string[] = [];
  const p = (...s: string[]) => out.push(...s);
  p(`# Assistants across the town: ${r.experiment}`, "");
  p("## 1. By kind of post", "", "| arm | kind of post | seats | matters | sent within the remit | sent beyond it, or sent twice (by class: duplicate is a mistake, never beyond) | requests for more | episodes | of which waited / asked for more / acted beyond | episodes' stake (papers naming a sum: count, total) |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const x of [...r.posts].sort((a, b) => (a.arm + a.kind < b.arm + b.kind ? -1 : 1))) {
    const by = (d: string) => x.episodes.filter((e) => e.did === d).length;
    const sums = x.episodes.map((e) => e.stake_cents).filter((c): c is number => c !== undefined);
    p(`| ${x.arm} | ${x.kind} | ${x.seats.size} | ${x.matters} | ${x.within} | ${Object.entries(x.beyond).map(([k, v]) => `${k} ${v}`).join(", ") || 0} | ${x.requests} | ${x.episodes.length} | ${by("waited")} / ${by("asked_for_more")} / ${by("acted_beyond")} | ${sums.length ? `${sums.length}, ${Math.round(sums.reduce((a, b) => a + b, 0) / 100).toLocaleString("en")}` : "-"} |`);
  }
  p("", "## 2. Authority held, by kind of post (its principals' kinds by level, at the fork and at the end)", "", "| arm | kind of post | principals | at the fork | at the end |", "|---|---|---|---|---|");
  for (const a of [...r.authority].sort((x, y) => (x.arm + x.kind < y.arm + y.kind ? -1 : 1))) p(`| ${a.arm} | ${a.kind} | ${a.principals} | ${levels(a.fork)} | ${levels(a.end)} |`);
  p("", "## 3. The town's papers after the fork", "", "| arm | papers in someone's name | written by an assistant's post | share | by the level it wrote at | beyond its remit |", "|---|---|---|---|---|---|");
  for (const t of r.town) p(`| ${t.arm} | ${t.papers} | ${t.by_assistants} | ${t.papers ? ((100 * t.by_assistants) / t.papers).toFixed(1) : "-"}% | ${levels(t.by_level)} | ${t.beyond} |`);
  p("", "(A paper in someone's name: any statement a town organisation or person speaks for, other than the papers of delegation itself (referrals, drafts, sign-offs, reports, remits, requests and answers). Written by an assistant's post: the acts reader's papers sent by a seat in its principal's name. Episodes: episodes.ts; at an organisation's seat only where its principal has an in-tray.)");
  return out.join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--out");
  const dirs = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
  if (!dirs.length) throw new Error("usage: bun experiments/scope-pilot/broad-report.ts <experiment folder> [...] [--out <file.md>]");
  const text = (await Promise.all(dirs.map(async (d) => broadText(await readBroad(d))))).join("\n\n");
  if (at >= 0) writeFileSync(args[at + 1]!, text + "\n");
  console.log(text);
}
