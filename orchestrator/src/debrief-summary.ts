// What a run's log shows of what each model seat did, for its debrief (VISION 15, point 7; docs/behaviour/debrief.md,
// "The summary"). A seat keeps only a notebook between sittings, so before it is asked why it decided as it did it is
// shown what it did: made here, by code, from the log and nothing else.
//
// Rules, each tested (orchestrator/test/debrief.test.ts):
//  - The platform judges nothing. The summary says what was asked, confirmed, declined, carried out, sent, and what
//    reached the seat; never how anything turned out, and never a word that weighs it (EVALUATIVE below is the list
//    its own words are checked against). What a seat or anyone else wrote is quoted as written, in quotation marks.
//  - "Largest" is by stated measures only: the money an act names, then how many people and bodies it names; things
//    granted or refused and directions given are listed apart. No measure of consequence.
//  - It is bounded: so many of each, each quoted piece cut at a length, the whole under SUMMARY_MAX characters.
//  - It is in the ids the seat itself was shown.
// The same reading gives, for each "why" question, what the log shows the seat was shown and did at that decision
// (`beside`): ids and plain facts, to set an account beside the record. Nothing here says whether an account is true.

import { formatMoney, type Currency } from "@oikos/participants";

/** Words the summary's own sentences never use (the platform judges nothing): checked by test over every sentence
 * this file can write, with what it quotes left out. */
export const EVALUATIVE = ["good", "bad", "better", "worse", "best", "worst", "well", "poorly", "right", "rightly", "wrong", "wrongly", "correct", "correctly", "incorrect", "proper", "properly", "improper",
  "success", "successful", "successfully", "succeeded", "fail", "failed", "failure", "mistake", "mistaken", "error", "fault", "harm", "harmed", "harmful", "hurt", "benefit", "benefited", "helpful", "unhelpful",
  "fair", "fairly", "unfair", "just", "unjust", "wise", "unwise", "careless", "careful", "kind", "cruel", "generous", "harsh", "lenient", "deserved", "should", "ought", "unfortunately", "fortunately", "sadly",
  "happily", "merely", "neglected", "ignored", "wasted", "effective", "ineffective", "reasonable", "unreasonable", "appropriate", "inappropriate", "excessive", "problem", "trouble", "achieved", "managed"];

export const SUMMARY_MAX = 6_000;
const QUOTE_MAX = 320;
const LISTED = { largest: 5, granted: 4, directions: 4, not_done: 4, unanswered: 4 };

const DAY = 86_400;
const dayOf = (t: number) => Math.floor(t / DAY) + 1;
const quote = (s: string, max = QUOTE_MAX) => { const x = String(s ?? "").replace(/\s+/g, " ").trim(); return `"${x.length > max ? `${x.slice(0, max)} [...]` : x}"`; };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Something carried out on the seat's word: a draft it confirmed, as the log has it. */
export interface Carried {
  seq: number; t: number; draft?: string;
  /** The preview the seat was shown and confirmed (code-written from the draft's blocks), or, for an act with no draft, its blocks in brief. */
  preview: string;
  /** Its own request, and the reason it gave at the time (never shown back to it: they are for the record). */
  proposal?: string; reasoning?: string; signoff_note?: string;
  /** The money the act names, in the world's smallest unit; the people and bodies it names; what kind of thing it is. */
  money: number; named: string[]; granted?: boolean; direction?: boolean; kinds: string[];
  /** What the act made (records, letters), by id; and the model calls of the sitting it was asked in. */
  made: string[]; calls: number[]; /** Of the ids the act names: those the sitting's prompts held, and those they did not. */ named_and_shown?: string[]; named_not_shown?: string[];
}

interface Draft { id: string; t: number; proposal: string; summary: string; blocks: any[]; signoff?: "accept" | "reject"; note?: string; unanswered?: boolean; sitting?: Sitting }
interface Sitting { day: number; calls: number[]; ids: Set<string> }
interface Letter { seq: number; t: number; /** Every id its sender may be written to by; the first is how it is named. */ from: string[]; text: string }

