// Wants (docs/design/ai-citizens.md 10a, 10b): what an entity is trying to bring about, and how a want meets an
// opening. Needs say how things are; a want says what the entity means to do about it. Arithmetic and matching only:
// no model, no clock, no draw. The citizen module tells it what happened and what it can see, and acts on what
// comes back; an organisation's wants (orgwants.ts) share the shapes.
//
// No verb is listed per want. A want names what would satisfy it in the world's own typed outcomes (2c): money to
// me, money from me (less of it), occupancy, work, attend, goods; and, where a paper stands in the way (a notice, a
// rise, a debt), that paper and who made it. An opening is anything the entity can see, reduced to what taking it up
// would bring in the same terms. A want and an opening meet when the opening brings what the want seeks.
//
// Every size is a parameter (`wants`, docs/behaviour/citizen.md "Wants and initiative"). Unless that table names a
// source, a size is a PLACEHOLDER. Basis points throughout, so a record is whole numbers.


/** What a want seeks, as a typed outcome of 2c seen from the one who wants it. */
export type SeekKey = "money.to" | "money.from" | "occupancy" | "work" | "attend" | "goods";

/** A seek as a record holds it: the outcome of 2c, with "me" where the entity itself stands. */
export function seekShape(k: SeekKey): { [outcome: string]: { [role: string]: string } } {
  switch (k) {
    case "money.to": return { money: { to: "me" } };
    case "money.from": return { money: { from: "me" } };
    case "occupancy": return { occupancy: { who: "me" } };
    case "work": return { work: { by: "me" } };
    case "attend": return { attend: { who: "me" } };
    case "goods": return { goods: { to: "me" } };
  }
}

/** A paper that stands in the way of a want: what it is (its kind), which one, and who made it. */
export interface Against { record: string; kind: string; by: string }

export interface Want {
  /** What it is about, in a word of the mind's own: a need (security, shelter ...), or what happened (rent_increase,
   * notice, let_go, loss, slight ...). With `against.record` it is the want's identity. */
  about: string;
  seeks: SeekKey[];
  against?: Against;
  /** Whom it concerns, where it is about someone: a person, an organisation or a post (a grievance against this
   * landlord, this employer, this council; someone lost; someone owed). A want may seek nothing typed and be about
   * someone only: to be heard by them, rid of them, even with them. Anything that bears on them is then an opening
   * (asking them, leaving them, a desk that hears what they did, a ballot they stand in, a petition about them);
   * with nothing the entity can see that would answer it, the want sits in the record, grows or is given up. */
  whom?: string;
  /** How much it matters (basis points). */
  weight: number;
  since: number;
  /** Born of a need as values weigh it, of something that happened, or of what someone one copies is after. */
  from: "need" | "event" | "other";
  /** The household it is held with, where it is a household's (each member holds it with their own weight). */
  with?: string;
  /** How often something was tried for it, when last, and the way taken (an opening's key; "wait": nothing). */
  tried: number;
  triedAt?: number;
  way?: string;
  /** What the way taken rests on (an opening's id: a request we made, a board we looked at). */
  on?: string;
  /** How often it has grown for going unmet. */
  grown: number;
}

export interface WantParams {
  /** How many a record keeps (the lightest gives way). */
  kept: number;
  /** A need below this for `unmet_days` becomes a want (by need; `other` for the rest). PLACEHOLDERS: the two that
   * were goals keep the goals' levels. */
  unmet_bps: { [need: string]: number };
  unmet_days: number;
  /** A need-born want is met once the need is back above its level by this much. */
  met_margin_bps: number;
  /** How long a way is given before the want is looked at again, at the middle of temperament (the patient wait
   * longer: `patience`). PLACEHOLDER. */
  patience_days: number;
  /** After this many tries unmet, the want grows or is given up, by temperament. PLACEHOLDER. */
  tries: number;
  /** Growing: this share more weight, at most `grows` times. PLACEHOLDERS. */
  grow_bps: number;
  grows: number;
  /** After giving one up, the same want is not born again for this long. PLACEHOLDER. */
  rest_days: number;
  /** An event-born want's weight at full size, and a need-born one's at a need wholly unmet (before the person's
   * own weighing). PLACEHOLDERS. */
  event_bps: number;
  need_bps: number;
  /** How many of those one knows must be after something before one who is short of it too takes the want up
   * (the conformist need fewer: 3b). PLACEHOLDER. */
  copy_from: number;
  /** What moves the choice among ways (basis points of the mind's payoff scale). PLACEHOLDERS, every one:
   * - `expect`: what a way not yet tried is expected to give (EWA's initial attraction);
   * - `trust`: how much a standard deviation of trust in the institution or party, against the town's figure for
   *   its kind, counts for turning to it;
   * - `fear`: how much fear of someone one depends on counts against confronting them (what is thought, not said);
   * - `agency`: how much a standard deviation of the sense of agency counts for acting at all against waiting;
   * - `belief`: how much holding what a host teaches counts for turning to it;
   * - `others`: how much each person known to have taken a way counts (weighed again by conformity in imitation). */
  choice: { expect: number; trust: number; fear: number; agency: number; belief: number; others: number; own: number; /** What the bother of taking something to a venue counts against it (forms, waiting, a hearing), beside its fee. FITTED to the share of people with a problem who turn to an authority or third party (docs/behaviour/frictions.md). */ venue: number };
  /** How far a standard deviation of trust, of the sense of agency and of attachment sways the cited rates they are
   * read by (docs/behaviour/citizen.md, "Readers"): symmetric about the town's mean, as `sway` is. PLACEHOLDERS. */
  sway: { trust: number; agency: number; attachment: number; /** How far wanting work of one's own raises the month's chance of founding a business (a share of it). */ found: number };
  /** Asking the other party to an agreement to vary it: at most once in this long for the same agreement. */
  ask_again_days: number;
  /** A rise asked for, as a share of the wage. PLACEHOLDER. */
  rise_bps: number;
  /** How long an answer is waited for before the paper asked about is dealt with as it stands. */
  answer_days: number;
}

