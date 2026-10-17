// The resolver (docs/design/translator-and-resolver.md §8): a call → the
// participant's own acts. Deterministic, platform-side, and bound by four rules:
//   - it never chooses how: the route is what the participant supplied; a missing
//     decision is a question back to the participant (P6);
//   - it fills in only single physical answers (the one account the participant
//     holds; who keeps an account);
//   - it never acts for anyone else: whoever must physically act is asked
//     (a request) or offered an agreement, and decides (P7);
//   - it uses only what the participant knows (P8). Ids the participant states outright
//     are passed through: if one doesn't exist, physics says so.

import { calls, formatMoney, forms, type Block } from "@oikos/participants";
import { Knowledge } from "./knowledge";

type Call = calls.Call;
type Value = calls.Value;

export const RESOLVER = { id: "resolver", version: "0.7.0" }; // 0.7.0: a form may record a claim beside its paper (FormWrites `claim`)

/** What the resolver reads from a structure type in the world's catalogue (which is public): its footprint, the terrains it can stand on, and its spaces. */
export interface StructureTypeInfo {
  footprint?: { w: number; h: number };
  terrains?: string[];
  spaces?: { kind: string; count: number; capacity: number }[];
}

/** A resolution: the participant's acts, or questions for the participant (and, when the call itself broke the contract, what was wrong, for the log). */
export type Resolution = { ok: true; blocks: Block[] } | { ok: false; questions: string[]; invalid?: string[] };

/** Fixed texts for the translator's refusal labels (§11.1). */
export const LABEL_TEXT: Record<calls.Label, string> = {
  not_yours: "That's for someone else to decide. You could write to them, or propose something.",
  needs_calculation: "Please state the amount itself.",
  too_much: "Please take this one step at a time.",
  unclear: "It isn't clear what should happen. Could you say it more plainly?",
  unknown_form: "You haven't seen a form by that name.",
  not_an_act: "That's something to look up or read, not something to do. Look at your reports and papers, or write to whoever keeps it.",
  no_such_act: "Nothing here does that as such. If it is for someone else to see to, direct them in writing, on their form for it if they have one.",
  // (Said of the request alone: nothing is looked up to say it, so it tells the caller nothing it didn't know.)
  look_first: "That needs something found out first. Look it up (in your own papers, or by asking whoever keeps it), then say what is to be done, naming each paper by its id.",
};

class Ask extends Error {}
/** An id as the contract writes one (common.schema.json: a chosen id, a minted one, a cell, a space), or a name bound
 * in the same act. Anything else written where an id goes can never be recorded: it is asked about, with what it is. */
const WRITTEN_ID = /^([a-z][a-z0-9_-]{0,63}|(ent|acc|str|rec|act|msg|par|pos|cnd)\.[0-9]{1,15}|cell\.[0-9]{1,6}\.[0-9]{1,6}|([a-z][a-z0-9_-]{0,63}|str\.[0-9]{1,15})\/[a-z][a-z0-9_-]{0,63}\.[0-9]{1,6})$/;
const BOUND_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const ID_SHAPE = { test: (x: string): boolean => (x.startsWith("$") ? BOUND_NAME.test(x.slice(1)) : WRITTEN_ID.test(x)) };
/** What is said of something written where an id goes that is no id (a draft's name; a made-up id). */
export const notAnId = (x: string, what: string): string => (x.startsWith("draft.") ? `${x} is the name a draft went by before it was confirmed, not a paper on record. Once confirmed it is on record under an id of its own (rec. and a number): look it up in your papers and name that.` : `"${x}" (for ${what}) is not the id of anything on record: an id is written exactly as your papers show it, like rec.412. Look it up and name it so.`);
/** Said of work in an agreement that names someone other than the side committing to it (the call's fault). */
export const WORK_IS_ITS_OWN = "In an agreement each side commits itself: the work a side commits to is its own to do, and nobody else is named for it.";
/** Said of an agreement with nothing on either side. */
export const NO_COMMITMENTS = "An agreement says what each side is to do or pay, and this one says nothing either side commits to. Say what you will do or pay, and what they will: money, goods, a building, occupancy, an account or work.";
/** Asked of work with neither how much nor how often: which of the two it is, in the words of whoever asked (a seat
 * that wanted a standing order to maintain was asked "How much of it?" four times, 2026-10-09). */
export const ONCE_OR_ROUTINE = "Is this work to be done once, or as a standing routine of your staff? Done once: say how much of it. As a routine: say how often (every day, every week), and it is a standing work order.";

/** Asked of a payment made once that is given a start. */
export const ONCE_IS_NOW = "A payment asked for once is made when it is asked: it can't be given a day to start. For a payment made again and again, say how often; for one payment on a later day, ask for it on that day.";

/** Said of a call that gives `per_request` on a payment its maker does not itself move (the call's fault: it is tried
 * again, and the seat never reads this). */
export const PER_REQUEST_IS_THE_KEEPERS = "per_request is written only by whoever keeps the account the money is paid from, and names the request to pay that they are carrying out: leave it out.";

/** Words as a label (a statement's kind, an organisation's, a post's role, an agreement's template): lower case,
 * letters and digits kept, anything else one underscore between them, starting with a letter, at most 64 characters.
 * A label already written as one comes back unchanged. What a model writes as "supplementary evidence statement" is
 * the label supplementary_evidence_statement, and never reaches the log as something the contract refuses. */
export function asLabel(s: string): string {
  let out = "";
  let gap = false;
  for (const ch of s.trim().toLowerCase()) {
    if ((ch >= "a" && ch <= "z") || (out && ((ch >= "0" && ch <= "9") || ch === "_"))) {
      if (gap && !out.endsWith("_") && ch !== "_") out += "_";
      gap = false;
      out += ch;
    } else if (out) gap = true;
  }
  return out.slice(0, 64);
}


/** A length of time in words: whole days where it is whole days ("14 days", "1 day"), else hours and minutes; seconds only where nothing rounder fits. */
export const durationWords = forms.durationWords;

/** Resolve a program. `typeOf` gives a structure type from the world's catalogue, for building on a lot. */
export function resolve(program: calls.Program, k: Knowledge, typeOf: (type: string) => StructureTypeInfo | undefined = () => undefined, as?: string, o: { /** The program was written by a translator from a request in words: a practice's and an offer's amounts and lengths of time are as the request wrote them (a code participant's are the smallest unit and whole seconds already). */ written?: boolean } = {}): Resolution {
  if ("none" in program) return { ok: false, questions: [LABEL_TEXT[program.none]] };
  if (calls.programText(program).length > 65536) return { ok: false, questions: [LABEL_TEXT.too_much] };
  const invalid = calls.contractErrors(program);
  if (invalid.length) return { ok: false, questions: [LABEL_TEXT.unclear], invalid };
  const r = new Resolver(k, program, k.actingFor(as));
  r.typeOf = typeOf;
  r.asPost = as;
  r.asWritten = !!o.written;
  const blocks: Block[] = [];
  const questions: string[] = [];
  for (const line of program.lines) {
    try {
      blocks.push(...r.line(line.call, line.bind));
    } catch (e) {
      if (e instanceof Ask) questions.push(e.message);
      else if (e instanceof calls.UnitError) questions.push(`${e.message}. Please say it another way.`);
      else throw e;
    }
  }
  if (questions.length) return { ok: false, questions };
  if (blocks.length > 32) return { ok: false, questions: [LABEL_TEXT.too_much] };
  return { ok: true, blocks };
}

