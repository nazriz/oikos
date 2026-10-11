// What a trained translator drafts on a finished run's own requests when it is shown as many forms as its reader
// takes (translator/model/subset.ts), measured offline from the run's log: no seat is called, nothing is replayed,
// and the only model asked is the local trained one, which costs nothing.
//
//   OIKOS_TRANSLATOR_MODELS=<models folder> bun translator/eval/forms-shown.ts decide/<name> <run folder>... [--json FILE] [--new-since <older run folder>]
//
// For each request in the run's dataset (`translations.jsonl`: `oikos dataset` writes it) it rebuilds what the
// translator was shown (the request and the forms' lines, from the logged exchange), says of each form whether it is
// the asker's own office's and what it is for (from the form's record in the run's opening world and the posts the
// asker holds), asks the model as a run would with another translator behind it, and compares its draft with the
// call the seat was finally offered and whether the seat confirmed that (same meaning: translator/train/meaning.ts,
// the real requests' scorer's rule). It does not run the resolver or the check of a draft's acts: a "draft" here is
// a program of the call language that passes the check of its form against the form's line, which is what the
// adapter offers. `--new-since`: forms whose names the older run's world did not have are counted apart (a model
// trained before them has never seen them).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DecideAdapter, shown } from "../model/adapter";
import { partsOf } from "../model/subset";
import { sameButForFreeText, sameMeaning } from "../train/meaning";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const jsonOut = flag("json"), newSince = flag("new-since");
const [model, ...runs] = args;
if (!model?.startsWith("decide/") || !runs.length) throw new Error("usage: bun translator/eval/forms-shown.ts decide/<name> <run folder>... [--json FILE] [--new-since <older run folder>]");

/** A run's opening config (the first line of its log). */
function configOf(dir: string): any {
  const log = readdirSync(dir).find((f) => f.endsWith(".jsonl.zst") || (f.endsWith(".jsonl") && !f.includes(".calls.") && !f.includes("anchors") && !f.includes("debriefs")));
  if (!log) throw new Error(`${dir}: no log`);
  const out = log.endsWith(".zst") ? spawnSync("sh", ["-c", `zstd -dc '${join(dir, log)}' 2>/dev/null | head -1`], { maxBuffer: 1 << 30 }).stdout.toString() : readFileSync(join(dir, log), "utf8").split("\n", 1)[0]!;
  return JSON.parse(out).body.config;
}
const formsOf = (config: any): Map<string, any> => new Map((config.world.records as any[]).filter((r) => r.kind === "form").map((r) => [r.id, r]));
const older = newSince ? new Set([...formsOf(configOf(newSince)).values()].map((f) => String(f.data?.form))) : undefined;

const adapter = new DecideAdapter(model.slice(7), { first: true, quiet: true });
await adapter.ready();

