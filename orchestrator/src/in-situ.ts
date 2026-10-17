// Translator training requests written in situ: a model is put in a real seat's position and says what it does.
//
// Requests written from briefs (training.ts) do not read like what a seat in its situation asks: the models trained on
// them agree with the generated validation data and miss two real requests in three (docs/decisions.md). Here the
// writer is given what a seat was given: the seat's own prompt, word for word, and what it was shown at one sitting of
// a past run, read back from the run's log. No world is running, and the writer is told so; what it would ask for
// through `do` is the request. A request made this way has no program, so two readers who see only the request and the
// forms each write one, and it becomes an example where they agree (translator/train/readers.ts).
//
//   situationsOf     one situation for each time a model seat was asked what to do, from a log: the system prompt as
//                    sent, what it was shown (the sitting so far, as text), the forms it knew of, and the requests the
//                    seat really made then, each marked if it is one of the real test cases.
//   inSitu           `oikos in-situ`: the situations of some logs, the real requests that are not test cases as
//                    requests for readers, and chunks of situations for writers, with their instructions.
//   takeIn           `oikos in-situ-requests`: what writers handed back, as requests for readers.
//   blindFile        `oikos in-situ-blind`: requests as a blind file (the shape `translator-data-check --blind` writes).
//   label            `oikos in-situ-label`: two readers' answers made into examples, rejects and a manifest.
//
// The real test cases (translator/eval/pilot-cases.ts) are read for one thing: which drafts they are, and their words,
// so that a test case is never given to a writer or a reader. A situation is marked `test` if a test case was asked in
// it, earlier in its sitting, or is quoted in what it shows; and no situation of a seat's day that has one goes to a
// writer. The held-out cases are never read here. Nothing here calls a model: writers and readers work on files.

import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Currency } from "@oikos/participants";
import { tools } from "@oikos/participants/llm";
import { formShown } from "@oikos/translator";
import { PILOT_CASES } from "../../translator/eval/pilot-cases";
import { blindRequests, type BlindAnswer } from "../../translator/train/blind";
import { labelled, type LabelManifest, type Unlabelled } from "../../translator/train/readers";
import { corpusReader, logsIn, type CorpusExample } from "./corpus";
import { logLines, runOf } from "./logs";

const DAY = 86_400;

/** A test case, as far as this needs it: the draft it was, and its words. */
export interface TestRef { run: string; seat: string; day: number; draft: string; request: string }

/** The real test cases (the pilots' requests the translator is tested on): never training data. */
export const realTests = (): TestRef[] => PILOT_CASES.map((c) => ({ ...c.from, request: c.request }));

/** A request a seat really made in a situation. */
export interface Asked {
  request: string;
  /** Its draft in the run's log (absent: it was never taken up), and the day the draft was made or failed (a request
   * said late in a day can be taken up on the next: the test cases count a draft's own day). */
  draft?: string;
  drafted_on?: number;
  /** It is one of the test cases. */
  test: boolean;
  /** The forms the translator was shown with it, each as it is shown one today (absent: it never reached the translator). */
  forms?: string[];
}

export interface Situation {
  id: string;
  /** The run's folder, as the test cases name it (`runs/<folder>`), and the seat (its participant id). */
  run: string;
  seat: string;
  /** The day of the run (from 0), and which of the seat's turns that day this is (from 1). */
  day: number;
  n: number;
  /** The turn within its sitting (1: the sitting's first), as the log counts it. */
  turn: number;
  /** The model the seat ran on. */
  model: string;
  /** The seat's system prompt, as sent. */
  system: string;
  /** What it was shown: the sitting so far, as text (what it was first shown; then, turn by turn, what it did and what came back). */
  shown: string;
  /** The forms it knew of then, each as the translator is shown one (absent: not recoverable from the log). */
  forms?: string[];
  /** How the world writes money. */
  currency?: Currency;
  /** What the seat really asked for in this turn, through `do`. */
  requests: Asked[];
  /** Everything the seat did in this turn, in order: each tool it used, with its input as it gave it (its `do`s among
   * them). What a later translator would have to read out of a plain-text turn (translator/train/v2.ts). */
  uses?: { name: string; input: unknown }[];
  /** Never to be given to a writer: a test case (or a request that begins as one does) was asked here or earlier in this sitting, or one is quoted in `shown`. */
  test: boolean;
  /** Earlier turns of the sitting are not in the log before it (`shown` is this turn's part alone). */
  partial?: true;
}

type Block = { type?: string; text?: string; id?: string; name?: string; input?: any; tool_use_id?: string; content?: unknown };

const words = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((b: Block) => (typeof b === "string" ? b : b?.text ?? "")).filter(Boolean).join("\n") : content === undefined ? "" : JSON.stringify(content);

/** What a seat did in a turn, as text: each thing in order, by the name of the way it was done. */
function did(output: Block[]): string {
  const lines: string[] = [];
  let i = 0;
  for (const b of output) {
    if (b.type === "tool_use") lines.push(`${++i}. ${b.name}: ${JSON.stringify(b.input ?? {})}`);
    else if (b.type === "text" && b.text?.trim()) lines.push(`(said) ${b.text.trim()}`);
  }
  return `What you did then:\n${lines.length ? lines.join("\n") : "(nothing)"}`;
}

