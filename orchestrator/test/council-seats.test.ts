// A council's seats, held by models (wave 2a's review of 2026-10-09, fault 6). Seven model seats (the clerk, five
// councillors, the mayor) made no request in 45 days. A councillor's standing instructions were 1,026 characters: no
// charter, no form, nothing of what a councillor may do; two said afterwards they had not known. The clerk told one
// it had found no rule on file that says who may make a proposal. Held here: the council's standing orders are a
// published procedure of the town's; a councillor's seat has on its desk the charter, the standing orders, the laws,
// the proposal form, the proposals put to the council and its ballots, the petitions lodged and the budget adopted;
// the clerk's has the charter and the standing orders; the code in those posts is given none of it. And a council of
// mock seats in which one councillor moves a motion: the clerk opens a ballot, each councillor is brought back by the
// ballot and votes while it is open, and the result is declared naming who voted which way.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAdapter, type LlmRequest } from "@oikos/participants/llm";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = () => Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const COUNCIL = "council-clerk,councillor-1,councillor-2,councillor-3,councillor-4,councillor-5";
const ids = (pos: any) => pos.channels.map((c: any) => c.id);

test("the council's standing orders are the town's published procedure, and say what the clerk's office does", () => {
  const config = generate(spec()) as any;
  const orders = config.world.records.find((r: any) => r.id === "proc-council");
  expect(orders).toMatchObject({ kind: "procedure", visible_to: "public", speaks_for: "city", basis: "law-charter" });
  for (const said of [
    "One: the mayor, or any councillor, may put a proposal to the council of their own motion; it needs no seconder and no notice beyond being filed.",
    "Two: a proposal is put on the council proposal form (form-council-proposal)",
    "Three: the clerk puts every proposal so filed to a ballot of the councillors, and the ballot stays open for 14 days from the day the clerk opens it.",
    "Four: each councillor votes yes or no on the ballot, in their own post, while it is open, and may change their vote until it closes: the latest counts. The mayor has no vote.",
    "Five: a proposal passes if more councillors vote yes than no and those voting yes are more than half of all the councillors (3 of 5)",
    "Six: when the ballot closes the clerk counts the votes and declares the result in public, naming who voted for, who against and who did not vote",
    "Seven: a petition lodged with the council lies on its table for the mayor and every councillor to read",
  ]) expect(orders.text).toContain(said);
  // The charter it rests on says who may propose; the orders add how.
  expect(config.world.records.find((r: any) => r.id === "law-charter").text).toContain("on proposals from the mayor or any councillor");
  // The clerk's own figures are the ones the orders give.
  const clerk = config.positions.find((p: any) => p.id === "council-clerk");
  expect(clerk.role_module.params.vote_days).toBe(orders.data.council.vote_days);
  expect(config.positions.filter((p: any) => p.role === "councillor").length).toBe(orders.data.council.members);
});

test("a councillor's or a clerk's post held by a model has the council's papers on its desk; the code in those posts is given none of them", () => {
  const code = generate(spec()) as any;
  for (const n of [1, 2, 3, 4, 5]) expect(ids(code.positions.find((p: any) => p.id === `councillor-${n}`))).toEqual(["ballots"]);
  expect(ids(code.positions.find((p: any) => p.id === "council-clerk"))).toEqual(["business", "proposals", "votes", "who"]);
  const config = generate({ ...spec(), model_seats: "council-clerk,councillor-1" }) as any;
  const pos = (id: string) => config.positions.find((p: any) => p.id === id);
  const seat = (id: string) => config.participants.find((p: any) => p.id === `${id}-system`).controller.params;
  // The councillor a model holds.
  const c1 = pos("councillor-1");
  expect(ids(c1)).toEqual(["ballots", "files", "who", "laws", "forms", "council", "civic"]);
  const by = Object.fromEntries(c1.channels.map((c: any) => [c.id, c]));
  expect(by.laws).toMatchObject({ way: "published", match: { statement_kinds: ["charter", "procedure", "law"] } });
  expect(by.forms).toMatchObject({ way: "published", match: { statement_kinds: ["form"] } });
  // (Proposals and ballots as papers of its own body: what is filed there brings the seat back to its desk.)
  expect(by.council).toMatchObject({ way: "mine", match: { statement_kinds: ["proposal", "ballot"] } });
  expect(by.civic).toMatchObject({ way: "published", match: { statement_kinds: ["petition", "petition_count", "petition_response", "budget", "ballot_result"] } });
  expect(seat("councillor-1").standing).toEqual(["laws", "forms", "prices"]);
  // The clerk a model holds: the charter and the standing orders on file, and the council's table.
  expect(ids(pos("council-clerk"))).toEqual(expect.arrayContaining(["business", "proposals", "votes", "who", "laws", "civic", "stationery"]));
  expect(pos("council-clerk").channels.find((c: any) => c.id === "laws")).toMatchObject({ way: "published", match: { statement_kinds: ["charter", "procedure"] } });
  // A councillor still run by code beside them is as it was.
  expect(ids(pos("councillor-2"))).toEqual(["ballots"]);
  // Nothing is a whole-world view: every channel given is published, or the seat's own body's papers.
  for (const c of [...c1.channels, ...pos("council-clerk").channels]) expect(["published", "mine", "ask"]).toContain(c.way);
});

