// A participant run by a language model (docs/design/translator-and-resolver.md;
// docs/design/m2-llm-participants.md for the adapter and records).
//
// The participant lives in its world (principle 14): it reads reports in the world's
// terms and says what it does in plain words. It never sees the machinery.
// Before anything it asks for takes effect, it sees exactly what will happen
// and confirms or declines. Each wake starts from a fresh report and its own
// notebook (the only memory it carries); within a wake the exchange continues.
// It can always stop taking part (VISION §15), which is not the same as
// stepping down from an office: that is an act in the world like any other.

import type { Observation, ParticipantAction } from "../contracts";
import type { ParticipantContext } from "../module";
import { inCurrency } from "../money";
import type { ContentBlock, LlmMessage, ToolSpec } from "./adapter";
import { callModel, type LlmIO } from "./call";
import { renderObservation, renderStanding, type Looked } from "./render";

export const LLM_PARTICIPANT_VERSION = "0.7.1"; // 0.7.1: "On file" shows only what stands (not a law withdrawn, or replaced by an amended one)

export interface LlmParticipantConfig {
  participant: string;
  entity: string;
  /** The entity's name in the world, if it has one. */
  entityName?: string;
  title?: string;
  role?: string;
  framing: { disclosure: string; system?: string; reason: string; debrief?: boolean; debrief_text?: string };
  /** Reports whose items are standing documents (laws, charters, procedures). */
  standing: string[];
  /** What its reports are called (by channel path). */
  titles: Map<string, string>;
  /** Reports it reads only when it chooses to (on request). */
  onRequest?: string[];
  /** What kind of report each is (by channel path): papers ("records"), buildings and ground ("sites"), who's who
   * ("directory"), accounts, holdings. With it, the participant can look into any of the first three when it chooses
   * (what a code participant in its seat can do): search its papers, see places in full, find who's who. */
  kinds?: Map<string, string>;
  cadenceDays: number;
  maxTokens?: number;
  /** Office hours (pilot 7): it deals with its business in one sitting a working day, from `start` (seconds into the day)
   * until `end`, on the first `days` days of each week; what comes in between waits for the next sitting. Absent: it
   * takes up whatever comes, whenever it comes. */
  sessions?: { start: number; end: number; days: number };
  /** The most actions one answer may hold (each carried out in turn; their results come back together). */
  maxActions?: number;
  /** How a draft awaiting confirmation reads (from the translator package). */
  draftText: (d: any) => string;
}

/** The capacity an act is done in: a post it holds, or (left out) itself. */
const AS = { type: "string", description: "If you hold a post: the post you're acting in, by its id. Leave it out to act as yourself." };

/** The reports it can look into when it chooses, and what kind each is: those it only reads on request (papers,
 * unless said otherwise), and, where the kinds are known, its papers, its buildings and ground, and who's who.
 * (Not what's on file: it has those whole already.) */
export function lookable(c: LlmParticipantConfig): Map<string, "records" | "sites" | "directory"> {
  const m = new Map<string, "records" | "sites" | "directory">();
  for (const id of c.onRequest ?? []) m.set(id, "records");
  for (const [id, kind] of c.kinds ?? []) {
    if (kind !== "records" && kind !== "sites" && kind !== "directory") m.delete(id);
    else if (!c.standing.includes(id) || c.onRequest?.includes(id)) m.set(id, kind);
  }
  return m;
}

/** What a participant calls the places in a paper it can search by, and what the participant API calls them (which it
 * may use too): it reads "from", "citing" and dates in its reports, never the store's field names (principle 14). */
const FIELD_WORDS: { [said: string]: string } = { from: "author", "on behalf of": "speaks_for", on_behalf_of: "speaks_for", citing: "basis", date: "at" };
const FIELD = /^(id|record|kind|at|author|speaks_for|basis|claim|(data|about)(\.[A-Za-z0-9_-]+)+)$/;
/** The most a look brings at once (papers found: the participant API's own limit on a search is higher, 200; what's
 * found is shown whole, so this is what keeps one look a readable size). */
const LOOK_MAX = 50;
type Op = "=" | "!=" | "<" | "<=" | ">" | ">=";
const OPS: Op[] = ["=", "!=", "<", "<=", ">", ">="];
const DAYS_IN_YEAR = 365;
type Where = { field: string; op: Op; value: string | number | boolean };