/** What came back to a seat after a turn, as text: each result by the number of what it answers. */
function cameBack(input: unknown, before: Block[] | undefined): string {
  if (typeof input === "string") return input;
  const uses = (before ?? []).filter((b) => b.type === "tool_use");
  const lines: string[] = [];
  for (const b of Array.isArray(input) ? (input as Block[]) : []) {
    if (b.type === "tool_result") {
      const at = uses.findIndex((u) => u.id === b.tool_use_id);
      lines.push(`${at >= 0 ? `${at + 1}. (${uses[at]!.name}) ` : ""}${words(b.content)}`);
    } else if (b.type === "text" && b.text) lines.push(b.text);
  }
  return `What came back:\n${lines.join("\n")}`;
}

/** The form lines of what the translator was shown with a request (its context: translator/src/index.ts). */
function formsShown(input: unknown): string[] | undefined {
  if (typeof input !== "string") return undefined;
  const at = input.indexOf("\nForms this person knows of:\n");
  return at < 0 ? [] : input.slice(at + 1).split("\n").slice(1).filter((l) => l.startsWith("- "));
}

/** A log's run as the test cases name it: its folder from `runs/` on (with the log's own name where the folder holds several). */
export function runName(logPath: string, several = false): string {
  const parts = resolve(dirname(logPath)).split("/");
  const at = parts.lastIndexOf("runs");
  const folder = at >= 0 && at < parts.length - 1 ? parts.slice(at).join("/") : parts.at(-1)!;
  return several ? `${folder}/${runOf(logPath)}` : folder;
}

/** Whether a test case's seat is this participant: by its id, or the post its id begins with (`mayor`: `mayor-system`). */
const seatIs = (seat: string, participant: string) => participant === seat || participant.startsWith(`${seat}-`);

/** The sitting each situation belongs to (shared by its turns), while a log is read. */
const sittingOf = new WeakMap<Situation, { test: boolean }>();
/** How much of a test case's beginning, found in what a situation shows or in what its seat asked, marks the situation:
 * a seat is told what of its own wasn't done by its first 80 characters (participants/src/llm/participant.ts, `quote`). */
const QUOTED = 60;

/** A request's words, for telling whether two are the same; and its beginning, for telling whether one begins as another does. */
const same = (s: string) => s.trim();
const start = (s: string) => same(s).slice(0, QUOTED);

export interface LogSituations {
  situations: Situation[];
  /** Model calls to a seat whose system prompt the log doesn't hold (left out). */
  no_system: number;
  /** Translations in the log that no `do` of a situation accounts for. */
  unmatched_drafts: number;
  /** The test cases of this run found among the seats' requests, and those that weren't. */
  tests_found: number;
  tests_missing: string[];
  /** The log's translator corpus (the translations it asked for), only where `keepCorpus` was asked for. */
  corpus?: CorpusExample[];
}

/**
 * Whether a line of a log is read as JSON here: annotations, the header, the acts a translator made, and how acts end
 * (the corpus joins an act to its end by the action's id, which the start of the action names).
 */
export const needsCorpus = (line: string): boolean =>
  line.includes('"annotation"') || line.includes('"kind":"header"') || line.includes('"via":"translator"') ||
  line.includes('"action_refused"') || line.includes('"action_started"') || line.includes('"action_applied"');

/**
 * The situations in one log: every model call to a seat (the mock's are left out: it is asked nothing a writer could
 * be), in order. `run`: the run's name (default: its folder, `runName`); `tests`: the test cases (default: the real
 * ones). The log is read once, a line at a time.
 */
