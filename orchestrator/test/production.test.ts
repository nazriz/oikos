// Factories (phase B, stage B4; firm.producer, after Lengnick 2013): goods are made by workers' hours from inputs
// bought at world prices; what isn't kept for customers is exported under each factory's share of the world market's
// demand; stock against demand decides hiring and letting go; what a factory holds beyond its buffer goes to its
// shareholders.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@terrarium/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const MONTH = 30 * DAY;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

async function run(name: string, config: any, until: number) {
  const out = join(root, "runs", `test-production-${name}`);
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config, runId: name, outDir: out, until });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(log.filter((e) => e.kind === "annotation" && (e.body.data?.call_unresolved || e.body.data?.call_unreadable)).map((e) => e.body.data)).toEqual([]);
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const cmds = log.filter((e) => e.kind === "command").map((e) => ({ t: e.t, ...e.body }));
  return { ev, cmds, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record) };
}

test("goods are made from inputs by workers' hours, exported within each factory's share, and profits paid to shareholders", async () => {
  const config = generate(base);
  const trader = config.participants.find((p: any) => p.id === "outside-trade-system").controller.params;
  const share = trader.buys.goods.from as { [f: string]: number };
  const task = config.catalogue.tasks.find((t: any) => t.id === "make");
  const { ev, recs } = await run("town", config, 200 * DAY);
  // Nothing refused but same-moment races (D58), and households moving into homes still being left.
  expect(ev.filter((e) => e.event === "action_refused" && !["not_present", "not_at_work", "capacity_exceeded"].includes(e.code))).toEqual([]);
  // Making: at the works, by the factory's own employees, never more than a working day each.
  const employees = new Map<string, Set<string>>();
  for (const a of [...config.world.records, ...recs].filter((r: any) => r.record === "agreement" && r.terms.template === "employment")) {
    const [firm, worker] = a.terms.parties;
    employees.set(firm, (employees.get(firm) ?? new Set()).add(worker));
  }
  const made = ev.filter((e) => e.event === "worked" && e.task === "make");
  expect(made.length).toBeGreaterThan(50);
  for (const w of made) {
    const firm = w.at.replace("-works", "");
    expect(w.performers.every((p: string) => employees.get(firm)?.has(p))).toBe(true);
    expect(w.labour).toBe(w.units * task.labour);
  }
  const perDay = new Map<string, number>();
  for (const w of made) for (const p of w.performers) {
    const k = `${p}|${Math.floor(w.t / DAY)}`;
    perDay.set(k, (perDay.get(k) ?? 0) + Math.ceil(w.labour / w.performers.length));
  }
  expect(Math.max(...perDay.values())).toBeLessThanOrEqual(config.catalogue.working_day);
  // Inputs come from outside at the world price.
  const inputs = ev.filter((e) => e.event === "goods_moved" && e.kind === "inputs");
  expect(inputs.length).toBeGreaterThan(0);
  for (const g of inputs) expect(ev.some((e) => e.event === "transfer" && e.to === "acc-outside" && e.from === `acc-${g.to}` && e.amount === String(Number(g.quantity) * trader.sells.inputs) && e.t <= g.t)).toBe(true);
  // Exports: paid for at the world price, never beyond a factory's share of a month's demand.
  const paid = new Map<string, number>();
  // (Payments for exports settle the factory's invoice; other payments from outside are refunds.)
  for (const e of ev.filter((x) => x.event === "transfer" && x.from === "acc-outside" && x.to.startsWith("acc-factory") && x.settles)) {
    const k = `${e.to}|${Math.floor(e.t / MONTH)}`;
    paid.set(k, (paid.get(k) ?? 0) + Number(e.amount));
  }
  expect(paid.size).toBeGreaterThan(0);
  for (const [k, x] of paid) {
    const f = k.split("|")[0]!.replace("acc-", "");
    expect(x % trader.buys.goods.unit_price).toBe(0);
    expect(x / trader.buys.goods.unit_price).toBeLessThanOrEqual(share[f]!);
  }
  // Dividends, out of a month's earnings: in proportion to the shares on the register.
  const asked = recs.filter((r) => r.kind === "request" && r.speaks_for?.startsWith("factory-") && r.data?.outcome?.money?.for === "Dividend.");
  expect(asked.length).toBeGreaterThan(0);
  const register = config.world.records.find((r: any) => r.id === `shareholders-${asked[0].speaks_for}`).data.holders as { account: string; shares: number }[];
  const first = asked.filter((r) => r.at === asked[0].at && r.speaks_for === asked[0].speaks_for).map((r) => r.data.outcome.money);
  const [a, b] = [register[0]!, register[1]!];
  const [pa, pb] = [a, b].map((h) => Number(first.find((m: any) => m.to === h.account)?.amount)) as [number, number];
  expect(Math.abs(pa / pb - a.shares / b.shares)).toBeLessThan(0.01);
}, 300_000);

