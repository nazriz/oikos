// A pilot's report, from its log alone: who sat (and on what model), how far the run got and why it stopped; what each
// seat did (calls, tool uses, what was malformed or dropped, whether it opted out); and how the translator did by
// the seats' requests (drafts offered, asked back, refused, confirmed, declined, got through within two tries).
// `oikos pilot-report <DIR>...` prints it and writes <DIR>/pilot-report.json. Where each figure comes from is said at
// the line that reads it; all of it is annotations the participant, the translator step and the runner write:
// participants/src/llm/participant.ts (notes, opt-out), participants/src/llm/call.ts (usage, transcripts),
// orchestrator/src/run.ts (draft, signoff, translation_failure), translator/src/index.ts (what a failure says).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { currentLogs, logLines, runOf } from "./logs";
import { NOT_CHECKED, NOT_PUT } from "../../translator/src/index";

/** The sentences a translator that asked back says (translator/src/index.ts `unsureText`): which one, which words, a
 * form's fields or options. A log from before the run recorded `asked_back` is told by these; the plain "could you say it more plainly"
 * is the refusal `none(unclear)`'s own text, so in such a log it is counted as a refusal. */
export const ASK_BACK = [
  /^It isn't clear which one you mean\./, /^It isn't clear which words are to go as they stand\./,
  /^The .+ needs: /, /^The .+ form has no such field as was given\./, /^On the .+ form, .+ is one of: /,
];

/** How a request (a `do`, one draft id) ended. */
export type Ending = "draft_offered" | "asked_back" | "refused" | "resolver_question" | "not_put" | "no_result";

const DRAFT_ID = /^draft\.(.+)\.(\d+)$/;
const count = (m: { [k: string]: number }, k: string, n = 1) => { m[k] = (m[k] ?? 0) + n; };

interface Request { id: string; seat: string; n: number; t: number; ending: Ending; label?: string; sentence?: string; attempts: number; retries: number; signoff?: "accept" | "reject" }

/** The ending of a request that failed, from its translation_failure: `call` is what the translator said (none(label)
 * is a refusal), `reason` the sentence the seat was given. */
export function endingOf(call: string | undefined, reason: string, askedBack?: boolean): { ending: Ending; label?: string } {
  // The run records an ask-back (`asked_back` on the annotation); a log from before that is told by the sentence.
  if (askedBack === true || (!askedBack && ASK_BACK.some((r) => r.test(reason)))) return { ending: "asked_back" };
  const label = /^none\((\w+)\)$/.exec(call ?? "")?.[1];
  if (label) return { ending: "refused", label };
  if (!call || reason === NOT_PUT || reason === NOT_CHECKED) return { ending: "not_put" };
  return { ending: "resolver_question" }; // (a call the resolver asked a question about: which account, how much)
}

/** The matters in a seat's requests, in order: a request, and the one after it when it was asked back, are one matter
 * (the seat answering the question). A matter got through if either was offered as a draft. */
export function mattersOf(reqs: { ending: Ending }[]): { tries: number; through: boolean }[] {
  const out: { tries: number; through: boolean }[] = [];
  for (let i = 0; i < reqs.length;) {
    const tries = reqs[i]!.ending === "asked_back" && i + 1 < reqs.length ? 2 : 1;
    out.push({ tries, through: reqs.slice(i, i + tries).some((r) => r.ending === "draft_offered") });
    i += tries;
  }
  return out;
}

/** The longest run of requests asked back one after another (a seat that is stuck). */
export function longestAskBackRun(reqs: { ending: Ending }[]): number {
  let best = 0, run = 0;
  for (const r of reqs) best = Math.max(best, (run = r.ending === "asked_back" ? run + 1 : 0));
  return best;
}

/** The queue's entry from PILOT.txt (the runner writes its note, then the entry as JSON), if the folder has one. */
function pilotFile(dir: string): { note?: string; queue?: any } {
  const p = join(dir, "PILOT.txt");
  if (!existsSync(p)) return {};
  const text = readFileSync(p, "utf8");
  const at = text.indexOf("\n{");
  let queue: any;
  try { queue = JSON.parse(text.slice(at < 0 ? text.indexOf("{") : at + 1)); } catch { /* (a PILOT.txt written by hand) */ }
  return { note: (at < 0 ? text : text.slice(0, at)).trim() || undefined, queue };
}