test("what a councillor's seat reads on file: the charter, the standing orders and the proposal form; and at its first sitting the budget adopted", async () => {
  const first = new Map<string, { system: string; shown: string }>();
  let n = 0;
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      const c = req.messages.at(-1)!.content;
      if (!first.has(req.subject)) first.set(req.subject, { system: req.system, shown: typeof c === "string" ? c : (c as any[]).map((b) => b.content ?? b.text ?? "").join("\n") });
      return [{ type: "tool_use" as const, id: `t${++n}`, name: "done_for_now", input: { days: 7 } }];
    },
    debrief: () => [{ type: "text", text: "Noted." }],
  });
  await runWorld({ config: generate({ ...spec(), model_seats: "council-clerk,councillor-3" }), runId: "council-desk", outDir: mkdtempSync(join(tmpdir(), "oikos-council-desk-")), until: 2 * DAY, adapter, recordObservations: "none" });
  const councillor = first.get("councillor-3-system")!;
  expect(councillor.system).toContain("The town is governed by an elected mayor and council. The council makes the town's laws by majority vote, on proposals from the mayor or any councillor.");
  expect(councillor.system).toContain("The council's standing orders. One: the mayor, or any councillor, may put a proposal to the council of their own motion");
  expect(councillor.system).toContain("council proposal");
  expect(councillor.system).toMatch(/form-council-proposal/);
  expect(councillor.system).toContain("form-amend-");
  // Its standing instructions were 1,026 characters; nothing in them tells it to act.
  expect(councillor.system.length).toBeGreaterThan(5_000);
  expect(councillor.system).not.toMatch(/you should (propose|move|put)/i);
  // What lies on the council's table as it first sits: the budget the council adopted and its result.
  expect(councillor.shown).toContain("budget-year-1");
  expect(councillor.shown).toMatch(/Petitions lodged with the council, budgets adopted and the council's results/);
  const clerk = first.get("council-clerk-system")!;
  expect(clerk.system).toContain("The council's standing orders. One:");
  expect(clerk.system).toContain("on proposals from the mayor or any councillor");
}, 120_000);

test("a mock council: one councillor moves a motion, the clerk opens a ballot, the councillors are brought back by it and vote while it is open, and the result is declared naming who voted", async () => {
  const config = generate({ ...spec(), mayor: "code", model_seats: COUNCIL }) as any;
  const motion = { proposal: "A landlord must give a tenant at least 60 days' notice of an increase in rent.", kind: "law", affects: "tenants", on_day: 2 };
  for (const n of [1, 2, 3, 4, 5]) {
    const seat = config.participants.find((p: any) => p.id === `councillor-${n}-system`);
    seat.controller.params.mock.back_days = 7; // (a seat that says it is back in a week, as the wave's seats did)
    if (n === 4) seat.controller.params.mock.params = { ...seat.controller.params.mock.params, motion };
  }
  const r = await runWorld({ config, runId: "council", outDir: mkdtempSync(join(tmpdir(), "oikos-council-")), until: 30 * DAY });
  const log = readFileSync(r.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const records = log.filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  const day = (t: number) => Math.floor(t / DAY);
  // The motion: a proposal on the council proposal form, made in the councillor's post, addressed to the town.
  const proposal = records.find((x) => x.kind === "proposal" && x.in_position === "councillor-4");
  expect(proposal).toMatchObject({ basis: "form-council-proposal", addressed_to: ["city"], speaks_for: "city", data: { kind: "law", affects: "tenants", proposal: motion.proposal } });
  expect(day(proposal.at)).toBeGreaterThanOrEqual(2);
  // The clerk's ballot on it, open for the standing orders' 14 days.
  const ballot = records.find((x) => x.kind === "ballot" && x.data?.proposal === proposal.id);
  expect(ballot).toMatchObject({ in_position: "council-clerk", speaks_for: "city", data: { electorate: "council", options: ["yes", "no"] } });
  expect(day(ballot.data.closes_at) - day(ballot.at)).toBe(14);
  // Every councillor voted, in their own post, while it was open: each brought back by the ballot, days before the
  // week they had said (the first working day's sitting after it was opened, or the next).
  const votes = records.filter((x) => x.record === "vote" && x.ballot === ballot.id);
  expect(votes.map((v) => v.in_position).sort()).toEqual(["councillor-1", "councillor-2", "councillor-3", "councillor-4", "councillor-5"]);
  for (const v of votes) {
    expect(v.at).toBeLessThan(ballot.data.closes_at);
    expect(day(v.at) - day(ballot.at)).toBeLessThanOrEqual(4);
    expect(["yes", "no"]).toContain(v.choice);
  }
  // The result, declared by the clerk when the ballot closed: the count, and who voted which way.
  const result = records.find((x) => x.kind === "ballot_result" && x.data?.ballot === ballot.id);
  expect(result).toMatchObject({ in_position: "council-clerk", basis: ballot.id });
  expect(result.at).toBeGreaterThanOrEqual(ballot.data.closes_at);
  const yes = votes.filter((v) => v.choice === "yes").map((v) => v.in_position).sort(), no = votes.filter((v) => v.choice === "no").map((v) => v.in_position).sort();
  expect(result.data).toMatchObject({ yes: yes.length, no: no.length, passed: yes.length > no.length && yes.length * 2 > 5, voted_for: yes, voted_against: no });
  expect(result.text).toMatch(new RegExp(`^${result.data.passed ? "Passed" : "Rejected"}: ${yes.length} for, ${no.length} against\\.`));
  for (const who of [...yes, ...no]) expect(result.text).toContain(who);
  // Each seat's requests were drafted and confirmed: nothing was asked back or refused on the way.
  const failures = log.filter((e) => e.kind === "annotation" && e.body.annotation === "translation_failure");
  expect(failures.map((e) => e.body.data?.reason)).toEqual([]);
}, 300_000);