test("Lengnick: with too little demand a factory lets workers go and stops making; with plenty it hires", async () => {
  // The world market wants little of what the factories can make, and the town's shops take only part of the rest.
  const slack = generate({ ...base, citizens: 120, exports_per_month: 2_000_000 });
  const { ev: e1, cmds: c1 } = await run("slack", slack, 5 * MONTH + DAY);
  const letGo = c1.filter((c) => c.participant?.startsWith("factory-") && /letting one worker go/.test(c.reasoning ?? ""));
  expect(letGo.length).toBeGreaterThanOrEqual(4);
  expect(e1.filter((e) => e.event === "recorded" && e.record.record === "notice" && e.record.text?.startsWith("Redundancy: we're making more")).length).toBe(letGo.length);
  // Beyond the top of Lengnick's band (last month's demand: the shops' orders, and its share of the world market's
  // offer) a factory makes nothing, though its staff could make far more: a day's making never takes its stock past
  // the band's top. (Stock made earlier may stay above it, unsold; making stops.)
  const recs1 = e1.filter((e) => e.event === "recorded").map((e) => e.record);
  for (const f of ["factory-1", "factory-2"]) {
    // What the shops ordered, as the factory counts it: orders paid that month, in full, met or not (its delivery notes).
    const ordered = (m: number) => recs1.filter((r) => r.kind === "delivery_note" && r.speaks_for === f && !r.data.declined && Math.floor(r.at / MONTH) === m).reduce((x, r) => x + r.data.ordered, 0);
    const quota = (m: number) => recs1.filter((r) => r.kind === "buying_offer" && Math.floor(r.at / MONTH) === m).reduce((x, r) => x + (r.data.quantities?.[f] ?? 0), 0);
    let stock = Number(slack.world.holdings.find((h: any) => h.holder === f && h.kind === "goods")?.quantity ?? 0);
    for (const e of e1) {
      if (e.event === "goods_moved" && e.kind === "goods" && e.from === f) stock -= Number(e.quantity);
      if (e.event === "goods_moved" && e.kind === "goods" && e.to === f) stock += Number(e.quantity);
      if (e.event === "worked" && e.task === "make" && e.at === `${f}-works`) {
        stock += e.units;
        const m = Math.floor(e.t / MONTH);
        if (m >= 1) {
          expect(stock).toBeLessThanOrEqual(ordered(m - 1) + quota(m - 1) + 1);
        }
      }
    }
  }
  // Twice what they can make: they post jobs for a bigger headcount each month, up to the works' room.
  const busy = generate({ ...base, citizens: 120, exports_per_month: 120_000_000 });
  const { cmds: c2 } = await run("busy", busy, 4 * MONTH + DAY);
  const posts = c2.filter((c) => c.participant?.startsWith("factory-") && /Short of this month's headcount .*stock .* was below/.test(c.reasoning ?? ""));
  expect(posts.length).toBeGreaterThanOrEqual(3);
}, 300_000);
