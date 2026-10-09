// Turns that are a choice among what was put to someone (translator/train/choices.ts): a citizen's decision told in
// plain words, a plain reply to a draft's preview, and whole turns with their segmentation (v2.ts `v2Turns`).
import { expect, test } from "bun:test";
import { choiceBrief, choicePlan, choiceReaderSystem, citizenCase, citizenSituation, previewsIn, replyCases, REPLY_OPTIONS, type DecisionRecord } from "../train/choices";
import { notCarried, v2Brief, v2Turns } from "../train/v2";

const CUR = { code: "XTS", minor_units: 2, symbol: "¤" };
const shop: DecisionRecord = {
  domain: "shop", choice: "shop-17", n: 6, t: 63,
  options: [{ key: "shop-12", facts: { goods_per_month: 13, money_per_month: -185718 } }, { key: "shop-17", facts: { goods_per_month: 0, money_per_month: 0 } }],
  circumstances: { savings: 443490, monthly_income: 427542, essentials: 35942, homeless: false }, state: { emotion: { kind: "fear", about: "money" } },
};

test("a citizen's decision is told as the citizen could know it: its money in the world's writing, each option's facts in plain words, nothing of its mind", () => {
  const { situation, options } = citizenSituation({ ...shop, ...({ person: { values: { power: 4827 } }, strategy: "deliberate" } as object) }, CUR);
  expect(situation).toContain("You have about ¤4,434.90 put by.");
  expect(situation).toContain("About ¤4,275.42 comes in a month.");
  expect(situation).toContain("You feel fear about money.");
  expect(situation).toContain("You are deciding where to do your shopping.");
  expect(situation).toContain("- shop-12: about 13 things bought there a month; costs you about ¤1,857.18 a month");
  expect(situation).toContain("- shop-17: you have bought nothing there yet; costs nothing");
  expect(situation).not.toMatch(/score|4827|deliberate|learned|power/);
  expect(options.map((o) => o.key)).toEqual(["shop-12", "shop-17"]);
  const c = citizenCase(shop, CUR, { run: "pilot-x", seq: 2238, subject: "c0533-self" })!;
  // The label is what the code citizen chose, and the case joins back to its decision.
  expect(c.label).toBe("shop-17");
  expect(c.from).toEqual({ run: "pilot-x", seq: 2238, subject: "c0533-self", domain: "shop", n: 6, t: 63 });
  expect(citizenCase({ ...shop, options: [shop.options[0]!] }, CUR, { run: "x", seq: 1 })).toBeUndefined();
  expect(citizenCase({ ...shop, choice: "elsewhere" }, CUR, { run: "x", seq: 1 })).toBeUndefined();
  const stay = citizenSituation({ domain: "practice", choice: "stay", current: "stay", options: [{ key: "sport-group-1-gathering", facts: { company: 2, time_hours_per_month: 9, money_per_month: 0 } }, { key: "stay", facts: { money_per_month: 0 } }] }, CUR);
  expect(stay.situation).toContain("- sport-group-1-gathering: 2 of the people you know go; takes about 9 hours a month; costs nothing");
  expect(stay.situation).toContain("- stay: stay in");
  expect(stay.situation).toContain("At present: stay in.");
  const brief = choiceBrief(c, "terse");
  expect(brief).toContain("What you choose: shop-17");
  expect(brief).toContain("Who is asking: an ordinary resident");
});

test("the previews a seat was shown are read out of its sitting, and each becomes replies whose label is fixed by how it is asked for", () => {
  const shown = "## Waiting for you to confirm\nBefore this goes ahead (draft.finance.1), here is exactly what will happen:\nYou will ask the bank to pay 5 to acc-a.\nNothing stands in the way right now.\nConfirm it, or decline it.\nBefore this goes ahead (draft.finance.2), here is exactly what will happen:\nYou will publish a notice.\nConfirm it, or decline it.";
  expect(previewsIn(shown)).toEqual([{ draft: "draft.finance.1", preview: "You will ask the bank to pay 5 to acc-a.\nNothing stands in the way right now." }, { draft: "draft.finance.2", preview: "You will publish a notice." }]);
  const cases = replyCases("pilot-x", "draft.finance.1", "You will ask the bank to pay 5 to acc-a.", "confirm", () => 0);
  expect(cases.map((c) => [c.label, c.from.real])).toEqual([["confirm", true], ["decline_and_ask", false], ["decline", false]]);
  for (const c of cases) { expect(c.options).toBe(REPLY_OPTIONS); expect(c.situation).toContain("You will ask the bank to pay 5 to acc-a."); expect(choiceBrief(c, "flat")).toContain("What you answer: "); }
  expect(replyCases("pilot-x", "draft.finance.2", "x", "decline", () => 1).map((c) => c.label)).toEqual(["decline", "unclear"]);
  expect(REPLY_OPTIONS.map((o) => o.key)).toEqual(["confirm", "decline", "decline_and_ask", "unclear"]);
  const plan = choicePlan(cases, { writers: ["a", "b"], seed: 2 });
  expect(new Set(plan.map((t) => t.id)).size).toBe(3);
  expect(choiceReaderSystem()).toContain("A yes that asks for something to be different");
});

