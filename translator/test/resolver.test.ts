// The call language, the resolver and the preview, on the design note's
// worked examples (docs/design/translator-and-resolver.md §4).

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calls, formatMoney, type Currency } from "@oikos/participants";
import BLOCKS from "../../contracts/blocks.schema.json";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { Knowledge } from "../src/knowledge";
import { Preview } from "../src/preview";
import { asLabel, resolve, type StructureTypeInfo } from "../src/resolver";

/** The town's money: its profile's (the platform has none of its own). */
const TOWN_MONEY: Currency = PROFILE.values.currency;
const parseAmount = (s: string) => calls.parseAmount(s, TOWN_MONEY);

const dwellings = (n: number) => Array.from({ length: n }, (_, i) => ({ space: `str.3/dwelling.${i}`, kind: "dwelling", capacity: 6, attrs: { bedrooms: 2 }, count: 0 }));
const building = (structure: string, type: string, at: string, spaces: any[]) => ({ structure, type, at, w: 1, h: 1, complete: true, spaces });

/** The town, as its mayor knows it (a code participant's slice, acting as mayor for the city). */
function town(): Knowledge {
  const k = new Knowledge(TOWN_MONEY);
  const rec = (r: any) => ({ author: "genesis", at: 0, visible_to: "public", ...r });
  k.absorb({
    participant: "mayor-system", as: "mayor", t: 86_400 * 30, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [],
    channels: {
      treasury: { kind: "accounts", transactions: [], accounts: [{ account: "acc-city", holder: "city", custodian: "bank", balance: 10_000_000 }] },
      who: { kind: "directory", entities: [{ entity: "city", kind: "town", name: "Millbrook" }, { entity: "bank", kind: "bank", name: "Millbrook Bank" }, { entity: "builder", kind: "firm", name: "Millbrook Builders" }, { entity: "greenco", kind: "firm", name: "GreenCo" }, { entity: "c0042", kind: "person", name: "Dana Reyes", participant: "c0042-self" }],
        positions: [{ position: "planning", entity: "city", role: "planning_officer", holder: "planning-system" }, { position: "mayor", entity: "city", role: "mayor", holder: "mayor-system" }] },
      town: { kind: "sites", as_of: 0, cells: [
        { cell: "cell.0.0", x: 0, y: 0, structure: building("str.3", "apartments", "cell.0.0", dwellings(12)) },
        { cell: "cell.1.0", x: 1, y: 0 },
        { cell: "cell.2.0", x: 2, y: 0 },
        { cell: "cell.3.0", x: 3, y: 0, terrain: "water" },
        { cell: "cell.0.1", x: 0, y: 1, structure: building("str.4", "shop", "cell.0.1", [{ space: "str.4/floor.0", kind: "floor", capacity: 20, count: 3 }]) },
      ] },
      mine: { kind: "records", records: [
        rec({ id: "inv.1", record: "statement", author: "builder-foreman", speaks_for: "builder", kind: "invoice", text: "Invoice", data: { outcome: { money: { to: "acc-builder", amount: "50000" } } }, addressed_to: ["city"] }),
        rec({ id: "form-permit", record: "statement", author: "planning-system", in_position: "planning", speaks_for: "city", kind: "form", text: "Permit application.",
          data: { form: "permit_application", submit_as: "permit_application", submit_to: ["city"], fields: { lot: { type: "lot", required: true }, structure_type: { type: "structure_type", required: true }, notes: { type: "text" } } } }),
        rec({ id: "lot-00", record: "statement", author: "registry", speaks_for: "city", kind: "lot", text: "Lot 00.", data: { cells: ["cell.1.0"] } }),
        rec({ id: "lot-01", record: "statement", author: "registry", speaks_for: "city", kind: "lot", text: "Lot 01.", data: { cells: ["cell.2.0", "cell.3.0"] } }),
      ] },
    },
  } as any);
  return k;
}
const TYPES: { [t: string]: StructureTypeInfo } = {
  apartments: { footprint: { w: 1, h: 1 }, spaces: [{ kind: "dwelling", count: 12, capacity: 6 }] },
  park: { footprint: { w: 1, h: 1 }, spaces: [] },
  jetty: { footprint: { w: 1, h: 1 }, terrains: ["water"], spaces: [] },
  plaza: { footprint: { w: 2, h: 1 }, spaces: [] },
};
const typeOf = (t: string) => TYPES[t];
const run = (src: string, k = town(), as?: string) => resolve(calls.parseProgram(src), k, typeOf, as);

test("the call language parses, and prints back canonically", () => {
  const p = calls.parseProgram('money(to=builder, amount="$500", for="the \\"fence\\"")\nt = entity(kind=trust, name="River Land Trust")\nstatement(kind=charter, for=t, text="…", data={"b":1,"a":[2]})');
  expect(calls.programText(p)).toBe('money(amount="$500", for="the \\"fence\\"", to=builder)\nt = entity(kind=trust, name="River Land Trust")\nstatement(data={"a":[2],"b":1}, for=t, kind=charter, text="…")');
  expect(calls.parseProgram(calls.programText(p))).toEqual(p);
  expect(calls.parseProgram("none(not_yours)")).toEqual({ none: "not_yours" });
  expect(() => calls.parseProgram("pay(to=builder)")).toThrow();
  expect(() => calls.parseProgram("money(to=builder, to=x)")).toThrow();
  expect(() => calls.parseProgram('statement(kind=x, text="y", data={"n":1.5})')).toThrow();
});

