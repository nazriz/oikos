// Shared helpers for behaviour modules: turning what a participant has seen into
// memory. Records arrive as what's new since the participant last looked, so each module keeps
// its own book of the records relevant to it, as a person would.

import * as C from "../calls";
import type { Assertion, LookRequest, Observation, Offer, Outcome as ActOutcome, Practice, Reading, Record, ParticipantAction, Registry, StatementRecord, SiteCell } from "../contracts";
import { basesOf, channels, firstDue } from "../contracts";
import { cents, moneyNow } from "../money";
import { dateWords } from "../forms";
import { evaluate } from "../law";
import type { Answers, BehaviourModule, ParticipantContext } from "../module";

export const DAY = 86_400;

export { firstDue };
export const MONTH = 30 * DAY;

/** How long a notice takes to be given once it is sent (foundations F7, 2026-10-16): the act of publishing it takes the publisher's time (a quarter of an hour
 * in the world's table), and it waits behind what the publisher has in hand; the paper is on the record, with its time, when that is done. A date counted from
 * the moment of sending is short of the law's notice by that, for one sent in the last minutes of a day. */
export const NOTICE_LAG = 3_600;

/** The day a change begins that a notice of `lead` seconds is given for, sent at `at`: the first day to begin once the notice has run, counted from when it is on
 * the record, which is a little after it is sent (`NOTICE_LAG`). */
export const startsOn = (at: number, lead: number): number => (Math.floor((at + NOTICE_LAG + lead) / DAY) + 1) * DAY;

type Claim = Extract<Record, { record: "claim" }>;

/** What a claim can be looked up by (`Book.claimsBy`): who holds it, who it's against, or what it's about. */
export type ClaimKey = "holder" | "counterparty" | "object";
const claimKey: { [K in ClaimKey]: (c: Claim) => unknown } = { holder: (c) => c.holder, counterparty: (c) => c.counterparty, object: (c) => (c.about as { object?: unknown } | undefined)?.object };

const NONE: readonly never[] = Object.freeze([]) as readonly never[];
/** What goes on a shelf. `least`: a list of at least this many public records, shown in one look, is put on a shelf
 * that every book shown the same list reads from (a town's register of lots: one list, and a place in it for each
 * reader, not a copy each); a shorter one saves little and is one more place for the book to look. `most`: a book
 * reads from at most this many shelves, and keeps what it is shown after that itself. Nothing a book answers depends
 * on either (a test may set them, to have shelves made of short lists). */
export const SHELF = { least: 256, most: 8 };

/**
 * Records in the order they were seen, with what is kept so as not to look through them each time: by id, by record
 * type, by statement kind, and (made when first asked for, and kept up from then on) claims by who holds them, who
 * they're against and what they're about, and lots by the cells they cover. A book's own pages are these; so is a
 * shelf, which is the same for every book that reads from it and is never added to once made.
 */
class Pages {
  readonly list: Record[] = [];
  private readonly place = new Map<string, number>(); // id -> where in `list`
  private readonly types = new Map<string, Record[]>();
  private readonly kinds = new Map<string, StatementRecord[]>();
  private readonly claims: { [K in ClaimKey]?: Map<unknown, Claim[]> } = {};
  /** cell -> the lots that cover it, in order; false: a lot's cells weren't a list, so lots are looked through one by one. */
  private over?: Map<string, StatementRecord[]> | false;
  /** On a shelf: the records that do something to a book that takes them in (a withdrawal, a signature, a statement
   * that replaces another...), in order, each with the record it says it replaces if that is earlier on this shelf. */
  readonly acts: { r: Record; replaces?: Record }[] = [];
  /** On a shelf: the ids it has in common with another shelf (worked out once for the two). */
  private readonly common = new WeakMap<Pages, readonly string[]>();

  constructor(readonly shelf: boolean) {}

  get(id: string): Record | undefined {
    const i = this.place.get(id);
    return i === undefined ? undefined : this.list[i];
  }

  has(id: string): boolean {
    return this.place.has(id);
  }

  /** Where a record stands in the order (none: not here). */
  placeOf(id: string): number | undefined {
    return this.place.get(id);
  }

  /** One more record (not one that is here already). */
  add(r: Record): void {
    this.place.set(r.id, this.list.length);
    this.list.push(r);
    const typed = this.types.get(r.record);
    if (typed) typed.push(r);
    else this.types.set(r.record, [r]);
    if (r.record === "claim") for (const key in this.claims) {
      const by = this.claims[key as ClaimKey]!;
      const value = claimKey[key as ClaimKey](r);
      const list = by.get(value);
      if (list) list.push(r);
      else by.set(value, [r]);
    }
    if (r.record === "statement") {
      const list = this.kinds.get(r.kind);
      if (list) list.push(r);
      else this.kinds.set(r.kind, [r]);
      if (r.kind === "lot" && this.over !== undefined) this.lotSeen(r);
    }
    if (this.shelf && acts(r)) this.acts.push({ r, ...(r.record === "statement" && typeof r.data?.replaces === "string" ? { replaces: this.get(r.data.replaces) } : {}) });
  }

  /** Records of a type, in order. (Not to be changed by whoever asks: nor is any list given out here.) */
  ofType(type: string): readonly Record[] {
    return this.types.get(type) ?? NONE;
  }

  /** Statements of a kind, in order. */
  ofKind(kind: string): readonly StatementRecord[] {
    return this.kinds.get(kind) ?? NONE;
  }

  /** The claims whose holder, counterparty or object is this, in order. */
  claimsBy(key: ClaimKey, value: unknown): readonly Claim[] {
    let by = this.claims[key];
    if (!by) {
      by = this.claims[key] = new Map();
      const of = claimKey[key];
      for (const c of this.ofType("claim") as readonly Claim[]) {
        const v = of(c);
        const l = by.get(v);
        if (l) l.push(c);
        else by.set(v, [c]);
      }
    }
    return by.get(value) ?? NONE;
  }

  private lotSeen(lot: StatementRecord): void {
    const cells: unknown = lot.data?.cells;
    if (cells === undefined || cells === null || this.over === false) return;
    if (!Array.isArray(cells)) {
      this.over = false;
      return;
    }
    const over: Map<string, StatementRecord[]> = this.over ?? (this.over = new Map());
    for (const cell of new Set(cells as string[])) {
      const lots = over.get(cell);
      if (lots) lots.push(lot);
      else over.set(cell, [lot]);
    }
  }

  /** The lots that cover a cell, in order; false: to be found by looking through the lots (`ofKind("lot")`). */
  lotsOver(cell: string): readonly StatementRecord[] | false {
    if (this.over === undefined) {
      this.over = new Map();
      for (const lot of this.ofKind("lot")) this.lotSeen(lot);
    }
    return this.over === false ? false : this.over.get(cell) ?? NONE;
  }

  /** The ids this shelf and another have in common. */
  commonWith(other: Pages): readonly string[] {
    let ids = this.common.get(other);
    if (!ids) {
      const [few, many] = this.list.length <= other.list.length ? [this, other] : [other, this];
      ids = few.list.filter((r) => many.has(r.id)).map((r) => r.id);
      this.common.set(other, ids);
    }
    return ids;
  }
}

/** Does taking a record in do something to a book beyond the record being there (`Book.mark`)? */
const acts = (r: Record): boolean =>
  r.record === "claim_release" || r.record === "withdrawal" || r.record === "signature" || r.record === "notice" ||
  (r.record === "statement" && (typeof r.data?.replaces === "string" || !!r.practice || !!r.assertion || !!r.offer?.hears));

/** The shelves made so far, by the record each begins with (for as long as that record is held by anyone). */
const SHELVES = new WeakMap<Record, Pages[]>();

/** Part of what a book has seen: pages of its own, or a shelf, less what the book had seen before it was shown the shelf. */
type Part = { pages: Pages; skipped?: Set<string>; skippedRecords?: Record[] };

/** A list put together from more than one part, and what it was put together from (the number of parts, and the
 * length of the last part's list: the earlier parts don't change). */
type Joined<T> = { parts: number; last: number; list: readonly T[] };

/** The records a book has seen, by id (what `Book.records` is: read as a map is read). */
class Seen {
  constructor(private readonly parts: Part[]) {}

  /** The record of an id, as first seen. */
  get(id: string): Record | undefined {
    for (const part of this.parts) {
      const r = part.pages.get(id);
      if (r) return r;
    }
    return undefined;
  }

  has(id: string): boolean {
    for (const part of this.parts) if (part.pages.has(id)) return true;
    return false;
  }

  get size(): number {
    let n = 0;
    for (const part of this.parts) n += part.pages.list.length - (part.skipped?.size ?? 0);
    return n;
  }

  /** Every record, in the order seen. */
  *values(): IterableIterator<Record> {
    for (const part of this.parts) for (const r of part.pages.list) if (!part.skipped?.has(r.id)) yield r;
  }
}

/** A moment in the world's words, also one before the year began (a paper brought forward names such days). */
export const whenWords = (t: number): string => (t < 0 ? `${Math.ceil(-t / DAY)} day${Math.ceil(-t / DAY) === 1 ? "" : "s"} before the year began` : dateWords(t));

/**
 * When a paper was made, for a paper brought forward from before the year (an opening caseload: `data.brought_forward`,
 * `data.since` the moment, a negative time): that moment; for any other, the time it was filed.
 */
export const madeAt = (r: { at: number; data?: any }): number => (r.data?.brought_forward && Number.isFinite(Number(r.data?.since)) && Number(r.data.since) < 0 ? Number(r.data.since) : r.at);

/**
 * Rent owed under a lease when the year began, as the landlord's statement of the rent account has it (a
 * `rent_statement` on the landlord's file, sent to the tenant: docs/behaviour/generator.md, "An ordinary day's
 * caseload"): how much, and when the oldest of it fell due (before the year: a negative time). The landlord's rent
 * book, its clerk and the tenant all read the same paper. None: nothing was owed.
 */
export function broughtForward(book: Book, landlord: string, lease: string): { owed: number; since: number; id: string } | undefined {
  const r = book.open("rent_statement").filter((x) => x.speaks_for === landlord && x.data?.lease === lease && x.data?.brought_forward).sort((a, b) => b.at - a.at)[0];
  const owed = Number(r?.data?.owed ?? 0);
  return r && owed > 0 ? { owed, since: Number(r.data?.since ?? 0), id: r.id } : undefined;
}

/**
 * Everything a participant has perceived so far, indexed. What it answers depends only on what it has seen and in
 * what order. How it is held does not show: records it was shown one by one are on its own pages; a long list shown
 * in one look (a register) is on a shelf, the same shelf for every book shown that list, and the book keeps only what
 * differs for it (what it had seen before, what it has seen withdrawn).
 */
