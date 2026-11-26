// The `ledger` fold: each person's own record of the run, for their life page (the inspector) and the search palette.
// Per person, one file (`ledger/p-<person id>`, fetched when their page opens): every payment into or out of their
// accounts (with who instructed it), every record and message that named them (with who wrote it, and whether that was
// the seat), their illnesses, and when they took a post, left or died. Plus one small index for the palette: the
// records worth searching by their words.
//
// "Who decided": a payment's is the author of the instruction it was made under (`per_instruction`), else the
// participant whose act caused it; a record's is its author; a message's its sender. Each is named as the log names it;
// the client says which are the seat, which a person (`<id>-self`), which an institution. Nothing here judges.
//
// Kinds of paper so common they would drown a page (more than BULK of them in the run: orders, delivery notes...) are
// kept per person as counts by kind, and left out of the search index; the json says which.
import type { Fold, FoldContext, FoldResult, LogLine } from "../shared/fold";

const BULK = 2000;
const TEXT = 280;

/** One payment: [t, cents (+ in, − out), the other side's holder, reason, memo, who decided]. */
export type LedgerTransfer = [number, number, string, string, string, string];
/** One paper or message that named the person. */
export interface LedgerItem {
  t: number;
  /** A record's kind ("benefit_decision"), or "message". */
  kind: string;
  id?: string;
  text: string;
  /** Who wrote it (participant or entity, as the log names it), and as which post. */
  from?: string;
  as?: string;
  /** The person wrote it themselves. */
  own?: boolean;
  /** The seat wrote it (or its act made it). */
  seat?: boolean;
  /** The command's seq (an act's place in the log), for deep links. */
  seq?: number;
  refused?: string;
}
export interface PersonLedger {
  id: string;
  accounts: string[];
  /** Balance of their accounts at t 0, cents. */
  opening: number;
  transfers: LedgerTransfer[];
  items: LedgerItem[];
  /** Bulk kinds, counted: { order: 41, delivery_note: 38 }. */
  counts: Record<string, number>;
  /** [t, "began" | "treated" | "ended", kind, severity]. */
  conditions: [number, string, string, string][];
  /** [t, what]: "appointed pos.1", "left", "died". */
  events: [number, string][];
}
export interface LedgerJson {
  v: number;
  seat?: string;
  persons: number;
  bulk: string[];
  /** For the palette: [id, kind, t, author, first words]. */
  records: [string, string, number, string, string][];
}

const self = (x: unknown) => (typeof x === "string" ? x.replace(/-self$/, "") : "");
const clip = (s: unknown, n = TEXT) => {
  const x = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
  return x.length > n ? `${x.slice(0, n - 1)}…` : x;
};
const list = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : typeof x === "string" ? [x] : []);

class LedgerFold implements Fold {
  readonly name = "ledger";
  readonly version = 1;
  private seat?: string;
  private readonly people = new Map<string, PersonLedger>();
  private readonly accountOf = new Map<string, string>(); // account → person
  private readonly holderOf = new Map<string, string>(); // account → holder (anyone)
  private readonly actBy = new Map<number, string>(); // command seq → participant
  private readonly actionCmd = new Map<string, number>(); // action → command seq
  private readonly itemsBySeq = new Map<number, LedgerItem[]>();
  private readonly authorOf = new Map<string, string>(); // record id → author
  private readonly kindCount = new Map<string, number>();
  private readonly index: { id: string; kind: string; t: number; author: string; text: string }[] = [];

  private person(id: string): PersonLedger | undefined {
    return this.people.get(id);
  }
  private add(p: PersonLedger, it: LedgerItem) {
    p.items.push(it);
    if (it.seq !== undefined) {
      const l = this.itemsBySeq.get(it.seq);
      if (l) l.push(it);
      else this.itemsBySeq.set(it.seq, [it]);
    }
  }

