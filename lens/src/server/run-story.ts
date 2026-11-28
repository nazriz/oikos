// "What happened" in one run (#/data/<key>, its first tab): one account by world day, built only from the run's own log
// (its records, the mayor's turns, the drafts and sign-offs of what it asked for, appointments, refusals, the end) and
// the run's own files (results.json, the grade files for "cited by grader" markers). Nothing here judges: it puts the
// log's entries in order, joins each request to what it became (draft, sign-off, record, ballot, result, law), and
// gives every text as written. What the seat said in its debrief is not read here (VISION section 15): the debrief
// annotation and the debrief transcripts are skipped; the raw view's Debriefs tab shows what the study publishes.
//
// One pass over the log (the kernel's export) makes both this account and the raw view's records list, kept in Lens's
// cache (views/story, views/records), never under runs/.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunEntry } from "../shared/api";
import { ensureDir, kernelPath } from "./paths";
import { stampOf } from "./bundle";
import { logLines } from "../../../orchestrator/src/logs";

const DAY = 86_400;
/** Raised when the account's shape changes, so a cached account of the old shape is made again. */
const STORY_VERSION = 2;

export interface LogRecord { t: number; record: Record<string, any> }

/** What one pass over the log keeps for the account. */
export interface StoryRaw {
  seat: string;
  turns: { t: number; turn?: number; system?: string; system_sha256?: string; input: unknown; output: any[] }[];
  drafts: { t: number; draft: Record<string, any> }[];
  signoffs: { t: number; body: Record<string, any> }[];
  failures: { t: number; data: Record<string, any> }[];
  refused: { t: number; body: Record<string, any> }[];
  appointed: { t: number; body: Record<string, any> }[];
  end?: { t: number; body: Record<string, any> };
}

const passes = new Map<string, Promise<{ records: LogRecord[]; raw: StoryRaw }>>();
const recordsFile = (views: string, e: RunEntry) => join(views, "records", `${e.key}.${stampOf(e.bytes, e.mtimeMs)}.jsonl`);
const storyFile = (views: string, e: RunEntry) => join(views, "story", `${e.key}.${stampOf(e.bytes, e.mtimeMs)}.v${STORY_VERSION}.json`);

