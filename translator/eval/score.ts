// The scored set: every real request we hold, with the call it should have been drawn as where one can be had honestly,
// and a rules version's score on it (docs/decisions.md, 2026-11-15, "A scored set from every real request"). Rule
// versions are chosen by this score, not by reading a run: a rule lands only if it raises the score on the whole set
// and misses nothing the set's baseline hits (translator/test/score.test.ts); a run's new phrasings enter the set
// before any rule is written for them.
//
// The set's targets:
//   (a) a request the seat confirmed: the call it confirmed; or, where docs/decisions.md explains the call drawn now as
//       a correction (translator/test/regress-explained.json), that corrected call (checked against its digest);
//   (b) a request the seat declined or was asked back on, followed by one it confirmed that asks the same thing: the
//       same seat, the same act in its first words (draft, send, send again, ask, report, scope request), naming the
//       same matter (a record the confirmed call's referral, matter, sign-off, return or claim blank holds, named in
//       the earlier request's words), the first confirmed after it on that matter: the confirmed call's target;
//   (c) nothing else has one. Requests no seat answered are not in it.
//
//   bun translator/eval/score.ts --build [--extract <file>]       the set, from the regress extract (run content: kept
//                                                                  beside it under runs/regress, out of git)
//   bun translator/eval/score.ts <version...> [--misses] [--baseline <file>]
//
// A version: `current` (this checkout's rules), `raw` (the model's draws with only the code-set fields: whose form it
// is and whom the work is for), or a git revision (its translator/src/rules.ts). Drawn exactly to target: the call,
// once ruled, does what the target does, resolved on the seat's knowledge as it stood (the same acts), on the model's
// first draw (a reading code sends back to the translator, `misread`, is a miss). Scored by run and by the target's
// form; `--misses` lists each miss; `--baseline <file>` writes the keys the version hits.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { calls } from "@oikos/participants";
import type { Knowledge } from "../src/knowledge";
import { resolve } from "../src/resolver";
import { canon, expand, explainedKeys, keyOf, replayOne, withKnowledge, type ArmLog, type CompactArm, type LoggedRequest } from "./requests";

export const REGRESS_DIR = join(process.env.OIKOS_RUNS ?? join(homedir(), "oikos/runs"), "regress");
export const EXTRACT = join(REGRESS_DIR, "requests.json.gz");
export const SET = join(REGRESS_DIR, "scored-set.json.gz");
const EXPLAINED = join(import.meta.dir, "..", "test", "regress-explained.json");

export interface Item { run: string; arm: string; ref: string; seat: string; target: string; how: "confirmed" | "corrected" | "later"; from?: string }
export interface ScoredSet { built: string; items: Item[]; unmatched: { run: string; arm: string; ref: string; why: string }[] }

export const itemKey = (x: { run: string; arm: string; ref: string }) => `${x.run}|${x.arm}|${x.ref}`;

export function loadArms(file = EXTRACT): ArmLog[] {
  return (JSON.parse(gunzipSync(readFileSync(file)).toString()) as CompactArm[]).map(expand);
}
export function loadSet(file = SET): ScoredSet {
  return JSON.parse(gunzipSync(readFileSync(file)).toString()) as ScoredSet;
}

/** The act a request asks for, in its first words. */
export function actOf(request: string): string {
  const w = request.trim().toLowerCase().replace(/^please\s+/, "");
  // (A form named in the first words, by id or name, "Fill in form-…-draft-rates-notice", "Using the send-signed form":
  // its act.)
  const f = /^(?:fill (?:in|out)|use|using|on|with)?\s*(?:the\s+)?(?:form[- :]+)?(?:[a-z0-9]+-)*?(draft|send-signed|send-again|question|report|scope-request|advice)\b/.exec(w.slice(0, 120).replace(/_/g, "-"));
  if (f && /^(fill|use|using|on|with|form|the)/.test(w)) return ({ draft: "draft", "send-signed": "send", "send-again": "send again", question: "ask", report: "report", "scope-request": "scope request", advice: "advice" } as { [k: string]: string })[f[1]!]!;
  if (/^(draft|drafting|prepare)\b|^for sign-?off\b|^fill (in|out) (the )?(form[- ])?draft/.test(w)) return "draft";
  if (/^(send|sending|re-?send)\b[^.]{0,40}\bagain\b|^send[- ]again\b/.test(w)) return "send again";
  if (/^(ask|query|question)\b[^.]{0,40}\bquestion\b|^question to\b/.test(w)) return "ask";
  if (/\bscope request\b|\bauthority\b|^request (for )?scope/.test(w.slice(0, 120)) && /^(send|ask|request|fill)/.test(w)) return "scope request";
  if (/^(send|sending|fill (in|out) (the )?send)/.test(w)) return "send";
  if (/^(ask|query|question)\b/.test(w)) return "ask";
  if (/^(report|file (form )?report|filing a report|fill (in|out) (the )?report)/.test(w)) return "report";
  return w.split(/\s+/)[0] ?? "";
}

