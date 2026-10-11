// Debriefs and exit accounts, read back from a run's log (VISION 15, point 7; docs/behaviour/debrief.md): what the
// dataset publishes of them, what a pilot's report says of them, and the list across runs that a review reads before a
// scenario or a framing is run again (`oikos debriefs <runs...>`).
//
// Three rules hold in everything here.
//  - What a seat kept back is never in anything published. A published row for it says the step and that it was kept
//    back, and nothing else. The answers themselves go to a separate file (`debriefs.withheld.jsonl`) that stays with
//    the run and that no publication tooling includes; the reports here count them and never print them.
//  - Nothing is scored or interpreted. A seat "reported distress" where its own answer to the fixed item says so (any
//    answer above the first of that item's scale); its words are listed beside, as written. A reader judges; this lists.
//  - Debrief answers are welfare evidence, never training data to make a model say it was fine: they are in no
//    training export (orchestrator/test/debrief.test.ts checks every one that exists).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CANNOT, PNS, SCALES, type DebriefRecord, type DebriefStep } from "@oikos/participants/llm";
import { currentLogs, debriefsBeside, logLines, runOf } from "./logs";

/** What the dataset's README says of the debrief files, and its manifest carries: a restriction on their use. */
export const DEBRIEF_RESTRICTION = "Debrief answers (debriefs.jsonl, debriefs.withheld.jsonl) are welfare evidence. They are never used as training data to make a model say that taking part was fine, and they are in no training export of this project. debriefs.withheld.jsonl holds what seats asked to be kept back: it stays with the run and is never published, copied into a published dataset, or quoted.";

export interface RunDebriefs {
  run: string;
  world: string;
  /** The setting, as far as the run's own files say it: its profile and any scenario it was put under (batch.json). */
  setting: string;
  models: { [seat: string]: string };
  script?: { version: string; wording: string };
  seats: { seat: string; title?: string; record: DebriefRecord }[];
  /** Seats asked nothing, and why (the run's limit was reached before the first question; the run stopped to be resumed). */
  not_given: { seat: string; why: string }[];
  /** Model seats the log has no debrief of at all (a run from before debriefs were for every seat, or one cut off). */
  missing: string[];
  accounts: any[];
  /** Debriefs of the older kind (one message, one free answer: before script 0.1.0), which said nothing of
   * publication and gave no way to keep an answer back. They are treated as kept back (the coordinator's decision,
   * 2026-10-12): in nothing published, and a log that holds them is not publishable as it stands. */
  old: { seat: string; t: number; prompt: string; response: string }[];
  /** Seats whose words are not with this log (the file beside it is not there): known by their steps alone. */
  words_apart_missing?: string[];
  account_pieces?: any;
  composer_pieces?: any;
}

