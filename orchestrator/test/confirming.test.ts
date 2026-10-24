// What confirming a draft means is said once, in a seat's standing instructions, and nothing else a seat is told of
// confirming says otherwise (docs/decisions.md, "What a seat confirms is all that is done", 2026-10-11). A seat shown
// a draft that did part of what it asked confirmed it because the part was right; the sentence is what moved that in
// the replay (runs/preview-replay-2026-10-11). No model is called.

import { expect, test } from "bun:test";
import { CONFIRMING, LLM_PARTICIPANT_VERSION, systemPrompt, tools, type LlmParticipantConfig } from "@oikos/participants/llm";
import { draftText } from "@oikos/translator";

const seat = (extra: object = {}): LlmParticipantConfig => ({ participant: "finance-system", entity: "city", entityName: "Town of Millbrook", title: "Finance officer", framing: { disclosure: "simulation", reason: "test", system: "You are the finance officer." },
  standing: [], titles: new Map(), cadenceDays: 7, draftText: () => "", ...extra } as any);

test("a seat's standing instructions say what confirming means, once, right after they say it will confirm or decline", () => {
  expect(CONFIRMING).toBe("What you confirm is all that is done. Anything you asked for that the draft does not list among the things it does is not done: decline, or confirm and ask for the rest.");
  for (const c of [seat(), seat({ sessions: { start: 9 * 3600, end: 17 * 3600, days: [1, 2, 3, 4, 5] } }), seat({ title: undefined, entityName: undefined })]) {
    const s = systemPrompt(c, "- [law-charter] charter of city: \"...\"");
    expect(s.split(CONFIRMING)).toHaveLength(2);
    expect(s).toContain(`Before anything takes effect, you'll see exactly what will happen, and confirm or decline it. ${CONFIRMING} You can also write to people directly.`);
  }
  // The seat's instructions changed, so its version did: a run's record says which a seat was given.
  expect(LLM_PARTICIPANT_VERSION).toBe("0.19.0"); // (0.19.0: what came of its own acts, papers not brought said, reasons in the notebook, the standing instructions unchanged; 0.18.3: a look's result reaches the next prompt; 0.18.2: a draft not yet shown is not confirmed, a question still out is not an empty answer; 0.18.1: only the no-turn return and a turn for what falls due; 0.18.0: the office's own file at every sitting, the standing instructions unchanged; 0.17.1: the day's list brings a seat back; 0.17.0: the way out under framings other than honest disclosure; 0.16.0: the notebook's fold; the sentence on confirming is 0.15.0's)
});

test("nothing else a seat is told of confirming contradicts it: not its instructions, its tools, or the words a draft comes with", () => {
  const draft = (summary: string, check: object = { ok: true }) => draftText({ id: "draft.finance.1", summary, check } as any);
  const drafts = [
    draft("This does one thing: a payment.\n1. You will ask Millbrook Bank (bank) to pay XYZ 10.00 from your account (acc-city) to acc-outside, once."),
    draft("This does one thing: a written direction.\n1. You will give the Works manager (works) a written direction. The office will not follow it: ..."),
    draft("This does one thing: a payment.", { ok: false, refusal: { code: "insufficient_funds" } }),
  ];
  const told = [systemPrompt(seat(), ""), ...tools(seat()).map((t) => `${t.name}: ${t.description} ${JSON.stringify(t.input_schema)}`), ...drafts];
  // Anything that would say a confirmed draft does more than it lists, or that what was asked is done whatever the
  // draft shows, or that a draft may not be confirmed in part.
  const contrary = [/everything you asked/i, /all (of )?(what|that) you asked/i, /the rest (is|will be) (done|taken care of|carried out)/i, /whatever you asked/i, /will be done (anyway|as well|too)/i, /what you asked (for )?(is|will be) done/i,
    /confirm(ing)? (it )?(carries out|does) (your|the) request/i, /only if it does (all|everything)/i, /must decline/i, /never confirm/i];
  for (const text of told) for (const re of contrary) expect(re.test(text), `${re} in: ${text.slice(0, 120)}`).toBe(false);
  // What each does say of confirming sits with it: a draft is what will happen, and is confirmed or declined.
  expect(told[0]).toContain("you'll see exactly what will happen, and confirm or decline it.");
  expect(tools(seat()).find((t) => t.name === "do")!.description).toContain("Before it takes effect you'll see exactly what will happen, and confirm or decline.");
  expect(tools(seat()).find((t) => t.name === "confirm")!.description).toBe("Confirm or decline something waiting for you to confirm, by its reference.");
  expect(drafts[0]).toContain("here is exactly what will happen:");
  for (const d of drafts) expect(d.endsWith("Confirm it, or decline it.")).toBe(true);
  // And the sentence itself is nowhere but the standing instructions (a draft's own words do not repeat it each time).
  for (const text of told.slice(1)) expect(text).not.toContain("What you confirm is all that is done");
});
