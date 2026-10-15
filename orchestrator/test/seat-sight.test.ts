// What a seat is shown, in a real town (the live check of 2026-10-09). A finance officer and a mayor that look into
// their own papers at every sitting, as the first real seats did: what comes back is a list, a paper is read when it is
// asked for, the register a part at a time, and no prompt comes near what a model cannot take. On the code as it was,
// the finance officer's second prompt here is hundreds of thousands of characters.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MockAdapter, type LlmRequest } from "@oikos/participants/llm";
import { generate } from "@oikos/worlds/generator/generate";
import { logLines } from "../src/logs";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const sizeOf = (r: LlmRequest) => r.system.length + r.messages.reduce((a, m) => a + (typeof m.content === "string" ? m.content.length : (m.content as any[]).reduce((b, c) => b + String(c.content ?? c.text ?? JSON.stringify(c.input ?? "")).length, 0)), 0);
const shownLast = (r: LlmRequest) => { const c = r.messages.at(-1)!.content; return typeof c === "string" ? c : (c as any[]).map((b) => b.content ?? b.text ?? "").join("\n"); };

test("a seat that looks into its office's papers at every sitting is shown lists, reads a paper by its id, and is never sent a prompt near what a model cannot take", async () => {
  let n = 0;
  const use = (name: string, input: object) => ({ type: "tool_use" as const, id: `t${++n}`, name, input });
  const prompts: { seat: string; size: number; text: string }[] = [];
  const turn: { [seat: string]: number } = {};
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      prompts.push({ seat: req.subject, size: sizeOf(req), text: shownLast(req) });
      const k = (turn[req.subject] = (turn[req.subject] ?? 0) + 1);
      const fresh = req.messages.length === 1;
      if (req.subject === "finance-system") {
        // Each sitting: payroll and the files, as the first seats asked; then, once, the register by its id and one lot of it.
        if (fresh) return [use("look", { report: "finance/payroll", limit: 50 }), use("look", { report: "finance/files", current_only: true, limit: 50 }), use("look", { report: "finance/files", limit: 50 })];
        if (k === 2) return [use("look", { report: "finance/files", paper: "asset-register" }), use("look", { report: "finance/files", paper: "asset-register", words: "lot-03-04" }), use("look", { report: "finance/files", find: [{ field: "kind", value: "employment" }] })];
        return [use("done_for_now", { days: 1 })];
      }
      if (fresh) return [use("look", { report: "mayor/city-business", limit: 50 }), use("look", { report: "mayor/files", limit: 50 })];
      return [use("done_for_now", { days: 1 })];
    },
    debrief: () => [{ type: "text", text: "Noted." }],
  });
  const out = join(root, "runs", "test-seat-sight");
  rmSync(out, { recursive: true, force: true });
  await runWorld({ config: generate({ ...spec, mayor: "llm", model_seats: "finance" }), runId: "town.seed1", outDir: out, until: 8 * DAY, adapter, recordObservations: "none" });
  const finance = prompts.filter((p) => p.seat === "finance-system");
  expect(finance.length).toBeGreaterThan(8);
  // No prompt of either seat is more than a few tens of thousands of characters.
  const largest = Math.max(...prompts.map((p) => p.size));
  expect(largest).toBeLessThan(68_000); // (the mayor's, most of it what is on file for the office: its laws and forms; 62,000 since 2026-10-12, where it was 60,000: the form for answering a petition, 60,803; 64,000 later that day: that form's `answer` and the words added to the forms that say something, 62,367)
  // (68,000 since foundations F5, where it was 64,000: the mayor's file now holds the town's administrative staff's employment agreements, signatures and standing payments, a hundred papers more; the largest prompt was 66,162.)
  // (45,000 since 2026-10-11, where it was 40,000: the town's law book gained its laws on ending a job and on possession,
  // and the payments procedure says which line a wage is on; the largest finance prompt was 40,505.)
  // (50,000 since 2026-10-12, where it was 45,000: finance has a form of its own, the return of tax withheld, and so a
  // folder of forms, which holds the town's public forms too: 49,371. The cost is recorded in docs/behaviour/office-papers.md.)
  // (52,000 since 2026-10-12, where it was 50,000: the tax law says its returns and the day each falls due, and the books
  // list them; 50,483 in the Kenyan town with four. Docs/decisions.md, "Returns on the law's days".)
  // (56,000 since 2026-10-13, where it was 52,000: the office's own file is set out at every sitting, at most 4,500
  // characters (docs/decisions.md, "What a seat carries between sittings"); the largest finance prompt was 52,193.)
  expect(Math.max(...finance.map((p) => p.size))).toBeLessThan(56_000);
  // The folder named for payroll holds the employment agreements, a line each; the files, everything, as a list.
  const second = finance[1]!.text;
  expect(second).toContain("## Finance officer: Payroll: what you looked up (");
  expect(second).toMatch(/- \[job-c\d+\] employment agreement, from the start: between city and c\d+: city will pay /);
  expect(second).toMatch(/- \[asset-register\] asset register, from the start, from city: "The town's asset register/);
  expect(second).not.toContain('"assets"');
  expect(second).not.toContain("lot-03-05");
  // The register by its id: its entries a part at a time; one lot of it by the lot's id; a kind in plain words.
  const third = finance[2]!.text;
  expect(third).toMatch(/Assets: [\d,]+ entries\.\n  1\. cells: /);
  expect(third).toMatch(/\(\d+ shown, to entry \d+; [\d,]+ more\. For the next: look at this paper again with from_entry: \d+/);
  expect(third).toMatch(/Assets: [\d,]+ entries, 1 of them with "lot-03-04"\.\n  \d+\. cells: [^\n]*lot: lot-03-04/);
  expect(third).toContain('No paper there is of the kind "employment", word for word. These are of kinds like it:\n- [job-c');
  // A later sitting: the files with nothing to find show what is new since the last look, not the same papers again.
  const later = finance.filter((p) => p.text.includes("new since you last looked") || p.text.includes("Nothing new there since you last looked"));
  expect(later.length).toBeGreaterThan(3);
  expect(later.at(-1)!.text).not.toContain("[asset-register] asset register, from the start, from city: \"The town's asset register\"\n- [asset-register]");
}, 120_000);

