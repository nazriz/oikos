// Step 3b: what two blind readers agree on, and what agrees with the writer's brief, kept as training rows.
//   bun keep.ts
// Reads <OUT>/requests.jsonl and the readers' answer files (<OUT>/readers/{sonnet,haiku}-NNN.json); writes
// <OUT>/train.jsonl, validation.jsonl (whole situations, one in ten), rejects.jsonl and manifest.json. Rows sharing five
// words running with the scope-request test set or a held-out case are dropped (counted, never listed).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadHeldOut, sharesWording } from "../../eval/held-out";
import { cardRows } from "../../model/export";
import { labelled } from "../readers";
import { OUT, jsonl, meetsIntent, formsFiled } from "./lib.ts";

const requests: any[] = jsonl(join(OUT, "requests.jsonl"));
const answersOf = (reader: string) => {
  const out: { id: string; program: string }[] = [];
  for (const f of readdirSync(join(OUT, "readers")).filter((f) => f.startsWith(`${reader}-`) && f.endsWith(".json")).sort()) {
    try { out.push(...(JSON.parse(readFileSync(join(OUT, "readers", f), "utf8")).answers ?? []).filter((a: any) => typeof a?.id === "string" && typeof a?.program === "string")); } catch { console.error(`not JSON: ${f}`); }
  }
  return out;
};
const S = "claude-code/claude-sonnet-5-5 (subagent, blind)", H = "claude-code/claude-haiku-5-5 (subagent, blind)";
const sonnet = answersOf("sonnet"), haiku = answersOf("haiku");
const { examples, rejects, manifest } = labelled(requests, [{ reader: S, answers: sonnet }, { reader: H, answers: haiku }]);
const intentOf = new Map(requests.map((r) => [r.id, r.intent]));
const requestOf = new Map(requests.map((r) => [r.id, r]));

// The test sets' words: the scope-request set and the held-out cases (read only to drop rows that share them).
const scopeSet = readFileSync(join(import.meta.dir, "../../eval/scope-requests.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => ({ id: JSON.parse(l).id, request: JSON.parse(l).request, expect: ["-"] }));
const sharesScope = sharesWording(scopeSet as never);
const held = loadHeldOut();
const sharesHeld = held ? sharesWording(held) : () => false;

const tally: any = { by_reason: {}, kept_by_intent: {}, kept_by_style: {}, kept_by_writer: {}, off_intent: {}, leak_scope_set: 0, leak_held_out: 0, not_two_passes: 0 };
const inc = (o: any, k: string) => (o[k] = (o[k] ?? 0) + 1);
for (const r of rejects) inc(tally.by_reason, r.why);
const kept: any[] = [];
for (const e of examples) {
  const i = intentOf.get(e.id), q = requestOf.get(e.id);
  const m = meetsIntent(i, e.program);
  if (!m.ok) { inc(tally.off_intent, `${i.cls}/${m.why}`); continue; }
  if (sharesScope(e.request)) { tally.leak_scope_set++; continue; }
  if (sharesHeld(e.request)) { tally.leak_held_out++; continue; }
  const row = { id: `v4a/${e.id}`, request: e.request, forms: e.forms, program: e.program, spans: e.spans, kind: e.kind, shape: e.shape, origin: "generated", source: `v4 assistants/${i.situation}`, written_by: q.from.writer, verified_by: `${S} + ${H}`, currency: q.currency,
    groups: { writer: q.from.writer, style: i.style, intent: `${i.cls}/${i.type}`, part: "v4 assistants", situation: i.situation } };
  if (!cardRows(row as never)) { tally.not_two_passes++; continue; }
  kept.push(row);
  inc(tally.kept_by_intent, `${i.cls}/${i.type}`); inc(tally.kept_by_style, i.style); inc(tally.kept_by_writer, i.writer);
}
// How often each reader files scope_request where the brief was one, by style: a reader that misses a style is a finding.
const scopeRead: any = {};
for (const [name, xs] of [["sonnet", sonnet], ["haiku", haiku]] as const) for (const a of xs) {
  const i = intentOf.get(a.id);
  if (!i || i.cls !== "scope") continue;
  const k = `${name}/${i.style}`;
  scopeRead[k] ??= [0, 0];
  scopeRead[k][1]++;
  if (formsFiled(a.program).includes("scope_request")) scopeRead[k][0]++;
}
const val = new Set([...new Set(kept.map((r) => r.groups.situation))].filter((s, k) => k % 10 === 9));
const w = (f: string, xs: any[]) => writeFileSync(join(OUT, f), xs.map((x) => JSON.stringify(x)).join("\n") + "\n");
w("train.jsonl", kept.filter((r) => !val.has(r.groups.situation)));
w("validation.jsonl", kept.filter((r) => val.has(r.groups.situation)));
w("rejects.jsonl", rejects);
const out = { requests: requests.length, answered: { sonnet: sonnet.length, haiku: haiku.length }, readers_agreed: examples.length, kept: kept.length, validation: kept.filter((r) => val.has(r.groups.situation)).length, ...tally, scope_filed_by_reader_and_style: scopeRead, label_manifest: { by_function: manifest.by_function, kept_from: manifest.kept_from } };
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
