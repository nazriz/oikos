// Small models' requests (2026-11-11): every request a model seat made through Do in the given run logs, with what the
// translator was shown beside it (its form cards, exactly as in its input), what our model drafted and how sure it was,
// and what came of it (served first time, asked back with which sentence, served after a restatement, never served;
// confirmed, declined), the writing model and the seat-day. Logs are only read.
//   bun translator/train/small-models/collect.ts <out dir> <arm log>...
// Written: requests.jsonl (every request, in order), situations.jsonl (each situation's id, model and what it was
// shown, for reading by hand), self.jsonl (Dos the seat host sent to nobody as notes to itself), described.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runName, situationsOf, type Situation } from "../../../orchestrator/src/in-situ";
import { SELF_TALK } from "../../../participants/src/llm/note";

const [out, ...logs] = process.argv.slice(2);
if (!out || !logs.length) throw new Error("usage: bun collect.ts <out dir> <arm log>...");
mkdirSync(out, { recursive: true });

/** The form lines of a translator input (as in-situ.ts reads them). */
const formsIn = (input: unknown): string[] | undefined => {
  if (typeof input !== "string") return undefined;
  const at = input.indexOf("\nForms this person knows of:\n");
  return at < 0 ? [] : input.slice(at + 1).split("\n").slice(1).filter((l) => l.startsWith("- "));
};
const IDS = /\b(?:rec\.\d+|draft\.[\w-]+\.\d+|ask-\d+|c\d{4}|acc-[\w-]+|form-[\w-]+|house-\d+|apts-[\w./-]+|factory-\d+|provider-[\w-]+|par\.\d+)\b/g;

const rows: any[] = [];
const sits: any[] = [];
const selves: any[] = [];
for (const log of logs) {
  const run = runName(log, true);
  const dropped = new Map<string, string>();
  const route = new Map<string, any>(), failure = new Map<string, any>(), draft = new Map<string, any>(), signoff = new Map<string, string>();
  const got = await situationsOf(log, {
    run, keepCorpus: true,
    onEntry: (e) => {
      const b = e?.body ?? {};
      if (e?.kind !== "annotation") return;
      if (b.annotation === "note" && typeof b.data?.dropped_tool_use === "string") {
        try { const u = JSON.parse(b.data.dropped_tool_use); if (u?.name === "do" && typeof u.input?.what === "string") dropped.set(`${b.subject}\u0000${u.input.what}`, String(b.data.reason ?? "")); } catch { /* not a use */ }
      } else if (b.annotation === "note" && b.data?.translation_route) route.set(String(b.data.translation_route.draft), b.data.translation_route);
      else if (b.annotation === "translation_failure" && b.data?.draft && !b.data.drawn_up_again) failure.set(String(b.data.draft), b.data);
      else if (b.annotation === "draft" && b.draft?.id) draft.set(String(b.draft.id), b.draft);
      else if (b.annotation === "signoff" && b.draft && !signoff.has(String(b.draft))) signoff.set(String(b.draft), b.decision === "accept" ? "confirmed" : "declined");
    },
  });
  const shownForms = new Map<string, string[]>();
  for (const c of got.corpus ?? []) { const f = formsIn(c.exchange[0]?.input); if (f) shownForms.set(c.draft, f); }
  for (const x of got.situations as Situation[]) {
    const seatDay = `${run.replace(/^runs\//, "")}/${x.seat}/d${x.day}`;
    sits.push({ id: x.id, model: x.model, seat_day: seatDay, turn: x.turn, system_chars: x.system.length, shown: x.shown });
    for (const u of x.uses ?? []) if ((u.input as any)?._self) selves.push({ situation: x.id, model: x.model, seat_day: seatDay, said: (u.input as any)._self });
    x.requests.forEach((r, i) => {
      const d = r.draft;
      const rt = d ? route.get(d) : undefined, f = d ? failure.get(d) : undefined, dr = d ? draft.get(d) : undefined;
      const stage: string | undefined = rt?.stage;
      const outcome = !d ? "never_reached" : dr ? (stage === "restated" ? "served_after_restatement" : "served_first_time") : f ? (stage === "restated" ? "never_served" : "asked_back") : "unknown";
      const forms: string[] = (d ? shownForms.get(d) : undefined) ?? r.forms ?? x.forms ?? [];
      const named = [...new Set(r.request.match(IDS) ?? [])];
      const unseen = named.filter((id) => !x.shown.includes(id) && !x.system.includes(id) && !forms.some((l) => l.includes(id)));
      rows.push({
        source: `${run.replace(/^runs\//, "")}/${d ?? `${x.id}/do-${i + 1}`}`, request: r.request, forms, forms_from: d && shownForms.has(d) ? "translator_input" : "situation",
        model: x.model, seat_day: seatDay, situation: x.id, ...(x.currency ? { currency: x.currency } : {}),
        draft: d ?? null, outcome, ...(rt?.first ? { ours: { wrote: rt.first.wrote ?? rt.first.call, served: dr?.call ?? null, sure_ppm: rt.first.sure_ppm, result: rt.first.result, withheld: rt.first.withheld ?? null, label: rt.first.label ?? null } } : dr ? { ours: { served: dr.call } } : {}),
        ...(f ? { asked_back_with: f.reason ?? null, failed_call: f.call ?? null } : {}),
        ...(!d ? { dropped: dropped.get(`${x.seat}\u0000${r.request}`) ?? null } : {}),
        ...(dr ? { signed: signoff.get(d!) ?? "unanswered" } : {}),
        english: !/[　-鿿가-힯Ѐ-ӿ]/.test(r.request),
        self_talk: SELF_TALK.test(r.request), named_ids: named, unseen_ids: unseen, test: r.test,
      });
    });
  }
  console.error(`${run}: ${got.situations.length} situations, ${rows.filter((r) => r.source.startsWith(run.replace(/^runs\//, ""))).length} requests, unmatched drafts ${got.unmatched_drafts}`);
}

