// The share of requests the translator behind drafts (the owner, 2026-10-25): in every run's report and cost summary,
// from each request's route in the log; each retrain is to shrink it.
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { behindShare, shareText, translatorShare } from "../src/pilot-report";

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
