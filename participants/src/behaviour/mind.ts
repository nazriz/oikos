// A citizen's mind in code (docs/design/ai-citizens.md 3): who a person is (values, temperament, needs), how they decide
// (CONSUMAT's four ways), and how they learn (experience-weighted attraction). Deterministic: randomness only from the
// participant's own streams. No world knowledge: a mind scores facts it's given (offers' typed terms), in the world's
// terms, and makes of them what its values make of them. Citations: docs/research/references.md.
//
// Numbers are basis points (0..10000) wherever they could reach a log, so records stay integers.

import type { Rng } from "../rng";

// ---------------------------------------------------------------- who a person is

/** Schwartz's ten basic values (Schwartz 1992): what a person believes in, measured across cultures. */
export const VALUES = ["self_direction", "stimulation", "hedonism", "achievement", "power", "security", "conformity", "tradition", "benevolence", "universalism"] as const;
export type Value = (typeof VALUES)[number];

/** Needs that rise and fall (Humanoid Agents; D2A). Belonging (being part of something: Baumeister and Leary 1995) and
 * meaning (D2A's "spiritual satisfaction"; Park 2005) since the richer record (docs/design/ai-citizens.md 10c). */
export const NEEDS = ["subsistence", "shelter", "security", "social", "status", "belonging", "meaning"] as const;
export type Need = (typeof NEEDS)[number];

/** A world's figures for drawing people: each value's importance (mean and spread, basis points), from its profile. */
export interface PopulationValues {
  values: { [v in Value]?: { mean_bps: number; sd_bps: number } };
}

/** How a person acts, apart from what they believe (Dwarf Fortress's facets beside its values). */
export interface Temperament {
  /** Trying what's new (stimulation, self-direction): exploration in learning, innovators to laggards (Rogers). */
  openness: number;
  /** Copying what most do (Boyd and Richerson's conformist bias; conformity, tradition). */
  conformity: number;
  /** Copying what the respected do (prestige bias; achievement, power). */
  prestige: number;
}

export interface Person {
  values: { [v in Value]: number };
  temperament: Temperament;
  /** How much each need weighs, set by values (Dwarf Fortress: values set needs). */
  weights: { [n in Need]: number };
}

const clamp = (x: number, lo = 0, hi = 10_000) => Math.max(lo, Math.min(hi, Math.round(x)));

/** A roughly normal draw (Irwin–Hall: the sum of 12 uniforms), as the petition thresholds are drawn. */
function normal(rng: Rng, mean: number, sd: number): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rng.below(1_000_001) / 1_000_000;
  return mean + (s - 6) * sd;
}

/**
 * A person, drawn from a world's figures. Temperament and need weights follow from values, by Schwartz's motivational
 * goals: security weighs the security need; power and achievement, status; benevolence and conformity, company;
 * hedonism, consumption; stimulation and self-direction make a person open; conformity and tradition, a conformist;
 * achievement and power, one who copies the respected. (Our mapping, to test against data: docs/design/ai-citizens.md.)
 */
export function drawPerson(rng: Rng, pop: PopulationValues): Person {
  return personOf(drawValues(rng, pop));
}

/** A person's values, drawn from a world's figures. */
export function drawValues(rng: Rng, pop: PopulationValues): Person["values"] {
  return Object.fromEntries(VALUES.map((v) => {
    const d = pop.values[v] ?? { mean_bps: 5000, sd_bps: 1500 };
    return [v, clamp(normal(rng, d.mean_bps, d.sd_bps))];
  })) as Person["values"];
}

