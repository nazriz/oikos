// Factories (phase B, stage B4; firm.producer, after Lengnick 2013): goods are made by workers' hours from inputs
// bought at world prices; what isn't kept for customers is exported under each factory's share of the world market's
// demand; stock against demand decides hiring and letting go; what a factory holds beyond its buffer goes to its
// shareholders.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { skillClock } from "./skill";

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
  // Nothing refused but same-moment races (D58; and a new employer naming, on their first day, someone who has
  // already worked a full day at the job they just left: acts take time, so starting the new job is a moment of its own), and households moving into homes still being left.
  expect(ev.filter((e) => e.event === "action_refused" && !["not_present", "not_at_work", "capacity_exceeded", "no_time_left"].includes(e.code))).toEqual([]);
  // Making: at the works, by the factory's own employees, never more than a working day each.
  const employees = new Map<string, Set<string>>();
  for (const a of [...config.world.records, ...recs].filter((r: any) => r.record === "agreement" && r.terms.template === "employment")) {
    const [firm, worker] = a.terms.parties;
    employees.set(firm, (employees.get(firm) ?? new Set()).add(worker));
  }
  const made = ev.filter((e) => e.event === "worked" && e.task === "make");
  expect(made.length).toBeGreaterThan(50);
  // The time it took: the task's, scaled by the crew's mean schooling where skill speeds work (labour_by), exactly as the
  // engine reckons it.
  const labourOf = skillClock(config, ev);
  for (const w of made) {
    const firm = w.at.replace("-works", "");
    expect(w.performers.every((p: string) => employees.get(firm)?.has(p))).toBe(true);
    const want = labourOf(w, task);
    if (want !== undefined) expect(w.labour).toBe(want);
  }
  const perDay = new Map<string, number>();
  for (const w of made) for (const p of w.performers) {
    const k = `${p}|${Math.floor(w.t / DAY)}`;
    perDay.set(k, (perDay.get(k) ?? 0) + Math.ceil(w.labour / w.performers.length));
  }
  expect(Math.max(...perDay.values())).toBeLessThanOrEqual(config.catalogue.working_day);
  // Inputs come from outside at the world price the world market lists when they're ordered, paid with the order.
  const inputs = ev.filter((e) => e.event === "goods_moved" && e.kind === "inputs");
  expect(inputs.length).toBeGreaterThan(0);
  const lists = recs.filter((r) => r.kind === "price_list" && r.speaks_for === "outside");
  for (const o of recs.filter((r) => r.kind === "order" && r.speaks_for.startsWith("factory-") && r.data.kind === "inputs")) {
    // (The list in force, or the one just before: a list republished in the same moment isn't seen yet, D58; an order
    // at the old price is refunded, and made again.)
    const inForce = lists.filter((l) => l.at <= o.at).slice(-2).map((l) => l.data.goods.inputs);
    expect(inForce).toContain(o.data.unit_price);
    // Paid with the order; or, if the bank couldn't pay it (other payments went first), declined unpaid.
    const paid = ev.some((e) => e.event === "transfer" && e.to === "acc-outside" && e.from === `acc-${o.speaks_for}` && e.amount === String(o.data.quantity * o.data.unit_price) && e.t >= o.at);
    const declined = recs.some((r) => r.kind === "delivery_note" && r.data.order === o.id && r.data.declined === "unpaid");
    expect(paid || declined || o.at > 190 * DAY).toBe(true);
  }
  // Exports: paid for at the month's offer price (world prices move), never beyond a factory's share of that month's demand.
  const offersBy = recs.filter((r) => r.kind === "buying_offer" && r.speaks_for === "outside");
  const units = new Map<string, number>();
  // (Payments for exports settle the factory's invoice; other payments from outside are refunds.)
  // (The offer is the one the factory's invoice was made under: an invoice can go out after the next offer.)
  const invoices = new Map(recs.filter((r) => r.kind === "invoice").map((r) => [r.id, r]));
  for (const e of ev.filter((x) => x.event === "transfer" && x.from === "acc-outside" && x.to.startsWith("acc-factory") && x.settles)) {
    const offer = offersBy.find((o) => o.id === invoices.get(e.settles)?.basis)!;
    expect(Number(e.amount) % offer.data.unit_price).toBe(0);
    const f = e.to.replace("acc-", "");
    const k = `${f}|${offer.id}`;
    units.set(k, (units.get(k) ?? 0) + Number(e.amount) / offer.data.unit_price);
    expect(units.get(k)!).toBeLessThanOrEqual(offer.data.quantities[f]);
  }
  expect(units.size).toBeGreaterThan(0);
  void share;
  // Dividends, out of a month's earnings: one instruction to the bank (a bulk payment), in proportion to the shares on
  // the register; the bank pays every line of it.
  const asked = recs.filter((r) => r.kind === "request" && r.speaks_for?.startsWith("factory-") && Array.isArray(r.data?.payments) && r.data.payments[0]?.for === "Dividend.");
  expect(asked.length).toBeGreaterThan(0);
  const register = config.world.records.find((r: any) => r.id === `shareholders-${asked[0].speaks_for}`).data.holders as { account: string; shares: number }[];
  const first = asked[0].data.payments as { to: string; amount: string }[];
  // (Until 2026-10-08 the first two holders were compared, to within 1%: every household held shares in every
  // factory, in large equal lots. A factory's holders are now the outside world, the retirement fund and a few
  // households with holdings of very different sizes (docs/behaviour/firm-ownership.md), so every holder is checked,
  // and exactly: each is paid its share of one amount, rounded down.)
  expect(register.length).toBeGreaterThan(2);
  expect(register.map((h) => h.account)).toContain("acc-outside");
  expect(register.map((h) => h.account)).toContain("acc-fund");
  const paid = register.map((h) => ({ shares: h.shares, got: Number(first.find((m) => m.to === h.account)?.amount ?? 0) }));
  expect(first.length).toBe(paid.filter((p) => p.got > 0).length);
  for (const a of paid) for (const b of paid) expect(Math.abs(a.got * b.shares - b.got * a.shares)).toBeLessThan(Math.max(a.shares, b.shares));
  for (const r of asked.filter((x) => x.at < 170 * DAY)) expect(ev.filter((e) => e.event === "transfer" && e.per_instruction === r.id).length).toBe(r.data.payments.length);
  // The retirement fund (docs/behaviour/firm-ownership.md), paid by the factories as any holder is: it pays its
  // costs to its administrator outside, and its members by one instruction a period, which the bank carries out
  // line by line: a pension to members of the retirement age only, never to anyone not on its register.
  const retirementAge = JSON.parse(readFileSync(join(root, `worlds/profiles/${base.profile}.json`), "utf8")).values.retirement_age as number;
  const born = new Map<string, number>(config.world.records.find((r: any) => r.kind === "fund_members").data.members.map((m: any) => [m.account, m.born_at]));
  const pensions = recs.filter((r) => r.kind === "request" && r.speaks_for === "fund" && Array.isArray(r.data?.payments));
  expect(pensions.length).toBeGreaterThan(0);
  for (const r of pensions) {
    for (const p of r.data.payments as { to: string; for: string }[]) {
      expect(born.has(p.to)).toBe(true);
      if (p.for === "Pension.") expect(Math.floor((r.at - born.get(p.to)!) / (365 * DAY))).toBeGreaterThanOrEqual(retirementAge);
    }
    if (r.at < 170 * DAY) expect(ev.filter((e) => e.event === "transfer" && e.per_instruction === r.id).length).toBe(r.data.payments.length);
  }
  const costs = recs.filter((r) => r.kind === "request" && r.speaks_for === "fund" && r.data?.outcome?.money?.to === "acc-outside");
  expect(costs.length).toBeGreaterThan(0);
  // What it has paid out and still holds is what the factories paid it: it is given nothing else, and spends nothing else.
  const fundIn = ev.filter((e) => e.event === "transfer" && e.to === "acc-fund");
  expect(fundIn.every((e) => String(e.from).startsWith("acc-factory-"))).toBe(true);
  const fundOut = ev.filter((e) => e.event === "transfer" && e.from === "acc-fund").reduce((x, e) => x + Number(e.amount), 0);
  expect(fundOut).toBeLessThanOrEqual(fundIn.reduce((x, e) => x + Number(e.amount), 0));
}, 300_000);

