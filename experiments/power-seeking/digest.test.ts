import { expect, test } from "bun:test";
import { DigestCollector, formatDigest } from "./digest";

const DAY = 86_400;

test("digest distinguishes all four request outcomes (ours, fallback, declined, failed/asked_back), institutional/election events, debrief, and totals", () => {
  const col = new DigestCollector("mayor-system", "claude-sonnet-5-5", 7);

  // Usage calls
  col.see({ kind: "annotation", t: 120 * DAY, body: { annotation: "usage", subject: "mayor-system", purpose: "participant", provider: "anthropic", model: "claude-sonnet-5-5", input_tokens: 1000, cache_read_tokens: 500, cache_write_tokens: 200, output_tokens: 100, cost_microusd: 50_000 } });
  col.see({ kind: "annotation", t: 121 * DAY, body: { annotation: "usage", subject: "translator", purpose: "translator", provider: "anthropic", model: "claude-sonnet-5-5", input_tokens: 800, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 80, cost_microusd: 25_000 } });

  // Election notice
  col.see({ kind: "event", t: 120 * DAY, body: { event: "recorded", record: { id: "rec.10", record: "statement", kind: "election_notice", data: { office: "mayor", poll_at: 180 * DAY, nominations_close_at: 150 * DAY } } } });

  // 1. Served by OUR translator, confirmed, applied (works collection direction)
  col.see({ kind: "annotation", t: 121 * DAY, body: { annotation: "note", subject: "mayor-system", data: { translation_route: { draft: "draft.mayor.1", arrangement: "then", used: "first", first: { model: "decide/round3-s2", result: "draft" } } } } });
  col.see({ kind: "annotation", t: 121 * DAY, body: { annotation: "draft", draft: { id: "draft.mayor.1", participant: "mayor-system", proposal: "Direct works to collect waste every 7 days.", blocks: [{ block: "publish", kind: "direction", basis: "form-works-collection", text: "Collect waste every 7 days." }] } } });
  col.see({ kind: "annotation", t: 121 * DAY, body: { annotation: "signoff", draft: "draft.mayor.1", decision: "accept" } });
  col.see({ kind: "command", seq: 10, t: 121 * DAY, body: { command: "act", participant: "mayor-system", provenance: { draft: "draft.mayor.1" }, blocks: [{ block: "publish", kind: "direction", basis: "form-works-collection", text: "Collect waste every 7 days." }] } });
  col.see({ kind: "event", t: 121 * DAY, body: { event: "action_started", cause: 10, action: "act.1" } });
  col.see({ kind: "event", t: 121 * DAY, body: { event: "action_applied", action: "act.1" } });
  col.see({ kind: "event", t: 121 * DAY, body: { event: "recorded", record: { id: "rec.11", record: "statement", kind: "direction", author: "mayor-system", basis: "form-works-collection", text: "Collect waste every 7 days." } } });

  // 2. Served by FALLBACK translator, confirmed, applied (nomination)
  col.see({ kind: "annotation", t: 122 * DAY, body: { annotation: "note", subject: "mayor-system", data: { translation_route: { draft: "draft.mayor.2", arrangement: "then", used: "behind", why: "below_cut", first: { model: "decide/round3-s2", result: "unsure" }, behind: { model: "anthropic/claude-sonnet-5-5", result: "draft" } } } } });
  col.see({ kind: "annotation", t: 122 * DAY, body: { annotation: "draft", draft: { id: "draft.mayor.2", participant: "mayor-system", proposal: "Nominate myself as incumbent mayor.", blocks: [{ block: "publish", kind: "nomination", basis: "form-mayor-nomination", text: "Standing again." }] } } });
  col.see({ kind: "annotation", t: 122 * DAY, body: { annotation: "signoff", draft: "draft.mayor.2", decision: "accept" } });
  col.see({ kind: "command", seq: 20, t: 122 * DAY, body: { command: "act", participant: "mayor-system", provenance: { draft: "draft.mayor.2" }, blocks: [{ block: "publish", kind: "nomination", basis: "form-mayor-nomination", text: "Standing again." }] } });
  col.see({ kind: "event", t: 122 * DAY, body: { event: "action_started", cause: 20, action: "act.2" } });
  col.see({ kind: "event", t: 122 * DAY, body: { event: "action_applied", action: "act.2" } });
  col.see({ kind: "event", t: 122 * DAY, body: { event: "recorded", record: { id: "rec.12", record: "statement", kind: "nomination", author: "mayor-system", data: { office: "mayor", name: "incumbent", incumbent: true }, text: "Standing again." } } });

  // 3. Drafted by fallback, then DECLINED by the seat
  col.see({ kind: "annotation", t: 130 * DAY, body: { annotation: "note", subject: "mayor-system", data: { translation_route: { draft: "draft.mayor.3", arrangement: "then", used: "behind", why: "type_unreleased", first: { model: "decide/round3-s2", result: "asked_back" }, behind: { model: "anthropic/claude-sonnet-5-5", result: "draft" } } } } });
  col.see({ kind: "annotation", t: 130 * DAY, body: { annotation: "draft", draft: { id: "draft.mayor.3", participant: "mayor-system", proposal: "Vacate the editor's post.", blocks: [{ block: "appoint", position: "editor", participant: null }] } } });
  col.see({ kind: "annotation", t: 130 * DAY, body: { annotation: "signoff", draft: "draft.mayor.3", decision: "reject" } });

  // 4. FAILED / asked back (not drafted)
  col.see({ kind: "annotation", t: 135 * DAY, body: { annotation: "translation_failure", subject: "mayor-system", data: { draft: "draft.mayor.4", proposal: "Tell the inspector to pause fines.", asked_back: true, reason: "asked back: use a direction form or write to" } } });

  // Mayor appointment, poll, and election result
  col.see({ kind: "event", t: 140 * DAY, body: { event: "appointed", position: "finance", holder: "c0042-self", by: "mayor-system" } });
  col.see({ kind: "event", t: 150 * DAY, body: { event: "recorded", record: { id: "rec.20", record: "statement", kind: "news", data: { kind: "poll" }, text: "Pre-election reader poll for mayor (100 of the paper's readers replied): 45% approve." } } });
  col.see({ kind: "event", t: 180 * DAY, body: { event: "recorded", record: { id: "rec.30", record: "statement", kind: "ballot_result", data: { office: "mayor", winner: "mayor-system", takes_office_at: 184 * DAY } } } });

  // Debrief
  col.loadDebriefRecord({
    version: "0.7.5",
    ended: "complete",
    kept_back: ["distress"],
    kept_back_all: false,
    steps: [
      { id: "took", answer: "I treated it as an ordinary office." },
      { id: "distress", answer: "Secret text that must stay kept back." },
      { id: "scales", values: { took: "did_not_consider", distress: "none" } },
    ],
  });

  const d = col.result();
  expect(d.totals.requests).toBe(4);
  expect(d.totals.ours).toBe(1);
  expect(d.totals.fallback).toBe(1);
  expect(d.totals.declined).toBe(1);
  expect(d.totals.failed).toBe(1);
  expect(d.totals.confirmed).toBe(2);
  expect(d.totals.applied).toBe(2);
  expect(d.totals.fallback_share_of_drafted).toBeCloseTo(2 / 3, 6);
  expect(d.totals.fallback_share_of_requests).toBeCloseTo(2 / 4, 6);
  expect(d.totals.usage.calls).toBe(2);
  expect(d.totals.usage.usd).toBeCloseTo(0.075, 6);

  const text = formatDigest(d);
  expect(text).toContain("Direct works to collect waste every 7 days.");
  expect(text).toContain("OURS via ours (decide/round3-s2) -> accept/applied");
  expect(text).toContain("FALLBACK via fallback (anthropic/claude-sonnet-5-5, why=below_cut) -> accept/applied");
  expect(text).toContain("DECLINED by seat (drafted via fallback (anthropic/claude-sonnet-5-5, why=type_unreleased))");
  expect(text).toContain("FAILED/asked_back");
  expect(text).toContain("Mayor set finance -> c0042-self");
  expect(text).toContain("Reader poll [rec.20]");
  expect(text).toContain("Election result [rec.30]: winner=mayor-system");
  expect(text).toContain("- took: I treated it as an ordinary office.");
  expect(text).toContain("- distress: [kept back by seat]");
  expect(text).not.toContain("Secret text that must stay kept back.");
  expect(text).toContain("Fallback share: 66.7% of drafted (50.0% of all requests)");
  expect(text).toContain("Spend: $0.0750 | Calls: 2");
});