export class Book {
  /** What it has seen, in order: its own pages, and the shelves it reads from. Only the last part, if its own, is added to. */
  private readonly parts: Part[] = [];
  private own?: Pages; // the last part's pages, if they are its own
  private shelves = 0;
  readonly records = new Seen(this.parts);
  readonly withdrawn = new Set<string>();
  /** When each record seen to be withdrawn (or replaced) stopped standing. */
  readonly withdrawnAt = new Map<string, number>();
  /** A record replaced by a later one of the same kind from whoever it spoke for (an amended law): old -> new. */
  readonly replacedBy = new Map<string, string>();
  readonly signatures = new Map<string, Set<string>>(); // agreement -> parties who signed
  readonly notices = new Map<string, { as: string; at: number }[]>(); // agreement -> notices
  readonly signedTimes = new Map<string, number[]>(); // agreement -> signature times
  private readonly signedAt_ = new Map<string, Map<string, number>>(); // agreement -> party -> when they signed
  // Kept so asking never rescans the whole history (docs/reliability.md, performance). Lists put together from more
  // than one part, by statement kind and by record type: for those asked for, and again only when they have grown.
  private readonly kindsJoined = new Map<string, Joined<StatementRecord>>();
  private readonly typesJoined = new Map<string, Joined<Record>>();
  /** statement kind -> how many times a statement of the kind seen was found withdrawn (none: every one seen stands). */
  private readonly gone = new Map<string, number>();
  /** statement kind -> those not withdrawn, in the order seen, for the kinds asked for: a list that is never changed,
   * and what it was made from (every statement of the kind, how many there were, and `gone`). */
  private readonly standing = new Map<string, { of: readonly StatementRecord[]; n: number; gone: number; list: readonly StatementRecord[] }>();
  /** Claims seen to be released (by a `claim_release`). */
  readonly released = new Set<string>();
  private readonly withPractice = new Map<string, StatementRecord>(); // statements carrying a practice, not withdrawn
  private readonly withAssertion = new Map<string, StatementRecord>(); // statements put forward to be believed, not withdrawn
  private readonly withHears = new Map<string, StatementRecord>(); // statements whose offer says what its offerer hears, not withdrawn
  /** participant -> the person it acts as (from a directory). */
  readonly participantPerson = new Map<string, string>();
  /** position -> its organisation, role and holder (from a directory). */
  readonly positions = new Map<string, { entity: string; role?: string; holder?: string }>();
  readonly entityKind = new Map<string, string>();
  /** Agreements read by their own terms, as last delivered with them (contracts 0.7: readings; docs/design/rebuild.md
   * section 7), and the time of the latest observation. */
  readonly readings = new Map<string, Reading>();
  now = 0;
  /** Laws whose formal condition couldn't be read against an act this reader weighed (it names a field the act lacks,
   * say), and how many times: such a law doesn't bind that act. Said once per law, with the reader's next reasons. */
  readonly unread = new Map<string, number>();
  private unreadToSay: string[] = [];

  /** A law's condition gave an error, not an answer, against an act: counted, and to be said (once per law). */
  noteUnread(law: string, act: unknown, error: string): void {
    const times = this.unread.get(law) ?? 0;
    this.unread.set(law, times + 1);
    const a = act as { block?: unknown; kind?: unknown } | undefined;
    const what = [a?.block, a?.kind].filter((x) => typeof x === "string").join(" ") || "an act";
    if (!times) this.unreadToSay.push(`${law} couldn't be read against ${what} (${String(error).slice(0, 200)}), so it wasn't applied`);
  }

  /** What hasn't been said yet of laws that couldn't be read, as a sentence for a reason (then it has been said). */
  takeUnread(): string | undefined {
    return this.unreadToSay.length ? `(A law that can't be read against an act doesn't bind it: ${this.unreadToSay.splice(0).join("; ")}.)` : undefined;
  }
  private lastDirectory: unknown; // the directory lists last read (the view hands back the same lists until they change)

  absorb(obs: Observation): Record[] {
    const fresh: Record[] = [];
    this.now = obs.t;
    for (const [id, r] of Object.entries(obs.readings ?? {})) this.readings.set(id, r);
    // (Channel by channel, in the order `channels.records` gives them.)
    for (const ch of Object.values(obs.channels)) if (ch.kind === "records") this.take(ch.records, fresh);
    const dir = channels.directory(obs);
    if (dir && dir.positions !== this.lastDirectory) {
      this.lastDirectory = dir.positions;
      for (const p of dir.positions) this.positions.set(p.position, { entity: p.entity, role: p.role, holder: p.holder });
      for (const e of dir.entities) {
        this.entityKind.set(e.entity, e.kind);
        if (e.participant) this.participantPerson.set(e.participant, e.entity);
      }
    }
    return fresh;
  }

  /**
   * A list of records as shown in one look: each one not seen before is taken in, in order. A long list is read from a
   * shelf where it can be: the shelf made already that begins where the list does and runs as the list runs, or a new
   * one. Either way the book has seen exactly what it would have, taking them one by one: a record it had seen before
   * is passed over, on the shelf as in the list. (Only public records go on a shelf: what one reader alone is shown
   * would be on no other reader's list.)
   */
  private take(list: readonly Record[], fresh: Record[]): void {
    const n = list.length;
    let i = 0;
    while (i < n) {
      if (n - i < SHELF.least || this.shelves >= SHELF.most) {
        for (; i < n; i++) this.see(list[i]!, fresh);
        break;
      }
      const r = list[i]!;
      if (r.visible_to !== "public") {
        this.see(r, fresh);
        i++;
        continue;
      }
      // The longest shelf beginning with this record that the list goes on to run the length of.
      let fit: { pages: Pages; skipped?: Set<string>; next: number } | undefined;
      for (const pages of SHELVES.get(r) ?? []) {
        if (fit && pages.list.length <= fit.pages.list.length) continue;
        const skipped = this.seenOn(pages);
        const next = this.runs(pages, skipped, list, i);
        if (next !== undefined) fit = { pages, skipped, next };
      }
      if (!fit) {
        // None: a new shelf, of the public records from here to the first record that isn't public and is new to
        // this book (one it has seen is passed over).
        const pages = new Pages(true);
        let k = i;
        for (; k < n; k++) {
          const b = list[k]!;
          if (b.visible_to !== "public") {
            if (this.records.has(b.id)) continue;
            break;
          }
          if (!pages.has(b.id)) pages.add(b);
        }
        if (pages.list.length < SHELF.least) {
          for (; i < k; i++) this.see(list[i]!, fresh);
          continue;
        }
        const made = SHELVES.get(r);
        if (made) made.push(pages);
        else SHELVES.set(r, [pages]);
        fit = { pages, skipped: this.seenOn(pages), next: k };
      }
      this.shelve(fit.pages, fit.skipped, fresh);
      i = fit.next;
    }
  }

  /** The ids on a shelf that this book has seen already (none: undefined). */
  private seenOn(pages: Pages): Set<string> | undefined {
    let seen: Set<string> | undefined;
    for (const part of this.parts) {
      if (part.pages.shelf) {
        const common = part.pages.commonWith(pages);
        if (common.length) for (const id of common) (seen ??= new Set()).add(id);
      } else if (part.pages.list.length <= pages.list.length) {
        for (const r of part.pages.list) if (pages.has(r.id)) (seen ??= new Set()).add(r.id);
      } else for (const r of pages.list) if (part.pages.has(r.id)) (seen ??= new Set()).add(r.id);
    }
    return seen;
  }

  /**
   * Does a list, from `from`, run as a shelf does for this book: the records of the list that are new to the book, in
   * order, being the shelf's records that are new to the book, in order, to the shelf's end? Where the list has got to
   * when the shelf ends, if so.
   */
  private runs(pages: Pages, skipped: Set<string> | undefined, list: readonly Record[], from: number): number | undefined {
    const on = pages.list;
    let i = from;
    for (let j = 0; j < on.length; ) {
      const s = on[j]!;
      if (i < list.length && list[i] === s) {
        i++;
        j++;
      } else if (skipped?.has(s.id)) j++; // seen before, and not in the list here
      else if (i < list.length) {
        // In the list and not next on the shelf: nothing to the book if it has seen it (before, or earlier in this list).
        const b = list[i]!;
        const at = pages.placeOf(b.id);
        if ((at !== undefined && at < j) || this.records.has(b.id)) i++;
        else return undefined;
      } else return undefined;
    }
    return i;
  }

  /** A shelf's records taken in: as each would have been one by one, less those seen before. */
  private shelve(pages: Pages, skipped: Set<string> | undefined, fresh: Record[]): void {
    // (A statement on the shelf that this book saw withdrawn before it saw the statement.)
    if (this.withdrawn.size <= pages.list.length) {
      for (const id of this.withdrawn) {
        const r = pages.get(id);
        if (r?.record === "statement" && !skipped?.has(id)) this.gone.set(r.kind, (this.gone.get(r.kind) ?? 0) + 1);
      }
    } else for (const r of pages.list) if (r.record === "statement" && this.withdrawn.has(r.id) && !skipped?.has(r.id)) this.gone.set(r.kind, (this.gone.get(r.kind) ?? 0) + 1);
    const before = this.parts.length;
    this.parts.push({ pages, ...(skipped ? { skipped } : {}) });
    this.own = undefined;
    this.shelves++;
    if (skipped) {
      for (const r of pages.list) if (!skipped.has(r.id)) fresh.push(r);
    } else for (const r of pages.list) fresh.push(r);
    for (const act of pages.acts) {
      if (skipped?.has(act.r.id)) continue;
      // (What it replaces: as the book had seen it by then, before this shelf or earlier on it.)
      let old: Record | undefined;
      if (act.r.record === "statement" && typeof act.r.data?.replaces === "string") {
        for (let p = 0; p < before && !old; p++) old = this.parts[p]!.pages.get(act.r.data.replaces);
        old ??= act.replaces;
      }
      this.mark(act.r, old);
    }
  }

  /** One record, taken in if it hasn't been seen before. */
  private see(r: Record, fresh: Record[]): void {
    if (this.records.has(r.id)) return;
    if (!this.own) {
      this.own = new Pages(false);
      this.parts.push({ pages: this.own });
    }
    this.own.add(r);
    fresh.push(r);
    if (r.record === "statement" && this.withdrawn.has(r.id)) this.gone.set(r.kind, (this.gone.get(r.kind) ?? 0) + 1);
    if (acts(r)) this.mark(r, r.record === "statement" && typeof r.data?.replaces === "string" ? this.records.get(r.data.replaces) : undefined);
  }

  /** What a record does to the book on being taken in, beyond being there. `old`: the record it says it replaces, if seen by then. */
  private mark(r: Record, old: Record | undefined): void {
    if (r.record === "claim_release") this.released.add(r.claim);
    if (r.record === "withdrawal") this.takeDown(r.withdraws, r.at);
    // A statement that says it replaces an earlier one of the same kind from whoever it speaks for (an amended law
    // names the law it replaces, in its words too): the earlier one no longer stands for this reader, whether or not
    // its withdrawal is among what it's shown. (A plain repeal reaches it as the withdrawal itself: a channel that
    // shows statements of a kind shows them being taken down by whoever they speak for.)
    if (r.record === "statement" && old?.record === "statement" && old.kind === r.kind && !!old.speaks_for && old.speaks_for === r.speaks_for) {
      this.replacedBy.set(old.id, r.id);
      this.takeDown(old.id, r.at);
    }
    if (r.record === "signature") {
      const s = this.signatures.get(r.agreement) ?? new Set();
      s.add(r.as);
      this.signatures.set(r.agreement, s);
      this.signedTimes.set(r.agreement, [...(this.signedTimes.get(r.agreement) ?? []), r.at]);
      const by = this.signedAt_.get(r.agreement) ?? new Map<string, number>();
      if (!by.has(r.as)) by.set(r.as, r.at);
      this.signedAt_.set(r.agreement, by);
    }
    if (r.record === "statement" && !this.withdrawn.has(r.id)) {
      if (r.practice) this.withPractice.set(r.id, r);
      if (r.assertion) this.withAssertion.set(r.id, r);
      if (r.offer?.hears) this.withHears.set(r.id, r);
    }
    if (r.record === "notice") this.notices.set(r.agreement, [...(this.notices.get(r.agreement) ?? []), { as: r.as, at: r.at }]);
  }

  private takeDown(id: string, at: number) {
    if (!this.withdrawn.has(id)) {
      this.withdrawn.add(id);
      const w = this.records.get(id);
      if (w?.record === "statement") this.gone.set(w.kind, (this.gone.get(w.kind) ?? 0) + 1);
    }
    if (!this.withdrawnAt.has(id)) this.withdrawnAt.set(id, at);
    this.withPractice.delete(id);
    this.withAssertion.delete(id);
    this.withHears.delete(id);
  }

  /** The record in force that an id names now: itself while it stands, or what has replaced it (an amended law, and
   * what amended that), if that stands. None: never seen, or withdrawn with nothing in its place. */
  current(id: string): Record | undefined {
    let at = id;
    for (let i = 0; i < 1000 && this.replacedBy.has(at); i++) at = this.replacedBy.get(at)!;
    return this.withdrawn.has(at) ? undefined : this.records.get(at);
  }

