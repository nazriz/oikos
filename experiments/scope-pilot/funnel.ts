// The health check of a fork (2026-11-14): a funnel per assistant seat and per kind of matter, every stage counted from
// the fork's log itself, and a plain verdict per seat with fixed thresholds. It reads a finished fork or one still
// running (the log as written so far), and decides nothing in the world. Why: the first pilot's model seats drafted
// and were signed off (Sonnet 88, Haiku 53, Codex 23) and almost nothing was sent afterwards; that was found only by
// noticing two numbers in different reports did not add up, after a 45-day run. The mock drafts as the code assistant
// does and the code arm passes, so only a real model's fork, read end to end, shows such a fault.
//
// The stages, per seat and kind of matter (units in brackets):
//   handed (matters handed to the seat from the fork on, and those from before it it drafted on after it) → drafted (matters with a draft of the seat's) → drafts (the
//   seat's drafts for sign-off) → signed (drafts the principal signed off; declined beside) → sent (signed drafts whose
//   paper the seat then sent: a paper of the draft's kind, in the seat's post, for the principal, after the sign-off) →
//   answered (sent papers some other party's paper cites: an answer, a decision, a paper sent back, an authority wanted)
//   → shown (answers that were in the seat's own view at a later sitting: model seats only, from their observations) →
//   done (matters the seat reported done).
// And per seat: the translator's stages (requests, served first time, after a restatement, never, not sent; drafts the
// seat confirmed or declined: orchestrator/src/served.ts), obstacles made, met and cleared (`oikos-kernel delegation`;
// cleared: a later paper for the principal to that counterparty that was not sent back), requests for more and their
// answers, reports of nothing done, unread answers, sittings, calls, and whether the seat was debriefed.
//
// THE VERDICT (fixed; a seat FAILS on any of these):
//   - handed 10 or more matters and drafted none;
//   - 10 or more drafts and none signed off or declined (the principal never answered);
//   - 5 or more signed off and under 80% of them sent ("FAIL at send");
//   - 5 or more answers came back and none was shown to it (a model seat);
//   - 10 or more requests to the translator and no draft offered;
//   - 5 or more sittings and no call (a model seat);
//   - the fork has ended and a model seat was not debriefed.
// A stage that keeps under half of what entered it (4 or more entering) is FLAGGED, not failed: some papers are never
// answered (a delivery note, a rates notice), and a matter may still be open.
//
//   bun experiments/scope-pilot/funnel.ts <experiment folder> [--seed 7] [--arm haiku,sonnet] [--gate rung1] [--json]
//
// Default: every model arm of the spec, the first seed. Exit 1 when any seat named fails (or the gate is not met).
// `--gate rung1`: the smoke's pass (obstacle-run.ts): the desk and the factory not failed; papers of the desk's that
// reached the lender (bank) or the support office (outside) came back and were shown to it; at least one obstacle met and
// cleared; every model seat debriefed.
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { kernelBinary } from "../../orchestrator/src/kernel";
import { ServedTally, type Served } from "../../orchestrator/src/served";

const DAY = 86_400;
/** The papers of delegation itself: never "the paper sent". */
const DELEGATION = new Set(["draft", "report", "advice", "scope_request", "approval_request", "handover", "referral", "sign_off", "declined", "go_ahead", "remit", "brief", "scope_answer", "letter"]);
const STAGES = ["handed", "drafted", "drafts", "signed", "sent", "answered", "shown", "done"] as const;
type Stage = (typeof STAGES)[number];
type Row = { [s in Stage]: number } & { declined: number; not_done: number; carried: number };
const row = (): Row => ({ handed: 0, drafted: 0, drafts: 0, signed: 0, sent: 0, answered: 0, shown: 0, done: 0, declined: 0, not_done: 0, carried: 0 });

export interface SeatFunnel {
  post: string; participants: string[]; model: boolean;
  kinds: { [kind: string]: Row }; total: Row;
  answers: { [kind: string]: number };
  /** Papers sent, by counterparty, with how many were answered and shown. */
  to: { [counterparty: string]: { sent: number; answered: number; shown: number } };
  served: Served;
  obstacles: { made: number; met: number; cleared: number; by_law: { [law: string]: { made: number; met: number; cleared: number } } };
  requests: { made: number; answered: { [why: string]: number } };
  unread: number; sittings: number; calls: number; debriefed: string | null;
  verdict: { fail: string[]; flag: string[] };
}
export interface Funnel { fork_day: number; through_day: number; ended: boolean; seats: SeatFunnel[] }

