// An assistant's matters, each with what became of it (docs/behaviour/assistants.md, "What it is shown").
//
// A seat that takes an assistant's post is shown the matters handed to the post and the answers to them (referrals,
// sign-offs, declines). What closed a matter is the post's own report, which sits in its file and is read only on
// request; so at the hand-over every matter its predecessor had finished looked open, each sign-off saying "send it as
// it stands" (the scope pilot's baseline, 2026-11-14: 55 sends of papers long since sent). A successor reads the file
// on arrival: this keeps what that one reading of the post's own reports finds, then what the seat itself does after
// (its own confirmed papers), and sets out each matter still open with where it stands, the finished ones counted.
// Nothing is asked of anyone else; nothing here says what to do. Code only, from the seat's own papers.

import type { Observation, Record as Paper } from "../contracts";
import { dateWords } from "../forms";

const DAY = 86_400;
/** The most open matters set out; the rest are counted. */
const MOST = 40;

interface Matter { id: string; at: number; kind: string; from: string; wants?: string; advised?: number; signed?: { id: string; at: number; paper?: any }; declined?: number; draft?: number; sent?: number; report?: { id?: string; at: number; done: boolean } }

const ref = (r: Paper): string | undefined => (typeof (r as any).data?.referral === "string" ? (r as any).data.referral : undefined);
const same = (p: any, b: any) => p && p.kind === b.kind && JSON.stringify(p.to ?? []) === JSON.stringify(b.addressed_to ?? []) && JSON.stringify(p.data ?? null) === JSON.stringify(b.data ?? null);

export class Matters {
  private readonly matters = new Map<string, Matter>();
  /** When the seat arrived (its first sitting), once it has. */
  private arrived?: number;
  /** Matters finished before it arrived: left out of what it is shown as open. */
  private readonly before = new Set<string>();

  /** `matters`: the post's channel of matters handed to it; `file`: its own file, read on request. */
  constructor(readonly matterPath: string, readonly filePath: string) {}

  /** Whether the file has yet to be read (the seat's first sitting). */
  get toRead(): boolean {
    return this.arrived === undefined;
  }
  /** The one reading of the post's own reports, at the first sitting: a search, which leaves the file as the seat has
   * never looked at it. */
  read(): { channel: string; query: { where: { field: string; op: "="; value: string }[] } }[] {
    return ["report", "advice"].map((kind) => ({ channel: this.filePath, query: { where: [{ field: "kind", op: "=", value: kind }] } }));
  }
  /** Papers sent back to the post, and authorities recorded for its clients, by whom they were for and the kind of paper. */
  private readonly back = new Map<string, { id: string; at: number; by: string; authority?: { id: string; at: number } }>();

  private take(r: Paper, t: number): void {
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
    if (k === "sign_off") m.signed = { id: r.id, at: r.at, paper: (r as any).data?.paper };
    else if (k === "declined") m.declined = r.at;
    else if (k === "report") m.report = { id: r.id, at: r.at, done: (r as any).data?.done === true || (r as any).data?.done === "yes" };
    else if (k === "draft") m.draft = r.at;
    else if (k === "advice") m.advised = r.at;
    void t;
  }

  /** What the seat is shown, taken in: the matters and their answers, and the file read at its first sitting (which is
   * then left out of what it is shown as looked up: it is set out here instead). Returns the observation to show. */
  absorb(obs: Observation): Observation {
    const chans = obs.channels as any;
    const first = this.arrived === undefined;
    if (first) this.arrived = obs.t;
    const rec = (p: string): Paper[] => (chans?.[p]?.kind === "records" ? chans[p].records ?? [] : []);
    for (const r of rec(this.matterPath)) this.take(r, obs.t);
    for (const p of Object.keys(chans ?? {})) if (p !== this.matterPath && p !== this.filePath) for (const r of rec(p)) if ((r as any).kind === "paper_returned" || (r as any).kind === "authority_recorded") this.take(r, obs.t);
    if (first) {
      for (const r of rec(this.filePath)) this.take(r, obs.t);
      for (const m of this.matters.values()) if ((m.report && m.report.at < obs.t) || (m.declined !== undefined && m.declined < obs.t) || (m.advised !== undefined && m.wants === "advice")) this.before.add(m.id);
    }
    if (!first && !(chans?.[this.filePath]?.search)) return obs;
    // (What it is shown: finished business left out of its matters; the file read on arrival not set out as a look.)
    const out: any = { ...obs, channels: { ...chans } };
    if (first && chans?.[this.filePath]?.search) delete out.channels[this.filePath];
    if (first && chans?.[this.matterPath]) {
      const keep = (r: Paper) => !this.before.has(r.id) && !this.before.has(ref(r) ?? "");
      out.channels[this.matterPath] = { ...chans[this.matterPath], records: rec(this.matterPath).filter(keep) };
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
      if (m.report || m.declined !== undefined || (m.advised !== undefined && m.wants === "advice")) { done++; continue; }
      // (A paper of this client's of this kind sent back after it was signed off: it went, and came back.)
      const back = m.signed ? this.back.get(`${m.from}|${m.kind}`) : undefined;
      const returned = back && back.at >= m.signed!.at ? `; sent, and sent back by ${back.by} on ${day(back.at)} (${back.id})${back.authority ? `; their authority recorded on ${day(back.authority.at)} (${back.authority.id})` : ""}` : "";
      const nothing = m.wants === "advice" ? "no advice given yet" : m.wants === "approve" ? "no request to go ahead yet" : m.wants === "alone" ? "not yet done" : "no draft yet";
      const where = m.signed
        ? returned ? `signed off on ${day(m.signed.at)} (${m.signed.id})${returned}; not yet reported` : m.sent !== undefined ? `signed off on ${day(m.signed.at)} (${m.signed.id}); sent on ${day(m.sent)}; not yet reported` // (Signed off before the seat took the post, and nothing of it seen since: whether it went is not known here.)
          : m.signed.at < (this.arrived ?? 0) ? `signed off on ${day(m.signed.at)} (${m.signed.id}), before you took this post; not reported on` : `signed off on ${day(m.signed.at)} (${m.signed.id}); not yet sent`
        : m.draft !== undefined ? `your draft went for sign-off on ${day(m.draft)}; no answer yet` : nothing;
      open.push(`- [${m.id}] ${m.kind.replace(/_/g, " ")}, handed over by ${m.from} on ${day(m.at)}: ${where}.`);
    }
    const lines = ["Your matters, and where each stands (from your own papers on them):", ...open.slice(0, MOST)];
    if (open.length > MOST) lines.push(`(And ${open.length - MOST} more open, older.)`);
    if (!open.length) lines.push("None is open.");
    if (done) lines.push(`${done} ${done === 1 ? "matter has" : "matters have"} been finished since you took this post (reported on, or done by whom it was for).`);
    if (this.before.size) lines.push(`${this.before.size} ${this.before.size === 1 ? "matter was" : "matters were"} finished before you took this post; ${this.before.size === 1 ? "it is" : "they are"} in your file.`);
    return lines.join("\n");
  }
}
