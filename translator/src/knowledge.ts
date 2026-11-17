// What a participant knows: everything it has observed, indexed for the resolver.
// The resolver fills gaps and turns names into ids only from this (P8): it
// never looks at the world beyond what the participant has seen.

import type { Currency, Observation, Record, SiteSpace, StatementRecord } from "@oikos/participants";

export interface AccountFact {
  account: string;
  holder: string;
  custodian: string;
}

/** A building the participant has seen: its type, corner cell and the spaces inside. */
export interface StructureFact {
  type: string;
  at: string;
  spaces: SiteSpace[];
}

/** A paper that names someone, as the participant was shown it: its id, what it is (its kind, or an agreement's
 * template), and how it names them (it speaks for them, is addressed to them, or they are a party to it). */
export interface Mention { record: string; what: string; how: "from" | "to" | "party" }
/** How many papers naming one entity are kept. */
const MENTIONS_KEPT = 3;

/** The words a referral gives for a paper's details, by name: the paper's own data where the matter is handed over as
 * written (`calls`), then what the client wants seen to (`facts.data.matter`), then its other facts. Words only; the
 * first a name is given wins. */
export function givenBy(d: any): { [field: string]: string } {
  const out: { [field: string]: string } = {};
  const add = (o: any) => { if (o && typeof o === "object" && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) if (typeof v === "string" && v && !(k in out)) out[k] = v; };
  if (typeof d?.calls === "string") { const m = /\bdata=(\{[^{}]*\})/.exec(d.calls); if (m) { try { add(JSON.parse(m[1]!)); } catch { /* not a flat object: nothing from it */ } } }
  add(d?.facts?.data?.matter);
  add(d?.facts?.data);
  add(d?.facts);
  return out;
}

/** One sitting, in seconds: turns closer together than this are one sitting (experiments/scope-pilot/funnel.ts, the same). */
export const SITTING = 3_600;

/** Ids however they are written: one, or a list in any order. */
const idList = (x: unknown): string[] => (x === undefined || x === null ? [] : (Array.isArray(x) ? x : [x]).map(String)).sort();

/** A paper as one string for "the same paper": its kind, its words, whom it goes to (a set of ids however written) and
 * its details whatever the order of their keys. Not what it cites: the same paper sent again cites the paper it was
 * (["rec.13137"] on a body's return, "rec.13137" on the record the post sent) or the return it answers ("rec.16612", as
 * the code desk sends one again). Compared as written, a returned paper sent again was never the paper that went (the
 * stakes run's 14-day check, 2026-11-17: c0352's claim and c0010's loan each sent twice from one return, a second claim
 * opened, a loan declined twice). */
export function paperKey(p: { kind?: unknown; text?: unknown; to?: unknown; data?: unknown; basis?: unknown }): string {
  const sorted = (x: unknown): unknown => (Array.isArray(x) ? x.map(sorted) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sorted((x as any)[k])])) : x);
  return JSON.stringify([String(p.kind ?? ""), String(p.text ?? ""), idList(p.to), sorted(p.data ?? null)]);
}

