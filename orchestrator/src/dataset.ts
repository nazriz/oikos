// Run datasets (docs/design/run-datasets.md; contracts/dataset.schema.json): a run's data, derived from its log in one
// streaming pass, joined and flattened into examples a training run can use. The log stays the record: a dataset can
// always be made again from it. The same log always gives the same dataset, byte for byte.

import { mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { actEnds } from "./act-ends";
import { logLines, runOf } from "./logs";
import { takeRoute, takeTurn, type CorpusExample } from "./corpus";
import { periodRow, Records } from "./records";

export const DATASET_VERSION = "0.4.0";

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
  const records = new Records();
  let recordSet: { seq: number; t: number; participant: string; set: any; because?: unknown[] } | undefined;
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
      continue;
    }
    if (e.kind === "end") end = { reason: String(b.reason), ...(b.detail ? { detail: String(b.detail) } : {}) };
    if (e.kind !== "event") applying = undefined;
    if (actions && e.seq !== undefined && e.kind !== "event") flushActions(e.seq);
    if (e.kind === "annotation") {
      const a = b.annotation;
      if (a === "orchestrator") orch = b.data ?? {};
      else if (a === "usage") pendingUsage.set(b.subject, { input: b.input_tokens, output: b.output_tokens, cost_microusd: b.cost_microusd });
      else if (a === "transcript") {
        const d = b.data ?? {};
        if (d.system_sha256 && d.system) systems.set(d.system_sha256, d.system);
        const model = `${d.provider}/${d.model}`;
        if (d.purpose === "translator" && d.ref) {
          takeTurn(tr(d.ref, e.t), d);
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
          ...(d.doubt !== undefined ? { doubt: d.doubt } : {}), ...(d.person ? { person: d.person } : {}), ...(d.state ? { state: d.state } : {}) });
      } else if (a === "outcome") {
        // What a citizen came to know of how its choices turned out (one entry holds all it learned since its last
        // action): a row each, and each kept for the decision it follows, to be written under it.
        for (const o of (b.data?.outcomes ?? []) as any[]) {
          const dec = Number.isInteger(o.of) ? decisionOf.get(b.subject)?.get(o.of) : undefined;
          const said = { ...(o.from !== undefined ? { from: o.from } : {}), ...(o.facts ? { facts: o.facts } : {}), ...(o.learned ? { learned: o.learned } : {}), ...(o.need !== undefined ? { need: o.need } : {}),
            ...(o.felt ? { felt: o.felt } : {}), ...(o.belief ? { belief: o.belief } : {}) };
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
      if (recordSet.set.hours) {
        const row = periodRow(r, recordSet.t);
        if (row) citizenPeriods.write({ run: run(), ...row });
      }
      recordSet = undefined;
    } else if (e.kind === "command" && b.command === "entity_record") {
      recordSet = { seq: e.seq, t: e.t, participant: b.participant, set: b.set, ...(b.because ? { because: b.because } : {}) };
    } else if (e.kind === "command") {
      const who = b.participant;
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
  const obs = await observations.close();
  if (obs.rows) files["observations.jsonl"] = obs;
  else await Bun.file(join(outDir, "observations.jsonl")).delete();

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
    seats: { models: orch.llm?.participants ?? {}, ...(orch.llm?.prices ? { prices: orch.llm.prices } : {}) },
    // How the log itself says it ended: completed, or aborted or error with why (a run cut short, or stopped at a
    // limit); a log with no end entry is a run that was killed, or is still going.
    end: { t: lastT, reason: !end ? "unfinished: the log has no end entry" : end.detail ? `${end.reason}: ${end.detail}` : end.reason },
    // What the run recorded for citizen models: by area of life, the decisions, those the citizen learned at least one
    // outcome of, and the outcomes (those that follow no recorded decision among them).
    ...(cd.rows ? { citizens: { decisions: cd.rows, outcomes: co.rows, by_domain: Object.fromEntries([...byDomain].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) } } : {}),
    // People's own records: how many people have one, the changes to them, the most any record ever held (bytes: it
    // never grows past the world's cap), and how many links of their chains did not hold when rebuilt (0, or a fault).
    ...(records.of.size ? { records: { entities: records.of.size, changes: [...records.of.values()].reduce((x, r) => x + r.n, 0), largest_bytes: largestRecord, chain_faults: recordFaults } } : {}),
    files,
  };
  await Bun.write(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** The dataset folder for a log: next to it, `<run>.dataset/` (or under `outRoot`). */
export function datasetDirFor(logPath: string, outRoot?: string): string {
  const name = `${runOf(logPath)}.dataset`;
  return join(outRoot ?? (statSync(logPath).isDirectory() ? logPath : join(logPath, "..")), name);
}