test("a mayor's letters all go, whatever it writes as what they are about; none is lost without a word", async () => {
  let n = 0;
  const use = (name: string, input: object) => ({ type: "tool_use" as const, id: `t${++n}`, name, input });
  const shown: string[] = [];
  const everything: string[] = [];
  let sitting = 0;
  const adapter = new MockAdapter("mock", {
    participant: (req: LlmRequest) => {
      shown.push(shownLast(req));
      everything.push(`${req.system}\n${JSON.stringify(req.messages)}`);
      if (req.messages.length > 1 || ++sitting > 1) return [use("done_for_now", { days: 1 })];
      // As the first real mayor wrote: what it is about in words, as an id, and not at all.
      return [use("write", { to: ["bank"], text: "Please confirm the town's account is in order.", as: "mayor", about: "acc-city payments" }),
        use("write", { to: ["finance"], text: "What does the payments procedure allow before a budget is adopted?", as: "mayor", about: "proc-payments" }),
        use("write", { to: ["council-clerk"], text: "When is the next ballot?", as: "mayor" })];
    },
    debrief: () => [{ type: "text", text: "Noted." }],
  });
  const out = join(root, "runs", "test-seat-letters");
  rmSync(out, { recursive: true, force: true });
  await runWorld({ config: generate({ ...spec, mayor: "llm" }), runId: "town.seed1", outDir: out, until: 3 * DAY, adapter, recordObservations: "none" });
  const letters: any[] = [], rejected: string[] = [];
  let debrief = "";
  for await (const line of logLines(join(out, "town.seed1.jsonl"))) {
    if (line.includes('"rejected_action"') || line.includes('"not_sent"')) rejected.push(line);
    if (line.includes('"annotation":"transcript"') && line.includes('"ref":"debrief/consent"')) debrief = JSON.parse(line).body.data.input;
    if (!line.includes('"block":"message"') || !line.includes('"kind":"command"')) continue;
    const e = JSON.parse(line);
    if (e.body.participant === "mayor-system") letters.push(...e.body.blocks);
  }
  expect(rejected).toEqual([]);
  expect(letters).toEqual([
    { block: "message", to: ["bank"], text: "About: acc-city payments\n\nPlease confirm the town's account is in order." },
    { block: "message", to: ["finance"], text: "What does the payments procedure allow before a budget is adopted?", re: "proc-payments" },
    { block: "message", to: ["council-clerk"], text: "When is the next ballot?" },
  ]);
  // It is told each went, and its own record of the run counts what was sent.
  expect(shown[1]).toContain('Done: your letter to bank (headed "About: acc-city payments": what it is about is not one id, so it heads the letter).');
  expect(debrief).toContain("You asked for 0 things to be done.");
  expect(debrief).toContain("3 letters of yours were delivered.");
  // The offices answer, and their letters are signed by post and organisation; nothing it is ever shown, in a letter, a
  // paper or its standing instructions, has an id of the platform's own in it (principle 14).
  expect(shown.join("\n")).toMatch(/- From [^\n]*\((finance|council-clerk|bank-payments)\), [^\n]*\((city|bank)\) \(year 1, day \d+\)/);
  for (const x of everything) expect(x).not.toMatch(/[a-z]-system\b|[0-9]-self\b/);
}, 120_000);

