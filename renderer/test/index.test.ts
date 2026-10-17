// The view index and the causal trace on a hand-built log (fixture.ts): every kept line comes back as it was, postings
// equal a brute-force scan, the tracks say where people were and what they held, and a trace walks from a change to the
// seat that decided it, to what it rested on, to a law made before the run.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex } from "../src/indexer";
import { buildingPanel, orgPanel, personPanel } from "../src/panels";
import { Store } from "../src/store";
import { trace } from "../src/trace";
import { DAY, fixtureLines, writeFixtureRun } from "./fixture";

const base = mkdtempSync(join(tmpdir(), "oikos-renderer-index-"));
let s: Store;
beforeAll(async () => {
  const log = writeFixtureRun(join(base, "run"));
  await buildIndex(log, join(base, "views", "fixture"));
  s = new Store(join(base, "views", "fixture"));
});
afterAll(() => { s?.close(); rmSync(base, { recursive: true, force: true }); });

const ordOf = (pred: (e: any) => boolean) => { for (let o = 0; o < s.kept; o++) if (pred(s.line(o))) return o; throw new Error("no such line"); };

test("each kept line comes back byte for byte, and only the lines nobody watching needs are dropped", () => {
  const lines = fixtureLines().slice(1);
  const kept = lines.filter((l) => !/"command":"(observe|advance_to_news)"|"event":"(action_started|action_applied|occupied)"|"annotation":"debrief"|"kind":"end"/.test(l) && !(/"event":"vacated"/.test(l) && /"reason":"left"/.test(l)));
  expect(s.kept).toBe(kept.length);
  kept.forEach((l, i) => expect(s.text(i)).toBe(l));
  for (let o = 0; o < s.kept; o++) expect(s.text(o)).not.toContain("SECRET-DEBRIEF");
});

test("a person's postings equal a brute-force scan of the kept lines", () => {
  for (const id of ["c1", "c1-self", "acc-c1", "rec.1", "tribunal"]) {
    const brute: number[] = [];
    for (let o = 0; o < s.kept; o++) { const t = s.text(o); if (t.slice(0, t.lastIndexOf(',"hash"')).includes(`"${id}"`)) brute.push(o); }
    // (decision and outcome annotations are posted under their subject only)
    const got = [...s.postings(id)].filter((o) => !s.nameOf(o).startsWith("annotation:decision"));
    expect(got).toEqual(brute.filter((o) => !s.nameOf(o).startsWith("annotation:decision")));
  }
});

test("where everyone was, at midnights and in between, and what they held", () => {
  const c2 = s.personIdx.get("c2")!;
  const spaceOf = (w: number) => (w ? s.meta.spaces[w - 1]!.id : "");
  expect(spaceOf(s.whereAt(0)[c2]!)).toBe("house-2/dwelling.1");
  expect(spaceOf(s.whereAt(DAY + 3000)[c2]!)).toBe("house-2/dwelling.1");
  expect(spaceOf(s.whereAt(DAY + 4000)[c2]!)).toBe("hall/workplace.1");
  expect(spaceOf(s.whereAt(2 * DAY)[c2]!)).toBe("hall/workplace.1"); // (the midnight keyframe)
  expect(spaceOf(s.whereAt(2 * DAY + 2000)[c2]!)).toBe("house-2/dwelling.1");
  // money is conserved and each day's holding is the fold of the transfers before it
  const c1 = s.series("money", s.holderIdx.get("c1")!), m2 = s.series("money", s.holderIdx.get("c2")!);
  expect(c1.slice(0, 3)).toEqual([10000, 10000, 9800]);
  expect(m2.slice(0, 3)).toEqual([5000, 5000, 5200]);
  for (let d = 0; d < c1.length; d++) expect(c1[d]! + m2[d]!).toBe(15000);
  expect(s.series("agency", s.personIdx.get("c1")!).slice(0, 3)).toEqual([-1, -1, 4100]);
});

