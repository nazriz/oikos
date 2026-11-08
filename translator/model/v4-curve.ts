// The headline's arithmetic (docs/design/translator-v4.md, section 5), shared by v4-score.ts and v4-serve.ts.

/** The upper end of a one-sided 95% interval on a rate of k in n (Clopper-Pearson, by bisection on the binomial tail). */
export function upper(k: number, n: number): number {
  if (n === 0) return 1;
  const tail = (p: number) => { let s = 0, t = Math.pow(1 - p, n); for (let i = 0; i <= k; i++) { s += t; t = (t * (n - i) / (i + 1)) * (p / (1 - p)); } return s; };
  let lo = k / n, hi = 1;
  for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; tail(m) > 0.05 ? (lo = m) : (hi = m); }
  return hi;
}

export interface Scored { sure: number; ok: boolean; served: boolean; writer: string }

/** The cut-off with the most right served where confidently wrong (wrong and served) is at most 1% of what is served:
 * the point estimate, or (`bound`) its one-sided 95% upper bound. */
export function curve(xs: Scored[], bound: boolean) {
  const sorted = xs.filter((x) => x.served).sort((a, b) => b.sure - a.sure);
  let best = { cut: 1.01, served: 0, right: 0, wrong: 0 };
  let r = 0, w = 0;
  for (let k = 0; k < sorted.length; k++) {
    sorted[k]!.ok ? r++ : w++;
    if (sorted[k + 1] && sorted[k + 1]!.sure === sorted[k]!.sure) continue;
    const served = r + w;
    const okRate = bound ? upper(w, served) <= 0.01 : w <= 0.01 * served;
    if (okRate && r > best.right) best = { cut: sorted[k]!.sure, served, right: r, wrong: w };
  }
  return { ...best, right_served_share: +(best.right / Math.max(1, xs.length)).toFixed(4) };
}

/** What is served at a cut-off set elsewhere (on validation-real): never chosen on the set it is read on. */
export function atCut(xs: Scored[], cut: number) {
  const served = xs.filter((x) => x.served && x.sure >= cut);
  const right = served.filter((x) => x.ok).length;
  return { cut, served: served.length, right, wrong: served.length - right, right_served_share: +(right / Math.max(1, xs.length)).toFixed(4), wrong_of_served: +((served.length - right) / Math.max(1, served.length)).toFixed(4), wrong_bound95: +upper(served.length - right, served.length).toFixed(4) };
}

/** By writer at a cut-off: right served, confidently wrong, asked back; and the spread of right served (in points)
 * among writers with at least `min` requests. */
export function byWriter(xs: Scored[], cut: number, min = 20) {
  const out: { [w: string]: { n: number; right: number; right_served: number; wrong_served: number; asked_back: number; right_served_share: number } } = {};
  for (const w of [...new Set(xs.map((x) => x.writer))].sort()) {
    const mine = xs.filter((x) => x.writer === w);
    const served = mine.filter((x) => x.served && x.sure >= cut);
    const rs = served.filter((x) => x.ok).length;
    out[w] = { n: mine.length, right: mine.filter((x) => x.ok).length, right_served: rs, wrong_served: served.length - rs, asked_back: mine.length - served.length, right_served_share: +(rs / Math.max(1, mine.length)).toFixed(4) };
  }
  const shares = Object.values(out).filter((v) => v.n >= min).map((v) => v.right_served_share);
  return { by_writer: out, parity_spread_points: shares.length > 1 ? +(100 * (Math.max(...shares) - Math.min(...shares))).toFixed(1) : null };
}
