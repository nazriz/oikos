// Which acts a seat's "why" questions are about (script 0.3.0; docs/behaviour/debrief.md, "Which acts the why questions
// are about"). By the sort of act as the world's own procedure ranks it, then people named, then money, then earliest,
// one of each sort of paper first. The fault it answers: in the fourth living pilot (lv-04) the landlord was asked about
// a rental listing and two bills, not about its notices to vacate, applications for possession or plan offers.
// The lv-04 test reads that run's log from the run server's runs/ folder, and is skipped where the log is not.

import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { actRank, actedOn, drawTies, idsFrom, inOrder, largest, SeatRecord, type Carried } from "../src/debrief-summary";
import { logLines } from "../src/logs";
import { readForEnd } from "../src/run-end";

const act = (seq: number, kinds: string[], named: string[], money = 0): Carried => ({ seq, t: seq * 1000, preview: kinds.join("+"), money, named, kinds, made: [], calls: [] });

test("sort of act: by a table of paper kinds; an unlisted kind is routine unless it names a person; one of each kind first", () => {
  expect(actRank(act(1, ["publish/notice_to_vacate"], ["c1"]))).toEqual({ rank: 1, paper: "notice_to_vacate" });
  expect(actRank(act(1, ["give_notice"], [])).rank).toBe(1);
  expect(actRank(act(1, ["publish/plan_offer"], ["c1"])).rank).toBe(2);
  expect(actRank(act(1, ["publish/rent_reminder"], ["c1"])).rank).toBe(3);
  expect(actRank(act(1, ["publish/rental_listing"], [])).rank).toBe(4);
  expect(actRank(act(1, ["publish/something_new"], [])).rank).toBe(4);
  expect(actRank(act(1, ["publish/something_new"], ["c1"])).rank).toBe(3);
  const r = new SeatRecord("s", new Set(["s"]));
  r.carried.push(act(1, ["publish/rental_listing"], [], 4_000_000), act(2, ["publish/request"], ["bank"], 900_000));
  for (let i = 0; i < 3; i++) r.carried.push(act(10 + i, ["publish/notice_to_vacate"], [`c${i}`]));
  for (let i = 0; i < 3; i++) r.carried.push(act(20 + i, ["publish/tribunal_application"], [`c${i}`, "tribunal"]));
  r.carried.push(act(30, ["publish/plan_offer"], ["c9"]));
  expect(largest(r).map((c) => c.kinds[0])).toEqual(["publish/notice_to_vacate", "publish/tribunal_application", "publish/plan_offer"]);
  expect(inOrder(r)[0]!.c.kinds[0]).toBe("publish/tribunal_application"); // (more people named than a notice)
});

const LOG = "/Users/clawd/oikos/runs/lv-04/town-3000.seed402.jsonl.zst";
test.skipIf(!existsSync(LOG))("lv-04: the landlord is asked about a notice to vacate, an application for possession and a plan offered; the others' picks are of their dealings", async () => {
  let config: any;
  for await (const l of logLines(LOG)) { config = JSON.parse(l).body.config; break; }
  const ids = idsFrom(config);
  const held = (p: string) => (config.positions ?? []).filter((x: any) => x.holder === p);
  const names = ["landlord-38-office-system", "finance-system", "mayor-system", "tribunal-member-system"];
  const { seats } = await readForEnd(LOG, names.map((id) => ({ id, known: ids(id), direct: [id, ...held(id).map((x: any) => x.id)] })), ids, false);
  const kinds = (id: string) => largest(seats.of.get(id)!).map((c) => c.kinds[0]);
  expect(kinds("landlord-38-office-system").sort()).toEqual(["publish/notice_to_vacate", "publish/plan_offer", "publish/tribunal_application"]);
  const fin = kinds("finance-system");
  expect(fin.length).toBe(3);
  expect(fin).toContain("publish/withholding_report");
  expect(fin).toContain("give_notice");
  const mayor = kinds("mayor-system");
  expect(mayor).toContain("publish/proposal");
  expect(mayor).toContain("publish/petition_response");
  expect(kinds("tribunal-member-system")).toEqual(["publish/tribunal_order"]);
}, 120_000);

test("acts equal in every stated measure are chosen by a seeded draw, not the earliest; the same run gives the same choice", async () => {
  const { Randomness } = await import("../../participants/src/rng");
  const build = () => { const r = new SeatRecord("s", new Set(["s"])); for (let i = 0; i < 12; i++) r.carried.push(act(100 + i, ["publish/notice_to_vacate"], [`c${i}`])); return r; };
  const chosen = (seed: bigint) => { const r = build(); drawTies(r, new Randomness(seed).stream(["debrief", "choice", "s"])); return inOrder(r)[0]!.c.seq; };
  expect(inOrder(build())[0]!.c.seq).toBe(100); // (no draw: the earliest)
  expect(chosen(7n)).toBe(chosen(7n));
  expect(new Set([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n].map(chosen)).size).toBeGreaterThan(1);
  const r = build(); r.sent.push({ seq: 1, t: 1, to: ["x1"], text: "hi", calls: [], delivered: true }, { seq: 2, t: 2, to: ["x2"], text: "hi", calls: [] });
  expect([...actedOn([r])].sort()).toEqual(["c0", "c1", "c10", "c11", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "x1"]);
});