export class Knowledge {
  /** `currency`: how the world's money is written (its config's first currency): what the resolver reads and writes
   * amounts in. The platform has none of its own. `named`: whether the world's people and bodies have names of their
   * own (its config's `names`; docs/design/names-and-dates.md section 4): then a name the participant knows more than
   * one by is answered `ambiguous`, and one it doesn't know is "not on file". Off: the old towns' answers. */
  constructor(readonly currency: Currency, readonly named = false) {}
  /** With names on: entity -> the papers the participant has been shown that name it (the latest few, newest last). */
  readonly namedIn = new Map<string, Mention[]>();
  readonly withdrawn = new Set<string>();
  readonly accounts = new Map<string, AccountFact>(); // accounts the participant can see directly
  /** What the entity acted for holds, and where (phase B): `at|kind` -> quantity (a decimal-string integer). */
  readonly holdings = new Map<string, { kind: string; at: string; quantity: string }>();
  /** entity -> accounts it has asked to be paid into (the shared outcome language: a money outcome with no `from`, in a statement it speaks for). */
  readonly stated = new Map<string, Set<string>>();
  readonly names = new Map<string, string>(); // entity -> name
  /** participant -> the person it acts as. */
  readonly participantPerson = new Map<string, string>();
  /** position -> the organisation it acts for. */
  readonly positions = new Map<string, string>();
  /** What each post is called, as the participant has been told: its title and its role. */
  readonly positionWords = new Map<string, { title?: string; role?: string }>();
  /** Positions the participant has held (the observation lists those it holds now). */
  readonly held = new Set<string>();
  readonly structures = new Map<string, StructureFact>();
  /** Cells seen, with their terrain and whether a building stands on them. */
  readonly cells = new Map<string, { x: number; y: number; terrain?: string; built: boolean }>();
  /** Lots in a registry the participant has seen (statements of kind "lot"): lot -> its cells. */
  readonly lots = new Map<string, string[]>();
  /** Statements seen that are addressed to someone: who each is addressed to (whoever acts on it: the keeper of the
   * account a standing payment instruction is paid from, say). What a hold on one is addressed to. */
  readonly addressed = new Map<string, string[]>();
  private readonly formsById = new Map<string, StatementRecord>();
  /** Signed copies seen: a sign-off's id -> the paper it signed, as it is to go (kind, text, to, visible, data, basis).
   * What a form that sends a signed copy (`copies`) sends. */
  readonly signed = new Map<string, { [k: string]: unknown }>();
  /** A sign-off's id -> the draft it signed, of every sign-off seen (one carrying no paper too): what the preview names
   * a signed copy by, and what a seat naming a sign-off with no copy on it is told. */
  readonly signedDraft = new Map<string, string>();
  /** The matters handed to the participant (referrals): id -> whom it is handed over by (who the work is for, the
   * `client` of the assistant's papers on it). translator/src/rules.ts, `formRules`. */
  readonly referrals = new Map<string, string>();
  /** Each matter handed over's kind (its referral's `kind`), and the matters answered since (a sign-off or a decline
   * citing them): which matter a draft for sign-off that names none is on. translator/src/rules.ts. */
  readonly referralKind = new Map<string, string>();
  readonly answeredReferrals = new Set<string>();
  /** The words each matter handed over gives for a paper's details, by name (`givenBy`): what a blank on it the
   * translator filled with other words is held to (translator/src/rules.ts). */
  readonly referralGives = new Map<string, { [field: string]: string }>();
  /** The details each matter handed over sets out (its facts' names, of any type): which blanks of its paper the matter
   * gives a value for, and which it leaves to whoever writes the paper (translator/src/rules.ts, `figureOnce`). */
  readonly referralFacts = new Map<string, ReadonlySet<string>>();
  /** The words of the paper each matter handed over as a finished act carries (its call's `text=`): what a blank of the
   * paper's words is, where the request quotes none (translator/src/rules.ts, `handOverWords`). */
  readonly handedWords = new Map<string, string>();
  /** What each matter handed over as what happened gives, whole: its papers' blanks and the forms they are written on
   * (`composed_on`), for a draft of the matter's papers as handed over (the form `draft_as_handed`). */
  readonly handedFacts = new Map<string, any>();
  /** A paper of the participant's a body sent back -> the return (`paper_returned`, its `returned`): what a request to
   * send a paper again that names the paper, not the return, is about (translator/src/rules.ts). */
  readonly returnOf = new Map<string, string>();
  /** A paper a client passed on to the participant (a `forward`) -> the body's paper it holds and the matter it came on:
   * what a draft that names the forward, or the paper in it, as its matter is on (translator/src/rules.ts). */
  readonly forwards = new Map<string, { paper: string; matter?: string }>();
  /** Papers sent from a post the participant holds, as they went (the newest few hundred): what a send of a signed copy
   * that has gone already is told by (translator/src/preview.ts). */
  readonly sent: { id: string; at: number; kind: string; text: string; to: unknown; data: unknown; basis: unknown; pending?: true; act?: string }[] = [];
  /** When each signed copy it holds came (a sign-off, or a body's return): a copy goes once from it (`sentFrom`). */
  readonly signedAt = new Map<string, number>();

