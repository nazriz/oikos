// The preview (option B, §10): exactly what the resolved acts will do, in
// world words, generated mechanically from the blocks, never written by the
// translator. The participant reads this before confirming.

import { formatMoney, type Block } from "@terrarium/participants";
import type { Knowledge } from "./knowledge";

const DAY = 86_400;
const $ = formatMoney;
const span = (s: number) => (s % (365 * DAY) === 0 ? `${s / (365 * DAY)} year${s === 365 * DAY ? "" : "s"}` : s % DAY === 0 ? `${s / DAY} day${s === DAY ? "" : "s"}` : `${s} seconds`);

export class Preview {
  /** `me`: the entity it acts for (its person, or the organisation of the position it acts in). */
  constructor(private k: Knowledge, private me = k.entity) {}

  private who(id: string | undefined): string {
    if (!id) return "someone";
    if (id.startsWith("$")) return `the new ${id.slice(1)}`;
    const e = this.k.entityOf(id);
    return e === this.me || e === this.k.entity ? "you" : this.k.name(id);
  }
  private acct(id: string): string {
    const holder = this.k.accounts.get(id)?.holder;
    if (holder === this.me) return `your account (${id})`;
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
    if (o?.goods) return `deliver ${o.goods.quantity} ${o.goods.kind}${o.goods.from ? ` from ${o.goods.from}` : ""} to ${this.who(o.goods.to)} at ${o.goods.at}${rep}`;
    if (o?.structure) return o.structure.remove ? `demolish ${o.structure.remove}` : `build a ${o.structure.type} on ${o.structure.on}`;
    if (o?.occupancy) return o.occupancy.leave ? `have ${this.who(o.occupancy.who)} leave ${o.occupancy.in}` : `let ${this.who(o.occupancy.who)} live or be in ${o.occupancy.in}`;
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
        return `You will ${b.place ? "put up" : "publish"} a ${String(b.kind).replace(/_/g, " ")}${b.place ? ` on ${b.place}` : ""}${b.speaks_for && this.k.entityOf(b.speaks_for) !== this.me ? ` in the name of ${this.who(b.speaks_for)}` : ""}${to}${seen}: "${b.text}"${d ? `, with these details: ${d}` : ""}${b.basis ? `, citing ${b.basis}` : ""}.`;
      }
      case "propose_agreement": {
        const t = b.terms;
        const others = t.parties.filter((p: string) => this.k.entityOf(p) !== this.me && p !== b.speaks_for).map((p: string) => this.who(p));
        const commits = t.commitments.map((c: any) => `${this.who(c.who)} will ${c.does?.outcome ? this.outcome(c.does.outcome, c.every) : `do: ${JSON.stringify(c.does)}`}`).join("; ");
        const notices = (t.termination ?? []).map((x: any) => `${this.who(x.party)} may end it on ${span(x.notice)}' notice`).join("; ");
        const signs = next?.block === "sign_agreement" && next.agreement === `$${b.ref}` ? ", and sign it on your side" : "";
        return `You will offer ${others.join(" and ") || "the parties"} ${t.template ? `a ${t.template} agreement` : "an agreement"}${t.term ? ` for ${span(t.term)}` : ""}: ${commits || "(no commitments)"}${notices ? `; ${notices}` : ""}${t.text ? `. Its terms: "${t.text}"` : ""}${b.basis ? `. It cites ${b.basis}` : ""}${signs}.`;
      }
      case "sign_agreement":
        return `You will sign agreement ${b.agreement}${this.k.entityOf(b.as) === this.me ? "" : ` for ${this.who(b.as)}`}.`;
      case "give_notice":
        return `You will give notice on agreement ${b.agreement}${b.text ? `: "${b.text}"` : ""}.`;
      case "transfer":
        return `You will move ${$(b.amount)} from ${this.acct(b.from)} to ${this.acct(b.to)}${b.memo ? `, for ${b.memo}` : ""}.`;
      case "open_account":
        return `You will open an account for ${this.who(b.holder)}, kept by you.`;
      case "close_account":
        return `You will close account ${b.account}.`;
      case "construct":
        return `You will start building a ${b.structure_type} with its corner at ${b.at} yourself${b.materials_at ? `, with materials from what you hold at ${b.materials_at}` : ""}.`;
      case "demolish":
        return `You will begin demolishing ${b.structure}: anyone inside will have to leave.`;
      case "work":
        return `${(b.performers ?? []).length ? `${(b.performers as string[]).map((p) => this.who(p)).join(" and ")} will do` : "You will do"} ${b.units} of ${b.task} at ${b.at}${b.on ? `, on ${b.on}` : ""}.`;
      case "move_goods":
        return `You will move ${b.quantity} ${b.kind} from ${b.from_at} to ${b.to === this.me ? "yourself" : this.who(b.to)} at ${b.to_at}.`;
      case "occupy":
        return b.who ? `You will bring ${this.who(b.who)} into ${b.space}.` : `You will move into ${b.space}.`;
      case "vacate":
        return this.k.entityOf(b.occupant) === this.k.entity ? `You will leave ${b.from}.` : `You will remove ${this.who(b.occupant)} from ${b.from}.`;
      case "create_entity":
        return `You will set up a new ${b.kind} called "${b.name}"${b.first_position ? `, with you as its ${b.first_position.title ?? "first officer"}` : ""}.`;
      case "arrive":
        return b.person ? `You will let ${this.who(b.person)} back into the world.` : `You will let a newcomer, ${b.name}, into the world${b.carrying ? `, carrying ${$(b.carrying)}` : ""}.`;
      case "leave":
        return !b.person || this.k.entityOf(b.person) === this.k.entity ? "You will leave the world." : `You will remove ${this.who(b.person)} from the world.`;
      case "birth":
        return `You will conceive a child, to be named ${b.name}${b.with ? `, with ${this.who(b.with)}` : ""}.`;
      case "harm":
        return `You will physically harm ${this.who(b.person)}.`;
      case "create_position":
        return `You will create a new position${b.title ? `, ${b.title}` : ""}${b.role ? ` (${b.role})` : ""}, vacant for now.`;
      case "appoint":
        return b.participant ? `You will appoint ${this.who(b.participant)} to ${b.position}.` : `You will leave ${b.position} with nobody in it.`;
      case "deploy":
        return `You will put a new system to work${b.title ? `, ${b.title}` : ""} (${b.template}).`;
      case "retire":
        return `You will switch off ${b.participant} for good.`;
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
