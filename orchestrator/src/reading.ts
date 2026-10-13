// The reading desk (docs/design/ai-citizens.md 13c, 13d; docs/behaviour/reading.md): where a seat's worded paper is
// read, once, at the step in which it is written, so that by the time anyone sees the paper its reading is on file and
// nobody waits on a reader. The desk holds the reading; people are moved by code (the citizen module) from their own
// record, by the shift it gives them. It is deterministic given the reader's answers; a reader that is a model is
// reached through the model adapters, so a resumed run is served its answers from the log and never asks again.
//
// The reader sees the paper (tagged), what it answers (tagged) and the reader's standing: never a person, never who
// wrote it beyond what it says. A reader that declines or fails, or whose answer cannot be read, or a run that has
// spent its calls: the paper is read as the plain paper of its kind, and that is counted.

import { reading as R } from "@oikos/participants";
import { READING_VERSION, readingKey, textHash, type Reader, type ReadAnswer, type ReadingTable } from "@oikos/participants/llm";

const { combineAskings, DECISION_KINDS, isNoShift, NO_SHIFT, plainKey, shiftOf, wellFormed, wordsOf } = R;
type Line = R.Line; type PaperRead = R.PaperRead; type Reading = R.Reading; type ReadingDial = R.ReadingDial; type Shift = R.Shift; type Standing = R.Standing;

/** A statement as the desk is shown it, from the log's `recorded` event. */
export interface Statement { id: string; author: string; kind: string; text: string; data?: { [k: string]: unknown }; addressed_to?: string[]; basis?: string; speaks_for?: string }

export interface DeskCounts { asked: number; read: number; cached: number; declined: number; no_answer: number; unread: number; apart_lines: number; over_limit: number; no_table: number; calls: number }

export interface DeskOptions {
  dial: ReadingDial;
  reader: Reader;
  table: ReadingTable;
  /** Whether the paper was written by a seat (a model): code's papers are plain and are never read. */
  bySeat: (author: string) => boolean;
  /** A fresh registry of tags for one paper and what it answers (participants/src/llm/reading-tags.ts): names, ids, sums and days leave the run as tags, and nothing else does. */
  tag: () => { tag(text: string): string };
  /** Where the writer's own words are, if not in the paper's text fields (a seam for tests that read a code office's paper as a seat's). */
  words?: (s: Statement) => string | undefined;
  /** Files a reading in the log (a `note` annotation, `data.reading`). */
  file: (data: object) => Promise<void>;
}

export class ReadingDesk {
  readonly counts: DeskCounts = { asked: 0, read: 0, cached: 0, declined: 0, no_answer: 0, unread: 0, apart_lines: 0, over_limit: 0, no_table: 0, calls: 0 };
  private readonly filed = new Map<string, PaperRead>();
  private readonly seen = new Map<string, { kind: string; words: string }>();
  /** Readings within this run, by the reader's version, the kind, the standing and the hash of the tagged words (and of what they answer): no cache is carried between runs. */
  private readonly cache = new Map<string, { source: "model" | "apart" | "declined" | "no_answer" | "unread"; reading?: Reading; apart?: Line[] }>();

  constructor(private readonly o: DeskOptions) {}

  /** What the citizen asks: the reading of a paper for someone of this standing, if it was read. */
  lookup = (paper: string, standing: Standing): PaperRead | undefined => this.filed.get(`${paper}\n${standing}`);

  /** A statement recorded in the world. Requests are remembered (bounded) so that a decision can be read with what it answers. */
  async onStatement(s: Statement): Promise<void> {
    if (!DECISION_KINDS.includes(s.kind)) {
      if (/request|claim|application|petition/.test(s.kind)) {
        this.seen.set(s.id, { kind: s.kind, words: [s.text, wordsOf(s.data) ?? ""].filter(Boolean).join("\n") });
        if (this.seen.size > 4_000) this.seen.delete(this.seen.keys().next().value!);
      }
      return;
    }
    if (!this.o.dial.papers.includes("decision") || !this.o.bySeat(s.author)) return;
    const words = this.o.words ? this.o.words(s) : wordsOf(s.data);
    if (words === undefined) return; // no words of its own: the plain paper, and no reader is asked
    await this.read(s, words, "addressee");
  }

