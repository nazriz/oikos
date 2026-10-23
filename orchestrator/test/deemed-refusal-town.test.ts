// A review never answered, in a living town (risk MT-21; docs/behaviour/decisions.md, "Deemed refusal"). Where the
// law requires a review before an appeal, a claimant whose request for review is never answered had no appeal route:
// the appeal's days ran from the answer, and none came. Where the place's law takes a review left unanswered as
// refused after so many days (Lower Saxony's: an objection not decided in three months may be taken to the social
// court, SGG s 88(2)), the claimant may now appeal from then; where it has no such rule (England's mandatory
// reconsideration), silence is still only silence. The office's answers are withheld for the whole run (the engine's
// `withhold`: it looks at each request and believes it answered; nothing reaches the claimant). No model is called.

import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadWorld } from "../src/batch";
import { engineModule } from "../src/kernel";
import { RustWorld } from "../src/rust-world";
import { existsSync } from "node:fs";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const have = !!engineModule() && existsSync(engineModule()!);

async function town(profile: string, days: number) {
  // (Frictions at three times the rates as sourced, as the recourse town's test runs them, so that a 300-person town
  // has refused claims early enough for the law's 91 days to run.)
  const { config } = await loadWorld(join(root, "worlds/town-300.yaml"), [`profile=${profile}`, "living.initiative_bps=10000", "living.friction_bps=30000"]);
  const people = new Set((config.participants as any[]).filter((p) => p.kind === "person").map((p) => p.person ?? p.id));
  // Every answer to a request for review, withheld.
  const withhold = Array.from({ length: 60 }, (_, i) => ({ what: "decision_review", nth: i + 1 }));
  const w = RustWorld.start({ ...config, log: { ...config.log, detail: "lean" } }, { until: days * DAY, withhold });
  for (let d = w.next(); d.due !== "end"; d = w.next()) for (const s of d.seats) w.submit(s.key, { type: "wait" });
  w.finish();
  const lines = new TextDecoder().decode(w.logBytes()!).trim().split("\n").map((l) => JSON.parse(l));
  const recs = lines.filter((e) => e.kind === "event" && e.body?.event === "recorded").map((e) => e.body.record);
  const asked = recs.filter((r) => r.kind === "review_request" && r.data?.matter === "claim_refused" && people.has(r.speaks_for) && !r.data?.brought_forward);
  const answered = recs.filter((r) => r.kind === "decision_review");
  const appeals = recs.filter((r) => people.has(r.speaks_for) && r.data?.matter === "claim_refused" && /application/.test(r.kind));
  const rejected = recs.filter((r) => r.data?.finding === "rejected" && appeals.some((a) => r.data?.application === a.id || r.basis === a.id));
  return { asked, answered, appeals, rejected };
}

test.skipIf(!have)("a review never answered is taken as refused where the place's law says so, and the claimant appeals from then; where the law has no such rule, nobody can", async () => {
  const [de, gb] = await Promise.all([town("de-ni-2026", 330), town("gb-eng-2026", 330)]);
  console.log(`deemed refusal: de-ni ${de.asked.length} asked, ${de.answered.length} answered, ${de.appeals.length} appealed, ${de.rejected.length} turned away; gb-eng ${gb.asked.length} asked, ${gb.appeals.length} appealed`);
  for (const x of [de, gb]) {
    expect(x.asked.length).toBeGreaterThan(0);
    expect(x.answered.length).toBe(0);
  }
  // Lower Saxony: appealed, each 91 days or more after asking, saying when the review was asked; none turned away for want of an answer.
  expect(de.appeals.length).toBeGreaterThan(0);
  for (const a of de.appeals) {
    expect(typeof a.data.review_asked_on).toBe("number");
    expect(a.at - a.data.review_asked_on).toBeGreaterThanOrEqual(91 * DAY);
  }
  expect(de.rejected.length).toBe(0);
  // England: the law has no deemed refusal, so the appeal route stays shut (what a real claimant does instead, a
  // complaint or a judicial review, is not built: MT-21's remainder).
  expect(gb.appeals.length).toBe(0);
}, 1_200_000);