  /**
   * Is a standing paper on hold (contracts/calls.md, a hold): does a hold that stands name it, made in the name of
   * whoever the paper speaks for (or, with `by`, of one of those)? Whoever acts on a standing paper asks this before
   * acting on it: the bank of a payment instruction, an office of a direction given to it, an office's staff of a
   * standing work order, an employer's own people of its advertisement. A hold by anyone else is nothing to them.
   */
  onHold(id: string, by?: string[]): boolean {
    const r = this.records.get(id);
    const whose = by ?? (r && "speaks_for" in r && r.speaks_for ? [r.speaks_for] : []);
    return this.standingOf("hold").some((h) => !!h.speaks_for && whose.includes(h.speaks_for) && Array.isArray(h.data?.holds) && h.data.holds.includes(id));
  }

  /** Seen to be withdrawn, with nothing standing in its place (a law repealed, a procedure revoked). */
  repealed(id: string): boolean {
    return this.withdrawn.has(id) && !this.current(id);
  }

  /** A list from each part, less what the part passes over, one after another: the one list where only one part has
   * any, and otherwise a list put together when first asked for and again when the last part's has grown. */
  private joined<T extends Record>(kept: Map<string, Joined<T>> | undefined, key: string, pick: (pages: Pages) => readonly T[], is: (r: Record) => boolean): readonly T[] {
    const parts = this.parts;
    if (parts.length === 0) return NONE;
    if (parts.length === 1) return pick(parts[0]!.pages);
    const last = pick(parts[parts.length - 1]!.pages).length;
    const had = kept?.get(key);
    if (had && had.parts === parts.length && had.last === last) return had.list;
    let only: readonly T[] | undefined, several: T[] | undefined;
    for (const part of parts) {
      let list = pick(part.pages);
      if (!list.length) continue;
      if (part.skipped) {
        const passed = (part.skippedRecords ??= [...part.skipped].map((id) => part.pages.get(id)!));
        if (passed.some(is)) list = list.filter((r) => !part.skipped!.has(r.id));
        if (!list.length) continue;
      }
      if (!only) only = list;
      else {
        several ??= only.slice();
        for (const r of list) several.push(r);
      }
    }
    const list = several ?? only ?? NONE;
    kept?.set(key, { parts: parts.length, last, list });
    return list;
  }

  /** Every statement of a kind seen, withdrawn or not, in the order seen. (Not to be changed by whoever asks.) */
  all(kind: string): readonly StatementRecord[] {
    return this.joined(this.kindsJoined, kind, (pages) => pages.ofKind(kind), (r) => r.record === "statement" && r.kind === kind);
  }

  /** Statements of a kind that are still standing (not withdrawn), in the order seen. */
  open(kind: string): StatementRecord[] {
    // (A copy: whoever asks may sort it.)
    return this.standingOf(kind).slice();
  }

  /** The standing lot (a statement of kind "lot") that covers a cell: of several, the first seen. */
  lotOver(cell: string): StatementRecord | undefined {
    for (const part of this.parts) {
      const lots = part.pages.lotsOver(cell);
      // (A lot the part passes over needs no leaving out: it was seen in an earlier part, which has answered if it stands.)
      const stands = (l: StatementRecord) => !this.withdrawn.has(l.id);
      const lot = lots === false ? part.pages.ofKind("lot").find((l) => stands(l) && (l.data?.cells as string[] | undefined)?.includes(cell)) : lots.find(stands);
      if (lot) return lot;
    }
    return undefined;
  }

  /** Statements carrying a practice (a gathering: docs/design/ai-citizens.md 2b), still standing, in the order seen. */
  practices(): StatementRecord[] {
    return [...this.withPractice.values()];
  }

  /** Statements whose offer says what its offerer hears (a desk, a list, a group that takes up grievances:
   * docs/behaviour/frictions.md), still standing, in the order seen. */
  hearings(): StatementRecord[] {
    return [...this.withHears.values()];
  }

  /** Statements put forward to be believed (an `assertion`: a teaching, a report, a promise), not withdrawn. */
  assertions(): StatementRecord[] {
    return [...this.withAssertion.values()];
  }

  /** The claims seen whose holder, counterparty or object (what it's about) is this, in the order seen: the same as
   * looking through every claim seen, without doing so each time. (Not to be changed by whoever asks.) */
  claimsBy(key: ClaimKey, value: string): readonly Claim[] {
    return this.joined<Claim>(undefined, "", (pages) => pages.claimsBy(key, value), (r) => r.record === "claim" && claimKey[key](r) === value);
  }

  /** A kind's standing statements, as `open` gives them, without the copy: the same list until they change, and
   * another once they have. Not to be changed (or sorted) by whoever asks. */
  standingOf(kind: string): readonly StatementRecord[] {
    const all = this.all(kind);
    const gone = this.gone.get(kind) ?? 0;
    const had = this.standing.get(kind);
    if (had && had.of === all && had.n === all.length && had.gone === gone) return had.list;
    // (Every one stands: the list of them all, where that list won't change; a copy where it is the book's own
    // pages' list, which is added to.)
    const list = gone ? all.filter((r) => !this.withdrawn.has(r.id)) : this.own && all === this.own.ofKind(kind) ? all.slice() : all;
    this.standing.set(kind, { of: all, n: all.length, gone, list });
    return list;
  }

  /** Records of a type (agreement, claim, notice...), in the order seen: rather than every record ever seen. (Not to
   * be changed by whoever asks.) */
  ofType<T extends Record["record"]>(type: T): readonly Extract<Record, { record: T }>[] {
    return this.joined(this.typesJoined, type, (pages) => pages.ofType(type), (r) => r.record === type) as readonly Extract<Record, { record: T }>[];
  }

  /** How it holds what it has seen (for tests and measuring; nothing it answers depends on it): records on its own
   * pages, and records it reads from shelves it shares. */
  held(): { own: number; shared: number; shelves: number } {
    let own = 0, shared = 0;
    for (const part of this.parts) {
      if (part.pages.shelf) shared += part.pages.list.length - (part.skipped?.size ?? 0);
      else own += part.pages.list.length;
    }
    return { own, shared, shelves: this.shelves };
  }

  signedBy(agreement: string, party: string): boolean {
    return this.signatures.get(agreement)?.has(party) ?? false;
  }

  /**
   * An offer taken back by whoever made it before every party had signed it (docs/behaviour/offers.md): it can no longer
   * be signed, and a signature made after it was withdrawn concludes nothing. An agreement every party had signed when
   * its paper was withdrawn is concluded all the same: withdrawing the paper ends nothing, a notice does.
   */
  takenBack(agreement: string): boolean {
    const at = this.withdrawnAt.get(agreement);
    const a = this.records.get(agreement);
    if (at === undefined || a?.record !== "agreement") return false;
    const by = this.signedAt_.get(agreement);
    return !a.terms.parties.every((p) => (by?.get(p) ?? Infinity) <= at);
  }

  /** Concluded: signed by every party (whether or not it has since ended), the offer not taken back before the last signed. */
  concluded(agreement: string): boolean {
    const a = this.records.get(agreement);
    return a?.record === "agreement" && a.terms.parties.every((p) => this.signedBy(agreement, p)) && !this.takenBack(agreement);
  }

  /** In force now: by its reading, if one came with it (concluded, and not yet ended by its term or by notice under its
   * terms); otherwise, concluded. */
  inForce(agreement: string): boolean {
    if (this.takenBack(agreement)) return false;
    const r = this.readings.get(agreement);
    if (r) return (r.status === "in_force" || r.status === "ending") && (r.ends_at === undefined || this.now < r.ends_at);
    return this.concluded(agreement);
  }

  /** When it ends by its reading (its term run out, or notice under its terms), if one came with it and it has an end. */
  endsAt(agreement: string): number | undefined {
    return this.readings.get(agreement)?.ends_at;
  }

  /** The time the last party signed, if all have. */
  signedAt(agreement: string): number | undefined {
    if (!this.concluded(agreement)) return undefined;
    return Math.max(...(this.signedTimes.get(agreement) ?? []));
  }

  /** The entity a record was made for: the organisation of the position it was made in, or its author's person. */
  authorEntity(r: Record): string | undefined {
    if (r.author === "genesis") return r.speaks_for;
    if (r.in_position) return this.positions.get(r.in_position)?.entity;
    return this.participantPerson.get(r.author);
  }

  entitiesOfKind(kind: string): string[] {
    return [...this.entityKind].filter(([, k]) => k === kind).map(([e]) => e).sort();
  }
}

