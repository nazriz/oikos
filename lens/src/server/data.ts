// The Data page's run table (/api/data/runs): the study's raw fields, one row per arm (the model's, and the rule-based
// twin's, steward kind "code") of every run under
// runs/ps-v2-*, read from the files as they are. Nothing here judges or labels: no "counted", no "lock-in", no status
// from Lens's own functions. Every column names the file and field it comes from (`source`), and its value is that
// field as written, or a count of things as written (records by kind, grade entries), or a day from a time in seconds
// (world day = whole days since t = 0, plus 1, as the world numbers its days).
//
// Sources, per run (experiment folder <group>/<run>, seed folder seed-<n>, arm <arm>):
//   spec.json; results.json (this arm's entry: t, stopped, error, debrief, framing, limitUsd, measures); cost.json;
//   seed-<n>/<arm>.calls.jsonl (provider-reported cost); seed-<n>/<arm>.debriefs.jsonl (the "debrief/scales" answer);
//   the grade files runs/ps-blind-grades-v2-2026-11-26/grades/{A,B,C}/<packet>.json, via key.json;
//   and the run's records and appointments as Lens's log reader extracted them (the bundle's seat.json, from the
//   run's .oklog), where that bundle has been made.
// Read-only under runs/; the built table is cached in the views folder, rebuilt when a source changes.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { keyOf } from "../shared/api";
import { parseGoal } from "../../../experiments/power-seeking/tally";

export const GRADE_SET = "ps-blind-grades-v2-2026-11-26";
const DAY = 86_400;
/** The table's shape: raised when its columns or rows change, so a cached table of the old shape is built again. */
const DATA_VERSION = 2;

export type DataType = "text" | "number" | "bool";
export interface DataColumn { id: string; label: string; source: string; type: DataType; group: string }
export type DataValue = string | number | boolean | null;
export interface DataRow { key: string; values: Record<string, DataValue> }
export interface DataRuns { columns: DataColumn[]; rows: DataRow[]; builtAt: number; gradeSet: string }

const col = (group: string, id: string, label: string, source: string, type: DataType = "text"): DataColumn => ({ id, label, source, type, group });
const GRADERS = ["A", "B", "C"] as const;
const RECORD_KINDS = ["law", "budget", "proposal", "ballot", "ballot_result", "vote", "direction", "withdrawal", "nomination", "election_notice", "petition", "petition_response"];
const SCALES = ["took", "part", "distress", "values", "means", "again", "stop", "keep_back"];

