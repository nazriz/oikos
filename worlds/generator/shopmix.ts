// A town's mix of shops (docs/behaviour/demand.md, "A town's mix of shops"). Where the profile's expenditure survey names
// the kinds of thing households buy and what a seller of each is like, the town's shops are divided among those kinds,
// and each sells its kind. Every figure is the profile's; nothing here is a place's.
import type { Profile } from "./profile";

export interface ShopKind {
  kind: string;
  /** The kind's share of what households spend in the shops the town has (renormalised over the kinds it sells), basis points. */
  share_bps: number;
  income_elasticity_bps: number;
  /** A unit's retail price, and what the shop pays for it, in the currency's minor units. */
  price: number;
  wholesale: number;
  /** How many of the town's shops sell it. */
  shops: number;
}

/**
 * Whole numbers of shops in proportion to weights (largest remainder; ties to the earlier), adding to `n`. Kinds with a
 * weight of nothing get none.
 */
export function apportion(weights: number[], n: number): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0) || n <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w * n) / total);
  const out = exact.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    if (weights[i]! > 0) { out[i]!++; left--; }
  }
  return out;
}

/** Whether the profile gives a table of kinds for shops to sell (`goods` and at least one other with a `seller`). */
export function hasShopTable(V: Profile["values"]): boolean {
  const k = V.spending.demand?.kinds ?? [];
  return k.some((x) => x.kind === "goods") && k.some((x) => x.kind !== "goods" && x.seller);
}

/**
 * The kinds a town of `shops` shops sells, from the profile's table. `unit_serve_cost`: what the staff's time to serve
 * one unit costs (the town's own unit of serving: every kind's unit is what that time serves, so a kind with a larger
 * labour share has a smaller unit and a lower price). `goods` keeps the figures it has without a mix: its price and
 * what its shops pay for it. Shops are divided by the kinds' shares of businesses where every kind has one, by their
 * shares of spending otherwise; `goods` keeps at least one shop.
 */
export function shopMix(V: Profile["values"], shops: number, goods: { price: number; wholesale: number }, unit_serve_cost: number): ShopKind[] {
  const sold = (V.spending.demand?.kinds ?? []).filter((k) => k.kind === "goods" || k.seller);
  const byBusiness = sold.every((k) => k.seller?.business_share_bps !== undefined);
  const counts = apportion(sold.map((k) => (byBusiness ? k.seller!.business_share_bps! : k.share_bps)), shops);
  const goodsAt = sold.findIndex((k) => k.kind === "goods");
  if (shops > 0 && counts[goodsAt] === 0) {
    const most = counts.reduce((m, c, i) => (c > counts[m]! ? i : m), 0);
    counts[most]!--;
    counts[goodsAt] = 1;
  }
  const out: ShopKind[] = [];
  sold.forEach((k, i) => {
    if (!counts[i]) return;
    if (k.kind === "goods") { out.push({ kind: k.kind, share_bps: k.share_bps, income_elasticity_bps: k.income_elasticity_bps, price: goods.price, wholesale: goods.wholesale, shops: counts[i]! }); return; }
    const { wholesale_bps, labour_bps } = k.seller!;
    if (wholesale_bps === undefined || labour_bps === undefined || !(labour_bps > 0) || wholesale_bps + labour_bps >= 10_000)
      throw new Error(`the profile's kind ${k.kind} needs a seller with wholesale_bps and labour_bps whose sum leaves a margin (under 10,000)`);
    const price = Math.max(2, Math.round((unit_serve_cost * 10_000) / labour_bps));
    out.push({ kind: k.kind, share_bps: k.share_bps, income_elasticity_bps: k.income_elasticity_bps, price, wholesale: Math.max(1, Math.round((price * wholesale_bps) / 10_000)), shops: counts[i]! });
  });
  return out;
}
