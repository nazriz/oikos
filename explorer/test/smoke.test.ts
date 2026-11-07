// The Bevy explorer end to end, in headless Chromium: a small code-only run is made, served as `oikos explore --engine
// bevy` serves it (the Rust data layer behind the Bun server), and the page is driven as a researcher would: the town is
// drawn (M1), time plays and scrubs (M2), a search opens a person's panel and the address keeps the view (M3), the
// overlays and their legends switch (M4), the workbench's tables answer (M7). Screenshots go to docs/explorer-shots/
// when OIKOS_SHOTS=1. Skipped, with a message, when the WebAssembly scene is not built (`bun explorer/build.ts`), the
// data layer is not built (`cargo build --release -p oikos-explore` in kernel/), or Playwright is not installed.
// Without a GPU, Chromium draws WebGL 2 in software (SwiftShader): slow, but the same pictures.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pilotRuns } from "../../renderer/src/paths";
import { rustBinary, startRust, type RustLayer } from "../../renderer/src/rust";
import { bevyBuilt, serve } from "../../renderer/src/server";

const REPO = join(import.meta.dir, "..", "..");
const SHOTS = join(REPO, "docs", "explorer-shots");
/** Playwright: the project's, or a machine-wide install (NODE_PATH, as a CI image or this environment has it). */
async function findPlaywright(): Promise<any> {
  for (const spec of ["playwright", ...(process.env.NODE_PATH ?? "").split(":").filter(Boolean).map((d) => join(d, "playwright")), "/opt/node-tools/node_modules/playwright"]) {
    try { return await import(spec); } catch { /* (not there) */ }
  }
  return undefined;
}
const playwright = await findPlaywright();
const why = !bevyBuilt().includes("webgl2") ? "the WebAssembly scene is not built (bun explorer/build.ts)" : !rustBinary() ? "oikos-explore is not built" : !playwright ? "playwright is not installed" : "";
if (why) console.log(`skipped: ${why}`);
const it = why ? test.skip : test;

const base = mkdtempSync(join(tmpdir(), "oikos-bevy-"));
let url = "", layer: RustLayer | undefined, server: any, browser: any, page: any;

beforeAll(async () => {
  if (why) return;
  const out = join(base, "runs", "town-3d");
  // (a code-only town, three days: no model is called)
  const r = Bun.spawnSync(["bun", join(REPO, "orchestrator", "src", "cli.ts"), "run", join(REPO, "worlds", "town.yaml"), "--until", String(3 * 86400), "--out", out, "--no-measure"], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(new TextDecoder().decode(r.stderr));
  const runs = pilotRuns("/nonexistent", [out]);
  layer = await startRust(runs, { withPilots: false });
  const s = await serve({ port: 0, prefix: "/explore", runs, single: runs[0]!.key, api: layer.api, engine: "bevy" });
  server = s.server; url = s.url;
  browser = await playwright.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e: Error) => console.error("page:", e.message));
}, 180_000);

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
  layer?.stop();
  rmSync(base, { recursive: true, force: true });
}, 60_000);

const shot = async (name: string) => {
  if (process.env.OIKOS_SHOTS !== "1") return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};
const ready = () => page.waitForFunction(() => (window as any).OIKOS_READY, null, { timeout: 120_000 });

it("M1: the town is drawn from the run's index, and the scene reports what it holds", async () => {
  await page.goto(`${url}#gl=1`);
  await ready();
  const ev = await page.evaluate(() => (window as any).OIKOS_READY);
  expect(ev.persons).toBeGreaterThan(100);
  expect(ev.structures).toBeGreaterThan(20);
  expect(ev.backend).toBe("WebGL 2");
  // (a blank canvas compresses to almost nothing; the town does not. Drawn in software, the first frames can take seconds)
  let png = 0;
  for (let i = 0; i < 90 && png <= 60_000; i++) { await page.waitForTimeout(1000); png = (await page.locator("#stage").screenshot()).length; }
  expect(png).toBeGreaterThan(60_000);
  await shot("m1-town");
}, 180_000);

