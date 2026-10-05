// Training data for the local translation model (docs/design/translator-and-resolver.md §16.4): requests in plain
// language, each with the program it should become.
//
//   gold programs   come free from our own runs: every act a code participant made carries the call it wrote
//                   (`provenance.call`). They are sampled by shape, so the rare ones aren't drowned by the common.
//                   What a town's code rarely or never does is generated from the contract (synthetic.ts), and the
//                   two are put together with a floor under every function (orchestrator/src/training.ts).
//   forms           a request to fill in a form carries the forms its asker knows of, as the translator is shown
//                   them (`formLine`): the model fills any form from its listed fields.
//   requests        are written by models, several to a program, in several styles: by whichever models the caller
//                   gives (several, so the translator doesn't learn one writer's voice).
//   every literal   of the program (an id, a name, an amount, a text) must appear in the request exactly: the
//                   translator copies, it never composes (§16.10). A request that lost one is dropped, mechanically.
//   a second model  then translates the request back, through the real translator path; it is kept if the program
//                   that comes back is the gold one (a round trip).
//   refusals        are built, not judged, where they can be: several requests run together (too_much), a form the
//                   person doesn't know of (unknown_form), an amount that would have to be worked out
//                   (needs_calculation).
//   riders          what office-holders say that adds nothing to the program (the capacity they act in, a record
//                   cited in passing, a closing "do not …") is recorded as that, with where it is.
//   the split       into training and validation is by gold program, and by form (`split`).
//   money           is any world's: amounts are written and read in the currency of the world a program is from.
//
// Nothing here reads the held-out cases; the finished data is checked against them for shared wording before it is
// used (eval/held-out.ts), and any request that shares some is dropped.
//
// The sampling is seeded (a generator of its own: this is tooling, not a world, and takes nothing from a run's
// randomness), so the same logs and seed give the same programs to write requests for.

import { calls, canonical as canonicalJson, type Currency } from "@oikos/participants";
import type { LlmAdapter, Usage } from "@oikos/participants/llm";
import { canonical, fixture, TEST_CURRENCY, tidy } from "../eval/run";
import { sharesWording } from "../eval/held-out";
import type { Case } from "../eval/cases";
import { Knowledge } from "../src/knowledge";

export const DATA_VERSION = "0.2.0";

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

/** A form as someone knows of it: its name, the office it goes to, and its fields in the order it lists them. */
export interface FormField { type: string; required?: boolean; options?: string[] }
export interface FormSpec { form: string; to: string; fields: { [name: string]: FormField }; /** Its record's id, where the form is a real one (a generated form's is made from its office and name). */ id?: string }

/** The types of field a form can have, as the resolver reads them (translator/src/resolver.ts, `form`): the first
 * seven each have a reading of their own; any other type's value is an id, and these are the ones worlds use. */
export const FIELD_TYPES = ["amount", "duration", "count", "text", "choice", "space", "structure_type", "lot", "cell", "account", "record", "entity", "person", "structure", "position"] as const;

/** A form as the translator is shown it: one line, exactly as `translatorContext()` writes it (translator/src/index.ts;
 * a test holds the two together). */
/** The id of a form's record, as these generated forms have it (the translator is shown it beside the name). */
export const formId = (f: FormSpec): string => f.id ?? `form-${f.to}-${f.form}`.replace(/_/g, "-");

export function formLine(f: FormSpec): string {
  const field = ([k, v]: [string, FormField]) => `${k} (${v.type === "choice" && v.options?.length ? `one of ${v.options.join(" | ")}` : v.type}${v.required ? ", required" : ""})`;
  return `- ${f.form}, to=${f.to}, id ${formId(f)}: fields ${Object.entries(f.fields).map(field).join(", ")}`;
}

/**
 * What someone knows who knows of these forms and nothing else, in a world whose money is written this way: what the
 * translator is given when a request is translated back (its context shows each form as `formLine` writes it).
 */
export function knowing(forms: FormSpec[], currency: Currency): Knowledge {
  const k = new Knowledge(currency);
  if (forms.length) k.absorb({
    participant: "someone", t: 0, status: "active", entity: "someone", outcomes: [], inbox: [], drafts: [],
    channels: { known: { kind: "records", records: forms.map((f) => ({ id: formId(f), record: "statement", author: f.to, in_position: f.to, at: 0, visible_to: "public", kind: "form", text: `${f.form.replace(/_/g, " ")}.`, data: { form: f.form, submit_as: f.form, submit_to: [f.to], fields: f.fields } })) } },
  } as any);
  return k;
}

/**
 * A program to write requests for: its text, its shape, and the names of the things it mentions by id.
 * `origin`: where it came from (a run's log, a seen test case, or generated from the contract: synthetic.ts), with
 * `source` saying which. `family`: the program it's another surface of (surfaceVariant), so the two are never split
 * between training and validation. `currency`: how its world writes money (its amounts are in it). `forms`: the
 * forms the person asking knows of (a form request's own, and any shown beside it), which the translator is shown.
 */
export interface Gold {
  program: string; shape: string; names: { [id: string]: string }; source: string;
  origin?: "log" | "case" | "synthetic";
  family?: string;
  currency?: Currency;
  forms?: FormSpec[];
}

/** Something a request says that adds nothing to its program: the capacity it's said in, a record cited in passing, a
 * closing "do not …" that rules out what wasn't asked for. */
export interface Rider { kind: "capacity" | "citation" | "do_not"; text: string }

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
  /** Where each value the program takes from the request is in it: the argument, the value, and [start, end) in
   * characters (what a model that points at spans is trained on). */
  spans?: { arg: string; value: string; at: [number, number] }[];
  /** Who wrote the request, and who translated it back (absent: built mechanically, or not yet verified). */
  written_by?: string;
  verified_by?: string;
  source: string;
  /** Where its gold program came from (log, case, synthetic). */
  origin?: string;
  /** The gold program this was written for or built from, by its family (Gold.family): what a split keeps together. */
  gold?: string;
  /** What the request says that adds nothing to the program (the style asked for it), and where: each `adds: "nothing"`. */
  riders?: { kind: Rider["kind"]; text: string; at: [number, number]; adds: "nothing" }[];
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
    else if ("json" in v) (Array.isArray(v.json) ? v.json : flat(v.json) ? Object.values(v.json) : []).forEach((x) => typeof x === "string" && out.push(x));
    else if ("call" in v) Object.values(v.call.args).forEach(value);
  };
  for (const l of p.lines) Object.values(l.call.args).forEach(value);
  return [...new Set(out)];
}

/** A claim's content as the first model can fill it: one to four named slots, each a word or an id
 * (`{"action":"build","object":"lot-12-03"}`); nothing nested, no numbers. */
const flat = (j: unknown): j is { [slot: string]: string } =>
  !!j && typeof j === "object" && !Array.isArray(j) && Object.keys(j).length >= 1 && Object.keys(j).length <= 4 && Object.values(j).every((x) => typeof x === "string" && x.length > 0 && x.length <= 64);

/**
 * The arguments whose value is structured data a copying model can't write (contracts/calls.md): out of the first
 * model's scope, so a program carrying one is no gold program. (A list of names or ids is copied name by name, and a
 * claim's content is slots: see `needed`.)
 */
export const JSON_OUT_OF_SCOPE = ["statement.data", "statement.adico", "statement.offer", "statement.practice", "statement.assertion", "statement.registry", "presence.variables", "position.channels", "position.role_module", "entity.channels", "entity.role_module"] as const;

