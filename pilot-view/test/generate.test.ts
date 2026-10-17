// The viewer on a small mock run (scripts/pilot-mock.ts): it writes one self-contained page, and it changes nothing in the run.

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockPilot } from "../../scripts/pilot-mock";
import { buildView } from "../src/build";
import { runPilotView } from "../src/cli";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oikos-pilot-view-test-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const entry = { name: "pv", world: "worlds/town.yaml", sets: ["citizens=20", "mayor=llm"], model: "codex/gpt-6.1-sol", translator: "decide/pod-small-d16-s1", until: 100 * 86_400, budget: 25, env: { OIKOS_CLAUDE_BIN: "/nonexistent" } };

const snapshot = (dir: string) => readdirSync(dir, { recursive: true }).map(String).sort().map((f) => { const s = statSync(join(dir, f)); return `${f}:${s.isDirectory() ? "d" : s.size}:${s.mtimeMs}`; });

test("a mock pilot becomes one self-contained page, and the run is left exactly as it was", async () => {
  const out = join(base, "w.mock");
  expect(await mockPilot(entry, out, 3)).toMatchObject({ generated: true, ranToEnd: true });
  const run = join(out, "pv");
  const before = snapshot(run);
  const page = join(base, "views", "pv.html");
  await runPilotView([run, "--out", page, "--quiet"]);
  expect(snapshot(run)).toEqual(before);

  const html = readFileSync(page, "utf8");
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toContain('<meta name="viewport"');
  expect(html).toContain("prefers-color-scheme: dark");
  // no network: nothing is fetched from anywhere
  expect(html).not.toMatch(/(src|href)=["']https?:/);
  expect(html).not.toMatch(/\bfetch\(|XMLHttpRequest|import\(/);
  expect(statSync(page).size).toBeLessThan(10_000_000);

  const data = JSON.parse(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!);
  expect(data.overview.days).toBeGreaterThan(2);
  expect(data.overview.seats.length).toBeGreaterThan(0);
  expect(data.seats[0].sittings.length).toBeGreaterThan(0);
  expect(data.actors.length).toBeGreaterThan(0);
  expect(data.town.series.acts.length).toBe(3);
  expect(data.twin).toBeNull();
}, 180_000);

test("the viewer refuses to write inside a run's folder, and a folder with no log", async () => {
  const run = join(base, "w.mock", "pv");
  await expect(runPilotView([run, "--out", join(run, "view.html"), "--quiet"])).rejects.toThrow("only reads");
  expect(existsSync(join(run, "view.html"))).toBe(false);
  await expect(buildView(base)).rejects.toThrow("no run log");
}, 60_000);