/** The records a confirmed call names its matter by. */
function matterOf(call: string): string[] {
  try {
    const p = calls.parseProgram(call);
    if (!("lines" in p)) return [];
    return p.lines.flatMap((l) => ["referral", "matter", "sign_off", "returned", "claim", "order"].flatMap((f) => {
      const v = l.call.args[f];
      return v && "id" in v && /^rec\.[0-9]+$/.test(v.id) ? [v.id] : [];
    }));
  } catch { return []; }
}

/** The set, built from the extract: (a) and (b) above. */
export async function build(arms: ArmLog[]): Promise<ScoredSet> {
  const explained = await explainedKeys(EXPLAINED);
  const items: Item[] = [];
  const unmatched: ScoredSet["unmatched"] = [];
  for (const a of arms) {
    const target = new Map<string, Item>();
    for (const [r, k] of withKnowledge(a)) {
      if (r.decision !== "accept" || !r.call) continue;
      // (A correction explained: the call drawn now by this checkout's rules, if its digest is the one explained.)
      const now = replayOne(r, k).now;
      const corrected = explained.has(keyOf({ run: a.run, arm: a.arm, ref: r.ref, now })) && canon(now) !== canon(r.call);
      target.set(r.ref, { run: a.run, arm: a.arm, ref: r.ref, seat: r.seat, target: canon(corrected ? now : r.call), how: corrected ? "corrected" : "confirmed" });
    }
    const confirmed = a.requests.filter((r) => target.has(r.ref));
    for (const r of a.requests) {
      if (target.has(r.ref)) { items.push(target.get(r.ref)!); continue; }
      if (r.decision !== "reject" && !r.failure) continue;
      const act = actOf(r.request);
      const later = confirmed.filter((c) => c.seat === r.seat && c.seq > r.seq && actOf(c.request) === act);
      const named = (c: LoggedRequest) => matterOf(target.get(c.ref)!.target).some((id) => new RegExp(`\\b${id.replace(".", "\\.")}\\b`).test(r.request));
      const c = later.find(named);
      if (c) items.push({ ...target.get(c.ref)!, ref: r.ref, how: "later", from: c.ref });
      else unmatched.push({ run: a.run, arm: a.arm, ref: r.ref, why: later.length ? "no later confirmed request of the same act names its matter" : `no later confirmed request of the same act (${act})` });
    }
  }
  return { built: new Date().toISOString(), items, unmatched };
}

type Rules = { formRules: (p: calls.Program, request: string, k: any, isRecord?: (id: string) => boolean) => calls.Program; misread?: (p: calls.Program, request: string, k: any) => string | undefined; ruled: (p: calls.Program, request: string, isRecord: (id: string) => boolean) => { ok: true; program: calls.Program } | { ok: false; ask: string }; recordTest: (k: any) => (id: string) => boolean };

/** A rules version: this checkout's, the model's raw draws with the code-set fields only, or a git revision's. */
export async function rulesOf(version: string): Promise<{ rules: Rules; done: () => void }> {
  const here = await import("../src/rules");
  if (version === "current") return { rules: here as unknown as Rules, done: () => {} };
  if (version === "raw") return { rules: { ...(here as unknown as Rules), formRules: codeOnly, misread: undefined }, done: () => {} };
  const src = Bun.spawnSync(["git", "show", `${version}:translator/src/rules.ts`], { cwd: join(import.meta.dir, "..", "..") });
  if (src.exitCode !== 0) throw new Error(`no rules at ${version}: ${src.stderr.toString().slice(0, 200)}`);
  const file = join(import.meta.dir, "..", "src", `.score-rules-${version.replace(/[^a-z0-9]/gi, "_")}.ts`);
  writeFileSync(file, src.stdout);
  const rules = (await import(file)) as unknown as Rules;
  return { rules, done: () => existsSync(file) && unlinkSync(file) };
}