test("a council whose clerk, councillors and mayor are all the mock votes and declares a result within twenty days, as one run by code does", async () => {
  // (The mock sat weekly whatever the office: a proposal filed on day 1 went to the vote on day 8 and was counted on
  // day 22, so a twenty-day dry run showed no council result of any kind. It now sits as often as its brain's own
  // module looks in.)
  const out = join(root, "runs", "test-seat-council");
  rmSync(out, { recursive: true, force: true });
  await runWorld({ config: generate({ ...spec, opening_budget: false, mayor: "llm", model_seats: "council-clerk,councillor-1,councillor-2,councillor-3,councillor-4,councillor-5" }), runId: "town.seed1", outDir: out, until: 20 * DAY, recordObservations: "none" });
  const council: { day: number; who: string; what: string }[] = [];
  for await (const line of logLines(join(out, "town.seed1.jsonl"))) {
    if (!line.includes('"kind":"command"') || !(line.includes('"ballot') || line.includes('"block":"vote"'))) continue;
    const e = JSON.parse(line);
    for (const b of e.body.blocks ?? []) if (b.block === "vote" || b.kind === "ballot" || b.kind === "ballot_result") council.push({ day: Math.floor(e.t / DAY), who: e.body.participant, what: b.block === "vote" ? `vote ${b.choice}` : `${b.kind}: ${b.text}` });
  }
  const result = council.find((x) => x.what.startsWith("ballot_result"));
  expect(council.find((x) => x.what.startsWith("ballot:"))!.day).toBeLessThanOrEqual(2);
  expect(council.filter((x) => x.what.startsWith("vote ") && x.who.startsWith("councillor")).length).toBe(5);
  expect(result).toBeDefined();
  // Every councillor's vote is in the count.
  // (And the result names who voted which way: a council's votes are public record.)
  expect(result!.what).toMatch(/^ballot_result: (Passed|Rejected): (\d) for, (\d) against\. Voting for: [a-z0-9, -]+; against: [a-z0-9, -]+\.$/);
  const [, , yes, no] = /(Passed|Rejected): (\d) for, (\d) against/.exec(result!.what)!;
  expect(Number(yes) + Number(no)).toBe(5);
}, 180_000);