function writeAtomic(file: string, text: string) {
  const tmp = `${file}.part`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** One pass over a run's log: every record, and what the account needs. Writes the records cache as it goes. */
export function logPass(runsDir: string, views: string, e: RunEntry): Promise<{ records: LogRecord[]; raw: StoryRaw }> {
  const id = `${e.key}.${stampOf(e.bytes, e.mtimeMs)}`;
  let p = passes.get(id);
  if (p) return p;
  p = (async () => {
    if (!process.env.OIKOS_KERNEL) process.env.OIKOS_KERNEL = kernelPath();
    const records: LogRecord[] = [];
    const raw: StoryRaw = { seat: "", turns: [], drafts: [], signoffs: [], failures: [], refused: [], appointed: [] };
    const subjects = new Map<string, number>();
    for await (const line of logLines(join(runsDir, e.log))) {
      if (line.includes('"event":"recorded"')) {
        try {
          const l = JSON.parse(line);
          if (l?.body?.event === "recorded" && l.body.record) records.push({ t: Number(l.t ?? l.body.record.at ?? 0), record: l.body.record });
        } catch {}
        continue;
      }
      if (line.includes('"annotation":"transcript"')) {
        if (!line.includes('"purpose":"participant"')) continue; // (the translator's, the notebook's and the debrief's calls are not the mayor's turns)
        try {
          const l = JSON.parse(line);
          const d = l.body?.data;
          if (d?.purpose !== "participant") continue;
          const s = String(l.body.subject ?? "");
          subjects.set(s, (subjects.get(s) ?? 0) + 1);
          if (!raw.seat) raw.seat = s;
          raw.turns.push({ t: Number(l.t), turn: d.turn, system: typeof d.system === "string" ? d.system : undefined, system_sha256: d.system_sha256, input: d.input, output: Array.isArray(d.output) ? d.output : [] });
        } catch {}
        continue;
      }
      const ann = /"annotation":"(draft|signoff|translation_failure)"/.exec(line)?.[1];
      if (ann) {
        try {
          const l = JSON.parse(line);
          if (ann === "draft") raw.drafts.push({ t: Number(l.t), draft: l.body.draft });
          else if (ann === "signoff") raw.signoffs.push({ t: Number(l.t), body: l.body });
          else raw.failures.push({ t: Number(l.t), data: l.body.data ?? {} });
        } catch {}
        continue;
      }
      if (line.includes('"event":"appointed"')) {
        try { const l = JSON.parse(line); raw.appointed.push({ t: Number(l.t), body: l.body }); } catch {}
        continue;
      }
      if (raw.seat && line.includes('"event":"action_refused"') && line.includes(`"participant":"${raw.seat}"`)) {
        try { const l = JSON.parse(line); raw.refused.push({ t: Number(l.t), body: l.body }); } catch {}
        continue;
      }
      if (line.includes('"kind":"end"')) {
        try { const l = JSON.parse(line); if (l.kind === "end") raw.end = { t: Number(l.t), body: l.body }; } catch {}
      }
    }
    if (subjects.size > 1) raw.seat = [...subjects].sort((a, b) => b[1] - a[1])[0]![0];
    ensureDir(join(views, "records"));
    writeAtomic(recordsFile(views, e), records.map((r) => JSON.stringify(r)).join("\n"));
    return { records, raw };
  })();
  passes.set(id, p);
  p.then(() => passes.delete(id), () => passes.delete(id));
  return p;
}

/** The run's records from the cache, else from a pass over the log. */
export async function cachedRecords(runsDir: string, views: string, e: RunEntry): Promise<LogRecord[]> {
  const f = recordsFile(views, e);
  if (existsSync(f)) return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LogRecord);
  return (await logPass(runsDir, views, e)).records;
}

// ---------------------------------------------------------------------------------------------------------------
// The account.

export type Cat = "sittings" | "laws" | "budgets" | "ballots" | "directions" | "agreements" | "appointments" | "letters" | "notebook" | "election" | "news";

export interface RecRef { id: string; kind: string; t: number; author?: string; speaks_for?: string; text: string; data?: unknown }
export interface Vote { yes?: number; no?: number; passed?: boolean; voted_for: string[]; voted_against: string[]; not_voting: string[]; text: string; id: string; t: number }

export type Item =
  | { kind: "shown"; sections: { title: string; text: string }[] }
  | { kind: "came_back"; to: string; asked?: string; text: string }
  | { kind: "wrote"; text: string }
  | { kind: "looked"; what: string[] }
  | { kind: "request"; what: string; why?: string; tool: string; draft?: { id: string; summary?: string; call?: string }; signoff?: { decision: string; note?: string; t: number }; failure?: string; made: RecRef[]; refused: { t: number; code?: string; detail?: string }[]; outcome?: Outcome[] }
  | { kind: "confirm"; ref?: string; decision?: string; note?: string }
  | { kind: "notebook"; input: Record<string, unknown> }
  | { kind: "letter"; input: Record<string, unknown> }
  | { kind: "tool"; name: string; input: unknown }
  | { kind: "done" };

/** What became of a record the mayor made: the ballot on it, the ballot's result, and the law or budget made. */
export interface Outcome { ballot?: RecRef; result?: Vote; made: RecRef[] }

export type Entry =
  | { type: "sitting"; t: number; end: number; turns: number; continued?: boolean; items: (Item & { cats: Cat[] })[] }
  | { type: "record"; t: number; rec: RecRef; cats: Cat[]; vote?: Vote; outcome?: Outcome }
  | { type: "appointment"; t: number; position: string; holder?: string; by?: string; cats: Cat[] };

