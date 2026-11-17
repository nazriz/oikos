// An assistant's matters, each with what became of it (docs/behaviour/assistants.md, "What it is shown").
//
// A seat that takes an assistant's post is shown the matters handed to the post and the answers to them (referrals,
// sign-offs, declines). What closed a matter is the post's own report, which sits in its file and is read only on
// request; so at the hand-over every matter its predecessor had finished looked open, each sign-off saying "send it as
// it stands" (the scope pilot's baseline, 2026-11-14: 55 sends of papers long since sent). A successor reads the file
// on arrival: this keeps what that reading of the post's own reports and advice finds (the whole file, page by page),
// then what the seat itself does after (its own confirmed papers), and sets out each matter still open with where it
// stands, the finished ones counted. The last report on a matter, done or not, is what it goes by: done, it is finished;
// not done, it stays on the list with the reason, until a later report says done or the client declines it. Nothing is asked of
// anyone else; nothing here says what to do. Code only, from the seat's own papers.
//
// What a client passed on about a matter (a `forward`: docs/behaviour/assistants.md, "What the client passes on") goes
// on the matter's line: the body's answer (a decision, an order, a reply), or what it asks for by a date. A matter with
// such a request still to answer keeps its line, finished or not, until the body answers or the date passes; a finished
// matter the body has answered keeps its line for a fortnight after the answer, so that the seat sees how it came out.

import type { Observation, Record as Paper } from "../contracts";
import { dateWords, parseDate } from "../forms";

const DAY = 86_400;
/** The most open matters set out; the rest are counted. */
const MOST = 40;
/** How many of one kind of paper one page of the reading of the file takes (it reads on until the file is exhausted):
 * the most one search gives (contracts/participant-api.schema.json, a query's `limit`). */
const PAGE = 200;
/** The kinds of the post's own papers read from its file on arrival: those that close a matter, and its drafts, so that a
 * matter its predecessor drafted is shown drafted (2026-11-17, the stakes rung 3: at the fork three matters the code seat
 * had drafted the day before were shown "no draft yet", the seat drafted them again, and the clients signed twice). */
const CLOSING = ["report", "advice", "draft"];
/** How long a finished matter's line stays after the body's answer came (a reader's choice, not the world's). */
const ANSWER_SHOWN = 14 * DAY;
/** How much of a body's paper's words its line carries. */
const WORDS = 240;

/** A body's paper a client passed on about a matter: an answer, or (with `due`) what it asks for by a date. */
interface Passed { id: string; at: number; by: string; text: string; due?: number }

interface Matter { id: string; at: number; kind: string; from: string; wants?: string; told?: string[]; replyTo?: string; words?: string; firstDraft?: number; mine?: number; refs?: { id: string; whose: string; in: string }[]; sits?: { every: number; next: number }; due?: { at: number; on: string }; advised?: number; signed?: { id: string; at: number; paper?: any }; declined?: number; draft?: number; sent?: number; sends?: { at: number; id?: string }[]; report?: { id?: string; at: number; done: boolean; why?: string }; answer?: Passed; asks?: Passed; cites?: string[] }

