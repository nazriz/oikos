// How the translator served each seat model's requests (Naz, 2026-11-10: "we need just one model that works"): per seat
// model, its requests; those served first time (a draft offered on the seat's first saying of it), asked back, served
// after one restatement, and never served (a restatement that still could not be drawn up); the drafts offered with
// what was unclear about them; and what the seat answered to the drafts (confirmed, declined, not answered). In every
// run's report and cost summary (experiment.ts, pilot-report.ts, batch.ts) and in the pilot viewer.
//
// A restatement is the seat's next request after one that was asked back or a draft it declined. Our translator alone
// says which each request was (its route's `stage`, translator/src/arrangement.ts `createAlone`: a request in the same
// answer as the one asked back is not yet one); for a run without it, the order of the seat's requests in the log says.

export interface Served {
  requests: number;
  served_first_time: number;
  asked_back: number;
  served_after_restatement: number;
  never_served: number;
  /** Drafts offered with a sentence saying what was unclear about them (our translator alone, unsure). */
  drafts_unsure: number;
  drafts_offered: number;
  drafts_confirmed: number;
  drafts_declined: number;
  drafts_unanswered: number;
}

export const noneServed = (): Served => ({ requests: 0, served_first_time: 0, asked_back: 0, served_after_restatement: 0, never_served: 0, drafts_unsure: 0, drafts_offered: 0, drafts_confirmed: 0, drafts_declined: 0, drafts_unanswered: 0 });

export function addServed(into: Served, x: Served): Served {
  for (const k of Object.keys(into) as (keyof Served)[]) into[k] += x[k] ?? 0;
  return into;
}

const DRAFT_ID = /^draft\.(.+)\.(\d+)$/;

/** A run's requests, seen one log entry at a time (`see`: a log line parsed, or an engine event: { kind, body }). */
export class ServedTally {
  private readonly seats = new Map<string, Served>();
  private readonly model = new Map<string, string>();
  private readonly stage = new Map<string, { stage?: string; unsure?: boolean }>();
  private readonly open = new Set<string>();
  /** Drafts offered: the seat's, and whether answered. */
  private readonly drafts = new Map<string, { seat: string; answered?: "accept" | "reject" }>();
  private readonly settled = new Set<string>();

  private of(seat: string): Served {
    let s = this.seats.get(seat);
    if (!s) this.seats.set(seat, (s = noneServed()));
    return s;
  }

  /** One request's outcome: drawn up (a draft offered) or not. */
  private request(id: string, seat: string, drafted: boolean): void {
    if (this.settled.has(id)) return;
    this.settled.add(id);
    const s = this.of(seat);
    const r = this.stage.get(id);
    const restated = r?.stage ? r.stage === "restated" : this.open.has(seat);
    this.open.delete(seat);
    s.requests++;
    if (drafted) {
      if (restated) s.served_after_restatement++; else s.served_first_time++;
      s.drafts_offered++;
      if (r?.unsure) s.drafts_unsure++;
      this.drafts.set(id, { seat });
    } else if (restated) s.never_served++;
    else { s.asked_back++; this.open.add(seat); }
  }

  see(e: { kind?: string; body?: any }): void {
    if (e?.kind !== "annotation") return;
    const b = e.body ?? {};
    if (b.annotation === "usage" && b.purpose === "participant" && typeof b.subject === "string" && !this.model.has(b.subject)) this.model.set(b.subject, `${b.provider}/${b.model}`);
    else if (b.annotation === "note" && b.data?.translation_route) {
      const r = b.data.translation_route;
      this.stage.set(String(r.draft), { ...(r.stage ? { stage: r.stage } : {}), ...(r.unsure_offered ? { unsure: true } : {}) });
    } else if (b.annotation === "draft" && b.draft?.id) {
      const seat = String(b.draft.participant ?? DRAFT_ID.exec(b.draft.id)?.[1] ?? "?");
      this.request(String(b.draft.id), seat, true);
    } else if (b.annotation === "translation_failure" && b.data?.draft) {
      // (A draft the log would not take, drawn up again under another id: the platform's fault, not a request.)
      if (b.data.drawn_up_again) return;
      this.request(String(b.data.draft), String(b.subject ?? DRAFT_ID.exec(b.data.draft)?.[1] ?? "?"), false);
    } else if (b.annotation === "signoff" && b.draft) {
      const d = this.drafts.get(String(b.draft));
      if (!d || d.answered) return;
      d.answered = b.decision === "accept" ? "accept" : "reject";
      const s = this.of(d.seat);
      if (d.answered === "accept") s.drafts_confirmed++;
      else { s.drafts_declined++; this.open.add(d.seat); }
    }
  }

  /** By seat, with the drafts not answered counted. */
  bySeat(): { [seat: string]: Served } {
    const out: { [seat: string]: Served } = {};
    for (const [seat, s] of this.seats) out[seat] = { ...s, drafts_unanswered: s.drafts_offered - s.drafts_confirmed - s.drafts_declined };
    return out;
  }

  /** By the seat's model (as its calls name it; "unknown" for a seat that made none, such as a code seat's words). */
  byModel(model?: (seat: string) => string | undefined): { [model: string]: Served } {
    const out: { [model: string]: Served } = {};
    for (const [seat, s] of Object.entries(this.bySeat())) addServed((out[model?.(seat) ?? this.model.get(seat) ?? "unknown"] ??= noneServed()), s);
    return out;
  }

  total(): Served {
    return Object.values(this.bySeat()).reduce(addServed, noneServed());
  }
}

const pct = (x: number, of: number) => (of ? `${Math.round((100 * x) / of)}%` : "-");
/** One line for a model's requests. */
export const servedText = (s: Served): string =>
  `${s.requests} requests: served first time ${s.served_first_time} (${pct(s.served_first_time, s.requests)}), asked back ${s.asked_back}, served after one restatement ${s.served_after_restatement}, never served ${s.never_served}; drafts offered ${s.drafts_offered}${s.drafts_unsure ? ` (${s.drafts_unsure} with what was unclear)` : ""}: confirmed ${s.drafts_confirmed}, declined ${s.drafts_declined}, not answered ${s.drafts_unanswered}`;