export interface Story {
  seat: string;
  /** The standing instructions as sent (the system prompt): the opening, the whole, and each later change to it as the
   * lines it added and took away. */
  told: { opening: string; full: string; first_t?: number; changed: { t: number; added: string[]; removed: string[] }[] };
  glance: {
    first_turn?: number; last_turn?: number; turns: number; sittings: number;
    end?: { t: number; reason?: string; detail?: string };
    results?: { t?: number; stopped?: unknown; framing?: unknown; debrief?: unknown; limitUsd?: unknown; untilDay?: unknown; forkDay?: unknown };
    election?: { notice?: RecRef; poll_at?: number; nominations_close_at?: number; nominations: { who: string; name: string; id: string; t: number; text: string }[]; result?: { rec: RecRef; winner?: string; winner_name?: string; rounds: { who: string; name: string; votes: number }[][]; electors?: number; formal?: number; turnout_bps?: number } };
    counts: Record<string, number>;
    requests: { asked: number; drafted: number; confirmed: number; declined: number; failed: number; refused: number; letters: number };
  };
  days: { day: number; entries: Entry[] }[];
}

/** A grader's day-and-quote entry, and where its quote is in the account: [day index, entry index, item index]. */
export interface Cite { grader: string; section: string; n: number; day?: number; quote: string; at?: [number, number, number?] }

const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((x: any) => (typeof x === "string" ? x : x?.text ?? "")).join("\n") : c == null ? "" : JSON.stringify(c));
const ref = (r: LogRecord): RecRef => ({ id: String(r.record.id), kind: kindOf(r.record), t: r.t, author: r.record.author, speaks_for: r.record.speaks_for, text: String(r.record.text ?? r.record.terms?.text ?? ""), data: r.record.data ?? r.record.terms });

/** The in-tray a sitting opened with, in its own sections ("## ..."), as written. */
function sectionsOf(s: string): { title: string; text: string }[] {
  const out: { title: string; text: string }[] = [];
  let title = "", buf: string[] = [];
  const flush = () => { const t = buf.join("\n").trim(); if (t || title) out.push({ title, text: t }); };
  for (const line of s.split("\n")) {
    const m = /^## (.+)$/.exec(line);
    if (m) { flush(); title = m[1]!; buf = []; } else buf.push(line);
  }
  flush();
  return out;
}

/** A council ballot's result: the count and each councillor's vote, as the clerk recorded them. */
function voteOf(r: LogRecord): Vote {
  const d = r.record.data ?? {};
  const text = String(r.record.text ?? "");
  const nv = /not voting: ([^.;]+)/.exec(text)?.[1];
  return {
    id: String(r.record.id), t: r.t, text, yes: d.yes, no: d.no, passed: d.passed,
    voted_for: Array.isArray(d.voted_for) ? d.voted_for.map(String) : [],
    voted_against: Array.isArray(d.voted_against) ? d.voted_against.map(String) : [],
    not_voting: nv && nv.trim() !== "none" ? nv.split(",").map((x) => x.trim()).filter(Boolean) : [],
  };
}

const LAWISH = new Set(["law"]);
/** A record's kind as the log names it: its kind, else what sort of record it is (an agreement, a signature). */
const kindOf = (r: Record<string, any>) => String(r.kind ?? r.record ?? "?");
function catsOfRecord(r: Record<string, any>, seat: string): Cat[] {
  const k = kindOf(r);
  const d = r.data ?? {};
  const out: Cat[] = [];
  if (LAWISH.has(k) || (k === "proposal" && d.kind === "law")) out.push("laws");
  if (k === "budget" || (k === "proposal" && d.kind === "budget")) out.push("budgets");
  if (k === "proposal" && !out.length) out.push("laws");
  if (k === "ballot" || k === "ballot_result") out.push(d.office ? "election" : "ballots");
  if (k === "direction" || k === "withdrawal") out.push("directions");
  if (k === "agreement") out.push("agreements");
  if (["election_notice", "nomination", "campaign_paper", "electoral_roll"].includes(k) || (k === "news" && d.kind === "poll")) out.push("election");
  if (k === "news") out.push("news");
  if (k === "petition_response" || k === "staff_briefing" || (r.author === seat && !out.length)) out.push("letters");
  return out.length ? out : ["news"];
}

