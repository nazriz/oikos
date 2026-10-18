// Run datasets (docs/design/run-datasets.md; contracts/dataset.schema.json): a run's data, derived from its log in one
// streaming pass, joined and flattened into examples a training run can use. The log stays the record: a dataset can
// always be made again from it. The same log always gives the same dataset, byte for byte.

import { mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { actEnds } from "./act-ends";
import { logLines, runOf } from "./logs";
import { takeRoute, takeTurn, type CorpusExample } from "./corpus";
import { periodRow, Records } from "./records";
import { framingOf } from "@oikos/participants/llm";
import { accountRows, DEBRIEF_RESTRICTION, debriefCounts, debriefRows, debriefsOf, OLD_LOG_NOT_PUBLISHABLE } from "./debriefs";

/** The README written beside a dataset that holds debriefs: what the files are and the restriction on their use. */
export function datasetReadme(run: string, withheld: boolean, old = false): string {
  return [`# Dataset of run ${run}: debriefs and exit accounts`, "",
    "`debriefs.jsonl`: what each AI system that held a seat in this run said when it was debriefed at the run's end (VISION 15, point 7), one row a question, by what it allowed to be published. A row with `kept_back: true` is an answer the seat asked to be kept back: the row says so and holds nothing else. For each question about why it decided something, `beside` holds what the run's log shows the seat was shown and did at that decision, so that the account can be set beside the record; nothing here says whether an account is true.",
    "", "`accounts.jsonl`: short accounts written at the run's end, each by an author (a model shown one person's record and nothing else, never told it is the person, free to decline), in that person's voice, beside the person's own private and expressed views from their record. The people of the town are records kept by arithmetic.",
    "", "## Restriction", "", DEBRIEF_RESTRICTION,
    ...(withheld ? ["", "## `debriefs.withheld.jsonl` is not for publication", "", "It holds, in full, the answers seats asked to be kept back. It stays with the run. Before this folder is published or copied anywhere it may be read by others, remove that file. The run's own log holds the same answers and is likewise not published as it stands."] : []),
    ...(old ? ["", "## This run's log is not publishable as it stands", "", OLD_LOG_NOT_PUBLISHABLE] : []),
    "", "Nothing in these files is scored.", ""].join("\n");
}

const sortedCounts = (c: { [k: string]: number }) => Object.fromEntries(Object.entries(c).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
export const DATASET_VERSION = "0.9.2"; // 0.9.2: the manifest says how the run was put to its seats (`seats.framing`: each disclosure in use, its reason, and the seats under it), from the log's header; 0.9.1: a debrief of the older kind (asked with nothing said of publication) is kept back: a row that says so in debriefs.jsonl, its answer in the withheld file only, and the log marked not publishable; 0.9.0: debriefs and exit accounts (debriefs.jsonl, debriefs.withheld.jsonl, accounts.jsonl, README.md, the manifest's `debriefs` and `restrictions`); a seat's debrief calls and an author's accounts are no longer rows of decisions.jsonl; 0.8.0: a decision about a want carries its situation (docs/design/ai-citizens.md 11); 0.7.0: founding and the lineage of ideas (founded.jsonl, ideas.jsonl, idea_passages.jsonl, words.jsonl)

interface Command { seq: number; command: string; as?: string; blocks?: unknown[]; looks?: unknown[]; provenance?: unknown; reasoning?: string; applied?: boolean; refusal?: unknown; created?: string[] }
/** Something a seat was shown that names what an earlier act of its own made: the record or letter made (`of`), the
 * command that made it (`seq`), and what names it (`in`: a record's or a letter's id; `from`: who wrote a letter). */
interface CameBack { of: string; seq: number; in: string; from?: string }
interface Decision {
  run: string; t: number; participant: string; purpose?: string; model: string; synthetic: boolean; system_sha256: string; turn: number;
  input: unknown; output: unknown; tokens?: { input: number; output: number; cost_microusd: number }; commands: Command[]; drafts: string[];
  came_back?: CameBack[];
}

export interface DatasetOptions {
  /** Also write actions.jsonl: every act by a code participant (large). */
  actions?: boolean;
}

/** A line-at-a-time writer (datasets can be large). */
function lines(path: string) {
  const w = Bun.file(path).writer();
  let rows = 0;
  let synthetic = 0;
  return {
    write(row: object) {
      w.write(`${JSON.stringify(row)}\n`);
      rows++;
      if ((row as { synthetic?: boolean }).synthetic) synthetic++;
    },
    async close() {
      await w.end();
      return { rows, synthetic };
    },
  };
}

/** Make the dataset of one log, in `outDir` (created). Returns the manifest. */
export async function exportDataset(logPath: string, outDir: string, o: DatasetOptions = {}): Promise<any> {
  mkdirSync(outDir, { recursive: true });
  let header: any;
  let orch: any = {};
  let engineModules: { [name: string]: unknown } | undefined;
  let entries = 0;
  let lastHash = "";
  let lastT = 0;
  let end: { reason: string; detail?: string } | undefined; // the log's end entry, if it has one
  const run = () => header?.run_id ?? runOf(logPath);
  const systems = new Map<string, string>();
  const translations = new Map<string, CorpusExample>();
  const bySeqDraft = new Map<number, string>(); // command seq -> draft (a translation carried out)
  const models = () => new Set(Object.keys(orch.llm?.participants ?? {}));
  const decisions: Decision[] = [];
  const openDecision = new Map<string, Decision>(); // participant -> its latest decision (commands that follow join it)
  const pendingUsage = new Map<string, { input: number; output: number; cost_microusd: number }>();
  const commandBySeq = new Map<number, Command>();
  // What came of a seat's acts, by reference: the ids of what each act of a model seat made (records, letters), and,
  // in what the seat is shown afterwards, whatever names one of them (a reply to its letter, a decision on its form,
  // a paper made on its direction). Kept until the seat's next model call, whose row says what had come back.
  const seatOf = new Map<number, string>(); // a model seat's command -> the seat
  const madeBy = new Map<string, Map<string, number>>(); // seat -> the id of something it made -> the command that made it
  const back = new Map<string, CameBack[]>(); // seat -> what has come back since its last model call
  const backSeen = new Set<string>();
  const made = (seq: number, id: string) => {
    const c = commandBySeq.get(seq);
    const who = seatOf.get(seq);
    if (c?.created?.includes(id) || actionRows.get(seq)?.created?.includes(id)) return;
    if (c && who) {
      (c.created ??= []).push(id);
      let mine = madeBy.get(who);
      if (!mine) madeBy.set(who, (mine = new Map()));
      mine.set(id, seq);
    }
    const row = actionRows.get(seq);
    if (row) (row.created ??= []).push(id);
  };
  const cameBack = (who: string, observation: unknown) => {
    const mine = madeBy.get(who);
    if (!mine?.size) return;
    const note = (x: CameBack) => {
      const key = `${who}|${x.of}|${x.in}`;
      if (backSeen.has(key)) return;
      backSeen.add(key);
      back.set(who, [...(back.get(who) ?? []), x]);
    };
    const cited = (v: unknown, into: Set<string>) => {
      if (typeof v === "string") { if (mine.has(v)) into.add(v); }
      else if (Array.isArray(v)) for (const x of v) cited(x, into);
      else if (v && typeof v === "object") for (const x of Object.values(v)) cited(x, into);
    };
    const visit = (v: any) => {
      if (Array.isArray(v)) { for (const x of v) visit(x); return; }
      if (!v || typeof v !== "object") return;
      if (typeof v.id === "string" && (typeof v.record === "string" || typeof v.text === "string")) {
        // A record or a letter that is not the seat's own making, naming something that is.
        if (mine.has(v.id)) return;
        const ids = new Set<string>();
        cited(v, ids);
        for (const id of [...ids].sort()) note({ of: id, seq: mine.get(id)!, in: v.id, ...(typeof v.record !== "string" && typeof v.from === "string" ? { from: v.from } : {}) });
        return;
      }
      for (const x of Object.values(v)) visit(x);
    };
    visit(observation);
  };
  const actions = o.actions ? lines(join(outDir, "actions.jsonl")) : undefined;
  const actionRows = new Map<number, any>(); // seq -> row, until its outcome is known (the events follow at once)
  const observations = lines(join(outDir, "observations.jsonl"));
  // Citizens' decisions are written as they are read, without their outcomes (which come later in the log), to a file
  // that is then written again with each decision's outcomes under it: only the outcomes are held meanwhile.
  const citizenDecisions = lines(join(outDir, "citizen_decisions.part.jsonl"));
  const citizenOutcomes = lines(join(outDir, "citizen_outcomes.jsonl"));
  // Each person's own record (docs/design/ai-citizens.md 10d, 10h): every change to it, as the kernel took it; and,
  // from the record rebuilt as the log is read, a row a person a period of what a log can show of them.
  const citizenRecords = lines(join(outDir, "citizen_records.jsonl"));
  const citizenPeriods = lines(join(outDir, "citizen_periods.jsonl"));
  // What became of wants (docs/design/ai-citizens.md 10a, 10h), people's and organisations': a row each time one was
  // born, gone after (and by what way; "wait": nothing was done), met, given up, grew, gave way to a heavier one, or
  // was withdrawn from. Read from the reasons recorded with each change to a record, so lean logs have them too.
  // Nothing here is scored.
  const wantRows = lines(join(outDir, "wants.jsonl"));
  const wantCounts = { people: {} as { [event: string]: { [what: string]: number } }, organisations: {} as { [event: string]: { [what: string]: number } } };
  const wantsOf = { people: new Set<string>(), organisations: new Map<string, { [event: string]: number }>() };
  // Everyday frictions and the venues that hear them (docs/behaviour/frictions.md, "What a log can show"): a row
  // each time something went wrong for a person or stopped being so (from their record's reasons, so lean logs have
  // them), and a row for each paper a grievance travelled on (asked, answered, applied, told, decided). Counted in
  // the manifest by kind; nothing is scored.
  const frictionRows = lines(join(outDir, "frictions.jsonl"));
  const venueRows = lines(join(outDir, "venues.jsonl"));
  const frictionCounts = { arose: {} as { [k: string]: number }, ended: {} as { [k: string]: number }, papers: {} as { [k: string]: number }, findings: {} as { [k: string]: number } };
  const PAPERS: { [kind: string]: string } = { review_request: "request", remedy_answer: "answer", application: "application", tribunal_application: "application", complaint_notice: "notice", hearing_notice: "notice",
    complaint_response: "response", tribunal_response: "response", venue_decision: "decision", tribunal_order: "decision", enforcement_request: "enforcement", repair_order: "repair_order", repair_done: "repair_done" };
  // Founding and the lineage of every idea (docs/design/ai-citizens.md 10h; docs/behaviour/founding.md, "What a log
  // can show"): each thing founded, with what a composing model would be shown for it; each idea (a statement put
  // forward to be held: a world's teaching, a founded thing's statement of purpose), who wrote it (the world, a
  // person's own plain words, the composing model for a person) and how it reached the log; each time an idea passed
  // to someone (they joined, they were told, their belief moved, they left); and what became of each part of a
  // composed piece on its way through the translator. Counted in the manifest; nothing is scored.
  const foundedRows = lines(join(outDir, "founded.jsonl"));
  const ideaRows = lines(join(outDir, "ideas.jsonl"));
  const passageRows = lines(join(outDir, "idea_passages.jsonl"));
  const wordRows = lines(join(outDir, "words.jsonl"));
  // Readings of seats' worded papers (docs/behaviour/reading.md): the training data of a small reader of our own.
  const readingRows = lines(join(outDir, "readings.jsonl"));
  const ideaOf = new Map<string, string>(); // whoever teaches or stands for it -> its latest idea
  const ideaCounts = { written_by: {} as { [k: string]: number }, passages: {} as { [k: string]: number }, founded: {} as { [k: string]: number }, words: {} as { [k: string]: number }, composer: {} as { [k: string]: number } };
  const bump = (c: { [k: string]: number }, k: string) => { c[k] = (c[k] ?? 0) + 1; };
  let worldIdeas = false;
  const persons = new Set<string>(); // participants whose own record is a person's
  let actsByPeople = 0, actsOnInitiative = 0;
  const records = new Records();
  let recordSet: { seq: number; t: number; participant: string; set: any; because?: unknown[]; organisation?: boolean } | undefined;
  let recordFaults = 0;
  let largestRecord = 0;
  const decisionSeqs: number[] = []; // each decision row's place in the log, in the order written
  const decisionOf = new Map<string, Map<number, { seq: number; t: number; domain: string }>>(); // citizen -> its own number -> its latest decision of that number
  const outcomesOf = new Map<number, string[]>(); // a decision's seq -> its outcomes, as they will be written under it
  let numbered = false; // the run numbered its citizens' decisions: it recorded outcomes with them
  const byDomain = new Map<string, { decisions: number; with_outcome: number; outcomes: number }>();
  const by = (domain: string) => {
    let x = byDomain.get(domain);
    if (!x) byDomain.set(domain, (x = { decisions: 0, with_outcome: 0, outcomes: 0 }));
    return x;
  };
  // An act takes time: the log says it started (naming the act's command), and later that it was applied or refused
  // (naming the action, and as its cause the step of the clock that ended it, not the act). So an act is joined to
  // how it ended by its action; and what it made is the records and letters written straight after it was applied.
  // (Until 2026-10-09 the end was looked for under the act's own command, where it never is once acts take time:
  // every refused act was written as applied.)
  const ends = actEnds();
  const underWay = ends.underWay;
  let applying: { seq: number; cause: number } | undefined; // the act just applied, whose records follow
  const ended = (b: any): number => ends.ended(b);
  // (In the order given, each once how its act ended is known; an act still under way holds back those after it.)
  const flushActions = (before: number) => {
    for (const [seq, row] of actionRows) {
      if (seq >= before || underWay.has(seq)) break;
      actions!.write(row);
      actionRows.delete(seq);
    }
  };
  const tr = (draft: string, t: number, participant = "") => {
    let x = translations.get(draft);
    if (!x) translations.set(draft, (x = { run: run(), draft, t, participant, synthetic: false, exchange: [], retries: [], result: "unknown" }));
    return x;
  };

  for await (const line of logLines(logPath)) {
    if (!line) continue;
    const e = JSON.parse(line);
    entries++;
    lastHash = e.hash ?? lastHash;
    lastT = e.t ?? lastT;
    const b = e.body ?? {};
    if (e.kind === "header") {
      header = b;
      // (The ideas a world begins with: what its groups teach, written by whoever made the world.)
      if (!worldIdeas) for (const r of (b.config?.world?.records ?? []) as any[]) {
        if (r?.record !== "statement" || !r.assertion || (r.kind !== "teaching" && r.kind !== "purpose")) continue;
        worldIdeas = true;
        const of = String(r.speaks_for ?? r.author);
        ideaOf.set(of, String(r.id));
        ideaRows.write({ run: run(), t: 0, seq: 0, idea: String(r.id), kind: String(r.kind), of, written_by: "world", via: "world", text: String(r.text ?? "") });
        bump(ideaCounts.written_by, "world");
      }
      continue;
    }
    if (e.kind === "end") end = { reason: String(b.reason), ...(b.detail ? { detail: String(b.detail) } : {}) };
    if (e.kind !== "event") applying = undefined;
    if (actions && e.seq !== undefined && e.kind !== "event") flushActions(e.seq);
    if (e.kind === "annotation") {
      const a = b.annotation;
      if (a === "orchestrator") orch = { ...b.data, ...(engineModules ? { modules: { ...engineModules, ...(b.data?.modules ?? {}) } } : {}) };
      // (The Rust world: the engine's note of the modules it runs, beside the host's own record of its seats' brains.)
      else if (a === "note" && b.data?.engine?.modules) {
        engineModules = b.data.engine.modules;
        if (orch.version !== undefined) orch = { ...orch, modules: { ...engineModules, ...(orch.modules ?? {}) } };
      }
      else if (a === "usage") pendingUsage.set(b.subject, { input: b.input_tokens, output: b.output_tokens, cost_microusd: b.cost_microusd });
      else if (a === "transcript") {
        const d = b.data ?? {};
        if (d.system_sha256 && d.system) systems.set(d.system_sha256, d.system);
        const model = `${d.provider}/${d.model}`;
        if (d.purpose === "translator" && d.ref) {
          takeTurn(tr(d.ref, e.t), d);
        } else if (d.purpose === "debrief" || d.purpose === "account") {
          // A seat's debrief and an author's exit account are not decisions, and are never training examples
          // (VISION 15, point 7): they are in debriefs.jsonl and accounts.jsonl, by what the seat allowed (debriefs.ts).
          pendingUsage.delete(b.subject);
        } else if (d.purpose !== "translator") {
          const usage = pendingUsage.get(b.subject);
          pendingUsage.delete(b.subject);
          const came = back.get(b.subject);
          back.delete(b.subject);
          const dec: Decision = { run: run(), t: e.t, participant: b.subject, purpose: d.purpose, model, synthetic: d.provider === "mock", system_sha256: d.system_sha256,
            turn: d.turn, input: d.input, output: d.output, ...(usage ? { tokens: usage } : {}), commands: [], drafts: [], ...(came?.length ? { came_back: came } : {}) };
          decisions.push(dec);
          openDecision.set(b.subject, dec);
        }
      } else if (a === "draft") {
        const d = b.draft;
        Object.assign(tr(d.id, e.t, d.participant), { participant: d.participant, ...(d.as ? { as: d.as } : {}), proposal: d.proposal, result: "drafted", translator: d.translator, call: d.call, blocks: d.blocks, summary: d.summary, check: d.check, ...(d.caveats ? { caveats: d.caveats } : {}) });
        const dec = openDecision.get(d.participant);
        if (dec && !dec.drafts.includes(d.id)) dec.drafts.push(d.id);
      } else if (a === "translation_failure") {
        const d = b.data ?? {};
        Object.assign(tr(d.draft, e.t, b.subject), { participant: b.subject, proposal: d.proposal, result: "failed", failure: { reason: d.reason, ...(d.call ? { call: d.call } : {}), ...(d.invalid ? { invalid: d.invalid } : {}), ...(d.raw ? { raw: d.raw } : {}) } });
        const dec = openDecision.get(b.subject);
        if (dec && !dec.drafts.includes(d.draft)) dec.drafts.push(d.draft);
      } else if (a === "note" && b.data?.translation_route) {
        // Two translators as one: who answered, and what each said. The example's exchange, model and system prompt
        // are then those of the one whose answer was used; the other's answer is in the route (corpus.ts).
        takeRoute(tr(String(b.data.translation_route.draft), e.t, b.subject), b.data.translation_route);
      } else if (a === "note" && b.data?.translation_retry) {
        const r = b.data.translation_retry;
        tr(r.draft, e.t, b.subject).retries.push({ attempt: r.attempt, reason: r.reason, ...(r.call ? { call: r.call } : {}) });
      } else if (a === "note" && b.data?.draft_unanswered) {
        // (Shown to its seat and never answered: the run ended first. Neither declined nor confirmed.)
        tr(b.data.draft_unanswered.draft, e.t, b.subject).signoff = { decision: "unanswered", note: b.data.draft_unanswered.why };
      } else if (a === "signoff") {
        tr(b.draft, e.t, b.participant).signoff = { decision: b.decision, ...(b.note ? { note: b.note } : {}) };
        const dec = openDecision.get(b.participant);
        if (dec && !dec.drafts.includes(b.draft)) dec.drafts.push(b.draft);
      } else if (a === "decision") {
        // (With where it stands in the log: what that citizen did and what came of it is what follows there, in
        // actions.jsonl by `seq`. What it had before it, as the mind was given it, where the record has it.)
        const d = b.data ?? {};
        const area = by(String(d.domain));
        area.decisions++;
        decisionSeqs.push(e.seq);
        // (Numbered by the citizen: what it later learns of how the choice went names it by that number. A log made
        // before outcomes were recorded has no numbers, and its rows say nothing of outcomes.)
        if (Number.isInteger(d.n)) {
          numbered = true;
          let mine = decisionOf.get(b.subject);
          if (!mine) decisionOf.set(b.subject, (mine = new Map()));
          mine.set(d.n, { seq: e.seq, t: d.t ?? e.t, domain: String(d.domain) });
        }
        citizenDecisions.write({ run: run(), t: d.t ?? e.t, seq: e.seq, participant: b.subject, ...(Number.isInteger(d.n) ? { n: d.n } : {}), ...(Number.isInteger(d.follows) ? { follows: d.follows } : {}),
          domain: d.domain, strategy: d.strategy, ...(d.choice !== undefined ? { choice: d.choice } : {}), options: d.options ?? [],
          ...(d.current !== undefined ? { current: d.current } : {}), ...(d.circumstances ? { circumstances: d.circumstances } : {}), ...(d.satisfied_here !== undefined ? { satisfied_here: d.satisfied_here } : {}),
          ...(d.doubt !== undefined ? { doubt: d.doubt } : {}), ...(d.person ? { person: d.person } : {}), ...(d.state ? { state: d.state } : {}), ...(d.situation ? { situation: d.situation } : {}) });
      } else if (a === "note" && b.data?.words) {
        const w = b.data.words;
        wordRows.write({ run: run(), t: e.t, seq: e.seq, participant: b.subject, what: String(w.what), ...(w.idea ? { idea: w.idea } : {}), ...(w.draft ? { draft: w.draft } : {}), result: w.result, ...(w.why ? { why: w.why } : {}), ...(w.by ? { by: w.by } : {}), ...(w.plumbing_added ? { plumbing_added: true } : {}) });
        bump(ideaCounts.words, `${w.what}: ${w.result}`);
      } else if (a === "note" && b.data?.reading?.paper) {
        const r = b.data.reading;
        readingRows.write({ run: run(), t: e.t, seq: e.seq, paper: r.paper, kind: r.kind, standing: r.standing, ...(r.text !== undefined ? { text: r.text, text_hash: r.text_hash } : {}), ...(r.answers_text !== undefined ? { answers_text: r.answers_text } : {}),
          source: r.source, ...(r.askings !== undefined ? { askings: r.askings } : {}), reader: r.reader, ...(r.reading ? { reading: r.reading } : {}), ...(r.plain ? { plain: r.plain } : {}), shift: r.shift, ...(r.apart ? { apart: r.apart } : {}) });
      } else if (a === "note" && b.data?.compose) {
        const c = b.data.compose;
        if (c.result) bump(ideaCounts.composer, `${c.result}${c.model ? `: ${c.model}` : ""}`);
        if (c.result && Array.isArray(c.dark) && c.dark.length) bump(ideaCounts.composer, "dark pieces asked for");
        if (c.fell_back) bump(ideaCounts.composer, `fell back: ${c.fell_back.from} to ${c.fell_back.to}`);
        if (c.follow_up) bump(ideaCounts.composer, "asked afterwards about the task");
      } else if (a === "outcome") {
        // What a citizen came to know of how its choices turned out (one entry holds all it learned since its last
        // action): a row each, and each kept for the decision it follows, to be written under it.
        for (const o of (b.data?.outcomes ?? []) as any[]) {
          // (Founding, and ideas passing: docs/design/ai-citizens.md 10h.)
          if (o.domain === "found" && o.kind === "founded") {
            foundedRows.write({ run: run(), t: o.t ?? e.t, seq: e.seq, founder: b.subject, shape: o.option, ...(o.facts ?? {}), ...(o.brief ? { brief: o.brief } : {}) });
            bump(ideaCounts.founded, String(o.option));
            if (o.facts?.org && o.facts?.idea) ideaOf.set(String(o.facts.org), String(o.facts.idea));
          }
          const host = o.belief?.host ?? (o.domain === "membership" && ["joined", "left", "wound_up"].includes(o.kind) ? o.facts?.with : undefined);
          if (host !== undefined && ideaOf.has(String(host)) && (o.domain === "membership" || o.belief.before !== o.belief.after)) {
            const how = o.domain === "membership" ? String(o.kind) : `${o.domain}:${o.kind}`;
            passageRows.write({ run: run(), t: o.t ?? e.t, seq: e.seq, idea: ideaOf.get(String(host))!, of: String(host), to: b.subject, how, ...(o.from !== undefined ? { from: o.from } : {}), ...(o.belief ? { before: o.belief.before, after: o.belief.after } : {}) });
            bump(ideaCounts.passages, how);
          }
          const dec = Number.isInteger(o.of) ? decisionOf.get(b.subject)?.get(o.of) : undefined;
          const said = { ...(o.from !== undefined ? { from: o.from } : {}), ...(o.facts ? { facts: o.facts } : {}), ...(o.learned ? { learned: o.learned } : {}), ...(o.need !== undefined ? { need: o.need } : {}),
            ...(o.felt ? { felt: o.felt } : {}), ...(o.belief ? { belief: o.belief } : {}), ...(o.read ? { read: o.read } : {}) };
          citizenOutcomes.write({ run: run(), t: o.t ?? e.t, seq: e.seq, participant: b.subject, domain: o.domain, option: o.option, ...(Number.isInteger(o.of) ? { of: o.of } : {}),
            ...(dec ? { decision_seq: dec.seq, decision_t: dec.t } : {}), kind: o.kind, way: o.way, ...said });
          by(String(o.domain)).outcomes++;
          if (!dec) continue;
          let under = outcomesOf.get(dec.seq);
          if (!under) {
            outcomesOf.set(dec.seq, (under = []));
            by(dec.domain).with_outcome++;
          }
          under.push(JSON.stringify({ t: o.t ?? e.t, seq: e.seq, option: o.option, kind: o.kind, way: o.way, ...said }));
        }
      } else if (a === "observation") {
        if (models().has(b.subject)) cameBack(b.subject, b.data?.observation);
        observations.write({ run: run(), t: b.data?.t ?? e.t, participant: b.subject, ...(b.data?.as ? { as: b.data.as } : {}), observation: b.data?.observation });
      }
    } else if (e.kind === "event" && b.event === "entity_recorded" && recordSet && b.cause === recordSet.seq) {
      const before = records.of.get(b.entity)?.faults.length ?? 0;
      const r = records.apply({ ...recordSet, entity: b.entity, n: b.n, chain: b.chain, digest: b.digest });
      recordFaults += r.faults.length - before;
      largestRecord = Math.max(largestRecord, r.bytes);
      citizenRecords.write({ run: run(), t: recordSet.t, seq: recordSet.seq, participant: recordSet.participant, entity: b.entity, n: b.n, set: recordSet.set, ...(recordSet.because ? { because: recordSet.because } : {}), chain: b.chain });
      for (const x of (recordSet.because ?? []) as any[]) {
        if (typeof x?.what === "string" && x.what.startsWith("friction_")) {
          const event = x.what.slice(9) as "arose" | "ended";
          const how = event === "ended" ? String(x.by ?? "").split(";")[0]! : "";
          frictionRows.write({ run: run(), t: x.t ?? recordSet.t, seq: recordSet.seq, entity: b.entity, event, matter: x.about ?? "", ...(event === "arose" ? { against: String(x.by ?? ""), size: x.size ?? 0 } : { how: String(x.by ?? ""), days: x.size ?? 0 }) });
          const key = event === "arose" ? String(x.about ?? "") : `${x.about ?? ""}: ${how}`;
          frictionCounts[event][key] = (frictionCounts[event][key] ?? 0) + 1;
          continue;
        }
        if (typeof x?.what !== "string" || !x.what.startsWith("want_")) continue;
        const event = x.what.slice(5);
        const org = !!recordSet.organisation;
        wantRows.write({ run: run(), t: x.t ?? recordSet.t, seq: recordSet.seq, entity: b.entity, ...(org ? { organisation: true } : {}), event, about: x.about ?? "", weight: x.size ?? 0, ...(x.by ? { by: x.by } : {}) });
        const counts = org ? wantCounts.organisations : wantCounts.people;
        const key = event === "pursued" ? String(x.by ?? "") : String(x.about ?? "");
        (counts[event] ??= {})[key] = (counts[event]![key] ?? 0) + 1;
        if (org) { const o = wantsOf.organisations.get(b.entity) ?? {}; o[event] = (o[event] ?? 0) + 1; wantsOf.organisations.set(b.entity, o); }
        else wantsOf.people.add(b.entity);
        if (!org && event === "pursued" && x.by !== "wait") actsOnInitiative++;
      }
      if (!recordSet.organisation) persons.add(recordSet.participant);
      if (recordSet.set.hours) {
        const row = periodRow(r, recordSet.t);
        if (row) citizenPeriods.write({ run: run(), ...row });
      }
      recordSet = undefined;
    } else if (e.kind === "command" && b.command === "entity_record") {
      recordSet = { seq: e.seq, t: e.t, participant: b.participant, set: b.set, ...(b.because ? { because: b.because } : {}), ...(b.entity !== undefined ? { organisation: true } : {}) };
    } else if (e.kind === "command") {
      const who = b.participant;
      if (b.command === "act" && !b.as && persons.has(who)) actsByPeople++;
      if (b.command === "act") for (const blk of (b.blocks ?? []) as any[]) {
        const paper = blk?.block === "publish" ? PAPERS[String(blk.kind)] : undefined;
        const d = blk?.data ?? {};
        const matter = String(d.matter ?? d.kind ?? (paper === "enforcement" || paper?.startsWith("repair") ? paper : ""));
        // (A tribunal's older lists, a rent increase, a debt and a charge, travel on the same forms: they are venue rows too.)
        if (!paper || !matter) continue;
        venueRows.write({ run: run(), t: e.t, seq: e.seq, paper, kind: String(blk.kind), by: String(blk.speaks_for ?? who), ...(Array.isArray(blk.addressed_to) ? { to: blk.addressed_to.map(String) } : {}), matter,
          ...(d.against ? { against: String(d.against) } : {}), ...(d.applicant ? { applicant: String(d.applicant) } : {}), ...(d.finding ? { finding: String(d.finding) } : {}), ...(d.binding !== undefined ? { binding: d.binding !== false } : {}),
          ...(d.granted !== undefined ? { granted: !!d.granted } : {}), ...(Number.isFinite(Number(d.amount)) && d.amount !== undefined ? { amount: Math.round(Number(d.amount)) } : {}), ...(Number.isInteger(d.waited_days) ? { waited_days: d.waited_days } : {}) });
        const key = `${paper}: ${matter}`;
        frictionCounts.papers[key] = (frictionCounts.papers[key] ?? 0) + 1;
        if (paper === "decision" && d.finding) { const f = `${String(blk.speaks_for ?? who)}: ${matter}: ${d.finding}`; frictionCounts.findings[f] = (frictionCounts.findings[f] ?? 0) + 1; }
      }
      // An idea put out in the run: a statement put forward to be held, with who wrote its words.
      if (b.command === "act") for (const blk of (b.blocks ?? []) as any[]) {
        const d = blk?.data ?? {};
        // (A statement of what something is for, or one that names its idea: a report or a promise put forward to be
        // believed is not an idea in this sense.)
        if (blk?.block !== "publish" || !blk.assertion || blk.visible_to !== "public" || (blk.kind !== "purpose" && blk.kind !== "teaching" && !d.idea)) continue;
        const of = String(blk.speaks_for ?? who);
        const idea = String(d.idea ?? `idea.${of}.${e.seq}`);
        const writer = String(d.written_by ?? "code");
        ideaOf.set(of, idea);
        ideaRows.write({ run: run(), t: e.t, seq: e.seq, idea, kind: String(blk.kind), of, written_by: writer, ...(d.model ? { model: String(d.model) } : {}), ...(d.for ? { for: String(d.for) } : {}), via: String(b.provenance?.via ?? "direct"), text: String(blk.text ?? "") });
        bump(ideaCounts.written_by, writer === "composer" && d.model ? `composer: ${d.model}` : writer);
      }
      if (b.command === "act" && b.provenance?.via === "translator" && b.provenance.draft) {
        bySeqDraft.set(e.seq, b.provenance.draft);
        tr(b.provenance.draft, e.t, who).executed = { seq: e.seq, applied: true };
      }
      if (["act", "look", "opt_out"].includes(b.command) && models().has(who)) {
        const dec = openDecision.get(who);
        if (dec) {
          const c: Command = { seq: e.seq, command: b.command, ...(b.as ? { as: b.as } : {}), ...(b.blocks ? { blocks: b.blocks } : {}), ...(b.looks ? { looks: b.looks } : {}),
            ...(b.provenance ? { provenance: b.provenance } : {}), ...(b.reasoning ? { reasoning: b.reasoning } : {}), ...(b.command === "act" ? { applied: true } : {}) };
          dec.commands.push(c);
          commandBySeq.set(e.seq, c);
          seatOf.set(e.seq, who);
        }
      } else if (actions && b.command === "act") {
        actionRows.set(e.seq, { run: run(), t: e.t, seq: e.seq, participant: who, ...(b.as ? { as: b.as } : {}), ...(b.reasoning ? { reasoning: b.reasoning } : {}),
          ...(b.provenance?.call ? { call: b.provenance.call } : {}), blocks: b.blocks ?? [], applied: true });
      }
    } else if (e.kind === "event" && b.event === "action_started" && typeof b.action === "string") {
      ends.started(b);
      applying = undefined;
    } else if (e.kind === "event" && b.event === "action_applied") {
      const seq = ended(b);
      applying = { seq, cause: b.cause };
      // (What it made and gave a name to; the rest follows as the records themselves.)
      for (const id of Object.values(b.created ?? {})) if (typeof id === "string") made(seq, id);
    } else if (e.kind === "event" && b.event === "recorded" && typeof b.record?.id === "string") {
      if (applying && b.cause === applying.cause) made(applying.seq, b.record.id);
    } else if (e.kind === "event" && b.event === "message_delivered" && typeof b.message === "string") {
      if (applying && b.cause === applying.cause) made(applying.seq, b.message);
    } else if (e.kind === "event" && b.event === "action_refused") {
      const seq = ended(b);
      applying = undefined;
      const refusal = { code: b.code, ...(b.detail ? { detail: b.detail } : {}) };
      const draft = bySeqDraft.get(seq);
      if (draft) translations.get(draft)!.executed = { seq, applied: false, refusal };
      const c = commandBySeq.get(seq);
      if (c) Object.assign(c, { applied: false, refusal });
      const row = actionRows.get(seq);
      if (row) Object.assign(row, { applied: false, refusal });
    }
  }
  // (An act still under way when the log ends was neither applied nor refused: its row does not say.)
  for (const seq of underWay) {
    delete commandBySeq.get(seq)?.applied;
    delete actionRows.get(seq)?.applied;
  }
  underWay.clear();
  if (actions) flushActions(Infinity);

  const files: Record<string, { rows: number; synthetic: number }> = {};
  const sys = lines(join(outDir, "systems.jsonl"));
  for (const [sha256, text] of [...systems].sort(([a], [b]) => (a < b ? -1 : 1))) sys.write({ run: run(), sha256, text });
  files["systems.jsonl"] = await sys.close();
  const trw = lines(join(outDir, "translations.jsonl"));
  for (const x of [...translations.values()].sort((a, b) => a.t - b.t || (a.draft < b.draft ? -1 : 1))) trw.write(x);
  files["translations.jsonl"] = await trw.close();
  const dw = lines(join(outDir, "decisions.jsonl"));
  for (const d of decisions) dw.write(d);
  files["decisions.jsonl"] = await dw.close();
  if (actions) files["actions.jsonl"] = await actions.close();
  // Citizens' decisions, each with what the citizen came to know of how it turned out (none: an empty list, where
  // the run recorded outcomes at all; a log from before it did says nothing of them).
  const cd = await citizenDecisions.close();
  const part = join(outDir, "citizen_decisions.part.jsonl");
  if (cd.rows) {
    const w = Bun.file(join(outDir, "citizen_decisions.jsonl")).writer();
    let i = 0;
    for await (const row of logLines(part)) {
      if (!row) continue;
      const seq = decisionSeqs[i++]!;
      w.write(numbered ? `${row.slice(0, -1)},"outcomes":[${(outcomesOf.get(seq) ?? []).join(",")}]}\n` : `${row}\n`);
    }
    await w.end();
    files["citizen_decisions.jsonl"] = cd;
  }
  await Bun.file(part).delete();
  const co = await citizenOutcomes.close();
  if (co.rows) files["citizen_outcomes.jsonl"] = co;
  else await Bun.file(join(outDir, "citizen_outcomes.jsonl")).delete();
  for (const [name, w] of [["citizen_records.jsonl", citizenRecords], ["citizen_periods.jsonl", citizenPeriods]] as const) {
    const x = await w.close();
    if (x.rows) files[name] = x;
    else await Bun.file(join(outDir, name)).delete();
  }
  const wr = await wantRows.close();
  if (wr.rows) files["wants.jsonl"] = wr;
  else await Bun.file(join(outDir, "wants.jsonl")).delete();
  const fr = await frictionRows.close();
  if (fr.rows) files["frictions.jsonl"] = fr;
  else await Bun.file(join(outDir, "frictions.jsonl")).delete();
  const vr = await venueRows.close();
  if (vr.rows) files["venues.jsonl"] = vr;
  else await Bun.file(join(outDir, "venues.jsonl")).delete();
  const lineage: { [name: string]: { rows: number } } = {};
  for (const [name, w] of [["founded.jsonl", foundedRows], ["ideas.jsonl", ideaRows], ["idea_passages.jsonl", passageRows], ["words.jsonl", wordRows], ["readings.jsonl", readingRows]] as const) {
    const x = await w.close();
    lineage[name] = x;
    if (x.rows) files[name] = x;
    else await Bun.file(join(outDir, name)).delete();
  }
  const obs = await observations.close();
  if (obs.rows) files["observations.jsonl"] = obs;
  else await Bun.file(join(outDir, "observations.jsonl")).delete();

  // Debriefs and exit accounts (VISION 15, point 7; docs/behaviour/debrief.md; debriefs.ts). debriefs.jsonl: what
  // seats said, by what each allowed to be published (a step kept back is a row that says so and nothing more).
  // debriefs.withheld.jsonl: what was kept back, in full; it stays with the run, and the README beside it says so.
  // accounts.jsonl: each exit account beside the person's own private and expressed views. Nothing is scored.
  const deb = await debriefsOf(logPath);
  const debRows = debriefRows(deb);
  const synth = (model: string) => model.startsWith("mock/");
  for (const [file, rs] of [["debriefs.jsonl", debRows.published], ["debriefs.withheld.jsonl", debRows.withheld], ["accounts.jsonl", accountRows(deb)]] as [string, any[]][]) {
    if (!rs.length) { if (await Bun.file(join(outDir, file)).exists()) await Bun.file(join(outDir, file)).delete(); continue; }
    const w = lines(join(outDir, file));
    const model = new Map(deb.seats.map((x) => [x.seat, x.record.model]));
    for (const r of rs) w.write({ ...r, ...(r.synthetic || (r.seat && synth(String(model.get(r.seat) ?? ""))) ? { synthetic: true } : {}) });
    files[file] = await w.close();
  }
  const debCounts = debriefCounts(deb);
  const hasDebriefs = deb.seats.length || deb.not_given.length || deb.accounts.length || deb.old.length;
  if (hasDebriefs) await Bun.write(join(outDir, "README.md"), datasetReadme(run(), !!debRows.withheld.length, !!deb.old.length));

  const config = header?.config ?? {};
  const manifest = {
    dataset: "oikos-run-dataset",
    version: DATASET_VERSION,
    run: run(),
    world: { name: config.meta?.name ?? run(), ...(config.meta?.description ? { description: config.meta.description } : {}), ...(Number.isInteger(config.seed) ? { seed: config.seed } : {}) },
    config_hash: header?.config_hash,
    initial_state_hash: header?.initial_state_hash,
    log: { file: basename(logPath), entries, last_hash: lastHash },
    versions: { contracts: header?.contracts, kernel: header?.kernel ?? {}, orchestrator: orch.version ?? "", ...(orch.modules ? { modules: orch.modules } : {}), ...(orch.llm?.translator ? { translator: orch.llm.translator } : {}) },
    // (How the run was put to its seats: VISION 15, point 1. From the world's config as the log's header has it.)
    seats: { models: orch.llm?.participants ?? {}, ...(orch.llm?.prices ? { prices: orch.llm.prices } : {}), ...(framingOf(config).length ? { framing: framingOf(config) } : {}) },
    // How the log itself says it ended: completed, or aborted or error with why (a run cut short, or stopped at a
    // limit); a log with no end entry is a run that was killed, or is still going.
    end: { t: lastT, reason: !end ? "unfinished: the log has no end entry" : end.detail ? `${end.reason}: ${end.detail}` : end.reason },
    // What the run recorded for citizen models: by area of life, the decisions, those the citizen learned at least one
    // outcome of, and the outcomes (those that follow no recorded decision among them).
    ...(cd.rows ? { citizens: { decisions: cd.rows, outcomes: co.rows, by_domain: Object.fromEntries([...byDomain].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) } } : {}),
    // People's own records: how many people have one, the changes to them, the most any record ever held (bytes: it
    // never grows past the world's cap), and how many links of their chains did not hold when rebuilt (0, or a fault).
    ...(records.of.size ? { records: { entities: records.of.size, changes: [...records.of.values()].reduce((x, r) => x + r.n, 0), largest_bytes: largestRecord, chain_faults: recordFaults } } : {}),
    // Wants (docs/design/ai-citizens.md 10h): how many were born, met, given up, withdrawn from, by what they were
    // about; how often each way was taken; for people and for organisations; and people's acts taken on initiative
    // (a want gone after by some way other than waiting) beside all their acts (the rest answer the world, or are
    // routine). Counted, never scored.
    ...(wr.rows ? { wants: { people: { holders: wantsOf.people.size, ...sorted(wantCounts.people) }, organisations: { holders: wantsOf.organisations.size, ...sorted(wantCounts.organisations) },
      acts: { by_people: actsByPeople, on_initiative: actsOnInitiative } } } : {}),
    // Everyday frictions (docs/behaviour/frictions.md): what arose, by matter; how each ended, by matter and how;
    // the papers grievances travelled on, by paper and matter; and what venues found, by venue, matter and finding.
    ...(fr.rows || vr.rows ? { frictions: { arose: sortedCounts(frictionCounts.arose), ended: sortedCounts(frictionCounts.ended), papers: sortedCounts(frictionCounts.papers), findings: sortedCounts(frictionCounts.findings) } } : {}),
    // Founding and ideas (docs/design/ai-citizens.md 10h): things founded, by shape; ideas, by who wrote them (the
    // world, a person's own plain words, the composing model and which); how often an idea passed to someone, by how;
    // what the composer was asked and answered, with the dark pieces a run asked for (VISION 15, point 7); and what
    // came of each part of a piece sent through the translator.
    ...(lineage["ideas.jsonl"]!.rows || lineage["founded.jsonl"]!.rows ? { ideas: { founded: sortedCounts(ideaCounts.founded), written_by: sortedCounts(ideaCounts.written_by), passages: sortedCounts(ideaCounts.passages),
      ...(Object.keys(ideaCounts.composer).length ? { composer: sortedCounts(ideaCounts.composer) } : {}), ...(Object.keys(ideaCounts.words).length ? { words: sortedCounts(ideaCounts.words) } : {}) } } : {}),
    // Debriefs and exit accounts: who was asked and how each debrief ended, what was kept back (counted, never
    // shown), the scaled items as given, the accounts asked for and declined, and the dark pieces the run asked a
    // model to write. And the restriction on the debrief files' use, which travels with them.
    ...(hasDebriefs ? { debriefs: debCounts, restrictions: { "debriefs.jsonl": DEBRIEF_RESTRICTION, ...(debRows.withheld.length ? { "debriefs.withheld.jsonl": "NOT FOR PUBLICATION. " + DEBRIEF_RESTRICTION } : {}), ...(deb.old.length ? { [basename(logPath)]: "NOT FOR PUBLICATION. " + OLD_LOG_NOT_PUBLISHABLE } : {}) } } : {}),
    files,
  };
  await Bun.write(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const sorted = (c: { [event: string]: { [what: string]: number } }) => Object.fromEntries(Object.keys(c).sort().map((e) => [e, Object.fromEntries(Object.keys(c[e]!).sort().map((k) => [k, c[e]![k]!]))]));

/** The dataset folder for a log: next to it, `<run>.dataset/` (or under `outRoot`). */
export function datasetDirFor(logPath: string, outRoot?: string): string {
  const name = `${runOf(logPath)}.dataset`;
  return join(outRoot ?? (statSync(logPath).isDirectory() ? logPath : join(logPath, "..")), name);
}
