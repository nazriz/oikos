// A wide part of the translator's training data (data.ts 0.13.0): registers beside the styles, who is asking, every
// paper the worlds' own offices issue with every field filled, and the wide kinds of refusal brief.
import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import * as PAPERS from "../../participants/src/shared/papers";
import { ASKERS, askerFor, BROAD_DEAL, DATA_VERSION, DEAL, fromWritten, PAPER_ASKERS, planOf, refusalBriefs, REGISTERS, STYLES, sampler, whyNot, type PlanItem } from "../train/data";
import { payments, synthetic, worldForms } from "../train/synthetic";

const gold = synthetic({ perFunction: 12, seed: 3 });

test("the pipeline's version says there is a wide part", () => {
  expect(DATA_VERSION).toBe("0.14.0");
});

test("the wide deal is made of the styles and the three registers, and the older deal has none of the registers", () => {
  for (const s of BROAD_DEAL) expect(STYLES[s] ?? REGISTERS[s]).toBeString();
  expect(Object.keys(REGISTERS).sort()).toEqual(["flat", "rambling", "slips"]);
  for (const r of Object.keys(REGISTERS)) { expect(BROAD_DEAL).toContain(r); expect(DEAL).not.toContain(r); expect(STYLES[r]).toBeUndefined(); }
  // (Every older style is still dealt, and the seats' voices are a fifth of the turns, not half.)
  for (const s of Object.keys(STYLES)) expect(BROAD_DEAL).toContain(s);
  const seats = BROAD_DEAL.filter((s) => s === "early" || s === "late").length / BROAD_DEAL.length;
  expect(seats).toBeGreaterThan(0.1);
  expect(seats).toBeLessThan(0.25);
  // (None of them names a place's money in its instruction.)
  for (const t of Object.values(REGISTERS)) expect(t).not.toMatch(/[$€£¥]|dollar|euro|pound/i);
});

test("a plan made without it is what it was: nobody is said to be asking, and no register is dealt", () => {
  const plan = planOf(gold, { writers: ["a", "b"], perGold: 1, refusalFloor: 2, seed: 4 });
  expect(plan.some((t) => t.asker !== undefined)).toBe(false);
  expect(plan.some((t) => t.style in REGISTERS)).toBe(false);
  expect(plan.some((t) => t.brief.includes("Who is asking"))).toBe(false);
  expect(plan.some((t) => t.kind === "refusal" && t.refusal.mustNot)).toBe(false);
});

test("a wide plan says who is asking in every brief: an office-holder in an office-holder's style, otherwise someone who would ask for such an act", () => {
  const plan = planOf(gold, { writers: ["a", "b", "c"], styles: BROAD_DEAL, broad: true, perGold: 1, refusalFloor: 6, seed: 4 });
  expect(planOf(gold, { writers: ["a", "b", "c"], styles: BROAD_DEAL, broad: true, perGold: 1, refusalFloor: 6, seed: 4 })).toEqual(plan);
  for (const t of plan) {
    expect(ASKERS[t.asker!]).toBeString();
    expect(t.brief).toContain(`Who is asking: ${ASKERS[t.asker!]}`);
    if (["early", "late", "capacity", "cited", "stacked", "do_not"].includes(t.style)) expect(t.asker).toBe("officer");
  }
  const askers = new Set(plan.map((t) => t.asker));
  for (const a of Object.keys(ASKERS)) expect(askers.has(a)).toBe(true);
  // Every register reaches requests and refusals alike, each with its own instruction in the brief.
  for (const r of Object.keys(REGISTERS)) for (const kind of ["request", "refusal"] as const) {
    const t = plan.find((x) => x.kind === kind && x.style === r)!;
    expect(t).toBeDefined();
    expect(t.brief).toContain(kind === "request" ? REGISTERS[r]! : REGISTERS[r]!.replaceAll("the call", "the situation"));
  }
  // Nobody asks for what they would not: a birth is never a banker's, a paper of an office's own is its holder's.
  expect(askerFor("terse", { shape: "birth(name,template)" }, sampler(1))).not.toBe("banker");
  for (let i = 0; i < 20; i++) expect(askerFor("chatty", { shape: "form(form,to)", tag: "paper" }, sampler(i))).toBe("officer");
  expect(askerFor("chatty", { shape: "form(form,to)", tag: "world_form", asker: "landlord" }, sampler(1))).toBe("landlord");
});

