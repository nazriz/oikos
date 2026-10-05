// The translator corpus: every translation a run's language-model participants asked for, as a training example
// (docs/measurement.md, "The translator corpus"). Read from the run's log, which keeps all of it: what the participant
// proposed; what the translator was shown and said, turn by turn (its transcripts, joined by the draft they were for);
// the call it wrote and what that resolved to; the kernel's dry run; what the participant decided; and, if it was
// carried out, whether the kernel applied it. A translation that failed keeps why, and the model's raw answer.
//
// Logs from real-model runs are the only source of this data and can't be made again: keep them (never delete a
// language-model run's log).

import { statSync } from "node:fs";
import { currentLogs, logLines, runOf } from "./logs";

export interface CorpusExample {
  run: string;
  draft: string;
  t: number;
  participant: string;
  as?: string;
  proposal?: string;
  /** The translator's model, as its transcripts name it (mock/mock: synthetic, from the mock). */
  model?: string;
  synthetic: boolean;
  /** The translator's system prompt (by hash, and in full), and its exchange, turn by turn. */
  system_sha256?: string;
  system?: string;
  exchange: { turn: number; input: unknown; output: unknown }[];
  retries: { attempt: number; reason: string; call?: string }[];
  /** Drafted: the call, what it resolved to, the dry run. Failed: why, and what the model answered. */
  result: "drafted" | "failed" | "unknown";
  translator?: unknown;
  call?: string;
  blocks?: unknown[];
  summary?: string;
  check?: unknown;
  caveats?: string;
  failure?: { reason?: string; call?: string; invalid?: unknown; raw?: string };
  /** The participant's decision on the draft. */
  signoff?: { decision: string; note?: string };
  /** Carried out: the command's position in the log, and whether the kernel applied it. */
  executed?: { seq: number; applied: boolean; refusal?: unknown };
}

/** The logs in a folder (a run's, or a batch's), each run once (its current log: what a resumed run left behind,
 * `<run>.stopped-<n>.jsonl`, holds the same answers again, and is read only when named), or one log. */
export function logsIn(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return currentLogs(path);
}

/** The translator corpus of one log. */
export async function corpusOf(logPath: string): Promise<CorpusExample[]> {
  const run = runOf(logPath);
  const systems = new Map<string, string>();
  const ex = new Map<string, CorpusExample>();
  const bySeq = new Map<number, string>(); // command seq -> draft
  const get = (draft: string, t: number, participant = "") => {
    let x = ex.get(draft);
    if (!x) ex.set(draft, (x = { run, draft, t, participant, synthetic: false, exchange: [], retries: [], result: "unknown" }));
    return x;
  };
  for await (const line of logLines(logPath)) {
    if (!line) continue;
    const e = JSON.parse(line);
    const b = e.body ?? {};
    if (e.kind === "annotation") {
      if (b.annotation === "transcript") {
        const d = b.data ?? {};
        if (d.system_sha256 && d.system) systems.set(d.system_sha256, d.system);
        if (d.purpose !== "translator" || !d.ref) continue;
        const x = get(d.ref, e.t);
        x.model = `${d.provider}/${d.model}`;
        x.synthetic = d.provider === "mock";
        x.system_sha256 = d.system_sha256;
        x.exchange.push({ turn: d.turn, input: d.input, output: d.output });
      } else if (b.annotation === "draft") {
        const d = b.draft;
        const x = get(d.id, e.t, d.participant);
        Object.assign(x, { participant: d.participant, ...(d.as ? { as: d.as } : {}), proposal: d.proposal, result: "drafted", translator: d.translator, call: d.call, blocks: d.blocks, summary: d.summary, check: d.check, ...(d.caveats ? { caveats: d.caveats } : {}) });
      } else if (b.annotation === "translation_failure") {
        const d = b.data ?? {};
        const x = get(d.draft, e.t, b.subject);
        Object.assign(x, { participant: b.subject, proposal: d.proposal, result: "failed", failure: { reason: d.reason, ...(d.call ? { call: d.call } : {}), ...(d.invalid ? { invalid: d.invalid } : {}), ...(d.raw ? { raw: d.raw } : {}) } });
      } else if (b.annotation === "note" && b.data?.translation_retry) {
        const r = b.data.translation_retry;
        get(r.draft, e.t, b.subject).retries.push({ attempt: r.attempt, reason: r.reason, ...(r.call ? { call: r.call } : {}) });
      } else if (b.annotation === "signoff") {
        get(b.draft, e.t, b.participant).signoff = { decision: b.decision, ...(b.note ? { note: b.note } : {}) };
      }
    } else if (e.kind === "command" && b.command === "act" && b.provenance?.via === "translator" && b.provenance.draft) {
      bySeq.set(e.seq, b.provenance.draft);
      get(b.provenance.draft, e.t, b.participant).executed = { seq: e.seq, applied: true };
    } else if (e.kind === "event" && b.event === "action_refused" && bySeq.has(b.cause)) {
      const x = ex.get(bySeq.get(b.cause)!)!;
      x.executed = { seq: b.cause, applied: false, refusal: { code: b.code, ...(b.detail ? { detail: b.detail } : {}) } };
    }
  }
  const out = [...ex.values()].sort((a, b) => a.t - b.t || (a.draft < b.draft ? -1 : 1));
  for (const x of out) if (x.system_sha256 && systems.has(x.system_sha256)) x.system = systems.get(x.system_sha256);
  return out;
}
