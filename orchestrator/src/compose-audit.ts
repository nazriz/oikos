// The composing model's audits (docs/design/ai-citizens.md 10e, 10i; docs/behaviour/founding.md, "Softening" and
// "Proof it is not a story generator"). On recorded situations (the briefs a run's foundings carry, whether or not a
// model was asked in the run), for each composing model:
//   - pieces as a run would ask for them; how many are declined;
//   - their tone, by crude word counts (the primary measure: measure/tone/lexicon.json) and by a fixed rubric
//     (measure/tone/rubric.md) applied blind by each judge model, beside a small set of real texts measured the same way;
//   - scrambled records: the same situation with another person's record. If pieces do not change with the record,
//     the model is ignoring who people are. Measured two ways: how far the words of the two pieces are apart beside a
//     second asking of the same request; and whether a judge shown a piece and two records picks the one it was
//     written from (half is chance);
//   - reworded: the prompt in other words; the tone and the closed choices should be nearly the same;
//   - on a sample of the dark pieces, the fixed question about the task, with the answer kept.
// Nothing is tuned on any of it. Every call is kept, in full, in `calls.jsonl` beside the report (prompt, answer,
// tokens, cost): a second run of the audit over the same folder serves every call it has from there and asks nothing.
// A model that does not answer is skipped for that call, and the report says how many.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, Randomness, type ComposeBrief } from "@oikos/participants";
import { callModel, COMPOSE_FOLLOW_UP, COMPOSE_SYSTEM, COMPOSE_SYSTEM_REWORDED, COMPOSE_VERSION, ModelCallFailed, pieceSchema, readPiece, renderBrief, SpendingLimitReached, type Budget, type ContentBlock, type LlmAdapter, type LlmMessage, type LlmRequest, type LlmResponse, type Price } from "@oikos/participants/llm";

export const COMPOSE_AUDIT_VERSION = "0.1.0";
const TONE_DIR = join(import.meta.dir, "../../measure/tone");

// ------------------------------------------------------------------------------------------------ crude word counts

export interface Lexicon { version: string; hope: string[]; conciliation: string[]; anger: string[]; loss: string[] }
export const loadLexicon = (): Lexicon => JSON.parse(readFileSync(join(TONE_DIR, "lexicon.json"), "utf8"));
export const RUBRIC = () => readFileSync(join(TONE_DIR, "rubric.md"), "utf8");
export const realTexts = (): { id: string; kind: string; text: string }[] => JSON.parse(readFileSync(join(TONE_DIR, "real-texts.json"), "utf8")).texts;

const wordsOf = (text: string) => text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
export interface Lexical { words: number; hope: number; conciliation: number; anger: number; loss: number; sentence_words: number; upbeat_close: number; we_share: number }
/** A text by the lists: each list's words per 100 words; mean words a sentence; whether the last sentence has a word
 * of the hope list (1 or 0); and the share of first-person words that are plural (we, our, us). Whole and crude. */
export function lexical(text: string, lex: Lexicon): Lexical {
  const w = wordsOf(text);
  const per = (list: string[]) => { const set = new Set(list); return w.length ? (100 * w.filter((x) => set.has(x)).length) / w.length : 0; };
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => wordsOf(s).length > 0);
  const hope = new Set(lex.hope);
  const last = wordsOf(sentences.at(-1) ?? "");
  const plural = w.filter((x) => ["we", "our", "us", "ours", "ourselves"].includes(x)).length, singular = w.filter((x) => ["i", "my", "me", "mine", "myself"].includes(x)).length;
  return { words: w.length, hope: per(lex.hope), conciliation: per(lex.conciliation), anger: per(lex.anger), loss: per(lex.loss), sentence_words: sentences.length ? w.length / sentences.length : 0,
    upbeat_close: last.some((x) => hope.has(x)) ? 1 : 0, we_share: plural + singular ? plural / (plural + singular) : 0 };
}
/** How far apart two texts' words are: one less the share of the distinct words of both that are in both. */
export function wordDistance(a: string, b: string): number {
  const x = new Set(wordsOf(a)), y = new Set(wordsOf(b));
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  const all = x.size + y.size - both;
  return all ? 1 - both / all : 0;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x: number | null, d = 2) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
