// Every number has a basis, in the code (law 11: docs/design/foundations-2.md 5.1 and 5.2, step N4). A number in the
// engine's behaviour code or the generator is a convention, read from parameters, or declared once in a figure registry
// with its class and source (`kernel/crates/actors/src/figures.rs`, `worlds/generator/registry.ts`). The literals that are
// none of these today are counted by file in the inventory (`fixtures/code-figures-inventory.json`), which only shrinks:
// a file with more fails (a new figure goes into a registry or a parameter), a file with fewer fails until its count is
// lowered here, so the change that moves a figure says so. The numbers of a world's config are figures.test.ts's.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CODE_INVENTORY, codeFigures, literals, REGISTRIES, unclassed } from "./lib/law11";

const root = join(import.meta.dir, "../..");

test("no file of the engine's behaviour or the generator holds more literal figures than the inventory, and none fewer unsaid; every registered figure has its class", () => {
  const inv = JSON.parse(readFileSync(CODE_INVENTORY, "utf8")).files as Record<string, number>;
  const now = codeFigures(root);
  const more = Object.entries(now).filter(([f, n]) => n > (inv[f] ?? 0)).map(([f, n]) => `${f}: ${n} (inventory ${inv[f] ?? 0}): a new figure goes into a registry, with its class and source, or into a parameter`);
  const fewer = Object.entries(inv).filter(([f, n]) => (now[f] ?? 0) < n).map(([f, n]) => `${f}: ${now[f] ?? 0} (inventory ${n}): lower it in the inventory`);
  expect(more).toEqual([]);
  expect(fewer).toEqual([]);
  for (const r of REGISTRIES) expect(unclassed(readFileSync(join(root, r), "utf8")), r).toEqual([]);
});

test("it counts what code computes with: not a convention, a comment, a string or a test", () => {
  const rs = 'fn f() { let a = 7 * DAY; let b = 1_500; // 2_500 in a comment\n let c = "4_200"; let d = 10_000; let e = 0.35; }\n#[cfg(test)]\nmod tests { fn t() { let x = 9_999; } }';
  expect(literals(rs, true)).toEqual(["1500", "0.35"]);
  expect(literals("const x = 1.4 * y; /* 77 */ const s = `${3}21`; const id = c0042;", false)).toEqual(["1.4"]);
  expect(unclassed("/// placeholder: a guess (risk X)\npub const A: i64 = 3;\npub const B: i64 = 4;")).toEqual(["B"]);
});