test("money is read and written in the world's own currency: no smaller unit, three decimals, or only a code", () => {
  // (The same cases as the kernel's resolver: kernel/crates/resolver/src/calls.rs.)
  const said = (cur: Currency, s: string) => { try { return calls.parseAmount(s, cur); } catch (e) { return `refused: ${(e as Error).message}`; } };
  const yen: Currency = { code: "JPY", minor_units: 0, symbol: "¥", unit_words: ["yen"] };
  expect(["500", "¥500", "¥1,234,567", "1.5k yen", "¥2m", "JPY 500", "500 jpy"].map((s) => said(yen, s))).toEqual(["500", "500", "1234567", "1500", "2000000", "500", "500"]);
  expect(said(yen, "¥500.5")).toBe("refused: this money has no decimals: ¥500.5");
  expect(said(yen, "¥500.00")).toBe("refused: this money has no decimals: ¥500.00");
  for (const other of ["$500", "500 dollars", "500 cents"]) expect(said(yen, other)).toBe(`refused: not an amount: ${other}`);
  expect(["500", "1234567", "0", "-50000"].map((n) => formatMoney(n, yen))).toEqual(["¥500", "¥1,234,567", "¥0", "-¥50,000"]);

  const dinar: Currency = { code: "KWD", minor_units: 3, symbol: "KD", unit_words: ["dinar", "dinars"], minor_words: ["fils"] };
  expect(["500", "KD 1.234", "kd1,000.5", "2 dinars", "250 fils", "1.5k"].map((s) => said(dinar, s))).toEqual(["500000", "1234", "1000500", "2000", "250", "1500000"]);
  expect(said(dinar, "1.2345")).toBe("refused: not an amount: 1.2345");
  for (const bad of ["1.5 fils", "2k fils"]) expect(said(dinar, bad)).toBe(`refused: not an amount: ${bad}`);
  expect(["1234", "5", "1234567890"].map((n) => formatMoney(n, dinar))).toEqual(["KD1.234", "KD0.005", "KD1,234,567.890"]);

  const coded: Currency = { code: "XYZ", minor_units: 2 };
  expect(["XYZ 500", "xyz500", "500 XYZ", "500", "XYZ 1,234.56", "3m xyz"].map((s) => said(coded, s))).toEqual(["50000", "50000", "50000", "50000", "123456", "300000000"]);
  for (const other of ["$500", "500 dollars"]) expect(said(coded, other)).toBe(`refused: not an amount: ${other}`);
  expect(["50000", "-123456"].map((n) => formatMoney(n, coded))).toEqual(["XYZ 500.00", "-XYZ 1,234.56"]);
  for (const n of ["0", "5", "50000", "123456789"]) expect(said(coded, formatMoney(n, coded))).toBe(n);
  const fine: Currency = { code: "FIN", minor_units: 8 };
  expect([said(fine, "FIN 0.00000001"), said(fine, "1.5"), formatMoney("150000001", fine)]).toEqual(["1", "150000000", "FIN 1.50000001"]);

  // The town's own, to the limits: 38 digits at most, and its words in the refusals.
  // (The town says its decimal mark, so a point once is the decimals; a currency that says nothing of it is told "two ways".)
  expect(said(TOWN_MONEY, "$1.234")).toBe("refused: more than two decimals: $1.234");
  const unsaid: Currency = { ...TOWN_MONEY, decimal_mark: undefined, group_mark: undefined };
  expect(said(unsaid, "$1.234")).toBe("refused: a point with three digits after it can be read two ways: $1.234");
  expect(said(TOWN_MONEY, "aud 500")).toBe("50000");
  expect(said(TOWN_MONEY, `$${"9".repeat(36)}`)).toBe(`${"9".repeat(36)}00`);
  expect(said(TOWN_MONEY, `$${"9".repeat(37)}`)).toBe(`refused: too large: $${"9".repeat(37)}`);
  expect(["123456", "5", "100000000", "-5"].map((n) => formatMoney(n, TOWN_MONEY))).toEqual(["$1,234.56", "$0.05", "$1,000,000.00", "-$0.05"]);
});

test("amounts and durations convert by table, with no arithmetic beyond the digits written", () => {
  expect(["$500", "$1,234.56", "60k", "$1.5k", "$2m", "500 dollars", "250 cents", "$0.05"].map(parseAmount)).toEqual(["50000", "123456", "6000000", "150000", "200000000", "50000", "250", "5"]);
  // Exact beyond JSON's 2^53 (D58): a world's sums can be that large.
  expect(parseAmount("$120 trillion")).toBe("12000000000000000");
  expect(parseAmount("$90,071,992,547,409.93")).toBe("9007199254740993");
  for (const bad of ["10%", "half", "$1,2345", "$1.234", "1.5 cents", "about $500"]) expect(() => parseAmount(bad)).toThrow();
  expect(["monthly", "every 3 months", "2 weeks", "a year", "fortnightly", "30 days"].map(calls.parseDuration)).toEqual([2592000, 7776000, 1209600, 31536000, 1209600, 2592000]);
  for (const bad of ["next Friday", "soon", "1.5 days"]) expect(() => calls.parseDuration(bad)).toThrow();
});

