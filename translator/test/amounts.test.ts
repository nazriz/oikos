// An amount as written, read in a world's own money (participants/src/calls.ts `parseAmount`): the table both readers
// are held to (contracts/test/amounts.json; the kernel's resolver has the same test), what each world's own writing of
// an amount reads back as, and what is refused because nothing says which of two numbers it is.

//
// Then the same money through everything that makes or carries a translation: the training data's writings of an
// amount (data.ts `amountWritings`, synthetic.ts), the steps a trained model answers in (model/encode.ts, export.ts),
// and the label step that carries a request's world with it (readers.ts).

import { expect, test } from "bun:test";
import { calls, formatMoney, type Currency } from "@oikos/participants";
import TABLE from "../../contracts/test/amounts.json";
import { translatorSystem } from "../src/index";
import { decode, encode } from "../model/encode";
import { pieces, row, stepsOf } from "../model/export";
import { amountWritings, sameProgram, spansIn, surfaceVariant, sampler, type Gold, type WrittenCurrency } from "../train/data";
import { labelled } from "../train/readers";
import { amountForms, CURRENCIES as INVENTED, everyCurrency, synthetic, worldsCurrencies } from "../train/synthetic";

const CURRENCIES = TABLE.currencies as unknown as { [name: string]: Currency };
const read = (s: string, cur: Currency): string | null => {
  try {
    return calls.parseAmount(s, cur);
  } catch (e) {
    if (!(e instanceof calls.UnitError)) throw e;
    return null;
  }
};

test("every amount in the table reads as it says, in its own currency, or is refused", () => {
  const wrong: unknown[] = [];
  for (const [name, text, want] of TABLE.cases as [string, string, string | null][]) {
    const got = read(text, CURRENCIES[name]!);
    if (got !== want) wrong.push({ currency: name, text, got, want });
  }
  // What a refusal says (the participant is told it): the same words from both readers.
  for (const [name, text, want] of TABLE.refusals as [string, string, string][]) {
    let got: string | undefined;
    try { calls.parseAmount(text, CURRENCIES[name]!); } catch (e) { got = (e as Error).message; }
    if (got !== want) wrong.push({ currency: name, text, got, want });
  }
  expect(wrong).toEqual([]);
  // The table has every one of the nine first towns' currencies, and each has both amounts read and amounts refused.
  for (const name of ["aud", "usd", "mxn", "jpy", "eur", "gbp", "brl", "inr", "kes"]) {
    const mine = (TABLE.cases as [string, string, string | null][]).filter(([c]) => c === name);
    expect(mine.some(([, , want]) => want !== null) && mine.some(([, , want]) => want === null)).toBe(true);
  }
});

test("each currency writes an amount as its place does (the table's \"writes\", which the kernel's writer is held to as well)", () => {
  const wrong: unknown[] = [];
  for (const [name, n, want] of (TABLE as unknown as { writes: [string, string, string][] }).writes) {
    const got = formatMoney(n, CURRENCIES[name]!);
    if (got !== want) wrong.push({ currency: name, n, got, want });
  }
  expect(wrong).toEqual([]);
  // Whole units only, for a round figure in a law's words.
  expect(formatMoney(150_000_00, CURRENCIES.inr!, { decimals: false })).toBe("₹1,50,000");
  expect(formatMoney(123_400, CURRENCIES.de!, { decimals: false })).toBe("1.234 €");
});

test("what a world writes an amount as reads back as that amount: every currency, every size", () => {
  for (const cur of Object.values(CURRENCIES)) {
    for (const n of ["0", "1", "5", "99", "100", "1000", "123456", "100000", "1234567", "50000000", "123456789012", "9007199254740993"]) {
      expect([cur.code, n, read(formatMoney(n, cur), cur)]).toEqual([cur.code, n, n]);
    }
  }
});

test("a sign two currencies share is each world's own, and the other's code or words are not read as it", () => {
  const { usd, mxn, aud } = CURRENCIES as { usd: Currency; mxn: Currency; aud: Currency };
  // The same characters, three worlds: each reads its own money.
  for (const cur of [usd, mxn, aud]) expect(read("$1,500.00", cur)).toBe("150000");
  // Said with whose it is: read where it is that world's, refused in the others (never read as the world's own).
  const said: [string, Currency][] = [["US$1,500", usd], ["1,500 USD", usd], ["MX$1,500", mxn], ["1,500 pesos", mxn], ["AU$1,500", aud], ["AUD 1,500", aud]];
  for (const [text, own] of said) for (const cur of [usd, mxn, aud]) expect([text, cur.code, read(text, cur)]).toEqual([text, cur.code, cur === own ? "150000" : null]);
});

