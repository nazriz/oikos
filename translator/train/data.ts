// Training data for the local translation model (docs/design/translator-and-resolver.md §16.4): requests in plain
// language, each with the program it should become.
//
//   gold programs   come free from our own runs: every act a code participant made carries the call it wrote
//                   (`provenance.call`). They are sampled by shape, so the rare ones aren't drowned by the common.
//   requests        are written by models, several to a program, in several styles: by whichever models the caller
//                   gives (several, so the translator doesn't learn one writer's voice).
//   every literal   of the program (an id, a name, an amount, a text) must appear in the request exactly: the
//                   translator copies, it never composes (§16.10). A request that lost one is dropped, mechanically.
//   a second model  then translates the request back, through the real translator path; it is kept if the program
//                   that comes back is the gold one (a round trip).
//   refusals        are built, not judged, where they can be: several requests run together (too_much), a form the
//                   person doesn't know of (unknown_form), an amount that would have to be worked out
//                   (needs_calculation).
//
// Nothing here reads the held-out cases; the finished data is checked against them for shared wording before it is
// used (eval/held-out.ts), and a set that shares any is refused.
//
// The sampling is seeded (a generator of its own: this is tooling, not a world, and takes nothing from a run's
// randomness), so the same logs and seed give the same programs to write requests for.

import { calls, canonical as canonicalJson } from "@oikos/participants";
import type { LlmAdapter, Usage } from "@oikos/participants/llm";
import { canonical } from "../eval/run";
import { leaks } from "../eval/held-out";
import type { Case } from "../eval/cases";

export const DATA_VERSION = "0.1.0";

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

/** A program to write requests for: its text, its shape, and the names of the things it mentions by id. */
export interface Gold { program: string; shape: string; names: { [id: string]: string }; source: string }

/** One training example. `kind`: a request with the program it becomes, or one that should be refused. */
export interface Example {
  id: string;
  request: string;
  /** What the translator is shown with the request (the forms the person knows of), as its context is written. */
  forms: string[];
  program: string;
  kind: "positive" | "refusal";
  shape: string;
  style?: string;
  /** Who wrote the request, and who translated it back (absent: built mechanically, or not yet verified). */
  written_by?: string;
  verified_by?: string;
  source: string;
}

/** A small seeded generator (mulberry32), for sampling only. */
export function sampler(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A program's shape: its functions and argument names, nested calls included, whatever the values. */
export function shapeOf(p: calls.Program): string {
  if ("none" in p) return `none(${p.none})`;
  const one = (c: calls.Call): string => `${c.fn}(${Object.entries(c.args).map(([k, v]) => ("call" in v ? `${k}=${one(v.call)}` : k)).sort().join(",")})`;
  return p.lines.map((l) => (l.bind ? "v=" : "") + one(l.call)).join(" ; ");
}

/** Every literal a program carries, as it would have to appear in a request: ids, names, amounts, texts. */
export function literals(p: calls.Program): string[] {
  if ("none" in p) return [];
  const bound = new Set(p.lines.map((l) => l.bind).filter(Boolean));
  const out: string[] = [];
  const value = (v: calls.Value) => {
    if ("id" in v) bound.has(v.id) || out.push(v.id);
    else if ("text" in v) out.push(v.text);
    else if ("json" in v) (Array.isArray(v.json) ? v.json : []).forEach((x) => typeof x === "string" && out.push(x));
    else if ("call" in v) Object.values(v.call.args).forEach(value);
  };
  for (const l of p.lines) Object.values(l.call.args).forEach(value);
  return [...new Set(out)];
}

/**
 * Whether a program is one a person could ask for in a sentence or two (§16.2): a line, or a few with names bound
 * between them; no structured data beyond a list of names (what code publishes for other code to read isn't a
 * request anyone words), and nothing carrying out someone else's instruction (a keeper's bookkeeping).
 */
export function askable(p: calls.Program, maxLines = 3): boolean {
  if ("none" in p || p.lines.length > maxLines) return false;
  const ok = (c: calls.Call): boolean => Object.entries(c.args).every(([k, v]) =>
    k !== "per_request" && ("json" in v ? Array.isArray(v.json) && v.json.every((x) => typeof x === "string") : "call" in v ? ok(v.call) : !("text" in v) || v.text.length <= 400));
  return p.lines.every((l) => ok(l.call));
}

/** The names a world's config gives its ids (entities, people, positions): for writing "Millbrook Builders" where the call says `builder`. */
export function namesIn(config: unknown): { [id: string]: string } {
  const out: { [id: string]: string } = {};
  const walk = (v: any) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const name = typeof v.name === "string" ? v.name : typeof v.title === "string" ? v.title : undefined;
      if (typeof v.id === "string" && name && name !== v.id) out[v.id] = name;
      Object.values(v).forEach(walk);
    }
  };
  walk(config);
  return out;
}