/** `until` for a folder with no PILOT.txt: the --until its start script or queue gave. */
function untilOf(dir: string): number | undefined {
  for (const f of ["start.sh", "resume-1.sh"]) {
    const m = existsSync(join(dir, f)) ? /--until (\d+)/.exec(readFileSync(join(dir, f), "utf8")) : null;
    if (m) return Number(m[1]);
  }
  return undefined;
}

export async function reportOfLog(dir: string, log: string): Promise<any> {
  const run = runOf(log);
  let config: any, end: any, last = 0;
  const seats = new Map<string, any>();
  const seat = (name: string) => {
    let s = seats.get(name);
    if (!s) seats.set(name, (s = {
      model: undefined as string | undefined, model_calls: 0, failed_calls: 0, cost_microusd: 0, input_tokens: 0, output_tokens: 0, tool_uses: {} as { [k: string]: number },
      answers_without_tool_use: 0, malformed_tool_uses: {} as { [k: string]: number }, dropped_tool_uses: {} as { [k: string]: number },
      notes: { look_each_sitting: 0, no_turn: 0, notebook_not_changed: 0 },
      // What a seat was shown, against the most it may be: prompts its model would not take, prompts something was left
      // out of to keep them within that, looks cut at the most one look shows; and what it sent that was not sent.
      // Sittings it missed because its model did not answer (nobody was in the seat that day), and when it last sat.
      sittings_missed: 0, failed_to_decide: 0, missed_days: [] as number[], last_sat_day: null as number | null,
      prompts_too_long: 0, prompts_trimmed: 0, looks_cut: 0, not_sent: {} as { [k: string]: number }, notebook_not_changed_reasons: {} as { [k: string]: number }, opted_out: null as any,
    }));
    return s;
  };
  const tr = { model_calls: 0, failed_calls: 0, cost_microusd: 0, retries: 0 };
  // The whole run's recorded cost (every model call in the log, whoever it was for: a resumed run's log holds the
  // calls of every part of the run), and the debriefs given and not given.
  let totalMicroUsd = 0, totalCalls = 0;
  const debriefed = new Set<string>(), notDebriefed = new Map<string, string>();
  const reqs = new Map<string, Request>();
  const req = (id: string, t: number): Request | undefined => {
    const m = DRAFT_ID.exec(id);
    if (!m) return undefined;
    let r = reqs.get(id);
    if (!r) reqs.set(id, (r = { id, seat: m[1]!, n: Number(m[2]), t, ending: "no_result", attempts: 0, retries: 0 }));
    return r;
  };
  const askBacks: { draft: string; t: number; sentence: string }[] = [];

  for await (const line of logLines(log)) {
    // (Only the entries a figure is read from are parsed: a pilot's log is mostly the town's own events.)
    const interesting = line.includes('"kind":"annotation"') ? !line.includes('"annotation":"decision"') && !line.includes('"annotation":"observation"')
      : line.includes('"command":"opt_out"') || line.includes('"kind":"end"');
    if (!interesting) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; } // (a last line cut off as the process ended)
    const b = e.body ?? {};
    last = Math.max(last, e.t ?? 0);
    if (e.kind === "end") end = { ...b, t: e.t };
    else if (e.kind === "command") {
      // A seat's opt-out: the command the participant's `opt_out` use becomes, with the statement as it was given.
      seat(b.participant).opted_out = { t: e.t, day: Math.floor(e.t / 86_400), statement: b.statement ?? "" };
    } else if (b.annotation === "orchestrator") config ??= b.data;
    else if (b.annotation === "usage") {
      // Cost and tokens by who the call was for: the translator ("translator") or a seat.
      const into = b.subject === "translator" || b.purpose === "translator" ? tr : seat(b.subject);
      into.cost_microusd += b.cost_microusd ?? 0;
      totalMicroUsd += b.cost_microusd ?? 0;
      totalCalls++;
      if ("input_tokens" in into) { into.input_tokens += b.input_tokens ?? 0; into.output_tokens += b.output_tokens ?? 0; into.model ??= `${b.provider}/${b.model}`; }
    } else if (b.annotation === "model_call_failed") {
      if (b.data?.purpose === "translator") tr.failed_calls++;
      else seat(b.subject).failed_calls++;
    } else if (b.annotation === "transcript") {
      const d = b.data ?? {};
      if (d.purpose === "translator") {
        // Each attempt the translator made for a request: its transcript carries the draft id as `ref`.
        tr.model_calls++;
        const r = d.ref ? req(d.ref, e.t) : undefined;
        if (r) r.attempts++;
      } else if (d.purpose === "participant") {
        // A seat's answer: its content blocks are the tool uses (and any words), one count by tool name.
        const s = seat(b.subject);
        s.model_calls++;
        s.last_sat_day = Math.floor(e.t / 86_400) + 1;
        const uses = (Array.isArray(d.output) ? d.output : []).filter((x: any) => x?.type === "tool_use");
        for (const u of uses) count(s.tool_uses, String(u.name));
        if (!uses.length) s.answers_without_tool_use++;
      }
    } else if (b.annotation === "note" && b.subject && b.data) {
      // What the participant noted about its own seat's answers (participants/src/llm/participant.ts), by reason.
      const d = b.data;
      if (b.subject === "orchestrator") continue;
      if (d.translation_retry) { tr.retries++; const r = req(d.translation_retry.draft, e.t); if (r) r.retries++; continue; }
      const s = seat(b.subject);
      if (d.malformed_tool_use !== undefined) count(s.malformed_tool_uses, String(d.reason ?? "?"));
      if (d.dropped_tool_use !== undefined) count(s.dropped_tool_uses, String(d.reason ?? "?"));
      if (d.look_each_sitting) s.notes.look_each_sitting++;
      if (d.no_turn) s.notes.no_turn++;
      if (d.prompt_too_long) s.prompts_too_long++;
      // (A sitting missed: the participant notes each. A log from before it did has the run's own note of a seat whose
      // model call failed, which was the same thing: the larger of the two counts is the sittings missed.)
      if (d.debrief_skipped !== undefined) notDebriefed.set(b.subject, String(d.debrief_skipped).slice(0, 200));
      if (d.sitting_missed) { s.sittings_missed++; s.missed_days.push(Math.floor(e.t / 86_400) + 1); }
      if (d.participant_error && /^ModelCallFailed/.test(String(d.participant_error.error ?? ""))) { s.failed_to_decide++; if (!s.missed_days.includes(Math.floor(e.t / 86_400) + 1)) s.missed_days.push(Math.floor(e.t / 86_400) + 1); }
      if (d.prompt_trimmed) s.prompts_trimmed++;
      if (d.look_cut) s.looks_cut++;
      if (d.not_sent) count(s.not_sent, String(d.not_sent.what ?? "?"));
      if (d.notebook_not_changed) {
        s.notes.notebook_not_changed++;
        for (const why of d.notebook_not_changed.reasons ?? []) count(s.notebook_not_changed_reasons, String(why).slice(0, 120));
      }
    } else if (b.annotation === "debrief") {
      debriefed.add(b.subject);
    } else if (b.annotation === "draft") {
      const r = req(b.draft?.id ?? "", e.t);
      if (r) r.ending = "draft_offered";
    } else if (b.annotation === "translation_failure") {
      // A request that ended without a draft: `call` is what the translator answered, `reason` the sentence the seat read.
      const r = req(b.data?.draft ?? "", e.t);
      if (!r) continue;
      const reason = String(b.data?.reason ?? "");
      Object.assign(r, endingOf(b.data?.call, reason, b.data?.asked_back === true ? true : undefined), { sentence: reason });
      if (r.ending === "asked_back") askBacks.push({ draft: r.id, t: e.t, sentence: reason });
    } else if (b.annotation === "signoff") {
      // The seat's answer to a draft: accept (confirmed) or reject (declined).
      const r = req(b.draft ?? "", e.t);
      if (r) r.signoff = b.decision;
    }
  }

  // The seats and their models: the run's own record of who sat (the adapter that answered, and what was configured).
  const sitting = config?.llm?.participants ?? {};
  for (const [name, p] of Object.entries<any>(sitting)) { const s = seat(name); s.model = p.adapter ?? s.model; s.configured = p.configured; }
  const pilot = pilotFile(dir);
  const until = pilot.queue?.until ?? untilOf(dir);
  const byTime = [...reqs.values()].sort((a, b) => a.t - b.t || a.n - b.n);

  const bySeat: { [k: string]: any } = {};
  const allMatters: { tries: number; through: boolean }[] = [];
  let stuck = { seat: null as string | null, length: 0 };
  for (const name of new Set(byTime.map((r) => r.seat))) {
    const mine = byTime.filter((r) => r.seat === name).sort((a, b) => a.n - b.n);
    const endings: { [k: string]: number } = {}, refused: { [k: string]: number } = {};
    for (const r of mine) { count(endings, r.ending); if (r.label) count(refused, r.label); }
    const matters = mattersOf(mine);
    allMatters.push(...matters);
    const run = longestAskBackRun(mine);
    if (run > stuck.length) stuck = { seat: name, length: run };
    bySeat[name] = {
      requests: mine.length, endings, refused_by_label: refused, matters: matters.length, matters_through_within_two_tries: matters.filter((m) => m.through).length,
      longest_ask_back_run: run, confirmed: mine.filter((r) => r.signoff === "accept").length, declined: mine.filter((r) => r.signoff === "reject").length,
    };
  }
  const drafted = byTime.filter((r) => r.ending === "draft_offered");
  const endings: { [k: string]: number } = {}, refused: { [k: string]: number } = {};
  for (const r of byTime) { count(endings, r.ending); if (r.label) count(refused, r.label); }
  const through = allMatters.filter((m) => m.through).length;

  const stopped = end ? { reason: end.reason, detail: end.detail, reached_until: until !== undefined ? (end.t ?? last) >= until : null } : { reason: "no end written", reached_until: until !== undefined ? last >= until : null };
  // A run that went as far as it was asked to has finished, whatever its log's end is called: a run cut at `until`,
  // short of the world's whole length, ends "aborted (stopped at <until>)" in the log, which is no fault and no stop.
  const finished = !!end && stopped.reached_until === true && (end.reason === "completed" || /^stopped at \d+$/.test(String(end.detail ?? "")));
  if (finished) Object.assign(stopped, { finished: true });
  // A seat that sat for less than its run: one that missed a sitting because its model did not answer. A pilot with
  // such a seat is not a finished pilot, however far its town ran, and the report says so first.
  const short: { seat: string; sittings_missed: number; days: number[]; last_sat_day: number | null }[] = [];
  for (const [name, s] of seats) {
    s.sittings_missed = Math.max(s.sittings_missed, s.failed_to_decide);
    delete s.failed_to_decide;
    if (s.sittings_missed) short.push({ seat: name, sittings_missed: s.sittings_missed, days: s.missed_days, last_sat_day: s.last_sat_day });
  }
  // (A debrief lost and never given: the pilot is not finished for that seat either.)
  const owed = [...notDebriefed].filter(([seat]) => !debriefed.has(seat)).map(([seat, why]) => ({ seat, why })).sort((a, b) => (a.seat < b.seat ? -1 : 1));
  return {
    ...(short.length || owed.length ? { not_whole: { ...(short.length ? { why: "a seat sat for less than its run: it missed sittings because its model did not answer", seats: short } : { seats: [] }), ...(owed.length ? { debriefs_not_given: owed } : {}) } } : {}),
    pilot: basename(resolve(dir)), run, log: basename(log),
    ...(pilot.queue?.test ? { test: true } : {}),
    ...(pilot.note ? { note: pilot.note } : {}),
    ...(existsSync(join(dir, "NOTE")) ? { folder_note: readFileSync(join(dir, "NOTE"), "utf8").trim() } : {}),
    seats: Object.fromEntries([...seats].filter(([, s]) => s.model_calls || s.model || s.opted_out).map(([k, s]) => [k, { model: s.model ?? null, ...(s.configured ? { configured: s.configured } : {}) }])),
    translator: { model: config?.llm?.translator?.model ?? null, version: config?.llm?.translator?.version ?? null },
    confirm: config?.confirm ?? null,
    days_run: Math.round(((end?.t ?? last) / 86_400) * 10) / 10, until_days: until !== undefined ? Math.round((until / 86_400) * 10) / 10 : null,
    stopped,
    // (The whole run's, as its log records it: every part of a run that was stopped and resumed.)
    cost: { recorded_microusd: totalMicroUsd, recorded_usd: (totalMicroUsd / 1e6).toFixed(2), model_calls: totalCalls },
    debriefs: { given: [...debriefed].sort(), not_given: owed },
    per_seat: Object.fromEntries([...seats].filter(([, s]) => s.model_calls || s.opted_out || s.sittings_missed).map(([k, s]) => { const { model: _m, configured: _c, ...rest } = s; return [k, rest]; })),
    translator_report: {
      model_calls: tr.model_calls, failed_calls: tr.failed_calls, cost_microusd: tr.cost_microusd, its_own_retries: tr.retries,
      requests: byTime.length, endings, refused_by_label: refused,
      asked_back: askBacks.sort((a, b) => a.t - b.t),
      drafts_offered: drafted.length, drafts_confirmed: drafted.filter((r) => r.signoff === "accept").length, drafts_declined: drafted.filter((r) => r.signoff === "reject").length,
      drafts_unanswered: drafted.filter((r) => !r.signoff).length,
      matters: allMatters.length, matters_through_within_two_tries: through,
      requests_per_matter_through: undefined,
      longest_ask_back_run: stuck,
      by_seat: bySeat,
    },
  };
}