test("4.1: paying someone asks the bank that keeps the account", () => {
  const r = run('money(to=builder, amount="$500", for="the fence")');
  if (!r.ok) throw new Error(r.questions.join(" "));
  expect(r.blocks).toEqual([{ block: "publish", kind: "request", speaks_for: "city", addressed_to: ["bank"], visible_to: ["city", "bank"],
    text: "Please pay $500.00 from acc-city to acc-builder, for the fence.", data: { outcome: { money: { from: "acc-city", to: "acc-builder", amount: "50000", for: "the fence" } } } }]);
  expect(new Preview(town()).of(r.blocks)).toBe('This does one thing: a payment.\n1. You will ask Millbrook Bank (bank) to pay $500.00 from your account (acc-city) to acc-builder, once.\n   - For, in words only: "the fence"');
});

test("4.2: a repeating payment is a standing request", () => {
  const r = run('money(to=acc-landlord-1, amount="$850", every="month", for="rent")');
  if (!r.ok) throw new Error(r.questions.join(" "));
  expect(r.blocks[0]!.data).toEqual({ outcome: { money: { from: "acc-city", to: "acc-landlord-1", amount: "85000", for: "rent" } }, every: 2592000 });
});

test("4.3: with the inputs supplied, an offered agreement to whoever builds, citing the permit", () => {
  const r = run('structure(type=park, on=lot-00, by=greenco, price="$60,000", from=acc-city, basis=rec.412)');
  if (!r.ok) throw new Error(r.questions.join(" "));
  expect(r.blocks).toEqual([
    { block: "propose_agreement", speaks_for: "city", ref: "offer1", basis: "rec.412", terms: { template: "construction", parties: ["city", "greenco"],
      commitments: [{ who: "greenco", does: { outcome: { structure: { type: "park", on: "lot-00" } } } }, { who: "city", does: { outcome: { money: { from: "acc-city", to: "greenco", amount: "6000000" } } } }],
      text: "GreenCo (greenco) will build a park on lot-00; Millbrook (city) pays $60,000.00 from acc-city." } },
    { block: "sign_agreement", agreement: "$offer1", as: "city" },
  ]);
  expect(new Preview(town()).of(r.blocks)).toContain("You will offer GreenCo (greenco) a construction agreement, and sign it on your side.\n   - You would be bound to: pay $60,000.00 from your account (acc-city) to GreenCo (greenco).\n   - GreenCo (greenco) would be bound to: build a park on lot-00.");
  expect(new Preview(town()).of(r.blocks)).toContain("   - Cites: rec.412.");
});

test("4.4: filling in a published form, checked against its fields", () => {
  const r = run("form(to=planning, form=permit_application, lot=lot-00, structure_type=park)");
  if (!r.ok) throw new Error(r.questions.join(" "));
  expect(r.blocks).toEqual([{ block: "publish", kind: "permit_application", speaks_for: "city", addressed_to: ["city"], basis: "form-permit", text: "permit application: lot lot-00, structure type park.", data: { lot: "lot-00", structure_type: "park" } }]);
  const missing = run("form(to=planning, form=permit_application, lot=lot-00)");
  expect(missing).toEqual({ ok: false, questions: ["The permit application needs: structure_type."] });
  expect(run("form(to=planning, form=dog_licence, name=rex)")).toEqual({ ok: false, questions: ["You haven't seen a form by that name."] });
  // A kind of building, quoted or not, is the same kind.
  expect(run('form(to=planning, form=permit_application, lot=lot-00, structure_type="park")')).toEqual(run("form(to=planning, form=permit_application, lot=lot-00, structure_type=park)"));
  // A form named by its record's id is the same form.
  expect(run("form(to=planning, form=form-permit, lot=lot-00, structure_type=park)").ok).toBe(true);
  // A known form sent to the wrong office: where it goes, not "unknown".
  expect(run("form(to=council, form=permit_application, lot=lot-00, structure_type=park)")).toEqual({ ok: false, questions: ["The permit application form isn't one council takes: it goes to planning."] });
});

test("4.5: a missing decision comes back as a question; the resolver never chooses", () => {
  expect(run("structure(type=park, on=lot-00)")).toEqual({ ok: false, questions: ["Who should build a park on lot-00?"] });
  expect(run('structure(type=park, on=lot-00, by=greenco)')).toEqual({ ok: false, questions: ["For what price should GreenCo (greenco) build a park on lot-00?"] });
  // "We'll build it ourselves" is also the participant's choice, and physics may allow it.
  const self = run("structure(type=park, on=lot-00, by=city)"); // one account, so which pays is a single answer; one cell, so where too
  expect(self.ok && self.blocks).toEqual([{ block: "construct", at: "cell.1.0", structure_type: "park" }]);
  expect(run("none(not_yours)")).toEqual({ ok: false, questions: ["That's for someone else to decide. You could write to them, or propose something."] });
});