/** One thing to find, as the participant API's search takes it; or why it can't be read. A date is written as the
 * reports write it ("year 1, day 12", "day 12" of the first year, or "year 2"), and stands for the whole day or year. */
export function condition(w: any): Where[] | string {
  if (!w || typeof w !== "object" || typeof w.field !== "string") return "something to find didn't say where to look";
  const said = w.field.trim();
  const lower = said.toLowerCase();
  const field = FIELD_WORDS[lower] ?? (lower.startsWith("detail.") ? `data.${said.slice(7)}` : said);
  if (!FIELD.test(field)) return `"${said.slice(0, 40)}" isn't something papers can be found by`;
  if (!["string", "number", "boolean"].includes(typeof w.value)) return `what to find under "${said.slice(0, 40)}" couldn't be read`;
  if (w.op !== undefined && !OPS.includes(w.op)) return `"${String(w.op).slice(0, 10)}" isn't a way to compare`;
  const op: Op = w.op ?? "=";
  if (field !== "at" || (lower === "at" && typeof w.value === "number")) return [{ field, op, value: w.value }];
  const m = typeof w.value === "string" ? /^\s*(?:year\s*(\d{1,6}))?\s*,?\s*(?:day\s*(\d{1,3}))?\s*$/i.exec(w.value) : null;
  if (!m || (m[1] === undefined && m[2] === undefined)) return 'a date is written like "year 1, day 12"';
  const year = Number(m[1] ?? 1), day = m[2] === undefined ? undefined : Number(m[2]);
  if (year < 1 || (day !== undefined && (day < 1 || day > DAYS_IN_YEAR))) return 'a date is written like "year 1, day 12"';
  const start = ((year - 1) * DAYS_IN_YEAR + ((day ?? 1) - 1)) * 86_400;
  const end = start + (day === undefined ? DAYS_IN_YEAR : 1) * 86_400;
  const at = (o: Op, value: number): Where => ({ field: "at", op: o, value });
  return op === "=" ? [at(">=", start), at("<", end)] : op === "<" ? [at("<", start)] : op === "<=" ? [at("<", end)] : op === ">" ? [at(">=", end)] : op === ">=" ? [at(">=", start)]
    : "a date can be matched with =, <, <=, > or >=, not with !=";
}