/** The model's draw with only what code sets: whose form it is (`to`), and whom the work is for (the matter's client). */
function codeOnly(p: calls.Program, _request: string, k: any): calls.Program {
  if (!("lines" in p)) return p;
  return { lines: p.lines.map((l) => {
    if (l.call.fn !== "form") return l;
    const args = { ...l.call.args };
    const name = args.form && "id" in args.form ? args.form.id : undefined;
    const held = (k.forms as any[]).filter((f) => f.data?.form === name && k.held.has(f.data?.office ?? f.in_position ?? f.speaks_for ?? f.author ?? ""));
    if (held.length === 1) args.to = { id: held[0].data?.office ?? held[0].in_position ?? held[0].speaks_for ?? held[0].author };
    const ref = args.referral && "id" in args.referral ? args.referral.id : undefined;
    if (held[0]?.data?.fields?.client && ref && k.referrals.has(ref)) args.client = { id: k.referrals.get(ref) };
    return { ...l, call: { ...l.call, args } };
  }) };
}

/** A call with its quoted words set aside. */
function wordless(call: string): string {
  // (Words: a quoted value with a letter and a space in it; figures, "$4,500.00", "12", stay.)
  const words = `"(?=[^"]*[A-Za-z])(?=[^"]* )(?:[^"\\\\]|\\\\.)*"`;
  return canon(call).replace(new RegExp(`, [a-z_]+=${words}`, "g"), "").replace(new RegExp(`\\([a-z_]+=${words}, `, "g"), "(");
}

/** What a program does, resolved on the seat's knowledge. */
function effect(p: calls.Program, k: Knowledge): string {
  const res = resolve(p, k, () => undefined, [...k.held][0], { written: true });
  return res.ok ? JSON.stringify(res.blocks) : `asked: ${res.questions.join(" ")}`;
}

export interface Score { hits: number; items: number; byRun: Map<string, [number, number]>; byForm: Map<string, [number, number]>; misses: { key: string; request: string; now: string; target: string }[]; hit: Set<string>; nearHits: number; nearByRun: Map<string, [number, number]> }