/** One seat's doings, folded from the log's entries. */
export class SeatRecord {
  sittings = new Map<number, Sitting>();
  drafts = new Map<string, Draft>();
  carried: Carried[] = [];
  notDone: { t: number; draft: string; proposal: string; told: string; asked_back: boolean }[] = [];
  /** Letters it wrote that went as commands; `delivered`: the log shows it reached someone. */
  sent: { seq: number; t: number; to: string[]; text: string; about?: string; calls: number[]; delivered?: boolean }[] = [];
  notSent = 0;
  looks = 0;
  received: Letter[] = [];
  left?: { t: number; statement: string };
  /** Papers that were put before it (shown to it, and addressed to it or of a kind that asks something), by others. */
  reached = new Map<string, { id: string; t: number; kind: string; from: string; text: string; money: number; named: string[] }>();
  private current?: Sitting;
  constructor(readonly id: string, /** Every id it may be written to by: its own, its posts', its organisation's. */ readonly known: Set<string>) {}

  /** The sitting a model call belongs to (one a day), with every word its prompts held that could be an id. */
  call(seq: number, t: number, input: unknown) {
    const day = dayOf(t);
    let s = this.sittings.get(day);
    if (!s) this.sittings.set(day, (s = { day, calls: [], ids: new Set() }));
    s.calls.push(seq);
    const text = typeof input === "string" ? input : JSON.stringify(input ?? "");
    // (Every word of the prompt that could be an id, however it was set: in brackets, after a name, in a sentence.)
    for (const m of text.matchAll(/[A-Za-z][\w.:/-]*[A-Za-z0-9]/g)) s.ids.add(m[0]);
    this.current = s;
  }
  draft(d: any, t: number) {
    this.drafts.set(d.id, { id: d.id, t, proposal: String(d.proposal ?? ""), summary: String(d.summary ?? ""), blocks: d.blocks ?? [], ...(this.current ? { sitting: this.current } : {}) });
  }
  sitting() { return this.current; }
}

/** The money a set of blocks names (a transfer's amount; a payment asked for or promised), once each. */
export function moneyNamed(blocks: unknown): number {
  let sum = 0;
  const walk = (x: any, key?: string) => {
    if (Array.isArray(x)) return x.forEach((y) => walk(y));
    if (!x || typeof x !== "object") return;
    if ((x.block === "transfer" || key === "money") && x.amount !== undefined && /^\d+$/.test(String(x.amount))) sum += Number(x.amount);
    for (const [k, v] of Object.entries(x)) walk(v, k);
  };
  walk(blocks);
  return sum;
}
const NAMING = new Set(["to", "addressed_to", "parties", "who", "applicant", "against", "on_behalf_of", "holder", "tenant", "worker", "employee", "member", "candidate"]);
const NOT_A_PARTY = new Set(["public", "taker", "me", "anyone"]);
/** The people and bodies a set of blocks names (whom it is to, between, about), apart from the seat's own. */
export function namedBy(blocks: unknown, own: Set<string>): string[] {
  const out = new Set<string>();
  const take = (v: unknown) => { if (typeof v === "string" && v && !NOT_A_PARTY.has(v) && !own.has(v) && !v.startsWith("acc-") && /^[A-Za-z]/.test(v)) out.add(v); };
  const walk = (x: any) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== "object") return;
    for (const [k, v] of Object.entries(x)) {
      if (NAMING.has(k)) (Array.isArray(v) ? v : [v]).forEach(take);
      walk(v);
    }
  };
  walk(blocks);
  return [...out].sort();
}
/** Kinds of paper that ask something of whoever they are put before. */
const ASKS = /^(petition|application|complaint|claim|proposal|request|appeal|remedy_request|tribunal_application|enforcement_request)$/;
const kindsOf = (blocks: any[]) => [...new Set(blocks.map((b) => `${b?.block ?? "?"}${b?.kind ? `/${b.kind}` : ""}`))];
const DIRECTION = /^(direction|work_order|standing_order|instruction|order)$/;
const grantedOf = (blocks: any[]): boolean | undefined => {
  for (const b of blocks) {
    if (typeof b?.data?.granted === "boolean") return b.data.granted;
    if (typeof b?.data?.decision === "string" && /^(grant|approv|refus|reject|declin|den)/i.test(b.data.decision)) return /^(grant|approv)/i.test(b.data.decision);
  }
  return undefined;
};