class Resolver {
  /** See `resolve`. */
  asWritten = false;
  /** The post it acts in, if any (none: it acts as itself). */
  asPost: string | undefined;
  private refs = new Set<string>();
  /** The names the program's own lines bind (`refs` also holds the ones made up here). */
  private bound = new Set<string>();
  private n = 0;
  constructor(private k: Knowledge, program: { lines: calls.Line[] }, private readonly me: string) {
    for (const l of program.lines) if (l.bind) this.refs.add(l.bind), this.bound.add(l.bind);
  }

  /** An amount as the world writes its money. */
  private sum(amount: string | number): string {
    return formatMoney(amount, this.k.currency);
  }

  private fresh(stem: string): string {
    let r: string;
    do r = `${stem}${++this.n}`;
    while (this.refs.has(r));
    this.refs.add(r);
    return r;
  }

  // --- reading argument values

  private raw(c: Call, key: string): Value | undefined {
    return c.args[key];
  }
  private has(c: Call, key: string) {
    return c.args[key] !== undefined;
  }
  /** An id (or a variable, as "$name", or a name the participant wrote that it knows). */
  private id(c: Call, key: string, what = key): string | undefined {
    const v = this.raw(c, key);
    if (v === undefined) return undefined;
    // No id has a capital letter (ids are lowercase): a bare word with one is a name, as if it were quoted.
    const named = "text" in v ? v.text : "id" in v && /[A-Z]/.test(v.id) ? v.id : undefined;
    if ("id" in v && named === undefined) {
      if (!ID_SHAPE.test(v.id)) throw new Ask(notAnId(v.id, what));
      return v.id;
    }
    if ("var" in v) return `$${v.var}`;
    if (named !== undefined) {
      const found = this.k.byName(named);
      if (found.length === 1) return found[0];
      if (found.length > 1) throw new Ask(`More than one ${what} is called "${named}": ${found.join(", ")}. Which one?`);
      throw new Ask(`You don't know of anyone or anything called "${named}" (for ${what}).`);
    }
    throw new Ask(`${what} should name something, not ${"json" in v ? "data" : "a call"}.`);
  }
  /** What the act cites: one record as any id is written, or a list of records, passed on in the order given. In a
   * list, a name bound on a line of the program is that line's record, and anything not written as an id is a name
   * the participant knows. One cited twice is kept where it first stands, and a list of one is that record alone
   * (one basis has one form: contracts, Basis). */
  private basis(c: Call): { basis?: string | string[] } {
    const v = this.raw(c, "basis");
    if (v === undefined || !("json" in v)) {
      const one = this.id(c, "basis");
      return one === undefined ? {} : { basis: one };
    }
    if (!Array.isArray(v.json) || !v.json.every((x) => typeof x === "string")) throw new Ask("basis should be a record, or a list of records.");
    const out: string[] = [];
    for (const x of v.json as string[]) {
      const ref = this.bound.has(x) ? x : undefined;
      let id: string;
      if (ref !== undefined) id = `$${ref}`;
      else if (/^[a-z0-9_.:\/-]+$/.test(x)) {
        if (!ID_SHAPE.test(x)) throw new Ask(notAnId(x, "basis"));
        id = x;
      }
      else {
        const found = this.k.byName(x);
        if (found.length === 0) throw new Ask(`You don't know of anyone or anything called "${x}" (for basis).`);
        if (found.length > 1) throw new Ask(`More than one basis is called "${x}": ${found.join(", ")}. Which one?`);
        id = found[0]!;
      }
      if (!out.includes(id)) out.push(id);
    }
    if (out.length === 0) throw new Ask("basis should name at least one record.");
    if (out.length > 64) throw new Ask("That cites more records than one act can: 64 at most.");
    return { basis: out.length === 1 ? out[0]! : out };
  }
  /** A record named by its id, where nothing but a record can stand (the request a keeper's payment carries out):
   * bare, as every id is written, or a name bound on an earlier line. Words in quotes are not an id, whoever or
   * whatever they might name, and data is not one (wave 2b: per_request="report", "the bank" and a table of pays
   * each went through unread). The call is at fault, so the seat never reads this. */
  private record(c: Call, key: string): string | undefined {
    const v = this.raw(c, key);
    if (v === undefined) return undefined;
    if ("var" in v) return `$${v.var}`;
    if ("id" in v && !/[A-Z]/.test(v.id)) return v.id;
    throw new Ask(`${key} should name a record by its id.`);
  }
  private need(c: Call, key: string, question: string): string {
    const x = this.id(c, key);
    if (x === undefined) throw new Ask(question);
    return x;
  }
  /** A label argument, as a label (asLabel); absent or empty: undefined. */
  private label(c: Call, key: string): string | undefined {
    const s = this.str(c, key);
    return s === undefined ? undefined : asLabel(s) || undefined;
  }
  private str(c: Call, key: string): string | undefined {
    const v = this.raw(c, key);
    if (v === undefined) return undefined;
    if ("text" in v) return v.text;
    if ("id" in v) return v.id;
    throw new Ask(`${key} should be written out.`);
  }
  private amount(c: Call, key: string): string | undefined {
    const s = this.str(c, key);
    return s === undefined ? undefined : calls.parseAmount(s, this.k.currency);
  }
  private seconds(c: Call, key: string): number | undefined {
    const s = this.str(c, key);
    return s === undefined ? undefined : calls.parseDuration(s);
  }
  private json(c: Call, key: string): unknown {
    const v = this.raw(c, key);
    if (v === undefined) return undefined;
    if ("json" in v) return v.json;
    if ("text" in v) return { text: v.text };
    throw new Ask(`${key} should be data or text.`);
  }
  private ids(c: Call, key: string): string[] | undefined {
    const v = this.raw(c, key);
    if (v === undefined) return undefined;
    if ("json" in v) {
      if (!Array.isArray(v.json) || !v.json.every((x) => typeof x === "string")) throw new Ask(`${key} should be a list of names or ids.`);
      return v.json as string[];
    }
    return [this.id(c, key)!];
  }
  private visible(c: Call): "public" | string[] | undefined {
    const v = this.raw(c, "visible");
    if (v === undefined) return undefined;
    if ("id" in v && v.id === "public") return "public";
    // Its own file: seen only by the entity the act is made for.
    if ("id" in v && v.id === "own") return [this.speaksFor(c).speaks_for];
    return this.ids(c, "visible");
  }
  private yes(c: Call, key: string): boolean {
    const s = this.str(c, key);
    return s !== undefined && /^(yes|true)$/i.test(s);
  }
  /** Whose name a record is in: the participant's own entity, unless the call says otherwise. */
  private speaksFor(c: Call): { speaks_for: string } {
    return { speaks_for: this.id(c, "for") ?? this.me };
  }

  // --- single physical answers

