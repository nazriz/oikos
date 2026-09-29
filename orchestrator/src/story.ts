// What a language-model participant did in a run, day by day, from the log: its actions (tool uses), the drafts
// the translator made and whether it confirmed them, translations that failed, the letters it received and the
// acts that took effect. For reading pilots (docs/real-models.md); measurement proper is measure/.

import { readLog } from "./logs";

const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function story(logPath: string, only?: string): string {
  const out: string[] = [];
  const entries = readLog(logPath).trim().split("\n").map((l) => JSON.parse(l));
  const models = new Set<string>();
  for (const e of entries) if (e.kind === "annotation" && e.body.annotation === "usage" && e.body.purpose === "participant") models.add(e.body.subject);
  const who = only ? new Set([only]) : models;
  const day = (t: number) => `day ${String(Math.floor(t / 86_400)).padStart(3)}`;
  for (const e of entries) {
    const b = e.body;
    if (e.kind === "annotation" && b.annotation === "transcript" && who.has(b.subject) && b.data?.purpose === "participant")
      for (const o of b.data.output ?? []) {
        if (o.type === "tool_use") out.push(`${day(e.t)}  ${o.name.padEnd(12)} ${clip(JSON.stringify(o.input))}`);
        else if (o.type === "text" && o.text) out.push(`${day(e.t)}  (says)       ${clip(o.text)}`);
      }
    if (e.kind === "annotation" && b.annotation === "draft" && who.has(b.draft?.participant)) out.push(`${day(e.t)}    draft ${b.draft.id}: ${clip(b.draft.call, 160)}${b.draft.check?.ok ? "" : ` [can't be done: ${b.draft.check?.refusal?.code}]`}`);
    if (e.kind === "annotation" && b.annotation === "signoff" && who.has(b.participant)) out.push(`${day(e.t)}    ${b.decision === "accept" ? "confirmed" : "declined"} ${b.draft}${b.note ? `: ${clip(b.note, 140)}` : ""}`);
    if (e.kind === "annotation" && b.annotation === "translation_failure" && who.has(b.subject)) out.push(`${day(e.t)}    translation failed: ${clip(b.data?.reason ?? "", 120)}${b.data?.call ? ` (${b.data.call})` : ""}`);
    if (e.kind === "event" && b.event === "message_delivered" && (b.to ?? []).some((x: string) => who.has(x)) && !who.has(b.participant)) out.push(`${day(e.t)}    letter from ${b.participant}`);
    if (e.kind === "event" && b.event === "action_applied" && who.has(b.participant)) out.push(`${day(e.t)}    ✓ act ${b.action} took effect`);
    if (e.kind === "event" && b.event === "action_refused" && who.has(b.participant)) out.push(`${day(e.t)}    ✗ act refused: ${b.code}`);
  }
  return out.join("\n");
}
