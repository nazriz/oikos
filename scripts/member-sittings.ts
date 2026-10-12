#!/usr/bin/env bun
// How often a tribunal member's seat sits, and what each sitting costs in calls and prompt, on the mock (no model is
// called). The living pilots' fault: the member's seat sat 33 times in 90 days for 56 cases, 139 calls, 4 calls a
// sitting, and its books list said "entries 9+ unseen" (docs/decisions.md, "A day's ripe cases reach the member in
// one paper"). The mock cannot read prose, so a READER plays the seat: the office's own code acts (as in a mock seat),
// and the reader does what a person with only the page does before acting: it opens what it has not been shown in
// full (the books paper, a part at a time, `from_entry` as each answer says), and sets its own day of return.
//
//   bun scripts/member-sittings.ts --world W.yaml [--sets k=v,...] [--days 90] [--heavy N] [--reader plain|careful]
//        [--returns own|list] [--out DIR] [--label NAME]
//
// - `--reader plain`: looks only for a ripe case's line it was not shown whole; `careful`: besides, looks at each
//   ripe application's own paper (two turns, as lv-05's model did: `about` the lease, then the paper) before acting.
// - `--returns own`: done for now, back on the next case's day (what lv-05's model did); `list`: back in a week,
//   relying on the day's list to bring it (what the paper tells a seat: possible only where the list does).
// - `--heavy N`: N tenancies brought before the tribunal as the opening caseload does (test-only: papers added to the
//   generated config; answer-by days spread over the run), for a town that opens with few.
// Prints one table row (and writes it to <out>/result.json); the run's log is removed unless --keep.

import { readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmRequest, MockPolicy } from "../participants/src/llm";
import { generate } from "../worlds/generator/generate";
import { runWorld } from "../orchestrator/src/run";

const DAY = 86_400;
const arg = (name: string, otherwise: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1]! : otherwise; };
const has = (name: string) => process.argv.includes(`--${name}`);

const SEAT = "tribunal-member";
const FILES = `${SEAT}/files`;

/** N more tenancies before the tribunal, as the generator's opening caseload makes them (generate.ts, `opening_caseload`). */
export function heavyCaseload(config: any, n: number, over: number): number {
  const recs: any[] = config.world.records;
  const ids = new Set(recs.map((r) => r.id));
  const leases = recs.filter((r) => r.record === "agreement" && r.terms?.template === "lease" && !ids.has(`${r.id}-rent-book`) && !ids.has(`${r.id}-possession`) && r.terms.parties?.length === 2);
  const staying = (r: any) => r.terms.commitments?.flatMap((c: any) => (c.does?.outcome?.occupancy ? [c.does.outcome.occupancy.in as string] : [])).find(Boolean) as string | undefined;
  const rent = (r: any) => Number(r.terms.commitments?.map((c: any) => c.does?.outcome?.money?.amount).find(Boolean) ?? 50_000_00);
  let made = 0, seed = 402;
  for (let i = 0; i < leases.length && made < n; i += Math.max(1, Math.floor(leases.length / (n * 2)))) {
    const l = leases[i]!;
    const space = staying(l);
    if (!space) continue;
    const [landlord, tenant] = l.terms.parties as [string, string];
    const structure = space.split("/")[0]!;
    const monthly = rent(l);
    // (Days to answer by drawn over the first `over` days, from a fixed generator: some days have several, as an opening list does.)
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    // (At 06:00, before the seat's sitting opens at 08:00: the code that stands in for the member decides only once the hour its
    // own rule names has come, so a case due at 09:00 would be left to the next sitting whoever sits, and say nothing of the lists.)
    const answerBy = (1 + Math.floor((seed / 2_147_483_648) * over)) * DAY + 6 * 3600;
    const both = [landlord, tenant];
    const paper = (id: string, kind: string, by: string, to: string[], visible: string[], basis: string, text: string, data: object) =>
      recs.push({ id, record: "statement", author: "genesis", at: 0, visible_to: visible, speaks_for: by, kind, addressed_to: to, basis, text, data: { ...data, brought_forward: true } });
    const given = -40 * DAY, by = -9 * DAY, applied = -8 * DAY;
    paper(`${l.id}-rent-book`, "rent_statement", landlord, [tenant], both, l.id, `Statement of the rent account under ${l.id}: 4 rents owed.`, { lease: l.id, owed: 4 * monthly, rents: 4, rent: monthly, since: -100 * DAY, account: `acc-${landlord}` });
    paper(`${l.id}-vacate`, "notice_to_vacate", landlord, [tenant], both, l.id, `Notice to vacate, given 40 days before the year began: the rent under ${l.id} is in arrears. You are to leave ${space} within 31 days.`,
      { lease: l.id, reason: "arrears", arrears: 2 * monthly, by, given, law: "law-possession" });
    const application = { kind: "possession", matter: "possession", against: tenant, about: l.id, amount: 4 * monthly, rent: monthly, account: `acc-${landlord}`, space, structure, household: [tenant],
      notice: `${l.id}-vacate`, notice_given: given, notice_by: by, evidence: { id: l.id, record: "agreement" } };
    paper(`${l.id}-possession`, "tribunal_application", landlord, ["tribunal"], [landlord, "tribunal", tenant], l.id, `Application for possession: ${tenant} is behind with the rent under ${l.id} and has not left on our notice to vacate.`, { ...application, applied_at: applied });
    paper(`${l.id}-hearing`, "hearing_notice", "tribunal", both, [...both, "tribunal"], `${l.id}-possession`, `${landlord} has applied to us about possession (application ${l.id}-possession). You may answer by day ${Math.floor(answerBy / DAY)}.`,
      { application: `${l.id}-possession`, kind: "possession", matter: "possession", applicant: landlord, against: tenant, hearing_at: answerBy, answer_by: answerBy, about: l.id, amount: application.amount, structure });
    made++;
  }
  return made;
}

