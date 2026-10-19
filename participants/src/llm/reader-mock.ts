// Mock readers for the gate's own tests and for runs that need a reader without a model (docs/design/ai-citizens.md
// 13f: "mocks that fail each check are in the tests, as 11c's are"). No model is called anywhere here. The lexicon
// reader is a deterministic reader of words, good enough to pass the gate on the hand-made pairs, and nothing more:
// it is a stand-in that shows the harness can pass a reader that tells the pairs apart, and each of the others is
// that reader with ONE thing wrong, so each should fail the check that is about that thing.

import { NEUTRAL, POLES, type Line, type Reading } from "../shared/reading";
import { phrasesAt, quoteFrom, READING_VERSION, type ReadAnswer, type Reader, type ReadRequest } from "./reader";

const count = (text: string, re: RegExp): { n: number; at: number } => {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let n = 0, at = -1;
  for (let m = g.exec(text); m; m = g.exec(text)) { n++; if (at < 0) at = m.index; if (m[0].length === 0) g.lastIndex++; }
  return { n, at };
};
const STOP = new Set("that this with from have your about were been will would could what when which there their them they than then into over also only some such these those more most much very just like make made does done need needs want wants please would should".split(" "));
const content = (s: string) => new Set((s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 4)));

const CONTEMPT = /\b(do not reapply|will not answer|not my problem|you do not qualify|be out by|do not be late|a mess|since you keep asking|last time|do not expect to see you|ask nicely|no\. )/gi;
const ACK = /\b(i have read what you|nothing you told us was doubted|nothing about you|we have kept the report|read it twice|i know it is|i know a|we know|i am glad|you were right|your patience|well kept|clear and well|take the leak seriously|we heard|we agree|you wrote|you asked|your (?:petition|signatures)|who need|neighbours who took|the only reason|we understand|i understand|read your|we wish you|sorry about|sorry for the trouble|i am glad|have enjoyed|always been on time)/gi;
const COURTESY = /\b(thank you|kind regards|we regret|i am sorry|i am very sorry|we are sorry)\b/gi;
const REASON_SPECIFIC = /\b(because|the only reason|the law|requires?|asks for|lets me|clause|the scheme is for|the payment is for|can only|which is why|budget was|rule we apply|shows?|show \[|show the|inspector|photographs|roster|receipt|reservoir|traffic count)\b/i;
const REASON_GENERAL = /\b(because|reason|law|rule|budget|limit|insufficient|unregistered|evidence|debts?|check failed|not eligible|powers|appliances are yours|do not qualify)\b/i;
const ACTION = /\b(bring|ask|write to|in writing|apply|appeal|review|reviewed|return to|tell us|tell me|come in|see you|contact|counter|set aside|say yes|questions to|enclosed a list|duty officer|tribunal for)\b/i;
const DEADLINE = /\b(before|by|within|until)\s+(?:\[DAY-\d+\]|\d+ days)/i;
const THREAT_ONE = /\b(goes to the tribunal|or lose it|or be fined|comply or)\b/i;
const THREAT_TWO = /\b(or else|you will regret|we will find you)\b/i;
const POLE_RE: { [p in (typeof POLES)[number]]: RegExp } = {
  conservation: /\b(as our parents did|our parents|grandmothers|customs|old games|traditions?|orderly|as it should be kept|as has always been done|church|respect for elders)\b/gi,
  transcendence: /\b(look after|nobody here|alone|any neighbour|whoever they are|care for|help the aged|care of those)\b/gi,
  openness: /\b(try new|learn new|start something|new ways|try anything|nobody has played|dares to change|new music|bold ideas|freedom to live|new ventures)\b/gi,
  enhancement: /\b(get ahead|rescued|win\b|success|invest|opportunit|push it through|trade leads|small businesses|work hard|start businesses|sell what we make)\b/gi,
};

/** The deterministic lexicon reader: what the words of the hand-made pairs part on, read by markers, with phrases that are in the paper. */
export function lexiconRead(req: ReadRequest): ReadAnswer {
  const t = req.paper;
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  const contempt = count(t, CONTEMPT), ack = count(t, ACK), courtesy = count(t, COURTESY);
  // (Courtesy softens contempt a step; it never makes regard of its own: that is what the politeness control is for.)
  const respect = clamp(Math.min(2, ack.n) - Math.max(0, Math.min(2, contempt.n) - Math.min(1, courtesy.n)), -2, 2);
  const reason = REASON_SPECIFIC.test(t) ? 2 : REASON_GENERAL.test(t) ? 1 : 0;
  let answers: number | null = null;
  if (req.answers !== undefined) {
    const asked = content(req.answers), said = content(t);
    const shared = [...asked].filter((w) => said.has(w)).length;
    const r = asked.size ? shared / asked.size : 0;
    void r;
    answers = shared >= 2 && t.split(/\s+/).length >= 25 ? 2 : shared >= 1 || /\b(refus|approv|declin|cannot|will not|not able|no\b|yes\b|ordered|granted|dismiss|decided)/i.test(t) ? 1 : 0;
  }
  const sentences = t.split(/(?<=[.!?])\s+/);
  const recourse = ACTION.test(t) ? (sentences.some((x) => ACTION.test(x) && DEADLINE.test(x)) ? 2 : 1) : 0;
  const threat = THREAT_TWO.test(t) ? 2 : THREAT_ONE.test(t) ? 1 : 0;
  const appeals = Object.fromEntries(POLES.map((p) => [p, Math.min(2, count(t, POLE_RE[p]).n)])) as Reading["appeals"];
  const reading: Reading = { respect, reason, answers, recourse, threat, appeals };
  const where: { [l in Line]?: number } = {
    respect: Math.max(0, Math.min(...[contempt.at, ack.at, courtesy.at].filter((x) => x >= 0), t.length)), reason: 0, answers: 0, recourse: Math.max(0, t.search(ACTION)), threat: Math.max(0, t.search(/\b(or it|or lose|or be|comply)/i)),
    conservation: Math.max(0, count(t, POLE_RE.conservation).at), transcendence: Math.max(0, count(t, POLE_RE.transcendence).at), openness: Math.max(0, count(t, POLE_RE.openness).at), enhancement: Math.max(0, count(t, POLE_RE.enhancement).at),
  };
  return { reading, phrases: phrasesAt(reading, t, (l) => where[l] ?? 0), cost_microusd: 4_000, input_tokens: 900, output_tokens: 150 };
}

const named = (name: string, f: (req: ReadRequest, n: number) => ReadAnswer | Promise<ReadAnswer>): Reader => {
  let calls = 0;
  return { model: `mock/${name}`, version: READING_VERSION, read: async (req) => f(req, ++calls) };
};
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const bump = (r: Reading, f: (l: Line, v: number) => number): Reading => ({
  respect: f("respect", r.respect), reason: f("reason", r.reason), answers: r.answers === null ? null : f("answers", r.answers), recourse: f("recourse", r.recourse), threat: f("threat", r.threat), appeals: { ...r.appeals },
});
const within = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The passing reader. */
export const lexiconReader = (): Reader => named("lexicon", (req) => lexiconRead(req));

/** The same, with one thing wrong each. Which check each should fail: the gate's tests say. */
const redo = (req: ReadRequest, a: ReadAnswer, reading: Reading): ReadAnswer => ({ ...a, reading, phrases: phrasesAt(reading, req.paper) });
export const BROKEN: { [name: string]: () => Reader } = {
  /** Reads the same paper differently each time it is asked (fails the repeat). */
  noisy: () => named("noisy", (req, n) => { const a = lexiconRead(req); const k = hash(`${n}|${req.paper}`); return redo(req, a, bump(a.reading!, (l, v) => (hash(`${k}|${l}`) % 100 < 45 ? within(v + (hash(`${k}${l}`) % 2 ? 1 : -1), l === "respect" ? -2 : 0, 2) : v))); }),
  /** Reads everything as the plain neutral paper, whatever it says (fails the pairs). */
  flat: () => named("flat", (req) => ({ reading: { ...NEUTRAL, answers: req.answers === undefined ? null : 0, appeals: { ...NEUTRAL.appeals } }, phrases: {}, cost_microusd: 4_000 })),
  /** Reads a longer paper as giving more reasons and ways on (fails the length control). */
  lengthy: () => named("lengthy", (req) => { const a = lexiconRead(req); const extra = within(Math.floor(req.paper.split(/\s+/).length / 60), 0, 2); return redo(req, a, bump(a.reading!, (l, v) => (l === "reason" || l === "recourse" ? within(v + extra, 0, 2) : v))); }),
  /** Counts pleasantries as respect, a reason, an answer and a way on (fails the politeness control). */
  pleasantries: () => named("pleasantries", (req) => { const a = lexiconRead(req); const n = count(req.paper, COURTESY).n; return redo(req, a, bump(a.reading!, (l, v) => (n && l !== "threat" ? within(v + 2, l === "respect" ? -2 : 0, 2) : v))); }),
  /** Reads the second wording of the prompt differently (fails rewording and order). */
  wording: () => named("wording", (req) => { const a = lexiconRead(req); return req.wording === 2 ? redo(req, a, bump(a.reading!, (l, v) => (l === "respect" ? within(-v, -2, 2) : l === "reason" ? within(2 - v, 0, 2) : v))) : a; }),
  /** Reads recourse and answers the other way about from the lexicon (a second reader that disagrees: fails two readers). */
  disagreeing: () => named("disagreeing", (req) => { const a = lexiconRead(req); return redo(req, a, bump(a.reading!, (l, v) => (l === "recourse" || l === "answers" ? 2 - v : v))); }),
  /** Quotes phrases that are not in the paper (fails the quoted-phrases check). */
  misquoting: () => named("misquoting", (req) => { const a = lexiconRead(req); return { ...a, phrases: Object.fromEntries(Object.keys(a.phrases ?? {}).map((l) => [l, "words that the paper does not contain at all"])) }; }),
  /** Returns numbers out of range now and then (fails readable). */
  garbled: () => named("garbled", (req, n) => { const a = lexiconRead(req); return n % 7 === 0 ? { ...a, reading: { ...a.reading!, respect: 5 } } : a; }),
  /** Costs far more a call than the bound (fails cost). */
  costly: () => named("costly", (req) => ({ ...lexiconRead(req), cost_microusd: 60_000 })),
  /** Declines now and then (declines are counted, never a failure). */
  declining: () => named("declining", (req, n) => (n % 9 === 0 ? { declined: true } : lexiconRead(req))),
};

/** A reader that reads one family's papers kinder than another reader does: for the author's-family check. `own` says which texts are its family's. */
export const familyBiased = (own: (paper: string) => boolean): Reader => named("family-biased", (req) => {
  const a = lexiconRead(req);
  return own(req.paper) ? redo(req, a, bump(a.reading!, (l, v) => (l === "respect" || l === "reason" ? within(v + 1, l === "respect" ? -2 : 0, 2) : v))) : a;
});

export { quoteFrom };
