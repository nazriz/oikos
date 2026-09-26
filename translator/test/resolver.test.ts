// The call language, the resolver and the preview, on the design note's
// worked examples (docs/design/translator-and-resolver.md §4).

import { expect, test } from "bun:test";
import { calls } from "@terrarium/seats";
import { Knowledge } from "../src/knowledge";
import { Preview } from "../src/preview";
import { resolve } from "../src/resolver";

/** The town, as its mayor's seat knows it. */
function town(): Knowledge {
  const k = new Knowledge();
  const rec = (r: any) => ({ author: "genesis", at: 0, visible_to: "public", ...r });
  k.absorb({
    seat: "mayor", t: 86_400 * 30, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [],
    channels: {
      treasury: { kind: "accounts", transactions: [], accounts: [{ account: "acc-city", holder: "city", custodian: "bank", balance: 10_000_000 }] },
      who: { kind: "directory", entities: [{ entity: "city", kind: "town", name: "Millbrook" }, { entity: "bank", kind: "bank", name: "Millbrook Bank" }, { entity: "builder", kind: "firm", name: "Millbrook Builders" }, { entity: "greenco", kind: "firm", name: "GreenCo" }],
        seats: [{ seat: "planning", entity: "city", role: "planning_officer", status: "active" }] },
      town: { kind: "sites", as_of: 0, parcels: [{ parcel: "p1", x: 0, y: 0, w: 1, h: 1, structure: { structure: "str.3", type: "apartments", complete: true, occupancy: [] } }] },
      mine: { kind: "records", records: [
        rec({ id: "inv.1", record: "statement", author: "builder-foreman", speaks_for: "builder", kind: "invoice", text: "Invoice", data: { outcome: { money: { to: "acc-builder", amount: 50000 } } }, addressed_to: ["city"] }),
        rec({ id: "form-permit", record: "statement", author: "planning", speaks_for: "city", kind: "form", text: "Permit application.",
          data: { form: "permit_application", submit_as: "permit_application", submit_to: ["city"], fields: { parcel: { type: "parcel", required: true }, structure_type: { type: "structure_type", required: true }, notes: { type: "text" } } } }),
      ] },
    },
  } as any);
  return k;
}
const run = (src: string, k = town()) => resolve(calls.parseProgram(src), k, (t) => (t === "apartments" ? { dwelling: 12 } : { dwelling: 1 }));

test("the call language parses, and prints back canonically", () => {
  const p = calls.parseProgram('money(to=builder, amount="$500", for="the \\"fence\\"")\nt = entity(kind=trust, name="River Land Trust")\nstatement(kind=charter, for=t, text="…", data={"b":1,"a":[2]})');
  expect(calls.programText(p)).toBe('money(amount="$500", for="the \\"fence\\"", to=builder)\nt = entity(kind=trust, name="River Land Trust")\nstatement(data={"a":[2],"b":1}, for=t, kind=charter, text="…")');
  expect(calls.parseProgram(calls.programText(p))).toEqual(p);
  expect(calls.parseProgram("none(not_yours)")).toEqual({ none: "not_yours" });
  expect(() => calls.parseProgram("pay(to=builder)")).toThrow();
  expect(() => calls.parseProgram("money(to=builder, to=x)")).toThrow();
  expect(() => calls.parseProgram('statement(kind=x, text="y", data={"n":1.5})')).toThrow();
});

test("amounts and durations convert by table, with no arithmetic beyond the digits written", () => {
  expect(["$500", "$1,234.56", "60k", "$1.5k", "$2m", "500 dollars", "250 cents", "$0.05"].map(calls.parseAmount)).toEqual([50000, 123456, 6000000, 150000, 200000000, 50000, 250, 5]);
  for (const bad of ["10%", "half", "$1,23", "$1.234", "1.5 cents", "about $500"]) expect(() => calls.parseAmount(bad)).toThrow();
  expect(["monthly", "every 3 months", "2 weeks", "a year", "fortnightly", "30 days"].map(calls.parseDuration)).toEqual([2592000, 7776000, 1209600, 31536000, 1209600, 2592000]);
  for (const bad of ["next Friday", "soon", "1.5 days"]) expect(() => calls.parseDuration(bad)).toThrow();
});