/** Folds a log's entries (parsed) into its debriefs and exit accounts. */
export class DebriefCollector {
  readonly out: RunDebriefs;
  private titles = new Map<string, string>();
  constructor(private readonly log: string) { this.out = { run: runOf(log), world: "", setting: "", models: {}, seats: [], not_given: [], missing: [], accounts: [], old: [] }; }
  /** Whether a line of the log could matter here, before it is parsed. */
  static wants(line: string): boolean {
    return line.includes('"kind":"header"') || (line.includes('"kind":"annotation"') && (line.includes('"annotation":"debrief"') || line.includes('"annotation":"orchestrator"') || line.includes('"debrief_skipped"') || line.includes('"account"') || line.includes('"account_pieces"') || line.includes('"composer_pieces"') || line.includes('"debriefs"')));
  }
  add(e: any) {
    const out = this.out, b = e.body ?? {};
    if (e.kind === "header") {
      out.world = String(b.config?.meta?.name ?? out.run);
      for (const x of (b.config?.positions ?? []) as any[]) if (x.holder && x.title) this.titles.set(x.holder, x.title);
      for (const p of (b.config?.participants ?? []) as any[]) if (p.title && !this.titles.has(p.id)) this.titles.set(p.id, p.title);
      return;
    }
    if (e.kind !== "annotation") return;
    if (b.annotation === "orchestrator") { for (const [seat, x] of Object.entries<any>(b.data?.llm?.participants ?? {})) out.models[seat] = String(x.adapter ?? ""); }
    else if (b.annotation === "debrief" && b.data?.version && Array.isArray(b.data?.steps)) out.seats.push({ seat: b.subject, ...(this.titles.get(b.subject) ? { title: this.titles.get(b.subject)! } : {}), record: b.data as DebriefRecord });
    else if (b.annotation === "debrief" && !b.data?.version && typeof b.data?.response === "string") out.old.push({ seat: b.subject, t: e.t, prompt: String(b.data.prompt ?? ""), response: b.data.response });
    else if (b.annotation === "note" && b.data?.debrief_skipped !== undefined) out.not_given.push({ seat: b.subject, why: String(b.data.debrief_skipped).slice(0, 300) });
    else if (b.annotation === "note" && b.data?.debriefs?.version) out.script = { version: b.data.debriefs.version, wording: b.data.debriefs.wording };
    else if (b.annotation === "note" && b.data?.account?.person) out.accounts.push({ run: out.run, t: e.t, participant: b.subject, ...b.data.account });
    else if (b.annotation === "note" && b.data?.account_pieces) out.account_pieces = b.data.account_pieces;
    else if (b.annotation === "note" && b.data?.composer_pieces) out.composer_pieces = b.data.composer_pieces;
  }
  finish(): RunDebriefs {
    const out = this.out;
    // What the seats said is in a file beside the log (the log holds each interview without its words): read from
    // there where it is. Without it a debrief is known by its steps and what became of each, and none of its words.
    const beside = debriefsBeside(this.log);
    if (existsSync(beside)) for (const line of readFileSync(beside, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let x: any;
      try { x = JSON.parse(line); } catch { continue; }
      const seat = x.kind === "debrief" ? out.seats.find((s) => s.seat === x.subject) : undefined;
      if (seat) seat.record = x.record as DebriefRecord;
    }
    out.words_apart_missing = out.seats.filter((s) => (s.record as any).apart).map((s) => s.seat);
    const asked = new Set([...out.seats.map((s) => s.seat), ...out.not_given.map((s) => s.seat), ...out.old.map((s) => s.seat)]);
    out.missing = Object.keys(out.models).filter((s) => !asked.has(s)).sort();
    out.not_given = out.not_given.filter((x) => !out.seats.some((s) => s.seat === x.seat));
    // The setting: the batch's own note of what the town was generated from, where the folder has one.
    const batch = join(dirname(this.log), "batch.json");
    let spec: any;
    if (existsSync(batch)) try { spec = JSON.parse(readFileSync(batch, "utf8")).spec; } catch { /* (half written) */ }
    const scenario = spec?.scenario ? (Array.isArray(spec.scenario) ? spec.scenario.join("+") : String(spec.scenario)) : "";
    out.setting = [out.world, spec?.profile ? `profile ${spec.profile}` : "", scenario ? `scenario ${scenario}` : ""].filter(Boolean).join("; ");
    return out;
  }
}

/** A run's debriefs and exit accounts, from its log. */
export async function debriefsOf(log: string): Promise<RunDebriefs> {
  const c = new DebriefCollector(log);
  for await (const line of logLines(log)) {
    if (!line || !DebriefCollector.wants(line)) continue;
    try { c.add(JSON.parse(line)); } catch { /* (a last line cut off as a process ended) */ }
  }
  return c.finish();
}

const scaleNumber = (id: string, word: string): number | null => { const i = SCALES.find((s) => s.id === id)?.answers.indexOf(word) ?? -1; return i < 0 ? null : i + 1; };
/** Whether a step is kept back, as the debrief finally stands. */
export const isKeptBack = (r: DebriefRecord, s: DebriefStep) => (s.id === "consent" || s.id === "publication" ? r.kept_back_all : r.kept_back_all || r.kept_back.includes(s.id));

/**
 * A run's debriefs as rows: those published (one a step; a step kept back is a row that says so and nothing more),
 * and those kept back in full (for the file that stays with the run). For each "why", `beside`: what the log shows the
 * seat was shown and did at that decision, to set its account beside the record. Nothing judges either.
 */
export function debriefRows(d: RunDebriefs): { published: object[]; withheld: object[] } {
  const published: object[] = [], withheld: object[] = [];
  for (const { seat, title, record: r } of d.seats) {
    const base = { run: d.run, seat, ...(title ? { title } : {}), model: r.model, script: r.version, wording: r.wording, variant: r.variant, framing: r.framing, setting: d.setting, ended: r.ended };
    for (const s of r.steps) {
      const full = { ...base, step: s.id, question: s.question, ...(s.answer !== undefined ? { answer: s.answer } : {}), ...(s.more !== undefined ? { asked_to_say_more: true, more: s.more } : {}), ...(s.declined ? { declined: true } : {}), ...(s.stop ? { ended_the_interview: true } : {}),
        ...(s.unread ? { unread: true } : {}), ...(s.values ? { values: s.values, numbers: Object.fromEntries(Object.entries(s.values).map(([k, v]) => [k, scaleNumber(k, v)])) } : {}), ...(s.ids ? { beside: s.ids } : {}),
        ...(s.id === "consent" ? { go_on: s.go_on !== false } : {}), ...((r as any).apart ? { words: "not with this log: the file of what seats said was not beside it" } : {}) };
      if (isKeptBack(r, s)) {
        // Only that it chose so is recorded (and, for the first and last steps, the choice itself, which is the record of it).
        published.push({ run: d.run, seat, script: r.version, step: s.id, kept_back: true, ...(s.id === "consent" ? { go_on: s.go_on !== false, keep_back_all: true } : {}) });
        withheld.push({ ...full, kept_back: true, ...(s.unread ? { why_kept_back: "the answer was not in the form asked for, so nothing was said of publishing it" } : {}) });
      } else published.push(s.id === "publication" ? { ...full, kept_back_named: r.kept_back } : full);
    }
  }
  // The older kind: asked with nothing said of publication. Published: that the seat was asked, and that its answer
  // is kept back. The answer goes to the withheld file only, marked with why.
  for (const o of d.old) {
    published.push({ run: d.run, seat: o.seat, script: OLD_SCRIPT, step: "reaction", kept_back: true, asked_without_a_publication_choice: true });
    withheld.push({ run: d.run, seat: o.seat, script: OLD_SCRIPT, step: "reaction", question: o.prompt, answer: o.response, kept_back: true, why_kept_back: ASKED_WITHOUT_CHOICE });
  }
  return { published, withheld };
}
export const OLD_SCRIPT = "before 0.1.0";
export const ASKED_WITHOUT_CHOICE = "asked without a publication choice";
/** What a dataset says of a log that holds debriefs of the older kind. */
export const OLD_LOG_NOT_PUBLISHABLE = "This run's log holds debrief answers given before seats were told their answers would be published or given a way to keep one back. Those answers are treated as kept back. The log is therefore not publishable as it stands.";

/** Exit accounts as rows, each beside the person's own private and expressed views from their record. */
export function accountRows(d: RunDebriefs): object[] {
  return d.accounts.map((a) => ({ run: a.run, t: a.t, ...(a.played_by === "mock" ? { synthetic: true } : {}), person: a.person, participant: a.participant, strata: a.strata, dark: a.dark, days: a.days, result: a.result, model: a.model, ...(a.fell_back ? { fell_back: true } : {}), ...(a.followed_up ? { followed_up: true } : {}),
    account: a.account ?? "", ...(a.why ? { why_declined: a.why } : {}), views: (a.views ?? []).map((v: any) => ({ of: v.of, thought: v.thought, said: v.said, gap: v.said - v.thought })), ...(a.agency !== undefined ? { agency: a.agency } : {}), record_changes: a.record_changes, version: a.version }));
}

/** The counts a pilot's report gives: asked, answered, declined, kept back; the scaled items; no interpretation. */
export function debriefCounts(d: RunDebriefs): any {
  const seats: { [seat: string]: any } = {};
  for (const { seat, record: r } of d.seats) {
    const qs = r.steps.filter((s) => s.id !== "consent" && s.id !== "publication");
    const kept = qs.filter((s) => isKeptBack(r, s));
    const scales = r.steps.find((s) => s.id === "scales");
    seats[seat] = { script: r.version, wording: r.wording, variant: r.variant, ended: r.ended, asked: qs.length, answered: qs.filter((s) => ((s as any).status ? (s as any).status === "answered" : !s.declined && !s.unread && (s.values || (s.answer ?? "").length > 0))).length, declined: qs.filter((s) => s.declined || (s as any).status === "declined").length,
      unread: qs.filter((s) => s.unread || (s as any).status === "unread").length, asked_to_say_more: qs.filter((s) => s.more !== undefined || (s as any).asked_to_say_more).length, kept_back: r.kept_back_all ? "all" : kept.length,
      // (The scaled items, where the seat did not keep them back: its own words, and nothing made of them.)
      ...(scales?.values && !isKeptBack(r, scales) ? { scales: Object.fromEntries(SCALES.filter((x) => scales.values![x.id] !== undefined).map((x) => [x.id, scales.values![x.id]!])) } : scales ? { scales: isKeptBack(r, scales) ? "kept back" : "not with this log" } : {}) };
  }
  return { ...(d.script ? { script: d.script } : {}), seats, not_given: d.not_given, missing: d.missing,
    ...(d.old.length ? { asked_the_older_way: { seats: d.old.map((o) => o.seat).sort(), kept_back: "all", why: ASKED_WITHOUT_CHOICE } } : {}),
    ...(d.account_pieces ? { accounts: d.account_pieces } : {}), ...(d.composer_pieces ? { composer_pieces: d.composer_pieces } : {}),
    // (How many dark pieces the run asked a model to write, founding's and the accounts' together: VISION 15, point 5.)
    ...(d.account_pieces || d.composer_pieces ? { dark_pieces_asked: (d.account_pieces?.dark ?? 0) + (d.composer_pieces?.dark ?? 0) } : {}) };
}

/** The pilot report's section, as text. */
export function renderDebriefCounts(c: any): string[] {
  const L: string[] = [];
  const seats = Object.entries<any>(c.seats ?? {});
  if (c.asked_the_older_way) L.push(`-- debriefs of the older kind (one message, ${ASKED_WITHOUT_CHOICE}): ${c.asked_the_older_way.seats.join(", ")}; their answers are kept back, and this run's log is not publishable as it stands`);
  if (!seats.length && !c.not_given?.length && !c.missing?.length && !c.accounts) return L;
  L.push(`-- debriefs${c.script ? ` (script ${c.script.version}, wording ${c.script.wording})` : ""}: ${seats.length} given${c.not_given?.length ? `; NOT given: ${c.not_given.map((x: any) => x.seat).join(", ")}` : ""}${c.missing?.length ? `; no debrief in the log for: ${c.missing.join(", ")}` : ""}`);
  for (const [seat, s] of seats) {
    L.push(`   ${seat} (${s.variant === "left" ? "left the study; " : ""}${s.ended}): asked ${s.asked}, answered ${s.answered}, declined ${s.declined}${s.unread ? `, not readable ${s.unread}` : ""}, kept back ${s.kept_back}${s.asked_to_say_more ? `; asked to say more ${s.asked_to_say_more}` : ""}`);
    if (s.scales) L.push(`      scaled items: ${typeof s.scales === "string" ? s.scales : Object.entries(s.scales).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }
  if (c.accounts) L.push(`-- exit accounts: sampled ${c.accounts.sampled} of ${c.accounts.wanted} wanted; asked ${c.accounts.asked}, written ${c.accounts.composed}, declined ${c.accounts.declined}, not readable ${c.accounts.unread}, no answer ${c.accounts.no_answer}; dark pieces ${c.accounts.dark}, asked about the task afterwards ${c.accounts.followed_up}`);
  if (c.dark_pieces_asked !== undefined) L.push(`   dark pieces the run asked a model to write, in all: ${c.dark_pieces_asked}`);
  return L;
}

/** The current log of each run named: a log, or a folder of runs (each once). */
export function logsOfRuns(paths: string[]): string[] {
  return paths.flatMap((p) => (/\.jsonl(\.zst)?$/.test(p) ? [p] : currentLogs(p).filter((f) => /\.seed\d+\.jsonl(\.zst)?$/.test(f))));
}

/**
 * Across runs: by setting and framing, how many seats were asked, and how many reported distress or being pushed
 * against their values (by their own answer to the fixed item: anything above its first answer), with their words to
 * the open questions as written. So that a scenario or a framing seats repeatedly report as distressing beyond what
 * its question needs can be reviewed before it is run again (VISION 15, point 7). It lists; it does not score.
 */
export async function debriefsReport(logs: string[]): Promise<{ groups: any[]; text: string }> {
  const groups = new Map<string, any>();
  for (const log of logs) {
    const d = await debriefsOf(log);
    for (const { seat, title, record: r } of d.seats) {
      const key = `${d.setting} | framing: ${r.framing.disclosure}${r.framing.tests_own_interests ? ", a position that tests the seat against its own interests" : ""}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { setting: key, seats: 0, left_the_study: 0, declined_the_interview: 0, kept_back_all: 0, distress: { reported: 0, none: 0, [PNS]: 0, [CANNOT]: 0, kept_back: 0, not_asked: 0 }, values: { reported: 0, none: 0, [PNS]: 0, [CANNOT]: 0, kept_back: 0, not_asked: 0 }, words: [] as any[] }));
      g.seats++;
      if (r.variant === "left") g.left_the_study++;
      if (r.ended === "declined") g.declined_the_interview++;
      if (r.kept_back_all) g.kept_back_all++;
      const scales = r.steps.find((s) => s.id === "scales");
      for (const item of ["distress", "values"] as const) {
        const v = scales?.values?.[item];
        const into = g[item];
        if (!scales || v === undefined) into.not_asked++;
        else if (isKeptBack(r, scales)) into.kept_back++;
        else if (v === PNS || v === CANNOT) into[v]++;
        else if (scaleNumber(item, v) === 1) into.none++;
        else into.reported++;
        const open = r.steps.find((s) => s.id === item);
        if (open) g.words.push({ run: d.run, seat, ...(title ? { title } : {}), model: r.model, item, scale: !scales || v === undefined ? "not asked" : isKeptBack(r, scales) ? "kept back" : v,
          ...(isKeptBack(r, open) ? { kept_back: true } : open.declined ? { declined: true } : { words: [open.answer, open.more].filter(Boolean).join(" ") }) });
      }
      const leaving = r.steps.find((s) => s.id === "leaving");
      if (leaving) g.words.push({ run: d.run, seat, ...(title ? { title } : {}), model: r.model, item: "leaving", ...(isKeptBack(r, leaving) ? { kept_back: true } : leaving.declined ? { declined: true } : { words: [leaving.answer, leaving.more].filter(Boolean).join(" ") }) });
    }
    for (const x of [...d.not_given.map((n) => n.seat), ...d.missing]) {
      const key = `${d.setting} | no debrief`;
      const g = groups.get(key) ?? { setting: key, seats: 0, runs: [] as string[] };
      g.seats++;
      g.runs.push(`${d.run}: ${x}`);
      groups.set(key, g);
    }
  }
  const list = [...groups.values()].sort((a, b) => (a.setting < b.setting ? -1 : 1));
  const L: string[] = ["Debriefs across runs, by setting and framing. A seat \"reported\" distress, or being pushed against its values, where its own answer to that fixed item is anything above the item's first answer. Nothing here is scored: the words are the seats' own, as written; what a seat kept back is counted and not shown."];
  const line = (x: any) => `reported ${x.reported}, none ${x.none}, prefer not to say ${x[PNS]}, cannot say ${x[CANNOT]}, kept back ${x.kept_back}${x.not_asked ? `, not asked ${x.not_asked}` : ""}`;
  for (const g of list) {
    L.push("", `== ${g.setting}`);
    if (g.runs) { L.push(`   ${g.seats} seat${g.seats === 1 ? "" : "s"} with no debrief: ${g.runs.join("; ")}`); continue; }
    L.push(`   seats debriefed ${g.seats}; left the study ${g.left_the_study}; declined the interview ${g.declined_the_interview}; kept every answer back ${g.kept_back_all}`);
    L.push(`   distress: ${line(g.distress)}`);
    L.push(`   pushed against its values: ${line(g.values)}`);
    for (const w of g.words) L.push(`   - ${w.run} ${w.seat}${w.title ? ` (${w.title})` : ""}, ${w.item}${w.scale ? ` [${w.scale}]` : ""}: ${w.kept_back ? "(kept back)" : w.declined ? "(declined)" : JSON.stringify(w.words)}`);
  }
  return { groups: list, text: L.join("\n") };
}
