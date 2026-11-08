// Translator v4, round 4, step 1: a third blind reader on the surest disagreements between a key and the models, on the
// validation sets the cut-off is certified on (validation-real and the pilot's validation side; never a test set).
//
//   bun translator/train/v4-pilot/third.ts select --rows <rows.jsonl>... --a <answers.jsonl>... --out <dir> [--n 80] [--min 0.99]
//   bun translator/train/v4-pilot/third.ts apply --rows <rows.jsonl>... --out <dir>
//
// select: every request where some model's own answer (v4-score.ts answer files, any number of models) is served
// (an act or a refusal other than asking back) and wrong against the key, ranked by the surest such answer; the first
// --n at or above --min. Written: selection.jsonl (each with its key and the models' answers, for apply) and a reader's
// job (blind.jsonl and jobs/third-NNN.md, as jobs.ts writes them): the request and its forms only, under a hashed id,
// shuffled: the reader sees neither key nor model.
// apply: the reader's answers (<dir>/third-*.json) against the key and each model's wrong answer, by v4-right.ts:
//   - the reader reads it as the key: the key stands (`key_upheld`);
//   - the reader reads it as a model's answer and not as the key: the key was wrong, and the reader's reading becomes
//     the key (`key_mended`): two independent readings of three (the reader's and the model's) against the key's;
//   - the reader reads it as neither: the key stands, recorded as read three ways (`three_ways`): a request at the edge
//     of meaning, which no third reading settles; nothing is dropped, so the certification is not made easier by it.
// Written: verdicts.jsonl, the rows mended (<dir>/<rows file name>, every row, the mended ones with `groups.key` saying
// so and `key_was` the old key) and manifest.json.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { translatorSystem } from "../../src/index";
import { right } from "../../model/v4-right";
import { prng, shuffle } from "../v4-assistants/lib";

const [mode, ...args] = process.argv.slice(2);
const all = (k: string) => args.flatMap((a, i) => (a === `--${k}` ? [args[i + 1]!] : []));
const jsonl = (p: string): any[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const out = all("out")[0];
if (!out || (mode !== "select" && mode !== "apply")) throw new Error("usage: bun third.ts select|apply --rows <rows.jsonl>... [--a <answers.jsonl>...] --out <dir>");
mkdirSync(out, { recursive: true });
const files = all("rows");
const rows = new Map(files.flatMap((f) => jsonl(f).map((r) => [r.id, r] as const)));
const hid = (id: string) => `k-${createHash("sha256").update(`translator-v4-r4-third|${id}`).digest("hex").slice(0, 12)}`;
const servable = (p: string | null | undefined) => !!p && p.trim() !== "none(unclear)";

if (mode === "select") {
  const N = Number(all("n")[0] ?? 80), MIN = Number(all("min")[0] ?? 0.99);
  const wrong = new Map<string, { model: string; program: string; sure: number }[]>();
  for (const f of all("a")) {
    const model = basename(f).replace(/^.*\.decide_/, "").replace(/\.jsonl$/, "");
    for (const a of jsonl(f)) {
      const r = rows.get(a.id);
      const program: string | null = a.own !== undefined ? a.own : a.program;
      if (!r || !servable(program) || right(program, r.program, r)) continue;
      (wrong.get(a.id) ?? wrong.set(a.id, []).get(a.id)!).push({ model, program: program!, sure: a.sure });
    }
  }
  const ranked = [...wrong.entries()].map(([id, ws]) => ({ id, ws, top: Math.max(...ws.map((w) => w.sure)) })).filter((x) => x.top >= MIN).sort((a, b) => b.top - a.top).slice(0, N);
  writeFileSync(join(out, "selection.jsonl"), ranked.map((x) => JSON.stringify({ id: x.id, blind: hid(x.id), key: rows.get(x.id).program, surest: x.top, wrong: x.ws })).join("\n") + "\n");
  const blind = shuffle(prng(2026_11_09), ranked.map((x) => JSON.stringify({ id: hid(x.id), request: rows.get(x.id).request.replace(/[\r\n]/g, " "), forms: rows.get(x.id).forms })));
  writeFileSync(join(out, "blind.jsonl"), blind.join("\n") + "\n");
  // The reader's job, as jobs.ts writes the two readers' (one batch: the third reader reads them all).
  const task = readFileSync(join(import.meta.dir, "../in-situ/reader-call.txt"), "utf8").trimEnd();
  mkdirSync(join(out, "jobs"), { recursive: true });
  writeFileSync(join(out, "system.md"), translatorSystem());
  const BATCH = 40;
  for (let k = 0; k * BATCH < blind.length; k++) {
    const name = `third-${String(k + 1).padStart(3, "0")}`;
    writeFileSync(join(out, "jobs", `${name}.md`), `${task}\n\nWrite the answer file as JSON to ${join(out, `${name}.json`)}: {"answers": [{"id": "...", "program": "..."}, ...]}, one object per line of BLIND, in order (the program JSON-escaped as a JSON string must be; the program itself as written).\n\n=== BLIND ===\n${blind.slice(k * BATCH, (k + 1) * BATCH).join("\n")}\n`);
  }
  console.log(JSON.stringify({ disagreements: wrong.size, at_or_above_min: [...wrong.values()].filter((ws) => Math.max(...ws.map((w) => w.sure)) >= MIN).length, selected: ranked.length, batches: Math.ceil(blind.length / BATCH) }));
} else {
  const sel = jsonl(join(out, "selection.jsonl"));
  const third = new Map<string, string>();
  for (const f of readdirSync(out).filter((f) => /^third-\d+\.json$/.test(f)).sort())
    for (const a of JSON.parse(readFileSync(join(out, f), "utf8")).answers ?? []) if (typeof a?.id === "string" && typeof a?.program === "string") third.set(a.id, a.program);
  const verdicts: any[] = [];
  const mended = new Map<string, string>();
  for (const s of sel) {
    const r = rows.get(s.id), p = third.get(s.blind);
    if (!r || p === undefined) { verdicts.push({ id: s.id, verdict: "unanswered" }); continue; }
    const asKey = right(p, s.key, r) || right(s.key, p, r);
    const asModel = s.wrong.filter((w: any) => right(w.program, p, r) || right(p, w.program, r)).map((w: any) => w.model);
    const verdict = asKey ? "key_upheld" : asModel.length ? "key_mended" : "three_ways";
    if (verdict === "key_mended") mended.set(s.id, p);
    verdicts.push({ id: s.id, verdict, key: s.key, third: p, models_agreeing: asModel, wrong: s.wrong, request: r.request });
  }
  writeFileSync(join(out, "verdicts.jsonl"), verdicts.map((v) => JSON.stringify(v)).join("\n") + "\n");
  for (const f of files) {
    const xs = jsonl(f).map((r) => mended.has(r.id) ? { ...r, program: mended.get(r.id), key_was: r.program, groups: { ...(r.groups ?? {}), key: `${r.groups?.key ? `${r.groups.key}; ` : ""}mended by a third blind reader agreeing with a model (round 4)` } } : r);
    writeFileSync(join(out, basename(f)), xs.map((x) => JSON.stringify(x)).join("\n") + "\n");
  }
  const count = (v: string) => verdicts.filter((x) => x.verdict === v).length;
  const manifest = { selected: sel.length, answered: third.size, key_upheld: count("key_upheld"), key_mended: count("key_mended"), three_ways: count("three_ways"), unanswered: count("unanswered"), rows_written: files.map((f) => join(out, basename(f))) };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
  console.log(JSON.stringify(manifest, null, 1));
}
