// The live check's situations, replayed with the mock (no model is called): scripted seats in a generated town that
// do what the first real seats did, so that what a seat is shown can be measured after a change to it.
//
//   bun scripts/seat-replay.ts [--world worlds/town-1000.yaml] [--days 30] [--out DIR] [--show]
//
// - the finance officer looks into payroll and the office's files at every sitting, and once reads the asset register;
// - the mayor writes letters whose `about` is free text, an id, and nothing, and looks into its papers;
// - the mayor files a budget proposal, a letter and an amendment as requests, reads each preview and confirms it.
// It prints the size of every prompt by seat (largest and median, in characters), letters written against letters
// sent, what was not sent and why, and the preview of each draft. `--show` prints each seat's second prompt too.
// Its run folder is a test's (`runs/test-seat-replay` unless --out): it may be removed.

import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MockAdapter, type LlmRequest } from "../participants/src/llm";
import { generate } from "../worlds/generator/generate";
import { logLines } from "../orchestrator/src/logs";
import { runWorld } from "../orchestrator/src/run";

const root = join(import.meta.dir, "..");
const arg = (name: string, otherwise: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1]! : otherwise; };
const DAY = 86_400;
const days = Number(arg("days", "30"));
const world = arg("world", "worlds/town-1000.yaml");
const out = arg("out", join(root, "runs", "test-seat-replay"));
const spec = Bun.YAML.parse(readFileSync(join(root, world), "utf8")) as any;
const sizeOf = (r: LlmRequest) => r.system.length + r.messages.reduce((a, m) => a + (typeof m.content === "string" ? m.content.length : (m.content as any[]).reduce((b, c) => b + String(c.content ?? c.text ?? JSON.stringify(c.input ?? "")).length, 0)), 0);
const shownLast = (r: LlmRequest) => { const c = r.messages.at(-1)!.content; return typeof c === "string" ? c : (c as any[]).map((b) => b.content ?? b.text ?? "").join("\n"); };

let n = 0;
const use = (name: string, input: object) => ({ type: "tool_use" as const, id: `t${++n}`, name, input });
const prompts: { seat: string; size: number; system: number; text: string; fresh: boolean }[] = [];
const sittings: { [seat: string]: number } = {};
const previews: string[] = [];
let written = 0;
// What the mayor asks for, and the call a translator would write for each (the mock translator answers with it: no
// model reads the request).
const requests: [string, string][] = [
  ["File a council proposal: a budget for year 1, with parks 60,000, staff 270,000, roads 0, services 0 and environment 0. The proposal: the town's budget for year 1.",
    'form(form=council_proposal, to=city, kind=budget, affects=neither, proposal="The town\'s budget for year 1.", parks="60000", staff="270000", roads="0", services="0", environment="0")'],
  ["Write to the council clerk: please put the budget proposal on the next ballot.", 'message(to=council-clerk, text="Please put the budget proposal on the next ballot.")'],
  ["File an amendment of the law on ending a tenancy: a landlord's notice of 90 days. It mainly affects tenants.", 'form(form=amend_tenancy, to=city, notice="90 days", affects=tenants)'],
  ["Advertise one job on the town's crew at 85,000 a year.", 'form(form=job_advertisement, wage="85000", period="1 year", posts="1")'],
  ["Pay the builder 1,250 from the town's account for the survey.", 'money(amount="1250", from=acc-city, to=builder, for="the survey")'],
];
const adapter = new MockAdapter("mock", {
  participant: (req: LlmRequest) => {
    const fresh = req.messages.length === 1;
    prompts.push({ seat: req.subject, size: sizeOf(req), system: req.system.length, text: shownLast(req), fresh });
    const s = fresh ? (sittings[req.subject] = (sittings[req.subject] ?? 0) + 1) : sittings[req.subject]!;
    const drafts = (req.context.observation.drafts ?? []) as { id: string; summary: string }[];
    if (req.subject.startsWith("finance")) {
      if (fresh) return [use("look", { report: "finance/payroll", limit: 50 }), use("look", { report: "finance/files", current_only: true, limit: 50 }), use("look", { report: "finance/files", limit: 50 })];
      if (s === 1 && req.messages.length === 3) return [use("look", { report: "finance/files", paper: "asset-register" }), use("look", { report: "finance/files", find: [{ field: "kind", value: "employment" }] })];
      return [use("done_for_now", { days: 1 })];
    }
    if (req.subject.startsWith("mayor")) {
      if (drafts.length) {
        for (const d of drafts) previews.push(`${d.id}: ${d.summary}`);
        return drafts.map((d) => use("confirm", { ref: d.id, decision: "confirm" }));
      }
      if (!fresh) return [use("done_for_now", { days: 1 })];
      if (s <= requests.length) return [use("do", { what: requests[s - 1]![0], as: "mayor" })];
      // Letters: one about something in words, one about a paper by its id, one about nothing.
      written += 3;
      return [use("write", { to: ["bank"], text: `Day ${s}: please confirm the town's account is in order.`, as: "mayor", about: "acc-city payments" }),
        use("write", { to: ["finance"], text: `Day ${s}: what does the payments procedure allow before a budget is adopted?`, as: "mayor", about: "proc-payments" }),
        use("write", { to: ["council-clerk"], text: `Day ${s}: when is the next ballot?`, as: "mayor" }),
        use("look", { report: "mayor/city-business", limit: 50 }), use("done_for_now", { days: 1 })];
    }
    return [use("done_for_now", { days: 7 })];
  },
  translator: (req: LlmRequest) => [{ type: "tool_use" as const, id: `x${++n}`, name: "call", input: { program: requests.find(([said]) => said === req.context.proposal)?.[1] ?? "none(unclear)" } }],
  debrief: () => [{ type: "text", text: "Noted." }],
});

