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

/** Needs that rise and fall (Humanoid Agents; D2A). Belonging and meaning come later (docs/design/ai-citizens.md 8). */
export const NEEDS = ["subsistence", "shelter", "security", "social", "status"] as const;
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
  const values = Object.fromEntries(VALUES.map((v) => {
    const d = pop.values[v] ?? { mean_bps: 5000, sd_bps: 1500 };
    return [v, clamp(normal(rng, d.mean_bps, d.sd_bps))];
  })) as Person["values"];
  const avg = (...xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const temperament: Temperament = {
    openness: clamp(avg(values.stimulation, values.self_direction)),
    conformity: clamp(avg(values.conformity, values.tradition)),
    prestige: clamp(avg(values.achievement, values.power)),
  };
  // Each need weighs 1, plus up to 1 more as its values say (so no need is ever ignored).
  const w = (x: number) => clamp(10_000 + x, 10_000, 20_000);
  const weights: Person["weights"] = {
    subsistence: w(values.hedonism * 0.5),
    shelter: w(avg(values.security, values.tradition) * 0.5),
    security: w(values.security),
    social: w(avg(values.benevolence, values.conformity)),
    status: w(avg(values.power, values.achievement)),
  };
  return { values, temperament, weights };
}

// ---------------------------------------------------------------- how satisfied

/** How well each need is met now (0 unmet .. 10000 fully), as the citizen judges its own life. */
export type NeedLevels = { [n in Need]: number };

/** Overall satisfaction: needs met, weighted as this person weighs them (basis points). */
export function satisfaction(p: Person, levels: NeedLevels): number {
  let num = 0;
  let den = 0;
  for (const n of NEEDS) {
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
}

/** What the facts do to each need, as this person weighs them (basis points of need, can be negative). Response curves:
 * money matters less the more one has (a log), a home matters most without one, work costs time. */
export function appraise(p: Person, f: Facts, circ: { monthly_income: number; savings: number; homeless: boolean; homeBedroomsNeeded?: number }): { [n in Need]: number } {
  const scale = Math.max(100_000, circ.monthly_income + Math.floor(circ.savings / 12)); // a month's means, at least $1,000
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
export function value(p: Person, a: { [n in Need]: number }): number {
  let num = 0;
  let den = 0;
  for (const n of NEEDS) {
    num += p.weights[n] * a[n];
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
export interface Circumstances { monthly_income: number; savings: number; homeless: boolean; homeBedroomsNeeded?: number }

/** An option in a decision: its key, its facts (from an offer), and how many others the person knows took it. */
export interface Choice { key: string; facts?: Facts; others?: number }

export interface Decision { key?: string; strategy: Strategy; scores: { key: string; score: number }[] }

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
  constructor(rng: Rng, pop: PopulationValues, readonly p: MindParams = MIND_DEFAULTS, private readonly expect: { [domain: string]: number } = {}) {
    this.person = drawPerson(rng, pop);
  }

  learned(domain: string): Attractions {
    let a = this.domains.get(domain);
    if (!a) this.domains.set(domain, (a = new Attractions(this.p.ewa, this.expect[domain] ?? 0)));
    return a;
  }

  learn(domain: string, chosen: string, payoff_bps: number, forgone: { [option: string]: number } = {}): void {
    this.learned(domain).update(chosen, payoff_bps, forgone);
  }

  decide(domain: string, rng: Rng, o: { options: Choice[]; current?: string; levels: NeedLevels; circ: Circumstances; satisfied_here?: number }): Decision {
    const learned = this.learned(domain);
    const options = [...o.options].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const known = options.filter((x) => learned.known(x.key)).length;
    const certainty = options.length ? Math.round((known * 10_000) / options.length) : 10_000;
    // Satisfaction: life as a whole, and, where the caller knows it, how this area has gone (the lower counts).
    const sat = Math.min(satisfaction(this.person, o.levels), o.satisfied_here ?? 10_000);
    const s = strategy(sat, certainty, this.p);
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
        return { key: c.key, strategy: s, scores: scored(() => 0) };
      }
    }
    // Deliberate: every option's facts appraised against needs, with what's been learned, chosen by logit.
    const appraised = (x: Choice) => (x.facts ? value(this.person, appraise(this.person, x.facts, o.circ)) : 0);
    const c = learned.choose(rng, options.map((x) => ({ key: x.key, value: appraised(x) })), this.person.temperament.openness);
    return { key: c.key, strategy: "deliberate", scores: scored(appraised) };
  }
}
