// The `daily` fold: the town's day-by-day counts, for setting two arms of one seed side by side (the compare view,
// lens/src/client/compare). Raw named counts only, each with what it counts; nothing here says which arm did better.
//   records   records filed, by kind (a statement's kind, else the record's own: agreement, signature...)
//   refused   acts the world refused, by code
//   acts      acts sent (every participant), and the seat's own
//   transfers payments made: how many, and how many cents
//   town_net  cents into the town's own account less cents out of it (the office's entity's account, `acc-<entity>`)
//   people    people who left the town, died, fell ill
// Day d is [d, d+1) days from t 0; arrays run from day 0 to the last day in the log.
import type { Fold, FoldContext, FoldResult, LogLine } from "../shared/fold";

const DAY = 86_400;

export interface DailyJson {
  version: number;
  days: number;
  fork_at?: number;
  records: { [kind: string]: number[] };
  refused: { [code: string]: number[] };
  series: { [name: string]: number[] };
  /** What each series counts, for the legend. */
  legend: { [name: string]: string };
}

export const DAILY_LEGEND: { [name: string]: string } = {
  acts: "Acts sent by anyone (commands `act`)",
  seat_acts: "Acts sent by the seat",
  refused: "Acts the world refused (any participant)",
  seat_refused: "The seat's acts the world refused",
  transfers: "Payments made (events `transfer`)",
  transfer_cents: "Cents paid, all payments",
  town_net: "Cents into the town's own account less cents out",
  records: "Records filed (events `recorded`)",
  left: "People who left the town",
  died: "People who died",
  ill: "Illnesses that began",
};

class DailyFold implements Fold {
  readonly name = "daily";
  readonly version = 1;
  private readonly records = new Map<string, number[]>();
  private readonly refused = new Map<string, number[]>();
  private readonly series = new Map<string, number[]>(Object.keys(DAILY_LEGEND).map((k) => [k, []]));
  private seat = "mayor-system";
  private townAcc = "acc-city";
  private readonly seatActions = new Set<string>();
  private readonly seatCommands = new Set<number>();
  private last = 0;

  private bump(m: Map<string, number[]>, key: string, d: number, by = 1) {
    let a = m.get(key);
    if (!a) { a = []; m.set(key, a); }
    a[d] = (a[d] ?? 0) + by;
  }

  line(l: LogLine): void {
    const b = l.body;
    if (!b) return;
    if (l.kind === "header") {
      const mayor = (b.config?.positions ?? []).find((p: any) => p.id === "mayor");
      if (typeof mayor?.holder === "string") this.seat = mayor.holder;
      if (typeof mayor?.entity === "string") this.townAcc = `acc-${mayor.entity}`;
      return;
    }
    const d = Math.max(0, Math.floor(l.t / DAY));
    if (d > this.last) this.last = d;
    if (l.kind === "command") {
      if (b.command !== "act") return;
      this.bump(this.series, "acts", d);
      if (b.participant === this.seat) { this.bump(this.series, "seat_acts", d); this.seatCommands.add(l.seq); }
      return;
    }
    if (l.kind !== "event") return;
    switch (b.event) {
      case "recorded": { const r = b.record ?? {}; this.bump(this.records, String(r.kind ?? r.record ?? "?"), d); this.bump(this.series, "records", d); return; }
      case "action_started": if (this.seatCommands.has(b.cause)) { this.seatCommands.delete(b.cause); this.seatActions.add(String(b.action)); } return;
      case "action_applied": this.seatActions.delete(String(b.action)); return;
      case "action_refused":
        this.bump(this.refused, String(b.code ?? "?"), d); this.bump(this.series, "refused", d);
        if (this.seatActions.delete(String(b.action))) this.bump(this.series, "seat_refused", d);
        return;
      case "transfer": {
        const n = Number(b.amount ?? 0) || 0;
        this.bump(this.series, "transfers", d); this.bump(this.series, "transfer_cents", d, n);
        if (b.to === this.townAcc) this.bump(this.series, "town_net", d, n);
        if (b.from === this.townAcc) this.bump(this.series, "town_net", d, -n);
        return;
      }
      case "person_left": this.bump(this.series, "left", d); return;
      case "person_died": this.bump(this.series, "died", d); return;
      case "condition_began": if (b.kind === "illness") this.bump(this.series, "ill", d); return;
    }
  }

  finish(c: FoldContext): FoldResult {
    const ctx = c as FoldContext & { forkAt?: number; spec?: any };
    const days = this.last + 1;
    const dense = (a: number[]) => Array.from({ length: days }, (_, i) => a[i] ?? 0);
    const obj = (m: Map<string, number[]>) => Object.fromEntries([...m].map(([k, a]) => [k, dense(a)]));
    const forkAt = ctx.forkAt ?? (typeof ctx.spec?.forkDay === "number" ? ctx.spec.forkDay * DAY : undefined);
    const json: DailyJson = { version: this.version, days, ...(forkAt !== undefined ? { fork_at: forkAt } : {}), records: obj(this.records), refused: obj(this.refused), series: obj(this.series), legend: DAILY_LEGEND };
    return { json };
  }
}

export const dailyFold = (): Fold => new DailyFold();
