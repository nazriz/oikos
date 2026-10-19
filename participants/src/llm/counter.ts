// What an office's counter takes off its office-holder (docs/behaviour/standing-work.md, "The counter"). A real office's
// counter staff sort and answer what is routine under the office's procedure, and only what needs a decision reaches
// the office-holder, with a count and a sample of the rest. A seat reads two papers it is already shown on its standing
// file: the office's procedure (which kinds of paper its counter answers) and its own standing work order for `answer`
// (in force, not ended, not on hold). Nothing here is shown to anyone: it is read, the same way the staff read it
// (`StandingWork.order`), from what the seat already has.

import type { Observation, Record } from "../contracts";
import { Book, StandingWork } from "../shared/common";

export interface CounterView {
  /** Whether a paper that has come is the counter's (not the seat's): of a kind the procedure lists, while the order is
   * in force, and neither addressed to one of the seat's own posts nor resting on a paper the seat made. */
  counters(r: Record): boolean;
  /** The kinds the procedure lists, with how the counter answers each. */
  kinds: Map<string, string>;
}

export class CounterWatch {
  private readonly book = new Book();
  private readonly work: StandingWork;
  /** The papers the seat itself made (never the staff's): a paper resting on one of them comes to the seat. */
  private readonly made = new Set<string>();
  /** The posts the seat holds: its office's procedure and orders are those made for them (the organisation's other offices have their own). */
  private readonly posts = new Set<string>();

  constructor(private readonly entity: string | undefined, private readonly participant: string, private readonly standing: ReadonlySet<string>) {
    this.work = new StandingWork(entity ?? "", "seat", this.posts);
  }

  /** Take in what an observation brings: the standing file (procedure, orders, holds), the seat's own papers, its posts. */
  absorb(obs: Observation): void {
    if (!this.entity || !this.standing.size) return;
    for (const p of obs.positions ?? []) this.posts.add(p.position);
    const channels: Observation["channels"] = {};
    for (const [id, ch] of Object.entries(obs.channels)) {
      if (ch.kind !== "records") continue;
      if (this.standing.has(id)) channels[id] = ch;
      if (!ch.search) for (const r of ch.records) if (r.author === this.participant) this.made.add(r.id);
    }
    this.book.absorb({ ...obs, channels });
  }

  /** The counter as it stands at a time: none if the office has none, or no order for it is in force. */
  view(t: number): CounterView | undefined {
    const proc = this.book.standingOf("procedure").filter((r) => r.speaks_for === this.entity && Array.isArray(r.data?.routines) && (typeof r.data?.office !== "string" || this.posts.has(r.data.office)));
    // (Any routine whose procedure lists the papers its staff deal with, while its own standing order is in force: the
    // counter's `answer`, and since 2026-10-11 a routine such as the support office's, whose staff decide the claims.)
    const kinds = new Map<string, string>();
    for (const r of proc) for (const x of r.data!.routines as { task?: string; papers?: { kind?: string; how?: string }[] }[]) {
      if (typeof x.task !== "string" || !x.papers?.length || !this.work.order(this.book, x.task, t)) continue;
      for (const k of x.papers) if (typeof k.kind === "string") kinds.set(k.kind, String(k.how ?? ""));
    }
    if (!kinds.size) return undefined;
    return {
      kinds,
      counters: (r) => r.record === "statement" && kinds.has(r.kind)
        && !(r.addressed_to ?? []).some((x) => this.posts.has(x)) && !(r.basis !== undefined && [r.basis].flat().some((b) => this.made.has(b))),
    };
  }
}
