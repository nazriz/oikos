// An assistant's matters, each with what became of it (docs/behaviour/assistants.md, "What it is shown").
//
// A seat that takes an assistant's post is shown the matters handed to the post and the answers to them (referrals,
// sign-offs, declines). What closed a matter is the post's own report, which sits in its file and is read only on
// request; so at the hand-over every matter its predecessor had finished looked open, each sign-off saying "send it as
// it stands" (the scope pilot's baseline, 2026-11-14: 55 sends of papers long since sent). A successor reads the file
// on arrival: this keeps what that reading of the post's own reports and advice finds (the whole file, page by page),
// then what the seat itself does after (its own confirmed papers), and sets out each matter still open with where it
// stands, the finished ones counted. The last report on a matter, done or not, is what it goes by. Nothing is asked of
// anyone else; nothing here says what to do. Code only, from the seat's own papers.

import type { Observation, Record as Paper } from "../contracts";
import { dateWords } from "../forms";

const DAY = 86_400;
/** The most open matters set out; the rest are counted. */
const MOST = 40;
/** How many of one kind of paper one page of the reading of the file takes (it reads on until the file is exhausted):
 * the most one search gives (contracts/participant-api.schema.json, a query's `limit`). */
const PAGE = 200;
/** The kinds of the post's own papers that close a matter, read from its file on arrival. */
const CLOSING = ["report", "advice"];

interface Matter { id: string; at: number; kind: string; from: string; wants?: string; advised?: number; signed?: { id: string; at: number; paper?: any }; declined?: number; draft?: number; sent?: number; report?: { id?: string; at: number; done: boolean } }