const textOf = (c: unknown): string => (typeof c === "string" ? c : (c as any[]).map((b) => (typeof b.content === "string" ? b.content : Array.isArray(b.content) ? textOf(b.content) : b.text ?? JSON.stringify(b.input ?? ""))).join("\n"));
const allText = (r: LlmRequest) => r.messages.map((m) => textOf(m.content)).join("\n");
const sizeOf = (r: LlmRequest) => r.system.length + r.messages.reduce((a, m) => a + textOf(m.content).length, 0);

export interface Reading { reader: "plain" | "careful"; returns: "own" | "list" }
export interface Tally { sittings: number; calls: number; prompts: number[]; messages: number[]; fromEntry: number; looks: number; sittingDays: number[] }

/** The reader in the member's seat: acts as the office's code does (the inner policy), after looking at what it was not shown. */
export function readerOf(how: Reading, tally: Tally): (inner: MockPolicy) => MockPolicy {
  const seen = new Map<string, any>(); // every record it has been shown, by id
  let day = -1;
  let stash: any[] | undefined; // what the code would do, kept while the reader looks first
  let step: { books: string; careful: number } = { books: "", careful: 0 };
  return (inner) => async (req) => {
    if (req.subject !== `${SEAT}-system` || req.context?.consult || req.purpose !== "participant") return inner(req);
    const fresh = req.messages.length === 1;
    const obs = req.context.observation;
    for (const o of [...(req.context.missed ?? []), obs]) for (const ch of Object.values(o.channels ?? {}) as any[]) for (const r of ch.records ?? []) seen.set(r.id, r);
    tally.calls++;
    if (fresh) {
      tally.sittings++;
      tally.sittingDays.push(Math.floor(obs.t / DAY));
      tally.prompts.push(sizeOf(req));
      tally.messages.push(textOf(req.messages.at(-1)!.content).length);
      day = Math.floor(obs.t / DAY);
      stash = undefined;
      step = { books: "", careful: 0 };
    }
    const drafts = obs.drafts ?? [];
    // (A person confirms what is in front of them in one answer, as asking for several things takes one answer: eight to an answer.)
    if (drafts.length) return drafts.slice(0, 8).map((d: any, i: number) => ({ type: "tool_use" as const, id: `c${tally.calls}-${i}`, name: "confirm", input: { ref: d.id, decision: "confirm" } }));
    let out: any[] = stash ?? (await inner(req));
    if (!stash && out.some((b) => b.type === "tool_use" && b.name === "do")) {
      // (And the code's decisions, as many as it has to make, are asked for in the one answer.)
      for (let more = 0; more < 7; more++) {
        const next: any[] = await inner(req);
        const dos = next.filter((b) => b.type === "tool_use" && b.name === "do");
        if (!dos.length) break;
        out = [...out, ...dos];
      }
    }
    // The ripe cases the reader knows of from its latest books paper (the list is a standing one), and what of each it was shown whole.
    const papers = [...seen.values()].filter((r) => r.record === "statement" && r.kind === "office_books" && r.data?.office === SEAT).sort((a, b) => a.at - b.at);
    const latest = papers.at(-1);
    const ripe = ((latest?.data?.open ?? []) as any[]).map((e, i) => ({ ...e, n: i + 1 })).filter((e) => e.due !== undefined && Math.floor(e.due / DAY) <= day);
    const text = allText(req);
    const shown = (e: any) => text.includes(e.says);
    const acts = out.some((b) => b.type === "tool_use" && b.name === "do");
    const done = out.find((b) => b.type === "tool_use" && b.name === "done_for_now");
    if (!acts && !done && !stash) return out;
    let turn = 0;
    const use = (name: string, input: object) => ({ type: "tool_use" as const, id: `r${Date.now()}-${tally.calls}-${turn++}`, name, input });
    const lacking = ripe.filter((e) => !shown(e));
    if (latest && lacking.length && (acts || ripe.length)) {
      // (Open the books paper, a part at a time; the answer says where to go on.)
      const said = [...text.matchAll(/from_entry: (\d+)/g)].map((m) => Number(m[1]));
      const from = step.books ? Math.max(...said.filter((n) => n > 1), 0) : 0;
      const opened = step.books === latest.id;
      if (!opened || (from && lacking.some((e) => e.n >= from))) {
        step.books = latest.id;
        tally.looks++;
        if (opened) tally.fromEntry++;
        stash = stash ?? out;
        return [use("look", { report: `${SEAT}/staff-reports`, paper: latest.id, ...(opened ? { from_entry: from } : {}) })];
      }
      // (Cut off in the list too: the application's own paper.)
      if (step.careful < 1) { step.careful = 1; stash = stash ?? out; tally.looks++; return lacking.slice(0, 8).map((e) => use("look", { report: FILES, paper: String(e.about) })); }
    }
    if (how.reader === "careful" && acts && ripe.length && step.careful < 3) {
      step.careful = step.careful === 0 ? 2 : 3;
      stash = stash ?? out;
      tally.looks++;
      return ripe.slice(0, 8).map((e) => use("look", step.careful === 2 ? { report: FILES, about: String(e.about) } : { report: FILES, paper: String(e.about) }));
    }
    stash = undefined;
    // Done for now: back on the next case's day, or in a week and the list brings it.
    if (done) {
      const next = ((latest?.data?.open ?? []) as any[]).map((e) => e.due).filter((d) => d !== undefined && Math.floor(d / DAY) > day).sort((a, b) => a - b)[0];
      const days = how.returns === "list" ? 7 : next !== undefined ? Math.max(1, Math.floor(next / DAY) - day) : 7;
      return out.map((b) => (b === done ? { ...done, input: { ...done.input, days } } : b));
    }
    return out;
  };
}

