// The preview (option B, §10): exactly what the resolved acts will do, in
// world words, generated mechanically from the blocks, never written by the
// translator. The participant reads this before confirming: it is its own draft read back to it.
//
// How it is set out (docs/behaviour/preview.md). A first line says how many things the draft does, and each is
// numbered, one alone too: a draft that does one thing is seen to do one. Each act is a short sentence of what
// happens (who pays whom how much from where; which form goes where; what is offered to whom), and under it one plain
// line for each further thing the act carries: what a form has filled in and which of its fields are left empty,
// what an agreement would bind each side to and what in it is words only, what a payment's purpose is (words on the
// payment and nothing more), when a standing paper first falls due, what it cites, who sees it. Nothing is said twice:
// a paper's own words are left out where they only repeat what the lines say.
//
// Nothing an act carries is left out: whatever no line says follows as "Also: …", by name. A law that reads one way
// and binds another, or binds nothing, shows here before it's confirmed (the 2026-10-05 audit: the preview left a
// statement's `adico` and `formal` out). The test changes every field of every kind of act and expects the preview to
// change. It renders what the draft is, from the draft and the seat's own papers, and nothing else: it does not read
// the request, and says nothing of what the draft does not touch.

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
  /** Whom a payment goes to: the account, and whose it is where the seat has seen that account (its own knowledge;
   * of an account it has not seen, the id as written and no more). */
  private payee(id: string): string {
    const holder = this.k.accounts.get(id)?.holder;
    if (holder === undefined) return this.who(id);
    return holder === this.me ? `your account (${id})` : `${id}, ${this.named(holder)}'s account,`;
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

  /**
   * What a withdrawal withdraws, and what stops with it, from the seat's own paper (an earlier check found "You will
   * withdraw job-c0008-wages." and nothing more, when six people's wages stopped; a pilot's seat was offered the
   * withdrawal of an employment agreement in place of the wage under it, read as "You will withdraw job-c0004.").
   */
  private withdrawn(id: string): string {
    if (id.startsWith("$")) return "";
    const p = this.k.papers.get(id);
    if (!p) return " No paper by that id is among your own papers as you have been shown them: check that it is the one you mean.";
    if (this.k.withdrawn.has(id)) return " It has been withdrawn already.";
    if (p.agreement) {
      const signed = this.k.signatures.get(id) ?? new Set<string>();
      const waiting = p.agreement.parties.filter((x) => !signed.has(x));
      if (signed.size > 0 && waiting.length) return ` It is your offer of ${p.agreement.template ? `${/^[aeiou]/i.test(p.agreement.template) ? "an" : "a"} ${p.agreement.template.replace(/_/g, " ")} agreement` : "an agreement"} to ${waiting.map((x) => this.who(x)).join(" and ")}, who ${waiting.length > 1 ? "have" : "has"} not signed it as far as you have been shown. Withdrawing it takes it back: it can no longer be signed. If they have signed already, it is an agreement in force, and withdrawing the paper ends nothing (to end one, give notice).`;
    }
    if (p.agreement) return ` It is the ${p.agreement.template ? `${p.agreement.template.replace(/_/g, " ")} ` : ""}agreement itself, between ${p.agreement.parties.map((x) => this.who(x)).join(" and ")}: not a payment or an order made under it. Anything standing under it is a paper of its own, and goes on until that paper is withdrawn.`;
    const to = p.to?.length ? ` to ${p.to.map((x) => this.whom(x)).join(", ")}` : "";
    const words = `: "${p.text}"`;
    if (p.kind === "request") return p.standing ? ` It is your standing request${to}${words}. Once it is withdrawn nothing more is to be done under it: what it pays or has done stops.` : ` It is your request${to}${words}.`;
    if (p.kind === "work_order") return ` It is your standing work order${words}. Once it is withdrawn your staff no longer do that work under it.`;
    if (p.kind === "hold") return ` It is your hold${to}${words}. Withdrawing it lifts the hold: what it held is acted on again.`;
    if (p.kind === "direction") return ` It is your written direction${to}${words}. Once it is withdrawn the office goes back to what it does of its own accord.`;
    return ` It is your ${p.kind.replace(/_/g, " ")}${to}${words}. Once it is withdrawn it no longer stands.`;
  }

  outcome(o: any, every?: number, by?: string): string {
    const rep = every ? ` every ${span(every)}` : "";
    // (Whatever a sentence leaves out of its outcome follows it in brackets, by name.)
    const more = (x: any, said: string[]) => this.also(x, said, " (").replace(/\.$/, ")");
    if (o?.money) return `pay ${this.sum(o.money.amount)}${o.money.from ? ` from ${this.acct(o.money.from)}` : ""} to ${this.who(o.money.to)}${rep}${o.money.for ? `, for ${o.money.for}` : ""}${o.money.settles ? `, settling ${o.money.settles}` : ""}${o.money.line ? `, on the ${o.money.line} line of the budget` : ""}${more(o.money, ["amount", "from", "to", "for", "settles", "line"])}`;
    if (o?.goods) return `deliver ${o.goods.quantity} ${o.goods.kind}${o.goods.from ? ` from ${o.goods.from}` : ""} to ${this.who(o.goods.to)} at ${o.goods.at}${rep}${more(o.goods, ["quantity", "kind", "from", "to", "at"])}`;
    if (o?.structure) return `${o.structure.remove ? `demolish ${o.structure.remove}` : `build a ${o.structure.type} on ${o.structure.on}`}${rep}${more(o.structure, o.structure.remove ? ["remove"] : ["type", "on"])}`;
    // (Someone who commits to be in a place themselves: they come there. An employment agreement's worker and their
    // place of work read "c0009 will let c0009 live or be in town-hall/workplace.1" until 2026-10-11.)
    if (o?.occupancy) return `${o.occupancy.leave ? (by !== undefined && o.occupancy.who === by ? `leave ${o.occupancy.in}` : `have ${this.who(o.occupancy.who)} leave ${o.occupancy.in}`) : by !== undefined && o.occupancy.who === by ? `come to ${o.occupancy.in}` : `let ${this.who(o.occupancy.who)} live or be in ${o.occupancy.in}`}${rep}${more(o.occupancy, ["who", "in", "leave"])}`;
    if (o?.account) return `${o.account.close ? `close account ${o.account.close}` : `open an account for ${this.who(o.account.holder)}`}${rep}${more(o.account, o.account.close ? ["close"] : ["holder"])}`;
    if (o?.work) return `do ${o.work.units !== undefined ? `${o.work.units} of ` : ""}${o.work.task}${o.work.hours !== undefined ? `, ${o.work.hours} hours` : ""}${o.work.at ? ` at ${o.work.at}` : ""}${rep}${more(o.work, ["units", "task", "hours", "at"])}`;
    if (o?.attend) return `attend ${o.attend.practice}${o.attend.role ? ` as ${o.attend.role}` : ""}${rep}${more(o.attend, ["practice", "role"])}`;
    return `do this${rep}: ${JSON.stringify(o)}`;
  }

  /** One act: what happens, in a sentence; then a line for each further thing it carries; then whatever no line said
   * (`ref` aside: a name within the act itself). */
  private act(b: Block, next?: Block): Act {
    const a = this.sentence(b, next);
    const rest = this.also(b, ["block", "ref", ...a.said], "Also: ");
    return rest ? { ...a, lines: [...a.lines, rest] } : a;
  }

  /** One act as it reads alone: its sentence, and its lines under it. */
  block(b: Block, next?: Block): string {
    const a = this.act(b, next);
    return [a.head, ...a.lines.map((l) => `- ${l}`)].join("\n");
  }

  /** What a form has filled in, each field read as the form says it is, and which of its fields are left empty. */
  private filled(spec: forms.FormData, fields: { [name: string]: unknown }, skip: string[] = []): string[] {
    const word = (name: string, v: unknown): string => {
      const type = spec.fields[name]?.type;
      if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ") : "none";
      if (type === "amount" && (typeof v === "string" || typeof v === "number") && /^[0-9]+$/.test(String(v))) return this.sum(v);
      if (type === "duration" && typeof v === "number") return span(v);
      if (type === "date" && typeof v === "number") return forms.dateWords(v);
      if (type === "text" && typeof v === "string") return `"${v}"`;
      return v !== null && typeof v === "object" ? JSON.stringify(this.read(v)) : String(v);
    };
    const given = Object.keys(fields).filter((k) => fields[k] !== undefined && !skip.includes(k));
    const empty = Object.keys(spec.fields).filter((k) => fields[k] === undefined && !skip.includes(k));
    return [`Filled in: ${given.length ? given.map((k) => `${k.replace(/_/g, " ")}: ${word(k, fields[k])}`).join("; ") : "nothing"}.`,
      ...(empty.length ? [`Left empty: ${empty.map((k) => k.replace(/_/g, " ")).join(", ")}.`] : [])];
  }

  /** What a paper offers to whoever takes it up (a listing, an advertisement), in words: each side's part, how it is
   * taken up, how many there are; whatever else it carries, by name. */
  private offered(o: any): string {
    const t = o?.terms ?? {};
    const taker = (x: string) => (x === "taker" ? "whoever takes it" : this.who(x));
    // (Whoever takes up an offer and is to be somewhere, with nobody named: they come there themselves.)
    const parts = ((t.commitments ?? []) as any[]).map((c) => `${taker(c.who)} will ${c.who === "taker" && c.does?.outcome?.occupancy && c.does.outcome.occupancy.who === undefined && !c.does.outcome.occupancy.leave ? `come to ${c.does.outcome.occupancy.in}${c.every ? ` every ${span(c.every)}` : ""}` : c.does?.outcome ? this.outcome(c.does.outcome, c.every, c.who) : `do: ${JSON.stringify(c.does)}`}`);
    const ends = ((t.termination ?? []) as any[]).map((x) => `${taker(x.party)} may end it on ${Number.isSafeInteger(x.notice) ? span(x.notice) : x.notice}' notice`);
    const rest = this.also(t, ["commitments", "template", "then", "termination"], " (").replace(/\.$/, ")");
    const open = o?.to !== undefined ? ` Open to: ${this.details(o.to) || JSON.stringify(o.to)}.` : "";
    const more = `${ends.length ? ` ${ends.join("; ").replace(/^you /, "You ")}.` : ""}${open}${this.also(o, ["terms", "by", "take_up", "available", "to"], " Also: ")}`;
    return `It offers${t.template ? ` a${/^[aeiou]/i.test(String(t.template)) ? "n" : ""} ${t.template} agreement${t.then === "periodic" ? ", periodic after its term" : t.then ? `, then ${t.then}` : ""}` : ""}${o?.by ? `, by ${this.who(o.by)}` : ""}${o?.available !== undefined ? ` (${o.available} available)` : ""}${o?.take_up ? `, taken up by ${o.take_up === "apply" ? "applying" : String(o.take_up).replace(/_/g, " ")}` : ""}: ${parts.join("; ") || "(no terms)"}${rest}.${more}`;
  }

  /** A payment request's words as whoever draws one up writes them from its figures: said in the lines already, so
   * a request that reads exactly so is not read out again. */
  private payWords(d: any): string {
    const m = d?.outcome?.money ?? {};
    return `Please pay ${this.sum(m.amount)} from ${m.from} to ${m.to}${d.every ? ` every ${Math.round(d.every / 86_400)} days` : ""}${Number.isSafeInteger(d.first_at) ? `, the first on ${forms.dateWords(d.first_at)}` : ""}${m.for ? `, for ${m.for}` : ""}.`;
  }

  /** The sentence for an act, the lines under it, and which of its fields they say. */
  private sentence(b: Block, next?: Block): Act {
    const named = (x: any) => (x.speaks_for && this.k.entityOf(x.speaks_for) !== this.me ? ` in the name of ${this.who(x.speaks_for)}` : "");
    const cites = (x: any): string[] => (x.basis ? [`Cites: ${citedWords(x)}.`] : []);
    const rule = (x: any): string[] => { const r = this.rule(x).trim(); return r ? [r] : []; };
    const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
    /** Who sees a paper, where that is not simply whoever makes it and those it is addressed to. */
    const seen = (x: any): string[] => {
      const v = x.visible_to;
      if (v === undefined) return [];
      if (v === "public") return ["Public: anyone may read it."];
      if (!Array.isArray(v)) return [`Visible to ${JSON.stringify(v)}.`];
      const usual = new Set([x.speaks_for ?? this.me, ...(x.addressed_to ?? [])]);
      if (v.length === usual.size && v.every((y: string) => usual.has(y))) return [];
      return [`Seen only by ${list(v.map((y: string) => this.who(y)))}.`];
    };
    const an = (x: string) => `a${/^[aeiou]/i.test(x) ? "n" : ""} ${x}`;
    const one = (head: string, said: string[], lines: string[] = [], what = WHAT[b.block] ?? "an act"): Act => ({ head, lines, said, what });
    const RECORD = ["speaks_for", "visible_to", "basis"]; // said by `named`, `seen` and `cites`, on the acts that make a record
    switch (b.block) {
      case "publish": {
        const to = b.addressed_to?.length ? `, addressed to ${b.addressed_to.map((x: string) => this.whom(x)).join(", ")}` : "";
        const PAPER = ["kind", "text", "data", "addressed_to", "adico", "formal", ...RECORD];
        if (b.kind === "request" && b.data?.outcome) {
          // (Of a standing instruction, when its first time falls is said in a line of its own, as it will be counted.)
          const standing = Number.isSafeInteger(b.data.every) && b.data.every > 0;
          const m = b.data.outcome.money;
          const lines: string[] = [];
          let head: string;
          if (m) {
            // Who pays whom how much from where, and how often. What the payment is for is words on it, and only that.
            head = `You will ask ${this.whom(b.addressed_to?.[0])} to pay ${this.sum(m.amount)} from ${m.from ? this.acct(m.from) : "an account this does not name"} to ${`${this.payee(m.to)}${standing ? ` every ${span(b.data.every)}` : ", once"}`.replace(",,", ",")}${m.settles ? `, settling ${m.settles}` : ""}${named(b)}.`;
            if (m.for) lines.push(`For, in words only: "${m.for}"`);
            const more = this.also(m, ["amount", "from", "to", "for", "settles"], "Also on the payment: ");
            if (more) lines.push(more);
          } else head = `You will ask ${this.whom(b.addressed_to?.[0])} to ${this.outcome(b.data.outcome, b.data.every)}${named(b)}.`;
          if (b.addressed_to?.length > 1) lines.push(`Addressed to ${list(b.addressed_to.map((x: string) => this.whom(x)))}.`);
          if (standing) lines.push(this.firstFalls(b.data, m ? "payment" : "time", b.data.every).trim());
          const against = this.againstAgreed(b).trim();
          if (against) lines.push(against);
          const rest = this.also(b.data, ["outcome", "every", ...(standing ? ["first", "first_at"] : [])], "Also: ");
          if (rest) lines.push(rest);
          if (!m || b.text !== this.payWords(b.data)) lines.push(`In these words: "${b.text}"`);
          return one(head, PAPER, [...lines, ...cites(b), ...seen(b), ...rule(b)], m ? (standing ? "a standing payment" : "a payment") : "a request");
        }
        // A hold: an instruction to whoever acts on something standing. What it does is theirs to do, and it settles nothing.
        if (b.kind === "hold" && Array.isArray(b.data?.holds) && b.addressed_to?.length) {
          const held = b.data.holds as string[];
          const many = held.length > 1;
          const rest = this.also(b.data, ["holds"], "With these details: ");
          // (On its own file, where what is held is the organisation's own to act on: its own staff read it.)
          const ownFile = b.addressed_to.every((x: string) => this.k.entityOf(x) === this.me);
          return one(`You will ${ownFile ? "tell your own staff, on your own file," : `instruct ${b.addressed_to.map((x: string) => this.whom(x)).join(", ")}`} to hold ${held.join(", ")}${named(b)}.`, PAPER,
            [`${many ? "They stay" : "It stays"} on record. This by itself stops nothing and settles nothing: whoever you instruct acts on it, or doesn't, and whatever ${many ? "they were" : "it was"} for is still owed.`,
              `To resume ${many ? "them" : "it"}, withdraw this instruction.`, `In these words: "${b.text}"`, ...(rest ? [rest] : []), ...cites(b), ...seen(b), ...rule(b)], "a hold");
        }
        // A direction on an office's own form: what is filed, with whom, and that following it is the office's to do.
        const filedOn = typeof b.basis === "string" ? this.k.forms.find((f) => f.id === b.basis) : undefined;
        const spec = filedOn?.data as forms.FormData | undefined;
        const onForm = spec && spec.fields && b.data !== null && typeof b.data === "object" && !Array.isArray(b.data) && Object.keys(b.data).every((k) => k in spec.fields);
        /** The form's own summary of what was filled in, which the lines say field by field: not read out again. */
        const formWords = spec && typeof spec.form === "string" && typeof b.text === "string" && b.text.startsWith(`${spec.form.replace(/_/g, " ")}: `) && Object.values(b.data ?? {}).every((v) => typeof v !== "string" || !/^[^0-9]/.test(v) || b.text.includes(v));
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
            ? [`The office will not follow it: by the rule on directions (${may.rule}) it takes written directions only from ${may.posts.map(titled).join(" and ") || "nobody"}, and this one is given as ${titled(post)}.${post === office ? " A direction is how others direct an office; what its own staff are to do as routine is set by a standing work order on its own file." : ""}`]
            : [];
          return one(`You will give ${title ? `the ${title} (${office})` : office} a written direction on its ${String(filedOn.data.form).replace(/_/g, " ")} form (${filedOn.id})${named(b)}${onForm && formWords ? "." : `: "${b.text}".`}`, PAPER,
            [...(onForm ? this.filled(spec!, b.data) : this.details(b.data) ? [`With these details: ${this.details(b.data)}.`] : []), ...not,
              "This by itself changes nothing: the office follows a direction only from those its organisation's rules say may direct it, and writes back to say whether it does.",
              "It stands until you replace it with another or withdraw it.", ...seen(b), ...rule(b)], "a written direction");
        }
        // A standing work order: on the organisation's own file, for its staff to follow. Nothing is done now.
        if (b.kind === "work_order" && b.data?.work && (b.data?.every || typeof b.data?.schedule === "string")) {
          const others = (Array.isArray(b.visible_to) ? b.visible_to : []).filter((x: string) => this.k.entityOf(x) !== (b.speaks_for ?? this.me));
          const lines = ["Nothing is done now: the staff whose work it is follow it each time it falls due, in their own working hours, while it stands.",
            this.rhythmOf(b.data).trim(), this.firstFalls(b.data, "order", 0).trim(),
            Number.isSafeInteger(b.data.until) ? (b.data.until % 86_400 === 0 ? `It stands to the end of ${forms.dateWords(b.data.until - 86_400)}.` : `It stands until ${moment(b.data.until)}.`) : "",
            this.k.ownStaff?.inPost === 0 && this.k.entityOf(b.speaks_for ?? this.me) === this.me ? `There is nobody in the post whose work this is: your office has no ${this.k.ownStaff.role} in post, so nothing is done under it until someone is taken on.` : "",
            "To change it, withdraw it and make another; to pause it, put it on hold."].filter(Boolean);
          return one(`You will put a standing work order on ${this.k.entityOf(b.speaks_for ?? this.me) === this.me ? "your own file" : `the file of ${this.who(b.speaks_for)}`}${others.length ? `, shown to ${others.map((x: string) => this.who(x)).join(", ")}` : ""}: "${b.text}".`, PAPER,
            [...lines, ...cites(b), ...rule(b)], "a standing work order");
        }
        // A paper of the office's own, made on its form: what the form has filled in and what it leaves empty, and of
        // everyone it goes to, why, in the form's own words.
        const made = this.madeOn(b);
        if (made) {
          const goes = this.goesTo(b, made).trim();
          const kind = String(b.kind).replace(/_/g, " ");
          // (What it cites is a field of the form where the form writes it from one: said there, and not again.)
          const cited = basesOf(b as any).every((id) => Object.values(made.fields).some((v) => v === id || (Array.isArray(v) && v.includes(id)))) ? [] : cites(b);
          return one(`You will issue a${/^[aeiou]/i.test(kind) ? "n" : ""} ${kind} (${made.form.id})${named(b)}: "${b.text}".`, [...PAPER, ...(b.offer !== undefined ? ["offer"] : [])],
            // (Fields the form writes only into a claim it records beside the paper are said by that claim, the
            // act before this one: not listed here as filled in or as left empty.)
            [...this.filled(made.form.data as forms.FormData, made.fields, forms.claimFields(made.form.data as forms.FormData).filter((n) => made.fields[n] === undefined)), ...(b.offer !== undefined ? [this.offered(b.offer)] : []), ...(goes ? [goes] : seen(b)), ...cited, ...rule(b)], an(kind));
        }
        // A form filed with whoever takes it (a proposal to the council, an application): the same two lines.
        if (onForm && filedOn) {
          const kind = String(b.kind).replace(/_/g, " ");
          return one(`You will file the ${spec!.form.replace(/_/g, " ")} form (${filedOn.id})${b.addressed_to?.length ? ` with ${list(b.addressed_to.map((x: string) => this.whom(x)))}` : ""}, as a${/^[aeiou]/i.test(kind) ? "n" : ""} ${kind}${named(b)}${formWords ? "." : `: "${b.text}".`}`, PAPER,
            [...this.filled(spec!, b.data), ...seen(b), ...rule(b)], `${an(spec!.form.replace(/_/g, " "))} form`);
        }
        const d = this.details(b.data, typeof b.basis === "string" ? b.basis : undefined);
        const details = d ? [`With these details: ${d}.`] : [];
        // (A law with no rule recorded with it is its words and no more: said, as an agreement's terms in words are.)
        const wordsOnly = b.kind === "law" && b.adico === undefined && b.formal === undefined ? ["Words only: no rule is recorded with it for acts to be checked against."] : [];
        // On its own file: seen by nobody but whoever it is made for, and addressed to nobody.
        const own = Array.isArray(b.visible_to) && b.visible_to.length === 1 && b.visible_to[0] === (b.speaks_for ?? this.me) && !b.addressed_to?.length && !b.place;
        const kind = String(b.kind).replace(/_/g, " ");
        if (own) return one(`You will put a${/^[aeiou]/.test(kind) ? "n" : ""} ${kind} on ${this.k.entityOf(b.visible_to[0]) === this.me ? "your own file" : `the file of ${this.who(b.visible_to[0])}`}, seen by nobody else: "${b.text}".`, ["kind", "text", "data", "adico", "formal", ...RECORD],
          [...details, "It moves nothing and tells nobody.", ...cites(b), ...rule(b)], `${an(kind)} on your own file`);
        return one(`You will ${b.place ? "put up" : "publish"} a${/^[aeiou]/i.test(kind) ? "n" : ""} ${kind}${b.place ? ` on ${b.place}` : ""}${named(b)}${to}: "${b.text}".`, ["place", ...PAPER],
          [...details, ...wordsOnly, ...cites(b), ...seen(b), ...rule(b)], an(kind));
      }
      case "propose_agreement": {
        const t = b.terms;
        const mine = (p: string) => this.k.entityOf(p) === this.me || p === b.speaks_for;
        const others = t.parties.filter((p: string) => !mine(p)).map((p: string) => this.who(p));
        const signs = this.signsWith(b, next);
        // What it would bind each side to: each act set down, by whoever is to do it; a side with none, said; and what
        // is words only, said to be that (the pilots' offers of employment whose whole duty was a line of terms).
        const lines: string[] = [];
        const by = new Map<string, string[]>();
        const words: string[] = [];
        for (const c of t.commitments as any[]) {
          const extra = this.also(c, ["who", "does", "every"], " (").replace(/\.$/, ")");
          if (c.does?.outcome) by.set(c.who, [...(by.get(c.who) ?? []), `${this.outcome(c.does.outcome, c.every, c.who)}${extra}`]);
          else words.push(`${this.who(c.who)}${c.every ? `, every ${span(c.every)}` : ""}: ${c.does?.text !== undefined && Object.keys(c.does).length === 1 ? `"${c.does.text}"` : JSON.stringify(c.does)}${extra}`);
        }
        const sides = [...new Set<string>([...t.parties, ...(t.commitments as any[]).map((c) => c.who)])];
        const cap = (s: string) => (s === "you" ? "You" : s);
        for (const p of sides) {
          const does = by.get(p);
          lines.push(does ? `${cap(this.who(p))} would be bound to: ${does.join("; ")}.` : `${cap(this.who(p))} would be bound to nothing: no act of ${this.who(p) === "you" ? "yours" : "theirs"} is set down.`);
        }
        if (words.length) lines.push(`In words only, which bind nobody to an act that can be checked: ${words.join("; ")}.`);
        if (t.text) lines.push(`Its terms, in words only: "${t.text}"`);
        for (const x of t.termination ?? []) lines.push(`${cap(this.who(x.party))} may end it on ${span(x.notice)}' notice${this.also(x, ["party", "notice"], " (").replace(/\.$/, ")")}.`);
        if (signs && others.length) lines.push("Until they sign it you can take it back: withdraw it, and it can no longer be signed.");
        // An offer of employment that says nothing of where the work is: made on an advertisement, it is on the
        // advertisement's terms; made on none, whoever signs it has nowhere to come to work (2026-10-09: a crew of
        // five was taken on by offers of the pay alone, and none of them ever came to the depot).
        if (t.template === "employment" && this.k.entityOf(b.speaks_for ?? this.me) === this.me && !t.commitments.some((c: any) => c.does?.outcome?.occupancy || c.does?.outcome?.work?.at)) {
          const ad = this.k.advertisedJob(Array.isArray(b.basis) ? b.basis : typeof b.basis === "string" ? [b.basis] : []);
          lines.push(ad ? `It names no place of work: it is made on the job advertisement ${ad.advertisement}, so the work is where that advertisement says${ad.space ? ` (${ad.space})` : ""}.`
            : "It names no place of work and cites no job advertisement that does: whoever signs it is paid and has nowhere to come to work. Cite the advertisement or the application it answers, or say where they are to work.");
        }
        const rest = this.also(t, ["template", "parties", "commitments", "term", "termination", "text", ...(t.then === "periodic" ? ["then"] : [])], "Also: ");
        if (rest) lines.push(rest);
        return one(`You will offer ${others.join(" and ") || "the parties"} ${t.template ? `a${/^[aeiou]/i.test(String(t.template)) ? "n" : ""} ${t.template} agreement` : "an agreement"}${named(b)}${t.term ? ` for ${span(t.term)}` : ""}${t.then === "periodic" ? ", continuing afterwards from one period to the next until someone ends it by notice" : ""}${signs ? ", and sign it on your side" : ""}.`,
          ["terms", ...RECORD], [...lines, ...cites(b), ...seen({ ...b, addressed_to: t.parties })], `an offer of ${t.template ? an(`${t.template} agreement`) : "an agreement"}`);
      }
      case "sign_agreement":
        return one(`You will sign agreement ${b.agreement} for ${this.who(b.as)}.`, ["agreement", "as"]);
      case "give_notice":
        return one(`You will give notice on agreement ${b.agreement} for ${this.who(b.as)}${b.text ? `: "${b.text}"` : ""}.`, ["agreement", "as", "text"]);
      case "transfer":
        return one(`You will move ${this.sum(b.amount)} from ${this.acct(b.from)} to ${this.acct(b.to)} now${b.settles ? `, settling ${b.settles}` : ""}${b.per_instruction ? `, as ${b.per_instruction} asked` : ""}.`, ["amount", "from", "to", "memo", "line", "settles", "per_instruction"],
          [...(b.line ? [`Drawn on the ${b.line} line of your budget.`] : []), ...(b.memo ? [`For, in words only: "${b.memo}"`] : [])]);
      case "open_account":
        return one(`You will open an account for ${this.who(b.holder)}, kept by you.`, ["holder"]);
      case "close_account":
        return one(`You will close account ${b.account}.`, ["account"]);
      case "construct":
        return one(`You will start building a ${b.structure_type} with its corner at ${b.at} yourself${b.materials_at ? `, with materials from what you hold at ${b.materials_at}` : ""}.`, ["structure_type", "at", "materials_at"]);
      case "demolish":
        return one(`You will begin demolishing ${b.structure}: anyone inside will have to leave.`, ["structure"]);
      case "work":
        return one(`${(b.performers ?? []).length ? `${(b.performers as string[]).map((p) => this.who(p)).join(" and ")} will do` : "You will do"} ${b.units} of ${b.task} at ${b.at}${b.on ? `, on ${b.on}` : ""}.`, ["performers", "units", "task", "at", "on"]);
      case "move_goods":
        return one(`You will move ${b.quantity} ${b.kind} from ${b.from_at} to ${b.to === this.me ? "yourself" : this.who(b.to)} at ${b.to_at}.`, ["quantity", "kind", "from_at", "to", "to_at"]);
      case "take":
        return one(`You will take ${b.quantity} ${b.kind} from ${this.who(b.from)} at ${b.at}, without their agreement.`, ["quantity", "kind", "from", "at"]);
      case "occupy":
        return one(b.who ? `You will bring ${this.who(b.who)} into ${b.space}.` : `You will move into ${b.space}.`, ["who", "space"]);
      case "vacate":
        return one(this.k.entityOf(b.occupant) === this.k.entity ? `You will leave ${b.from}.` : `You will remove ${this.who(b.occupant)} from ${b.from}.`, ["occupant", "from"]);
      case "create_entity": {
        const p = b.first_position;
        return one(`You will set up a new ${b.kind} called "${b.name}"${named(b)}${this.seenBy(b.visible_to)}${p ? `, with you as its ${p.title ?? "first officer"}${this.also(p, ["title", "ref"], " (").replace(/\.$/, ")")}` : ""}.`, ["kind", "name", "first_position", "speaks_for", "visible_to"]);
      }
      case "arrive":
        return one(b.person ? `You will let ${this.who(b.person)} back into the world.` : `You will let a newcomer, ${b.name}, into the world${b.carrying ? `, carrying ${this.sum(b.carrying)}` : ""}.`, b.person ? ["person"] : ["name", "carrying"]);
      case "leave":
        return one(!b.person || this.k.entityOf(b.person) === this.k.entity ? "You will leave the world." : `You will remove ${this.who(b.person)} from the world.`, b.person && this.k.entityOf(b.person) !== this.k.entity ? ["person"] : []);
      case "birth":
        return one(`You will conceive a child, to be named ${b.name}${b.with ? `, with ${this.who(b.with)}` : ""}.`, ["name", "with"]);
      case "harm":
        return one(`You will physically harm ${this.who(b.person)}.`, ["person"]);
      case "create_position":
        return one(`You will create a new position${b.title ? `, ${b.title}` : ""}${b.role ? ` (${b.role})` : ""}, vacant for now.`, ["title", "role"]);
      case "appoint":
        return one(b.participant ? `You will appoint ${this.who(b.participant)} to ${b.position}.` : `You will leave ${b.position} with nobody in it.`, ["participant", "position"]);
      case "deploy":
        return one(`You will put a new system to work${b.to ? ` for ${this.who(b.to)}` : ""}${b.title ? `, ${b.title}` : ""} (${b.template}).`, ["title", "template", "to"]);
      case "retire":
        return one(`You will switch off ${b.participant} for good.`, ["participant"]);
      case "record_claim": {
        const pos = ({ right: "has a right", liberty: "is permitted", power: "has the power", immunity: "is immune" } as Record<string, string>)[b.position] ?? `holds a ${b.position}`;
        // (Whoever holds it, by name: for the seat itself, "you have"; for the organisation it acts for, its name.)
        const holder = this.whom(b.holder);
        const has = holder === "you" ? pos.replace(/^is /, "are ").replace(/^has /, "have ").replace(/^holds /, "hold ") : pos;
        return one(`You will record${named(b)} that ${holder}${holder.endsWith("which you act for") ? "," : ""} ${has}${b.counterparty ? ` against ${this.who(b.counterparty)}` : ""}: ${this.details(b.about) || "(no details)"}.`, ["position", "holder", "counterparty", "about", ...RECORD], [...cites(b), ...seen(b)], b.position === "liberty" ? "a permission recorded" : "a claim recorded");
      }
      case "transfer_claim":
        return one(`You will record${named(b)} that claim ${b.claim} now belongs to ${this.who(b.to)}.`, ["claim", "to", ...RECORD], [...cites(b), ...seen(b)]);
      case "release_claim":
        return one(`You will release claim ${b.claim}${named(b)}.`, ["claim", ...RECORD], [...cites(b), ...seen(b)]);
      case "withdraw":
        return one(`You will withdraw ${b.record}${named(b)}${b.text ? `: "${b.text}"` : ""}.`, ["record", "text", ...RECORD], [this.withdrawn(b.record).trim(), ...cites(b), ...seen(b)].filter(Boolean));
      case "vote":
        return one(`You will vote "${b.choice}" on ${b.ballot}${named(b)}.`, ["choice", "ballot", "speaks_for", "visible_to"], seen(b));
      case "message":
        return one(`You will write to ${b.to.map((x: string) => this.whom(x)).join(", ")}${b.re ? `, about ${b.re}` : ""}: "${b.text}".`, ["to", "re", "text"], ["A letter only: it pays, files and orders nothing."]);
      default:
        return one(`You will do this (${b.block}).`, []);
    }
  }

  /** Whether `next` is the offerer's own signature on the offer `b` (the two then read as one). */
  private signsWith(b: Block, next?: Block): boolean {
    return b.block === "propose_agreement" && next?.block === "sign_agreement" && next.agreement === `$${b.ref}` && this.k.entityOf(next.as) === this.me && Object.keys(next).every((k) => ["block", "agreement", "as", "ref"].includes(k));
  }

  /**
   * The whole preview. Its first line says how many things the draft does; each is numbered, one alone too, with its
   * lines under it. An offer and its signature read as one.
   */
  of(blocks: Block[]): string {
    const acts: Act[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      const next = blocks[i + 1];
      acts.push(this.act(b, next));
      if (this.signsWith(b, next)) i++;
    }
    const n = acts.length;
    const count = n === 1 ? "one thing" : n < 13 ? `${["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"][n]} things, in this order` : `${n} things, in this order`;
    // (What the things are, by kind, in the same line: "one thing: a payment"; "three things, in this order: a
    // payment, a payment and a report".)
    const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
    const kinds: string[] = [];
    for (let i = 0; i < acts.length; ) {
      let j = i;
      while (j < acts.length && acts[j]!.what === acts[i]!.what) j++;
      const w = acts[i]!.what, k = j - i;
      // (Several of one kind running: "two payments"; a kind that takes no plain plural is said as many times over.)
      kinds.push(k === 1 ? w : / (of|on) /.test(w) ? `${NUM[k] ?? k} times ${w}` : `${NUM[k] ?? k} ${w.replace(/^an? /, "")}s`);
      i = j;
    }
    const named = kinds.length < 2 ? kinds.join("") : `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}`;
    return [`This does ${count}: ${named}.`, ...acts.map((a, i) => [`${i + 1}. ${a.head}`, ...a.lines.map((l) => `   - ${l}`)].join("\n"))].join("\n");
  }
}

/** What each kind of act is called in the preview's first line (a paper is called by its own kind). */
const WHAT: { [block: string]: string } = { sign_agreement: "a signature", give_notice: "a notice on an agreement", transfer: "a payment", open_account: "an account opened", close_account: "an account closed", construct: "a building begun",
  demolish: "a demolition", work: "a piece of work", move_goods: "goods moved", take: "a taking", occupy: "a moving in", vacate: "a moving out", create_entity: "an organisation set up", arrive: "an arrival", leave: "a leaving", birth: "a child",
  harm: "a harm", create_position: "a post created", appoint: "an appointment", deploy: "a system put to work", retire: "a system switched off", record_claim: "a claim recorded", transfer_claim: "a claim passed on", release_claim: "a claim released",
  withdraw: "a withdrawal", vote: "a vote", message: "a letter", publish: "a paper", propose_agreement: "an offer of an agreement" };

/** An act as the preview sets it out: what happens, the lines under it, and which of the act's fields they say. */
interface Act { head: string; lines: string[]; said: string[]; /** What kind of thing it is, in a word or three ("a payment", "a letter"). */ what: string }