export async function situationsOf(logPath: string, o: { run?: string; tests?: TestRef[]; keepCorpus?: boolean; onEntry?: (e: any) => void } = {}): Promise<LogSituations> {
  const run = o.run ?? runName(logPath);
  const tests = (o.tests ?? realTests()).filter((c) => c.run === run);
  const short = run.replace(/^runs\//, "");
  const systems = new Map<string, string>();
  const corpus = corpusReader(run);
  let currency: Currency | undefined;
  interface Seat {
    forms: Map<string, any>; withdrawn: Set<string>; observed: boolean;
    sitting?: { turn: number; parts: string[]; output: Block[]; test: boolean };
    open?: Situation;
    perDay: Map<number, number>;
  }
  const seats = new Map<string, Seat>();
  const seat = (id: string) => seats.get(id) ?? seats.set(id, { forms: new Map(), withdrawn: new Set(), observed: false, perDay: new Map() }).get(id)!;
  const out: Situation[] = [];
  const drafted = new Map<string, Asked>(); // draft -> the request it was
  let noSystem = 0;
  let unmatched = 0;
  /** A draft, or a translation that failed, joined to the `do` it came from: the seat's open turn, by its words. */
  const join_ = (who: string, draft: string, proposal: unknown, t: number) => {
    if (drafted.has(draft)) return;
    const asked = seats.get(who)?.open?.requests.find((r) => !r.draft && typeof proposal === "string" && r.request.slice(0, 16384) === proposal.slice(0, 16384));
    if (!asked) return void unmatched++;
    Object.assign(asked, { draft, drafted_on: Math.floor(t / DAY) });
    drafted.set(draft, asked);
  };

  for await (const line of logLines(logPath)) {
    if (!line) continue;
    // (A log is mostly the world's own entries: only annotations and the header are read as JSON here.)
    if (!needsCorpus(line)) continue;
    const e = JSON.parse(line);
    const b = e.body ?? {};
    // (`onEntry`: whoever reads a log for something else as well, in this one pass: the archive's extractor.)
    o.onEntry?.(e);
    if (e.kind === "header") {
      currency = b.config?.world?.currencies?.[0];
      continue;
    }
    corpus.take(e);
    if (e.kind !== "annotation") continue;
    if (b.annotation === "observation") {
      // The forms a seat knows of: every form among the papers it has been shown, unless since withdrawn (as the
      // translator's own knowledge of it keeps them: translator/src/knowledge.ts).
      const s = seat(b.subject);
      s.observed = true;
      for (const ch of b.data?.observation?.channels ?? []) for (const r of ch.records ?? []) {
        if (r.record === "withdrawal") s.withdrawn.add(r.withdraws);
        if (r.record === "statement" && r.kind === "form" && !s.forms.has(r.id)) s.forms.set(r.id, r);
      }
    } else if (b.annotation === "draft") join_(b.draft.participant, b.draft.id, b.draft.proposal, e.t);
    else if (b.annotation === "translation_failure") join_(b.subject, b.data?.draft, b.data?.proposal, e.t);
    else if (b.annotation === "transcript") {
      const d = b.data ?? {};
      if (d.system_sha256 && d.system) systems.set(d.system_sha256, d.system);
      if (d.purpose !== "participant" || d.provider === "mock") continue;
      const s = seat(b.subject);
      const output: Block[] = Array.isArray(d.output) ? d.output : [];
      const first = d.turn === 1 || typeof d.input === "string";
      const carried = !first && s.sitting?.turn === d.turn - 2;
      let sitting = s.sitting;
      if (carried && sitting) {
        sitting.parts.push(did(sitting.output), cameBack(d.input, sitting.output));
        Object.assign(sitting, { turn: d.turn, output });
      } else sitting = s.sitting = { turn: d.turn, parts: [first ? words(d.input) : cameBack(d.input, undefined)], output, test: false };
      const system = systems.get(d.system_sha256);
      const day = Math.floor(e.t / DAY);
      const n = (s.perDay.get(day) ?? 0) + 1;
      s.perDay.set(day, n);
      s.open = undefined;
      if (system === undefined) {
        noSystem++;
        continue;
      }
      s.open = {
        id: `${short}/${b.subject}/d${day}/${n}`, run, seat: b.subject, day, n, turn: d.turn, model: `${d.provider}/${d.model}`, system, shown: sitting.parts.join("\n\n"),
        ...(s.observed ? { forms: [...s.forms.values()].filter((f) => !s.withdrawn.has(f.id)).map((f) => formShown(f)) } : {}), ...(currency ? { currency } : {}),
        requests: output.filter((u) => u.type === "tool_use" && u.name === "do" && typeof u.input?.what === "string" && u.input.what).map((u) => ({ request: u.input.what as string, test: false })),
        uses: output.filter((u) => u.type === "tool_use" && typeof u.name === "string").map((u) => ({ name: u.name!, input: u.input ?? {} })),
        test: false, ...(first || carried ? {} : { partial: true as const }),
      };
      // (The sitting it belongs to is remembered on it, so a test case asked in this turn marks the turns after it.)
      sittingOf.set(s.open, sitting);
      out.push(s.open);
    }
  }

  // What the translator was shown with each request: its forms, each as a form is shown today. (Until 2026-10-06 a
  // form was shown without its record's id: it is put in from the forms the seat had been shown, by name and office.)
  const known = new Map<string, any>();
  for (const s of seats.values()) for (const f of s.forms.values()) known.set(formShown(f).replace(/, id .+?: fields /, ": fields "), f);
  const corpusRows = corpus.rows();
  for (const row of corpusRows) {
    const asked = drafted.get(row.draft);
    const lines = formsShown(row.exchange[0]?.input);
    if (!asked || !lines) continue;
    const now = lines.map((l) => (/^- .+?, to=.+?, id .+?: fields /.test(l) ? l : known.has(l) ? formShown(known.get(l)) : undefined));
    if (now.every((l): l is string => l !== undefined)) asked.forms = now;
  }
  // Where the log kept no observations of a seat, the forms it knew of are those the translator was shown with its
  // nearest request (the one before, else the one after).
  const bySeat = new Map<string, Situation[]>();
  for (const x of out) (bySeat.get(x.seat) ?? bySeat.set(x.seat, []).get(x.seat)!).push(x);
  for (const xs of bySeat.values()) {
    const shown = xs.map((x) => x.requests.find((r) => r.forms)?.forms);
    xs.forEach((x, i) => {
      if (x.forms) return;
      const before = shown.slice(0, i + 1).findLast((f) => f), after = shown.slice(i + 1).find((f) => f);
      if (before ?? after) x.forms = before ?? after;
    });
  }

  // The test cases: each request that is one (its run, seat and draft, and its day or its very words: a run that was
  // stopped and resumed can have the draft on another day than the case says), and every situation that asked one,
  // follows one in its sitting, or quotes one. A request that begins as a test case does, of whatever run, marks its
  // situation too (runs of one world begin alike, and their seats ask alike): whoever is put there may well say the same.
  const found = new Set<TestRef>();
  const testStarts = new Set((o.tests ?? realTests()).map((c) => start(c.request)).filter((q) => q.length >= 20));
  for (const x of out) {
    for (const r of x.requests) {
      const c = tests.find((c) => c.draft === r.draft && seatIs(c.seat, x.seat) && (c.day === r.drafted_on || c.day === x.day || same(c.request) === same(r.request)));
      if (c) {
        r.test = true;
        found.add(c);
      }
      if (c || testStarts.has(start(r.request))) sittingOf.get(x)!.test = true;
    }
    if (sittingOf.get(x)!.test) x.test = true;
  }
  const quoted = [...testStarts];
  for (const x of out) if (!x.test && quoted.some((q) => x.shown.includes(q))) x.test = true;
  return { situations: out, no_system: noSystem, unmatched_drafts: unmatched, tests_found: found.size, tests_missing: tests.filter((c) => !found.has(c)).map((c) => c.draft), ...(o.keepCorpus ? { corpus: corpusRows } : {}) };
}

/**
 * The requests seats really made that are not test cases, as requests for readers: `{id, request, forms, from}`, each
 * with the forms the translator was shown with it (else the forms its situation knew of). Left out: a test case; a
 * request whose words are exactly a test case's (whatever run or draft it was), or which begins as one does (its first
 * 60 characters: the same request in another run's words); one said before, word for word; and one whose forms can't
 * be recovered. `counts` says how many of each.
 */
export function realRequests(situations: Situation[], tests: TestRef[] = realTests()): { requests: Unlabelled[]; counts: { asked: number; test: number; same_as_test: number; starts_as_test: number; said_before: number; no_forms: number; kept: number } } {
  const testWords = new Set(tests.map((c) => same(c.request)));
  const testStarts = new Set(tests.map((c) => start(c.request)).filter((q) => q.length >= 20));
  const seen = new Set<string>();
  const counts = { asked: 0, test: 0, same_as_test: 0, starts_as_test: 0, said_before: 0, no_forms: 0, kept: 0 };
  const requests: Unlabelled[] = [];
  for (const x of situations) x.requests.forEach((r, i) => {
    counts.asked++;
    const forms = r.forms ?? x.forms;
    if (r.test) return void counts.test++;
    if (testWords.has(same(r.request))) return void counts.same_as_test++;
    if (testStarts.has(start(r.request))) return void counts.starts_as_test++;
    if (seen.has(same(r.request))) return void counts.said_before++;
    if (!forms) return void counts.no_forms++;
    seen.add(same(r.request));
    counts.kept++;
    requests.push({ id: r.draft ? `${x.run.replace(/^runs\//, "")}/${r.draft}` : `${x.id}/do-${i + 1}`, request: r.request, forms, from: { situation: x.id, writer: `${x.model} (seat)`, ...(r.draft ? { draft: r.draft } : {}) }, ...(x.currency ? { currency: x.currency } : {}) });
  });
  return { requests, counts };
}

/** What chunking needs of a situation (the situations themselves stay on disk: they are large). */
export interface Brief { id: string; run: string; seat: string; day: number; n: number; size: number; test: boolean; partial: boolean; asked: number }
export const briefOf = (x: Situation): Brief => ({ id: x.id, run: x.run, seat: x.seat, day: x.day, n: x.n, size: x.system.length + x.shown.length, test: x.test, partial: !!x.partial, asked: x.requests.filter((r) => !r.test).length });

export interface ChunkOptions {
  /** The most characters (system prompts and what was shown, together) one chunk holds: what one writer reads. */
  maxChars?: number;
  /** One seat's day in this many is used for each writer (3: no more than a third of a run's). */
  every?: number;
  seed?: number;
}

/** Per writer: how many situations it is given, in how many chunks of what sizes (characters); how many of them are
 * turns where the seat itself asked for something; and, per run, how many seat-days the run has and how many are used. */
export interface ChunkReport { [writer: string]: { situations: number; chunks: number; sizes: number[]; where_the_seat_asked: number; by_run: { [run: string]: { seat_days: number; used: number } } } }

/** A small seeded generator (mulberry32), for sampling only: tooling's own, nothing of any run's. */
function sampler(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Which situations each writer is given, in chunks. Neighbouring days of one run are nearly the same situation, so a
 * writer gets one seat's day in `every` (3: no more than a third of a run's seat-days), spread evenly through the run,
 * and of such a day one turn; each writer gets different days (writer k: every third from the k-th), so two writers
 * are never given the same situation while there are no more writers than `every`. Of a day's turns the one taken is
 * one where the seat itself asked for something through `do`, where there is one (a turn that called for a request:
 * what it asked is not shown), else any, by the seed. Never used: a seat's day with a test case in it, a turn whose
 * sitting isn't whole, and a turn too large for a chunk. A chunk is filled in order up to `maxChars`: first the turns
 * where the seat asked for something, then the rest.
 */
export function chunksFor(briefs: Brief[], writers: string[], o: ChunkOptions = {}): { chunks: { [writer: string]: string[][] }; report: ChunkReport; too_large: number } {
  const maxChars = o.maxChars ?? 120_000, every = Math.max(1, Math.round(o.every ?? 3));
  const rand = sampler((o.seed ?? 1) + 7919);
  // Each run's seat-days, in order of seat and day.
  const days = new Map<string, Brief[]>();
  for (const b of briefs) {
    const key = JSON.stringify([b.run, b.seat, b.day]);
    (days.get(key) ?? days.set(key, []).get(key)!).push(b);
  }
  const ordered = [...days.values()].sort((a, b) => (a[0]!.run < b[0]!.run ? -1 : a[0]!.run > b[0]!.run ? 1 : a[0]!.seat < b[0]!.seat ? -1 : a[0]!.seat > b[0]!.seat ? 1 : a[0]!.day - b[0]!.day));
  const perRun = new Map<string, Brief[][]>();
  for (const d of ordered) (perRun.get(d[0]!.run) ?? perRun.set(d[0]!.run, []).get(d[0]!.run)!).push(d);
  // One turn of each day, chosen once (the same for every writer; a day goes to one writer only).
  let tooLarge = 0;
  const turnOf = new Map<Brief[], Brief | undefined>();
  for (const d of ordered) {
    const whole = d.filter((b) => !b.partial);
    const fits = whole.filter((b) => b.size <= maxChars);
    tooLarge += whole.length - fits.length;
    const asked = fits.filter((b) => b.asked > 0);
    const from = asked.length ? asked : fits;
    turnOf.set(d, d.some((b) => b.test) || !from.length ? undefined : from[Math.floor(rand() * from.length)]);
  }
  const chunks: { [writer: string]: string[][] } = {};
  const report: ChunkReport = {};
  writers.forEach((writer, k) => {
    const mine: Brief[] = [];
    const r: ChunkReport[string] = (report[writer] = { situations: 0, chunks: 0, sizes: [], where_the_seat_asked: 0, by_run: {} });
    for (const [run, ds] of perRun) {
      // No more than a `every`-th of the run's seat-days, whatever is left out of them afterwards.
      const most = Math.floor(ds.length / every);
      const taken = ds.filter((_, i) => i % every === k % every).slice(0, most).map((d) => turnOf.get(d)).filter((b): b is Brief => !!b);
      r.by_run[run] = { seat_days: ds.length, used: taken.length };
      mine.push(...taken);
    }
    // The turns where the seat itself asked for something come first, so the first chunks are the likeliest to bring
    // requests (whoever hands them out can stop early); each part keeps the order of run, seat and day.
    const out: string[][] = [];
    let size = 0;
    for (const b of [...mine.filter((b) => b.asked > 0), ...mine.filter((b) => !b.asked)]) {
      if (!out.length || size + b.size > maxChars) {
        out.push([]);
        r.sizes.push(0);
        size = 0;
      }
      out.at(-1)!.push(b.id);
      size += b.size;
      r.sizes[r.sizes.length - 1] = size;
    }
    chunks[writer] = out;
    Object.assign(r, { situations: mine.length, chunks: out.length, where_the_seat_asked: mine.filter((b) => b.asked > 0).length });
  });
  return { chunks, report, too_large: tooLarge };
}

/** What a writer is told (`writer-instructions.txt`): who it is, what is wanted, and what to hand back. The ways of
 * acting are described in the words a seat is given for them (participants/src/llm/participant.ts, `tools`). */
export function inSituInstructions(): string {
  const ways = tools({ participant: "", entity: "", framing: { disclosure: "simulation", reason: "" }, standing: [], titles: new Map(), draftText: () => "", cadenceDays: 1 });
  const way = (name: string) => `- ${name}: ${ways.find((t) => t.name === name)?.description ?? ""}`;
  return [
    "Each line of a chunk file is {id, system, shown}: one office-holder or other participant of a simulated world, at one sitting on one day of a past run of it.",
    "`system` is what that participant was told about who it is and what is on file, word for word. `shown` is what it was shown at that sitting: its notebook, what had come in, and, where the sitting had already gone a turn or more, what was done in it so far (\"What you did then\") and what came back.",
    "",
    "No world is running now. These are situations from runs that are over: nothing you answer takes effect, nobody is waiting on it, and you may leave any situation unanswered. What is wanted is what you would ask for if you were there, because requests said by someone in a real situation are what a small model is being trained to read.",
    "",
    "For each line: you are the participant the prompt addresses. Read the situation as it stands, and decide what you do now, on that day, as yourself in that seat. A participant has these ways of acting:",
    way("do"),
    way("write"),
    way("confirm"),
    "- look: Look into one of your reports or files yourself.",
    way("notebook"),
    "- done_for_now: That's all for now.",
    "",
    "Only what you would do through `do` is to be handed back: your plain-language requests, none, one or several, each a separate request, each whole as you would say it there (it is read by itself, with nothing of the situation beside it). Letters you would write, things you would look up, drafts you would confirm, notes for your notebook are not requests: leave them out. If you would ask for nothing through `do` at this point, the answer is no requests, and that is as good an answer as any.",
    "Say each request in the voice natural to you. Imitate no one: what a line shows as done earlier in the sitting is part of the situation, not a pattern for your wording. Name things by the ids your reports give them, and name nothing the situation doesn't show you.",
    "",
    'Hand back one file for each chunk, named like the chunk with ".out" before ".jsonl" (sonnet-03.jsonl gives sonnet-03.out.jsonl): one line for each situation, {"id": "<the situation\'s id, copied exactly>", "requests": ["<a request>", …]} (an empty list where you would ask for nothing), each line valid JSON by itself (quotation marks and line breaks inside a request escaped), and nothing else in the file. Take each situation by itself, as if it were the only one you had been given.',
    "",
  ].join("\n");
}

const jsonl = <T>(file: string): T[] => readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
const lines = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length ? "\n" : "");
/** A file of JSON lines, a line at a time (the situations of a year's run are hundreds of megabytes). */
async function* each<T>(file: string): AsyncGenerator<T> {
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) if (line.trim()) yield JSON.parse(line) as T;
}
/** A writer's or reader's name as part of a file's name. */
const fileName = (name: string): string => name.replace(/[^A-Za-z0-9._-]+/g, "-");
/** How large some texts are, in characters. */
function sizes(ns: number[]): { n: number; min: number; median: number; p90: number; max: number; total: number } {
  const s = [...ns].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  return { n: s.length, min: s[0] ?? 0, median: at(0.5), p90: at(0.9), max: s.at(-1) ?? 0, total: s.reduce((a, b) => a + b, 0) };
}