  /** What it has confirmed to send and is not yet on file (an act done later in the sitting's time): held as sent, so that
   * a second send of the same paper in the same sitting is told it has gone. The record replaces it when it comes. */
  sending(blocks: unknown[], at: number): void {
    const act = JSON.stringify(blocks);
    for (const b of blocks as any[]) {
      if (b?.block !== "publish" || typeof b.kind !== "string") continue;
      this.sent.push({ id: "", at, kind: b.kind, text: String(b.text ?? ""), to: b.addressed_to, data: b.data, basis: b.basis, pending: true, act });
      if (this.sent.length > 400) this.sent.shift();
    }
  }

  /** The same act, sending a paper, that it confirmed already in this sitting (a second ask for the same send, drawn
   * before the first was confirmed): the first's entry. Only the whole act, and only within the sitting (`SITTING`): the
   * same words sent again on another day, or with other goods or work beside them, are another act (a shop's second
   * delivery note for the rest of an order, the twin-seat year, 2026-11-17). */
  twice(blocks: unknown[], now: number): { id: string; at: number; pending?: true } | undefined {
    if (!(blocks as any[]).some((b) => b?.block === "publish")) return undefined;
    const act = JSON.stringify(blocks);
    return this.sent.find((x) => x.pending && x.act === act && now - x.at < SITTING);
  }

  /** The paper sent, from a post it holds, that is this one exactly (its kind, words, whom it goes to, its details and
   * what it cites), at or after `since`: the newest, confirmed or on file. */
  sentFrom(paper: { kind?: unknown; text?: unknown; to?: unknown; data?: unknown; basis?: unknown }, since: number): { id: string; at: number; pending?: true } | undefined {
    const key = paperKey(paper);
    return [...this.sent].reverse().find((x) => x.at >= since && paperKey(x) === key);
  }
  /** A paper that is a signed copy it holds (a sign-off's, or a body's return's) and has gone since the newest such copy
   * came: that copy, the paper as it went, and whether the copy is a return. A signed copy goes once, and a paper sent back
   * goes again once for each time it came back, however the send is asked for: on the form that sends a copy, or written
   * out word for word (a code desk sends a returned paper again as a statement). */
  goneAgain(paper: { kind?: unknown; text?: unknown; to?: unknown; data?: unknown; basis?: unknown }): { copy: string; went: { id: string; at: number; pending?: true }; returned: boolean } | undefined {
    const key = paperKey(paper);
    // (A copy it is: the same paper, citing what the copy cites or the copy itself, a return answered by sending again.)
    const cites = idList(paper.basis);
    const copies = [...this.signed].filter(([id, p]) => (Array.isArray((p as any).papers) ? (p as any).papers : [p]).some((x: any) => paperKey(x) === key && cites.every((c) => c === id || idList(x.basis).includes(c)))).map(([id]) => id);
    const copy = copies.sort((a, b) => (this.signedAt.get(b) ?? 0) - (this.signedAt.get(a) ?? 0))[0];
    if (!copy) return undefined;
    const went = this.sentFrom(paper, this.signedAt.get(copy) ?? 0);
    return went ? { copy, went, returned: [...this.returnOf.values()].includes(copy) } : undefined;
  }
  /** A matter handed over that is a reply to a body's paper -> that paper (its referral's `reply_to`). */
  readonly replyTo = new Map<string, string>();
  /** Laws and claims the participant has seen: what law warnings are judged against (§10). */
  readonly laws = new Map<string, StatementRecord>();
  /** Every record the participant has been shown, by id: what a request may cite (translator/src/rules.ts, `ruled`). */
  readonly records = new Set<string>();
  readonly claims: Record[] = [];
  private readonly claimIds = new Set<string>();
  private readonly directionRules = new Map<string, StatementRecord>();
  /** The posts whose written directions an office follows, by its organisation's rule as the participant has seen it
   * (the rule's id with them); undefined where it has seen no such rule, or the rule is withdrawn. */
  mayDirect(office: string): { rule: string; posts: string[] } | undefined {
    const entity = this.positions.get(office);
    for (const r of [...this.directionRules.values()].reverse()) {
      if (this.withdrawn.has(r.id) || r.speaks_for !== entity) continue;
      const d = r.data!.directions as { by?: unknown; offices?: { [office: string]: unknown } };
      const posts = d.offices?.[office] ?? d.by;
      if (Array.isArray(posts)) return { rule: r.id, posts: posts.filter((x): x is string => typeof x === "string") };
    }
    return undefined;
  }
  entity = "";
  /** Whose accounts are the participant's own (its own person; null: none, a system seat). Absent: the entity it acts
   * for, as before 2026-11-17. Set by whoever seats it, from its configuration. */
  ownHolder?: string | null;
  t = 0;
  /** The staff of the office the participant holds, where the office employs any (the run keeps it from the office's
   * own papers): what they are called and how many are in post. A draft's preview says when work is ordered of nobody. */
  ownStaff?: { role: string; inPost: number };
  private readonly jobs = new Map<string, { advertisement: string; space?: string }>();
  private readonly applications = new Map<string, string>();
  /** The job advertisement among the papers cited (itself, or through an application that answers it), as far as the
   * participant has been shown them: its id, and where it says the work is if it has seen the advertisement. */
  advertisedJob(cited: string[]): { advertisement: string; space?: string } | undefined {
    for (const id of cited) {
      const ad = this.jobs.has(id) ? id : this.applications.get(id);
      if (ad !== undefined) return this.jobs.get(ad) ?? { advertisement: ad };
    }
    return undefined;
  }

