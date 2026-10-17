// Adoption by the numbers (docs/behaviour/automation.md): the comparison a manager makes, and an office\'s tender. The figures here
// are the test\'s own.

import { expect, test } from "bun:test";
import { Book } from "../src/behaviour/common";
import { ADOPTION, appraise, best, capacityOf, dropping, Fleet, OfficeAdoption, type Lot, type Task } from "../src/behaviour/automation";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { DAY, MONTH, statement } from "./stepping";

inCurrency(PROFILE.values.currency);
const bookOf = (...records: any[]) => {
  const b = new Book();
  b.absorb({ t: 0, entity: "x", participant: "x", channels: { mine: { kind: "records", records } }, inbox: [], outcomes: [], woke_for: "cadence" } as any);
  return b;
};

/** A shop: 400 units a month, 2,600 seconds a unit, a worker\'s month of 160 hours at $4,500 (the test\'s own). */
const SHOP: Task = { units: 400, labour: 2_600, wage_month: 450_000, seconds_per_worker_month: 160 * 3600, utilisation_bps: 8_000, unit_price: 12_000, hiring_cost_weeks: 8 };
const KIOSK = { fee_month: 31_000, setup: 2_325_000, exit: 465_000, seconds: 2_600, scope_bps: 3_000, error_bps: 150, oversight_hours_per_month: 6, references: 0 };

test("a system is worth taking when the staff it frees cost more than its fees, oversight, mistakes, set-up and exit spread over the payback, by the margin asked", () => {
  const x = appraise(KIOSK, 1, SHOP, ADOPTION, 24);
  // 30% of 400 units is 120; one system can do 0.8 x a month / 2,600 s = 738 of them: it does all 120.
  expect(x.units).toBe(120);
  expect(x.hands).toBeCloseTo((120 * 2_600) / (160 * 3600 * 0.8), 5);
  expect(x.saving).toBe(Math.round(x.hands * 450_000));
  // fee 31,000; 6 hours at $28.1/h; 120 units x 1.5% x $120 refunded; set-up and exit over 24 months.
  expect(x.running).toBe(31_000 + Math.round(6 * ((450_000 * 3600) / (160 * 3600))) + Math.round((120 * 150 * 12_000) / 10_000));
  expect(x.amortised).toBe(Math.round((2_325_000 + 465_000) / 24));
  expect(x.worth).toBe(x.saving * 10_000 >= (x.running + x.amortised) * (10_000 + ADOPTION.hurdle_bps));
});

test("the same system at twice the price, or a worse one, is not worth it; at half the price it is; each client the vendor names eases the margin", () => {
  const at = (times: number, o: object = {}) => best({ ...KIOSK, fee_month: KIOSK.fee_month * times, setup: KIOSK.setup * times, exit: KIOSK.exit * times, ...o }, SHOP, ADOPTION, 24);
  expect(at(0.5)).toBeDefined();
  expect(at(4)).toBeUndefined();
  expect(at(1, { error_bps: 5_000 })).toBeUndefined(); // (it gets half its units wrong)
  expect(at(1, { scope_bps: 500 })).toBeUndefined(); // (it can do a twentieth of the task)
  // At a price on the margin, references tip it: the same offer is refused with none and taken with several.
  const margin = (refs: number) => appraise({ ...KIOSK, references: refs }, 1, SHOP, ADOPTION, 24);
  let times = 0.2;
  while (!margin(0).worth && times < 3) times += 0.01;
  const edge = (r: number) => appraise({ ...KIOSK, fee_month: KIOSK.fee_month * (times - 0.02), setup: KIOSK.setup * (times - 0.02), exit: KIOSK.exit * (times - 0.02), references: r }, 1, SHOP, ADOPTION, 24);
  expect(edge(10).hurdle_bps).toBeLessThan(edge(0).hurdle_bps);
});

test("more systems are taken only as long as the next does more: the number is the one that frees most for the cost", () => {
  const big: Task = { ...SHOP, units: 6_000 };
  const x = best(KIOSK, big, ADOPTION, 24)!;
  expect(x.n).toBeGreaterThan(1);
  expect(x.units).toBe(Math.min(Math.floor((6_000 * 3_000) / 10_000), x.n * capacityOf(2_600, 8_000)));
});

const lot = (o: Partial<Lot> = {}): Lot => ({ delivery: "d", order: "o", offer: "self-service-point", vendor: "vendors", account: "acc-vendors", task: "serve", kinds: [], title: "Self-service point", systems: ["par.1"], seconds: 2_600, scope_bps: 3_000,
  error_bps: 150, fee_month: 31_000, exit: 465_000, term_days: 1_095, notice_days: 90, oversight_hours_per_month: 6, setup: 2_325_000, since: 0, ...o });

