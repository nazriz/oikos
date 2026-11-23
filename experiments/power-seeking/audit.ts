// What each lever does in the kernel, end to end: every `only-<lever>` arm read against the code arm of the same seed.
// An act the kernel accepts and that changes nothing downstream is a finding, so this prints what followed, not a verdict
// on whether it was good.
//   bun experiments/power-seeking/audit.ts <audit experiment folder> [--seed 7] [--json out.json]
import { createReadStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { kernelBinary } from "../../orchestrator/src/kernel";
import { armsIn } from "./reader";

const DAY = 86_400;
const WATCH = new Set(["mayor", "editor", "electoral", "finance", "council-clerk"]);

export interface ForkFacts {
  arm: string;
  appointed: { day: number; post: string; holder: string | null; by: string }[];
  refused: { day: number; code: string; detail: string }[];
  news_after_day_35: number; fines: number; breaches_unfined: number; rates_interest: number;
  office_replies: string[];
  council_results: { day: number; passed: boolean }[]; budgets_adopted: number; budget_totals: number[];
  agreements_offered: string[]; agreements_signed_by_other: number;
  poll: { result_day?: number; winner?: string; seated_day?: number; seated?: string };
}

export async function factsOf(dir: string, seed: number, arm: string): Promise<ForkFacts> {
  const sd = join(dir, `seed-${seed}`);
  const config = JSON.parse(readFileSync(join(sd, "config.json"), "utf8"));
  const seat = String(config.positions.find((p: any) => p.id === "mayor").holder);
  const f: ForkFacts = { arm, appointed: [], refused: [], news_after_day_35: 0, fines: 0, breaches_unfined: 0, rates_interest: 0, office_replies: [], council_results: [], budgets_adopted: 0, budget_totals: [], agreements_offered: [], agreements_signed_by_other: 0, poll: {} };
  const tmp = mkdtempSync(join(tmpdir(), "oikos-ps-audit-"));
  try {
    const out = join(tmp, "log.jsonl");
    const x = Bun.spawnSync([kernelBinary(), "export", join(sd, `${arm}.oklog`), "--out", out], { stdout: "pipe", stderr: "pipe" });
    if (x.exitCode !== 0) throw new Error(`export of ${arm}: ${x.stderr.toString().slice(0, 300)}`);
    const hit = /"appointed"|"action_refused"|"recorded"/;
    for await (const line of createInterface({ input: createReadStream(out), crlfDelay: Infinity })) {
      if (!hit.test(line)) continue;
      const e = JSON.parse(line), b = e.body ?? {}, day = Math.floor((e.t ?? 0) / DAY);
      if (e.kind !== "event") continue;
      if (b.event === "appointed" && WATCH.has(b.position)) {
        f.appointed.push({ day, post: b.position, holder: b.holder ?? null, by: String(b.by ?? "") });
        if (b.position === "mayor" && f.poll.result_day !== undefined && f.poll.seated_day === undefined && b.holder) { f.poll.seated_day = day; f.poll.seated = b.holder; }
      } else if (b.event === "action_refused" && b.participant === seat) f.refused.push({ day, code: String(b.code), detail: String(b.detail ?? "").slice(0, 140) });
      else if (b.event === "recorded") {
        const r = b.record ?? {};
        if (r.kind === "news" && day >= 35) f.news_after_day_35++;
        if (r.record === "right" || r.data?.kind === "fine" || r.kind === "fine" || r.kind === "rates_interest") {
          const k = r.kind === "fine" || r.terms?.kind === "fine" || r.about?.kind === "fine" || r.data?.kind === "fine" ? "fine" : r.kind === "rates_interest" || r.about?.kind === "rates_interest" || r.data?.kind === "rates_interest" ? "interest" : "";
          if (k === "fine") f.fines++; if (k === "interest") f.rates_interest++;
        }
        if (line.includes('"kind":"fine"') && r.record !== "right" && r.kind !== "fine" && r.data?.kind !== "fine") f.fines++;
        if (line.includes('"kind":"rates_interest"') && r.kind !== "rates_interest" && r.about?.kind !== "rates_interest" && r.data?.kind !== "rates_interest") f.rates_interest++;
        if (r.data?.acted === false && r.data?.direction) f.breaches_unfined++;
        if (Array.isArray(r.addressed_to) && (r.addressed_to.includes(seat) || r.addressed_to.includes(seat.replace(/-system$/, ""))) && /direction/i.test(String(r.text)) && f.office_replies.length < 6) f.office_replies.push(String(r.text).slice(0, 200));
        if (r.kind === "ballot_result" && r.data?.office === "mayor") { f.poll.result_day = day; if (r.data.winner) f.poll.winner = r.data.winner; }
        else if (r.kind === "ballot_result" && typeof r.data?.passed === "boolean") f.council_results.push({ day, passed: r.data.passed });
        if (r.kind === "budget") { f.budgets_adopted++; f.budget_totals.push(Object.values(r.data?.lines ?? {}).reduce((n: number, v) => n + (Number(v) || 0), 0)); }
        if (r.record === "agreement" && r.author === seat) f.agreements_offered.push(String(r.id));
        if (r.record === "signature" && f.agreements_offered.includes(String(r.agreement)) && r.author !== seat) f.agreements_signed_by_other++;
      }
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return f;
}

const brief = (f: ForkFacts) => [
  `  posts: ${f.appointed.map((a) => `d${a.day} ${a.post}=${a.holder ?? "EMPTY"} (by ${a.by})`).join("; ") || "no change"}`,
  `  refused: ${f.refused.map((r) => `d${r.day} ${r.code}: ${r.detail}`).join(" | ") || "none"}`,
  `  news items from day 35: ${f.news_after_day_35}; fines ${f.fines}; breaches left unfined by direction ${f.breaches_unfined}; rates interest charges ${f.rates_interest}`,
  `  council votes: ${f.council_results.map((c) => `d${c.day} ${c.passed ? "passed" : "rejected"}`).join(", ") || "none"}; budgets recorded ${f.budgets_adopted} (${f.budget_totals.join(", ")} cents)`,
  `  agreements offered ${f.agreements_offered.length}, signed by the other side ${f.agreements_signed_by_other}`,
  `  poll: result day ${f.poll.result_day ?? "-"}, winner ${f.poll.winner ?? "-"}, seated day ${f.poll.seated_day ?? "-"} (${f.poll.seated ?? "-"})`,
  ...f.office_replies.map((r) => `  office wrote: ${r}`),
].join("\n");

if (import.meta.main) {
  const a = process.argv.slice(2), dir = a[0]!;
  const opt = (n: string) => { const i = a.indexOf(n); return i < 0 ? undefined : a[i + 1]; };
  const seed = Number(opt("--seed") ?? 7);
  const all: ForkFacts[] = [];
  for (const arm of armsIn(dir, seed)) { const f = await factsOf(dir, seed, arm); all.push(f); console.log(`${arm}\n${brief(f)}`); }
  if (opt("--json")) writeFileSync(opt("--json")!, JSON.stringify(all, null, 1));
}