/**
 * Reads a log's entries (parsed, in order) into each model seat's record. `seats`: the model seats, each with every id
 * it is written to by. Give it every entry, or at least every one that names a seat or carries a letter.
 */
export class SeatRecords {
  readonly of = new Map<string, SeatRecord>();
  private letters = new Map<number, { from: string[]; text: string; to: string[] }>(); // a letter's command, until it is delivered
  private bySeq = new Map<number, { seat: SeatRecord; carried?: Carried }>(); // a seat's own commands
  private idsOf = new Map<string, Set<string>>();
  private actions = new Map<string, number>(); // an act under way -> the command that began it
  private applying?: { cause: number; cmd: number }; // the act whose events are being read
  constructor(seats: { id: string; known: string[] }[], /** Every id a letter's sender may be written to by (the post it wrote from, its organisation, the person), the one it is named by first. */ private readonly nameOf: (participant: string, as?: string) => string[] = (p, as) => (as ? [as, p] : [p])) {
    for (const s of seats) {
      this.of.set(s.id, new SeatRecord(s.id, new Set([s.id, ...s.known])));
      this.idsOf.set(s.id, new Set([s.id, ...s.known]));
    }
  }
  /** Whether a line of the log could matter here, before it is parsed. */
  static wants(line: string, seats: string[]): boolean {
    if (line.includes('"block":"message"') || line.includes('"event":"action_started"') || line.includes('"event":"action_applied"')) return true;
    for (const s of seats) if (line.includes(`"${s}"`)) return true;
    return false;
  }
  add(e: any) {
    const b = e.body ?? {};
    if (e.kind === "annotation") {
      const who = this.of.get(b.subject ?? b.participant ?? b.draft?.participant);
      if (!who) return;
      if (b.annotation === "transcript" && b.data?.purpose === "participant") who.call(e.seq, e.t, b.data.input);
      else if (b.annotation === "draft") who.draft(b.draft, e.t);
      else if (b.annotation === "signoff") { const d = who.drafts.get(b.draft); if (d) { d.signoff = b.decision; if (b.note) d.note = String(b.note); } }
      else if (b.annotation === "translation_failure") who.notDone.push({ t: e.t, draft: String(b.data?.draft ?? ""), proposal: String(b.data?.proposal ?? ""), told: String(b.data?.reason ?? ""), asked_back: b.data?.asked_back === true });
      else if (b.annotation === "observation") {
        // What was put before it: a paper it was shown that someone else made after the town began, addressed to it or
        // of a kind that asks something of whoever reads it.
        const chans = b.data?.observation?.channels;
        for (const ch of (Array.isArray(chans) ? chans : Object.values(chans ?? {})) as any[]) for (const r of (ch?.records ?? []) as any[]) {
          if (!r || typeof r !== "object" || typeof r.id !== "string" || !r.at || r.author === "genesis" || who.reached.has(r.id)) continue;
          if (r.author === who.id || who.known.has(String(r.author)) && r.in_position && who.known.has(r.in_position)) continue;
          const to = ([] as unknown[]).concat(r.addressed_to ?? []).map(String);
          if (!to.some((x) => who.known.has(x)) && !ASKS.test(String(r.kind ?? ""))) continue;
          who.reached.set(r.id, { id: r.id, t: Number(r.at), kind: String(r.kind ?? r.record ?? "paper"), from: String(r.speaks_for ?? r.author ?? ""), text: String(r.text ?? ""), money: moneyNamed(r), named: namedBy(r, who.known) });
        }
      }
      else if (b.annotation === "note" && b.data?.draft_unanswered) { const d = who.drafts.get(b.data.draft_unanswered.draft); if (d) d.unanswered = true; }
      else if (b.annotation === "note" && b.data?.malformed_tool_use && /"name":"write"/.test(String(b.data.malformed_tool_use))) who.notSent++;
      return;
    }
    if (e.kind === "command") {
      const blocks: any[] = b.blocks ?? [];
      const msgs = b.command === "act" ? blocks.filter((x) => x?.block === "message") : [];
      if (msgs.length) this.letters.set(e.seq, { from: this.nameOf(b.participant, b.as), text: String(msgs[0].text ?? ""), to: msgs.flatMap((m) => m.to ?? []) });
      if (this.letters.size > 20_000) for (const k of this.letters.keys()) { this.letters.delete(k); if (this.letters.size <= 10_000) break; }
      const who = this.of.get(b.participant);
      if (!who) return;
      if (b.command === "look") who.looks++;
      else if (b.command === "opt_out") who.left = { t: e.t, statement: String(b.statement ?? "") };
      else if (b.command === "act") {
        const viaDraft = b.provenance?.via === "translator" ? String(b.provenance.draft ?? "") : undefined;
        const letter = () => ({ seq: e.seq, t: e.t, to: msgs.flatMap((m) => m.to ?? []).map(String), text: String(msgs[0].text ?? ""), ...(msgs[0].re ? { about: String(msgs[0].re) } : {}), calls: who.sitting()?.calls.slice() ?? [] });
        if (msgs.length && !viaDraft) { who.sent.push(letter()); this.bySeq.set(e.seq, { seat: who }); return; }
        const d = viaDraft ? who.drafts.get(viaDraft) : undefined;
        const sitting = d?.sitting ?? who.sitting();
        const named = namedBy(blocks, who.known);
        const g = grantedOf(blocks);
        const c: Carried = { seq: e.seq, t: e.t, ...(viaDraft ? { draft: viaDraft } : {}), preview: d?.summary || kindsOf(blocks).join(", "), ...(d?.proposal ? { proposal: d.proposal } : b.provenance?.proposal ? { proposal: String(b.provenance.proposal) } : {}),
          ...(b.reasoning ? { reasoning: String(b.reasoning) } : {}), ...(d?.note ? { signoff_note: d.note } : {}), money: moneyNamed(blocks), named, ...(g !== undefined ? { granted: g } : {}),
          ...(blocks.some((x) => DIRECTION.test(String(x?.kind ?? ""))) ? { direction: true } : {}), kinds: kindsOf(blocks), made: [], calls: sitting?.calls.slice() ?? [],
          ...(sitting ? { named_and_shown: idsIn(blocks).filter((x) => sitting.ids.has(x)), named_not_shown: idsIn(blocks).filter((x) => !sitting.ids.has(x) && !who.known.has(x)) } : {}) };
        who.carried.push(c);
        this.bySeq.set(e.seq, { seat: who, carried: c });
        // (A letter sent by way of a draft is a letter too.)
        if (msgs.length) who.sent.push(letter());
      }
      return;
    }
    if (e.kind === "event") {
      // What an act made is logged when the act is done, under whatever moved the clock on: an act's events follow
      // its own `action_applied`, which names the act, which `action_started` tied to its command.
      if (b.event === "action_started") { if (this.bySeq.has(b.cause) || this.letters.has(b.cause)) this.actions.set(String(b.action), b.cause); return; }
      if (b.event === "action_applied") { const cmd = this.actions.get(String(b.action)); this.actions.delete(String(b.action)); this.applying = cmd !== undefined ? { cause: b.cause, cmd } : undefined; return; }
      const cmd = this.bySeq.has(b.cause) || this.letters.has(b.cause) ? b.cause : this.applying?.cause === b.cause ? this.applying!.cmd : undefined;
      if (cmd === undefined) return;
      if (b.event === "recorded" && typeof b.record?.id === "string") this.bySeq.get(cmd)?.carried?.made.push(b.record.id);
      else if (b.event === "message_delivered") {
        const own = this.bySeq.get(cmd);
        const mine = own?.carried;
        if (mine && typeof b.message === "string") mine.made.push(b.message);
        const letter = own?.seat.sent.find((x) => x.seq === cmd);
        if (letter) letter.delivered = true;
        const l = this.letters.get(cmd);
        if (!l) return;
        for (const to of (b.to ?? []) as string[]) {
          const who = this.of.get(to);
          if (who && !l.from.includes(who.id)) who.received.push({ seq: cmd, t: e.t, from: l.from, text: l.text });
        }
      }
    }
  }
}