test("names the participant knows become ids; ambiguity or ignorance becomes a question, phrased from its side", () => {
  // The builder stated its account on its invoice, so paying "Millbrook Builders" goes there.
  const r = run('money(to="Millbrook Builders", amount="$10")');
  expect(r.ok && r.blocks[0]!.data.outcome.money.to).toBe("acc-builder");
  // GreenCo's account has never been seen: a question, not a guess (and not a payment that silently fails).
  expect(run('money(to="GreenCo", amount="$10")')).toEqual({ ok: false, questions: ["Which of GreenCo (greenco)'s accounts should it go to? You don't know one."] });
  expect(run('money(to="Nobody Inc", amount="$10")')).toEqual({ ok: false, questions: ['You don\'t know of anyone or anything called "Nobody Inc" (for to).'] });
});

test("a lease: nested commitments become outcomes, notice periods and term are durations", () => {
  const r = run('agreement(with=c0042, template=lease, term="12 months", our_notice="60 days", their_notice="30 days", we_do=occupancy(who=c0042, in=str.3/dwelling.2), they_do=money(to=acc-city, amount="$850", every="monthly", for="rent"))');
  if (!r.ok) throw new Error(r.questions.join(" "));
  expect(r.blocks[0]!.terms).toEqual({ template: "lease", parties: ["city", "c0042"], term: 31104000,
    commitments: [{ who: "city", does: { outcome: { occupancy: { who: "c0042", in: "str.3/dwelling.2" } } } }, { who: "c0042", does: { outcome: { money: { to: "acc-city", amount: "85000", for: "rent" } } }, every: 2592000 }],
    termination: [{ party: "city", notice: 5184000 }, { party: "c0042", notice: 2592000 }] });
});

test("occupancy fills the only space a building has, and asks otherwise", () => {
  expect(run("occupancy(in=str.4)")).toEqual({ ok: true, blocks: [{ block: "occupy", space: "str.4/floor.0" }] });
  expect(run("occupancy(in=str.3/dwelling.5)")).toEqual({ ok: true, blocks: [{ block: "occupy", space: "str.3/dwelling.5" }] });
  const ask = run("occupancy(in=str.3)");
  expect(ask.ok).toBe(false);
  expect(!ask.ok && ask.questions[0]).toStartWith("Which space in str.3: str.3/dwelling.0, str.3/dwelling.1,");
  // Bringing someone, and removing them: a participant named is its person.
  expect(run("occupancy(in=str.3/dwelling.5, who=c0042-self)")).toEqual({ ok: true, blocks: [{ block: "occupy", space: "str.3/dwelling.5", who: "c0042" }] });
  expect(run("occupancy(in=str.3, who=c0042, leave=yes)")).toEqual({ ok: true, blocks: [{ block: "vacate", occupant: "c0042", from: "str.3" }] });
});

test("building on a lot: the one corner that fits is filled in; a choice or a misfit is a question", () => {
  const b = (type: string, on: string) => run(`structure(type=${type}, on=${on}, by=city)`);
  expect(b("park", "lot-00")).toEqual({ ok: true, blocks: [{ block: "construct", at: "cell.1.0", structure_type: "park" }] });
  // lot-01 is one dry cell and one of water: a park fits only on the dry one, a jetty only on the water.
  expect(b("park", "lot-01").ok && (b("park", "lot-01") as any).blocks[0].at).toBe("cell.2.0");
  expect(b("jetty", "lot-01").ok && (b("jetty", "lot-01") as any).blocks[0].at).toBe("cell.3.0");
  // A plaza is two cells wide: it would need the water cell too.
  expect(b("plaza", "lot-01")).toEqual({ ok: false, questions: ["A plaza (2 by 1) doesn't fit on the open ground of lot-01 as far as you've seen. Which cell should its corner be?"] });
  // A cell stated outright is taken as the corner: physics decides.
  expect(b("plaza", "cell.1.0")).toEqual({ ok: true, blocks: [{ block: "construct", at: "cell.1.0", structure_type: "plaza" }] });
});

test("a language-model participant sees all its capacities: the one it acts in decides whose name it's in", () => {
  const k = new Knowledge(TOWN_MONEY);
  k.absorb({
    participant: "ada", t: 0, status: "active", entity: "ada-p", outcomes: [], inbox: [], drafts: [],
    positions: [{ position: "mayor", entity: "city", title: "Mayor" }],
    channels: {
      wallet: { kind: "accounts", transactions: [], accounts: [{ account: "acc-ada", holder: "ada-p", custodian: "bank", balance: 100 }] },
      "mayor/treasury": { kind: "accounts", transactions: [], accounts: [{ account: "acc-city", holder: "city", custodian: "bank", balance: 10_000_000 }] },
    },
  } as any);
  const own = resolve(calls.parseProgram('statement(kind=notice, text="Hello")'), k, typeOf);
  expect(own.ok && own.blocks[0]!.speaks_for).toBe("ada-p");
  const asMayor = resolve(calls.parseProgram('money(to=acc-x, amount="$5")'), k, typeOf, "mayor");
  expect(asMayor.ok && asMayor.blocks[0]!.data.outcome.money.from).toBe("acc-city");
  expect(asMayor.ok && new Preview(k, k.actingFor("mayor")).of(asMayor.blocks)).toContain("from your account (acc-city)");
});

test("a statement can be put up on a lot, and the preview says where: on the lot's cell, which is what the contract takes", () => {
  const k = town();
  const r = run('statement(kind=notice, text="Park works start Monday.", on=lot-00)', k);
  expect(r.ok && r.blocks).toEqual([{ block: "publish", kind: "notice", text: "Park works start Monday.", place: "cell.1.0", speaks_for: "city" }]);
  expect(r.ok && new Preview(k).of(r.blocks)).toContain('You will put up a notice on cell.1.0: "Park works start Monday."');
});

