#!/usr/bin/env bun
// Candidate readers for the translator pipeline, compared on the same requests: `bun orchestrator/src/reader-compare.ts
// <config.json>`. Each candidate reads the same blind requests exactly as a reader of the pipeline does (the same
// system message, task, batches and way of handing in: `askReader`, pipeline.ts), and what is measured is what choosing
// a pair of readers turns on:
//
//   read whole     of the requests given, how many came back as a program of the call language (and how many of those
//                  had to be repaired: quotation marks escaped by hand, `undoubled`);
//   agreement      with each other candidate, as the pipeline's label step would find it (the same program by meaning,
//                  or differing in `basis` alone, which the pipeline joins);
//   with labels    with the labels already settled for those requests (two earlier readers' agreement), where there is one;
//   cost, time     per request: the cost as the ledger has it (for Claude Code, what Claude Code reports where that is
//                  more than its tokens come to), and the time a batch took from asking to answer.
//
// The config: { "out": DIR, "requests": FILE, "labels": FILE, "limit": 40, "budget": N (the spending limit for the calls), "readers": ["provider/model", …],
// "stored": [DIR, …] }. `requests` is a pipeline's `lanes/<lane>/requests/unlabelled.jsonl`; `labels` its
// `label/examples.jsonl`. Requests with a label are taken first, then others, in a seeded order, up to `limit`. `stored`:
// pipeline folders whose readers' stored answers are measured the same way, with no call (their time is not known).
// Everything is written under `out`: `calls.jsonl` (every call's prompt, answer, usage and cost: model runs are kept),
// `read/<reader>/batch-N.json`, `claude-code.jsonl` (what Claude Code reported for each of its calls), `comparison.json`
// and `comparison.txt`. Run again, it makes only the calls that are missing (a batch's file is its answer whatever the
// prompt has become since: for a later prompt, a new `out`; `comparison.json` names the prompt it was made under).

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { calls } from "@oikos/participants";
import { TRANSLATOR_VERSION, translatorSystem } from "@oikos/translator";
import { formOfLine, type BlindAnswer } from "../../translator/train/blind";
import { sameProgram, type FormSpec } from "../../translator/train/data";
import { withListsQuoted, type Unlabelled } from "../../translator/train/readers";
import { askReader, Caller, undoubled, unionBasis, type Used } from "./pipeline";

export interface CompareConfig { out: string; requests: string; labels?: string; limit?: number; budget: number; readers: string[]; stored?: string[]; batch?: number; seed?: number }

const jsonl = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T) : []);
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-");
const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

/** Whether an answer is a program of the call language at all. */
export const isProgram = (program: string): boolean => {
  try {
    calls.parseProgram(withListsQuoted(program));
    return true;
  } catch {
    return false;
  }
};

const ctxOf = (u: Unlabelled) => {
  const forms = u.forms.map(formOfLine).filter((f): f is FormSpec => !!f);
  return { ...(u.currency ? { currency: u.currency } : {}), ...(forms.length ? { forms } : {}) };
};
/** Two answers to a request that the pipeline's label step would take as agreeing: the same by meaning, or differing in `basis` alone. */
export const agree = (u: Unlabelled, a: string, b: string): boolean => {
  try {
    return sameProgram(withListsQuoted(a), withListsQuoted(b), ctxOf(u)) || unionBasis(u.request, a, b, ctxOf(u)) !== undefined;
  } catch {
    return false;
  }
};

export interface ReaderMeasure {
  reader: string;
  requests: number;
  answered: number;
  read_whole: number;
  escaped_by_hand: number;
  with_labels?: { agreed: number; of: number };
  cost_usd: number;
  cost_usd_per_request: number;
  output_tokens: number;
  seconds?: number;
  seconds_per_request?: number;
  calls: number;
}