  /** The account to pay from: the one given, or the only one the participant's entity holds. */
  private payer(c: Call, purpose: string): string {
    const given = this.id(c, "from");
    if (given) return given;
    const own = this.k.accountsOf(this.me);
    if (own.length === 1) return own[0]!;
    if (own.length === 0) throw new Ask(`Which account should ${purpose} come from? You don't know of one you hold.`);
    throw new Ask(`Which account should ${purpose} come from: ${own.join(" or ")}?`);
  }
  /**
   * Where money goes: an account, or the only account the participant knows an entity holds.
   * For a payment made now, an entity with no known account is a question; in a
   * commitment ("we'll pay the builder") the entity itself is enough.
   */
  private payee(to: string, commitment = false): string {
    if (to.startsWith("$") || this.k.isAccount(to)) return to;
    const e = this.k.entityOf(to);
    const known = this.k.names.has(e) || e !== to || this.k.stated.has(e);
    const accts = this.k.accountsOf(e);
    if (accts.length === 1) return accts[0]!;
    if (accts.length > 1) throw new Ask(`Which of ${this.k.name(e)}'s accounts: ${accts.join(" or ")}?`);
    if (known && !commitment) throw new Ask(`Which of ${this.k.name(e)}'s accounts should it go to? You don't know one.`);
    return commitment && known ? e : to; // an id stated outright is taken as an account; physics decides
  }
  private keeper(account: string): string | undefined {
    return this.k.accounts.get(account)?.custodian;
  }

  // --- functions

  line(c: Call, bind?: string): Block[] {
    switch (c.fn) {
      case "money": return this.money(c, bind);
      case "goods": return this.goods(c);
      case "take": return this.take(c);
      case "work": return this.work(c, bind);
      case "account": return this.account(c, bind);
      case "structure": return this.structure(c, bind);
      case "occupancy": return this.occupancy(c);
      case "entity": return this.entity(c, bind);
      case "claim": return this.claim(c, bind);
      case "agreement": return this.agreement(c, bind);
      case "statement": return this.statement(c, bind);
      case "vote": return [{ block: "vote", ballot: this.need(c, "ballot", "Which ballot?"), choice: this.str(c, "choice")!, ...this.speaksFor(c), ...(this.visible(c) ? { visible_to: this.visible(c) } : {}) }];
      case "message": return [{ block: "message", to: this.ids(c, "to")!, text: this.str(c, "text")!, ...(this.id(c, "re") ? { re: this.id(c, "re") } : {}) }];
      case "form": return this.form(c, bind);
      case "presence": return this.presence(c, bind);
      case "birth": return [{ block: "birth", name: this.str(c, "name")!, template: this.str(c, "template")!, ...(this.has(c, "with") ? { with: this.k.entityOf(this.id(c, "with")!) } : {}) }];
      case "harm": return [{ block: "harm", person: this.k.entityOf(this.need(c, "who", "Whom?")) }];
      case "position": return this.position(c, bind);
      case "system": return this.system(c, bind);
    }
  }

  /** A quantity of goods, as written ("40", "40 items"): a count, exact. */
  private quantity(c: Call, key: string): string | undefined {
    const s = this.str(c, key);
    return s === undefined ? undefined : String(calls.parseCount(s, this.k.currency));
  }
  /** When (a date, or a length of time from when the paper is lodged), as written. A date already past is a question. */
  private when(c: Call, key: string): calls.When | undefined {
    const s = this.str(c, key);
    if (s === undefined) return undefined;
    const w = calls.parseWhen(s, this.k.t);
    if ("at" in w && w.at + 86_400 <= this.k.t) throw new Ask(`${forms.dateWords(w.at)} is already past: today is ${forms.dateWords(this.k.t)}. Give today's date or a later one, or a length of time from now.`);
    return w;
  }

  /** Moving your own goods (phase B): from where you hold them (said, or the one place you hold that kind), to
   * someone (yourself by default) at a place. Only the holder can move goods: someone else's are asked for (a request
   * or an agreement: a goods outcome). */
  private goods(c: Call): Block[] {
    const kind = this.need(c, "kind", "Of what?");
    const quantity = this.quantity(c, "quantity");
    if (!quantity || quantity === "0") throw new Ask("How much?");
    const to = this.k.entityOf(this.id(c, "to") ?? this.me);
    const toAt = this.id(c, "at");
    if (!toAt) throw new Ask(to === this.me ? `Where to? Somewhere you keep things.` : `Where should ${this.k.name(to)} get them: at which place?`);
    let fromAt = this.id(c, "from_at");
    if (!fromAt) {
      const places = this.k.placesHolding(kind);
      if (places.length === 0) throw new Ask(`You don't hold any ${kind} that you know of.`);
      if (places.length > 1) throw new Ask(`From where: ${places.join(" or ")}?`);
      fromAt = places[0]!;
    }
    return [{ block: "move_goods", kind, quantity, from_at: fromAt, to, to_at: toAt }];
  }

  /** Work (phase B): units of a task at a place, by the people named (`by`: one, or a list). Nobody named: work that
   * takes no one's time (using things up). */
  private work(c: Call, bind?: string): Block[] {
    const task = this.need(c, "task", "What work?");
    if (this.has(c, "every")) return this.standingWork(c, task, bind);
    if (this.has(c, "first") || this.has(c, "until")) throw new Ask("Work asked for once is done now. When it starts and how long it goes on are said of work done again and again: say how often.");
    // A survey (nature): of a species or a field, in these cells, a unit each.
    const survey = this.id(c, "survey");
    const cells = survey ? this.ids(c, "cells") : undefined;
    if (survey && !cells?.length) throw new Ask("Survey which cells?");
    const units = this.quantity(c, "units") ?? (cells ? String(cells.length) : undefined);
    // Neither how much nor how often, of a routine whose rhythm the office's own procedure states: a standing order
    // that follows it (a rates office asked for its levy "at each instalment the rating law sets" and was asked
    // "once or as a routine?": wave 2b). The preview says which rhythm, and from which paper.
    if ((!units || units === "0") && !survey && !this.has(c, "investigate") && (this.k.routine(task)?.every || this.k.routine(task)?.schedule)) return this.standingWork(c, task, bind);
    if (!units || units === "0") throw new Ask(ONCE_OR_ROUTINE);
    const at = this.need(c, "at", "Where?");
    const by = this.has(c, "by") ? (this.ids(c, "by") ?? [this.id(c, "by")!]).map((p) => this.k.entityOf(p)) : [];
    const on = this.id(c, "on");
    // An investigation (crime): of goods of a kind taken from someone, at a structure.
    const from = this.id(c, "investigate");
    let investigate: object | undefined;
    if (from) {
      const takenAt = this.id(c, "taken_at");
      if (!takenAt) throw new Ask("Taken from where?");
      investigate = { from: this.k.entityOf(from), at: takenAt, kind: this.need(c, "kind", "Taken: what?") };
    }
    return [{ block: "work", task, units: Number(units), at, performers: by, ...(on ? { on } : {}), ...(survey && cells ? { survey: { of: survey, cells } } : {}), ...(investigate ? { investigate } : {}) }];
  }