test("every block kind is reachable from some call", () => {
  const k = town();
  k.accounts.set("acc-own", { account: "acc-own", holder: "city", custodian: "city" });
  const programs = [
    'money(to=acc-builder, amount="$1", from=acc-own)', "account(holder=builder, at=city)", "account(close=acc-own)",
    "structure(type=park, on=lot-00, by=city, from=acc-own)", "structure(remove=str.9, by=city, from=acc-own)", "occupancy(in=str.4)", "occupancy(in=str.3, who=c1, leave=yes)",
    'entity(kind=trust, name="T", position="Trustee")', 'presence(name="Ana", age="31 years", template=newcomer, carrying="$2,400")', "presence(leave=yes)",
    'birth(name="Kim", template=child, with=c0042)', "harm(who=c0042)", 'position(title="Clerk", role=clerk)', "position(appoint=planning, to=c0042)", "position(vacate=planning)",
    'system(template=payroll, title="Payroll")', "system(retire=par.9)", 'claim(position=right, holder=city, against=builder, about={"kind":"debt","amount":100})', "claim(transfer=rec.1, to=builder)", "claim(release=rec.1)",
    "agreement(with=builder, we_do=account(holder=builder))", "agreement(sign=rec.5)", "agreement(notice=rec.5)", 'statement(kind=notice, text="x")', "statement(withdraw=rec.2)",
    "vote(ballot=rec.3, choice=yes)", 'message(to=builder, text="hi")',
  ];
  const kinds = new Set<string>();
  for (const p of programs) {
    const r = resolve(calls.parseProgram(p), k, typeOf);
    if (!r.ok) throw new Error(`${p}: ${r.questions}`);
    for (const b of r.blocks) kinds.add(b.block);
  }
  // Every block the kernel has, from contracts/blocks.schema.json.
  const all = (BLOCKS.$defs.BlockName.enum as string[]).slice().sort();
  expect([...kinds].sort()).toEqual(all);
});

test("a bare word with a capital letter is a name (ids are lowercase), and '12-month' is a duration", () => {
  const r = run('message(to=GreenCo, text="Hi.")');
  expect(r.ok && r.blocks[0]!.to).toEqual(["greenco"]);
  expect(run("message(to=Nobody, text=\"Hi.\")")).toEqual({ ok: false, questions: ['You don\'t know of anyone or anything called "Nobody" (for to).'] });
  expect(calls.parseDuration("12-month")).toBe(calls.parseDuration("12 months"));
  expect(calls.parseDuration("two-week")).toBe(calls.parseDuration("2 weeks"));
});

test("goods and work (phase B): your own goods move from where you hold them; work by the people named; committed goods are an outcome", () => {
  const k = town();
  k.absorb({ participant: "mayor-system", as: "mayor", t: 0, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], channels: {
    stores: { kind: "holdings", holdings: [{ kind: "goods", at: "str.1", quantity: "40" }, { kind: "materials", at: "str.1", quantity: "500" }, { kind: "materials", at: "str.2", quantity: "90" }] } } } as any);
  const r = (text: string) => resolve(calls.parseProgram(text), k, () => undefined, "mayor");
  // The one place it holds goods is filled in; a choice of places is a question.
  expect(r("goods(kind=goods, quantity=12, to=c0042, at=str.9)")).toEqual({ ok: true, blocks: [{ block: "move_goods", kind: "goods", quantity: "12", from_at: "str.1", to: "c0042", to_at: "str.9" }] });
  expect(r("goods(kind=materials, quantity=10, at=str.2)")).toEqual({ ok: false, questions: ["From where: str.1 or str.2?"] });
  expect(r("goods(kind=bread, quantity=1, at=str.1)")).toEqual({ ok: false, questions: ["You don't hold any bread that you know of."] });
  expect(r("goods(kind=goods, quantity=5)")).toEqual({ ok: false, questions: ["Where to? Somewhere you keep things."] });
  // Work: the people named, at the place; with nobody named, work that takes no one's time.
  expect(r('work(task=make, units=48, at=str.1, by=["c0012", "c0040"])')).toEqual({ ok: true, blocks: [{ block: "work", task: "make", units: 48, at: "str.1", performers: ["c0012", "c0040"] }] });
  expect(r('work(task=build, units="7200", at=str.1, by=c0012, on=str.5)')).toEqual({ ok: true, blocks: [{ block: "work", task: "build", units: 7200, at: "str.1", performers: ["c0012"], on: "str.5" }] });
  // Committed goods: an outcome in an agreement (a supplier delivers, every 30 days).
  const a = r('agreement(with=builder, they_do=goods(kind=materials, quantity=2000, to=city, at=str.1, every="30 days"), we_do=money(amount="$900", to=acc-builder))');
  expect(a.ok && (a.blocks[0] as any).terms.commitments[1]).toEqual({ who: "builder", does: { outcome: { goods: { kind: "materials", quantity: "2000", to: "city", at: "str.1" } } }, every: 2592000 });
});

