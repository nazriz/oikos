// The resolver (docs/design/translator-and-resolver.md §8): a call → the
// seat's own acts. Deterministic, platform-side, and bound by four rules:
//   - it never chooses how: the route is what the seat supplied; a missing
//     decision is a question back to the seat (P6);
//   - it fills in only single physical answers (the one account the seat
//     holds; who keeps an account);
//   - it never acts for anyone else: whoever must physically act is asked
//     (a request) or offered an agreement, and decides (P7);
//   - it uses only what the seat knows (P8). Ids the seat states outright
//     are passed through: if one doesn't exist, physics says so.

import { calls, type Block } from "@terrarium/seats";
import type { Knowledge } from "./knowledge";

type Call = calls.Call;
type Value = calls.Value;

export const RESOLVER = { id: "resolver", version: "0.2.0" };

/** A resolution: the seat's acts, or questions for the seat (and, when the call itself broke the contract, what was wrong, for the log). */
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

const $ = (cents: number) => `$${Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${String(cents % 100).padStart(2, "0")}`;

/** Resolve a program. `capacity` gives a structure type's spaces (from the world's catalogue, which is public), for occupancy. */
export function resolve(program: calls.Program, k: Knowledge, capacity: (type: string) => { [slot: string]: number } = () => ({})): Resolution {
  if ("none" in program) return { ok: false, questions: [LABEL_TEXT[program.none]] };
  if (calls.programText(program).length > 65536) return { ok: false, questions: [LABEL_TEXT.too_much] };
  const invalid = calls.contractErrors(program);
  if (invalid.length) return { ok: false, questions: [LABEL_TEXT.unclear], invalid };
  const r = new Resolver(k, program);
  r.capacity = capacity;
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
  constructor(private k: Knowledge, program: { lines: calls.Line[] }) {
    for (const l of program.lines) if (l.bind) this.refs.add(l.bind);
  }

  private get me() {
    return this.k.entity;
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
  /** An id (or a variable, as "$name", or a name the seat wrote that it knows). */
  private id(c: Call, key: string, what = key): string | undefined {
    const v = this.raw(c, key);
    if (v === undefined) return undefined;
    if ("id" in v) return v.id;
    if ("var" in v) return `$${v.var}`;
    if ("text" in v) {
      const found = this.k.byName(v.text);
      if (found.length === 1) return found[0];
      if (found.length > 1) throw new Ask(`More than one ${what} is called "${v.text}": ${found.join(", ")}. Which one?`);
      throw new Ask(`You don't know of anyone or anything called "${v.text}" (for ${what}).`);
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
  private amount(c: Call, key: string): number | undefined {
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
  /** Whose name a record is in: the seat's own entity, unless the call says otherwise. */
  private speaksFor(c: Call): { speaks_for: string } {
    return { speaks_for: this.id(c, "for") ?? this.me };
  }

  // --- single physical answers

  /** The account to pay from: the one given, or the only one the seat's entity holds. */
  private payer(c: Call, purpose: string): string {
    const given = this.id(c, "from");
    if (given) return given;
    const own = this.k.accountsOf(this.me);
    if (own.length === 1) return own[0]!;
    if (own.length === 0) throw new Ask(`Which account should ${purpose} come from? You don't know of one you hold.`);
    throw new Ask(`Which account should ${purpose} come from: ${own.join(" or ")}?`);
  }
  /**
   * Where money goes: an account, or the only account the seat knows an entity holds.
   * For a payment made now, an entity with no known account is a question; in a
   * commitment ("we'll pay the builder") the entity itself is enough.
   */
  private payee(to: string, commitment = false): string {
    if (to.startsWith("$") || this.k.isAccount(to)) return to;
    const e = this.k.entityOf(to);
    const known = this.k.names.has(e) || this.k.seatEntity.has(to) || this.k.stated.has(e);
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
    }
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
    const out = this.moneyOutcome(c, from).money as { to: string; amount: number; for?: string; settles?: string };
    const every = this.seconds(c, "every");
    const first = this.seconds(c, "first");
    const keeper = this.keeper(from);
    if (keeper === undefined) throw new Ask(`You don't know who keeps account ${from}, so you can't ask them to pay from it.`);
    if (keeper === this.me) {
      // The seat's own entity keeps the money (a bank, or someone keeping their own): it moves it itself.
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
    if (!keeper) throw new Ask(close ? `You don't know who keeps account ${close}.` : "Who should keep the account: you, or a bank (which)?");
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
    if (!by) throw new Ask(`Who should ${place}${this.has(c, "price") || this.has(c, "from") ? "" : ", and from which account is it paid"}?`);
    const type = remove ? undefined : this.need(c, "type", "What should be built?");
    const on = remove ? undefined : this.need(c, "on", "On which lot?");
    const permit = this.id(c, "permit");
    if (this.k.entityOf(by) === this.me) {
      const from = this.payer(c, remove ? "the demolition" : "the materials");
      return remove
        ? [{ block: "demolish", structure: remove, costs_from: from }]
        : [{ block: "construct", parcel: on, structure_type: type, materials_from: from, ...(bind ? { ref: bind } : {}) }];
    }
    // Someone else builds: offer them an agreement, signed on the seat's side. They decide.
    const builder = this.k.entityOf(by);
    const price = this.amount(c, "price");
    if (price === undefined) throw new Ask(`For what price should ${this.k.name(builder)} ${place}?`);
    const from = this.payer(c, "the payment");
    const ref = bind ?? this.fresh("offer");
    return [
      {
        block: "propose_agreement", speaks_for: this.me, ref, ...(permit ? { basis: permit } : {}),
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

  private slot(structure: string): string {
    const type = this.k.structures.get(structure);
    const cap = type ? this.capacity(type) : {};
    const kinds = Object.keys(cap);
    if (kinds.length === 1) return kinds[0]!;
    throw new Ask(`Which kind of space in ${structure}${kinds.length ? `: ${kinds.join(" or ")}` : ""}?`);
  }
  capacity: (type: string) => { [slot: string]: number } = () => ({});

  private occupancy(c: Call): Block[] {
    const inside = this.need(c, "in", "Where?");
    const who = this.id(c, "who") ?? this.me;
    if (this.yes(c, "leave")) return [{ block: "vacate", occupant: who, structure: inside }];
    const slot = this.str(c, "slot") ?? this.slot(inside);
    const count = this.has(c, "count") ? calls.parseCount(this.str(c, "count")!) : 1;
    return [{ block: "occupy", structure: inside, slot, count }];
  }

  private occupancyOutcome(c: Call): { occupancy: object } {
    const inside = this.need(c, "in", "Where?");
    const who = this.id(c, "who") ?? this.me;
    const slot = this.str(c, "slot");
    const count = this.has(c, "count") ? calls.parseCount(this.str(c, "count")!) : 1;
    return { occupancy: { who, in: inside, ...(slot ? { slot } : {}), count, ...(this.yes(c, "leave") ? { leave: true } : {}) } };
  }

  private entity(c: Call, bind?: string): Block[] {
    return [{ block: "create_entity", kind: this.str(c, "kind")!, name: this.str(c, "name")!, ...(this.visible(c) ? { visible_to: this.visible(c) } : {}), ...(bind ? { ref: bind } : {}) }];
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
    const every = c.fn === "money" ? this.seconds(c, "every") : undefined;
    const outcome =
      c.fn === "money" ? this.moneyOutcome(c, this.id(c, "from"), true)
      : c.fn === "occupancy" ? this.occupancyOutcome(c)
      : c.fn === "structure" ? { structure: this.id(c, "remove") ? { remove: this.id(c, "remove") } : { type: this.id(c, "type"), on: this.id(c, "on") } }
      : c.fn === "account" ? { account: { holder: this.id(c, "holder") ?? who, ...(this.id(c, "close") ? { close: this.id(c, "close") } : {}) } }
      : undefined;
    if (!outcome) throw new Ask(`A commitment can be money, a building, occupancy or an account, not ${c.fn}.`);
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
        terms: { ...(this.str(c, "template") ? { template: this.str(c, "template") } : {}), parties: [me, other], commitments, ...(term ? { term } : {}), ...(termination.length ? { termination } : {}), ...(text ? { text } : {}) },
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
    return [{ block: "publish", kind, text, ...(to ? { addressed_to: to } : {}), ...(data !== undefined ? { data } : {}), ...(adico !== undefined ? { adico } : {}), ...(formal ? { formal: { language: "cel", condition: formal } } : {}), ...common }];
  }

  private form(c: Call, bind?: string): Block[] {
    const to = this.need(c, "to", "Which office's form?");
    const name = this.need(c, "form", "Which form?");
    const f = this.k.form(to, name);
    if (!f) throw new Ask(LABEL_TEXT.unknown_form);
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