/** What a set of readers' answers to the same requests comes to. `raw`: answers as they came, before any repair. */
export function measure(requests: Unlabelled[], labels: Map<string, string>, readers: { reader: string; raw: Map<string, string>; used: Used; ms?: number }[]): { readers: ReaderMeasure[]; agreement: { a: string; b: string; agreed: number; of: number }[] } {
  const fixed = readers.map((r) => new Map([...r.raw].map(([id, p]) => [id, undoubled(p)])));
  const out = readers.map((r, i): ReaderMeasure => {
    const mine = fixed[i]!;
    const whole = requests.filter((u) => mine.has(u.id) && isProgram(mine.get(u.id)!));
    const labelled = whole.filter((u) => labels.has(u.id));
    return {
      reader: r.reader, requests: requests.length, answered: requests.filter((u) => mine.has(u.id)).length, read_whole: whole.length,
      escaped_by_hand: requests.filter((u) => r.raw.has(u.id) && undoubled(r.raw.get(u.id)!) !== r.raw.get(u.id)).length,
      ...(labels.size ? { with_labels: { agreed: labelled.filter((u) => agree(u, mine.get(u.id)!, labels.get(u.id)!)).length, of: requests.filter((u) => labels.has(u.id)).length } } : {}),
      cost_usd: r.used.cost_microusd / 1e6, cost_usd_per_request: r.used.cost_microusd / 1e6 / Math.max(1, requests.length), output_tokens: r.used.output_tokens,
      ...(r.ms !== undefined ? { seconds: Math.round(r.ms / 1000), seconds_per_request: Math.round(r.ms / 100 / Math.max(1, requests.length)) / 10 } : {}),
      calls: r.used.calls,
    };
  });
  const agreement: { a: string; b: string; agreed: number; of: number }[] = [];
  for (let i = 0; i < readers.length; i++) for (let j = i + 1; j < readers.length; j++) {
    const both = requests.filter((u) => fixed[i]!.has(u.id) && fixed[j]!.has(u.id));
    agreement.push({ a: readers[i]!.reader, b: readers[j]!.reader, agreed: both.filter((u) => agree(u, fixed[i]!.get(u.id)!, fixed[j]!.get(u.id)!)).length, of: requests.length });
  }
  return { readers: out, agreement };
}

export function tableText(title: string, m: ReturnType<typeof measure>): string {
  const L = [title];
  for (const r of m.readers)
    L.push(`  ${r.reader}: read whole ${r.read_whole}/${r.requests}${r.escaped_by_hand ? ` (${r.escaped_by_hand} escaped by hand, repaired)` : ""}${r.with_labels ? `; with the settled labels ${r.with_labels.agreed}/${r.with_labels.of}` : ""}; ${r.cost_usd.toFixed(4)} USD (${r.cost_usd_per_request.toFixed(4)} a request), ${r.output_tokens} output tokens${r.seconds !== undefined ? `; ${r.seconds} s (${r.seconds_per_request} s a request)` : ""}; ${r.calls} calls`);
  for (const a of m.agreement) L.push(`  ${a.a} with ${a.b}: ${a.agreed}/${a.of} agree`);
  return L.join("\n");
}

const noUse = (): Used => ({ input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_microusd: 0, calls: 0 });
const add = (a: Used, b: Used): Used => ({ input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens, cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens, cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens, cost_microusd: a.cost_microusd + b.cost_microusd, calls: a.calls + b.calls });

/** A pipeline folder's stored readers, measured as they answered (no call). */
export function measureStored(dir: string): ReturnType<typeof measure> | undefined {
  const lane = join(dir, "lanes", "train");
  const requests = jsonl<Unlabelled>(join(lane, "requests", "unlabelled.jsonl"));
  const readDir = join(lane, "read");
  if (!requests.length || !existsSync(readDir)) return undefined;
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { models: { readers: string[] } };
  const readers = manifest.models.readers.map((reader) => {
    const raw = new Map<string, string>();
    let used = noUse();
    const d = join(readDir, safe(reader));
    for (const f of existsSync(d) ? readdirSync(d).filter((f) => /^pass\d+-\d+\.json$/.test(f)).sort() : []) {
      const u = JSON.parse(readFileSync(join(d, f), "utf8")) as { answers: BlindAnswer[]; used: Used };
      for (const a of u.answers) if (!raw.has(a.id)) raw.set(a.id, a.program);
      used = add(used, u.used);
    }
    return { reader, raw, used };
  });
  return measure(requests, new Map(), readers);
}