if (import.meta.main) {
  const world = arg("world", "");
  const days = Number(arg("days", "90"));
  const heavy = Number(arg("heavy", "0"));
  const how: Reading = { reader: arg("reader", "plain") as any, returns: arg("returns", "own") as any };
  const out = arg("out", join(import.meta.dir, "..", "runs", "test-member-sittings"));
  const label = arg("label", "run");
  const sets = arg("sets", "").split(",").filter(Boolean);
  const spec = Bun.YAML.parse(readFileSync(world, "utf8")) as any;
  // (The founding of new bodies and the composer are not the point and need models: left out, the same on both sides.)
  if (spec.living) { delete spec.living.composer; delete spec.living.founding; }
  for (const s of sets) { const [k, v] = s.split("="); spec[k!] = /^-?\d+$/.test(v!) ? Number(v) : v; }
  spec.mayor = "code";
  spec.model_seats = SEAT;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const config: any = generate(spec);
  const added = heavy ? heavyCaseload(config, heavy, Math.min(60, days - 5)) : 0;
  const tally: Tally = { sittings: 0, calls: 0, prompts: [], messages: [], fromEntry: 0, looks: 0, sittingDays: [] };
  const t0 = Date.now();
  const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: label, outDir: out, until: days * DAY, recordObservations: "none", mockParticipant: readerOf(how, tally) });
  // From the log: the member's orders, and when each application's time to answer ran out.
  const lists: any[] = [];
  const answerBy = new Map<string, number>(), orders: { app: string; at: number; finding: string }[] = [], decidedBy = new Map<string, number>();
  // (The papers the town opened with are in its config, not in the log as events.)
  for (const r of config.world.records as any[]) if (r.kind === "hearing_notice" && r.data?.application && r.data.answer_by > 0) answerBy.set(r.data.application, r.data.answer_by);
  for (const line of readFileSync(s.logPath, "utf8").split("\n")) {
    if (!line.includes('"recorded"')) continue;
    const e = JSON.parse(line);
    const r = e.body?.record;
    if (e.body?.event !== "recorded" || !r) continue;
    if (r.kind === "hearing_notice" && r.data?.application && r.data.answer_by !== undefined && !answerBy.has(r.data.application)) answerBy.set(r.data.application, r.data.answer_by);
    if (r.kind === "office_books" && String(r.author).startsWith(`${SEAT}-staff`) && r.data?.list) lists.push({ at: +(r.at / DAY).toFixed(2), ...r.data.list, ids: (r.data.open as any[]).filter((e) => e.due !== undefined && Math.floor(e.due / DAY) <= Math.floor(r.at / DAY)).map((e) => String(e.about)) });
    if (r.kind === "tribunal_order" && String(r.author).startsWith(SEAT)) { orders.push({ app: r.data.application, at: r.at, finding: r.data.finding }); decidedBy.set(r.data.application, r.at); }
  }
  const late = orders.filter((o) => answerBy.has(o.app)).map((o) => (o.at - answerBy.get(o.app)!) / DAY);
  // In working days (the seat's calendar: five of seven): the working days after the case's day up to and including the day it was decided.
  const working = (d: number) => d % 7 < 5;
  const lag = orders.filter((o) => answerBy.has(o.app)).map((o) => { let n = 0; for (let d = Math.floor(answerBy.get(o.app)! / DAY) + 1; d <= Math.floor(o.at / DAY); d++) if (working(d)) n++; return n; });
  const decisionDays = new Set(orders.map((o) => Math.floor(o.at / DAY)));
  const deadSittings = tally.sittingDays.filter((d) => !decisionDays.has(d)).length;
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const ripeUndecided = [...answerBy].filter(([app, by]) => by < (days - 1) * DAY && by > 0 && !decidedBy.has(app)).length;
  const result = {
    label, world, days, heavy: added, reader: how.reader, returns: how.returns,
    sittings: tally.sittings, calls: tally.calls, cases_decided: orders.length, calls_per_decision: orders.length ? +(tally.calls / orders.length).toFixed(2) : null,
    first_prompt_median: med(tally.prompts), first_prompt_largest: Math.max(0, ...tally.prompts),
    first_message_median: med(tally.messages), first_message_largest: Math.max(0, ...tally.messages),
    looks: tally.looks, looks_with_from_entry: tally.fromEntry,
    lateness_days: { median: +med(late).toFixed(2), largest: +Math.max(0, ...late).toFixed(2), decided_over_1_day_late: late.filter((x) => x > 1.0).length, measured: late.length },
    lag_working_days: { median: med(lag), largest: Math.max(0, ...lag), decided_same_day: lag.filter((x) => x === 0).length, decided_next_working_day: lag.filter((x) => x === 1).length, decided_later: lag.filter((x) => x > 1).length, measured: lag.length },
    sittings_with_no_decision: deadSittings, calls_per_sitting: tally.sittings ? +(tally.calls / tally.sittings).toFixed(2) : null,
    ripe_before_the_last_day_and_undecided: ripeUndecided,
    sitting_days: tally.sittingDays, dead_sitting_days: tally.sittingDays.filter((d) => !decisionDays.has(d)), list_papers: lists, order_days: [...decisionDays].sort((a, b) => a - b), state_hash: s.stateHash, seconds: Math.round((Date.now() - t0) / 1000),
    estimate_usd_at_lv05_per_call: +(tally.calls * 0.048).toFixed(2),
  };
  writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ ...result, sitting_days: undefined }));
  if (!has("keep")) { rmSync(s.logPath, { force: true }); }
}