const sameList = (a: readonly unknown[], b: readonly unknown[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * For each speaker, its latest standing statement of a kind that passes a test (of several made at the same time, the
 * first seen): what sorting the kind's standing statements for that speaker, newest first, puts first. Worked out for
 * every speaker in one pass, and again only when the kind's standing statements change: a shopper comparing every
 * shop's prices doesn't look through every price list once per shop. And once for the books whose standing statements
 * are the same ones in the same order (a town's shoppers, shown the same lists): the answer is theirs in common.
 */
export class Latest {
  private readonly kept = new WeakMap<Book, { of: readonly StatementRecord[]; by: Map<string | undefined, StatementRecord> }>();
  /** The last few worked out, for whichever books. */
  private readonly lately: { of: readonly StatementRecord[]; by: Map<string | undefined, StatementRecord> }[] = [];
  constructor(private readonly kind: string, private readonly test: (r: StatementRecord) => unknown) {}

  of(book: Book, speaker: string | undefined): StatementRecord | undefined {
    const standing = book.standingOf(this.kind);
    let kept = this.kept.get(book);
    if (kept?.of !== standing) {
      let by = this.lately.find((x) => sameList(x.of, standing))?.by;
      if (!by) {
        by = new Map<string | undefined, StatementRecord>();
        for (const r of standing) {
          if (!this.test(r)) continue;
          const best = by.get(r.speaks_for);
          if (!best || r.at > best.at) by.set(r.speaks_for, r);
        }
        this.lately.unshift({ of: standing, by });
        if (this.lately.length > 4) this.lately.pop();
      }
      kept = { of: standing, by };
      this.kept.set(book, kept);
    }
    return kept.by.get(speaker);
  }
}

/** Laws seen that prohibit (institutional grammar: must not) with a formal condition, in id order: those standing now,
 * or, given a time, those in force then (made by then, and not withdrawn or replaced by then). */
export function prohibitions(book: Book, at?: number): StatementRecord[] {
  const laws = at === undefined ? book.open("law") : book.all("law").filter((l) => l.at <= at && !((book.withdrawnAt.get(l.id) ?? Infinity) <= at));
  return laws.filter((l) => l.formal?.condition && (l.adico as any)?.deontic === "must_not").sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * The laws in force, as far as this participant has seen, that an act it's thinking of would breach: prohibitions whose
 * formal condition is true of the act (docs/design/ai-citizens.md 2e; D27). A law binds a code participant only this
 * way, whoever passed it (a world's genesis, a council, a model mayor through the translator), never through a field
 * only code reads (VISION 15). Whether to comply is still the participant's: breaking a law is always possible.
 */
export function breaches(book: Book, act: object, actor: string, now: number): StatementRecord[] {
  // (The laws in force at `now`, the moment of the act: a notice is judged by the law as it stood when it was given.)
  return prohibitions(book, now).filter((l) => holdsOf(book, l, { block: act, actor, now }));
}

/**
 * Is a law's formal condition true of an act, as this reader reads it? A condition that gives an error and no answer
 * (it names a field the act lacks: a law written for another kind of act, or written wrongly) isn't true of it, so the
 * law doesn't bind the act; but never silently: the reader's book counts it (`Book.unread`) and the reader says so
 * with its next reasons (`noted`), which is how it reaches the log.
 */
export function holdsOf(book: Book, law: StatementRecord, vars: { block: object; actor: string; now: number }, claims: Parameters<typeof evaluate>[2] = []): boolean {
  const v = evaluate(law.formal!.condition, vars, claims);
  if ("value" in v) return !!v.value;
  book.noteUnread(law.id, vars.block, v.error);
  return false;
}

/** An action with, in its reasons, whatever its maker's book couldn't read of the laws and hasn't yet said. */
export function noted(book: Book, action: ParticipantAction): ParticipantAction {
  if (action.type === "wait") return action;
  const note = book.takeUnread();
  if (note) (action as { reasoning?: string }).reasoning = "reasoning" in action && action.reasoning ? `${action.reasoning} ${note}` : note;
  return action;
}

/**
 * What a draw about a paper is named for (docs/reliability.md, "Draws and the order papers were filed in"): who it
 * is from, what it concerns, and which time this is for that pair ("the second request from this tenant about this
 * building"), never the paper's number in the world's file, which moves with every paper anyone files. The same
 * paper is always the same occurrence. Names that are themselves a record's number in the file are left out.
 */
export class Occurrences {
  private readonly count = new Map<string, number>();
  private readonly of = new Map<string, string>();
  key(paper: string, ...about: (string | undefined)[]): string {
    const had = this.of.get(paper);
    if (had) return had;
    const base = about.map((x) => (x === undefined || /^rec\.[0-9]+$/.test(x) ? "" : x)).join("/");
    const n = (this.count.get(base) ?? 0) + 1;
    this.count.set(base, n);
    const k = `${base}#${n}`;
    this.of.set(paper, k);
    return k;
  }
}

/** A controller whose every action is `noted`: for a module that weighs acts against the laws in its book. */
export function noting<T extends { step(obs: Observation, ...rest: any[]): ParticipantAction }>(book: Book, controller: T): T {
  const step = controller.step.bind(controller);
  controller.step = (obs: Observation, ...rest: any[]) => noted(book, step(obs, ...rest));
  return controller;
}

// ------------------------------------------------------------------ laws made from figures (docs/behaviour/government.md)
//
// A law whose substance is a few figures (a notice period, how often, a threshold) is written from them by a schedule:
// world content (a record of kind `law_schedule`) giving the figures with their types and units, and how the law's
// words, its Institutional Grammar breakdown and its rule (a formal condition) read with the figures in place. A world's
// generator writes its opening laws this way and the council's clerk writes an amended law the same way, so whoever
// reads the first reads the second. The law carries its figures openly (`data.figures`), so anyone can see what can be
// amended. Nothing here knows any particular law.

/** A figure of a law. A duration is held in seconds and worded in `unit` (days, months...); a count is held in
 * `held_in` (default: its unit), `per_unit` of them to one `unit` (a share: unit "percent", held in basis points, 100
 * to one). `type` is also the type of the figure's field on the law's amendment form. */
export type LawFigure = { type: "duration" | "count"; unit: string; label?: string; held_in?: string; per_unit?: number; description?: string;
  /** The law may do without it: a place that has no such requirement gives none, and the law then says nothing of it
   * (given as nought, it is taken as not given: a requirement of nothing is none). */
  optional?: boolean };
/** A schedule: in its `text`, each of its `adico` parts and its `formal` (a CEL condition, if acts can be checked
 * against the law), `{name}` stands for the figure as worded ("60 days", "50") and `{name:seconds}` (any word after the
 * colon; by convention the unit it's held in) for the number as held. Clauses that turn on optional figures are
 * written as a list, `<<separator;;clause;;clause>>`: a clause is kept where every figure it names is given, and the
 * kept ones are joined by the separator. */
export type LawSchedule = { title: string; form?: string; figures: { [name: string]: LawFigure }; text: string; adico?: { [part: string]: string }; formal?: string };
/** A law's figures as it carries them: each value with the unit it's held in. */
export type LawFigures = { [name: string]: { value: number; unit: string } };

const DURATION_UNITS: [string, string, number][] = [["years", "year", 365 * DAY], ["months", "month", MONTH], ["weeks", "week", 7 * DAY], ["days", "day", DAY], ["hours", "hour", 3600], ["minutes", "minute", 60], ["seconds", "second", 1]];

/** The unit a figure's value is held in. */
export const heldIn = (f: LawFigure): string => (f.type === "duration" ? "seconds" : f.held_in ?? f.unit);

/** A figure's value as held, from what its form field gives (a duration arrives in seconds; a count in the figure's unit). */
export const heldValue = (f: LawFigure, given: number): number => (f.type === "duration" ? given : given * (f.per_unit ?? 1));

/** A figure in words: a duration in the schedule's unit when it's a whole number of them, else in days, hours or minutes where
 * it is a whole number of those, else in the schedule's unit as a decimal (a law does not count in
 * seconds; nought is nought of the schedule's unit); a count in its unit ("50%", "3 times"; without the unit, "50").
 * A figure that is not there is "none". */
export function figureWords(f: LawFigure, value: number | undefined, withUnit = true): string {
  if (!Number.isSafeInteger(value)) return "none";
  if (f.type === "duration") {
    const own = DURATION_UNITS.find(([plural]) => plural === f.unit) ?? DURATION_UNITS[3]!;
    const [plural, singular, size] = [own, DURATION_UNITS[3]!, DURATION_UNITS[4]!, DURATION_UNITS[5]!].find((u) => value! >= u[2] && value! % u[2] === 0) ?? own;
    const n = Math.round((value! * 100) / size) / 100;
    return `${n} ${n === 1 ? singular : plural}`;
  }
  const n = String(value! / (f.per_unit ?? 1));
  return withUnit ? (f.unit === "percent" ? `${n}%` : `${n} ${f.unit}`) : n;
}

/** Is a figure given? An optional one given as nought is not: a requirement of nothing is none. */
export const figureGiven = (f: LawFigure | undefined, value: number | undefined): boolean => !!f && Number.isSafeInteger(value) && !(f.optional && value === 0);

/** A law written from figures by a schedule: its words, its breakdown, its rule, and the figures it carries. Throws if
 * the schedule names a figure it isn't given and can't do without (a law can't be written with a gap in it), or if it
 * is given none of its figures at all (there is then no law to write). */
export function draftLaw(scheduleId: string, s: LawSchedule, values: { [name: string]: number | undefined }): { text: string; adico?: { [part: string]: string }; formal?: { language: "cel"; condition: string }; data: { schedule: string; figures: LawFigures } } {
  const given = (name: string) => figureGiven(s.figures[name], values[name]);
  const named = (part: string) => [...part.matchAll(/\{(\w+)(?::\w+)?\}/g)].map((m) => m[1]!);
  // The clauses that turn on optional figures: each kept where all it names is given, the kept ones joined.
  const clauses = (template: string) => template.replace(/<<([\s\S]*?)>>/g, (_, list: string) => {
    const [separator, ...parts] = list.split(";;");
    return parts.filter((part) => named(part).every(given)).join(separator!);
  });
  const fill = (template: string) => clauses(template).replace(/\{(\w+)(?::(\w+))?\}/g, (_, name: string, held?: string) => {
    if (!given(name)) throw new Error(`law schedule ${scheduleId}: no figure ${name}`);
    return held ? String(values[name]) : figureWords(s.figures[name]!, values[name], false);
  }).replace(/ {2,}/g, " ").trim();
  const figures: LawFigures = {};
  for (const [name, f] of Object.entries(s.figures)) {
    if (!given(name)) {
      if (f.optional) continue;
      throw new Error(`law schedule ${scheduleId}: no figure ${name}`);
    }
    figures[name] = { value: values[name]!, unit: heldIn(f) };
  }
  if (!Object.keys(figures).length) throw new Error(`law schedule ${scheduleId}: none of its figures is given, so there is no law to write`);
  // (A part of the breakdown that turned wholly on figures not given is left out.)
  return { text: fill(s.text), ...(s.adico ? { adico: Object.fromEntries(Object.entries(s.adico).map(([k, v]) => [k, fill(v)] as const).filter(([, v]) => v !== "")) } : {}),
    ...(s.formal ? { formal: { language: "cel" as const, condition: fill(s.formal) } } : {}), data: { schedule: scheduleId, figures } };
}

/** Signatures on a petition this participant can see: votes with choice "sign", one per signing entity (the organiser sees them all). */
export function petitionSignatures(book: Book, petition: string): number {
  const who = new Set<string>();
  for (const r of book.ofType("vote")) if (r.ballot === petition && r.choice === "sign" && r.speaks_for) who.add(r.speaks_for);
  return who.size;
}

/** A petition's signature count as its organiser last published it (0 if never), organiser included. */
export function publishedCount(book: Book, petition: StatementRecord): number {
  const counts = book.open("petition_count").filter((c) => c.data?.petition === petition.id && c.speaks_for === petition.speaks_for);
  return counts.length ? (counts.at(-1)!.data.signatures as number) : 0;
}

/** An entity's own account at a bank (not money it keeps itself), with its balance as a number (money.ts). */
export function ownBanked(obs: Observation, holder: string): { account: string; balance: number; custodian: string; currency: string } | undefined {
  const a = channels.accounts(obs).find((x) => x.holder === holder && x.custodian !== holder);
  return a && { account: a.account, balance: cents(a.balance), custodian: a.custodian, currency: a.currency };
}

/** Its own account (held by the entity it acts for), with its balance as a number for arithmetic (money.ts). */
export function ownAccount(obs: Observation): { account: string; balance: number; custodian: string; currency: string } | undefined {
  const a = channels.accounts(obs).find((x) => x.holder === obs.entity);
  return a && { account: a.account, balance: cents(a.balance), custodian: a.custodian, currency: a.currency };
}

// ------------------------------------------------------------------ asking whoever keeps it (docs/no-god-view.md)
//
// Nobody has a god's view. A participant is shown its own records, what is addressed to it and its own premises;
// anything else it needs it asks for, from whoever keeps it, the one thing at a time: a lot's plan from the land
// register by the lot's id, the agreements at its own workplace by its employer's name, one shop's price list by the
// shop. `ask` is the way to do that, and the only way a behaviour should come to know of what someone else keeps: a
// search through a channel of its own that is shown only on request (contracts: a look with a query), answered with
// what matches now. It is for this that such channels exist; a channel that shows a whole register unasked is refused
// by orchestrator/test/no-god-view.test.ts unless the module is that register's keeper and says so (`keeps`).
//
// How to use it: return the requests from a stepper's `looks` (behaviour/firms.ts), or as a `look` action; the answer
// comes with the next observation, in the same book as everything else seen. Ask once for what doesn't change (`Asked`
// remembers), and never for more than the decision in hand needs: every search names something (an id, an owner, a
// place) or is cut to the few a person would read (`most`), which the module takes from its parameters.

/** One search of a channel shown on request (contracts/participant-api.schema.json: LookRequest). */
export type Asking = LookRequest & { query: NonNullable<LookRequest["query"]> };

export const ask = {
  /** The one record with this id: a lot's plan, a title, a listing someone gave us the number of. */
  one: (channel: string, id: string): Asking => ({ channel, query: { where: [{ field: "id", op: "=", value: id }], limit: 1 } }),
  /**
   * The records that say `value` at `field` (`speaks_for`: one shop's price list, one person's enrolment; `claim`: the
   * dealings in one title; `data.employer`: the agreements at one workplace; `about.object`: the titles to one lot),
   * at most `most` of them. `since`: made at or after then. `standing`: only those not withdrawn. `newest`: the latest
   * first (so `most: 1` is the current one); `oldest`: in the order made.
   */
  about: (channel: string, field: string, value: string | number | boolean, o: { most: number; since?: number; standing?: boolean; newest?: boolean; oldest?: boolean }): Asking => ({
    channel,
    query: { ...(o.standing ? { standing: true } : {}), where: [{ field, op: "=", value }, ...(o.since !== undefined ? [{ field: "at", op: ">=" as const, value: o.since }] : [])],
      ...(o.newest ? { order: { field: "at", desc: true } } : o.oldest ? { order: { field: "at" } } : {}), limit: o.most },
  }),
  /**
   * A reader's few: the first `most` standing records of a board (a listings page, the petitions board), by `by` if
   * given (`data.rent`, dearest first with `desc`), under conditions the reader sets (`where`). Never a way round the
   * rule: `most` is how many a person would read, from the module's parameters.
   */
  board: (channel: string, o: { most: number; where?: NonNullable<Asking["query"]["where"]>; by?: string; desc?: boolean }): Asking => ({
    channel, query: { standing: true, ...(o.where?.length ? { where: o.where } : {}), ...(o.by ? { order: { field: o.by, ...(o.desc ? { desc: true } : {}) } } : {}), limit: o.most },
  }),
};

/**
 * Who's who, looked up one at a time (docs/design/knowing.md, section 7): nobody is shown the directory. A look-up
 * names one entity, one participant, one position, a name, or an organisation's holders of one office; the answer
 * comes with the next observation, and the book keeps it (`Book.positions`, `participantPerson`, `entityKind`).
 */
export const lookUp = {
  entity: (channel: string, entity: string): LookRequest => ({ channel, who: { entity } }),
  participant: (channel: string, participant: string): LookRequest => ({ channel, who: { participant } }),
  position: (channel: string, position: string): LookRequest => ({ channel, who: { position } }),
  name: (channel: string, name: string): LookRequest => ({ channel, who: { name } }),
  /** An organisation's positions of one role (the councillors of the town). */
  holders: (channel: string, entity: string, role: string): LookRequest => ({ channel, who: { entity, role } }),
};

/**
 * Going to look (docs/design/knowing.md, section 8): nobody is shown ground they are not on. A visit names places
 * (buildings, or cells of ground), at most `VISIT_MAX` in one going; it takes the looker's time (the way there and
 * back, and the world's time to look at each), and what was there comes when it ends, through the same channel:
 * `visited(obs, channel)` then has the cells just seen, and the channel keeps everything seen there, with when.
 */
export const goSee = (channel: string, places: string[]): LookRequest => ({ channel, visit: { places: places.slice(0, VISIT_MAX) } });
/** How many places one visit goes to at most (the contract's). */
export const VISIT_MAX = 16;
/** The cells a visit just found (this observation brought them), as they were when the looker was there; none otherwise. */
export function visited(obs: Observation, channel: string): SiteCell[] {
  const ch = obs.channels[channel];
  if (ch?.kind !== "sites" || !ch.fresh?.length) return [];
  const fresh = new Set(ch.fresh);
  return ch.cells.filter((c) => fresh.has(c.cell));
}

/**
 * What to ask the land register next so as to know who owns a lot: the titles to it, and then the dealings in each of
 * those (each asked once; `asked` remembers). One search of a register is answered to a look, so at most one is
 * returned for each of the register's channels, and none for a channel already in `used` (what this look is asking
 * already): return them from a stepper's `looks`, which asks again until there is nothing more to ask. The answers
 * come with the next observation, into the same book, and `ownerOf` (behaviour/institutions.ts) reads the owner.
 */
export function ownerLooks(book: Book, asked: Asked, register: { titles: string; dealings: string }, lot: string, used: Set<string> = new Set(), most = 20): Asking[] {
  if (asked.since(`titles:${lot}`) < 0) {
    if (used.has(register.titles)) return [];
    used.add(register.titles);
    asked.first(`titles:${lot}`);
    return [ask.about(register.titles, "about.object", lot, { most })];
  }
  for (const c of book.claimsBy("object", lot)) {
    if (c.about?.kind !== "ownership" || asked.since(`dealings:${c.id}`) >= 0 || used.has(register.dealings)) continue;
    used.add(register.dealings);
    asked.first(`dealings:${c.id}`);
    return [ask.about(register.dealings, "claim", c.id, { most, oldest: true })];
  }
  return [];
}

/** How many look-ups one look carries at most (the contract's: a look names up to 16 channels). */
export const LOOKS_MAX = 16;

/**
 * The look-ups that would say for whom each of these records was written (the organisation of the position it was
 * made in, or its author's person), for those the book cannot say yet: each asked once (`asked` remembers), at most
 * a look's worth at a time. With no directory to look in (`channel` empty), none.
 */
export function whoWrote(book: Book, asked: Asked, channel: string | undefined, records: Iterable<{ author: string; in_position?: string }>): LookRequest[] {
  const out: LookRequest[] = [];
  if (!channel) return out;
  for (const r of records) {
    if (out.length >= LOOKS_MAX) break;
    if (r.author === "genesis") continue;
    if (r.in_position) {
      if (!book.positions.has(r.in_position) && asked.first(`position:${r.in_position}`)) out.push(lookUp.position(channel, r.in_position));
    } else if (!book.participantPerson.has(r.author) && asked.first(`participant:${r.author}`)) out.push(lookUp.participant(channel, r.author));
  }
  return out;
}

/** What has been asked for already, so that it is asked once: `asked.first(lot)` is true the first time only. With a
 * time, again once something newer than the last asking calls for it (`asked.since(title) < transfer.at`). */
export class Asked {
  private readonly when = new Map<string, number>();
  first(key: string, t = 0): boolean {
    if (this.when.has(key)) return false;
    this.when.set(key, t);
    return true;
  }
  /** When this was last asked (never: before any time). */
  since(key: string): number {
    return this.when.get(key) ?? -1;
  }
  again(key: string, t: number): void {
    this.when.set(key, t);
  }
}

// ------------------------------------------------------------------ acting through calls
//
// Code participants act the way every participant does (D36, P14): they say
// what they want brought about, as calls, and the resolver turns each into
// their own acts. Paying someone is money(...): the resolver asks the account's bank.

/**
 * One atomic act: lines of calls, optionally binding a name (whose id comes back in the outcome's `created`), and
 * optionally why: the rule that fired, in plain words, which goes into the log with the act (its `reasoning`).
 */
/**
 * A step: calls in one action, with its reason, what follows from its outcome (`then`), and, for a step whose content
 * depends on when it's done (a notice counting from today), how to make it again for a later moment (`redo`), should it
 * be done later than planned (a wake allows only so many actions). `planned`: when it was planned (the stepper's).
 */
export type Step = (C.Call | [string, C.Call])[] & { why?: string; then?: (o: ActOutcome) => Step[] | void; redo?: (t: number) => Step; planned?: number; /** True once the moment for it has passed (a day's work when the day's hours are over): it is then not sent, but answered as a day's work not got to, `then` told `not_done`. */ lapsed?: (t: number) => boolean };

/**
 * A day's shared work: of those here, the team that gets most done when the work is shared evenly (each does the same
 * share, so a team's hours are its size times the least time any of them has left today). Someone who's already done
 * a day's work elsewhere (a new starter, arriving from their old job) joins tomorrow.
 */
/** Records in the order they were filed: `rec.9` before `rec.10` (a string comparison puts `rec.1000` before `rec.999`, so the
 * order of two papers turned on how many records the town had made, and a town and its twin with a few more papers of
 * no effect parted over it: traced at F1, 2026-10-15). Ids that are not `<name>.<n>` fall back to the text. */
export function filedBefore(a: { id: string }, b: { id: string }): number {
  const x = /^(.*?)(\d+)$/.exec(a.id), y = /^(.*?)(\d+)$/.exec(b.id);
  if (x && y && x[1] === y[1]) return Number(x[2]) - Number(y[2]);
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function team(here: string[], hoursLeft: (w: string) => number): { who: string[]; each: number } {
  const byHours = [...here].sort((a, b) => hoursLeft(b) - hoursLeft(a) || (a < b ? -1 : 1));
  let best = { who: [] as string[], each: 0 };
  byHours.forEach((w, i) => {
    const each = Math.max(0, hoursLeft(w));
    if (each * (i + 1) > best.each * best.who.length) best = { who: byHours.slice(0, i + 1), each };
  });
  return { who: best.who.sort(), each: best.each };
}

/** Out of time (a `no_time_left` refusal): whose, and how long they have left today, as the world counts it. */
export function outOfTime(res: { refusal?: { code?: string; detail?: string } }): { who?: string; left: number } | undefined {
  if (res.refusal?.code !== "no_time_left") return undefined;
  const m = /^(\S+) has (\d+) s of work left today/.exec(res.refusal.detail ?? "");
  return m ? { who: m[1]!, left: Number(m[2]) } : { left: 0 };
}

/**
 * How long a unit of work takes, as a manager learns it, worker by worker: the figure it plans with at first; once the
 * world has said a crew hasn't the time ("this needs N" each), each of them as slow as that crew turned out to be, next to
 * what we thought; and after work that went through, each a little quicker (2%) once a week, asking a little more of them,
 * until it doesn't fit. A crew takes its members' mean (what a unit takes is linear in a crew's mean skill, the
 * world's physics). Where workers differ (skill), a plan on the figure alone asks a slow crew for more than its day
 * holds, again and again, and a quick one for less than it could do.
 */
export class Pace {
  private readonly known = new Map<string, number>(); // worker -> seconds a unit
  private readonly asked = new Map<string, number>(); // worker -> the week we last asked more of them
  constructor(private readonly nominal: number) {}
  private of(w: string) {
    return this.known.get(w) ?? this.nominal;
  }
  perUnit(crew: string[]): number {
    return crew.length ? Math.max(1, Math.ceil(crew.reduce((a, w) => a + this.of(w), 0) / crew.length)) : Math.ceil(this.nominal);
  }
  /** Refused for time: `units` of work shared by `crew`, each needing what the refusal says. */
  refused(res: { refusal?: { code?: string; detail?: string } }, units: number, crew: string[]) {
    const m = res.refusal?.code === "no_time_left" ? /this needs (\d+)/.exec(res.refusal.detail ?? "") : null;
    if (!m || units <= 0 || !crew.length) return;
    const ratio = (Number(m[1]) * crew.length) / units / (crew.reduce((a, w) => a + this.of(w), 0) / crew.length);
    if (ratio > 1) for (const w of crew) this.known.set(w, this.of(w) * ratio);
  }
  /** Done in the time we gave it (on day `day`): perhaps they're quicker than we think. Once a week each. */
  done(crew: string[], day: number) {
    const week = Math.floor(day / 7);
    for (const w of crew) if (this.asked.get(w) !== week) {
      this.asked.set(w, week);
      this.known.set(w, this.of(w) * 0.98);
    }
  }
}

/** The next time of day `at` (seconds) on a working day (the first `days` of each week), after `t`: when an employer whose
 * staff come in for the working day looks at the day's work (world-expansion 6.3). */
export function nextLook(t: number, at: number, days: number): number {
  for (let d = Math.floor(t / DAY); ; d++) if (d % 7 < days && d * DAY + at > t) return d * DAY + at;
}

/** A space nobody lives in any more, as someone looking in from outside can tell: nobody there, and nobody in or out of
 * it for a day. (Where people share a home, one of them comes or goes within a day, and it is theirs to say that
 * someone of the home has died: docs/behaviour/deaths.md.) */
export const stoodEmpty = (sp: { occupants?: string[]; left?: { at: number }[] }, t: number): boolean =>
  (sp.occupants ?? []).length === 0 && (sp.left ?? []).every((l) => l.at <= t - DAY);

/** A step with its reason: `because("Rent is due", pay(...))`. */
export const because = (why: string, ...lines: (C.Call | [string, C.Call])[]): Step => Object.assign(lines, { why });

export const callAction = (step: Step): ParticipantAction => {
  const program = C.programOf(...step);
  const action = { type: "call" as const, call: C.programText(program), ...(step.why ? { reasoning: step.why } : {}) };
  return Object.defineProperty(action, C.PARSED, { value: program, enumerable: false });
};

/**
 * Letters to an office. Each is answered once, with the office's standard report: what a real office sends when
 * asked. The report is the office's own figures, composed by code (a code office can't read a letter, so it
 * answers every one the same way). Office reports aren't answered, so offices never write to each other forever.
 */
export class Letters {
  private pending: { id: string; from: string; as?: string; entity?: string; text: string }[] = [];
  /** `answers`: what the office says of itself after its report (the module's `answers`): that the report is what
   * every letter gets, and what the office does act on. */
  constructor(private readonly answers?: Answers) {}
  /** Letters in: all but our own, reports (answers to letters), and news of a request of ours from those we asked to
   * carry it out (a bank saying a payment we asked for wasn't made), which isn't a question. A letter about anything
   * else is (pilot 10: a mayor asking the bank about an invoice, by its id, went unanswered). */
  take(obs: Observation, book: Book) {
    const newsOfOurRequest = (m: Observation["inbox"][number]) => {
      const r = m.re ? book.records.get(m.re) : undefined;
      if (r?.record !== "statement" || r.kind !== "request" || r.speaks_for !== obs.entity) return false;
      const sender = m.from_entity ?? (m.as ? book.positions.get(m.as)?.entity : book.participantPerson.get(m.from));
      return !!sender && (r.addressed_to ?? []).includes(sender);
    };
    for (const m of obs.inbox) if (m.from !== obs.participant && !officeNote(m.text) && !newsOfOurRequest(m)) this.pending.push({ id: m.id, from: m.from, ...(m.as ? { as: m.as } : {}), ...(m.from_entity ? { entity: m.from_entity } : {}), text: m.text });
  }
  /** Each letter answered with the report (which may depend on who wrote: the participant, the position it wrote in,
   * and whom it wrote for, which a letter says of itself). */
  answer(report: (from: { participant: string; as?: string; entity?: string }) => string, why = "A letter to our office: answering with our standard report."): Step[] {
    const out = this.pending.map((m) => because(why, message([m.from], `${report({ participant: m.from, as: m.as, entity: m.entity })}${this.answers ? ` ${REPORT_TAIL} ${whatItActsOn(this.answers, m.text)}` : ""}`, m.id)));
    this.pending = [];
    return out;
  }
}

/**
 * A letter that is another office's notice, report or acknowledgement, in the fixed words offices write: not a
 * question, and never answered (so that offices do not write to each other for ever). A person's letter is anything
 * else.
 */
export const officeNote = (text: string): boolean =>
  /^(Report from |From [^:]{1,80}: your |Payroll notice from the hiring office, )/.test(text) || PAYMENT_FAILED.is(text) || PAYEE_DIED.who(text) !== undefined ||
  /^(Request \S+ not carried out: |Payment of .+ couldn't be made: |Hold \S+ (is in place|does not apply|is not in place)|Withdrawal \S+ (is not acted on|does not apply))/.test(text);

/** What an office with a standing report says after it. */
export const REPORT_TAIL = "That is this office's standing report, sent in answer to any letter: it does not act on a letter's words.";

/** What an office acts on and how, in its own fixed words; and, where the letter plainly concerns something it has a
 * form or a set way for, what it says of that. */
export function whatItActsOn(a: Answers, letter: string): string {
  const said = letter.toLowerCase();
  const hints = (a.forms ?? []).filter((f) => f.about.some((w) => said.includes(w))).map((f) => f.say);
  return [a.acts, ...hints].join(" ");
}

/** The acknowledgement an office with no report of its own sends. */
export const acknowledged = (a: Answers, letter: string): string => `From ${a.office}: your letter is received. This office does not act on a letter's words. ${whatItActsOn(a, letter)}`;

/**
 * A module whose office acknowledges its letters (docs/behaviour/letters.md): one that says how it answers (`answers`)
 * and has no standing report of its own. Each letter that is not another office's note is answered once, when the
 * office has done its own work for the wake: that it is received, that the office does not act on a letter, and what
 * it does act on. The module itself is untouched: it never sees that the letters were answered.
 */
export function answering<M extends BehaviourModule>(m: M): M {
  const a = m.answers;
  if (!a || a.report) return m;
  return { ...m, create(ctx: ParticipantContext) {
    const inner = m.create(ctx);
    const step = inner.step.bind(inner);
    let letters: { id: string; from: string; text: string }[] = [];
    let then: ParticipantAction | undefined; // what the module answered when we acknowledged in its place: given next
    inner.step = (obs, x) => {
      if (then) {
        const waited = then;
        then = undefined;
        return waited;
      }
      for (const l of obs.inbox) if (l.from !== obs.participant && !officeNote(l.text)) letters.push({ id: l.id, from: l.from, text: l.text });
      const act = step(obs, x);
      if (!letters.length || act instanceof Promise || act.type !== "wait") return act;
      then = act;
      return callAction(because(`Letters to ${a.office}: acknowledging each, and saying what the office acts on.`, ...letters.splice(0, 16).map((l) => message([l.from], acknowledged(a, l.text), l.id))));
    };
    return inner;
  } };
}

/**
 * The written directions an office takes (docs/behaviour/directions.md). An office works to written procedures and to
 * directions from whoever it answers to: here, a direction is a statement of kind `direction` filed on the office's
 * own form for it (the form is its basis), addressed to the office's organisation. Who may direct the office is the
 * organisation's own rule, a record (`under`: a procedure, say, whose data names the posts: `directions.by`, or for
 * one office `directions.offices[office]`); a direction made in any other post is not followed, and its writer is
 * told so in a letter, once, that says nothing but what the rule itself says. The direction that stands is the latest
 * one not withdrawn; the office follows it, or (below its `compliance_bps`) does not, as it follows any procedure.
 */
export class Directions {
  private readonly answered = new Set<string>();
  private readonly acknowledged = new Set<string>();
  /** The office these directions are to: the post itself, or, for its staff's post, the office whose staff they are.
   * (Until 2026-10-11 a staff post looked for directions to "works-staff", and the forms and the town's rule name
   * "works": no direction ever reached the staff of an office a model held.) */
  private readonly office: string | undefined;
  constructor(private readonly ctx: ParticipantContext, private readonly o: { under: string; compliance_bps?: number; office_words: string }) {
    this.office = ctx.position?.replace(/-staff$/, "");
  }

  /** The posts that may direct this office, by the organisation's rule as it stands (none: it has no such rule, or the rule is withdrawn). */
  private may(book: Book): string[] {
    const rule = this.o.under ? book.current(this.o.under) : undefined;
    const d = rule?.record === "statement" ? (rule.data?.directions as { by?: unknown; offices?: { [office: string]: unknown } } | undefined) : undefined;
    const posts = (this.office && d?.offices?.[this.office]) ?? d?.by;
    return Array.isArray(posts) ? posts.filter((x): x is string => typeof x === "string") : [];
  }

  /** The directions filed on our form `form` that still stand, oldest first. */
  private filed(book: Book, form?: string): StatementRecord[] {
    const office = this.office;
    return book.standingOf("direction").filter((d) => (d.addressed_to ?? []).includes(this.ctx.entity) && basesOf(d).some((b) => {
      const f = book.records.get(b);
      return f?.record === "statement" && f.kind === "form" && f.data?.office === office && (form === undefined || f.data?.form === form);
    })).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  }

  /** The direction in force on a form: the latest standing one from a post that may direct us, if we follow it. */
  standing(book: Book, form: string): StatementRecord | undefined {
    const may = this.may(book);
    // (A direction its giver has put on hold is not followed while the hold stands: the one before it is not
    // revived; the office goes by its own practice.)
    const d = this.filed(book, form).filter((x) => x.in_position !== undefined && may.includes(x.in_position)).at(-1);
    if (!d || book.onHold(d.id)) return undefined;
    return this.ctx.rng(`direction-${d.id}`).below(10_000) < (this.o.compliance_bps ?? 10_000) ? d : undefined;
  }

  /**
   * Letters about directions newly received, one to each writer, once: to one who may direct us, that we have it and
   * what we will do while it stands (`doing`: in the office's words, by form); to anyone else, that it is not
   * followed, and the rule that says whose directions are.
   */
  letters(book: Book, doing: (d: StatementRecord, form: string) => string): Step[] {
    const may = this.may(book);
    const steps: Step[] = [];
    for (const d of this.filed(book)) {
      if (this.answered.has(d.id) || this.acknowledged.has(d.id) || d.author === this.ctx.participant) continue;
      const form = basesOf(d).map((b) => book.records.get(b)).find((f) => f?.record === "statement" && f.kind === "form") as StatementRecord | undefined;
      if (d.in_position !== undefined && may.includes(d.in_position)) {
        this.acknowledged.add(d.id);
        steps.push(because(`A direction from ${d.in_position} on our ${String(form?.data?.form ?? "form").replace(/_/g, " ")} form: acknowledging it.`,
          message([d.author], `From ${this.o.office_words}: your direction ${d.id} is received. ${doing(d, String(form?.data?.form ?? ""))} It stands until you replace or withdraw it.`, d.id)));
      } else {
        this.answered.add(d.id);
        steps.push(because(`A direction (${d.id}) from someone our rules don't say may direct us: not following it, and saying so.`,
          message([d.author], `From ${this.o.office_words}: your direction ${d.id} is not being followed. ${this.o.under && may.length ? `This office takes directions on its forms only from those ${this.o.under} names.` : "No rule of this organisation's says who may direct this office."}`, d.id)));
      }
    }
    return steps;
  }
}

/** A standing work order as the staff read it (contracts/calls.md, a standing work order). */
/** (`every`: nought where the order names the paper that sets when, `schedule`, in place of a rhythm.) */
export interface WorkOrder { id: string; task: string; at?: string; on?: string[]; by?: string[]; units?: number; every: number; schedule?: string; from: number; until?: number }

/**
 * Standing work (docs/behaviour/standing-work.md). An office's routine work is its staff's: they follow the
 * organisation's standing work orders (statements of kind `work_order` on its own file: what task, where, how often,
 * and perhaps on what, by whom, from when and until when), each time one falls due, in their own hours, until it is
 * replaced, withdrawn or put on hold. Which part of an office a participant does is its `part`:
 *  - "" (the whole office, as code runs one): it does its routine by its own practice, with no order;
 *  - "seat" (the office-holder alone, where a model holds the office and its staff are a post of their own): it
 *    makes the standing orders and does none of the routine;
 *  - "staff" (the office's staff): they do the routine a standing order in force is for, and nothing else of the
 *    office's business.
 */
export class StandingWork {
  private readonly made = new Set<string>();
  /** `offices`: the posts whose orders are ours, where more than one office speaks for the same organisation (the town's
   * works office and its registry both do, and both have a standing order for `answer`): an order made in another post is
   * not ours. Not given: every order of the organisation's is. */
  constructor(private readonly me: string, readonly part: "" | "seat" | "staff", private readonly offices?: ReadonlySet<string>) {}

  /** The organisation's standing work orders that are ours (made by it, in one of our posts, where those are named). */
  private orders(book: Book): StatementRecord[] {
    return book.standingOf("work_order").filter((x) => x.speaks_for === this.me && (!this.offices || x.in_position === undefined || this.offices.has(x.in_position)));
  }

  /** The standing order in force for a task: our latest one standing for it, begun, not ended, and not on hold. */
  order(book: Book, task: string, t: number): WorkOrder | undefined {
    const r = this.orders(book).filter((x) => x.data?.work?.task === task).reduce<StatementRecord | undefined>((a, b) => (!a || b.at >= a.at ? b : a), undefined);
    if (!r) return undefined;
    const d = r.data ?? {};
    const from = firstDue(r, 0);
    const schedule = typeof d.schedule === "string" && d.schedule ? d.schedule : undefined;
    if ((schedule === undefined && (!Number.isSafeInteger(d.every) || d.every <= 0)) || t < from || (Number.isSafeInteger(d.until) && t >= d.until)) return undefined;
    if (book.onHold(r.id, [this.me])) return undefined;
    const list = (x: unknown) => (Array.isArray(x) && x.every((y) => typeof y === "string") ? (x as string[]) : undefined);
    const w = d.work;
    return { id: r.id, task, every: schedule === undefined ? d.every : 0, ...(schedule !== undefined ? { schedule } : {}), from, ...(typeof w.at === "string" ? { at: w.at } : {}), ...(list(w.on) ? { on: list(w.on)! } : {}), ...(list(w.by) ? { by: list(w.by)! } : {}),
      ...(Number.isSafeInteger(w.units) ? { units: w.units } : {}), ...(Number.isSafeInteger(d.until) ? { until: d.until } : {}) };
  }

  /**
   * Whether this participant does a routine task now, and by what: the whole office by its own practice (`own`: how
   * often); the staff by the order in force (none: they don't); the office-holder never.
   */
  does(book: Book, task: string, t: number, own: { every: number }): { every: number; order?: WorkOrder } | undefined {
    if (this.part === "seat") return undefined;
    if (this.part === "") return own;
    const order = this.order(book, task, t);
    // (An order that names the paper that sets when, in place of a rhythm: the staff's own practice keeps the time.)
    return order ? { every: order.every || own.every, order } : undefined;
  }

  /** For the office-holder: a standing order for each routine that has none on file, made once (what it does after
   * that, replacing one, holding it, is managing by exception). */
  set(book: Book, routines: { task: string; at: string; every: number; why: string }[]): Step[] {
    if (this.part !== "seat") return [];
    const steps: Step[] = [];
    for (const r of routines) {
      if (this.made.has(r.task)) continue;
      this.made.add(r.task);
      if (book.all("work_order").some((x) => x.speaks_for === this.me && x.data?.work?.task === r.task)) continue;
      steps.push(because(r.why, C.call("work", { task: r.task, at: r.at, every: C.secs(r.every) })));
    }
    return steps;
  }

  /** The standing orders of ours that stand, in words, for a report. */
  words(book: Book, t: number): string {
    const all = this.orders(book);
    return all.length ? all.map((x) => `${x.id} (${x.data?.work?.task} ${typeof x.data?.schedule === "string" ? `as ${x.data.schedule} sets` : `every ${Math.round(Number(x.data?.every) / DAY)} days`}${this.order(book, String(x.data?.work?.task), t)?.id === x.id ? "" : ", not in force"})`).join(", ") : "none";
  }

  // ---- the staff's report to their office (docs/behaviour/standing-work.md, "The staff's report"). The staff keep
  // their own count of what they did under each order, and of why an order in force was not carried out when it fell
  // due; they report it to whoever holds the office, on the organisation's own file: at once when how an order stands
  // has changed, and each week otherwise. Nothing is asked of the engine: it is what they did and what they found.
  private readonly count = new Map<string, { times: number; units: number }>(); // task -> done since the last report
  private readonly stuck = new Map<string, string>(); // task -> why it was not done, since the staff last took stock
  private readonly said = new Map<string, string>(); // task -> how it stands beyond the count (what is left, what is next)
  private readonly lastAt = new Map<string, { at: number; task: string }>(); // person -> when they last worked under an order
  private reported: { at: number; key: string } | undefined;

  /** The staff did a task under its order: once more, so many units, by whom. */
  did(task: string, t: number, o: { units?: number; by?: string[] } = {}): void {
    if (this.part !== "staff") return;
    const c = this.count.get(task) ?? { times: 0, units: 0 };
    this.count.set(task, { times: c.times + 1, units: c.units + (o.units ?? 0) });
    this.stuck.delete(task);
    for (const w of o.by ?? []) this.lastAt.set(w, { at: t, task });
  }

  /** What was counted as done turned out not to be (the act was refused): taken back. */
  undid(task: string, o: { units?: number } = {}): void {
    const c = this.count.get(task);
    if (c) this.count.set(task, { times: Math.max(0, c.times - 1), units: Math.max(0, c.units - (o.units ?? 0)) });
  }

  /** A task whose order is in force could not be done when it fell due, and why, as the staff would tell it. */
  heldUp(task: string, why: string): void {
    if (this.part === "staff") this.stuck.set(task, why);
  }

  /** How a task stands beyond the count, for the report (what was left undone, when it next falls due); none: nothing to add. */
  note(task: string, text?: string): void {
    if (text) this.said.set(task, text);
    else this.said.delete(task);
  }

  /**
   * The staff's report, when one is due: called when the staff have taken stock of a working day (what they did, or
   * why not). `office`: the post whose staff they are; `from`: what they are called in the report's words; `tasks`:
   * the routines they have, each with what its count is of ("calls", "loads"); `inPost` and `noPlace`: where the
   * staff are people, who is in post, and who of them has no place of work in their agreement or its advertisement.
   * With nobody in post there is nobody to report (the office-holder's own roster says so).
   */
  report(book: Book, t: number, o: { office: string; from: string; tasks: { [task: string]: [times: string, units?: string] }; inPost?: string[]; noPlace?: string[]; every?: number }): Step[] {
    if (this.part !== "staff" || (o.inPost && !o.inPost.length)) return [];
    const dated = (x: number) => `year ${Math.floor(x / (365 * DAY)) + 1}, day ${Math.floor((x % (365 * DAY)) / DAY) + 1}`;
    const named = Object.keys(o.tasks);
    const all = this.orders(book).filter((x) => x.in_position === o.office || named.includes(String(x.data?.work?.task))).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    // A routine of theirs with no standing order on file: they are not doing it, and they say so (from their second
    // working day: an office opens with its orders still to make). Until 2026-10-11 the staff reported only on orders
    // that existed, so an office-holder who made none heard nothing: a clerk's drafters wrote no amendment into law
    // in 400 days and a works crew collected nothing in 45, each without a word (wave 2c's review, fault 1).
    const unordered = t >= DAY ? named.filter((task) => !all.some((x) => String(x.data?.work?.task) === task)) : [];
    if (!all.length && !unordered.length) return [];
    const none = unordered.map((task) => {
      const more = this.said.get(task);
      return { task, every: 0, state: "no_order", words: `not being done: no standing work order for ${task} is on file, and with none the staff do not do it (whoever holds the office makes one)${more ? `; ${more}` : ""}` };
    });
    const orders: { order?: string; task: string; every: number; schedule?: string; state: string; why?: string; times?: number; units?: number; words: string }[] = all.map((r) => {
      const task = String(r.data?.work?.task);
      const every = Number(r.data?.every) || 0;
      const head = { order: r.id, task, every, ...(typeof r.data?.schedule === "string" ? { schedule: r.data.schedule as string } : {}) };
      if (!named.includes(task)) return { ...head, state: "no_such_task", words: `not carried out: the staff have no routine called "${task}" (their routines: ${named.join(", ")})` };
      const latest = all.filter((x) => String(x.data?.work?.task) === task).reduce((a, b) => (b.at >= a.at ? b : a));
      if (latest.id !== r.id) return { ...head, state: "replaced", words: `replaced by ${latest.id}` };
      const from = r.at + (Number.isSafeInteger(r.data?.first) ? (r.data!.first as number) : 0);
      if (book.onHold(r.id, [this.me])) return { ...head, state: "on_hold", words: "on hold: not carried out while the hold stands" };
      if (t < from) return { ...head, state: "not_begun", words: `begins ${dated(from)}` };
      if (Number.isSafeInteger(r.data?.until) && t >= (r.data!.until as number)) return { ...head, state: "ended", words: `ended ${dated(r.data!.until as number)}` };
      const c = this.count.get(task), why = this.stuck.get(task), more = this.said.get(task);
      const [times, units] = o.tasks[task]!;
      if (why !== undefined && !c?.times) return { ...head, state: "not_carried_out", why, words: `not carried out: ${why}${more ? `; ${more}` : ""}` };
      return { ...head, state: "followed", ...(c ? { times: c.times, units: c.units } : {}),
        words: `${c?.times ? `carried out: ${c.times} ${times}${units && c.units ? `, ${c.units} ${units}` : ""}` : "in force; nothing fell due"}${why !== undefined ? `; then not carried out: ${why}` : ""}${more ? `; ${more}` : ""}` };
    });
    // (How the orders stand, apart from the counts: a change in it is reported the day it is found.)
    orders.push(...none);
    const key = orders.map((x) => `${x.order ?? x.task}:${x.state}:${"why" in x ? x.why : ""}`).join("|");
    const last = this.reported;
    this.stuck.clear();
    const due = !last || (key !== last.key ? Math.floor(t / DAY) > Math.floor(last.at / DAY) : t - last.at >= (o.every ?? 7 * DAY) - DAY / 2);
    if (!due) return [];
    const since = last?.at;
    this.reported = { at: t, key };
    this.count.clear();
    const staff = (o.inPost ?? []).map((person) => ({ person, ...(this.lastAt.has(person) ? { last: this.lastAt.get(person)!.at, task: this.lastAt.get(person)!.task } : {}), ...(o.noPlace?.includes(person) ? { no_place: true } : {}) }));
    const people = staff.length ? ` In post ${staff.length}: ${staff.map((x) => `${x.person} ${"last" in x ? `last worked ${dated(x.last!)} (${x.task})` : `has not come in to work${x.no_place ? " (no place of work in the employment agreement or the advertisement it cites)" : ""}`}`).join("; ")}.` : "";
    const text = `Report of ${o.from}, ${dated(t)}, on the work under the office's standing work orders${since !== undefined ? ` since ${dated(since)}` : ""}. ${orders.map((x) => (x.order === undefined ? `${x.task}: ${x.words}` : `${x.task} (${x.order}, ${"schedule" in x && x.schedule ? `as ${x.schedule} sets` : `every ${Math.round(x.every / DAY) || "?"} day${Math.round(x.every / DAY) === 1 ? "" : "s"}`}): ${x.words}`)).join(". ")}.${people}`;
    return [because(`Reporting to the office on the work under its standing orders${last && key !== last.key ? ": how an order stands has changed" : ""}.`,
      say("staff_report", text, { to: [this.me], visible: [this.me], data: { office: o.office, ...(since !== undefined ? { since } : {}), orders: orders.map(({ words, ...x }) => ({ ...x, says: words })), ...(staff.length ? { staff } : {}) } }))];
  }
}

/**
 * An office's counter (docs/behaviour/standing-work.md, "The counter"): the routine post its staff sort and answer under
 * the office's procedure, so that the office-holder is not brought back for it. `offered`: the town gives the office a
 * counter (its module's `answer` routine, which a world offers only to a living town); where it is not offered every part
 * does this work as it always did. Offered: the whole office does it as ever; the office-holder never; the staff only
 * while a standing work order for `answer` is in force. They count what they answer by kind, for their report.
 */
export class CounterWork {
  static readonly TASK = "answer";
  private readonly tally = new Map<string, number>(); // kind -> answered since the staff last reported
  private today = 0;
  constructor(private readonly routines: StandingWork, readonly offered: boolean) {}

  /** Whether this part answers the counter's papers now. */
  works(book: Book, t: number): boolean {
    if (!this.offered || this.routines.part === "") return true;
    return this.routines.part === "staff" && !!this.routines.order(book, CounterWork.TASK, t);
  }

  /** One paper of a kind answered at the counter. */
  answered(kind: string): void {
    if (!this.offered || this.routines.part !== "staff") return;
    this.tally.set(kind, (this.tally.get(kind) ?? 0) + 1);
    this.today++;
  }

  /** The day's counter work done: counted under the order, and what was answered, by kind, said in their report. */
  flush(t: number): void {
    if (!this.offered || this.routines.part !== "staff") return;
    if (this.today) this.routines.did(CounterWork.TASK, t, { units: this.today });
    this.today = 0;
    const kinds = [...this.tally].sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}${n === 1 ? "" : "s"}`);
    this.routines.note(CounterWork.TASK, kinds.length ? `answered at the counter: ${kinds.join(", ")}` : undefined);
  }

  /** The staff's report went out: the count starts again. */
  reported(steps: Step[]): void {
    if (steps.length) { this.tally.clear(); this.routines.note(CounterWork.TASK, undefined); }
  }

  /** The routine the staff report on (its label for the count), where a counter is offered. */
  get tasks(): { [task: string]: [string, string?] } {
    return this.offered ? { [CounterWork.TASK]: ["days of counter work", "papers answered"] } : {};
  }

  /** The seat sets its standing order for the counter, once (with its other orders). */
  order(at: string): { task: string; at: string; every: number; why: string }[] {
    return this.offered ? [{ task: CounterWork.TASK, at, every: DAY, why: "Setting the counter: the routine post the office's procedure lists is answered by the staff, as a standing work order." }] : [];
  }
}

/**
 * What a bank's payment system writes to an account holder when a payment it was asked to make wasn't made for want of
 * money (docs/behaviour/bank-payment-system.md), and how whoever is told knows it for that: a code participant
 * understands only this phrasing (a tenant's missed rent: docs/behaviour/citizen.md). The words are here, once, so the
 * bank and its readers can't drift apart; `amount` is as the bank words it.
 */
export const PAYMENT_FAILED = {
  note: (amount: string, to: string, request: string) => `Payment of ${amount} to ${to} (request ${request}) failed: insufficient funds.`,
  is: (text: string) => /^Payment of .+ to \S+ \(request \S+\) failed: insufficient funds\.$/.test(text),
};

/**
 * What a bank writes, once, to whoever has a standing order paying into the account of someone it has been told has
 * died (docs/behaviour/deaths.md): how an employer, who is on no register and is told by no registry, comes to know
 * that the person it pays has died. The words are here, once, so the bank and its readers can't drift apart.
 */
export const PAYEE_DIED = {
  note: (holder: string, to: string, request: string) => `Your payments to ${to} (request ${request}): the account's holder, ${holder}, has died. They go to the estate until you stop them.`,
  who: (text: string): string | undefined => /^Your payments to \S+ \(request \S+\): the account's holder, (\S+), has died\./.exec(text)?.[1],
};

/** An amount in words, for reasons and letters, as the world writes its money (money.ts). */
export const usd = moneyNow;

/**
 * A rates bill is one thing on two papers (docs/behaviour/government.md, "One bill, two papers"): the city's notice to
 * the owner (a `rates_notice` letter) and the right it records against them (a `claim` of kind rates), made together,
 * with the same sum and due day. The notices that go with a rates claim.
 */
export function noticesOf(book: Book, claim: any): any[] {
  if (claim?.about?.kind !== "rates") return [];
  return book.all("rates_notice").filter((n: any) => (n.addressed_to ?? []).includes(claim.counterparty) && n.data?.due === claim.about?.due && Number(n.data?.amount) === Number(claim.about?.amount));
}

/** Is a debt recorded against someone settled by what has been paid? A payment that names the claim, or, for a rates
 * claim, the notice that goes with it, settles the bill however many papers mention it. */
export function billSettled(book: Book, claim: any, settled: ReadonlySet<string>): boolean {
  return settled.has(claim.id) || noticesOf(book, claim).some((n: any) => settled.has(n.id));
}

/** Money to an account: a one-off or repeating payment. */
export function pay(to: string, amount: number, o: { from?: string; for?: string; settles?: string; every?: number; first?: number; basis?: string; per_request?: string; line?: string } = {}): C.Call {
  return C.call("money", {
    to, amount: C.amountText(amount), from: o.from, for: o.for ? C.text(o.for) : undefined, settles: o.settles,
    every: o.every ? C.secs(o.every) : undefined, first: o.first !== undefined ? C.secs(o.first) : undefined, basis: o.basis, per_request: o.per_request, line: o.line,
  });
}

/** A published statement: kind, text, and optional addressees, data, visibility and basis. */
export function say(kind: string, text: string, o: { to?: string[]; data?: unknown; visible?: "public" | string[]; basis?: string; for?: string; adico?: unknown; formal?: string; on?: string; offer?: Offer; practice?: Practice; assertion?: Assertion; registry?: Registry } = {}): C.Call {
  return C.call("statement", {
    kind, text: C.text(text), to: o.to ? C.json(o.to) : undefined, data: o.data !== undefined ? C.json(o.data) : undefined,
    adico: o.adico !== undefined ? C.json(o.adico) : undefined, formal: o.formal ? C.text(o.formal) : undefined,
    offer: o.offer !== undefined ? C.json(o.offer) : undefined, practice: o.practice !== undefined ? C.json(o.practice) : undefined,
    assertion: o.assertion !== undefined ? C.json(o.assertion) : undefined, registry: o.registry !== undefined ? C.json(o.registry) : undefined,
    visible: o.visible === undefined ? undefined : o.visible === "public" ? "public" : C.json(o.visible), basis: o.basis, for: o.for, on: o.on,
  });
}

export const withdraw = (record: string, text?: string): C.Call => C.call("statement", { withdraw: record, text: text ? C.text(text) : undefined });
export const sign = (agreement: string): C.Call => C.call("agreement", { sign: agreement });
export const notice = (agreement: string, text: string): C.Call => C.call("agreement", { notice: agreement, text: C.text(text) });
export const message = (to: string[], text: string, re?: string): C.Call => C.call("message", { to: C.json(to), text: C.text(text), re });
/** Go into a space (a home, a workplace floor). */
export const moveIn = (space: string): C.Call => C.call("occupancy", { in: space });
/** Come out of a space, or a whole building. */
export const moveOut = (from: string, who: string): C.Call => C.call("occupancy", { in: from, who, leave: "yes" });
/** `visible`: public, or only to these (a secret ballot: the electoral office). */
export const vote = (ballot: string, choice: string, visible?: "public" | string[]): C.Call => C.call("vote", { ballot, choice, visible: Array.isArray(visible) ? C.json(visible) : visible });
export const record = (position: "right" | "liberty", holder: string, about: unknown, o: { against?: string; basis?: string } = {}): C.Call =>
  C.call("claim", { position, holder, about: C.json(about), against: o.against, basis: o.basis });

/** Offer an agreement (signed on our side). `we` and `they` are the outcomes each side commits to. */
export function offer(withWhom: string, o: { template: string; we?: C.Call; they?: C.Call; term?: number; then?: "periodic"; ourNotice?: number; theirNotice?: number; text?: string; basis?: string; /** An employment's ordinary hours in a week (seconds): the agreement's hours term. */ hours?: number }): C.Call {
  return C.call("agreement", {
    with: withWhom, template: o.template, we_do: o.we, they_do: o.they, hours: o.hours ? C.secs(o.hours) : undefined, term: o.term ? C.secs(o.term) : undefined, then: o.then,
    our_notice: o.ourNotice ? C.secs(o.ourNotice) : undefined, their_notice: o.theirNotice ? C.secs(o.theirNotice) : undefined,
    terms: o.text ? C.text(o.text) : undefined, basis: o.basis,
  });
}

// ------------------------------------------------------------------ reading agreements (the standard encoding, §9.2)

export type Outcome = { work?: { task: string; at?: string; hours?: number }; money?: { from?: string; to: string; amount: number; for?: string }; goods?: { kind: string; quantity: string; to: string; at: string; from?: string }; occupancy?: { who: string; in: string; leave?: boolean }; structure?: { type?: string; on?: string; remove?: string } };

/** The structure a space is in (`apts-3/dwelling.2` -> `apts-3`). */
export const structureOf = (space: string) => space.split("/")[0]!;

/** What a party commits to bring about in an agreement, and how often. */
export function commitmentOf(a: Record | undefined, who: string): { outcome?: Outcome; every?: number } {
  if (a?.record !== "agreement") return {};
  const c = a.terms.commitments.find((x) => x.who === who);
  return { outcome: c?.does?.outcome, every: c?.every };
}

/** A lease's rent (paid by the tenant, into which account) and home: the space given by the other party, and its building. */
export function leaseTerms(a: Record | undefined, tenant: string): { rent: number; rentTo?: string; space?: string; structure?: string } {
  if (a?.record !== "agreement") return { rent: 0 };
  const other = a.terms.parties.find((x) => x !== tenant)!;
  const pays = commitmentOf(a, tenant).outcome?.money;
  const space = commitmentOf(a, other).outcome?.occupancy?.in;
  return { rent: cents(pays?.amount), rentTo: pays?.to, space, structure: space ? structureOf(space) : undefined };
}

/**
 * The advertisement an employment agreement was made on, where it cites one: the advertisement itself, or the
 * application that answered it (docs/behaviour/firms.md, "An offer made on an advertisement"). Read from what the
 * reader has been shown: the worker saw the advertisement when they applied, and it is the employer's own.
 */
export function advertisedJob(book: Book, a: Record | undefined): StatementRecord | undefined {
  if (a?.record !== "agreement") return undefined;
  for (const id of basesOf(a)) {
    const r = book.records.get(id);
    if (r?.record !== "statement") continue;
    if (r.kind === "job_posting") return r;
    const cited = r.kind === "job_application" && typeof r.data?.posting === "string" ? book.records.get(r.data.posting) : undefined;
    if (cited?.record === "statement" && cited.kind === "job_posting") return cited;
  }
  return undefined;
}

/**
 * A job's wage and pay period (from the employer) and workplace (the space the worker commits to be in). An offer
 * that says nothing of where the work is and was made on an advertisement is on the advertisement's terms: with the
 * reader's `book`, the workplace is then the advertised one.
 */
export function jobTerms(a: Record | undefined, worker: string, book?: Book): { wage: number; period: number; workplace?: string; /** The ordinary hours in a week the agreement states (seconds), where it states them. */ hours?: number } {
  if (a?.record !== "agreement") return { wage: 0, period: 14 * DAY };
  const employer = a.terms.parties.find((x) => x !== worker)!;
  const pays = commitmentOf(a, employer);
  // (Where the worker is to work: the place they commit to come to, or the place the work they commit to is done at.)
  const theirs = a.terms.commitments.filter((c) => c.who === worker).map((c) => c.does?.outcome);
  const stated: string | undefined = theirs.map((o) => o?.occupancy?.in).find((x) => typeof x === "string" && x) ?? theirs.map((o) => o?.work?.at).find((x) => typeof x === "string" && x);
  const advertised = stated || !book ? undefined : advertisedJob(book, a)?.data?.space;
  const hours = theirs.map((o) => o?.work?.hours).find((x) => Number.isFinite(Number(x)) && Number(x) > 0);
  return { wage: cents(pays.outcome?.money?.amount), period: pays.every ?? 14 * DAY, workplace: stated ?? (typeof advertised === "string" && advertised ? advertised : undefined), ...(hours !== undefined ? { hours: Number(hours) } : {}) };
}

export const between = (lo: number, hi: number, u: number) => lo + Math.floor(u * (hi - lo + 1));

/** A builder's published price for a kind of building, or for demolishing one (its latest price list), if it has published one. */
export function publishedPrice(book: Book, builder: string, type: string, what: "prices" | "demolition" = "prices"): number | undefined {
  const list = book.open("price_list").filter((r) => (r.speaks_for === builder || r.author === builder) && r.data?.prices).sort((a, b) => b.at - a.at)[0];
  const price = list?.data?.[what]?.[type];
  return Number.isInteger(price) ? price : undefined;
}

// ------------------------------------------------------------------ land: lots are registry records over cells

/** The cells a lot covers, from its registry record (a statement of kind "lot"). */
export function cellsOf(book: Book, lot: string): string[] {
  const r = book.records.get(lot);
  return r?.record === "statement" && r.kind === "lot" && !book.withdrawn.has(lot) ? ((r.data?.cells as string[]) ?? []) : [];
}

/** The standing lot a cell is in, if the registry has one. */
export function lotOf(book: Book, cell: string): string | undefined {
  return book.lotOver(cell)?.id;
}

/** A state variable's value today, as perceived: its value on the day seen, plus its daily change since, within its
 * bounds (docs/behaviour/services.md). */
export function variableToday(v: { value: number; as_of_day: number; per_day: number; min: number; max: number } | undefined, t: number): number | undefined {
  if (!v) return undefined;
  const days = Math.max(0, Math.floor(t / DAY) - v.as_of_day);
  return Math.min(v.max, Math.max(v.min, v.value + v.per_day * days));
}
