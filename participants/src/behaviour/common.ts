// Shared helpers for behaviour modules: turning what a participant has seen into
// memory. Records arrive as what's new since the participant last looked, so each module keeps
// its own book of the records relevant to it, as a person would.

import * as C from "../calls";
import type { Assertion, Observation, Offer, Outcome as ActOutcome, Practice, Reading, Record, ParticipantAction, Registry, StatementRecord } from "../contracts";
import { channels } from "../contracts";
import { cents, moneyNow } from "../money";
import { evaluate } from "../law";

export const DAY = 86_400;
export const MONTH = 30 * DAY;

/** Everything a participant has perceived so far, indexed. */
export class Book {
  readonly records = new Map<string, Record>();
  readonly withdrawn = new Set<string>();
  /** When each record seen to be withdrawn (or replaced) stopped standing. */
  readonly withdrawnAt = new Map<string, number>();
  /** A record replaced by a later one of the same kind from whoever it spoke for (an amended law): old -> new. */
  readonly replacedBy = new Map<string, string>();
  readonly signatures = new Map<string, Set<string>>(); // agreement -> parties who signed
  readonly notices = new Map<string, { as: string; at: number }[]>(); // agreement -> notices
  readonly signedTimes = new Map<string, number[]>(); // agreement -> signature times
  private readonly byKind = new Map<string, StatementRecord[]>(); // statement kind -> statements, in the order seen
  // Kept as records arrive, so asking never rescans the whole history (docs/reliability.md, performance):
  private readonly standing = new Map<string, Map<string, StatementRecord>>(); // statement kind -> those not withdrawn, in the order seen
  private readonly byRecord = new Map<string, Record[]>(); // record type (agreement, claim...) -> records, in the order seen
  private readonly withPractice = new Map<string, StatementRecord>(); // statements carrying a practice, not withdrawn
  private readonly withAssertion = new Map<string, StatementRecord>(); // statements put forward to be believed, not withdrawn
  /** participant -> the person it acts as (from a directory). */
  readonly participantPerson = new Map<string, string>();
  /** position -> its organisation, role and holder (from a directory). */
  readonly positions = new Map<string, { entity: string; role?: string; holder?: string }>();
  readonly entityKind = new Map<string, string>();
  /** Agreements read by their own terms, as last delivered with them (contracts 0.7: readings; docs/design/rebuild.md
   * section 7), and the time of the latest observation. */
  readonly readings = new Map<string, Reading>();
  now = 0;
  private lastDirectory: unknown; // the directory lists last read (the view hands back the same lists until they change)

  absorb(obs: Observation): Record[] {
    const fresh: Record[] = [];
    this.now = obs.t;
    for (const [id, r] of Object.entries(obs.readings ?? {})) this.readings.set(id, r);
    for (const r of channels.records(obs)) {
      if (this.records.has(r.id)) continue;
      this.records.set(r.id, r);
      fresh.push(r);
      const typed = this.byRecord.get(r.record);
      if (typed) typed.push(r);
      else this.byRecord.set(r.record, [r]);
      if (r.record === "withdrawal") this.takeDown(r.withdraws, r.at);
      // A statement that says it replaces an earlier one of the same kind from whoever it speaks for (an amended law
      // names the law it replaces, in its words too): the earlier one no longer stands for this reader, who may never
      // be shown its withdrawal (a book of laws shows laws, not what was taken down).
      if (r.record === "statement" && typeof r.data?.replaces === "string") {
        const old = this.records.get(r.data.replaces);
        if (old?.record === "statement" && old.kind === r.kind && !!old.speaks_for && old.speaks_for === r.speaks_for) {
          this.replacedBy.set(old.id, r.id);
          this.takeDown(old.id, r.at);
        }
      }
      if (r.record === "signature") {
        const s = this.signatures.get(r.agreement) ?? new Set();
        s.add(r.as);
        this.signatures.set(r.agreement, s);
        this.signedTimes.set(r.agreement, [...(this.signedTimes.get(r.agreement) ?? []), r.at]);
      }
      if (r.record === "statement") {
        const list = this.byKind.get(r.kind);
        if (list) list.push(r);
        else this.byKind.set(r.kind, [r]);
        if (!this.withdrawn.has(r.id)) {
          const open = this.standing.get(r.kind);
          if (open) open.set(r.id, r);
          else this.standing.set(r.kind, new Map([[r.id, r]]));
          if (r.practice) this.withPractice.set(r.id, r);
          if (r.assertion) this.withAssertion.set(r.id, r);
        }
      }
      if (r.record === "notice") this.notices.set(r.agreement, [...(this.notices.get(r.agreement) ?? []), { as: r.as, at: r.at }]);
    }
    const dir = channels.directory(obs);
    if (dir && dir.positions !== this.lastDirectory) {
      this.lastDirectory = dir.positions;
      for (const p of dir.positions) this.positions.set(p.position, { entity: p.entity, role: p.role, holder: p.holder });
      for (const e of dir.entities) {
        this.entityKind.set(e.entity, e.kind);
        if (e.participant) this.participantPerson.set(e.participant, e.entity);
      }
    }
    return fresh;
  }

