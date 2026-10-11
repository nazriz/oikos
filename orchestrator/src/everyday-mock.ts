// Mock teachers for the everyday model's gate (docs/design/ai-citizens.md 11): one that reads the person, by
// construction, and four that are each at fault in one way the gate must catch. No model is called. They answer from
// the structured facts behind a request (`context`, which no real model is sent), as the other mocks do.

import { MockAdapter, type ContentBlock, type LlmRequest } from "@oikos/participants/llm";
import { baseLine, optionsOf, SHIFT_STEP, TRUST_SD, yearsHere, zAgency, type Asked, type Harvested } from "./everyday";

export type MockKind = "reads" | "situation" | "first" | "wording" | "venues";

/** Odds for the person shown: the code mind's own for the situation, moved by who the person is. */
function reading(shown: Harvested): { [id: string]: number } {
  const s = shown.situation;
  const base = baseLine(shown, [shown]);
  const w: { [id: string]: number } = {};
  const z = Math.max(-3, Math.min(3, zAgency(s)));
  for (const o of optionsOf(s)) {
    let x = Math.max(0.02, base[o.id] ?? 0);
    if (o.id === "leave") x *= Math.exp(-0.5 * z);
    else if (o.id === "give_up") x = 0.03 * Math.exp(-0.7 * z);
    else {
      x *= Math.exp(0.3 * z);
      if (o.opening!.trust) x *= Math.exp((0.6 * (o.opening!.trust.bps - o.opening!.trust.town_bps)) / TRUST_SD);
      if (o.opening!.kind === "offer:lease") x *= Math.exp(-0.08 * Math.min(20, yearsHere(shown)));
      x *= 1 + 0.1 * Math.min(5, o.opening!.others);
    }
    w[o.id] = x;
  }
  return w;
}

export function mockTeacher(kind: MockKind, name = "mock"): MockAdapter {
  const policy = (req: LlmRequest): ContentBlock[] => {
    const { asked, shown } = req.context.everyday as { asked: Asked; shown: Harvested };
    const original: Harvested = { ...shown, situation: shown.situation };
    let w = reading(original);
    if (kind === "situation") {
      // The person ignored: the same numbers whoever is in the situation (what an opening is, never what they know of it).
      w = Object.fromEntries(optionsOf(shown.situation).map((o) => [o.id, o.id === "leave" ? 0.4 : o.id === "give_up" ? 0.05 : 0.55 / Math.max(1, optionsOf(shown.situation).length - 2)]));
    }
    if (kind === "venues") for (const o of optionsOf(shown.situation)) if (o.cls === "venue" || o.cls === "ask") w[o.id] = (w[o.id] ?? 0) * 6 + 0.5;
    const listed = asked.ids.map((id, i) => (w[id] ?? 0) * (kind === "first" && i === 0 ? 3 : 1) * (kind === "wording" && /estimation task/.test(req.system) && i % 2 === 0 ? 3 : 1));
    const total = listed.reduce((a, b) => a + b, 0) || 1;
    if (asked.shiftFrom) {
      // (The closed scale: the step nearest to how far these odds sit from the base line shown.)
      const shifts = listed.map((x, i) => Math.max(-3, Math.min(3, Math.round(Math.log(Math.max(1e-6, x / total) / asked.shiftFrom![i]!) / Math.log(SHIFT_STEP)))));
      return [{ type: "tool_use", id: "estimate", name: "estimate", input: { declined: false, bearing: [], shifts: Object.fromEntries(asked.labels.map((l, i) => [l, shifts[i]!])) } }];
    }
    const counts = listed.map((x) => Math.floor((100 * x) / total));
    // (What is left over goes by the largest remainders, ties by the option's own id: never by where it is listed.)
    const left = 100 - counts.reduce((a, b) => a + b, 0);
    const byRemainder = listed.map((x, i) => ({ i, r: (100 * x) / total - counts[i]!, id: asked.ids[i]! })).sort((a, b) => b.r - a.r || (a.id < b.id ? -1 : 1));
    for (let k = 0; k < left; k++) counts[byRemainder[k % counts.length]!.i]!++;
    return [{ type: "tool_use", id: "estimate", name: "estimate", input: { declined: false, bearing: [], counts: Object.fromEntries(asked.labels.map((l, i) => [l, counts[i]!])) } }];
  };
  return new MockAdapter(name, { consult: policy });
}