export const WANT_DEFAULTS: WantParams = {
  kept: 6,
  unmet_bps: { security: 3_000, social: 4_000, subsistence: 0, other: 2_500 },
  unmet_days: 60,
  met_margin_bps: 500,
  patience_days: 45,
  tries: 3,
  grow_bps: 2_500,
  grows: 2,
  rest_days: 180,
  event_bps: 6_000,
  need_bps: 6_000,
  copy_from: 2,
  choice: { expect: 5_000, trust: 1_500, fear: 3_000, agency: 1_500, belief: 3_000, others: 500, own: 500, venue: 1_500 },
  sway: { trust: 0.3, agency: 0.3, attachment: 0.3, found: 1 },
  ask_again_days: 365,
  rise_bps: 500,
  answer_days: 14,
};

export function wantParams(given: any): WantParams {
  const d = WANT_DEFAULTS;
  const g = given ?? {};
  return { ...d, ...g, unmet_bps: { ...d.unmet_bps, ...(g.unmet_bps ?? {}) }, choice: { ...d.choice, ...(g.choice ?? {}) }, sway: { ...d.sway, ...(g.sway ?? {}) } };
}

const idOf = (w: { about: string; against?: Against; whom?: string }) => `${w.about}${w.against ? `:${w.against.record}` : w.whom ? `:${w.whom}` : ""}`;

/** What became of a want, for whoever records it (nothing here says whether that was good). */
export interface WantEvent { t: number; kind: "born" | "pursued" | "met" | "given_up" | "grown" | "displaced"; want: Want; way?: string; why?: string }

/**
 * An entity's wants: a short, bounded list. `patience` (about 0.5 to 1.5) stretches how long a way is given, and
 * `persistence` (standard deviations: those who value achievement and self-direction, and feel their acts count)
 * decides whether a want long unmet grows or is given up.
 */
export class Wants {
  private list: Want[] = [];
  private readonly rested = new Map<string, number>();
  private readonly copied = new Map<string, number>(); // a want taken up from others and met -> not taken up from them again before
  private events: WantEvent[] = [];
  constructor(readonly p: WantParams = WANT_DEFAULTS) {}

  all(): readonly Want[] {
    return this.list;
  }
  get(about: string, record?: string): Want | undefined {
    return this.list.find((w) => w.about === about && (record === undefined || w.against?.record === record || w.whom === record));
  }
  /** The heaviest want that concerns this one, if any. */
  about(whom: string): Want | undefined {
    return [...this.list].sort((a, b) => b.weight - a.weight).find((w) => w.whom === whom || w.against?.by === whom);
  }
  has(about: string): boolean {
    return this.list.some((w) => w.about === about);
  }
  /** The way being taken for a want that seeks this (the latest tried), if any. */
  taking(kind: string): boolean {
    return this.list.some((w) => w.way !== undefined && (w.way === kind || w.way.startsWith(`${kind}:`)));
  }