test("papers can be limited to some by name, and some filled in more ways, the programs of those the same as without the limit", () => {
  const all = worldForms({ perForm: 3, seed: 9, askers: PAPER_ASKERS });
  const names = [...new Set(all.map((g) => g.source!.split(".").at(-1)!))].slice(3, 5);
  const some = worldForms({ perForm: 3, seed: 9, askers: PAPER_ASKERS, only: names, perFormOf: { [names[0]!]: 5 } });
  expect(new Set(some.map((g) => g.source!.split(".").at(-1)!))).toEqual(new Set(names));
  const of = (gs: typeof all, n: string) => gs.filter((g) => g.source!.endsWith(`.${n}`)).map((g) => g.program);
  expect(of(some, names[0]!).length).toBe(5);
  expect(of(some, names[0]!).slice(0, 3)).toEqual(of(all, names[0]!));
  expect(of(some, names[1]!)).toEqual(of(all, names[1]!));
});

test("every paper the worlds' own offices issue is there, each with every field it has in its first two fillings", () => {
  const declared = Object.entries(PAPERS).flatMap(([office, x]) => (Array.isArray(x) ? x : typeof x === "object" && x && "form" in x ? [x] : []).map((p: any) => ({ office, form: p.form as string, fields: Object.keys(p.fields) })));
  // (41 when this was written; a paper a module declares later is covered without anything here changing.)
  expect(declared.length).toBeGreaterThanOrEqual(41);
  const made = worldForms({ perForm: 3, seed: 9, askers: PAPER_ASKERS });
  expect(worldForms({ perForm: 3, seed: 9, askers: PAPER_ASKERS })).toEqual(made);
  for (const d of declared) {
    const own = made.filter((g) => g.source === `synthetic: world form ${d.office}.${d.form}`);
    expect(own.length).toBe(3);
    const filled = new Set<string>();
    for (const g of own.slice(0, 2)) {
      const p = calls.parseProgram(g.program) as { lines: calls.Line[] };
      expect(calls.contractErrors(p)).toEqual([]);
      for (const k of Object.keys(p.lines[0]!.call.args)) filled.add(k);
      expect(g.tag).toBe("world_form");
      expect(g.asker).toBe(PAPER_ASKERS[d.office] ?? "officer");
      // (Shown with its own form, as its office's holder knows it: the office's own stationery.)
      expect(g.forms!.some((f) => f.form === d.form && f.office === "paper")).toBe(true);
    }
    for (const f of d.fields) expect(filled.has(f)).toBe(true);
  }
  // Every type of field a declared paper has is among what is filled, and the fillings are in many worlds' money.
  expect(new Set(made.map((g) => g.currency?.code)).size).toBeGreaterThan(10);
});