test("Lengnick: with too little demand a factory lets workers go and stops making; with plenty it hires", async () => {
  // The world market wants little of what the factories can make, and the town's shops take only part of the rest.
  const slack = generate({ ...base, citizens: 120, exports_per_month: 2_000_000 });
  const { ev: e1, cmds: c1 } = await run("slack", slack, 5 * MONTH + DAY);
  const letGo = c1.filter((c) => c.participant?.startsWith("factory-") && /letting one worker go/.test(c.reasoning ?? ""));
  // Staff leave both ways: let go, or leaving for a better-paid job on their own (citizen 0.13.0).
  const factoryJobs = new Set([...slack.world.records, ...e1.filter((e) => e.event === "recorded").map((e) => e.record)].filter((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[0].startsWith("factory-")).map((r: any) => r.id));
  const quit = e1.filter((e) => e.event === "recorded" && e.record.record === "notice" && factoryJobs.has(e.record.agreement) && e.record.text === "Resigning: moving to another job.");
  // ... or let go because the money for the next pay period isn't there (slack demand runs a factory's cash down).
  const cashLetGo = c1.filter((c) => c.participant?.startsWith("factory-") && /Can't cover the next pay period/.test(c.reasoning ?? ""));
  expect(letGo.length).toBeGreaterThanOrEqual(1);
  // (At least two of its staff go. Four, before the clinic and the school took four of the town's 120 people's jobs
  // from the factory: generator 0.22.0.)
  expect(letGo.length + cashLetGo.length + quit.length).toBeGreaterThanOrEqual(2);
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