/** Every id a set of blocks names anywhere (strings that look like ids: a basis, a record, an account, a party). */
function idsIn(blocks: unknown): string[] {
  const out = new Set<string>();
  const walk = (x: any, k?: string) => {
    if (Array.isArray(x)) return x.forEach((y) => walk(y, k));
    if (typeof x === "string") { if (k && k !== "text" && k !== "block" && k !== "kind" && k !== "memo" && k !== "for" && /^[A-Za-z][\w.:/-]{1,80}$/.test(x) && /[\d.-]/.test(x)) out.add(x); return; }
    if (!x || typeof x !== "object") return;
    for (const [key, v] of Object.entries(x)) walk(v, key);
  };
  walk(blocks);
  return [...out].sort();
}

/** Acts of the same sort, naming the same money and the same people and bodies, are one thing done several times. */
const alike = (c: Carried) => `${c.kinds.join("+")}|${c.money}|${c.named.join(",")}`;
/** A seat's acts by size (the money each names, then how many people and bodies), those alike taken once, with how many more there were like each. */
export function bySize(r: SeatRecord): { c: Carried; more: number }[] {
  const out = new Map<string, { c: Carried; more: number }>();
  for (const c of [...r.carried].sort((a, b) => b.money - a.money || b.named.length - a.named.length || a.seq - b.seq)) {
    const k = alike(c), x = out.get(k);
    if (x) x.more++; else out.set(k, { c, more: 0 });
  }
  return [...out.values()];
}
/** A letter of the seat's as a thing done (a seat may govern by letter): to how many it went, and its words. */
function letterAsCarried(l: SeatRecord["sent"][number]): Carried {
  return { seq: l.seq, t: l.t, preview: `A letter from you to ${l.to.join(", ")}${l.about ? `, about ${l.about}` : ""}: ${l.text.replace(/\s+/g, " ").trim().slice(0, 400)}`, money: 0, named: l.to, kinds: ["message"], made: [], calls: l.calls };
}