/**
 * The programs in a run's log worth writing requests for: the calls code participants wrote, askable ones only, at
 * most `perShape` different programs of each shape (a seeded sample of those seen), in shape order.
 */
export async function goldFromLog(lines: AsyncIterable<string> | Iterable<string>, o: { perShape?: number; seed?: number; source?: string } = {}): Promise<Gold[]> {
  const perShape = o.perShape ?? 8;
  const rand = sampler(o.seed ?? 1);
  let names: { [id: string]: string } = {};
  const kept = new Map<string, { programs: string[]; seen: number }>();
  for await (const line of lines as AsyncIterable<string>) {
    if (line.startsWith('{"body":{"canary"') || line.includes('"kind":"header"')) {
      try {
        const e = JSON.parse(line);
        if (e.kind === "header") names = namesIn(e.body?.config);
      } catch {
        // not the header after all
      }
      continue;
    }
    if (!line.includes('"via":"call"')) continue;
    let text: string | undefined;
    try {
      text = JSON.parse(line).body?.provenance?.call;
    } catch {
      continue;
    }
    if (typeof text !== "string") continue;
    let p: calls.Program;
    try {
      p = calls.parseProgram(text);
    } catch {
      continue;
    }
    if (!askable(p) || calls.contractErrors(p).length) continue;
    const shape = shapeOf(p);
    const program = calls.programText(p);
    const k = kept.get(shape) ?? kept.set(shape, { programs: [], seen: 0 }).get(shape)!;
    if (k.programs.includes(program)) continue;
    // Reservoir sampling: each different program of a shape is as likely to be kept as any other.
    k.seen++;
    if (k.programs.length < perShape) k.programs.push(program);
    else {
      const j = Math.floor(rand() * k.seen);
      if (j < perShape) k.programs[j] = program;
    }
  }
  const out: Gold[] = [];
  for (const shape of [...kept.keys()].sort()) for (const program of kept.get(shape)!.programs) {
    const mentioned = new Set(literals(calls.parseProgram(program)));
    out.push({ program, shape, names: Object.fromEntries(Object.entries(names).filter(([id]) => mentioned.has(id))), source: o.source ?? "log" });
  }
  return out;
}

const AMOUNT_ARGS = new Set(["amount", "price", "carrying"]);
const DURATION_ARGS = new Set(["every", "term", "our_notice", "their_notice", "first"]);

/** Other ways of writing the same amount, each checked to parse to the same number of cents. */
export function amountForms(text: string): string[] {
  let cents: string;
  try {
    cents = calls.parseAmount(text);
  } catch {
    return [];
  }
  const c = BigInt(cents);
  const whole = (c / 100n).toString();
  const frac = (c % 100n).toString().padStart(2, "0");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const forms = frac === "00"
    ? [`$${grouped}`, `$${whole}`, `$${grouped}.00`, `${grouped} dollars`, ...(c % 100_000n === 0n && c > 0n ? [`$${c / 100_000n}k`, `${c / 100_000n}k`] : []), ...(c % 100_000_000n === 0n && c > 0n ? [`$${c / 100_000_000n}m`, `$${c / 100_000_000n} million`] : [])]
    : [`$${grouped}.${frac}`, `$${whole}.${frac}`, `${grouped}.${frac} dollars`];
  return [...new Set(forms)].filter((f) => f !== text && same(() => calls.parseAmount(f), cents));
}