test("4.1: paying someone asks the bank that keeps the account", () => {
  const r = run('money(to=builder, amount="$500", for="the fence")');
  if (!r.ok) throw new Error(r.questions.join(" "));
  expect(r.blocks).toEqual([{ block: "publish", kind: "request", speaks_for: "city", addressed_to: ["bank"], visible_to: ["city", "bank"],
    text: "Please pay $500.00 from acc-city to acc-builder, for the fence.", data: { outcome: { money: { from: "acc-city", to: "acc-builder", amount: 50000, for: "the fence" } } } }]);
  expect(new Preview(town()).of(r.blocks)).toBe("You will ask Millbrook Bank (bank) to pay $500.00 from your account (acc-city) to acc-builder, for the fence.");
});

test("4.2: a repeating payment is a standing request", () => {
  const r = run('money(to=acc-landlord-1, amount="$850", every="month", for="rent")');
  if (!r.ok) throw new Error(r.questions.join(" "));
  expect(r.blocks[0]!.data).toEqual({ outcome: { money: { from: "acc-city", to: "acc-landlord-1", amount: 85000, for: "rent" } }, every: 2592000 });
});

test("4.3: with the inputs supplied, an offered agreement to whoever builds, citing the permit", () => {
  const r = run('structure(type=park, on=p00-00, by=greenco, price="$60,000", from=acc-city, basis=rec.412)');
  if (!r.ok) throw new Error(r.questions.join(" "));
  expect(r.blocks).toEqual([
    { block: "propose_agreement", speaks_for: "city", ref: "offer1", basis: "rec.412", terms: { template: "construction", parties: ["city", "greenco"],
      commitments: [{ who: "greenco", does: { outcome: { structure: { type: "park", on: "p00-00" } } } }, { who: "city", does: { outcome: { money: { from: "acc-city", to: "greenco", amount: 6000000 } } } }],
      text: "GreenCo (greenco) will build a park on p00-00; Millbrook (city) pays $60,000.00 from acc-city." } },
    { block: "sign_agreement", agreement: "$offer1", as: "city" },
  ]);
  expect(new Preview(town()).of(r.blocks)).toContain("You will offer GreenCo (greenco) a construction agreement: GreenCo (greenco) will build a park on lot p00-00; you will pay $60,000.00 from your account (acc-city) to GreenCo (greenco)");
  expect(new Preview(town()).of(r.blocks)).toContain("It cites rec.412, and sign it on your side.");
});

test("4.4: filling in a published form, checked against its fields", () => {
  const r = run("form(to=planning, form=permit_application, parcel=p00-00, structure_type=park)");
  if (!r.ok) throw new Error(r.questions.join(" "));
  expect(r.blocks).toEqual([{ block: "publish", kind: "permit_application", speaks_for: "city", addressed_to: ["city"], basis: "form-permit", text: "permit application: parcel p00-00, structure type park.", data: { parcel: "p00-00", structure_type: "park" } }]);
  const missing = run("form(to=planning, form=permit_application, parcel=p00-00)");
  expect(missing).toEqual({ ok: false, questions: ["The permit application needs: structure_type."] });
  expect(run("form(to=planning, form=dog_licence, name=rex)")).toEqual({ ok: false, questions: ["You haven't seen a form by that name."] });
});

test("4.5: a missing decision comes back as a question; the resolver never chooses", () => {
  expect(run("structure(type=park, on=p00-00)")).toEqual({ ok: false, questions: ["Who should build a park on p00-00, and from which account is it paid?"] });
  expect(run('structure(type=park, on=p00-00, by=greenco)')).toEqual({ ok: false, questions: ["For what price should GreenCo (greenco) build a park on p00-00?"] });
  // "We'll build it ourselves" is also the seat's choice, and physics may allow it.
  const self = run("structure(type=park, on=p00-00, by=city)"); // one account, so which pays is a single answer
  expect(self.ok && self.blocks).toEqual([{ block: "construct", parcel: "p00-00", structure_type: "park", materials_from: "acc-city" }]);
  expect(run("none(not_yours)")).toEqual({ ok: false, questions: ["That's for someone else to decide. You could write to them, or propose something."] });
});