it("M2: time plays, pauses and scrubs; the clock and the address follow", async () => {
  const t0 = await page.evaluate(() => Number(new URLSearchParams(location.hash.slice(1)).get("t") ?? 0));
  await page.keyboard.press("]"); // faster
  const before = await page.locator("#ctime").textContent();
  await page.keyboard.press("Space");
  await page.waitForFunction((b: string) => document.querySelector("#ctime")?.textContent !== b, before, { timeout: 60_000 });
  await page.keyboard.press("Space");
  await page.waitForFunction((t: number) => Number(new URLSearchParams(location.hash.slice(1)).get("t")) > t, t0, { timeout: 30_000 });
  const t1 = await page.evaluate(() => Number(new URLSearchParams(location.hash.slice(1)).get("t")));
  expect(t1).toBeGreaterThan(t0);
  // scrub: a click on the timeline at its middle is about the middle of the run
  const box = await page.locator(".tl-canvas").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 12);
  await page.waitForFunction(() => /day 1/.test(document.querySelector("#cday")?.textContent ?? ""), null, { timeout: 30_000 });
  // night: the hour's light (a screenshot at 22:00)
  await page.evaluate(() => { location.hash = location.hash.replace(/t=\d+/, "t=165600"); });
  await page.waitForFunction(() => document.querySelector("#ctime")?.textContent === "22:00", null, { timeout: 30_000 });
  await page.waitForTimeout(3000);
  await shot("m2-night");
}, 120_000);

it("M3: search opens a person's panel through the bridge, and the address brings it back", async () => {
  await page.keyboard.press("/");
  await page.keyboard.type("c0001");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".inspector.open .ph h2", { timeout: 30_000 });
  expect(await page.locator(".inspector .ph h2").textContent()).toBe("c0001");
  await page.waitForTimeout(800);
  expect(page.url()).toContain("sel=person%3Ac0001");
  await shot("m3-person");
  // a building, picked in the scene: the centre of the view is the town
  await page.keyboard.press("Escape");
  const href = page.url();
  await page.goto("about:blank");
  await page.goto(href.replace(/sel=[^&]*/, "sel=person%3Ac0002"));
  await ready();
  await page.waitForSelector(".inspector.open .ph h2", { timeout: 30_000 });
  expect(await page.locator(".inspector .ph h2").textContent()).toBe("c0002");
}, 180_000);

it("M4: the overlays switch, each with its legend and definition", async () => {
  await page.click('#modes button[data-mode="decided"]');
  await page.waitForTimeout(3000);
  expect(await page.locator("#legend").textContent()).toContain("last 30 days");
  await shot("m4-decided");
  await page.click('#modes button[data-mode="hardship"]');
  await page.waitForTimeout(3000);
  expect(await page.locator("#legend").textContent()).toContain("sense of agency");
  expect(page.url()).toContain("ov=hardship");
  await shot("m4-hardship");
  await page.click('#modes button[data-mode="town"]');
}, 60_000);

it("M7: the workbench draws a measure over time from the run's log, and its tables export", async () => {
  await page.click('#ws button[data-ws="bench"]');
  await page.waitForSelector("#wbchart svg", { timeout: 120_000 });
  expect(await page.locator(".wb-h").textContent()).toContain("decisions");
  await page.waitForTimeout(600); // (the address is written a quarter second after a change)
  expect(page.url()).toContain("ws=bench");
  await shot("m7-workbench");
  const csv = await page.evaluate(async () => (await fetch(document.querySelector<HTMLAnchorElement>(".wb-export a")!.href)).text());
  expect(csv.split("\r\n")[0]).toMatch(/^run,day,decisions/);
  const pq = await page.evaluate(async () => { const b = new Uint8Array(await (await fetch(document.querySelectorAll<HTMLAnchorElement>(".wb-export a")[1]!.href)).arrayBuffer()); return String.fromCharCode(...b.slice(0, 4)); });
  expect(pq).toBe("PAR1");
  await page.click('[data-tab="events"]');
  await page.waitForSelector(".wb-table.events tbody tr", { timeout: 60_000 });
  await page.click('[data-tab="cohorts"]');
  await page.waitForSelector(".wb-grid svg", { timeout: 60_000 });
  await page.click('#ws button[data-ws="map"]');
}, 240_000);
