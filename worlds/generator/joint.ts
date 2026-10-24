// Joint draws (docs/design/market-realism.md, "ME-17"; risk ME-17): who is in work, and how much they have saved, drawn
// together rather than each on its own. A Gaussian copula keeps every person's own chances exactly the profile's and
// adds only the dependence a survey's cross-tab gives: work shared within a household (fitted to the share of
// households in which nobody works), and savings leaning on pay (the residual rank correlation of income and wealth).
// Floating point here is deterministic (the same operations in the same order give the same town); every result that
// reaches the world is a whole number of basis points or cents.

/** The standard normal's distribution function (Abramowitz and Stegun 26.2.17, error under 7.5e-8). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Its inverse (Acklam's rational approximation, relative error under 1.2e-9), for 0 < p < 1. */
export function normInv(p: number): number {
  const q0 = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (q0 < lo) {
    const q = Math.sqrt(-2 * Math.log(q0));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (q0 > 1 - lo) return -normInv(1 - q0);
  const q = q0 - 0.5, r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** A uniform draw in (0, 1) from a whole-number draw below 1,000,000. */
export const unit = (k: number): number => (k + 0.5) / 1_000_000;

/** The chance that nobody in a household is in work, when each member i is in work with chance `p[i]` and all share a
 *  common factor with weight `rho` (the correlation of their latent draws): the integral over the factor of the product
 *  of each one's chance of not working, by the midpoint rule on [-8, 8]. */
export function noneWorking(p: number[], rho: number): number {
  const live = p.filter((x) => x > 0);
  if (!live.length) return 1;
  if (rho <= 0) return live.reduce((x, q) => x * (1 - q), 1);
  const c = live.map((q) => normInv(Math.min(q, 1 - 1e-12))), s = Math.sqrt(rho), r = Math.sqrt(1 - rho);
  const n = 320, h = 16 / n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const z = -8 + (i + 0.5) * h;
    let none = 1;
    for (const ci of c) none *= 1 - normCdf((ci - s * z) / r);
    sum += none * Math.exp((-z * z) / 2);
  }
  return (sum * h) / Math.sqrt(2 * Math.PI);
}

/** The shared weight that makes the town's expected share of households with nobody in work equal `target` (0..1),
 *  each household given as its members' chances of being in work. 0 where independence already gives as many or more
 *  (the copula here cannot make work rarer to share; said in the town's description), and at most 0.95. */
export function fitShared(households: number[][], target: number): number {
  if (!households.length) return 0;
  const share = (rho: number) => households.reduce((x, h) => x + noneWorking(h, rho), 0) / households.length;
  if (share(0) >= target) return 0;
  let lo = 0, hi = 0.95;
  if (share(hi) <= target) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (share(mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** A draw that shares `rho` of its variance with a common factor: the latent in standard normal units. */
export const shared = (common: number, own: number, rho: number): number => Math.sqrt(rho) * common + Math.sqrt(1 - rho) * own;

/** Each value's rank among all, as a share in (0, 1) (ties at the middle of their run). */
export function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    for (let k = i; k <= j; k++) out[order[k]![1]] = ((i + j) / 2 + 0.5) / order.length;
    i = j + 1;
  }
  return out;
}

/** A savings rank (0..9,999, as `drawSavings` takes it) that leans on an income rank `u` (0..1) with rank correlation
 *  about `rho` (a Gaussian copula: for a normal pair, Spearman's rho and the copula's are within 0.02 of each other at
 *  these sizes), given a uniform draw `v` (0..1) of its own. */
export function savingsRank(u: number, v: number, rho: number): number {
  const z = rho * normInv(u) + Math.sqrt(1 - rho * rho) * normInv(v);
  return Math.min(9_999, Math.max(0, Math.floor(normCdf(z) * 10_000)));
}