  private takeDown(id: string, at: number) {
    this.withdrawn.add(id);
    if (!this.withdrawnAt.has(id)) this.withdrawnAt.set(id, at);
    const w = this.records.get(id);
    if (w?.record === "statement") this.standing.get(w.kind)?.delete(w.id);
    this.withPractice.delete(id);
    this.withAssertion.delete(id);
  }

  /** The record in force that an id names now: itself while it stands, or what has replaced it (an amended law, and
   * what amended that), if that stands. None: never seen, or withdrawn with nothing in its place. */
  current(id: string): Record | undefined {
    let at = id;
    for (let i = 0; i < 1000 && this.replacedBy.has(at); i++) at = this.replacedBy.get(at)!;
    return this.withdrawn.has(at) ? undefined : this.records.get(at);
  }

  /** Seen to be withdrawn, with nothing standing in its place (a law repealed, a procedure revoked). */
  repealed(id: string): boolean {
    return this.withdrawn.has(id) && !this.current(id);
  }

  /** Every statement of a kind seen, withdrawn or not, in the order seen. */
  all(kind: string): StatementRecord[] {
    return this.byKind.get(kind) ?? [];
  }

  /** Statements of a kind that are still standing (not withdrawn), in the order seen. */
  open(kind: string): StatementRecord[] {
    const open = this.standing.get(kind);
    return open ? [...open.values()] : [];
  }

  /** Statements carrying a practice (a gathering: docs/design/ai-citizens.md 2b), still standing, in the order seen. */
  practices(): StatementRecord[] {
    return [...this.withPractice.values()];
  }

  /** Statements put forward to be believed (an `assertion`: a teaching, a report, a promise), not withdrawn. */
  assertions(): StatementRecord[] {
    return [...this.withAssertion.values()];
  }

  /** Records of a type (agreement, claim, notice...), in the order seen: rather than every record ever seen. */
  ofType<T extends Record["record"]>(type: T): Extract<Record, { record: T }>[] {
    return (this.byRecord.get(type) ?? []) as Extract<Record, { record: T }>[];
  }

  signedBy(agreement: string, party: string): boolean {
    return this.signatures.get(agreement)?.has(party) ?? false;
  }

  /** Concluded: signed by every party (whether or not it has since ended). */
  concluded(agreement: string): boolean {
    const a = this.records.get(agreement);
    return a?.record === "agreement" && a.terms.parties.every((p) => this.signedBy(agreement, p));
  }

  /** In force now: by its reading, if one came with it (concluded, and not yet ended by its term or by notice under its
   * terms); otherwise, concluded. */
  inForce(agreement: string): boolean {
    const r = this.readings.get(agreement);
    if (r) return (r.status === "in_force" || r.status === "ending") && (r.ends_at === undefined || this.now < r.ends_at);
    return this.concluded(agreement);
  }

  /** When it ends by its reading (its term run out, or notice under its terms), if one came with it and it has an end. */
  endsAt(agreement: string): number | undefined {
    return this.readings.get(agreement)?.ends_at;
  }

  /** The time the last party signed, if all have. */
  signedAt(agreement: string): number | undefined {
    if (!this.concluded(agreement)) return undefined;
    return Math.max(...(this.signedTimes.get(agreement) ?? []));
  }

  /** The entity a record was made for: the organisation of the position it was made in, or its author's person. */
  authorEntity(r: Record): string | undefined {
    if (r.author === "genesis") return r.speaks_for;
    if (r.in_position) return this.positions.get(r.in_position)?.entity;
    return this.participantPerson.get(r.author);
  }

