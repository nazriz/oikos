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
  const code = await p.exited;
  expect(code).toBe(0);
  const left = () => readdirSync(outer).filter(mine).filter((n) => !before.has(n) && !n.startsWith(`oikos-test-${process.pid}-`));
  for (let i = 0; i < 40 && left().some((n) => /leak|oikos-test-/.test(n) && !isLive(n)); i++) await Bun.sleep(250); // (the reaper looks once a second)
  const after = left();
  // (Folders other processes made meanwhile are not ours: only names from the fixture or a dead run's root count.)
  expect(after.filter((n) => /leak/.test(n))).toEqual([]);
  expect(after.filter((n) => n.startsWith("oikos-test-") && !isLive(n))).toEqual([]);
}, 60000);

function isLive(n: string): boolean { const pid = Number(n.split("-")[2]); try { process.kill(pid, 0); return true; } catch { return false; } }