  /**
   * A standing work order (contracts/calls.md): work to be done again and again, by the organisation's own staff, put
   * on the organisation's own file. What task, where, on what and by whom (if said), how often, from when and for how
   * long. Nothing is done here and the kernel does nothing with it: the staff whose work it is follow it, each time
   * it falls due, in their own hours, while it stands. It is changed by withdrawing it and making another, and put
   * on hold like any standing paper.
   */
  private standingWork(c: Call, task: string, bind?: string): Block[] {
    if (this.has(c, "survey") || this.has(c, "investigate")) throw new Ask("A survey or an investigation is asked for each time, with what it is of: it can't be a standing order.");
    const at = this.need(c, "at", "Where?");
    // How often: a length of time; or, of a routine whose time a published paper sets, that paper named ("as
    // law-rates sets"); or nothing, and the order follows the rhythm the office's own procedure states for the task.
    const routine = this.k.routine(task);
    const said = this.str(c, "every");
    let every: number | undefined;
    let schedule: string | undefined;
    if (said === undefined) {
      if (routine?.schedule) schedule = routine.schedule;
      else if (routine?.every) every = routine.every;
      else throw new Ask("How often?");
    } else {
      try {
        every = calls.parseDuration(said);
      } catch (e) {
        if (!(e instanceof calls.UnitError)) throw e;
        const named = routine?.schedule !== undefined && said.toLowerCase().split(/[^a-z0-9_.-]+/).map((w) => w.replace(/\.+$/, "")).includes(routine.schedule);
        if (named) schedule = routine!.schedule;
        else if (routine?.schedule) throw new Ask(`"${said}" could not be read as how often. By your office's procedure (${routine.procedure}) the staff do ${task} when ${routine.schedule} sets: say "as ${routine.schedule} sets", or leave how often out and the order follows it.`);
        else if (routine?.every) throw new Ask(`"${said}" could not be read as how often. Say it as a length of time ("every 7 days", "each working day"), or leave it out: by your office's procedure (${routine.procedure}) the staff do ${task} every ${durationWords(routine.every)}, and an order that does not say how often follows that.`);
        else throw new calls.UnitError(`not how often: ${said}`);
      }
    }
    if (every !== undefined && every <= 0) throw new Ask("How often?");
    const rhythm = schedule !== undefined ? `as ${schedule} sets` : `every ${durationWords(every!)}`;
    const first = this.when(c, "first");
    const until = this.when(c, "until");
    // (An end given as a date is the end of that day; as a length of time, so long from now.)
    const ends = until === undefined ? undefined : "at" in until ? until.at + 86_400 : this.k.t + until.in;
    const by = this.has(c, "by") ? [...new Set(this.ids(c, "by")!.map((p) => this.k.entityOf(p)))] : undefined;
    const on = this.has(c, "on") ? [...new Set(this.ids(c, "on")!)] : undefined;
    const units = this.quantity(c, "units");
    const me = this.id(c, "for") ?? this.me;
    const text = `Standing work order: ${task} at ${at}${on ? `, on ${on.join(", ")}` : ""}${by ? `, by ${by.join(", ")}` : ""}${units ? `, ${units} each time` : ""}, ${rhythm}${first === undefined ? "" : "at" in first ? `, the first on ${forms.dateWords(first.at)}` : `, the first in ${durationWords(first.in)}`}${until === undefined ? "" : "at" in until ? `, until the end of ${forms.dateWords(until.at)}` : `, for ${durationWords(until.in)}`}.`;
    return [{ block: "publish", kind: "work_order", text, speaks_for: me, addressed_to: [me], visible_to: [...new Set([me, ...(by ?? [])])],
      data: { work: { task, at, ...(on ? { on } : {}), ...(by ? { by } : {}), ...(units ? { units: Number(units) } : {}) }, ...(schedule !== undefined ? { schedule } : { every }), ...(said === undefined ? { by_procedure: routine!.procedure } : {}), ...(first === undefined ? {} : "at" in first ? { first_at: first.at } : { first: first.in }), ...(ends !== undefined ? { until: ends } : {}) },
      ...(bind ? { ref: bind } : {}) }];
  }

  /** Taking goods another holds, where we are (crime: world-expansion 7.3). */
  private take(c: Call): Block[] {
    const kind = this.need(c, "kind", "Take what?");
    const quantity = this.quantity(c, "quantity");
    if (!quantity || quantity === "0") throw new Ask("How much?");
    return [{ block: "take", kind, quantity, from: this.k.entityOf(this.need(c, "from", "Whose?")), at: this.need(c, "at", "Where?") }];
  }

  /** The money outcome of a call, for requests and commitments. */
  private moneyOutcome(c: Call, from: string | undefined, commitment = false): { money: object } {
    const amount = this.amount(c, "amount");
    if (amount === undefined) throw new Ask("How much?");
    const to = this.payee(this.need(c, "to", "Paid to whom?"), commitment);
    const purpose = this.str(c, "for");
    const settles = this.id(c, "settles");
    const line = this.id(c, "line");
    return { money: { ...(from ? { from } : {}), to, amount, ...(purpose ? { for: purpose } : {}), ...(settles ? { settles } : {}), ...(line ? { line } : {}) } };
  }

  private money(c: Call, bind?: string): Block[] {
    const from = this.payer(c, "the payment");
    const out = this.moneyOutcome(c, from).money as { to: string; amount: string; for?: string; settles?: string; line?: string };
    const every = this.seconds(c, "every");
    const first = this.when(c, "first");
    // (When it starts is said of a payment made again and again: one asked for once is made when it is asked.)
    if (first !== undefined && !every) throw new Ask(ONCE_IS_NOW);
    const keeper = this.keeper(from);
    if (keeper === undefined) throw new Ask(`You don't know who keeps account ${from}, so you can't ask them to pay from it.`);
    // The request a payment carries out is a record, and only whoever keeps the account carries one out: said of a
    // payment that is itself a request to the keeper it means nothing, and is refused, never passed over.
    const per = this.record(c, "per_request");
    if (per !== undefined && keeper !== this.me) throw new Ask(PER_REQUEST_IS_THE_KEEPERS);
    if (keeper === this.me) {
      // The participant's own entity keeps the money (a bank, or someone keeping their own): it moves it itself.
      if (every) throw new Ask("You keep this money yourself, so a repeating payment means paying each time. Say when to pay this one.");
      return [{ block: "transfer", from, to: out.to, amount: out.amount, ...(out.settles ? { settles: out.settles } : {}), ...(per ? { per_instruction: per } : {}), ...(out.for ? { memo: out.for.slice(0, 500) } : {}), ...(out.line ? { line: out.line } : {}) }];
    }
    // Someone else keeps it: the only physical option is to ask them. They decide.
    return [{
      block: "publish", kind: "request", speaks_for: this.me, addressed_to: [keeper], visible_to: [this.me, keeper],
      text: `Please pay ${this.sum(out.amount)} from ${from} to ${out.to}${every ? ` every ${Math.round(every / 86_400)} days` : ""}${first !== undefined && "at" in first ? `, the first on ${forms.dateWords(first.at)}` : ""}${out.for ? `, for ${out.for}` : ""}.`,
      data: { outcome: { money: { from, ...out } }, ...(every ? { every } : {}), ...(first === undefined ? {} : "at" in first ? { first_at: first.at } : { first: first.in }) },
      ...this.basis(c), ...(bind ? { ref: bind } : {}),
    }];
  }

