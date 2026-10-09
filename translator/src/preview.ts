// The preview (option B, §10): exactly what the resolved acts will do, in
// world words, generated mechanically from the blocks, never written by the
// translator. The participant reads this before confirming.
//
// Nothing an act carries is left out. Each kind of act is put in a sentence, and whatever the sentence doesn't say
// (a law's rule and the formal condition it's checked by, a payment's invoice, who a record is visible to) follows
// it as "Also: …", by name. A law that reads one way and binds another, or binds nothing, shows here before it's
// confirmed (the 2026-10-05 audit: the preview left a statement's `adico` and `formal` out). The test changes every
// field of every kind of act and expects the preview to change.

import { basesOf, citedWords, formatMoney, forms, type Block } from "@oikos/participants";
import { duration, moment, readable, ruleWords, type FieldKinds } from "@oikos/participants/llm";
import type { Knowledge } from "./knowledge";

/** A length of time as people say one (years, days, hours and minutes: never a count of seconds where it is rounder). */
const span = duration;

export class Preview {
  /** `me`: the entity it acts for (its person, or the organisation of the position it acts in). */
  /** `called`: what someone the seat names is called, where the seat's own knowledge has no name for them (its own
   * organisation and that organisation's posts; anyone whose name is published). */
  constructor(private k: Knowledge, private me = k.entity, private called: (id: string) => string | undefined = () => undefined, /** The post the act is done in, if one. */ private as?: string) {}
  /** Someone by name and id (by id alone where no name is known). */
  private named(id: string): string {
    const known = this.k.name(id);
    const e = this.k.entityOf(id);
    const name = known === e ? this.called(e) : undefined;
    return name && name !== e ? `${name} (${e})` : known;
  }

  /** An amount as the world writes its money. */
  private sum(amount: string | number): string {
    return formatMoney(amount, this.k.currency);
  }

