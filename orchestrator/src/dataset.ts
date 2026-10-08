// Run datasets (docs/design/run-datasets.md; contracts/dataset.schema.json): a run's data, derived from its log in one
// streaming pass, joined and flattened into examples a training run can use. The log stays the record: a dataset can
// always be made again from it. The same log always gives the same dataset, byte for byte.

import { mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { logLines, runOf } from "./logs";
import type { CorpusExample } from "./corpus";

export const DATASET_VERSION = "0.2.0";

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
  const citizenDecisions = lines(join(outDir, "citizen_decisions.jsonl"));
  // An act takes time: the log says it started (naming the act's command), and later that it was applied or refused
  // (naming the action, and as its cause the step of the clock that ended it, not the act). So an act is joined to
  // how it ended by its action; and what it made is the records and letters written straight after it was applied.
  // (Until 2026-10-09 the end was looked for under the act's own command, where it never is once acts take time:
  // every refused act was written as applied.)
  const startedBy = new Map<string, number>(); // an action under way -> the command that began it
  const underWay = new Set<number>(); // commands whose action has started and not yet ended
  let applying: { seq: number; cause: number } | undefined; // the act just applied, whose records follow
  const actOf = (b: any): number => (typeof b.action === "string" && startedBy.has(b.action) ? startedBy.get(b.action)! : b.cause);
  const ended = (b: any): number => {
    const seq = actOf(b);
    if (typeof b.action === "string") startedBy.delete(b.action);
    underWay.delete(seq);
    return seq;
  };
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
          const x = tr(d.ref, e.t);
          Object.assign(x, { model, synthetic: d.provider === "mock", system_sha256: d.system_sha256 });
          x.exchange.push({ turn: d.turn, input: d.input, output: d.output });
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
      } else if (a === "note" && b.data?.translation_retry) {
        const r = b.data.translation_retry;
        tr(r.draft, e.t, b.subject).retries.push({ attempt: r.attempt, reason: r.reason, ...(r.call ? { call: r.call } : {}) });
      } else if (a === "signoff") {
        tr(b.draft, e.t, b.participant).signoff = { decision: b.decision, ...(b.note ? { note: b.note } : {}) };
        const dec = openDecision.get(b.participant);
        if (dec && !dec.drafts.includes(b.draft)) dec.drafts.push(b.draft);
      } else if (a === "decision") {
        // (With where it stands in the log: what that citizen did and what came of it is what follows there, in
        // actions.jsonl by `seq`. What it had before it, as the mind was given it, where the record has it.)
        const d = b.data ?? {};
        citizenDecisions.write({ run: run(), t: d.t ?? e.t, seq: e.seq, participant: b.subject, domain: d.domain, strategy: d.strategy, ...(d.choice !== undefined ? { choice: d.choice } : {}), options: d.options ?? [],
          ...(d.current !== undefined ? { current: d.current } : {}), ...(d.circumstances ? { circumstances: d.circumstances } : {}), ...(d.satisfied_here !== undefined ? { satisfied_here: d.satisfied_here } : {}),
          ...(d.doubt !== undefined ? { doubt: d.doubt } : {}), ...(d.person ? { person: d.person } : {}), ...(d.state ? { state: d.state } : {}) });
      } else if (a === "observation") {
        if (models().has(b.subject)) cameBack(b.subject, b.data?.observation);
        observations.write({ run: run(), t: b.data?.t ?? e.t, participant: b.subject, ...(b.data?.as ? { as: b.data.as } : {}), observation: b.data?.observation });
      }
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
      startedBy.set(b.action, b.cause);
      underWay.add(b.cause);
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
  const cd = await citizenDecisions.close();
  if (cd.rows) files["citizen_decisions.jsonl"] = cd;
  else await Bun.file(join(outDir, "citizen_decisions.jsonl")).delete();
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
