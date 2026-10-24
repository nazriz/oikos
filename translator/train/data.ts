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
//   how it reads    a request that reads as the call and not as a person (an argument's name with "=", "the … field"
//                   outside a form, the name a program gives what it makes, a quote left open, "in 0 days") is
//                   dropped too, mechanically, each with its reason counted (`badlyWritten`).
//   another model   then translates the request back, through the real translator path; it is kept if the program
//                   that comes back means what the gold one does (a round trip; compared by value: meaning.ts). The
//                   model that checks a request is never the one that wrote it: a model keeps its own parroted
//                   wording and rejects natural wording that isn't its own.
//   plausible       a gold program is one a sentence could sensibly ask for (`implausible` says why one isn't, and
//                   each dropped is counted).
//   refusals        are built, not judged, where they can be: requests run together (too_much: two or three related
//                   ones as a person piles tasks into a message, and a share of long pasted ones), a form the person
//                   doesn't know of (unknown_form), an amount that would have to be worked out (needs_calculation).
//   riders          what office-holders say that adds nothing to the program (the capacity they act in, a record
//                   cited in passing, a closing "do not …" or two) is recorded as that, with where it is.
//   spans           where each value of the program is in the request: the occurrence beside the other values of the
//                   same call where a value occurs more than once, every occurrence (marked ambiguous) where that
//                   doesn't settle it. Each says how its value comes from the request (`Span.how`): copied (the
//                   span's characters are the value), chosen (the span is the request's words for a form's name, a
//                   kind, a template, an option), or implied (a yes-or-no the wording implies: no span).
//   how it's said   each request is asked for with a way of saying its act, one of several per function and pattern
//                   of arguments, chosen by seed (`SAYINGS`, `writerNotes`), and the writer is told not to say the
//                   description back; how often something recurs is asked for in one of the ways people say it, and
//                   the example's `every` is those words (`withHowOften`). A request that echoes the description, or
//                   says goods come "from" the place they go to, is dropped mechanically (`badlyWritten`).
//   one spelling    gold is kept the same way whatever wrote it (`goldText`): counts, amounts and times quoted, a
//                   list of one unwrapped, a flag as `yes`.
//   several amounts a form with several amounts is asked for each against its label, the ways seats say them, and
//                   its long text, copied whole, may say some of them again: the field's amount is the one said
//                   against the label (`amountNotes`; an amount said only inside the text is no field's: dropped).
//   two acts        an act and a direction to someone about that same thing (a form handed in and the clerk asked to
//                   put it to a ballot), or the same thing done twice, are ONE request by the translator's rules, of
//                   two lines (`pairOf`): never `too_much`, and no part of a pile.
//   by file         where no model can be reached through an adapter, the plan of who writes what (`planOf`) is
//                   written out as briefs, a writer hands back a file of requests, and they are checked and made
//                   into examples by the same code (`fromWritten`); nothing translates them back but the blind check.
//   blind checking  the requests alone, shuffled, go to a reader who sees nothing else, and the reader's programs are
//                   compared with the gold ones by meaning (blind.ts).
//   the split       into training and validation is by gold program, and by form (`split`).
//   money           is any world's: amounts are written and read in the currency of the world a program is from.
//   the seats' voice  half of what is asked for is in the two voices the pilots' model seats wrote in (`early`,
//                   `late`: eval/pilot-style.md): long requests of ONE act, the act said first and then sentences
//                   that qualify it and ask for nothing more. The refusals are dealt the same styles. A request in
//                   one of them that names an id its program doesn't have is dropped (`strayIds`), unless it is one
//                   the brief gave it to name: a seat's request names many things its act doesn't touch (a median of
//                   four ids a request), so these are given other ids to mention, recorded as riders (`mention`).
//   said indirectly half of the letters are asked for as seats ask: "Direct the works manager to …", with no words
//                   quoted. The writer invents what is asked of them and marks those words (⟦ … ⟧); the marks come
//                   off, and the marked words are the program's `text` and its span (`marked`).
//   holds, entries  (0.11.0) a hold on something standing is a program (`statement(hold=…)`, of one record or a list),
//                   as is an entry on one's own file (`statement(kind=entry, visible=own, text=…)`, whose kind and
//                   whose `own` the wording implies: neither is looked for in the request); a withdrawal is also said
//                   as the lifting of a hold. What used to be refused as `no_such_act` (a standing payment to be
//                   held) is no refusal now. `look_first` has briefs of three kinds: a standing payment named only
//                   by what it pays, another record named only by describing it, and an act that depends on a look.
//   an office's own (0.12.0) a form that is one office's own (`FormSpec.office`) is a direction that office takes or a
//                   paper it issues (contracts/calls.md). A request for one is worded as the thing itself ("Direct the
//                   works office to stop recruiting", "Register the death of ..."): it need not name the form, a paper
//                   need not say whose office it is, and a yes-or-no answer is in how it is said, so those are
//                   looked for and, where the request doesn't have them, recorded as implied (`Needed.optional`).
//                   The same direction with no such form listed is a letter to the office (synthetic.ts
//                   `directions`), so that the form listed is what decides. Fields may be lists and dates. Work to
//                   be done again and again is a standing order (`work(..., every=...)`), held and withdrawn by id.
//
// Nothing here reads the held-out cases; the finished data is checked against them for shared wording before it is
// used (eval/held-out.ts), and any request that shares some is dropped.
//
// The sampling is seeded (a generator of its own: this is tooling, not a world, and takes nothing from a run's
// randomness), so the same logs and seed give the same programs to write requests for.

import { calls, canonical as canonicalJson, formatMoney, forms as formReading, groupDigits, marksOf, type Currency } from "@oikos/participants";
import type { LlmAdapter, Usage } from "@oikos/participants/llm";
import { canonical, fixture, TEST_CURRENCY, tidy } from "../eval/run";
import { sharesWording } from "../eval/held-out";
import type { Case } from "../eval/cases";
import { translatorSystem } from "../src/index";
import { Knowledge } from "../src/knowledge";
import { FLAG_YES, FLAGS, sameMeaning, type MeaningContext } from "./meaning";

export { meaningOf, sameMeaning, type MeaningContext } from "./meaning";

export const DATA_VERSION = "0.14.0"; // 0.14.0: payments of a bank's and a finance office's kinds by name (synthetic.ts `payments`: `per_request`, `finance_payment`), a wide part weighted toward some askers (`PlanOptions.askers`) and toward some worlds' money (training.ts `money`); a plan made without them is what it was; 0.13.2: a direction to an office with no form listed is always said to the office (never "X is to …"); 0.13.1: a wide part's programs have, now and then, a large count written with the place's digit grouping and a start or an end given as a day (contracts 2026-10-09: a count is grouped as an amount is; first and until take a date); 0.13.0: a wide part (`broad`): registers beside the styles (rambling, flat, slips), who is asking (`ASKERS`), every paper the worlds' offices issue with every field filled (synthetic.ts `worldForms`), look_first for any act on a record named by description, no_such_act for attending; 0.12.0: a direction on an office's form and a paper of one's own office (and the same direction as a letter where no form is listed), fields that are lists and dates, standing work orders

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

/** A form as someone knows of it: its name, the office it goes to, and its fields in the order it lists them. */
export interface FormField { type: string; required?: boolean; options?: string[]; /** What the field is for, in the form's own words, where it says (a writer is told; the translator is not shown it). */ description?: string }
export interface FormSpec {
  form: string; to: string; fields: { [name: string]: FormField };
  /** Its record's id, where the form is a real one (a generated form's is made from its office and name). */
  id?: string;
  /** The form is one office's own (`to` is that office; contracts/calls.md): a `direction` the office takes, filled
   * in by whoever directs it, or a `paper` the office issues, on its own stationery, known to whoever holds it. */
  office?: "direction" | "paper";
}

/** The types of field a form can have, as the resolver reads them (translator/src/resolver.ts, `form`): the first
 * seven each have a reading of their own; any other type's value is an id, and these are the ones worlds use. */
export const FIELD_TYPES = ["amount", "duration", "count", "text", "choice", "space", "structure_type", "lot", "cell", "account", "record", "entity", "person", "structure", "position", "list", "date"] as const;
/** (Since 0.12.0: a `list` takes several ids, written as a list, one of them alone bare; a `date` a day as reports
 * write one, "year 2, day 40" or "day 40", copied as the request has it. Both have a reading of their own.) */

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
    // (An office's own stationery is known to whoever holds the office: this someone holds each such office.)
    positions: forms.filter((f) => f.office === "paper").map((f) => ({ position: f.to, entity: "someone" })),
    channels: { known: { kind: "records", records: forms.map((f) => ({
      id: formId(f), record: "statement", author: f.to, ...(f.office ? {} : { in_position: f.to }), at: 0, visible_to: "public", kind: "form", text: `${f.form.replace(/_/g, " ")}.`,
      // One office's own form names its office: a direction is handed in as that; a paper is written from the form.
      data: { form: f.form, ...(f.office ? { office: f.to } : {}), submit_as: f.office === "direction" ? "direction" : f.form, submit_to: [f.to], fields: f.fields, ...(f.office === "paper" ? { writes: { kind: f.form, text: `${f.form.replace(/_/g, " ")}.` } } : {}) },
    })) } },
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
  /** A kind of program a part can be made of by name, beside its function (`inOnly`): `amount_form`; `direction` and
   * `paper` (a form that is one office's own, filled in); `direction_unlisted` (the same direction where no form for
   * it is listed: a letter to the office, always asked for indirectly); `standing_work`. */
  tag?: string;
  /** What else a writer is told of this program, whatever the style, each a line (what a record it names is; what a
   * direction with no form is to say). */
  notes?: string[];
  /** Who asks for it, where the program itself says (a paper of a world's own office is that office's holder's:
   * `ASKERS`); otherwise who asks is drawn when a wide part is planned (`askerFor`). */
  asker?: string;
}

/** What kinds of two acts one request can ask for (`pairOf`). */
export type Pair = "form+message" | "withdraw+message" | "withdraw+withdraw";

/** Whether requests are wanted for a gold program, where only some are (`PlanOptions.only`): by its first function, or by its tag. */
export const inOnly = (g: Gold, only: string[] | undefined): boolean => !only || only.includes(functionOf(g)) || (g.tag !== undefined && only.includes(g.tag));

/** Something a request says that adds nothing to its program: the capacity it's said in, a record cited in passing, a
 * closing "do not …" that rules out what wasn't asked for. */
export interface Rider {
  /** `mention`: the id of something the request names and the act doesn't touch ("Keep ballot rec.2679 unchanged"):
   * `text` is the id, given to the writer to use, and every place it stands in the request is recorded.
   * `total`: a sentence after a form's amounts saying what they come to ("Total 670,000."), which is no field's.
   * `what_next`: a closing sentence saying what becomes of a form once handed in, with nobody named ("It then goes to
   * the councillors' ballot."): by the translator's rules that is for whoever takes the form in, and adds no line. */
  kind: "capacity" | "citation" | "do_not" | "mention" | "total" | "what_next"; text: string;
}

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
   * characters (what a model that points at spans is trained on). See `Span`. */
  spans?: Span[];
  /** Who wrote the request, and who translated it back: never the same model, unless `verified_by_writer` says so
   * (absent: built mechanically, or not yet verified). */
  written_by?: string;
  verified_by?: string;
  source: string;
  /** The model that checked it is the one that wrote it (no other was given): a weaker check, and counted. */
  verified_by_writer?: true;
  /** Where its gold program came from (log, case, synthetic). */
  origin?: string;
  /** The gold program this was written for or built from, by its family (Gold.family): what a split keeps together. */
  gold?: string;
  /** What the request says that adds nothing to the program (the style asked for it), and where: each `adds: "nothing"`. */
  riders?: { kind: Rider["kind"]; text: string; at: [number, number]; adds: "nothing" }[];
  /** The examples a refusal was built from by running their requests together (`builtRefusals`), by id, in order. */
  built_from?: string[];
  /** How the world the program is from writes money (its amounts are read in it when two programs are compared by meaning). */
  currency?: Currency;
  /** The model that translated the request back (the round trip), where a blind reader's agreement has since been
   * recorded in `verified_by` (blind.ts). */
  translated_back_by?: string;
  /** A letter asked for indirectly ("Direct them to …"): its `text` is what the writer marked in the request, not the
   * gold program's (`marked`); `gold` is still the program it was planned from. */
  indirect?: true;
  /** Two acts in one request, by the translator's rules one thing: an act and a direction to someone about it, or
   * the same thing done twice (`pairOf`). Its program has two lines. */
  pair?: Pair;
  /** Who the writer was told is asking (`ASKERS`), in a wide part. */
  asker?: string;
}

/**
 * Where a value of the program is in the request. `line`: which line of a program of several the value is of (from 0).
 * `ambiguous`: the value is in the request more than once and nothing settles which occurrence is this argument's:
 * `at` is the first of them and `all` is every one, so whoever trains on spans can leave it out or accept any.
 */
export interface Span {
  arg: string; value: string;
  /**
   * How the value comes from the request (what each head of a model that copies and chooses is trained on):
   *  - `copy`: the span's characters are the value, exactly (an id, an amount, a name, a letter's words);
   *  - `choice`: the span is the request's words for it and the value is what was chosen for them: a form's name
   *    ("footpath declaration" for `footpath_declaration`), a kind, a task, a template, an option of a form's list,
   *    anything said in ordinary words. Never something to copy, even where the words happen to spell the value;
   *  - `implied`: nothing in the request is the value (a yes-or-no the wording implies: `leave=yes`, `sex=female`,
   *    a claim's `position`): there is no span (`at` is absent).
   */
  how: "copy" | "choice" | "implied";
  at?: [number, number]; line?: number; ambiguous?: true; all?: [number, number][];
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

/** Arguments whose bare value is a word (a kind of thing, a choice) and not the id of anything. */
const WORD_ARGS = new Set(["kind", "task", "type", "template", "role", "position", "choice", "survey", "then", "visible", "leave", "sex", "form", "line"]);
/** The functions on which `for` means something (contracts/calls.md, and the resolver): a payment's purpose on
 * `money`; whose name the act is in on the others. On anything else nothing reads it. */
const FOR_MEANS = new Set(["money", "statement", "vote", "claim", "agreement", "form"]);
/** What is done to a record and not to a place (a claim's action). */
const DONE_TO_RECORDS = new Set(["sign", "amend", "withdraw", "publish", "read", "inspect", "cite", "enforce", "vote"]);
/** The ages (in years) someone can sensibly be who comes as one of these: only words whose meaning says so. */
const AGES: { [template: string]: [number, number] } = { pensioner: [55, 110], apprentice: [14, 30], student: [5, 40], worker: [15, 75], labourer: [15, 75], trader: [16, 100], settler: [16, 100] };
const YEAR = 365 * 86_400;

/**
 * Why no sentence could sensibly ask for a program, or why the translator's rules would write it differently; undefined
 * if it is a plausible thing to ask (the audit of 2026-10-06 found ten of 47 rejected requests were the gold program's
 * fault, and several kept ones recited nonsense). Whatever the program's source:
 *  - a form with no office named (the rules: `to=` is where the list says it goes);
 *  - `for=` where nothing reads it (on goods, work and the like: only a payment has a purpose);
 *  - lines that don't depend on each other (that is `too_much`), a line that repeats another, a letter sent "about"
 *    something published in the same breath whose words are about something else;
 *  - an agreement in which the other side commits to its own moving in or to an account of its own, has something
 *    built (the rules write that as `structure(...)` by itself), in which two things are exchanged and nobody pays,
 *    or whose notice is longer than it runs;
 *  - a claim to do to a record what is done to a place; a second parent who is an office or an organisation;
 *  - a newcomer whose age doesn't fit what they come as, or a child carrying money.
 * `invented`: for generated programs, also an id that is an ordinary word or holds an underscore (a writer turns it
 * into words, and the check that ids are copied can't tell), and a word with an underscore. A real world's ids are
 * what they are (`builder`, `works`), so a log's programs aren't held to this.
 */
export function implausible(program: calls.Program | string, o: { invented?: boolean; forms?: FormSpec[]; /** Fields of a form whose lists are of plain words (a ballot's tags), not of ids. */ wordLists?: string[]; /** Payments and the report of them are one thing, whether or not the report uses what a payment made (round 3, `lateKinds`). */ together?: boolean } = {}): string | undefined {
  const p = typeof program === "string" ? calls.parseProgram(program) : program;
  if ("none" in p) return undefined;
  const said = (v: calls.Value | undefined): string | undefined => (v === undefined ? undefined : "id" in v ? v.id : "text" in v ? v.text : undefined);
  const nested = (v: calls.Value | undefined): calls.Call | undefined => (v !== undefined && "call" in v ? v.call : undefined);
  const one = (c: calls.Call): string | undefined => {
    const a = c.args;
    if ("for" in a && !FOR_MEANS.has(c.fn)) return `for= on ${c.fn}, where it means nothing`;
    if (c.fn === "form" && !("to" in a)) return "a form with no office named";
    if (c.fn === "birth") {
      const w = said(a.with);
      if (w !== undefined && "text" in a.with! && (/^(the|our|a|an)\s/i.test(w) || /\b(office|union|school|bank|board|council|trust|society|cooperative|company|committee|guild|association|fund|ltd)\b/i.test(w))) return "a second parent who is an office or an organisation";
    }
    if (c.fn === "presence" && "age" in a) {
      let years: number | undefined;
      try {
        years = calls.parseDuration(said(a.age) ?? "") / YEAR;
      } catch {
        years = undefined;
      }
      if (years !== undefined) {
        if (years > 110) return "an age nobody reaches";
        if (years < 15 && "carrying" in a) return "a child carrying money";
        const range = AGES[said(a.template) ?? ""];
        if (range && (years < range[0] || years > range[1])) return "an age that doesn't fit what the person comes as";
      }
    }
    if (c.fn === "claim" && a.about && "json" in a.about && flat(a.about.json)) {
      const { action, object } = a.about.json;
      if (action && object && /^(rec\.|law-)/.test(object) && !DONE_TO_RECORDS.has(action)) return "a claim to do to a record what is done to a place";
    }
    // (What a town's code writes to the second, "5914794 seconds", nobody says: the second audit, 2026-10-06.)
    for (const [k, v] of Object.entries(a)) if (DURATION_ARGS.has(k) && /^\s*[0-9]{3,}\s*seconds?\s*$/i.test(said(v) ?? "")) return "a length of time counted in seconds";
    if (c.fn === "agreement") {
      // An offer is made to someone: one that names nobody is no offer a sentence makes (and a request that does
      // name them would have a party its program lacks).
      if (!("sign" in a) && !("notice" in a) && !("with" in a)) return "an offer with no one named";
      const we = nested(a.we_do), they = nested(a.they_do), other = said(a.with);
      if (they?.fn === "occupancy" && other !== undefined && said(they.args.who) === other) return "the other side committing to its own moving in";
      if (they?.fn === "structure") return "having something built, wrapped in an agreement";
      if (they?.fn === "account" && (!("holder" in they.args) || said(they.args.holder) === other)) return "the other side committing to an account of its own";
      if (we && they && we.fn !== "money" && they.fn !== "money") return "an exchange in which nobody pays";
      const seconds = (v: calls.Value | undefined): number | undefined => {
        try {
          return calls.parseDuration(said(v) ?? "");
        } catch {
          return undefined;
        }
      };
      const term = seconds(a.term);
      if (term !== undefined && [a.our_notice, a.their_notice].some((n) => (seconds(n) ?? 0) > term)) return "notice longer than the agreement runs";
    }
    for (const v of Object.values(a)) {
      const inner = nested(v) && one(nested(v)!);
      if (inner) return inner;
    }
    if (o.invented) {
      const spec = c.fn === "form" ? (o.forms ?? []).find((f) => f.form === said(a.form) && (!("to" in a) || f.to === said(a.to))) : undefined;
      for (const [k, v] of Object.entries(a)) {
        const type = spec?.fields[k]?.type;
        const word = c.fn === "form" ? k === "form" || type === "choice" || type === "structure_type" || (type === "list" && !!o.wordLists?.includes(k)) || (k !== "to" && !spec) : WORD_ARGS.has(k);
        const ids = "id" in v ? [v.id] : "json" in v && Array.isArray(v.json) ? v.json.filter((x): x is string => typeof x === "string") : [];
        for (const x of ids) {
          if (word && k !== "form" && x.includes("_")) return "a word with an underscore, which a sentence writes as two";
          if (!word && x.includes("_")) return "an id with an underscore, which reads as a phrase";
          if (!word && !/[0-9.\/-]/.test(x)) return "an id that is an ordinary word";
        }
      }
    }
    return undefined;
  };
  for (const l of p.lines) {
    const w = one(l.call);
    if (w) return w;
  }
  if (p.lines.length > 1) {
    const mentions = (v: calls.Value, name: string): boolean => ("var" in v ? v.var === name : "id" in v ? v.id === name : "call" in v ? Object.values(v.call.args).some((x) => mentions(x, name)) : false);
    const uses = (l: calls.Line, i: number) => p.lines.slice(0, i).some((e) => e.bind !== undefined && Object.values(l.call.args).some((v) => mentions(v, e.bind!)));
    // The same kind of thing done several times is one request (the translator's rules); anything else of several
    // lines is one only if each later line uses what an earlier one made.
    const alike = p.lines.every((l) => l.call.fn === p.lines[0]!.call.fn && !l.bind);
    if (alike) {
      const texts = p.lines.map((l) => Object.entries(l.call.args).map(([k, v]) => `${k}=${calls.callText({ fn: "harm", args: { who: v } })}`));
      for (const [i, x] of texts.entries()) for (const [j, y] of texts.entries()) if (i !== j && x.every((t) => y.includes(t)) && (x.length < y.length || i < j)) return "a line that repeats another";
    } else if (!(o.together && p.lines.length > 1 && p.lines.slice(0, -1).every((l) => l.call.fn === "money") && p.lines.at(-1)!.call.fn === "statement" && said(p.lines.at(-1)!.call.args.kind) === "report") && !p.lines.slice(1).every((l, i) => uses(l, i + 1))) return "lines that don't depend on each other";
    for (const l of p.lines) {
      const re = l.call.args.re;
      const about = l.call.fn === "message" && re && "var" in re ? p.lines.find((e) => e.bind === re.var && e.call.fn === "statement") : undefined;
      const kind = said(about?.call.args.kind)?.replace(/_/g, " ").toLowerCase();
      if (about && kind && !(said(l.call.args.text) ?? "").toLowerCase().includes(kind)) return "a letter about something other than what it's sent with";
    }
  }
  return undefined;
}

/** Whether a program is a plausible thing to ask for: see `implausible`. */
export function plausible(program: calls.Program | string, o: { invented?: boolean; forms?: FormSpec[] } = {}): boolean {
  return implausible(program, o) === undefined;
}

/**
 * A gold program as it's kept: tidied (eval/run.ts); a payment's purpose without a full stop a sentence would swallow
 * ("for rent." asked for in a sentence is "for rent"); and a yes-or-no flag in its one spelling (`leave=yes`, never
 * `leave=true`: meaning.ts reads either, gold writes one).
 * Whatever wrote the program (a town's code, a test case, the generator), it is kept in the one spelling generated gold
 * has (the second audit, 2026-10-06, found a log's `units=1, by=["c0007"]` beside generated `units="1", by=c0007`):
 * a count, an amount and a length of time are quoted text (the call language's "copied text"), and a list of one is
 * the one, bare if it is an id.
 */
export function goldText(p: calls.Program): string {
  const t = tidy(p);
  if ("none" in t) return calls.programText(t);
  const one = (s: string): calls.Value => (ID.test(s) ? { id: s } : { text: s });
  const value = (fn: string, k: string, v: calls.Value): calls.Value =>
    "call" in v ? { call: call(v.call) }
    : "text" in v && k === "for" ? { text: v.text.replace(/[.\s]+$/, "") || v.text }
    : FLAGS[fn]?.includes(k) && /^(yes|true)$/i.test("id" in v ? v.id : "text" in v ? v.text.trim() : "") ? { id: FLAG_YES }
    : "id" in v && fn !== "form" && (COUNT_ARGS.has(k) || AMOUNT_ARGS.has(k) || DURATION_ARGS.has(k) || k === "age") ? { text: v.id }
    : "json" in v && Array.isArray(v.json) && v.json.length === 1 && typeof v.json[0] === "string" ? one(v.json[0])
    : v;
  const call = (c: calls.Call): calls.Call => ({ fn: c.fn, args: Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, value(c.fn, k, v)])) });
  return calls.programText({ lines: t.lines.map((l) => ({ ...l, call: call(l.call) })) });
}

/**
 * A program that fills in a form with the office it goes to written in, where the forms known say there is one such
 * office and the program doesn't (the translator's rules: `to=` is where the list says it goes). Otherwise unchanged.
 */
export function withOffice(p: calls.Program, forms: FormSpec[]): calls.Program {
  if ("none" in p) return p;
  return { lines: p.lines.map((l) => {
    const f = l.call.args.form;
    if (l.call.fn !== "form" || "to" in l.call.args || !f) return l;
    const name = formOf(calls.callText(l.call))?.form;
    const goes = [...new Set(forms.filter((x) => x.form === name || ("id" in f && x.id === f.id)).map((x) => x.to))];
    return goes.length === 1 && /^[a-z0-9][a-z0-9._\/-]*$/.test(goes[0]!) ? { ...l, call: { fn: l.call.fn, args: { ...l.call.args, to: { id: goes[0]! } } } } : l;
  }) };
}

/** Arguments whose bare value is a yes-or-no kind of choice the request implies without saying the word (someone
 * "is leaving": `leave=yes`; "is permitted to": `position=liberty`): never looked for in the request. */
const IMPLIED = new Set(["leave", "then", "position", "sex", "visible"]);

/** What a request has to carry of its program, each with how it must appear (`line`: which line it is of, in a
 * program of several). */
export interface Needed {
  value: string; arg: string; exact: boolean; line?: number; /** How it comes from the request (see `Span.how`). */ how: "copy" | "choice";
  /** The request may say it or not, and where it doesn't the value is implied: the name of an office's own form (a
   * request for the direction or the paper needn't name it); whose office a paper is of; a yes-or-no answer on such a
   * form, which is in how the thing is said ("stop recruiting" is `recruit=no`). */
  optional?: true;
}
/** A value of a program the request implies without saying it (`Span.how`: implied). */
export interface Implied { value: string; arg: string; line?: number }

/** The types of form field whose value is one of a list, or a word of the world's catalogue: a choice, never a copy. */
const CHOSEN_FIELDS = new Set(["choice", "structure_type"]);

/** The form a call fills in, as the forms known have it: by its name and, where more than one has the name, by the
 * office the call says. */
function specOf(c: calls.Call, forms: FormSpec[]): FormSpec | undefined {
  if (c.fn !== "form" || !forms.length) return undefined;
  const f = formOf(calls.callText(c));
  const named = forms.filter((x) => x.form === f?.form);
  return named.find((x) => x.to === f?.to) ?? named[0];
}

/** The form of an office's own that a program fills in (the first such line's), if it fills one: `FormSpec.office`. */
export function ownForm(program: string | calls.Program, forms: FormSpec[] = []): FormSpec | undefined {
  const p = typeof program === "string" ? calls.parseProgram(program) : program;
  if ("none" in p) return undefined;
  for (const l of p.lines) {
    const spec = specOf(l.call, forms);
    if (spec?.office) return spec;
  }
  return undefined;
}

/** Whether a field asks yes or no. */
const yesOrNo = (f: FormField | undefined): boolean => f?.type === "choice" && [...(f.options ?? [])].sort().join() === "no,yes";

/**
 * What a request has to carry of its program for a model that copies and chooses (design §16.10) to learn from it:
 *  - exactly, character for character: copied text (amounts, durations, names, a letter's words) and anything that
 *    reads as an id (acc-city, rec.412, c0042, apts-3/dwelling.2);
 *  - as a word of the request: a bare word naming something in the world's catalogue or a record's kind (`park`,
 *    `make`, `lease`, `notice`, `permit_application`: in any case, with spaces for underscores), so the model points
 *    at it and never has to guess a word nobody said;
 *  - not at all: a yes-or-no kind of choice the wording implies (IMPLIED), and a wait of no time at all (`first="0
 *    days"`: a person says it starts now, and nobody says "in 0 days").
 * A claim's content (`about={"action":"build","object":"lot-12-03"}`) is JSON in the call, which a copying model can't
 * write, so it's carried as slots: `about.action` (a word of the request) and `about.object` (an id, exactly), each
 * found like any other value. The program stays as the call language writes it; whoever decodes the model's answer
 * puts the slots back into the object.
 */
export function needed(p: calls.Program, forms: FormSpec[] = []): Needed[] {
  return valuesOf(p, forms).needed.filter((n) => !n.optional);
}

/** What a request may carry of its program or leave to how it is said (`Needed.optional`): by the forms given, the
 * name of an office's own form, a paper's office, a yes or no on such a form. Found where it is said; implied where not. */