const asList = (x: unknown): string[] => (Array.isArray(x) ? x.map(String) : x ? [String(x)] : []);
const kindOfCalls = (calls: unknown): string | undefined => /kind=([a-z_]+)/.exec(String(calls ?? ""))?.[1];

/** Reads one fork's log (exported JSONL lines, in order) against its config. */
export class FunnelReader {
  private readonly from: number;
  private readonly posts = new Map<string, { principal: string | undefined; desk: boolean }>(); // assistant post -> its principal entity (an organisation's), or a desk
  private readonly principalPost = new Map<string, string>(); // a principal's post -> its assistant post
  private readonly providers = new Set<string>();
  private readonly seatOf = new Map<string, string>(); // a seat's participant -> its post
  private readonly model = new Set<string>(); // participants that made a model call
  private readonly matters = new Map<string, { post: string; kind: string; principal: string; t: number; drafted?: boolean; done?: boolean }>();
  private readonly drafts = new Map<string, { matter: string; paper?: string }>();
  private readonly signed: { id: string; draft: string; matter: string; t: number; sent?: string }[] = [];
  private readonly sent = new Map<string, { post: string; kind: string; to: string; t: number; answered?: string; shown?: boolean }>();
  private readonly answers = new Map<string, { sent: string; t: number }>();
  private readonly requests = new Map<string, string>(); // scope_request id -> post
  private readonly requestAnswers = new Map<string, string>(); // request -> why
  private readonly unread = new Map<string, number>();
  private readonly sittings = new Map<string, Set<number>>();
  private readonly calls = new Map<string, number>();
  private readonly debriefs = new Map<string, string>();
  private readonly toCounterparty: { principal: string; to: string[]; t: number; id: string }[] = [];
  private readonly returnedPapers = new Set<string>();
  private readonly declinedDrafts = new Set<string>();
  private readonly notDone = new Set<string>();
  readonly served = new ServedTally();
  last = 0;

  constructor(config: any, seats: { [participant: string]: { capacity: string } }, forkDay: number) {
    this.from = forkDay * DAY;
    for (const pos of config.positions ?? []) {
      const d = pos.role_module?.params?.delegation;
      if (d?.post) { this.posts.set(d.post, { principal: pos.entity, desk: false }); this.principalPost.set(pos.id, d.post); }
    }
    for (const p of config.participants ?? []) if (p.kind === "system" && /-desk-system$/.test(p.id)) {
      this.providers.add(String(p.owner));
      const post = (config.positions ?? []).find((x: any) => x.holder === p.id)?.id ?? `${p.owner}-desk`;
      this.posts.set(post, { principal: undefined, desk: true });
      this.seatOf.set(p.id, post);
    }
    for (const [id, s] of Object.entries(seats)) if (this.posts.has(s.capacity)) this.seatOf.set(id, s.capacity);
  }

  private deskOf(provider: string): string | undefined {
    return [...this.posts.entries()].find(([post, x]) => x.desk && post.startsWith(provider))?.[0];
  }

  /** Which assistant post a referral goes to. */
  private postFor(r: any): string | undefined {
    const to = asList(r.addressed_to);
    const direct = to.find((x) => this.posts.has(x));
    if (direct) return direct;
    const viaPost = this.principalPost.get(r.in_position ?? "");
    if (viaPost) return viaPost;
    const prov = to.find((x) => this.providers.has(x));
    return prov ? this.deskOf(prov) : undefined;
  }

