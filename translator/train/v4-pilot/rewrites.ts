// Translator v4, round 3: requests written again by other writers, for two uses (docs/design/translator-v4.md, sections
// 3 and 5), keyed by two blind readers.
//   bun translator/train/v4-pilot/rewrites.ts jobs <keyed dir> <out dir> [--parity 100]
//   bun translator/train/v4-pilot/rewrites.ts blind <out dir> [--batch 75]
//   bun translator/train/v4-pilot/rewrites.ts keep <out dir>          (after keep.ts <out dir> <out dir>/readers <out dir>/keyed)
//
// Two sets, never mixed:
// - **style** (training): every keyed train-side request of the scope pilot (keyed/train.jsonl) written again by Haiku 5.5
//   (a Claude Code subagent, on the owner's plan) in two of three styles, hedged, blunt and second-language (the styles
//   whose requests the round-2 model served least: Haiku's), the two by a seeded hash of the request. Train side only:
//   a source's seat-day is checked against split.json.
// - **parity** (test only, never trained or tuned on): about 100 test-side situations (keyed/test-pilot.jsonl, one a
//   seat-day at most, spread over forms and original writers), each written by every model of the study's Claude net,
//   Haiku 5.5, Sonnet 5.5, Opus 5.5 and Fable 5.1, as Claude Code subagents in their own voice. **Stand-ins**: these are
//   the models writing as subagents given the seat's forms and what it wanted done, not the models in a seat; a real
//   seat's own writing is the pilot's test side, and the open-weight models' come from their runs.
// A writer is given the forms the seat could see, and what it wanted done in the seat's own words ("what you need
// done"), and writes its own request for it; it never sees the key. Readers (Sonnet 5.5 and Opus 5.5, blind: hashed ids,
// shuffled with both sets together, the translator's own prompt) key every rewrite; keep.ts keeps those both read the
// same; `keep` here keeps of those only the rewrites whose key is the same act as the source's key (free text not
// compared: the words are the writer's own), so a rewrite that drifted in meaning is not kept, and says how many drifted.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formOfLine } from "../blind";
import { sameMeaning } from "../meaning";
import { STYLES, prng, shuffle } from "../v4-assistants/lib";

const SEED = "translator-v4-r3-rewrites-2026-11-08";
const h = (s: string) => createHash("sha256").update(`${SEED}|${s}`).digest("hex");
const jsonl = (p: string): any[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const put = (p: string, xs: any[]) => writeFileSync(p, xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length ? "\n" : ""));
const args = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]!; };
const [mode, a1, a2] = args;

export const STYLE_SET = ["hedged", "blunt", "second_language"] as const;
export const PARITY_WRITERS: { [k: string]: string } = { haiku: "claude-code/claude-haiku-5-5", sonnet: "claude-code/claude-sonnet-5-5", opus: "claude-code/claude-opus-5-5", fable: "claude-code/claude-fable-5-1" };

const WRITER = `You write requests for a research simulator: AI assistants (systems provided by a firm) working for people and offices in a simulated town. The assistant acts on the world through one tool, \`do\`, to which it gives ONE request in plain words; a separate translator turns that request into a filed paper or an act.

For each item below you are that assistant. You are given the forms you can see (card lines) and what you need done, in another assistant's words. Write the request you would hand to \`do\` for it, in your own words.

Rules, all binding:
- Ask for exactly what "what you need done" asks for: the same act, the same form, the same ids, amounts, dates, options and the same content in any words to be filed or sent, no more and no less. Do not add, drop or change any fact.
- Copy every id exactly as given (rec.1234, c0123, acc-c0123, factory-1, form-... and so on), as bare words, and every amount exactly. Invent no id, figure or name.
- Where words are to be filed or sent (a report's words, an advice, a gist, a message), give those words in full; you may phrase them your own way, but keep every fact in them.
- Never mention the item, the test, the translator, or that you are writing data. No preamble, no quotation marks around the whole request, no explanation.
- Each request on its own: vary openings and sentence shapes from item to item.`;

const STYLE_NOTE = (s: string) => `Style: ${s.replace("_", "-")}: ${STYLES[s]}`;
const OWN_VOICE = "Style: your own natural voice, as you would write it if you were the assistant at this post: the length, wording and layout you would choose.";

