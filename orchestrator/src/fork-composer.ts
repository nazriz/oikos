// The composer and the exit accounts in an experiment (MT-22), as a pilot has them (run.ts): where the world's dial has
// a composer, the engine's actors' questions are answered as a pilot's host answers them (a piece composed, the rest
// with nothing, as an actor decides offline), a day at a time so that each is answered by its asker's next wake; and at
// a fork's end a seeded sample of the town's people give their exit accounts, each from that person's own record. The
// base carries the composer's month and every person's record to the fork point (`save`), and each fork goes on from
// there. The mock plays every composing model: an experiment calls no composing model (docs/experiments.md).

import { formatMoney, Randomness } from "@oikos/participants";
import { ACCOUNT_VERSION, ACCOUNTS_DEFAULT, COMPOSE_VERSION, ACCOUNTS_MOST, createCompose, darkAccount, mockAccount, mockCompose, MockAdapter, sampleAccounts, SpendingLimitReached, writeAccount, type AccountBrief, type AccountCounts, type ComposerConfig, type ComposeSaved, type LlmAdapter, type LlmIO } from "@oikos/participants/llm";
import { PeopleAtEndReader, type PersonAtEnd } from "./run-end";
import type { RustWorld } from "./rust-world";

const DAY = 86_400;

export interface ForkComposerSaved { compose: ComposeSaved; people: PersonAtEnd[] }

export class ForkComposer {
  private t = 0;
  private readonly composer: ReturnType<typeof createCompose>;
  private readonly people: PeopleAtEndReader;
  private readonly adapters: Map<string, LlmAdapter>;
  private readonly io: Omit<LlmIO, "adapter">;
  private readonly randomness: Randomness;
  readonly accountsN: number;

  private constructor(private readonly cfg: any, private readonly world: RustWorld, private readonly ccfg: ComposerConfig, saved?: ForkComposerSaved) {
    this.randomness = new Randomness(BigInt(cfg.seed));
    this.io = { annotate: async (a) => world.annotate(a), now: () => this.t, prices: {} };
    this.adapters = new Map(ccfg.mix.map((m) => [m.model, new MockAdapter("mock", { compose: mockCompose, account: mockAccount })]));
    this.composer = createCompose(this.io, ccfg, this.adapters, (purpose) => this.randomness.stream(["compose", purpose]), undefined, saved?.compose);
    this.people = new PeopleAtEndReader(saved?.people);
    // (run.ts: a composer allowed no pieces is asked for no accounts either, unless the world says how many.)
    this.accountsN = Math.max(0, Math.min(ACCOUNTS_MOST, ccfg.accounts ?? (ccfg.pieces_per_month > 0 ? ACCOUNTS_DEFAULT : 0)));
  }

  /** The world's composer, if its dial has one (absent: none, and nothing here is done). */
  static of(cfg: any, world: RustWorld, saved?: ForkComposerSaved): ForkComposer | undefined {
    const ccfg = cfg.dials?.composer as ComposerConfig | undefined;
    if (!ccfg) return undefined;
    for (const m of ccfg.mix ?? []) if (/astra|fable/i.test(m.model)) throw new Error(`the composer's mix names ${m.model}, which is never a composing model (docs/behaviour/founding.md)`);
    return new ForkComposer(cfg, world, ccfg, saved);
  }

  /** Said once, at the start of the base or the fork's own log (run.ts says it at a pilot's start). */
  start(): void {
    this.world.annotate({ annotation: "note", subject: "orchestrator", data: { composer: { version: COMPOSE_VERSION, ...this.ccfg, played_by: "mock" } } });
  }

  see(e: any): void {
    this.people.see(e);
  }

  /** How far the engine is asked to go before the questions are answered: a day at a time (run.ts asks the same). */
  by(t: number): number {
    return t + DAY;
  }

  /** The engine's actors' questions since last asked, answered (run.ts `answerQuestions`: those it has no service for with nothing). */
  async answer(t: number): Promise<void> {
    this.t = t;
    for (const q of this.world.questions()) {
      const subject = q.key.split("|")[0]!;
      const body = q.kind === "compose" ? ((await this.composer(q.body as any, subject).catch(() => undefined)) ?? null) : null;
      this.world.answer(q.key, [{ kind: q.kind, about: q.about, body }]);
    }
  }

  save(): ForkComposerSaved {
    return { compose: this.composer.save(), people: this.people.save() };
  }

  /** The composer's pieces, said with the fork (run.ts `composer_pieces`). */
  counts() { return { ...this.composer.counts }; }

  /**
   * The exit accounts of a seeded sample of the town's people at the fork's end (run.ts): each by one call of an author
   * shown that person's own record and nothing else. `actedOn`: those the seat's acts reached (sampled first).
   */
  async accounts(t: number, actedOn: ReadonlySet<string>, names: Map<string, string | undefined>): Promise<AccountCounts | undefined> {
    if (!this.accountsN) return undefined;
    this.t = t;
    const day = Math.floor(t / DAY);
    const currency = this.cfg.world.currencies[0];
    const counts: AccountCounts = { asked: 0, composed: 0, declined: 0, dark: 0, fell_back: 0, unread: 0, no_answer: 0, followed_up: 0 };
    const people = [...this.people.people.values()].map((p) => ({ person: p.entity, participant: p.participant, record: p.sections }));
    const agencies = people.map((p) => Number(p.record.agency?.now)).filter((x) => Number.isFinite(x));
    const mean = agencies.reduce((a, b) => a + b, 0) / Math.max(1, agencies.length);
    const sd = Math.sqrt(agencies.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, agencies.length)) || 1;
    const sample = sampleAccounts(people, this.accountsN, this.randomness.stream(["accounts", "sample"]), actedOn);
    const seen = new Set<string>();
    const named = Object.fromEntries([...names].filter(([id, name]) => name && name !== id)) as { [id: string]: string };
    for (const who of sample) {
      const p = people.find((x) => x.person === who.person)!;
      const c = p.record.circumstances ?? {};
      const brief: AccountBrief = { person: who.person, record: p.record, means: { income: formatMoney(Number(c.income ?? 0), currency), savings: formatMoney(Number(c.savings ?? 0), currency) }, days: day,
        names: named, strata: who.strata, dark: darkAccount(p.record, Number.isFinite(Number(p.record.agency?.now)) ? (Number(p.record.agency.now) - mean) / sd : 0) };
      try {
        const piece = await writeAccount(this.io, this.ccfg, this.adapters, (purpose) => this.randomness.stream(["accounts", purpose]), brief, p.participant, counts, seen);
        this.world.annotate({ annotation: "note", subject: p.participant, data: { account: { version: ACCOUNT_VERSION, played_by: "mock", person: who.person, strata: who.strata, dark: brief.dark, days: day, ...piece,
          views: ((p.record.views ?? []) as any[]).map((v) => ({ of: v.of, thought: v.private, said: v.expressed })), ...(p.record.agency ? { agency: p.record.agency.now } : {}), record_changes: this.people.people.get(who.person)!.n } } });
      } catch (e) {
        if (!(e instanceof SpendingLimitReached)) throw e;
        this.world.annotate({ annotation: "note", subject: "orchestrator", data: { accounts_cut_short: { written: counts.asked - 1, of: sample.length, why: e.message } } });
        break;
      }
    }
    this.world.annotate({ annotation: "note", subject: "orchestrator", data: { account_pieces: { ...counts, sampled: sample.length, wanted: this.accountsN, version: ACCOUNT_VERSION } } });
    return counts;
  }
}