/** Other ways of writing the same length of time (`repeating`: for how often something recurs, "monthly" reads too). */
export function durationForms(text: string, repeating: boolean): string[] {
  let seconds: number;
  try {
    seconds = calls.parseDuration(text);
  } catch {
    return [];
  }
  const DAY = 86_400;
  const forms: string[] = [];
  const of = (n: number, unit: string) => forms.push(`${n} ${unit}${n === 1 ? "" : "s"}`, ...(n === 1 ? [`${/^[aeiou]/.test(unit) ? "an" : "a"} ${unit}`] : []), ...(repeating ? [n === 1 ? `every ${unit}` : `every ${n} ${unit}s`] : []));
  if (seconds % DAY === 0) of(seconds / DAY, "day");
  if (seconds % (7 * DAY) === 0) of(seconds / (7 * DAY), "week");
  if (seconds % (30 * DAY) === 0) of(seconds / (30 * DAY), "month");
  if (seconds % (365 * DAY) === 0) of(seconds / (365 * DAY), "year");
  if (seconds === 14 * DAY) forms.push("a fortnight");
  if (repeating) forms.push(...Object.entries({ daily: DAY, weekly: 7 * DAY, fortnightly: 14 * DAY, monthly: 30 * DAY, quarterly: 90 * DAY, yearly: 365 * DAY }).filter(([, v]) => v === seconds).map(([k]) => k));
  return [...new Set(forms)].filter((f) => f !== text && same(() => calls.parseDuration(f), seconds));
}

const same = <T>(f: () => T, want: T): boolean => {
  try {
    return f() === want;
  } catch {
    return false;
  }
};

/**
 * The same program written another way on its surface: an organisation or person by its name instead of its id
 * (which a call writes as the name, quoted: the resolver looks it up), an amount or a length of time in another
 * format that parses to the same number. What it does is unchanged; what a request for it must copy is different,
 * so the model learns to copy what's written, in whatever form, and not one way of writing things.
 */
export function surfaceVariant(g: Gold, rand: () => number): Gold {
  const p = calls.parseProgram(g.program);
  if ("none" in p) return g;
  const choose = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const value = (key: string, v: calls.Value): calls.Value => {
    if ("call" in v) return { call: call(v.call) };
    if ("id" in v && g.names[v.id] && !/["\\]/.test(g.names[v.id]!) && rand() < 0.4) return { text: g.names[v.id]! };
    if ("text" in v && AMOUNT_ARGS.has(key) && rand() < 0.6) return { text: choose([v.text, ...amountForms(v.text)]) };
    if ("text" in v && DURATION_ARGS.has(key) && rand() < 0.6) return { text: choose([v.text, ...durationForms(v.text, key === "every")]) };
    return v;
  };
  const call = (c: calls.Call): calls.Call => ({ fn: c.fn, args: Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, value(k, v)])) });
  return { ...g, program: calls.programText({ lines: p.lines.map((l) => ({ ...l, call: call(l.call) })) }) };
}

/** Gold programs from the seen test cases (each case's first accepted answer): the functions a town's own code rarely
 * or never calls (a trust set up, a claim recorded, a post created) are there. Never from held-out cases. */
export function goldFromCases(cases: Case[]): Gold[] {
  return cases.filter((c) => !c.held_out && !c.expect[0]!.startsWith("none(")).map((c) => {
    const p = calls.parseProgram(c.expect[0]!);
    return { program: calls.programText(p), shape: shapeOf(p), names: {}, source: `case ${c.id}` };
  });
}

/** The ways a request can be written. Each is a line of instruction to the writer. */
export const STYLES: { [style: string]: string } = {
  terse: "As short as it can be said: a few words, like a note to staff.",
  formal: "Formal and complete, as in an official instruction.",
  chatty: "Conversational, the way someone talks to a colleague they know well.",
  reasoned: "With a short reason or a little background attached, before or after what's wanted.",
  polite: "As a polite question or request (\"could you…\", \"please…\", \"I'd like…\").",
  bracketed: "Naming things with their ids in square brackets, as someone reading them off a report would: [acc-city], [rec.412].",
};