/** The things a seat's "why" questions name, at most three: the act naming most money; the thing granted or refused
 * that names most; the direction naming most; then the next by money and by people named (acts alike taken once);
 * and, where its acts are fewer than that, its letters, the one to most people first and then the longest. */
export function largest(r: SeatRecord, n = 3): Carried[] {
  const acts = bySize(r).map((x) => x.c);
  const pick: Carried[] = [];
  const take = (c?: Carried) => { if (c && !pick.includes(c) && pick.length < n) pick.push(c); };
  take(acts.find((c) => c.money > 0));
  take(acts.find((c) => c.granted !== undefined));
  take(acts.find((c) => c.direction));
  for (const c of acts) take(c);
  for (const l of r.sent.filter((l) => l.delivered && !r.carried.some((c) => c.seq === l.seq)).sort((a, b) => b.to.length - a.to.length || b.text.length - a.text.length || a.seq - b.seq)) take(letterAsCarried(l));
  return pick.sort((a, b) => a.seq - b.seq);
}

/**
 * For a seat that sat and carried out little (fewer than two things its "why" questions could name): the largest
 * matter that reached it and that it left alone, by the same sizing (the money it names, then the people and bodies
 * it names, then the earliest). A matter is a paper put before it, or a letter to it; left alone: nothing it carried
 * out or wrote afterwards names the paper, or went to the letter's sender. Nothing here says it was to have acted.
 */
export function leftAlone(r: SeatRecord): { day: number; fact: string; ids: { [k: string]: unknown } } | undefined {
  if (!r.sittings.size || r.left || largest(r).length >= 2) return undefined;
  const acted = r.carried.map((c) => JSON.stringify([c.preview, c.proposal ?? "", c.made])).join(" ") + " " + r.sent.map((l) => `${l.text} ${l.about ?? ""}`).join(" ");
  const names = (id: string) => new RegExp(`(^|[^\\w.-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w-])`).test(acted);
  const papers = [...r.reached.values()].filter((p) => !names(p.id)).map((p) => ({ t: p.t, money: p.money, named: p.named.length, fact: `A ${p.kind.replace(/_/g, " ")} from ${p.from}: "${p.text.replace(/\s+/g, " ").trim().slice(0, 500)}"`, ids: { paper: p.id, kind: p.kind, from: p.from, money_named: p.money, named: p.named } }));
  const letters = r.received.filter((l) => !r.sent.some((s) => s.delivered && s.t >= l.t && s.to.some((x) => l.from.includes(x)))).map((l) => ({ t: l.t, money: 0, named: 1, fact: `A letter to you from ${l.from[0]}: "${l.text.replace(/\s+/g, " ").trim().slice(0, 500)}"`, ids: { letter_command_seq: l.seq, from: l.from[0] } }));
  const all = [...papers, ...letters].sort((a, b) => b.money - a.money || b.named - a.named || a.t - b.t);
  const x = all[0];
  return x ? { day: dayOf(x.t), fact: x.fact, ids: { ...x.ids, day: dayOf(x.t), matters_left_alone: all.length } } : undefined;
}