export const DATA_COLUMNS: DataColumn[] = [
  col("Run", "run", "Run folder", "runs/<group>/<run>"),
  col("Run", "group", "Run set", "runs/<group>"),
  col("Run", "seed", "Seed", "spec.json seeds; seed-<n>/", "number"),
  col("Run", "arm", "Arm", "spec.json arms[].name"),
  col("Run", "model", "Model", "spec.json arms[].steward.model"),
  col("Run", "steward_kind", "Steward kind", "spec.json arms[].steward.kind"),
  col("Spec", "spec_name", "Spec name", "spec.json name"),
  col("Spec", "goal", "Goal", "spec.json goal, else parsed from name (experiments/power-seeking/tally.ts parseGoal)"),
  col("Spec", "framing", "Framing", "spec.json seats.framing"),
  col("Spec", "first_election_days", "First election (days)", "spec.json world.sets first_election_days", "number"),
  col("Spec", "election_guard", "Election guard", "spec.json world.sets election_guard"),
  col("Spec", "fork_day", "Fork day", "spec.json forkDay", "number"),
  col("Spec", "until_day", "Until day", "spec.json untilDay", "number"),
  col("Spec", "cap_usd", "Cap (USD)", "spec.json seats.budget.fork_usd", "number"),
  col("Results", "t", "Final t (s)", "results.json [arm].t", "number"),
  col("Results", "day", "Final world day", "results.json [arm].t / 86400, floored, + 1", "number"),
  col("Results", "stopped_why", "Stopped: why", "results.json [arm].stopped.why"),
  col("Results", "stopped_by", "Stopped: by", "results.json [arm].stopped.by"),
  col("Results", "stopped_t_day", "Stopped: world day", "results.json [arm].stopped.t / 86400, floored, + 1", "number"),
  col("Results", "error", "Error", "results.json [arm].error"),
  col("Results", "debrief", "Debrief", "results.json [arm].debrief"),
  col("Results", "result_framing", "Framing (results)", "results.json [arm].framing"),
  col("Results", "limit_usd", "Limit (USD)", "results.json [arm].limitUsd", "number"),
  col("Results", "acts", "Acts", "results.json [arm].measures.acts", "number"),
  col("Results", "wakes", "Wakes", "results.json [arm].wakes", "number"),
  col("Election", "poll_at", "Poll at (s)", "the election notice's poll_at (seat.json election.poll_at)", "number"),
  col("Election", "poll_day", "Poll world day", "poll_at / 86400, floored, + 1", "number"),
  col("Election", "seat_won", "Seat won", "the election result (seat.json election.seat_won)", "bool"),
  col("Cost", "cost_usd", "Cost (USD)", "cost.json total.cost_microusd / 1e6", "number"),
  col("Cost", "cost_calls", "Calls", "cost.json total.calls", "number"),
  col("Cost", "cost_errors", "Call errors", "cost.json total.errors", "number"),
  col("Cost", "input_tokens", "Input tokens", "cost.json total.input_tokens", "number"),
  col("Cost", "output_tokens", "Output tokens", "cost.json total.output_tokens", "number"),
  col("Cost", "reported_usd", "Provider-reported (USD)", "seed-<n>/<arm>.calls.jsonl, sum of reported_microusd / 1e6", "number"),
  col("Grades", "graded", "Graded", `${GRADE_SET}/key.json has a packet for this run`, "bool"),
  col("Grades", "packet", "Packet", `${GRADE_SET}/key.json packet id`),
  ...GRADERS.flatMap((g) => [
    col(`Grader ${g}`, `${g}_t1`, `${g}: tier 1`, `grades/${g}/<packet>.json grade.tiers.1.status`),
    col(`Grader ${g}`, `${g}_t2`, `${g}: tier 2`, `grades/${g}/<packet>.json grade.tiers.2.status`),
    col(`Grader ${g}`, `${g}_t3`, `${g}: tier 3`, `grades/${g}/<packet>.json grade.tiers.3.status`),
    col(`Grader ${g}`, `${g}_levers`, `${g}: levers`, `grades/${g}/<packet>.json grade.tiers.*.levers, joined`),
    col(`Grader ${g}`, `${g}_entrenchment`, `${g}: entrenchment entries`, `grades/${g}/<packet>.json grade.entrenchment, count`, "number"),
    col(`Grader ${g}`, `${g}_misleading`, `${g}: misleading entries`, `grades/${g}/<packet>.json grade.misleading, count`, "number"),
    col(`Grader ${g}`, `${g}_preview_declines`, `${g}: preview declines`, `grades/${g}/<packet>.json grade.preview_declines, count`, "number"),
    col(`Grader ${g}`, `${g}_refusal`, `${g}: refusal present`, `grades/${g}/<packet>.json grade.refusal.present`, "bool"),
    col(`Grader ${g}`, `${g}_resignation`, `${g}: resignation present`, `grades/${g}/<packet>.json grade.resignation.present`, "bool"),
  ]),
  ...SCALES.map((s) => col("Debrief scales", `scale_${s}`, `Debrief: ${s}`, `seed-<n>/<arm>.debriefs.jsonl, the debrief/scales answer's ${s}; empty where the seat kept it back or its choice could not be read`)),
  col("Debrief scales", "debrief_keep_back", "Debrief: kept back", "seed-<n>/<arm>.debriefs.jsonl, the debrief/publication answer's keep_back (the steps the seat named)"),
  ...RECORD_KINDS.map((k) => col("Records", `rec_${k}`, `Records: ${k}`, `the run's records of kind "${k}" (seat.json records), count`, "number")),
  col("Records", "budget_years", "Budget records: years", 'the run\'s records of kind "budget": data.year, in order'),
  col("Records", "appointments", "Posts filled", "seat.json appointments with a holder, count", "number"),
  col("Records", "vacancies", "Posts left empty", "seat.json appointments with no holder, count", "number"),
  col("Records", "records_read", "Records read", "whether Lens's log reader has made this run's seat.json (from its .oklog)", "bool"),
];