/** What the writer is told. The call language's own glosses, and the one rule that makes the data usable: copy. */
export function writerSystem(): string {
  return [
    "You write the requests that people in a town make of whoever carries things out for them: a mayor to an office, a business owner to a clerk, a resident to an agent. Each request is one to three sentences of plain language.",
    "You're given what should happen, as a call in a small formal language (function(argument=value, …); an id is a bare word like acc-city or rec.412; quoted text is copied text), and a style.",
    "Write a request that means exactly that call: everything the call says, and nothing it doesn't.",
    "- Every id and every quoted value in the call must appear in your request exactly as written, character for character (the id acc-city as acc-city; the amount \"$1,200\" as $1,200; a quoted text word for word). Don't reformat amounts or durations, and don't replace an id with a description.",
    "- Don't mention the call, its function names or its argument names; say it as a person would.",
    "- Don't add details the call doesn't have (no dates, reasons that change what's asked, extra recipients).",
    "Answer with the request only.",
  ].join("\n");
}

/** A request for a gold program in a style, from a model. */
export async function writeRequest(adapter: LlmAdapter, gold: Gold, style: string, usage?: (u: Usage) => void): Promise<string | undefined> {
  const names = Object.entries(gold.names).map(([id, name]) => `${id} is ${name}`);
  const res = await adapter.complete({
    purpose: "translator", subject: "training-data-writer", system: writerSystem(), maxTokens: 600,
    messages: [{ role: "user", content: [`Call:\n${gold.program}`, ...(names.length ? [`For your understanding only (still write the ids): ${names.join("; ")}.`] : []), `Style: ${STYLES[style] ?? style}`].join("\n\n") }],
  });
  usage?.(res.usage);
  const text = res.content.filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text").map((b) => b.text).join(" ").trim();
  return text ? text.replace(/^["“]|["”]$/g, "").trim() : undefined;
}

/** Whether a request carries every literal of its program, exactly (the translator copies; it never composes). */
export function copies(request: string, program: string): boolean {
  return literals(calls.parseProgram(program)).every((l) => request.includes(l));
}

/** A program with the same meaning counts as the same: compared in canonical form (eval/run.ts). */
export const sameProgram = (a: string, b: string): boolean => canonical(a) === canonical(b);

/** A stable id for an example: from what it is. */
const exampleId = (request: string, program: string) => sha256(canonicalJson({ request, program })).slice(0, 16);

/**
 * Refusals that can be built without anyone's judgement:
 *  - too_much: four or more unrelated requests run together;
 *  - unknown_form: a request to fill in a form, shown to the translator without that form.
 * (needs_calculation, not_yours and unclear have to be written; they come from a writer, checked by a second model.)
 */
export function builtRefusals(positives: Example[], seed = 1, share = 0.05): Example[] {
  const rand = sampler(seed);
  const out: Example[] = [];
  const pick = () => positives[Math.floor(rand() * positives.length)]!;
  const n = Math.floor(positives.length * share);
  for (let i = 0; i < n && positives.length >= 8; i++) {
    const parts = new Map<string, Example>();
    for (let tries = 0; parts.size < 4 + Math.floor(rand() * 3) && tries < 64; tries++) {
      const e = pick();
      if (![...parts.values()].some((x) => x.shape === e.shape)) parts.set(e.id, e);
    }
    if (parts.size < 4) continue;
    const request = [...parts.values()].map((e) => e.request.replace(/\s+/g, " ").trim()).join(rand() < 0.5 ? " Also: " : " And then: ");
    out.push({ id: exampleId(request, "none(too_much)"), request, forms: [], program: "none(too_much)", kind: "refusal", shape: "none(too_much)", source: "built: several requests run together" });
  }
  for (const e of positives.filter((e) => e.shape.startsWith("form(") && e.forms.length)) {
    if (rand() >= Math.max(share * 4, 0.2)) continue;
    out.push({ ...e, id: exampleId(e.request, "none(unknown_form)"), forms: [], program: "none(unknown_form)", kind: "refusal", shape: "none(unknown_form)", source: "built: the form left out of what's known" });
  }
  return out;
}