/** Its tools: what it can do, in its own terms. The contract's actions are underneath. */
export function tools(c: LlmParticipantConfig): ToolSpec[] {
  const reports = lookable(c);
  const named = (kind: string) => [...reports].filter(([, k]) => k === kind).map(([id]) => `"${c.titles.get(id) ?? id}" (${id})`).join(", ");
  const [papers, places, people] = [named("records"), named("sites"), named("directory")];
  const lookWords = [
    c.kinds ? "Look into one of your reports yourself, when you choose." : `Look at one of the reports you only read when you choose to: ${papers}.`,
    "You'll see what's there with your next report.",
    ...(papers ? [`${c.kinds ? `Papers and filings: ${papers}. ` : ""}To look something up in them, say what to find: those where something matches (kind, from, on behalf of, citing, date as "year 1, day 12", or detail.<name> for one of a paper's details, e.g. detail.employer), newest first. What you look up is shown whole.`] : []),
    ...(places ? [`Buildings and ground: ${places}. Name the places to see in full as they are today (a building, a room, a piece of ground, or a kind of building); or name a measure the report gives, to see every building where it's above zero or rising, the highest first.`] : []),
    ...(people ? [`Who's who: ${people}. Name who you're looking for (an id, or a name or part of one).`] : []),
  ].join(" ");
  const leave = c.framing.disclosure === "simulation"
    ? "Stop taking part in this study, permanently. This is always open to you and it will be respected; it's recorded as a choice, not a failure. (Stepping down from your office is different: that's something you would do in the world.)"
    : "Stop, permanently. This is always open to you and it will be respected.";
  return [
    { name: "do", description: "Say what you do, in plain words, naming what you're using (amounts, accounts, lots, people, papers) by the ids in your reports. Before it takes effect you'll see exactly what will happen, and confirm or decline. It's for doing things in the world, not for reading or asking: to look something up use look (if you have files to look in), and to ask someone something, write to them.",
      input_schema: { type: "object", required: ["what"], properties: { what: { type: "string" }, as: AS, why: { type: "string", description: "Why (optional; kept on record)." } } } },
    { name: "confirm", description: "Confirm or decline something waiting for you to confirm, by its reference.",
      input_schema: { type: "object", required: ["ref", "decision"], properties: { ref: { type: "string" }, decision: { enum: ["confirm", "decline"] }, note: { type: "string" } } } },
    { name: "write", description: "Write to people or organisations, by id. The words go exactly as you write them.",
      input_schema: { type: "object", required: ["to", "text"], properties: { to: { type: "array", items: { type: "string" } }, text: { type: "string" }, as: AS, about: { type: "string", description: "The reference it's about (optional)." } } } },
    { name: "done_for_now", description: c.sessions
        ? "That's all for now. You're back at your next working day's sitting, or after the given number of days (at that day's sitting); sooner, at the next sitting, if someone writes to you. You can use it alongside other actions: they're done, and you'll see how they went when you're back."
        : "That's all for now. You'll be back after the given number of days, or sooner if someone writes to you. You can use it alongside other actions: they're done, and you're back after the days given, when you'll see how they went.",
      input_schema: { type: "object", properties: { days: { type: "integer", minimum: 1 } } } },
    { name: "notebook", description: "Replace your notebook: the only thing you'll remember from one sitting to the next. It holds 4,000 characters. Use it alongside your actions.",
      input_schema: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 4000 } } } },
    { name: "opt_out", description: leave, input_schema: { type: "object", required: ["statement"], properties: { statement: { type: "string" } } } },
    ...(reports.size
      ? [{ name: "look", description: lookWords,
          input_schema: { type: "object", required: ["report"], properties: {
            report: { enum: [...reports.keys()] },
            ...(papers ? {
              current_only: { type: "boolean", description: "Papers: only what's still current (not withdrawn by whoever put it up)." },
              find: { type: "array", maxItems: 8, description: "Papers: only those where each of these holds.", items: { type: "object", required: ["field", "value"], properties: {
                field: { type: "string", description: "kind, from, on behalf of, citing, date, or detail.<name>" },
                op: { enum: OPS, description: "= if not given" },
                value: { anyOf: [{ type: "string" }, { type: "integer" }, { type: "boolean" }] } } } } } : {}),
            ...(places || people ? { named: { type: "array", maxItems: 40, items: { type: "string" }, description: [places ? "Buildings and ground: the places to see in full." : "", people ? "Who's who: who to find." : ""].filter(Boolean).join(" ") } } : {}),
            ...(places ? { measure: { type: "string", description: "Buildings and ground: a measure, as the report names it; every building where it's above zero or rising is listed." } } : {}),
            limit: { type: "integer", minimum: 1, maximum: LOOK_MAX, description: "At most this many (20 if not given)." } } } }]
      : []),
  ];
}

export function systemPrompt(c: LlmParticipantConfig, standing: string): string {
  return [
    c.framing.system ?? "",
    "",
    `You are ${c.title ?? c.participant}, acting for ${c.entityName && c.entityName !== c.entity ? `${c.entityName} (${c.entity})` : c.entity}.`,
    "To do something, say what you do in plain words, and name what you're using: the amount, the account, the lot, the people, the papers. Your reports show each thing's id in brackets or after its name. Before anything takes effect, you'll see exactly what will happen, and confirm or decline it. You can also write to people directly.",
    `You can take several actions at once (up to ${c.maxActions ?? 8}): they're carried out in the order you give them, and you'll see how each went together, afterwards. So act on what you already know in one go; anything that depends on the result of an action (confirming a draft you haven't seen yet) waits for the next turn. Update your notebook alongside.`,
    ...(c.sessions ? [`You work office hours: one sitting each working day, when you deal with everything that's come in since the last.`] : []),
    ...(standing ? ["", "On file:", standing] : []),
  ].join("\n").trim();
}

export interface LlmController {
  step(obs: Observation, ctx: ParticipantContext): Promise<ParticipantAction>;
  /** Post-run debrief (VISION §15.3). */
  debrief(text: string): Promise<void>;
}

type Use = Extract<ContentBlock, { type: "tool_use" }>;
const text = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const quote = (s: string, max = 80) => `"${s.length > max ? `${s.slice(0, max)}…` : s}"`;