test("a wide part's refusal briefs: any act on a record whose id the speaker lacks is look_first, and attending is no_such_act", async () => {
  const narrow = refusalBriefs(gold, 12, 5);
  const wide = refusalBriefs(gold, 12, 5, { wide: true });
  expect(narrow.some((b) => b.mustNot)).toBe(false);
  const described = wide.filter((b) => b.mustNot);
  expect(described.length).toBeGreaterThanOrEqual(2);
  for (const b of described) {
    expect(b.label).toBe("look_first");
    expect(b.mustCopy).not.toContain(b.mustNot![0]);
    expect(b.brief).toContain(`its id (${b.mustNot![0]}) is NOT in the request`);
  }
  expect(wide.some((b) => b.label === "no_such_act" && /in person for something that happens there/.test(b.brief))).toBe(true);
  // (The kinds there were are still there.)
  expect(wide.some((b) => b.label === "no_such_act" && /routine of their own office/.test(b.brief))).toBe(true);
  expect(wide.some((b) => b.label === "look_first" && /looked up or found out/.test(b.brief))).toBe(true);
  // A request that gives the id after all is not kept: it would be an act, not a refusal.
  const plan = planOf(gold, { writers: ["w"], styles: ["terse"], broad: true, perGold: 1, only: ["none"], refusalFloor: 12, refusalLabels: ["look_first"], seed: 5 });
  const item = plan.find((t): t is Extract<PlanItem, { kind: "refusal" }> => t.kind === "refusal" && t.round === 0 && !!t.refusal.mustNot)!;
  const others = item.refusal.mustCopy.join(" and ");
  const kept = await fromWritten(plan, [{ writer: "w", requests: [{ id: item.id, request: `See to the one about the market, whichever it is: ${others}.` }] }], { refusalFloor: 0, refusalLabels: ["look_first"] });
  expect(kept.examples.filter((e) => e.program === "none(look_first)").length).toBe(1);
  expect(kept.examples[0]!.asker).toBe(item.asker);
  expect(kept.manifest.by_asker).toEqual({ [item.asker!]: 1 });
  const given = await fromWritten(plan, [{ writer: "w", requests: [{ id: item.id, request: `See to ${item.refusal.mustNot![0]}: ${others}.` }] }], { refusalFloor: 0, refusalLabels: ["look_first"] });
  expect(given.examples.length).toBe(0);
  expect(given.rejects[0]!.why).toBe("not_copied");
});

test("a wide part's programs have grouped counts and starts given as days, each read by the contract; without it none has", () => {
  const wide = synthetic({ perFunction: 150, seed: 3, only: ["goods", "work", "money", "take"], wide: true });
  const plain = synthetic({ perFunction: 150, seed: 3, only: ["goods", "work", "money", "take"] });
  const grouped = (g: { program: string }) => /(quantity|units)="[0-9]{1,3}([,. '][0-9]{2,3})+"/.test(g.program);
  const dated = (g: { program: string }) => /(first|until)="(year [0-9]+, )?day [0-9]+"/.test(g.program);
  expect(wide.filter(grouped).length).toBeGreaterThan(10);
  expect(wide.filter(dated).length).toBeGreaterThan(5);
  expect(plain.some(grouped) || plain.some(dated)).toBe(false);
  for (const g of wide.filter((x) => grouped(x) || dated(x))) expect(calls.contractErrors(calls.parseProgram(g.program))).toEqual([]);
});