  private account(c: Call, bind?: string): Block[] {
    const at = this.id(c, "at");
    const close = this.id(c, "close");
    // Who keeps it is a choice (you, or a bank), unless an existing account's keeper is known.
    const keeper = at ? this.k.entityOf(at) : close ? this.keeper(close) : undefined;
    if (!keeper) throw new Ask(close ? `You don't know who keeps account ${close}.` : "Who should keep the account: you, or someone else (who)?");
    if (keeper === this.me) {
      if (close) return [{ block: "close_account", account: close }];
      return [{ block: "open_account", holder: this.need(c, "holder", "An account for whom?"), ...(bind ? { ref: bind } : {}) }];
    }
    const holder = this.id(c, "holder") ?? this.me;
    return [{
      block: "publish", kind: "request", speaks_for: this.me, addressed_to: [keeper], visible_to: [this.me, keeper],
      text: close ? `Please close account ${close}.` : `Please open an account for ${holder}.`,
      data: { outcome: { account: { holder, ...(close ? { close } : {}) } } }, ...(bind ? { ref: bind } : {}),
    }];
  }

  private structure(c: Call, bind?: string): Block[] {
    const remove = this.id(c, "remove");
    const by = this.id(c, "by");
    const place = remove ? `demolish ${remove}` : `build a ${this.str(c, "type") ?? "?"} on ${this.str(c, "on") ?? "?"}`;
    if (!by) throw new Ask(`Who should ${place}?`);
    const type = remove ? undefined : this.need(c, "type", "What should be built?");
    const on = remove ? undefined : this.need(c, "on", "On which lot or cell?");
    const basis = this.basis(c);
    if (this.k.entityOf(by) === this.me) {
      // Building it yourself (phase B): the materials come from your own holding where you keep them (`materials_at`),
      // and the building work is work (`work`); demolition begins, and its work follows.
      const yard = this.id(c, "materials_at");
      return remove
        ? [{ block: "demolish", structure: remove }]
        : [{ block: "construct", at: this.corner(on!, type!), structure_type: type, ...(yard ? { materials_at: yard } : {}), ...(bind ? { ref: bind } : {}) }];
    }
    // Someone else builds: offer them an agreement, signed on its side. They decide.
    const builder = this.k.entityOf(by);
    const price = this.amount(c, "price");
    if (price === undefined) throw new Ask(`For what price should ${this.k.name(builder)} ${place}?`);
    const from = this.payer(c, "the payment");
    const ref = bind ?? this.fresh("offer");
    return [
      {
        block: "propose_agreement", speaks_for: this.me, ref, ...basis,
        terms: {
          template: "construction", parties: [this.me, builder],
          commitments: [
            { who: builder, does: { outcome: { structure: remove ? { remove } : { type, on } } } },
            { who: this.me, does: { outcome: { money: { from, to: builder, amount: price } } } },
          ],
          text: `${this.k.name(builder)} will ${place}; ${this.k.name(this.me)} pays ${this.sum(price)} from ${from}.`,
        },
      },
      { block: "sign_agreement", agreement: `$${ref}`, as: this.me },
    ];
  }

  typeOf: (type: string) => StructureTypeInfo | undefined = () => undefined;

  /**
   * Where a building goes: a cell stated outright is its corner; on a lot, the one corner from which the type's
   * footprint fits on the lot's unbuilt cells of a terrain it can stand on. Several corners are a choice, for the
   * participant; none is a question too (physics would refuse, but the participant can say what it meant).
   */
  private corner(on: string, type: string): string {
    if (on.startsWith("$") || !this.k.lots.has(on)) return on; // a cell, or an id stated outright: physics decides
    const t = this.typeOf(type);
    if (!t) throw new Ask(`You don't know what a ${type} is.`);
    const { w, h } = t.footprint ?? { w: 1, h: 1 };
    const lot = new Set(this.k.lots.get(on)!);
    const at = (x: number, y: number) => [...lot].find((id) => this.k.cells.get(id)?.x === x && this.k.cells.get(id)?.y === y);
    const fits = (id: string) => {
      const c0 = this.k.cells.get(id);
      if (!c0) return false;
      for (let dx = 0; dx < w; dx++)
        for (let dy = 0; dy < h; dy++) {
          const cell = at(c0.x + dx, c0.y + dy);
          const info = cell ? this.k.cells.get(cell) : undefined;
          if (!info || info.built) return false;
          // As physics has it: a type that lists terrains stands only on those; one that lists none, only on unlabelled ground.
          if (t.terrains ? !(info.terrain && t.terrains.includes(info.terrain)) : info.terrain !== undefined) return false;
        }
      return true;
    };
    const corners = [...lot].filter(fits).sort();
    if (corners.length === 1) return corners[0]!;
    if (corners.length === 0) throw new Ask(`A ${type} (${w} by ${h}) doesn't fit on the open ground of ${on} as far as you've seen. Which cell should its corner be?`);
    throw new Ask(`Which cell of ${on} should the ${type}'s corner be on: ${corners.slice(0, 12).join(", ")}${corners.length > 12 ? ", …" : ""}?`);
  }

  /** The space meant by `in`: a space stated outright, or the only space in a building the participant has seen. */
  private space(inside: string): string {
    if (inside.startsWith("$") || inside.includes("/")) return inside;
    const s = this.k.structures.get(inside);
    if (s && s.spaces.length === 1) return s.spaces[0]!.space;
    if (!s) throw new Ask(`Which space in ${inside}? You haven't seen inside it.`);
    const list = s.spaces.map((x) => x.space);
    throw new Ask(`Which space in ${inside}: ${list.slice(0, 12).join(", ")}${list.length > 12 ? ", …" : ""}?`);
  }

  /** Whose body: the participant's own person unless the call names someone. */
  private body(c: Call): string {
    const who = this.id(c, "who");
    return who === undefined || who.startsWith("$") ? (who ?? this.k.entity) : this.k.entityOf(who);
  }

  private occupancy(c: Call): Block[] {
    const inside = this.need(c, "in", "Where?");
    const who = this.body(c);
    if (this.yes(c, "leave")) {
      // A seat acting as the person takes only itself out of a place; an organisation's post puts others out (the police on a warrant).
      if (this.asWritten && who !== this.me && who !== this.k.entity && this.asPost === undefined) throw new Ask("You can take only yourself out of a place.");
      return [{ block: "vacate", occupant: who, from: inside }];
    }
    return [{ block: "occupy", space: this.space(inside), ...(who !== this.k.entity ? { who } : {}) }];
  }

  private occupancyOutcome(c: Call): { occupancy: object } {
    const inside = this.need(c, "in", "Where?");
    return { occupancy: { who: this.body(c), in: inside, ...(this.yes(c, "leave") ? { leave: true } : {}) } };
  }

  private entity(c: Call, bind?: string): Block[] {
    const position = this.str(c, "position");
    const channels = this.json(c, "channels");
    const module = this.json(c, "role_module");
    const first = position ? { title: position, ...(channels !== undefined ? { channels } : {}), ...(module !== undefined ? { role_module: module } : {}) } : undefined;
    return [{ block: "create_entity", kind: this.label(c, "kind")!, name: this.str(c, "name")!, ...(first ? { first_position: first } : {}), ...(this.visible(c) ? { visible_to: this.visible(c) } : {}), ...(bind ? { ref: bind } : {}) }];
  }