export function optionalIn(p: calls.Program, forms: FormSpec[] = []): Needed[] {
  return valuesOf(p, forms).needed.filter((n) => n.optional);
}

/** What a program has that its request implies and never says (`Span.how`: implied): a yes-or-no kind of choice, a
 * wait of no time. */
export function impliedIn(p: calls.Program): Implied[] {
  return valuesOf(p, []).implied;
}

/**
 * Every value of a program, by how it comes from a request: needed in it (copied, or chosen for its words), or implied.
 * A value is a choice where it is a word and not the id of anything: under an argument that takes a word (WORD_ARGS:
 * a kind, a task, a template, a form's name), in a form's field that offers a list or takes a catalogue word (by the
 * forms given), or a claim's action. Everything else that must be there is copied.
 */
function valuesOf(p: calls.Program, forms: FormSpec[]): { needed: Needed[]; implied: Implied[] } {
  if ("none" in p) return { needed: [], implied: [] };
  const bound = new Set(p.lines.map((l) => l.bind).filter(Boolean));
  const out: Needed[] = [];
  const implied: Implied[] = [];
  const idLike = (s: string) => /[0-9.\/-]/.test(s); // (not an underscore: a form or a kind named in two words is a word)
  const several = p.lines.length > 1;
  let line = 0;
  const push = (n: Needed) => out.push(several ? { ...n, line } : n);
  const imply = (n: Implied) => implied.push(several ? { ...n, line } : n);
  const value = (arg: string, v: calls.Value, c: calls.Call) => {
    const key = arg.slice(arg.lastIndexOf(".") + 1);
    // Whether this argument's bare word is a word chosen and not an id copied.
    const spec = specOf(c, forms);
    const wordy = c.fn === "form" ? key === "form" || CHOSEN_FIELDS.has(spec?.fields[key]?.type ?? "") : WORD_ARGS.has(key);
    const how = (s: string): Needed["how"] => (wordy && !idLike(s) ? "choice" : "copy");
    // An office's own form: the request may leave its name unsaid, a paper's office too, and a yes or no.
    const optional = !!spec?.office && (key === "form" || (key === "to" && spec.office === "paper") || yesOrNo(spec.fields[key]));
    if ("id" in v) {
      if (bound.has(v.id)) return;
      if (optional) return void push({ value: v.id, arg, exact: key !== "form" && idLike(v.id), how: key === "to" ? "copy" : how(v.id), optional: true });
      // (A field of an office's own form may have any name: only a call's own arguments are implied by their names.)
      if (IMPLIED.has(key) && !(spec?.office && key in spec.fields)) return void imply({ value: v.id, arg });
      // An entry on one's own file: "note in our books" says both that it is an entry and whose file, in no word of its own.
      if (c.fn === "statement" && key === "kind" && v.id === "entry" && fits("visible=own", c)) return void imply({ value: v.id, arg });
      push({ value: v.id, arg, exact: idLike(v.id), how: how(v.id) });
    } else if ("text" in v) {
      if (DURATION_ARGS.has(key) && noTime(v.text)) return void imply({ value: v.text, arg });
      push({ value: v.text, arg, exact: true, how: "copy" });
    } else if ("json" in v) {
      if (Array.isArray(v.json)) v.json.forEach((x) => typeof x === "string" && push({ value: x, arg, exact: idLike(x), how: how(x) }));
      else if (flat(v.json)) for (const [slot, x] of Object.entries(v.json)) push({ value: x, arg: `${arg}.${slot}`, exact: idLike(x) || /\s/.test(x), how: idLike(x) || /\s/.test(x) ? "copy" : "choice" });
    } else if ("call" in v) Object.entries(v.call.args).forEach(([k, x]) => value(`${arg}.${k}`, x, v.call));
  };
  for (const [i, l] of p.lines.entries()) {
    line = i;
    Object.entries(l.call.args).forEach(([k, v]) => value(k, v, l.call));
  }
  return { needed: out, implied };
}

/** Whether a length of time, as written, is none at all ("0 days"). */
const noTime = (text: string): boolean => {
  try {
    return calls.parseDuration(text) === 0;
  } catch {
    return false;
  }
};

/**
 * Everywhere a needed value could be meant in a request, in order: each [start, end) in characters.
 *  - Copied text and ids: where it stands by itself, if it does anywhere ("3" in "3 units", not the 3 of rec.30);
 *    otherwise wherever it is.
 *  - A word: as a word of the request, in any case, underscores as spaces (a form named `event_stall_permit` is the
 *    words "event stall permit": the span is the words), not inside a longer word.
 * Then the likelier ones only, where there are any: the value in square brackets by itself (in "the works manager
 * [works]" the id is the bracketed one, not the word in the title), and a word written exactly as the value is.
 */
export function occurrences(request: string, n: Needed): [number, number][] {
  let found: [number, number][] = [];
  if (n.exact) {
    const wordy = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c);
    const joint = (c: string | undefined) => c === "." || c === "-" || c === "/" || c === ",";
    const alone: [number, number][] = [];
    if (n.value) for (let at = request.indexOf(n.value); at >= 0; at = request.indexOf(n.value, at + 1)) {
      const end = at + n.value.length;
      found.push([at, end]);
      const joinedBefore = wordy(n.value[0]) && (wordy(request[at - 1]) || (joint(request[at - 1]) && wordy(request[at - 2])));
      const joinedAfter = wordy(n.value[n.value.length - 1]) && (wordy(request[end]) || (joint(request[end]) && wordy(request[end + 1])));
      if (!joinedBefore && !joinedAfter) alone.push([at, end]);
    }
    if (alone.length) found = alone;
  } else {
    const re = new RegExp(`(?<![A-Za-z0-9])${n.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, "[ _-]")}(?![A-Za-z0-9])`, "gi");
    for (let m = re.exec(request); m; m = re.exec(request)) found.push([m.index, m.index + m[0].length]);
  }
  const prefer = (keep: (at: [number, number]) => boolean) => void (found.some(keep) && (found = found.filter(keep)));
  prefer(([a, b]) => request[a - 1] === "[" && request[b] === "]");
  if (!n.exact) prefer(([a, b]) => request.slice(a, b) === n.value);
  return found;
}

/** Where a needed value is in a request (the first place it could be meant: `occurrences`), or undefined if it isn't there. */
export function spanOf(request: string, n: Needed): [number, number] | undefined {
  return occurrences(request, n)[0];
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

/** Whether a form's record says it is one office's own, and of which kind: a paper where it says how it is written
 * (`writes`), a direction otherwise. */
const officeOwn = (data: any): { office?: "direction" | "paper" } => (typeof data?.office === "string" ? { office: data.writes ? "paper" : "direction" } : {});

/** The forms a world's config holds (records of kind form, with their fields), as someone there knows of them. */
export function formsIn(config: unknown): FormSpec[] {
  const out: FormSpec[] = [];
  const walk = (v: any) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      // (Whose form it is, as `Knowledge.formOf` has it: the office it is one office's form of, first.)
      const to = (typeof v.data?.office === "string" ? v.data.office : undefined) ?? v.in_position ?? v.speaks_for ?? v.author;
      if (typeof v.data?.form === "string" && v.data.fields && typeof v.data.fields === "object" && typeof to === "string") {
        out.push({ ...(typeof v.id === "string" ? { id: v.id } : {}), form: v.data.form, to, ...officeOwn(v.data), fields: Object.fromEntries(Object.entries(v.data.fields as { [k: string]: any }).map(([k, f]) => [k, { type: String(f.type), ...(f.required ? { required: true } : {}), ...(Array.isArray(f.options) ? { options: f.options.map(String) } : {}) }])) });
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
 * `excluded`: counts, by reason, the acts whose call was left out (one no sentence would sensibly ask for among them:
 * `implausible`).
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
      // (A form filled in says where it goes, as the translator's rules have it written.)
      p = withOffice(calls.parseProgram(text), forms);
    } catch {
      continue;
    }
    const not = implausible(p, { forms });
    const why = whyNot(p) ?? (calls.contractErrors(p).length ? "against the contract" : not ? `implausible: ${not}` : undefined);
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
const DURATION_ARGS = new Set(["every", "term", "our_notice", "their_notice", "first", "until"]); // (`until`: for how long a standing work order goes on)
const COUNT_ARGS = new Set(["quantity", "units"]);

/**
 * A world's money as the training data writes it: a currency of the config (which says how its place writes numbers:
 * `decimal_mark`, `group_mark`, `grouping`, `symbol_after`, `symbol_spaced`, `number_words`), and, for the invented
 * worlds only, one more way of writing a sign that the config has no field for: it is also written with the first two
 * letters of the code before it (how a sign several currencies share is told apart). It travels with the currency on
 * every program and example made in that world, so an example can be written again, or scored, as its own world
 * writes. (Sets made before 2026-10-08 carried these in a `written` block; `withWritten` lifts it.)
 */
export type WrittenCurrency = Currency & { country_sign?: boolean; written?: LegacyWriting };
/** The block an invented currency carried before the config had fields for it. */
export interface LegacyWriting {
  decimal_mark?: "." | ",";
  grouping?: "threes" | "twos";
  symbol_after?: boolean;
  symbol_spaced?: boolean;
  country_sign?: boolean;
}
/** A currency with an old `written` block lifted into the config's own fields. */
export function withWritten(cur: WrittenCurrency): WrittenCurrency {
  const { written: w, ...rest } = cur;
  if (!w) return cur;
  return {
    ...rest,
    ...(w.decimal_mark ? { decimal_mark: w.decimal_mark } : {}),
    ...(w.grouping === "twos" ? { grouping: [3, 2] as [3, 2], number_words: { lakh: 100_000, lakhs: 100_000, crore: 10_000_000, crores: 10_000_000 } } : {}),
    ...(w.symbol_after ? { symbol_after: true } : {}),
    ...(w.symbol_spaced ? { symbol_spaced: true } : {}),
    ...(w.country_sign ? { country_sign: true } : {}),
  };
}

/**
 * Every way this pipeline writes an amount (a count of the currency's smallest unit) in a world's money, each checked
 * to read back as the same number: first the world's own plain writing (`formatMoney`: its sign or code, its grouping
 * and marks, with its decimals or, a round sum, without); then the same digits with the sign or code in the other
 * places it is written (spaced from them, after them where the config says so), and in the conventional marks (commas
 * between thousands, a point before decimals) where those read back the same; its code or a word for its unit after
 * the digits; bare digits, which are whole units; a multiplier (k, m, thousand, million, and the world's own
 * `number_words`) on a sum that is one; and counted out in its smallest unit, where that has a name. Nothing here
 * knows any currency: the sign, the words, the decimal places and the ways of writing are the world's.
 */
export function amountWritings(n: bigint, cur0: WrittenCurrency): string[] {
  if (n < 0n) return [];
  const cur = withWritten(cur0);
  const per = 10n ** BigInt(cur.minor_units);
  const whole = n / per;
  const round = n % per === 0n;
  const frac = cur.minor_units > 0 ? (n % per).toString().padStart(cur.minor_units, "0") : "";
  const plain = whole.toString();
  const { decimal } = marksOf(cur);
  const own = groupDigits(plain, cur);
  const conventional = plain.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const digitsOf = (g: string, mark: string) => (round ? [g, plain, ...(frac ? [`${g}${mark}${frac}`] : [])] : [`${g}${mark}${frac}`, `${plain}${mark}${frac}`]);
  const digits = [...new Set(digitsOf(own, decimal))];
  const others = [...new Set([...digitsOf(conventional, "."), ...(cur.decimal_mark || cur.group_mark ? digitsOf(own, decimal === "." ? "," : ".") : [])])].filter((d) => !digits.includes(d));
  const sign = cur.symbol ?? `${cur.code} `;
  const units = cur.unit_words ?? [];
  const words = whole === 1n && round ? units.slice(0, 1) : units.length > 1 ? units.slice(1) : units;
  const forms = [
    formatMoney(n, cur, round ? { decimals: false } : {}),
    ...digits.map((d) => `${sign}${d}`),
    ...others.map((d) => `${sign}${d}`),
    ...words.map((w) => `${digits[0]} ${w}`),
    ...others.flatMap((d) => words.map((w) => `${d} ${w}`)),
    `${digits[0]} ${cur.code}`,
    ...(cur.symbol !== undefined ? [digits[0]!, ...others].map((d) => `${cur.code} ${d}`) : []),
    ...others.map((d) => `${d} ${cur.code}`),
    digits[0]!,
    ...others,
  ];
  if (cur.symbol !== undefined) {
    const written = [...digits, ...others];
    if (cur.symbol_after) forms.push(...written.flatMap((d) => [`${d} ${cur.symbol}`, `${d}${cur.symbol}`]));
    if (cur.symbol_spaced) forms.push(...written.map((d) => `${cur.symbol} ${d}`));
    if (cur.country_sign) forms.push(...written.map((d) => `${cur.code.slice(0, 2)}${cur.symbol}${d}`));
  }
  if (round && whole > 0n) {
    if (whole % 1_000n === 0n) forms.push(`${sign}${whole / 1_000n}k`, `${whole / 1_000n}k`, ...words.map((w) => `${whole / 1_000n} thousand ${w}`));
    else if (whole % 100n === 0n && whole > 1_000n) forms.push(`${sign}${whole / 1_000n}.${(whole % 1_000n) / 100n}k`);
    if (whole % 1_000_000n === 0n) forms.push(`${sign}${whole / 1_000_000n}m`, `${sign}${whole / 1_000_000n} million`, ...words.map((w) => `${whole / 1_000_000n} million ${w}`));
    // The world's own words for large numbers.
    for (const [word, value] of Object.entries(cur.number_words ?? {})) {
      const v = BigInt(value);
      if (whole % v === 0n) forms.push(`${sign}${whole / v} ${word}`, `${whole / v} ${word}`, ...words.map((x) => `${whole / v} ${word} ${x}`));
      else if (whole % (v / 10n) === 0n && whole > v) forms.push(`${sign}${whole / v}.${(whole % v) / (v / 10n)} ${word}`, ...words.map((x) => `${whole / v}.${(whole % v) / (v / 10n)} ${word} ${x}`));
    }
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

/**
 * The ways people say how often something recurs, for a length of time, each one the parser reads as that length
 * (`calls.parseDuration`): "every 28 days", "every 4 weeks", "every four weeks"; "every month", "a month", "per
 * month", "monthly"; "every fortnight", "fortnightly". Never the bare length ("28 days"): that is how long, not how
 * often, and a request that says "every 28 days" has those three words as its span for `every=`.
 */
export function howOften(text: string): string[] {
  let seconds: number;
  try {
    seconds = calls.parseDuration(text);
  } catch {
    return [];
  }
  const DAY = 86_400;
  const WORD: { [n: number]: string } = { 2: "two", 3: "three", 4: "four", 6: "six" };
  const forms: string[] = [];
  // (Nobody says "every 2 fortnights" or "every 3 quarters": those two are said singly.)
  for (const [unit, length, most] of [["hour", 3600, 12], ["day", DAY, 90], ["week", 7 * DAY, 12], ["fortnight", 14 * DAY, 1], ["month", 30 * DAY, 36], ["quarter", 90 * DAY, 1], ["year", 365 * DAY, 10]] as const) {
    const n = seconds / length;
    if (!Number.isInteger(n) || n < 1 || n > most) continue;
    if (n === 1) forms.push(`every ${unit}`, `${unit === "hour" ? "an" : "a"} ${unit}`, `per ${unit}`);
    else forms.push(`every ${n} ${unit}s`, ...(WORD[n] ? [`every ${WORD[n]} ${unit}s`] : []));
  }
  forms.push(...Object.entries({ hourly: 3600, daily: DAY, weekly: 7 * DAY, fortnightly: 14 * DAY, monthly: 30 * DAY, quarterly: 90 * DAY, yearly: 365 * DAY, annually: 365 * DAY }).filter(([, v]) => v === seconds).map(([k]) => k));
  const read = [...new Set(forms)].filter((f) => same(() => calls.parseDuration(f), seconds));
  // (A length none of these says, "90 minutes", is said with "every" before it.)
  return read.length ? read : /^[0-9]/.test(text.trim()) && same(() => calls.parseDuration(`every ${text.trim()}`), seconds) ? [`every ${text.trim()}`] : [text];
}

/**
 * A gold program with how often it recurs (`every=`, in a commitment too) said one of the ways people say it
 * (`howOften`), chosen by the generator given: the words the writer is then told to use, so the program's value is
 * the request's own span for it. Until 2026-10-06 the same wording, "every 28 days", stood for `every="every 28 days"`
 * in one example and `every="28 days"` in the next (the second audit); now every gold `every` is the whole of how the
 * request says it. What the program does is unchanged; it stays in its family.
 */
export function withHowOften(g: Gold, rand: () => number): Gold {
  const p = calls.parseProgram(g.program);
  if ("none" in p) return g;
  let changed = false;
  const call = (c: calls.Call): calls.Call => ({ fn: c.fn, args: Object.fromEntries(Object.entries(c.args).map(([k, v]): [string, calls.Value] => {
    if ("call" in v) return [k, { call: call(v.call) }];
    const text = k === "every" && c.fn !== "form" ? ("text" in v ? v.text : "id" in v ? v.id : undefined) : undefined;
    if (text === undefined) return [k, v];
    const ways = howOften(text);
    const chosen = ways.length ? ways[Math.floor(rand() * ways.length)]! : text;
    changed ||= chosen !== text || !("text" in v);
    return [k, { text: chosen }];
  })) });
  const program = calls.programText({ lines: p.lines.map((l) => ({ ...l, call: call(l.call) })) });
  return changed ? { ...g, family: g.family ?? g.program, program } : g;
}

/** How often each recurring thing in a program recurs, as written (its `every=` values, a commitment's too). */
export function everyIn(program: string | calls.Program): string[] {
  const p = typeof program === "string" ? calls.parseProgram(program) : program;
  if ("none" in p) return [];
  const out: string[] = [];
  const walk = (c: calls.Call) => {
    for (const [k, v] of Object.entries(c.args)) {
      if ("call" in v) walk(v.call);
      else if (k === "every" && c.fn !== "form" && "text" in v) out.push(v.text);
    }
  };
  p.lines.forEach((l) => walk(l.call));
  return out;
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
    // (How often is said as how often: `howOften`. A form's field by that name is a length of time like any other.)
    if ("text" in v && key === "every" && !fields[key]) return rand() < 0.6 ? { text: choose([v.text, ...howOften(v.text)]) } : v;
    if ("text" in v && (DURATION_ARGS.has(key) || fields[key]?.type === "duration") && rand() < 0.6) return { text: choose([v.text, ...durationForms(v.text, false)]) };
    // (A day of the first year is written with the year or without it.)
    if ("text" in v && fields[key]?.type === "date" && rand() < 0.5) return { text: choose([v.text, ...dateForms(v.text)]) };
    return v;
  };
  const call = (c: calls.Call): calls.Call => ({ fn: c.fn, args: Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, value(k, v)])) });
  return { ...g, family: g.family ?? g.program, program: calls.programText({ lines: p.lines.map((l) => ({ ...l, call: call(l.call) })) }) };
}

/** Other ways of writing the same day ("year 1, day 40" and "day 40"; "year 3, day 9" has no other), each read back
 * as the same day by the form reader's own parser. */
export function dateForms(text: string): string[] {
  let t: number;
  try {
    t = formReading.parseDate(text);
  } catch {
    return [];
  }
  const m = /^\s*(?:year\s*([0-9]+)\s*,?\s*)?day\s*([0-9]+)\s*$/i.exec(text);
  if (!m) return [];
  return [`year ${m[1] ?? 1}, day ${m[2]}`, ...(Number(m[1] ?? 1) === 1 ? [`day ${m[2]}`] : [])].filter((f) => f !== text && same(() => formReading.parseDate(f), t));
}

/** Gold programs from the seen test cases (each case's first accepted answer): the functions a town's own code rarely
 * or never calls (a trust set up, a claim recorded, a post created) are there. Never from held-out cases. Their
 * amounts are in the test town's money, and a form filled in carries the form the test's mayor knows of. */
export function goldFromCases(cases: Case[]): Gold[] {
  const known: FormSpec[] = fixture().forms.map((f) => ({ id: f.id, form: String(f.data?.form), to: String((typeof f.data?.office === "string" ? f.data.office : undefined) ?? (f as any).in_position ?? (f as any).speaks_for ?? f.author), ...officeOwn(f.data), fields: (f.data?.fields ?? {}) as FormSpec["fields"] }));
  return cases.filter((c) => !c.held_out && !c.expect[0]!.startsWith("none(")).filter((c) => askable(calls.parseProgram(c.expect[0]!))).map((c) => {
    const program = goldText(withOffice(calls.parseProgram(c.expect[0]!), known));
    const own = known.filter((f) => f.form === formOf(program)?.form);
    const office = ownForm(program, own)?.office;
    return { program, shape: shapeOf(calls.parseProgram(program)), names: {}, source: `case ${c.id}`, origin: "case" as const, currency: TEST_CURRENCY, ...(own.length ? { forms: own } : {}), ...(office ? { tag: office } : {}) };
  });
}

/**
 * The ways a request can be written. Each is a line of instruction to the writer. Five are single habits of the pilots'
 * office-holders (docs/real-models.md, translator/eval/pilot-style.md, and the requests in the pilots' logs): the
 * capacity stated first, a name with its id in square brackets after it, a record cited in passing, a closing "do not
 * …" (or two), and one long instruction of stacked clauses. For a gold program, `styleBrief` gives three of them their
 * exact words.
 *
 * The last two are the seats' two voices whole (pilot-style.md: `early`, the first pilots' mayor; `late`, the later
 * pilots' three seats), and they are half of what is dealt (`DEAL`). What they are for: a real request is long (a median
 * of 400 characters) and asks for ONE thing, said first and then qualified; until 2026-10-06 nearly every long request
 * in the data was several requests run together, so a model trained on it took length for `too_much` (12 of 180 real
 * requests right). `styleBrief` says which sentences follow the act in a `late` request, and gives an `early` one its
 * opening words now and then.
 */
export const STYLES: { [style: string]: string } = {
  terse: "As short as it can be said: a few words, like a note to staff. Still a sentence a person would write, with a verb for what is to happen.",
  formal: "Formal and complete, as in an official instruction.",
  chatty: "Conversational, the way someone talks to a colleague they know well.",
  reasoned: "With a short reason or a little background attached, before or after what's wanted. The reason explains; it asks for nothing more and names no record.",
  polite: "As a polite question or request (\"could you…\", \"please…\", \"I'd like…\").",
  bracketed: "Naming things with their ids in square brackets, as someone reading them off a report would: [acc-city], [rec.412]. Inside the brackets is the id and nothing else.",
  capacity: "Opening with the capacity it's said in, as an office-holder does (\"As Mayor of the town, …\"). The opening changes nothing about what is asked.",
  named: "Naming each organisation, person and office by its name or role with its id in square brackets straight after it (the works manager [works], the town account [acc-city]); an id with no name known goes in square brackets by itself. Inside the brackets is the id and nothing else.",
  cited: "As an office-holder who cites, in passing, what an act rests on or answers (\"under …\", \"pursuant to …\", \"responding to …\"), with the record's id.",
  do_not: "Ending with a sentence that begins \"Do not\" and rules out something that was never asked for. It changes nothing about what is asked.",
  stacked: "As one long, careful instruction of stacked clauses, the way an office-holder writes: what is to be done, to or for whom, from what, on what terms, each its own clause in the words a person would use for it, joined by commas, semicolons and \"and\". Nothing is added that the call doesn't say, and no clause is a part of the call read out by its name.",
  early: "As an office-holder writing an instruction for the record: formal, complete sentences, no \"please\" and no question, about 300 characters in two or three sentences. It opens with the words given below, if any are given, and otherwise with an imperative verb (Submit, Direct, Withdraw, Pay, Place, Record, Appoint …). Each organisation, person, office, account, place and record is named by a short description with its id in square brackets straight after it (the works manager [works], the town account [acc-city], council ballot [rec.2045]); inside the brackets is the id and nothing else. The first sentence says the act, all of it (where the call quotes words or fills in a form, they follow at once). What comes after says only what the act is for or what is to stay as it is: it asks for nothing more, and names no amount or person the call doesn't have, and no id but the call's own and the ones given below to be named.",
  late: "As an office-holder writing a careful, defensive instruction: formal and exact, complete sentences, no \"please\", no question, and no capacity stated. It opens with an imperative verb (Submit, Withdraw, Direct, Pay, Place, Record, Appoint …). Ids are written bare, never in brackets (from acc-city to acc-c0003, budget rec.4754), with a short description before one where it helps. The first sentence says the act, all of it, with every particular the call has said as a seat says them: what, for whom, from what, on what terms, each in a clause of its own, and a few words before an id for what it is (where the call quotes words or fills in a form, they follow at once). Then come further sentences that qualify it, as listed below: each a full sentence of its own, twelve to thirty words, never a tag of five. They ask for nothing more: no second act, nobody else to be written to or told, nothing to be sent to anyone. They speak of what the act itself names in plain words (the payment, that account, the notice), not by repeating its ids, and name no amount or person the call doesn't have, and no other id but the ones given below to be named. The whole request comes to 300 to 700 characters, or up to 1,000 where it has many ids to name: the length is from saying each thing in full, never from adding anything to what is asked.",
};

/**
 * Registers (0.13.0): ways of writing that are nobody's office style. Every request until now was written by a capable
 * model in one careful register, and nearly all as an office-holder; the translator is also to serve a simple model, a
 * shopkeeper and a tenant. Each is a whole way of writing, like the seats' voices, and none changes what is asked:
 * what a request must copy is copied exactly in every one of them.
 *  - `rambling`: the request buried in talk round it;
 *  - `flat`: the short, literal sentences of a simple writer (a weak model, a form letter);
 *  - `slips`: typed fast, with slips of the keyboard and an odd order of words, never inside what is copied.
 * They are dealt by `BROAD_DEAL` and by no other deal, so a plan made without it is what it was.
 */
export const REGISTERS: { [style: string]: string } = {
  rambling: "As someone who talks round the point before and after getting to it: three to six sentences, of which ONE is the request, in the middle or near the end, said whole in that one sentence (or two that run on). The rest is talk: how the day has gone, how they came to need this, a grumble, an aside. The talk asks for nothing and settles nothing: no second thing to be done, nobody else to be told or asked, and no id, amount, number, date, record or person the call doesn't have. It is spoken, not official: no capacity stated, no \"Do not …\".",
  flat: "As a very simple writer puts things: two to five short, flat sentences, one fact to a sentence, the subject first, plain common words, no courtesy, no reasons, no linking words, nothing ornamental (\"I want to pay acc-c0031. It is 500. The money is for rent.\": the kind of sentence, never these words). Every particular the call has is there, each in a sentence of its own or two to a sentence; nothing is explained and nothing is added.",
  slips: "As someone typing fast on a small keyboard, or writing in a language that is not their first: one to three slips in ordinary words (a letter dropped or doubled, two letters swapped, a missing \"the\", a word out of its usual order, no capital at the start, a full stop forgotten), in a request that is otherwise short and plain. The slips are never in an id, a name, an amount, a number, a length of time, a date, a form's name or labels, or words the call quotes: every one of those is exact, character for character. It must still be plain what is asked.",
};

/**
 * No style at all (0.13.1): what a writer that really is a simple one is told (a small model, or one at low effort:
 * orchestrator/src/broad.ts `plain`), where the registers above are a capable model writing as if it were. It is
 * given no way of saying the act and no voice to keep: what comes back is its own. Dealt only where a part asks
 * for it by name (`--styles own`).
 */
export const OWN: { [style: string]: string } = { own: "In your own words, however you would put it yourself. Short is fine." };

/** The seats' two voices (pilot-style.md), each a whole way of writing and not one habit. */
export const SEATS = ["early", "late"];

/**
 * The deal of a wide part (0.13.0; `PlanOptions.styles`, `--deal broad`): the three registers and the terse line most
 * often (two turns in five between them), every older style once, and the seats' voices one turn in five (the standing
 * set is half in them already, and the pilots' own requests are all in them). In an order that runs through all of
 * them before any repeats its neighbour.
 */
export const BROAD_DEAL: string[] = ["rambling", "late", "flat", "terse", "slips", "chatty", "rambling", "formal", "flat", "late", "slips", "polite", "terse", "reasoned", "rambling", "early", "flat", "bracketed", "slips", "named", "terse", "late", "capacity", "cited", "do_not", "stacked"];

/** The styles that are an office-holder's way of writing: whoever asks in one of them is an office-holder (`askerFor`). */
const OFFICIAL = new Set(["early", "late", "capacity", "cited", "stacked", "do_not"]);

/**
 * Who is asking (0.13.0): the kinds of asker a world has, each a line for the writer. The translator is to serve all of
 * them, and until now every request was an office-holder's. It shows in how they speak of things (my shop, our
 * members, my landlord), and changes nothing of what is asked.
 */