test("an id written in quotes is that id (a letter to \"planning\", the post)", () => {
  const { fixture } = require("../eval/run");
  const { calls } = require("@oikos/participants");
  const quoted = resolve(calls.parseProgram('message(to="planning", text="Hello.")'), fixture(), () => undefined, "mayor");
  const bare = resolve(calls.parseProgram('message(to=planning, text="Hello.")'), fixture(), () => undefined, "mayor");
  expect(quoted.ok).toBe(true);
  expect(quoted).toEqual(bare);
  expect(resolve(calls.parseProgram('message(to="nobody at all", text="Hello.")'), fixture(), () => undefined, "mayor").ok).toBe(false);
});

test("a person's name among those the seat has been shown: as written, then without its marks if that finds one person; a collision is a question", () => {
  const k = new Knowledge(TOWN_MONEY);
  k.absorb({ participant: "me-system", t: 0, status: "active", entity: "me", outcomes: [], inbox: [], drafts: [], channels: { who: { kind: "directory",
    entities: [{ entity: "c0001", kind: "person", name: "José Muñoz García" }, { entity: "c0002", kind: "person", name: "Mary Wanjiru" }, { entity: "c0003", kind: "person", name: "Mary Wanjiru" },
      { entity: "c0004", kind: "person", name: "Hanna Müller" }, { entity: "c0005", kind: "person", name: "Hanna Muller" }], positions: [] } } } as any);
  // (The engine's resolver has the same cases: kernel/crates/resolver/src/knowledge.rs.)
  expect(k.byName("José Muñoz García")).toEqual(["c0001"]);
  expect(k.byName("Jose Munoz Garcia")).toEqual(["c0001"]);
  expect(k.byName("jose  munoz garcia")).toEqual(["c0001"]);
  expect(k.byName("Mary Wanjiru")).toEqual(["c0002", "c0003"]);
  expect(k.byName("Hanna Müller")).toEqual(["c0004"]);
  expect(k.byName("Hanna Muller")).toEqual(["c0005"]);
  expect(k.byName("Hanna Mueller")).toEqual([]);
  expect(k.byName("Jose Garcia")).toEqual([]);
});

test("a name as written, then a description: the builder, the bank, a post by its title or role", () => {
  const k = new Knowledge(TOWN_MONEY);
  k.absorb({ participant: "mayor-system", t: 0, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], channels: { who: { kind: "directory",
    entities: [{ entity: "builder", kind: "firm", name: "Millbrook Builders" }, { entity: "bank", kind: "bank", name: "Millbrook Bank" }],
    positions: [{ position: "planning", entity: "city", role: "planning_officer", title: "Planning Officer" }, { position: "works", entity: "city", role: "works_manager" },
      { position: "clerk-a", entity: "city", role: "clerk" }, { position: "clerk-b", entity: "city", role: "clerk" }] } } } as any);
  // (The engine's resolver has the same cases, word for word: kernel/crates/resolver/src/knowledge.rs.)
  expect(k.byName("Millbrook Builders")).toEqual(["builder"]);
  expect(k.byName("works")).toEqual(["works"]);
  expect(k.byName("the builder")).toEqual(["builder"]);
  expect(k.byName("The Bank")).toEqual(["bank"]);
  expect(k.byName("the planning officer")).toEqual(["planning"]);
  expect(k.byName("works manager")).toEqual(["works"]);
  expect(k.byName("the clerk")).toEqual(["clerk-a", "clerk-b"]);
  expect(k.byName("the planning job")).toEqual(["planning"]);
  expect(k.byName("works office")).toEqual(["works"]);
  expect(k.byName("the theatre")).toEqual([]);
  expect(k.byName("thebuilder")).toEqual([]);
  // In a call: a letter to "the builder" goes to the builder; to "the clerk", it's asked which.
  const r = resolve(calls.parseProgram('message(to="the builder", text="When can you start?")'), k, () => undefined, undefined);
  expect(r.ok && r.blocks).toEqual([{ block: "message", to: ["builder"], text: "When can you start?" }]);
  const two = resolve(calls.parseProgram('message(to="the clerk", text="Hello.")'), k, () => undefined, undefined);
  expect(!two.ok && two.questions[0]).toContain("Which one?");
});

test("a form by its name in ordinary words; one nobody has seen is said to be that first; its office filled in when there's one", () => {
  const k = town();
  const run2 = (p: string) => resolve(calls.parseProgram(p), k, () => undefined, "mayor");
  const exact = run2("form(to=planning, form=permit_application, lot=lot-00, structure_type=park)");
  for (const p of ['form(form="permit application", lot=lot-00, structure_type=park)', 'form(form="the permit application form", lot=lot-00, structure_type=park)', "form(form=permit_application, lot=lot-00, structure_type=park)"]) {
    const r = run2(p);
    expect(r.ok && r.blocks).toEqual(exact.ok && exact.blocks);
  }
  for (const p of ['form(form="event permit")', 'form(to=planning, form="event permit form")', "form(form=dog_licence, to=planning)"]) {
    const r = run2(p);
    expect(!r.ok && r.questions).toEqual(["You haven't seen a form by that name."]);
  }
});

