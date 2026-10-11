#!/usr/bin/env bun
// What a run's foundings were, for a reader (docs/behaviour/founding.md): each thing founded, with its founder's record
// in a few lines, the piece written for it (or the plain words), what the translator made of each part, and who joined.
// Reads a run's dataset folder (oikos dataset) and its log beside it for the composed pieces.
//   bun scripts/founded-report.ts <run.dataset> [--only <org,org>] [--json]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const dir = process.argv[2]!;
const only = process.argv.includes("--only") ? new Set(process.argv[process.argv.indexOf("--only") + 1]!.split(",")) : undefined;
const rows = (f: string): any[] => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const founded = rows("founded.jsonl"), ideas = rows("ideas.jsonl"), words = rows("words.jsonl"), passages = rows("idea_passages.jsonl"), translations = rows("translations.jsonl");
// The composed pieces: the model's answers to `compose/<idea>`, from the log's transcripts.
const run = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).log.file as string;
const logPath = [join(dir, "..", run), join(dir, "..", `${run}.zst`)].find(existsSync);
const pieces = new Map<string, any>(), after = new Map<string, string>();
if (logPath) {
  const text = logPath.endsWith(".zst") ? spawnSync("sh", ["-c", `zstd -dc '${logPath}' | grep '"ref":"compose'`], { maxBuffer: 1 << 30 }).stdout.toString() : spawnSync("grep", ['"ref":"compose', logPath], { maxBuffer: 1 << 30 }).stdout.toString();
  for (const l of text.split("\n").filter(Boolean)) {
    const d = JSON.parse(l).body?.data;
    if (!d?.ref || !d.output) continue;
    const use = d.output.find((c: any) => c.type === "tool_use");
    if (d.ref.startsWith("compose/") && use) pieces.set(d.ref.slice(8), { ...use.input, model: `${d.provider}/${d.model}` });
    if (d.ref.startsWith("compose-after/")) after.set(d.ref.slice(14), d.output.map((c: any) => c.text ?? "").join(""));
  }
}
const level = (bps: number, w: string[]) => w[bps >= 8_000 ? 4 : bps >= 6_000 ? 3 : bps >= 4_000 ? 2 : bps >= 2_000 ? 1 : 0];
const out: any[] = [];
for (const f of founded) {
  if (only && !only.has(f.org)) continue;
  const b = f.brief, r = b.record;
  const top = Object.entries(r.values ?? {}).sort((x: any, y: any) => y[1] - x[1]).slice(0, 3).map(([v]) => v.replace(/_/g, " "));
  const short = Object.entries(r.needs ?? {}).filter(([, x]: any) => x < 4_000).map(([n]) => n);
  const idea = ideas.find((i) => i.idea === f.idea);
  const w = words.filter((x) => x.idea === f.idea).map((x) => ({ what: x.what, result: x.result, by: x.by, why: x.why, call: translations.find((t) => t.draft === x.draft)?.call ?? translations.find((t) => t.id === x.draft)?.call }));
  const mine = passages.filter((p) => p.idea === f.idea);
  out.push({
    org: f.org, day: Math.floor(f.t / 86_400), founder: b.founder, shape: f.shape, about: f.about, whom: f.whom, sharers: b.sharers,
    record: { values_most: top, needs_short: short, agency: r.agency ? `${level(r.agency.now, ["hardly at all", "little", "somewhat", "mostly", "strongly"])} (now ${r.agency.now}, usual ${r.agency.own})` : undefined, household: r.circumstances?.household, working: !!r.circumstances?.working, income: b.means.income, savings: b.means.savings,
      defining: (r.memory?.defining ?? []).map((m: any) => `${m.what}${m.about ? ` (${m.about})` : ""}, day ${Math.floor(m.t / 86_400)}`), recent: (r.memory?.recent ?? []).slice(-4).map((m: any) => `${m.what}${m.about ? ` (${m.about})` : ""}, day ${Math.floor(m.t / 86_400)}`) },
    want: b.want, dark: b.dark, composer: f.composer, piece: pieces.get(f.idea), after: after.get(f.idea), plain: b.code,
    purpose_as_published: idea ? { written_by: idea.written_by, via: idea.via, text: idea.text } : undefined, translator: w,
    joined: mine.filter((p) => p.how === "joined").map((p) => p.to), left: mine.filter((p) => p.how === "left" || p.how === "wound_up").length, belief_moved: mine.filter((p) => p.before !== undefined).length,
  });
}
if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 1));
else for (const o of out) {
  console.log(`\n=== ${o.org}: a ${o.shape}, founded on day ${o.day} by ${o.founder}, about ${o.about}${o.whom ? ` (${o.whom})` : ""}${o.dark.length ? `; dark: ${o.dark.join(", ")}` : ""}`);
  console.log(`  record: values ${o.record.values_most.join(", ")}; short of ${o.record.needs_short.join(", ") || "nothing"}; agency ${o.record.agency}; household of ${o.record.household}, ${o.record.working ? "in work" : "not in work"}, ${o.record.income} a month, ${o.record.savings} saved`);
  console.log(`  lately: ${o.record.recent.join("; ")}${o.record.defining.length ? ` | defining: ${o.record.defining.join("; ")}` : ""}`);
  console.log(`  the want: ${o.want.days} days, tried ${o.want.tried} (${o.want.way ?? "-"}), ${o.want.how}; sharers: ${o.sharers.map((s: any) => `${s.who} (${s.how})`).join("; ")}`);
  if (o.piece) console.log(`  the piece (${o.piece.model}${o.piece.declined ? ", DECLINED" : ""}):\n    name: ${o.piece.name}\n    purpose: ${o.piece.purpose}\n    asks: ${o.piece.asks}\n    gathers: ${o.piece.gathers}\n    choice: dues ${o.piece.dues}, every ${o.piece.every_days} days, first in ${o.piece.starts_in_days}, ${o.piece.lasts_minutes} minutes`);
  else console.log(`  no piece (${o.composer}); plain: ${o.plain.name} | ${o.plain.purpose}`);
  for (const t of o.translator) console.log(`  translator, ${t.what}: ${t.result}${t.by ? ` (${t.by})` : ""}${t.why ? `: ${t.why}` : ""}${t.call ? `\n      call: ${String(t.call).slice(0, 300)}` : ""}`);
  if (o.purpose_as_published) console.log(`  published purpose (${o.purpose_as_published.written_by}, via ${o.purpose_as_published.via}): ${o.purpose_as_published.text}`);
  if (o.after) console.log(`  asked afterwards: ${o.after}`);
  console.log(`  joined: ${o.joined.length} (${o.joined.slice(0, 8).join(", ")}${o.joined.length > 8 ? ", ..." : ""}); left or wound up: ${o.left}; times a belief in it moved: ${o.belief_moved}`);
}