  private async read(s: Statement, words: string, standing: Standing): Promise<void> {
    const c = this.counts;
    c.asked++;
    const key = plainKey(s.kind, s.data);
    const plain = this.o.table.rows[key];
    // What leaves the run is the paper and what it answers with tags in the place of names, ids, sums and days, and the
    // reader's standing: nothing of any person. The paper first, so that its tags number first.
    const tagger = this.o.tag();
    const answered = s.basis ? this.seen.get(s.basis) : undefined;
    const paper = tagger.tag(words);
    const answers = answered ? tagger.tag(answered.words) : undefined;
    const req = { kind: key, standing, paper, ...(answers !== undefined ? { answers } : {}) };
    const out = { paper: s.id, kind: key, standing, text: paper, text_hash: textHash(paper), ...(answers !== undefined ? { answers_text: answers } : {}),
      reader: { model: this.o.reader.model, version: this.o.reader.version, prompt: READING_VERSION, table: this.o.table.version ?? null } };
    const fileIt = async (source: string, extra: object = {}, shift: Shift = NO_SHIFT) => {
      this.filed.set(`${s.id}\n${standing}`, { paper: s.id, standing, shift, source });
      await this.o.file({ reading: { ...out, source, ...extra, shift } });
    };
    if (!plain) { c.no_table++; return fileIt("no_table"); }
    const ck = readingKey({ reader: this.o.reader.model, version: `${this.o.reader.version}/${READING_VERSION}`, kind: key, standing, paper, ...(answers !== undefined ? { answers } : {}) });
    const hit = this.cache.get(ck);
    if (hit) {
      c.cached++;
      if (hit.source === "declined") c.declined++; else if (hit.source === "no_answer") c.no_answer++; else if (hit.source === "unread") c.unread++;
      if (!hit.reading) return fileIt(hit.source);
      const shift = shiftOf(hit.reading, plain);
      return fileIt("cache", { askings: 2, reading: hit.reading, plain, ...(hit.apart?.length ? { apart: hit.apart } : {}) }, isNoShift(shift) ? NO_SHIFT : shift);
    }
    if (c.calls + 2 > this.o.dial.calls_per_run) { c.over_limit++; return fileIt("over_limit"); }
    const asked: ReadAnswer[] = [];
    for (const wording of [1, 2] as const) {
      c.calls++;
      try { asked.push(await this.o.reader.read({ ...req, wording })); } catch { asked.push({}); }
    }
    if (asked.some((a) => a.declined)) { c.declined++; this.cache.set(ck, { source: "declined" }); return fileIt("declined"); }
    if (asked.some((a) => !a.reading)) { c.no_answer++; this.cache.set(ck, { source: "no_answer" }); return fileIt("no_answer"); }
    const readable = asked.every((a) => wellFormed(a.reading) && phrasesFound(a, paper));
    if (!readable) { c.unread++; this.cache.set(ck, { source: "unread" }); return fileIt("unread"); }
    const { reading, apart } = combineAskings(asked[0]!.reading!, asked[1]!.reading!, plain);
    c.read++;
    c.apart_lines += apart.length;
    this.cache.set(ck, { source: apart.length ? "apart" : "model", reading, apart });
    const shift = shiftOf(reading, plain);
    await fileIt(apart.length ? "apart" : "model", { askings: 2, reading, plain, ...(apart.length ? { apart } : {}) }, isNoShift(shift) ? NO_SHIFT : shift);
  }
}

/** Every line that is not 0 comes with a phrase that is in the paper (a reading whose phrases are not is unread). */
export function phrasesFound(a: ReadAnswer, paper: string): boolean {
  const norm = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase();
  const p = norm(paper);
  const r = a.reading!;
  const lines: [Line, number | null][] = [["respect", r.respect], ["reason", r.reason], ["answers", r.answers], ["recourse", r.recourse], ["threat", r.threat], ["openness", r.appeals.openness], ["conservation", r.appeals.conservation], ["enhancement", r.appeals.enhancement], ["transcendence", r.appeals.transcendence]];
  for (const [l, v] of lines) {
    if (v === 0 || v === null) continue;
    const q = a.phrases?.[l];
    if (typeof q !== "string" || !q.trim() || q.trim().split(/\s+/).length > 12 || !p.includes(norm(q))) return false;
  }
  return true;
}