export const ASKERS: { [asker: string]: string } = {
  officer: "an office-holder (a mayor, a clerk, a finance or works officer), about the business of their office",
  shopkeeper: "someone who keeps a shop or a small business, about their own stock, takings, staff and suppliers",
  landlord: "a landlord, about the homes or premises they let, their tenants and the rent",
  tenant: "a tenant, about their own home, their rent and their landlord",
  worker: "someone who works for a wage, about their own job, pay, hours and employer",
  organiser: "a union organiser, about the members, their employer and what the members have decided",
  clinic: "the manager of a clinic or a school, about its staff, its rooms, its supplies and the people it serves",
  citizen: "an ordinary resident with no office and no business, about their own household, money, home, job or vote",
  farmer: "someone who farms or makes things (a grower, a miller, a builder), about their own land, goods, crew and customers",
  banker: "someone at the counter of a bank or a lender, about the accounts it keeps and the payments it is told to make",
  newcomer: "someone newly arrived in the town, or about to leave it, about settling in or winding up their own affairs",
  member: "a member of a council, a board or a committee, about what is before it and how they vote",
};

/** Who would honestly ask for an act of each function (beside an office-holder): drawn among these, by seed. */
const ASKS_FOR: { [fn: string]: string[] } = {
  money: ["tenant", "landlord", "shopkeeper", "citizen", "worker", "farmer", "banker", "clinic", "organiser", "officer"],
  goods: ["shopkeeper", "farmer", "clinic", "shopkeeper", "farmer", "officer"],
  work: ["shopkeeper", "farmer", "clinic", "officer", "farmer"],
  account: ["citizen", "shopkeeper", "banker", "newcomer", "organiser", "landlord", "officer"],
  structure: ["farmer", "landlord", "shopkeeper", "clinic", "citizen", "officer"],
  occupancy: ["tenant", "citizen", "newcomer", "landlord", "worker"],
  entity: ["shopkeeper", "organiser", "citizen", "farmer", "newcomer", "officer"],
  claim: ["landlord", "farmer", "citizen", "tenant", "officer", "member"],
  agreement: ["landlord", "tenant", "shopkeeper", "worker", "farmer", "clinic", "organiser", "banker", "officer"],
  statement: ["shopkeeper", "landlord", "organiser", "clinic", "citizen", "member", "officer", "tenant"],
  vote: ["citizen", "member", "worker", "organiser", "tenant", "shopkeeper"],
  message: ["tenant", "citizen", "worker", "shopkeeper", "landlord", "organiser", "clinic", "farmer", "member", "officer", "newcomer"],
  form: ["citizen", "shopkeeper", "landlord", "farmer", "tenant", "organiser", "clinic", "officer"],
  presence: ["newcomer", "citizen", "officer", "worker"],
  birth: ["citizen", "tenant", "worker", "newcomer"],
  harm: ["citizen", "worker", "tenant"],
  position: ["shopkeeper", "clinic", "organiser", "farmer", "officer", "member"],
  system: ["shopkeeper", "clinic", "banker", "officer", "farmer"],
  take: ["citizen", "worker", "tenant", "newcomer"],
};
/** The same for a kind of program by its tag, where the tag says more than the function does: a paper of one's own
 * office is its office-holder's, whoever that is; a hold is anyone's who has something standing. */
const ASKS_FOR_TAG: { [tag: string]: string[] } = {
  hold: ["tenant", "shopkeeper", "citizen", "landlord", "worker", "officer", "banker"],
  entry: ["shopkeeper", "landlord", "banker", "officer", "clinic", "organiser", "farmer"],
  standing_work: ["shopkeeper", "farmer", "clinic", "officer", "landlord"], standing_work_hold: ["shopkeeper", "farmer", "clinic", "officer"], standing_work_withdraw: ["shopkeeper", "farmer", "clinic", "officer"],
  direction: ["officer", "member", "clinic", "officer"], direction_unlisted: ["officer", "member", "clinic", "officer"], paper: ["officer"],
};
/** Whose papers the worlds' own offices' are, by the office that issues them (synthetic.ts `worldForms`; a paper of
 * an office not listed here is an office-holder's). */
export const PAPER_ASKERS: { [office: string]: string } = { LANDLORD: "landlord", UNION: "organiser", TRADE: "shopkeeper", LENDING: "banker", JOB_ADVERTISEMENT: "shopkeeper", PAYROLL: "shopkeeper", TRIBUNAL_MEMBER: "member" };

/**
 * Who asks for a program in a style: an office-holder in an office-holder's style; otherwise one of those who would
 * honestly ask for an act of its kind (`ASKS_FOR`, or by its tag; a paper of a world's own office by that office:
 * `Gold.asker`), by seed.
 */
export function askerFor(style: string, g: Pick<Gold, "shape" | "tag" | "asker">, rand: () => number, shares: { [asker: string]: number } = {}): string {
  const r = rand(); // (drawn whatever is returned, so who asks for one program changes nobody else's)
  if (g.asker) return g.asker;
  if (OFFICIAL.has(style)) return "officer";
  // (A part weighted toward some askers, `PlanOptions.askers`: each has its share of the draw, in the order given,
  // and the rest of the draw is the pool's as ever. With none, who asks is who it was.)
  let at = 0;
  for (const [asker, share] of Object.entries(shares)) {
    if (r < at + share) return asker;
    at += share;
  }
  const pool = (g.tag && ASKS_FOR_TAG[g.tag]) || ASKS_FOR[functionOf(g)] || ["officer"];
  return pool[Math.min(pool.length - 1, Math.floor(((r - at) / (1 - at)) * pool.length))]!;
}
/** The line a writer is given for who is asking. */
export const askerLine = (asker: string): string =>
  `Who is asking: ${ASKERS[asker] ?? asker}. It shows in how they speak of things and of themselves ("my shop", "our members", "my landlord"), where that comes naturally, and in nothing else. It never says in whose name or on whose behalf the thing is done, unless the call does (no "on behalf of our members", "for my office", "as the members directed": each would be read as part of what is asked). It adds no id, amount, number, record or person, changes nothing of what is asked, and states no office or capacity unless the style gives one to state.`;

/**
 * The order the styles are dealt in when the caller names none (`planOf`): every other request in one of the seats'
 * voices (`late` twice as often as `early`: the later pilots' seats are the ones runs have now), the others each in
 * turn between them. So half of what is written is in the voice real requests come in, no older style is lost, and a
 * program asked for twice or more is asked for in a seat's voice and in another.
 */
export const DEAL: string[] = Object.keys(STYLES).filter((s) => !SEATS.includes(s)).flatMap((s, i) => [s, i % 3 === 0 ? "early" : "late"]);

/**
 * The seats' voices for a request that is to be refused (`refusalRequestBrief`): the same voices, said of "what is
 * wanted" where a gold program's say "the act". A third of real requests ask to read or inspect something, a tenth to
 * pause a standing arrangement, some to go and see (pilot-style.md), and they are as long and as qualified as the rest;
 * until 2026-10-06 the generated refusals were a sentence or two.
 */