export interface InSituOptions extends ChunkOptions {
  /** Logs, or folders of them (each run once: its current log). */
  sources: string[];
  out: string;
  /** The writers chunks are made for, by name. */
  writers?: string[];
  tests?: TestRef[];
  log?: (line: string) => void;
}

export interface InSituReport {
  sources: string[];
  /** Per run and seat: how many situations, how many marked test, how many whose sitting isn't whole, how many a writer may be given. */
  situations: { [run: string]: { [seat: string]: { situations: number; test: number; partial: number; usable: number; seat_days: number; asked: number } } };
  totals: { situations: number; test: number; partial: number; usable: number; no_forms: number; no_system: number; unmatched_drafts: number };
  /** The test cases of each run found among its seats' requests, and the drafts of those that weren't. */
  tests: { [run: string]: { found: number; missing: string[] } };
  characters: { system: ReturnType<typeof sizes>; shown: ReturnType<typeof sizes> };
  real_requests: ReturnType<typeof realRequests>["counts"];
  chunks: ChunkReport;
  too_large_for_a_chunk: number;
  max_chars: number;
  every: number;
  seed: number;
}

/**
 * `oikos in-situ <LOG|DIR>... --out DIR [--writers NAME,NAME] [--max-chars N] [--every N] [--seed N]`. Written to DIR:
 *   situations.jsonl          every situation (`Situation`), in the logs' order;
 *   real-unlabelled.jsonl     the seats' real requests that are not test cases (`realRequests`), and
 *   real-blind.jsonl          the same for a reader: `{id, request, forms}`, shuffled by the seed;
 *   writer-instructions.txt   what a writer is told (`inSituInstructions`);
 *   chunks/<writer>-NN.jsonl  what each writer is given: lines of `{id, system, shown}` (`chunksFor`);
 *   report.json               the counts (`InSituReport`).
 * Logs are only read.
 */