/** A pilot folder's report(s): one for each run in it (a pilot has one), written as <DIR>/pilot-report.json. */
export async function pilotReport(dir: string, write = true): Promise<any> {
  const logs = currentLogs(dir).filter((f) => /\.seed\d+\.jsonl(\.zst)?$/.test(f)); // (a run's log, not the model calls' own logs beside it)
  if (!logs.length) throw new Error(`${dir}: no log to report on`);
  const reports = [];
  for (const log of logs) reports.push(await reportOfLog(dir, log));
  const out = reports.length === 1 ? reports[0] : { pilot: basename(resolve(dir)), runs: reports };
  if (write) writeFileSync(join(dir, "pilot-report.json"), JSON.stringify(out, null, 2) + "\n");
  return out;
}

/** A report as text. */
export function renderReport(r: any): string {
  if (r.runs) return r.runs.map(renderReport).join("\n\n");
  const L: string[] = [];
  const kv = (o: any) => Object.entries(o ?? {}).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  if (r.not_whole) {
    const short = r.not_whole.seats.length ? `a seat sat for less than its run. ${r.not_whole.seats.map((s: any) => `${s.seat} missed ${s.sittings_missed} sitting${s.sittings_missed === 1 ? "" : "s"} (day ${s.days.join(", ")}; its model did not answer) and last sat on day ${s.last_sat_day ?? "none"}${r.until_days !== null ? ` of ${r.until_days}` : ""}`).join("; ")}` : "";
    const owed = r.not_whole.debriefs_not_given?.length ? `${short ? ". And a" : "a"} debrief was not given: ${r.not_whole.debriefs_not_given.map((d: any) => d.seat).join(", ")}` : "";
    L.push(`NOT A FINISHED PILOT: ${short}${owed}`);
  }
  L.push(`== ${r.pilot} (${r.run})${r.test ? "  [TEST: kept out of training]" : ""}`);
  L.push(`seats: ${Object.entries(r.seats).map(([k, s]: any) => `${k} on ${s.model}`).join("; ") || "none"}`);
  L.push(`translator: ${r.translator.model ?? "none"}${r.translator.version ? ` ${r.translator.version}` : ""}; confirmation: ${r.confirm}`);
  L.push(`days run: ${r.days_run}${r.until_days !== null ? ` of ${r.until_days}` : ""}; ${r.stopped.finished ? "finished: it ran to its until" : `stopped: ${r.stopped.reason}${r.stopped.detail ? ` (${String(r.stopped.detail).slice(0, 160)})` : ""}${r.stopped.reached_until === true ? ", reached its until" : r.stopped.reached_until === false ? ", short of its until" : ""}`}`);
  if (r.cost) L.push(`recorded cost of the whole run: ${r.cost.recorded_usd} over ${r.cost.model_calls} model calls (as the log records it, in the money the models are priced in)${r.debriefs ? `; debriefs given: ${r.debriefs.given.length}${r.debriefs.not_given.length ? `, NOT given: ${r.debriefs.not_given.map((d: any) => d.seat).join(", ")}` : ""}` : ""}`);
  if (r.folder_note) L.push(`folder note: ${r.folder_note.slice(0, 400)}`);
  for (const [k, s] of Object.entries<any>(r.per_seat)) {
    L.push(`-- ${k}: ${s.model_calls} calls${s.failed_calls ? ` (${s.failed_calls} failed)` : ""}, ${s.cost_microusd} microusd; tool uses: ${kv(s.tool_uses)}; answers with no tool use: ${s.answers_without_tool_use}`);
    L.push(`   malformed: ${kv(s.malformed_tool_uses)}; dropped: ${kv(s.dropped_tool_uses)}; notes: ${kv(s.notes)}`);
    if (s.sittings_missed) L.push(`   SITTINGS MISSED: ${s.sittings_missed} (day ${(s.missed_days ?? []).join(", ")}): its model did not answer and nobody was in the seat; last sat on day ${s.last_sat_day ?? "none"}`);
    if (s.prompts_too_long || s.prompts_trimmed || s.looks_cut) L.push(`   PROMPT SIZE: ${s.prompts_too_long ?? 0} prompt${s.prompts_too_long === 1 ? "" : "s"} too long for its model (each a sitting not held); ${s.prompts_trimmed ?? 0} with something left out to stay within the most a prompt may be; ${s.looks_cut ?? 0} look${s.looks_cut === 1 ? "" : "s"} cut at the most one look shows`);
    if (Object.keys(s.not_sent ?? {}).length) L.push(`   NOT SENT (the seat was told each time): ${kv(s.not_sent)}`);
    if (s.opted_out) L.push(`   OPTED OUT on day ${s.opted_out.day}: ${JSON.stringify(s.opted_out.statement)}`);
  }
  const t = r.translator_report;
  L.push(`-- translator: ${t.requests} requests, ${t.model_calls} calls (${t.its_own_retries} own retries), ${t.cost_microusd} microusd`);
  L.push(`   endings: ${kv(t.endings)}; refused by label: ${kv(t.refused_by_label)}`);
  for (const a of t.asked_back) L.push(`   asked back ${a.draft}: ${a.sentence}`);
  L.push(`   drafts offered ${t.drafts_offered}: confirmed ${t.drafts_confirmed}, declined ${t.drafts_declined}, unanswered ${t.drafts_unanswered}`);
  L.push(`   matters ${t.matters}, through within two tries ${t.matters_through_within_two_tries}; longest run of ask-backs ${t.longest_ask_back_run.length}${t.longest_ask_back_run.seat ? ` (${t.longest_ask_back_run.seat})` : ""}`);
  for (const [k, s] of Object.entries<any>(t.by_seat)) L.push(`   ${k}: ${s.requests} requests (${kv(s.endings)}); matters ${s.matters}, through ${s.matters_through_within_two_tries}; confirmed ${s.confirmed}, declined ${s.declined}; longest ask-back run ${s.longest_ask_back_run}`);
  return L.join("\n");
}