const w = (f: string, xs: any[]) => writeFileSync(join(out, f), xs.map((x) => JSON.stringify(x)).join("\n") + (xs.length ? "\n" : ""));
w("requests.jsonl", rows);
w("situations.jsonl", sits);
w("self.jsonl", selves);

// Described: by model, all and distinct (the same words with the same cards), and the kinds a reader need not settle.
const by: any = {};
const key = (r: any) => `${r.request.trim()}\u0000${r.forms.join("\n")}`;
for (const r of rows) {
  const m = (by[r.model] ??= { requests: 0, distinct: new Set(), distinct_words: new Set(), seat_days: new Set(), english: 0, self_talk: 0, names_unseen: 0, outcome: {}, signed: {}, sent_to_nobody_as_self: 0 });
  m.requests++; m.distinct.add(key(r)); m.distinct_words.add(r.request.trim()); m.seat_days.add(r.seat_day);
  if (r.english) m.english++;
  if (r.self_talk) m.self_talk++;
  if (r.unseen_ids.length) m.names_unseen++;
  m.outcome[r.outcome] = (m.outcome[r.outcome] ?? 0) + 1;
  if (r.signed) m.signed[r.signed] = (m.signed[r.signed] ?? 0) + 1;
}
for (const s of selves) ((by[s.model] ??= { requests: 0, distinct: new Set(), distinct_words: new Set(), seat_days: new Set(), outcome: {}, signed: {}, sent_to_nobody_as_self: 0 }).sent_to_nobody_as_self++);
const described = Object.fromEntries(Object.entries(by).map(([m, v]: [string, any]) => [m, { ...v, distinct: v.distinct.size, distinct_words: v.distinct_words.size, seat_days: v.seat_days.size }]));
writeFileSync(join(out, "described.json"), JSON.stringify({ logs, requests: rows.length, distinct: new Set(rows.map(key)).size, by_model: described }, null, 1));
console.log(JSON.stringify(described, null, 1));