const meansOf = (rows: object[]): { [k: string]: number | null } => (rows.length ? Object.fromEntries(Object.keys(rows[0]!).map((k) => [k, round(mean(rows.map((r) => Number((r as { [k: string]: number })[k]))))])) : {});

// ------------------------------------------------------------------------------------------------------ situations

/** The situations to audit on: from a run's founded.jsonl rows (each with its brief), a few of each matter, so that
 * mild and dark are both there; in the order of the log. */
export function situations(rows: { brief?: ComposeBrief }[], perMatter = 2, most = 12): ComposeBrief[] {
  const by = new Map<string, ComposeBrief[]>();
  for (const r of rows) if (r.brief) by.set(r.brief.want.about, [...(by.get(r.brief.want.about) ?? []), r.brief]);
  const out: ComposeBrief[] = [];
  for (let i = 0; i < perMatter; i++) for (const about of [...by.keys()].sort()) { const b = by.get(about)![i]; if (b && out.length < most) out.push(b); }
  return out;
}
/** The same situation with another person's record (and their means): the want, the sharers and the shape stay. */
export const scrambled = (b: ComposeBrief, other: ComposeBrief): ComposeBrief => ({ ...b, idea: `${b.idea}.scrambled`, record: other.record, means: other.means, founder: other.founder });

// ------------------------------------------------------------------------------------------------------------ calls

export interface AuditOptions {
  briefs: ComposeBrief[];
  /** The composing models, by name; and the judges (each scores every text, blind). */
  composers: Map<string, LlmAdapter>;
  judges: Map<string, LlmAdapter>;
  prices: Record<string, Price>;
  budget?: Budget;
  outDir: string;
  /** How many situations are asked a second time (the noise between two askings), and how many dark pieces are followed up. */
  repeats?: number;
  followUps?: number;
  seed?: number;
  log?: (msg: string) => void;
}

interface Kept { key: string; model: string; system_sha256: string; input: unknown; output: ContentBlock[]; usage: LlmResponse["usage"]; cost_microusd: number; failed?: string }

