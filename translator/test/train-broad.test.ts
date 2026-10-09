// A wide part of the translator's training data (data.ts 0.13.0): registers beside the styles, who is asking, every
// paper the worlds' own offices issue with every field filled, and the wide kinds of refusal brief.
import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import * as PAPERS from "../../participants/src/behaviour/papers";
import { ASKERS, askerFor, BROAD_DEAL, DATA_VERSION, DEAL, fromWritten, PAPER_ASKERS, planOf, refusalBriefs, REGISTERS, STYLES, sampler, type PlanItem } from "../train/data";
import { synthetic, worldForms } from "../train/synthetic";

const gold = synthetic({ perFunction: 12, seed: 3 });

test("the pipeline's version says there is a wide part", () => {
  expect(DATA_VERSION).toBe("0.13.0");
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

test("every paper the worlds' own offices issue is there, each with every field it has in its first two fillings", () => {
  const declared = Object.entries(PAPERS).flatMap(([office, x]) => (Array.isArray(x) ? x : typeof x === "object" && x && "form" in x ? [x] : []).map((p: any) => ({ office, form: p.form as string, fields: Object.keys(p.fields) })));
  expect(declared.length).toBe(41);
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
