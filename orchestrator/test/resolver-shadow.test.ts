// The two resolvers agree. Runs use the engine's (kernel/crates/resolver, a port in Rust); the one with unit tests of
// its own, and the one the translator's test set runs on, is this repository's TypeScript one (translator/src). In
// shadow mode a run resolves every call both ways and stops at the first difference. Until 2026-10-05 no test ran in
// shadow mode, so the resolver every run depends on was checked only by hand (the code audit of that day).

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

// (The shadow is the host's: it resolves the calls its own units make both ways. On the Rust world the engine resolves
// every code actor's calls itself, with the one resolver it has, so there is nothing for a second to shadow; that the
// two agree is what this shows on the TS world's run, and the translator's test set runs the TS resolver on its own.)
const tsOnly = process.env.OIKOS_WORLD === "rust" ? test.skip : test;

tsOnly("sixty days of the town, every call resolved by both resolvers: no difference", async () => {
  const out = join(root, "runs/test-resolver-shadow");
  rmSync(out, { recursive: true, force: true });
  // (The resolver is chosen when the run's code loads, so this run is a process of its own.)
  const p = Bun.spawn(["bun", "orchestrator/src/cli.ts", "run", "worlds/town.yaml", "--seeds", "1", "--until", String(60 * 86_400), "--out", out, "--no-measure"],
    { cwd: root, env: { ...process.env, OIKOS_RESOLVER: "shadow", NODE_ENV: "test" }, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  expect(`${code} ${stderr.slice(-2000)}`).toStartWith("0 ");
  expect(stdout).not.toContain("FAILED");
  const summary = JSON.parse(readFileSync(join(out, "town.seed1.summary.json"), "utf8"));
  expect(summary.resolverShadow.differed).toBe(0);
  expect(summary.resolverShadow.checked).toBeGreaterThan(10_000);
}, 300_000);