  see(e: any): void {
    const t: number = e.t ?? 0;
    this.last = Math.max(this.last, t);
    const b = e.body ?? {};
    if (e.kind === "annotation") {
      if (t < this.from) return;
      this.served.see(e);
      const who = String(b.subject ?? "");
      if (b.annotation === "usage" && b.purpose === "participant") { this.calls.set(who, (this.calls.get(who) ?? 0) + 1); this.model.add(who); }
      else if (b.annotation === "debrief") this.debriefs.set(who, String(b.data?.ended ?? "given"));
      else if (b.annotation === "note" && b.data?.unread_answer) this.unread.set(who, (this.unread.get(who) ?? 0) + 1);
      else if (b.annotation === "observation" && this.seatOf.has(who)) {
        (this.sittings.get(who) ?? this.sittings.set(who, new Set()).get(who)!).add(t);
        // (What the seat was shown at this sitting: every answer to a paper of its own that is in its view now.)
        const seen = JSON.stringify(b.data ?? {});
        for (const [id, a] of this.answers) if (a.t <= t && !this.sent.get(a.sent)!.shown && seen.includes(`"${id}"`)) this.sent.get(a.sent)!.shown = true;
      }
      return;
    }
    if (e.kind === "command") {
      if (t >= this.from && b.command === "observe" && this.seatOf.has(b.participant) && !this.model.has(b.participant)) (this.sittings.get(b.participant) ?? this.sittings.set(b.participant, new Set()).get(b.participant)!).add(t);
      return;
    }
    if (b.event !== "recorded") return;
    const r = b.record ?? {};
    const d = r.data ?? {};
    // (A seat's own paper names its post; its author is the seat.)
    if (r.in_position && this.posts.has(r.in_position) && r.author) this.seatOf.set(r.author, r.in_position);
    if (r.kind === "paper_returned") for (const p of [...asList(r.basis), String(d.paper ?? "")]) this.returnedPapers.add(p);
    if (r.kind === "referral") {
      const post = this.postFor(r);
      if (post) this.matters.set(r.id, { post, kind: String(d.kind ?? kindOfCalls(d.calls) ?? "?"), principal: String(r.speaks_for ?? ""), t });
      return;
    }
    const m = this.matters.get(String(d.referral ?? ""));
    if (r.kind === "draft" && m && t >= this.from && this.seatOf.get(r.author) === m.post) {
      m.drafted = true;
      this.drafts.set(r.id, { matter: String(d.referral), paper: d.paper?.kind ?? kindOfCalls(d.calls) });
      return;
    }
    if (r.kind === "sign_off" && t >= this.from && this.drafts.has(String(d.draft))) { this.signed.push({ id: r.id, draft: String(d.draft), matter: this.drafts.get(String(d.draft))!.matter, t }); return; }
    if (r.kind === "declined" && t >= this.from && this.drafts.has(String(d.of))) { this.declinedDrafts.add(String(d.of)); return; }
    if (r.kind === "report" && m && t >= this.from && this.seatOf.get(r.author) === m.post) { if (d.done === "yes" || d.done === true) m.done = true; else this.notDone.add(String(d.referral)); return; }
    if (r.kind === "scope_request" && this.seatOf.has(r.author)) { this.requests.set(r.id, this.seatOf.get(r.author)!); return; }
    if (r.kind === "scope_answer") { const q = asList(r.basis).find((x) => this.requests.has(x)) ?? String(d.request ?? ""); if (this.requests.has(q)) this.requestAnswers.set(q, String(d.why ?? d.answer ?? "answered")); return; }
    // (A paper sent for a principal: by the seat, in its post. It is a signed draft's when one of that principal's
    // matters with this seat was signed off before it and not yet matched, of the same kind.)
    const post = this.seatOf.get(r.author);
    if (post && r.in_position === post && !DELEGATION.has(r.kind)) {
      const s = this.signed.find((x) => !x.sent && x.t <= t && this.matters.get(x.matter)!.principal === r.speaks_for && (!this.drafts.get(x.draft)!.paper || this.drafts.get(x.draft)!.paper === r.kind));
      if (s && t >= this.from) {
        s.sent = r.id;
        this.sent.set(r.id, { post, kind: this.matters.get(s.matter)!.kind, to: asList(r.addressed_to)[0] ?? "?", t });
      }
    }
    // (Anything a principal sends to someone: what clears an obstacle with that someone, unless it comes back.)
    if (t >= this.from && r.speaks_for) this.toCounterparty.push({ principal: String(r.speaks_for), to: asList(r.addressed_to), t, id: r.id });
    // (Someone else's paper that cites one the seat sent: an answer to it.)
    if (!post) {
      const cited = [...asList(r.basis), ...Object.values(d).flatMap(asList)].find((x) => this.sent.has(x));
      if (cited && !this.sent.get(cited)!.answered) { this.sent.get(cited)!.answered = r.id; this.answers.set(r.id, { sent: cited, t }); }
    }
  }