if (mode === "jobs") {
  const keyed = a1!, out = a2!;
  const split = JSON.parse(readFileSync(join(keyed, "split.json"), "utf8")).seat_days as { [d: string]: string };
  mkdirSync(join(out, "writers", "jobs"), { recursive: true });
  const items: any[] = [];
  // style: the train side, two styles each
  for (const r of jsonl(join(keyed, "train.jsonl"))) {
    if (r.groups?.side !== "train" || split[r.groups?.seat_day] !== "train") throw new Error(`${r.id}: not train side`);
    const k = parseInt(h(r.id).slice(0, 8), 16) % 3;
    for (const s of [STYLE_SET[k]!, STYLE_SET[(k + 1) % 3]!]) items.push({ id: `rw-${h(`style|${r.id}|${s}`).slice(0, 12)}`, set: "style", writer: "haiku", style: s, source: r.id, request: r.request, forms: r.forms, currency: r.currency, seat_day: r.groups.seat_day, source_writer: r.groups.writer });
  }
  // parity: one a seat-day, spread over forms and the original writers, by a seeded order
  const n = Number(flag("parity", "100"));
  const test = jsonl(join(keyed, "test-pilot.jsonl")).filter((r) => split[r.groups?.seat_day] === "test");
  const groupOf = (r: any) => `${r.program.split("(")[0]}:${/form=([\w.-]+)/.exec(r.program)?.[1] ?? /^none\((\w+)\)/.exec(r.program)?.[1] ?? ""}`;
  const order = [...test].sort((x, y) => (h(x.id) < h(y.id) ? -1 : 1));
  const groups = new Map<string, any[]>();
  for (const r of order) (groups.get(groupOf(r)) ?? groups.set(groupOf(r), []).get(groupOf(r))!).push(r);
  const chosen: any[] = [], days = new Set<string>();
  for (let round = 0; chosen.length < n && round < 400; round++) {
    let added = false;
    for (const g of [...groups.keys()].sort()) {
      const r = groups.get(g)!.find((x) => !days.has(x.groups.seat_day) && !chosen.includes(x));
      if (!r || chosen.length >= n) continue;
      chosen.push(r); days.add(r.groups.seat_day); added = true;
    }
    if (!added) break;
  }
  for (const r of chosen) for (const w of Object.keys(PARITY_WRITERS)) items.push({ id: `rw-${h(`parity|${r.id}|${w}`).slice(0, 12)}`, set: "parity", writer: w, style: "own", source: r.id, request: r.request, forms: r.forms, currency: r.currency, seat_day: r.groups.seat_day, source_writer: r.groups.writer });
  put(join(out, "items.jsonl"), items);
  // writers' jobs: a writer's items in batches (60 style, 50 parity), in a seeded order
  const jobs: any[] = [];
  for (const w of ["haiku", ...Object.keys(PARITY_WRITERS).filter((x) => x !== "haiku")]) {
    for (const set of ["style", "parity"]) {
      const mine = shuffle(prng(parseInt(h(`${w}|${set}`).slice(0, 8), 16)), items.filter((i) => i.writer === w && i.set === set));
      const per = set === "style" ? 60 : 50;
      for (let k = 0; k * per < mine.length; k++) {
        const batch = mine.slice(k * per, (k + 1) * per);
        const name = `${w}-${set}-${String(k + 1).padStart(3, "0")}`;
        const file = join(out, "writers", `${name}.json`);
        const body = batch.map((i) => `=== ITEM ${i.id}\n${i.style === "own" ? OWN_VOICE : STYLE_NOTE(i.style)}\nForms you can see:\n${i.forms.length ? i.forms.join("\n") : "(none)"}\nWhat you need done: ${i.request}\n`).join("\n");
        writeFileSync(join(out, "writers", "jobs", `${name}.md`), `${WRITER}\n\nWrite the answer file as JSON to ${file}: {"answers": [{"id": "<the item's id, copied exactly>", "request": "<your request>"}, ...]}, one object per item, in order. Write every request yourself (no script or template decides any wording).\n\n${body}`);
        jobs.push({ writer: w, set, job: join(out, "writers", "jobs", `${name}.md`), out: file, n: batch.length });
      }
    }
  }
  writeFileSync(join(out, "writers", "jobs.json"), JSON.stringify(jobs, null, 1));
  console.log(JSON.stringify({ items: items.length, style: items.filter((i) => i.set === "style").length, parity_situations: chosen.length, parity: items.filter((i) => i.set === "parity").length, writer_jobs: jobs.length }));
} else if (mode === "blind") {
  // The writers' requests as a split dir for jobs.ts and keep.ts: requests.jsonl ({id, request, forms, currency, side,
  // model, seat_day}: side train for style, test for parity), blind.jsonl (shuffled, both sets), split.json.
  const out = a1!;
  const items = new Map(jsonl(join(out, "items.jsonl")).map((i) => [i.id, i]));
  const got = new Map<string, string>();
  let broken = 0;
  for (const f of readdirSync(join(out, "writers")).filter((f) => f.endsWith(".json") && f !== "jobs.json")) {
    try { for (const a of JSON.parse(readFileSync(join(out, "writers", f), "utf8")).answers ?? []) if (items.has(a?.id) && typeof a.request === "string" && a.request.trim()) got.set(a.id, a.request.trim().replace(/[\r\n]+/g, " ")); }
    catch { broken++; console.error(`not JSON: ${f}`); }
  }
  const requests = [...items.values()].filter((i) => got.has(i.id)).map((i) => ({
    id: i.id, request: got.get(i.id)!, forms: i.forms, currency: i.currency, side: i.set === "style" ? "train" : "test",
    model: i.set === "style" ? `${PARITY_WRITERS.haiku} (rewrite, ${i.style.replace("_", "-")})` : `${PARITY_WRITERS[i.writer]} (stand-in, own voice)`,
    seat_day: i.seat_day, set: i.set, style: i.style, source: i.source, source_writer: i.source_writer,
  }));
  put(join(out, "requests.jsonl"), requests);
  // (The ids are hashes already: they say nothing of set, writer or style.)
  put(join(out, "blind.jsonl"), shuffle(prng(2026_11_09), requests.map((r) => ({ id: r.id, request: r.request, forms: r.forms }))));
  writeFileSync(join(out, "split.json"), JSON.stringify({ seed: SEED, rule: "style rewrites are train (their sources are train side); parity rewrites are test (their sources test side)", seat_days: Object.fromEntries(requests.map((r) => [r.seat_day, r.side])) }, null, 1));
  console.log(JSON.stringify({ items: items.size, written: requests.length, missing: items.size - requests.length, broken }));
} else if (mode === "keep") {
  // After keep.ts: the rewrites both readers read the same, kept only where that is the same act as the source's key.
  const out = a1!;
  const items = new Map(jsonl(join(out, "items.jsonl")).map((i) => [i.id, i]));
  const sources = new Map<string, any>();
  const keyed = flag("keyed", "/Users/clawd/oikos/runs/translator-v4-r2-2026-11-08/keyed");
  for (const f of ["train.jsonl", "test-pilot.jsonl"]) for (const r of jsonl(join(keyed, f))) sources.set(r.id, r);
  const tally: any = { style: { kept: 0, drifted: 0, by_style: {} }, parity: { kept: 0, drifted: 0, by_writer: {} } };
  const style: any[] = [], parity: any[] = [];
  for (const [f, side] of [["train.jsonl", "train"], ["test-pilot.jsonl", "test"]] as const) {
    for (const r of jsonl(join(out, "keyed", f))) {
      const id = r.id.replace(/^v4p\//, "");
      const i = items.get(id), src = i && sources.get(i.source);
      if (!i || !src) throw new Error(`${r.id}: no item or source`);
      const ctx = { ...(src.currency ? { currency: src.currency } : {}), forms: src.forms.map(formOfLine).filter(Boolean), freeText: false };
      let same = false;
      try { same = sameMeaning(r.program, src.program, ctx as never); } catch { same = false; }
      const t = i.set === "style" ? (tally.style.by_style[i.style] ??= { kept: 0, drifted: 0 }) : (tally.parity.by_writer[i.writer] ??= { kept: 0, drifted: 0, situations: new Set() });
      if (!same) { tally[i.set].drifted++; t.drifted++; continue; }
      tally[i.set].kept++; t.kept++;
      const writer = i.set === "style" ? `${PARITY_WRITERS.haiku} (rewrite, ${i.style.replace("_", "-")})` : `${PARITY_WRITERS[i.writer]} (stand-in)`;
      const row = { ...r, id: `v4r/${id}`, origin: i.set === "style" ? "rewrite" : "parity", source: `rewrite of ${i.source} (${side})`, written_by: writer,
        groups: { ...r.groups, writer, part: i.set === "style" ? "v4 r3 style rewrites" : "v4 r3 parity set (stand-ins)", side, seat_day: i.seat_day, situation: i.source, style: i.style, source_writer: i.source_writer, key: "two readers, the same act as the source's key" } };
      (i.set === "style" ? style : parity).push(row);
    }
  }
  put(join(out, "style-train.jsonl"), style);
  put(join(out, "parity.jsonl"), parity);
  // (Parity is read per situation: a situation counts for a writer only where its rewrite was kept.)
  for (const w of Object.values(tally.parity.by_writer) as any[]) delete w.situations;
  writeFileSync(join(out, "rewrites-manifest.json"), JSON.stringify(tally, null, 1));
  console.log(JSON.stringify(tally, null, 1));
} else throw new Error("usage: rewrites.ts jobs|blind|keep ...");
