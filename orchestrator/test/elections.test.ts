// Elections and the local paper (docs/design/world-expansion.md 3), in a generated town: the electoral office runs an
// election (notice, nominations, roll, ballot, count, appointment); electors vote in secret, about as many as the
// profile's turnout; the paper runs the news weekly; a town run well keeps its mayor, and a town whose mayor funds no
// works crew votes them out. Whoever is elected carries on the office from its record, not from scratch.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { instantRunoff } from "../../participants/src/behaviour/elections";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const POLL = 200;

async function town(name: string, negligent: boolean, days: number, standBps?: number, extra: object = {}, standsAgain = true) {
  const config = generate({ ...spec, years: 1, first_election_days: POLL, ...extra });
  if (!standsAgain) for (const x of config.participants) if (x.controller?.impl === "city.mayor_code") x.controller.params.stands_again = false;
  if (negligent) for (const x of config.participants) if (x.controller?.impl === "city.mayor_code") x.controller.params.staff_budget = 0;
  // (How readily people stand, where the test needs a contest, or none.)
  if (standBps !== undefined) for (const c of [...config.participants.map((x: any) => x.controller), ...config.templates.map((x: any) => x.controller)]) if (c?.params?.civic) c.params = { ...c.params, civic: { ...c.params.civic, stand_bps: standBps } };
  const out = join(root, "runs", `test-elections-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until: days * DAY });
  expect(s.participantErrors).toBe(0);
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = ev.filter((e) => e.event === "recorded").map((e) => e.record);
  const result = recs.find((r) => r.kind === "ballot_result" && r.data?.office === "mayor");
  const incumbent = recs.find((r) => r.kind === "nomination" && r.data?.incumbent)?.author;
  return { recs, result, incumbent, appointed: ev.filter((e) => e.event === "appointed" && e.position === "mayor") };
}

test("instant runoff: the last is out until someone has a majority", () => {
  // a 4, b 3, c 2 first preferences; c's go to b: b wins 5 to 4.
  const r = [...Array(4).fill(["a", "b"]), ...Array(3).fill(["b", "a"]), ...Array(2).fill(["c", "b"])];
  expect(instantRunoff(["a", "b", "c"], r)).toEqual({ winner: "b", rounds: [{ a: 4, b: 3, c: 2 }, { a: 4, b: 5 }] });
  expect(instantRunoff(["a"], []).winner).toBeUndefined();
});

test("an election in a town run well, and in a town whose mayor funds no works crew", async () => {
  const kept = await town("kept", false, POLL + 5, 1000);
  // The office's records, in order: a notice, nominations (the incumbent among them), the roll and the ballot, then
  // the result on polling day, and the winner appointed.
  const kinds = ["election_notice", "electoral_roll", "ballot_result"].map((k) => kept.recs.find((r) => r.kind === k && r.author === "electoral-system")?.at ?? -1);
  expect(kinds.every((t) => t > 0)).toBe(true);
  expect([...kinds].sort((a, b) => a - b)).toEqual(kinds);
  expect(Math.floor(kept.result.at / DAY)).toBe(POLL);
  expect(kept.incumbent).toBeTruthy();
  // The incumbent is kept, and reappointed.
  expect(kept.result.data.winner).toBe(kept.incumbent);
  expect(kept.appointed.map((e) => e.holder)).toEqual([kept.incumbent]);
  // Turnout near the profile's 83% (voting is compulsory; some don't).
  expect(kept.result.data.turnout_bps).toBeGreaterThan(7000);
  expect(kept.result.data.turnout_bps).toBeLessThan(9500);
  // The ballot is secret: each vote is for the electoral body's eyes only (never the town's: the body that runs the
  // election is its own, since 2026-10-08), and ranks the candidates.
  const votes = kept.recs.filter((r) => r.record === "vote" && r.ballot === kept.result.data.ballot);
  expect(votes.length).toBeGreaterThanOrEqual(kept.result.data.formal);
  expect(votes.every((v) => JSON.stringify(v.visible_to) === JSON.stringify(["electoral-commission"]))).toBe(true);
  expect(votes.some((v) => String(v.choice).includes(">"))).toBe(true);
  // The paper: weekly, in the weeks with something new on the public record (a small town's is thin); each item an
  // assertion about the town, at most five to an edition, the election among them.
  const news = kept.recs.filter((r) => r.kind === "news");
  const editions = [...new Set(news.map((r) => r.data.edition))];
  expect(editions.length).toBeGreaterThanOrEqual(4);
  expect(editions).toEqual(editions.map((_, i) => i + 1));
  const days = editions.map((e) => Math.floor(news.find((r) => r.data.edition === e).at / DAY));
  for (let i = 1; i < days.length; i++) expect((days[i]! - days[0]!) % 7).toBe(0);
  expect(news.every((r) => r.assertion?.about?.includes("city"))).toBe(true);
  for (const e of editions) expect(news.filter((r) => r.data.edition === e).length).toBeLessThanOrEqual(5);
  expect(news.some((r) => r.data.kind === "election_notice" || r.data.kind === "nomination")).toBe(true);

  // Nobody stands against the incumbent: elected unopposed when nominations close, with no ballot.
  const alone = await town("unopposed", false, POLL - 25, 0);
  expect(alone.result.data).toMatchObject({ winner: alone.incumbent, unopposed: true });
  expect(Math.floor(alone.result.at / DAY)).toBe(POLL - 30);
  expect(alone.recs.some((r) => r.kind === "ballot" && r.data?.electorate === "roll")).toBe(false);

  // A mayor who funds no works crew loses support (the waste piles up, and people complain): its first preferences well
  // below the kept town's, the same number standing. Whether that loses it the election depends on the town: with many
  // standing the vote splits, and where people are better off they forgive more. Not tested: who wins.
  const neglect = await town("neglected", true, POLL + 5, 1000);
  const share = (r: any, who: string) => (r.data.rounds[0][who] ?? 0) / Object.values(r.data.rounds[0] as { [k: string]: number }).reduce((a, b) => a + b, 0);
  expect(share(neglect.result, neglect.incumbent)).toBeLessThan(share(kept.result, kept.incumbent) * 0.75);
  // (Not compared: how many complain. A kept town's one-person crew can leave, and six weeks pass before the next starts.)

  // A mayor who doesn't stand again: a resident is elected, appointed, and carries on from the office's record (nothing
  // it had already acted on is acted on again).
  const voted = await town("successor", false, POLL + 40, 1000, {}, false);
  expect(voted.result.data.winner).toMatch(/^c\d+-self$|^par\./); // a resident
  const mayor = voted.appointed[0]?.holder;
  expect(mayor).toBe(voted.result.data.winner);
  // (Applications on a form have the form as their basis: a park and a road are two.)
  const office = voted.recs.filter((r) => r.in_position === "mayor" && r.basis && !String(r.basis).startsWith("form-"));
  const bases = office.map((r) => `${r.record}:${r.kind ?? ""}:${r.basis}`);
  expect(new Set(bases).size).toBe(bases.length);
}, 2_400_000);
