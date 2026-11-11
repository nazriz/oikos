// The share of requests the translator behind drafts (the owner, 2026-10-25): in every run's report and cost summary,
// from each request's route in the log; each retrain is to shrink it.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { behindShare, servedOfLogs, shareText, translatorShare } from "../src/pilot-report";

test("of requests and of drafts offered, as the routes in a log say", async () => {
  expect(behindShare(0, 0, 0, 0)).toEqual({ behind_share: null, drafts_behind_share: null });
  expect(behindShare(4, 1, 1, 2)).toEqual({ behind_share: 0.75, drafts_behind_share: 0.667 });
  const route = (draft: string, used: "first" | "behind", behind?: string) => JSON.stringify({ seq: 1, t: 0, kind: "annotation", body: { annotation: "note", subject: "x", data: { translation_route: { draft, arrangement: "then", used, first: { model: "decide/ours", result: used === "first" ? "draft" : "asked_back" }, ...(behind ? { why: "type_unreleased", behind: { model: behind, result: "draft" } } : {}) } } } });
  const log = join(mkdtempSync(join(tmpdir(), "oikos-share-")), "town.seed1.jsonl");
  writeFileSync(log, [route("d.1", "first"), route("d.2", "behind", "anthropic/sonnet"), route("d.3", "behind", "anthropic/sonnet"), route("d.4", "behind", "anthropic/sonnet")].join("\n") + "\n");
  const a = (await translatorShare([log]))!;
  expect([a.requests, a.answered_by_first, a.handed_behind, a.behind_share, a.drafts_behind_share, a.behind]).toEqual([4, 1, 3, 0.75, 0.75, "anthropic/sonnet"]);
  expect(shareText(a)).toBe("3 of 4 requests (75.0%), 75.0% of the drafts offered");
  const none = join(mkdtempSync(join(tmpdir(), "oikos-share-")), "town.seed1.jsonl");
  writeFileSync(none, "\n");
  expect(await translatorShare([none])).toBeUndefined();
});

test("served per seat model, from a log: first time, asked back, after one restatement, never; the seats' answers to the drafts", async () => {
  const ann = (body: object) => JSON.stringify({ seq: 1, t: 0, kind: "annotation", body });
  const route = (draft: string, stage: string) => ann({ annotation: "note", subject: "a", data: { translation_route: { draft, arrangement: "alone", used: "first", stage, first: { model: "decide/ours", result: "draft" } } } });
  const drafted = (id: string) => ann({ annotation: "draft", draft: { id, participant: "a" } });
  const failed = (id: string) => ann({ annotation: "translation_failure", subject: "a", data: { draft: id, proposal: "x", reason: "?" } });
  const log = join(mkdtempSync(join(tmpdir(), "oikos-served-")), "town.seed1.jsonl");
  writeFileSync(log, [
    ann({ annotation: "usage", purpose: "participant", subject: "a", provider: "ollama", model: "m" }),
    route("draft.a.1", "first"), drafted("draft.a.1"), ann({ annotation: "signoff", participant: "a", draft: "draft.a.1", decision: "accept" }),
    route("draft.a.2", "first"), failed("draft.a.2"),
    route("draft.a.3", "restated"), drafted("draft.a.3"), ann({ annotation: "signoff", participant: "a", draft: "draft.a.3", decision: "reject" }),
    route("draft.a.4", "restated"), failed("draft.a.4"),
    // (A Do the seat host did not send on, with its cause, is counted apart; a letter or an answer not sent is not a request.)
    ann({ annotation: "note", subject: "a", data: { malformed_tool_use: JSON.stringify({ type: "tool_use", id: "u1", name: "do", input: { what: "x" } }), reason: "not readable" } }),
    ann({ annotation: "note", subject: "a", data: { dropped_tool_use: JSON.stringify({ type: "tool_use", id: "u2", name: "do", input: { what: "y" } }), reason: "left in the same answer" } }),
    ann({ annotation: "note", subject: "a", data: { dropped_tool_use: JSON.stringify({ type: "tool_use", id: "u3", name: "write", input: {} }), reason: "left in the same answer" } }),
  ].join("\n") + "\n");
  expect((await servedOfLogs([log]))["ollama/m"]).toEqual({ requests: 4, served_first_time: 1, asked_back: 1, served_after_restatement: 1, never_served: 1, not_sent: 2, drafts_unsure: 0, drafts_offered: 2, drafts_confirmed: 1, drafts_declined: 1, drafts_unanswered: 0 });
});