test("what could be two numbers is not guessed, and what could only be one is read", () => {
  const { eur, brl, aud, jpy, three } = CURRENCIES as { [k: string]: Currency };
  // A point once with three digits after it: a decimal point with a digit too many, or thousands. Refused wherever the
  // currency has fewer than three decimals; in one with three it is its decimals.
  for (const cur of [eur, brl, aud, jpy]) expect(read(`${cur!.symbol}1.234`, cur!)).toBeNull();
  expect(read("1.234", three!)).toBe("1234");
  // With the other separator beside it, or written twice, only one reading is left.
  for (const cur of [eur, brl, aud]) {
    expect(read("1.234,56", cur!)).toBe("123456");
    expect(read("1,234.56", cur!)).toBe("123456");
    expect(read("1.234.567", cur!)).toBe("123456700");
    expect(read("12,5", cur!)).toBe("1250");
  }
  // A currency with no smaller unit has no decimals, however they are marked.
  for (const text of ["500.5", "500,5", "500.00", "1.234,5"]) expect(read(text, jpy!)).toBeNull();
  // The reason given names nothing but the world's own words.
  expect(() => calls.parseAmount("¥500.5", jpy!)).toThrow("this money has no decimals: ¥500.5");
  expect(() => calls.parseAmount("€1.234", eur!)).toThrow("a point with three digits after it can be read two ways: €1.234");
  expect(() => calls.parseAmount("¥1.234", jpy!)).toThrow("a point with three digits after it can be read two ways: ¥1.234");
  expect(() => calls.parseAmount("0.005 euros", eur!)).toThrow("more than two decimals: 0.005 euros");
  expect(() => calls.parseAmount("1,5,000", aud!)).toThrow("badly grouped digits: 1,5,000");
});

test("no arithmetic but on the digits written: multipliers are exact, and nothing finer than the smallest unit is read", () => {
  const { inr, jpy, gbp } = CURRENCIES as { [k: string]: Currency };
  expect(read("1.25 lakh", inr!)).toBe("12500000");
  expect(read("0.001 crore", inr!)).toBe("1000000");
  expect(read("1.2345 lakh", inr!)).toBeNull(); // (more than three decimals are never read)
  expect(read("0.5k", jpy!)).toBe("500");
  expect(read("0.001k", jpy!)).toBe("1");
  expect(() => calls.parseAmount("0.001k", gbp!)).not.toThrow();
  expect(read("1.005k", gbp!)).toBe("100500");
  expect(() => calls.parseAmount("£1.5 thousand pence", gbp!)).toThrow();
  expect(read(`£${"9".repeat(36)}`, gbp!)).toBe(`${"9".repeat(36)}00`);
  expect(read(`£${"9".repeat(37)}`, gbp!)).toBeNull();
});

// ---------------------------------------------------------------- the translator's instructions

test("the translator's instructions are one text for every world, and say of amounts what the parser reads", () => {
  const s = translatorSystem();
  expect(translatorSystem.length).toBe(0); // (it is told nothing of the world: it copies, and the parser reads)
  expect(s).toContain("  - amounts: whatever the request wrote as one, copied whole: the digits (with their commas, points and decimals, and a multiplier such as k or m, or a word such as thousand or million, if written) together with the sign, code or word of money before or after them, if any. The parser reads it in the world's own money, to an integer in its smallest unit; digits written with no sign or word are whole units.");
  // No currency of the table is in it: no sign, no code, no word.
  for (const cur of Object.values(CURRENCIES)) {
    for (const w of [cur.symbol, ...(cur.unit_words ?? []), ...(cur.minor_words ?? [])]) {
      if (w === undefined || ["real", "pound", "bob", "mark", "rs", "kr"].includes(w)) continue; // (ordinary words too, or letters of one)
      expect([w, new RegExp(/^[a-z]+$/i.test(w) ? `\\b${w}\\b` : w.replace(/[$.]/g, "\\$&"), "i").test(s)]).toEqual([w, false]);
    }
    expect([cur.code, new RegExp(`\\b${cur.code}\\b`).test(s)]).toEqual([cur.code, false]);
  }
});