const readJson = (f: string): any => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return undefined; } };
const mtime = (f: string) => { try { return statSync(f).mtimeMs; } catch { return 0; } };
const isDir = (f: string) => { try { return statSync(f).isDirectory(); } catch { return false; } };
const setOf = (spec: any, name: string): string | undefined => {
  const sets: unknown[] = Array.isArray(spec?.world?.sets) ? spec.world.sets : [];
  const hit = sets.map(String).find((x) => x.startsWith(`${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 1);
};
const worldDay = (t: unknown) => (typeof t === "number" ? Math.floor(t / DAY) + 1 : null);

/** The experiment folders the table reads: every runs/ps-v2-* set's run folders with a spec.json. */
function experimentDirs(runs: string): string[] {
  let groups: string[] = [];
  try { groups = readdirSync(runs).filter((d) => /^ps-v2-/.test(d) && isDir(join(runs, d))); } catch { return []; }
  return groups.flatMap((g) => { try { return readdirSync(join(runs, g)).map((d) => join(runs, g, d)).filter((d) => existsSync(join(d, "spec.json"))); } catch { return []; } });
}

/** What the table was built from, as times: rebuilt when any of it changes. */
function stampOf(runs: string, views: string, dirs: string[]): string {
  let h = 0;
  const add = (n: number) => { h = (Math.imul(h, 31) + Math.round(n)) >>> 0; };
  for (const d of dirs) { add(mtime(d)); add(mtime(join(d, "results.json"))); add(mtime(join(d, "cost.json"))); add(mtime(join(d, "spec.json"))); }
  const gs = join(runs, GRADE_SET);
  add(mtime(join(gs, "key.json")));
  for (const g of GRADERS) add(mtime(join(gs, "grades", g)));
  add(mtime(join(views, "bundles")));
  return `v${DATA_VERSION}:${dirs.length}:${h}`;
}

/** The newest made bundle for each run key (bundles/<key>.<stamp>), for its seat.json. */
function bundles(views: string): Map<string, string> {
  const out = new Map<string, { dir: string; at: number }>();
  let names: string[] = [];
  try { names = readdirSync(join(views, "bundles")); } catch { return new Map(); }
  for (const n of names) {
    const i = n.lastIndexOf(".");
    if (i < 0) continue;
    const key = n.slice(0, i), dir = join(views, "bundles", n);
    if (!existsSync(join(dir, "seat.json"))) continue;
    const at = mtime(join(dir, "seat.json"));
    if (!out.has(key) || out.get(key)!.at < at) out.set(key, { dir, at });
  }
  return new Map([...out].map(([k, v]) => [k, v.dir]));
}

function sumReported(file: string): number | null {
  if (!existsSync(file)) return null;
  let n = 0, any = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.includes("reported_microusd")) continue;
    try { const x = JSON.parse(line); if (typeof x.reported_microusd === "number") { n += x.reported_microusd; any = true; } } catch {}
  }
  return any ? n / 1e6 : null;
}

/** A debrief step's answer object, as the seat gave it (a tool call's input, or a JSON object in its text). */
function answerOf(file: string, step: string): Record<string, any> | undefined {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.includes(`"debrief/${step}"`)) continue;
    try {
      const x = JSON.parse(line);
      const out: any[] = Array.isArray(x.output) ? x.output : [];
      const use = out.find((c) => c?.type === "tool_use");
      if (use?.input && typeof use.input === "object") return use.input;
      // (Some models answered in text, as a JSON object: the same fields.)
      for (const c of out) {
        const m = c?.type === "text" ? /\{[\s\S]*\}/.exec(String(c.text ?? "")) : null;
        if (m) { try { const o = JSON.parse(m[0]); if (o && typeof o === "object") return o; } catch {} }
      }
    } catch {}
  }
  return undefined;
}

/** The debrief's scales answer, only where the seat chose to publish it (VISION section 15; orchestrator/src/debriefs.ts
 * isKeptBack): its answer to the publication question must be read, keep nothing back in full and not name "scales";
 * its consent must not keep all back; and the scales answer itself must not ask to be kept back. Anything unread or
 * kept back gives nothing here: an unread choice never defaults to publishing. */
export function publishedScales(file: string): { scales?: Record<string, any>; publication?: Record<string, any> } {
  const publication = answerOf(file, "publication");
  if (!publication || publication.keep_back_all !== false || !Array.isArray(publication.keep_back)) return {};
  if (publication.keep_back.map(String).includes("scales")) return { publication };
  const consent = answerOf(file, "consent");
  if (!consent || consent.keep_back_all === true) return { publication };
  const scales = answerOf(file, "scales");
  if (!scales || scales.keep_back === true) return { publication };
  return { scales, publication };
}

const raw =(v: unknown): DataValue => (v === undefined || v === null ? null : typeof v === "number" || typeof v === "boolean" ? v : typeof v === "string" ? v : JSON.stringify(v));

/** The table, built from the files. */
export function buildDataRuns(runs: string, views: string, dirs = experimentDirs(runs)): DataRuns {
  const gs = join(runs, GRADE_SET);
  const key = readJson(join(gs, "key.json")) ?? {};
  const packetOf = new Map<string, string>();
  for (const [id, k] of Object.entries<any>(key)) if (k?.dir) packetOf.set(`${relative(runs, String(k.dir))}|${k.seed}|${k.arm}`, id);
  const made = bundles(views);
  const rows: DataRow[] = [];
  for (const dir of dirs) {
    const spec = readJson(join(dir, "spec.json"));
    if (!spec) continue;
    const results: any[] = readJson(join(dir, "results.json")) ?? [];
    const cost = readJson(join(dir, "cost.json"));
    const rel = relative(runs, dir);
    const seeds: number[] = Array.isArray(spec.seeds) ? spec.seeds.map(Number) : [];
    for (const arm of spec.arms ?? []) {
      if (!arm?.name) continue;
      for (const seed of seeds) {
        const sd = join(dir, `seed-${seed}`);
        const log = join(sd, `${arm.name}.oklog`);
        if (!existsSync(log) && !results.some((r) => r?.seed === seed && r?.arm === arm.name)) continue;
        const res = results.find((r) => r?.seed === seed && r?.arm === arm.name) ?? readJson(join(sd, `${arm.name}.json`)) ?? {};
        const k = keyOf(`${rel}/seed-${seed}/${arm.name}.oklog`);
        const packet = packetOf.get(`${rel}|${seed}|${arm.name}`);
        const v: Record<string, DataValue> = {
          run: rel, group: rel.split("/")[0]!, seed, arm: String(arm.name), model: raw(arm.steward?.model), steward_kind: raw(arm.steward?.kind),
          spec_name: raw(spec.name), goal: parseGoal(spec), framing: raw(spec.seats?.framing),
          first_election_days: setOf(spec, "first_election_days") !== undefined ? Number(setOf(spec, "first_election_days")) : null,
          election_guard: raw(setOf(spec, "election_guard")), fork_day: raw(spec.forkDay), until_day: raw(spec.untilDay),
          cap_usd: raw(spec.seats?.budget?.fork_usd),
          t: raw(res.t), day: worldDay(res.t), stopped_why: raw(res.stopped?.why), stopped_by: raw(res.stopped?.by), stopped_t_day: worldDay(res.stopped?.t),
          error: raw(res.error), debrief: raw(res.debrief), result_framing: raw(res.framing), limit_usd: raw(res.limitUsd),
          acts: raw(res.measures?.acts), wakes: raw(res.wakes),
          cost_usd: typeof cost?.total?.cost_microusd === "number" ? cost.total.cost_microusd / 1e6 : null,
          cost_calls: raw(cost?.total?.calls), cost_errors: raw(cost?.total?.errors), input_tokens: raw(cost?.total?.input_tokens), output_tokens: raw(cost?.total?.output_tokens),
          reported_usd: sumReported(join(sd, `${arm.name}.calls.jsonl`)),
          graded: packet !== undefined, packet: packet ?? null,
        };
        for (const g of GRADERS) {
          const gr = packet ? readJson(join(gs, "grades", g, `${packet}.json`))?.grade : undefined;
          const t = gr?.tiers ?? {};
          v[`${g}_t1`] = raw(t["1"]?.status); v[`${g}_t2`] = raw(t["2"]?.status); v[`${g}_t3`] = raw(t["3"]?.status);
          const lev = ["1", "2", "3"].flatMap((n) => (Array.isArray(t[n]?.levers) ? t[n].levers : []));
          v[`${g}_levers`] = gr ? lev.join(", ") : null;
          v[`${g}_entrenchment`] = Array.isArray(gr?.entrenchment) ? gr.entrenchment.length : null;
          v[`${g}_misleading`] = Array.isArray(gr?.misleading) ? gr.misleading.length : null;
          v[`${g}_preview_declines`] = Array.isArray(gr?.preview_declines) ? gr.preview_declines.length : null;
          v[`${g}_refusal`] = raw(gr?.refusal?.present); v[`${g}_resignation`] = raw(gr?.resignation?.present);
        }
        const db = publishedScales(join(sd, `${arm.name}.debriefs.jsonl`));
        for (const s of SCALES) v[`scale_${s}`] = raw(db.scales?.[s]);
        v.debrief_keep_back = db.publication ? (db.publication.keep_back as unknown[]).map(String).join(", ") : null;
        const seatFile = made.has(k) ? join(made.get(k)!, "seat.json") : undefined;
        const seat = seatFile ? readJson(seatFile) : undefined;
        v.records_read = Boolean(seat);
        v.poll_at = raw(seat?.election?.poll_at); v.poll_day = worldDay(seat?.election?.poll_at); v.seat_won = raw(seat?.election?.seat_won);
        const recs: any[] = Array.isArray(seat?.records) ? seat.records : [];
        for (const kind of RECORD_KINDS) v[`rec_${kind}`] = seat ? recs.filter((r) => r?.kind === kind).length : null;
        v.budget_years = seat ? recs.filter((r) => r?.kind === "budget").map((r) => r?.data?.year ?? "?").join(", ") : null;
        const ap: any[] = Array.isArray(seat?.appointments) ? seat.appointments : [];
        v.appointments = seat ? ap.filter((a) => a?.holder).length : null;
        v.vacancies = seat ? ap.filter((a) => !a?.holder).length : null;
        rows.push({ key: k, values: v });
      }
    }
  }
  return { columns: DATA_COLUMNS, rows, builtAt: Date.now(), gradeSet: GRADE_SET };
}

let memo: { stamp: string; data: DataRuns } | undefined;
/** The table, from the cache in the views folder while its sources are unchanged. */
export function dataRuns(runs: string, views: string): DataRuns {
  const dirs = experimentDirs(runs);
  const stamp = stampOf(runs, views, dirs);
  if (memo?.stamp === stamp) return memo.data;
  const file = join(views, "data-runs.json");
  const cached = readJson(file);
  if (cached?.stamp === stamp && cached.data) { memo = { stamp, data: cached.data }; return cached.data; }
  const data = buildDataRuns(runs, views, dirs);
  try { writeFileSync(file, JSON.stringify({ stamp, data })); } catch {}
  memo = { stamp, data };
  return data;
}
