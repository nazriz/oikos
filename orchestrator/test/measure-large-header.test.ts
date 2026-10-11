// A log whose first line (the config header) is over DuckDB's default 16 MB JSON object limit is measured all the same
// (a 3,000-person town's header is 36 MB, a 10,000-person town's 123 MB). The header here is padded with a field
// nothing reads; the measures and the cost report must come out as for the unpadded log.

import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";
import { exportLogs, firstLineBytes, objectLimitFor, query } from "@oikos/measure";
import { costReport } from "../src/cost";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;

test("a log with a header over 16 MB is measured, plain or compressed, and costed", async () => {
  const { generate } = await import("@oikos/worlds/generator/generate");
  const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
  const out = join(root, "runs", "test-measure-large-header");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const small = (await runWorld({ config: { ...generate({ ...spec, citizens: 30 }), seed: 7 }, runId: "town.seed7", outDir: out, until: 2 * DAY })).logPath;
  // The same run, its header padded to about 20 MB (a field the measures don't read), as a plain log and a compressed one.
  const lines = readFileSync(small, "utf8").split("\n");
  const header = JSON.parse(lines[0]!);
  header.body.config.padding_for_the_test = "x".repeat(20 * 1024 * 1024);
  lines[0] = JSON.stringify(header);
  const bigDir = join(out, "big");
  mkdirSync(bigDir, { recursive: true });
  const big = join(bigDir, "town.seed7.jsonl");
  writeFileSync(big, lines.join("\n"));
  expect(await firstLineBytes(big)).toBeGreaterThan(20 * 1024 * 1024);
  expect(await objectLimitFor(big)).toBeGreaterThanOrEqual(2 * (await firstLineBytes(big)));
  expect(await objectLimitFor(small)).toBe(16_777_216); // (a header within the default keeps it)
  const zst = join(bigDir, "z.seed7.jsonl.zst");
  writeFileSync(zst, zlib.zstdCompressSync(readFileSync(big)));
  expect(await firstLineBytes(zst)).toBe(await firstLineBytes(big));

  const plainOut = join(out, "measure-small");
  await exportLogs([small], plainOut);
  const bigOut = join(out, "measure-big");
  expect((await exportLogs([big], bigOut)).map((r) => r.entries)).toEqual([lines.filter(Boolean).length]);
  const counts = async (d: string) => (await query(d, `select (select count(*) from participants) as participants, (select count(*) from entities) as entities, (select count(*) from runs) as runs, (select count(*) from accounts) as accounts`))[0];
  expect(await counts(bigOut)).toEqual(await counts(plainOut));
  expect(((await counts(bigOut)) as any).participants).toBeGreaterThan(0);
  // (The compressed form, read the same way.)
  const zOut = join(out, "measure-zst");
  await exportLogs([zst], zOut);
  expect(await counts(zOut)).toEqual(await counts(plainOut));
  expect((await costReport(bigOut, {})).text).toContain("Cost report");
  rmSync(out, { recursive: true, force: true });
}, 120_000);