  /** The funnel so far, with the obstacles as `oikos-kernel delegation` reads them (its rows, JSON) and whether the fork ended. */
  result(obstacleRows: any[], ended: boolean): Funnel {
    const seats = new Map<string, SeatFunnel>();
    const seat = (post: string) => {
      let s = seats.get(post);
      if (!s) seats.set(post, (s = { post, participants: [], model: false, kinds: {}, total: row(), answers: {}, to: {}, served: undefined as any, obstacles: { made: 0, met: 0, cleared: 0, by_law: {} }, requests: { made: 0, answered: {} }, unread: 0, sittings: 0, calls: 0, debriefed: null, verdict: { fail: [], flag: [] } }));
      return s;
    };
    const add = (post: string, kind: string, f: (r: Row) => void) => { const s = seat(post); f((s.kinds[kind] ??= row())); f(s.total); };
    for (const [id, m] of this.matters) {
      // (Handed: from the fork on, and those handed before it that the seat drafted on after it: carried over.)
      if (m.t >= this.from || m.drafted) add(m.post, m.kind, (r) => { r.handed++; if (m.t < this.from) r.carried++; });
      if (m.drafted) add(m.post, m.kind, (r) => r.drafted++);
      if (m.done) add(m.post, m.kind, (r) => r.done++);
      if (this.notDone.has(id) && !m.done) add(m.post, m.kind, (r) => r.not_done++);
    }
    for (const [id, dr] of this.drafts) { const m = this.matters.get(dr.matter)!; add(m.post, m.kind, (r) => { r.drafts++; if (this.declinedDrafts.has(id)) r.declined++; }); }
    for (const s of this.signed) {
      const m = this.matters.get(s.matter)!;
      add(m.post, m.kind, (r) => r.signed++);
      const p = s.sent ? this.sent.get(s.sent) : undefined;
      if (!p) continue;
      const st = seat(m.post);
      const c = (st.to[p.to] ??= { sent: 0, answered: 0, shown: 0 });
      c.sent++;
      add(m.post, m.kind, (r) => r.sent++);
      if (p.answered) { c.answered++; add(m.post, m.kind, (r) => r.answered++); const k = this.answerKind.get(p.answered) ?? "answer"; st.answers[k] = (st.answers[k] ?? 0) + 1; }
      if (p.shown) { c.shown++; add(m.post, m.kind, (r) => r.shown++); }
    }
    for (const [participant, post] of this.seatOf) {
      const s = seat(post);
      if (!s.participants.includes(participant)) s.participants.push(participant);
      if (this.model.has(participant)) s.model = true;
      s.unread += this.unread.get(participant) ?? 0;
      s.sittings += this.sittings.get(participant)?.size ?? 0;
      s.calls += this.calls.get(participant) ?? 0;
      if (this.debriefs.has(participant)) s.debriefed = this.debriefs.get(participant)!;
    }
    const servedBy = this.served.bySeat();
    for (const s of seats.values()) s.served = s.participants.map((p) => servedBy[p]).filter(Boolean).reduce((a, x) => { for (const k of Object.keys(a) as (keyof Served)[]) a[k] += x![k]; return a; }, { requests: 0, served_first_time: 0, asked_back: 0, served_after_restatement: 0, never_served: 0, not_sent: 0, drafts_unsure: 0, drafts_offered: 0, drafts_confirmed: 0, drafts_declined: 0, drafts_unanswered: 0 } as Served);
    for (const [q, post] of this.requests) { const s = seat(post); s.requests.made++; const why = this.requestAnswers.get(q) ?? "not answered"; s.requests.answered[why] = (s.requests.answered[why] ?? 0) + 1; }
    for (const o of obstacleRows) {
      if (!o.seat || !seats.has(o.seat) && !this.posts.has(o.seat) || (o.t ?? 0) < this.from) continue;
      const s = seat(o.seat);
      const l = (s.obstacles.by_law[o.law] ??= { made: 0, met: 0, cleared: 0 });
      s.obstacles.made++; l.made++;
      if (typeof o.met_at === "number") { s.obstacles.met++; l.met++; }
      const cleared = this.toCounterparty.some((x) => x.principal === o.principal && x.t > o.t && x.to.includes(o.counterparty) && x.id !== o.paper && !this.returnedPapers.has(x.id));
      if (cleared) { s.obstacles.cleared++; l.cleared++; }
    }
    const out = [...seats.values()].filter((s) => s.total.handed || s.total.drafts || s.calls).sort((a, b) => a.post.localeCompare(b.post));
    for (const s of out) s.verdict = verdict(s, ended);
    return { fork_day: this.from / DAY, through_day: Math.floor(this.last / DAY), ended, seats: out };
  }

  private readonly answerKind = new Map<string, string>();
  /** (The kinds of answer, kept as they are seen.) */
  seeAnswerKind(e: any): void {
    const r = e.body?.record;
    if (e.body?.event === "recorded" && r && this.answers.has(r.id)) this.answerKind.set(r.id, String(r.kind));
  }
}