test("a label written as ordinary words is that label (a kind, a role, a template), in the acts and so in the log", () => {
  // (The engine's resolver has the same cases: kernel/crates/resolver/src/resolve.rs.)
  for (const [written, label] of [["notice", "notice"], ["permit_application", "permit_application"], ["supplementary evidence statement", "supplementary_evidence_statement"], ["  Rent-Increase  Notice ", "rent_increase_notice"], ["2nd reading", "nd_reading"], ["works_manager", "works_manager"], ["—", ""]] as const) expect(asLabel(written)).toBe(label);
  const r = resolve(calls.parseProgram('statement(kind="supplementary evidence statement", text="Filed.")'), town(), () => undefined, "mayor");
  expect(r.ok && r.blocks[0]).toMatchObject({ block: "publish", kind: "supplementary_evidence_statement" });
  const e = resolve(calls.parseProgram('entity(kind="Land Trust", name="River Land Trust")'), town(), () => undefined, "mayor");
  expect(e.ok && e.blocks[0]).toMatchObject({ block: "create_entity", kind: "land_trust" });
});

test("an act may rest on several records: basis as a list goes through in the order given, on every act that takes one", () => {
  // (The engine's resolver has the same cases: kernel/crates/resolver/src/resolve.rs.)
  const blocks = (src: string) => { const r = run(src, town(), "mayor"); if (!r.ok) throw new Error(r.questions.join(" ")); return r.blocks; };
  // A payment from an account someone else keeps: the request to its keeper cites them all.
  expect(blocks('money(to=acc-greenco, amount="$2,150", from=acc-city, settles=rec.640, basis=["rec.611","rec.627","rec.305"])')[0]).toMatchObject({ block: "publish", kind: "request", basis: ["rec.611", "rec.627", "rec.305"] });
  // A building someone else puts up: the offered agreement does.
  expect(blocks('structure(type=park, on=lot-00, by=greenco, price="$60,000", from=acc-city, basis=["rec.512","rec.498"])')[0]).toMatchObject({ block: "propose_agreement", basis: ["rec.512", "rec.498"] });
  expect(blocks('agreement(with=greenco, terms="Mowing, weekly.", we_do=account(holder=greenco), basis=["rec.9","rec.3"])')[0]).toMatchObject({ block: "propose_agreement", basis: ["rec.9", "rec.3"] });
  expect(blocks('claim(position=liberty, holder=greenco, about={"action":"build","object":"lot-00"}, basis=["law-planning","rec.861"])')).toEqual([
    { block: "record_claim", position: "liberty", holder: "greenco", about: { action: "build", object: "lot-00" }, speaks_for: "city", basis: ["law-planning", "rec.861"] }]);
  expect(blocks('claim(release=rec.70, basis=["rec.71","rec.72"])')[0]).toMatchObject({ block: "release_claim", basis: ["rec.71", "rec.72"] });
  expect(blocks('claim(transfer=rec.70, to=greenco, basis=["rec.71","rec.72"])')[0]).toMatchObject({ block: "transfer_claim", basis: ["rec.71", "rec.72"] });
  expect(blocks('statement(kind=notice, text="The pool closes.", basis=["rec.733","rec.741"])')[0]).toMatchObject({ block: "publish", kind: "notice", basis: ["rec.733", "rec.741"] });
  expect(blocks('statement(withdraw=rec.50, basis=["rec.733","rec.741"])')[0]).toMatchObject({ block: "withdraw", record: "rec.50", basis: ["rec.733", "rec.741"] });
  // One record is written one way: bare, as it always was; a list of one is that record, and one cited twice is cited once.
  const one = blocks('statement(kind=notice, text="The pool closes.", basis=rec.733)');
  expect(one[0]!.basis).toBe("rec.733");
  expect(blocks('statement(kind=notice, text="The pool closes.", basis=["rec.733"])')).toEqual(one);
  expect(blocks('statement(kind=notice, text="The pool closes.", basis=["rec.733","rec.733"])')).toEqual(one);
  expect(blocks('statement(kind=notice, text="The pool closes.", basis=["rec.733","rec.741","rec.733"])')[0]!.basis).toEqual(["rec.733", "rec.741"]);
  // What an earlier line of the program makes can be among them, by the name it was bound to.
  expect(blocks('t = entity(kind=trust, name="River Land Trust")\nstatement(kind=charter, text="Its charter.", basis=["rec.5","t"])')[1]!.basis).toEqual(["rec.5", "$t"]);
  // A name in the list is someone or something the participant knows, or a question; data that names nothing is a question.
  const asks = (src: string) => { const r = run(src, town(), "mayor"); return r.ok ? [] : r.questions; };
  expect(asks('statement(kind=notice, text="x", basis=["rec.733","the parks budget"])')).toEqual(['You don\'t know of anyone or anything called "the parks budget" (for basis).']);
  expect(asks('statement(kind=notice, text="x", basis=[])')).toEqual(["basis should name at least one record."]);
  expect(asks('statement(kind=notice, text="x", basis=[1,2])')).toEqual(["basis should be a record, or a list of records."]);
  expect(asks('statement(kind=notice, text="x", basis={"permit":"rec.1"})')).toEqual(["basis should be a record, or a list of records."]);
  expect(asks(`statement(kind=notice, text="x", basis=${JSON.stringify(Array.from({ length: 65 }, (_, i) => `rec.${i + 1}`))})`)).toEqual(["That cites more records than one act can: 64 at most."]);
  // Every act it comes to is one the contract takes.
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  for (const f of ["common", "blocks", "records", "world-config", "participant-api", "outcomes", "module"]) ajv.addSchema(JSON.parse(readFileSync(join(import.meta.dir, `../../contracts/${f}.schema.json`), "utf8")));
  const valid = ajv.getSchema("urn:oikos:contracts:0.8:blocks#/$defs/Block")!;
  for (const src of ['money(to=acc-greenco, amount="$2,150", from=acc-city, basis=["rec.611","rec.305"])', 'claim(release=rec.70, basis=["rec.71","rec.72"])', 'statement(withdraw=rec.50, basis=["rec.733"])', 'structure(type=park, on=lot-00, by=greenco, price="$60,000", from=acc-city, basis=["rec.512","rec.498"])'])
    for (const b of blocks(src)) expect([src, valid(b), valid.errors]).toEqual([src, true, null]);
  // The preview says each of them.
  const p = new Preview(town());
  expect(p.of(blocks('statement(kind=notice, text="The pool closes.", basis=["rec.733","rec.741"])'))).toContain("Cites: rec.733 and rec.741.");
  expect(p.of(blocks('claim(release=rec.70, basis=["rec.71","rec.72","rec.73"])'))).toContain("Cites: rec.71, rec.72 and rec.73.");
});

