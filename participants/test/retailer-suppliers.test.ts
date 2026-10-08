// Which supplier a shop asks (docs/behaviour/retailer.md): the cheapest; among suppliers at the same price, in the
// shop's own usual order, not the same one for every shop in town.
//
// Found in the 1,000-person town's logs (decisions log, 2026-10-08): with the factories' prices level, all thirty shops
// sent each week's order to the factory whose name sorts first and the next week's to the second, one of them a works
// with no staff; the other eight factories, exporting all they made, were never asked.

import { expect, test } from "bun:test";
import { retailer } from "../src/behaviour/retailer";
import { inCurrency } from "../src/money";
import { context, DAY, statement, wake } from "./stepping";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";

inCurrency(PROFILE.values.currency);

const SUPPLIERS = ["factory-1", "factory-10", "factory-2", "factory-3", "factory-4", "factory-5"];
const list = (seller: string, price: number) => statement(`list-${seller}`, 0, "price_list", { speaks_for: seller, data: { goods: { goods: price }, account: `acc-${seller}`, min_order: 50 } });

/** A shop with money and no stock, woken once: whom it sends its first order to. */
function firstOrder(shop: string, prices: { [seller: string]: number }): string | undefined {
  const m = retailer.create(context(`${shop}-manager-system`, shop, { premises: shop, workplace: `${shop}/workplace.1`, suppliers: SUPPLIERS, demand: 200 }, { position: `${shop}-manager` }));
  const books = { kind: "accounts", accounts: [{ account: `acc-${shop}`, holder: shop, custodian: "bank", currency: "AUD", balance: "100000000" }], transactions: [] };
  const w = wake(m, DAY, { books, lists: { kind: "records", records: SUPPLIERS.map((s) => list(s, prices[s] ?? 10_000)) } }, { entity: shop, as: { participant: `${shop}-manager-system`, position: `${shop}-manager` } });
  return w.of("statement", "order")[0]?.args.to?.[0];
}

const shops = Array.from({ length: 12 }, (_, i) => `shop-${i + 1}`);

test("at level prices shops don't all ask the same supplier, and a shop asks the same one however often it is made", () => {
  const asked = shops.map((s) => firstOrder(s, {}));
  for (const a of asked) expect(SUPPLIERS).toContain(a!);
  expect(new Set(asked).size).toBeGreaterThan(2);
  expect(shops.map((s) => firstOrder(s, {}))).toEqual(asked);
});

test("a cheaper supplier is asked by every shop, whatever its place in a shop's usual order", () => {
  for (const cheap of ["factory-5", "factory-10"]) expect(new Set(shops.map((s) => firstOrder(s, { [cheap]: 9_900 })))).toEqual(new Set([cheap]));
});