/** A seat's verdict, by the thresholds in the header. */
export function verdict(s: SeatFunnel, ended: boolean): { fail: string[]; flag: string[] } {
  const t = s.total, fail: string[] = [], flag: string[] = [];
  if (t.handed >= 10 && t.drafted === 0) fail.push("at drafting: nothing drafted");
  if (t.drafts >= 10 && t.signed + t.declined === 0) fail.push("at sign-off: no draft answered");
  if (t.signed >= 5 && t.sent < 0.8 * t.signed) fail.push(`at send: ${t.sent} of ${t.signed} signed sent`);
  if (s.model && t.answered >= 5 && t.shown === 0) fail.push("at shown: no answer shown to the seat");
  if (s.served.requests >= 10 && s.served.drafts_offered === 0) fail.push("at the translator: no draft offered");
  if (s.model && s.sittings >= 5 && s.calls === 0) fail.push("no call at any sitting");
  if (ended && s.model && !s.debriefed) fail.push("not debriefed");
  const pairs: [string, number, number][] = [["drafted of handed", t.handed, t.drafted], ["signed of drafts", t.drafts, t.signed], ["sent of signed", t.signed, t.sent], ["answered of sent", t.sent, t.answered], ...(s.model ? [["shown of answered", t.answered, t.shown] as [string, number, number]] : []), ["done of handed", t.handed, t.done]];
  for (const [what, a, b] of pairs) if (a >= 4 && b < a / 2) flag.push(`${what}: ${b} of ${a}`);
  if (s.served.requests >= 4 && s.served.served_first_time < s.served.requests / 2) flag.push(`served first time: ${s.served.served_first_time} of ${s.served.requests}`);
  return { fail, flag };
}

/** The smoke's gate (obstacle-run.ts, rung 1). */
export function gate(f: Funnel, o: { posts: string[]; counterparties: string[] }): string[] {
  const why: string[] = [];
  for (const post of o.posts) {
    const s = f.seats.find((x) => x.post === post);
    if (!s) { why.push(`${post}: no seat`); continue; }
    if (s.verdict.fail.length) why.push(`${post}: FAIL ${s.verdict.fail.join("; ")}`);
  }
  const desk = f.seats.find((x) => x.post.endsWith("-desk"));
  const back = o.counterparties.reduce((a, c) => a + (desk?.to[c]?.shown ?? 0), 0);
  if (!back) why.push(`no paper of the desk's to ${o.counterparties.join(" or ")} came back and was shown to it`);
  if (!f.seats.some((s) => o.posts.includes(s.post) && s.obstacles.met > 0 && s.obstacles.cleared > 0)) why.push("no obstacle met and cleared");
  if (f.ended) for (const s of f.seats) if (s.model && !s.debriefed) why.push(`${s.post}: not debriefed`);
  return why;
}