/** A rules version's score on the set. */
export function score(rules: Rules, set: ScoredSet, arms: ArmLog[]): Score {
  const want = new Map(set.items.map((x) => [itemKey(x), x]));
  const s: Score = { hits: 0, items: 0, byRun: new Map(), byForm: new Map(), misses: [], hit: new Set(), nearHits: 0, nearByRun: new Map() };
  for (const a of arms) for (const [r, k] of withKnowledge(a)) {
    const item = want.get(itemKey({ run: a.run, arm: a.arm, ref: r.ref }));
    if (!item || !r.raw) continue;
    let now = "";
    let ok = false;
    try {
      const fr = rules.formRules(calls.parseProgram(r.raw), r.request, k, rules.recordTest(k));
      const wrong = rules.misread?.(fr, r.request, k);
      const ru = wrong ? undefined : rules.ruled(fr, r.request, rules.recordTest(k));
      now = wrong ? `(asked again: ${wrong})` : ru!.ok ? calls.programText(ru!.program) : `(asked: ${ru!.ask})`;
      ok = !!ru?.ok && (canon(now) === item.target || effect(ru.program, k) === effect(calls.parseProgram(item.target), k));
    } catch (e) { now = `(failed: ${String((e as Error).message).slice(0, 100)})`; }
    const form = /form=([a-z_]+)/.exec(item.target)?.[1] ?? item.target.split("(")[0]!;
    const tally = (m: Map<string, [number, number]>, key: string) => { const t = m.get(key) ?? [0, 0]; t[1]++; if (ok) t[0]++; m.set(key, t); };
    s.items++;
    tally(s.byRun, a.run);
    tally(s.byRun, `target: ${item.how}`);
    if (item.how !== "corrected") tally(s.byRun, "all but the corrected");
    tally(s.byForm, form);
    const near = ok || (now.startsWith("form(") && wordless(now) === wordless(item.target));
    if (near) s.nearHits++;
    { const t = s.nearByRun.get(item.how) ?? [0, 0]; t[1]++; if (near) t[0]++; s.nearByRun.set(item.how, t); }
    if (ok) { s.hits++; s.hit.add(itemKey(item)); } else s.misses.push({ key: itemKey(item), request: r.request, now, target: item.target });
  }
  return s;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
  const extract = flag("--extract") ?? EXTRACT;
  if (argv[0] === "--build") {
    const set = await build(loadArms(extract));
    writeFileSync(SET, gzipSync(JSON.stringify(set), { level: 9 }));
    const how = (h: string) => set.items.filter((x) => x.how === h).length;
    console.log(`scored set: ${SET}\n  ${set.items.length} requests with a target: ${how("confirmed")} confirmed, ${how("corrected")} corrected (explained), ${how("later")} from a later confirmed request\n  ${set.unmatched.length} declined or asked back with no target:`);
    for (const [why, n] of Object.entries(set.unmatched.reduce((o, u) => ({ ...o, [u.why]: (o[u.why] ?? 0) + 1 }), {} as { [w: string]: number }))) console.log(`    ${n}: ${why}`);
    process.exit(0);
  }
  // (`--each-rule`: this checkout's rules with each rule switched off in turn: what each one is worth on the set, the
  // requests it alone draws to target, and those it alone draws away from it.)
  if (argv[0] === "--each-rule") {
    const set = loadSet();
    const arms = loadArms(extract);
    const { rules } = await rulesOf("current");
    const here = await import("../src/rules");
    const all = score(rules, set, arms);
    // (Its worth on the targets the rules did not set themselves: the corrected ones are this checkout's own draws.)
    const how = new Map(set.items.map((x) => [itemKey(x), x.how]));
    const own = (xs: string[]) => xs.filter((x) => how.get(x) !== "corrected").length;
    console.log(`all rules on: ${all.hits}/${all.items}\n\n| rule | standing | hits with it off | it alone draws to target (of them, not corrected targets) | it alone draws away | net | net, not corrected |\n|---|---|---|---|---|---|---|`);
    for (const name of here.RULE_NAMES()) {
      here.SWITCHED_OFF.clear();
      here.SWITCHED_OFF.add(name);
      const off = score(rules, set, arms);
      const gains = [...all.hit].filter((x) => !off.hit.has(x)), losses = [...off.hit].filter((x) => !all.hit.has(x));
      console.log(`| ${name} | ${here.STANDING_OF(name)} | ${off.hits} | ${gains.length} (${own(gains)}) | ${losses.length}${losses.length ? ` (${losses.slice(0, 4).join("; ")})` : ""} | ${gains.length - losses.length} | ${own(gains) - own(losses)} |`);
    }
    here.SWITCHED_OFF.clear();
    process.exit(0);
  }
  const showMisses = argv.includes("--misses") ? (argv.splice(argv.indexOf("--misses"), 1), true) : false;
  const baselineOut = flag("--baseline");
  if (!argv.length) { console.error("usage: bun translator/eval/score.ts --build | <current|raw|git-rev>... [--misses] [--baseline <file>]"); process.exit(2); }
  const set = loadSet();
  const arms = loadArms(extract);
  const results: [string, Score][] = [];
  for (const v of argv) {
    const { rules, done } = await rulesOf(v);
    try { results.push([v, score(rules, set, arms)]); } finally { done(); }
  }
  const pct = ([h, n]: [number, number]) => `${h}/${n} (${n ? ((100 * h) / n).toFixed(1) : "-"}%)`;
  const rows = (pick: (s: Score) => Map<string, [number, number]>) => [...new Set(results.flatMap(([, s]) => [...pick(s).keys()]))].sort();
  console.log(`| | ${results.map(([v]) => v).join(" | ")} |\n|---|${results.map(() => "---").join("|")}|`);
  console.log(`| all | ${results.map(([, s]) => pct([s.hits, s.items])).join(" | ")} |`);
  console.log(`| all, apart from words blanks | ${results.map(([, s]) => pct([s.nearHits, s.items])).join(" | ")} |`);
  console.log(`| target: later, apart from words blanks | ${results.map(([, s]) => pct(s.nearByRun.get("later") ?? [0, 0])).join(" | ")} |`);
  for (const r of rows((s) => s.byRun)) console.log(`| ${r} | ${results.map(([, s]) => pct(s.byRun.get(r) ?? [0, 0])).join(" | ")} |`);
  for (const f of rows((s) => s.byForm)) console.log(`| form ${f} | ${results.map(([, s]) => pct(s.byForm.get(f) ?? [0, 0])).join(" | ")} |`);
  if (showMisses) for (const [v, s] of results) {
    console.log(`\n## misses, ${v} (${s.misses.length})`);
    for (const m of s.misses) console.log(`- ${m.key}\n    asked:  ${m.request.replace(/\s+/g, " ").slice(0, 200)}\n    now:    ${m.now.slice(0, 220)}\n    target: ${m.target.slice(0, 220)}`);
  }
  if (baselineOut) writeFileSync(baselineOut, `${JSON.stringify([...results[0]![1].hit].sort(), null, 0).replace(/","/g, '",\n"')}\n`);
}