  entitiesOfKind(kind: string): string[] {
    return [...this.entityKind].filter(([, k]) => k === kind).map(([e]) => e).sort();
  }
}

/** Laws seen that prohibit (institutional grammar: must not) with a formal condition, in id order: those standing now,
 * or, given a time, those in force then (made by then, and not withdrawn or replaced by then). */
export function prohibitions(book: Book, at?: number): StatementRecord[] {
  const laws = at === undefined ? book.open("law") : book.all("law").filter((l) => l.at <= at && !((book.withdrawnAt.get(l.id) ?? Infinity) <= at));
  return laws.filter((l) => l.formal?.condition && (l.adico as any)?.deontic === "must_not").sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * The laws in force, as far as this participant has seen, that an act it's thinking of would breach: prohibitions whose
 * formal condition is true of the act (docs/design/ai-citizens.md 2e; D27). A law binds a code participant only this
 * way, whoever passed it (a world's genesis, a council, a model mayor through the translator), never through a field
 * only code reads (VISION 15). Whether to comply is still the participant's: breaking a law is always possible.
 */
export function breaches(book: Book, act: object, actor: string, now: number): StatementRecord[] {
  // (The laws in force at `now`, the moment of the act: a notice is judged by the law as it stood when it was given.)
  return prohibitions(book, now).filter((l) => {
    const v = evaluate(l.formal!.condition, { block: act, actor, now }, []);
    return "value" in v && v.value;
  });
}

// ------------------------------------------------------------------ laws made from figures (docs/behaviour/government.md)
//
// A law whose substance is a few figures (a notice period, how often, a threshold) is written from them by a schedule:
// world content (a record of kind `law_schedule`) giving the figures with their types and units, and how the law's
// words, its Institutional Grammar breakdown and its rule (a formal condition) read with the figures in place. A world's
// generator writes its opening laws this way and the council's clerk writes an amended law the same way, so whoever
// reads the first reads the second. The law carries its figures openly (`data.figures`), so anyone can see what can be
// amended. Nothing here knows any particular law.

/** A figure of a law. A duration is held in seconds and worded in `unit` (days, months...); a count is held in
 * `held_in` (default: its unit), `per_unit` of them to one `unit` (a share: unit "percent", held in basis points, 100
 * to one). `type` is also the type of the figure's field on the law's amendment form. */
export type LawFigure = { type: "duration" | "count"; unit: string; label?: string; held_in?: string; per_unit?: number; description?: string };
/** A schedule: in its `text`, each of its `adico` parts and its `formal` (a CEL condition, if acts can be checked
 * against the law), `{name}` stands for the figure as worded ("60 days", "50") and `{name:seconds}` (any word after the
 * colon; by convention the unit it's held in) for the number as held. */
export type LawSchedule = { title: string; form?: string; figures: { [name: string]: LawFigure }; text: string; adico?: { [part: string]: string }; formal?: string };
/** A law's figures as it carries them: each value with the unit it's held in. */
export type LawFigures = { [name: string]: { value: number; unit: string } };

const DURATION_UNITS: [string, string, number][] = [["years", "year", 365 * DAY], ["months", "month", MONTH], ["weeks", "week", 7 * DAY], ["days", "day", DAY], ["hours", "hour", 3600], ["minutes", "minute", 60], ["seconds", "second", 1]];

/** The unit a figure's value is held in. */
export const heldIn = (f: LawFigure): string => (f.type === "duration" ? "seconds" : f.held_in ?? f.unit);

/** A figure's value as held, from what its form field gives (a duration arrives in seconds; a count in the figure's unit). */
export const heldValue = (f: LawFigure, given: number): number => (f.type === "duration" ? given : given * (f.per_unit ?? 1));

/** A figure in words: a duration in the schedule's unit when it's a whole number of them, else in days (or hours...);
 * a count in its unit ("50%", "3 times"; without the unit, "50"). */
export function figureWords(f: LawFigure, value: number, withUnit = true): string {
  if (f.type === "duration") {
    const own = DURATION_UNITS.find(([plural]) => plural === f.unit);
    const [plural, singular, size] = [own, ...DURATION_UNITS.slice(3)].find((u) => u && value >= u[2] && value % u[2] === 0) ?? DURATION_UNITS.at(-1)!;
    return `${value / size} ${value / size === 1 ? singular : plural}`;
  }
  const n = String(value / (f.per_unit ?? 1));
  return withUnit ? (f.unit === "percent" ? `${n}%` : `${n} ${f.unit}`) : n;
}

/** A law written from figures by a schedule: its words, its breakdown, its rule, and the figures it carries. Throws if
 * the schedule names a figure it isn't given (a law can't be written with a gap in it). */
export function draftLaw(scheduleId: string, s: LawSchedule, values: { [name: string]: number }): { text: string; adico?: { [part: string]: string }; formal?: { language: "cel"; condition: string }; data: { schedule: string; figures: LawFigures } } {
  const fill = (template: string) => template.replace(/\{(\w+)(?::(\w+))?\}/g, (_, name: string, held?: string) => {
    const f = s.figures[name];
    const v = values[name];
    if (!f || !Number.isSafeInteger(v)) throw new Error(`law schedule ${scheduleId}: no figure ${name}`);
    return held ? String(v) : figureWords(f, v!, false);
  });
  const figures: LawFigures = {};
  for (const [name, f] of Object.entries(s.figures)) {
    if (!Number.isSafeInteger(values[name])) throw new Error(`law schedule ${scheduleId}: no figure ${name}`);
    figures[name] = { value: values[name]!, unit: heldIn(f) };
  }
  return { text: fill(s.text), ...(s.adico ? { adico: Object.fromEntries(Object.entries(s.adico).map(([k, v]) => [k, fill(v)])) } : {}),
    ...(s.formal ? { formal: { language: "cel" as const, condition: fill(s.formal) } } : {}), data: { schedule: scheduleId, figures } };
}

/** Signatures on a petition this participant can see: votes with choice "sign", one per signing entity (the organiser sees them all). */
export function petitionSignatures(book: Book, petition: string): number {
  const who = new Set<string>();
  for (const r of book.ofType("vote")) if (r.ballot === petition && r.choice === "sign" && r.speaks_for) who.add(r.speaks_for);
  return who.size;
}

/** A petition's signature count as its organiser last published it (0 if never), organiser included. */
export function publishedCount(book: Book, petition: StatementRecord): number {
  const counts = book.open("petition_count").filter((c) => c.data?.petition === petition.id && c.speaks_for === petition.speaks_for);
  return counts.length ? (counts.at(-1)!.data.signatures as number) : 0;
}

/** An entity's own account at a bank (not money it keeps itself), with its balance as a number (money.ts). */
export function ownBanked(obs: Observation, holder: string): { account: string; balance: number; custodian: string; currency: string } | undefined {
  const a = channels.accounts(obs).find((x) => x.holder === holder && x.custodian !== holder);
  return a && { account: a.account, balance: cents(a.balance), custodian: a.custodian, currency: a.currency };
}

/** Its own account (held by the entity it acts for), with its balance as a number for arithmetic (money.ts). */
export function ownAccount(obs: Observation): { account: string; balance: number; custodian: string; currency: string } | undefined {
  const a = channels.accounts(obs).find((x) => x.holder === obs.entity);
  return a && { account: a.account, balance: cents(a.balance), custodian: a.custodian, currency: a.currency };
}

// ------------------------------------------------------------------ acting through calls
//
// Code participants act the way every participant does (D36, P14): they say
// what they want brought about, as calls, and the resolver turns each into
// their own acts. Paying someone is money(...): the resolver asks the account's bank.

/**
 * One atomic act: lines of calls, optionally binding a name (whose id comes back in the outcome's `created`), and
 * optionally why: the rule that fired, in plain words, which goes into the log with the act (its `reasoning`).
 */
/**
 * A step: calls in one action, with its reason, what follows from its outcome (`then`), and, for a step whose content
 * depends on when it's done (a notice counting from today), how to make it again for a later moment (`redo`), should it
 * be done later than planned (a wake allows only so many actions). `planned`: when it was planned (the stepper's).
 */
export type Step = (C.Call | [string, C.Call])[] & { why?: string; then?: (o: ActOutcome) => Step[] | void; redo?: (t: number) => Step; planned?: number };

/**
 * A day's shared work: of those here, the team that gets most done when the work is shared evenly (each does the same
 * share, so a team's hours are its size times the least time any of them has left today). Someone who's already done
 * a day's work elsewhere (a new starter, arriving from their old job) joins tomorrow.
 */
export function team(here: string[], hoursLeft: (w: string) => number): { who: string[]; each: number } {
  const byHours = [...here].sort((a, b) => hoursLeft(b) - hoursLeft(a) || (a < b ? -1 : 1));
  let best = { who: [] as string[], each: 0 };
  byHours.forEach((w, i) => {
    const each = Math.max(0, hoursLeft(w));
    if (each * (i + 1) > best.each * best.who.length) best = { who: byHours.slice(0, i + 1), each };
  });
  return { who: best.who.sort(), each: best.each };
}

/** Out of time (a `no_time_left` refusal): whose, and how long they have left today, as the world counts it. */
export function outOfTime(res: { refusal?: { code?: string; detail?: string } }): { who?: string; left: number } | undefined {
  if (res.refusal?.code !== "no_time_left") return undefined;
  const m = /^(\S+) has (\d+) s of work left today/.exec(res.refusal.detail ?? "");
  return m ? { who: m[1]!, left: Number(m[2]) } : { left: 0 };
}

/**
 * How long a unit of work takes, as a manager learns it, worker by worker: the figure it plans with at first; once the
 * world has said a crew hasn't the time ("this needs N" each), each of them as slow as that crew turned out to be, next to
 * what we thought; and after work that went through, each a little quicker (2%) once a week, asking a little more of them,
 * until it doesn't fit. A crew takes its members' mean (what a unit takes is linear in a crew's mean skill, the
 * world's physics). Where workers differ (skill), a plan on the figure alone asks a slow crew for more than its day
 * holds, again and again, and a quick one for less than it could do.
 */
export class Pace {
  private readonly known = new Map<string, number>(); // worker -> seconds a unit
  private readonly asked = new Map<string, number>(); // worker -> the week we last asked more of them
  constructor(private readonly nominal: number) {}
  private of(w: string) {
    return this.known.get(w) ?? this.nominal;
  }
  perUnit(crew: string[]): number {
    return crew.length ? Math.max(1, Math.ceil(crew.reduce((a, w) => a + this.of(w), 0) / crew.length)) : Math.ceil(this.nominal);
  }
  /** Refused for time: `units` of work shared by `crew`, each needing what the refusal says. */
  refused(res: { refusal?: { code?: string; detail?: string } }, units: number, crew: string[]) {
    const m = res.refusal?.code === "no_time_left" ? /this needs (\d+)/.exec(res.refusal.detail ?? "") : null;
    if (!m || units <= 0 || !crew.length) return;
    const ratio = (Number(m[1]) * crew.length) / units / (crew.reduce((a, w) => a + this.of(w), 0) / crew.length);
    if (ratio > 1) for (const w of crew) this.known.set(w, this.of(w) * ratio);
  }
  /** Done in the time we gave it (on day `day`): perhaps they're quicker than we think. Once a week each. */
  done(crew: string[], day: number) {
    const week = Math.floor(day / 7);
    for (const w of crew) if (this.asked.get(w) !== week) {
      this.asked.set(w, week);
      this.known.set(w, this.of(w) * 0.98);
    }
  }
}

/** The next time of day `at` (seconds) on a working day (the first `days` of each week), after `t`: when an employer whose
 * staff come in for the working day looks at the day's work (world-expansion 6.3). */
export function nextLook(t: number, at: number, days: number): number {
  for (let d = Math.floor(t / DAY); ; d++) if (d % 7 < days && d * DAY + at > t) return d * DAY + at;
}

/** A step with its reason: `because("Rent is due", pay(...))`. */
export const because = (why: string, ...lines: (C.Call | [string, C.Call])[]): Step => Object.assign(lines, { why });

export const callAction = (step: Step): ParticipantAction => {
  const program = C.programOf(...step);
  const action = { type: "call" as const, call: C.programText(program), ...(step.why ? { reasoning: step.why } : {}) };
  return Object.defineProperty(action, C.PARSED, { value: program, enumerable: false });
};

/**
 * Letters to an office. Each is answered once, with the office's standard report: what a real office sends when
 * asked. The report is the office's own figures, composed by code (a code office can't read a letter, so it
 * answers every one the same way). Office reports aren't answered, so offices never write to each other forever.
 */
export class Letters {
  private pending: { id: string; from: string; as?: string }[] = [];
  /** Letters in: all but our own, reports (answers to letters), and news of a request of ours from those we asked to
   * carry it out (a bank saying a payment we asked for wasn't made), which isn't a question. A letter about anything
   * else is (pilot 10: a mayor asking the bank about an invoice, by its id, went unanswered). */
  take(obs: Observation, book: Book) {
    const newsOfOurRequest = (m: Observation["inbox"][number]) => {
      const r = m.re ? book.records.get(m.re) : undefined;
      if (r?.record !== "statement" || r.kind !== "request" || r.speaks_for !== obs.entity) return false;
      const sender = m.as ? book.positions.get(m.as)?.entity : book.participantPerson.get(m.from);
      return !!sender && (r.addressed_to ?? []).includes(sender);
    };
    for (const m of obs.inbox) if (m.from !== obs.participant && !m.text.startsWith("Report from ") && !newsOfOurRequest(m)) this.pending.push({ id: m.id, from: m.from, ...(m.as ? { as: m.as } : {}) });
  }
  /** Each letter answered with the report (which may depend on who wrote: the participant, and the position it wrote in). */
  answer(report: (from: { participant: string; as?: string }) => string, why = "A letter to our office: answering with our standard report."): Step[] {
    const out = this.pending.map((m) => because(why, message([m.from], report({ participant: m.from, as: m.as }), m.id)));
    this.pending = [];
    return out;
  }
}

/** An amount in words, for reasons and letters, as the world writes its money (money.ts). */
export const usd = moneyNow;

/** Money to an account: a one-off or repeating payment. */
export function pay(to: string, amount: number, o: { from?: string; for?: string; settles?: string; every?: number; first?: number; basis?: string; per_request?: string } = {}): C.Call {
  return C.call("money", {
    to, amount: C.amountText(amount), from: o.from, for: o.for ? C.text(o.for) : undefined, settles: o.settles,
    every: o.every ? C.secs(o.every) : undefined, first: o.first !== undefined ? C.secs(o.first) : undefined, basis: o.basis, per_request: o.per_request,
  });
}

/** A published statement: kind, text, and optional addressees, data, visibility and basis. */
export function say(kind: string, text: string, o: { to?: string[]; data?: unknown; visible?: "public" | string[]; basis?: string; for?: string; adico?: unknown; formal?: string; on?: string; offer?: Offer; practice?: Practice; assertion?: Assertion; registry?: Registry } = {}): C.Call {
  return C.call("statement", {
    kind, text: C.text(text), to: o.to ? C.json(o.to) : undefined, data: o.data !== undefined ? C.json(o.data) : undefined,
    adico: o.adico !== undefined ? C.json(o.adico) : undefined, formal: o.formal ? C.text(o.formal) : undefined,
    offer: o.offer !== undefined ? C.json(o.offer) : undefined, practice: o.practice !== undefined ? C.json(o.practice) : undefined,
    assertion: o.assertion !== undefined ? C.json(o.assertion) : undefined, registry: o.registry !== undefined ? C.json(o.registry) : undefined,
    visible: o.visible === undefined ? undefined : o.visible === "public" ? "public" : C.json(o.visible), basis: o.basis, for: o.for, on: o.on,
  });
}

export const withdraw = (record: string, text?: string): C.Call => C.call("statement", { withdraw: record, text: text ? C.text(text) : undefined });
export const sign = (agreement: string): C.Call => C.call("agreement", { sign: agreement });
export const notice = (agreement: string, text: string): C.Call => C.call("agreement", { notice: agreement, text: C.text(text) });
export const message = (to: string[], text: string, re?: string): C.Call => C.call("message", { to: C.json(to), text: C.text(text), re });
/** Go into a space (a home, a workplace floor). */
export const moveIn = (space: string): C.Call => C.call("occupancy", { in: space });
/** Come out of a space, or a whole building. */
export const moveOut = (from: string, who: string): C.Call => C.call("occupancy", { in: from, who, leave: "yes" });
/** `visible`: public, or only to these (a secret ballot: the electoral office). */
export const vote = (ballot: string, choice: string, visible?: "public" | string[]): C.Call => C.call("vote", { ballot, choice, visible: Array.isArray(visible) ? C.json(visible) : visible });
export const record = (position: "right" | "liberty", holder: string, about: unknown, o: { against?: string; basis?: string } = {}): C.Call =>
  C.call("claim", { position, holder, about: C.json(about), against: o.against, basis: o.basis });

/** Offer an agreement (signed on our side). `we` and `they` are the outcomes each side commits to. */
export function offer(withWhom: string, o: { template: string; we?: C.Call; they?: C.Call; term?: number; then?: "periodic"; ourNotice?: number; theirNotice?: number; text?: string; basis?: string }): C.Call {
  return C.call("agreement", {
    with: withWhom, template: o.template, we_do: o.we, they_do: o.they, term: o.term ? C.secs(o.term) : undefined, then: o.then,
    our_notice: o.ourNotice ? C.secs(o.ourNotice) : undefined, their_notice: o.theirNotice ? C.secs(o.theirNotice) : undefined,
    terms: o.text ? C.text(o.text) : undefined, basis: o.basis,
  });
}

// ------------------------------------------------------------------ reading agreements (the standard encoding, §9.2)

export type Outcome = { money?: { from?: string; to: string; amount: number; for?: string }; goods?: { kind: string; quantity: string; to: string; at: string; from?: string }; occupancy?: { who: string; in: string; leave?: boolean }; structure?: { type?: string; on?: string; remove?: string } };

/** The structure a space is in (`apts-3/dwelling.2` -> `apts-3`). */
export const structureOf = (space: string) => space.split("/")[0]!;

/** What a party commits to bring about in an agreement, and how often. */
export function commitmentOf(a: Record | undefined, who: string): { outcome?: Outcome; every?: number } {
  if (a?.record !== "agreement") return {};
  const c = a.terms.commitments.find((x) => x.who === who);
  return { outcome: c?.does?.outcome, every: c?.every };
}

/** A lease's rent (paid by the tenant, into which account) and home: the space given by the other party, and its building. */
export function leaseTerms(a: Record | undefined, tenant: string): { rent: number; rentTo?: string; space?: string; structure?: string } {
  if (a?.record !== "agreement") return { rent: 0 };
  const other = a.terms.parties.find((x) => x !== tenant)!;
  const pays = commitmentOf(a, tenant).outcome?.money;
  const space = commitmentOf(a, other).outcome?.occupancy?.in;
  return { rent: cents(pays?.amount), rentTo: pays?.to, space, structure: space ? structureOf(space) : undefined };
}

/** A job's wage and pay period (from the employer) and workplace (the space the worker commits to be in). */
export function jobTerms(a: Record | undefined, worker: string): { wage: number; period: number; workplace?: string } {
  if (a?.record !== "agreement") return { wage: 0, period: 14 * DAY };
  const employer = a.terms.parties.find((x) => x !== worker)!;
  const pays = commitmentOf(a, employer);
  return { wage: cents(pays.outcome?.money?.amount), period: pays.every ?? 14 * DAY, workplace: commitmentOf(a, worker).outcome?.occupancy?.in };
}

export const between = (lo: number, hi: number, u: number) => lo + Math.floor(u * (hi - lo + 1));

/** A builder's published price for a kind of building, or for demolishing one (its latest price list), if it has published one. */
export function publishedPrice(book: Book, builder: string, type: string, what: "prices" | "demolition" = "prices"): number | undefined {
  const list = book.open("price_list").filter((r) => (r.speaks_for === builder || r.author === builder) && r.data?.prices).sort((a, b) => b.at - a.at)[0];
  const price = list?.data?.[what]?.[type];
  return Number.isInteger(price) ? price : undefined;
}

// ------------------------------------------------------------------ land: lots are registry records over cells

/** The cells a lot covers, from its registry record (a statement of kind "lot"). */
export function cellsOf(book: Book, lot: string): string[] {
  const r = book.records.get(lot);
  return r?.record === "statement" && r.kind === "lot" && !book.withdrawn.has(lot) ? ((r.data?.cells as string[]) ?? []) : [];
}

/** The standing lot a cell is in, if the registry has one. */
export function lotOf(book: Book, cell: string): string | undefined {
  return book.open("lot").find((l) => (l.data?.cells as string[] | undefined)?.includes(cell))?.id;
}

/** A state variable's value today, as perceived: its value on the day seen, plus its daily change since, within its
 * bounds (docs/behaviour/services.md). */
export function variableToday(v: { value: number; as_of_day: number; per_day: number; min: number; max: number } | undefined, t: number): number | undefined {
  if (!v) return undefined;
  const days = Math.max(0, Math.floor(t / DAY) - v.as_of_day);
  return Math.min(v.max, Math.max(v.min, v.value + v.per_day * days));
}