test("the trace of an order: the seat that decided it, why, what it rested on, back to a law made before the run", () => {
  const order = ordOf((e) => e.body?.record?.id === "rec.2");
  const links = trace(s, order, "c1");
  expect(links[0]).toMatchObject({ role: "change", record: "rec.2" });
  expect(links[1]).toMatchObject({ role: "act", who: "member-system", as: "member", cls: "seat", model: "mock/mock", status: "applied" });
  expect(links[1]!.why).toMatchObject({ kind: "seat" });
  const basis = links.find((l) => l.record === "rec.1")!;
  expect(basis).toMatchObject({ role: "basis" });
  const applicant = links.find((l) => l.role === "act" && l.who === "c1-self")!;
  expect(applicant.cls).toBe("self"); // (traced for c1: their own application)
  expect(links.at(-1)).toMatchObject({ role: "genesis", record: "law-1", cls: "world" });
});

test("a standing payment leads to the instruction and the person who gave it, with the decision they recorded", () => {
  const pay = ordOf((e) => e.body?.event === "transfer" && e.body.per_instruction === "rec.3");
  const links = trace(s, pay, "c1");
  expect(links.find((l) => l.role === "act" && l.who === "bank-payments-system")?.cls).toBe("system");
  const instr = links.find((l) => l.record === "rec.3")!;
  expect(instr.role).toBe("instruction");
  const giver = links.find((l) => l.role === "act" && l.who === "c2-self")!;
  expect(giver.cls).toBe("person");
  expect(giver.why).toMatchObject({ kind: "decision" });
  expect(giver.why!.text).toContain("chose pay");
});

test("who decided each change that reached a person, and where the seat's act landed", () => {
  // pulses: the order (hard, a seat's), the money it moved, the standing payment
  const P = [...Array(s.pulses.length / 6).keys()].map((i) => ({ person: s.meta.holders[s.pulses[i * 6 + 1]!], cls: s.pulses[i * 6 + 3]!, flags: s.pulses[i * 6 + 4]! }));
  expect(P.filter((p) => p.person === "c1" && p.cls === 3 && p.flags & 1)).toHaveLength(1);
  expect(P.some((p) => p.person === "c1" && p.cls === 1)).toBe(true); // c2's standing payment to c1: another person
  expect(s.seatActs).toHaveLength(1);
  expect(s.seatActs[0]).toMatchObject({ participant: "member-system", status: "applied", draft: "draft.member-system.1" });
  expect(s.seatActs[0]!.targets.map((t) => t.id).sort()).toEqual(["c1", "c2"]);
  expect(s.seatActs[0]!.targets.find((t) => t.id === "c1")!.struct).toBe(0); // house-1
  expect(s.seatActs[0]!.from).toBe(2); // the tribunal works from the hall
});

test("panels: a person's life and record, an organisation's posts and backlog, a building's occupants", () => {
  const p = personPanel(s, "c1", 3 * DAY)!;
  expect(p).toMatchObject({ age: 30, home: { structure: "house-1" }, record: { changes: 1 } });
  expect(p.byClass.seat).toBe(2); // the order and the money it moved
  expect(p.byClass.person).toBe(1); // c2's standing payment
  expect(p.events.some((e) => e.hard && e.cls === "seat")).toBe(true);
  const o = orgPanel(s, "tribunal", 3 * DAY)!;
  expect(o.posts[0]).toMatchObject({ id: "member", cls: "seat", model: "mock/mock" });
  expect(o.backlog.open).toBe(0); // the application was answered
  expect(orgPanel(s, "tribunal", DAY)!.backlog.open).toBe(1);
  const b = buildingPanel(s, 2, DAY + 5000)!;
  expect(b.inside.map((x) => x.person)).toEqual(["c2"]);
  expect(b.usedBy.map((x) => x.id)).toEqual(["tribunal"]);
});