test("payments of a bank's kind: a keeper carries out a request to pay, asked by someone at a bank's counter; a log's own stay out", () => {
  const made = payments({ kind: "per_request", n: 120, seed: 21 });
  expect(payments({ kind: "per_request", n: 120, seed: 21 })).toEqual(made);
  expect(made.length).toBe(120);
  expect(new Set(made.map((g) => g.program)).size).toBe(120);
  for (const g of made) {
    const p = calls.parseProgram(g.program) as { lines: calls.Line[] };
    expect(calls.contractErrors(p)).toEqual([]);
    expect(p.lines.length).toBe(1);
    const a = p.lines[0]!.call.args;
    expect(p.lines[0]!.call.fn).toBe("money");
    // (The request carried out is a record's id, bare; the account the money leaves is always said.)
    expect((a.per_request as { id: string }).id).toMatch(/^rec\.\d+$/);
    expect("id" in a.from!).toBe(true);
    expect([g.tag, g.asker, g.origin]).toEqual(["per_request", "banker", "synthetic"]);
    expect(g.notes!.join(" ")).toContain((a.per_request as { id: string }).id);
    // (What keeps a code keeper's own such payments out of a gold set made from logs is unchanged.)
    expect(whyNot(p)).toContain("per_request");
  }
  // Some name the account's holder inside the purpose, as tellers write it; some settle something.
  expect(made.filter((g) => /for="c\d{4}'s /.test(g.program)).length).toBeGreaterThan(8);
  expect(made.filter((g) => g.program.includes("settles=")).length).toBeGreaterThan(3);
  // Whoever asks is the bank, in every style, an office-holder's too.
  const plan = planOf(made.slice(0, 52), { writers: ["a"], perGold: 1, broad: true, styles: BROAD_DEAL, seed: 2 });
  expect(plan.every((t) => t.asker === "banker" && t.brief.includes(ASKERS.banker!) && t.brief.includes("carrying out a request to pay"))).toBe(true);
});

test("payments of a finance office's kinds: a net wage with its gross and what was withheld, a remittance, several records cited, a first day", () => {
  const made = payments({ kind: "finance", n: 120, seed: 22 });
  expect(payments({ kind: "finance", n: 120, seed: 22 })).toEqual(made);
  expect(made.length).toBe(120);
  const args = (g: (typeof made)[number]) => (calls.parseProgram(g.program) as { lines: calls.Line[] }).lines[0]!.call.args;
  for (const g of made) {
    expect(calls.contractErrors(calls.parseProgram(g.program))).toEqual([]);
    expect([g.tag, g.asker]).toEqual(["finance_payment", undefined]);
    expect(g.program).not.toContain("per_request");
  }
  // A wage: the note gives the gross and what was withheld, and the call's amount is what is left of the one after the other.
  const wages = made.filter((g) => g.notes!.some((n) => n.includes("the gross wage")));
  expect(wages.length).toBe(30);
  for (const g of wages) {
    const m = /the gross wage, (.+?), and what was withheld from it, (.+?)\. What is to be paid is (.+?), and the request/.exec(g.notes!.join(" "))!;
    const [gross, withheld, net] = [m[1]!, m[2]!, m[3]!].map((x) => BigInt(calls.parseAmount(x, g.currency!)));
    expect(gross! - withheld!).toBe(net!);
    expect((args(g).amount as { text: string }).text).toBe(m[3]!);
    expect(g.program).not.toContain(m[1]!);
  }
  // What was withheld, remitted to an outside account; a payment resting on several records, mostly settling something; a standing payment with its first day or wait.
  expect(made.filter((g) => g.notes!.some((n) => n.includes("withheld")) && !wages.includes(g)).length).toBe(30);
  const several = made.filter((g) => { const b = args(g).basis; return !!b && "json" in b && Array.isArray(b.json) && b.json.length >= 2; });
  expect(several.length).toBe(30);
  expect(several.filter((g) => "settles" in args(g)).length).toBeGreaterThan(8);
  const standing = made.filter((g) => "every" in args(g));
  expect(standing.length).toBe(30);
  expect(standing.every((g) => "first" in args(g))).toBe(true);
  expect(standing.filter((g) => /first="(year \d+, )?day \d+"/.test(g.program)).length).toBeGreaterThan(5);
});

test("a wide part weighted toward an asker: that share of the requests is theirs, an office-holder's style is an office-holder's still, and with no weight who asks is who it was", () => {
  const money = gold.filter((g) => g.shape.startsWith("money(") || g.shape.startsWith("statement(") || g.shape.startsWith("agreement("));
  const o = { writers: ["a"], perGold: 4, broad: true, styles: BROAD_DEAL, seed: 6 };
  const plain = planOf(money, o), weighted = planOf(money, { ...o, askers: { banker: 0.5 } });
  expect(planOf(money, { ...o, askers: {} }).map((t) => t.asker)).toEqual(plain.map((t) => t.asker));
  expect(weighted.length).toBe(plain.length);
  const official = ["early", "late", "capacity", "cited", "stacked", "do_not"];
  const free = weighted.filter((t) => !official.includes(t.style));
  expect(weighted.filter((t) => official.includes(t.style)).every((t) => t.asker === "officer")).toBe(true);
  const share = free.filter((t) => t.asker === "banker").length / free.length;
  expect(share).toBeGreaterThan(0.4);
  expect(share).toBeLessThan(0.7);
  // (The others are still there, drawn among those who would ask for such an act.)
  expect(new Set(free.map((t) => t.asker)).size).toBeGreaterThan(4);
  expect(plain.filter((t) => t.asker === "banker").length).toBeLessThan(free.filter((t) => t.asker === "banker").length / 3);
  // A program that says who asks is theirs whatever the weight; the whole draw to one asker is that asker.
  expect(askerFor("chatty", { shape: "form(form,to)", asker: "landlord" }, sampler(1), { banker: 1 })).toBe("landlord");
  for (let i = 0; i < 10; i++) expect(askerFor("flat", { shape: "statement(kind,text)" }, sampler(i), { banker: 1 })).toBe("banker");
});