const ref = (r: Paper): string | undefined => (typeof (r as any).data?.referral === "string" ? (r as any).data.referral : undefined);
const same = (p: any, b: any) => p && p.kind === b.kind && JSON.stringify(p.to ?? []) === JSON.stringify(b.addressed_to ?? []) && JSON.stringify(p.data ?? null) === JSON.stringify(b.data ?? null);
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
  /** Papers sent back to the post, and authorities recorded for its clients, by whom they were for and the kind of paper. */
  private readonly back = new Map<string, { id: string; at: number; by: string; authority?: { id: string; at: number } }>();

  /** `matters`: the post's channel of matters handed to it; `file`: its own file, read on request. */
  constructor(readonly matterPath: string, readonly filePath: string) {}

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
      if (!this.matters.has(r.id)) this.matters.set(r.id, { id: r.id, at: r.at, kind: String((r as any).data?.kind ?? "matter"), from: String((r as any).speaks_for ?? ""), ...(typeof (r as any).data?.wants === "string" ? { wants: (r as any).data.wants } : {}) });
      return;
    }
    const d = (r as any).data ?? {};
    if (k === "paper_returned" && typeof d.for === "string" && typeof d.paper?.kind === "string") {
      this.back.set(`${d.for}|${d.paper.kind}`, { id: r.id, at: r.at, by: String(d.by ?? (r as any).speaks_for ?? "") });
      return;
    }
    if (k === "authority_recorded" && typeof d.for === "string") {
      for (const [key, b] of this.back) if (key.startsWith(`${d.for}|`) && b.at <= r.at) b.authority = { id: r.id, at: r.at };
      return;
    }
    const m = this.matters.get(ref(r) ?? "");
    if (!m) return;
    // (The latest of each kind of paper on a matter is what it goes by: the file is read newest first.)
    if (k === "sign_off" && (!m.signed || m.signed.at <= r.at)) m.signed = { id: r.id, at: r.at, paper: d.paper };
    else if (k === "declined") m.declined = Math.max(m.declined ?? r.at, r.at);
    else if (k === "report" && (!m.report || m.report.at <= r.at)) m.report = { id: r.id, at: r.at, done: d.done === true || d.done === "yes" };
    else if (k === "draft") m.draft = Math.max(m.draft ?? r.at, r.at);
    else if (k === "advice") m.advised = Math.max(m.advised ?? r.at, r.at);
  }

  private closed(m: Matter): boolean {
    return !!m.report || m.declined !== undefined || (m.advised !== undefined && m.wants === "advice");
  }

  /** What the seat is shown, taken in: the matters and their answers, and at its first sitting what its file says of
   * them (the reading of the file is not set out as a look: it is set out here instead). Returns the observation to
   * show: at the first sitting, the matters finished before the seat took the post, and the papers sent back on them,
   * left to the file. */
  absorb(obs: Observation): Observation {
    const chans = obs.channels as any;
    const first = this.arrived === undefined;
    if (first) this.arrived = obs.t;
    const rec = (p: string): Paper[] => (chans?.[p]?.kind === "records" ? chans[p].records ?? [] : []);
    for (const r of rec(this.matterPath)) this.take(r);
    const others = Object.keys(chans ?? {}).filter((p) => p !== this.matterPath && p !== this.filePath);
    for (const p of others) for (const r of rec(p)) if (isBack(r)) this.take(r);
    if (!first) return obs;
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

  /** The seat's own confirmed acts (their blocks), when they are done: a draft, a report, a signed copy sent. */
  own(blocks: any[], t: number): void {
    for (const b of blocks) {
      if (b?.block !== "publish") continue;
      const m = this.matters.get(typeof b.data?.referral === "string" ? b.data.referral : "");
      if (b.kind === "report" && m) m.report = { at: t, done: b.data?.done === true || b.data?.done === "yes" };
      else if (b.kind === "draft" && m) m.draft = t;
      else if (b.kind === "advice" && m) m.advised = t;
      else for (const x of this.matters.values()) if (x.signed && x.sent === undefined && same(x.signed.paper, b)) { x.sent = t; break; }
    }
  }

  /** Each matter still open, with where it stands; the finished ones counted. Empty before the seat has any. */
  text(): string {
    if (!this.matters.size) return "";
    const day = (t: number) => dateWords(Math.floor(t / DAY) * DAY);
    const open: string[] = [];
    let done = 0;
    for (const m of [...this.matters.values()].sort((a, b) => a.at - b.at)) {
      if (this.before.has(m.id)) continue;
      if (this.closed(m)) { done++; continue; }
      // (A paper of this client's of this kind sent back after it was signed off: it went, and came back.)
      const back = m.signed ? this.back.get(`${m.from}|${m.kind}`) : undefined;
      const returned = back && back.at >= m.signed!.at ? `; sent, and sent back by ${back.by} on ${day(back.at)} (${back.id})${back.authority ? `; their authority recorded on ${day(back.authority.at)} (${back.authority.id})` : ""}` : "";
      const nothing = m.wants === "advice" ? "no advice given yet" : m.wants === "approve" ? "no request to go ahead yet" : m.wants === "alone" ? "not yet done" : "no draft yet";
      const where = m.signed
        ? returned ? `signed off on ${day(m.signed.at)} (${m.signed.id})${returned}; not yet reported`
          : m.sent !== undefined ? `signed off on ${day(m.signed.at)} (${m.signed.id}); sent on ${day(m.sent)}; not yet reported`
          // (Signed off before the seat took the post, and nothing of it seen since: whether it went is not known here.)
          : m.signed.at < (this.arrived ?? 0) ? `signed off on ${day(m.signed.at)} (${m.signed.id}), before you took this post; not reported on` : `signed off on ${day(m.signed.at)} (${m.signed.id}); not yet sent`
        : m.draft !== undefined ? `your draft went for sign-off on ${day(m.draft)}; no answer yet` : nothing;
      open.push(`- [${m.id}] ${m.kind.replace(/_/g, " ")}, handed over by ${m.from} on ${day(m.at)}: ${where}.`);
    }
    const lines = ["Your matters, and where each stands (from your own papers on them):", ...open.slice(0, MOST)];
    if (open.length > MOST) lines.push(`(And ${open.length - MOST} more open, older.)`);
    if (!open.length) lines.push("None is open.");
    if (done) lines.push(`${done} ${done === 1 ? "matter has" : "matters have"} been finished since you took this post (reported on, or done by whom it was for).`);
    if (this.before.size) lines.push(`${this.before.size} ${this.before.size === 1 ? "matter was" : "matters were"} finished before you took this post; ${this.before.size === 1 ? "it is" : "they are"} in your file${this.backBefore ? ", with the papers sent back on them" : ""}.`);
    return lines.join("\n");
  }
}