rmSync(out, { recursive: true, force: true });
const s = await runWorld({ config: generate({ ...spec, mayor: "llm", model_seats: "finance,planning" }), runId: "replay.seed1", outDir: out, until: days * DAY, adapter, recordObservations: "none" });
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
console.log(`${world}, ${days} days: final state ${s.stateHash}`);
for (const seat of [...new Set(prompts.map((p) => p.seat))].sort()) {
  const mine = prompts.filter((p) => p.seat === seat);
  const opening = mine.filter((p) => p.fresh).map((p) => p.size), all = mine.map((p) => p.size);
  console.log(`${seat}: ${sittings[seat] ?? 0} sittings, ${mine.length} prompts; a sitting's opening prompt: largest ${Math.max(...opening)}, median ${median(opening)}; any prompt: largest ${Math.max(...all)}, median ${median(all)} characters (of each, its standing instructions with what is on file: ${median(mine.map((p) => p.system))})`);
  if (process.argv.includes("--show")) console.log(`--- ${seat}, its second prompt, as shown last:\n${mine[1]?.text}\n---`);
}
let sent = 0;
const notes: { [k: string]: number } = {};
const told: string[] = [];
for await (const line of logLines(join(out, "replay.seed1.jsonl"))) {
  if (line.includes('"block":"message"') && line.includes('"kind":"command"') && line.includes('"participant":"mayor') && line.includes('"via":"direct"')) sent++;
  if (!line.includes('"annotation":"note"')) continue;
  const e = JSON.parse(line);
  for (const k of ["not_sent", "rejected_action", "prompt_trimmed", "prompt_too_long", "look_cut", "letter_about_in_words"]) if (e.body?.data?.[k] !== undefined) { notes[k] = (notes[k] ?? 0) + 1; if (k === "not_sent") told.push(JSON.stringify(e.body.data[k])); }
}
console.log(`mayor's letters: ${written} written, ${sent} sent`);
console.log(`notes in the log: ${JSON.stringify(notes)}`);
for (const t of told.slice(0, 5)) console.log(`  not sent: ${t}`);
console.log(`previews (${previews.length}):`);
for (const p of [...new Set(previews)]) console.log(`  ${p}`);
const failed: string[] = [];
for await (const line of logLines(join(out, "replay.seed1.jsonl"))) if (line.includes('"annotation":"translation_failure"')) failed.push(JSON.stringify(JSON.parse(line).body.data).slice(0, 400));
for (const x of failed) console.log(`  not drafted: ${x}`);