  /** Coming into the world (a newcomer, or someone returning: done at the boundary) or leaving it. */
  private presence(c: Call, bind?: string): Block[] {
    const who = this.id(c, "who");
    const person = who === undefined || who.startsWith("$") ? who : this.k.entityOf(who);
    if (this.yes(c, "leave")) {
      // A seat (a program written from words) acting as the person takes only itself out of the world; an organisation's post takes others (a child into care), and a parent's code takes its household's children.
      if (this.asWritten && person && person !== this.me && this.asPost === undefined) throw new Ask("You can take only yourself out of the world.");
      return [{ block: "leave", ...(person && person !== this.k.entity ? { person } : {}) }];
    }
    if (person) return [{ block: "arrive", person }];
    const name = this.str(c, "name");
    const template = this.str(c, "template");
    if (!name || !template) throw new Ask("Who is coming: someone returning (who), or a newcomer (their name, age and template)?");
    const age = this.seconds(c, "age");
    if (age === undefined) throw new Ask(`How old is ${name}?`);
    const carrying = this.amount(c, "carrying");
    // (A newcomer's body variables: a JSON object, as given.)
    const variables = this.json(c, "variables");
    const sex = this.str(c, "sex");
    if (sex !== undefined && sex !== "female" && sex !== "male") throw new Ask("sex should be female or male.");
    return [{ block: "arrive", name, template, born_at: this.k.t - age, ...(sex ? { sex } : {}), ...(carrying ? { carrying } : {}), ...(variables !== undefined ? { variables } : {}), ...(bind ? { ref: bind } : {}) }];
  }

  /** An organisation's positions: create one, appoint someone to one, or leave one empty. */
  private position(c: Call, bind?: string): Block[] {
    const vacate = this.id(c, "vacate");
    if (vacate) return [{ block: "appoint", position: vacate }];
    const appoint = this.id(c, "appoint");
    if (appoint) {
      const to = this.need(c, "to", `Whom should ${appoint} go to?`);
      // A person named for the post means the participant that is that person.
      const participant = [...this.k.participantPerson].find(([, e]) => e === to)?.[0] ?? to;
      return [{ block: "appoint", position: appoint, participant }];
    }
    const title = this.str(c, "title");
    if (!title) throw new Ask("What is the new position called?");
    const channels = this.json(c, "channels");
    const module = this.json(c, "role_module");
    return [{ block: "create_position", title, ...(this.label(c, "role") ? { role: this.label(c, "role") } : {}), ...(channels !== undefined ? { channels } : {}), ...(module !== undefined ? { role_module: module } : {}), ...(bind ? { ref: bind } : {}) }];
  }

  private system(c: Call, bind?: string): Block[] {
    const retire = this.id(c, "retire");
    if (retire) return [{ block: "retire", participant: retire }];
    const template = this.str(c, "template");
    if (!template) throw new Ask("Which kind of system (its template)?");
    // (The client, if the supplier delivers it to another organisation: `to`. Absent: the supplier itself.)
    const to = this.id(c, "to");
    return [{ block: "deploy", template, ...(to ? { to: this.k.entityOf(to) } : {}), ...(this.str(c, "title") ? { title: this.str(c, "title") } : {}), ...(bind ? { ref: bind } : {}) }];
  }

  private claim(c: Call, bind?: string): Block[] {
    const common = { ...this.speaksFor(c), ...this.basis(c), ...(this.visible(c) ? { visible_to: this.visible(c) } : {}), ...(bind ? { ref: bind } : {}) };
    const release = this.id(c, "release");
    if (release) return [{ block: "release_claim", claim: release, ...common }];
    const transfer = this.id(c, "transfer");
    if (transfer) return [{ block: "transfer_claim", claim: transfer, to: this.need(c, "to", "To whom?"), ...common }];
    const position = this.str(c, "position");
    if (!position || !["right", "liberty", "power", "immunity"].includes(position)) throw new Ask("What kind of claim: a right, a liberty (a permission), a power or an immunity?");
    const against = this.id(c, "against");
    return [{ block: "record_claim", position, holder: this.id(c, "holder") ?? this.me, ...(against ? { counterparty: against } : {}), about: this.json(c, "about") ?? {}, ...common }];
  }

  /** A nested call as a commitment's outcome. */
  private outcome(v: Value | undefined, who: string): { does: object; every?: number } | undefined {
    if (v === undefined) return undefined;
    if (!("call" in v)) return { does: { text: "text" in v ? v.text : JSON.stringify("json" in v ? v.json : v) } };
    const c = v.call;
    const every = c.fn === "money" || c.fn === "goods" || c.fn === "work" ? this.seconds(c, "every") : undefined;
    if (c.fn === "work" && this.has(c, "by") && this.ids(c, "by")!.some((p) => this.k.entityOf(p) !== this.k.entityOf(who))) throw new Ask(WORK_IS_ITS_OWN);
    const outcome =
      c.fn === "money" ? this.moneyOutcome(c, this.id(c, "from"), true)
      : c.fn === "goods" ? { goods: { kind: this.need(c, "kind", "Of what?"), quantity: this.quantity(c, "quantity") ?? "0", to: this.k.entityOf(this.need(c, "to", "Delivered to whom?")), at: this.need(c, "at", "Delivered where?"), ...(this.id(c, "from_at") ? { from: this.id(c, "from_at") } : {}) } }
      : c.fn === "occupancy" ? this.occupancyOutcome(c)
      : c.fn === "structure" ? { structure: this.id(c, "remove") ? { remove: this.id(c, "remove") } : { type: this.id(c, "type"), on: this.id(c, "on") } }
      : c.fn === "account" ? { account: { holder: this.id(c, "holder") ?? who, ...(this.id(c, "close") ? { close: this.id(c, "close") } : {}) } }
      // Work a side commits to (an employment agreement's "works as crew at the depot"): the kind of work, as a
      // label, where it is done, and how much each time if said. The contract's commitments have had it all along;
      // refused here, every offer of employment a translator wrote this way cost a second call (wave 2b: 8 of 8).
      : c.fn === "work" ? { work: { task: asLabel(this.str(c, "task") ?? "") || "work", ...(this.id(c, "at") ? { at: this.id(c, "at") } : {}), ...(this.quantity(c, "units") ? { units: this.quantity(c, "units") } : {}) } }
      : undefined;
    if (!outcome) throw new Ask(`A commitment can be money, goods, a building, occupancy, an account or work, not ${c.fn}.`);
    return { does: { outcome }, ...(every ? { every } : {}) };
  }