interface Row { run: string; draft: string; seat: string; day: number; founder: boolean; forms_of: number; forms_shown: number; before: string; now: string; sure: number; program: string; final_call?: string; confirmed?: boolean; same?: "same" | "same_but_free_text" | "different"; new_form?: string; final_form?: string }
const rows: Row[] = [];
for (const dir of runs) {
  const config = configOf(dir);
  const forms = formsOf(config);
  const currency = config.world.currencies?.[0];
  const dataset = readdirSync(dir).find((f) => f.endsWith(".dataset"));
  if (!dataset || !existsSync(join(dir, dataset, "translations.jsonl"))) throw new Error(`${dir}: no dataset with translations.jsonl (oikos dataset)`);
  const held = new Map<string, Set<string>>(), acts = new Map<string, string>();
  for (const p of config.positions as any[]) if (p.holder) (held.get(p.holder) ?? held.set(p.holder, new Set()).get(p.holder)!).add(p.id);
  for (const p of config.participants as any[]) acts.set(p.id, p.owner ?? p.entity ?? p.id);
  for (const line of readFileSync(join(dir, dataset, "translations.jsonl"), "utf8").split("\n")) {
    if (!line) continue;
    const x = JSON.parse(line);
    if (x.synthetic) continue;
    const input = x.exchange?.[0]?.input;
    if (typeof input !== "string") continue;
    const { request, forms: lines } = shown(input);
    const mine = held.get(x.participant) ?? new Set<string>(), entity = acts.get(x.participant) ?? x.participant;
    const facts = lines.map((l) => {
      const f = forms.get(partsOf(l).id);
      return { own: !!f && ((typeof f.data?.office === "string" && mine.has(f.data.office)) || (!!f.in_position && mine.has(f.in_position)) || f.speaks_for === entity || f.author === x.participant), about: typeof f?.text === "string" ? f.text.slice(0, 400) : "" };
    });
    const a = await adapter.translate(request, lines, { facts });
    const ctx = { currency, forms: lines.map((l) => { const p = partsOf(l), f = forms.get(p.id); return { form: p.name, to: /, to=([^,]+),/.exec(l)?.[1] ?? "", id: p.id, fields: (f?.data?.fields ?? {}) as { [k: string]: { type: string } } }; }) };
    const now = a.withheld ? `no draft (${a.withheld})` : /^none\((\w+)\)$/.test(a.program) ? `refusal ${a.program}` : "draft";
    const first = x.route?.first;
    const before = !first ? "(no route)" : first.result === "draft" ? "draft" : first.withheld ? `no draft (${first.withheld})` : `${first.result}${first.label ? ` ${first.label}` : ""}`;
    const finalCall: string | undefined = x.result === "drafted" ? x.call : undefined;
    let same: Row["same"];
    if (now === "draft" && finalCall) {
      try { same = sameMeaning(a.program, finalCall, ctx) ? "same" : sameButForFreeText(a.program, finalCall, ctx) ? "same_but_free_text" : "different"; } catch { same = a.program === finalCall ? "same" : "different"; }
    }
    const finalForm = /form=([\w-]+)/.exec(finalCall ?? "")?.[1];
    rows.push({ run: dir.split("/").filter(Boolean).at(-1)!, draft: x.draft, seat: x.as ?? x.participant, day: Math.floor(x.t / 86_400), founder: /^c\d+/.test(x.participant), forms_of: lines.length, forms_shown: a.shown?.forms.length ?? lines.length, before, now, sure: Math.round(a.sure * 1000) / 1000, program: a.program === "none(unclear)" && a.wrote ? `${a.program} [wrote: ${a.wrote}]` : a.program,
      ...(finalCall ? { final_call: finalCall, confirmed: x.signoff?.decision === "accept" } : {}), ...(same ? { same } : {}), ...(finalForm ? { final_form: finalForm } : {}), ...(older && finalForm && !older.has(finalForm) ? { new_form: finalForm } : {}) });
  }
}
adapter.close();

const count = (xs: Row[], f: (r: Row) => string) => { const c: { [k: string]: number } = {}; for (const r of xs) c[f(r)] = (c[f(r)] ?? 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join("; "); };
const L: string[] = [];
for (const run of [...new Set(rows.map((r) => r.run))]) {
  const all = rows.filter((r) => r.run === run);
  for (const [what, xs] of [["seats' requests", all.filter((r) => !r.founder)], ["founders' requests (the composer's parts)", all.filter((r) => r.founder)]] as const) {
    if (!xs.length) continue;
    L.push(`${run}, ${what}: ${xs.length}`);
    L.push(`  in the run, the trained model: ${count(xs, (r) => r.before)}`);
    L.push(`  now, shown what its reader takes: ${count(xs, (r) => r.now)}`);
    const cut = xs.filter((r) => r.forms_shown < r.forms_of);
    L.push(`  shown fewer forms than the asker knows of: ${cut.length}${cut.length ? ` (of ${[...new Set(cut.map((r) => r.forms_of))].join("/")} forms, shown ${Math.min(...cut.map((r) => r.forms_shown))} to ${Math.max(...cut.map((r) => r.forms_shown))})` : ""}`);
    const drafts = xs.filter((r) => r.now === "draft");
    const against = drafts.filter((r) => r.final_call && r.confirmed);
    L.push(`  its drafts now: ${drafts.length}; of those where the seat confirmed a draft in the run (${against.length}): ${count(against, (r) => r.same ?? "?") || "none"}`);
    const declined = drafts.filter((r) => r.final_call && r.confirmed === false);
    if (declined.length) L.push(`  against a draft the seat declined (${declined.length}): ${count(declined, (r) => r.same ?? "?")}`);
    for (const seat of [...new Set(xs.map((r) => r.seat))]) {
      const s = xs.filter((r) => r.seat === seat);
      if (s.length > 1 && !s[0]!.founder) L.push(`    ${seat}: ${s.length} requests; now ${count(s, (r) => r.now)}; confirmed in the run and drafted now ${s.filter((r) => r.now === "draft" && r.confirmed).length}: ${count(s.filter((r) => r.now === "draft" && r.confirmed), (r) => r.same ?? "?") || "none"}`);
    }
    if (older) {
      const fresh = xs.filter((r) => r.new_form);
      L.push(`  on forms the model has never seen (${fresh.length} requests: ${count(fresh, (r) => r.new_form!)}): now ${count(fresh, (r) => r.now) || "none"}; against the confirmed draft: ${count(fresh.filter((r) => r.now === "draft" && r.confirmed), (r) => r.same ?? "?") || "none"}`);
    }
  }
}
console.log(L.join("\n"));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ model, rows }, null, 1));