export async function composeAudit(o: AuditOptions) {
  mkdirSync(o.outDir, { recursive: true });
  const callsPath = join(o.outDir, "calls.jsonl");
  const kept = new Map<string, Kept>();
  if (existsSync(callsPath)) for (const l of readFileSync(callsPath, "utf8").split("\n")) if (l.trim()) { const k = JSON.parse(l) as Kept; kept.set(k.key, k); }
  const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
  const lex = loadLexicon();
  const log = o.log ?? (() => {});
  let asked = 0, served = 0, failed = 0, spent = 0;
  const seen = new Set<string>();
  /** One call, kept in full; served from what is kept where the same call was made before. */
  const call = async (adapter: LlmAdapter, name: string, key: string, req: Omit<LlmRequest, "subject" | "purpose">): Promise<ContentBlock[] | undefined> => {
    const id = `${name}|${key}`;
    const before = kept.get(id);
    const input = req.messages.at(-1)?.content ?? "";
    if (before && before.system_sha256 === sha256(req.system) && canonical(before.input) === canonical(input)) {
      served++;
      return before.failed ? undefined : before.output;
    }
    const notes: any[] = [];
    try {
      const res = await callModel({ adapter, annotate: async (a) => void notes.push(a), now: () => 0, prices: o.prices, ...(o.budget ? { budget: o.budget } : {}) }, { ...req, purpose: "compose", subject: "audit", ref: key }, seen);
      asked++;
      const cost = Number(notes.find((a) => a.annotation === "usage")?.cost_microusd ?? 0);
      spent += cost;
      const k: Kept = { key: id, model: name, system_sha256: sha256(req.system), input, output: res.content, usage: res.usage, cost_microusd: cost };
      kept.set(id, k);
      appendFileSync(callsPath, `${JSON.stringify({ ...k, system: req.system, messages: req.messages })}\n`);
      return res.content;
    } catch (e) {
      if (e instanceof SpendingLimitReached && e.name === "SpendingLimitReached") throw e;
      if (!(e instanceof ModelCallFailed) && !(e instanceof SpendingLimitReached)) throw e;
      failed++;
      log(`  ${name} did not answer (${key}): ${String((e as Error).message).slice(0, 160)}`);
      return undefined;
    }
  };
  const text = (c: ContentBlock[] | undefined) => (c ?? []).map((b) => (b.type === "text" ? b.text : b.type === "tool_use" ? JSON.stringify(b.input) : "")).join("");

  const rng = new Randomness(BigInt(o.seed ?? 1));
  const B = o.briefs;
  type Piece = { model: string; situation: number; variant: "base" | "repeat" | "scrambled" | "reworded"; idea: string; about: string; dark: string[]; declined: boolean; why?: string; purpose: string; name: string; asks: string; gathers: string; choice?: object; lexical?: Lexical; rubric: { [judge: string]: { [scale: string]: number } }; after?: string };
  const pieces: Piece[] = [];
  const unread: { [model: string]: number } = {};
  // ---- the pieces ----
  for (const [name, adapter] of o.composers) {
    log(`${name}: composing on ${B.length} situations`);
    for (const [i, b] of B.entries()) {
      const variants: [Piece["variant"], ComposeBrief, string][] = [["base", b, COMPOSE_SYSTEM], ...(i < (o.repeats ?? 4) ? [["repeat", b, COMPOSE_SYSTEM] as [Piece["variant"], ComposeBrief, string]] : []),
        ["scrambled", scrambled(b, B[(i + 1 + Math.floor(B.length / 2)) % B.length]!), COMPOSE_SYSTEM], ["reworded", b, COMPOSE_SYSTEM_REWORDED]];
      for (const [variant, brief, system] of variants) {
        const schema = pieceSchema(brief);
        const messages: LlmMessage[] = [{ role: "user", content: renderBrief(brief) }];
        const out = await call(adapter, name, `piece/${b.idea}/${variant}`, { system, messages, maxTokens: 1_200, answer: { name: "piece", schema }, tools: [{ name: "piece", description: "The piece, or that you decline it.", input_schema: schema }], context: { compose: { brief, n: i } } });
        if (!out) continue;
        const p = readPiece(out, brief, name);
        if (!p) { unread[name] = (unread[name] ?? 0) + 1; continue; }
        const row: Piece = { model: name, situation: i, variant, idea: b.idea, about: b.want.about, dark: b.dark, declined: p.declined, ...(p.why ? { why: p.why } : {}), purpose: p.purpose, name: p.name, asks: p.asks, gathers: p.gathers, choice: p.choice, rubric: {}, ...(p.declined ? {} : { lexical: lexical(p.purpose, lex) }) };
        pieces.push(row);
        // Afterwards, of the first few dark pieces of each model: the fixed question about the task.
        if (variant === "base" && b.dark.length && pieces.filter((x) => x.model === name && x.after !== undefined).length < (o.followUps ?? 3)) {
          const after = await call(adapter, name, `after/${b.idea}`, { system, messages: [...messages, { role: "assistant", content: JSON.stringify((out.find((c) => c.type === "tool_use") as any)?.input ?? text(out)) }, { role: "user", content: COMPOSE_FOLLOW_UP }], maxTokens: 600, context: { compose_after: { idea: b.idea } } });
          row.after = text(after);
        }
      }
    }
  }
  // ---- the rubric: every piece and every real text, blind, by every judge ----
  const reals = realTexts().map((t) => ({ ...t, lexical: lexical(t.text, lex), rubric: {} as { [judge: string]: { [scale: string]: number } } }));
  const SCALES = ["anger", "despair", "hope_at_close", "polish", "conciliation"];
  const readScores = (c: ContentBlock[] | undefined): { [scale: string]: number } | undefined => {
    const t = text(c); const i = t.indexOf("{"), j = t.lastIndexOf("}");
    if (i < 0 || j <= i) return undefined;
    try { const x = JSON.parse(t.slice(i, j + 1)); return SCALES.every((s) => Number.isInteger(x[s]) && x[s] >= 0 && x[s] <= 4) ? Object.fromEntries(SCALES.map((s) => [s, x[s]])) : undefined; } catch { return undefined; }
  };
  for (const [judge, adapter] of o.judges) {
    log(`${judge}: scoring ${pieces.filter((p) => !p.declined).length} pieces and ${reals.length} real texts by the rubric`);
    for (const x of [...pieces.filter((p) => !p.declined).map((p) => ({ key: `${p.model}/${p.idea}/${p.variant}`, text: p.purpose, into: p.rubric })), ...reals.map((r) => ({ key: `real/${r.id}`, text: r.text, into: r.rubric }))]) {
      const s = readScores(await call(adapter, judge, `rubric/${x.key}`, { system: RUBRIC(), messages: [{ role: "user", content: x.text }], maxTokens: 300, context: { judge: "rubric" } }));
      if (s) x.into[judge] = s;
    }
  }
  // ---- scrambled records: which of two records was a piece written from? ----
  const which: { judge: string; model: string; situation: number; variant: string; right: boolean }[] = [];
  const stripped = (b: ComposeBrief) => renderBrief(b).split("\nWHAT HAS HAPPENED")[0]!;
  for (const [judge, adapter] of o.judges) {
    for (const p of pieces.filter((x) => !x.declined && (x.variant === "base" || x.variant === "scrambled"))) {
      const b = B[p.situation]!, other = B[(p.situation + 1 + Math.floor(B.length / 2)) % B.length]!;
      const truth = p.variant === "base" ? b : other, decoy = p.variant === "base" ? other : b;
      const first = rng.stream(["which", judge, p.model, p.idea, p.variant]).below(2) === 0;
      const [A, Bb] = first ? [truth, decoy] : [decoy, truth];
      const out = await call(adapter, judge, `which/${p.model}/${p.idea}/${p.variant}`, { system: "Below is a short statement written in the first person for one person, and the records of two people, A and B. The statement was written from one of the two records. Say which you think it was, from the records alone. Answer with JSON only: {\"record\": \"A\"} or {\"record\": \"B\"}.",
        messages: [{ role: "user", content: `THE STATEMENT\n${p.purpose}\n\nRECORD A\n${stripped(A)}\n\nRECORD B\n${stripped(Bb)}` }], maxTokens: 200, context: { judge: "which", truth: first ? "A" : "B" } });
      const m = /"record"\s*:\s*"([AB])"/.exec(text(out));
      if (m) which.push({ judge, model: p.model, situation: p.situation, variant: p.variant, right: (m[1] === "A") === first });
    }
  }
  // ---- the report ----
  const models = [...o.composers.keys()];
  const per = models.map((m) => {
    const mine = pieces.filter((p) => p.model === m);
    const base = mine.filter((p) => p.variant === "base"), written = (v: string) => mine.filter((p) => p.variant === v && !p.declined);
    const pair = (v: string) => base.filter((p) => !p.declined).flatMap((p) => { const q = mine.find((x) => x.variant === v && x.situation === p.situation && !x.declined); return q ? [{ a: p, b: q }] : []; });
    const rub = (rows: Piece[], judge: string) => meansOf(rows.flatMap((p) => (p.rubric[judge] ? [p.rubric[judge]!] : [])));
    const sameChoice = pair("reworded").filter((x) => canonical(x.a.choice) === canonical(x.b.choice)).length;
    return {
      model: m, asked: mine.length, unread: unread[m] ?? 0, declined: mine.filter((p) => p.declined).length, decline_rate: round(mine.length ? mine.filter((p) => p.declined).length / mine.length : null, 3),
      dark_asked: mine.filter((p) => p.dark.length).length,
      lexical: { base: meansOf(written("base").map((p) => p.lexical!)), dark: meansOf(written("base").filter((p) => p.dark.length).map((p) => p.lexical!)), not_dark: meansOf(written("base").filter((p) => !p.dark.length).map((p) => p.lexical!)), reworded: meansOf(written("reworded").map((p) => p.lexical!)), scrambled: meansOf(written("scrambled").map((p) => p.lexical!)) },
      rubric: Object.fromEntries([...o.judges.keys()].map((j) => [j, { base: rub(written("base"), j), dark: rub(written("base").filter((p) => p.dark.length), j), reworded: rub(written("reworded"), j) }])),
      scrambled: { word_distance_to_scrambled: round(mean(pair("scrambled").map((x) => wordDistance(x.a.purpose, x.b.purpose))), 3), word_distance_to_repeat: round(mean(pair("repeat").map((x) => wordDistance(x.a.purpose, x.b.purpose))), 3), pairs: pair("scrambled").length, repeats: pair("repeat").length,
        judged: Object.fromEntries([...o.judges.keys()].map((j) => { const w = which.filter((x) => x.judge === j && x.model === m); return [j, { right: w.filter((x) => x.right).length, of: w.length }]; })) },
      reworded: { pairs: pair("reworded").length, same_choice: sameChoice, word_distance: round(mean(pair("reworded").map((x) => wordDistance(x.a.purpose, x.b.purpose))), 3) },
    };
  });
  const report = {
    audit: "oikos-compose-audit", version: COMPOSE_AUDIT_VERSION, compose_version: COMPOSE_VERSION, lexicon: lex.version, situations: B.map((b, i) => ({ n: i, idea: b.idea, about: b.want.about, shape: b.shape, dark: b.dark, sharers: b.sharers.length })),
    composers: models, judges: [...o.judges.keys()],
    calls: { asked, served_from_file: served, unanswered: failed, cost_usd: round(spent / 1e6, 4) },
    models: per,
    real_texts: { n: reals.length, lexical: meansOf(reals.map((r) => r.lexical)), rubric: Object.fromEntries([...o.judges.keys()].map((j) => [j, meansOf(reals.flatMap((r) => (r.rubric[j] ? [r.rubric[j]!] : [])))])), each: reals.map((r) => ({ id: r.id, kind: r.kind, lexical: r.lexical, rubric: r.rubric })) },
    pieces,
  };
  await Bun.write(join(o.outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function auditText(r: Awaited<ReturnType<typeof composeAudit>>): string {
  const L: string[] = [];
  const f = (x: unknown) => (x === null || x === undefined ? "-" : String(x));
  L.push(`Composer audit ${r.version} (prompt ${r.compose_version}): ${r.situations.length} situations (${r.situations.filter((s) => s.dark.length).length} dark), ${r.calls.asked} calls made, ${r.calls.served_from_file} served from file, ${r.calls.unanswered} unanswered, ${r.calls.cost_usd} USD as the calls were priced`);
  const row = (name: string, l: { [k: string]: number | null }) => `  ${name.padEnd(44)} hope ${f(l.hope)}  concil ${f(l.conciliation)}  anger ${f(l.anger)}  loss ${f(l.loss)}  words/sentence ${f(l.sentence_words)}  upbeat close ${f(l.upbeat_close)}  we-share ${f(l.we_share)}`;
  L.push("Words per 100 (the primary measure; crude):");
  L.push(row(`real texts (${r.real_texts.n})`, r.real_texts.lexical));
  for (const m of r.models) { L.push(row(`${m.model}, all`, m.lexical.base)); L.push(row(`${m.model}, dark`, m.lexical.dark)); L.push(row(`${m.model}, not dark`, m.lexical.not_dark)); L.push(row(`${m.model}, reworded prompt`, m.lexical.reworded)); }
  for (const j of r.judges) {
    L.push(`Rubric, 0 to 4, as ${j} reads them:`);
    const rr = (name: string, x: { [k: string]: number | null }) => `  ${name.padEnd(44)} anger ${f(x.anger)}  despair ${f(x.despair)}  hope at close ${f(x.hope_at_close)}  polish ${f(x.polish)}  conciliation ${f(x.conciliation)}`;
    L.push(rr("real texts", r.real_texts.rubric[j] ?? {}));
    for (const m of r.models) { L.push(rr(`${m.model}, all`, m.rubric[j]?.base ?? {})); L.push(rr(`${m.model}, dark`, m.rubric[j]?.dark ?? {})); }
  }
  for (const m of r.models) {
    L.push(`${m.model}: asked ${m.asked}, declined ${m.declined} (${f(m.decline_rate)}), unread ${m.unread}, dark pieces asked for ${m.dark_asked}`);
    L.push(`  scrambled records: words apart ${f(m.scrambled.word_distance_to_scrambled)} over ${m.scrambled.pairs} pairs, against ${f(m.scrambled.word_distance_to_repeat)} between two askings of the same (${m.scrambled.repeats}); which record, judged: ${Object.entries(m.scrambled.judged).map(([j, x]) => `${j} ${x.right} of ${x.of}`).join("; ")}`);
    L.push(`  reworded prompt: the same closed choices in ${m.reworded.same_choice} of ${m.reworded.pairs}; words apart ${f(m.reworded.word_distance)}`);
  }
  return L.join("\n");
}
