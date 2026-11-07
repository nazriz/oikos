// Whether the trained translator reads an assistant's request for more scope or means as one (docs/design/delegation.md
// section 4: `scope_request`, the act the delegation study counts), across ways of writing it, and whether it reads a
// request that is not one as one. Offline: the only model asked is the local one; nothing is sent behind.
//
//   OIKOS_TRANSLATOR_MODELS=<models> bun translator/eval/scope-run.ts decide/<name> [translator/eval/scope-requests.jsonl] [--json FILE]
//
// The set (scope-requests.jsonl) was written for this by three writers in nine styles (claude-sonnet-5-5: formal,
// structured, terse; claude-haiku-5-5: hedged, blunt, second-language; codex gpt-6-luna: plain, checklist), from one
// brief, never from a pilot's requests. Each line is labelled `scope` (a request for more scope or means for the
// assistant itself) or what it is instead (advice, approval_request, report, handover, message, other). It is a test
// set: not for training.
//
// Each request is asked twice: as served (the arrangement's own rule: a form not yet taught is on trial and goes
// behind; a kind of field or function not released goes behind) and as the model writes it alone
// (OIKOS_DECIDE_UNRELEASED's reading: `wrote`). Recognised: the model's program files `scope_request`. A false
// positive: a request labelled otherwise that it files as one.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ASSISTANT_ISSUES, draftOf, type Issued } from "@oikos/participants";
import { DecideAdapter } from "../model/adapter";
import { formLine } from "../train/data";

/** The forms each situation's seat is shown: the assistant's papers at its post, and (the town's planning assistant)
 * the principal's own form for the kind it holds, as itself and as a draft for sign-off (worlds/generator, assistant
 * posts' stationery). */
const PERMIT_DECISION: Issued = { form: "permit_decision", title: "A decision on a permit application", fields: {
  applicant: { type: "entity", required: true, description: "" }, application: { type: "record", required: true, description: "" },
  decision: { type: "choice", options: ["granted", "refused", "incomplete"], required: true, description: "" }, law: { type: "record", description: "" },
  lot: { type: "lot", description: "" }, missing: { type: "list", description: "" }, reason: { type: "text", description: "" },
  structure_type: { type: "structure_type", description: "" } }, writes: { kind: "permit_decision", text: "{decision}" } } as Issued;
const lines = (post: string, issued: Issued[]) => issued.map((x) => formLine({ form: x.form, to: post, fields: x.fields } as never));
export const SITUATIONS: { [s: string]: string[] } = {
  A: lines("planning-assistant", [...ASSISTANT_ISSUES, PERMIT_DECISION, draftOf(PERMIT_DECISION)]),
  B: lines("helpwell-desk", ASSISTANT_ISSUES),
};

/** The form a program files, by name, for each line that files one. */
export const formsFiled = (program: string): string[] => [...program.matchAll(/[(,\s]form="?([a-z_]+)/g)].map((m) => m[1]!); // (only a form has a `form` argument)

// (Run as a script; its situations and `formsFiled` are shared with translator/model/v4-scope.ts.)
if (import.meta.main) {
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const jsonOut = flag("json");
const [model, file = join(import.meta.dir, "scope-requests.jsonl")] = args;
if (!model?.startsWith("decide/")) throw new Error("usage: bun translator/eval/scope-run.ts decide/<name> [scope-requests.jsonl] [--json FILE]");

interface Case { id: string; writer: string; style: string; situation: string; label: string; level: string | null; unprompted: boolean | null; request: string }
const cases: Case[] = readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const adapter = new DecideAdapter(model.slice(7), { first: true, quiet: true });
await adapter.ready();
interface Read { id: string; writer: string; style: string; label: string; scope: boolean; read_as_scope: boolean; level_asked: string | null; level_read: string | null; served: string; wrote: string; sure: number }
const rows: Read[] = [];
for (const c of cases) {
  const a = await adapter.translate(c.request, SITUATIONS[c.situation]!, { who: `scope/${c.situation}` });
  const wrote = a.wrote ?? a.program;
  const filed = formsFiled(wrote);
  const level = /level="?(advice|draft|approve|alone)"?/.exec(wrote)?.[1] ?? null;
  rows.push({ id: c.id, writer: c.writer, style: c.style, label: c.label, scope: c.label === "scope", read_as_scope: filed.includes("scope_request"), level_asked: c.level, level_read: level,
    served: a.withheld ? `behind (${a.withheld})` : /^none\(/.test(a.program) ? a.program : "draft", wrote, sure: Math.round(a.sure * 1000) / 1000 });
}
adapter.close();

const tally = (xs: typeof rows) => {
  const pos = xs.filter((r) => r.scope), neg = xs.filter((r) => !r.scope);
  return { scope: pos.length, recognised: pos.filter((r) => r.read_as_scope).length, others: neg.length, false_positives: neg.filter((r) => r.read_as_scope).length,
    level_right: pos.filter((r) => r.level_asked && r.read_as_scope && r.level_read === r.level_asked).length, level_stated: pos.filter((r) => r.level_asked).length,
    scope_served_by_ours: pos.filter((r) => r.served === "draft" && r.read_as_scope).length };
};
const by = (k: "writer" | "style" | "label") => Object.fromEntries([...new Set(rows.map((r) => r[k]))].sort().map((v) => [v, tally(rows.filter((r) => r[k] === v))]));
const instead: { [k: string]: number } = {};
for (const r of rows.filter((r) => r.scope && !r.read_as_scope)) { const k = formsFiled(r.wrote)[0] ?? r.wrote.split("(")[0]!; instead[k] = (instead[k] ?? 0) + 1; }
const served: { [k: string]: number } = {};
for (const r of rows.filter((r) => r.scope)) served[r.served] = (served[r.served] ?? 0) + 1;
const summary = { model, all: tally(rows), by_writer: by("writer"), by_style: by("style"), scope_read_instead_as: instead, scope_as_served: served };
console.log(JSON.stringify(summary, null, 1));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ ...summary, rows }, null, 1));
}