  absorb(obs: Observation): void {
    this.entity = obs.entity;
    this.t = obs.t;
    for (const p of obs.positions ?? []) {
      this.positions.set(p.position, p.entity);
      this.positionWords.set(p.position, { ...(p.title ? { title: p.title } : {}), ...(p.role ? { role: p.role } : {}) });
      this.held.add(p.position);
    }
    for (const ch of Object.values(obs.channels)) {
      if (ch.kind === "accounts") {
        for (const a of ch.accounts) {
          if (a.closed) this.accounts.delete(a.account);
          else this.accounts.set(a.account, { account: a.account, holder: a.holder, custodian: a.custodian });
        }
      } else if (ch.kind === "holdings") {
        for (const h of ch.holdings) {
          if (h.quantity === "0") this.holdings.delete(`${h.at}|${h.kind}`);
          else this.holdings.set(`${h.at}|${h.kind}`, h);
        }
      } else if (ch.kind === "sites") {
        for (const c of ch.cells) {
          this.cells.set(c.cell, { x: c.x, y: c.y, ...(c.terrain ? { terrain: c.terrain } : {}), built: !!c.structure });
          if (c.structure) this.structures.set(c.structure.structure, { type: c.structure.type, at: c.structure.at, spaces: c.structure.spaces });
        }
      } else if (ch.kind === "directory") {
        for (const e of ch.entities) {
          this.names.set(e.entity, e.name);
          if (e.participant) this.participantPerson.set(e.participant, e.entity);
        }
        for (const p of ch.positions) {
          this.positions.set(p.position, p.entity);
          this.positionWords.set(p.position, { ...(p.title ? { title: p.title } : {}), ...(p.role ? { role: p.role } : {}) });
        }
      } else if (ch.kind === "records") {
        for (const r of ch.records) this.add(r);
      }
    }
  }

  /** Agreements the participant has seen under which someone pays money: who pays what, to whom and how often. What
   * a payment that cites one is set against in its draft's preview (a wage against the pay agreed). */
  /** Who has signed each agreement it has seen signed (the maker's own signature on an offer included). */
  readonly signatures = new Map<string, Set<string>>();
  readonly agreements = new Map<string, { template?: string; parties: string[]; pays: { who: string; to?: string; amount: string; every?: number }[] }>();

