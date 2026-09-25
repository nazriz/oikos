// The preview (option B, §10): exactly what the resolved acts will do, in
// world words, generated mechanically from the blocks, never written by the
// translator. The seat reads this before confirming.

import type { Block } from "@terrarium/seats";
import type { Knowledge } from "./knowledge";

const DAY = 86_400;
const $ = (cents: number) => {
  const d = Math.floor(Math.abs(cents) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cents < 0 ? "-" : ""}$${d}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
};
const span = (s: number) => (s % (365 * DAY) === 0 ? `${s / (365 * DAY)} year${s === 365 * DAY ? "" : "s"}` : s % DAY === 0 ? `${s / DAY} day${s === DAY ? "" : "s"}` : `${s} seconds`);

export class Preview {
  constructor(private k: Knowledge) {}

  private who(id: string | undefined): string {
    if (!id) return "someone";
    if (id.startsWith("$")) return `the new ${id.slice(1)}`;
    return this.k.entityOf(id) === this.k.entity ? "you" : this.k.name(id);
  }
  private acct(id: string): string {
    const holder = this.k.accounts.get(id)?.holder;
    if (holder === this.k.entity) return `your account (${id})`;
    return id;
  }
  private details(data: unknown): string {
    if (data === null || typeof data !== "object") return "";
    const entries = Object.entries(data as object);
    const flat = entries.every(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v));
    const s = flat ? entries.map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("; ") : JSON.stringify(data);
    return s.length > 600 ? s.slice(0, 600) + "…" : s;
  }

  outcome(o: any, every?: number): string {
    const rep = every ? ` every ${span(every)}` : "";
    if (o?.money) return `pay ${$(o.money.amount)}${o.money.from ? ` from ${this.acct(o.money.from)}` : ""} to ${this.who(o.money.to)}${rep}${o.money.for ? `, for ${o.money.for}` : ""}`;
    if (o?.structure) return o.structure.remove ? `demolish ${o.structure.remove}` : `build a ${o.structure.type} on lot ${o.structure.on}`;
    if (o?.occupancy) return o.occupancy.leave ? `have ${this.who(o.occupancy.who)} leave ${o.occupancy.in}` : `give ${this.who(o.occupancy.who)} ${o.occupancy.count ?? 1} ${o.occupancy.slot ?? "place"}${(o.occupancy.count ?? 1) === 1 ? "" : "s"} in ${o.occupancy.in}`;
    if (o?.account) return o.account.close ? `close account ${o.account.close}` : `open an account for ${this.who(o.account.holder)}`;
    return "do something (see the terms)";
  }

  block(b: Block, next?: Block): string {
    switch (b.block) {
      case "publish": {
        if (b.kind === "request" && b.data?.outcome) return `You will ask ${this.who(b.addressed_to?.[0])} to ${this.outcome(b.data.outcome, b.data.every)}.`;
        const to = b.addressed_to?.length ? `, addressed to ${b.addressed_to.map((x: string) => this.who(x)).join(", ")}` : "";
        const seen = b.visible_to === "public" ? ", publicly" : Array.isArray(b.visible_to) ? `, seen only by ${b.visible_to.map((x: string) => this.who(x)).join(", ")}` : "";
        const d = this.details(b.data);
        return `You will publish a ${String(b.kind).replace(/_/g, " ")}${b.speaks_for && this.k.entityOf(b.speaks_for) !== this.k.entity ? ` in the name of ${this.who(b.speaks_for)}` : ""}${to}${seen}: "${b.text}"${d ? `, with these details: ${d}` : ""}${b.basis ? `, citing ${b.basis}` : ""}.`;
      }
      case "propose_agreement": {
        const t = b.terms;
        const others = t.parties.filter((p: string) => this.k.entityOf(p) !== this.k.entity && p !== b.speaks_for).map((p: string) => this.who(p));
        const commits = t.commitments.map((c: any) => `${this.who(c.who)} will ${c.does?.outcome ? this.outcome(c.does.outcome, c.every) : `do: ${JSON.stringify(c.does)}`}`).join("; ");
        const notices = (t.termination ?? []).map((x: any) => `${this.who(x.party)} may end it on ${span(x.notice)}' notice`).join("; ");
        const signs = next?.block === "sign_agreement" && next.agreement === `$${b.ref}` ? ", and sign it on your side" : "";
        return `You will offer ${others.join(" and ") || "the parties"} ${t.template ? `a ${t.template} agreement` : "an agreement"}${t.term ? ` for ${span(t.term)}` : ""}: ${commits || "(no commitments)"}${notices ? `; ${notices}` : ""}${t.text ? `. Its terms: "${t.text}"` : ""}${b.basis ? `. It cites ${b.basis}` : ""}${signs}.`;
      }
      case "sign_agreement":
        return `You will sign agreement ${b.agreement}${this.k.entityOf(b.as) === this.k.entity ? "" : ` for ${this.who(b.as)}`}.`;
      case "give_notice":
        return `You will give notice on agreement ${b.agreement}${b.text ? `: "${b.text}"` : ""}.`;
      case "transfer":
        return `You will move ${$(b.amount)} from ${this.acct(b.from)} to ${this.acct(b.to)}${b.memo ? `, for ${b.memo}` : ""}.`;
      case "open_account":
        return `You will open an account for ${this.who(b.holder)}, kept by you.`;
      case "close_account":
        return `You will close account ${b.account}.`;
      case "construct":
        return `You will start building a ${b.structure_type} on lot ${b.parcel} yourself, paying for materials from ${this.acct(b.materials_from)}.`;
      case "demolish":
        return `You will demolish ${b.structure} yourself, paying from ${this.acct(b.costs_from)}.`;
      case "occupy":
        return `You will move into ${b.structure} (${b.count} ${b.slot} place${b.count === 1 ? "" : "s"}).`;
      case "vacate":
        return this.k.entityOf(b.occupant) === this.k.entity ? `You will leave ${b.structure}.` : `You will remove ${this.who(b.occupant)} from ${b.structure}.`;
      case "create_entity":
        return `You will set up a new ${b.kind} called "${b.name}".`;
      case "record_claim": {
        const pos = ({ right: "has a right", liberty: "is permitted", power: "has the power", immunity: "is immune" } as Record<string, string>)[b.position] ?? `holds a ${b.position}`;
        return `You will record that ${this.who(b.holder)} ${pos}${b.counterparty ? ` against ${this.who(b.counterparty)}` : ""}: ${this.details(b.about) || "(no details)"}${b.basis ? `, citing ${b.basis}` : ""}.`;
      }
      case "transfer_claim":
        return `You will record that claim ${b.claim} now belongs to ${this.who(b.to)}.`;
      case "release_claim":
        return `You will release claim ${b.claim}.`;
      case "withdraw":
        return `You will withdraw ${b.record}${b.text ? `: "${b.text}"` : ""}.`;
      case "vote":
        return `You will vote "${b.choice}" on ${b.ballot}.`;
      case "message":
        return `You will write to ${b.to.map((x: string) => this.who(x)).join(", ")}: "${b.text}".`;
      default:
        return `You will do something the preview can't describe (${b.block}).`;
    }
  }

  /** The whole preview, one line per act; an offer and its signature read as one. */
  of(blocks: Block[]): string {
    const out: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      const next = blocks[i + 1];
      out.push(this.block(b, next));
      if (b.block === "propose_agreement" && next?.block === "sign_agreement" && next.agreement === `$${b.ref}`) i++;
    }
    return out.map((l, i) => (out.length > 1 ? `${i + 1}. ${l}` : l)).join("\n");
  }
}
