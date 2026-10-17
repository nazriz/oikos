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

export class Knowledge {
  /** `currency`: how the world's money is written (its config's first currency): what the resolver reads and writes
   * amounts in. The platform has none of its own. */
  constructor(readonly currency: Currency) {}
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
  /** Laws and claims the participant has seen: what law warnings are judged against (§10). */
  readonly laws = new Map<string, StatementRecord>();
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
    if (r.record === "statement") {
      if (r.addressed_to?.length) this.addressed.set(r.id, r.addressed_to);
      if (r.kind === "form") this.formsById.set(r.id, r);
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