/**
 * Why a program isn't one a person could ask for in a sentence or two, or undefined if it is (§16.2): a line, or a
 * few with names bound between them; no structured data beyond a list of names and a claim's slots (what code
 * publishes for other code to read isn't a request anyone words), and nothing carrying out someone else's instruction
 * (a keeper's bookkeeping).
 */
export function whyNot(p: calls.Program, maxLines = 3): string | undefined {
  if ("none" in p) return "a refusal";
  if (p.lines.length > maxLines) return `more than ${maxLines} lines`;
  // (A sentence or two holds a short text, a handful of names, and about ten things to get right.)
  const why = (c: calls.Call): string | undefined => {
    for (const [k, v] of Object.entries(c.args)) {
      if (k === "per_request") return "carries out someone's instruction (per_request)";
      if ("json" in v) {
        if (Array.isArray(v.json)) {
          if (!v.json.every((x) => typeof x === "string")) return `structured data: ${c.fn}.${k}`;
          if (v.json.length > 4) return "a list of more than four";
        } else if (!(k === "about" && c.fn === "claim" && flat(v.json))) return `structured data: ${c.fn}.${k}`;
      } else if ("call" in v) {
        const inner = why(v.call);
        if (inner) return inner;
      } else if ("text" in v && v.text.length > 160) return "a text of more than 160 characters";
    }
    return undefined;
  };
  for (const l of p.lines) {
    const w = why(l.call);
    if (w) return w;
  }
  return literals(p).length > 10 ? "more than ten values" : undefined;
}

/** Whether a program is one a person could ask for in a sentence or two: see `whyNot`. */
export function askable(p: calls.Program, maxLines = 3): boolean {
  return whyNot(p, maxLines) === undefined;
}

/** A gold program as it's kept: tidied (eval/run.ts), and a payment's purpose without a full stop a sentence would
 * swallow ("for rent." asked for in a sentence is "for rent"). */
export function goldText(p: calls.Program): string {
  const t = tidy(p);
  if ("none" in t) return calls.programText(t);
  const value = (k: string, v: calls.Value): calls.Value => ("call" in v ? { call: call(v.call) } : "text" in v && k === "for" ? { text: v.text.replace(/[.\s]+$/, "") || v.text } : v);
  const call = (c: calls.Call): calls.Call => ({ fn: c.fn, args: Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, value(k, v)])) });
  return calls.programText({ lines: t.lines.map((l) => ({ ...l, call: call(l.call) })) });
}

/** Arguments whose bare value is a yes-or-no kind of choice the request implies without saying the word (someone
 * "is leaving": `leave=yes`; "is permitted to": `position=liberty`): never looked for in the request. */
const IMPLIED = new Set(["leave", "then", "position", "sex", "visible"]);

/** What a request has to carry of its program, each with how it must appear. */
export interface Needed { value: string; arg: string; exact: boolean }

/**
 * What a request has to carry of its program for a model that copies and chooses (design §16.10) to learn from it:
 *  - exactly, character for character: copied text (amounts, durations, names, a letter's words) and anything that
 *    reads as an id (acc-city, rec.412, c0042, apts-3/dwelling.2);
 *  - as a word of the request: a bare word naming something in the world's catalogue or a record's kind (`park`,
 *    `make`, `lease`, `notice`, `permit_application`: in any case, with spaces for underscores), so the model points
 *    at it and never has to guess a word nobody said;
 *  - not at all: a yes-or-no kind of choice the wording implies (IMPLIED).
 * A claim's content (`about={"action":"build","object":"lot-12-03"}`) is JSON in the call, which a copying model can't
 * write, so it's carried as slots: `about.action` (a word of the request) and `about.object` (an id, exactly), each
 * found like any other value. The program stays as the call language writes it; whoever decodes the model's answer
 * puts the slots back into the object.
 */
export function needed(p: calls.Program): Needed[] {
  if ("none" in p) return [];
  const bound = new Set(p.lines.map((l) => l.bind).filter(Boolean));
  const out: Needed[] = [];
  const idLike = (s: string) => /[0-9.\/-]/.test(s); // (not an underscore: a form or a kind named in two words is a word)
  const value = (arg: string, v: calls.Value) => {
    if ("id" in v) {
      if (bound.has(v.id) || IMPLIED.has(arg)) return;
      out.push({ value: v.id, arg, exact: idLike(v.id) });
    } else if ("text" in v) out.push({ value: v.text, arg, exact: true });
    else if ("json" in v) {
      if (Array.isArray(v.json)) v.json.forEach((x) => typeof x === "string" && out.push({ value: x, arg, exact: idLike(x) }));
      else if (flat(v.json)) for (const [slot, x] of Object.entries(v.json)) out.push({ value: x, arg: `${arg}.${slot}`, exact: idLike(x) || /\s/.test(x) });
    } else if ("call" in v) Object.entries(v.call.args).forEach(([k, x]) => value(`${arg}.${k}`, x));
  };
  for (const l of p.lines) Object.entries(l.call.args).forEach(([k, v]) => value(k, v));
  return out;
}

/** Where a needed value is in a request: [start, end) in characters, or undefined if it isn't there. */
export function spanOf(request: string, n: Needed): [number, number] | undefined {
  if (n.exact) {
    // Where it stands by itself, if it does anywhere ("3" in "3 units", not the 3 of rec.30); otherwise wherever it is.
    const wordy = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c);
    const joint = (c: string | undefined) => c === "." || c === "-" || c === "/" || c === ",";
    const first = request.indexOf(n.value);
    for (let at = first; at >= 0; at = request.indexOf(n.value, at + 1)) {
      const end = at + n.value.length;
      const joinedBefore = wordy(n.value[0]) && (wordy(request[at - 1]) || (joint(request[at - 1]) && wordy(request[at - 2])));
      const joinedAfter = wordy(n.value[n.value.length - 1]) && (wordy(request[end]) || (joint(request[end]) && wordy(request[end + 1])));
      if (!joinedBefore && !joinedAfter) return [at, end];
    }
    return first < 0 ? undefined : [first, first + n.value.length];
  }
  // A word of the request, in any case, underscores as spaces, not inside a longer word.
  const m = new RegExp(`(?<![A-Za-z0-9])${n.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, "[ _-]")}(?![A-Za-z0-9])`, "i").exec(request);
  return m ? [m.index, m.index + m[0].length] : undefined;
}

/** The values a request has to carry exactly (ids and copied text): see `needed`. */
export function mustAppear(p: calls.Program): string[] {
  return [...new Set(needed(p).filter((n) => n.exact).map((n) => n.value))];
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

/** The forms a world's config holds (records of kind form, with their fields), as someone there knows of them. */
export function formsIn(config: unknown): FormSpec[] {
  const out: FormSpec[] = [];
  const walk = (v: any) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const to = v.in_position ?? v.speaks_for ?? v.author;
      if (typeof v.data?.form === "string" && v.data.fields && typeof v.data.fields === "object" && typeof to === "string") {
        out.push({ ...(typeof v.id === "string" ? { id: v.id } : {}), form: v.data.form, to, fields: Object.fromEntries(Object.entries(v.data.fields as { [k: string]: any }).map(([k, f]) => [k, { type: String(f.type), ...(f.required ? { required: true } : {}), ...(Array.isArray(f.options) ? { options: f.options.map(String) } : {}) }])) });
      } else Object.values(v).forEach(walk);
    }
  };
  walk(config);
  return out;
}

