// Debriefs recorded before script 0.7.1, read again from their own saved replies (2026-11-16; docs/decisions.md, "Debrief
// answers not read are ours"). No model is called and nothing is re-asked: the file of what seats said, kept beside a run's
// log (`<run>.debriefs.jsonl`: each call's reply and each whole interview), already holds every reply. Each interview is
// read again as participants/src/llm/debrief.ts `rereadDebrief` says, and written to a new file beside the old,
// `<run>.debriefs.reread.jsonl`, one line an interview ({kind: "debrief", subject, record}); the run's own files are never
// written over (a reread file already there is left, and the tool says so). Readers that find the reread file read it in
// place of the interviews in the old one (`debriefRecordsIn`).
//
//   bun orchestrator/src/reread-debriefs.ts <a debriefs.jsonl, or a folder searched for them> ...

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rereadDebrief, type DebriefCallKept, type DebriefRecord } from "@oikos/participants/llm";

export const rereadBeside = (file: string) => file.replace(/\.debriefs\.jsonl$/, ".debriefs.reread.jsonl");

const lines = (file: string): any[] => readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

/** The interviews in a debriefs file, each by its seat: from the reread file beside it where there is one. */
export function debriefRecordsIn(file: string): { subject: string; record: DebriefRecord; reread: boolean }[] {
  const again = rereadBeside(file);
  const from = existsSync(again) ? again : file;
  return lines(from).filter((x) => x.kind === "debrief" && x.record).map((x) => ({ subject: String(x.subject), record: x.record as DebriefRecord, reread: from === again }));
}

/** One file read again: the new file's lines, and how many steps each seat had read anew. */
export function rereadFile(file: string): { out: object[]; read: { [seat: string]: string[] } } {
  const all = lines(file);
  const out: object[] = [];
  const read: { [seat: string]: string[] } = {};
  for (const x of all.filter((y) => y.kind === "debrief" && y.record)) {
    const calls: DebriefCallKept[] = all.filter((y) => y.kind === "call" && y.subject === x.subject && Array.isArray(y.output)).map((y) => ({ subject: y.subject, ref: String(y.ref), output: y.output }));
    const r = rereadDebrief(x.record, calls);
    read[x.subject] = r.reread.steps;
    out.push({ kind: "debrief", subject: x.subject, record: r });
  }
  return { out, read };
}

function filesUnder(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((f) => {
    const p = join(path, f);
    return statSync(p).isDirectory() ? filesUnder(p) : f.endsWith(".debriefs.jsonl") ? [p] : [];
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (!args.length) { console.error("usage: bun orchestrator/src/reread-debriefs.ts <debriefs.jsonl | folder> ..."); process.exit(2); }
  for (const file of args.flatMap(filesUnder)) {
    const to = rereadBeside(file);
    if (existsSync(to)) { console.log(`${to}: already there, left as it is`); continue; }
    const { out, read } = rereadFile(file);
    if (!out.length) { console.log(`${file}: no interview in it`); continue; }
    writeFileSync(to, out.map((x) => JSON.stringify(x)).join("\n") + "\n", { flag: "wx" });
    console.log(`${to}: ${Object.entries(read).map(([s, steps]) => `${s} read anew ${steps.length}${steps.length ? ` (${steps.join(", ")})` : ""}`).join("; ")}; still not read: ${out.map((x: any) => `${x.subject} ${x.record.not_read.length ? x.record.not_read.join(", ") : "none"}`).join("; ")}`);
  }
}