test("names the seat knows become ids; ambiguity or ignorance becomes a question, phrased from the seat's side", () => {
  // The builder stated its account on its invoice, so paying "Millbrook Builders" goes there.
  const r = run('money(to="Millbrook Builders", amount="$10")');
  expect(r.ok && r.blocks[0]!.data.outcome.money.to).toBe("acc-builder");
  // GreenCo's account has never been seen: a question, not a guess (and not a payment that silently fails).
  expect(run('money(to="GreenCo", amount="$10")')).toEqual({ ok: false, questions: ["Which of GreenCo (greenco)'s accounts should it go to? You don't know one."] });
  expect(run('money(to="Nobody Inc", amount="$10")')).toEqual({ ok: false, questions: ['You don\'t know of anyone or anything called "Nobody Inc" (for to).'] });
});

test("a lease: nested commitments become outcomes, notice periods and term are durations", () => {
  const r = run('agreement(with=c0042, template=lease, term="12 months", our_notice="60 days", their_notice="30 days", we_do=occupancy(who=c0042, in=str.3, slot=dwelling), they_do=money(to=acc-city, amount="$850", every="monthly", for="rent"))');
  if (!r.ok) throw new Error(r.questions.join(" "));
  expect(r.blocks[0]!.terms).toEqual({ template: "lease", parties: ["city", "c0042"], term: 31104000,
    commitments: [{ who: "city", does: { outcome: { occupancy: { who: "c0042", in: "str.3", slot: "dwelling", count: 1 } } } }, { who: "c0042", does: { outcome: { money: { to: "acc-city", amount: 85000, for: "rent" } } }, every: 2592000 }],
    termination: [{ party: "city", notice: 5184000 }, { party: "c0042", notice: 2592000 }] });
});

test("occupancy fills the only kind of space a building has, and asks otherwise", () => {
  const r = run("occupancy(in=str.3)");
  expect(r.ok && r.blocks).toEqual([{ block: "occupy", structure: "str.3", slot: "dwelling", count: 1 }]);
});

test("every block kind is reachable from some call", () => {
  const k = town();
  k.accounts.set("acc-own", { account: "acc-own", holder: "city", custodian: "city" });
  const programs = [
    'money(to=acc-builder, amount="$1", from=acc-own)', "account(holder=builder, at=city)", "account(close=acc-own)",
    "structure(type=park, on=p2, by=city, from=acc-own)", "structure(remove=str.9, by=city, from=acc-own)", "occupancy(in=str.3)", "occupancy(in=str.3, who=c1, leave=yes)",
    'entity(kind=trust, name="T")', 'claim(position=right, holder=city, against=builder, about={"kind":"debt","amount":100})', "claim(transfer=rec.1, to=builder)", "claim(release=rec.1)",
    "agreement(with=builder)", "agreement(sign=rec.5)", "agreement(notice=rec.5)", 'statement(kind=notice, text="x")', "statement(withdraw=rec.2)",
    "vote(ballot=rec.3, choice=yes)", 'message(to=builder, text="hi")',
  ];
  const kinds = new Set<string>();
  for (const p of programs) {
    const r = resolve(calls.parseProgram(p), k, () => ({ dwelling: 1 }));
    if (!r.ok) throw new Error(`${p}: ${r.questions}`);
    for (const b of r.blocks) kinds.add(b.block);
  }
  expect([...kinds].sort()).toEqual(["close_account", "construct", "create_entity", "demolish", "give_notice", "message", "occupy", "open_account", "propose_agreement", "publish", "record_claim", "release_claim", "sign_agreement", "transfer", "transfer_claim", "vacate", "vote", "withdraw"]);
});