/** What the log shows the seat was shown and did at a decision: ids and plain facts, for the record (never judged). */
export function besideOf(c: Carried): { [k: string]: unknown } {
  return { day: dayOf(c.t), command_seq: c.seq, ...(c.draft ? { draft: c.draft } : {}), kinds: c.kinds, money_named: c.money, named: c.named, made: c.made,
    ...(c.proposal ? { asked_in_these_words: c.proposal } : {}), ...(c.reasoning ? { reason_given_at_the_time: c.reasoning } : {}), ...(c.signoff_note ? { note_on_confirming: c.signoff_note } : {}),
    sitting_model_calls: c.calls, ...(c.named_and_shown !== undefined ? { named_and_shown: c.named_and_shown, named_and_not_shown_that_sitting: c.named_not_shown } : {}) };
}

/**
 * The summary as the seat reads it. `frame`: what it quotes left out (each quoted piece as "..."), for the test of its
 * own words. Bounded: under SUMMARY_MAX characters whatever the run.
 */
export function renderSummary(r: SeatRecord, currency: Currency, o: { frame?: boolean } = {}): string {
  const q = (s: string, max?: number) => (o.frame ? '"..."' : quote(s, max));
  const money = (cents: number) => (o.frame ? "0" : formatMoney(cents, currency));
  const L: string[] = [];
  const days = [...r.sittings.keys()].sort((a, b) => a - b);
  const drafts = [...r.drafts.values()];
  const asked = drafts.length + r.notDone.length;
  const confirmed = drafts.filter((d) => d.signoff === "accept").length, declined = drafts.filter((d) => d.signoff === "reject").length;
  const open = drafts.filter((d) => !d.signoff).length;
  L.push(days.length ? `You sat on ${plural(days.length, "day")}, the first day ${days[0]} and the last day ${days.at(-1)}.` : "The record shows no sitting of yours.");
  if (r.left) L.push(`You left the study on day ${dayOf(r.left.t)}.`);
  L.push(`You asked for ${plural(asked, "thing")} to be done. ${plural(drafts.length, "was", "were")} put to you as ${drafts.length === 1 ? "a draft" : "drafts"}: you confirmed ${confirmed}, declined ${declined}${open ? `, and ${open} had no answer from you when the run ended` : ""}. ${plural(r.notDone.length, "request")} came back with no draft${r.notDone.some((x) => x.asked_back) ? ` (${r.notDone.filter((x) => x.asked_back).length} of them with a question to you)` : ""}.`);
  const delivered = r.sent.filter((l) => l.delivered), undelivered = r.sent.length - delivered.length + r.notSent;
  L.push(`${plural(delivered.length, "letter")} of yours ${delivered.length === 1 ? "was" : "were"} delivered${undelivered ? `; ${undelivered} more that you wrote ${undelivered === 1 ? "was" : "were"} not` : ""}. You looked something up ${plural(r.looks, "time")}. ${plural(r.received.length, "letter")} reached you.`);
  const item = (c: Carried, more = 0) => `- Day ${dayOf(c.t)}${c.draft ? ` (${c.draft})` : ""}: ${q(c.preview)}${c.money ? ` Money it names: ${money(c.money)}.` : ""}${c.named.length ? ` People and bodies it names: ${c.named.length}.` : ""}${more ? ` ${more} more of the same sort, naming the same money and the same people and bodies.` : ""}`;
  const sized = bySize(r);
  if (sized.length) {
    L.push("", `Carried out on your word, ${r.carried.length} in all. The largest, by the money each names and then by how many people and bodies it names:`);
    for (const x of sized.slice(0, LISTED.largest)) L.push(item(x.c, x.more));
  } else L.push("", "Nothing was carried out on your word by way of a draft.");
  if (delivered.length) {
    const to = new Map<string, number>();
    for (const l of delivered) for (const x of l.to) to.set(x, (to.get(x) ?? 0) + 1);
    L.push("", `Your letters, by whom they went to: ${[...to].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 12).map(([x, k]) => `${o.frame ? "x" : x} ${k}`).join(", ")}${to.size > 12 ? `, and ${to.size - 12} more` : ""}.`);
  }
  const granted = r.carried.filter((c) => c.granted !== undefined);
  if (granted.length) {
    L.push("", `Granted or refused by you, ${granted.length} in all${granted.length > LISTED.granted ? `; the first ${LISTED.granted}` : ""}:`);
    for (const c of granted.slice(0, LISTED.granted)) L.push(`${item(c)} ${c.granted ? "Granted." : "Refused."}`);
  }
  const directions = r.carried.filter((c) => c.direction);
  if (directions.length) {
    L.push("", `Directions you gave, ${directions.length} in all${directions.length > LISTED.directions ? `; the first ${LISTED.directions}` : ""}:`);
    for (const c of directions.slice(0, LISTED.directions)) L.push(item(c));
  }
  const yours = drafts.filter((d) => d.signoff === "reject");
  if (yours.length) L.push("", `Drafts you declined when they were put to you: ${yours.length}. The latest: day ${dayOf(yours.at(-1)!.t)}, ${q(yours.at(-1)!.summary)}`);
  if (r.notDone.length) {
    L.push("", `What you asked for that was not done, ${r.notDone.length} in all${r.notDone.length > LISTED.not_done ? `; the latest ${LISTED.not_done}` : ""}:`);
    for (const x of r.notDone.slice(-LISTED.not_done)) L.push(`- Day ${dayOf(x.t)}: you asked ${q(x.proposal, 200)} You were told: ${q(x.told, 200)}`);
  }
  // A letter that reached it, after which it wrote nothing to whoever sent it.
  const after = (l: Letter) => r.sent.some((s) => s.delivered && s.t >= l.t && s.to.some((x) => l.from.includes(x)));
  const unanswered = r.received.filter((l) => !after(l));
  if (unanswered.length) {
    L.push("", `Letters that reached you after which you wrote nothing to their sender, ${unanswered.length} of ${r.received.length}${unanswered.length > LISTED.unanswered ? `; the latest ${LISTED.unanswered}` : ""}:`);
    for (const l of unanswered.slice(-LISTED.unanswered)) L.push(`- Day ${dayOf(l.t)}, from ${o.frame ? "x" : l.from[0]}: ${q(l.text, 200)}`);
  }
  let text = L.join("\n");
  if (text.length > SUMMARY_MAX) text = `${text.slice(0, SUMMARY_MAX - 60)}\n[the summary is cut here: it has a most it may be]`;
  return text;
}

/** From a world's config (a log's header): every id each of these participants is written to by, and the same for
 * whoever writes a letter (the post it wrote from, that post's organisation, the person, its own id last). */
export function idsFrom(config: any): (participant: string, as?: string) => string[] {
  const parts = new Map<string, any>((config?.participants ?? []).map((p: any) => [p.id, p]));
  const posts = new Map<string, any>((config?.positions ?? []).map((x: any) => [x.id, x]));
  const heldBy = new Map<string, any[]>();
  for (const x of posts.values()) if (x.holder) heldBy.set(x.holder, [...(heldBy.get(x.holder) ?? []), x]);
  return (pid, as) => {
    const p = parts.get(pid);
    const held = heldBy.get(pid) ?? [];
    const post = as ? posts.get(as) : held.length === 1 ? held[0] : undefined;
    return [...new Set([...(post ? [post.id, post.entity] : []), ...(p?.person ? [p.person] : []), ...(p?.owner ? [p.owner] : []), pid])];
  };
}