// ---------------------------------------------------------------- the training data's writings

/** Every way of writing numbers at once: what a test asks of a currency whose own way isn't on record. */
type Writing = Pick<WrittenCurrency, "decimal_mark" | "group_mark" | "grouping" | "symbol_after" | "symbol_spaced" | "number_words" | "country_sign">;
const LAKH = { lakh: 100_000, lakhs: 100_000, crore: 10_000_000, crores: 10_000_000 };
const EVERY_WAY: Writing[] = [{}, { decimal_mark: ",", symbol_after: true }, { decimal_mark: ",", symbol_spaced: true }, { grouping: [3, 2], number_words: LAKH, symbol_spaced: true }, { country_sign: true, symbol_after: true },
  { decimal_mark: ",", group_mark: "\u202f", symbol_after: true, symbol_spaced: true }, { group_mark: "'" }, { decimal_mark: ",", group_mark: ".", grouping: [3, 2], number_words: LAKH }];
/** A currency with how its place writes numbers replaced by `way` (the fields it has of its own set aside). */
const writtenAs = (base: WrittenCurrency, way: Writing): WrittenCurrency => {
  const { decimal_mark, group_mark, grouping, symbol_after, symbol_spaced, number_words, country_sign, ...rest } = base;
  void [decimal_mark, group_mark, grouping, symbol_after, symbol_spaced, number_words, country_sign];
  return { ...rest, ...way };
};
const SUMS = (cur: Currency): bigint[] => {
  const per = 10n ** BigInt(cur.minor_units);
  return [1n * per, 500n * per, 9_000n * per, 1_234n * per + (per > 1n ? 56n % per : 0n), 150_000n * per, 1_234_567n * per + (per > 1n ? 5n : 0n), 2_500_000n * per, 30_000_000n * per, 7n];
};

test("the training data writes an amount as its world does, every writing reads back as the same number, and the first is the plain one", () => {
  const seen = new Set<string>();
  for (const base of [...Object.values(CURRENCIES), ...everyCurrency()]) for (const way of [undefined, ...EVERY_WAY]) {
    const cur: WrittenCurrency = way ? writtenAs(base as WrittenCurrency, way) : (base as WrittenCurrency);
    for (const n of SUMS(cur)) {
      const forms = amountWritings(n, cur);
      expect(forms.length).toBeGreaterThanOrEqual(3);
      expect(forms[0]).toBe(formatMoney(n, cur, n % 10n ** BigInt(cur.minor_units) === 0n ? { decimals: false } : {}));
      for (const f of forms) {
        expect([cur.code, f, read(f, cur)]).toEqual([cur.code, f, n.toString()]);
        seen.add(f.replace(/[0-9]+/g, "9"));
      }
    }
  }
  // A world that says how it writes numbers is written that way too, and one that doesn't is not.
  const of = (code: string) => INVENTED.find((c) => c.code === code)!;
  const comma = of("GLD"), spaced = of("NVO"), twos = of("RPA"), letters = of("TSH"), shared = of("PSO"), plain = of("DLR"), after = of("ZEN");
  expect(amountWritings(123_456n, comma)).toEqual(expect.arrayContaining(["₲1,234.56", "₲1.234,56", "1.234,56 ₲", "1234,56₲", "1.234,56 guldens", "1.234,56 GLD", "1.234,56"]));
  expect(amountWritings(123_400n, comma)).toContain("₲1.234"); // (its decimal mark is stated, so a point can only group)
  expect(amountWritings(123_400n, plain)).not.toContain("$1.234"); // (it could be two numbers: nothing writes what isn't read)
  expect(amountWritings(123_456_700n, comma)).toContain("₲1.234.567");
  expect(amountWritings(123_456n, spaced)).toEqual(expect.arrayContaining(["N$1,234.56", "N$ 1.234,56", "N$ 1,234.56", "NVO 1,234.56"]));
  expect(amountWritings(15_000_000n, twos)).toEqual(expect.arrayContaining(["₨150,000", "₨1,50,000", "₨ 1,50,000", "1,50,000 rupas", "₨1.5 lakh", "1.5 lakh rupas"]));
  expect(amountWritings(50_000_000n, twos)).toEqual(expect.arrayContaining(["₨5 lakh", "5 lakh", "5 lakh rupas", "₨5,00,000"]));
  expect(amountWritings(3_000_000_000n, twos)).toEqual(expect.arrayContaining(["₨3 crore", "3 crore rupas", "₨3,00,00,000", "₨30m"]));
  expect(amountWritings(500_000n, letters)).toEqual(expect.arrayContaining(["TSh5,000", "TSh 5,000", "5,000 bob", "TSH 5,000", "TSh5k"]));
  expect(amountWritings(50_000n, shared)).toEqual(expect.arrayContaining(["$500", "PS$500", "500 pesos", "PSO 500"]));
  expect(amountWritings(9_000n, after)).toEqual(expect.arrayContaining(["圓9,000", "9,000 圓", "9,000圓", "9,000 zen", "9k"]));
  for (const f of amountWritings(123_456n, plain)) expect(/^\$?1,?234\.56( dollars| DLR)?$|^DLR 1,234\.56$/.test(f)).toBe(true);
  // The shapes written are many, and not one currency's: a sign before, after, spaced; a code; words; both marks.
  expect(seen.size).toBeGreaterThan(150);
});

