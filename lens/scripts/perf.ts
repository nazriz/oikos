#!/usr/bin/env bun
// Frame times of the map in a real Chrome window with the GPU (not the headless software renderer): idle, panning by
// mouse drag, playing at the page's speed, and playing zoomed out.
//   bun lens/scripts/perf.ts [url]
// Default url: the city dev page (bun lens/src/client/city/dev.ts) on day 124 at 08:48. Needs a display and
// playwright-core: it is not a Lens dependency, so the script loads it from $LENS_PLAYWRIGHT or the dev folder
// beside the runs (~/oikos/runs/views/lens-dev/node_modules/playwright-core).
import { homedir } from "node:os";
import { join } from "node:path";

const pw = process.env.LENS_PLAYWRIGHT ?? join(homedir(), "oikos/runs/views/lens-dev/node_modules/playwright-core");
const { chromium } = await import(pw);
const url = process.argv[2] ?? "http://127.0.0.1:4329/?day=124&hour=8.8&theme=dark&speed=3600";
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await chromium.launch({ headless: false, executablePath: chrome, args: ["--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
p.on("pageerror", (e: unknown) => console.log("pageerror:", String(e).slice(0, 300)));
type Stats = { avg: number; p95: number; max: number; n: number };
const measure = (ms: number): Promise<Stats> => p.evaluate((ms: number) => new Promise<Stats>((res) => {
  const ts: number[] = []; let last = performance.now(); const t0 = last;
  const f = (now: number) => { ts.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(f); else { ts.sort((a, b) => a - b); res({ avg: ts.reduce((a, b) => a + b, 0) / ts.length, p95: ts[Math.floor(ts.length * 0.95)]!, max: ts[ts.length - 1]!, n: ts.length }); } };
  requestAnimationFrame(f);
}), ms);
const show = (what: string, s: Stats) => console.log(`${what.padEnd(16)} avg ${s.avg.toFixed(1)} ms  p95 ${s.p95.toFixed(1)} ms  max ${s.max.toFixed(1)} ms  (${s.n} frames)`);

await p.goto(url, { waitUntil: "load" });
await p.waitForTimeout(6000);
const gl = await p.evaluate(() => { const c = document.createElement("canvas").getContext("webgl2"); const d = c?.getExtension("WEBGL_debug_renderer_info"); return d ? c!.getParameter(d.UNMASKED_RENDERER_WEBGL) : "?"; });
console.log("renderer:", gl);
show("idle", await measure(2000));
const pan = (async () => { await p.mouse.move(700, 450); await p.mouse.down(); for (let i = 0; i < 120; i++) { await p.mouse.move(700 + Math.sin(i / 10) * 300, 450 + Math.cos(i / 13) * 160); await p.waitForTimeout(16); } await p.mouse.up(); })();
show("pan", await measure(2500));
await pan;
await p.click("text=Play").catch(() => {});
show("play", await measure(3000));
await p.mouse.wheel(0, 900);
await p.waitForTimeout(800);
show("play zoomed out", await measure(3000));
await b.close();