export interface Manifest {
  version: string;
  examples: number;
  by_kind: { [k: string]: number };
  by_shape: { [shape: string]: number };
  writers: { [model: string]: number };
  dropped: { not_copied: number; round_trip: number; duplicate: number };
  usage: { [model: string]: Usage };
  /** SHA-256 of the examples file: recorded with any model trained on it (§16.4). */
  sha256: string;
}

/**
 * Write requests for the gold programs and keep the ones that hold up.
 * `writers`: the models that write requests, taken in turn, each asked for the styles in turn.
 * `back`: translates a request to a program through the real translator (a different model from the writer's is the
 * point); absent, examples are kept unverified and marked so.
 * `heldOut`: the held-out cases, if this machine has them: any shared wording stops the data being returned.
 */
export async function generate(gold: Gold[], o: {
  writers: LlmAdapter[];
  styles?: string[];
  perGold?: number;
  back?: { model: string; translate: (request: string, forms: string[]) => Promise<string | undefined> };
  heldOut?: Case[];
  seed?: number;
  log?: (s: string) => void;
}): Promise<{ examples: Example[]; manifest: Manifest }> {
  const styles = o.styles ?? Object.keys(STYLES);
  const perGold = o.perGold ?? 3;
  const usage: { [model: string]: Usage } = {};
  const add = (model: string) => (u: Usage) => {
    const t = (usage[model] ??= { input_tokens: 0, output_tokens: 0 });
    t.input_tokens += u.input_tokens + (u.cache_read_tokens ?? 0);
    t.output_tokens += u.output_tokens;
  };
  const dropped = { not_copied: 0, round_trip: 0, duplicate: 0 };
  const seen = new Set<string>();
  const positives: Example[] = [];
  let turn = 0;
  for (const [gi, g] of gold.entries()) {
    for (let i = 0; i < perGold; i++, turn++) {
      const writer = o.writers[turn % o.writers.length]!;
      const style = styles[turn % styles.length]!;
      const model = `${writer.provider}/${writer.model}`;
      const request = await writeRequest(writer, g, style, add(model));
      if (!request) continue;
      if (!copies(request, g.program)) {
        dropped.not_copied++;
        continue;
      }
      const key = request.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) {
        dropped.duplicate++;
        continue;
      }
      seen.add(key);
      let verified: string | undefined;
      if (o.back) {
        const got = await o.back.translate(request, []);
        if (got === undefined || !sameProgram(got, g.program)) {
          dropped.round_trip++;
          continue;
        }
        verified = o.back.model;
      }
      positives.push({ id: exampleId(request, g.program), request, forms: [], program: g.program, kind: "positive", shape: g.shape, style, written_by: model, ...(verified ? { verified_by: verified } : {}), source: g.source });
    }
    if (o.log && (gi + 1) % 25 === 0) o.log(`${gi + 1}/${gold.length} programs; ${positives.length} examples kept`);
  }
  const examples = [...positives, ...builtRefusals(positives, o.seed ?? 1)];
  if (o.heldOut?.length) {
    const shared = leaks(o.heldOut, [{ name: "the training data", text: examples.map((e) => e.request).join("\n") }]);
    if (shared.length) throw new Error(`the training data shares wording with ${new Set(shared.map((s) => s.id)).size} held-out case(s) (${[...new Set(shared.map((s) => s.id))].join(", ")}): not usable as it is`);
  }
  const count = (key: (e: Example) => string | undefined) => {
    const out: { [k: string]: number } = {};
    for (const e of examples) {
      const k = key(e);
      if (k !== undefined) out[k] = (out[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(out).sort());
  };
  const manifest: Manifest = {
    version: DATA_VERSION, examples: examples.length, by_kind: count((e) => e.kind), by_shape: count((e) => e.shape), writers: count((e) => e.written_by), dropped, usage,
    sha256: sha256(examples.map((e) => canonicalJson(e)).join("\n")),
  };
  return { examples, manifest };
}
