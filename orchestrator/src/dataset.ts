// Run datasets (docs/design/run-datasets.md; contracts/dataset.schema.json): a run's data, derived from its log in one
// streaming pass, joined and flattened into examples a training run can use. The log stays the record: a dataset can
// always be made again from it. The same log always gives the same dataset, byte for byte.

import { mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { logLines, runOf } from "./logs";
import type { CorpusExample } from "./corpus";

export const DATASET_VERSION = "0.1.0";

interface Command { seq: number; command: string; as?: string; blocks?: unknown[]; looks?: unknown[]; provenance?: unknown; reasoning?: string; applied?: boolean; refusal?: unknown }
interface Decision {
  run: string; t: number; participant: string; purpose?: string; model: string; synthetic: boolean; system_sha256: string; turn: number;
  input: unknown; output: unknown; tokens?: { input: number; output: number; cost_microusd: number }; commands: Command[]; drafts: string[];
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
  let stopped: string | undefined;
  const run = () => header?.run_id ?? runOf(logPath);
  const systems = new Map<string, string>();
  const translations = new Map<string, CorpusExample>();
  const bySeqDraft = new Map<number, string>(); // command seq -> draft (a translation carried out)
  const models = () => new Set(Object.keys(orch.llm?.participants ?? {}));
  const decisions: Decision[] = [];
  const openDecision = new Map<string, Decision>(); // participant -> its latest decision (commands that follow join it)
  const pendingUsage = new Map<string, { input: number; output: number; cost_microusd: number }>();
  const commandBySeq = new Map<number, Command>();
  const actions = o.actions ? lines(join(outDir, "actions.jsonl")) : undefined;
  const actionRows = new Map<number, any>(); // seq -> row, until its outcome is known (the events follow at once)
  const observations = lines(join(outDir, "observations.jsonl"));
  const citizenDecisions = lines(join(outDir, "citizen_decisions.jsonl"));
  const flushActions = (before: number) => {
    for (const [seq, row] of actionRows) if (seq < before) {
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
    if (actions && e.seq !== undefined && e.kind !== "event") flushActions(e.seq);
    if (e.kind === "annotation") {
      const a = b.annotation;
      if (a === "orchestrator") orch = b.data ?? {};
      else if (a === "note" && b.data?.stopped) stopped = String(b.data.stopped);
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
          const dec: Decision = { run: run(), t: e.t, participant: b.subject, purpose: d.purpose, model, synthetic: d.provider === "mock", system_sha256: d.system_sha256,
            turn: d.turn, input: d.input, output: d.output, ...(usage ? { tokens: usage } : {}), commands: [], drafts: [] };
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
        citizenDecisions.write({ run: run(), t: b.data?.t ?? e.t, participant: b.subject, domain: b.data?.domain, strategy: b.data?.strategy, ...(b.data?.choice !== undefined ? { choice: b.data.choice } : {}), options: b.data?.options ?? [], ...(b.data?.state ? { state: b.data.state } : {}) });
      } else if (a === "observation") {
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
        }
      } else if (actions && b.command === "act") {
        actionRows.set(e.seq, { run: run(), t: e.t, seq: e.seq, participant: who, ...(b.as ? { as: b.as } : {}), ...(b.reasoning ? { reasoning: b.reasoning } : {}),
          ...(b.provenance?.call ? { call: b.provenance.call } : {}), blocks: b.blocks ?? [], applied: true });
      }
    } else if (e.kind === "event" && b.event === "action_refused") {
      const refusal = { code: b.code, ...(b.detail ? { detail: b.detail } : {}) };
      const draft = bySeqDraft.get(b.cause);
      if (draft) translations.get(draft)!.executed = { seq: b.cause, applied: false, refusal };
      const c = commandBySeq.get(b.cause);
      if (c) Object.assign(c, { applied: false, refusal });
      const row = actionRows.get(b.cause);
      if (row) Object.assign(row, { applied: false, refusal });
    }
  }
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
    end: { t: lastT, reason: stopped ?? "completed" },
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
