// A year of a town and its twin with one office in a mock seat that deals with nobody (the head of twin-draws.test.ts says why):
// everyone else draws, decides, acts, answers and prices the same on the same days. (Split out of twin-draws.test.ts at the test
// pruning, 2026-10-24.)

import { onRust } from "./lib/doubles";
import { expect, test } from "bun:test";
import { alike, answers, DAY, matched, share, town } from "./lib/twins";

test("a year with one office in a mock seat that sits at other hours and files papers of no effect: everyone else decides, answers, prices and draws the same on the same days", async () => {
  // (2026-10-12, draws and the moment. A seat acts at other hours than its code twin and files papers the twin does not,
  // so a stream named for the hour someone woke, or for a paper's number, fell differently for all the town. Now a draw
  // is named for the one who draws, the calendar day, what it is for and which time that was for them that day.)
  // (The ombudsman's office is run by a system in both towns, and its seat is a system's, as every office was until foundations F5: a person's
  // time spent on a seat is a true difference between a town and its twin, and what it moves is seen in the other tests of this file.)
  // The ombudsman's office deals with nobody in this town: its seat sits in office hours, reads its staff's reports and
  // files its own. Every draw but the seat's own, every decision, every act, every answer and every price must be the same.
  // (2026-10-23, the held cases settled. The two towns are the same town with the same posts: the twin is generated with the seat too, so that the ombudsman's office has the same
  // staff post in both, and differs from the other only in who holds the posts, the office's own code or a seat. Until then the twin had no staff post, and the decision on a complaint
  // was made by the officer in the twin and by the staff in the town with the seat, three seconds later: the people vary with the run seed, a complaint reached the ombudsman at seed 1, and 77 acts
  // of 119,749 differed by that reaction. A comparison of a town and its twin compares the same posts.)
  const [twin, seat, mayor] = await Promise.all([town("moments-code", { model_seats: "ombudsman-officer" }, undefined, 365, "code:ombudsman-officer"), town("moments-seat", { model_seats: "ombudsman-officer" }, undefined, 365, "seat:ombudsman-officer"), town("moments-mayor", { mayor: "llm" }, undefined, 365)]);
  const office = (pid: string) => pid.startsWith("ombudsman-officer");
  const papers = seat.records.filter((r) => r.kind === "staff_report").length;
  expect(papers).toBeGreaterThan(8);
  // (The staff post is in both towns, and so are its reports: what the seat adds is its hours, not papers. The numbering of papers by what a seat files is the first and second cases' subject.)
  expect(twin.records.filter((r) => r.kind === "staff_report").length).toBe(papers);
  const draws = alike(twin.draws, seat.draws, (pid) => !office(pid));
  const decided = matched(twin.decisions, seat.decisions, (pid) => !office(pid));
  // (An act addressed to the ombudsman is dealt with by the seat: a complaint it was sent and when its answer came is the seat's.)
  const acted = matched(twin.acts.filter((x) => !x.includes("ombudsman")), seat.acts.filter((x) => !x.includes("ombudsman")), (pid) => !office(pid));
  console.log(`twin moments, a seat that deals with nobody (${papers} papers of its own): draws ${share(draws)}; decisions ${share(decided)}; acts ${share(acted)}`);
  expect(draws.apart).toEqual([]);
  expect(decided.apart).toEqual([]);
  // (Foundations F7: act for act. Until then 6 acts of 122,000 differed by seconds from day 203: someone asleep when their body gave news (an injury in the
  // small hours) was met at the first cohort the engine had after it, and in a quiet stretch that was the ombudsman's own unit's, which in the town with the
  // seat sits at other hours than in the twin. The engine's advance now stops at the moment of body news (`advance_to_news`, kernel/src/schedule.rs), so the
  // news reaches the person when it happens, whoever wakes next.)
  expect(acted.apart).toEqual([]);
  expect(decided.all).toBeGreaterThan(5_000);
  expect([...answers(seat.records, new Set()).entries()].sort()).toEqual([...answers(twin.records, new Set()).entries()].sort());
  const prices = (rs: any[]) => rs.filter((r) => r.kind === "price_list" && /at world prices/.test(String(r.text))).map((r) => `${Math.floor(r.at / (30 * DAY))} ${String(r.text).replace(/rec\.[0-9]+/g, "rec")}`);
  expect(prices(seat.records)).toEqual(prices(twin.records));
  // And the mayor's seat, which does deal with the town (its orders reach planning, finance and the builders, and what
  // they do on other days is another town from there): it is not the same town, but what the seat did not reach is still
  // drawn alike. Reported; held at a floor that the draws named for the hour could not reach.
  const mDraws = alike(twin.draws, mayor.draws, (pid) => !pid.startsWith("mayor"));
  const mDecided = matched(twin.decisions, mayor.decisions, (pid) => !pid.startsWith("mayor"));
  console.log(`twin moments, the mayor's seat: draws ${share(mDraws)}; decisions ${share(mDecided)}`);
  // (A year of this town with draws named for the hour: 34% of draws and 35% of decisions alike; now 79% and 45%.)
  // (Not on the Rust world: the draw trace is the TS loop's, so there are no draws to set side by side; the rule is held by
  // actors/src/draws.rs's own tests, as for the draw-trace test below.)
  if (!onRust) expect(mDraws.same / mDraws.all).toBeGreaterThan(0.65);
  // (0.37 where it was 0.4, foundations F5: 39.9% now, 43.5% before. The mayor's seat is a person's time spent, so what the town does on other days
  // moves a little more; the floor stays above the 35% the hour-named draws gave.)
  expect(mDecided.same / mDecided.all).toBeGreaterThan(0.37);
}, 1_800_000);
