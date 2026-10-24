// A test run leaves no temp folder behind (scripts/tmp-preload.ts), and the sweep in scripts/disk-tidy.ts finds old ones.
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// The real temp root, not this process's own (the preload moved TMPDIR); a nested run gets TMPDIR of the real one.
const realTmp = () => process.env.OIKOS_TEST_TMP_ROOT ? join(process.env.OIKOS_TEST_TMP_ROOT, "..") : "/private/tmp";
const mine = (n: string) => /^(oikos-|forms-trained|sz-)/.test(n);

test("a test run leaves no new oikos-* folder in the temp root", async () => {
  const outer = realTmp();
  const before = new Set(readdirSync(outer).filter(mine));
  const env = { ...process.env, TMPDIR: outer }; delete (env as Record<string, string | undefined>).OIKOS_TEST_TMP_ROOT;
  const p = Bun.spawn(["bun", "test", join(import.meta.dir, "fixtures/tmp-leak.fixture.ts")], { env, stdout: "pipe", stderr: "pipe", cwd: join(import.meta.dir, "..") });
  const said = (await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])).join("\n");
  const code = await p.exited;
  expect(code).toBe(0);
  // (The fixture's own root. Roots of other test processes that end meanwhile, in a suite running side by side, are not
  // this run's: counting them made the test fail whenever their reapers were slower than ten seconds, 2026-10-24.)
  const root = /FIXTURE_ROOT=\S*\/(oikos-test-[^\s/]+)/.exec(said)?.[1];
  expect(root).toBeDefined();
  const left = () => readdirSync(outer).filter(mine).filter((n) => !before.has(n) && !n.startsWith(`oikos-test-${process.pid}-`));
  const ours = (n: string) => /leak/.test(n) || n === root;
  for (let i = 0; i < 40 && left().some(ours); i++) await Bun.sleep(250); // (the reaper looks once a second)
  const after = left();
  // (Folders other processes made meanwhile are not ours: only names from the fixture, or the fixture run's own root.)
  expect(after.filter((n) => /leak/.test(n))).toEqual([]);
  expect(after.filter((n) => n === root)).toEqual([]);
}, 60000);