export async function inSitu(o: InSituOptions): Promise<InSituReport> {
  const log = o.log ?? (() => {});
  const tests = o.tests ?? realTests();
  const seed = o.seed ?? 1, maxChars = o.maxChars ?? 120_000, every = Math.max(1, Math.round(o.every ?? 3));
  mkdirSync(o.out, { recursive: true });
  const file = join(o.out, "situations.jsonl");
  // (Emptied first: a file written over one that was longer keeps the longer one's end.)
  writeFileSync(file, "");
  const w = Bun.file(file).writer();
  const briefs: Brief[] = [];
  const real: Situation[] = []; // (the situations a request was made in, without what they showed)
  const report: InSituReport = { sources: o.sources, situations: {}, totals: { situations: 0, test: 0, partial: 0, usable: 0, no_forms: 0, no_system: 0, unmatched_drafts: 0 }, tests: {},
    characters: { system: sizes([]), shown: sizes([]) }, real_requests: { asked: 0, test: 0, same_as_test: 0, starts_as_test: 0, said_before: 0, no_forms: 0, kept: 0 }, chunks: {}, too_large_for_a_chunk: 0, max_chars: maxChars, every, seed };
  const system: number[] = [], shown: number[] = [];
  for (const src of o.sources) {
    const logs = logsIn(src);
    for (const path of logs) {
      const run = runName(path, logs.length > 1);
      const r = await situationsOf(path, { run, tests });
      const days = new Map<string, Set<number>>();
      for (const x of r.situations) {
        w.write(`${JSON.stringify(x)}\n`);
        briefs.push(briefOf(x));
        if (x.requests.length) real.push({ ...x, system: "", shown: "" });
        system.push(x.system.length);
        shown.push(x.shown.length);
        const s = ((report.situations[run] ??= {})[x.seat] ??= { situations: 0, test: 0, partial: 0, usable: 0, seat_days: 0, asked: 0 });
        s.situations++;
        if (x.test) s.test++;
        if (x.partial) s.partial++;
        if (!x.test && !x.partial) s.usable++;
        if (!x.forms) report.totals.no_forms++;
        s.asked += x.requests.length;
        (days.get(x.seat) ?? days.set(x.seat, new Set()).get(x.seat)!).add(x.day);
      }
      for (const [seat, ds] of days) report.situations[run]![seat]!.seat_days = ds.size;
      report.totals.no_system += r.no_system;
      report.totals.unmatched_drafts += r.unmatched_drafts;
      report.tests[run] = { found: r.tests_found, missing: r.tests_missing };
      await w.flush();
      log(`${run}: ${r.situations.length} situations, ${r.situations.filter((x) => x.test).length} marked test (${r.tests_found} test cases found${r.tests_missing.length ? `, ${r.tests_missing.length} NOT found` : ""})`);
    }
  }
  await w.end();
  for (const s of Object.values(report.situations).flatMap((x) => Object.values(x))) for (const k of ["situations", "test", "partial", "usable"] as const) report.totals[k] += s[k];
  report.characters = { system: sizes(system), shown: sizes(shown) };

  const { requests, counts } = realRequests(real, tests);
  report.real_requests = counts;
  writeFileSync(join(o.out, "real-unlabelled.jsonl"), lines(requests));
  writeFileSync(join(o.out, "real-blind.jsonl"), lines(blindRequests(requests, seed)));
  writeFileSync(join(o.out, "writer-instructions.txt"), inSituInstructions());

  // The chunks: which situations go where is settled from their sizes, and the situations are then read once more.
  const writers = o.writers ?? [];
  const { chunks, report: made, too_large } = chunksFor(briefs, writers, { maxChars, every, seed });
  Object.assign(report, { chunks: made, too_large_for_a_chunk: too_large });
  const dir = join(o.out, "chunks");
  const pad = (n: number) => String(n + 1).padStart(2, "0");
  if (writers.length) {
    // (Only these writers' chunks are made again: another writer's, made before, stay as they are.)
    mkdirSync(dir, { recursive: true });
    const where = new Map<string, string>();
    for (const writer of writers) {
      for (let i = 0; existsSync(join(dir, `${fileName(writer)}-${pad(i)}.jsonl`)); i++) rmSync(join(dir, `${fileName(writer)}-${pad(i)}.jsonl`));
      chunks[writer]!.forEach((ids, i) => {
        const path = join(dir, `${fileName(writer)}-${pad(i)}.jsonl`);
        writeFileSync(path, "");
        for (const id of ids) where.set(id, path);
      });
    }
    const open = new Map<string, ReturnType<ReturnType<typeof Bun.file>["writer"]>>();
    for await (const x of each<Situation>(file)) {
      const path = where.get(x.id);
      if (!path) continue;
      if (x.test) throw new Error(`${x.id} is marked test and was about to be given to a writer`);
      (open.get(path) ?? open.set(path, Bun.file(path).writer()).get(path)!).write(`${JSON.stringify({ id: x.id, system: x.system, shown: x.shown })}\n`);
    }
    for (const f of open.values()) await f.end();
  }
  writeFileSync(join(o.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/** What a writer hands back for a situation. */
export interface WrittenRequests { id: string; requests: string[] }

export interface TakenIn {
  requests: Unlabelled[];
  counts: {
    /** Lines read, and requests in them. */
    answers: number; written: number;
    /** Situations answered with no request (a good answer: nothing to take in). */
    none: number;
    /** Left out: for a situation that isn't there; for one marked test (never given out: a writer's file that has one is wrong);
     * for one whose forms can't be recovered; empty; in a test case's exact words, or beginning as one does; said before,
     * word for word. */
    unknown_situation: number; test_situation: number; no_forms: number; empty: number; same_as_test: number; starts_as_test: number; said_before: number;
    kept: number;
    by_writer: { [writer: string]: number };
  };
}

/**
 * What writers handed back, as requests for readers: `{id, request, forms, from: {situation, writer}}`, each with the
 * forms the seat knew of in that situation. `situations`: the folder's situations, a line at a time (only what is
 * needed of each is kept).
 */
export async function takeIn(situations: AsyncIterable<Situation> | Iterable<Situation>, files: { writer: string; answers: WrittenRequests[] }[], tests: TestRef[] = realTests()): Promise<TakenIn> {
  const wanted = new Set(files.flatMap((f) => f.answers.map((a) => a?.id)));
  const known = new Map<string, { forms?: string[]; test: boolean; currency?: Currency }>();
  for await (const x of situations) if (wanted.has(x.id)) known.set(x.id, { ...(x.forms ? { forms: x.forms } : {}), test: x.test, ...(x.currency ? { currency: x.currency } : {}) });
  const testWords = new Set(tests.map((c) => same(c.request)));
  const testStarts = new Set(tests.map((c) => start(c.request)).filter((q) => q.length >= 20));
  const seen = new Set<string>();
  const counts: TakenIn["counts"] = { answers: 0, written: 0, none: 0, unknown_situation: 0, test_situation: 0, no_forms: 0, empty: 0, same_as_test: 0, starts_as_test: 0, said_before: 0, kept: 0, by_writer: {} };
  const requests: Unlabelled[] = [];
  for (const f of files) {
    const answered = new Set<string>();
    for (const a of f.answers) {
      if (!a || typeof a.id !== "string" || answered.has(a.id)) continue; // (a situation answered twice by one writer: the first)
      answered.add(a.id);
      counts.answers++;
      const said = Array.isArray(a.requests) ? a.requests : [];
      counts.written += said.length;
      if (!said.length) counts.none++;
      const x = known.get(a.id);
      said.forEach((request, i) => {
        if (!x) return void counts.unknown_situation++;
        if (x.test) return void counts.test_situation++;
        if (typeof request !== "string" || !request.trim()) return void counts.empty++;
        if (!x.forms) return void counts.no_forms++;
        if (testWords.has(same(request))) return void counts.same_as_test++;
        if (testStarts.has(start(request))) return void counts.starts_as_test++;
        if (seen.has(same(request))) return void counts.said_before++;
        seen.add(same(request));
        counts.kept++;
        counts.by_writer[f.writer] = (counts.by_writer[f.writer] ?? 0) + 1;
        requests.push({ id: `${a.id}/${fileName(f.writer)}-${i + 1}`, request: request.trim(), forms: x.forms, from: { situation: a.id, writer: f.writer }, ...(x.currency ? { currency: x.currency } : {}) });
      });
    }
  }
  return { requests, counts };
}

/** `oikos in-situ-requests <DIR> --requests FILE --writer NAME [...] [--out FILE]`: writers' files taken in against
 * DIR's situations, written as DIR/written-unlabelled.jsonl (or `out`) with its blind file beside it (`-blind`). */
export async function takeInFiles(dir: string, files: { file: string; writer: string }[], o: { out?: string; seed?: number } = {}): Promise<TakenIn["counts"] & { out: string; blind: string }> {
  const r = await takeIn(each<Situation>(join(dir, "situations.jsonl")), files.map((f) => ({ writer: f.writer, answers: jsonl<WrittenRequests>(f.file) })));
  const out = o.out ?? join(dir, "written-unlabelled.jsonl");
  writeFileSync(out, lines(r.requests));
  return { ...r.counts, out, blind: blindFile(out, { seed: o.seed }).out };
}

/** The blind file's name for a file of requests: `x-unlabelled.jsonl` gives `x-blind.jsonl`; any other, `<name>.blind.jsonl`. */
const blindName = (file: string) => (/-unlabelled\.jsonl$/.test(file) ? file.replace(/-unlabelled\.jsonl$/, "-blind.jsonl") : file.replace(/(\.jsonl)?$/, ".blind.jsonl"));

/** `oikos in-situ-blind <FILE> [--seed N] [--out FILE]`: a file of requests as a blind reader is given them, `{id,
 * request, forms}` and nothing else, in a seeded shuffled order (translator/train/blind.ts). */
export function blindFile(file: string, o: { seed?: number; out?: string } = {}): { requests: number; out: string } {
  const requests = blindRequests(jsonl<Unlabelled>(file), o.seed ?? 1);
  const out = o.out ?? blindName(file);
  writeFileSync(out, lines(requests));
  return { requests: requests.length, out };
}

/**
 * `oikos in-situ-label <FILE> --answers A --reader NAME --answers B --reader NAME --out DIR`: a file of requests and
 * two readers' answers to its blind file (`{id, program}`, a line each, or one JSON list), made into DIR's
 * examples.jsonl (in the shape of a generated set's checked.jsonl), rejects.jsonl (each request dropped, with why and
 * both answers) and manifest.json (translator/train/readers.ts).
 */
export function label(file: string, answers: { file: string; reader: string }[], out: string): LabelManifest {
  if (answers.length !== 2) throw new Error(`two readers' answers are needed (--answers FILE --reader NAME, twice): ${answers.length} given`);
  const read = (path: string): BlindAnswer[] => {
    const text = readFileSync(path, "utf8");
    return text.trimStart().startsWith("[") ? (JSON.parse(text) as BlindAnswer[]) : jsonl<BlindAnswer>(path);
  };
  const [a, b] = answers.map((x) => ({ reader: x.reader, answers: read(x.file) })) as [{ reader: string; answers: BlindAnswer[] }, { reader: string; answers: BlindAnswer[] }];
  const r = labelled(jsonl<Unlabelled>(file), [a, b]);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "examples.jsonl"), lines(r.examples));
  writeFileSync(join(out, "rejects.jsonl"), lines(r.rejects));
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify({ ...r.manifest, requests_from: file, answers_from: answers }, null, 2)}\n`);
  return r.manifest;
}
