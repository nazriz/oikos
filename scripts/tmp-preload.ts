// Before the tests: every temporary folder a test makes (mkdtemp under os.tmpdir(), here or in a child process) lands
// in one folder of this process's own, oikos-test-<pid>-<random>, and that folder is removed when the process ends,
// pass or fail. TMPDIR points at it, so children (the kernel, the orchestrator CLI, nested `bun test`) inherit it.
// Before this, thousands of oikos-*/forms-trained*/sz-* folders (some of several GB) piled up in /tmp. A process killed
// outright (SIGKILL) leaves its folder; scripts/disk-tidy.ts sweeps those after a day.
import { afterAll } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.OIKOS_TEST_TMP_OFF && !process.env.OIKOS_TEST_TMP_ROOT) {
  const root = mkdtempSync(join(tmpdir(), `oikos-test-${process.pid}-`));
  process.env.OIKOS_TEST_TMP_ROOT = root;
  process.env.TMPDIR = root;
  // (Bun starts a child with the environment the process began with unless told otherwise: default it to the current one.)
  for (const k of ["spawn", "spawnSync"] as const) {
    const orig = Bun[k].bind(Bun) as (...a: unknown[]) => unknown;
    (Bun as unknown as Record<string, unknown>)[k] = (cmd: unknown, opts?: Record<string, unknown>) => {
      const o = Array.isArray(cmd) ? opts : (cmd as Record<string, unknown>);
      if (o && !("env" in o)) o.env = { ...process.env };
      else if (!o && Array.isArray(cmd)) return orig(cmd, { env: { ...process.env } });
      return orig(cmd, opts);
    };
  }
  const clean = () => { try { rmSync(root, { recursive: true, force: true }); } catch { /* already gone */ } };
  process.on("exit", clean);
  // (bun test does not always run exit handlers; after a file, empty the folder but keep it for the next file.)
  afterAll(() => { try { for (const e of readdirSync(root)) rmSync(join(root, e), { recursive: true, force: true }); } catch { /* gone */ } });
  // A reaper outlives this process, however it ends (bun test runs no exit handlers; SIGKILL runs nothing): when the pid is gone, the folder goes.
  try { Bun.spawn(["sh", "-c", `while kill -0 ${process.pid} 2>/dev/null; do sleep 1; done; rm -rf "$1"`, "reaper", root], { stdio: ["ignore", "ignore", "ignore"], env: { PATH: "/usr/bin:/bin" } }).unref(); } catch { /* no reaper: the sweep gets it */ }
  for (const s of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(s, () => { clean(); process.exit(128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 })[s]); });
}
