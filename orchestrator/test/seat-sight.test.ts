// What a seat is shown, in a real town (the live check of 2026-10-09). A finance officer and a mayor that look into
// their own papers at every sitting, as the first real seats did: what comes back is a list, a paper is read when it is
// asked for, the register a part at a time, and no prompt comes near what a model cannot take. On the code as it was,
// the finance officer's second prompt here is hundreds of thousands of characters.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MockAdapter, type LlmRequest } from "@oikos/participants/llm";
import { generate } from "@oikos/worlds/generator/generate";
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
  expect(largest).toBeLessThan(60_000); // (the mayor's, most of it what is on file for the office: its laws and forms)
  expect(Math.max(...finance.map((p) => p.size))).toBeLessThan(40_000);
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