  private agreement(c: Call, bind?: string): Block[] {
    const sign = this.id(c, "sign");
    if (sign && this.k.withdrawn.has(sign)) throw new Ask(`${sign} has been withdrawn: if it was an offer, whoever made it has taken it back, and there is nothing to sign.`);
    if (sign) return [{ block: "sign_agreement", agreement: sign, as: this.id(c, "for") ?? this.me, ...(bind ? { ref: bind } : {}) }];
    const notice = this.id(c, "notice");
    if (notice) return [{ block: "give_notice", agreement: notice, as: this.id(c, "for") ?? this.me, ...(this.str(c, "text") ? { text: this.str(c, "text") } : {}) }];
    const me = this.id(c, "for") ?? this.me;
    const other = this.need(c, "with", "An agreement with whom?");
    const ours = this.outcome(this.raw(c, "we_do"), me);
    const theirs = this.outcome(this.raw(c, "they_do"), other);
    // The ordinary hours of a job in a week (an employment's hours term, added 2026-10-13): the other side's commitment to work them.
    const weekly = this.seconds(c, "hours");
    const hoursTerm = weekly ? [{ who: other, does: { outcome: { work: { task: "ordinary_hours", hours: weekly } } }, every: 7 * 86_400 }] : [];
    const commitments = [...(ours ? [{ who: me, ...ours }] : []), ...(theirs ? [{ who: other, ...theirs }] : []), ...hoursTerm];
    if (!commitments.length) throw new Ask(NO_COMMITMENTS);
    const term = this.seconds(c, "term");
    // After the term: it may continue, periodically, until ended by notice.
    const then = this.str(c, "then") || undefined;
    if (then !== undefined && then !== "periodic") throw new Ask(`After its term, an agreement can only continue periodically (then=periodic), not "${then}".`);
    const termination = [
      ...(this.has(c, "our_notice") ? [{ party: me, notice: this.seconds(c, "our_notice")! }] : []),
      ...(this.has(c, "their_notice") ? [{ party: other, notice: this.seconds(c, "their_notice")! }] : []),
    ];
    const text = this.str(c, "terms") ?? this.str(c, "text");
    const ref = bind ?? this.fresh("offer");
    return [
      {
        block: "propose_agreement", ref, speaks_for: me, ...this.basis(c),
        ...(this.visible(c) ? { visible_to: this.visible(c) } : {}),
        terms: { ...(this.label(c, "template") ? { template: this.label(c, "template") } : {}), parties: [me, other], commitments, ...(term ? { term } : {}), ...(then ? { then } : {}), ...(termination.length ? { termination } : {}), ...(text ? { text } : {}) },
      },
      { block: "sign_agreement", agreement: `$${ref}`, as: me },
    ];
  }

  private statement(c: Call, bind?: string): Block[] {
    const common = { ...this.speaksFor(c), ...this.basis(c), ...(this.visible(c) ? { visible_to: this.visible(c) } : {}), ...(bind ? { ref: bind } : {}) };
    const withdraw = this.id(c, "withdraw");
    if (withdraw) return [{ block: "withdraw", record: withdraw, ...(this.str(c, "text") ? { text: this.str(c, "text") } : {}), ...common }];
    if (this.has(c, "hold")) return this.hold(c, common);
    const kind = this.label(c, "kind");
    const text = this.str(c, "text");
    if (!kind) throw new Ask("What kind of statement is it (a notice, a law, a report, …)?");
    if (!text) throw new Ask("What should it say?");
    const to = this.ids(c, "to")?.map((x) => (x.startsWith("$") ? x : this.k.entityOf(x)));
    const data = this.json(c, "data");
    const adico = this.json(c, "adico");
    const formal = this.str(c, "formal");
    // Where it is put up: a cell of ground. A lot of one cell is that cell; of several, which is asked; anything else
    // is no place (a clerk asked to publish a law "in place of" another, and the other's id was written here).
    let on = this.id(c, "on");
    if (on !== undefined && !on.startsWith("$") && !/^cell\.[0-9]{1,6}\.[0-9]{1,6}$/.test(on)) {
      const cells = this.k.lots.get(on);
      if (cells?.length === 1) on = cells[0]!;
      else if (cells && cells.length > 1) throw new Ask(`Which cell of ${on} should it be put up on: ${cells.slice(0, 12).join(", ")}${cells.length > 12 ? ", …" : ""}?`);
      else throw new Ask(`A paper is put up at a place on the ground: a lot, or a cell of one. ${on} is neither, as far as you know. To publish it and put it up nowhere, leave the place out; to put one paper in another's place, withdraw the other and publish this.`);
    }
    // What someone may take up, and a recurring situation people take part in (docs/design/ai-citizens.md 2a, 2b):
    // facts in the typed vocabulary, checked by the contract when the act is.
    // (A translator writes a practice's and an offer's money and lengths of time as the request wrote them, to be copied
    // the way a payment's amount is: the block has the smallest unit and whole seconds, as everywhere in them, and a
    // translator is not asked to know the currency's or to count seconds. A code participant's are that already.
    // 2026-10-14, prompt 0.9.5.)
    const offer = this.asWritten ? this.writtenData(this.json(c, "offer")) : this.json(c, "offer");
    const practice = this.asWritten ? this.writtenData(this.json(c, "practice")) : this.json(c, "practice");
    const assertion = this.json(c, "assertion");
    const registry = this.json(c, "registry");
    return [{ block: "publish", kind, text, ...(to ? { addressed_to: to } : {}), ...(on ? { place: on } : {}), ...(data !== undefined ? { data } : {}), ...(adico !== undefined ? { adico } : {}), ...(formal ? { formal: { language: "cel", condition: formal } } : {}),
      ...(offer !== undefined ? { offer } : {}), ...(practice !== undefined ? { practice } : {}),
      ...(assertion !== undefined ? { assertion } : {}), ...(registry !== undefined ? { registry } : {}), ...common }];
  }

  /** What a translator wrote as data for a practice or an offer, read as the request wrote it (`resolve`, `written`): the amounts
   * of its money outcomes as an amount is (calls.parseAmount, in the world's money), and its lengths of time (`every`,
   * `lasts`, `term`, `notice`) as a length of time is (calls.parseDuration: "14 days", "90 minutes", "a month"), where
   * they are text; whole seconds are passed on as they are. */
  private writtenData(v: unknown): unknown {
    const lengths = new Set(["every", "lasts", "term", "notice"]);
    const walk = (x: unknown, inMoney: boolean): unknown => {
      if (Array.isArray(x)) return x.map((y) => walk(y, inMoney));
      if (x && typeof x === "object") return Object.fromEntries(Object.entries(x as object).map(([k, y]) => [k, typeof y === "string" && k === "amount" && inMoney ? calls.parseAmount(y, this.k.currency) : typeof y === "string" && lengths.has(k) ? calls.parseDuration(y) : walk(y, inMoney || k === "money")]));
      return x;
    };
    return walk(v, false);
  }