  private readonly routineFacts = new Map<string, { procedure: string; every?: number; schedule?: string }>();
  private readonly procedures = new Map<string, string>();
  /** The words of a procedure that states routines, as the participant has it on file. */
  procedureText(id: string): string | undefined {
    return this.procedures.get(id);
  }
  /** A routine of the participant's office as its own procedure states it (a paper on its file: `proc-<office>-routines`):
   * the procedure, and the routine's published rhythm where it has one (how often, or the paper that sets when).
   * What a standing work order that does not say how often follows. None: no procedure it has seen names the task. */
  routine(task: string): { procedure: string; every?: number; schedule?: string } | undefined {
    const r = this.routineFacts.get(task);
    return r && !this.withdrawn.has(r.procedure) ? r : undefined;
  }

  /** The participant's own papers, as far as it has been shown them (those made in its own name, or in the name of an
   * organisation it holds a post of; agreements it or that organisation is party to): what each is, in a few words.
   * What a withdrawal's preview says it withdraws. */
  readonly papers = new Map<string, { kind: string; text: string; to?: string[]; standing?: boolean; agreement?: { template?: string; parties: string[] } }>();
  private own(e: string | undefined): boolean {
    return e !== undefined && (e === this.entity || [...this.held].some((p) => this.positions.get(p) === e));
  }