test("a whole turn is one to five parts in order, each with its reading: an act with its program, one that cannot be read, one to be asked back, or another tool", () => {
  const acts = [
    ...Array.from({ length: 12 }, (_, i) => ({ request: `Pay acc-${i} ${i + 3}00 for the fence.`, program: `money(amount="${i + 3}00", for="the fence", to=acc-${i})` })),
    { request: "Sort out the housing thing.", program: "none(unclear)" }, { request: "Put a hold on whichever order pays the cleaner.", program: "none(look_first)" },
    { request: "x".repeat(400), program: "vote(ballot=rec.1, choice=yes)" }, { request: "Pay a and hire b.", program: "none(too_much)" },
  ];
  const turns = v2Turns({ acts, n: 300, seed: 4 });
  expect(v2Turns({ acts, n: 300, seed: 4 })).toEqual(turns);
  expect(turns.length).toBe(300);
  const sizes = new Set(turns.map((t) => t.case.uses.length));
  for (const n of [1, 2, 3, 4, 5]) expect(sizes.has(n)).toBe(true);
  const parts = turns.flatMap((t) => t.case.uses);
  expect(parts.some((u) => u.reads === "act")).toBe(true);
  expect(parts.some((u) => u.reads === "unreadable" && u.program === "none(unclear)")).toBe(true);
  expect(parts.some((u) => u.reads === "ask_back" && u.program === "none(look_first)")).toBe(true);
  // (A long act and a pile of acts are no part of a turn.)
  expect(parts.some((u) => u.tool === "do" && (u.input.what.length > 320 || u.program === "none(too_much)"))).toBe(false);
  expect(parts.some((u) => u.tool === "look")).toBe(true);
  for (const t of turns) {
    expect(t.case.kind).toBe(`whole_turn:${t.case.uses.length}`);
    for (const u of t.case.uses) if (u.tool === "do") expect(acts.some((a) => a.request === u.input.what && a.program === u.program)).toBe(true);
    for (const u of t.case.uses) if (u.tool === "look") expect(t.case.knows.reports.map((r) => r.id)).toContain(u.input.report);
  }
  // The writer is told that an act's words go in as they are, and a turn that rewords one is not kept.
  const withAct = turns.find((t) => t.case.uses.some((u) => u.tool === "do"))!;
  expect(v2Brief(withAct.case, "terse", "citizen")).toContain("said in its own words exactly as given");
  const one = { tool: "do" as const, input: { what: "Pay acc-1 400 for the fence." } };
  expect(notCarried("First, pay acc-1 400 for the fence. Then I am done.", [one])).toMatch(/words not as written/);
  expect(notCarried("First: Pay acc-1 400 for the fence. Then I am done.", [one])).toBeUndefined();
  // A report named by its title alone is carried; by a loose description it is not.
  const look = { tool: "look" as const, input: { report: "me/rents", current_only: true } };
  const knows = { reports: [{ id: "me/rents", title: "My papers: Rents" }] };
  expect(notCarried("Could you pull up My papers: Rents, just what's still current?", [look], knows)).toBeUndefined();
  expect(notCarried("Could you pull up my rent papers, just what's still current?", [look], knows)).toMatch(/id not there/);
  expect(notCarried("Send it with this note: \"fine\". Yes to draft.a.1.", [{ tool: "confirm", input: { ref: "draft.a.1", decision: "confirm", note: "fine" } }])).toBeUndefined();
});
