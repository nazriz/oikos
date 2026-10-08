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
 * form's fields or options. The plain "could you say it more plainly" is the refusal `none(unclear)`'s own text and
 * can't be told from a refusal, so it is counted as one. */
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
export function endingOf(call: string | undefined, reason: string): { ending: Ending; label?: string } {
  if (ASK_BACK.some((r) => r.test(reason))) return { ending: "asked_back" };
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
      notes: { look_each_sitting: 0, no_turn: 0, notebook_not_changed: 0 }, notebook_not_changed_reasons: {} as { [k: string]: number }, opted_out: null as any,
    }));
    return s;
  };
  const tr = { model_calls: 0, failed_calls: 0, cost_microusd: 0, retries: 0 };
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
      if (d.notebook_not_changed) {
        s.notes.notebook_not_changed++;
        for (const why of d.notebook_not_changed.reasons ?? []) count(s.notebook_not_changed_reasons, String(why).slice(0, 120));
      }
    } else if (b.annotation === "draft") {
      const r = req(b.draft?.id ?? "", e.t);
      if (r) r.ending = "draft_offered";
    } else if (b.annotation === "translation_failure") {
      // A request that ended without a draft: `call` is what the translator answered, `reason` the sentence the seat read.
      const r = req(b.data?.draft ?? "", e.t);
      if (!r) continue;
      const reason = String(b.data?.reason ?? "");
      Object.assign(r, endingOf(b.data?.call, reason), { sentence: reason });
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
  return {
    pilot: basename(resolve(dir)), run, log: basename(log),
    ...(pilot.queue?.test ? { test: true } : {}),
    ...(pilot.note ? { note: pilot.note } : {}),
    ...(existsSync(join(dir, "NOTE")) ? { folder_note: readFileSync(join(dir, "NOTE"), "utf8").trim() } : {}),
    seats: Object.fromEntries([...seats].filter(([, s]) => s.model_calls || s.model || s.opted_out).map(([k, s]) => [k, { model: s.model ?? null, ...(s.configured ? { configured: s.configured } : {}) }])),
    translator: { model: config?.llm?.translator?.model ?? null, version: config?.llm?.translator?.version ?? null },
    confirm: config?.confirm ?? null,
    days_run: Math.round(((end?.t ?? last) / 86_400) * 10) / 10, until_days: until !== undefined ? Math.round((until / 86_400) * 10) / 10 : null,
    stopped,
    per_seat: Object.fromEntries([...seats].filter(([, s]) => s.model_calls || s.opted_out).map(([k, s]) => { const { model: _m, configured: _c, ...rest } = s; return [k, rest]; })),
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
  L.push(`== ${r.pilot} (${r.run})${r.test ? "  [TEST: kept out of training]" : ""}`);
  L.push(`seats: ${Object.entries(r.seats).map(([k, s]: any) => `${k} on ${s.model}`).join("; ") || "none"}`);
  L.push(`translator: ${r.translator.model ?? "none"}${r.translator.version ? ` ${r.translator.version}` : ""}; confirmation: ${r.confirm}`);
  L.push(`days run: ${r.days_run}${r.until_days !== null ? ` of ${r.until_days}` : ""}; stopped: ${r.stopped.reason}${r.stopped.detail ? ` (${String(r.stopped.detail).slice(0, 160)})` : ""}${r.stopped.reached_until === true ? ", reached its until" : r.stopped.reached_until === false ? ", short of its until" : ""}`);
  if (r.folder_note) L.push(`folder note: ${r.folder_note.slice(0, 400)}`);
  for (const [k, s] of Object.entries<any>(r.per_seat)) {
    L.push(`-- ${k}: ${s.model_calls} calls${s.failed_calls ? ` (${s.failed_calls} failed)` : ""}, ${s.cost_microusd} microusd; tool uses: ${kv(s.tool_uses)}; answers with no tool use: ${s.answers_without_tool_use}`);
    L.push(`   malformed: ${kv(s.malformed_tool_uses)}; dropped: ${kv(s.dropped_tool_uses)}; notes: ${kv(s.notes)}`);
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