  /**
   * A hold (contracts/calls.md): an instruction to whoever acts on a standing record not to act on it while the hold
   * stands. Who that is, is the one physical answer: whoever the record is addressed to, as the participant knows it
   * (or whoever the call says). Nothing is stopped here: the one addressed honours it, or doesn't.
   */
  private hold(c: Call, common: { speaks_for: string; visible_to?: unknown }): Block[] {
    const other = ["kind", "data", "adico", "formal", "on", "offer", "practice", "assertion", "registry"].filter((k) => this.has(c, k) && !(k === "kind" && this.label(c, "kind") === "hold"));
    if (other.length) throw new Ask("A hold says only what it holds, in what words, for whom and on what basis: nothing else should be written.");
    const held = [...new Set(this.ids(c, "hold")!)];
    if (!held.length) throw new Ask("Hold what? Name it by its id.");
    const me = common.speaks_for;
    const given = this.ids(c, "to")?.map((x) => (x.startsWith("$") ? x : this.k.entityOf(x)));
    const to: string[] = [];
    for (const x of held) {
      if (x.startsWith("$")) throw new Ask("A hold names something already on record, not something made in the same act.");
      if (this.k.withdrawn.has(x)) throw new Ask(`${x} has been withdrawn: there is nothing to hold.`);
      const acts = given ?? this.k.addressed.get(x);
      if (!acts) throw new Ask(`You don't know of a standing paper called ${x} that someone acts on. Look it up and name it by its id, or say who is to hold it.`);
      for (const a of acts) if (a !== me && !to.includes(a)) to.push(a);
    }
    // (What is addressed to nobody but the organisation itself is acted on by its own people: the hold goes on its
    // own file, where they read it. A standing work order is such a paper.)
    const own = !to.length;
    const text = this.str(c, "text") || `Please hold ${held.join(", ")}: nothing is to be done under ${held.length > 1 ? "them" : "it"} until this is withdrawn.`;
    return [{ block: "publish", kind: "hold", text, addressed_to: own ? [me] : to, data: { holds: held }, visible_to: own ? [me] : [me, ...to], ...common }];
  }

  private form(c: Call, bind?: string): Block[] {
    // The form, by its name as written: its own name or record id, or the same in ordinary words ("permit
    // application", "the event permit form"). One nobody has seen is said to be that before anything else is asked
    // (asked "which office's form?" about a form that doesn't exist, a participant can only guess). Known, and its
    // office not said: it goes where it says it goes, if that's one place.
    const raw = this.raw(c, "form");
    const written = raw && "id" in raw ? raw.id : raw && "text" in raw ? raw.text : undefined;
    if (written === undefined) throw new Ask("Which form?");
    const plain = written.trim().toLowerCase().replace(/^the\s+/, "").replace(/[\s-]+/g, "_");
    const spellings = [written, plain, plain.replace(/_form$/, "")];
    const known = this.k.forms.filter((x) => spellings.includes(x.data?.form) || x.id === written);
    if (!known.length) throw new Ask(LABEL_TEXT.unknown_form);
    const name: string = known.some((x) => x.id === written) ? written : known[0]!.data.form;
    const goes = [...new Set(known.map((x) => Knowledge.formOf(x)))].sort();
    const to = this.has(c, "to") ? this.need(c, "to", "Which office's form?") : goes.length === 1 ? goes[0]! : (() => { throw new Ask("Which office's form?"); })();
    const f = this.k.form(to, name);
    if (!f) {
      // Known by name but not from that office: say where it goes, rather than that it's unknown.
      const elsewhere = this.k.forms.filter((x) => x.data?.form === name || x.id === name);
      if (!elsewhere.length) throw new Ask(LABEL_TEXT.unknown_form);
      const where = [...new Set(elsewhere.map((x) => Knowledge.formOf(x)))];
      throw new Ask(`The ${name.replace(/_/g, " ")} form isn't one ${to} takes: it goes to ${where.join(" or ")}.`);
    }
    const spec = f.data as { form: string; submit_as: string; submit_to: string[]; fields: { [k: string]: { type: string; required?: boolean; options?: string[] } }; writes?: forms.FormWrites };
    const data: { [k: string]: unknown } = {};
    const missing: string[] = [];
    for (const [field, t] of Object.entries(spec.fields)) {
      if (!this.has(c, field)) {
        if (t.required) missing.push(field);
        continue;
      }
      data[field] =
        t.type === "amount" ? this.amount(c, field)
        : t.type === "duration" ? this.seconds(c, field)
        // (A count on a form may be nought: a vote with nobody against.)
        : t.type === "count" ? calls.parseCount(this.str(c, field)!, this.k.currency, true)
        : t.type === "text" ? this.str(c, field)
        : t.type === "choice" ? this.choice(c, field, t.options ?? [])
        : t.type === "space" ? this.space(this.id(c, field)!)
        // A kind of building names a catalogue entry, not anyone: quoted or not, it's the same word.
        : t.type === "structure_type" ? this.str(c, field)
        : t.type === "list" ? this.ids(c, field)
        : t.type === "date" ? this.date(c, field)
        : this.id(c, field);
    }
    // (A paper of the office's own may be given its words as they are to stand, where the form has no field of that name.)
    const ownWords = !!spec.writes && !("text" in spec.fields);
    const unknown = Object.keys(c.args).filter((a) => !["to", "form", "for"].includes(a) && !(a in spec.fields) && !(a === "text" && ownWords));
    if (unknown.length) throw new Ask(`The ${spec.form.replace(/_/g, " ")} form has no ${unknown.join(" or ")} field. Its fields are: ${Object.keys(spec.fields).join(", ")}.`);
    if (missing.length) throw new Ask(`The ${spec.form.replace(/_/g, " ")} needs: ${missing.join(", ")}.`);
    // A paper of the office's own (contracts: FormWrites): written from the fields as the form says, the statement
    // the rest of the world reads. It does not cite the form.
    if (spec.writes) {
      const me = this.id(c, "for") ?? this.me;
      const paper = this.written(() => forms.writePaper(spec as forms.FormData, data as forms.Filled, { self: me, now: this.k.t, money: (a) => this.sum(a), ...(ownWords && this.has(c, "text") ? { text: this.str(c, "text")! } : {}) }));
      // A claim the form records beside its paper (a permission granted with the decision): recorded first, as an
      // office that grants records what it grants and then says so.
      const claim = this.written(() => forms.writeClaim(spec as forms.FormData, data as forms.Filled, { self: me, now: this.k.t }));
      return [...(claim ? [{ block: "record_claim", ...claim, speaks_for: me } as Block] : []), { block: "publish", ...paper, text: paper.text.slice(0, 16384), speaks_for: me, ...(bind ? { ref: bind } : {}) }];
    }
    // What was filled in, in words: an amount as the world writes its money, a length of time in days.
    const words = (k: string, x: unknown): string => {
      const type = spec.fields[k]?.type;
      if (type === "amount" && typeof x === "string") return this.sum(x);
      if (type === "duration" && typeof x === "number") return durationWords(x);
      return typeof x === "string" ? x : JSON.stringify(x);
    };
    const summary = Object.entries(data).map(([k, x]) => `${k.replace(/_/g, " ")} ${words(k, x)}`).join(", ");
    return [{ block: "publish", kind: spec.submit_as, speaks_for: this.id(c, "for") ?? this.me, addressed_to: spec.submit_to, basis: f.id, text: `${spec.form.replace(/_/g, " ")}: ${summary}.`.slice(0, 16384), data, ...(bind ? { ref: bind } : {}) }];
  }

  /** A date as written ("year 1, day 12"), as the moment that day begins. */
  private date(c: Call, field: string): number {
    return this.written(() => forms.parseDate(this.str(c, field)!));
  }
  /** What a form's own reading says is wrong is a question back. */
  private written<T>(f: () => T): T {
    try {
      return f();
    } catch (e) {
      if (e instanceof forms.FormError) throw new Ask(e.message);
      throw e;
    }
  }

  private choice(c: Call, field: string, options: string[]): string {
    const s = this.str(c, field)!;
    if (options.length && !options.includes(s)) throw new Ask(`${field} must be one of: ${options.join(", ")}.`);
    return s;
  }
}