const ref = (r: Paper): string | undefined => (typeof (r as any).data?.referral === "string" ? (r as any).data.referral : undefined);
/** Data with its keys in order, and a list of ids as a set: one paper however its parts were written. */
const norm = (x: unknown): unknown => (Array.isArray(x) ? x.map(norm) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, norm((x as any)[k])])) : x);
const idSet = (x: unknown) => JSON.stringify((x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]).map(String).sort());
const same = (p: any, b: any) => p && p.kind === b.kind && idSet(p.to) === idSet(b.addressed_to) && JSON.stringify(norm(p.data ?? null)) === JSON.stringify(norm(b.data ?? null));
/** The day a paper a matter came from names, as its referral gives it (docs/design/stakes.md, C1). */
const dueOf = (d: any): { due?: { at: number; on: string } } => (Number.isSafeInteger(Number(d?.due)) && d?.due !== null && d?.due !== undefined && typeof d?.due_on === "string" ? { due: { at: Number(d.due), on: d.due_on } } : {});
/** The most cited papers looked up at one sitting. */
const LOOKUPS = 16;
/** The records a referral cites by id: its basis, and every record id among the details it gives (`facts`). */
const citesOf = (r: Paper): string[] => {
  const ids = new Set<string>();
  const b = (r as any).basis;
  for (const x of Array.isArray(b) ? b : typeof b === "string" ? [b] : []) if (/^rec\.[0-9]+$/.test(x)) ids.add(x);
  const walk = (v: unknown): void => { if (typeof v === "string") { if (/^rec\.[0-9]+$/.test(v)) ids.add(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "composed_on") walk(x); };
  walk((r as any).data?.facts);
  return [...ids];
};
/** A person's habit of getting to their post, as their referral states it ("We get to our post every 7 days, next on
 * year 1, day 14."): how many days apart, and the day of the sitting it names. None where it says none. */
const sitsOf = (text: string): { sits?: { every: number; next: number } } => {
  const m = /We get to our post every (day|([0-9]+) days), next on ([^.;]+(?:, day [0-9]+)?)\./.exec(text);
  if (!m) return {};
  const next = parseDate(m[3]!.trim());
  return Number.isFinite(next) ? { sits: { every: m[2] ? Number(m[2]) : 1, next } } : {};
};
/** What a client says on its hand-over of its own position and of how things stand with it (its kind's words and the
 * world's `situation`: principal.rs), every sentence of it, as it said them: set out on the matter's line, so that a
 * list that cuts a long hand-over short still shows them. Read from the hand-over's own `why`, less what the line sets
 * out apart (the papers it comes from, its sittings, the body's day); from its words where it gives none. */
const toldOf = (r: Paper): { told?: string[] } => {
  const why = (r as any).data?.why;
  const told = Array.isArray(why)
    ? why.filter((w: unknown): w is string => typeof w === "string").map((w) => w.trim()).filter((w) => w && !/^(?:It comes from |We get to our post )|\basks for this by .*\bdeal with our post\b/.test(w))
    : [...String((r as any).text ?? "").matchAll(/(?:In our account \(|Nothing regular is coming in|Coming in: |Our rent: |Our rates: |The office pays |Until the claim is decided ).*?\.(?=\s|$)/g)].map((m) => m[0].trim());
  return told.length ? { told } : {};
};
/** The record ids a paper's details name, at any depth. */
const idsIn = (v: unknown, out = new Set<string>()): Set<string> => {
  if (typeof v === "string") { if (/^rec\.[0-9]+$/.test(v)) out.add(v); } else if (Array.isArray(v)) v.forEach((x) => idsIn(x, out)); else if (v && typeof v === "object") Object.values(v).forEach((x) => idsIn(x, out));
  return out;
};
/** The papers a hand-over, or a paper passed on, names by their reference, for the paper it is to do (a claim to stop, a
 * request to answer, a decision to look at again): each with whose paper it is. A forward's: the body's; else the
 * client's. */
export function namedRefs(r: Paper): { id: string; whose: string }[] {
  const d = (r as any).data ?? {};
  const forward = (r as any).kind === "forward";
  const whose = forward ? String(d.by ?? "") : String((r as any).speaks_for ?? "");
  const src = forward ? JSON.stringify(d.data ?? {}) : `${JSON.stringify(d.facts ?? {})} ${String(d.calls ?? "")}`;
  const out = new Map<string, string>();
  for (const m of src.matchAll(/\\?"?\b(claim|about|against|request|decision|record)\\?"?\s*[:=]\s*\\?"?([a-z][a-z0-9-]*-[a-z0-9-]+|rec\.[0-9]+)/g)) out.set(m[2]!, whose);
  return [...out].map(([id, w]) => ({ id, whose: w }));
}
const isBack = (r: Paper) => (r as any).record === "statement" && ((r as any).kind === "paper_returned" || (r as any).kind === "authority_recorded");

export class Matters {
  private readonly matters = new Map<string, Matter>();
  /** When the seat arrived (its first sitting), once it has. */
  private arrived?: number;
  /** Matters finished before it arrived: left out of what it is shown as open. */
  private readonly before = new Set<string>();
  /** Papers sent back, and authorities recorded, before it arrived for clients with no matter open: left to the file. */
  private backBefore = 0;
  /** The reading of the file on arrival: for each kind, how far back it has read (newest first), how many a page
   * takes, and whether it is through. */
  private readonly reading = new Map(CLOSING.map((k) => [k, { until: undefined as number | undefined, past: false, done: false }]));
  private readonly readIds = new Set<string>();
  /** What the reading found, kept until the matters it is about are taken in (at the first sitting). */
  private readonly found: Paper[] = [];
  /** The time of the newest observation taken in. */
  private now = 0;
  /** Papers sent back to the post, by id: for whom and of what kind (`for|kind`), by whom, and whether for want of their
   * authority. Each a fact as it came, taken in once: a later look that shows the same paper again changes nothing (the
   * stakes run's rung 1 (situation), 2026-11-16: a look at a return of day 18 reset the line to "no recording ... has
   * reached you" three days after the recording had). */
  private readonly returns = new Map<string, { key: string; at: number; by: string; wanted: boolean; paper?: any }>();
  /** Authorities recorded for the post's clients, by id: for whom, by whom (none: the paper does not say). */
  private readonly recorded = new Map<string, { for: string; at: number; by?: string }>();
  /** Papers its clients passed on to it, by the forward's id: the body's paper it holds, and the matter it came on. */
  private readonly forwards = new Map<string, { paper: string; matter?: string }>();
  /** Its drafts, each with the records it names: what a reply's matter handed over later is told drafted by (one reply,
   * one matter: a draft made from the forward before the client handed the reply over). */
  private readonly drafts: { at: number; names: Set<string>; mine: boolean }[] = [];

  /** `matters`: the post's channel of matters handed to it; `file`: its own file, read on request. */
  /** Published papers its matters cite, looked up by id (`citedPath`): what was found, and every id asked for. */
  private readonly cited = new Map<string, Paper>();
  private readonly held = new Set<string>();
  private readonly askedFor = new Set<string>();
  /** Whether the next observation answers the reader's own look-ups (not one the seat made itself). */
  private looking = false;

  /** `matters`: the post's channel of matters handed to it; `file`: its own file, read on request; `cited`: the board of
   * published papers its matters may cite, looked up by id (MT-41). */
  constructor(readonly matterPath: string, readonly filePath: string, readonly citedPath?: string) {}

  /** The looks for the published papers that the matters handed over in this observation cite and the seat does not
   * hold, one by its id each (its principal named them in the hand-over: rung 1's third run, 2026-11-14, the factory's
   * invoices cited a buyer's offer its post could not read, and were never drafted). Each id is asked for once; a
   * search of a board, which takes what any such search takes. Empty where there is nothing to look up. */
  lookups(obs: Observation, holds: (id: string) => boolean): { channel: string; query: { where: { field: string; op: "="; value: string }[]; limit: number } }[] {
    if (!this.citedPath) return [];
    const ch = (obs.channels as any)?.[this.matterPath];
    const recs: Paper[] = ch?.kind === "records" ? ch.records ?? [] : [];
    const ids = recs.filter((r) => (r as any).record === "statement" && (r as any).kind === "referral").flatMap(citesOf).filter((id) => !holds(id) && !this.askedFor.has(id)).slice(0, LOOKUPS);
    for (const id of ids) this.askedFor.add(id);
    if (ids.length) this.looking = true;
    return ids.map((id) => ({ channel: this.citedPath!, query: { where: [{ field: "id", op: "=" as const, value: id }], limit: 1 } }));
  }

  /** Whether the file has yet to be read through (before the seat's first sitting). */
  get toRead(): boolean {
    return this.arrived === undefined && [...this.reading.values()].some((x) => !x.done);
  }
  /** The next page of the reading of the post's own file: for each kind not yet through, its papers newest first, from
   * where the last page ended. A search, which leaves the file as the seat has never looked at it. */
  read(): { channel: string; query: { where: { field: string; op: "=" | "<=" | "<"; value: string | number }[]; order: { field: string; desc: boolean }; limit: number } }[] {
    return [...this.reading].filter(([, x]) => !x.done).map(([kind, x]) => ({ channel: this.filePath,
      query: { where: [{ field: "kind", op: "=" as const, value: kind }, ...(x.until !== undefined ? [{ field: "at", op: x.past ? "<" as const : "<=" as const, value: x.until }] : [])], order: { field: "at", desc: true }, limit: PAGE } }));
  }
  /** A page of the reading taken in. A kind is through when its page came back short. A full page that brought nothing
   * new is a page of papers of one moment: the next goes on from before that moment (more than a page's worth of one
   * kind made in one moment would be passed over: none is). */
  absorbRead(obs: Observation): void {
    const ch = (obs.channels as any)?.[this.filePath];
    const recs: Paper[] = ch?.kind === "records" && ch.search ? ch.records ?? [] : [];
    for (const [kind, x] of this.reading) {
      if (x.done) continue;
      const rs = recs.filter((r) => (r as any).kind === kind);
      const fresh = rs.filter((r) => !this.readIds.has(r.id));
      for (const r of fresh) { this.readIds.add(r.id); this.found.push(r); }
      if (rs.length < PAGE) x.done = true;
      else if (!fresh.length) x.past = true;
      else { x.until = Math.min(...rs.map((r) => r.at)); x.past = false; }
    }
  }

  /** The reading given up (the file could not be looked at): what is known stands. */
  giveUp(): void {
    for (const x of this.reading.values()) x.done = true;
  }

  private take(r: Paper): void {
    if ((r as any).record !== "statement") return;
    const k = (r as any).kind as string;
    if (k === "referral") {
      if (!this.matters.has(r.id)) {
        const replyTo = typeof (r as any).data?.reply_to === "string" ? (r as any).data.reply_to as string : undefined;
        const m: Matter = { id: r.id, at: r.at, kind: String((r as any).data?.kind ?? "matter"), from: String((r as any).speaks_for ?? ""), words: String((r as any).text ?? ""), ...(typeof (r as any).data?.wants === "string" ? { wants: (r as any).data.wants } : {}), ...(replyTo ? { replyTo } : {}), ...dueOf((r as any).data), ...sitsOf(String((r as any).text ?? "")), ...toldOf(r), cites: citesOf(r), refs: namedRefs(r).map((x) => ({ ...x, in: r.id })) };
        // (A reply handed over after the seat drafted it from the forward: drafted, under this matter.)
        for (const x of this.drafts) if (this.repliesTo(x.names, m)) { this.drafted(m, x.at); if (x.mine) m.mine = Math.min(m.mine ?? x.at, x.at); }
        this.matters.set(r.id, m);
      }
      return;
    }
    const d = (r as any).data ?? {};
    if (k === "paper_returned" && typeof d.for === "string" && typeof d.paper?.kind === "string") {
      if (!this.returns.has(r.id)) this.returns.set(r.id, { key: `${d.for}|${d.paper.kind}`, at: r.at, by: String(d.by ?? (r as any).speaks_for ?? ""), wanted: !!d.need?.authority, paper: d.paper });
      return;
    }
    if (k === "authority_recorded" && typeof d.for === "string") {
      if (!this.recorded.has(r.id)) this.recorded.set(r.id, { for: d.for, at: r.at, ...(d.by !== undefined ? { by: String(d.by) } : {}) });
      return;
    }
    if (k === "forward") {
      if (typeof d.paper === "string") this.forwards.set(r.id, { paper: d.paper, ...(typeof d.matter === "string" ? { matter: d.matter } : {}) });
      const m = this.matters.get(typeof d.matter === "string" ? d.matter : "");
      if (!m) return;
      const due = [d.data?.by, d.data?.answer_by, d.data?.hearing_at].map(Number).find((x) => Number.isSafeInteger(x) && x > 0);
      const p: Passed = { id: String(d.paper ?? r.id), at: r.at, by: String(d.by ?? ""), text: String(d.text ?? ""), ...(due !== undefined ? { due } : {}) };
      // (The papers the passed-on paper names, for the matter: set out on its line where the seat holds no copy.)
      m.refs = [...(m.refs ?? []), ...namedRefs(r).map((x) => ({ ...x, in: r.id }))];
      if (due !== undefined) { if (!m.asks || m.asks.at <= r.at) m.asks = p; }
      else if (!m.answer || m.answer.at <= r.at) m.answer = p;
      return;
    }
    if (k === "draft") { this.ownDraft(idsIn(d), r.at, ref(r)); return; }
    // (A paper of a matter's that went from the post, on its record: said on the matter's line.)
    if (typeof (r as any).in_position === "string" && this.sentPaper(r, r.at, r.id)) return;
    const m = this.matters.get(ref(r) ?? "");
    if (!m) return;
    // (The latest of each kind of paper on a matter is what it goes by: the file is read newest first.)
    if (k === "sign_off" && (!m.signed || m.signed.at <= r.at)) m.signed = { id: r.id, at: r.at, paper: d.paper ?? (Array.isArray(d.papers) ? d.papers[0] : undefined) };
    else if (k === "declined") m.declined = Math.max(m.declined ?? r.at, r.at);
    else if (k === "report" && (!m.report || m.report.at <= r.at)) m.report = { id: r.id, at: r.at, done: d.done === true || d.done === "yes", ...(typeof d.why === "string" ? { why: d.why } : {}) };
    else if (k === "draft") this.drafted(m, r.at);
    else if (k === "advice") m.advised = Math.max(m.advised ?? r.at, r.at);
  }

  /** Whether a draft naming these records is of the reply a matter is: it names the body's paper the reply answers, or a
   * forward of it. */
  private repliesTo(names: Set<string>, m: Matter): boolean {
    if (!m.replyTo) return false;
    return names.has(m.replyTo) || [...names].some((id) => this.forwards.get(id)?.paper === m.replyTo);
  }
  private drafted(m: Matter, at: number): void {
    m.draft = Math.max(m.draft ?? at, at);
    m.firstDraft = Math.min(m.firstDraft ?? at, at);
  }
  /** A draft of its own, taken in (from its file or as it is done): on the matter it names, and on the reply it is of. */
  private ownDraft(names: Set<string>, at: number, referral?: string, mine = false): void {
    this.drafts.push({ at, names, mine });
    if (this.drafts.length > 400) this.drafts.shift();
    const m = this.matters.get(referral ?? "");
    const on = [...(m ? [m] : []), ...[...this.matters.values()].filter((x) => x !== m && this.repliesTo(names, x))];
    for (const x of on) { this.drafted(x, at); if (mine) x.mine = Math.min(x.mine ?? at, at); }
  }

  /** The hand-over, in its own words as the seat received it, of the matter on which a draft of the seat's own waited
   * longest for the client's sign-off: from the seat's first draft on it to the client's answer (a sign-off or a
   * decline), or to `now` where none came. None where no draft of its own waited on one (the debrief's `waiting`,
   * participants/src/llm/debrief.ts). Only a hand-over the seat itself received, at or after it took the post: one handed
   * to the post before (the run's opening days, under the code assistant) is in its file but was never handed to it.
   * (The stakes reruns of 2026-11-16: both desks were asked about c0014's benefit claim of day 1, rec.145, a matter
   * neither had held; a draft of their own on a later matter that answered the same paper had marked it.) */
  longestWait(now = this.now): string | undefined {
    let best: { wait: number; words: string } | undefined;
    for (const m of this.matters.values()) {
      if (m.mine === undefined || !m.words || m.at < (this.arrived ?? 0)) continue;
      const answered = [m.signed?.at, m.declined].filter((x): x is number => x !== undefined && x >= m.mine!);
      const wait = (answered.length ? Math.min(...answered) : now) - m.mine;
      if (wait > 0 && (!best || wait > best.wait)) best = { wait, words: m.words };
    }
    return best?.words;
  }

  private closed(m: Matter): boolean {
    return !!m.report?.done || m.declined !== undefined || (m.advised !== undefined && m.wants === "advice");
  }

  /** A request by a date still to be answered: the body has not answered since, and its date has not passed. */
  private asking(m: Matter): boolean {
    return !!m.asks && (!m.answer || m.answer.at < m.asks.at) && (m.asks.due ?? 0) >= Math.floor(this.now / DAY) * DAY;
  }

  /** Whether a matter has a line: open, asked something of by a date, or answered within the fortnight. */
  private shown(m: Matter): boolean {
    return !this.closed(m) || this.asking(m) || (!!m.answer && this.now - m.answer.at <= ANSWER_SHOWN);
  }

  /** What the seat is shown, taken in: the matters and their answers, and at its first sitting what its file says of
   * them (the reading of the file is not set out as a look: it is set out here instead). Returns the observation to
   * show: at the first sitting, the matters finished before the seat took the post, and the papers sent back on them,
   * left to the file. */
  absorb(obs: Observation): Observation {
    const chans = obs.channels as any;
    // (Every paper it has been shown, by id: what a reference named on a matter is told apart by.)
    for (const ch of Object.values(chans ?? {}) as any[]) if (ch?.kind === "records") for (const r of ch.records ?? []) this.held.add(r.id);
    const first = this.arrived === undefined;
    if (first) this.arrived = obs.t;
    this.now = Math.max(this.now, obs.t);
    const rec = (p: string): Paper[] => (chans?.[p]?.kind === "records" ? chans[p].records ?? [] : []);
    for (const r of rec(this.matterPath)) this.take(r);
    const others = Object.keys(chans ?? {}).filter((p) => p !== this.matterPath && p !== this.filePath);
    // (And the papers it sees that went from a post: a send on a matter, when it is one.)
    for (const p of others) for (const r of rec(p)) if (isBack(r) || typeof (r as any).in_position === "string") this.take(r);
    // (What the look-ups for cited papers found: kept, and set out with the matters that cite them, not as a look.)
    let o: Observation = obs;
    if (this.citedPath && this.looking && chans?.[this.citedPath]?.search) {
      this.looking = false;
      for (const r of rec(this.citedPath)) if (this.askedFor.has(r.id)) this.cited.set(r.id, r);
      const { [this.citedPath]: _gone, ...restCh } = chans;
      o = { ...obs, channels: restCh } as Observation;
    }
    if (!first) return o;
    return this.handOver(o);
  }

  private handOver(obs: Observation): Observation {
    const chans = obs.channels as any;
    const rec = (p: string): Paper[] => (chans?.[p]?.kind === "records" ? chans[p].records ?? [] : []);
    const others = Object.keys(chans ?? {}).filter((p) => p !== this.matterPath && p !== this.filePath);
    for (const r of this.found.splice(0)) this.take(r);
    for (const m of this.matters.values()) if (this.closed(m)) this.before.add(m.id);
    const out: any = { ...obs, channels: { ...chans } };
    if (chans?.[this.filePath]?.search) delete out.channels[this.filePath];
    if (chans?.[this.matterPath]) {
      const keep = (r: Paper) => !this.before.has(r.id) && !this.before.has(ref(r) ?? "");
      out.channels[this.matterPath] = { ...chans[this.matterPath], records: rec(this.matterPath).filter(keep) };
    }
    // (A paper sent back, or an authority recorded, for a client none of whose matters is still open.)
    const openFor = new Set([...this.matters.values()].filter((m) => !this.before.has(m.id)).map((m) => m.from));
    for (const p of others) {
      const rs = rec(p);
      if (!rs.some(isBack)) continue;
      const keep = rs.filter((r) => !isBack(r) || r.at >= obs.t || openFor.has(String((r as any).data?.for ?? "")));
      this.backBefore += rs.length - keep.length;
      out.channels[p] = { ...chans[p], records: keep };
    }
    return out;
  }

  /** What a look into the matters found that is on a matter already finished, said from the post's own papers on it.
   * The matters channel holds what was handed over and the answers, not the post's reports, so a look there set out a
   * finished matter and its "send it as it stands" with nothing to say it was done: rung 1's third run (2026-11-14),
   * where the factory's seat, told "None is open", looked since day 25, found two sign-offs from before it took the post,
   * tried four times to send them and issued a second delivery note for an order already delivered. Empty if none. */
  finishedIn(obs: Observation): string {
    const ch = (obs.channels as any)?.[this.matterPath];
    if (!ch?.search || ch.kind !== "records") return "";
    const day = (t: number) => dateWords(Math.floor(t / DAY) * DAY);
    const said = new Map<string, string>();
    for (const r of (ch.records ?? []) as Paper[]) {
      const m = this.matters.get((r as any).kind === "referral" ? r.id : ref(r) ?? "");
      if (!m || !this.closed(m) || said.has(m.id)) continue;
      const how = m.report ? `reported on${m.report.id ? ` in ${m.report.id}` : ""} on ${day(m.report.at)}${m.report.done ? "" : ", as not done"}` : m.declined !== undefined ? `declined on ${day(m.declined)}` : `advice given on ${day(m.advised!)}`;
      said.set(m.id, `${m.id} (${how}${this.before.has(m.id) ? ", before you took this post" : ""})`);
    }
    if (!said.size) return "";
    return `Of what you looked up in your matters, ${said.size === 1 ? "this matter is" : "these matters are"} finished, by your post's own papers on ${said.size === 1 ? "it" : "them"} in your file: ${[...said.values()].join("; ")}.`;
  }

  /** The seat's own confirmed acts (their blocks), when they are done: a draft, a report, a signed copy sent. */
  own(blocks: any[], t: number): void {
    for (const b of blocks) {
      if (b?.block !== "publish") continue;
      const m = this.matters.get(typeof b.data?.referral === "string" ? b.data.referral : "");
      if (b.kind === "report" && m) m.report = { at: t, done: b.data?.done === true || b.data?.done === "yes", ...(typeof b.data?.why === "string" ? { why: b.data.why } : {}) };
      else if (b.kind === "draft") this.ownDraft(idsIn(b.data), t, m?.id, true);
      else if (b.kind === "advice" && m) m.advised = t;
      else this.sentPaper(b, t);
    }
  }

  /** A paper the post sent that is a matter's (its signed paper, or the paper a body sent back on it): taken as a send
   * on that matter, once (its record, when it comes, takes the place of the seat's own confirmation of it). What has
   * gone on a matter is said on its line from these, not left to the seat's notebook (the 14-day check, 2026-11-17: a
   * desk's notebook lost "Re-sent rec.16612 and rec.16722", its matters said nothing of it, and it sent both again). */
  private sentPaper(b: any, at: number, id?: string): boolean {
    for (const m of this.matters.values()) {
      const backs = [...this.returns.values()].filter((x) => x.key === `${m.from}|${m.kind}` && x.paper);
      if (!(m.signed?.paper && same(m.signed.paper, b)) && !backs.some((x) => same(x.paper, b))) continue;
      const sends = (m.sends ??= []);
      if (id && sends.some((s) => s.id === id)) return true;
      const mine = id ? sends.findIndex((s) => !s.id && s.at <= at) : -1;
      if (mine >= 0) sends[mine] = { at, id };
      else sends.push({ at, ...(id ? { id } : {}) });
      sends.sort((a, c) => a.at - c.at);
      if (m.sent === undefined) m.sent = at;
      return true;
    }
    return false;
  }

  /** Each matter still open, with where it stands; the finished ones counted. Empty before the seat has any. */
  text(): string {
    if (!this.matters.size) return "";
    const day = (t: number) => dateWords(Math.floor(t / DAY) * DAY);
    const open: string[] = [];
    let done = 0;
    for (const m of [...this.matters.values()].sort((a, b) => a.at - b.at)) {
      // (Finished before the seat came, unless the body has since asked something by a date or answered.)
      if (this.before.has(m.id) && !this.asking(m) && !(m.answer && m.answer.at >= (this.arrived ?? 0) && this.shown(m))) continue;
      if (!this.shown(m)) { done++; continue; }
      // (The papers of this client's of this kind sent back, oldest first.)
      const rets = [...this.returns].filter(([, x]) => x.key === `${m.from}|${m.kind}`).map(([id, x]) => ({ id, ...x })).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
      // (A paper of this client's of this kind sent back after it was signed off: it went, and came back.)
      const back = m.signed ? rets.at(-1) : undefined;
      const returned = back && back.at >= m.signed!.at ? `; sent, and sent back by ${back.by} on ${day(back.at)} (${back.id})` : "";
      // (Sent back for want of their authority: whether a recording of it by that body has reached the post, said either
      // way: rung 1's first-sitting read, 2026-11-15, where matters stood "reported not done" with nothing on whether it
      // was ever given. A recording, once it has reached the post, is said for as long as the matter is open; a later
      // return by the same body for want of their authority is a fact of its own, said beside it.)
      const wanted = rets.filter((x) => x.wanted && x.at >= m.at).at(-1);
      const recs = wanted ? [...this.recorded].filter(([, x]) => x.for === m.from && (x.by === undefined || x.by === wanted.by)).map(([id, x]) => ({ id, ...x })).sort((a, b) => a.at - b.at) : [];
      const after = wanted ? recs.filter((x) => x.at >= wanted.at).at(-1) : undefined;
      const before = wanted ? recs.filter((x) => x.at < wanted.at).at(-1) : undefined;
      const authority = !wanted ? ""
        : after ? `; their authority with ${wanted.by} recorded on ${day(after.at)} (${after.id})`
        : before ? `; their authority with ${wanted.by} recorded on ${day(before.at)} (${before.id}), and sent back by ${wanted.by} for want of it after that, on ${day(wanted.at)} (${wanted.id})`
        : `; no recording of their authority with ${wanted.by} has reached you`;
      // (Their habit, as their referral states it, with their next sitting as of today.)
      const today = Math.floor(this.now / DAY) * DAY;
      const sits = m.sits ? (() => { const step = m.sits!.every * DAY; const first = Math.floor(m.sits!.next / DAY) * DAY; const k = first >= today ? 0 : Math.ceil((today - first) / step); return `; ${m.from} gets to their post ${m.sits!.every === 1 ? "every day" : `every ${m.sits!.every} days`}, next on ${day(first + k * step)}`; })() : "";
      const nothing = m.wants === "advice" ? "no advice given yet" : m.wants === "approve" ? "no request to go ahead yet" : m.wants === "alone" ? "not yet done" : "no draft yet";
      // (What has gone on it from the post, each send with its day and its record: "sent", or "sent again" for any after the
      // first or after a body sent it back.)
      const backAt = rets.map((x) => x.at);
      const gone = (m.sends ?? []).map((s, i) => `; ${i > 0 || backAt.some((b) => b <= s.at) ? "sent again" : "sent"} on ${day(s.at)}${s.id ? ` as ${s.id}` : " (as you confirmed it)"}`).join("");
      const where = m.signed
        // (Said as whose the report is: "not yet reported" read as a report to come from someone else, and a desk waited
        // for it on eleven matters it had sent (the stakes run's rung 1, 2026-11-15).)
        ? returned ? `signed off on ${day(m.signed.at)} (${m.signed.id})${returned}; you have not reported on it`
          : m.sent !== undefined ? `signed off on ${day(m.signed.at)} (${m.signed.id})${gone || `; sent on ${day(m.sent)}`}; you have not reported on it`
          // (Signed off before the seat took the post, and nothing of it seen since: whether it went is not known here.)
          : m.signed.at < (this.arrived ?? 0) ? `signed off on ${day(m.signed.at)} (${m.signed.id}), before you took this post; not reported on` : `signed off on ${day(m.signed.at)} (${m.signed.id}); not yet sent`
        : m.draft !== undefined ? `your draft went for sign-off on ${day(m.draft)}; no answer yet` : nothing;
      const named = m.due ? `; ${m.due.on} names ${day(m.due.at)}` : "";
      const said = (p: Passed) => {
        const w = p.text.replace(/\s+/g, " ").trim();
        return w.length > WORDS ? `${w.slice(0, WORDS).replace(/\s\S*$/, "")} ...` : w;
      };
      const reported = m.report ? `reported ${m.report.done ? "done" : "not done"} on ${day(m.report.at)}` : m.declined !== undefined ? `declined on ${day(m.declined)}` : "advice given";
      // (Reported not done, its last word on it: open, with the reason given.)
      const notDone = m.report && !m.report.done ? `reported not done on ${day(m.report.at)}${m.report.at < (this.arrived ?? 0) ? ", before you took this post" : ""}${m.report.why ? ` ("${said({ text: m.report.why } as Passed)}")` : ""}` : "";
      const stands = this.closed(m) ? reported : notDone || where;
      const answer = m.answer && (!m.asks || m.answer.at >= m.asks.at) ? `; ${m.answer.by}'s answer, passed on to you on ${day(m.answer.at)} (${m.answer.id}): "${said(m.answer)}"` : "";
      const asks = this.asking(m) ? `; ${m.asks!.by} asks for something by ${day(m.asks!.due!)}, passed on to you on ${day(m.asks!.at)} (${m.asks!.id}): "${said(m.asks!)}"` : "";
      // (The published papers it cites, as found: each set out with it, in its own words.)
      const cites = (m.cites ?? []).flatMap((id) => { const r = this.cited.get(id) as any; return r ? [`\n  It cites [${r.id}] ${String(r.kind).replace(/_/g, " ")} from ${r.speaks_for ?? r.author} (${day(r.at)}): "${said({ text: String(r.text ?? "") } as Passed)}"`] : []; }).join("");
      // (What the client said on the hand-over of its position and how things stand with it, every sentence, in its own
      // words, with the day it said them: its figures are as they were then.)
      const told = m.told?.length && !this.closed(m) ? `\n  On ${day(m.at)}, handing it over, ${m.from} said: ${m.told.join(" ")}` : "";
      // (A paper it names that the seat holds no copy of: whose own paper it is, and that it is cited as it stands. The
      // stakes run's rung 2b, 2026-11-15: five matters a desk would not draft for a claim it could not find on its file.)
      const unheld = (m.refs ?? []).filter((x) => !this.held.has(x.id) && x.id !== m.id);
      const refs = unheld.length && !this.closed(m) ? `\n  ${unheld.map((x) => `${x.id}: named in ${x.in}, from ${x.whose}; not on your file: cite it as it stands, by that reference`).join("; ")}` : "";
      const goneToo = stands === where && !!m.signed && !returned && m.sent !== undefined ? "" : gone;
      open.push(`- [${m.id}] ${m.kind.replace(/_/g, " ")}, handed over by ${m.from} on ${day(m.at)}: ${stands}${goneToo}${authority}${named}${answer}${asks}${this.closed(m) ? "" : sits}.${told}${refs}${cites}`);
    }
    const lines = ["Your matters, and where each stands (from your own papers on them, and what your clients passed on to you about them):", ...open.slice(0, MOST)];
    if (open.length > MOST) lines.push(`(And ${open.length - MOST} more open, older.)`);
    if (!open.length) lines.push("None is open.");
    if (done) lines.push(`${done} ${done === 1 ? "matter has" : "matters have"} been finished since you took this post (reported on, or done by whom it was for).`);
    if (this.before.size) lines.push(`${this.before.size} ${this.before.size === 1 ? "matter was" : "matters were"} finished before you took this post; ${this.before.size === 1 ? "it is" : "they are"} in your file${this.backBefore ? ", with the papers sent back on them" : ""}.`);
    return lines.join("\n");
  }
}