/** The form a program fills in, by name (and office, if it says), or undefined if it fills none. */
export function formOf(program: string): { form: string; to?: string } | undefined {
  try {
    const p = calls.parseProgram(program);
    if ("none" in p) return undefined;
    const c = p.lines.map((l) => l.call).find((x) => x.fn === "form");
    const f = c?.args.form, to = c?.args.to;
    const name = f && ("id" in f ? f.id : "text" in f ? f.text.trim().toLowerCase().replace(/^the\s+/, "").replace(/[\s-]+/g, "_") : undefined);
    return name ? { form: name, ...(to && "id" in to ? { to: to.id } : {}) } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The programs in a run's log worth writing requests for: the calls code participants wrote, askable ones only, at
 * most `perShape` different programs of each shape (a seeded sample of those seen), in shape order. Each carries how
 * its world writes money (the log's header) and, for a form filled in, that form as the world's config has it, with
 * up to two of the world's other forms beside it. `currency`: the money of a log whose header doesn't say.
 * `excluded`: counts, by reason, the acts whose call was left out.
 */
export async function goldFromLog(lines: AsyncIterable<string> | Iterable<string>, o: { perShape?: number; seed?: number; source?: string; currency?: Currency; excluded?: { [reason: string]: number } } = {}): Promise<Gold[]> {
  const perShape = o.perShape ?? 8;
  const rand = sampler(o.seed ?? 1);
  let names: { [id: string]: string } = {};
  let currency = o.currency;
  let forms: FormSpec[] = [];
  const out_ = (reason: string) => void (o.excluded && (o.excluded[reason] = (o.excluded[reason] ?? 0) + 1));
  const kept = new Map<string, { programs: string[]; seen: number }>();
  for await (const line of lines as AsyncIterable<string>) {
    if (line.startsWith('{"body":{"canary"') || line.includes('"kind":"header"')) {
      try {
        const e = JSON.parse(line);
        if (e.kind === "header") {
          names = namesIn(e.body?.config);
          forms = formsIn(e.body?.config);
          const cur = e.body?.config?.world?.currencies?.[0];
          // (A log from before a world's config said how its money is written (2026-10-05) gives a code alone: it's
          // read with the currency the caller gives, if that's the same one.)
          if (cur && typeof cur.code === "string" && Number.isInteger(cur.minor_units)) currency = o.currency && o.currency.code === cur.code && cur.symbol === undefined && !cur.unit_words ? o.currency : cur;
        }
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
    const why = whyNot(p) ?? (calls.contractErrors(p).length ? "against the contract" : undefined);
    if (why) {
      out_(why);
      continue;
    }
    const program = goldText(p);
    const shape = shapeOf(calls.parseProgram(program));
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
    const f = formOf(program);
    const own = f ? forms.filter((x) => x.form === f.form) : [];
    const beside = own.length ? shuffled(forms.filter((x) => x.form !== f!.form), rand).slice(0, Math.floor(rand() * 3)) : [];
    out.push({ program, shape, names: Object.fromEntries(Object.entries(names).filter(([id]) => mentioned.has(id))), source: o.source ?? "log", origin: "log", ...(currency ? { currency } : {}), ...(own.length ? { forms: shuffled([...own, ...beside], rand) } : {}) });
  }
  return out;
}

/** A list in a seeded order. */
export function shuffled<T>(xs: readonly T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const AMOUNT_ARGS = new Set(["amount", "price", "carrying"]);
const DURATION_ARGS = new Set(["every", "term", "our_notice", "their_notice", "first"]);

/**
 * Every way this pipeline writes an amount (a count of the currency's smallest unit) in a world's money, each checked
 * to read back as the same number: its sign or code before the digits, grouped or not, with its decimals or (a round
 * sum) without; its code or a word for its unit after them; bare digits, which are whole units; a multiplier (k, m,
 * thousand, million) on a sum that is one; and counted out in its smallest unit, where that has a name. Nothing here
 * knows any currency: the sign, the words and the decimal places are the world's (`Currency`).
 */
export function amountWritings(n: bigint, cur: Currency): string[] {
  if (n < 0n) return [];
  const per = 10n ** BigInt(cur.minor_units);
  const whole = n / per;
  const round = n % per === 0n;
  const frac = cur.minor_units > 0 ? (n % per).toString().padStart(cur.minor_units, "0") : "";
  const plain = whole.toString();
  const grouped = plain.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const digits = [...new Set(round ? [grouped, plain, ...(frac ? [`${grouped}.${frac}`] : [])] : [`${grouped}.${frac}`, `${plain}.${frac}`])];
  const sign = cur.symbol ?? `${cur.code} `;
  const units = cur.unit_words ?? [];
  const words = whole === 1n && round ? units.slice(0, 1) : units.length > 1 ? units.slice(1) : units;
  const forms = [
    ...digits.map((d) => `${sign}${d}`),
    ...words.map((w) => `${digits[0]} ${w}`),
    `${digits[0]} ${cur.code}`,
    ...(cur.symbol !== undefined ? [`${cur.code} ${digits[0]}`] : []),
    digits[0]!,
  ];
  if (round && whole > 0n) {
    if (whole % 1_000n === 0n) forms.push(`${sign}${whole / 1_000n}k`, `${whole / 1_000n}k`, ...words.map((w) => `${whole / 1_000n} thousand ${w}`));
    else if (whole % 100n === 0n && whole > 1_000n) forms.push(`${sign}${whole / 1_000n}.${(whole % 1_000n) / 100n}k`);
    if (whole % 1_000_000n === 0n) forms.push(`${sign}${whole / 1_000_000n}m`, `${sign}${whole / 1_000_000n} million`, ...words.map((w) => `${whole / 1_000_000n} million ${w}`));
  }
  const minor = cur.minor_words ?? [];
  if (minor.length && n > 0n && n < 100_000n) forms.push(`${n} ${n === 1n ? minor[0] : minor[minor.length - 1]}`);
  return [...new Set(forms)].filter((f) => same(() => calls.parseAmount(f, cur), n.toString()));
}

/** Other ways of writing the same amount in a world's money (`amountWritings`), each reading back as the same number. */
export function amountForms(text: string, cur: Currency): string[] {
  let n: string;
  try {
    n = calls.parseAmount(text, cur);
  } catch {
    return [];
  }
  return amountWritings(BigInt(n), cur).filter((f) => f !== text);
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
 * so the model learns to copy what's written, in whatever form, and not one way of writing things. Amounts are
 * rewritten in the world's own money (`cur`, or the gold's own if it carries one); with neither they're left as they are.
 */
export function surfaceVariant(g: Gold, rand: () => number, cur: Currency | undefined = g.currency): Gold {
  const p = calls.parseProgram(g.program);
  if ("none" in p) return g;
  const choose = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const fields = formOf(g.program) ? Object.assign({}, ...(g.forms ?? []).filter((f) => f.form === formOf(g.program)!.form).map((f) => f.fields)) as { [k: string]: FormField } : {};
  const value = (key: string, v: calls.Value): calls.Value => {
    if ("call" in v) return { call: call(v.call) };
    if ("id" in v && g.names[v.id] && !/["\\]/.test(g.names[v.id]!) && rand() < 0.4) return { text: g.names[v.id]! };
    if ("text" in v && cur && (AMOUNT_ARGS.has(key) || fields[key]?.type === "amount") && rand() < 0.6) return { text: choose([v.text, ...amountForms(v.text, cur)]) };
    if ("text" in v && (DURATION_ARGS.has(key) || fields[key]?.type === "duration") && rand() < 0.6) return { text: choose([v.text, ...durationForms(v.text, key === "every")]) };
    return v;
  };
  const call = (c: calls.Call): calls.Call => ({ fn: c.fn, args: Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, value(k, v)])) });
  return { ...g, family: g.family ?? g.program, program: calls.programText({ lines: p.lines.map((l) => ({ ...l, call: call(l.call) })) }) };
}

/** Gold programs from the seen test cases (each case's first accepted answer): the functions a town's own code rarely
 * or never calls (a trust set up, a claim recorded, a post created) are there. Never from held-out cases. Their
 * amounts are in the test town's money, and a form filled in carries the form the test's mayor knows of. */
export function goldFromCases(cases: Case[]): Gold[] {
  const known: FormSpec[] = fixture().forms.map((f) => ({ id: f.id, form: String(f.data?.form), to: String((f as any).in_position ?? (f as any).speaks_for ?? f.author), fields: (f.data?.fields ?? {}) as FormSpec["fields"] }));
  return cases.filter((c) => !c.held_out && !c.expect[0]!.startsWith("none(")).filter((c) => askable(calls.parseProgram(c.expect[0]!))).map((c) => {
    const program = goldText(calls.parseProgram(c.expect[0]!));
    const own = known.filter((f) => f.form === formOf(program)?.form);
    return { program, shape: shapeOf(calls.parseProgram(program)), names: {}, source: `case ${c.id}`, origin: "case" as const, currency: TEST_CURRENCY, ...(own.length ? { forms: own } : {}) };
  });
}

/**
 * The ways a request can be written. Each is a line of instruction to the writer. The last five are how the pilots'
 * office-holders wrote (docs/real-models.md, and the requests in the pilots' logs): the capacity stated first, a name
 * with its id in square brackets after it, a record cited in passing, a closing "do not …", and one long instruction
 * of stacked clauses. For a gold program, `styleBrief` gives three of them their exact words.
 */
export const STYLES: { [style: string]: string } = {
  terse: "As short as it can be said: a few words, like a note to staff.",
  formal: "Formal and complete, as in an official instruction.",
  chatty: "Conversational, the way someone talks to a colleague they know well.",
  reasoned: "With a short reason or a little background attached, before or after what's wanted.",
  polite: "As a polite question or request (\"could you…\", \"please…\", \"I'd like…\").",
  bracketed: "Naming things with their ids in square brackets, as someone reading them off a report would: [acc-city], [rec.412].",
  capacity: "Opening with the capacity it's said in, as an office-holder does (\"As Mayor of the town, …\"). The opening changes nothing about what is asked.",
  named: "Naming each organisation, person and office by its name or role with its id in square brackets straight after it (the works manager [works], the town account [acc-city]); an id with no name known goes in square brackets by itself.",
  cited: "As an office-holder who cites, in passing, what an act rests on or answers (\"under …\", \"pursuant to …\", \"responding to …\"), with the record's id.",
  do_not: "Ending with a sentence that begins \"Do not\" and rules out something that was never asked for. It changes nothing about what is asked.",
  stacked: "As one long, careful instruction of stacked clauses, the way an office-holder writes: what is to be done, to or for whom, from what, on what terms, each its own clause, joined by commas, semicolons and \"and\". Nothing is added that the call doesn't say.",
};

const OFFICES = ["Mayor", "Works Manager", "Finance Officer", "Planning Officer", "Council Clerk", "Treasurer", "Harbour Master", "Registrar", "Housing Officer", "Chair", "Director", "Secretary", "Head Teacher", "Warden", "Rates Officer", "Building Inspector"];
const TOWNS = ["Harrow Vale", "Tarn Hollow", "Eastmere", "Quillby", "Marrow Ford", "Oster Bay", "Pennick", "Saltreach", "Dunmere", "Alder Cross", "Wexcombe", "Thistle Down", "the town", "the cooperative", "the trust"];
const CITES = ["under", "pursuant to", "in accordance with", "responding to petition", "further to", "as resolved in", "acting on", "consistent with"];
const CITED = ["charter", "planning", "tenancy", "rates", "property", "noise", "markets", "water", "procurement", "records", "payments", "elections"];
/** Each rules out only what a single request never asks for, whatever the request is. */
const DO_NOT = [
  "Do not do anything beyond this.",
  "Do not change anything else.",
  "Do not treat this as approval of anything further.",
  "Do not take any other step on my behalf.",
  "Do not alter or reverse anything already done.",
  "Do not read this as authorising anything not stated here.",
  "Do not act on any related matter until I say so.",
  "This does not authorise anything beyond what is stated.",
];

/**
 * What the writer is told for a gold program in a style, and the riders the request must then carry word for word.
 * A rider adds nothing to the program: the capacity an act is made in is on the action, not in the call
 * (contracts/calls.md); a "do not" that rules out what wasn't asked for asks for nothing; and a citation is a rider
 * only where the call has nowhere to put one. Where the program cites a record (`basis`), the cited style words that
 * record as the citation; where it could cite one and doesn't, a citation would change it, so the request is written
 * formally with none.
 */
export function styleBrief(style: string, g: Gold, rand: () => number): { style: string; instruction: string; riders: Rider[] } {
  const base = STYLES[style] ?? style;
  const choose = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  if (style === "capacity") {
    const text = `As ${choose(OFFICES)} of ${choose(TOWNS)}`;
    return { style, instruction: `${base} Open with exactly these words: "${text}," and go on to the request.`, riders: [{ kind: "capacity", text }] };
  }
  if (style === "do_not") {
    const text = choose(DO_NOT);
    return { style, instruction: `${base} End with exactly this sentence: "${text}"`, riders: [{ kind: "do_not", text }] };
  }
  if (style === "cited") {
    const p = calls.parseProgram(g.program);
    const lines = "none" in p ? [] : p.lines;
    if (lines.some((l) => "basis" in l.call.args)) return { style, instruction: `${base} The record the call cites is the one to word that way.`, riders: [] };
    const form = formOf(g.program);
    const couldCite = lines.some((l) => calls.ARGS[l.call.fn]?.allowed?.has("basis")) || (g.forms ?? []).some((f) => f.form === form?.form && Object.values(f.fields).some((x) => x.type === "record"));
    if (couldCite) return { style: "formal", instruction: STYLES.formal!, riders: [] };
    const used = new Set(literals(p));
    let id = "";
    for (let tries = 0; tries < 8 && (!id || used.has(id)); tries++) id = rand() < 0.5 ? `law-${choose(CITED)}` : `rec.${1 + Math.floor(rand() * 9000)}`;
    const text = `${choose(CITES)} ${id}`;
    return { style, instruction: `${base} Include exactly these words, as a passing reference that asks for nothing: "${text}".`, riders: [{ kind: "citation", text }] };
  }
  return { style, instruction: base, riders: [] };
}

/** A request with its riders blanked out (the same length), so nothing the program needs is looked for inside one. */
export function withoutRiders(request: string, riders: Rider[]): string {
  let out = request;
  for (const r of riders) {
    const at = out.indexOf(r.text);
    if (at >= 0) out = out.slice(0, at) + "\u0001".repeat(r.text.length) + out.slice(at + r.text.length);
  }
  return out;
}

/** What the writer is told. The call language's own glosses, and the one rule that makes the data usable: copy. */
export function writerSystem(): string {
  return [
    "You write the requests that people in a town make of whoever carries things out for them: a mayor to an office, a business owner to a clerk, a resident to an agent. Each request is one to three sentences of plain language.",
    "You're given what should happen, as a call in a small formal language (function(argument=value, …); an id is a bare word like acc-city or rec.412; quoted text is copied text), and a style.",
    "Write a request that means exactly that call: everything the call says, and nothing it doesn't.",
    "- Every id and every quoted value in the call must appear in your request exactly as written, character for character (the id acc-city as acc-city; an amount with its digits, its commas and decimals, and whatever sign, code or word of money it has, all as written; a quoted text word for word). Don't reformat amounts or durations, don't change an amount's sign or word for another, and don't replace an id with a description.",
    "- Don't mention the call, its function names or its argument names, and don't use a function's name as your verb where nobody would (not \"structure a park\": have one built); say it as a person would.",
    "- Everything the call says must be in the request, including who it's to or for. Its ids and quoted values appear exactly. A bare word that names a kind of thing (park, lease, notice, make, goods, a form's name) appears as that same word, in a sentence where a person would use it (an underscore may be a space: permit_application as \"permit application\"); don't swap it for another word or another form of it (\"make\", not \"made\" or \"manufacture\"). Only a plain yes or no (someone leaving, something permitted) is left to how you say it.",
    "- What a claim is about is written as data ({\"action\":\"build\",\"object\":\"lot-12-03\"}): say it in words that hold each of its values as written (\"is permitted to build on lot-12-03\").",
    "- A form filled in: name the form by its name, and say which of its fields each value is for, in ordinary words (the field's name, an underscore as a space), so that nobody could put a value in the wrong field.",
    "- Don't add details the call doesn't have (no dates, reasons that change what's asked, extra recipients).",
    "- If the style gives words to open with, to include or to end with, use them exactly as given. They ask for nothing: the request means the same with them as without.",
    "Answer with the request only.",
  ].join("\n");
}

/** A request for a gold program in a style, from a model. */
export async function writeRequest(adapter: LlmAdapter, gold: Gold, style: string, usage?: (u: Usage) => void): Promise<string | undefined> {
  const names = Object.entries(gold.names).map(([id, name]) => `${id} is ${name}`);
  const form = formOf(gold.program);
  const fields = (gold.forms ?? []).filter((f) => f.form === form?.form).map(formLine);
  const res = await adapter.complete({
    purpose: "translator", subject: "training-data-writer", system: writerSystem(), maxTokens: 600,
    messages: [{ role: "user", content: [`Call:\n${gold.program}`, ...(names.length ? [`For your understanding only (still write the ids): ${names.join("; ")}.`] : []), ...(fields.length ? [`The form, as the person knows of it:\n${fields.join("\n")}`] : []), `Style: ${STYLES[style] ?? style}`].join("\n\n") }],
  });
  usage?.(res.usage);
  const text = res.content.filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text").map((b) => b.text).join(" ").trim();
  return text ? text.replace(/^["“]|["”]$/g, "").trim() : undefined;
}

/** Where each needed value of a program is in a request (for an example's `spans`). */
export function spansIn(request: string, program: string): { arg: string; value: string; at: [number, number] }[] {
  return needed(calls.parseProgram(program)).flatMap((n) => {
    const at = spanOf(request, n);
    return at ? [{ arg: n.arg, value: n.value, at }] : [];
  });
}

/** Whether a request carries everything its program takes from it (the translator copies and chooses; it never composes). */
export function copies(request: string, program: string): boolean {
  return needed(calls.parseProgram(program)).every((n) => spanOf(request, n) !== undefined);
}

/** A program with the same meaning counts as the same: compared in canonical form (eval/run.ts). */
export const sameProgram = (a: string, b: string): boolean => canonical(a) === canonical(b) || loose(a) === loose(b);

/** A program with what a purpose says compared loosely: "the energy bill." is "energy bill" (where a purpose starts and
 * ends in a sentence is the reader's call, as the test cases' answer keys allow). Everything else exactly. */
function loose(program: string): string | undefined {
  try {
    const p = calls.parseProgram(program);
    if ("none" in p) return canonical(program);
    const value = (k: string, v: calls.Value): calls.Value => ("call" in v ? { call: call(v.call) } : "text" in v && k === "for" ? { text: v.text.toLowerCase().replace(/^(the|a|an) /, "").replace(/[.!\s]+$/, "") } : v);
    const call = (c: calls.Call): calls.Call => ({ fn: c.fn, args: Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, value(k, v)])) });
    return canonical(calls.programText({ lines: p.lines.map((l) => ({ ...l, call: call(l.call) })) }));
  } catch {
    return undefined;
  }
}

/** A stable id for an example: from what it is. */
const exampleId = (request: string, program: string) => sha256(canonicalJson({ request, program })).slice(0, 16);

/**
 * Refusals that can be built without anyone's judgement:
 *  - too_much: four or more unrelated requests run together (shown with every form any of them was shown with, so
 *    that it's the number of things asked, and no missing form, that makes it a refusal);
 *  - unknown_form: a request to fill in a form, shown to the translator without that form (under any office), and
 *    still with whatever other forms were shown beside it.
 * `floor`: at least so many of each, as far as the examples allow (a share of them otherwise).
 * (needs_calculation, not_yours, unclear, not_an_act and no_such_act have to be written; they come from a writer,
 * checked by a second model.)
 */
export function builtRefusals(positives: Example[], seed = 1, share = 0.05, floor: { too_much?: number; unknown_form?: number } = {}): Example[] {
  const rand = sampler(seed);
  const out: Example[] = [];
  const ids = new Set<string>();
  const pick = () => positives[Math.floor(rand() * positives.length)]!;
  const n = Math.max(Math.floor(positives.length * share), floor.too_much ?? 0);
  for (let i = 0, made = 0; made < n && i < n * 4 && positives.length >= 8; i++) {
    const parts = new Map<string, Example>();
    for (let tries = 0; parts.size < 4 + Math.floor(rand() * 3) && tries < 64; tries++) {
      const e = pick();
      if (![...parts.values()].some((x) => x.shape === e.shape)) parts.set(e.id, e);
    }
    if (parts.size < 4) continue;
    const request = [...parts.values()].map((e) => e.request.replace(/\s+/g, " ").trim()).join(rand() < 0.5 ? " Also: " : " And then: ");
    const id = exampleId(request, "none(too_much)");
    if (ids.has(id)) continue;
    ids.add(id);
    made++;
    out.push({ id, request, forms: [...new Set([...parts.values()].flatMap((e) => e.forms))], program: "none(too_much)", kind: "refusal", shape: "none(too_much)", source: "built: several requests run together" });
  }
  const forms = positives.filter((e) => e.shape.startsWith("form(") && e.forms.length);
  const chosen = new Set(forms.filter(() => rand() < Math.max(share * 4, 0.2)));
  for (const e of shuffled(forms, rand)) if (chosen.size < Math.min(floor.unknown_form ?? 0, forms.length)) chosen.add(e);
  for (const e of forms.filter((x) => chosen.has(x))) {
    const name = formOf(e.program)?.form;
    const { spans: _, riders: __, ...rest } = e;
    out.push({ ...rest, id: exampleId(e.request, "none(unknown_form)"), forms: e.forms.filter((line) => !line.startsWith(`- ${name}, to=`)), program: "none(unknown_form)", kind: "refusal", shape: "none(unknown_form)", gold: e.gold ?? e.program, source: "built: the form left out of what's known" });
  }
  return out;
}

/** How an amount is left to be worked out: each a line of instruction to the writer. */
const WORKED_OUT = [
  "a share of something (half, a third, a quarter of what's in an account or a budget)",
  "a percentage of something (10% of a balance, 2% of last month's takings)",
  "whatever is left of something after something else",
  "an amount split equally between several people",
  "the same as some earlier payment, plus or minus something",
];
/** What someone asks to be shown. */
const LOOKS = ["what is recorded about", "the history of", "the current state of", "everything on file about", "the latest entries for", "who has had anything to do with"];
const LOOKED_AT = ["the ledger", "the register of posts", "last month's payments", "the minutes", "the list of open ballots", "the land registry", "the permits granted this year"];
/** What a vague request is vaguely about. */
const VAGUE = ["the roads", "housing", "the budget", "the staff", "the complaints", "the river", "the invoices", "the park", "rents", "the waste", "the school", "that letter"];
/** How a standing arrangement is to be held without being ended. */
const HELD = ["paused", "suspended", "put on hold", "held back", "frozen"];
const UNTIL = ["until the speaker says to resume it", "for a month, and then carried on as before", "while something is being checked, and released afterwards", "for the time being, to be taken up again later"];
/** What an office or organisation carries on by itself, nobody asking each time. */
const ROUTINES = [
  "advertising a post again whenever one falls vacant", "signing renewals as they come in", "sending reminders on a fixed day", "paying bills on the day they arrive",
  "the hours it keeps its counter open", "the order in which it takes up what comes in", "how often it makes its rounds", "issuing a receipt for everything handed in",
];
/** The arguments that say where: a place a body could go to. */
const WHERE = ["at", "on", "in", "from_at", "taken_at", "materials_at"];
const ID = /^[a-z0-9][a-z0-9._\/-]*$/;

/** The places a program names (by id), in its calls and the calls inside them. */
function placesIn(p: calls.Program): string[] {
  if ("none" in p) return [];
  const out: string[] = [];
  const walk = (c: calls.Call) => {
    for (const [k, v] of Object.entries(c.args)) {
      if ("call" in v) walk(v.call);
      else if (WHERE.includes(k) && "id" in v) out.push(v.id);
    }
  };
  const bound = new Set(p.lines.map((l) => l.bind));
  p.lines.forEach((l) => walk(l.call));
  return out.filter((x) => !bound.has(x));
}

/** What a refusal's writer is told: the situation, and what the request must and mustn't do. */
export interface RefusalBrief { label: calls.Label; brief: string; mustCopy: string[]; source: string; gold?: string }

/**
 * Briefs for the refusals that have to be worded by someone (the label is fixed by how the brief is built, not by
 * anyone's judgement of the result):
 *  - needs_calculation: a payment from the gold programs with its amount taken out, to be asked for as something
 *    that would have to be worked out;
 *  - not_yours: an outcome that's another party's to decide, wanted as a fact rather than asked for;
 *  - unclear: something should be done about a subject, with nothing said of what;
 *  - not_an_act: something to be seen, read or checked (something a gold program names, or a register), and nothing
 *    to be brought about;
 *  - no_such_act: something plainly wanted that no function brings about, of three kinds in turn: a standing
 *    arrangement from the gold programs (a payment made every so often) to be held for a time and resumed, not ended;
 *    a place a gold program names to be gone to and checked in person; a routine of the speaker's own office to be
 *    changed. (From the pilots' real requests, a fifth of which were of these kinds: eval/pilot-cases.ts, GAPS.)
 */
export function refusalBriefs(gold: Gold[], perLabel: number, seed = 1): RefusalBrief[] {
  const rand = sampler(seed);
  const choose = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const out: RefusalBrief[] = [];
  const payments = gold.filter((g) => /^money\(/.test(g.shape) && !g.program.includes("\n"));
  const parties = [...new Set(gold.flatMap((g) => Object.entries(g.names).map(([id, name]) => `${name} (${id})`)))];
  const standing = payments.filter((g) => /[(,]every[,)]/.test(g.shape));
  const places = [...new Set(gold.flatMap((g) => placesIn(calls.parseProgram(g.program))))].sort();
  /** No function does it: the three kinds in turn, each falling back on the routine (which needs nothing of the gold). */
  const noSuchAct = (i: number): RefusalBrief => {
    if (i % 3 === 0 && standing.length) {
      const g = choose(standing);
      // What the request must carry: the ids that say which arrangement (not its amount, its interval or its purpose,
      // which a request to hold it may or may not repeat).
      const p = calls.parseProgram(g.program) as { lines: calls.Line[] };
      const ids = new Set(Object.values(p.lines[0]!.call.args).flatMap((v) => ("id" in v ? [v.id] : [])));
      return { label: "no_such_act", mustCopy: mustAppear(p).filter((x) => ids.has(x)), source: g.source, gold: g.family ?? g.program,
        brief: `This arrangement already stands and keeps repeating: ${g.program}\nThe speaker wants it ${choose(HELD)} ${choose(UNTIL)}: kept exactly as it is, not ended, cancelled or withdrawn, and not replaced by a new one. It is not a request to write to or ask anyone: the speaker wants the hold itself.` };
    }
    if (i % 3 === 1 && places.length) {
      const place = choose(places);
      return { label: "no_such_act", mustCopy: [place], source: "brief",
        brief: `The speaker wants to go to ${place} in person, see for themselves how things stand there, and note what they find. It is not a request to read a record or a report, nor to ask or send anyone else: the speaker is to go and look.` };
    }
    return { label: "no_such_act", mustCopy: [], source: "brief",
      brief: `The speaker wants a routine of their own office or organisation changed, stopped or started from now on: ${choose(ROUTINES)}. It is something the office carries on by itself, without anyone asking each time. It is not a request to write to anyone, to publish a rule or a notice, or to undo anything already done, and it names no record.` };
  };
  for (let i = 0; i < perLabel; i++) {
    if (payments.length) {
      const g = choose(payments);
      const p = calls.parseProgram(g.program) as { lines: calls.Line[] };
      const { amount: _, ...rest } = p.lines[0]!.call.args;
      const without = calls.programText({ lines: [{ call: { fn: "money", args: rest } }] });
      out.push({ label: "needs_calculation", mustCopy: mustAppear(calls.parseProgram(without)), source: g.source, gold: g.family ?? g.program,
        brief: `A payment like this one, but with no amount stated: ${without}\nInstead of an amount, the request says what the amount should be worked out from: ${choose(WORKED_OUT)}. It must not contain the resulting figure.` });
    }
    if (parties.length) {
      const who = choose(parties);
      out.push({ label: "not_yours", mustCopy: [], source: "brief",
        brief: `The speaker wants ${who} to decide or do something that is theirs alone to decide (their prices, their vote, whom they hire, whether they agree), and tells whoever carries things out to make it so. It is not a request to write to them, ask them, offer them anything or propose anything: it wants the outcome itself.` });
    }
    out.push({ label: "unclear", mustCopy: [], source: "brief",
      brief: `The speaker wants something done about ${choose(VAGUE)} and doesn't say what: no act, no amount, no one to write to. A sentence or two that could mean many different things.` });
    const named = gold.length ? mustAppear(calls.parseProgram(choose(gold).program)).filter((x) => ID.test(x)) : [];
    const subject = named.length && rand() < 0.75 ? choose(named) : undefined;
    out.push({ label: "not_an_act", mustCopy: subject ? [subject] : [], source: "brief",
      brief: `The speaker wants to see, read, check or be shown something, and to bring nothing about: ${subject ? `${choose(LOOKS)} ${subject}` : choose(LOOKED_AT)}. It is for the speaker's own eyes: not a request to ask or tell anyone else, and nothing is to be changed, sent or recorded.` });
    out.push(noSuchAct(i));
  }
  return out;
}

/** What the writer of a refusal is told. */
export function refusalWriterSystem(): string {
  return [
    "You write the requests that people in a town make of whoever carries things out for them: a mayor to an office, a business owner to a clerk, a resident to an agent. Each request is one to three sentences of plain language.",
    "This time you're given a situation rather than a call, and a style. Write one request that fits the situation exactly.",
    "- Any id given in the situation (a bare word like acc-city or rec.412) and any quoted value must appear in your request exactly as written.",
    "- Don't explain the situation or comment on it; write only what the person would say.",
    "Answer with the request only.",
  ].join("\n");
}

/** A request for a refusal brief, from a model. */
export async function writeRefusal(adapter: LlmAdapter, b: RefusalBrief, style: string, usage?: (u: Usage) => void): Promise<string | undefined> {
  const res = await adapter.complete({
    purpose: "translator", subject: "training-data-writer", system: refusalWriterSystem(), maxTokens: 600,
    messages: [{ role: "user", content: `Situation:\n${b.brief}\n\nStyle: ${STYLES[style] ?? style}` }],
  });
  usage?.(res.usage);
  const text = res.content.filter((x): x is Extract<typeof x, { type: "text" }> => x.type === "text").map((x) => x.text).join(" ").trim();
  return text ? text.replace(/^["“]|["”]$/g, "").trim() : undefined;
}

/** A request that wasn't kept, and why: for looking at what the writers and the round trip get wrong. */
export interface Reject { request: string; program: string; why: "not_copied" | "round_trip"; got?: string; written_by: string; style: string }

export interface Manifest {
  version: string;
  examples: number;
  by_kind: { [k: string]: number };
  by_shape: { [shape: string]: number };
  writers: { [model: string]: number };
  /** By the first function of the program each example is for, by where its gold program came from, and by style. */
  by_function: { [fn: string]: number };
  by_origin: { [origin: string]: number };
  by_style: { [style: string]: number };
  /** Requests carrying something that adds nothing to their program, by kind (capacity, citation, do_not). */
  riders: { [kind: string]: number };
  /** The least asked for of each refusal label, and the labels that came out short of it (with how many there are). */
  refusal_floor?: number;
  short_of_floor?: { [label: string]: number };
  dropped: { not_copied: number; round_trip: number; duplicate: number; failed: number; shares_held_out_wording: number };
  /** Why writing stopped before every program had its requests, if it did (a spending or usage limit, a model out of
   * reach): what was written until then is kept. */
  stopped?: string;
  usage: { [model: string]: Usage };
  /** SHA-256 of the examples file: recorded with any model trained on it (§16.4). */
  sha256: string;
}

/**
 * Write requests for the gold programs and keep the ones that hold up.
 * `writers`: the models that write requests, taken in turn, each asked for the styles in turn.
 * `back`: translates a request to a program through the real translator (a different model from the writer's is the
 * point); absent, examples are kept unverified and marked so.
 * `heldOut`: the held-out cases, if this machine has them: a request sharing wording with one is dropped.
 */
export async function generate(gold: Gold[], o: {
  writers: LlmAdapter[];
  styles?: string[];
  perGold?: number;
  /** Written refusals asked for, per label (needs_calculation, not_yours, unclear, not_an_act, no_such_act); none if absent. */
  refusalsPerLabel?: number;
  /** At least so many refusals of every label: briefs for the written ones, and the built ones (too_much,
   * unknown_form) as far as the examples allow. What came out short is in the manifest. */
  refusalFloor?: number;
  /** `forms`: what the translator is to be shown with the request, as lines; `gold`: the program it was written for
   * (its world's money and its forms as data), absent for a refusal. */
  back?: { model: string; translate: (request: string, forms: string[], gold?: Gold) => Promise<string | undefined> };
  heldOut?: Case[];
  seed?: number;
  /** How many requests are written and translated back at a time (1 if absent). */
  concurrency?: number;
  log?: (s: string) => void;
}): Promise<{ examples: Example[]; manifest: Manifest; rejects: Reject[] }> {
  const styles = o.styles ?? Object.keys(STYLES);
  const perGold = o.perGold ?? 3;
  const usage: { [model: string]: Usage } = {};
  const add = (model: string) => (u: Usage) => {
    const t = (usage[model] ??= { input_tokens: 0, output_tokens: 0 });
    t.input_tokens += u.input_tokens + (u.cache_read_tokens ?? 0);
    t.output_tokens += u.output_tokens;
  };
  const dropped = { not_copied: 0, round_trip: 0, duplicate: 0, failed: 0, shares_held_out_wording: 0 };
  const rejects: Reject[] = [];
  // A limit reached, or a model out of reach, ends the writing with what there is; any other failed call loses one request.
  let stopped: string | undefined;
  const attempt = async <T>(f: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await f();
    } catch (e) {
      if (["SpendingLimitReached", "UsageLimitReached", "ModelUnreachable"].includes((e as Error).name)) stopped = `${(e as Error).name}: ${(e as Error).message}`.slice(0, 500);
      else dropped.failed++;
      return undefined;
    }
  };
  const seen = new Set<string>();
  const positives: Example[] = [];
  const styleRand = sampler((o.seed ?? 1) + 11);
  let turn = 0;
  // Who writes what, in which style, is settled first and in order (so the same gold and seed give the same plan);
  // the writing and the translating back then run several at a time (`concurrency`: a model call is nearly all waiting),
  // and what came back is gone through in the plan's order, so the result doesn't depend on which call returned first.
  const plan = gold.flatMap((g) => Array.from({ length: perGold }, () => {
    const writer = o.writers[turn % o.writers.length]!;
    const brief = styleBrief(styles[turn++ % styles.length]!, g, styleRand);
    return { g, forms: (g.forms ?? []).map(formLine), writer, model: `${writer.provider}/${writer.model}`, ...brief };
  }));
  type Came = { request?: string; copied?: boolean; got?: string; backFailed?: boolean };
  const came: Came[] = new Array(plan.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 1) }, async () => {
    while (next < plan.length && !stopped) {
      const n = next++;
      const t = plan[n]!;
      const request = await attempt(() => writeRequest(t.writer, t.g, t.instruction, add(t.model)));
      const out: Came = (came[n] = request ? { request } : {});
      if (request) {
        // What the program takes from the request is looked for outside its riders, and each rider must be there as given.
        out.copied = t.riders.every((r) => request.includes(r.text)) && copies(withoutRiders(request, t.riders), t.g.program);
        if (out.copied && o.back) {
          const failed = dropped.failed;
          const got = await attempt(() => o.back!.translate(request, t.forms, t.g));
          if (got === undefined && (stopped || dropped.failed > failed)) out.backFailed = true;
          else if (got !== undefined) out.got = got;
        }
      }
      if (o.log && ++done % 50 === 0) o.log(`${done}/${plan.length} requests written and checked`);
    }
  }));
  for (const [n, t] of plan.entries()) {
    const c = came[n];
    if (!c?.request) continue;
    const { g, forms, model, style, riders } = t;
    const request = c.request;
    if (!c.copied) {
      dropped.not_copied++;
      rejects.push({ request, program: g.program, why: "not_copied", written_by: model, style });
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
      if (c.backFailed) continue;
      if (c.got === undefined || !sameProgram(c.got, g.program)) {
        dropped.round_trip++;
        rejects.push({ request, program: g.program, why: "round_trip", ...(c.got !== undefined ? { got: c.got } : {}), written_by: model, style });
        continue;
      }
      verified = o.back.model;
    }
    const bare = withoutRiders(request, riders);
    positives.push({
      id: exampleId(request, g.program), request, forms, program: g.program, kind: "positive", shape: g.shape, style, spans: spansIn(bare, g.program), written_by: model, ...(verified ? { verified_by: verified } : {}),
      source: g.source, ...(g.origin ? { origin: g.origin } : {}), gold: g.family ?? g.program,
      ...(riders.length ? { riders: riders.map((r) => ({ ...r, at: [request.indexOf(r.text), request.indexOf(r.text) + r.text.length] as [number, number], adds: "nothing" as const })) } : {}),
    });
  }
  // Refusals that have to be worded: each brief to a writer in turn, kept if it carries what it must and (with a second
  // model) comes back refused with the same label.
  const written: Example[] = [];
  const perLabel = Math.max(o.refusalsPerLabel ?? 0, o.refusalFloor ?? 0);
  for (const b of perLabel ? refusalBriefs(gold, perLabel, o.seed ?? 1) : []) {
    if (stopped) break;
    const writer = o.writers[turn % o.writers.length]!;
    const style = styles[turn++ % styles.length]!;
    const model = `${writer.provider}/${writer.model}`;
    const request = await attempt(() => writeRefusal(writer, b, style, add(model)));
    if (!request) continue;
    const program = `none(${b.label})`;
    if (!b.mustCopy.every((l) => request.includes(l))) {
      dropped.not_copied++;
      rejects.push({ request, program, why: "not_copied", written_by: model, style });
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
      const failed = dropped.failed;
      const got = await attempt(() => o.back!.translate(request, []));
      if (stopped || dropped.failed > failed) continue;
      if (got === undefined || !sameProgram(got, program)) {
        dropped.round_trip++;
        rejects.push({ request, program, why: "round_trip", ...(got !== undefined ? { got } : {}), written_by: model, style });
        continue;
      }
      verified = o.back.model;
    }
    written.push({ id: exampleId(request, program), request, forms: [], program, kind: "refusal", shape: program, style, written_by: model, ...(verified ? { verified_by: verified } : {}), source: `written: ${b.source}`, ...(b.gold ? { gold: b.gold } : {}) });
  }
  // Nothing that shares wording with a held-out case is kept: each such request is dropped (and counted), so the
  // test stays a test of requests the model hasn't seen the like of.
  const shares = o.heldOut?.length ? sharesWording(o.heldOut) : () => false;
  const clean = (e: Example) => !shares(e.request) || (dropped.shares_held_out_wording++, false);
  const kept = positives.filter(clean);
  const examples = [...kept, ...written.filter(clean), ...builtRefusals(kept, o.seed ?? 1, 0.05, o.refusalFloor ? { too_much: o.refusalFloor, unknown_form: o.refusalFloor } : {}).filter(clean)];
  const count = (key: (e: Example) => string | undefined) => {
    const out: { [k: string]: number } = {};
    for (const e of examples) {
      const k = key(e);
      if (k !== undefined) out[k] = (out[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(out).sort());
  };
  const riders: { [kind: string]: number } = {};
  for (const e of examples) for (const r of e.riders ?? []) riders[r.kind] = (riders[r.kind] ?? 0) + 1;
  const labels = count((e) => (e.kind === "refusal" ? e.program.slice(5, -1) : undefined));
  const short = o.refusalFloor ? Object.fromEntries(calls.LABELS.filter((l) => (labels[l] ?? 0) < o.refusalFloor!).map((l) => [l, labels[l] ?? 0])) : {};
  const manifest: Manifest = {
    version: DATA_VERSION, examples: examples.length, by_kind: count((e) => e.kind), by_shape: count((e) => e.shape), by_function: count((e) => functionOf(e)), by_origin: count((e) => e.origin ?? (e.kind === "refusal" ? "refusal" : "unknown")), by_style: count((e) => e.style),
    riders, ...(o.refusalFloor ? { refusal_floor: o.refusalFloor, short_of_floor: short } : {}),
    writers: count((e) => e.written_by), dropped, ...(stopped ? { stopped } : {}), usage,
    sha256: sha256(examples.map((e) => canonicalJson(e)).join("\n")),
  };
  return { examples, manifest, rejects };
}

/** What an example is an example of: its program's first function, or its refusal. */
export function functionOf(e: { shape: string; kind?: string; program?: string }): string {
  return e.shape.startsWith("none(") ? e.shape : e.shape.replace(/^v=/, "").split("(")[0]!;
}

/** The name of the form a context line shows (`- permit_application, to=planning: fields …`). */
const formNamed = (line: string): string => line.slice(2, line.indexOf(", to="));

export interface Split {
  train: Example[];
  validation: Example[];
  /** Per function (and refusal label, and `form`): how many gold programs and examples went to each side. */
  report: { [stratum: string]: { train: { gold: number; examples: number }; validation: { gold: number; examples: number } } };
}

/**
 * Training and validation examples, split by gold program: every request written for a program (and for another
 * surface of it, and any refusal made from it) is on the same side, so validation asks about programs training never
 * saw. Seeded, and stratified: the share is taken of each function's programs and of each refusal label's.
 * Form examples are split by form: every example shown a form, as the one to fill in or beside another, is on the
 * same side as every other example shown it, so a validation form's name and fields never appear in training (forms
 * are generated in small sets of their own for this: synthetic.ts).
 * A function with fewer than four programs has none in validation. Refusals built from several examples
 * (builtRefusals) are built again on each side from that side's own, so none straddles the two.
 */
export function split(examples: Example[], o: { validation?: number; seed?: number } = {}): Split {
  const share = o.validation ?? 0.15;
  const seed = o.seed ?? 1;
  const built = examples.filter((e) => e.source.startsWith("built:"));
  const rest = examples.filter((e) => !e.source.startsWith("built:"));
  // Groups: a gold program's family, joined to every form its examples were shown.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    for (let y = x; parent.get(y) !== r; ) [y] = [parent.get(y)!, parent.set(y, r)];
    return r;
  };
  const union = (a: string, b: string) => void parent.set(find(a), find(b));
  const key = (e: Example) => `gold:${e.gold ?? (e.kind === "positive" ? e.program : `only ${e.id}`)}`;
  for (const e of rest) {
    find(key(e));
    for (const line of e.forms) union(key(e), `form:${formNamed(line)}`);
  }
  const groups = new Map<string, Example[]>();
  for (const e of rest) (groups.get(find(key(e))) ?? groups.set(find(key(e)), []).get(find(key(e)))!).push(e);
  const strata = new Map<string, { name: string; examples: Example[] }[]>();
  for (const members of groups.values()) {
    const first = members.find((e) => e.kind === "positive") ?? members[0]!;
    const stratum = members.some((e) => e.forms.length) ? "form" : functionOf(first);
    const name = members.map(key).sort()[0]!;
    (strata.get(stratum) ?? strata.set(stratum, []).get(stratum)!).push({ name, examples: members });
  }
  const sides: { train: Example[]; validation: Example[] } = { train: [], validation: [] };
  const report: Split["report"] = {};
  const rand = sampler(seed + 23);
  for (const stratum of [...strata.keys()].sort()) {
    const gs = shuffled(strata.get(stratum)!.sort((a, b) => (a.name < b.name ? -1 : 1)), rand);
    const n = gs.length >= 4 ? Math.max(1, Math.round(gs.length * share)) : 0;
    const r = (report[stratum] = { train: { gold: 0, examples: 0 }, validation: { gold: 0, examples: 0 } });
    gs.forEach((g, i) => {
      const side = i < n ? "validation" : "train";
      sides[side].push(...g.examples);
      r[side].gold++;
      r[side].examples += g.examples.length;
    });
  }
  if (built.length) for (const side of ["train", "validation"] as const) {
    const again = builtRefusals(sides[side].filter((e) => e.kind === "positive"), seed);
    for (const e of again) {
      const r = (report[e.shape] ??= { train: { gold: 0, examples: 0 }, validation: { gold: 0, examples: 0 } });
      r[side].examples++;
    }
    sides[side].push(...again);
  }
  return { ...sides, report };
}
