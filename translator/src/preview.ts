// The preview (option B, §10): exactly what the resolved acts will do, in
// world words, generated mechanically from the blocks, never written by the
// translator. The participant reads this before confirming.
//
// Nothing an act carries is left out. Each kind of act is put in a sentence, and whatever the sentence doesn't say
// (a law's rule and the formal condition it's checked by, a payment's invoice, who a record is visible to) follows
// it as "Also: …", by name. A law that reads one way and binds another, or binds nothing, shows here before it's
// confirmed (the 2026-10-05 audit: the preview left a statement's `adico` and `formal` out). The test changes every
// field of every kind of act and expects the preview to change.

import { formatMoney, type Block } from "@oikos/participants";
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
    return flat ? entries.map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("; ") : JSON.stringify(data);
  }
  /** Whatever of `o` the sentence before didn't say (every key but `said`), by name. */
  private also(o: any, said: string[], lead = " Also: "): string {
    const val = (v: unknown): string => (v === null || typeof v !== "object" ? String(v) : Array.isArray(v) && v.every((x) => x === null || typeof x !== "object") ? v.join(", ") : JSON.stringify(v));
    const more = Object.entries(o ?? {}).filter(([k, v]) => !said.includes(k) && v !== undefined).map(([k, v]) => `${k.replace(/_/g, " ")}: ${val(v)}`);
    return more.length ? `${lead}${more.join("; ")}.` : "";
  }
  private seenBy(v: unknown): string {
    return v === "public" ? ", publicly" : Array.isArray(v) ? `, seen only by ${v.map((x: string) => this.who(x)).join(", ")}` : v === undefined ? "" : `, visible to ${JSON.stringify(v)}`;
  }
  /** A law's rule, as its Institutional Grammar breakdown says it, and the condition offices and others check acts by. */
  private rule(b: any): string {
    const a = b.adico;
    const deontic = ({ may: "may", must: "must", must_not: "must not" } as Record<string, string>)[a?.deontic] ?? a?.deontic;
    const rule = a ? ` Its rule, as recorded: ${[a.attribute ?? "(nobody named)", deontic ?? "(may, must or must not isn't said)", a.aim ?? "(no action named)"].join(" ")}${a.condition ? `, ${a.condition}` : ""}${a.or_else ? `; or else: ${a.or_else}` : ""}.${this.also(a, ["attribute", "deontic", "aim", "condition", "or_else"])}` : "";
    const formal = b.formal ? ` The condition acts are checked against, as written${b.formal.language === "cel" ? "" : ` (in ${b.formal.language})`}: ${b.formal.condition}${this.also(b.formal, ["language", "condition"], " (").replace(/\.$/, ")")}.` : "";
    return rule + formal;
  }

  outcome(o: any, every?: number): string {
    const rep = every ? ` every ${span(every)}` : "";
    // (Whatever a sentence leaves out of its outcome follows it in brackets, by name.)
    const more = (x: any, said: string[]) => this.also(x, said, " (").replace(/\.$/, ")");
    if (o?.money) return `pay ${$(o.money.amount)}${o.money.from ? ` from ${this.acct(o.money.from)}` : ""} to ${this.who(o.money.to)}${rep}${o.money.for ? `, for ${o.money.for}` : ""}${o.money.settles ? `, settling ${o.money.settles}` : ""}${more(o.money, ["amount", "from", "to", "for", "settles"])}`;
    if (o?.goods) return `deliver ${o.goods.quantity} ${o.goods.kind}${o.goods.from ? ` from ${o.goods.from}` : ""} to ${this.who(o.goods.to)} at ${o.goods.at}${rep}${more(o.goods, ["quantity", "kind", "from", "to", "at"])}`;
    if (o?.structure) return `${o.structure.remove ? `demolish ${o.structure.remove}` : `build a ${o.structure.type} on ${o.structure.on}`}${rep}${more(o.structure, o.structure.remove ? ["remove"] : ["type", "on"])}`;
    if (o?.occupancy) return `${o.occupancy.leave ? `have ${this.who(o.occupancy.who)} leave ${o.occupancy.in}` : `let ${this.who(o.occupancy.who)} live or be in ${o.occupancy.in}`}${rep}${more(o.occupancy, ["who", "in", "leave"])}`;
    if (o?.account) return `${o.account.close ? `close account ${o.account.close}` : `open an account for ${this.who(o.account.holder)}`}${rep}${more(o.account, o.account.close ? ["close"] : ["holder"])}`;
    if (o?.work) return `do ${o.work.units !== undefined ? `${o.work.units} of ` : ""}${o.work.task}${o.work.hours !== undefined ? `, ${o.work.hours} hours` : ""}${o.work.at ? ` at ${o.work.at}` : ""}${rep}${more(o.work, ["units", "task", "hours", "at"])}`;
    if (o?.attend) return `attend ${o.attend.practice}${o.attend.role ? ` as ${o.attend.role}` : ""}${rep}${more(o.attend, ["practice", "role"])}`;
    return `do this${rep}: ${JSON.stringify(o)}`;
  }

  /** One act, in a sentence, and then whatever the sentence didn't say (`ref` aside: a name within the act itself). */
  block(b: Block, next?: Block): string {
    const [text, said] = this.sentence(b, next);
    return text + this.also(b, ["block", "ref", ...said]);
  }

  /** The sentence for an act, and which of its fields the sentence says. */
  private sentence(b: Block, next?: Block): [string, string[]] {
    const named = (x: any) => (x.speaks_for && this.k.entityOf(x.speaks_for) !== this.me ? ` in the name of ${this.who(x.speaks_for)}` : "");
    const citing = (x: any, lead = ", citing ") => (x.basis ? `${lead}${x.basis}` : "");
    const RECORD = ["speaks_for", "visible_to", "basis"]; // said by `named`, `seenBy` and `citing`, on the acts that make a record
    switch (b.block) {
      case "publish": {
        const to = b.addressed_to?.length ? `, addressed to ${b.addressed_to.map((x: string) => this.who(x)).join(", ")}` : "";
        if (b.kind === "request" && b.data?.outcome) {
          const rest = this.also(b.data, ["outcome", "every"], ", with these details: ").replace(/\.$/, "");
          return [`You will ask ${this.who(b.addressed_to?.[0])} to ${this.outcome(b.data.outcome, b.data.every)}${named(b)}${b.addressed_to?.length > 1 ? to : ""}${this.seenBy(b.visible_to)}${rest}${citing(b)}. Your request will read: "${b.text}".${this.rule(b)}`,
            ["kind", "text", "data", "addressed_to", "adico", "formal", ...RECORD]];
        }
        const d = this.details(b.data);
        return [`You will ${b.place ? "put up" : "publish"} a ${String(b.kind).replace(/_/g, " ")}${b.place ? ` on ${b.place}` : ""}${named(b)}${to}${this.seenBy(b.visible_to)}: "${b.text}"${d ? `, with these details: ${d}` : ""}${citing(b)}.${this.rule(b)}`,
          ["kind", "text", "data", "place", "addressed_to", "adico", "formal", ...RECORD]];
      }
      case "propose_agreement": {
        const t = b.terms;
        const others = t.parties.filter((p: string) => this.k.entityOf(p) !== this.me && p !== b.speaks_for).map((p: string) => this.who(p));
        const commits = t.commitments.map((c: any) => `${this.who(c.who)} will ${c.does?.outcome ? this.outcome(c.does.outcome, c.every) : `do${c.every ? ` every ${span(c.every)}` : ""}: ${c.does?.text !== undefined && Object.keys(c.does).length === 1 ? `"${c.does.text}"` : JSON.stringify(c.does)}`}${this.also(c, ["who", "does", "every"], " (").replace(/\.$/, ")")}`).join("; ");
        const notices = (t.termination ?? []).map((x: any) => `${this.who(x.party)} may end it on ${span(x.notice)}' notice${this.also(x, ["party", "notice"], " (").replace(/\.$/, ")")}`).join("; ");
        const signs = this.signsWith(b, next) ? ", and sign it on your side" : "";
        return [`You will offer ${others.join(" and ") || "the parties"} ${t.template ? `a ${t.template} agreement` : "an agreement"}${named(b)}${t.term ? ` for ${span(t.term)}` : ""}${t.then === "periodic" ? ", continuing afterwards from one period to the next until someone ends it by notice" : ""}${this.seenBy(b.visible_to)}: ${commits || "(no commitments)"}${notices ? `; ${notices}` : ""}${t.text ? `. Its terms: "${t.text}"` : ""}${citing(b, ". It cites ")}${signs}. Its parties: ${t.parties.map((p: string) => this.who(p)).join(", ")}.${this.also(t, ["template", "parties", "commitments", "term", "termination", "text", ...(t.then === "periodic" ? ["then"] : [])])}`,
          ["terms", ...RECORD]];
      }
      case "sign_agreement":
        return [`You will sign agreement ${b.agreement} for ${this.who(b.as)}.`, ["agreement", "as"]];
      case "give_notice":
        return [`You will give notice on agreement ${b.agreement} for ${this.who(b.as)}${b.text ? `: "${b.text}"` : ""}.`, ["agreement", "as", "text"]];
      case "transfer":
        return [`You will move ${$(b.amount)} from ${this.acct(b.from)} to ${this.acct(b.to)}${b.memo ? `, for ${b.memo}` : ""}${b.settles ? `, settling ${b.settles}` : ""}${b.per_instruction ? `, as ${b.per_instruction} asked` : ""}.`, ["amount", "from", "to", "memo", "settles", "per_instruction"]];
      case "open_account":
        return [`You will open an account for ${this.who(b.holder)}, kept by you.`, ["holder"]];
      case "close_account":
        return [`You will close account ${b.account}.`, ["account"]];
      case "construct":
        return [`You will start building a ${b.structure_type} with its corner at ${b.at} yourself${b.materials_at ? `, with materials from what you hold at ${b.materials_at}` : ""}.`, ["structure_type", "at", "materials_at"]];
      case "demolish":
        return [`You will begin demolishing ${b.structure}: anyone inside will have to leave.`, ["structure"]];
      case "work":
        return [`${(b.performers ?? []).length ? `${(b.performers as string[]).map((p) => this.who(p)).join(" and ")} will do` : "You will do"} ${b.units} of ${b.task} at ${b.at}${b.on ? `, on ${b.on}` : ""}.`, ["performers", "units", "task", "at", "on"]];
      case "move_goods":
        return [`You will move ${b.quantity} ${b.kind} from ${b.from_at} to ${b.to === this.me ? "yourself" : this.who(b.to)} at ${b.to_at}.`, ["quantity", "kind", "from_at", "to", "to_at"]];
      case "take":
        return [`You will take ${b.quantity} ${b.kind} from ${this.who(b.from)} at ${b.at}, without their agreement.`, ["quantity", "kind", "from", "at"]];
      case "occupy":
        return [b.who ? `You will bring ${this.who(b.who)} into ${b.space}.` : `You will move into ${b.space}.`, ["who", "space"]];
      case "vacate":
        return [this.k.entityOf(b.occupant) === this.k.entity ? `You will leave ${b.from}.` : `You will remove ${this.who(b.occupant)} from ${b.from}.`, ["occupant", "from"]];
      case "create_entity": {
        const p = b.first_position;
        return [`You will set up a new ${b.kind} called "${b.name}"${named(b)}${this.seenBy(b.visible_to)}${p ? `, with you as its ${p.title ?? "first officer"}${this.also(p, ["title", "ref"], " (").replace(/\.$/, ")")}` : ""}.`, ["kind", "name", "first_position", "speaks_for", "visible_to"]];
      }
      case "arrive":
        return [b.person ? `You will let ${this.who(b.person)} back into the world.` : `You will let a newcomer, ${b.name}, into the world${b.carrying ? `, carrying ${$(b.carrying)}` : ""}.`, b.person ? ["person"] : ["name", "carrying"]];
      case "leave":
        return [!b.person || this.k.entityOf(b.person) === this.k.entity ? "You will leave the world." : `You will remove ${this.who(b.person)} from the world.`, b.person && this.k.entityOf(b.person) !== this.k.entity ? ["person"] : []];
      case "birth":
        return [`You will conceive a child, to be named ${b.name}${b.with ? `, with ${this.who(b.with)}` : ""}.`, ["name", "with"]];
      case "harm":
        return [`You will physically harm ${this.who(b.person)}.`, ["person"]];
      case "create_position":
        return [`You will create a new position${b.title ? `, ${b.title}` : ""}${b.role ? ` (${b.role})` : ""}, vacant for now.`, ["title", "role"]];
      case "appoint":
        return [b.participant ? `You will appoint ${this.who(b.participant)} to ${b.position}.` : `You will leave ${b.position} with nobody in it.`, ["participant", "position"]];
      case "deploy":
        return [`You will put a new system to work${b.title ? `, ${b.title}` : ""} (${b.template}).`, ["title", "template"]];
      case "retire":
        return [`You will switch off ${b.participant} for good.`, ["participant"]];
      case "record_claim": {
        const pos = ({ right: "has a right", liberty: "is permitted", power: "has the power", immunity: "is immune" } as Record<string, string>)[b.position] ?? `holds a ${b.position}`;
        return [`You will record${named(b)} that ${this.who(b.holder)} ${pos}${b.counterparty ? ` against ${this.who(b.counterparty)}` : ""}: ${this.details(b.about) || "(no details)"}${this.seenBy(b.visible_to)}${citing(b)}.`, ["position", "holder", "counterparty", "about", ...RECORD]];
      }
      case "transfer_claim":
        return [`You will record${named(b)} that claim ${b.claim} now belongs to ${this.who(b.to)}${this.seenBy(b.visible_to)}${citing(b)}.`, ["claim", "to", ...RECORD]];
      case "release_claim":
        return [`You will release claim ${b.claim}${named(b)}${this.seenBy(b.visible_to)}${citing(b)}.`, ["claim", ...RECORD]];
      case "withdraw":
        return [`You will withdraw ${b.record}${named(b)}${b.text ? `: "${b.text}"` : ""}${this.seenBy(b.visible_to)}${citing(b)}.`, ["record", "text", ...RECORD]];
      case "vote":
        return [`You will vote "${b.choice}" on ${b.ballot}${named(b)}${this.seenBy(b.visible_to)}.`, ["choice", "ballot", "speaks_for", "visible_to"]];
      case "message":
        return [`You will write to ${b.to.map((x: string) => this.who(x)).join(", ")}${b.re ? `, about ${b.re}` : ""}: "${b.text}".`, ["to", "re", "text"]];
      default:
        return [`You will do this (${b.block}).`, []];
    }
  }

  /** Whether `next` is the offerer's own signature on the offer `b` (the two then read as one). */
  private signsWith(b: Block, next?: Block): boolean {
    return b.block === "propose_agreement" && next?.block === "sign_agreement" && next.agreement === `$${b.ref}` && this.k.entityOf(next.as) === this.me && Object.keys(next).every((k) => ["block", "agreement", "as", "ref"].includes(k));
  }

  /** The whole preview, one line per act; an offer and its signature read as one. */
  of(blocks: Block[]): string {
    const out: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      const next = blocks[i + 1];
      out.push(this.block(b, next));
      if (this.signsWith(b, next)) i++;
    }
    return out.map((l, i) => (out.length > 1 ? `${i + 1}. ${l}` : l)).join("\n");
  }
}