test("generated programs are in the invented worlds' money and each profile's, and every amount reads in its own", () => {
  const all = everyCurrency();
  expect(all.slice(0, INVENTED.length)).toEqual(INVENTED);
  expect(all.length).toBe(INVENTED.length + worldsCurrencies().length);
  expect(worldsCurrencies().length).toBeGreaterThanOrEqual(1);
  // The invented worlds differ in what a real world's may: decimals, a sign or none, where the sign goes, the marks.
  const has = (f: (c: WrittenCurrency) => unknown) => expect(INVENTED.some(f)).toBe(true);
  for (const f of [(c: WrittenCurrency) => c.minor_units === 0, (c: WrittenCurrency) => c.minor_units === 3, (c: WrittenCurrency) => !c.symbol, (c: WrittenCurrency) => c.decimal_mark === ",", (c: WrittenCurrency) => c.grouping?.length === 2,
    (c: WrittenCurrency) => c.symbol_after, (c: WrittenCurrency) => c.symbol_spaced, (c: WrittenCurrency) => c.country_sign, (c: WrittenCurrency) => INVENTED.filter((x) => x.symbol === c.symbol).length > 1]) has(f);
  const gold = [...synthetic({ perFunction: 150, only: ["money", "structure", "presence"], seed: 4 }), ...amountForms({ forms: 40, seed: 4 })];
  const used = new Set<string>();
  const shapes = new Set<string>();
  const amountsOf = (g: Gold): string[] => {
    const out: string[] = [];
    const walk = (c: calls.Call) => { for (const [k, v] of Object.entries(c.args)) { if ("call" in v) walk(v.call); else if ("text" in v && (["amount", "price", "carrying"].includes(k) || g.forms?.some((f) => f.fields[k]?.type === "amount"))) out.push(v.text); } };
    const p = calls.parseProgram(g.program);
    if (!("none" in p)) for (const l of p.lines) walk(l.call);
    return out;
  };
  for (const g of gold) for (const a of amountsOf(g)) {
    expect([g.currency!.code, a, read(a, g.currency!) !== null]).toEqual([g.currency!.code, a, true]);
    used.add(g.currency!.code);
    shapes.add(a.replace(/[0-9]+/g, "9"));
  }
  expect([...used].sort()).toEqual(all.map((c) => c.code).sort());
  expect(shapes.size).toBeGreaterThan(120);
  // Its world's way of writing goes with a program, so another surface of it is written as that world writes.
  const g = gold.find((x) => x.currency!.code === "GLD" && x.shape.startsWith("money("))!;
  expect([(g.currency as WrittenCurrency).decimal_mark, (g.currency as WrittenCurrency).symbol_after]).toEqual([",", true]);
  const rand = sampler(3);
  const surfaces = new Set<string>();
  for (let i = 0; i < 80; i++) for (const a of amountsOf(surfaceVariant(g, rand))) {
    expect(read(a, g.currency!)).toBe(read(amountsOf(g)[0]!, g.currency!));
    surfaces.add(a);
  }
  expect([...surfaces].some((a) => a.endsWith("₲"))).toBe(true);
});

// ---------------------------------------------------------------- the trained model's steps

