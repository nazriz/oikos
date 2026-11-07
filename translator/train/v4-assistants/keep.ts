// Step 3b: what two blind readers agree on, and what agrees with the writer's brief, kept as training rows.
//   bun keep.ts
// Reads <OUT>/requests.jsonl and the readers' answer files (<OUT>/readers/{sonnet,haiku}-NNN.json); writes
// <OUT>/train.jsonl, validation.jsonl (whole situations, one in ten), rejects.jsonl and manifest.json. Rows sharing five
// words running with the scope-request test set or a held-out case are dropped (counted, never listed).
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadHeldOut, sharesWording } from "../../eval/held-out";
import { cardRows } from "../../model/export";
import { labelled } from "../readers";
import { OUT, jsonl, meetsIntent, formsFiled } from "./lib";
const ANSWERS = join(import.meta.dir, "../../../runs/translator-v4-2026-11-07/assistants/readers");

// (Each request on one line, each break a space, every character where it stood, as the adapter shows a request to
// the model, `oneLine`: a line of a list that begins "- " would otherwise be read as a form's line.)
const requests: any[] = jsonl(join(OUT, "requests.jsonl")).map((r: any) => ({ ...r, request: r.request.replace(/[\r\n]/g, " ") }));
const answersOf = (reader: string) => {
  const out: { id: string; program: string }[] = [];
  for (const f of readdirSync(ANSWERS).filter((f) => f.startsWith(`${reader}-`) && f.endsWith(".json")).sort()) {
    copyFileSync(join(ANSWERS, f), join(OUT, "readers", f));
    try { out.push(...(JSON.parse(readFileSync(join(ANSWERS, f), "utf8")).answers ?? []).filter((a: any) => typeof a?.id === "string" && typeof a?.program === "string")); } catch { console.error(`not JSON: ${f}`); }
  }
  return out;
};
// (The second reader is Opus 5.5: Haiku 5.5 as a subagent left three in four of a batch of 100 as placeholders.)
const S = "claude-code/claude-sonnet-5-5 (subagent, blind)", H = "claude-code/claude-opus-5-5 (subagent, blind)";
// A reader who put a paper's free text in its own words (a scope request's `words`, advice, a report's words) is given
// the request's own words for it instead: the run of the request's whole words most like what it wrote (F1 of words
// at least 0.6), as a copy must be. Never an id, a figure or an option: only text fields, a letter's text, a
// statement's text. Counted (`aligned`).
const wordsAt = (t: string) => [...t.matchAll(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)].map((m) => ({ w: m[0].toLowerCase(), a: m.index!, b: m.index! + m[0].length }));
function aligned(request: string, value: string): string | undefined {
  if (request.includes(value)) return value;
  const R = wordsAt(request), V = wordsAt(value).map((x) => x.w);
  if (!V.length || !R.length) return undefined;
  const want = new Map<string, number>(); for (const w of V) want.set(w, (want.get(w) ?? 0) + 1);
  let best = { f: 0, a: 0, b: 0 };
  for (let i = 0; i < R.length; i++) {
    const got = new Map<string, number>(); let hit = 0;
    for (let j = i; j < R.length && j < i + V.length * 2 + 8; j++) {
      const w = R[j]!.w; const g = (got.get(w) ?? 0) + 1; got.set(w, g); if (g <= (want.get(w) ?? 0)) hit++;
      const prec = hit / (j - i + 1), rec = hit / V.length, f = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
      if (f > best.f) best = { f, a: R[i]!.a, b: R[j]!.b };
    }
  }
  return best.f >= 0.6 ? request.slice(best.a, best.b) : undefined;
}
let alignedCount = 0;
const textFields = (forms: string[]) => { const out = new Set<string>(); for (const l of forms) for (const m of l.matchAll(/([a-z_]+) \(text(?:, required)?\)/g)) out.add(m[1]!); return out; };
const reqOf = new Map(requests.map((r: any) => [r.id, r]));
function repaired(a: { id: string; program: string }): { id: string; program: string } {
  const r: any = reqOf.get(a.id);
  if (!r) return a;
  const tf = textFields(r.forms);
  let changed = false;
  const program = a.program.replace(/\b([a-z_]+)="((?:[^"\\]|\\.)*)"/g, (whole: string, k: string, v: string) => {
    if (!(tf.has(k) || k === "text")) return whole;
    const raw = v.replace(/\\(["\\])/g, "$1");
    if (request(r).includes(raw)) return whole;
    const got = aligned(request(r), raw);
    if (!got) return whole;
    changed = true;
    return `${k}="${got.replace(/(["\\])/g, "\\$1")}"`;
  });
  if (changed) alignedCount++;
  return { id: a.id, program };
}
const request = (r: any) => r.request as string;
const sonnet = answersOf("sonnet").map(repaired), haiku = answersOf("opus").map(repaired);
const strict = labelled(requests, [{ reader: S, answers: sonnet }, { reader: H, answers: haiku }]);
const intentOf = new Map(requests.map((r) => [r.id, r.intent]));
// Relaxed: where the two readers file the same papers and both agree with the writer's brief (the act, and a scope
// request's level where the brief fixed one) but differ in an optional field (a scope request's kind or access, a
// report's words), the first reader's program is kept if it passes every check of an example on its own (`labelled`
// with it as both readers: it copies the request, spans, two passes). Counted apart (`groups.key`).
const agreedIds = new Set(strict.examples.map((e) => e.id));
const opusOf = new Map(haiku.map((a) => [a.id, a.program]));
const relaxedAnswers = sonnet.filter((a) => {
  const o = opusOf.get(a.id), i = intentOf.get(a.id);
  if (agreedIds.has(a.id) || !o || !i) return false;
  return JSON.stringify(formsFiled(a.program)) === JSON.stringify(formsFiled(o)) && meetsIntent(i, a.program).ok && meetsIntent(i, o).ok && formsFiled(a.program).length > 0;
});
const relaxed = labelled(requests.filter((r) => relaxedAnswers.some((a) => a.id === r.id)), [{ reader: S, answers: relaxedAnswers }, { reader: `${S} (again)`, answers: relaxedAnswers }]);
const keyOf = new Map<string, string>([...strict.examples.map((e) => [e.id, "two readers"] as const), ...relaxed.examples.map((e) => [e.id, "same papers, first reader's fields"] as const)]);
// Implied by the card: where the two readers agreed and what is "not copied" is only the form's name, its office or
// an option of its field, all of which the two passes point at in the form's own line (encode.ts `cards`; v3's
// `withImplied`), the first reader's program is kept with those spans implied. `cardRows` below is the check.
const { withImplied } = await import("./implied");
const { spansIn, shapeOf } = await import("../data");
const { formOfLine } = await import("../blind");
const { sameButForFreeText } = await import("../meaning");
const { calls } = await import("@oikos/participants");
const sOf = new Map(sonnet.map((a) => [a.id, a.program]));
const impliedEx: any[] = [];
for (const r of strict.rejects) {
  if (r.why !== "not_copied" || relaxed.examples.some((e) => e.id === r.id)) continue;
  const q: any = reqOf.get(r.id), a = sOf.get(r.id), o = opusOf.get(r.id);
  // (Free text of a form compared as letters' text is (ruling A): a field the form's line types `text` is not compared,
  // but which fields are filled is; everything else by meaning.)
  const blank = (x: string) => { const tf = textFields(q.forms); return x.replace(/\b([a-z_]+)="((?:[^"\\]|\\.)*)"/g, (w: string, k: string) => (tf.has(k) ? `${k}="_"` : w)); };
  if (!q || !a || !o || !sameButForFreeText(blank(a), blank(o), q.currency ? { currency: q.currency } : {})) continue;
  const missing = String(r.detail ?? "").split("; ").map((x) => x.split("=").slice(1).join("="));
  if (!missing.every((v) => q.forms.some((l: string) => l.startsWith(`- ${v},`) || l.includes(`, to=${v},`) || new RegExp(`\\(one of [^)]*\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(l)))) continue;
  try {
    const program = calls.programText(calls.parseProgram(a));
    const spans = withImplied(spansIn(q.request, program, q.forms.map(formOfLine).filter(Boolean)), program, q.forms);
    impliedEx.push({ id: r.id, request: q.request, forms: q.forms, program, spans, kind: "positive", shape: shapeOf(calls.parseProgram(program)) });
  } catch { /* not a program the spans can be found for: left out */ }
}
for (const e of impliedEx) keyOf.set(e.id, "two readers (a form's text fields not compared), its name, office or option implied by its card");
const examples = [...strict.examples, ...relaxed.examples, ...impliedEx], rejects = strict.rejects.filter((r) => !relaxed.examples.some((e) => e.id === r.id) && !impliedEx.some((e) => e.id === r.id)), manifest = strict.manifest;
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
  // (On one line, each break a space, every character where it stood: as the adapter shows a request, `oneLine`.)
  const row = { id: `v4a/${e.id}`, request: e.request.replace(/[\r\n]/g, " "), forms: e.forms, program: e.program, spans: e.spans, kind: e.kind, shape: e.shape, origin: "generated", source: `v4 assistants/${i.situation}`, written_by: q.from.writer, verified_by: `${S} + ${H}`, currency: q.currency,
    groups: { writer: q.from.writer, style: i.style, intent: `${i.cls}/${i.type}`, part: "v4 assistants", situation: i.situation, key: keyOf.get(e.id)! } };
  let two: unknown; try { two = cardRows(row as never); } catch { two = undefined; }
  if (!two) { tally.not_two_passes++; continue; }
  kept.push(row);
  inc(tally.kept_by_intent, `${i.cls}/${i.type}`); inc(tally.kept_by_style, i.style); inc(tally.kept_by_writer, i.writer);
}
// How often each reader files scope_request where the brief was one, by style: a reader that misses a style is a finding.
const scopeRead: any = {};
for (const [name, xs] of [["sonnet", sonnet], ["opus", haiku]] as const) for (const a of xs) {
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
const out = { requests: requests.length, answered: { sonnet: sonnet.length, opus: haiku.length }, readers_agreed: strict.examples.length, implied_by_card: impliedEx.length, aligned_answers: alignedCount, relaxed: relaxed.examples.length, kept: kept.length, validation: kept.filter((r) => val.has(r.groups.situation)).length, ...tally, scope_filed_by_reader_and_style: scopeRead, label_manifest: { by_function: manifest.by_function, kept_from: manifest.kept_from } };
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