/** Which records the account shows: everything the mayor made, the council's and the election's records, the paper,
 * and the office's briefings and letters to the mayor. The rest of the log is in the raw view's Records tab. */
// (A withdrawal is shown only when the mayor wrote it: the rest are job postings filled.)
const SHOWN = new Set(["proposal", "ballot", "ballot_result", "law", "budget", "direction", "election_notice", "nomination", "campaign_paper", "news", "staff_briefing", "petition_response", "petition"]);
function shownRecord(r: Record<string, any>, seat: string): boolean {
  const k = kindOf(r);
  if (k === "signature") return false; // (an agreement's signatures are in the Records tab; the agreement is shown)
  if (r.author === seat) return true;
  if (k === "ballot_result" && r.data?.electorate === undefined && !r.data?.office && !String(r.text ?? "").includes("councillor")) return false; // (a union's ballot)
  if (k === "ballot" && r.data?.electorate && r.data.electorate !== "council") return false;
  if (k === "petition") return false; // (shown when the mayor answers one, as the basis of its response)
  if (k === "staff_briefing") return JSON.stringify(r.addressed_to ?? r.to ?? "").includes("mayor") || String(r.text ?? "").startsWith("Weekly briefing");
  return SHOWN.has(k);
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’“”"']/g, "").replace(/…|\.\.\./g, " ").replace(/\s+/g, " ").trim();

/** The account, from one pass's records and what it kept, the arm's results entry, and its grade files. */
export function buildStory(records: LogRecord[], raw: StoryRaw, extra: { results?: Record<string, any>; spec?: Record<string, any> } = {}): Story {
  const seat = raw.seat;
  const byId = new Map<string, LogRecord>();
  const byBasis = new Map<string, LogRecord[]>();
  for (const r of records) {
    byId.set(String(r.record.id), r);
    const b = r.record.basis;
    if (typeof b === "string") (byBasis.get(b) ?? byBasis.set(b, []).get(b)!).push(r);
  }
  // (What became of a proposal: the ballot whose basis it is, that ballot's result, and the law or budget made on it.)
  const outcomeOf = (id: string): Outcome | undefined => {
    const ballot = (byBasis.get(id) ?? []).find((x) => x.record.kind === "ballot");
    if (!ballot) return undefined;
    const after = byBasis.get(String(ballot.record.id)) ?? [];
    const res = after.find((x) => x.record.kind === "ballot_result");
    return { ballot: ref(ballot), result: res ? voteOf(res) : undefined, made: after.filter((x) => x.record.kind !== "ballot_result").map(ref) };
  };

  // The mayor's own records, in order, for joining each request to what it made.
  const mine = records.filter((r) => r.record.author === seat);
  const used = new Set<string>();
  const signoffOf = new Map(raw.signoffs.filter((s) => s.body.participant === seat || !s.body.participant).map((s) => [String(s.body.draft), s]));
  const failureOf = new Map(raw.failures.map((f) => [String(f.data.draft ?? ""), f]));
  const draftsLeft = raw.drafts.filter((d) => !d.draft?.participant || d.draft.participant === seat);
  const refusedLeft = [...raw.refused];

  const madeBy = (d: { t: number; draft: Record<string, any> }, from: number): RecRef[] => {
    const blocks: any[] = Array.isArray(d.draft.blocks) ? d.draft.blocks : [];
    const out: RecRef[] = [];
    for (const b of blocks) {
      const want = String(b.text ?? "");
      const hit = mine.find((r) => !used.has(String(r.record.id)) && r.t >= from && (want ? String(r.record.text ?? "") === want : r.record.kind === b.kind))
        ?? mine.find((r) => !used.has(String(r.record.id)) && r.t >= from && r.record.kind === b.kind);
      if (hit) { used.add(String(hit.record.id)); out.push(ref(hit)); }
    }
    return out;
  };

  // Sittings: a sitting opens with the in-tray (a turn whose input is text) and runs through the turns that answer its
  // tool calls.
  const sittings: Extract<Entry, { type: "sitting" }>[] = [];
  const toolName = new Map<string, { name: string; input: any }>();
  let cur: Extract<Entry, { type: "sitting" }> | undefined;
  const requestsByTool = new Map<string, Extract<Item, { kind: "request" }>>();
  let systemSha: string | undefined, systemText = "", firstT: number | undefined;
  const changed: { t: number; added: string[]; removed: string[] }[] = [];
  let lastSystem = "";
  for (const turn of raw.turns) {
    if (turn.system !== undefined) {
      if (!systemText) { systemText = turn.system; firstT = turn.t; lastSystem = turn.system; }
      else if (turn.system !== lastSystem && turn.system_sha256 !== systemSha) {
        const was = new Set(lastSystem.split("\n")), now = new Set(turn.system.split("\n"));
        changed.push({ t: turn.t, added: [...now].filter((l) => !was.has(l)), removed: [...was].filter((l) => !now.has(l)) });
        lastSystem = turn.system;
      }
      systemSha = turn.system_sha256 ?? systemSha;
    }
    const opens = typeof turn.input === "string" || !cur;
    // (A sitting that runs into the next world day goes on under that day, marked as continued.)
    const nextDay = !opens && Math.floor(turn.t / DAY) !== Math.floor(cur!.t / DAY);
    if (opens || nextDay) {
      cur = { type: "sitting", t: turn.t, end: turn.t, turns: 0, items: [], ...(nextDay ? { continued: true } : {}) };
      sittings.push(cur);
    }
    const s = cur!;
    s.turns++;
    s.end = turn.t;
    // What came in.
    if (typeof turn.input === "string") s.items.push({ kind: "shown", sections: sectionsOf(turn.input), cats: ["sittings"] });
    else if (Array.isArray(turn.input)) {
      for (const r of turn.input as any[]) {
        if (r?.type === "tool_result") {
          const tu = toolName.get(String(r.tool_use_id));
          const name = tu?.name ?? "?";
          if (name === "done_for_now" || name === "notebook") continue;
          const asked = name === "look" ? [tu?.input?.report, tu?.input?.about ?? tu?.input?.words ?? (tu?.input?.named ? tu.input.named.join(", ") : tu?.input?.find ? JSON.stringify(tu.input.find) : undefined)].filter(Boolean).join(" ") : undefined;
          s.items.push({ kind: "came_back", to: name, asked, text: textOf(r.content), cats: [name === "write" ? "letters" : "sittings"] });
        } else if (r?.type === "text" && String(r.text ?? "").trim()) s.items.push({ kind: "shown", sections: sectionsOf(String(r.text)), cats: ["sittings"] });
      }
    }
    // What it wrote and did.
    const looked: string[] = [];
    for (const b of turn.output) {
      if (b?.type === "text" && String(b.text ?? "").trim()) { s.items.push({ kind: "wrote", text: String(b.text), cats: ["sittings"] }); continue; }
      if (b?.type !== "tool_use") continue;
      toolName.set(String(b.id), { name: String(b.name), input: b.input });
      const i = b.input ?? {};
      if (b.name === "look") { looked.push([i.report, i.about ?? i.words ?? (Array.isArray(i.named) ? i.named.join(", ") : i.find ? JSON.stringify(i.find) : "")].filter(Boolean).join(" ")); continue; }
      if (b.name === "done_for_now") { s.items.push({ kind: "done", cats: ["sittings"] }); continue; }
      if (b.name === "notebook") { s.items.push({ kind: "notebook", input: i, cats: ["notebook"] }); continue; }
      if (b.name === "confirm") { s.items.push({ kind: "confirm", ref: i.ref, decision: i.decision, note: i.note, cats: ["sittings"] }); continue; }
      if (b.name === "do" || b.name === "write") {
        const what = String(b.name === "do" ? i.what ?? JSON.stringify(i) : i.text ?? "");
        const req: Extract<Item, { kind: "request" }> = { kind: "request", tool: String(b.name), what, why: i.why, made: [], refused: [] };
        if (b.name === "write") s.items.push({ kind: "letter", input: i, cats: ["letters"] });
        // (The draft the translator wrote for it: its proposal is the request's own words.)
        const di = draftsLeft.findIndex((d) => d.t >= turn.t - DAY && (String(d.draft.proposal ?? "") === what || (b.name === "write" && String(d.draft.proposal ?? "").includes(what.slice(0, 80)))));
        if (di >= 0) {
          const d = draftsLeft.splice(di, 1)[0]!;
          req.draft = { id: String(d.draft.id), summary: d.draft.summary, call: d.draft.call };
          const so = signoffOf.get(String(d.draft.id));
          if (so) {
            req.signoff = { decision: String(so.body.decision), note: so.body.note, t: so.t };
            if (so.body.decision === "accept") req.made = madeBy(d, so.t);
          }
          const f = failureOf.get(String(d.draft.id));
          if (f) req.failure = String(f.data.reason ?? f.data.error ?? f.data.detail ?? JSON.stringify(f.data));
          // (Refusals of the act once confirmed: the kernel's, by time.)
          if (req.signoff && !req.made.length) {
            const ri = refusedLeft.findIndex((x) => x.t >= req.signoff!.t && x.t <= req.signoff!.t + DAY);
            if (ri >= 0) { const x = refusedLeft.splice(ri, 1)[0]!; req.refused.push({ t: x.t, code: x.body.code, detail: x.body.detail }); }
          }
        }
        const outs = req.made.map((m) => outcomeOf(m.id)).filter((o): o is Outcome => Boolean(o));
        if (outs.length) req.outcome = outs;
        const cats = new Set<Cat>(b.name === "write" ? ["letters"] : ["sittings"]);
        for (const m of req.made) for (const c of catsOfRecord(byId.get(m.id)?.record ?? { kind: m.kind }, seat)) cats.add(c);
        if (b.name === "do") s.items.push({ ...req, cats: [...cats] });
        else { const last = s.items[s.items.length - 1] as any; Object.assign(last, { request: req }); }
        requestsByTool.set(String(b.id), req);
        continue;
      }
      s.items.push({ kind: "tool", name: String(b.name), input: i, cats: ["sittings"] });
    }
    if (looked.length) s.items.push({ kind: "looked", what: looked, cats: ["sittings"] });
  }

  // The records the account shows, and the appointments to the town's posts.
  const entries: Entry[] = [...sittings];
  for (const r of records) {
    if (!shownRecord(r.record, seat)) continue;
    const k = String(r.record.kind);
    const e: Extract<Entry, { type: "record" }> = { type: "record", t: r.t, rec: ref(r), cats: catsOfRecord(r.record, seat) };
    if (k === "ballot_result" && !r.record.data?.office) e.vote = voteOf(r);
    if (k === "proposal") e.outcome = outcomeOf(String(r.record.id));
    entries.push(e);
  }
  const townPosts = new Set<string>(["mayor"]);
  for (const r of records) if (r.record.in_position && ["city", "electoral-commission"].includes(String(r.record.speaks_for))) townPosts.add(String(r.record.in_position));
  for (const a of raw.appointed) {
    const pos = String(a.body.position ?? "");
    if (!townPosts.has(pos) && !/^councillor/.test(pos) && a.body.by !== seat && a.body.holder !== seat) continue;
    entries.push({ type: "appointment", t: a.t, position: pos, holder: a.body.holder, by: a.body.by, cats: ["appointments"] });
  }
  entries.sort((a, b) => a.t - b.t);

  // Days.
  const days: Story["days"] = [];
  for (const e of entries) {
    const day = Math.floor(e.t / DAY) + 1;
    if (!days.length || days[days.length - 1]!.day !== day) days.push({ day, entries: [] });
    days[days.length - 1]!.entries.push(e);
  }

  // At a glance.
  const counts: Record<string, number> = {};
  // (The mayor's own records by kind, and the council's and the election's.)
  for (const r of records) if (r.record.author === seat || ["law", "budget", "ballot_result", "proposal", "direction", "nomination"].includes(kindOf(r.record))) counts[kindOf(r.record)] = (counts[kindOf(r.record)] ?? 0) + 1;
  const reqs = sittings.flatMap((s) => s.items.flatMap((i: any) => (i.kind === "request" ? [i] : i.request ? [i.request] : [])));
  const notice = records.find((r) => r.record.kind === "election_notice" && r.record.data?.office === "mayor");
  const noms = records.filter((r) => r.record.kind === "nomination" && (r.record.data?.office ?? "mayor") === "mayor");
  const nameOf = new Map<string, string>();
  for (const n of noms) {
    const who = n.record.author === seat ? seat : String(n.record.author ?? "");
    nameOf.set(who, String(n.record.data?.name ?? n.record.speaks_for ?? who));
  }
  const res = records.find((r) => r.record.kind === "ballot_result" && r.record.data?.office === "mayor");
  const rd = res?.record.data ?? {};
  const results = extra.results ?? {};
  return {
    seat,
    told: { opening: systemText.split(/\nYou act as /)[0]!.trim(), full: systemText, first_t: firstT, changed },
    glance: {
      first_turn: raw.turns[0]?.t, last_turn: raw.turns[raw.turns.length - 1]?.t, turns: raw.turns.length, sittings: sittings.length,
      end: raw.end ? { t: raw.end.t, reason: raw.end.body.reason, detail: raw.end.body.detail } : undefined,
      results: { t: results.t, stopped: results.stopped, framing: results.framing, debrief: results.debrief, limitUsd: results.limitUsd, untilDay: extra.spec?.untilDay, forkDay: extra.spec?.forkDay },
      election: notice || res || noms.length ? {
        notice: notice ? ref(notice) : undefined, poll_at: notice?.record.data?.poll_at, nominations_close_at: notice?.record.data?.nominations_close_at,
        nominations: noms.map((n) => ({ who: String(n.record.author === seat ? seat : n.record.author), name: String(n.record.data?.name ?? ""), id: String(n.record.id), t: n.t, text: String(n.record.text ?? "") })),
        result: res ? {
          rec: ref(res), winner: rd.winner, winner_name: nameOf.get(String(rd.winner)) ?? rd.winner,
          rounds: (Array.isArray(rd.rounds) ? rd.rounds : []).map((round: Record<string, number>) => Object.entries(round).sort((a, b) => b[1] - a[1]).map(([who, votes]) => ({ who, name: nameOf.get(who) ?? who.replace(/-self$/, ""), votes }))),
          electors: rd.electors, formal: rd.formal, turnout_bps: rd.turnout_bps,
        } : undefined,
      } : undefined,
      counts,
      requests: {
        asked: reqs.filter((r) => r.tool === "do").length, letters: reqs.filter((r) => r.tool === "write").length, drafted: reqs.filter((r) => r.draft).length,
        confirmed: reqs.filter((r) => r.signoff?.decision === "accept").length, declined: reqs.filter((r) => r.signoff && r.signoff.decision !== "accept").length,
        failed: reqs.filter((r) => r.failure).length, refused: reqs.filter((r) => r.refused.length).length,
      },
    },
    days,
  };
}

/** "Cited by grader": each grade file's day-and-quote entries, placed on the entry whose words hold the quote (the
 * nearest such day first). The grade files can change apart from the log, so this is done on each request. */
export function placeCites(story: Story, grades: { grader: string; grade: Record<string, any> }[]): Cite[] {
  const out: Cite[] = [];
  for (const g of grades) {
    const gr = g.grade ?? {};
    const add = (section: string, list: any[]) => list.forEach((x, n) => { if (x && typeof x.quote === "string" && x.quote.trim()) out.push({ grader: g.grader, section, n, day: typeof x.day === "number" ? x.day : undefined, quote: x.quote }); });
    for (const tier of ["1", "2", "3"]) add(`tier ${tier}`, Array.isArray(gr.tiers?.[tier]?.evidence) ? gr.tiers[tier].evidence : []);
    add("entrenchment", Array.isArray(gr.entrenchment) ? gr.entrenchment : []);
    add("misleading", Array.isArray(gr.misleading) ? gr.misleading : []);
    add("preview declines", Array.isArray(gr.preview_declines) ? gr.preview_declines : []);
    for (const s of ["refusal", "resignation"]) if (gr[s]?.present) add(s, [gr[s]]);
  }
  for (const c of out) {
    const q = norm(c.quote).slice(0, 120);
    if (q.length < 8) continue;
    // (The packet numbers days from 0, as the graders saw them: its "Day 140" is the world's day 141.)
    const near = (d: number) => (c.day === undefined ? 0 : Math.abs(story.days[d]!.day - 1 - c.day));
    const order = story.days.map((_, i) => i).sort((a, b) => near(a) - near(b));
    outer: for (const di of order) {
      const entries = story.days[di]!.entries;
      for (let ei = 0; ei < entries.length; ei++) {
        const e = entries[ei]!;
        if (e.type === "sitting") {
          for (let ii = 0; ii < e.items.length; ii++) if (norm(itemText(e.items[ii]!)).includes(q)) { c.at = [di, ei, ii]; break outer; }
        } else if (e.type === "record" && norm(e.rec.text).includes(q)) { c.at = [di, ei]; break outer; }
      }
    }
  }
  return out;
}

/** An item's words, for finding a grader's quote in it. */
function itemText(it: Item & { request?: any }): string {
  switch (it.kind) {
    case "wrote": return it.text;
    case "request": return [it.what, it.why ?? "", ...it.made.map((m) => m.text)].join(" \n ");
    case "notebook": case "letter": case "tool": return JSON.stringify(it.kind === "tool" ? it.input : it.input).replace(/\\n/g, " ");
    case "confirm": return it.note ?? "";
    case "came_back": return it.text;
    default: return "";
  }
}

const storyMem = new Map<string, Promise<Story>>();
/** The account of a run, from the cache, else made (one pass over the log) and kept. */
export function runStory(runsDir: string, views: string, e: RunEntry, extra: () => Parameters<typeof buildStory>[2]): Promise<Story> {
  const f = storyFile(views, e);
  let p = storyMem.get(f);
  if (p) return p;
  p = (async () => {
    if (existsSync(f)) {
      const s = JSON.parse(readFileSync(f, "utf8")) as Story;
      return s;
    }
    const { records, raw } = await logPass(runsDir, views, e);
    const s = buildStory(records, raw, extra());
    ensureDir(join(views, "story"));
    writeAtomic(f, JSON.stringify(s));
    return s;
  })();
  storyMem.set(f, p);
  p.catch(() => storyMem.delete(f));
  while (storyMem.size > 3) storyMem.delete(storyMem.keys().next().value!);
  return p;
}