  private who(id: string | undefined): string {
    if (!id) return "someone";
    if (id.startsWith("$")) return `the new ${id.slice(1)}`;
    const e = this.k.entityOf(id);
    return e === this.me || e === this.k.entity ? "you" : this.named(id);
  }
  /**
   * Whoever something is addressed or sent to, as the seat knows them. Never "you" for the organisation it acts for or
   * for a post of it: a proposal put to the town, or a letter to its clerk, is not addressed to whoever writes it (the
   * live check of 2026-10-09: "addressed to you", "You will write to you", and a correct draft declined for it). A
   * post is named by its title; the organisation acted for by its name, said to be the one acted for.
   */
  private whom(id: string | undefined): string {
    if (!id) return "someone";
    if (id.startsWith("$")) return `the new ${id.slice(1)}`;
    if (this.k.positions.has(id)) {
      const title = this.k.positionWords.get(id)?.title ?? this.called(id);
      return title ? `the ${title.charAt(0).toLowerCase()}${title.slice(1)} (${id})` : id;
    }
    const e = this.k.entityOf(id);
    if (e !== this.me) return e === this.k.entity ? "you" : this.named(id);
    // Itself, or the organisation it acts for (which a post of its own is a post of).
    return [...this.k.positions.values()].includes(e) ? `${this.named(id)}, which you act for` : "you";
  }
  /** A paper's details as a person reads them: on a form, each field as the form says it is (an amount, a length of time, a date). */
  private read(data: unknown, form?: string): unknown {
    const fields = form === undefined ? undefined : (this.k.forms.find((f) => f.id === form)?.data?.fields as FieldKinds | undefined);
    return readable(data, { money: (a) => this.sum(a), ...(fields ? { fields } : {}) });
  }
  private acct(id: string): string {
    const holder = this.k.accounts.get(id)?.holder;
    if (holder === this.me) return `your account (${id})`;
    return id;
  }
  /**
   * The form of the office's own that a paper was made on (docs/behaviour/office-papers.md), found by writing the
   * paper back to its fields (a paper of this kind does not cite its form): the form, the fields it was filled in
   * with, and what the form says each of the paper's details is (an amount, a date), so that they read as money and
   * days. None: it is no paper of a form the seat holds.
   */
  private madeOn(b: any): { form: any; fields: forms.Filled; kinds: FieldKinds } | undefined {
    if (b.place || b.adico !== undefined || b.formal !== undefined) return undefined;
    const self = b.speaks_for ?? this.me;
    const paper: forms.Paper = { kind: b.kind, text: b.text, ...(b.data !== undefined ? { data: b.data } : {}), ...(b.addressed_to?.length ? { addressed_to: b.addressed_to } : {}),
      ...(b.visible_to !== undefined ? { visible_to: b.visible_to } : {}), ...(typeof b.basis === "string" ? { basis: b.basis } : {}), ...(b.offer !== undefined ? { offer: b.offer } : {}), ...(b.assertion !== undefined ? { assertion: b.assertion } : {}) };
    for (const f of this.k.forms) {
      const spec = f.data as forms.FormData | undefined;
      if (!spec?.writes || spec.writes.kind !== b.kind || typeof spec.office !== "string") continue;
      const got = forms.fieldsFor(spec, paper, { self, now: this.k.t, money: (a) => this.sum(a) });
      if (!got) continue;
      // (A detail the form writes from one field is what that field is.)
      const kinds: FieldKinds = {};
      const t = spec.writes.data;
      if (t && typeof t === "object" && !Array.isArray(t)) for (const [key, x] of Object.entries(t)) {
        const name = typeof x === "string" && /^[=#?+][a-z_][a-z0-9_]{0,31}$/.test(x) ? x.slice(1) : undefined;
        const type = name === undefined ? undefined : spec.fields[name]?.type;
        if (type === "amount" || type === "date" || (type === "duration" && x[0] === "=")) kinds[key] = { type };
      }
      return { form: f, fields: got.fields, kinds };
    }
    return undefined;
  }

  /**
   * Whom a paper made on the office's own form goes to, and why each: someone a field of the form names, with that
   * field and what the form says of it; someone the form itself sends every paper to, with the form's own reason
   * (`sends`), or, where the form gives none, that it is the form that names them. Then who else sees it. Nothing
   * here is the platform's: it is the form on the seat's own file, read out (wave 2b: a registrar took the two
   * bodies every death entry goes to for mistakes of the draft, and declined seven right registrations).
   */
  private goesTo(b: any, made: { form: any; fields: forms.Filled }): string {
    const to: string[] = b.addressed_to ?? [];
    if (!to.length) return "";
    const spec = made.form.data as forms.FormData;
    const me = b.speaks_for ?? this.me;
    const left = new Set(to);
    const parts: string[] = [];
    const names = (ids: string[]) => { const w = ids.map((x) => (x === me ? "your own organisation's file" : this.whom(x))); return w.length < 2 ? w.join("") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`; };
    for (const x of spec.writes!.to ?? []) {
      const name = typeof x === "string" && /^=[a-z_][a-z0-9_]{0,31}$/.test(x) && x !== "=self" ? x.slice(1) : undefined;
      if (name === undefined) continue;
      const v = made.fields[name];
      const ids = (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((id) => left.has(id));
      if (!ids.length) continue;
      for (const id of ids) left.delete(id);
      const says = spec.fields[name]?.description;
      parts.push(`${names(ids)} (${name.replace(/_/g, " ")} on the form${says ? `: "${says}"` : ""})`);
    }
    for (const s of spec.writes!.sends ?? []) {
      const ids = s.to.filter((id) => left.has(id));
      if (!ids.length) continue;
      for (const id of ids) left.delete(id);
      parts.push(`${names(ids)} (not for you to choose: the form, ${made.form.id}, sends every paper made on it to ${ids.length > 1 ? "them" : "it"}: "${s.why}")`);
    }
    if (left.size) parts.push(`${names([...left])} (named on the form itself, ${made.form.id}, for every paper made on it)`);
    const others = Array.isArray(b.visible_to) ? b.visible_to.filter((x: string) => x !== me && !to.includes(x) && this.k.entityOf(x) !== this.me) : [];
    const seen = b.visible_to === "public" ? " It is public." : Array.isArray(b.visible_to) ? ` It is seen only by you${others.length ? `, ${names(others)}` : ""} and those it goes to.` : "";
    return ` It goes to: ${parts.join("; ")}.${seen}`;
  }

  private details(raw: unknown, form?: string, kinds?: FieldKinds): string {
    if (raw === null || typeof raw !== "object") return "";
    const data = kinds ? readable(raw, { money: (a) => this.sum(a), fields: kinds }) : this.read(raw, form);
    if (data === null || typeof data !== "object") return String(data);
    const entries = Object.entries(data as object);
    const flat = entries.every(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v));
    return flat ? entries.map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("; ") : JSON.stringify(data);
  }
  /** Whatever of `o` the sentence before didn't say (every key but `said`), by name. */
  private also(o: any, said: string[], lead = " Also: "): string {
    const val = (v: unknown): string => (v === null || typeof v !== "object" ? String(v) : Array.isArray(v) && v.every((x) => x === null || typeof x !== "object") ? v.join(", ") : JSON.stringify(v));
    const left = Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => !said.includes(k) && v !== undefined));
    const more = Object.entries(this.read(left) as object).map(([k, v]) => `${k.replace(/_/g, " ")}: ${val(v)}`);
    return more.length ? `${lead}${more.join("; ")}.` : "";
  }
  private seenBy(v: unknown): string {
    return v === "public" ? ", publicly" : Array.isArray(v) ? `, seen only by ${v.map((x: string) => this.who(x)).join(", ")}` : v === undefined ? "" : `, visible to ${JSON.stringify(v)}`;
  }
  /** A law's rule and the condition acts are checked against, as anyone reading the law later is shown them. */
  private rule(b: any): string {
    const words = ruleWords(b, { asWritten: true });
    return words ? ` ${words}` : "";
  }

  /**
   * When a standing paper's first time falls, said as whoever acts on it will count it (participants: `firstDue`), so
   * that what is confirmed is what happens. A date given is that date. A length of time is counted from the moment
   * the paper is lodged, and is said so, with the day it comes to if it is lodged today. With neither, the keeper's
   * own rule is said: a standing payment's first falls one whole period after it is lodged (`otherwise`: that
   * period), a standing work order is in force at once (`otherwise`: none; of an order only when it comes into force
   * is said, which is all its staff read of it). (Until 2026-10-09 the length of time was shown as a date counted
   * from the world's start: "first: year 1, day 15" for 14 days asked on day 8.)
   */
  private firstFalls(d: { every: number; first?: number; first_at?: number }, what: string, otherwise: number): string {
    const now = this.k.t;
    const today = forms.dateWords(now);
    const then = `, and then every ${span(d.every)}`;
    if (what === "order") {
      if (Number.isSafeInteger(d.first_at)) return ` It is in force from ${forms.dateWords(d.first_at!)}${forms.dateWords(d.first_at!) === today ? ", which is today" : ""}.`;
      const wait = Number.isSafeInteger(d.first) ? d.first! : 0;
      return wait === 0 ? " It is in force as soon as it is on file." : ` It comes into force ${span(wait)} after it is put on file: on ${forms.dateWords(now + wait)} if that is today (${today}).`;
    }
    if (Number.isSafeInteger(d.first_at)) {
      const on = forms.dateWords(d.first_at!);
      return ` The first ${what} falls due on ${on}${on === today ? ", which is today" : ""}${then} from that date.`;
    }
    const wait = Number.isSafeInteger(d.first) ? d.first! : otherwise;
    const lead = Number.isSafeInteger(d.first) ? "" : otherwise > 0 ? "No first date is given: " : "";
    if (wait === 0) return ` ${lead}${lead ? "t" : "T"}he first ${what} falls due as soon as this is lodged${then}.`;
    return ` ${lead}${lead ? "t" : "T"}he first ${what} falls due ${span(wait)} after this is lodged${lead ? ", one whole period" : ""}: on ${forms.dateWords(now + wait)} if it is lodged today (${today})${then}.`;
  }

  /**
   * A payment that cites an agreement the seat has seen, set against what that agreement has it pay: the whole sum
   * agreed, or how much less or more, and for an employment agreement that the whole agreed pay has nothing withheld
   * from it. Only where the agreement cited has the payer pay one sum, and the payee is not known to be someone outside
   * it. Both papers are the seat's own to read; this says them side by side (wave 2b: a wage asked as "gross pay less
   * what the law says to withhold" was drafted at the gross figure, read as "pay 1.944,46 every 14 days, citing the
   * agreement and the tax law", and confirmed: nothing on the page said it was the whole agreed pay).
   */
  private againstAgreed(b: any): string {
    const m = b.data?.outcome?.money;
    if (!m || typeof m.amount !== "string" || !/^[0-9]+$/.test(m.amount)) return "";
    const payer = this.k.entityOf(b.speaks_for ?? this.me);
    const every: number | undefined = Number.isSafeInteger(b.data.every) && b.data.every > 0 ? b.data.every : undefined;
    for (const id of basesOf(b)) {
      const a = this.k.agreements.get(id);
      if (!a || this.k.withdrawn.has(id)) continue;
      const holder = this.k.accounts.get(m.to)?.holder;
      if (holder !== undefined && !a.parties.includes(holder)) continue;
      // (Paid where the agreement says: into the account it names; or, where it names a party and not an account, to
      // an account not known to be someone else's; or, where it names nowhere, anywhere.)
      const samePayee = (to?: string) => to === undefined || to === m.to || (a.parties.includes(this.k.entityOf(to)) && (holder === undefined || this.k.entityOf(to) === holder));
      const pays = a.pays.filter((p) => this.k.entityOf(p.who) === payer && samePayee(p.to));
      if (pays.length !== 1) continue;
      const agreed = pays[0]!;
      const job = a.template === "employment";
      const what = job ? "pay" : "sum";
      const terms = `${this.sum(agreed.amount)}${agreed.every ? ` every ${span(agreed.every)}` : ""}`;
      // (Paid at another rhythm than the agreement's, the two figures are not one period's: both are said, and no difference.)
      if (every !== undefined && agreed.every !== undefined && every !== agreed.every) return ` The ${what} agreed in ${id} is ${terms}; this pays ${this.sum(m.amount)} every ${span(every)}.`;
      const one = every === undefined && agreed.every !== undefined ? `one period's ${what}` : `the ${what}`;
      const diff = BigInt(m.amount) - BigInt(agreed.amount);
      if (diff === 0n) return ` This is the whole of ${one} agreed in ${id} (${terms})${job ? ", with nothing withheld from it" : ""}.`;
      return ` This is ${this.sum((diff < 0n ? -diff : diff).toString())} ${diff < 0n ? "less" : "more"} than ${one} agreed in ${id} (${terms}).`;
    }
    return "";
  }

  /**
   * How often a standing work order is carried out, where that is not simply the rhythm the seat gave: the paper
   * that sets when, with what the office's own procedure says of the routine; a rhythm taken from that procedure
   * because the order gave none; or a rhythm given for a routine whose time a paper sets whatever an order says.
   * All of it is the seat's own procedure, read out.
   */
  private rhythmOf(d: any): string {
    const task = String(d.work?.task);
    const r = this.k.routine(task);
    const adopted = typeof d.by_procedure === "string";
    if (typeof d.schedule === "string") return ` ${adopted ? "It gives no rhythm of its own: when" : "When"} ${task} is done is set by ${d.schedule}, as your office's procedure${r ? ` (${r.procedure})` : ""} says${this.saidOf(task, r?.procedure)}`;
    if (adopted) return ` It gives no rhythm of its own: every ${span(d.every)} is the office's own rhythm for ${task}, by its procedure (${d.by_procedure}).`;
    if (r?.schedule) return ` By your office's procedure (${r.procedure}) when ${task} is done is set by ${r.schedule}, whatever an order says of how often: the staff keep to that.`;
    return "";
  }
  /** What a procedure the seat has on file says of one of its routines, quoted (": \"...\""), or a full stop. */
  private saidOf(task: string, procedure?: string): string {
    const text = procedure === undefined ? undefined : this.k.procedureText(procedure);
    const at = text?.indexOf(` ${task}, at `) ?? -1;
    if (text === undefined || at < 0) return ".";
    const from = text.indexOf(": ", at) + 2;
    const rest = text.slice(from);
    const end = rest.search(/ (When it is done is set by|The office's own rhythm for it is) /);
    return `: "${(end < 0 ? rest : rest.slice(0, end)).trim().slice(0, 600)}"`;
  }

  outcome(o: any, every?: number): string {
    const rep = every ? ` every ${span(every)}` : "";
    // (Whatever a sentence leaves out of its outcome follows it in brackets, by name.)
    const more = (x: any, said: string[]) => this.also(x, said, " (").replace(/\.$/, ")");
    if (o?.money) return `pay ${this.sum(o.money.amount)}${o.money.from ? ` from ${this.acct(o.money.from)}` : ""} to ${this.who(o.money.to)}${rep}${o.money.for ? `, for ${o.money.for}` : ""}${o.money.settles ? `, settling ${o.money.settles}` : ""}${more(o.money, ["amount", "from", "to", "for", "settles"])}`;
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
    const citing = (x: any, lead = ", citing ") => (x.basis ? `${lead}${citedWords(x)}` : "");
    const RECORD = ["speaks_for", "visible_to", "basis"]; // said by `named`, `seenBy` and `citing`, on the acts that make a record
    switch (b.block) {
      case "publish": {
        const to = b.addressed_to?.length ? `, addressed to ${b.addressed_to.map((x: string) => this.whom(x)).join(", ")}` : "";
        if (b.kind === "request" && b.data?.outcome) {
          // (Of a standing instruction, when its first time falls is said in a sentence of its own, as it will be counted.)
          const standing = Number.isSafeInteger(b.data.every) && b.data.every > 0;
          const rest = this.also(b.data, ["outcome", "every", ...(standing ? ["first", "first_at"] : [])], ", with these details: ").replace(/\.$/, "");
          return [`You will ask ${this.whom(b.addressed_to?.[0])} to ${this.outcome(b.data.outcome, b.data.every)}${named(b)}${b.addressed_to?.length > 1 ? to : ""}${this.seenBy(b.visible_to)}${rest}${citing(b)}. Your request will read: "${b.text}".${standing ? this.firstFalls(b.data, b.data.outcome?.money ? "payment" : "time", b.data.every) : ""}${this.againstAgreed(b)}${this.rule(b)}`,
            ["kind", "text", "data", "addressed_to", "adico", "formal", ...RECORD]];
        }
        // A hold: an instruction to whoever acts on something standing. What it does is theirs to do, and it settles nothing.
        if (b.kind === "hold" && Array.isArray(b.data?.holds) && b.addressed_to?.length) {
            const held = b.data.holds as string[];
            const many = held.length > 1;
            const rest = this.also(b.data, ["holds"], " With these details: ");
            // (On its own file, where what is held is the organisation's own to act on: its own staff read it.)
            const ownFile = b.addressed_to.every((x: string) => this.k.entityOf(x) === this.me);
            return [`You will ${ownFile ? "tell your own staff, on your own file," : `instruct ${b.addressed_to.map((x: string) => this.whom(x)).join(", ")}`} to hold ${held.join(", ")}${named(b)}${this.seenBy(b.visible_to)}${citing(b)}. ${many ? "They stay" : "It stays"} on record. This by itself stops nothing and settles nothing: whoever you instruct acts on it, or doesn't, and whatever ${many ? "they were" : "it was"} for is still owed. To resume ${many ? "them" : "it"}, withdraw this instruction. Your instruction will read: "${b.text}".${rest}${this.rule(b)}`,
              ["kind", "text", "data", "addressed_to", "adico", "formal", ...RECORD]];
        }
        // A direction on an office's own form: what is filed, with whom, and that following it is the office's to do.
        const filedOn = typeof b.basis === "string" ? this.k.forms.find((f) => f.id === b.basis) : undefined;
        if (b.kind === "direction" && typeof filedOn?.data?.office === "string") {
          const office: string = filedOn.data.office;
          const title = this.k.positionWords.get(office)?.title;
          // Whose directions the office follows is its organisation's published rule: where the seat has that rule and
          // the post it writes in is not one of those named, the preview says so before anything is filed (a works
          // manager was twice offered a direction to its own office with nothing said: 2026-10-09). Only what the rule
          // itself says, which the seat has on file.
          const post = this.as ?? (this.k.held.size === 1 ? [...this.k.held][0] : undefined);
          const may = this.k.mayDirect(office);
          const titled = (p: string) => this.k.positionWords.get(p)?.title ? `the ${this.k.positionWords.get(p)!.title} (${p})` : p;
          const not = may && post && !may.posts.includes(post)
            ? ` The office will not follow it: by the rule on directions (${may.rule}) it takes written directions only from ${may.posts.map(titled).join(" and ") || "nobody"}, and this one is given as ${titled(post)}.${post === office ? " A direction is how others direct an office; what its own staff are to do as routine is set by a standing work order on its own file." : ""}`
            : "";
          return [`You will give ${title ? `the ${title} (${office})` : office} a written direction on its ${String(filedOn.data.form).replace(/_/g, " ")} form (${filedOn.id})${named(b)}${this.seenBy(b.visible_to)}: "${b.text}".${not} This by itself changes nothing: the office follows a direction only from those its organisation's rules say may direct it, and writes back to say whether it does. It stands until you replace it with another or withdraw it.${this.rule(b)}`,
            ["kind", "text", "data", "addressed_to", "adico", "formal", ...RECORD]];
        }
        // A standing work order: on the organisation's own file, for its staff to follow. Nothing is done now.
        if (b.kind === "work_order" && b.data?.work && (b.data?.every || typeof b.data?.schedule === "string")) {
          const others = (Array.isArray(b.visible_to) ? b.visible_to : []).filter((x: string) => this.k.entityOf(x) !== (b.speaks_for ?? this.me));
          return [`You will put a standing work order on ${this.k.entityOf(b.speaks_for ?? this.me) === this.me ? "your own file" : `the file of ${this.who(b.speaks_for)}`}${others.length ? `, shown to ${others.map((x: string) => this.who(x)).join(", ")}` : ""}: "${b.text}". Nothing is done now: the staff whose work it is follow it each time it falls due, in their own working hours, while it stands.${this.rhythmOf(b.data)}${this.firstFalls(b.data, "order", 0)}${Number.isSafeInteger(b.data.until) ? (b.data.until % 86_400 === 0 ? ` It stands to the end of ${forms.dateWords(b.data.until - 86_400)}.` : ` It stands until ${moment(b.data.until)}.`) : ""}${this.k.ownStaff?.inPost === 0 && this.k.entityOf(b.speaks_for ?? this.me) === this.me ? ` There is nobody in the post whose work this is: your office has no ${this.k.ownStaff.role} in post, so nothing is done under it until someone is taken on.` : ""} To change it, withdraw it and make another; to pause it, put it on hold.${citing(b, " It cites ")}${this.rule(b)}`,
            ["kind", "text", "data", "addressed_to", "adico", "formal", ...RECORD]];
        }
        // A paper of the office's own, made on its form: its details read as the form says each is, and of everyone
        // it goes to, why, in the form's own words.
        const made = this.madeOn(b);
        if (made) {
          const dd = this.details(b.data, undefined, made.kinds);
          const goes = this.goesTo(b, made);
          return [`You will publish a${/^[aeiou]/i.test(String(b.kind)) ? "n" : ""} ${String(b.kind).replace(/_/g, " ")}${named(b)}${goes ? "" : this.seenBy(b.visible_to)}: "${b.text}"${dd ? `, with these details: ${dd}` : ""}${citing(b)}.${goes}${this.rule(b)}`,
            ["kind", "text", "data", "addressed_to", "adico", "formal", ...RECORD]];
        }
        const d = this.details(b.data, typeof b.basis === "string" ? b.basis : undefined);
        // On its own file: seen by nobody but whoever it is made for, and addressed to nobody.
        const own = Array.isArray(b.visible_to) && b.visible_to.length === 1 && b.visible_to[0] === (b.speaks_for ?? this.me) && !b.addressed_to?.length && !b.place;
        if (own) {
          const kind = String(b.kind).replace(/_/g, " ");
          return [`You will put a${/^[aeiou]/.test(kind) ? "n" : ""} ${kind} on ${this.k.entityOf(b.visible_to[0]) === this.me ? "your own file" : `the file of ${this.who(b.visible_to[0])}`}, seen by nobody else: "${b.text}"${d ? `, with these details: ${d}` : ""}${citing(b)}. It moves nothing and tells nobody.${this.rule(b)}`,
            ["kind", "text", "data", "adico", "formal", ...RECORD]];
        }
        return [`You will ${b.place ? "put up" : "publish"} a${/^[aeiou]/i.test(String(b.kind)) ? "n" : ""} ${String(b.kind).replace(/_/g, " ")}${b.place ? ` on ${b.place}` : ""}${named(b)}${to}${this.seenBy(b.visible_to)}: "${b.text}"${d ? `, with these details: ${d}` : ""}${citing(b)}.${this.rule(b)}`,
          ["kind", "text", "data", "place", "addressed_to", "adico", "formal", ...RECORD]];
      }
      case "propose_agreement": {
        const t = b.terms;
        const others = t.parties.filter((p: string) => this.k.entityOf(p) !== this.me && p !== b.speaks_for).map((p: string) => this.who(p));
        const commits = t.commitments.map((c: any) => `${this.who(c.who)} will ${c.does?.outcome ? this.outcome(c.does.outcome, c.every) : `do${c.every ? ` every ${span(c.every)}` : ""}: ${c.does?.text !== undefined && Object.keys(c.does).length === 1 ? `"${c.does.text}"` : JSON.stringify(c.does)}`}${this.also(c, ["who", "does", "every"], " (").replace(/\.$/, ")")}`).join("; ");
        const notices = (t.termination ?? []).map((x: any) => `${this.who(x.party)} may end it on ${span(x.notice)}' notice${this.also(x, ["party", "notice"], " (").replace(/\.$/, ")")}`).join("; ");
        const signs = this.signsWith(b, next) ? ", and sign it on your side" : "";
        // An offer of employment that says nothing of where the work is: made on an advertisement, it is on the
        // advertisement's terms; made on none, whoever signs it has nowhere to come to work (2026-10-09: a crew of
        // five was taken on by offers of the pay alone, and none of them ever came to the depot).
        let place = "";
        if (t.template === "employment" && this.k.entityOf(b.speaks_for ?? this.me) === this.me && !t.commitments.some((c: any) => c.does?.outcome?.occupancy)) {
          const ad = this.k.advertisedJob(Array.isArray(b.basis) ? b.basis : typeof b.basis === "string" ? [b.basis] : []);
          place = ad ? ` It names no place of work: it is made on the job advertisement ${ad.advertisement}, so the work is where that advertisement says${ad.space ? ` (${ad.space})` : ""}.`
            : " It names no place of work and cites no job advertisement that does: whoever signs it is paid and has nowhere to come to work. Cite the advertisement or the application it answers, or say where they are to work.";
        }
        return [`You will offer ${others.join(" and ") || "the parties"} ${t.template ? `a${/^[aeiou]/i.test(String(t.template)) ? "n" : ""} ${t.template} agreement` : "an agreement"}${named(b)}${t.term ? ` for ${span(t.term)}` : ""}${t.then === "periodic" ? ", continuing afterwards from one period to the next until someone ends it by notice" : ""}${this.seenBy(b.visible_to)}: ${commits || "(no commitments)"}${notices ? `; ${notices}` : ""}${t.text ? `. Its terms: "${t.text}"` : ""}${citing(b, ". It cites ")}${signs}. Its parties: ${t.parties.map((p: string) => this.who(p)).join(", ")}.${place}${this.also(t, ["template", "parties", "commitments", "term", "termination", "text", ...(t.then === "periodic" ? ["then"] : [])])}`,
          ["terms", ...RECORD]];
      }
      case "sign_agreement":
        return [`You will sign agreement ${b.agreement} for ${this.who(b.as)}.`, ["agreement", "as"]];
      case "give_notice":
        return [`You will give notice on agreement ${b.agreement} for ${this.who(b.as)}${b.text ? `: "${b.text}"` : ""}.`, ["agreement", "as", "text"]];
      case "transfer":
        return [`You will move ${this.sum(b.amount)} from ${this.acct(b.from)} to ${this.acct(b.to)}${b.memo ? `, for ${b.memo}` : ""}${b.settles ? `, settling ${b.settles}` : ""}${b.per_instruction ? `, as ${b.per_instruction} asked` : ""}.`, ["amount", "from", "to", "memo", "settles", "per_instruction"]];
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
        return [b.person ? `You will let ${this.who(b.person)} back into the world.` : `You will let a newcomer, ${b.name}, into the world${b.carrying ? `, carrying ${this.sum(b.carrying)}` : ""}.`, b.person ? ["person"] : ["name", "carrying"]];
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
        return [`You will write to ${b.to.map((x: string) => this.whom(x)).join(", ")}${b.re ? `, about ${b.re}` : ""}: "${b.text}".`, ["to", "re", "text"]];
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
