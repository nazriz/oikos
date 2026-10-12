#!/usr/bin/env bun
// What debriefs and exit accounts have cost, per seat and per account, by model, from the runs on file.
// `bun scripts/debrief-costs.ts <runs-dir> [--out FILE]`. It walks the directory for run logs (`*.jsonl.zst` or
// `*.jsonl` that have a `.debriefs.jsonl` beside them, so only runs that debriefed a seat in the present way), skips
// folders named `*.mock`, streams each log through `zstd -dc | grep` (nothing is loaded whole) and sums the `usage`
// annotations whose purpose is `debrief` (subject: the seat) or `account` (subject: the person), priced when made.
// A seat of the mock (cost 0) is left out. Prints a table and, per model, n, mean, median and max.
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Measured { run: string; kind: "debrief" | "account"; subject: string; model: string; calls: number; microusd: number }

function* logs(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() && !e.isFile()) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.endsWith(".mock") && e.name !== "node_modules") yield* logs(p); continue; }
    const m = e.name.match(/^(.*)\.jsonl(\.zst)?$/);
    if (m && !e.name.endsWith(".debriefs.jsonl") && !/\.(anchors|calls)\.jsonl$/.test(e.name) && existsSync(join(dir, `${m[1]}.debriefs.jsonl`))) yield p;
  }
}

async function measure(log: string, run: string): Promise<Measured[]> {
  const cmd = log.endsWith(".zst") ? `zstd -dc ${JSON.stringify(log)}` : `cat ${JSON.stringify(log)}`;
  const p = Bun.spawn(["sh", "-c", `${cmd} | grep -E '"annotation":"usage".*"purpose":"(debrief|account)"'`], { stdout: "pipe", stderr: "ignore" });
  const by = new Map<string, Measured>();
  let buf = "";
  const take = (line: string) => {
    if (!line) return;
    const b = JSON.parse(line).body;
    if (b.annotation !== "usage" || (b.purpose !== "debrief" && b.purpose !== "account") || b.provider === "mock") return;
    const model = `${b.provider}/${b.model}`, key = `${b.purpose}|${b.subject}|${model}`;
    const x = by.get(key) ?? { run, kind: b.purpose, subject: b.subject, model, calls: 0, microusd: 0 };
    x.calls++; x.microusd += b.cost_microusd; by.set(key, x);
  };
  const dec = new TextDecoder();
  for await (const chunk of p.stdout as any) { buf += dec.decode(chunk, { stream: true }); const parts = buf.split("\n"); buf = parts.pop()!; parts.forEach(take); }
  take(buf);
  await p.exited;
  return [...by.values()];
}

export const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return { n, mean: Math.round(s.reduce((a, b) => a + b, 0) / n), median: n % 2 ? s[(n - 1) / 2]! : Math.round((s[n / 2 - 1]! + s[n / 2]!) / 2), max: s[n - 1]! };
};

if (import.meta.main) {
  const args = process.argv.slice(2), oi = args.indexOf("--out");
  const out = oi >= 0 ? args.splice(oi, 2)[1] : undefined;
  const root = args[0] ?? "/Users/clawd/oikos/runs";
  const rows: Measured[] = [];
  for (const log of logs(root)) rows.push(...(await measure(log, log.slice(root.length + 1).replace(/\/[^/]*$/, ""))));
  const usd = (m: number) => (m / 1e6).toFixed(3);
  const L: string[] = [`Debrief and exit-account costs measured from the run logs under ${root} (usage annotations, purpose debrief / account, priced when made; mock and *.mock folders left out).`, ""];
  const seats = rows.filter((r) => r.kind === "debrief").sort((a, b) => a.run.localeCompare(b.run) || a.subject.localeCompare(b.subject));
  L.push("Per seat: run | seat | model | debrief calls | debrief USD");
  for (const r of seats) L.push(`${r.run} | ${r.subject} | ${r.model} | ${r.calls} | ${usd(r.microusd)}`);
  const accounts = rows.filter((r) => r.kind === "account");
  const bundle = (xs: Measured[]) => { const m = new Map<string, Measured[]>(); for (const x of xs) (m.get(x.model) ?? m.set(x.model, []).get(x.model)!).push(x); return m; };
  L.push("", "Per model, per seat: model | n | mean USD | median USD | max USD | mean calls");
  for (const [model, xs] of bundle(seats)) { const s = stats(xs.map((x) => x.microusd)); L.push(`${model} | ${s.n} | ${usd(s.mean)} | ${usd(s.median)} | ${usd(s.max)} | ${(xs.reduce((a, x) => a + x.calls, 0) / xs.length).toFixed(1)}`); }
  L.push("", "Per model, per exit account (all the account's calls): model | n | mean USD | median USD | max USD");
  for (const [model, xs] of bundle(accounts)) { const s = stats(xs.map((x) => x.microusd)); L.push(`${model} | ${s.n} | ${usd(s.mean)} | ${usd(s.median)} | ${usd(s.max)}`); }
  const text = L.join("\n") + "\n";
  if (out) writeFileSync(out, text); else process.stdout.write(text);
  if (out) writeFileSync(out.replace(/\.txt$/, "") + ".json", JSON.stringify(rows, null, 1));
}