  line(l: LogLine): void {
    const b = l.body;
    if (!b) return;
    if (l.kind === "header") {
      const w = b.config?.world ?? {};
      this.seat = (b.config?.positions ?? []).find((p: any) => p.id === "mayor")?.holder;
      for (const e of w.entities ?? []) if (e.kind === "person") this.people.set(e.id, { id: e.id, accounts: [], opening: 0, transfers: [], items: [], counts: {}, conditions: [], events: [] });
      for (const a of w.accounts ?? []) this.openAccount(a.id, a.holder, Number(a.balance ?? 0) || 0);
      return;
    }
    if (l.kind === "command") {
      if (b.command !== "act") return;
      const who = String(b.participant ?? "");
      this.actBy.set(l.seq, who);
      // Messages: their words are in the command; who they reach, in its `to`.
      for (const blk of b.blocks ?? []) {
        if (blk?.block !== "message") continue;
        for (const to of list(blk.to)) {
          const p = this.person(self(to));
          if (p) this.add(p, { t: l.t, kind: "message", text: clip(blk.text), from: who, ...(b.as ? { as: String(b.as) } : {}), ...(who === this.seat ? { seat: true } : {}), seq: l.seq });
        }
      }
      return;
    }
    if (l.kind !== "event") return;
    switch (b.event) {
      case "action_started":
        if (this.itemsBySeq.has(b.cause)) this.actionCmd.set(String(b.action), b.cause);
        return;
      case "action_refused": {
        const seq = this.actionCmd.get(String(b.action));
        if (seq !== undefined) for (const it of this.itemsBySeq.get(seq) ?? []) it.refused = String(b.code ?? "refused");
        return;
      }
      case "account_opened":
        this.openAccount(String(b.account), String(b.holder ?? ""), 0);
        return;
      case "person_created":
        if (!this.people.has(b.person)) this.people.set(b.person, { id: b.person, accounts: [], opening: 0, transfers: [], items: [], counts: {}, conditions: [], events: [] });
        return;
      case "transfer": {
        const n = Number(b.amount ?? 0) || 0;
        const decider = (b.per_instruction && this.authorOf.get(String(b.per_instruction))) || this.actBy.get(b.cause) || String(b.by ?? "");
        const from = this.accountOf.get(String(b.from)), to = this.accountOf.get(String(b.to));
        const memo = clip(b.memo, 80), reason = String(b.reason ?? "");
        if (from) this.person(from)?.transfers.push([l.t, -n, this.holderOf.get(String(b.to)) ?? String(b.to), reason, memo, decider]);
        if (to && to !== from) this.person(to)?.transfers.push([l.t, n, this.holderOf.get(String(b.from)) ?? String(b.from), reason, memo, decider]);
        return;
      }
      case "recorded": {
        const r = b.record ?? {};
        const id = String(r.id ?? "");
        const author = String(r.author ?? "");
        if (id) this.authorOf.set(id, author);
        const kind = String(r.kind ?? r.record ?? "record");
        this.kindCount.set(kind, (this.kindCount.get(kind) ?? 0) + 1);
        const text = clip(r.text);
        const by = this.actBy.get(b.cause);
        const seat = this.seat !== undefined && (author === this.seat || by === this.seat);
        if (text) this.index.push({ id, kind, t: l.t, author, text: clip(r.text, 140) });
        const reached = new Set<string>();
        for (const x of [...list(r.addressed_to), ...list(r.visible_to), author]) {
          const p = self(x);
          if (this.people.has(p)) reached.add(p);
        }
        for (const p of reached) {
          this.add(this.people.get(p)!, { t: l.t, kind, id, text, from: author, ...(r.in_position ? { as: String(r.in_position) } : {}), ...(self(author) === p ? { own: true } : {}), ...(seat ? { seat: true } : {}), ...(typeof b.cause === "number" ? { seq: b.cause } : {}) });
        }
        return;
      }
      case "condition_began":
      case "condition_treated":
      case "condition_ended": {
        const p = this.person(String(b.person));
        if (p) p.conditions.push([l.t, String(b.event).slice("condition_".length), String(b.kind ?? ""), String(b.severity ?? "")]);
        return;
      }
      case "appointed": {
        const p = this.person(self(b.holder));
        if (p) p.events.push([l.t, `appointed ${b.position}`]);
        return;
      }
      case "person_left":
      case "person_died": {
        const p = this.person(String(b.person));
        if (p) p.events.push([l.t, b.event === "person_left" ? "left" : "died"]);
        return;
      }
    }
  }

  private openAccount(id: string, holder: string, balance: number) {
    this.holderOf.set(id, holder);
    const p = this.people.get(self(holder));
    if (!p) return;
    this.accountOf.set(id, p.id);
    p.accounts.push(id);
    p.opening += balance;
  }

  finish(_ctx: FoldContext): FoldResult {
    const bulk = [...this.kindCount].filter(([, n]) => n > BULK).map(([k]) => k).sort();
    const isBulk = new Set(bulk);
    const enc = new TextEncoder();
    const files: { [f: string]: Uint8Array } = {};
    for (const p of this.people.values()) {
      const items: LedgerItem[] = [];
      for (const it of p.items) {
        if (isBulk.has(it.kind) && !it.seat) p.counts[it.kind] = (p.counts[it.kind] ?? 0) + 1;
        else items.push(it);
      }
      p.items = items;
      files[`p-${p.id}`] = enc.encode(JSON.stringify(p));
    }
    const json: LedgerJson = {
      v: this.version,
      ...(this.seat ? { seat: this.seat } : {}),
      persons: this.people.size,
      bulk,
      records: this.index.filter((r) => !isBulk.has(r.kind)).map((r) => [r.id, r.kind, r.t, r.author, r.text]),
    };
    return { json, files };
  }
}

export const ledgerFold = (): Fold => new LedgerFold();
