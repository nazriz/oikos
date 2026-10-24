// Comparing arms of an experiment fairly (docs/experiments.md, "The comparison"): every arm of a seed runs from the same
// base town (the same past, the same draws up to the fork), so the comparison is made seed by seed. For a measure, an
// arm's difference from the reference is taken within each seed and the differences are summarised over the seeds:
// their mean, sd, and a Student-t interval (the paired design: Student 1908; a fork per seed is a matched pair). A
// difference of differences across four arms, (A - B) - (C - D) seed by seed, is the same summary of another per-seed
// number: the counterfactual design, where B and D are A and C with one act withheld (difference-in-differences; Card
// and Krueger 1994; Angrist and Pischke 2009, ch. 5).
//
// The intervals are the only inference here. With three seeds they are wide, and they should be: a seed is one town.
// Nothing here says which arm is better. Pure: numbers in, numbers out.

/** Per seed: the measure's value (null: the measure had nothing to count in that fork). */
export type BySeed = { seed: number; value: number | null }[];

export interface Interval {
  n: number;
  mean: number | null;
  sd: number | null;
  /** The interval's level as asked (0.95), and after any correction for several comparisons. */
  level: number;
  lo: number | null;
  hi: number | null;
  /** Seeds whose difference was above, below and at zero. */
  above: number;
  below: number;
  zero: number;
  values: BySeed;
}

/** The differences seed by seed: `a - b`, for each seed both have a value. */
export function pairedDifferences(a: BySeed, b: BySeed): BySeed {
  const of = new Map(b.map((x) => [x.seed, x.value]));
  return a.flatMap((x) => {
    const y = of.get(x.seed);
    return x.value !== null && y !== null && y !== undefined ? [{ seed: x.seed, value: x.value - y }] : [];
  });
}

/** (a - b) - (c - d), seed by seed: the difference in differences. */
export function differenceInDifferences(a: BySeed, b: BySeed, c: BySeed, d: BySeed): BySeed {
  return pairedDifferences(pairedDifferences(a, b), pairedDifferences(c, d));
}

/** Mean, sd and a two-sided Student-t interval at `level` of a set of per-seed numbers. */
export function interval(values: BySeed, level = 0.95): Interval {
  const xs = values.map((v) => v.value).filter((v): v is number => v !== null);
  const n = xs.length;
  const mean = n ? xs.reduce((a, b) => a + b, 0) / n : null;
  const sd = n > 1 && mean !== null ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : n ? 0 : null;
  let lo: number | null = null, hi: number | null = null;
  if (n > 1 && mean !== null && sd !== null) {
    const half = tQuantile(1 - (1 - level) / 2, n - 1) * (sd / Math.sqrt(n));
    lo = mean - half;
    hi = mean + half;
  }
  return { n, mean, sd, level, lo, hi, above: xs.filter((x) => x > 0).length, below: xs.filter((x) => x < 0).length, zero: xs.filter((x) => x === 0).length, values };
}

/** The level each of `k` comparisons is read at so that all `k` hold together at `level` (Bonferroni; Dunn 1961). */
export function bonferroni(level: number, k: number): number {
  return k > 1 ? 1 - (1 - level) / k : level;
}

// ---- Student's t, by the regularised incomplete beta function (Numerical Recipes, 3rd ed., 6.4; Lentz's continued
// fraction). Exact enough for intervals; deterministic.

function lnGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const k of c) ser += k / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d; if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

/** The regularised incomplete beta function I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** P(T <= t) for Student's t with `df` degrees of freedom. */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** The t such that P(T <= t) = p (bisection on the cdf). */
export function tQuantile(p: number, df: number): number {
  if (p === 0.5) return 0;
  let lo = -1e6, hi = 1e6;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
