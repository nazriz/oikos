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

import { calls, formatMoney, type Block } from "@terrarium/participants";
import { Knowledge } from "./knowledge";

type Call = calls.Call;
type Value = calls.Value;

export const RESOLVER = { id: "resolver", version: "0.4.0" };

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
};

class Ask extends Error {}

const $ = formatMoney;

/** Resolve a program. `typeOf` gives a structure type from the world's catalogue, for building on a lot. */
export function resolve(program: calls.Program, k: Knowledge, typeOf: (type: string) => StructureTypeInfo | undefined = () => undefined, as?: string): Resolution {
  if ("none" in program) return { ok: false, questions: [LABEL_TEXT[program.none]] };
  if (calls.programText(program).length > 65536) return { ok: false, questions: [LABEL_TEXT.too_much] };
  const invalid = calls.contractErrors(program);
  if (invalid.length) return { ok: false, questions: [LABEL_TEXT.unclear], invalid };
  const r = new Resolver(k, program, k.actingFor(as));
  r.typeOf = typeOf;
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
  private refs = new Set<string>();
  private n = 0;
  constructor(private k: Knowledge, program: { lines: calls.Line[] }, private readonly me: string) {
    for (const l of program.lines) if (l.bind) this.refs.add(l.bind);
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
    if ("id" in v && named === undefined) return v.id;
    if ("var" in v) return `$${v.var}`;
    if (named !== undefined) {
      const found = this.k.byName(named);
      if (found.length === 1) return found[0];
      if (found.length > 1) throw new Ask(`More than one ${what} is called "${named}": ${found.join(", ")}. Which one?`);
      throw new Ask(`You don't know of anyone or anything called "${named}" (for ${what}).`);
    }
    throw new Ask(`${what} should name something, not ${"json" in v ? "data" : "a call"}.`);
  }
  private need(c: Call, key: string, question: string): string {
    const x = this.id(c, key);
    if (x === undefined) throw new Ask(question);
    return x;
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
    return s === undefined ? undefined : calls.parseAmount(s);
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
      case "work": return this.work(c);
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
    return s === undefined ? undefined : String(calls.parseCount(s));
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
  private work(c: Call): Block[] {
    const task = this.need(c, "task", "What work?");
    const units = this.quantity(c, "units");
    if (!units || units === "0") throw new Ask("How much of it?");
    const at = this.need(c, "at", "Where?");
    const by = this.has(c, "by") ? (this.ids(c, "by") ?? [this.id(c, "by")!]).map((p) => this.k.entityOf(p)) : [];
    const on = this.id(c, "on");
    return [{ block: "work", task, units: Number(units), at, performers: by, ...(on ? { on } : {}) }];
  }

  /** The money outcome of a call, for requests and commitments. */
  private moneyOutcome(c: Call, from: string | undefined, commitment = false): { money: object } {
    const amount = this.amount(c, "amount");
    if (amount === undefined) throw new Ask("How much?");
    const to = this.payee(this.need(c, "to", "Paid to whom?"), commitment);
    const purpose = this.str(c, "for");
    const settles = this.id(c, "settles");
    return { money: { ...(from ? { from } : {}), to, amount, ...(purpose ? { for: purpose } : {}), ...(settles ? { settles } : {}) } };
  }

  private money(c: Call, bind?: string): Block[] {
    const from = this.payer(c, "the payment");
    const out = this.moneyOutcome(c, from).money as { to: string; amount: string; for?: string; settles?: string };
    const every = this.seconds(c, "every");
    const first = this.seconds(c, "first");
    const keeper = this.keeper(from);
    if (keeper === undefined) throw new Ask(`You don't know who keeps account ${from}, so you can't ask them to pay from it.`);
    if (keeper === this.me) {
      // The participant's own entity keeps the money (a bank, or someone keeping their own): it moves it itself.
      if (every) throw new Ask("You keep this money yourself, so a repeating payment means paying each time. Say when to pay this one.");
      const per = this.id(c, "per_request");
      return [{ block: "transfer", from, to: out.to, amount: out.amount, ...(out.settles ? { settles: out.settles } : {}), ...(per ? { per_instruction: per } : {}), ...(out.for ? { memo: out.for.slice(0, 500) } : {}) }];
    }
    // Someone else keeps it: the only physical option is to ask them. They decide.
    return [{
      block: "publish", kind: "request", speaks_for: this.me, addressed_to: [keeper], visible_to: [this.me, keeper],
      text: `Please pay ${$(out.amount)} from ${from} to ${out.to}${every ? ` every ${Math.round(every / 86_400)} days` : ""}${out.for ? `, for ${out.for}` : ""}.`,
      data: { outcome: { money: { from, ...out } }, ...(every ? { every } : {}), ...(first !== undefined ? { first } : {}) },
      ...(this.id(c, "basis") ? { basis: this.id(c, "basis") } : {}), ...(bind ? { ref: bind } : {}),
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
    const basis = this.id(c, "basis");
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
        block: "propose_agreement", speaks_for: this.me, ref, ...(basis ? { basis } : {}),
        terms: {
          template: "construction", parties: [this.me, builder],
          commitments: [
            { who: builder, does: { outcome: { structure: remove ? { remove } : { type, on } } } },
            { who: this.me, does: { outcome: { money: { from, to: builder, amount: price } } } },
          ],
          text: `${this.k.name(builder)} will ${place}; ${this.k.name(this.me)} pays ${$(price)} from ${from}.`,
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
    if (this.yes(c, "leave")) return [{ block: "vacate", occupant: who, from: inside }];
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
    return [{ block: "create_entity", kind: this.str(c, "kind")!, name: this.str(c, "name")!, ...(first ? { first_position: first } : {}), ...(this.visible(c) ? { visible_to: this.visible(c) } : {}), ...(bind ? { ref: bind } : {}) }];
  }

  /** Coming into the world (a newcomer, or someone returning: done at the boundary) or leaving it. */
  private presence(c: Call, bind?: string): Block[] {
    const who = this.id(c, "who");
    const person = who === undefined || who.startsWith("$") ? who : this.k.entityOf(who);
    if (this.yes(c, "leave")) return [{ block: "leave", ...(person && person !== this.k.entity ? { person } : {}) }];
    if (person) return [{ block: "arrive", person }];
    const name = this.str(c, "name");
    const template = this.str(c, "template");
    if (!name || !template) throw new Ask("Who is coming: someone returning (who), or a newcomer (their name, age and template)?");
    const age = this.seconds(c, "age");
    if (age === undefined) throw new Ask(`How old is ${name}?`);
    const carrying = this.amount(c, "carrying");
    const sex = this.str(c, "sex");
    if (sex !== undefined && sex !== "female" && sex !== "male") throw new Ask("sex should be female or male.");
    return [{ block: "arrive", name, template, born_at: this.k.t - age, ...(sex ? { sex } : {}), ...(carrying ? { carrying } : {}), ...(bind ? { ref: bind } : {}) }];
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
    return [{ block: "create_position", title, ...(this.str(c, "role") ? { role: this.str(c, "role") } : {}), ...(channels !== undefined ? { channels } : {}), ...(module !== undefined ? { role_module: module } : {}), ...(bind ? { ref: bind } : {}) }];
  }

  private system(c: Call, bind?: string): Block[] {
    const retire = this.id(c, "retire");
    if (retire) return [{ block: "retire", participant: retire }];
    const template = this.str(c, "template");
    if (!template) throw new Ask("Which kind of system (its template)?");
    return [{ block: "deploy", template, ...(this.str(c, "title") ? { title: this.str(c, "title") } : {}), ...(bind ? { ref: bind } : {}) }];
  }

  private claim(c: Call, bind?: string): Block[] {
    const common = { ...this.speaksFor(c), ...(this.id(c, "basis") ? { basis: this.id(c, "basis") } : {}), ...(this.visible(c) ? { visible_to: this.visible(c) } : {}), ...(bind ? { ref: bind } : {}) };
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
    const every = c.fn === "money" || c.fn === "goods" ? this.seconds(c, "every") : undefined;
    const outcome =
      c.fn === "money" ? this.moneyOutcome(c, this.id(c, "from"), true)
      : c.fn === "goods" ? { goods: { kind: this.need(c, "kind", "Of what?"), quantity: this.quantity(c, "quantity") ?? "0", to: this.k.entityOf(this.need(c, "to", "Delivered to whom?")), at: this.need(c, "at", "Delivered where?"), ...(this.id(c, "from_at") ? { from: this.id(c, "from_at") } : {}) } }
      : c.fn === "occupancy" ? this.occupancyOutcome(c)
      : c.fn === "structure" ? { structure: this.id(c, "remove") ? { remove: this.id(c, "remove") } : { type: this.id(c, "type"), on: this.id(c, "on") } }
      : c.fn === "account" ? { account: { holder: this.id(c, "holder") ?? who, ...(this.id(c, "close") ? { close: this.id(c, "close") } : {}) } }
      : undefined;
    if (!outcome) throw new Ask(`A commitment can be money, goods, a building, occupancy or an account, not ${c.fn}.`);
    return { does: { outcome }, ...(every ? { every } : {}) };
  }

  private agreement(c: Call, bind?: string): Block[] {
    const sign = this.id(c, "sign");
    if (sign) return [{ block: "sign_agreement", agreement: sign, as: this.id(c, "for") ?? this.me, ...(bind ? { ref: bind } : {}) }];
    const notice = this.id(c, "notice");
    if (notice) return [{ block: "give_notice", agreement: notice, as: this.id(c, "for") ?? this.me, ...(this.str(c, "text") ? { text: this.str(c, "text") } : {}) }];
    const me = this.id(c, "for") ?? this.me;
    const other = this.need(c, "with", "An agreement with whom?");
    const ours = this.outcome(this.raw(c, "we_do"), me);
    const theirs = this.outcome(this.raw(c, "they_do"), other);
    const commitments = [...(ours ? [{ who: me, ...ours }] : []), ...(theirs ? [{ who: other, ...theirs }] : [])];
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
        block: "propose_agreement", ref, speaks_for: me, ...(this.id(c, "basis") ? { basis: this.id(c, "basis") } : {}),
        ...(this.visible(c) ? { visible_to: this.visible(c) } : {}),
        terms: { ...(this.str(c, "template") ? { template: this.str(c, "template") } : {}), parties: [me, other], commitments, ...(term ? { term } : {}), ...(then ? { then } : {}), ...(termination.length ? { termination } : {}), ...(text ? { text } : {}) },
      },
      { block: "sign_agreement", agreement: `$${ref}`, as: me },
    ];
  }

  private statement(c: Call, bind?: string): Block[] {
    const common = { ...this.speaksFor(c), ...(this.id(c, "basis") ? { basis: this.id(c, "basis") } : {}), ...(this.visible(c) ? { visible_to: this.visible(c) } : {}), ...(bind ? { ref: bind } : {}) };
    const withdraw = this.id(c, "withdraw");
    if (withdraw) return [{ block: "withdraw", record: withdraw, ...(this.str(c, "text") ? { text: this.str(c, "text") } : {}), ...common }];
    const kind = this.str(c, "kind");
    const text = this.str(c, "text");
    if (!kind) throw new Ask("What kind of statement is it (a notice, a law, a report, …)?");
    if (!text) throw new Ask("What should it say?");
    const to = this.ids(c, "to")?.map((x) => (x.startsWith("$") ? x : this.k.entityOf(x)));
    const data = this.json(c, "data");
    const adico = this.json(c, "adico");
    const formal = this.str(c, "formal");
    const on = this.id(c, "on");
    // What someone may take up, and a recurring situation people take part in (docs/design/ai-citizens.md 2a, 2b):
    // facts in the typed vocabulary, checked by the contract when the act is.
    const offer = this.json(c, "offer");
    const practice = this.json(c, "practice");
    const assertion = this.json(c, "assertion");
    const registry = this.json(c, "registry");
    return [{ block: "publish", kind, text, ...(to ? { addressed_to: to } : {}), ...(on ? { place: on } : {}), ...(data !== undefined ? { data } : {}), ...(adico !== undefined ? { adico } : {}), ...(formal ? { formal: { language: "cel", condition: formal } } : {}),
      ...(offer !== undefined ? { offer } : {}), ...(practice !== undefined ? { practice } : {}),
      ...(assertion !== undefined ? { assertion } : {}), ...(registry !== undefined ? { registry } : {}), ...common }];
  }

  private form(c: Call, bind?: string): Block[] {
    const to = this.need(c, "to", "Which office's form?");
    const name = this.need(c, "form", "Which form?");
    const f = this.k.form(to, name);
    if (!f) {
      // Known by name but not from that office: say where it goes, rather than that it's unknown.
      const elsewhere = this.k.forms.filter((x) => x.data?.form === name || x.id === name);
      if (!elsewhere.length) throw new Ask(LABEL_TEXT.unknown_form);
      const where = [...new Set(elsewhere.map((x) => x.in_position ?? x.speaks_for ?? x.author))];
      throw new Ask(`The ${name.replace(/_/g, " ")} form isn't one ${to} takes: it goes to ${where.join(" or ")}.`);
    }
    const spec = f.data as { form: string; submit_as: string; submit_to: string[]; fields: { [k: string]: { type: string; required?: boolean; options?: string[] } } };
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
        : t.type === "count" ? calls.parseCount(this.str(c, field)!)
        : t.type === "text" ? this.str(c, field)
        : t.type === "choice" ? this.choice(c, field, t.options ?? [])
        : t.type === "space" ? this.space(this.id(c, field)!)
        // A kind of building names a catalogue entry, not anyone: quoted or not, it's the same word.
        : t.type === "structure_type" ? this.str(c, field)
        : this.id(c, field);
    }
    const unknown = Object.keys(c.args).filter((a) => !["to", "form", "for"].includes(a) && !(a in spec.fields));
    if (unknown.length) throw new Ask(`The ${spec.form.replace(/_/g, " ")} form has no ${unknown.join(" or ")} field. Its fields are: ${Object.keys(spec.fields).join(", ")}.`);
    if (missing.length) throw new Ask(`The ${spec.form.replace(/_/g, " ")} needs: ${missing.join(", ")}.`);
    const summary = Object.entries(data).map(([k, x]) => `${k.replace(/_/g, " ")} ${typeof x === "string" ? x : JSON.stringify(x)}`).join(", ");
    return [{ block: "publish", kind: spec.submit_as, speaks_for: this.id(c, "for") ?? this.me, addressed_to: spec.submit_to, basis: f.id, text: `${spec.form.replace(/_/g, " ")}: ${summary}.`.slice(0, 16384), data, ...(bind ? { ref: bind } : {}) }];
  }

  private choice(c: Call, field: string, options: string[]): string {
    const s = this.str(c, field)!;
    if (options.length && !options.includes(s)) throw new Ask(`${field} must be one of: ${options.join(", ")}.`);
    return s;
  }
}