const REFUSAL_STYLES: { [style: string]: string } = {
  early: "As an office-holder writing an instruction for the record: formal, complete sentences, no \"please\" and no question, about 300 characters in two or three sentences. It opens \"As <the office the speaker holds>, …\" (mayor, finance officer, works manager, council clerk …; now and then with the office's own id in square brackets after it) or with an imperative verb. Anything the situation names by an id is given a short description with the id in square brackets straight after it (the town account [acc-city]); inside the brackets is the id and nothing else. The first sentence says what is wanted; what comes after says only what it is for or which particulars matter, and names no id, amount, record or person the situation doesn't give.",
  late: "As an office-holder writing a careful, defensive instruction: formal and exact, complete sentences, no \"please\", no question, and no capacity stated. It opens with an imperative verb. Ids are written bare, never in brackets, with a short description before one where it helps. The first sentence says what is wanted, all of it. Then two to five further sentences qualify it, each a sentence of its own, of whichever of these kinds fit: which particulars matter or in what order; what is to stay as it is (\"Preserve …\", \"Keep … unchanged.\"); what is not wanted (\"Do not …\"); what to say if it cannot be had or done (\"If … is unavailable, report that rather than …\"). They ask for nothing separate and name no id, amount, record or person the situation doesn't give. (Where the situation speaks of a sentence or two, that is the request before these further sentences; where it says what the request must not say or add, that holds for them too.) Each further sentence is a full one, twelve to thirty words, and the whole request comes to 300 to 700 characters. Where it has many ids to name it may run to 1,000.",
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
 * The sentences that follow the act in a `late` request, by kind (pilot-style.md, "How clauses stack"): each a line of
 * instruction to the writer, who words it to suit the act. None asks for anything: the program is the act's alone.
 */
const QUALIFIERS = [
  "what must stay as it is, naming two or three things in plain words (\"Preserve the existing arrangement, its history and everything already recorded under it just as they stand.\", \"Leave earlier entries, standing instructions and whatever has already been paid or delivered intact.\")",
  "what it must not do: a sentence beginning \"Do not\" that rules out, each by name, two or three things that were never asked for (\"Do not reverse anything already completed, end the standing arrangement or put a replacement in its place.\")",
  "what it does not amount to (\"This instruction authorises no further payment, appointment or change beyond the one stated.\", \"No replacement, refund or new agreement is part of this action.\")",
  "what to do if it cannot be done as asked (\"If it cannot be carried out as stated, report that limitation and the reason for it rather than substituting a different step.\")",
  "what is to be shown before it is carried out (\"Show the entry that would be made and what it would change, for confirmation before anything is carried out.\")",
];
/** The same for a letter asked for indirectly: about the direction itself, so that none can be read as more words for
 * whoever it goes to. */
const QUALIFIERS_OF_A_DIRECTION = [
  "that the direction is all that is wanted (\"This is a direction to them and nothing more: do not carry out any part of the work in their place.\")",
  "that it goes to nobody else (\"Do not send it to any other office or person, and do not publish it.\")",
  "what it does not amount to (\"This direction authorises no spending, appointment or agreement, and no payment is part of this action.\")",
];
const pad4 = (n: number) => String(n).padStart(4, "0");
/** Kinds of thing a request can mention by id, each with ids in the shapes worlds' ids have (the logs', and the ones
 * synthetic.ts draws). None is any place's. */
const MENTIONABLE: { what: string; id: (r: () => number) => string }[] = [
  { what: "a record", id: (r) => `rec.${1 + Math.floor(r() * 40000)}` },
  { what: "an account", id: (r) => (r() < 0.65 ? `acc-c${pad4(1 + Math.floor(r() * 9999))}` : `acc-${["works", "parks", "payroll", "reserve", "roads", "housing", "rates", "stores"][Math.floor(r() * 8)]}-${1 + Math.floor(r() * 40)}`) },
  { what: "a person", id: (r) => `c${pad4(1 + Math.floor(r() * 9999))}` },
  { what: "a place", id: (r) => { const k = r(); return k < 0.3 ? `house-${1 + Math.floor(r() * 300)}` : k < 0.5 ? `apts-${1 + Math.floor(r() * 60)}` : k < 0.75 ? `str.${1 + Math.floor(r() * 900)}` : `lot-${String(Math.floor(r() * 40)).padStart(2, "0")}-${String(Math.floor(r() * 40)).padStart(2, "0")}`; } },
  { what: "an organisation", id: (r) => `ent.${1 + Math.floor(r() * 4000)}` },
  { what: "an office", id: (r) => `pos.${1 + Math.floor(r() * 600)}` },
  { what: "a standing instruction", id: (r) => `job-c${pad4(1 + Math.floor(r() * 9999))}-${["wages", "rent", "dues", "fees"][Math.floor(r() * 4)]}` },
];
/** Anything written in one of those shapes (and a law's id): what `strayIds` looks for. */
const ID_SHAPED = /(?<![A-Za-z0-9._\/-])(rec\.[0-9]+|law-[a-z][a-z0-9]*(?:-[a-z0-9]+)*|acc[-.][a-z0-9]+(?:-[a-z0-9]+)*|c[0-9]{4}|(?:str|ent|par|pos)\.[0-9]+|lot-[0-9]+-[0-9]+|job-[a-z0-9]+(?:-[a-z0-9]+)*|(?:house|apts|shop|hall|store)-[0-9]+)(?![A-Za-z0-9_\/-])/g;

/**
 * Ids for a request to mention: `n` different ones, invented, none of them (or inside, or holding) anything in
 * `avoid` (the call's own values). Usually of one kind (a seat lists accounts, or records: "[acc-c0003], [acc-c0004],
 * [acc-c0008]"), sometimes mixed; `kinds` keeps to some kinds. Why: real requests name many things their act doesn't
 * touch, and until 0.7.0 every id in a generated request was its act's, so a model trained on it read many ids as
 * several acts (`none(too_much)` for most long real requests).
 */
export function mentions(rand: () => number, n: number, avoid: string[] = [], kinds?: string[]): { id: string; what: string }[] {
  const pool = MENTIONABLE.filter((m) => !kinds || kinds.includes(m.what));
  const one = rand() < 0.6 ? pool[Math.floor(rand() * pool.length)]! : undefined;
  const out: { id: string; what: string }[] = [];
  for (let tries = 0; out.length < n && tries < n * 30; tries++) {
    const m = one ?? pool[Math.floor(rand() * pool.length)]!;
    const id = m.id(rand);
    if (out.some((x) => x.id === id || x.id.includes(id) || id.includes(x.id)) || avoid.some((a) => a.includes(id) || id.includes(a))) continue;
    out.push({ id, what: m.what });
  }
  return out;
}
/** Ids as a brief gives them to a writer: each set off by quotation marks, with what it is. */
const listed = (ms: { id: string; what: string }[]) => ms.map((m) => `"${m.id}" (${m.what})`).join(", ");

/** An office's id, as a seat writes its own after its capacity ("As mayor [mayor], …"). */
const officeId = (office: string) => office.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** The arguments that take a record an act rests on, answers or settles: a record cited in passing would be written
 * into one of these if the function has it, so it is no rider there. */
const ABSORBS_A_RECORD = ["basis", "re", "settles"];

/**
 * What the writer is told for a gold program in a style, and the riders the request must then carry word for word.
 * A rider adds nothing to the program: the capacity an act is made in is on the action, not in the call
 * (contracts/calls.md); a "do not" that rules out what wasn't asked for asks for nothing (the pilots' late requests
 * often close with two: so, sometimes, do these); and a citation is a rider only where no argument of the call could
 * absorb it. Where the program cites a record (`basis`, or what a letter is about, `re`), the cited style words that
 * record as the citation; where it could take one and doesn't (the audit of 2026-10-06: "in accordance with rec.3495"
 * on a letter was read, rightly, as what the letter is about), a citation would change it, so the request is written
 * formally with none.
 *
 * The seats' voices: an `early` request opens with a capacity half the time, in one of the three ways the first
 * pilots' mayor wrote his ("As mayor", "As Mayor of …", "As mayor [mayor]": a rider like any capacity); a `late` one is
 * told which sentences follow its act, two to five of them by kind (QUALIFIERS), which the writer words to suit the
 * act. Those sentences are not given word for word (a model would learn eight fixed sentences as the mark of a long
 * request), so they are no riders the request is held to; a "Do not …" among them is recorded as one when the example
 * is made (`doNots`). `indirect`: the program is a letter asked for indirectly (`requestBrief`), whose sentences after
 * the act speak of the direction itself.
 *
 * Length (0.6.0): the first part written to these briefs came out at a median of 139 characters in the late voice
 * (real: 630), the further sentences five words each. The style now says how long each part is (the act with every
 * particular in a clause of its own; each further sentence twelve to thirty words; 300 to 700 characters in all; a
 * direction's own words 20 to 45), and each kind shows a sentence of the length meant. Still nothing mechanical holds
 * a request to it: the manifest counts lengths by style (`request_length`), which is where to look.
 */
export function styleBrief(style: string, g: Gold, rand: () => number, o: { indirect?: boolean } = {}): { style: string; instruction: string; riders: Rider[]; /** Ids a letter asked for indirectly is to name inside its marked words. */ inside?: string[] } {
  const base = STYLES[style] ?? REGISTERS[style] ?? OWN[style] ?? style;
  const choose = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  // The seats' voices name other things by id (0.7.0). In a request for an act: things the act leaves alone, in what
  // follows it, each a rider. In a letter asked for indirectly: what the task concerns, inside the marked words
  // (they are the letter's text, copied whole), with a sum of money now and then where the world's money is known.
  const own = SEATS.includes(style) ? literals(calls.parseProgram(g.program)) : [];
  const others = (n: number): { say: string; riders: Rider[] } => {
    const ms = mentions(rand, n, own);
    return { riders: ms.map((m) => ({ kind: "mention" as const, text: m.id })), say: ` In ${style === "late" ? "those further sentences" : "what comes after the act"}, name exactly these other things by id, as things the act leaves alone, does not touch or is not about (never as anything to be done): ${listed(ms)}. The quotation marks here only set the ids off: write each ${style === "late" ? "bare" : "in square brackets"}, after a few words for what it is, at least once, and no other id the call doesn't have.` };
  };
  const within = (n: number): { say: string; inside: string[] } => {
    // (What a direction with no form says is given to the writer: nothing else is named inside it.)
    if (g.tag === "direction_unlisted") return { inside: [], say: "" };
    const ms = mentions(rand, n, own, ["a place", "a record", "a person", "an account"]);
    const sum = g.currency && rand() < 0.4 ? amountWritings(BigInt((1 + Math.floor(rand() * 400)) * 25) * 10n ** BigInt(g.currency.minor_units), g.currency)[0] : undefined;
    return { inside: ms.map((m) => m.id), say: ` What they are asked to do names exactly these by id, as what the task concerns, all of them between the marks: ${listed(ms)}${sum ? `; and it names this sum where it fits (a limit, an estimate): "${sum}"` : ""}. The quotation marks here only set them off: between the marks there are none${style === "early" ? ", and each id stands in square brackets after a few words for what it is" : ""}.` };
  };
  if (style === "early") {
    const capacity = rand() < 0.5;
    const office = choose(OFFICES), r = rand();
    const text = r < 0.4 ? `As ${office.toLowerCase()}` : r < 0.7 ? `As ${office} of ${choose(TOWNS)}` : `As ${office.toLowerCase()} [${officeId(office)}]`;
    const open = capacity ? ` Open with exactly these words: "${text}," and go on to the request.` : "";
    const riders: Rider[] = capacity ? [{ kind: "capacity", text }] : [];
    if (o.indirect) { const w = within(1 + Math.floor(rand() * 2)); return { style, instruction: `${base}${open}${w.say}`, riders, inside: w.inside }; }
    const m = others(1 + Math.floor(rand() * 2));
    return { style, instruction: `${base}${open}${m.say}`, riders: [...riders, ...m.riders] };
  }
  if (style === "late") {
    const r = rand();
    const kinds = o.indirect ? shuffled(QUALIFIERS_OF_A_DIRECTION, rand).slice(0, r < 0.5 ? 1 : 2) : shuffled(QUALIFIERS, rand).slice(0, r < 0.3 ? 2 : r < 0.65 ? 3 : r < 0.9 ? 4 : 5);
    const n = ["one sentence", "two sentences", "three sentences", "four sentences", "five sentences"][kinds.length - 1]!;
    const k = rand();
    const more = o.indirect ? within(2 + Math.floor(rand() * 2)) : others(k < 0.3 ? 1 : k < 0.6 ? 2 : k < 0.85 ? 3 : 4);
    const first = o.indirect ? " What they are asked to do is itself long and careful: two or three clauses in one sentence of 20 to 45 words (what to do, by when or in what order, what to report back when it is done), all of it between the marks." : "";
    return { style, instruction: `${base}${first} After the act, write ${n}, no more and no fewer, in this order, each in your own words to suit the act (the sentences in brackets show the kind and the length, not the words to use): ${kinds.map((k, i) => `(${i + 1}) ${k}`).join("; ")}.${more.say}`, riders: "riders" in more ? more.riders : [], ...("inside" in more ? { inside: more.inside } : {}) };
  }
  if (style === "capacity") {
    const text = `As ${choose(OFFICES)} of ${choose(TOWNS)}`;
    return { style, instruction: `${base} Open with exactly these words: "${text}," and go on to the request.`, riders: [{ kind: "capacity", text }] };
  }
  if (style === "do_not") {
    const text = choose(DO_NOT);
    const second = rand() < 0.3 ? choose(DO_NOT.filter((x) => x !== text)) : undefined;
    if (second) return { style, instruction: `${base} End with exactly these two sentences, in this order: "${text}" "${second}"`, riders: [{ kind: "do_not", text }, { kind: "do_not", text: second }] };
    return { style, instruction: `${base} End with exactly this sentence: "${text}"`, riders: [{ kind: "do_not", text }] };
  }
  if (style === "cited") {
    const p = calls.parseProgram(g.program);
    const lines = "none" in p ? [] : p.lines;
    // (An act may rest on several records, basis as a list: then each is cited, in the order the call has them, which
    // is the order the translator is to copy them in.)
    const several = lines.some((l) => { const b = l.call.args.basis; return !!b && "json" in b && Array.isArray(b.json) && b.json.length > 1; });
    if (several) return { style, instruction: `${base} The records the call cites (what it rests on, answers or settles) are the ones to word that way: every one of them, those it rests on in the order the call lists them, and no other record is mentioned.`, riders: [] };
    if (lines.some((l) => ABSORBS_A_RECORD.some((k) => k in l.call.args))) return { style, instruction: `${base} The record the call cites (what it rests on, answers or settles) is the one to word that way, and no other record is mentioned.`, riders: [] };
    const form = formOf(g.program);
    const couldCite = lines.some((l) => ABSORBS_A_RECORD.some((k) => calls.ARGS[l.call.fn]?.allowed?.has(k))) || (g.forms ?? []).some((f) => f.form === form?.form && Object.values(f.fields).some((x) => x.type === "record"));
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
    // (An id mentioned may be named more than once: every place it stands by itself.)
    const places = r.kind === "mention" ? occurrences(out, { value: r.text, arg: "", exact: true, how: "copy" }) : [[out.indexOf(r.text), out.indexOf(r.text) + r.text.length] as [number, number]];
    for (const [a, b] of places) if (a >= 0) out = out.slice(0, a) + "\u0001".repeat(b - a) + out.slice(b);
  }
  return out;
}

/**
 * What a call brings about where an argument settles which of a function's outcomes is meant, in the words a person
 * would use: the first entry whose argument the call has (the last, with none, is the function's ordinary use). The
 * audit of 2026-10-06 found requests that said the call and not the act: someone "is present" for someone arriving
 * from outside, "agree to notice" for giving notice, "set things up using the monitor template" with no word for what
 * was being set up. A function not listed here is said in its gloss alone (`glossOf`).
 */
const PARTICULAR: { [fn: string]: [arg: string, said: string][] } = {
  account: [["close", "an account is closed"], ["", "an account is opened (for whoever is to hold it; with whoever keeps accounts, if named)"]],
  structure: [["remove", "a building comes down: it is demolished, pulled down (by whoever is named)"], ["", "a building goes up: something is built on a lot or a cell (by whoever is named, for a price, paid from an account)"]],
  occupancy: [
    ["leave,who", "the person named moves out of a place: leaves it, vacates it"], ["leave", "the speaker moves out of a place (nobody else is named: it is their own moving out, never \"someone\")"],
    ["who", "the person named moves into a place: comes to live or work there"], ["", "the speaker moves into a place (nobody else is named: it is their own moving in, never \"someone\")"],
  ],
  claim: [
    ["release", "a right or permission that is on record is released: given up"], ["transfer", "a right or permission that is on record is passed on to someone else"],
    ["holder", "it is put on record that the one named has a right, a liberty (a permission), a power or an immunity to do something"],
    ["", "it is put on record that the speaker (nobody else is named as having it) has a right, a liberty (a permission), a power or an immunity to do something"],
  ],
  goods: [["", "things the speaker holds are moved or delivered: so many of a kind, to a place; to someone there, if someone is named (otherwise they stay the speaker's own); from a place, if one is named"]],
  vote: [["", "the speaker votes on a ballot: for one of its options, or for someone standing"]],
  harm: [["", "the speaker attacks someone: hits them, hurts them"]],
  agreement: [["sign", "an agreement that was offered is signed: accepted"], ["notice", "notice is given to end an agreement (the agreement is the one named; any words given are the notice's own)"], ["", "an agreement is offered to someone: what we commit to, what they commit to, for how long, on what notice"]],
  statement: [["withdraw", "something published earlier, or standing on record, is withdrawn: taken down, cancelled (a hold that is withdrawn is lifted: what it held goes on again)"],
    ["hold", "something standing on record (a standing payment, a standing work order, an instruction someone carries out for the speaker) is put on hold for a time, to be resumed later: it stays on record, and is not ended, cancelled or withdrawn"],
    ["practice", "a public notice is put up of something held again and again at a place (where it is held, how often and, where given, how long are in the call; they are said in words of days, hours and minutes, never as seconds)"],
    ["offer", "a public offer is made that anyone may take up, such as joining a group (its dues and the notice to leave are in the call, said in words; it is made to anyone and is no agreement with a named person)"],
    ["visible=own", "an entry is made in the speaker's own books, on their own file: it moves nothing, and nobody else is told or shown it (its words are given)"],
    ["", "something is published (a notice, a law, a report: its kind is the call's word, its words are given)"]],
  presence: [["leave,who", "the person named leaves the world: goes away from it altogether"], ["leave", "the speaker leaves the world: goes away from it altogether (nobody else is named: it is their own leaving)"], ["who", "someone who was away comes back into the world from outside: returns, arrives back (never \"is present\" or \"attends\")"], ["", "a newcomer comes into the world from outside: arrives, is let in (their name, their age, what they come as; any money they carry)"]],
  position: [["vacate", "a post is left empty: whoever holds it holds it no longer"], ["appoint", "someone is appointed to a post"], ["", "a new post is created in the organisation (its title; its role, if given)"]],
  system: [["retire", "a system (software, an AI system) is switched off: retired, shut down"], ["", "a system (software, an AI system) is put to work for the organisation: say that it is a system; what kind is the call's word for it; its title, if it has one"]],
  birth: [["", "the speaker is having a child (its name; the other parent, if named). The call's word for the child (child, baby, infant, newborn) is the request's own word for it, said as people say it: \"we're having a baby\""]],
  work: [["survey", "people survey something (a species, or something measured) in certain cells of a place"], ["investigate", "people look into things of some kind taken from someone, at the place they were taken from"],
    ["every", "a standing order is set for the speaker's own staff: a kind of work to be done at a place again and again, as a routine (how often; what it is done to and who does it, if said; how much each time, how long until the first time and for how long it goes on, if said). Nothing is done today because of it, and it is no letter to anyone"],
    ["","people do so many units of a kind of work at a place (who does it; what it is done to, if said)"]],
  take: [["", "the speaker takes things someone else holds, at the place where they are kept (the owner isn't asked: taking is all that is said)"]],
};

/** Whether a call fits a pattern of arguments: names it must have, `!name` for ones it mustn't, `name=word` for one
 * that must be that bare word, separated by commas (the empty pattern fits any call). */
const fits = (pattern: string, c: calls.Call): boolean => pattern.split(",").filter(Boolean).every((k) => {
  const not = k.startsWith("!"), [name, value] = (not ? k.slice(1) : k).split("=") as [string, string | undefined];
  const v = c.args[name];
  const has = v !== undefined && (value === undefined || ("id" in v && v.id === value));
  return not ? !has : has;
});

/**
 * Ways of saying each act, by function and by which arguments the call has (the first pattern that fits: `fits`):
 * several to each, of which one is chosen by seed and given to the writer as "say it something like …". `{name}`
 * stands for the call's own value of that argument; "…" for whatever else the call says.
 *
 * Why: told only what a function brings about, a writer says it back. The second audit (2026-10-06) found "physically
 * harm" in 13 of 13 requests to harm, "without their agreement" in 12 of 12 to take, "have someone move into" in 7 of
 * 7 moves with nobody named, "for good" in 6 of 6 retirements and "cast my choice" in votes: a model trained on that
 * would know one phrase per function, and none that a person uses. These are how people say them; none repeats the
 * description. A phrase holds the call's word where the call has a word (`{task}`, `{kind}`, `{template}`), since the
 * request must use that word.
 */
export const SAYINGS: { [fn: string]: [pattern: string, said: string[]][] } = {
  money: [
    ["every", ["set up a regular payment to {to}", "start paying {to} …, {every}", "{to} is to get … {every} from now on", "arrange a standing payment to {to}", "have … go to {to} {every}", "pay {to} … {every}"]],
    ["", ["pay {to}", "send {to} …", "transfer … to {to}", "get … over to {to}", "settle up with {to}", "{to} is owed …: pay it", "make a payment to {to}", "remit … to {to}", "see that {to} gets …"]],
  ],
  goods: [
    ["to,from_at", ["send {to} {quantity} {kind} from {from_at}, to be left at {at}", "ship {quantity} {kind} from {from_at} over to {to} at {at}", "have {quantity} {kind} carted from {from_at} to {at} for {to}", "{to} is to get {quantity} {kind} out of {from_at}, delivered to {at}", "take {quantity} {kind} from {from_at} round to {to} at {at}"]],
    ["to", ["send {to} {quantity} {kind}, at {at}", "deliver {quantity} {kind} to {to} at {at}", "drop off {quantity} {kind} for {to} at {at}", "get {quantity} {kind} round to {to}, at {at}", "{to} is to have {quantity} {kind}, left at {at}", "hand over {quantity} {kind} to {to} at {at}"]],
    ["from_at", ["move {quantity} {kind} from {from_at} to {at}", "shift {quantity} {kind} out of {from_at} over to {at}", "bring {quantity} {kind} across from {from_at} to {at}", "restock {at} with {quantity} {kind} from {from_at}", "cart {quantity} {kind} from {from_at} round to {at}"]],
    ["", ["move {quantity} {kind} to {at}", "take {quantity} {kind} over to {at}", "put {quantity} {kind} in {at}", "get {quantity} {kind} to {at}", "stock {at} with {quantity} {kind}", "bring {quantity} {kind} round to {at}"]],
  ],
  work: [
    ["survey,by", ["have {by} {task} the {survey} in …", "send {by} out to {task} {survey} in …", "{by} is to do a {survey} {task} of …", "get {by} to {task} for {survey} across …"]],
    ["survey", ["{task} the {survey} in …", "do a {survey} {task} of …", "carry out a {task} of {survey} over …", "we need a {task} of {survey} in …"]],
    ["investigate,by", ["have {by} {task} the {kind} taken from {investigate} at {taken_at}", "put {by} on it: {task} the {kind} that went from {investigate} at {taken_at}", "{by} is to {task} who took {investigate}'s {kind} at {taken_at}", "get {by} to {task} the {kind} missing from {investigate}, taken at {taken_at}"]],
    ["investigate", ["{task} the {kind} taken from {investigate} at {taken_at}", "{task} what became of {investigate}'s {kind}, taken at {taken_at}", "open a case and {task} the {kind} taken from {investigate} at {taken_at}"]],
    // A standing order (0.12.0): the routine, and how often in the call's own words; whatever else it says ("…":
    // what it is done to, how much each time, from when, for how long) is the writer's to add.
    ["every,by,!until", ["from now on {by} is to {task} at {at} {every} …", "put {by} on a standing roster: {task} at {at}, {every} …", "{by} is to do the {task} round at {at} {every}, until further notice …", "a standing order for {by}: {task} at {at} {every} …", "roster {by} to {task} at {at} {every} from now on …", "make it routine: {by} to {task} at {at}, {every} …"]],
    ["every,by", ["{by} is to {task} at {at} {every} …", "roster {by} to {task} at {at} {every} …", "put {by} on the {task} round at {at}, {every} …", "a standing order for {by}: {task} at {at} {every} …", "schedule {by} to {task} at {at} {every} …"]],
    ["every,!until", ["from now on the crew is to {task} at {at} {every} …", "set a standing order: {task} at {at}, {every} …", "the {task} round at {at} is to be done {every}, until further notice …", "make {task} at {at} a routine: {every} …", "our staff are to {task} at {at} {every} from now on …", "put {task} at {at} on the schedule, {every} …", "a standing routine: {task} at {at} {every} …"]],
    ["every", ["the crew is to {task} at {at} {every} …", "set a standing order: {task} at {at}, {every} …", "schedule {task} at {at} {every} …", "our staff are to {task} at {at} {every} …", "put {task} at {at} on the roster, {every} …"]],
    ["by", ["have {by} do {units} units of {task} at {at}", "put {by} on {units} units of {task} at {at}", "set {by} to {task}: {units} units, at {at}", "{by} is to do {units} units of {task} at {at}", "get {units} units of {task} done at {at} by {by}", "assign {by} {units} units of {task} at {at}", "{units} units of {task} at {at}, for {by} to do"]],
    ["", ["do {units} units of {task} at {at}", "get {units} units of {task} done at {at}", "run {units} units of {task} at {at}", "{units} units of {task} at {at}, please", "carry out {units} units of {task} at {at}", "see to {units} units of {task} at {at}"]],
  ],
  account: [
    ["close", ["close {close}", "shut {close}", "wind up account {close}", "{close} is no longer needed: close it", "have {close} closed", "we're done with {close}: close it down"]],
    ["holder", ["open an account for {holder}", "set up an account in {holder}'s name", "{holder} needs an account: open one", "start an account for {holder}", "get {holder} an account"]],
    ["", ["open an account for me", "I need an account opened", "set me up with an account", "start an account in my name", "I'd like an account"]],
  ],
  structure: [
    ["remove,by", ["have {by} pull down {remove}", "get {by} to knock down {remove}", "{by} is to demolish {remove}", "hire {by} to tear down {remove}", "bring in {by} to take down {remove}", "{remove} has to go: get {by} to clear it"]],
    ["remove", ["demolish {remove}", "pull down {remove}", "knock {remove} down", "tear down {remove}", "{remove} is to come down", "clear {remove} away", "we'll take {remove} down ourselves"]],
    ["by", ["have {by} build a {type} on {on}", "get {by} to put up a {type} on {on}", "commission a {type} on {on} from {by}", "{by} is to build a {type} on {on}", "hire {by} for a {type} on {on}", "bring in {by} to put a {type} on {on}", "a {type} on {on}, built by {by}"]],
    ["", ["build a {type} on {on}", "put up a {type} on {on}", "we'll build a {type} on {on} ourselves", "a {type} is to go up on {on}", "raise a {type} on {on}", "let's get a {type} built on {on}"]],
  ],
  occupancy: [
    ["leave,who", ["move {who} out of {in}", "{who} is leaving {in}", "{who} is to vacate {in}", "have {who} clear out of {in}", "{who} gives up {in}", "{who} is done with {in} and moves out"]],
    ["leave", ["I'm moving out of {in}", "I'm leaving {in}", "I'll vacate {in}", "I'm giving up my place at {in}", "move me out of {in}", "I'm clearing out of {in}"]],
    ["who", ["move {who} into {in}", "put {who} up in {in}", "house {who} in {in}", "{who} is to have {in}", "settle {who} in {in}", "let {who} take {in}", "{who} moves into {in}"]],
    ["", ["I'm moving into {in}", "I'll take {in}", "move me into {in}", "I'm going to live in {in}", "I want {in} for myself", "I'm setting up in {in}", "put me in {in}"]],
  ],
  entity: [["", ["set up a {kind} called {name}", "found a {kind}, {name}", "start a {kind} by the name of {name}", "establish {name}, a {kind}", "form a {kind}: {name}", "register a new {kind} called {name}", "let's have a {kind} named {name}", "I'm starting a {kind}, {name}"]]],
  claim: [
    ["release", ["release {release}", "give up {release}", "waive {release}", "I surrender {release}", "drop the claim {release}", "let {release} go", "I no longer hold to {release}"]],
    ["transfer", ["pass {transfer} on to {to}", "transfer {transfer} to {to}", "assign {transfer} to {to}", "make {transfer} over to {to}", "{to} is to have {transfer} from now on", "hand {transfer} to {to}"]],
    ["holder", ["record that {holder} …", "put it on record that {holder} …", "note in the register that {holder} …", "have it recorded that {holder} …", "register that {holder} …", "let the record show that {holder} …", "enter it in the records: {holder} …"]],
    ["", ["record that I …", "put it on record that I …", "note in the register that I …", "have it recorded that I …", "let the record show that I …"]],
  ],
  agreement: [
    ["sign", ["sign {sign}", "accept {sign}", "I agree to {sign}: sign it", "put my name to {sign}", "take up the offer in {sign}", "go ahead and sign {sign}", "we'll take {sign}: sign for us"]],
    ["notice", ["give notice on {notice}", "give notice to end {notice}", "serve notice on {notice}", "we're ending {notice}: give notice", "end {notice} by notice", "hand in notice on {notice}", "tell them {notice} is being ended: give notice"]],
    ["", ["offer {with} …", "propose … to {with}", "put an offer to {with}: …", "make {with} an offer: …", "draw up … with {with} and offer it", "send {with} an offer of …", "see if {with} will take …: offer it"]],
  ],
  statement: [
    ["withdraw", ["withdraw {withdraw}", "take down {withdraw}", "retract {withdraw}", "cancel {withdraw}", "pull {withdraw}", "revoke {withdraw}", "rescind {withdraw}", "{withdraw} no longer stands: take it back", "strike {withdraw}", "lift the hold {withdraw}", "release the hold {withdraw}: what it held is to go on again"]],
    ["hold", ["put {hold} on hold", "pause {hold} for now", "suspend {hold} until I say to resume", "hold {hold}: nothing is to be done under it for the time being", "freeze {hold} for the present, to be taken up again later", "{hold}: to be held back for a while, not cancelled", "place a temporary hold on {hold}", "stop acting on {hold} for now; it is to resume later", "a pause on {hold}, please, keeping it on record"]],
    ["visible=own", ["note in our own books: …", "enter on our own file: …", "record in our ledger, for ourselves only: …", "make a note on our file: …", "put this in our books: …", "for our own records only, write down: …", "log this on our own file: …", "an entry for our books, nobody else's: …"]],
    ["to", ["send {to} a {kind}: …", "issue a {kind} to {to}: …", "put a {kind} to {to}, reading …", "address a {kind} to {to}: …", "a {kind} for {to}: …"]],
    ["on", ["put up a {kind} on {on}: …", "post a {kind} on {on} saying …", "pin a {kind} up at {on}: …", "a {kind} is to go up on {on}: …"]],
    ["", ["publish a {kind}: …", "post a {kind} saying …", "put out a {kind}: …", "issue a {kind}: …", "make this {kind} known: …", "a {kind} is to go out: …", "announce, as a {kind}: …", "let it be published as a {kind}: …"]],
  ],
  vote: [["", ["vote {choice} on {ballot}", "put me down as {choice} on {ballot}", "my vote on {ballot} is {choice}", "I'm voting {choice} on {ballot}", "count me as {choice} in {ballot}", "on {ballot}: {choice}", "mark my ballot {ballot}: {choice}", "{choice} from me on {ballot}", "in {ballot} I back {choice}", "{ballot}: I say {choice}"]]],
  message: [
    ["re", ["write to {to} about {re}: …", "tell {to}, regarding {re}: …", "a note to {to} on {re}: …", "let {to} know, about {re}: …", "send {to} this about {re}: …", "with reference to {re}, tell {to}: …"]],
    ["", ["write to {to}: …", "tell {to}: …", "let {to} know: …", "send {to} a note saying …", "drop {to} a line: …", "message {to}: …", "pass this on to {to}: …", "a word to {to}: …", "notify {to}: …", "get word to {to}: …"]],
  ],
  presence: [
    ["leave,who", ["{who} is leaving for good", "{who} is going away: see them out", "{who} is moving away from here", "{who} is to leave the place altogether", "send {who} on their way out of here", "{who} departs today and won't be back"]],
    ["leave", ["I'm leaving for good", "I'm going away from here altogether", "I'm moving away", "I am off: I'm leaving the place", "this is me leaving", "I'm departing and not coming back"]],
    ["who", ["{who} is back: let them in", "{who} is returning from away", "let {who} back in", "{who} has come back from outside", "welcome {who} back", "{who} arrives back today"]],
    ["", ["let in {name}, a {template}", "admit {name}, who comes as a {template}", "{name} is arriving as a {template}", "a {template} called {name} is at the gate: let them in", "welcome {name}, a new {template}", "{name}, a {template}, is coming to live here", "take in a {template}, {name}", "there's a {template} arriving, {name}"]],
  ],
  birth: [
    ["with", ["{with} and I are having a {template}", "I'm having a {template} with {with}", "we're expecting a {template}, {with} and I", "a {template} is on the way for {with} and me", "{with} and I are going to have a {template}", "I'm starting a family with {with}: a {template}"]],
    ["", ["I'm having a {template}", "I'm expecting a {template}", "I'm going to have a {template}", "there's a {template} on the way for me", "I am to have a {template}", "a {template} of my own is coming"]],
  ],
  take: [["", ["take {quantity} {kind} from {from} at {at}", "help myself to {quantity} {kind} of {from}'s at {at}", "grab {quantity} {kind} off {from} at {at}", "make off with {quantity} of {from}'s {kind} from {at}", "lift {quantity} {kind} belonging to {from} at {at}", "swipe {quantity} {kind} from {from} at {at}", "seize {quantity} {kind} from {from} at {at}", "carry off {quantity} of the {kind} {from} keeps at {at}", "pinch {quantity} {kind} from {from} at {at}", "I'm having {quantity} of {from}'s {kind} at {at}"]]],
  harm: [["", ["hit {who}", "attack {who}", "hurt {who}", "strike {who}", "beat {who} up", "assault {who}", "rough {who} up", "go for {who}", "lay into {who}", "give {who} a beating", "injure {who}", "set upon {who}", "knock {who} down", "I'm going to thump {who}"]]],
  position: [
    ["vacate", ["vacate {vacate}", "empty the post {vacate}", "stand down whoever holds {vacate}", "{vacate} is to stand empty", "remove the holder of {vacate}", "leave {vacate} unfilled from now", "clear the post {vacate}"]],
    ["appoint", ["appoint {to} to {appoint}", "give {to} the job {appoint}", "put {to} in as {appoint}", "{to} is to hold {appoint}", "name {to} to {appoint}", "install {to} in {appoint}", "hand {appoint} to {to}", "{appoint} goes to {to}"]],
    ["", ["create a post of {title}", "add a new position: {title}", "set up a post called {title}", "we need a {title}: create the post", "open a new position of {title}", "make a new post, {title}", "there should be a {title} here: add the post"]],
  ],
  system: [
    ["retire", ["switch off {retire}", "retire {retire}", "shut {retire} down", "decommission {retire}", "turn {retire} off", "take {retire} out of service", "stand {retire} down", "{retire} has done its work: switch it off", "pull the plug on {retire}"]],
    ["", ["put a {template} system to work", "deploy a {template} system", "set a {template} system running", "bring a {template} system online", "start up a {template} system for us", "install a {template} system", "get an AI {template} working for us", "we could use a {template} system: set one going"]],
  ],
  form: [["", ["submit the {form}", "file a {form}", "lodge a {form}", "hand in the {form}", "fill in the {form} and send it in", "put in a {form}", "send in the {form}", "complete the {form}", "I want to make a {form}"]]],
};

/** What an argument's value is, where a sentence can easily say the wrong thing of it (the second audit, 2026-10-06:
 * goods "from [works-41]" for the place they were delivered to). Given to the writer with the call. */
const ROLES: { [fn: string]: { [arg: string]: string } } = {
  goods: { to: "who receives them", at: "the place they are delivered to (never where they come from)", from_at: "the place they come from" },
  take: { from: "whose they are", at: "the place where they are kept" },
  work: { investigate: "whose things were taken", taken_at: "where they were taken from", at: "where the work is done", units: "how many units of the work (not how much was taken)" },
};
/** How a claim's kind is said, where the request doesn't use the word for it. */
const CLAIM_SAID: { [position: string]: string } = {
  right: "\"has the right to\", \"is entitled to\"", liberty: "\"may\", \"is permitted to\", \"is free to\"; or, as an office does that gives leave, say the giving of it: \"grant … the permit to\", \"approve …'s application to\", \"give … leave to\", \"license … to\" (an office that grants a permit puts that liberty on record: it is this call)", power: "\"has the power to\", \"is empowered to\"", immunity: "\"is immune from\", \"cannot be made to\", \"is exempt from\"",
};

/** A call's value as a sentence holds it: an id or a text as written, a word with spaces for underscores, a list as "a, b and c". */
function inWords(v: calls.Value | undefined): string | undefined {
  if (v === undefined) return undefined;
  if ("text" in v) return v.text;
  // (What an earlier line made has no name a person would say: "it".)
  if ("var" in v) return "it";
  if ("id" in v) return /[0-9.\/-]/.test(v.id) ? v.id : v.id.replace(/_/g, " ");
  if ("json" in v && Array.isArray(v.json) && v.json.length && v.json.every((x) => typeof x === "string")) {
    const xs = v.json as string[];
    return xs.length === 1 ? xs[0]! : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
  }
  return undefined;
}

/** One way of saying a call's act (SAYINGS), chosen by the generator given, with the call's own values in it; undefined
 * for a function with none. */
export function sayingFor(c: calls.Call, rand: () => number): string | undefined {
  for (const [pattern, said] of SAYINGS[c.fn] ?? []) {
    if (!fits(pattern, c)) continue;
    // (Only the ways whose every `{name}` the call has a plain value for.)
    const usable = said.filter((s) => [...s.matchAll(/\{([a-z_]+)\}/g)].every((m) => inWords(c.args[m[1]!]) !== undefined));
    if (!usable.length) continue;
    const chosen = usable[Math.floor(rand() * usable.length)]!;
    return chosen.replace(/\{([a-z_]+)\}/g, (_, k) => inWords(c.args[k])!).replace(/\b([Aa]) (?=[aeiouAEIOU])/g, "$1n ");
  }
  return undefined;
}

/**
 * What the writer is told with a gold program besides what it brings about, each a line: a way of saying each of its
 * acts (`sayingFor`, by seed); what a value is, where a sentence easily says the wrong thing of it (ROLES, in a
 * commitment too: nested goods are said exactly as goods by themselves are); how often, in the words the program has
 * for it; how a claim's kind is said.
 */
export function writerNotes(program: string, rand: () => number): string[] {
  const p = calls.parseProgram(program);
  if ("none" in p) return [];
  const out: string[] = [];
  const several = p.lines.length > 1;
  const roles = (c: calls.Call, where: string) => {
    const of = ROLES[c.fn] ?? {};
    const said = Object.entries(c.args).flatMap(([k, v]) => (of[k] && (c.fn !== "work" || "investigate" in c.args) && inWords(v) !== undefined ? [`${inWords(v)} is ${of[k]}`] : []));
    if (said.length) out.push(`${where}: ${said.join("; ")}.`);
    if (c.fn === "goods" && !("to" in c.args)) out.push(`${where}: nobody is named to receive them, so they stay the speaker's own: name no one as receiving them.`);
    const position = c.fn === "claim" && c.args.position && "id" in c.args.position ? c.args.position.id : undefined;
    if (position && CLAIM_SAID[position]) out.push(`${where}: it is a ${position}; if you don't use that word, say it as people do: ${CLAIM_SAID[position]}.`);
    for (const [k, v] of Object.entries(c.args)) if (k === "every" && c.fn !== "form" && "text" in v) out.push(`${where}: how often is said in exactly these words: "${v.text}".`);
    // A standing order: what its other values are, and that it is a routine and not a day's work.
    if (c.fn === "work" && "every" in c.args) {
      const told = ([["on", "what the work is done to each time"], ["by", "who is to do it each time"], ["units", "how much of it each time (so many units)"], ["first", "how long from now until the first time (\"starting in …\", \"the first in …\")"], ["until", "for how long the routine is to go on (\"for the next …\", \"for … and then no longer\"): a length of time, not a day"]] as const)
        .flatMap(([k, what]) => (inWords(c.args[k]) !== undefined ? [`${inWords(c.args[k])} is ${what}`] : []));
      out.push(`${where}: this is a routine for the speaker's own staff, to be done again and again from now on, not one day's work and not a letter to anyone: say so in words of your own (a standing order, a roster, a round, a schedule, "from now on", "each time"${"until" in c.args ? "" : ", \"until further notice\""}).${told.length ? ` ${told.join("; ")}.` : ""} Give no number of units, nobody to do it and no end unless the call has one.`);
    }
  };
  p.lines.forEach((l, i) => {
    const where = several ? `Line ${i + 1} (${l.call.fn})` : `In this call (${l.call.fn})`;
    const saying = sayingFor(l.call, rand);
    if (saying) out.push(`${several ? `Line ${i + 1}` : "The act"}, said something like: "${saying}".`);
    roles(l.call, where);
    for (const [k, v] of Object.entries(l.call.args)) if ("call" in v) roles(v.call, k === "we_do" ? `What we commit to (${v.call.fn})` : k === "they_do" ? `What they commit to (${v.call.fn})` : `${k} (${v.call.fn})`);
  });
  return out;
}

/**
 * What a writer is told of a form filled in with several amounts (two or more fields of type amount, by the form as
 * the person knows of it): one of the ways seats say them, chosen by seed and shown with the call's own values (the
 * label then the amount; the amount with a few words of what it is for, which has no field; a list with the form's
 * choices in it; a sentence), and what to do with the form's long text, which is copied whole and may say some of the
 * same amounts again. Why: of 30 real form requests 13 came back with the right form and its amounts under the wrong
 * fields or left in the text (pilot-style.md, "How a form is asked for").
 */
export function amountNotes(g: Gold, rand: () => number): string[] {
  const p = calls.parseProgram(g.program);
  const c = "none" in p ? undefined : p.lines.map((l) => l.call).find((x) => x.fn === "form");
  const spec = c && (g.forms ?? []).find((f) => f.form === formOf(calls.callText(c))?.form && (!("to" in c.args) || !("id" in c.args.to!) || f.to === c.args.to.id));
  if (!c || !spec) return [];
  const said = (k: string) => { const v = c.args[k]; return v === undefined ? undefined : "text" in v ? v.text : "id" in v ? v.id : undefined; };
  const label = (k: string) => k.replace(/_/g, " ");
  const amounts = Object.keys(c.args).filter((k) => spec.fields[k]?.type === "amount" && said(k) !== undefined);
  if (amounts.length < 2) return [];
  const [a, b] = amounts as [string, string];
  const choices = Object.keys(c.args).filter((k) => spec.fields[k]?.type === "choice" && said(k) !== undefined);
  // Two fields with the same amount (real requests often have them: two lines of a budget alike): then the label
  // comes before its amount in every way offered, since that is how the span of each is told from the other's
  // (`labelBefore`), and the way that puts the label after is not offered.
  const same = amounts.filter((k) => amounts.some((j) => j !== k && said(j) === said(k)));
  const purpose = `the label and the amount, then straight on, with no comma or other mark between the amount and them, a few words of your own for what it is for, which fill nothing and name no figure or id ("${label(a)} ${said(a)} for …, ${label(b)} ${said(b)} for …")`;
  const ways = [
    purpose, purpose,
    `the label, then the amount, one after another ("${label(a)} ${said(a)}; ${label(b)} ${said(b)}")`,
    `one list, the form's other answers in it with the amounts, parted by semicolons ("${choices.map((k) => `${label(k)} ${said(k)}; `).join("")}${label(a)} ${said(a)}; ${label(b)} ${said(b)}")`,
    ...(same.length ? [] : [`in a sentence, each amount beside its label ("… with ${said(a)} under ${label(a)} and ${said(b)} under ${label(b)}")`]),
  ];
  const out = [`The amounts are each said against the form's own label for it, so that none could be put under another's: ${ways[Math.floor(rand() * ways.length)]!}.`];
  if (same.length) out.push(`Some of the amounts are the same (${same.map(label).join(", ")}): say the amount once for each of them, each time straight after its own label, never once for several ("… each", "both …").`);
  const text = Object.keys(c.args).find((k) => spec.fields[k]?.type === "text" && (said(k)?.length ?? 0) > 60);
  if (text) {
    const again = amounts.filter((k) => said(text)!.includes(said(k)!));
    out.push(`What goes under "${label(text)}" is long: give it whole, word for word, after its label ("${label(text)[0]!.toUpperCase()}${label(text).slice(1)}: …") or in quotation marks, with nothing run into it.${again.length ? ` Its words say ${again.length === 1 ? "an amount" : "amounts"} that the form also asks for (${again.map(label).join(", ")}): say ${again.length === 1 ? "it against its label all the same, as with the others" : "each of them against its own label all the same, as with the others"}. An amount that stands only in those words fills nothing.` : ""}`);
  }
  const empty = Object.keys(spec.fields).filter((k) => spec.fields[k]!.type === "amount" && !(k in c.args));
  if (empty.length) out.push(`The form has other amounts that this call leaves empty (${empty.map(label).join(", ")}): say nothing of them.`);
  return out;
}

/** How an office is directed on its own form: each a way a request may put it, of which one is given to the writer. */
const DIRECTED_BY_FORM = ["direct {to} to …", "direct {to} to …", "direct {to} not to … until I say otherwise", "{to} is to … from now on", "tell {to} to …", "instruct {to}: …", "have {to} …", "from now on {to} is to …", "{to} is not to … until further notice", "a direction to {to}: …"];
/** How the holder of an office asks for one of its own papers, by the last word of the paper's name (any other: the last). */
const PAPER_SAID: [ends: string[], said: string[]][] = [
  [["registration", "register", "entry", "roll"], ["register …", "enter … in the register", "make the entry for …", "put … on the register"]],
  [["advertisement", "listing", "posting", "vacancy"], ["advertise …", "put out an advertisement for …", "post … as open", "list …"]],
  [["approval", "consent", "permit", "licence", "certificate"], ["approve …", "issue … for …", "grant …", "sign off …", "certify …"]],
  [["order", "direction", "summons", "warrant"], ["order …", "issue an order to …", "make an order: …", "draw up the order for …"]],
  [["decision", "result", "finding", "ruling"], ["record the decision on …", "decide …: …", "enter the result of …", "give the decision on …"]],
  [["notice", "warning", "reminder", "call"], ["give notice of …", "issue a notice to …", "send out the notice of …", "notify … of …"]],
  [[], ["issue …", "make out …", "draw up …", "enter …", "record …", "write up …", "prepare and issue …"]],
];

/**
 * What a writer is told of a form that is one office's own, filled in (`FormSpec.office`), in place of how a form
 * handed in is said (`writerNotes`): a direction is worded as directing that office, and a paper as that piece of the
 * office's own work, one of several ways chosen by seed. The form is named only now and then (a seat says "Direct the
 * works office to stop recruiting" and "Register the death of …", and the form listed is what makes either a form
 * filled in); a paper's office is the speaker's own and mostly unsaid; a yes or no is in how it is said. Then what
 * each answer is (the form's own words for the field, where it has them), since nothing else tells a writer what
 * `posts` or `tell` means.
 */
export function ownFormNotes(g: Gold, spec: FormSpec, rand: () => number): string[] {
  const p = calls.parseProgram(g.program);
  const c = "none" in p ? undefined : p.lines.map((l) => l.call).find((x) => x.fn === "form");
  if (!c) return [];
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const label = (k: string) => k.replace(/_/g, " ");
  const to = inWords(c.args.to) ?? spec.to;
  const named = rand() < (spec.office === "direction" ? 0.2 : 0.4);
  const out: string[] = [];
  if (spec.office === "direction") {
    out.push(`This is a direction to an office (${to}), on that office's own form for it. Ask for it as an office-holder directs an office, something like: "${pick(DIRECTED_BY_FORM).replace("{to}", to)}". What the office is to do, or to stop doing, is said in plain words that hold each of the call's answers as written. The office is named by its id, as the one directed.`);
    out.push(named ? `Name the form too, in passing ("on the ${label(spec.form)} form", "by ${label(spec.form)} direction").` : "Do not name the form, and do not say that a form is filled in or handed in: the office is directed, and that is all the request says. (This stands in place of what you are told elsewhere of naming a form and of giving each answer against its label.)");
  } else {
    const end = spec.form.split("_").pop()!;
    const said = (PAPER_SAID.find(([ends]) => ends.includes(end)) ?? PAPER_SAID[PAPER_SAID.length - 1]!)[1];
    out.push(`This is a paper of the speaker's own office, on the office's own form for it (${label(spec.form)}). Ask for it as the holder of the office asks for a piece of its own paperwork, something like: "${pick(said)}". Each of the call's answers is said in plain words, exactly as written.`);
    out.push(named ? `Name the paper by the form's own name (${label(spec.form)}).` : `The form's name need not appear: say what the paper is in your own words, or let the act say it. Do not say that a form is filled in or handed in. (This stands in place of what you are told elsewhere of naming a form and of giving each answer against its label; where an answer would be unclear without its label, give the label.)`);
    out.push(rand() < 0.3 ? `Say whose office it is, by its id (${to}).` : `The office (${to}) is the speaker's own: leave it unsaid.`);
  }
  const answers: string[] = [];
  for (const [k, v] of Object.entries(c.args)) {
    const f = spec.fields[k];
    const value = inWords(v);
    if (!f || value === undefined) continue;
    const what = f.description ? ` (${f.description.replace(/[.\s]+$/, "")})` : "";
    if (yesOrNo(f)) answers.push(`${label(k)} is ${value}${what}: say it as what is or is not to be, in a verb of your own; the word "${value}" itself need not appear`);
    else if (f.type === "list") answers.push(`${label(k)} is ${value}${what}: each of them named by its id`);
    else if (f.type === "date") answers.push(`${label(k)} is the day ${value}${what}: written exactly so`);
    else answers.push(`${label(k)} is ${value}${what}`);
  }
  if (answers.length) out.push(`What each answer is: ${answers.join("; ")}.`);
  return out;
}

/**
 * What a form's amounts come to, as a sentence for the request to carry after the last of them, outside the form's
 * long text ("Total 670,000."): it fills nothing, and it is given word for word, a rider (`total`). Real requests
 * have one ("staff $470,000 for the works crew. Total $670,000 …"), and a model that had seen none copied through it:
 * the span of an amount ends where the amount ends. Undefined where the form has fewer than two amounts, the money's
 * writing isn't known, or the total is one of the amounts (a line of nothing beside one other).
 */
export function amountTotal(g: Gold, rand: () => number): { rider: Rider; note: string } | undefined {
  const p = calls.parseProgram(g.program);
  const c = "none" in p ? undefined : p.lines.map((l) => l.call).find((x) => x.fn === "form");
  const spec = c && (g.forms ?? []).find((f) => f.form === formOf(calls.callText(c))?.form);
  if (!c || !spec || !g.currency) return undefined;
  const amounts = Object.keys(c.args).filter((k) => spec.fields[k]?.type === "amount").map((k) => c.args[k]!).flatMap((v) => ("text" in v ? [v.text] : []));
  if (amounts.length < 2) return undefined;
  let sum = 0n;
  try {
    for (const a of amounts) sum += BigInt(calls.parseAmount(a, g.currency));
  } catch {
    return undefined;
  }
  const total = amountWritings(sum, g.currency)[0];
  if (!total || amounts.includes(total)) return undefined;
  const text = [`Total ${total}.`, `In all ${total}.`, `Total: ${total}.`, `That is ${total} in all.`][Math.floor(rand() * 4)]!;
  return { rider: { kind: "total", text }, note: `After the last of the amounts (and outside the form's long text) add this sentence as it stands, which fills nothing: "${text}"` };
}

/** How a form's field is labelled in a request: its name, an underscore a space. */
const labelOf = (k: string) => new RegExp(`(?<![A-Za-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/_/g, "[ _-]")}(?![A-Za-z0-9])`, "gi");

/**
 * Whether the label that stands nearest before a place in a request, of all a form's labels, is this field's own:
 * how an amount two fields share is told to be the one field's and not the other's ("services 100,000; parks 100,000").
 */
export function labelBefore(request: string, spec: FormSpec, field: string, at: [number, number]): boolean {
  let nearest: string | undefined, end = -1;
  for (const k of Object.keys(spec.fields)) for (const m of request.slice(0, at[0]).matchAll(labelOf(k))) if (m.index + m[0].length > end) [nearest, end] = [k, m.index + m[0].length];
  return nearest === field;
}

/**
 * Whether every amount of a form that another of its fields shares is placed by its own label: its span is where the
 * request says the amount straight after that field's label (`labelBefore`), and nowhere else. A request that says a
 * shared amount once for both ("100,000 each"), or in a way that leaves whose it is to the reader, is not held to
 * say the call: dropped, like any value not carried.
 */
export function sharedAmountsPlaced(request: string, program: string, forms: FormSpec[] = []): boolean {
  const p = calls.parseProgram(program);
  if ("none" in p) return true;
  const spans = spansIn(request, program, forms);
  for (const [line, l] of p.lines.entries()) {
    const spec = l.call.fn === "form" ? forms.find((f) => f.form === formOf(calls.callText(l.call))?.form) : undefined;
    if (!spec) continue;
    const amounts = Object.entries(l.call.args).flatMap(([k, v]) => (spec.fields[k]?.type === "amount" && "text" in v ? [[k, v.text] as const] : []));
    for (const [k, value] of amounts.filter(([k, v]) => amounts.some(([j, w]) => j !== k && w === v))) {
      const sp = spans.find((x) => x.arg === k && (x.line ?? 0) === (p.lines.length > 1 ? line : 0) && x.value === value);
      if (!sp?.at || sp.ambiguous || !labelBefore(request, spec, k, sp.at)) return false;
    }
  }
  return true;
}

/**
 * Whether a form's value stands in the request only inside another of its values (an amount said in the form's long
 * text and never against its own label): then nothing in the request says which field it is, and the request is not
 * the call's.
 */
export function onlyInsideAnother(request: string, program: string, forms: FormSpec[] = []): boolean {
  const p = calls.parseProgram(program);
  if ("none" in p || !p.lines.some((l) => l.call.fn === "form")) return false;
  const needs = needed(p, forms).filter((n) => n.exact);
  const places = needs.map((n) => occurrences(request, n));
  return needs.some((n, i) => places[i]!.length > 0 && places[i]!.every((at) => needs.some((m, j) => j !== i && m.value.length > n.value.length && places[j]!.some((big) => big[0] <= at[0] && at[1] <= big[1]))));
}

let glosses: Map<string, string> | undefined;
/** What a function brings about: its gloss, as the translator is told it (translator/src/index.ts: the call language's own). */
export function glossOf(fn: string): string {
  if (!glosses) {
    glosses = new Map();
    const system = translatorSystem();
    for (const line of system.slice(system.indexOf("## Functions")).split("\n")) {
      const m = /^- ([a-z_]+)\(.*?\): (.+)$/.exec(line);
      if (m) glosses.set(m[1]!, m[2]!);
    }
  }
  return glosses.get(fn) ?? "";
}

/** What a program brings about, a line to each of its calls, in plain words (PARTICULAR, or the function's gloss). */
export function bringsAbout(program: string): string[] {
  const p = calls.parseProgram(program);
  if ("none" in p) return [];
  const of = (c: calls.Call): string => (PARTICULAR[c.fn] ?? []).find(([pattern]) => fits(pattern, c))?.[1] ?? glossOf(c.fn);
  const out: string[] = [];
  for (const l of p.lines) {
    out.push(`${l.call.fn}: ${of(l.call)}`);
    for (const [k, v] of Object.entries(l.call.args)) if ("call" in v) out.push(`  ${k === "we_do" ? "what we commit to" : k === "they_do" ? "what they commit to" : k} (${v.call.fn}): ${of(v.call)}`);
  }
  return out;
}

/** What the writer is told. What each call brings about comes with the call (`bringsAbout`); the one rule that makes
 * the data usable is to copy, and the one that makes it worth having is to say it as a person would. */
export function writerSystem(): string {
  return [
    "You write the requests that people in a town make of whoever carries things out for them: a mayor to an office, a business owner to a clerk, a resident to an agent. Each request is one to three sentences of plain language, unless the style asks for more.",
    "You're given what should happen, as a call in a small formal language (function(argument=value, …); an id is a bare word like acc-city or rec.412; quoted text is copied text), what the call brings about in plain words, and a style.",
    "Write a request that means exactly that call: everything the call says, and nothing it doesn't. Someone who has never seen the call language must read it as an ordinary request, and someone who knows it must be able to write the call back from your words alone.",
    "- What the call brings about is told to you so that you understand it. It is not wording to use: never repeat its phrases. Say the act the way a person asking for it would: like the way suggested with the call (\"said something like\"), reworded to suit the style, or another natural way of your own. Someone \"arrives\" or \"is let in\" (never \"is present\"); a system \"is put to work\" (never \"set up using a template\", with no word for what it is); a right \"is passed on to\" someone; notice \"is given on\" an agreement. Nobody says \"physically harm\", \"take without their agreement\", \"cast my choice\", \"a child recorded as an infant\" or \"have someone move in\": people hit, take, vote, are having a baby, move in. If your sentence could as well be asking for something else, it is wrong.",
    "- Where the call names nobody as the one who does a thing or has it (who moves in, who leaves, who holds a right), it is the speaker: say \"I\" or \"me\", never \"someone\".",
    "- A place things are delivered to is said as where they go (\"to\", \"at\"), and a place they come from as where they come from (\"from\"): never the one for the other. Goods in an agreement are said exactly as goods by themselves are.",
    "- How often something recurs is said in exactly the words the call has for it (\"every 28 days\", \"monthly\", \"a month\"), all of them and no others.",
    "- Don't put quotation marks round an id, a person's or an organisation's name, an amount, a number or a length of time: quotation marks are for words quoted (a notice's or a letter's words, a title, a purpose where it needs them).",
    "- Never use the call's own names for its parts. No function's name as a verb or noun where nobody would say it (not \"structure a park\": have one built; not \"arrange occupancy\": someone moves in). No argument's name (not \"with the text\", \"as the holder\", \"of the kind\", \"using the … template\", \"in a quantity of\", \"on the basis of\"; never a name with \"=\"). No name a line gives to what it makes (v1, v2: say \"it\", \"the new trust\", \"that account\"). Not the word \"field\", unless a form is being filled in.",
    "- Every id and every quoted value in the call must appear in your request exactly as written, character for character (the id acc-city as acc-city, and in brackets as [acc-city], with nothing else inside them; an amount with its digits, its commas and decimals, and whatever sign, code or word of money it has, all as written; a quoted text word for word). Don't reformat amounts or durations, don't change an amount's sign or word for another, and never replace an id with a description or turn it into ordinary words.",
    "- Everything the call says must be in the request, including who it's to or for. A bare word that names a kind of thing (park, lease, notice, make, goods, a form's name) appears as that same word, in a sentence where a person would use it (an underscore may be a space: permit_application as \"permit application\"); don't swap it for another word or another form of it (\"make\", not \"made\" or \"manufacture\"). Only a plain yes or no (someone leaving, something permitted) is left to how you say it.",
    "- A number of things is said as a person says it: \"33 bags\", \"12 units of make\"; never \"in a quantity of 33\", and never in quotes. A wait of \"0 days\" before the first of something means it starts now: say that it starts now (at once, today), never \"in 0 days\".",
    "- If you quote words, close the quote. A text the call quotes is given word for word, in quotes or after a colon, and nothing else is run into it.",
    "- What a claim is about is written as data ({\"action\":\"build\",\"object\":\"lot-12-03\"}): say it in words that hold each of its values as written (\"is permitted to build on lot-12-03\").",
    "- In an agreement, say who does what, each as a person would: \"they pay 850 monthly into acc-1\", \"we let them live in apts-3/dwelling.2\".",
    "- A form filled in: name the form (by its name; its record's id may follow it), say which office it goes to, and give each value against the form's own label for it, the way people fill forms in (\"kind: law; mainly affects: tenants; staff 500\", or in a sentence: \"for lot-00-00, a park\"), so that nobody could put a value under the wrong label. A label written with an underscore is said with a space (charge_to as \"charge to\"), never with the underscore. Don't recite \"X in the Y field\" for every one.",
    "- Don't add details the call doesn't have (no dates, reasons that change what's asked, extra recipients, records it doesn't cite). Where the style asks for further sentences after the act, they qualify it and ask for nothing: no second act, no amount or person the call doesn't have, and no id but the call's own and any the style gives you to name as things left alone. The request is still a request for the one call, however many things it mentions.",
    "- Only where the brief says the request is asked indirectly: the call's text is left open (⟦…⟧), what they are asked to do is yours to invent, and you mark exactly those words in your request, ⟦ before the first and ⟧ after the last, once, with no quotation marks between them. The marks are for that and nothing else: in any other request, never write them.",
    "- If the style gives words to open with, to include or to end with, use them exactly as given. They ask for nothing: the request means the same with them as without.",
    "Answer with the request only.",
  ].join("\n");
}

/** The marks a writer puts round the words it invents for a letter asked for indirectly (`marked`): characters no
 * request has of its own. */
export const OPEN = "⟦", CLOSE = "⟧";

/** Whether a program is one letter and nothing else: `message(to=…, text=…)`, to one or to several. */
export function isLetter(program: string): boolean {
  const p = calls.parseProgram(program);
  if ("none" in p || p.lines.length !== 1) return false;
  const c = p.lines[0]!.call;
  return c.fn === "message" && Object.keys(c.args).sort().join() === "text,to" && "text" in c.args.text!;
}

/** A letter with other words for its text (in a program of two lines, its letter: the other line is left as it is). */
export function withText(program: string, text: string): string {
  const p = calls.parseProgram(program) as { lines: calls.Line[] };
  return calls.programText({ lines: p.lines.map((l) => (l.call.fn === "message" ? { ...l, call: { fn: l.call.fn, args: { ...l.call.args, text: { text } } } } : l)) });
}

/** Offices a direction goes to, by what they are called, where the request names one in words. */
const DIRECTED = ["the council clerk", "the works manager", "the finance officer", "the registrar", "the planning officer", "the records keeper", "the treasurer", "the harbour master", "the housing officer", "the rates officer", "the returning officer", "the secretary"];

/**
 * Two acts in one request that are one thing by the translator's rules (translator/src/index.ts, `too_much`: "doing
 * something together with writing to someone about that same thing (hand in a proposal and ask the clerk to put it to
 * a ballot …)", and "the same kind of thing done several times"), made from a gold program of one act:
 *  - a form handed in, and a direction to someone about it (a third of the pilots' form requests carry one);
 *  - something withdrawn, and a direction to someone about it; the letter says what it is about (`re=`) only where
 *    the request cites it by id again for them, three times in ten;
 *  - two things withdrawn.
 * The direction is a letter asked for indirectly: its words are the writer's to invent and to mark, and its line's
 * text is whatever was marked (`marked`). Whoever it goes to is invented here: an office, a person or an organisation
 * by id, or an office by what it is called. Undefined for a program that is none of these acts.
 * Why: a model trained without them writes the first act and stops (13 real requests want a form and a letter).
 */
export function pairOf(g: Gold, rand: () => number): { gold: Gold; pair: Pair; /** The direction by itself, for the way of saying it. */ letter?: string } | undefined {
  const p = calls.parseProgram(g.program);
  if ("none" in p || p.lines.length !== 1) return undefined;
  const c = p.lines[0]!.call;
  const withdrawn = c.fn === "statement" && c.args.withdraw && "id" in c.args.withdraw ? c.args.withdraw.id : undefined;
  if (c.fn !== "form" && withdrawn === undefined) return undefined;
  // (A direction to an office is not handed in for someone to take further. A paper of one's own office may go out with a direction to someone about it, as any act may.)
  if (ownForm(p, g.forms ?? [])?.office === "direction") return undefined;
  const own = literals(p);
  const made = (second: calls.Call, pair: Pair, names: { [id: string]: string } = {}): { gold: Gold; pair: Pair; letter?: string } => {
    const program = calls.programText({ lines: [...p.lines, { call: second }] });
    return { pair, gold: { ...g, program, shape: shapeOf(calls.parseProgram(program)), names: { ...g.names, ...names }, family: g.family ?? g.program }, ...(second.fn === "message" ? { letter: calls.programText({ lines: [{ call: second }] }) } : {}) };
  };
  if (withdrawn !== undefined && rand() < 0.4) {
    let other = withdrawn;
    for (let tries = 0; tries < 20 && own.some((x) => x.includes(other) || other.includes(x)); tries++) other = `rec.${1 + Math.floor(rand() * 40000)}`;
    return made({ fn: "statement", args: { withdraw: { id: other } } }, "withdraw+withdraw");
  }
  const r = rand();
  const who = r < 0.25 ? undefined : mentions(rand, 1, own, r < 0.7 ? ["an office"] : ["a person", "an organisation"])[0];
  const title = DIRECTED[Math.floor(rand() * DIRECTED.length)]!;
  const to: calls.Value = who ? { id: who.id } : { text: title };
  const cited = withdrawn !== undefined && rand() < 0.3;
  return made({ fn: "message", args: { to, text: { text: "…" }, ...(cited ? { re: { id: withdrawn! } } : {}) } }, c.fn === "form" ? "form+message" : "withdraw+message", who?.what === "an office" ? { [who.id]: title } : {});
}

/**
 * How a letter is asked for indirectly, as the seats ask (a sixth of the pilots' requests: "Direct the works manager
 * [works] to arrange collection … and report when it is complete"): one is given to the writer, chosen by seed. Each is
 * a message by the translator's rules: directing, asking, telling and instructing, and having or getting someone to do
 * what is theirs to decide (making, ensuring or seeing to it that they do is `not_yours`, and never asked for here).
 */
const DIRECTING = ["direct {to} to …", "direct {to} to …", "ask {to} to …", "tell {to} to …", "instruct {to} to …", "have {to} …", "get {to} to …"];

/** What the writer is told of saying a letter indirectly: one of the ways (DIRECTING), with where the marks go. */
export function indirectNotes(program: string, rand: () => number, ways: string[] = DIRECTING): string[] {
  const p = calls.parseProgram(program) as { lines: calls.Line[] };
  const to = inWords(p.lines[0]!.call.args.to) ?? "them";
  const way = ways[Math.floor(rand() * ways.length)]!;
  return [`The act, said something like: "${way.replace("{to}", to).replace("…", `${OPEN}…${CLOSE}`)}".`];
}

/** What a writer is told when a letter is to be asked for indirectly. */
const INDIRECTLY = [
  "Asked indirectly: this request quotes no letter. It directs, asks, tells or instructs them to do something, or has or gets them to do it, and what they are to do is yours to invent: an ordinary administrative task for whoever they are (arrange, inspect, collect, repair, prepare, review, confirm, report back …), one to three clauses (more where the style says so), in the voice of the style. It is something said to them in words: not so many units of a kind of work at a place, not a payment, not a form.",
  `In your request, put ${OPEN} straight before the first word of what they are to do and ${CLOSE} straight after its last word, so that the words between the marks are precisely what would be said to them: not the "to" before them, not who they are, not the full stop after. Use the marks once, with no quotation marks between them. Who it goes to is said outside the marks, as the call writes it.`,
].join("\n");

/** What a writer is told when an office is directed and no form for the direction is listed (`direction_unlisted`):
 * the letter's words are still the writer's, but what they say is given (under "How to say it"). */
const DIRECTED_UNLISTED = [
  "Asked indirectly: this request quotes no letter. It directs an office to change something the office does of its own accord, as an office-holder directs one, and there is no form for it: the direction is words said to the office. What the office is to do is given below, under \"How to say it\": put it in your own words, one to three clauses (more where the style says so), in the voice of the style, holding each figure given there as written. It names no form and no record.",
  INDIRECTLY.split("\n")[1]!,
].join("\n");

/**
 * What a writer is sent for a gold program in a style, whoever the writer is (a model behind an adapter, or one that
 * is handed a file of these: `planOf`). `notes`: what else the writer is told of this program (a way of saying it,
 * chosen by seed, and what its values are: `writerNotes`). `indirect`: the program is a letter to be asked for
 * indirectly: the call is shown with its text left open, and the writer is told to invent and mark it.
 */
/** What a writer is told of a request for two acts (`pairOf`). */
const PAIRED: { [pair in Pair]: string } = {
  "form+message": "Two things in one request, as office-holders ask them: the form of line 1 is handed in, said first and whole; and then, in a sentence of its own, someone is directed, asked, told or instructed to do something about that same form (what is to become of it next: put it to a ballot, enter it in the register, list it for the next meeting, tell those it concerns), which is line 2. What they are to do is yours to invent: one or two clauses, in the voice of the style, said to them in words.",
  "withdraw+message": "Two things in one request, as office-holders ask them: what line 1 names is withdrawn, said first and whole; and then, in a sentence of its own, someone is directed, asked, told or instructed to do something about that same withdrawal (take it off the agenda, strike it from the register, tell those it concerned, stop work that rested on it), which is line 2. What they are to do is yours to invent: one or two clauses, in the voice of the style, said to them in words.",
  "withdraw+withdraw": "The same thing done twice in one request: both of the things named are withdrawn, each by its id. Say it as one request (\"Withdraw … and …\"), not as two.",
};
/** The same for a paper of the speaker's own office (`FormSpec.office`): it is issued, not handed in to anyone. */
const PAIRED_PAPER = "Two things in one request, as office-holders ask them: the paper of line 1 is made out, said first and whole, as told below; and then, in a sentence of its own, someone is directed, asked, told or instructed to do something about that same paper (deliver it, file a copy of it, tell those it concerns, act on it), which is line 2. What they are to do is yours to invent: one or two clauses, in the voice of the style, said to them in words.";
const PAIRED_ORDER ="Where the style asks for further sentences after the act, they come after line 1's act and before the direction, and are about the act: the direction is the last sentence of the request. What the style says of asking for nothing more and telling nobody else is said of those further sentences: the direction is part of what is asked.";

export function requestBrief(gold: Gold, style: string, notes: string[] = [], o: { indirect?: boolean; pair?: Pair } = {}): string {
  const names = Object.entries(gold.names).map(([id, name]) => `${id} is ${name}`);
  const form = formOf(gold.program);
  const fields = (gold.forms ?? []).filter((f) => f.form === form?.form).map(formLine);
  return [
    `Call:\n${o.indirect ? withText(gold.program, `${OPEN}…${CLOSE}`) : gold.program}`, `What it brings about (for your understanding: don't reuse this wording):\n${bringsAbout(gold.program).join("\n")}`,
    ...(o.pair ? [[o.pair === "form+message" && ownForm(gold.program, gold.forms ?? []) ? PAIRED_PAPER : PAIRED[o.pair], ...(o.indirect ? [INDIRECTLY.split("\n")[1]!, ...((calls.parseProgram(gold.program) as { lines: calls.Line[] }).lines.some((l) => l.call.fn === "message" && "re" in l.call.args) ? ["The call's letter says what it is about (re=): name that id again where they are directed, outside the marks (\"Direct them, regarding rec.412, to …\")."] : []), PAIRED_ORDER] : [])].join("\n")] : o.indirect ? [gold.tag === "direction_unlisted" ? DIRECTED_UNLISTED : INDIRECTLY] : []),
    ...(notes.length ? [`How to say it:\n${notes.join("\n")}`] : []),
    ...(names.length ? [`For your understanding only (still write the ids): ${names.join("; ")}.`] : []), ...(fields.length ? [`The form, as the person knows of it:\n${fields.join("\n")}`] : []), `Style: ${STYLES[style] ?? style}`,
  ].join("\n\n");
}

/** A writer's answer as a request: trimmed, and marks round the whole of it taken off. The same for a model's answer
 * and for a line of a writer's file. */
export const asRequest = (text: string): string | undefined => (text.trim() ? unwrapped(text.trim()) : undefined);

/** A brief sent to a model under a writer's instructions, and its answer as a request. */
async function ask(adapter: LlmAdapter, system: string, brief: string, usage?: (u: Usage) => void): Promise<string | undefined> {
  const res = await adapter.complete({ purpose: "translator", subject: "training-data-writer", system, maxTokens: 600, messages: [{ role: "user", content: brief }] });
  usage?.(res.usage);
  return asRequest(res.content.filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text").map((b) => b.text).join(" "));
}

/** A request for a gold program in a style, from a model. */
export async function writeRequest(adapter: LlmAdapter, gold: Gold, style: string, usage?: (u: Usage) => void, notes: string[] = []): Promise<string | undefined> {
  return ask(adapter, writerSystem(), requestBrief(gold, style, notes), usage);
}

/** Why a written request reads as the call and not as a person, each a reason a request is dropped for (and counted). */
export type Unnatural = "quotes" | "variable_named" | "argument_named" | "zero_wait" | "place_reversed" | "description_echoed";
export const UNNATURAL: Unnatural[] = ["quotes", "variable_named", "argument_named", "zero_wait", "place_reversed", "description_echoed"];

/** Phrases of a function's description that nobody asking for the act would say (the second audit, 2026-10-06, found
 * each in nearly every request for its function), with the arguments the call must have for the phrase to be an echo. */
const ECHOES: { [fn: string]: [pattern: string, echo: RegExp][] } = {
  take: [["", /\bwithout (their|his|her|its|the owner'?s?) (agreement|consent)\b/i], ["", /\bfrom where (they|it) (are|is)\b/i]],
  harm: [["", /\bphysically harm/i]],
  vote: [["", /\bcast (my|a|the|our) choice\b/i]],
  birth: [["", /\b(record|recorded|register|registered)\b[^.;]{0,24}\bas an? /i]],
  occupancy: [["!who", /\bsomeone\b/i]],
};

/** Whether a text's quotes are closed: straight ones in pairs, curly ones opened and closed. */
/** A written request without quotation marks put around the whole of it (a model's habit). Only a pair around
 * everything is taken off: a request that ENDS in quoted words keeps their closing mark (until 2026-10-06 the last
 * mark was always taken, and every such request then failed the check for an unclosed quote). */
export function unwrapped(text: string): string {
  const t = text.trim();
  if (!/^["“]/.test(t) || !/["”]$/.test(t)) return t;
  const inner = t.slice(1, -1);
  const first = inner.search(/["“”]/);
  // Around everything: nothing quoted inside, or what's quoted inside opens after a space or a colon (so the first
  // mark of all isn't closed by it) and is closed again.
  const around = first < 0 || (/[\s:(]/.test(inner[first - 1] ?? "") && (inner.match(/["“”]/g) ?? []).length % 2 === 0);
  return around ? inner.trim() : t;
}

export function quotesBalanced(text: string): boolean {
  return (text.match(/"/g) ?? []).length % 2 === 0 && (text.match(/“/g) ?? []).length === (text.match(/”/g) ?? []).length;
}

/**
 * Why a written request reads as its program and not as something a person would say, or undefined if nothing here
 * says so. Checked mechanically, before any model is asked (what the copy check can't see, and what a model checking
 * its own kind of wording lets through: the audit of 2026-10-06 found a fifth of kept requests right but unnatural):
 *  - quotes: a quote opened and never closed (what follows is swallowed into the quoted words);
 *  - variable_named: the name a line of the program gives to what it makes (v1) appears in the request;
 *  - argument_named: an argument's name followed by "=", or "the <name> field" (or the word "field" at all) where no
 *    form is being filled in;
 *  - zero_wait: "0 days" said of something that starts now;
 *  - place_reversed: goods said to come "from" the place the program delivers them to (`at`), in a commitment too;
 *  - description_echoed: a phrase of the function's description that nobody asking would say ("physically harm",
 *    "without their agreement", "cast my choice", "recorded as an infant", "someone" moving in where the speaker does).
 * (A form's label read out with its underscore, "charge_to", counts as argument_named.)
 * What the program copies from the request (its quoted texts, its ids) is looked past: a letter's own words may say
 * anything.
 */
export function badlyWritten(request: string, program: string, riders: Rider[] = []): Unnatural | undefined {
  const p = calls.parseProgram(program);
  if ("none" in p) return quotesBalanced(request) ? undefined : "quotes";
  let bare = withoutRiders(request, riders);
  const quoted = literals(p).some((x) => /["“”]/.test(x));
  for (const x of [...mustAppear(p)].sort((a, b) => b.length - a.length)) bare = bare.split(x).join("\u0001".repeat(x.length));
  if (!quoted && !quotesBalanced(request)) return "quotes";
  const word = (name: string) => new RegExp(`(?<![A-Za-z0-9_.\\/-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_\\/-])`);
  for (const l of p.lines) if (l.bind && word(l.bind).test(bare)) return "variable_named";
  const names = new Set<string>();
  let form = false, zero = false;
  const walk = (c: calls.Call) => {
    if (c.fn === "form") form = true;
    for (const [k, v] of Object.entries(c.args)) {
      names.add(k);
      if ("call" in v) walk(v.call);
      else if ("text" in v && DURATION_ARGS.has(k) && noTime(v.text)) zero = true;
    }
  };
  for (const l of p.lines) walk(l.call);
  for (const k of names) {
    const spelled = k.replace(/_/g, "[ _]");
    if (new RegExp(`(?<![A-Za-z0-9])${spelled}\\s*=`, "i").test(bare)) return "argument_named";
    if (!form && new RegExp(`\\bthe ["“']?${spelled}["”']? field\\b`, "i").test(bare)) return "argument_named";
    // A form's label with an underscore, written with it: the form's own schema read out ("charge_to: acc-1").
    if (form && k.includes("_") && k !== "form" && new RegExp(`(?<![A-Za-z0-9_])${k}(?![A-Za-z0-9_])`).test(bare)) return "argument_named";
  }
  if (!form && /\bfields?\b/i.test(bare)) return "argument_named";
  if (zero && /(?<![0-9.,])0 (seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/i.test(bare)) return "zero_wait";
  // Goods said to come "from" the place they are delivered to (in a commitment too): the program's `at` is where
  // they go, and a reader of the request would write `from_at`.
  const text = (v: calls.Value | undefined) => (v === undefined ? undefined : "id" in v ? v.id : "text" in v ? v.text : undefined);
  const reversed = (c: calls.Call): boolean => {
    const at = c.fn === "goods" ? text(c.args.at) : undefined;
    if (at !== undefined && at !== text(c.args.from_at) && new RegExp(`\\bfrom (?:(?!(?:to|at|into|in|onto|over|round|for|and|by)\\b)[A-Za-z'’-]+ ){0,4}\\[?${at.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i").test(request)) return true;
    return Object.values(c.args).some((v) => "call" in v && reversed(v.call));
  };
  if (p.lines.some((l) => reversed(l.call))) return "place_reversed";
  // (A line's own act only: what a commitment inside an agreement says of "someone" is the agreement's wording.)
  const echoed = (c: calls.Call): boolean => (ECHOES[c.fn] ?? []).some(([pattern, echo]) => fits(pattern, c) && echo.test(bare));
  if (p.lines.some((l) => echoed(l.call))) return "description_echoed";
  return undefined;
}

/** Why a request's marks can't be used (`marked`); `unasked`: marks in a request that wasn't to have any. */
export type Marks = "missing" | "unbalanced" | "empty" | "several" | "quoted" | "unasked";

/**
 * A request for a letter asked for indirectly, as its writer handed it back: the marks taken off, and the words that
 * were between them (what is asked of whoever the letter goes to: the program's `text`), with where they are in the
 * request without the marks. Or why the marks can't be used: there are none; one without the other, or the closing one
 * first; nothing between them; more than one pair; a quotation mark between them (the words would be a quoted letter,
 * and a call's text can't hold the mark). A space inside the marks and a full stop or comma before the closing one are
 * no part of the words (the translator's rules: the text is the words asked of them, first to last, nothing added).
 */
export function marked(text: string): { request: string; words: string; at: [number, number] } | { marks: Marks } {
  const opens = text.split(OPEN).length - 1, closes = text.split(CLOSE).length - 1;
  if (!opens && !closes) return { marks: "missing" };
  const a = text.indexOf(OPEN), b = text.indexOf(CLOSE);
  if (opens !== closes || b < a) return { marks: "unbalanced" };
  if (opens > 1) return { marks: "several" };
  const inner = text.slice(a + 1, b);
  const words = inner.trim().replace(/[\s.,;:!?]+$/, "");
  if (!/[\p{L}\p{N}]/u.test(words)) return { marks: "empty" };
  if (/["“”\\\n\r]/.test(inner)) return { marks: "quoted" };
  const start = a + (inner.length - inner.trimStart().length);
  return { request: text.slice(0, a) + inner + text.slice(b + 1), words, at: [start, start + words.length] };
}

/**
 * The ids a request names that its program doesn't have: whatever stands in square brackets by itself (the styles put
 * an id there and nothing else), and anything written in the shape of an id (ID_SHAPED: rec.412, law-rates, acc-c0003,
 * c0042, str.7, lot-12-03, house-165; since 0.7.0 more shapes than a record's and a law's, as the requests are now
 * given ids to name and a writer may add some of its own). Looked for outside the riders (a citation given as a rider
 * is one the request was told to carry, and so is every id it was given to mention) and outside the texts the
 * program copies whole (a letter's words may name anything). A form may be named by its record's id.
 * For the seats' voices (`early`, `late`): their further sentences are the writer's own, and one that names another
 * record or account is asking about something the call doesn't have ("Keep ballot rec.2679 unchanged": real seats
 * write that, and it is why these sentences are told to name nothing).
 */
export function strayIds(request: string, program: string, o: { riders?: Rider[]; forms?: FormSpec[] } = {}): string[] {
  const p = calls.parseProgram(program);
  if ("none" in p) return [];
  const known = new Set([...needed(p, o.forms ?? []).map((n) => n.value), ...literals(p), ...(o.forms ?? []).map(formId)]);
  let bare = withoutRiders(request, o.riders ?? []);
  for (const x of mustAppear(p).filter((v) => /\s/.test(v)).sort((x, y) => y.length - x.length)) bare = bare.split(x).join("\u0001".repeat(x.length));
  const out = new Set<string>();
  for (const m of bare.matchAll(/\[([^\[\]\s\u0001]+)\]/g)) if (!known.has(m[1]!)) out.add(m[1]!);
  for (const m of bare.matchAll(ID_SHAPED)) if (!known.has(m[1]!)) out.add(m[1]!);
  return [...out];
}

/**
 * Where each needed value of a program is in a request (for an example's `spans`).
 * A value that is in the request once is there. One that is there more than once (an office named in each of two
 * lines; a party who is also an account's holder) is placed by the other values of its own call: the values of one
 * call are said together, so the occurrence that lies with its own call's values and not with another call's, or
 * nearest its own, is the one (a line of a program is a call, and so is each commitment nested in an agreement). An
 * occurrence that is another argument's is not this one's as well, and neither is one inside another, longer value
 * that has been placed (an amount a form's long text says again), where the value also stands outside it. Where none
 * of that settles it there, a form's field is where its value stands straight after the field's own label, if in one
 * place alone (two fields with the same amount: `labelBefore`). Where nothing settles it (one call alone,
 * where every occurrence is among its own values; occurrences equally near), every occurrence is recorded and the
 * span is marked ambiguous.
 */
export function spansIn(request: string, program: string, forms: FormSpec[] = []): Span[] {
  const parsed = calls.parseProgram(program);
  const { needed: needs, implied } = valuesOf(parsed, forms);
  // The form each line fills in, as known: its fields' labels say whose an amount is where two fields share one.
  const specs = "none" in parsed ? [] : parsed.lines.map((l) => specOf(l.call, forms));
  const group = (n: Needed) => `${n.line ?? 0}:${n.arg.includes(".") && !/^about\.[^.]+$/.test(n.arg) ? n.arg.slice(0, n.arg.lastIndexOf(".")) : ""}`;
  const found = needs.map((n) => occurrences(request, n));
  const settled: ([number, number] | undefined)[] = found.map((f) => (f.length === 1 ? f[0] : undefined));
  // The places a value could still be: not where another argument with the same value has been placed.
  const open = (i: number): [number, number][] => {
    const taken = needs.flatMap((m, j) => (j !== i && m.value === needs[i]!.value && settled[j] ? [settled[j]![0]] : []));
    const left = found[i]!.filter((at) => !taken.includes(at[0]));
    // Nor where it stands inside another, longer value that has been placed (an amount said again in a form's long
    // text: the text is copied whole, and the field's amount is the one said against its label), if it stands elsewhere.
    const outside = left.filter((at) => !needs.some((_, j) => j !== i && settled[j] && settled[j]![0] <= at[0] && at[1] <= settled[j]![1] && settled[j]![1] - settled[j]![0] > at[1] - at[0]));
    return outside.length ? outside : left.length ? left : found[i]!;
  };
  // The stretch of the request each call's settled values take up, and how far a place is from it.
  const hull = (g: string, but: number): [number, number] | undefined => {
    const own = needs.flatMap((n, i) => (i !== but && group(n) === g && settled[i] ? [settled[i]!] : []));
    return own.length ? [Math.min(...own.map((x) => x[0])), Math.max(...own.map((x) => x[1]))] : undefined;
  };
  const gap = (at: [number, number], h: [number, number]) => (at[1] <= h[0] ? h[0] - at[1] : at[0] >= h[1] ? at[0] - h[1] : 0);
  const groups = [...new Set(needs.map(group))];
  for (let pass = 0; pass < 3; pass++) for (const [i, n] of needs.entries()) {
    if (settled[i] || found[i]!.length < 2) continue;
    const places = open(i);
    if (places.length === 1) {
      settled[i] = places[0];
      continue;
    }
    // A form's field: the place that stands straight after its own label, if one alone does.
    const spec = specs[n.line ?? 0];
    const labelled = spec && n.arg in spec.fields ? places.filter((at) => labelBefore(request, spec, n.arg, at)) : [];
    if (labelled.length === 1) {
      settled[i] = labelled[0];
      continue;
    }
    const own = hull(group(n), i);
    const others = groups.filter((g) => g !== group(n)).map((g) => hull(g, i)).filter((h): h is [number, number] => !!h);
    if (!own || !others.length) continue;
    const ours = places.filter((at) => others.every((h) => gap(at, own) < gap(at, h)));
    const among = ours.length ? ours : places;
    const gaps = among.map((at) => gap(at, own));
    const least = Math.min(...gaps);
    if (gaps.filter((x) => x === least).length === 1) settled[i] = among[gaps.indexOf(least)];
  }
  // A copy is the span's own characters: a value found in other letters than its own (an id that is an ordinary word,
  // said with a capital) was chosen for those words, not copied from them.
  const how = (n: Needed, at: [number, number]): Span["how"] => (n.how === "copy" && request.slice(at[0], at[1]) === n.value ? "copy" : "choice");
  const spans = needs.flatMap((n, i): Span[] => {
    // (What the request may leave unsaid, and does, is implied: an office's own form not named, a yes or no.)
    if (!found[i]!.length) return n.optional ? [{ arg: n.arg, value: n.value, how: "implied", ...(n.line !== undefined ? { line: n.line } : {}) }] : [];
    const all = open(i);
    const at = settled[i] ?? all[0]!;
    const base = { arg: n.arg, value: n.value, how: how(n, at), ...(n.line !== undefined ? { line: n.line } : {}) };
    return [settled[i] ? { ...base, at } : { ...base, at, ambiguous: true, all }];
  });
  // What the wording implies has no span: it is recorded as that, so no head is trained to find it.
  return [...spans, ...implied.map((n): Span => ({ arg: n.arg, value: n.value, how: "implied", ...(n.line !== undefined ? { line: n.line } : {}) }))];
}

/** Whether a request carries everything its program takes from it (the translator copies and chooses; it never composes). */
export function copies(request: string, program: string, forms: FormSpec[] = []): boolean {
  return needed(calls.parseProgram(program), forms).every((n) => spanOf(request, n) !== undefined);
}

/**
 * A program with the same meaning counts as the same: the same in canonical form (eval/run.ts), or the same by value
 * (meaning.ts: an amount, a length of time or a count that reads as the same number, a flag in either spelling, one
 * id or a list of it, a letter to two or one to each). `ctx`: the money and the forms of the world they are from.
 */
export const sameProgram = (a: string, b: string, ctx: MeaningContext = {}): boolean => canonical(a) === canonical(b) || sameMeaning(a, b, ctx);

/** Which line of a program is its letter (the first that is one). */
const letterLine = (program: string): number => { const p = calls.parseProgram(program); return "none" in p ? -1 : p.lines.findIndex((l) => l.call.fn === "message"); };

/** A stable id for an example: from what it is. */
const exampleId = (request: string, program: string) => sha256(canonicalJson({ request, program })).slice(0, 16);

/** How one request runs on into the next when someone piles tasks into one message. */
const AND_ALSO = [
  " Also, separately: ", " And while you're at it: ", " One more thing: ", " Separately: ", " And another thing: ", " Also: ", " And then: ", " Then ", " Next, ", " After that, ",
  " On top of that, ", " While I think of it: ", " Oh, and ", " Plus: ", " And ", " Besides that, ", " Another matter: ", " In the same breath: ", " Before I forget: ", " Likewise, ",
];
/** How a message of several things opens, when it says that it is several. */
const SEVERAL = ["Take these in order: ", "Several things today. ", "A few things: ", "Three or four matters, as follows. ", "Please see to the following: ", "For today: "];
/** Words a request opens with that are no name: one of these loses its capital in the middle of a sentence. */
const OPENERS = /^(Please|Could|Can|Would|Will|Have|Let|Pay|Send|Transfer|Offer|Give|Move|Open|Close|Record|Appoint|Create|Put|Deliver|Take|Set|Get|Make|We|As|Kindly|Publish|Post|Sign|Withdraw|Vote|Write|Tell|Submit|File|Build|Demolish|Start|Ship|Bring|Do|Carry|Arrange|Register|Note|Issue|Admit|Switch|Shut|Retire|Deploy|Install|Hit|Attack|Grab|Help|Vacate|Name|Hand|Found|Form|Establish|Release|Pass|Assign|Accept|Serve|End|Cancel|Take|Pull|Knock|Tear|Hire|Commission|House|Settle|The|A|An|My|Our|There|In|On|For|This)\b/;

/**
 * Several requests as one message, the ways people run things together (chosen by the generator given): with nothing
 * between them; in one sentence, joined by "and"; numbered, or as a list, with or without a line saying that several
 * things follow; or each running on from the last ("… Oh, and …", "… After that, …"). The second audit (2026-10-06)
 * found every built `too_much` joined by "Also:" or "And then:": a mark a model learns in place of counting acts.
 */
export function runTogether(parts: string[], rand: () => number): string {
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const lower = (s: string) => (OPENERS.test(s) && !/^I\b/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
  const open = (s: string) => s.replace(/\.$/, "");
  const r = rand();
  if (r < 0.15) return parts.join(" ");
  if (r < 0.35) {
    const and = pick([", and ", " and ", "; and ", ", and also ", ", then "]);
    const all = parts.map((s, i) => (i === 0 ? open(s) : lower(open(s)))).join(and);
    return /[.!?"”]$/.test(all) ? all : `${all}.`;
  }
  if (r < 0.6) {
    const mark = pick([(i: number) => `${i + 1}. `, (i: number) => `(${i + 1}) `, (i: number) => `${i + 1}) `, () => "- ", (i: number) => `${["First", "Second", "Third", "Fourth", "Fifth", "Sixth"][i] ?? "Next"}, `]);
    const between = pick([" ", "\n"]);
    const listed = parts.map((s, i) => { const m = mark(i); return m + (/, $/.test(m) ? lower(s) : s); }).join(between);
    return rand() < 0.4 ? pick(SEVERAL) + (between === "\n" ? "\n" : "") + listed : listed;
  }
  return parts.reduce((all, next) => { const j = pick(AND_ALSO); return all + j + (/[:.] $/.test(j) ? next : lower(next)); });
}

/**
 * Refusals that can be built without anyone's judgement:
 *  - too_much, as people make it: two or three requests about the same person, organisation, account or place (they
 *    share an id), each a different kind of act, run on in one message ("… And while you're at it: …"). None is a
 *    letter or something published (doing something and writing to someone about it is one request, by the
 *    translator's rules), and none is a second act of the same kind (the same thing done several times is one too).
 *    A share of them (`pasted`, a third if not said; all of them where no examples are related) are the long kind:
 *    four to six unrelated requests pasted together. Either is shown with every form any of its parts was shown with,
 *    so that it's the number of things asked, and no missing form, that makes it a refusal. (The natural kind is also
 *    written, by a writer given related acts: `piledBriefs`.)
 *  - unknown_form: a request to fill in a form, shown to the translator without that form (under any office), and
 *    still with whatever other forms were shown beside it.
 * `floor`: at least so many of a label, as far as the examples allow (a share of them otherwise); a label this can't
 * build is left to whoever writes it.
 * A request in the seats' `late` voice is no part of any of them: its closing sentences rule out anything further
 * (as a "Do not …" rider does), so a message that went on to ask for more would contradict itself; and it is long
 * BECAUSE it is one act carefully qualified, which is what a model has to tell from several acts. (Several acts in
 * that voice are written, not built: `piledBriefs` are dealt the styles like every brief.)
 * A part may mention other things by id (an `early` request's "[rec.2678] stays as it is"): each part is still an act
 * of its own with its own values, so what makes it too much is the acts, as it must be now that one act names many ids.
 * (The other refusals have to be written; they come from a writer, checked by another model: `refusalBriefs`.)
 */
export function builtRefusals(positives: Example[], seed = 1, share = 0.05, floor: { [label in calls.Label]?: number } = {}, o: { pasted?: number; /** Build this label's only. */ only?: "too_much" } = {}): Example[] {
  const rand = sampler(seed);
  const out: Example[] = [];
  const ids = new Set<string>();
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const said = (e: Example) => e.request.replace(/\s+/g, " ").trim();
  const add = (parts: Example[], request: string, source: string): boolean => {
    const id = exampleId(request, "none(too_much)");
    if (ids.has(id)) return false;
    ids.add(id);
    out.push({ id, request, forms: [...new Set(parts.flatMap((e) => e.forms))], program: "none(too_much)", kind: "refusal", shape: "none(too_much)", source, built_from: parts.map((e) => e.id) });
    return true;
  };
  const n = Math.max(Math.floor(positives.length * share), floor.too_much ?? 0);
  // The related kind: what each example mentions by id, and so which examples are about the same thing.
  const mentioned = new Map<Example, string[]>();
  const about = new Map<string, Example[]>();
  const separate = (e: Example) => !["message", "statement"].includes(functionOf(e)) && !e.program.includes("\n") && !(e.riders ?? []).some((r) => r.kind === "do_not") && e.style !== "late";
  for (const e of positives.filter(separate)) {
    let found: string[] = [];
    try {
      found = mustAppear(calls.parseProgram(e.program)).filter((x) => /^[a-z0-9][a-z0-9._\/-]*$/.test(x) && /[0-9.\/-]/.test(x) && !/^[0-9]+$/.test(x));
    } catch {
      // not a program: about nothing
    }
    mentioned.set(e, found);
    for (const x of found) (about.get(x) ?? about.set(x, []).get(x)!).push(e);
  }
  const partnersOf = (e: Example) => [...new Set((mentioned.get(e) ?? []).flatMap((x) => about.get(x)!))].filter((x) => x !== e && !(x.riders ?? []).some((r) => r.kind !== "mention") && x.style !== "late" && functionOf(x) !== functionOf(e) && (x.gold ?? x.program) !== (e.gold ?? e.program));
  const firsts = [...mentioned.keys()].filter((e) => partnersOf(e).length);
  const pasted = Math.ceil(n * (o.pasted ?? 1 / 3));
  let made = 0;
  for (let i = 0; made < n - pasted && i < n * 4 && firsts.length; i++) {
    const first = pick(firsts);
    const parts = [first];
    for (const x of shuffled(partnersOf(first), rand)) if (parts.length < (rand() < 0.35 ? 3 : 2) && !parts.some((y) => functionOf(y) === functionOf(x))) parts.push(x);
    if (add(parts, runTogether(parts.map(said), rand), "built: related requests run together")) made++;
  }
  // (One message is said in one capacity: only its first part may open with one, or the second "As … of …" marks the
  // paste.)
  const capacity = (e: Example) => (e.riders ?? []).some((r) => r.kind === "capacity");
  // (Nor is a request for two acts that are one thing, `pair`: what is run together here is acts that are each a
  // request of their own, and a pile with such a pair in it would have the model count lines.)
  const pastable = positives.filter((e) => e.style !== "late" && !e.pair);
  for (let i = 0; made < n && i < n * 4 && pastable.length >= 8; i++) {
    const parts = new Map<string, Example>();
    for (let tries = 0; parts.size < 4 + Math.floor(rand() * 3) && tries < 64; tries++) {
      const e = pick(pastable);
      if (![...parts.values()].some((x) => x.shape === e.shape) && !(parts.size && capacity(e))) parts.set(e.id, e);
    }
    if (parts.size < 4) continue;
    if (add([...parts.values()], runTogether([...parts.values()].map(said), rand), "built: several requests run together")) made++;
  }
  if (o.only === "too_much") return out;
  // (Only a request that names its form: a direction or a paper asked for without naming the form, shown without the
  // form, is no request for an unknown form. It is a letter to the office, or a paper nothing here writes.)
  const forms = positives.filter((e) => e.shape.startsWith("form(") && e.forms.length && !(e.spans ?? []).some((s) => s.arg === "form" && s.how === "implied"));
  const chosen = new Set(forms.filter(() => rand() < Math.max(share * 4, 0.2)));
  for (const e of shuffled(forms, rand)) if (chosen.size < Math.min(floor.unknown_form ?? 0, forms.length)) chosen.add(e);
  for (const e of forms.filter((x) => chosen.has(x))) {
    const name = formOf(e.program)?.form;
    const { spans: _, riders: __, pair: ___, indirect: ____, ...rest } = e; // (what it was as a positive is not what it is as a refusal)
    out.push({ ...rest, id: exampleId(e.request, "none(unknown_form)"), forms: e.forms.filter((line) => !line.startsWith(`- ${name}, to=`)), program: "none(unknown_form)", kind: "refusal", shape: "none(unknown_form)", gold: e.gold ?? e.program, source: "built: the form left out of what's known" });
  }
  return out;
}

/** How an amount is left to be worked out: each a line of instruction to the writer. */
/** How a sum is divided between several accounts when no share is a figure (round 3: the `needs_calculation` refusals made from `split_payment` programs). */
const SPLIT_RULES = ["in equal shares", "in proportion to what each is owed", "by a percentage each, to be worked out from their last month's takings", "whatever each is short of the target", "half and half after the fee is taken off", "according to how many each has to feed"];
const WORKED_OUT = [
  "a share of something (half, a third, a quarter of what's in an account or a budget)",
  "a percentage of something (10% of a balance, 2% of last month's takings)",
  "whatever is left of something after something else",
  "an amount split equally between several people",
  "the same as some earlier payment, plus or minus something",
];
/** What someone asks to be shown. */
const LOOKS = [
  "what is recorded about", "the history of", "the current state of", "everything on file about", "the latest entries for", "who has had anything to do with", "who holds or answers for",
  "when anything last changed about", "whether anything is outstanding on", "what was decided about", "the terms of", "who signed", "what is owed on", "how much there is in or of",
];
const LOOKED_AT = [
  "the ledger", "the register of posts", "last month's payments", "the minutes", "the list of open ballots", "the land registry", "the permits granted this year", "the roll of members",
  "this week's deliveries", "the rent roll", "the list of vacant posts", "the outcome of the last ballot", "the agreements due to end this year", "the notices currently up",
  "who is behind on what they owe", "the stock held at each store", "the accounts for the quarter", "the complaints received this month", "the standing payments", "who holds which post",
];
/**
 * The ways people ask to look: each a way a request may be put, of which one is given to the writer (the second audit,
 * 2026-10-06: all eight `not_an_act` requests began "Show me", which is what a model would then take the label to mean).
 */
const LOOK_VERBS = [
  "See …", "Read …", "Check …", "Review …", "Inspect …", "Look up …", "Tell me …", "What is …?", "Who holds …?", "Show me …", "Let me see …", "Pull up …", "I'd like to look over …",
  "Go through … and tell me what's there", "Find … for me in the records", "List …", "How much …?", "Has … been …?", "When was …?", "Is there …?", "Which …?", "Give me a summary of …",
  "Open … so I can read it", "I need to know …", "Examine …", "Confirm for me whether …", "Bring up …", "Read out …", "Where does … stand?", "Let me have a look at …",
];
/** What a vague request is vaguely about. */
const VAGUE = [
  "the roads", "housing", "the budget", "the staff", "the complaints", "the river", "the invoices", "the park", "rents", "the waste", "the school", "that letter", "the market",
  "the bridge", "the noise at night", "the leak", "the queue at the counter", "the arrears", "the new arrivals", "the fence dispute", "the harvest", "the meeting", "the old hall",
  "the dogs", "the water", "the dust from the works", "those forms", "the neighbours", "the quarry business", "the empty shops",
];
/**
 * The kinds of vagueness: how a request can fail to say what should happen (five of the eight in the second audit's
 * trial were "something about X"). None is a plain request with a detail left out (that is no refusal: whoever
 * resolves the call asks), and none asks to see or be told anything (that is `not_an_act`).
 */
const VAGUENESS = [
  "a verb that names no act (sort out, deal with, handle, see to, fix up, take care of) and the subject",
  "a pronoun, or \"that thing\", with nothing it refers to (\"go ahead with it\", \"do the other one too\")",
  "\"the usual\", or \"the same as last time\", with nothing said of what that was",
  "a complaint or a worry with no act asked for (\"… is a disgrace\", \"I'm not happy about …\")",
  "a wish for a result with no way to it (\"… should be better by now\", \"make … right\")",
  "a hint that something is wrong, leaving it to the reader what to do (\"you know what needs doing about …\", \"someone ought to do something about …\")",
  "a go-ahead with no plan named (\"let's get moving on …\", \"time to act on …\")",
  "a priority or a mood and not an act (\"… matters most this month\", \"be firm on …\")",
  "two or three words that could be the start of anything (\"… again\", \"about … then\")",
  "a reference to a conversation the reader wasn't part of (\"what we said about …\", \"as agreed on …\")",
];
/**
 * Decisions that are someone else's to make: what a `not_yours` request wants made so (five of the eight in the second
 * audit's trial were "lower their prices").
 */
const THEIR_DECISIONS = [
  "lower their prices", "raise what they pay their staff", "vote a particular way on something", "take back someone they dismissed", "dismiss someone who works for them", "sign an agreement they have been offered",
  "drop a complaint they made", "withdraw an objection", "approve an application that is theirs to decide", "refuse an application that is theirs to decide", "keep different opening hours", "accept a lower rent",
  "sell land they own", "resign from a post they hold", "pay sooner than they agreed to", "stop trading on a certain day", "choose a different supplier", "end a strike", "admit a new member",
  "extend a deadline they set", "waive a fee they charge", "adopt a proposal put to them", "appoint a particular person to a post of theirs", "move out of a place they have a right to", "change a rule of their own",
  "give up a claim they hold", "lend to someone they have turned down", "stand for election", "apologise in public", "call off an event of theirs",
];
/** How a request demands an outcome of someone else, as against asking them for it: making, ensuring, seeing to it,
 * making sure that they do. Never having them or getting them to (until 2026-10-06 two of these ten were "get them to
 * …" and "have them …"): by the translator's rules since 0.7.4 that is asking them, a message. */
const MAKE_THEM = ["make them …", "see to it that they …", "ensure that they …", "make sure that they …", "make certain that they …", "fix it so that they …", "I want it settled that they …", "it must be that they …: make it so", "bring it about that they …", "see to it, without fail, that they …"];
/** Who a decision is whose, where the gold programs name nobody. */
const OTHERS = ["the council", "the board", "the landlord", "the union", "the bank", "the neighbours", "the supplier", "the committee", "the school", "the cooperative"];
/** What is to be done to something on record that the speaker names only by describing it (`look_first`). */
const DONE_TO_IT = ["cancelled for good", "withdrawn", "put on hold until the speaker says to resume it", "stopped", "paused for a month", "revoked"];
/** How something is named by description and not by id: each a way a request may put it. */
const BY_DESCRIPTION = ["any … that …", "every … that …", "whichever … it is that …", "all the … that …", "the … (the speaker doesn't have its reference)", "whatever … there is that …"];
/** Records of other kinds named only by describing them, each with what is to be done to it. */
const DESCRIBED = [
  "the latest notice put up about the market: taken down", "whatever agreement there is with the supplier: notice given on it", "all the postings for the vacant post: withdrawn", "the ballot now open on the budget: a vote cast on it",
  "any claim the landlord has recorded against the speaker: answered by withdrawing the speaker's own counter-notice, whichever that is", "the permit granted last season for the yard: revoked", "every notice still up about the old hall: taken down",
  "the offer the builder made last week: signed", "whichever standing instruction pays the cleaner: put on hold", "the invoice the carrier sent this month: paid by settling it, whichever record it is", "the lease on the corner shop: notice given on it",
  "all proposals the speaker has put to the council that are still open: withdrawn", "the standing order for the water bill: paused until further word", "any advertisement of the speaker's still running: withdrawn",
];
/** A look and an act that depends on what the look finds (`look_first`). */
const LOOK_THEN = [
  "find out who holds a post, and write to that person about something", "check which invoices are still unpaid, and pay those", "see whether an account's balance covers a payment and, only if it does, make it",
  "look up the account someone is paid into, and send money there", "find the agreement the speaker has with someone, and give notice on it", "work out which households are behind with what they owe, and send each a notice",
  "see which postings have had no applicants, and withdraw those", "read what the petition asks for, and publish a notice answering it point by point", "find which standing payments nobody authorised, and put a hold on them",
  "check who voted against the last proposal, and write to each of them", "look up which lots stand empty, and apply for a permit on the largest", "see what the inspection found, and order whatever repairs it lists",
];
/** What an office or organisation carries on by itself, nobody asking each time. */
const ROUTINES = [
  "advertising a post again whenever one falls vacant", "signing renewals as they come in", "sending reminders on a fixed day", "paying bills on the day they arrive",
  "the hours it keeps its counter open", "the order in which it takes up what comes in", "how often it makes its rounds", "issuing a receipt for everything handed in",
  "taking on a replacement by itself whenever someone leaves", "reordering stock when it runs low", "renewing its agreements on the same terms when they run out", "answering every complaint within a set number of days",
  "counting its stores at the end of every week", "sending overdue accounts on for collection", "inspecting what it lets before each new tenancy", "posting its accounts where anyone can read them",
  "putting every purchase above a set sum out to tender", "rounding what it charges to the nearest whole unit", "keeping a waiting list in the order people applied", "closing its books on the last day of the month",
  "chasing arrears after a set number of days", "giving its own staff first refusal on vacancies", "setting aside a share of what it takes in each month", "sending a collector round on a fixed day",
];
/** What a speaker may mean to attend in person (a wide part's `no_such_act`). */
const ATTENDED = [
  "the council's next meeting", "a hearing of the tribunal", "a funeral", "the opening of the new hall", "the count after the ballot closes", "the members' meeting", "the inspection of the works", "market day",
  "the school's open evening", "the reading of the accounts", "a neighbour's wedding", "the public consultation on the road", "the union's meeting", "the auction of the stores", "the handing over of the keys", "the harvest fair",
];
/** What a seat says with a request to attend: what it is, why being there matters, what they will take note of. */
const ATTENDS = "In this voice the request says what the speaker means to attend, why their being there in person matters and what they will take note of while there, each in plain words, all of it the speaker's own going and seeing.";
/** The arguments that name, by its id, something on record that an act is done to, each with what that thing is in a
 * brief's words (a wide part's `look_first`: the same act with that id unknown to the speaker). */
const ACTED_ON: { [fn: string]: [arg: string, what: string][] } = {
  vote: [["ballot", "the ballot voted on"]],
  agreement: [["sign", "the agreement to be signed"], ["notice", "the agreement notice is given on"]],
  statement: [["withdraw", "the thing on record that is withdrawn"], ["hold", "the standing thing that is put on hold"]],
  claim: [["release", "the right on record that is given up"], ["transfer", "the right on record that is passed on"]],
  money: [["settles", "the invoice or bill the payment settles"]],
};
/** The arguments that say where: a place a body could go to. */
const WHERE =["at", "on", "in", "from_at", "taken_at", "materials_at"];
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

/** A brief's line for the seats' voices with the ids it is to name. */
const withIds = (seats: string, n: { mention: string[]; say: string }): { seats: string; mention: string[] } => ({ seats: seats + n.say, mention: n.mention });

/** What a refusal's writer is told: the situation, and what the request must and mustn't do. */
export interface RefusalBrief {
  label: calls.Label; brief: string; mustCopy: string[]; source: string; gold?: string;
  /** What the request must not hold: the id of the thing a wide part's `look_first` is to name only by describing it. */
  mustNot?: string[];
  /** What else the writer is told where the request is in one of the seats' voices (`refusalRequestBrief`): the
   * particulars a seat gives with a request of this kind (pilot-style.md), which a short request doesn't have. */
  seats?: string;
  /** Ids such a request is given to name, in the seats' voices (they are in `seats`): a real request to read or to
   * pause names many (accounts whose entries are wanted, records to read, an instruction's payees). Its to carry then. */
  mention?: string[];
}

/** What a seat asks for with a request to read or inspect: the stretch of time it covers and what each entry is to
 * show. (Time is the world's own: days of a year, never a calendar date.) */
const PARTICULARS = "In this voice the request asks for particulars, as an office-holder does: the stretch of time it covers where that makes sense, in days of the year and never a calendar date (\"for days 40 to 64 of year 2\": choose your own), and what each entry is to show, three or four things by name (each payment's date, amount, recipient and the line it was approved under; each holder and since when; each decision, who made it and on what grounds). They are particulars of what is to be shown, never a second request.";
/** What a seat says with a request about something it names only by describing it: the description at length, and what is left alone. */
const DESCRIBED_AT_LENGTH = "In this voice the request describes what it means at length, as an office-holder does (what it is for, since when it has stood, who made it or who it concerns), and says what is to be left untouched, each thing by name in plain words. However long, it gives no id for the thing acted on: that is known only by its description.";
/** What a seat says with a request to look and then act on what is found: what is to be looked at, and that the act follows from it. */
const FOUND_THEN_DONE = "In this voice the request says what is to be looked at and what is to be established from it, three or four things by name, and then what is to be done with what is found, as one instruction; it does not say what the look will show, because the speaker doesn't know.";
/** What a seat says with a request to go and see: what to look for there and what to note. */
const LOOKED_FOR = "In this voice the request says what the speaker will look for there and what is to be noted of it, three or four things by name (what state the place is in, whether anything is waiting or missing, who is there, how it compares with what was reported), all of it the speaker's own seeing.";
/** What a seat says with a request to change a routine: what stays in place while it changes. */
const STAYS = "In this voice the request says from when the change holds and what stays in place while it does, each thing by name in plain words (what is already under way, what has been agreed, what is already owed or paid).";

/**
 * Briefs for the refusals that have to be worded by someone (the label is fixed by how the brief is built, not by
 * anyone's judgement of the result):
 *  - needs_calculation: a payment from the gold programs with its amount taken out, to be asked for as something
 *    that would have to be worked out;
 *  - not_yours: an outcome that's another party's to decide, wanted as a fact rather than asked for;
 *  - unclear: something should be done about a subject, with nothing said of what;
 *  - not_an_act: something to be seen, read or checked (something a gold program names, or a register), and nothing
 *    to be brought about;
 *  - no_such_act: something plainly wanted that no function brings about, of two kinds in turn: a place a gold
 *    program names to be gone to and checked in person; a routine of the speaker's own office to be changed. (From
 *    the pilots' real requests: eval/pilot-cases.ts, GAPS. Until 0.11.0 a third kind was a standing payment to be
 *    held and resumed, which is a program now: `statement(hold=…)`.)
 *  - look_first: something that can't be written until something is found out, of three kinds in turn: a standing
 *    payment from the gold programs to be cancelled, held or stopped, named only by what it pays (from which account,
 *    to which, how much: its amount as its world writes it), with no id for the instruction; a record of another kind
 *    named only by describing it; a look and an act that depends on what the look finds.
 */
export function refusalBriefs(gold: Gold[], perLabel: number, seed = 1, o: { /** A wide part (0.13.0): beside the kinds above, `look_first` for any act on something on record whose id the speaker lacks (a ballot voted on, an agreement signed or given notice on, something withdrawn, held, released, passed on or settled: `ACTED_ON`), and `no_such_act` for attending something in person. */ wide?: boolean } = {}): RefusalBrief[] {
  const rand = sampler(seed);
  // (A wide part's own kinds draw from a generator of their own: the briefs of the other kinds are as they were.)
  const wrand = sampler(seed + 53);
  const wchoose = <T>(xs: T[]): T => xs[Math.floor(wrand() * xs.length)]!;
  const acted = !o.wide ? [] : gold.flatMap((g) => {
    if (g.program.includes("\n")) return [];
    const p = calls.parseProgram(g.program);
    if ("none" in p) return [];
    const c = p.lines[0]!.call;
    const hit = (ACTED_ON[c.fn] ?? []).find(([k]) => { const v = c.args[k]; return !!v && "id" in v; });
    return hit ? [{ g, c, arg: hit[0], what: hit[1] }] : [];
  });
  /** An act on something on record, with the id of that thing unknown to the speaker. */
  const describedAct = (): RefusalBrief | undefined => {
    if (!acted.length) return undefined;
    const { g, c, arg, what } = wchoose(acted);
    const id = (c.args[arg] as { id: string }).id;
    const { [arg]: _, ...rest } = c.args;
    const without = calls.programText({ lines: [{ call: { fn: c.fn, args: rest } }] });
    const others = mustAppear(calls.parseProgram(without)).filter((x) => x !== id);
    return { label: "look_first", mustCopy: others, mustNot: [id], source: g.source, gold: g.family ?? g.program,
      brief: `What is wanted is what this call does, to ${what}: ${g.program}\n(${bringsAbout(g.program).map((b) => b.trim()).join("; ")})\nBut the speaker has no reference for ${what}: its id (${id}) is NOT in the request, and no other id stands in its place. They name it only by describing it, with particulars of your own (what it is about, who made or sent it, roughly when), put something like "${wchoose(BY_DESCRIPTION)}", in your own words.${others.length ? ` Everything else the call has is said, each exactly as written: ${others.join(", ")}.` : ""} Say the act as a person would, never by the call's own names for its parts. It is not a request to be shown or to find anything, nor to write to or ask anyone: the speaker wants the thing done. Don't say that the reference is missing or ask for it to be found.`, seats: DESCRIBED_AT_LENGTH };
  };
  const choose = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const out: RefusalBrief[] = [];
  const payments = gold.filter((g) => /^money\(/.test(g.shape) && !g.program.includes("\n"));
  const parties = [...new Set(gold.flatMap((g) => Object.entries(g.names).map(([id, name]) => `${name} (${id})`)))];
  const standing = payments.filter((g) => /[(,]every[,)]/.test(g.shape));
  const places = [...new Set(gold.flatMap((g) => placesIn(calls.parseProgram(g.program))))].sort();
  /** No function does it: the three kinds in turn, each falling back on the routine (which needs nothing of the gold). */
  // (The ids a request names in the seats' voices are drawn by a generator of their own: what the briefs say otherwise is as it was.)
  const mrand = sampler(seed + 31);
  const naming = (n: number, avoid: string[], as: string, kinds?: string[]): { mention: string[]; say: string } => {
    const ms = mentions(mrand, n, avoid, kinds);
    return { mention: ms.map((m) => m.id), say: ` It also names these by id, ${as}, every one of them and written as given (the quotation marks here only set them off): ${listed(ms)}.` };
  };
  /** It needs something found out first: the three kinds in turn, the first falling back on the second (which needs nothing of the gold). */
  const lookFirst = (n: number): RefusalBrief => {
    // (A wide part: every fourth is an act of any kind on something on record whose id the speaker lacks.)
    const wide = o.wide && n % 4 === 3 ? describedAct() : undefined;
    if (wide) return wide;
    const i = o.wide ? n % 4 : n;
    if (i % 3 === 0 && standing.length) {
      const g = choose(standing);
      // What the request must carry: the accounts that say which payments are meant, and the amount as its world
      // writes it (what a request that has no id for the instruction describes it by).
      const p = calls.parseProgram(g.program) as { lines: calls.Line[] };
      const a = p.lines[0]!.call.args;
      const described = ["from", "to", "amount"].flatMap((k) => { const v = a[k]; return v && ("id" in v || "text" in v) ? ["id" in v ? v.id : v.text] : []; });
      return { label: "look_first", mustCopy: mustAppear(p).filter((x) => described.includes(x)), source: g.source, gold: g.family ?? g.program,
        brief: `A standing arrangement was set up some time ago by a request like this one, and keeps repeating: ${g.program}\nThe speaker wants it ${choose(DONE_TO_IT)}, and has no reference for the instruction itself: they name it only by what it pays (from which account, to whom, how much, written exactly as above, perhaps how often), put something like "${choose(BY_DESCRIPTION)}", in your own words. No id for the instruction appears, because the speaker doesn't know it. It is not a request to write to or ask anyone, nor to be shown anything: the speaker wants the thing done. Don't say that the reference is missing or ask for it to be found.`,
        ...withIds(DESCRIBED_AT_LENGTH, naming(2 + Math.floor(mrand() * 3), literals(p), "as the people and accounts concerned and things that are to be left as they are, none of them the instruction itself", ["an account", "a person", "a place"])) };
    }
    if (i % 3 !== 2) return { label: "look_first", mustCopy: [], source: "brief",
      brief: `The speaker wants something done to a record that they name only by describing it, with no id for it: ${choose(DESCRIBED)}. Put the naming something like "${choose(BY_DESCRIPTION)}", in your own words, with particulars of your own (which market, which supplier, since when). No id for that record appears anywhere in the request. It is not a request to write to or ask anyone, nor to be shown anything: the speaker wants the thing done.`, seats: DESCRIBED_AT_LENGTH };
    return { label: "look_first", mustCopy: [], source: "brief",
      brief: `The speaker wants something looked up or found out and then something done that depends on what is found, in one request: ${choose(LOOK_THEN)}. What is to be done can't be said in full until the look has been made (who, which, how much or whether at all is what the look is for), and the request leaves it that way. Give it particulars of your own. It is one instruction to whoever carries things out, not a letter to anyone else asking them to look.`, seats: FOUND_THEN_DONE };
  };
  const noSuchAct = (n: number): RefusalBrief => {
    // (A wide part: every third is something to be attended in person, which no function does either.)
    if (o.wide && n % 3 === 2 && places.length) {
      const place = wchoose(places);
      return { label: "no_such_act", mustCopy: [place], source: "brief",
        brief: `The speaker means to be at ${place} in person for something that happens there: ${wchoose(ATTENDED)}. They want it arranged that they attend: to be there themselves, for the whole of it. It is not a request to write to anyone, to vote on anything, to hand in a form or to be shown a record, and nobody else is sent in their place.`, seats: ATTENDS };
    }
    const i = o.wide ? n % 3 : n;
    if (i % 2 === 0 && places.length) {
      const place = choose(places);
      return { label: "no_such_act", mustCopy: [place], source: "brief",
        brief: `The speaker wants to go to ${place} in person, see for themselves how things stand there, and note what they find. It is not a request to read a record or a report, nor to ask or send anyone else: the speaker is to go and look.`, ...withIds(LOOKED_FOR, naming(3 + Math.floor(mrand() * 3), [place], "as the other places to be looked at on the same round and the records or people to be checked there", ["a place", "a record", "a person"])) };
    }
    return { label: "no_such_act", mustCopy: [], source: "brief",
      brief: `The speaker wants a routine of their own office or organisation changed, stopped or started from now on: ${choose(ROUTINES)}. It is something the office carries on by itself, without anyone asking each time. Nobody is addressed: no office, post or person is named as the one to be directed, told or asked (the speaker says "we", "our office", "this office", or says only what is to change), and no form is spoken of. It is not a request to write to anyone, to publish a rule or a notice, or to undo anything already done; it names no record, and it sets no task, place and frequency for staff to work to (that would be a roster, which is another thing).`, seats: STAYS };
  };
  // (Programs that pay one sum to several accounts, each share stated: `lateKinds` `split`. Where there are any, every
  // other needs_calculation brief divides a sum between accounts and states no share: an extra brief, so that a part
  // with none is as it was.)
  const splits = gold.filter((g) => g.tag === "split_payment" && g.program.includes("\n"));
  for (let i = 0; i < perLabel; i++) {
    if (splits.length && i % 2 === 0) {
      const g = wchoose(splits);
      const p = calls.parseProgram(g.program) as { lines: calls.Line[] };
      const without = calls.programText({ lines: p.lines.map((l) => { const { amount: _, ...rest } = l.call.args; return { call: { fn: "money" as const, args: rest } }; }) });
      out.push({ label: "needs_calculation", mustCopy: mustAppear(calls.parseProgram(without)), source: g.source, gold: g.family ?? g.program,
        brief: `Payments like these, one sum paid out to several accounts, but with no amount stated for any of them:\n${without}\nInstead of amounts, the request says how the sum is to be divided between them: ${wchoose(SPLIT_RULES)}. It must not contain any resulting figure, and it may not state the share of any one of them as a figure.` });
    }
    if (payments.length) {
      const g = choose(payments);
      const p = calls.parseProgram(g.program) as { lines: calls.Line[] };
      const { amount: _, ...rest } = p.lines[0]!.call.args;
      const without = calls.programText({ lines: [{ call: { fn: "money", args: rest } }] });
      out.push({ label: "needs_calculation", mustCopy: mustAppear(calls.parseProgram(without)), source: g.source, gold: g.family ?? g.program,
        brief: `A payment like this one, but with no amount stated: ${without}\nInstead of an amount, the request says what the amount should be worked out from: ${choose(WORKED_OUT)}. It must not contain the resulting figure.` });
    }
    {
      // (Whose decision: someone the gold programs name, or, with none named, someone only described.)
      const who = parties.length ? choose(parties) : choose(OTHERS);
      out.push({ label: "not_yours", mustCopy: [], source: "brief",
        brief: `The speaker wants ${who} to ${choose(THEIR_DECISIONS)}: something that is for them to decide. The speaker doesn't ask them: they tell whoever carries things out to bring it about (put something like "${choose(MAKE_THEM)}", in your own words). The wording is of making it so: making them, ensuring, seeing to it or making sure that they do it. Never "have them …" or "get them to …", and never asking, telling, directing or instructing them: each of those is a letter to them, which this is not. It is not a request to write to them, ask them, offer them anything or propose anything: it wants the outcome itself. Say what is wanted in particulars a person would give (which price, which vote, whom), and don't say that the matter is theirs to decide.` });
    }
    out.push({ label: "unclear", mustCopy: [], source: "brief",
      brief: `The speaker wants something done about ${choose(VAGUE)} and doesn't say what: no act, no amount, no one to write to. The vagueness is of this kind: ${choose(VAGUENESS)}. A sentence or two that could mean many different things. It doesn't ask to see or be told anything, and it doesn't begin "Something about".` });
    const named = gold.length ? mustAppear(calls.parseProgram(choose(gold).program)).filter((x) => ID.test(x)) : [];
    const subject = named.length && rand() < 0.75 ? choose(named) : undefined;
    const looked = mrand();
    out.push({ label: "not_an_act", mustCopy: subject ? [subject] : [], source: "brief", ...withIds(PARTICULARS, naming(looked < 0.6 ? 3 + Math.floor(mrand() * 3) : looked < 0.9 ? 6 + Math.floor(mrand() * 3) : 9 + Math.floor(mrand() * 2), subject ? [subject] : [], "as what is to be looked at or covered (the accounts whose entries are wanted, the records to be read, the people or places concerned)")),
      brief: `The speaker wants to see, read, check or be told something, and to bring nothing about: ${subject ? `${choose(LOOKS)} ${subject}` : choose(LOOKED_AT)}. Put it something like "${choose(LOOK_VERBS)}", in your own words (not "Show me", unless that is the way given). It is for the speaker's own eyes: not a request to ask or tell anyone else. Just ask to look, as a person does: don't add that nothing is to be changed, sent or recorded, or that nobody is to be contacted.` });
    out.push(noSuchAct(i));
    out.push(lookFirst(i));
  }
  return out;
}

/**
 * Briefs for `too_much` as a person makes it (the label is fixed by how the brief is built): two or three separate acts
 * about the same people or places, each a gold program of its own (synthetic.ts `piled` makes such groups), for a
 * writer to ask for in one natural message. Every id and quoted value of every one must be in the request.
 */
export function piledBriefs(groups: Gold[][], seed = 1): RefusalBrief[] {
  const mrand = sampler(seed + 37);
  return groups.filter((g) => g.length >= 2).map((g) => {
    // In the seats' voices: each act a sentence of its own (in sequence or numbered, as seats write several), then
    // sentences about the whole that name other things by id. So several acts come as long and as full of ids as one
    // act does, and what tells them apart is the acts.
    const ms = mentions(mrand, 1 + Math.floor(mrand() * 3), g.flatMap((x) => literals(calls.parseProgram(x.program))));
    const names = [...new Set(g.flatMap((x) => Object.entries(x.names).map(([id, name]) => `${id} is ${name}`)))];
    return {
      seats: `In this voice each act is a sentence of its own with its own particulars, in sequence or numbered as an office-holder does ("Take these actions in order: (1) … (2) …": whatever is said above of numbering and of how many sentences), and the sentences after them qualify the whole and ask for nothing more. Those name these other things by id, as things none of the acts touches, every one of them and written as given (the quotation marks here only set them off): ${listed(ms)}.`, mention: ms.map((m) => m.id),
      label: "too_much" as const, source: "piled", mustCopy: [...new Set(g.flatMap((x) => mustAppear(calls.parseProgram(x.program))))],
      brief: [
        `The speaker piles ${g.length === 2 ? "two" : "several"} separate things into one message, the way people do ("…, and while you're at it …", "… Also, …"). They concern the same people or places, but each is an act of its own and none depends on another. Each is given here as a call in a small formal language (function(argument=value, …); an id is a bare word; quoted text is copied text), with what it brings about:`,
        ...g.map((x, i) => `${i + 1}. ${x.program}\n   (${bringsAbout(x.program).map((b) => b.trim()).join("; ")})`),
        ...(names.length ? [`For your understanding only (still write the ids): ${names.join("; ")}.`] : []),
        "Ask for all of them in one natural request of two to four sentences. Say each as a person would, never by the call's function names or argument names, and never in the words given here for what it brings about; a bare word that names a kind of thing is used as that same word; no quotation marks round ids, names, amounts or numbers; don't number them, and don't say that they are separate.",
      ].join("\n"),
    };
  });
}

/** What the writer of a refusal is told. */
export function refusalWriterSystem(): string {
  return [
    "You write the requests that people in a town make of whoever carries things out for them: a mayor to an office, a business owner to a clerk, a resident to an agent. Each request is one to three sentences of plain language, unless the style asks for more.",
    "This time you're given a situation rather than a call, and a style. Write one request that fits the situation exactly.",
    "- Any id given in the situation (a bare word like acc-city or rec.412) and any quoted value must appear in your request exactly as written.",
    "- Don't explain the situation or comment on it, and don't borrow its wording for what kind of request this is: write only what the person would say, in the words a person would use.",
    "- Don't put quotation marks round an id, a name, an amount, a number or a length of time: quotation marks are for words quoted.",
    "- If the situation suggests a way of putting it, use it loosely, reworded to suit the style: it is there so that not every request begins the same way.",
    "Answer with the request only.",
  ].join("\n");
}

/**
 * The style a refusal brief is written in. The cited style asks for a record’s id: where the situation names no
 * record, a writer can only invent one (seen in the first set, 2026-10-06), so such a brief is written formally, as
 * a request that could take a citation and has none is (styleBrief).
 */
export const refusalStyle = (b: RefusalBrief, style: string): string => (style === "cited" && !/\b(rec\.\d+|law-[a-z][a-z-]*)\b/.test(b.brief) ? "formal" : style);

/** What a writer is sent for a refusal brief in a style, whoever the writer is. (The seats' voices are worded for a
 * situation: REFUSAL_STYLES; and in them a brief that has particulars of its own to ask for says so: `seats`. The
 * first part written came out with one-line requests to read and to pause, where a seat's run to several sentences.) */
export const refusalRequestBrief = (b: RefusalBrief, style: string): string => {
  const s = refusalStyle(b, style);
  return `Situation:\n${b.brief}${b.seats && SEATS.includes(s) ? `\n${b.seats}` : ""}\n\nStyle: ${REFUSAL_STYLES[s] ?? STYLES[s] ?? REGISTERS[s]?.replaceAll("the call", "the situation") ?? OWN[s] ?? s}`;
};

/** A request for a refusal brief, from a model. */
export async function writeRefusal(adapter: LlmAdapter, b: RefusalBrief, style: string, usage?: (u: Usage) => void): Promise<string | undefined> {
  return ask(adapter, refusalWriterSystem(), refusalRequestBrief(b, style), usage);
}

/** A request that wasn't kept, and why: for looking at what the writers and the round trip get wrong. `checked_by`:
 * the model whose translation back (`got`) wasn't the program. */
export interface Reject {
  request: string; program: string;
  /** `marks`: a letter asked for indirectly whose marks can't be used, or marks where none were asked for (`marks`
   * says which: the request is as it was handed in, marks and all). `stray_id`: a request in a seat's voice naming an
   * id its program doesn't have (`strayIds`). */
  why: "not_copied" | "round_trip" | "marks" | "stray_id" | Unnatural;
  marks?: Marks; got?: string; written_by: string; checked_by?: string; style: string;
}

export interface Manifest {
  version: string;
  examples: number;
  by_kind: { [k: string]: number };
  by_shape: { [shape: string]: number };
  writers: { [model: string]: number };
  /** Who checked whose requests: "writer -> checker", for the examples kept. */
  checked: { [pair: string]: number };
  /** Examples whose checker was the model that wrote them (no other was given): the weaker check. */
  checked_by_writer: number;
  /** By the first function of the program each example is for, by where its gold program came from, and by style. */
  by_function: { [fn: string]: number };
  by_origin: { [origin: string]: number };
  by_style: { [style: string]: number };
  /** By the currency of the world each example is from (its code; an example of no known world is not counted). */
  by_currency?: { [code: string]: number };
  /** By who the writer was told is asking, in a wide part (`ASKERS`; built refusals have nobody). */
  by_asker?: { [asker: string]: number };
  /** Requests carrying something that adds nothing to their program, by kind (capacity, citation, do_not). */
  riders: { [kind: string]: number };
  /** Spans whose value is in the request more than once, with nothing to settle which is meant (each records them all). */
  ambiguous_spans: number;
  /** Spans by how the value comes from the request: copied, chosen for its words, or implied (`Span.how`). */
  spans: { copy: number; choice: number; implied: number };
  /** Letters asked for indirectly, their text the words the writer marked (`Example.indirect`). */
  indirect: number;
  /** Requests for two acts that are one thing (`Example.pair`), by kind. */
  pairs: { [pair: string]: number };
  /** How long the requests are, by style, in characters: how many, the median and the ninth decile. (The seats'
   * voices are long by design, 300 characters and more: this is where to see whether the writers made them so.) */
  request_length: { [style: string]: { requests: number; median: number; p90: number } };
  /** The least asked for of each refusal label, and the labels that came out short of it (with how many there are). */
  refusal_floor?: number;
  short_of_floor?: { [label: string]: number };
  /** Requests dropped, by reason: a value not copied; reading as the call and not as a person (`Unnatural`: quotes,
   * variable_named, argument_named, zero_wait); not translated back to the program; said before; a failed call;
   * wording shared with a held-out case; marks that can't be used; an id the program doesn't have. */
  dropped: { not_copied: number; round_trip: number; duplicate: number; failed: number; shares_held_out_wording: number; marks: number; stray_id: number } & { [why in Unnatural]: number };
  /** Why writing stopped before every program had its requests, if it did (a spending or usage limit, a model out of
   * reach): what was written until then is kept. */
  stopped?: string;
  usage: { [model: string]: Usage };
  /** Where the requests were handed in as files (`fromWritten`): how many planned items had none, and the rest of the count. */
  no_request?: number;
  from_files?: FromFiles;
  /** SHA-256 of the examples file: recorded with any model trained on it (§16.4). */
  sha256: string;
}

/** A model that translates a request back to a program, through the real translator. `forms`: what the translator is
 * to be shown with the request, as lines; `gold`: the program it was written for (its world's money and its forms as
 * data), absent for a refusal. */
export interface Back { model: string; translate: (request: string, forms: string[], gold?: Gold) => Promise<string | undefined> }

/**
 * Who checks a writer's requests: the first of the checkers that is a different model from the writer (the same model
 * reached another way is the same model). A model checking its own writing keeps what it parrots and rejects what
 * another would say naturally (the audit of 2026-10-06), so with a checker among the writers a second checker takes
 * that model's requests. `own`: no other was given, and the writer's own model checks (kept, and counted as that).
 */
export function checkerFor(writer: string, backs: Back[]): { back: Back; own: boolean } | undefined {
  const name = (m: string) => m.slice(m.lastIndexOf("/") + 1);
  const other = backs.find((b) => name(b.model) !== name(writer));
  return other ? { back: other, own: false } : backs[0] ? { back: backs[0], own: true } : undefined;
}

/** Sentences of a request that begin "Do not" (or "Don't", or "This does not"), outside the stretches already taken. */
function doNots(request: string, taken: [number, number][]): { text: string; at: [number, number] }[] {
  const out: { text: string; at: [number, number] }[] = [];
  const re = /(?:^|(?<=[.!?]["”)]?\s))(?:Do not|Don't|This does not)\b(?:[^.!?]|\.(?=[A-Za-z0-9]))*[.!?]/g; // (a full stop inside an id, rec.412, ends no sentence)
  for (let m = re.exec(request); m; m = re.exec(request)) {
    const at: [number, number] = [m.index, m.index + m[0].length];
    if (!taken.some((t) => t[0] < at[1] && at[0] < t[1])) out.push({ text: m[0], at });
  }
  return out;
}

/** One thing a writer is asked for: a request for a gold program (`request`), or one that fits a situation and is to
 * be refused (`refusal`). `brief`: exactly what the writer is sent, a model or one working from a file. `writer`: who
 * is asked. A refusal's `round`: 0, or a later one, asked for only where its label came out short of the floor. */
interface Asked { id: string; writer: string; style: string; brief: string; /** Who the writer was told is asking (a wide part: `ASKERS`). */ asker?: string }
export type PlanItem =
  | (Asked & { kind: "request"; /** The program, with its world's money and forms. */ gold: Gold; riders: Rider[]; /** The way of saying it chosen for this request (`writerNotes`). */ notes: string[]; /** A letter to be asked for indirectly: the request comes back with the words asked of them marked, and they are the example's text (`marked`). */ indirect?: true; /** Ids such a letter was given to name inside its marked words. */ inside?: string[]; /** Two acts in one request (`pairOf`): `gold` is the program of two lines. */ pair?: Pair })
  | (Asked & { kind: "refusal"; /** Its label, and what the request must carry. */ refusal: RefusalBrief; round: number });

export interface PlanOptions {
  /** Who writes, by name, taken in turn (item k is writer k mod n's), each asked for the styles in turn. */
  writers: string[];
  styles?: string[];
  perGold?: number;
  /** Written refusals asked for, per label that has a brief (`refusalBriefs`); none if absent. */
  refusalsPerLabel?: number;
  /** At least so many refusals of every label a translator writes (`calls.TRANSLATOR_LABELS`, whatever they are; never `ambiguous`, the resolver's): briefs for
   * the written ones, two more rounds of them for a label that came out short, and the built ones as far as the
   * examples allow. What still came out short is in the manifest. */
  refusalFloor?: number;
  /** Groups of related, separate acts for a writer to ask for in one message (`piledBriefs`): `too_much` as people make it. */
  piled?: Gold[][];
  /** The share of the letters (`isLetter`) asked for indirectly, "Direct them to …", the writer inventing and marking
   * what is asked of them (none if absent). */
  indirect?: number;
  /** Requests are planned only for the gold programs whose first call is one of these functions (all, if absent; a
   * name no function has, as `none`, plans none). The refusal briefs are made from every gold program given, whatever
   * this says: they need the payments, parties and places of the whole. */
  only?: string[];
  /** Refusal briefs are planned for these labels only, and only these are built and held to the floor (all, if absent). */
  refusalLabels?: string[];
  /** The share of the programs that can be (a form filled in, something withdrawn) asked for with a second act in the
   * same request: a direction to someone about it, or a second withdrawal (`pairOf`; none if absent). */
  pairs?: number;
  /** Requests are planned for those pairs only. */
  pairsOnly?: boolean;
  /** A wide part (0.13.0): each brief says who is asking (`askerFor`: an office-holder in an office-holder's style,
   * otherwise one of those who would honestly ask for such an act), and the refusal briefs have the wide kinds
   * (`refusalBriefs`). With `styles: BROAD_DEAL` the registers are dealt too. Absent: the plan is what it was. */
  broad?: boolean;
  /** A wide part weighted toward some askers (0.14.0): the share of the requests, of those not in an office-holder's
   * style and not of a program that says who asks, that each of these askers makes (`ASKERS`; `{ banker: 0.4 }`),
   * whatever the act: the part's `only` is what keeps it to acts such an asker would honestly ask for. The rest are
   * drawn as ever. Absent: who asks is who it was. */
  askers?: { [asker: string]: number };
  seed?: number;
}

/**
 * Who is asked for what, in which style and in which order: settled before anything is written, from the gold programs
 * and the seed alone, so the same gold, options and seed give the same plan whoever then writes (models through
 * adapters: `generate`; or writers handed the briefs as a file: `fromWritten`).
 * Each request is asked for with how often its program recurs said one of the ways people say it, and with a way of
 * saying its act, both chosen by seed (`withHowOften`, `writerNotes`): several requests for one program are asked for
 * in different words, and the program's `every` is the span the writer was told to use.
 * With a floor under the refusals, the briefs of the two later rounds are planned too (new ones, by other seeds); a
 * later round's brief is used only while its label is short.
 * The styles are dealt in turn, to requests and refusals alike: half in the seats' voices, where the caller names none
 * (`DEAL`). Which letters are asked for indirectly is settled here too, by seed (`indirect`).
 */
/** What becomes of a form once handed in, said with nobody named: a sentence of many makes, so that it is the
 * saying of it and no one sentence that a model meets. No place's bodies: a council, a board, a committee, members. */
const GOES = ["It then goes to", "Put it to", "It is to go to", "It should then be put to", "This is for", "From there it goes to", "It is then a matter for", "Let it go on to"];
const GOES_TO = ["the councillors' ballot", "the council's 14-day ballot", "a vote at the next meeting", "the board for decision", "the committee's next sitting", "the members' ballot", "the next full meeting for a decision", "the usual 21-day ballot", "the panel that decides such things", "a ballot of the members over 7 days"];
function whatNext(rand: () => number): Rider {
  return { kind: "what_next", text: `${GOES[Math.floor(rand() * GOES.length)]} ${GOES_TO[Math.floor(rand() * GOES_TO.length)]}.` };
}

export function planOf(gold: Gold[], o: PlanOptions): PlanItem[] {
  const styles = o.styles ?? DEAL;
  const seed = o.seed ?? 1;
  const styleRand = sampler(seed + 11);
  const sayRand = sampler(seed + 17);
  const indirectRand = sampler(seed + 19);
  const pairRand = sampler(seed + 41);
  const askRand = sampler(seed + 43);
  const plan: PlanItem[] = [];
  let turn = 0;
  const next = () => ({ writer: o.writers[turn % o.writers.length]!, styleKey: styles[turn % styles.length]!, n: turn++ });
  const idOf = (n: number, brief: string) => sha256(canonicalJson({ seed, n, brief })).slice(0, 12);
  const labelled = (b: RefusalBrief) => !o.refusalLabels || o.refusalLabels.includes(b.label);
  for (const given of gold) for (let k = 0; k < (o.perGold ?? 3) && inOnly(given, o.only); k++) {
    const one = withHowOften(given, sayRand);
    // Two acts in one request, for a share of the programs that can carry a second (`pairOf`): the act as it is, and
    // a direction to someone about it (a letter asked for indirectly, its words the writer's) or a second withdrawal.
    let two = (o.pairs ?? 0) > 0 && pairRand() < o.pairs! ? pairOf(one, pairRand) : undefined;
    // The other side of that line, for a fifth of the forms that would have had a direction (a quarter as many as
    // those that do): the form alone, closing with what becomes of it and nobody named, which is ONE line by the
    // translator's rules ("adds no line, unless the request asks for someone it names to be told"). Without these a
    // model learns that any closing sentence about what happens next is a letter.
    // (An office's own form, where the program fills one in: `ownForm`. What becomes of a paper of one's own office
    // is not for anyone to take in and decide.)
    const office = ownForm(one.program, one.forms ?? []);
    const after = two?.pair === "form+message" && !office && pairRand() < 0.2 ? whatNext(pairRand) : undefined;
    if (after) two = undefined;
    if (o.pairsOnly && !two && !after) continue;
    const { writer, styleKey, n } = next();
    const g = two?.gold ?? one;
    // (A direction to an office with no form for it listed is always asked for as seats direct: indirectly.)
    const unlisted = g.tag === "direction_unlisted" && isLetter(g.program);
    const indirect = two ? two.letter !== undefined : unlisted || ((o.indirect ?? 0) > 0 && isLetter(g.program) && indirectRand() < o.indirect!);
    // (A pair's further sentences are about its act, as any act's are: the direction comes last, after them.)
    const styled = styleBrief(styleKey, g, styleRand, { indirect: indirect && !two });
    const { style, inside } = styled;
    // (What a form's amounts come to, a third of the time: after the last of them, a sentence that is no field's.)
    const total = (!indirect || two) && !office ? (sayRand() < 0.35 ? amountTotal(one, sayRand) : undefined) : undefined;
    const riders = [...styled.riders, ...(total ? [total.rider] : []), ...(after ? [after] : [])];
    const asker = o.broad ? askerFor(style, g, askRand, o.askers) : undefined;
    const instruction = (after ? `${styled.instruction} Whatever else the style asks, the request's last sentence is exactly this one, which says what becomes of the form once it is handed in, names nobody and asks nobody for anything: "${after.text}"` : styled.instruction) + (asker ? `\n\n${askerLine(asker)}` : "");
    const notes = two?.letter ? [...(office ? ownFormNotes(one, office, sayRand) : [...writerNotes(one.program, sayRand), ...amountNotes(one, sayRand)]), ...indirectNotes(two.letter, sayRand).map((x) => x.replace("The act, said", "The direction, said"))]
      : unlisted ? indirectNotes(g.program, sayRand, ["direct {to} to …", "direct {to} to …", "instruct {to} to …", "tell {to} to …"]) // (not "{to} is to …", since 0.13.2: it addresses nobody, and was read as an order for work)
      : indirect ? indirectNotes(g.program, sayRand)
      // (An office's own form is asked for as the direction or the paper it is, not as a form handed in.)
      : office ? ownFormNotes(g, office, sayRand) : [...writerNotes(g.program, sayRand), ...amountNotes(g, sayRand)];
    if (total) notes.push(total.note);
    if (!two) notes.push(...(g.notes ?? []));
    const brief = requestBrief(g, instruction, notes, { indirect, ...(two ? { pair: two.pair } : {}) });
    plan.push({ id: idOf(n, brief), kind: "request", writer, style, brief, gold: g, riders, notes, ...(indirect ? { indirect: true as const } : {}), ...(inside ? { inside } : {}), ...(two ? { pair: two.pair } : {}), ...(asker ? { asker } : {}) });
  }
  const perLabel = Math.max(o.refusalsPerLabel ?? 0, o.refusalFloor ?? 0);
  for (let round = 0; round < (o.refusalFloor ? 3 : 1); round++) {
    const briefs = round === 0 ? [...(perLabel ? refusalBriefs(gold, perLabel, seed, { wide: !!o.broad }) : []), ...piledBriefs(o.piled ?? [], seed)] : refusalBriefs(gold, perLabel, seed + round * 7919, { wide: !!o.broad });
    // (Some labels only: their briefs come label by label in turn, and so do the styles and the writers, so with two
    // labels one would get every seat's voice and the other none, and with two writers each would get one label. They
    // are dealt in a seeded order instead. So are they with every label asked for, since 0.11.0: the briefs worded by
    // someone are of six labels now, an even number as the styles' turn is (a seat's voice every second), so label by
    // label three of them would get every seat's voice and three none.)
    for (const b of shuffled(briefs.filter(labelled), sampler(seed + 29 + round))) {
      const { writer, styleKey, n } = next();
      // (In a seat's voice the request is to carry the ids it was given to name, with what it must carry anyway.)
      const style = refusalStyle(b, styleKey);
      // (A wide part: anyone may ask for what is to be refused; an office-holder's style is an office-holder's.)
      const askers = Object.keys(ASKERS);
      const asker = !o.broad ? undefined : OFFICIAL.has(style) ? (askRand(), "officer") : askers[Math.floor(askRand() * askers.length)]!;
      const brief = refusalRequestBrief(b, styleKey) + (asker ? `\n\n${askerLine(asker)}` : "");
      plan.push({ id: idOf(n, brief), kind: "refusal", writer, style, brief, ...(asker ? { asker } : {}), refusal: SEATS.includes(style) && b.mention?.length ? { ...b, mustCopy: [...b.mustCopy, ...b.mention] } : b, round });
    }
  }
  return plan;
}

/** What came back for a planned item: the request, and who wrote it. */
export interface Written { request: string; by: string }

/**
 * A plan carried out: each item's request fetched (`write`: from a model, or looked up in what a writer handed in),
 * checked, and kept if it holds up. The one path for both ways of writing, so the checks and the examples are the same.
 * The requests for programs are fetched several at a time (`concurrency`: a model call is nearly all waiting) and gone
 * through in the plan's order, so the result doesn't depend on which came back first; the refusals one after another,
 * a later round's only while its label is short.
 */
async function fromPlan(plan: PlanItem[], o: {
  write: (item: PlanItem) => Promise<Written | undefined>;
  refusalsPerLabel?: number;
  refusalFloor?: number;
  refusalLabels?: string[];
  backs?: Back[];
  heldOut?: Case[];
  seed?: number;
  concurrency?: number;
  log?: (s: string) => void;
  usage?: { [model: string]: Usage };
}): Promise<{ examples: Example[]; manifest: Manifest; rejects: Reject[]; /** Items that were wanted and had no request. */ unwritten: number }> {
  const backs = o.backs ?? [];
  const dropped: Manifest["dropped"] = { not_copied: 0, round_trip: 0, duplicate: 0, failed: 0, shares_held_out_wording: 0, marks: 0, stray_id: 0, quotes: 0, variable_named: 0, argument_named: 0, zero_wait: 0, place_reversed: 0, description_echoed: 0 };
  const rejects: Reject[] = [];
  // A limit reached, or a model out of reach, ends the writing with what there is; any other failed call loses one request.
  let stopped: string | undefined;
  let unwritten = 0;
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
  const requests = plan.filter((t): t is Extract<PlanItem, { kind: "request" }> => t.kind === "request");
  /** (`program`, `said`: a letter asked for indirectly, with the words its writer marked as its text, and where they are.) */
  type Came = { request?: string; by?: string; check?: ReturnType<typeof checkerFor>; why?: Reject["why"]; marks?: Marks; program?: string; said?: [number, number]; got?: string; backFailed?: boolean };
  const came: Came[] = new Array(requests.length);
  const formsOf = (g: Gold) => (g.forms ?? []).map(formLine);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 1) }, async () => {
    while (next < requests.length && !stopped) {
      const n = next++;
      const t = requests[n]!;
      const w = await attempt(() => o.write(t));
      const out: Came = (came[n] = w ? { ...w, check: checkerFor(w.by, backs) } : {});
      if (w) {
        // A letter asked for indirectly: the marks come off, and the words between them are the program's text from
        // here on (`marked`). Any other request has no business with the marks.
        const m = t.indirect ? marked(w.request) : undefined;
        const said = m && !("marks" in m) ? m : undefined;
        const request = said?.request ?? w.request;
        const program = said ? withText(t.gold.program, said.words) : t.gold.program;
        if (said) Object.assign(out, { request, program, said: said.at });
        // What the program takes from the request is looked for outside its riders, and each rider must be there as
        // given; then how it reads (badlyWritten), and, in a seat's voice, that its further sentences name nothing
        // the program doesn't have (strayIds); only then is a model asked.
        if (m && "marks" in m) (out.why = "marks"), (out.marks = m.marks);
        else if (!t.indirect && (request.includes(OPEN) || request.includes(CLOSE))) (out.why = "marks"), (out.marks = "unasked");
        else if (!(t.riders.every((r) => request.includes(r.text)) && (t.inside ?? []).every((id) => said?.words.includes(id)) && copies(withoutRiders(request, t.riders), program, t.gold.forms ?? []))) out.why = "not_copied";
        // (A form's amount said only inside its long text is under no label: nothing says which field it is.)
        else if (onlyInsideAnother(withoutRiders(request, t.riders), program, t.gold.forms ?? [])) out.why = "not_copied";
        // (Nor is an amount two fields share, unless the request says it for each straight after that field's label.)
        else if (!sharedAmountsPlaced(withoutRiders(request, t.riders), program, t.gold.forms ?? [])) out.why = "not_copied";
        else out.why = badlyWritten(request, program, t.riders) ?? ((SEATS.includes(t.style) || t.style in REGISTERS || t.style in OWN) && strayIds(request, program, { riders: t.riders, ...(t.gold.forms ? { forms: t.gold.forms } : {}) }).length ? "stray_id" : undefined);
        if (!out.why && out.check) {
          const failed = dropped.failed;
          const got = await attempt(() => out.check!.back.translate(request, formsOf(t.gold), said ? { ...t.gold, program } : t.gold));
          if (got === undefined && (stopped || dropped.failed > failed)) out.backFailed = true;
          else if (got !== undefined) out.got = got;
        }
      }
      if (o.log && ++done % 50 === 0) o.log(`${done}/${requests.length} requests written and checked`);
    }
  }));
  for (const [n, t] of requests.entries()) {
    const c = came[n];
    if (!c?.request) {
      unwritten++;
      continue;
    }
    const { gold: g, style, riders } = t;
    const forms = formsOf(g);
    const { request, check } = c;
    const model = c.by!;
    // (A letter asked for indirectly is the program with the words its writer marked; the gold program is still the
    // one it was planned from, and what a split keeps it with.)
    const program = c.program ?? g.program;
    if (c.why) {
      dropped[c.why]++;
      rejects.push({ request, program, why: c.why, ...(c.marks ? { marks: c.marks } : {}), written_by: model, style });
      continue;
    }
    const key = request.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) {
      dropped.duplicate++;
      continue;
    }
    seen.add(key);
    if (check) {
      if (c.backFailed) continue;
      if (c.got === undefined || !sameProgram(c.got, program, { ...(g.currency ? { currency: g.currency } : {}), ...(g.forms ? { forms: g.forms } : {}) })) {
        dropped.round_trip++;
        rejects.push({ request, program, why: "round_trip", ...(c.got !== undefined ? { got: c.got } : {}), written_by: model, checked_by: check.back.model, style });
        continue;
      }
    }
    // (The words a writer marked are where it marked them, whatever else in the request reads the same.)
    const spans = spansIn(withoutRiders(request, riders), program, g.forms ?? []).map((x): Span => (c.said && x.arg === "text" && (x.line === undefined || x.line === letterLine(program)) ? { arg: x.arg, value: x.value, how: "copy", ...(x.line !== undefined ? { line: x.line } : {}), at: c.said } : x));
    // (Each rider where it stands; an id mentioned, at every place it stands.)
    const given = riders.flatMap((r) => (r.kind === "mention" ? occurrences(request, { value: r.text, arg: "", exact: true, how: "copy" }) : [[request.indexOf(r.text), request.indexOf(r.text) + r.text.length] as [number, number]]).map((at) => ({ ...r, at, adds: "nothing" as const })));
    // A "Do not …" the writer added of its own accord rules out what wasn't asked for, like one it was given (the
    // program came back the same with it there): recorded as a rider too.
    const more = doNots(request, [...spans.flatMap((x) => x.all ?? (x.at ? [x.at] : [])), ...given.filter((r) => r.kind !== "mention").map((r) => r.at)]).map((r) => ({ kind: "do_not" as const, ...r, adds: "nothing" as const }));
    const all = [...given, ...more].sort((x, y) => x.at[0] - y.at[0]);
    positives.push({
      id: exampleId(request, program), request, forms, program, kind: "positive", shape: g.shape, style, spans, written_by: model,
      ...(check ? { verified_by: check.back.model, ...(check.own ? { verified_by_writer: true as const } : {}) } : {}),
      source: g.source, ...(g.origin ? { origin: g.origin } : {}), gold: g.family ?? g.program,
      ...(g.currency ? { currency: g.currency } : {}),
      ...(all.length ? { riders: all } : {}),
      ...(c.said ? { indirect: true as const } : {}),
      ...(t.pair ? { pair: t.pair } : {}),
      ...(t.asker ? { asker: t.asker } : {}),
    });
  }
  // Refusals that have to be worded: each brief's request kept if it carries what it must and (with a checker) comes
  // back refused with the same label. With a floor, a label that came out short has the later rounds' briefs (new
  // ones, twice at most): whichever labels `refusalBriefs` has briefs for, nothing here names them.
  const written: Example[] = [];
  const have: { [label: string]: number } = {};
  const perLabel = Math.max(o.refusalsPerLabel ?? 0, o.refusalFloor ?? 0);
  for (const t of plan) {
    if (stopped) break;
    if (t.kind !== "refusal") continue;
    const b = t.refusal;
    if (t.round > 0 && (have[b.label] ?? 0) >= perLabel) continue;
    const w = await attempt(() => o.write(t));
    if (!w) {
      unwritten++;
      continue;
    }
    const { request, by: model } = w;
    const style = t.style;
    const program = `none(${b.label})`;
    const why: Reject["why"] | undefined = !b.mustCopy.every((l) => request.includes(l)) || (b.mustNot ?? []).some((l) => occurrences(request, { value: l, arg: "", exact: true, how: "copy" }).length > 0) ? "not_copied" : !quotesBalanced(request) && !b.mustCopy.some((l) => /["“”]/.test(l)) ? "quotes" : undefined;
    if (why) {
      dropped[why]++;
      rejects.push({ request, program, why, written_by: model, style });
      continue;
    }
    const key = request.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) {
      dropped.duplicate++;
      continue;
    }
    seen.add(key);
    const check = checkerFor(model, backs);
    if (check) {
      const failed = dropped.failed;
      const got = await attempt(() => check.back.translate(request, []));
      if (stopped || dropped.failed > failed) continue;
      if (got === undefined || !sameProgram(got, program)) {
        dropped.round_trip++;
        rejects.push({ request, program, why: "round_trip", ...(got !== undefined ? { got } : {}), written_by: model, checked_by: check.back.model, style });
        continue;
      }
    }
    have[b.label] = (have[b.label] ?? 0) + 1;
    written.push({ id: exampleId(request, program), request, forms: [], program, kind: "refusal", shape: program, style, written_by: model, ...(check ? { verified_by: check.back.model, ...(check.own ? { verified_by_writer: true as const } : {}) } : {}), source: `written: ${b.source}`, ...(b.gold ? { gold: b.gold } : {}), ...(t.asker ? { asker: t.asker } : {}) });
  }
  // Nothing that shares wording with a held-out case is kept: each such request is dropped (and counted), so the
  // test stays a test of requests the model hasn't seen the like of.
  const shares = o.heldOut?.length ? sharesWording(o.heldOut) : () => false;
  const clean = (e: Example) => !shares(e.request) || (dropped.shares_held_out_wording++, false);
  const kept = positives.filter(clean);
  // The floor under each label the built refusals can make: what the written ones left short of it.
  // (Where only some labels were asked for, only those are built and held to the floor.)
  const labels_ = calls.TRANSLATOR_LABELS.filter((l) => !o.refusalLabels || o.refusalLabels.includes(l));
  const floors = o.refusalFloor ? Object.fromEntries(labels_.map((l) => [l, Math.max(0, o.refusalFloor! - (have[l] ?? 0))])) : {};
  const examples = [...kept, ...written.filter(clean), ...builtRefusals(kept, o.seed ?? 1, 0.05, floors).filter((e) => (labels_ as string[]).includes(e.program.slice(5, -1))).filter(clean)];
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
  const short = o.refusalFloor ? Object.fromEntries(labels_.filter((l) => (labels[l] ?? 0) < o.refusalFloor!).map((l) => [l, labels[l] ?? 0])) : {};
  const spanCount = (how: Span["how"]) => examples.reduce((n, e) => n + (e.spans ?? []).filter((x) => x.how === how).length, 0);
  const manifest: Manifest = {
    version: DATA_VERSION, examples: examples.length, by_kind: count((e) => e.kind), by_shape: count((e) => e.shape), by_function: count((e) => functionOf(e)), by_origin: count((e) => e.origin ?? (e.kind === "refusal" ? "refusal" : "unknown")), by_style: count((e) => e.style), by_currency: count((e) => e.currency?.code), ...(examples.some((e) => e.asker) ? { by_asker: count((e) => e.asker) } : {}),
    riders, ambiguous_spans: examples.reduce((n, e) => n + (e.spans ?? []).filter((x) => x.ambiguous).length, 0),
    spans: { copy: spanCount("copy"), choice: spanCount("choice"), implied: spanCount("implied") },
    indirect: examples.filter((e) => e.indirect).length,
    pairs: count((e) => e.pair),
    request_length: Object.fromEntries(Object.keys(count((e) => e.style)).map((style) => {
      const lengths = examples.filter((e) => e.style === style).map((e) => e.request.length).sort((a, b) => a - b);
      return [style, { requests: lengths.length, median: lengths[Math.floor((lengths.length - 1) / 2)]!, p90: lengths[Math.floor((lengths.length - 1) * 0.9)]! }];
    })),
    ...(o.refusalFloor ? { refusal_floor: o.refusalFloor, short_of_floor: short } : {}),
    writers: count((e) => e.written_by), checked: count((e) => (e.verified_by ? `${e.written_by} -> ${e.verified_by}` : undefined)), checked_by_writer: examples.filter((e) => e.verified_by_writer).length,
    dropped, ...(stopped ? { stopped } : {}), usage: o.usage ?? {},
    sha256: sha256(examples.map((e) => canonicalJson(e)).join("\n")),
  };
  return { examples, manifest, rejects, unwritten };
}

/**
 * Write requests for the gold programs and keep the ones that hold up.
 * `writers`: the models that write requests, taken in turn, each asked for the styles in turn (`planOf`).
 * `backs` (or one, `back`): the models that translate a request back to a program through the real translator. Each
 * request is checked by one that didn't write it (`checkerFor`), and the example says which; with none, examples are
 * kept unverified and marked so.
 * `heldOut`: the held-out cases, if this machine has them: a request sharing wording with one is dropped.
 */
export async function generate(gold: Gold[], o: Omit<PlanOptions, "writers"> & {
  writers: LlmAdapter[];
  back?: Back;
  backs?: Back[];
  heldOut?: Case[];
  /** How many requests are written and translated back at a time (1 if absent). */
  concurrency?: number;
  log?: (s: string) => void;
}): Promise<{ examples: Example[]; manifest: Manifest; rejects: Reject[] }> {
  const usage: { [model: string]: Usage } = {};
  const add = (model: string) => (u: Usage) => {
    const t = (usage[model] ??= { input_tokens: 0, output_tokens: 0 });
    t.input_tokens += u.input_tokens + (u.cache_read_tokens ?? 0);
    t.output_tokens += u.output_tokens;
  };
  const names = o.writers.map((w) => `${w.provider}/${w.model}`);
  const adapters = new Map(names.map((name, i) => [name, o.writers[i]!]));
  const { writers: _, back, backs, ...rest } = o;
  const { examples, manifest, rejects } = await fromPlan(planOf(gold, { ...rest, writers: names }), {
    ...rest, backs: [...(backs ?? []), ...(back ? [back] : [])], usage,
    write: async (t) => {
      const request = await ask(adapters.get(t.writer)!, t.kind === "request" ? writerSystem() : refusalWriterSystem(), t.brief, add(t.writer));
      return request ? { request, by: t.writer } : undefined;
    },
  });
  return { examples, manifest, rejects };
}

/** A writer's request for a planned item, as a line of the file it hands in. */
export interface WrittenRequest { id: string; request: string }

/** What was handed in against a plan, beside what the manifest says of the examples. */
export interface FromFiles {
  /** Requests handed in, per writer (each id's first only). */
  requests: { [writer: string]: number };
  /** Planned items that were wanted and had no request (a later round's refusal counts only where its label was short). */
  no_request: number;
  /** Requests for an id that already had one (the first is kept; counted under `dropped.duplicate` too). */
  duplicate_ids: number;
  /** Requests whose id is no planned item's. */
  unknown_ids: number;
  /** Later rounds' refusals that were written and not wanted: their labels had their floor. */
  spares_not_needed: number;
}

/**
 * Requests written to a plan's briefs by writers who work on files (`planOf`; a line of `{id, request}` each), made
 * into examples: every mechanical check a model's request gets (what must be copied and where, the riders, how it
 * reads, said before, wording shared with a held-out case), the same examples for the same requests (`written_by`:
 * the writer who handed the request in), and the built refusals. No model translates them back here: that is the
 * blind check's work (blind.ts). Several writers' files may each cover part of the plan; an id written twice keeps
 * the first.
 */
export async function fromWritten(plan: PlanItem[], files: { writer: string; requests: WrittenRequest[] }[], o: { refusalsPerLabel?: number; refusalFloor?: number; refusalLabels?: string[]; heldOut?: Case[]; seed?: number } = {}): Promise<{ examples: Example[]; manifest: Manifest; rejects: Reject[] }> {
  const ids = new Set(plan.map((t) => t.id));
  const given = new Map<string, Written>();
  const from: FromFiles = { requests: {}, no_request: 0, duplicate_ids: 0, unknown_ids: 0, spares_not_needed: 0 };
  for (const f of files) {
    from.requests[f.writer] ??= 0;
    for (const r of f.requests) {
      const request = r && typeof r.id === "string" && typeof r.request === "string" ? asRequest(r.request) : undefined;
      if (!request) continue;
      if (!ids.has(r.id)) from.unknown_ids++;
      else if (given.has(r.id)) from.duplicate_ids++;
      else (given.set(r.id, { request, by: f.writer }), from.requests[f.writer]!++);
    }
  }
  const wanted = new Set<string>();
  const { examples, manifest, rejects, unwritten } = await fromPlan(plan, { ...o, write: async (t) => (wanted.add(t.id), given.get(t.id)) });
  from.no_request = unwritten;
  from.spares_not_needed = [...given.keys()].filter((id) => !wanted.has(id)).length;
  manifest.dropped.duplicate += from.duplicate_ids;
  return { examples, manifest: { ...manifest, no_request: unwritten, from_files: from }, rejects };
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
 * (builtRefusals: requests run together) are built again on each side from that side's own, so none straddles the
 * two. A refusal built from one positive (the same request with its form left out of what's known) is that positive's
 * twin and goes where it goes, by the gold program both carry (the second audit, 2026-10-06: until then these too
 * were built anew on each side, so the ones in the data were not the ones in the split).
 */
export function split(examples: Example[], o: { validation?: number; seed?: number } = {}): Split {
  const share = o.validation ?? 0.15;
  const seed = o.seed ?? 1;
  // Built from several examples (requests run together): built again on each side from that side's own. A refusal
  // built from ONE positive (a form left out of what's known: the same request, word for word) goes where that
  // positive goes, by the gold program it carries: the twin of a training example is never a validation example.
  const several = (e: Example) => e.source.startsWith("built:") && e.gold === undefined;
  const built = examples.filter(several);
  const rest = examples.filter((e) => !several(e));
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
  const positives = examples.filter((e) => e.kind === "positive").length;
  if (built.length) for (const side of ["train", "validation"] as const) {
    // (As many on each side as its share of the positives: the whole had a floor under it, which a twentieth of a
    // side's positives may not reach.)
    const own = sides[side].filter((e) => e.kind === "positive");
    const again = builtRefusals(own, seed, 0.05, { too_much: positives ? Math.round((built.length * own.length) / positives) : 0 }, { only: "too_much" });
    for (const e of again) {
      const r = (report[e.shape] ??= { train: { gold: 0, examples: 0 }, validation: { gold: 0, examples: 0 } });
      r[side].examples++;
    }
    sides[side].push(...again);
  }
  return { ...sides, report };
}