test("the payment pilot 10 lost (a finance seat's, citing four dockets and a budget) now resolves, to a request that cites all five", () => {
  // The call as the translator wrote it (runs/pilot-10/town-1000.seed2.jsonl, draft.finance-system.2, t 5216402),
  // which came back "basis should name something, not data" until the dockets were moved into the payment's purpose.
  const call = 'money(amount="$3,187.73", basis=["rec.11904","rec.16123","rec.21887","rec.25703","rec.25150"], for="disposal of waste", from=acc-city, settles=rec.28337, to=acc-outside)';
  const r = run(call, town(), "mayor");
  if (!r.ok) throw new Error(r.questions.join(" "));
  expect(r.blocks).toEqual([{
    block: "publish", kind: "request", speaks_for: "city", addressed_to: ["bank"], visible_to: ["city", "bank"],
    text: "Please pay $3,187.73 from acc-city to acc-outside, for disposal of waste.",
    data: { outcome: { money: { from: "acc-city", to: "acc-outside", amount: "318773", for: "disposal of waste", settles: "rec.28337" } } },
    basis: ["rec.11904", "rec.16123", "rec.21887", "rec.25703", "rec.25150"],
  }]);
  expect(new Preview(town()).of(r.blocks)).toContain("Cites: rec.11904, rec.16123, rec.21887, rec.25703 and rec.25150.");
});

test("an agreement's hours term is a second commitment of the other side: work, task ordinary_hours, the seconds, every week; with none, nothing is added", () => {
  const blocks = (src: string) => { const r = run(src, town(), "mayor"); if (!r.ok) throw new Error(r.questions.join(" ")); return r.blocks; };
  const withHours = blocks('agreement(with=greenco, template=employment, hours="136800 seconds", we_do=money(to=acc-greenco, amount="$2,000", every="14 days", from=acc-city))')[0] as any;
  expect(withHours.terms.commitments.filter((c: any) => c.who === "greenco")).toEqual([{ who: "greenco", does: { outcome: { work: { task: "ordinary_hours", hours: 136_800 } } }, every: 7 * 86_400 }]);
  const without = blocks('agreement(with=greenco, template=employment, we_do=money(to=acc-greenco, amount="$2,000", every="14 days", from=acc-city))')[0] as any;
  expect(without.terms.commitments.length).toBe(1);
});

// Bug hunt 2026-10-17, finding 13: a seat acting as a person takes only itself out of the world; a post of an organisation takes others.
test("presence(leave=yes, who=...) by a person's seat is a question; by a post it is the block", () => {
  const person = new Knowledge(TOWN_MONEY);
  person.absorb({ participant: "c1-self", t: 86_400, status: "active", entity: "c1", outcomes: [], inbox: [], drafts: [], channels: {} } as any);
  const mine = resolve(calls.parseProgram("presence(leave=yes)"), person, typeOf);
  expect(mine.ok && mine.blocks).toEqual([{ block: "leave" }]);
  const other = resolve(calls.parseProgram("presence(who=c2, leave=yes)"), person, typeOf, undefined, { written: true });
  // (A code parent taking its children out with it is not a seat's program.)
  const parent = resolve(calls.parseProgram("presence(who=c2, leave=yes)"), person, typeOf);
  expect(parent.ok && parent.blocks).toEqual([{ block: "leave", person: "c2" }]);
  expect(other.ok).toBe(false);
  expect(!other.ok && other.questions.join(" ")).toContain("only yourself");
  const away = resolve(calls.parseProgram("occupancy(in=str.3, who=c2, leave=yes)"), person, typeOf, undefined, { written: true });
  expect(away.ok).toBe(false);
  expect(!away.ok && away.questions.join(" ")).toContain("only yourself");
  const self = resolve(calls.parseProgram("occupancy(in=str.3, leave=yes)"), person, typeOf, undefined, { written: true });
  expect(self.ok).toBe(true);
  const post = resolve(calls.parseProgram("presence(who=c2, leave=yes)"), town(), typeOf, "mayor", { written: true });
  expect(post.ok && post.blocks).toEqual([{ block: "leave", person: "c2" }]);
});