test("a trained model's answer copies an amount exactly, however its world writes it: every writing of the nine currencies comes back as it was said", () => {
  let checked = 0;
  for (const name of ["aud", "usd", "mxn", "jpy", "eur", "gbp", "brl", "inr", "kes"]) for (const way of EVERY_WAY) {
    const cur: WrittenCurrency = writtenAs(CURRENCIES[name]!, way);
    for (const n of SUMS(cur).filter((_, i) => i % 2 === 0)) for (const amount of amountWritings(n, cur)) {
      for (const [request, program] of [
        [`Pay acc-works ${amount} from acc-town for the fence.`, `money(amount="${amount}", for="the fence", from=acc-town, to=acc-works)`],
        [`Have ent.12 build a shed on lot-07-02 for ${amount}, paid from acc-town, under permit rec.30.`, `structure(basis=rec.30, by=ent.12, from=acc-town, on=lot-07-02, price="${amount}", type=shed)`],
        [`Offer ent.24 a membership agreement: they pay ${amount} per month into acc-union.`, `agreement(template=membership, they_do=money(amount="${amount}", every="per month", to=acc-union), with=ent.24)`],
      ] as const) {
        const spans = spansIn(request, program);
        const e = encode({ request, forms: [], program, spans });
        const canonical = calls.programText(calls.parseProgram(program));
        expect(decode(e.input, e.steps)).toBe(canonical);
        // As pieces, what a model points at: the amount is whole pieces, and comes back character for character.
        const r = row("x", "positive", e);
        expect([amount, r !== undefined]).toEqual([amount, true]);
        const back = decode(e.input, stepsOf(r!, r!.steps));
        expect(back).toBe(canonical);
        expect(back).toContain(`"${amount}"`);
        checked++;
      }
      // And read in its own world's money it is the sum that was meant; in a world with another sign it is refused.
      expect(read(amount, cur)).toBe(n.toString());
    }
  }
  expect(checked).toBeGreaterThan(2000);
  // A sign, whatever it is, is a piece of its own unless it is letters run into the digits: no span of an amount cuts one.
  expect(pieces("₹1,50,000 and 1.234,56 € and R$ 9.000,00 and KSh5k and ¥9,000").map((p) => p.text)).toEqual(["₹", "1", ",", "50", ",", "000", "and", "1", ".", "234", ",", "56", "€", "and", "R", "$", "9", ".", "000", ",", "00", "and", "KSh5k", "and", "¥", "9", ",", "000"]);
}, 30_000);

// ---------------------------------------------------------------- a request's world goes with it

test("a request labelled by two readers keeps its world's money, and its amount is compared in it", () => {
  const { kes, mxn } = CURRENCIES as { [k: string]: Currency };
  const requests = [
    { id: "a", request: "Pay acc-works KSh 5,000 from acc-town.", forms: [], from: { situation: "run/seat/d1/1", writer: "w" }, currency: kes! },
    { id: "b", request: "Pay acc-works $500 from acc-town.", forms: [], from: { situation: "run2/seat/d1/1", writer: "w" }, currency: mxn! },
  ];
  const said = (a: string, b: string) => [{ id: "a", program: `money(amount="${a}", from=acc-town, to=acc-works)` }, { id: "b", program: `money(amount="${b}", from=acc-town, to=acc-works)` }];
  const r = labelled(requests, [{ reader: "one", answers: said("KSh 5,000", "$500") }, { reader: "two", answers: said("KSh 5,000", "$500") }]);
  expect(r.examples.map((e) => [e.id, e.currency?.code, e.program])).toEqual([["a", "KES", 'money(amount="KSh 5,000", from=acc-town, to=acc-works)'], ["b", "MXN", 'money(amount="$500", from=acc-town, to=acc-works)']]);
  // By meaning, in the example's own money: other writings of the sum are the same program; another sum, or another
  // world's writing of it, is not.
  const [a, b] = r.examples as [typeof r.examples[number], typeof r.examples[number]];
  const same = (e: typeof a, amount: string) => sameProgram(e.program, `money(amount="${amount}", from=acc-town, to=acc-works)`, { currency: e.currency! });
  expect([same(a, "5,000 bob"), same(a, "5k shillings"), same(a, "KES 5000.00"), same(a, "KSh 50,000"), same(a, "$5,000")]).toEqual([true, true, true, false, false]);
  expect([same(b, "500 pesos"), same(b, "MX$500.00"), same(b, "US$500"), same(b, "500 dollars")]).toEqual([true, true, false, false]);
});