  private add(r: Record): void {
    this.records.add(r.id);
    if (r.record === "statement" && r.kind !== "form" && this.own(r.speaks_for ?? undefined)) this.papers.set(r.id, { kind: r.kind, text: r.text.length > 300 ? `${r.text.slice(0, 300)}…` : r.text, ...(r.addressed_to?.length ? { to: r.addressed_to } : {}), ...(Number.isSafeInteger(r.data?.every) && r.data.every > 0 ? { standing: true } : {}) });
    if (r.record === "agreement" && (r.terms?.parties ?? []).some((p) => this.own(p))) this.papers.set(r.id, { kind: "agreement", text: "", agreement: { ...(r.terms.template ? { template: r.terms.template } : {}), parties: r.terms.parties } });
    if (r.record === "statement" && r.kind === "procedure" && Array.isArray(r.data?.routines)) this.procedures.set(r.id, r.text);
    if (r.record === "statement" && r.kind === "procedure" && Array.isArray(r.data?.routines)) for (const x of r.data.routines as any[]) {
      if (typeof x?.task !== "string") continue;
      this.routineFacts.set(x.task, { procedure: r.id, ...(Number.isSafeInteger(x.every) && x.every > 0 ? { every: x.every } : {}), ...(typeof x.schedule === "string" && x.schedule ? { schedule: x.schedule } : {}) });
    }
    if (r.record === "agreement") {
      const pays = (r.terms?.commitments ?? []).flatMap((c) => {
        const m = c.does?.outcome?.money;
        return m && typeof m.amount === "string" && /^[0-9]+$/.test(m.amount) ? [{ who: c.who, ...(typeof m.to === "string" ? { to: m.to } : {}), amount: m.amount as string, ...(Number.isSafeInteger(c.every) && c.every! > 0 ? { every: c.every! } : {}) }] : [];
      });
      if (pays.length) this.agreements.set(r.id, { ...(r.terms.template ? { template: r.terms.template } : {}), parties: r.terms.parties ?? [], pays });
    }
    if (r.record === "signature") this.signatures.set(r.agreement, new Set([...(this.signatures.get(r.agreement) ?? []), r.as]));
    if (r.record === "withdrawal") {
      this.withdrawn.add(r.withdraws);
      this.lots.delete(r.withdraws);
    }
    if ((r.record === "claim" || r.record === "claim_release" || r.record === "withdrawal") && !this.claimIds.has(r.id)) {
      this.claimIds.add(r.id);
      this.claims.push(r);
    }
    if (r.record === "entity_declaration") this.names.set(r.entity, r.name);
    if (this.named) this.mentions(r);
    if (r.record === "statement") {
      if (r.addressed_to?.length) this.addressed.set(r.id, r.addressed_to);
      if (r.kind === "form") this.formsById.set(r.id, r);
      if (r.kind === "sign_off" && typeof r.data?.draft === "string") this.signedDraft.set(r.id, r.data.draft);
      if (r.kind === "referral" && typeof r.speaks_for === "string") this.referrals.set(r.id, r.speaks_for);
      if (r.kind === "referral" && typeof r.data?.kind === "string") this.referralKind.set(r.id, r.data.kind);
      if (r.kind === "referral") this.referralGives.set(r.id, givenBy(r.data));
      if (r.kind === "referral" && typeof r.data?.calls === "string") { const m = /\btext="((?:[^"\\]|\\.)*)"/.exec(r.data.calls); if (m) { try { this.handedWords.set(r.id, JSON.parse(`"${m[1]}"`)); } catch { /* (words that do not read: none) */ } } }
      if (r.kind === "referral" && r.data?.facts && typeof r.data.facts === "object") this.handedFacts.set(r.id, r.data.facts);
      if (r.kind === "referral" && r.data?.facts && typeof r.data.facts === "object") this.referralFacts.set(r.id, new Set(Object.keys(r.data.facts).filter((x) => x !== "composed_on")));
      if (r.kind === "referral" && typeof r.data?.reply_to === "string") this.replyTo.set(r.id, r.data.reply_to);
      if (r.kind === "paper_returned" && typeof r.data?.returned === "string") this.returnOf.set(r.data.returned, r.id);
      if (typeof r.in_position === "string" && this.held.has(r.in_position) && !this.sent.some((x) => x.id === r.id)) {
        // (The paper it confirmed, now on file: in its place.)
        const key = paperKey({ kind: r.kind, text: r.text, to: r.addressed_to, data: r.data, basis: r.basis });
        const was = this.sent.findIndex((x) => x.pending && paperKey(x) === key);
        if (was >= 0) this.sent.splice(was, 1);
        this.sent.push({ id: r.id, at: r.at, kind: String(r.kind), text: String(r.text ?? ""), to: r.addressed_to, data: r.data, basis: r.basis });
        if (this.sent.length > 400) this.sent.shift();
      }
      if (r.kind === "forward" && typeof r.data?.paper === "string") this.forwards.set(r.id, { paper: r.data.paper, ...(typeof r.data.matter === "string" ? { matter: r.data.matter } : {}) });
      if ((r.kind === "sign_off" || r.kind === "declined") && typeof r.data?.referral === "string") this.answeredReferrals.add(r.data.referral);
      // (A sign-off's copy keeps whose sign-off it is, and a paper sent back whom it was for: the copy goes in their name.
      // kernel/crates/resolver, the same.)
      if (r.kind === "sign_off" || r.kind === "paper_returned") this.signedAt.set(r.id, r.at);
      if ((r.kind === "sign_off" || r.kind === "paper_returned") && r.data?.paper && typeof r.data.paper === "object" && !Array.isArray(r.data.paper)) {
        const by = r.kind === "sign_off" ? r.speaks_for : r.data.for;
        this.signed.set(r.id, typeof by === "string" ? { ...r.data.paper, signed_by: by } : r.data.paper);
      }
      // (A sign-off of a draft of several papers: each, sent together, in the name of whoever signed it off.)
      if (r.kind === "sign_off" && Array.isArray(r.data?.papers) && r.data.papers.length) this.signed.set(r.id, { papers: r.data.papers, ...(typeof r.speaks_for === "string" ? { signed_by: r.speaks_for } : {}) });
      // Job advertisements, and the applications that answer them: an offer of employment made on one is on its terms.
      if (r.kind === "job_posting") this.jobs.set(r.id, { advertisement: r.id, ...(typeof r.data?.space === "string" && r.data.space ? { space: r.data.space } : {}) });
      if (r.kind === "job_application" && typeof r.data?.posting === "string") this.applications.set(r.id, r.data.posting);
      // An organisation's rule on who may direct its offices (a paper it has put out: its data names the posts).
      if (r.data?.directions && typeof r.data.directions === "object" && r.speaks_for) this.directionRules.set(r.id, r);
      if (r.kind === "law" && r.formal?.condition) this.laws.set(r.id, r);
      if (r.kind === "lot" && Array.isArray(r.data?.cells)) this.lots.set(r.id, r.data.cells as string[]);
      // Someone asking to be paid names where the money should go: that's where they receive money.
      const who = r.speaks_for;
      const m = r.data?.outcome?.money;
      if (who && m && typeof m.to === "string" && m.from === undefined) this.stated.set(who, new Set([...(this.stated.get(who) ?? []), m.to]));
    }
  }

  /** Whom a record names, and how, kept against each (with names on). (A lot is a plan in a register, not a paper about
   * anyone.) */
  private mentions(r: Record): void {
    const found: [string, Mention][] = [];
    if (r.record === "agreement") for (const p of r.terms?.parties ?? []) found.push([p, { record: r.id, what: r.terms?.template || "agreement", how: "party" }]);
    if (r.record === "statement" && r.kind !== "lot") {
      const what = r.kind ?? "statement";
      if (r.speaks_for) found.push([r.speaks_for, { record: r.id, what, how: "from" }]);
      for (const to of r.addressed_to ?? []) found.push([to, { record: r.id, what, how: "to" }]);
    }
    for (const [who, m] of found) {
      const kept = (this.namedIn.get(who) ?? []).filter((x) => !(x.record === m.record && x.how === m.how));
      kept.push(m);
      if (kept.length > MENTIONS_KEPT) kept.shift();
      this.namedIn.set(who, kept);
    }
  }

  /** What tells someone or something apart on the participant's own file, in words (at most three things): the post
   * it is, the papers it has been shown that name them (newest first), the accounts it knows they hold or asked to be
   * paid into, the posts it knows are theirs. Nothing it was not shown. Empty: nothing but the id. (The other
   * resolver's `known_by`, word for word.) */
  knownBy(id: string): string[] {
    const out: string[] = [];
    const w = this.positionWords.get(id);
    if (w) {
      const called = w.title || (w.role ?? "").replace(/_/g, " ");
      const org = this.positions.get(id);
      out.push(org ? `the post of ${called} at ${this.name(org)}` : `the post of ${called}`);
    }
    for (const m of [...(this.namedIn.get(id) ?? [])].reverse()) {
      const what = m.what.replace(/_/g, " ");
      const a = /^[aeiou]/.test(what) ? "an" : "a";
      out.push(m.how === "from" ? `who wrote ${m.record} (${a} ${what})` : m.how === "to" ? `to whom ${m.record} (${a} ${what}) is addressed` : `party to ${m.record} (${a} ${what})`);
    }
    const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const held = [...this.accounts.values()].filter((a) => a.holder === id).map((a) => a.account).sort(byKey);
    for (const a of held) out.push(`who holds account ${a}`);
    for (const a of [...(this.stated.get(id) ?? [])].sort(byKey)) if (this.accounts.get(a)?.holder !== id) out.push(`who asked to be paid into ${a}`);
    const posts = [...this.positions].filter(([, e]) => e === id).map(([p]) => p).sort(byKey);
    if (posts.length) out.push(`whose ${posts.length === 1 ? "post is" : "posts are"} ${posts.slice(0, 3).join(", ")}`);
    return out.slice(0, 3);
  }

  /** The entity an id refers to: a participant's person, a position's organisation, or the entity itself. */
  entityOf(id: string): string {
    return this.participantPerson.get(id) ?? this.positions.get(id) ?? id;
  }

  /** The entity acting in a capacity: a position's organisation, or (as itself) the participant's own. */
  actingFor(as?: string): string {
    return (as && this.positions.get(as)) || this.entity;
  }

  /** The building a space is in, and whether the id names a space at all (`apts-3/dwelling.2`). */
  static structureOf(space: string): string {
    return space.split("/")[0]!;
  }

  /** Accounts the participant knows to be held by an entity. */
  accountsOf(entity: string): string[] {
    const own = [...this.accounts.values()].filter((a) => a.holder === entity).map((a) => a.account);
    return [...new Set([...own, ...(this.stated.get(entity) ?? [])])].sort();
  }

  isAccount(id: string): boolean {
    return this.accounts.has(id) || [...this.stated.values()].some((s) => s.has(id));
  }

  /**
   * What a name the participant wrote refers to: the ids it could mean (one, if it's clear). In order, the first that
   * finds anything: someone or something called that; an id written out ("works" for the post works); a post by its
   * title or its role ("the works manager", "planning officer"). Tried as written, then without a leading "the", then
   * without a closing "job", "post", "position" or "office":
   * people say "the builder" and "the bank" of the one they know (2026-10-05: the strongest model, told to leave out
   * what's only described, wrote `to="the builder"`, and nothing knew who that was).
   */
  byName(name: string): string[] {
    const written = name.trim();
    const bare = written.toLowerCase().replace(/^the\s+/, "");
    // ("the planning job", "the works office": the post, said with the word for a post.)
    const post = bare.replace(/\s+(job|post|position|office)$/, "");
    for (const [n, id] of [[written.toLowerCase(), written], [bare, bare], [post, post]] as const) {
      const called = [...this.names].filter(([, v]) => v.toLowerCase() === n).map(([k]) => k).sort();
      if (called.length) return called;
      if (this.names.has(id) || this.positions.has(id) || this.participantPerson.has(id)) return [id];
      const posts = [...this.positionWords].filter(([, w]) => w.title?.toLowerCase() === n || w.role?.toLowerCase() === n || w.role?.toLowerCase().replace(/_/g, " ") === n).map(([k]) => k).sort();
      if (posts.length) return posts;
    }
    // Last, a name written without the marks it carries (Muñoz as Munoz) or with its spaces spread, only when it finds
    // exactly one: a near miss is a question, never a guess (docs/design/names-and-dates.md section 4). Never fuzzy.
    const plain = plainName(written.toLowerCase());
    const hits = plain ? [...this.names].filter(([, v]) => plainName(v.toLowerCase()) === plain).map(([k]) => k) : [];
    return hits.length === 1 ? hits : [];
  }

  name(id: string): string {
    const e = this.entityOf(id);
    const n = this.names.get(e);
    return n && n !== e ? `${n} (${e})` : e;
  }

  /** Forms the participant has seen and that still stand. */
  get forms(): StatementRecord[] {
    return [...this.formsById.values()].filter((f) => !this.withdrawn.has(f.id) && this.ours(f));
  }

  /** An office's own stationery (a form that writes a paper of that office's: contracts, FormWrites) is known to
   * whoever holds the office, and is no form of anyone else's. Every other form is whoever has seen it's. */
  private ours(f: StatementRecord): boolean {
    return !(f.data?.writes && typeof f.data?.office === "string") || this.held.has(f.data.office);
  }

  /** Where the entity holds some of a kind (phase B). */
  placesHolding(kind: string): string[] {
    return [...this.holdings.values()].filter((h) => h.kind === kind).map((h) => h.at).sort();
  }

  /** The standing form, by its name or its record's id, published by an institution a participant, position or entity id names. */
  form(to: string, name: string): StatementRecord | undefined {
    const ent = this.entityOf(to);
    const named = this.forms.filter((f) => f.data?.form === name || f.id === name);
    // One office's own form (a direction it takes, a paper it issues) is that office's: named by the office, it is
    // that one and no other of the same name.
    const offices = named.filter((f) => f.data?.office === to);
    // (Named by anything else, one office's form is found only by its organisation itself: another office of the same
    // organisation is not where it goes.)
    const whole = (f: StatementRecord) => typeof f.data?.office !== "string" || to === f.speaks_for;
    return (offices.length ? offices : named.filter((f) => whole(f) && (f.author === to || f.in_position === to || f.speaks_for === ent || (f.data?.submit_to ?? []).includes(ent))))
      .sort((a, b) => b.at - a.at)[0];
  }

  /** Whose form it is, as a call's `to` names it: the office it is one office's form of, else the post it was made
   * in, else whom it speaks for (or its author). */
  static formOf(f: StatementRecord): string {
    return (typeof f.data?.office === "string" ? f.data.office : undefined) ?? f.in_position ?? f.speaks_for ?? f.author;
  }
}

/** A name for matching without its marks and spacing: lower case, the letters that carry a mark as the plain letter
 * (NFD with the combining marks dropped; the Rust twin `plain_name` folds the Latin letters people write the same way),
 * runs of spaces as one. */
export function plainName(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/đ/g, "d").replace(/\s+/g, " ").trim();
}