test("at the end of its term a licence is ended when it costs more over the payback than it saves and leaving costs, and kept when it pays", () => {
  expect(dropping(lot(), SHOP, ADOPTION, 24).drop).toBe(false); // (it saves more than it costs)
  const dear = lot({ fee_month: 600_000 });
  expect(dropping(dear, SHOP, ADOPTION, 24).drop).toBe(true);
  // A dear exit keeps it: running a little over what it saves for a few months costs less than leaving.
  const slightly = lot({ fee_month: 31_000 + 90_000, exit: 90_000_000 });
  expect(dropping(slightly, SHOP, ADOPTION, 24).drop).toBe(false);
});

// ---------------------------------------------------------------------------------------------------- an office\'s tender

const offer = (id: string, vendor: string, setup: number, fee: number) => statement(`offer-${id}`, 0, "system_offer", { speaks_for: vendor, visible_to: "public",
  data: { id, vendor, account: `acc-${vendor}`, for: "offices", kinds: ["rates_notice"], template: id, title: id, seconds: 20, speed_bps: 1_500, scope_bps: 6_000, setup, fee_per_year: fee * 12, fee_month: fee, exit: setup / 5, term_days: 1_095, notice_days: 90, oversight_hours_per_month: 10, error_bps: 200, references: 0 } });
const casework = { kinds: ["rates_notice"], person_seconds: { rates_notice: 120 }, wage_month: 450_000, seconds_per_worker_month: 160 * 3600, utilisation_bps: 8_000 };
const kindsOf = (steps: any[]) => steps.flatMap((s) => s.map((l: any) => (Array.isArray(l) ? l[1] : l)).filter((c: any) => c.fn === "statement").map((c: any) => c.args.kind?.text ?? c.args.kind?.id));

test("an office puts a large contract to tender as the law asks, waits for the bids, and awards it to the one that costs least; a small one it orders at once", () => {
  // A large office: 40,000 notices a month (the test\'s own: a city of a million), so a clerk\'s days are worth a system.
  const offers = [offer("sys-a", "vendor-a", 10_000_000, 400_000), offer("sys-b", "vendor-b", 7_500_000, 300_000)];
  const asked = { casework, volume: 40_000, account: "acc-city", balance: 10_000_000_000, keep: 0, staff: 1 };
  const small = new OfficeAdoption("city", new Fleet("city"), ADOPTION, { threshold: 10_000_000_000_000, bid_days: 30 });
  const direct = small.review(bookOf(...offers), 40 * DAY, asked);
  expect(kindsOf(direct)).toContain("order");
  expect(kindsOf(direct)).not.toContain("tender");

  const o = new OfficeAdoption("city", new Fleet("city"), ADOPTION, { threshold: 1_000_000, bid_days: 30 });
  const first = o.review(bookOf(...offers), 40 * DAY, asked);
  expect(kindsOf(first)).toEqual(["tender"]);
  // Open: nothing is decided early.
  expect(o.review(bookOf(...offers), 50 * DAY, asked)).toEqual([]);
  // Closed, with two bids: the dearer is passed over.
  const bid = (id: string, v: string, setup: number, fee: number) => statement(`bid-${id}`, 45 * DAY, "bid", { speaks_for: v, addressed_to: ["city"], data: { tender: "tender-1", ...offer(id, v, setup, fee).data } });
  // (The tender\'s id as the world gave it.)
  (o as any).tender.id = "tender-1";
  const awarded = o.review(bookOf(...offers, bid("sys-a", "vendor-a", 10_000_000, 400_000), bid("sys-b", "vendor-b", 7_500_000, 300_000)), 75 * DAY, asked);
  const placed = awarded.flatMap((s) => s.map((l: any) => (Array.isArray(l) ? l[1] : l))).find((c: any) => c.fn === "statement" && (c.args.kind?.text ?? c.args.kind?.id) === "order")!;
  expect(placed.args.data.json.kind).toBe("system:sys-b");
  expect(placed.args.data.json.unit_price).toBe(7_500_000);
  // With no bids it awards nothing.
  const none = new OfficeAdoption("city", new Fleet("city"), ADOPTION, { threshold: 1_000_000, bid_days: 30 });
  none.review(bookOf(...offers), 40 * DAY, asked);
  (none as any).tender.id = "tender-9";
  expect(kindsOf(none.review(bookOf(...offers), 75 * DAY, asked))).toEqual([]);
});

test("a small office, whose papers cost its staff little, takes none at any of these prices", () => {
  const o = new OfficeAdoption("city", new Fleet("city"), ADOPTION, { threshold: 1_000_000, bid_days: 30 });
  expect(o.review(bookOf(offer("sys-a", "vendor-a", 2_325_000, 31_000)), 40 * DAY, { casework, volume: 400, account: "acc-city", balance: 10_000_000_000, keep: 0, staff: 1 })).toEqual([]);
});

test("a month is thirty days (the licence fee runs by it)", () => expect(MONTH).toBe(30 * DAY));
