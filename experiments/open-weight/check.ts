// The open-weight smoke test's reading (smoke.ts): for each model's fork, from its record of calls and its log, whether
// its prompts fit (calls refused before they were made, sittings missed for a prompt too long, the largest prompt
// against its window), how long its calls took, and whether it could act through the translator (answers that could
// not be read, drafts made, signed off and refused, the translator's refusals), and whether it was debriefed. It
// writes nothing into the run's folder but `check.json`; the logs are read through the kernel's export into a temporary
// folder. A model "passes" if no call was refused for its size, at least one draft of its was signed off, and fewer
// than one answer in five could not be read: a bar for going on to a pilot, not a finding.
//
//   bun experiments/open-weight/check.ts runs/open-weight-smoke
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { kernelBinary } from "../../orchestrator/src/kernel";
import { priceTable } from "../../orchestrator/src/models";
import { promptTooLong } from "../../participants/src/llm/call";

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : 0;
};
const NOTES = ["unread_answer", "malformed_tool_use", "prompt_too_long", "sitting_missed", "dropped_tool_use"] as const;

export interface ArmCheck {
  arm: string; model: string; seed: number; context_tokens?: number;
  seat_calls: number; failed_calls: number; refused_for_size: number;
  ms: { p50: number; p95: number; max: number };
  prompt_tokens: { p50: number; max: number }; output_tokens: { p50: number; max: number }; cost_usd: number;
  notes: { [k: string]: number }; drafts: number; signed_off: number; declined: number; translator_refusals: number; debriefs: number;
  passes: boolean; why: string[];
}

async function lines(path: string, each: (o: any) => void) {
  for await (const l of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    if (!l.trim()) continue;
    try {
      each(JSON.parse(l));
    } catch {
      // (a torn last line of a fork that stopped: left out)
    }
  }
}

export async function checkArm(dir: string, seed: number, arm: string, model: string, tmp: string): Promise<ArmCheck> {
  const sd = join(dir, `seed-${seed}`);
  const calls: any[] = [];
  const callsFile = join(sd, `${arm}.calls.jsonl`);
  if (existsSync(callsFile)) await lines(callsFile, (r) => calls.push(r));
  const seat = calls.filter((r) => r.purpose === "participant" && r.model === model);
  const ok = seat.filter((r) => !r.error);
  const prompt = (r: any) => (r.input_tokens ?? 0) + (r.cache_read_tokens ?? 0) + (r.cache_write_tokens ?? 0);
  const notes: { [k: string]: number } = Object.fromEntries(NOTES.map((n) => [n, 0]));
  let drafts = 0, signedOff = 0, declined = 0, refusals = 0, debriefs = 0;
  const oklog = join(sd, `${arm}.oklog`);
  if (existsSync(oklog)) {
    const out = join(tmp, `${seed}-${arm}.jsonl`);
    const p = Bun.spawnSync([kernelBinary(), "export", oklog, "--out", out], { stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`export ${oklog}: ${p.stderr.toString().slice(0, 500)}`);
    await lines(out, (e) => {
      const b = e.body;
      if (e.kind !== "annotation" || !b) return;
      if (b.annotation === "note") for (const n of NOTES) if (b.data?.[n] !== undefined) notes[n]!++;
      if (b.annotation === "draft") drafts++;
      if (b.annotation === "signoff") b.decision === "accept" ? signedOff++ : declined++;
      if (b.annotation === "translation_failure") refusals++;
      if (b.annotation === "debrief") debriefs++;
    });
  }
  const context = (priceTable()[model] as { context_tokens?: number } | undefined)?.context_tokens;
  const refusedForSize = seat.filter((r) => r.error && promptTooLong(String(r.error))).length;
  const why: string[] = [];
  if (!seat.length) why.push("no seat call was made");
  if (refusedForSize || notes.prompt_too_long) why.push(`${refusedForSize} calls refused for their size, ${notes.prompt_too_long} sittings cut for a prompt too long`);
  if (!signedOff) why.push("no draft of its was signed off");
  if (ok.length && notes.unread_answer! / ok.length >= 0.2) why.push(`${notes.unread_answer} of ${ok.length} answers could not be read`);
  return {
    arm, model, seed, ...(context ? { context_tokens: context } : {}),
    seat_calls: seat.length, failed_calls: seat.length - ok.length, refused_for_size: refusedForSize,
    ms: { p50: pct(ok.map((r) => r.ms ?? 0), 0.5), p95: pct(ok.map((r) => r.ms ?? 0), 0.95), max: Math.max(0, ...ok.map((r) => r.ms ?? 0)) },
    prompt_tokens: { p50: pct(ok.map(prompt), 0.5), max: Math.max(0, ...ok.map(prompt)) },
    output_tokens: { p50: pct(ok.map((r) => r.output_tokens ?? 0), 0.5), max: Math.max(0, ...ok.map((r) => r.output_tokens ?? 0)) },
    cost_usd: Math.round(calls.reduce((a, r) => a + (r.cost_microusd ?? 0), 0) / 1e4) / 100,
    notes, drafts, signed_off: signedOff, declined, translator_refusals: refusals, debriefs,
    passes: !why.length, why,
  };
}

if (import.meta.main) {
  const dir = resolve(process.argv[2] ?? "runs/open-weight-smoke");
  const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
  const tmp = mkdtempSync(join(tmpdir(), "ow-check-"));
  const out: ArmCheck[] = [];
  try {
    for (const s of readdirSync(dir).filter((x) => /^seed-\d+$/.test(x))) {
      const seed = Number(s.slice(5));
      for (const a of spec.arms) if (a.steward?.kind === "model") out.push(await checkArm(dir, seed, a.name, a.steward.model, tmp));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  writeFileSync(join(dir, "check.json"), JSON.stringify(out, null, 2) + "\n");
  for (const c of out) {
    console.log(`${c.passes ? "PASS" : "FAIL"} ${c.arm} (${c.model})`);
    console.log(`  calls ${c.seat_calls} (${c.failed_calls} failed, ${c.refused_for_size} refused for size); seconds a call p50 ${(c.ms.p50 / 1000).toFixed(1)}, p95 ${(c.ms.p95 / 1000).toFixed(1)}, max ${(c.ms.max / 1000).toFixed(1)}`);
    console.log(`  prompt tokens p50 ${c.prompt_tokens.p50}, max ${c.prompt_tokens.max}${c.context_tokens ? ` of ${c.context_tokens}` : ""}; answer tokens p50 ${c.output_tokens.p50}, max ${c.output_tokens.max}; $${c.cost_usd}`);
    console.log(`  drafts ${c.drafts}, signed off ${c.signed_off}, declined ${c.declined}; translator refusals ${c.translator_refusals}; ${Object.entries(c.notes).map(([k, v]) => `${k} ${v}`).join(", ")}; debriefs ${c.debriefs}`);
    if (c.why.length) console.log(`  why: ${c.why.join("; ")}`);
  }
}