const short = (post: string) => (post.endsWith("-desk") ? "desk" : post.replace(/-manager-assistant$|-assistant$/, ""));
export function funnelText(f: Funnel, label: string): string {
  const lines = [`${label}: the fork from day ${f.fork_day}, read through day ${f.through_day}${f.ended ? " (ended)" : " (so far)"}`];
  for (const s of f.seats) {
    const t = s.total;
    const head = `${short(s.post)}: ${t.handed} handed${t.carried ? ` (${t.carried} from before the fork)` : ""}, ${t.drafted} drafted (${t.drafts} drafts), ${t.signed} signed (${t.declined} declined), ${t.sent} sent, ${t.answered} answered, ${s.model ? `${t.shown} shown, ` : ""}${t.done} reported done`;
    lines.push(`${head}: ${s.verdict.fail.length ? `FAIL ${s.verdict.fail.join("; ")}` : "ok"}${s.verdict.flag.length ? ` [flagged: ${s.verdict.flag.join("; ")}]` : ""}`);
    lines.push(`  ${s.model ? "model" : "code"} seat ${s.participants.join(", ")} in ${s.post}: ${s.sittings} sittings, ${s.calls} calls; translator: ${s.served.requests} requests, ${s.served.served_first_time} served first time, ${s.served.served_after_restatement} after a restatement, ${s.served.never_served} never, ${s.served.not_sent} not sent; drafts confirmed ${s.served.drafts_confirmed}, declined ${s.served.drafts_declined}`);
    lines.push(`  obstacles: ${s.obstacles.made} made, ${s.obstacles.met} met, ${s.obstacles.cleared} cleared${Object.keys(s.obstacles.by_law).length ? ` (${Object.entries(s.obstacles.by_law).map(([k, v]) => `${k} ${v.made}/${v.met}/${v.cleared}`).join(", ")})` : ""}; requests for more ${s.requests.made}${s.requests.made ? ` (${Object.entries(s.requests.answered).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}; reported not done ${t.not_done}; unread answers ${s.unread}; debriefed: ${s.debriefed ?? (s.model ? "no" : "-")}`);
    if (Object.keys(s.to).length) lines.push(`  sent to: ${Object.entries(s.to).sort((a, b) => b[1].sent - a[1].sent).map(([c, v]) => `${c} ${v.sent} (answered ${v.answered}${s.model ? `, shown ${v.shown}` : ""})`).join(", ")}`);
    for (const [k, r] of Object.entries(s.kinds).sort((a, b) => b[1].handed - a[1].handed)) lines.push(`    ${k}: ${STAGES.map((st) => (st === "shown" && !s.model ? "-" : r[st])).join(" → ")}${r.declined ? ` (declined ${r.declined})` : ""}`);
  }
  lines.push(`(stages: ${STAGES.join(" → ")})`);
  return lines.join("\n");
}

/** One fork's log, read: exported (a running fork's too: its log as written so far), with its obstacles. */
export async function readFork(log: string, config: any, seats: { [participant: string]: { capacity: string } }, forkDay: number, ended: boolean): Promise<Funnel> {
  const dir = mkdtempSync(join(tmpdir(), "oikos-funnel-"));
  try {
    const out = join(dir, "log.jsonl");
    const x = Bun.spawnSync([kernelBinary(), "export", log, "--out", out], { stdout: "pipe", stderr: "pipe" });
    if (x.exitCode !== 0) throw new Error(`export of ${log}: ${x.stderr.toString().slice(0, 300)}`);
    const reader = new FunnelReader(config, seats, forkDay);
    const rl = createInterface({ input: createReadStream(out), crlfDelay: Infinity });
    for await (const line of rl) {
      // (The base's entries hold no seat's work after the fork; only what a reading needs is parsed.)
      if (!/"recorded"|"annotation"|"command":"observe"/.test(line.slice(0, 400)) && !line.includes('"recorded"')) continue;
      const e = JSON.parse(line);
      reader.see(e);
      reader.seeAnswerKind(e);
    }
    const d = Bun.spawnSync([kernelBinary(), "delegation", log], { stdout: "pipe", stderr: "pipe" });
    const rows = d.exitCode === 0 ? d.stdout.toString().split("\n").filter((l) => l.includes('"obstacles"')).map((l) => JSON.parse(l)).filter((o) => o.table === "obstacles") : [];
    return reader.result(rows, ended);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A fork of an experiment folder, read. */
export async function readExperimentFork(dir: string, seed: number, arm: string): Promise<Funnel> {
  const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
  const sd = join(dir, `seed-${seed}`);
  const config = JSON.parse(readFileSync(join(sd, "config.json"), "utf8"));
  const seatsFile = join(sd, "template-seats.json");
  const seats = existsSync(seatsFile) ? JSON.parse(readFileSync(seatsFile, "utf8")) : {};
  return readFork(join(sd, `${arm}.oklog`), config, seats, spec.forkDay, existsSync(join(sd, `${arm}.json`)));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith("--")) ?? "");
  const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
  const seed = Number(opt("--seed") ?? spec.seeds[0]);
  const arms = opt("--arm")?.split(",") ?? spec.arms.filter((a: any) => a.steward?.kind === "model").map((a: any) => a.name);
  let failed = false;
  const all: { [arm: string]: Funnel } = {};
  for (const arm of arms) {
    if (!existsSync(join(dir, `seed-${seed}`, `${arm}.oklog`))) { console.log(`${arm}: no log yet`); continue; }
    const f = await readExperimentFork(dir, seed, arm);
    all[arm] = f;
    if (!args.includes("--json")) console.log(funnelText(f, `${spec.name}, seed ${seed}, arm ${arm}`) + "\n");
    if (f.seats.some((s) => s.verdict.fail.length)) failed = true;
    if (opt("--gate") === "rung1") {
      const why = gate(f, { posts: f.seats.filter((s) => s.model).map((s) => s.post), counterparties: ["bank", "outside"] });
      console.log(why.length ? `GATE rung 1, ${arm}: NOT MET: ${why.join("; ")}` : `GATE rung 1, ${arm}: met`);
      if (why.length) failed = true;
    }
  }
  if (args.includes("--json")) console.log(JSON.stringify(all, null, 1));
  process.exit(failed ? 1 : 0);
}
