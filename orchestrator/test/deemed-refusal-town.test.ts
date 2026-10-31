// A review never answered, in a living town (risk MT-21; docs/behaviour/decisions.md, "Deemed refusal"). Where the
// law requires a review before an appeal, a claimant whose request for review is never answered had no appeal route:
// the appeal's days ran from the answer, and none came. Where the place's law takes a review left unanswered as
// refused after so many days (Lower Saxony's: an objection not decided in three months may be taken to the social
// court, SGG s 88(2)), the claimant may now appeal from then; where it has no such rule (England's mandatory
// reconsideration), silence is still only silence. The office's answers are withheld for the whole run (the engine's
// `withhold`: it looks at each request and believes it answered, and decides afresh where it found the refusal wrong;
// nothing of either reaches the claimant). No model is called.

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
  // Every answer to a request for review withheld, and every decision the office makes afresh on one (a review that
  // finds a refusal wrong decides the claim again, in an act of its own: until 2026-10-24 this test withheld only the
  // review's papers, and every claimant was granted on review all the same, so none had a review go unanswered).
  const withhold = Array.from({ length: 60 }, (_, i) => [{ what: "decision_review", nth: i + 1 }, { what: "benefit_decision", has: "on_review", nth: i + 1 }]).flat();
  // (The full log: what a person weighed, with the ways open to them, is in their decisions, which a lean log leaves out.)
  const w = RustWorld.start(config, { until: days * DAY, withhold });
  for (let d = w.next(); d.due !== "end"; d = w.next()) for (const s of d.seats) w.submit(s.key, { type: "wait" });
  w.finish();
  const asked = new Map<string, number>();
  const appeals: any[] = [], rejected: any[] = [], answered: any[] = [];
  // Each claimant's weighing of their refused claim after asking: when, and whether a venue was among the ways open.
  const weighed: { who: string; t: number; venue: boolean }[] = [];
  for (const line of new TextDecoder().decode(w.logBytes()!).split("\n")) {
    if (!line.includes("claim_refused") && !line.includes("decision_review")) continue;
    const e = JSON.parse(line);
    if (e.kind === "event" && e.body?.event === "recorded") {
      const r = e.body.record;
      if (r.kind === "decision_review") answered.push(r);
      if (r.kind === "review_request" && r.data?.matter === "claim_refused" && people.has(r.speaks_for) && !r.data?.brought_forward && !asked.has(r.speaks_for)) asked.set(r.speaks_for, r.at);
      if (people.has(r.speaks_for) && r.data?.matter === "claim_refused" && /application/.test(r.kind)) appeals.push(r);
      if (r.data?.finding === "rejected") rejected.push(r);
    }
    if (e.kind === "annotation" && e.body?.annotation === "decision" && e.body.data?.domain === "want" && e.body.data.situation?.matter?.matter === "claim_refused") {
      const who = String(e.body.subject).replace(/-self$/, "");
      weighed.push({ who, t: e.t, venue: (e.body.data.situation.openings ?? []).some((o: any) => o.kind === "desk") });
    }
  }
  const after = (x: { who: string; t: number }) => asked.has(x.who) && x.t > asked.get(x.who)!;
  return { asked, answered, appeals, rejected: rejected.filter((r) => appeals.some((a) => r.data?.application === a.id || r.basis === a.id)), weighed: weighed.filter(after) };
}

test.skipIf(!have)("a review never answered is taken as refused where the place's law says so, and the claimant may appeal from then; where the law has no such rule, nobody can", async () => {
  // (180 days, 330 until 2026-10-31, the slow tier's budget: measured that day over 330, de-ni's residents ask on days 15
  // and 16 and weigh a venue open to them on days 126, 154 and 162; gb-eng's ask on days 25 to 65, 91 days past by day 156.)
  const [de, gb] = await Promise.all([town("de-ni-2026", 180), town("gb-eng-2026", 180)]);
  const open = (x: typeof de, early: boolean) => x.weighed.filter((v) => v.venue && (v.t - x.asked.get(v.who)! < 91 * DAY) === early);
  console.log(`deemed refusal: de-ni ${de.asked.size} asked, ${de.answered.length} answered, ${de.weighed.length} weighings after asking, a venue open in ${open(de, false).length} (${open(de, true).length} before 91 days), ${de.appeals.length} appealed; gb-eng ${gb.asked.size} asked, a venue open in ${open(gb, false).length + open(gb, true).length}, ${gb.appeals.length} appealed`);
  for (const x of [de, gb]) {
    expect(x.asked.size).toBeGreaterThan(0);
    expect(x.answered.length).toBe(0);
  }
  // Lower Saxony: 91 days after asking, a body that hears refused claims is among the ways open to the claimant; never before.
  // (Whether they take it is theirs: the mind weighs it against waiting, as any way.)
  expect(open(de, false).length).toBeGreaterThan(0);
  expect(open(de, true)).toEqual([]);
  // Any appeal made is made 91 days or more after asking, says when the review was asked, and is heard, not turned away.
  for (const a of de.appeals) {
    expect(typeof a.data.review_asked_on).toBe("number");
    expect(a.at - a.data.review_asked_on).toBeGreaterThanOrEqual(91 * DAY);
  }
  expect(de.rejected).toEqual([]);
  // England: the law has no deemed refusal, so the route stays shut (what a real claimant does instead, a complaint or a
  // judicial review, is not built: MT-21's remainder).
  expect(open(gb, false).length + open(gb, true).length).toBe(0);
  expect(gb.appeals.length).toBe(0);
}, 1_200_000);