  /** A want is born, or one already held is felt more (the heavier weight stands). Returns it, or nothing while the
   * same want rests after being given up. */
  born(w: Omit<Want, "tried" | "grown">, t: number): Want | undefined {
    const id = idOf(w);
    if (t < (this.rested.get(id) ?? 0) || (w.from === "other" && t < (this.copied.get(id) ?? 0))) return undefined;
    const held = this.list.find((x) => idOf(x) === id);
    if (held) {
      held.weight = Math.max(held.weight, Math.round(w.weight));
      return held;
    }
    const want: Want = { ...w, weight: Math.max(1, Math.min(10_000, Math.round(w.weight))), tried: 0, grown: 0 };
    this.list.push(want);
    this.events.push({ t, kind: "born", want: { ...want } });
    if (this.list.length > this.p.kept) {
      // The lightest gives way (of equals, the oldest; never the one just born).
      let drop = -1;
      for (let i = 0; i < this.list.length - 1; i++) if (drop < 0 || this.list[i]!.weight < this.list[drop]!.weight) drop = i;
      const [gone] = this.list.splice(drop, 1);
      this.events.push({ t, kind: "displaced", want: { ...gone! } });
    }
    return want;
  }

  /** The wants to act on now: one never tried, or one whose way has had its time. Heaviest first. */
  due(t: number, patience: number): Want[] {
    const wait = Math.round(this.p.patience_days * 86_400 * patience);
    return this.list.filter((w) => w.tried === 0 || t - (w.triedAt ?? w.since) >= wait).sort((a, b) => b.weight - a.weight || (idOf(a) < idOf(b) ? -1 : 1));
  }

  /** Something was tried for it (or, with "wait", nothing was). */
  tried(w: Want, way: string, t: number, on?: string): void {
    w.tried += 1;
    w.triedAt = t;
    w.way = way;
    if (on !== undefined) w.on = on; else delete w.on;
    this.events.push({ t, kind: "pursued", want: { ...w }, way });
  }

  met(w: Want, t: number, why?: string): void {
    this.drop(w);
    // (A want taken up from others, once met, is not taken up from them again for a while: it would otherwise be
    // born and met week after week by someone who is merely near their aspiration.)
    if (w.from === "other") this.copied.set(idOf(w), t + this.p.rest_days * 86_400);
    this.events.push({ t, kind: "met", want: { ...w }, ...(w.way ? { way: w.way } : {}), ...(why ? { why } : {}) });
  }

  giveUp(w: Want, t: number, why?: string): void {
    this.drop(w);
    this.rested.set(idOf(w), t + this.p.rest_days * 86_400);
    this.events.push({ t, kind: "given_up", want: { ...w }, ...(w.way ? { way: w.way } : {}), ...(why ? { why } : {}) });
  }

  /**
   * A want that has had its tries and is still unmet grows or is given up: which, is temperament. Returns what
   * became of it ("grown": it presses harder and is tried again; "given_up"), or nothing if it has tries left.
   */
  wornOut(w: Want, t: number, persistence: number): "grown" | "given_up" | undefined {
    if (w.tried < this.p.tries * (w.grown + 1)) return undefined;
    if (persistence > 0 && w.grown < this.p.grows) {
      w.grown += 1;
      w.weight = Math.min(10_000, Math.round(w.weight * (1 + this.p.grow_bps / 10_000)));
      this.events.push({ t, kind: "grown", want: { ...w } });
      return "grown";
    }
    this.giveUp(w, t, "nothing worked");
    return "given_up";
  }

  private drop(w: Want): void {
    const i = this.list.indexOf(w);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** What has become of wants since this was last asked. */
  take(): WantEvent[] {
    return this.events.splice(0);
  }

  /** The record's section (contracts/entity-record.schema.json): heaviest first, whole numbers. */
  section(): { about: string; whom?: string; seeks: unknown[]; against?: Against; weight: number; since: number; from: string; with?: string; tried: number; way?: string }[] {
    return [...this.list].sort((a, b) => b.weight - a.weight || (idOf(a) < idOf(b) ? -1 : 1)).map((w) => ({
      about: w.about, ...(w.whom ? { whom: w.whom } : {}), seeks: w.seeks.map(seekShape), ...(w.against ? { against: { ...w.against } } : {}), weight: Math.round(w.weight), since: Math.round(w.since), from: w.from,
      ...(w.with ? { with: w.with } : {}), tried: w.tried, ...(w.way ? { way: w.way } : {}),
    }));
  }
}

/**
 * A rate swayed by where a person stands against their town (docs/behaviour/citizen.md, "Readers"): `z` standard
 * deviations from the town's mean, `per` the share of the rate a standard deviation moves it. Symmetric, so the
 * town's rate stays where it is calibrated while people differ.
 */
export function swayed(bps: number, z: number, per: number): number {
  return Math.max(0, Math.min(10_000, Math.round(bps * (1 + per * Math.max(-3, Math.min(3, z))))));
}
