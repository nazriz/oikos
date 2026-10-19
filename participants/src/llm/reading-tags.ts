// Tags, hashing and the cache key of a reading (docs/design/ai-citizens.md 13b, 13c, 13d; docs/behaviour/reading.md).
//
// Before a paper leaves the run for a reader, names, ids, sums and dates in it are replaced by tags
// ([PERSON-1], [ID-1], [SUM-1], [DAY-1]), numbered by first appearance across the paper and then what it answers, the
// same value always the same tag. So "you asked for [SUM-1]; we can pay [SUM-2]" still reads, and the reader is never
// shown a name, a sum or a day of the run. Counts and spans of time ("26 weeks", "within 28 days") are not tags: they
// are part of what a reason is. Nothing here knows a place: the money marks are the world's own currency's, the dates
// are the world's ("year 1, day 12"; the world has no calendar), the names are the world's entities'.

import type { Currency } from "../money";
import type { Standing } from "../shared/reading";

export interface TagWorld {
  /** The world's names for people, offices and organisations. */
  names: string[];
  /** The world's currency: the sign and the code written with a sum, and the words after it. */
  currency?: Pick<Currency, "code" | "symbol" | "unit_words">;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TAGS = ["DAY", "SUM", "ID", "PERSON"] as const;
type Tag = (typeof TAGS)[number];

/** Replaces what must not leave the run with tags, one registry for a paper and what it answers. */
export class Tagger {
  private readonly values: { [t in Tag]: Map<string, number> } = { DAY: new Map(), SUM: new Map(), ID: new Map(), PERSON: new Map() };
  private readonly patterns: { tag: Tag; re: RegExp }[];

  constructor(world: TagWorld) {
    const num = String.raw`\d+(?:[.,'   ]\d+)*`; // (groups joined by one separator: \"205. 5\" is two numbers)
    const marks = [world.currency?.symbol, world.currency?.code].filter((x): x is string => !!x).map(esc);
    const units = (world.currency?.unit_words ?? []).map(esc);
    // (A number just after a letter or another number is not a sum's: a code that ends in digits, then a sign and an amount, has one sum.)
    const lone = String.raw`(?<![A-Za-z0-9.,])`;
    const sum = [
      ...(marks.length ? [String.raw`(?<![A-Za-z])(?:${marks.join("|")})[\u00a0 ]?${num}`, String.raw`${lone}${num}[\u00a0 ]?(?:${marks.join("|")})(?![A-Za-z0-9])`] : []),
      ...(units.length ? [String.raw`${lone}${num}[\u00a0 ]?(?:${units.join("|")})\b`] : []),
    ];
    const names = [...new Set(world.names.filter((n) => n.trim().length >= 2))].sort((a, b) => b.length - a.length).map(esc);
    this.patterns = [
      { tag: "DAY", re: new RegExp(String.raw`\byear \d+,? day \d+(?:,? \d{1,2}:\d{2}(?::\d{2})?)?|\bday \d+(?:,? \d{1,2}:\d{2}(?::\d{2})?)?\b|\b\d{4}-\d{2}-\d{2}\b`, "gi") },
      ...(sum.length ? [{ tag: "SUM" as Tag, re: new RegExp(sum.join("|"), "g") }] : []),
      // An id: letters, then parts joined by . _ / # - and at least one digit somewhere; or a short code like L1, J12.
      { tag: "ID", re: new RegExp(String.raw`\b[A-Za-z][A-Za-z0-9]*(?:[._/#-][A-Za-z0-9]+)+\b|\b[A-Z]{1,3}\d+\b`, "g") },
      ...(names.length ? [{ tag: "PERSON" as Tag, re: new RegExp(String.raw`(?<![A-Za-z0-9])(?:${names.join("|")})(?![A-Za-z0-9])`, "g") }] : []),
    ];
  }

  /** The text with tags in place. The numbering continues across calls: tag the paper first, then what it answers. */
  tag(text: string): string {
    type M = { at: number; end: number; tag: Tag; value: string; rank: number };
    const found: M[] = [];
    this.patterns.forEach(({ tag, re }, rank) => {
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        // An id must have a digit (a hyphenated word is a word); a name stands as it is.
        if (tag === "ID" && !/\d/.test(m[0])) continue;
        found.push({ at: m.index, end: m.index + m[0].length, tag, value: m[0].trim(), rank });
      }
    });
    found.sort((a, b) => a.at - b.at || a.rank - b.rank || b.end - a.end);
    let out = "", pos = 0;
    for (const m of found) {
      if (m.at < pos) continue; // inside an earlier match
      out += text.slice(pos, m.at);
      const seen = this.values[m.tag];
      if (!seen.has(m.value)) seen.set(m.value, seen.size + 1);
      out += `[${m.tag}-${seen.get(m.value)}]`;
      pos = m.end;
    }
    return out + text.slice(pos);
  }
}

/** A paper and what it answers, tagged by one registry: the paper first. */
export function tagged(world: TagWorld, paper: string, answers?: string): { paper: string; answers?: string } {
  const t = new Tagger(world);
  const p = t.tag(paper);
  return { paper: p, ...(answers !== undefined ? { answers: t.tag(answers) } : {}) };
}

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
/** The hash of tagged words, as the log says it (the first 16 hex digits). */
export const textHash = (s: string): string => sha256(s).slice(0, 16);

/** The cache key of a reading, within a run: the reader's version, the kind, the standing, and the hash of the tagged words of the paper and of what it answers. Forty refusals in the same words to forty people are one reading. */
export function readingKey(o: { reader: string; version: string; kind: string; standing: Standing; paper: string; answers?: string }): string {
  return [o.reader, o.version, o.kind, o.standing, textHash(o.paper), o.answers === undefined ? "-" : textHash(o.answers)].join("|");
}
