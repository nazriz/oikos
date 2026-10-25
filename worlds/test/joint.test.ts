// Joint draws (docs/design/market-realism.md, "ME-17"; risk ME-17): the mechanism, not a seed's town.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate, type TownSpec } from "../generator/generate";
import { fitShared, noneWorking, normCdf, normInv, ranks, savingsRank } from "../generator/joint";

test("the normal's distribution and its inverse agree", () => {
  for (const p of [0.001, 0.02, 0.2, 0.5, 0.7, 0.98, 0.999]) expect(Math.abs(normCdf(normInv(p)) - p)).toBeLessThan(1e-6);
});

test("a shared factor makes households with nobody in work commoner, and the fit finds the weight that gives the survey's share", () => {
  const twos = Array.from({ length: 50 }, () => [0.7, 0.7]);
  expect(noneWorking([0.7, 0.7], 0)).toBeCloseTo(0.09, 10);
  expect(noneWorking([0.7, 0.7], 0.5)).toBeGreaterThan(0.09);
  const rho = fitShared(twos, 0.15);
  expect(rho).toBeGreaterThan(0);
  expect(noneWorking([0.7, 0.7], rho)).toBeCloseTo(0.15, 4);
  // Where each one's own chances already give as many workless households, nothing is shared: the copula cannot make work rarer.
  expect(fitShared(twos, 0.05)).toBe(0);
  // A household with nobody who could work is workless whatever is shared.
  expect(noneWorking([0, 0], 0.5)).toBe(1);
});

test("savings lean on pay by the rank correlation, and on nothing without it", () => {
  const v = Array.from({ length: 2_000 }, (_, i) => (i * 7919 % 2_000 + 0.5) / 2_000);
  const u = Array.from({ length: 2_000 }, (_, i) => (i + 0.5) / 2_000);
  const spearman = (a: number[], b: number[]) => {
    const ra = ranks(a), rb = ranks(b), m = 0.5;
    const cov = ra.reduce((x, y, i) => x + (y - m) * (rb[i]! - m), 0), va = ra.reduce((x, y) => x + (y - m) ** 2, 0), vb = rb.reduce((x, y) => x + (y - m) ** 2, 0);
    return cov / Math.sqrt(va * vb);
  };
  expect(Math.abs(spearman(u, u.map((x, i) => savingsRank(x, v[i]!, 0))) - spearman(u, v))).toBeLessThan(0.01);
  const r = spearman(u, u.map((x, i) => savingsRank(x, v[i]!, 0.31)));
  expect(r).toBeGreaterThan(0.25);
  expect(r).toBeLessThan(0.37);
  // Ties share the middle of their run.
  expect(ranks([5, 0, 0, 9])).toEqual([0.625, 0.25, 0.25, 0.875]);
});

test("in a generated town, those with more pay have more saved where the profile gives the correlation, and not where it gives none", () => {
  const root = join(import.meta.dir, "../..");
  const spec = { ...(Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as TownSpec), citizens: 400 };
  const corr = (profile: string) => {
    const c = generate({ ...spec, profile }) as any;
    const w = c.world;
    const pay = new Map<string, number>();
    for (const r of w.records as any[]) if (r.record === "agreement" && r.terms?.template === "employment") pay.set(r.terms.parties[1], Number(r.terms.commitments[0].does.outcome.money.amount));
    const people = (w.entities as any[]).filter((e) => e.kind === "person" && Math.floor(-e.born_at / (365 * 86_400)) >= 18 && Math.floor(-e.born_at / (365 * 86_400)) < 60);
    const acc = new Map((w.accounts as any[]).map((a) => [a.holder, a.balance as number]));
    const a = ranks(people.map((p) => pay.get(p.id) ?? 0)), b = ranks(people.map((p) => acc.get(p.id) ?? 0)), m = 0.5;
    return a.reduce((x, y, i) => x + (y - m) * (b[i]! - m), 0) / Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) * b.reduce((x, y) => x + (y - m) ** 2, 0));
  };
  // au-vic gives 0.31; ke-nakuru gives none (no source), so its savings have nothing to do with pay.
  expect(corr("au-vic-2026")).toBeGreaterThan(0.1);
  expect(Math.abs(corr("ke-nakuru-2026"))).toBeLessThan(0.1);
});