const avg = (...xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** How much each need weighs for someone of these values: 1, plus up to 1 more as its values say (so no need is ever
 * ignored). Belonging by benevolence, conformity and tradition; meaning by tradition, universalism and benevolence
 * (the religious value tradition and conformity most: Saroglou, Delpierre and Dernelle 2004, to confirm). */
export function needWeights(values: Person["values"]): Person["weights"] {
  const w = (x: number) => clamp(10_000 + x, 10_000, 20_000);
  return {
    subsistence: w(values.hedonism * 0.5),
    shelter: w(avg(values.security, values.tradition) * 0.5),
    security: w(values.security),
    social: w(avg(values.benevolence, values.conformity)),
    status: w(avg(values.power, values.achievement)),
    belonging: w(avg(values.benevolence, values.conformity, values.tradition)),
    meaning: w(avg(values.tradition, values.universalism, values.benevolence)),
  };
}

/** The person these values make: temperament and need weights follow from them (above). */
export function personOf(values: Person["values"]): Person {
  const temperament: Temperament = {
    openness: clamp(avg(values.stimulation, values.self_direction)),
    conformity: clamp(avg(values.conformity, values.tradition)),
    prestige: clamp(avg(values.achievement, values.power)),
  };
  return { values, temperament, weights: needWeights(values) };
}

// ---------------------------------------------------------------- how satisfied

/** How well each need is met now (0 unmet .. 10000 fully), as the citizen judges its own life. */
export type NeedLevels = { [n in Need]: number };

/** Overall satisfaction: needs met, weighted as this person weighs them (basis points). */
export function satisfaction(p: Person, levels: NeedLevels): number {
  let num = 0;
  let den = 0;
  for (const n of NEEDS) {
    if (levels[n] === undefined) continue; // (a need nobody judged counts for nothing)
    num += p.weights[n] * levels[n];
    den += p.weights[n];
  }
  return den ? Math.round(num / den) : 0;
}

// ---------------------------------------------------------------- learning (EWA)

/**
 * Experience-weighted attraction (Camerer and Ho 1999): each option has an attraction, updated after each choice by
 * the payoff it gave (and, weighted by delta, what the others would have given, where that's known); choice is by the
 * logit of attractions. Parameters: phi (decay of past attraction), rho (decay of experience), delta (weight on forgone
 * payoffs), lambda (sensitivity). Defaults are placeholders near the paper's estimates, to fit.
 */
export interface EwaParams { phi_bps: number; rho_bps: number; delta_bps: number; lambda: number }
export const EWA_DEFAULTS: EwaParams = { phi_bps: 9000, rho_bps: 9000, delta_bps: 5000, lambda: 4 };

export class Attractions {
  private readonly a = new Map<string, number>(); // option -> attraction (a payoff scale: basis points of satisfaction)
  private n = 1; // experience weight
  constructor(private readonly e: EwaParams = EWA_DEFAULTS, private readonly prior = 0) {}

  get(option: string): number {
    return this.a.get(option) ?? this.prior;
  }
  /** Tried at least once, or heard of with a payoff: how well the option is known. */
  known(option: string): boolean {
    return this.a.has(option);
  }
  experience(): number {
    return this.n;
  }

  /** After a choice: its payoff, and the forgone payoffs of the others where they're known (seen others get them). */
  update(chosen: string, payoff: number, forgone: { [option: string]: number } = {}): void {
    const phi = this.e.phi_bps / 10_000;
    const rho = this.e.rho_bps / 10_000;
    const delta = this.e.delta_bps / 10_000;
    const n0 = this.n;
    this.n = rho * n0 + 1;
    const all = new Set([chosen, ...Object.keys(forgone), ...this.a.keys()]);
    for (const o of [...all].sort()) {
      const pay = o === chosen ? payoff : forgone[o];
      const w = o === chosen ? 1 : delta;
      const prev = this.get(o);
      this.a.set(o, pay === undefined ? (phi * n0 * prev) / this.n : (phi * n0 * prev + w * pay) / this.n);
    }
  }

  /**
   * What someone else got from an option, as they told us: weighted as EWA weighs forgone payoffs (delta), against our
   * own experience, and applied when heard rather than at our next choice (our adaptation: word of mouth arrives between
   * choices). The option is then known.
   */
  hear(option: string, payoff: number): void {
    const delta = this.e.delta_bps / 10_000;
    const prev = this.get(option);
    this.a.set(option, prev + (delta / (this.n + delta)) * (payoff - prev));
  }

  /** Choose among options by the logit of attraction plus each option's appraised value, with openness to explore. */
  choose(rng: Rng, options: { key: string; value: number }[], openness_bps: number): { key: string; weights: number[] } {
    const lam = this.e.lambda * (1 - openness_bps / 20_000); // the more open, the more a person explores
    const scores = options.map((o) => (this.get(o.key) + o.value) / 10_000);
    const max = Math.max(...scores);
    const weights = scores.map((s) => Math.round(Math.exp(lam * (s - max)) * 1_000_000));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng.below(Math.max(1, total));
    for (let i = 0; i < options.length; i++) {
      r -= weights[i]!;
      if (r < 0) return { key: options[i]!.key, weights };
    }
    return { key: options.at(-1)!.key, weights };
  }
}

// ---------------------------------------------------------------- how to decide (CONSUMAT)

export type Strategy = "repeat" | "imitate" | "compare" | "deliberate";

/**
 * CONSUMAT (Jager 2000; Jager and Janssen 2012): satisfied and certain, repeat; satisfied and uncertain, imitate;
 * unsatisfied and certain, compare with similar others; unsatisfied and uncertain, deliberate. `aspiration` is the
 * satisfaction below which a person looks to change; `certainty` how well they know their options (0..10000).
 */
export function strategy(satisfied_bps: number, certainty_bps: number, t: { aspiration_bps: number; certainty_bps: number }): Strategy {
  const satisfied = satisfied_bps >= t.aspiration_bps;
  const certain = certainty_bps >= t.certainty_bps;
  return satisfied ? (certain ? "repeat" : "imitate") : certain ? "compare" : "deliberate";
}

// ---------------------------------------------------------------- appraising an offer's facts

/** What taking up an option would change, in a month, in the world's terms (from an offer's typed terms). */
export interface Facts {
  /** Money a month: + in, - out (cents). */
  money_per_month: number;
  /** A place to live comes with it (and its bedrooms, if known). */
  home?: { bedrooms?: number };
  /** Hours of work a month it asks. */
  work_hours_per_month?: number;
  /** Goods it brings, a month (units). */
  goods_per_month?: number;
  /** Others around: members, workmates, fellow attendees, where known. */
  company?: number;
  /** Hours a month it takes out of one's own time, unpaid (a meeting, a service, a class). */
  time_hours_per_month?: number;
}

/** What giving up one's own time costs (basis points, whatever it's for): a placeholder, about 40 an hour a month, so an
 * evening a week (about 9 hours a month) weighs a little against the company it brings. */
export function timeCost(f: Facts): number {
  return f.time_hours_per_month ? Math.min(2_000, Math.round(f.time_hours_per_month * 40)) : 0;
}

/** What the facts do to each need, as this person weighs them (basis points of need, can be negative). Response curves:
 * money matters less the more one has (a log), a home matters most without one, work costs time. */
/** (An offer's facts say nothing of belonging or meaning: what a thing means to a person is `meaning`, from belief.
 * So the appraisal is of the five needs facts speak to, and weighed among those five, as it always was.) */
export type Appraisal = { [n in Need]?: number };
export function appraise(p: Person, f: Facts, circ: Circumstances): Appraisal {
  const scale = Math.max(1, circ.essentials ?? 0, circ.monthly_income + Math.floor(circ.savings / 12)); // a month's means, at least a month's essentials
  const money = f.money_per_month / scale; // this month's money against a month's means
  const moneyValue = Math.sign(money) * Math.log1p(Math.abs(money)) * 10_000;
  // A home: most to the homeless; half as much if it's short of the bedrooms needed; a little more for each spare one
  // (room, up to two).
  const spare = f.home?.bedrooms !== undefined && circ.homeBedroomsNeeded !== undefined ? f.home.bedrooms - circ.homeBedroomsNeeded : 0;
  const home = f.home ? (circ.homeless ? 10_000 : 2_000) * (spare < 0 ? 0.5 : 1) + Math.min(2, Math.max(0, spare)) * 1_500 : 0;
  const workCost = f.work_hours_per_month ? Math.min(3_000, f.work_hours_per_month * 15) : 0; // ~160 h a month: -2,400
  return {
    subsistence: Math.round(f.goods_per_month ? Math.min(10_000, f.goods_per_month * 800) : 0),
    shelter: Math.round(home),
    security: Math.round(moneyValue),
    social: Math.round(f.company ? Math.min(3_000, Math.log1p(f.company) * 1_000) : 0),
    status: Math.round((f.work_hours_per_month ? 1_000 : 0) + Math.max(0, moneyValue) * 0.3 - workCost * 0.2),
  };
}

/** One number: the appraisal weighted by this person's needs (basis points). */
export function value(p: Person, a: Appraisal): number {
  let num = 0;
  let den = 0;
  for (const n of NEEDS) {
    if (a[n] === undefined) continue;
    num += p.weights[n] * a[n]!;
    den += p.weights[n];
  }
  return den ? Math.round(num / den) : 0;
}

/** An offer's facts, from its typed terms (contracts: Offer; docs/design/ai-citizens.md 2a): money a month in and out for
 * the taker, a home, work hours, goods. Terms in words count for nothing here: their meaning is a mind's (4). */
export function factsOf(offer: { terms?: { commitments: { who: string; does: any; every?: number; per?: string }[] } }, units = 1): Facts {
  const MONTH = 30 * 86_400;
  const f: Facts = { money_per_month: 0 };
  for (const c of offer.terms?.commitments ?? []) {
    const o = c.does?.outcome;
    if (!o) continue;
    const perMonth = (x: number) => (c.every ? Math.round((x * MONTH) / c.every) : x) * (c.per === "unit" ? units : 1);
    const taker = c.who === "taker";
    if (o.money) f.money_per_month += (taker ? -1 : 1) * perMonth(Number(o.money.amount));
    if (o.occupancy && !taker) f.home = {};
    if (o.occupancy && taker) f.work_hours_per_month = (f.work_hours_per_month ?? 0) + 160; // being at a workplace: a job's hours
    if (o.work && taker) f.work_hours_per_month = (f.work_hours_per_month ?? 0) + Math.round(perMonth(o.work.hours ?? 0) / 3600);
    if (o.goods && !taker) f.goods_per_month = (f.goods_per_month ?? 0) + perMonth(Number(o.goods.quantity));
  }
  return f;
}

// ---------------------------------------------------------------- a mind: the pieces together

/** Where a person stands, for appraising (their means, whether they have a home, how many bedrooms they need). */
/** A person's circumstances: income and savings (cents), whether homeless, the bedrooms their household needs, and what a
 * month's essentials cost in their world (the least a month's means is taken to be: the world's figure, not the code's). */
export interface Circumstances { monthly_income: number; savings: number; homeless: boolean; homeBedroomsNeeded?: number; essentials?: number }

/** An option in a decision: its key, its facts (from an offer), how many others the person knows took it, and what it
 * means to them beyond the facts (from what they believe; basis points). */
export interface Choice { key: string; facts?: Facts; others?: number; meaning?: number }

/** The mind that decides, as decision records name it (contracts-0.7 A2: `state.mind`). */
export const MIND_VERSION = "mind-0.3.0";

/** `satisfaction` and `certainty`: as they stood when it decided (basis points). */
export interface Decision { key?: string; strategy: Strategy; scores: { key: string; score: number }[]; satisfaction?: number; certainty?: number }

export interface MindParams {
  /** Satisfaction below which a person looks to change (CONSUMAT's aspiration; placeholder). */
  aspiration_bps: number;
  /** How well options must be known to count as certain (share of the options tried or heard of; placeholder). */
  certainty_bps: number;
  ewa: EwaParams;
}
export const MIND_DEFAULTS: MindParams = { aspiration_bps: 6_000, certainty_bps: 5_000, ewa: EWA_DEFAULTS };

/**
 * A citizen's mind: a person drawn once, and what they've learned in each area of life (a domain: "shop", "job"...).
 * `decide` takes the options the world offers and returns a choice, the way CONSUMAT says a person like this, this
 * satisfied, this sure of their options, would make it; `learn` records how a choice turned out.
 */
export class Mind {
  readonly person: Person;
  private readonly domains = new Map<string, Attractions>();

  /** `expect`: what a person expects of an option not yet tried, by area (EWA's initial attractions, Camerer and Ho). */
  /** `own`: the person's values where the world gave them (who lives in a town is the town's; a child's come from
   * those who raise them: docs/behaviour/citizen.md, "Upbringing"); none: drawn here from the world's figures. */
  constructor(rng: Rng, pop: PopulationValues, readonly p: MindParams = MIND_DEFAULTS, private readonly expect: { [domain: string]: number } = {}, own?: { [v: string]: number }) {
    const given = own && VALUES.every((v) => Number.isFinite(own[v]));
    this.person = given ? personOf(Object.fromEntries(VALUES.map((v) => [v, clamp(own![v]!)])) as Person["values"]) : drawPerson(rng, pop);
  }

  /** The person's values have moved (drift, a shock): what they weigh follows. Temperament does not move
   * (docs/design/ai-citizens.md 10c: hardly ever). */
  reweigh(): void {
    Object.assign(this.person.weights, needWeights(this.person.values));
  }

  learned(domain: string): Attractions {
    let a = this.domains.get(domain);
    if (!a) this.domains.set(domain, (a = new Attractions(this.p.ewa, this.expect[domain] ?? 0)));
    return a;
  }

  learn(domain: string, chosen: string, payoff_bps: number, forgone: { [option: string]: number } = {}): void {
    this.learned(domain).update(chosen, payoff_bps, forgone);
  }

  /** What someone told us an option gave them (word of mouth). */
  hear(domain: string, option: string, payoff_bps: number): void {
    this.learned(domain).hear(option, payoff_bps);
  }

  /** `doubt`: how much a feeling (fear) takes from how sure the person is of their options (basis points). */
  decide(domain: string, rng: Rng, o: { options: Choice[]; current?: string; levels: NeedLevels; circ: Circumstances; satisfied_here?: number; doubt?: number }): Decision {
    const learned = this.learned(domain);
    const options = [...o.options].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const known = options.filter((x) => learned.known(x.key)).length;
    const certainty = Math.max(0, (options.length ? Math.round((known * 10_000) / options.length) : 10_000) - (o.doubt ?? 0));
    // Satisfaction: life as a whole, and, where the caller knows it, how this area has gone (the lower counts).
    const sat = Math.min(satisfaction(this.person, o.levels), o.satisfied_here ?? 10_000);
    const s = strategy(sat, certainty, this.p);
    const d = this.decideAs(s, rng, options, learned, o);
    return { ...d, satisfaction: sat, certainty };
  }

  private decideAs(s: Strategy, rng: Rng, options: Choice[], learned: ReturnType<Mind["learned"]>, o: { current?: string; circ: Circumstances }): Decision {
    const has = (k?: string) => k !== undefined && options.some((x) => x.key === k);
    const scored = (value: (x: Choice) => number) => options.map((x) => ({ key: x.key, score: Math.round(learned.get(x.key) + value(x)) }));
    if (!options.length) return { strategy: s, scores: [] };
    if (s === "repeat" && has(o.current)) return { key: o.current, strategy: s, scores: [] };
    if (s === "imitate") {
      // What others do: conformists weigh how many took it (Boyd and Richerson). Without anyone to copy, one's own habit.
      const told = options.filter((x) => (x.others ?? 0) > 0);
      if (told.length) {
        const weights = told.map((x) => Math.round(Math.pow(x.others!, 1 + this.person.temperament.conformity / 10_000) * 1000));
        const total = weights.reduce((a, b) => a + b, 0);
        let r = rng.below(Math.max(1, total));
        for (let i = 0; i < told.length; i++) if ((r -= weights[i]!) < 0) return { key: told[i]!.key, strategy: s, scores: told.map((x, j) => ({ key: x.key, score: weights[j]! })) };
      }
      // Nobody to copy: what we know from experience (below), not habit alone.
    }
    if (s === "compare" || s === "imitate") {
      // Among options known, the best by experience.
      const familiar = options.filter((x) => learned.known(x.key));
      if (familiar.length) {
        const c = learned.choose(rng, familiar.map((x) => ({ key: x.key, value: 0 })), this.person.temperament.openness);
        return { key: c.key, strategy: "compare", scores: scored(() => 0) }; // (what was done, whatever the quadrant)
      }
    }
    // Deliberate: every option's facts appraised against needs, with what's been learned, chosen by logit.
    const appraised = (x: Choice) => (x.facts ? value(this.person, appraise(this.person, x.facts, o.circ)) - timeCost(x.facts) : 0) + (x.meaning ?? 0);
    const c = learned.choose(rng, options.map((x) => ({ key: x.key, value: appraised(x) })), this.person.temperament.openness);
    return { key: c.key, strategy: "deliberate", scores: scored(appraised) };
  }
}

// ---------------------------------------------------------------- feelings (OCC, lite) and ties

/**
 * Emotions by appraisal (Ortony, Clore and Collins 1988, as FAtiMA computes them; docs/design/ai-citizens.md 3d), each
 * about someone or something: events against one's goals (joy, distress; hope, fear of what's coming), others' acts
 * against one's standards (anger, gratitude). Each fades by its half-life (placeholders: a grudge lasts longer than a
 * disappointment).
 */
export type Emotion = "joy" | "distress" | "hope" | "fear" | "anger" | "gratitude";
export const EMOTION_HALF_LIFE_DAYS: { [e in Emotion]: number } = { joy: 7, distress: 14, hope: 14, fear: 30, anger: 60, gratitude: 90 };

export class Feelings {
  private readonly felt = new Map<string, { bps: number; t: number }>(); // "emotion:about" -> intensity when last felt
  constructor(private readonly halfLife: { [e in Emotion]: number } = EMOTION_HALF_LIFE_DAYS) {}

  /** How strongly it's felt now (basis points), faded since. */
  level(e: Emotion, about: string, t: number): number {
    const f = this.felt.get(`${e}:${about}`);
    return f ? Math.round(f.bps * Math.pow(0.5, (t - f.t) / (this.halfLife[e] * 86_400))) : 0;
  }

  /** Felt at least this strongly now (a stronger feeling isn't lessened by a milder cause). */
  feel(e: Emotion, about: string, bps: number, t: number): void {
    this.felt.set(`${e}:${about}`, { bps: Math.min(10_000, Math.max(this.level(e, about, t), Math.round(bps))), t });
  }

  /** The strongest feeling now, if any: what it is, about whom, how strong. */
  strongest(t: number): { kind: string; about: string; bps: number } | undefined {
    let best: { kind: string; about: string; bps: number } | undefined;
    for (const k of [...this.felt.keys()].sort()) {
      const [kind, about] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
      const bps = this.level(kind as Emotion, about, t);
      if (bps > 0 && (!best || bps > best.bps)) best = { kind, about, bps };
    }
    return best;
  }

  /** Felt more: a share of the way to its strongest. */
  add(e: Emotion, about: string, bps: number, t: number): void {
    const now = this.level(e, about, t);
    this.felt.set(`${e}:${about}`, { bps: now + Math.round(((10_000 - now) * Math.min(10_000, bps)) / 10_000), t });
  }
}

/**
 * Ties: affinity with each person known (Comme il Faut's and the Ensemble engine's social networks, lite;
 * docs/design/ai-citizens.md 3d, 10c), from -10,000 to 10,000, with how far they are trusted and what last passed
 * between us. Affinity grows with time together and with favours, falls with wrongs, and fades toward none without
 * contact (a placeholder half-life). Bounded: only so many are kept (`kept`: the sympathy group of about 15, Hill and
 * Dunbar 2003), the faintest giving way; a record holds the closest few and the few most resented.
 */
export interface Tie { who: string; affinity: number; trust: number; last?: { what: string; t: number } }
export class Ties {
  private readonly aff = new Map<string, { bps: number; t: number; trust: number; last?: { what: string; t: number } }>();
  constructor(private readonly halfLifeDays = 180, private readonly kept = 15, private readonly startTrust = 5_000) {}

  affinity(who: string, t: number): number {
    const a = this.aff.get(who);
    return a ? Math.round(a.bps * Math.pow(0.5, (t - a.t) / (this.halfLifeDays * 86_400))) : 0;
  }

  /** `what`: what passed between us, in a word (talked, met, tip, wronged, ...), kept as the last thing that did. */
  add(who: string, bps: number, t: number, what?: string): void {
    const a = this.aff.get(who);
    const last = what ? { what, t } : a?.last;
    this.aff.set(who, { bps: Math.max(-10_000, Math.min(10_000, this.affinity(who, t) + Math.round(bps))), t, trust: a?.trust ?? this.startTrust, ...(last ? { last } : {}) });
    if (this.aff.size > this.kept) {
      // The faintest goes (by how strongly felt now, either way; of equals, by name).
      let drop: string | undefined;
      let least = Infinity;
      for (const k of [...this.aff.keys()].sort()) {
        if (k === who) continue;
        const x = Math.abs(this.affinity(k, t));
        if (x < least) (least = x), (drop = k);
      }
      if (drop !== undefined) this.aff.delete(drop);
    }
  }

  /** How far we trust them, if we keep them. */
  trust(who: string): number | undefined {
    return this.aff.get(who)?.trust;
  }
  /** They did as they said (a share of the way to complete trust), or did not (of the way to none). */
  trusted(who: string, good: boolean, bps: number): void {
    const a = this.aff.get(who);
    if (a) a.trust = Math.round(good ? a.trust + ((10_000 - a.trust) * bps) / 10_000 : a.trust - (a.trust * bps) / 10_000);
  }
  /** No longer anyone to us (they died, or left for good). */
  drop(who: string): void {
    this.aff.delete(who);
  }

  private all(t: number): Tie[] {
    return [...this.aff.entries()].map(([who, a]) => ({ who, affinity: this.affinity(who, t), trust: a.trust, ...(a.last ? { last: { ...a.last } } : {}) }));
  }
  /** The closest few (affinity above nothing), closest first. */
  closest(n: number, t: number): Tie[] {
    return this.all(t).filter((x) => x.affinity > 0).sort((a, b) => b.affinity - a.affinity || (a.who < b.who ? -1 : 1)).slice(0, n);
  }
  /** The few most resented (affinity below nothing), most first. */
  resented(n: number, t: number): Tie[] {
    return this.all(t).filter((x) => x.affinity < 0).sort((a, b) => a.affinity - b.affinity || (a.who < b.who ? -1 : 1)).slice(0, n);
  }
}

// ---------------------------------------------------------------- goals with steps (HTN, lite)

/**
 * A goal pursued by methods tried in turn: hierarchical task networks, one level deep (each method a way to the goal,
 * the way HTN planners choose among methods for a task; docs/design/ai-citizens.md 3d). Each method is given time to
 * work; the goal is met when the need behind it recovers, and given up when no method is left.
 */
export class Pursuit {
  step = 0;
  constructor(readonly goal: string, readonly methods: string[], public since: number) {}
  get method(): string | undefined {
    return this.methods[this.step];
  }
  /** The next method (from now), if there's one left. */
  next(t: number): string | undefined {
    this.step += 1;
    this.since = t;
    return this.method;
  }
}