export async function compare(cfg: CompareConfig, log: (line: string) => void = console.log): Promise<object> {
  const out = resolve(cfg.out);
  mkdirSync(out, { recursive: true });
  for (const r of cfg.readers) if (/astra/i.test(r)) throw new Error(`${r} is never used`);
  const seed = cfg.seed ?? 1;
  const pool = jsonl<Unlabelled>(cfg.requests);
  const labels = new Map(cfg.labels ? jsonl<{ id: string; program: string }>(cfg.labels).map((e) => [e.id, e.program]) : []);
  // Requests with a settled label first, then the others, each in a seeded order.
  const order = (xs: Unlabelled[]) => [...xs].sort((a, b) => (sha(`${seed}:${a.id}`) < sha(`${seed}:${b.id}`) ? -1 : 1));
  const requests = [...order(pool.filter((u) => labels.has(u.id))), ...order(pool.filter((u) => !labels.has(u.id)))].slice(0, cfg.limit ?? 40);
  // (One blind order for every reader, not the order above: a reader isn't shown the labelled ones first.)
  const blind = order(requests).map((u) => ({ id: u.id, request: u.request, forms: u.forms }));
  writeFileSync(join(out, "requests.jsonl"), requests.map((u) => JSON.stringify({ ...u, ...(labels.has(u.id) ? { label: labels.get(u.id) } : {}) })).join("\n") + "\n");
  writeFileSync(join(out, "config.json"), `${JSON.stringify(cfg, null, 1)}\n`);
  process.env.OIKOS_CLAUDE_CODE_LOG ??= join(out, "claude-code.jsonl");
  const caller = new Caller({ budget: cfg.budget, waitMinutes: 10, maxWaitHours: 2 }, join(out, "calls.jsonl"), {}, log);
  const system = translatorSystem();
  const task = readFileSync(join(import.meta.dir, "../../translator/train/in-situ/reader-call.txt"), "utf8").trimEnd();
  const size = cfg.batch ?? 30;
  const one = async (reader: string) => {
    const raw = new Map<string, string>();
    let used = noUse(), ms = 0;
    for (let at = 0, n = 1; at < blind.length; at += size, n++) {
      const batch = blind.slice(at, at + size);
      const file = join(out, "read", safe(reader), `batch-${n}.json`);
      let u = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { answers: BlindAnswer[]; raw: BlindAnswer[]; used: Used; ms: number }) : undefined;
      if (!u) {
        const r = await askReader(caller, reader, { step: "compare", unit: `${safe(reader)}/batch-${n}` }, system, task, batch);
        // (As they came, before any repair: read back from the ledger's last answer for this unit.)
        const last = jsonl<any>(join(out, "calls.jsonl")).filter((e) => e.annotation === "transcript" && e.unit === `${safe(reader)}/batch-${n}`).at(-1);
        const handed = (last?.data?.output ?? []).flatMap((b: any) => (b.type === "tool_use" && Array.isArray(b.input?.answers) ? b.input.answers : []));
        u = { answers: r.answers, raw: handed.length ? handed : r.answers, used: r.used, ms: r.ms };
        mkdirSync(join(out, "read", safe(reader)), { recursive: true });
        writeFileSync(file, `${JSON.stringify(u, null, 1)}\n`);
        log(`${reader} batch ${n}: ${r.answers.length} of ${batch.length} answered, ${r.repaired} repaired, ${(r.used.cost_microusd / 1e6).toFixed(4)} USD, ${Math.round(r.ms / 1000)} s`);
      }
      const ids = new Set(batch.map((b) => b.id));
      for (const a of u.raw) if (a && typeof a.id === "string" && typeof a.program === "string" && ids.has(a.id) && !raw.has(a.id)) raw.set(a.id, a.program);
      used = add(used, u.used);
      ms += u.ms;
    }
    return { reader, raw, used, ms };
  };
  // (The candidates at once: they are different models behind different sign-ins, and a batch waits on its model.)
  const settled = await Promise.allSettled(cfg.readers.map(one));
  const done = settled.flatMap((s, i) => (s.status === "fulfilled" ? [s.value] : (log(`${cfg.readers[i]}: ${String((s.reason as Error)?.message ?? s.reason).slice(0, 300)}`), [])));
  const fresh = measure(requests, labels, done);
  const stored = Object.fromEntries((cfg.stored ?? []).map((d) => [d, measureStored(resolve(d))]).filter(([, m]) => m));
  const result = { made: new Date().toISOString(), prompt: TRANSLATOR_VERSION, requests: requests.length, labelled: requests.filter((u) => labels.has(u.id)).length, fresh, stored, failed: settled.flatMap((s, i) => (s.status === "rejected" ? [{ reader: cfg.readers[i], why: String((s.reason as Error)?.message ?? s.reason).slice(0, 500) }] : [])) };
  writeFileSync(join(out, "comparison.json"), `${JSON.stringify(result, null, 1)}\n`);
  const text = [tableText(`Fresh: ${requests.length} requests (${result.labelled} with a settled label), each read by every candidate`, fresh), ...Object.entries(stored).map(([d, m]) => tableText(`Stored: ${d}`, m as ReturnType<typeof measure>))].join("\n\n");
  writeFileSync(join(out, "comparison.txt"), `${text}\n`);
  appendFileSync(join(out, "compare.log"), `${new Date().toISOString()} compared ${done.length} readers on ${requests.length} requests\n`);
  log(text);
  return result;
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) throw new Error("usage: bun orchestrator/src/reader-compare.ts <config.json>");
  await compare(JSON.parse(readFileSync(file, "utf8")) as CompareConfig);
}