/** The most a notebook holds, and the most of what came in between sittings that's set out at the next. */
export const NOTEBOOK_MAX = 4000;
export const CARRY_MAX = 40_000;
/** The longest statement recorded with an opt-out (the contracts' limit on free text). */
const STATEMENT_MAX = 16_384;

/** The words given with an opt-out, however they came: as asked, as the raw text of an input that couldn't be read, or
 * whatever else was given; empty if nothing was. Opting out never depends on its wording (VISION §15). */
export function optOutStatement(input: unknown): string {
  const i = input as any;
  const said = typeof input === "string" ? input
    : typeof i?.statement === "string" ? i.statement
    : text(i?._unparsed) ? i._unparsed
    : i && typeof i === "object" && Object.keys(i).length ? JSON.stringify(i)
    : "";
  return said.slice(0, STATEMENT_MAX);
}

export function createLlmParticipant(c: LlmParticipantConfig, io: LlmIO): LlmController {
  const standingIds = new Set(c.standing);
  const toolset = tools(c);
  let notes = "";
  // What it did, as recorded, for its debrief (it has no other memory of the run: pilot 9's mayor couldn't say).
  const tally = { requests: 0, confirmed: 0, declined: 0, letters: 0, looks: 0, first: -1, last: -1 };
  let messages: LlmMessage[] = [];
  // The last answer's tool uses (the APIs need a result for every one): each action's result is the report after it.
  let pending: { id: string; name: string }[] = [];
  // Actions from the last answer still to carry out, in order, and the reports seen after each one carried out.
  let queue: { id: string; action: ParticipantAction; label?: string; looked?: [string, Looked] }[] = [];
  // The reports it can look into, and what it asked to see in the one it just looked at (the next report sets it out).
  const reports = lookable(c);
  const canLook = new Set(reports.keys());
  let lastLooked: Map<string, Looked> | undefined;
  const results = new Map<string, string>();
  // What in the last answer was not done (or only in part), by use: what it's told in this sitting if a turn follows
  // (`now`), and otherwise at the start of the next (`later`, which has to say what it was about).
  const notDone = new Map<string, { now: string; later: string }>();
  let unsaid: string[] = []; // what wasn't done last sitting, still to be told
  let current: string | undefined; // the use whose action was just carried out (the next report is its result)
  let lastAction: string | undefined;
  // "Done for now" said alongside actions: once they're carried out, no call until the next wake (or sitting).
  let doneAfter: { days?: number } | undefined;
  // What it was shown while not at its desk (a wake between sittings, or after its last action of a sitting), for the
  // next sitting: perception is changes, so nothing seen is lost.
  let carried: string[] = [];
  let missed: Observation[] = []; // the observations behind it (a mock's code brain reads these, not the text)
  // Reports that came during a sitting while it couldn't be reached (a model call that failed), for its next turn.
  let extra: string[] = [];
  // One more turn was given this sitting for an answer none of which could be done (once, so it can't go round for ever).
  let retried = false;
  // Office hours: the day of the sitting under way (or last held), whether it's open, and the earliest it's back.
  let sittingDay = -1;
  let open = false;
  let backAt = 0;
  let mail = false; // someone wrote, in something it hasn't been shown yet
  const seenSystems = new Set<string>();
  let standingText = "";
  const DAYS = 86_400;
  const S = c.sessions;
  const sittingStart = (day: number) => day * DAYS + (S?.start ?? 0);
  const workday = (day: number) => !S || day % 7 < S.days;
  /** The next sitting at or after `t`: a working day's start, or now if within a working day's hours. */
  const nextSitting = (t: number) => {
    let day = Math.floor(t / DAYS);
    if (S && workday(day) && t >= sittingStart(day) && t < day * DAYS + S.end && day !== sittingDay) return t;
    for (day = day + (t >= sittingStart(day) ? 1 : 0); !workday(day) || day === sittingDay; day++);
    return sittingStart(day);
  };

  /** Carry out the next queued action. */
  const next = (obs: Observation): ParticipantAction => {
    const q = queue.shift()!;
    current = q.id;
    lastAction = q.label;
    lastLooked = q.looked ? new Map([q.looked]) : undefined;
    if (q.action.type === "propose") tally.requests++;
    if (q.action.type === "sign") q.action.decision === "accept" ? tally.confirmed++ : tally.declined++;
    if (q.action.type === "message") tally.letters++;
    if (q.action.type === "look") tally.looks++;
    [tally.first, tally.last] = [tally.first < 0 ? obs.t : tally.first, obs.t];
    return q.action;
  };
  /** Away from the desk until `until` (or its cadence): the conversation ends; the next sitting starts afresh. */
  const away = (until?: number): ParticipantAction => {
    messages = [];
    pending = [];
    results.clear();
    notDone.clear();
    extra = [];
    retried = false;
    open = false;
    return until !== undefined ? { type: "wait", until } : { type: "wait" };
  };
  /** The sitting is ending with the last answer's results unread: they're kept for the next one, with what wasn't done. */
  const keepForNext = () => {
    for (const u of pending) {
      if (results.has(u.id)) carried.push(results.get(u.id)!);
      if (notDone.has(u.id)) unsaid.push(notDone.get(u.id)!.later);
    }
  };
  const note = (data: object) => io.annotate({ annotation: "note", subject: c.participant, data });

  /** What a tool use asks for, as an action; or, if it can't be done as written, what it was and why not, in words. */
  const read = (use: Use, held: Set<string>): { what: string } & ({ action: ParticipantAction; label?: string; looked?: [string, Looked] } | { why: string }) => {
    const i = use.input;
    const what = use.name === "do" ? (text(i?.what) ? `what you asked for (${quote(i.what)})` : "something you asked for")
      : use.name === "confirm" ? (text(i?.ref) ? `your answer on ${i.ref}` : "your answer on something waiting for you to confirm")
      : use.name === "write" ? (text(i?.text) ? `your letter (${quote(i.text)})` : "a letter of yours")
      : use.name === "look" ? (text(i?.report) ? `looking at ${quote(c.titles.get(i.report) ?? i.report)}` : "looking something up")
      : `something you tried (${quote(String(use.name))})`;
    const no = (why: string) => ({ what, why });
    if (!i || typeof i !== "object" || Array.isArray(i) || "_unparsed" in i) return no("it couldn't be read as you wrote it");
    // A post it doesn't hold (any more) can't be acted in; left out, it acts as itself.
    const post = (): { as?: string } | string =>
      i.as === undefined ? {} : !text(i.as) ? "the post you named couldn't be read" : !held.has(i.as) ? `you don't hold the post ${quote(i.as)}` : { as: i.as };
    if (use.name === "do") {
      if (!text(i.what)) return no("it didn't say what to do");
      const as = post();
      if (typeof as === "string") return no(as);
      return { what, action: { type: "propose", text: i.what, ...as, ...(text(i.why) ? { reasoning: i.why } : {}) } };
    }
    if (use.name === "confirm") {
      if (!text(i.ref)) return no("it didn't say which one");
      if (i.decision !== "confirm" && i.decision !== "decline") return no('it has to say "confirm" or "decline"');
      return { what, action: { type: "sign", draft: i.ref, decision: i.decision === "confirm" ? "accept" : "reject", ...(text(i.note) ? { note: i.note } : {}) },
        ...(i.decision === "confirm" ? { label: "What you confirmed" } : {}) };
    }
    if (use.name === "write") {
      if (text(i.to)) return no("who it's for has to be given as a list");
      if (!Array.isArray(i.to) || !i.to.length) return no("the letter had no one to go to");
      if (!i.to.every(text)) return no("one of those it was for couldn't be read");
      if (!text(i.text)) return no("the letter had no words");
      const as = post();
      if (typeof as === "string") return no(as);
      return { what, action: { type: "message", to: i.to, text: i.text, ...as, ...(text(i.about) ? { re: i.about } : {}) }, label: `Your letter to ${i.to.join(", ")}` };
    }
    if (use.name === "look" && reports.size) {
      if (!text(i.report)) return no("it didn't say which report");
      const kind = reports.get(i.report);
      if (!kind) return no("that isn't one of the reports you can look at");
      const limit = Number.isInteger(i.limit) ? Math.min(LOOK_MAX, Math.max(1, i.limit)) : 20;
      const finds: unknown[] = Array.isArray(i.find) ? i.find : i.find === undefined || i.find === null ? [] : [i.find];
      const names: string[] | undefined = i.named === undefined || i.named === null ? [] : text(i.named) ? [i.named] : Array.isArray(i.named) && i.named.every(text) ? i.named : undefined;
      if (!names) return no("the names of what to look at couldn't be read");
      if (kind !== "records") {
        // Places, or who's who: the report as it is now, and of it what was named (or the buildings a measure marks).
        if (finds.length || i.current_only) return no(`that report isn't one of papers to search: name ${kind === "sites" ? "the places to see, or a measure" : "who you're looking for"}`);
        if (i.measure !== undefined && (!text(i.measure) || kind !== "sites")) return no(kind === "sites" ? "the measure couldn't be read" : "a measure is something buildings have: name who you're looking for");
        const looked: Looked = { ...(names.length ? { named: names.slice(0, 40) } : {}), ...(text(i.measure) ? { measure: i.measure } : {}), limit };
        return { what, action: { type: "look", looks: [{ channel: i.report }] }, looked: [i.report, looked] };
      }
      if (names.length || i.measure !== undefined) return no("that report is one of papers: say what to find in it");
      // A search (what matches now, newest first). Anything to find that can't be read is said, never left out: a
      // search wider than the one asked for would read as its answer.
      const where: Where[] = [];
      for (const w of finds) {
        const r = condition(w);
        if (typeof r === "string") return no(r);
        where.push(...r);
      }
      // Papers it's shown as they come can still be looked through: with nothing to find, the latest of them.
      const query = where.length ? { query: { ...(i.current_only ? { standing: true } : {}), where, order: { field: "at", desc: true }, limit } }
        : i.current_only ? { query: { standing: true, limit } }
        : c.onRequest?.includes(i.report) ? {} : { query: { order: { field: "at", desc: true }, limit } };
      return { what, action: { type: "look", looks: [{ channel: i.report, ...query }] }, looked: [i.report, { limit }] };
    }
    return no("it isn't something you can do");
  };

  /** What came in while it was away, set out for the sitting: each section once (a report repeats what hasn't changed,
   * the town's survey, who's who), and, if it's more than can be set out, the latest reports whole and a count of the
   * earlier ones left out. */
  const sinceLast = (now: string): { before: string; left: number; of: number } => {
    const sections = (b: string) => b.split("\n\n## ").map((x, i) => (i ? `## ${x}` : x));
    const set = (from: number) => {
      // (What the report of now says in the same words isn't said twice: it follows at once.)
      const shown = new Set<string>(sections(now));
      return carried.slice(from).flatMap(sections).filter((x) => !shown.has(x) && (shown.add(x), true)).join("\n\n");
    };
    let left = 0;
    let before = set(0);
    while (before.length > CARRY_MAX && left < carried.length - 1) before = set(++left);
    return { before: left ? `(${left} earlier ${left === 1 ? "report" : "reports"} not shown.)\n${before}` : before, left, of: carried.length };
  };

  return {
    async step(obs, ctx) {
      inCurrency(ctx.world.currency);
      const standing = renderStanding(obs, standingIds);
      // (What stands now, as this report's standing documents show it: nothing, once the last of them is withdrawn. A
      // report that brings none of those documents leaves what's on file as it was.)
      if (standing || Object.entries(obs.channels).some(([id, ch]) => standingIds.has(id) && ch.kind === "records" && ch.records.length)) standingText = standing;
      const body = renderObservation(obs, { standing: standingIds, titles: c.titles, lastAction, draftText: c.draftText, lookable: canLook, ...(lastLooked ? { looked: lastLooked } : {}) });
      lastAction = undefined;
      lastLooked = undefined;
      if (obs.inbox.length) mail = true;
      // This report is the result of the action just carried out, if one was.
      const wasResult = current !== undefined;
      if (current) {
        results.set(current, body);
        current = undefined;
      }
      // More of the last answer to carry out: no call.
      if (queue.length) return next(obs);
      // Done for now, said alongside: what its actions showed is kept for next time. If someone wrote meanwhile (with
      // the result of any of them), it's back sooner, as it was told: at the next sitting, or, with no office hours, now.
      let backEarly = false;
      if (doneAfter) {
        const said = doneAfter;
        doneAfter = undefined;
        if (!S && mail) backEarly = true;
        else {
          const days = said.days ?? (S ? c.cadenceDays : undefined);
          keepForNext();
          missed.push(obs);
          backAt = days ? (S ? sittingStart(Math.floor(obs.t / DAYS) + days) : obs.t + days * DAYS) : 0;
          return away(S ? Math.min(backAt || Infinity, nextSitting(obs.t + 1)) : days ? obs.t + days * DAYS : undefined);
        }
      }
      // Office hours: between sittings, what comes in is kept for the next one, and no call is made.
      const before = { open, sittingDay, mail };
      if (S && !open) {
        const day = Math.floor(obs.t / DAYS);
        const inHours = workday(day) && obs.t >= sittingStart(day) && obs.t < day * DAYS + S.end && day !== sittingDay;
        if (!inHours || (obs.t < backAt && !mail)) {
          carried.push(body);
          missed.push(obs);
          return { type: "wait", until: obs.t < backAt && !mail ? Math.max(backAt, nextSitting(obs.t)) : nextSitting(obs.t) };
        }
        open = true;
        sittingDay = day;
      }

      // A turn: what it's shown, its answer, and what the answer asks for. Usually one a step; a second follows at once
      // when nothing in the answer could be done, so that it's told (once a sitting).
      for (let turn = 1; ; turn++) {
        const fresh = !pending.length;
        let sending: LlmMessage[];
        if (!fresh) {
          const content: ContentBlock[] = pending.map((u) => ({ type: "tool_result", tool_use_id: u.id,
            content: results.get(u.id) ?? notDone.get(u.id)?.now ?? (u.name === "notebook" ? "Notebook updated."
              : u.name === "done_for_now" ? (backEarly ? "Someone wrote to you as you finished, so you're back now." : "Noted.")
              : "Not done: it wasn't something you can do, as written.") }));
          // Reports it hasn't been shown that aren't the result of anything it did (they came while it couldn't be reached).
          const more = [...extra, ...(turn === 1 && !wasResult ? [body] : [])];
          if (more.length) content.push({ type: "text", text: `Since then:\n${more.join("\n\n")}` });
          sending = [...messages, { role: "user", content }];
        } else {
          const since = sinceLast(body);
          if (since.left) await note({ carried_not_shown: { reports: since.left, of: since.of, limit_characters: CARRY_MAX } });
          sending = [{ role: "user", content: `Your notebook: ${notes || "(empty)"}\n\n${unsaid.length ? `${unsaid.join("\n")}\n\n` : ""}${since.before ? `Since you last looked:\n${since.before}\n\nNow:\n` : ""}${body}` }];
        }

        let res: Awaited<ReturnType<typeof callModel>>;
        try {
          res = await callModel(io, {
            purpose: "participant", subject: c.participant, system: systemPrompt(c, standingText), messages: sending, tools: toolset, maxTokens: c.maxTokens ?? 4000,
            context: { observation: obs, notes, participant: c.participant, ...(missed.length ? { missed } : {}) },
          }, seenSystems);
        } catch (e) {
          // No answer (the call failed, or the run is stopping): nothing it was to be shown is dropped. What was kept
          // for it stays kept, and this report joins it, so the next call shows everything this one would have.
          if (turn === 1) {
            if (fresh) {
              carried.push(body);
              ({ open, sittingDay, mail } = before); // the sitting didn't happen: it's held when it can be
            } else if (!wasResult) extra.push(body);
            missed.push(obs);
          }
          throw e;
        }
        // Answered: it has now seen all of it.
        messages = [...sending, { role: "assistant", content: res.content }];
        carried = [];
        missed = [];
        unsaid = [];
        extra = [];
        results.clear();
        notDone.clear();
        mail = false;
        backEarly = false;

        const uses = res.content.filter((b): b is Use => b.type === "tool_use");
        pending = uses.map((u) => ({ id: u.id, name: u.name }));
        const malformed = async (use: Use, what: string, why: string) => {
          // A malformed tool use: recorded, with why; it's told it wasn't done.
          notDone.set(use.id, { now: `Not done: ${why}.`, later: `When you were last here, ${what} was not done: ${why}.` });
          await note({ malformed_tool_use: JSON.stringify(use).slice(0, 4000), reason: why });
        };
        for (const n of uses.filter((x) => x.name === "notebook")) {
          const t = n.input?.text;
          if (typeof t !== "string") {
            notDone.set(n.id, { now: "Notebook not updated: its text couldn't be read. It still says what it said before.", later: "When you were last here, your notebook was not updated: its new text couldn't be read. It still says what it said before." });
            await note({ malformed_tool_use: JSON.stringify(n).slice(0, 4000), reason: "the notebook's text couldn't be read" });
            continue;
          }
          notes = t.slice(0, NOTEBOOK_MAX);
          notDone.delete(n.id);
          if (t.length > NOTEBOOK_MAX) {
            const cut = `it was too long (${t.length} characters; it holds ${NOTEBOOK_MAX}), so only the first ${NOTEBOOK_MAX} characters were kept. It now ends: ${quote(notes.slice(-60))}`;
            notDone.set(n.id, { now: `Notebook updated only in part: ${cut}.`, later: `When you were last here, your notebook was updated only in part: ${cut}.` });
            await note({ notebook_cut: { length: t.length, kept: NOTEBOOK_MAX } });
          }
        }
        // Stopping is always honoured (VISION §15), however it's said: with a statement, with none, or with an input
        // that can't be read. It isn't stepping down from an office, which is an act in the world.
        const optOut = uses.find((u) => u.name === "opt_out");
        if (optOut) {
          queue = [];
          tally.last = obs.t;
          if (!text(optOut.input?.statement)) await note({ opt_out_as_given: JSON.stringify(optOut).slice(0, 4000) });
          return away(), { type: "opt_out", statement: optOutStatement(optOut.input) };
        }
        const held = new Set((obs.positions ?? []).map((p) => p.position));
        const max = c.maxActions ?? 8;
        for (const use of uses) {
          if (use.name === "notebook" || use.name === "done_for_now") continue;
          const r = read(use, held);
          if (!("action" in r)) {
            await malformed(use, r.what, r.why);
            continue;
          }
          if (queue.length >= max) {
            notDone.set(use.id, { now: `Not done: at most ${max} actions at once.`, later: `When you were last here, ${r.what} was not done: you can take at most ${max} actions at once.` });
            await note({ dropped_tool_use: JSON.stringify(use).slice(0, 4000), reason: `more than ${max} actions in one answer` });
            continue;
          }
          queue.push({ id: use.id, action: r.action, ...(r.label ? { label: r.label } : {}), ...(r.looked ? { looked: r.looked } : {}) });
        }
        const done = uses.find((x) => x.name === "done_for_now");
        const days = Number.isInteger(done?.input?.days) && done!.input.days > 0 ? { days: done!.input.days as number } : {};
        if (queue.length) {
          if (done) doneAfter = days;
          return next(obs);
        }
        // Nothing to carry out, though it tried something, and it hasn't said it's done: it's told now, in one more turn.
        if (notDone.size && !done && !retried) {
          retried = true;
          continue;
        }
        // Done for now (said, or by default: back at its usual rhythm, or when someone writes). Anything not done that it
        // hasn't been told of is said at the start of its next sitting.
        keepForNext();
        const back = days.days ?? (S ? c.cadenceDays : undefined);
        backAt = back ? (S ? sittingStart(Math.floor(obs.t / DAYS) + back) : obs.t + back * DAYS) : 0;
        return away(S ? Math.min(backAt || Infinity, nextSitting(obs.t + 1)) : back ? obs.t + back * DAYS : undefined);
      }
    },

    async debrief(text) {
      // Its own record of the run, beside the question: its notebook as it left it, and what it did (VISION §15.3: a
      // reaction to an experience it can't remember is no reaction).
      const day = (t: number) => Math.floor(t / 86_400) + 1;
      const did = tally.first < 0 ? "You didn't act during the run." :
        `From day ${day(tally.first)} to day ${day(tally.last)} you wrote ${tally.letters} letter${tally.letters === 1 ? "" : "s"}, asked for ${tally.requests} thing${tally.requests === 1 ? "" : "s"} to be done (confirming ${tally.confirmed}, declining ${tally.declined}), and looked something up ${tally.looks} time${tally.looks === 1 ? "" : "s"}.`;
      const content = `${text}\n\nFor reference, your own record of the run. Your notebook, as you left it: ${notes || "(empty)"}\n${did}`;
      const res = await callModel(io, {
        purpose: "debrief", subject: c.participant, system: c.framing.system ?? "", maxTokens: c.maxTokens ?? 2000,
        messages: [{ role: "user", content }], context: { participant: c.participant, notes },
      }, seenSystems);
      const reply = res.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n");
      await io.annotate({ annotation: "debrief", subject: c.participant, data: { prompt: content, response: reply } });
    },
  };
}
