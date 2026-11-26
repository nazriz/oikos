#!/usr/bin/env bun
// Flicker and smoothness of Lens, measured in a real Chrome window with the GPU: for each thing a viewer does (idle,
// play at each speed, scrub, hover, open a turn, Map/3D, theme, mode, library to run and back) it reports
//   commits/s   React commits a second, and the components that rendered most (from React's devtools hook)
//   dom/s       DOM nodes added or removed a second outside the canvases (panels remounting, labels popping)
//   cls         layout shift (the browser's own measure)
//   long        long tasks (over 50 ms): how many, and their total
//   fps / p95   rAF frame times
//   blinks      screencast frames where a region changed and changed back within three frames (A-B-A): flicker
//               in pixels, counted over the whole page, where a tenth of the page or more blinked (a strobe), and
//               outside the canvases. Small ones while playing or scrubbing are mostly people moving.
//   swings/s    the page's brightness turning between rising and falling, a second: day and night pulsing
//   blank       frames that are one flat colour (a white or empty flash) on a route change
//   ready ms    on a route change: from the click to the run's map canvas, the rail's words and the timeline in place
//   bun lens/scripts/flicker.ts [base url] [run key] [--only a,b] [--out DIR] [--theme dark|light] [--mode story|researcher]
// Default url http://127.0.0.1:4340 (start one: bun orchestrator/src/cli.ts lens --port 4340), run: the first indexed
// model run in the library. Needs a display and playwright-core (not a Lens dependency: $LENS_PLAYWRIGHT, else the dev
// folder beside the runs). Writes report.json and the frames' blink maps to --out (default runs/views/lens-dev/smooth/<stamp>).
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const pos = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1]!.startsWith("--")));
const base = (pos[0] ?? "http://127.0.0.1:4340").replace(/\/$/, "");
const only = opt("only")?.split(",");
const out = opt("out") ?? join(homedir(), "oikos/runs/views/lens-dev/smooth", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
const theme = opt("theme") ?? "dark", mode = opt("mode") ?? "researcher";
mkdirSync(out, { recursive: true });

const pw = process.env.LENS_PLAYWRIGHT ?? join(homedir(), "oikos/runs/views/lens-dev/node_modules/playwright-core");
const { chromium } = await import(pw);
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let key = pos[1];
if (!key) {
  const runs = ((await (await fetch(`${base}/api/runs`)).json()) as { runs: { key: string; indexed?: boolean; experiment?: { isCode?: boolean } }[] }).runs;
  key = runs.find((r) => r.indexed && r.experiment && !r.experiment.isCode)?.key ?? runs.find((r) => r.indexed)?.key;
  if (!key) throw new Error("no indexed run: open one in Lens first");
}
const runUrl = (q = "") => `${base}/#/run/${encodeURIComponent(key!)}${q}`;

// In the page before anything else: React's commit hook, a DOM mutation count, layout shifts and long tasks.
const probe = () => {
  const w = window as any;
  const fl = (w.__fl = { commits: 0, renders: new Map<string, number>(), shifts: new Map<string, number>(), dom: 0, cls: 0, longN: 0, longMs: 0 });
  const seen = new WeakMap<object, [unknown, unknown]>();
  const nameOf = (f: any): string => {
    const t = f.type;
    let n = (t && (t.displayName || t.name)) || (t?.render && (t.render.displayName || t.render.name)) || (t?.type && (t.type.displayName || t.type.name)) || "?";
    // (Names are minified in the served build: the first element's class says which component it is.)
    let c = f.child;
    while (c && typeof c.type !== "string") c = c.child;
    const cls = c?.stateNode?.className;
    if (typeof cls === "string" && cls) n += `.${cls.trim().split(/\s+/)[0]}`;
    return n;
  };
  const walk = (f: any) => {
    while (f) {
      if (f.tag === 0 || f.tag === 1 || f.tag === 11 || f.tag === 14 || f.tag === 15) {
        const k = seen.has(f) ? f : f.alternate && seen.has(f.alternate) ? f.alternate : f;
        const prev = seen.get(k);
        if (!prev || prev[0] !== f.memoizedProps || prev[1] !== f.memoizedState) {
          seen.set(k, [f.memoizedProps, f.memoizedState]);
          if (prev) { const n = nameOf(f); fl.renders.set(n, (fl.renders.get(n) ?? 0) + 1); }
        }
      }
      if (f.child) walk(f.child);
      f = f.sibling;
    }
  };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(), supportsFiber: true, isDisabled: false, checkDCE() {}, inject() { return 1; },
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, setStrictMode() {},
    onCommitFiberRoot(_id: number, root: any) { fl.commits++; walk(root.current.child); },
  };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries() as any[]) {
      if (e.hadRecentInput) continue;
      fl.cls += e.value;
      for (const s of e.sources ?? []) { const n = s.node as Element | undefined; const k = n ? `${n.nodeName.toLowerCase()}.${(n as HTMLElement).className || ""}`.slice(0, 60) : "?"; fl.shifts.set(k, (fl.shifts.get(k) ?? 0) + e.value); }
    }
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { fl.longN++; fl.longMs += e.duration; } }).observe({ type: "longtask", buffered: true });
  const mo = new MutationObserver((ms) => { for (const m of ms) if (m.type === "childList") fl.dom += m.addedNodes.length + m.removedNodes.length; });
  addEventListener("DOMContentLoaded", () => mo.observe(document.body, { childList: true, subtree: true }));
};

const b = await chromium.launch({ headless: false, executablePath: chrome, args: ["--enable-gpu", "--ignore-gpu-blocklist", "--window-size=1600,1100"] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addInitScript(probe);
await ctx.addInitScript(([th, md]: string[]) => { try { localStorage.setItem("lens.theme", th!); localStorage.setItem("lens.mode", md!); localStorage.setItem("lens.toured", "1"); } catch {} }, [theme, mode]);
const p = await ctx.newPage();
const errors: string[] = [];
p.on("pageerror", (e: unknown) => errors.push(String(e).slice(0, 300)));
const cdp = await ctx.newCDPSession(p);
// (A second page decodes the screencast frames: the browser's own JPEG decoder, no image library needed.)
const lab = await ctx.newPage();
await lab.goto("about:blank");
await p.bringToFront();

type Frame = { data: string; ts: number };
let frames: Frame[] | null = null;
cdp.on("Page.screencastFrame", async (f: { data: string; sessionId: number; metadata: { timestamp: number } }) => {
  frames?.push({ data: f.data, ts: f.metadata.timestamp });
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 800, maxHeight: 500, everyNthFrame: 1 });

const snap = () => p.evaluate(() => { const f = (window as any).__fl; return f ? { commits: f.commits, dom: f.dom, cls: f.cls, longN: f.longN, longMs: f.longMs, renders: Object.fromEntries(f.renders), shifts: Object.fromEntries(f.shifts) } : null; });
const fps = (ms: number) => p.evaluate((ms: number) => new Promise<{ avg: number; p95: number; max: number }>((res) => {
  const ts: number[] = []; let last = performance.now(); const t0 = last;
  const f = (now: number) => { ts.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(f); else { ts.sort((a, b) => a - b); res({ avg: ts.reduce((a, b) => a + b, 0) / ts.length, p95: ts[Math.floor(ts.length * 0.95)]!, max: ts.at(-1)! }); } };
  requestAnimationFrame(f);
}), ms);
const canvases = () => p.evaluate(() => [...document.querySelectorAll("canvas")].map((c) => { const r = c.getBoundingClientRect(); return [r.left / innerWidth, r.top / innerHeight, r.right / innerWidth, r.bottom / innerHeight]; }).filter((r) => r[2]! > r[0]! && r[3]! > r[1]!));

/** A-B-A blinks between screencast frames, in 8 px blocks of mean luminance. */
async function blinks(fs: Frame[], masks: number[][]) {
  return lab.evaluate(async ({ fs, masks }: { fs: string[]; masks: number[][] }) => {
    const B = 8;
    const lum: Float32Array[] = [], means: number[] = []; let W = 0, H = 0, flat = 0;
    for (const d of fs) {
      const bm = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${d}`)).blob());
      W = Math.floor(bm.width / B); H = Math.floor(bm.height / B);
      const c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext("2d")!;
      g.drawImage(bm, 0, 0);
      const px = g.getImageData(0, 0, bm.width, bm.height).data;
      const L = new Float32Array(W * H);
      let s = 0, s2 = 0;
      for (let y = 0; y < H * B; y++) for (let x = 0; x < W * B; x++) { const i = (y * bm.width + x) * 4, v = 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!; L[Math.floor(y / B) * W + Math.floor(x / B)]! += v / (B * B); s += v; s2 += v * v; }
      const n = W * H * B * B, sd = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
      if (sd < 4) flat++;
      means.push(s / n);
      lum.push(L);
    }
    const masked = (bx: number, by: number) => masks.some((m) => bx / W >= m[0]! && bx / W <= m[2]! && by / H >= m[1]! && by / H <= m[3]!);
    let all = 0, outside = 0, big = 0; const where: number[][] = [];
    const T = 28;
    for (let i = 1; i + 1 < lum.length; i++) {
      const a = lum[i - 1]!, b = lum[i]!, c = lum[i + 1]!;
      let n = 0, no = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
      for (let k = 0; k < a.length; k++) {
        if (Math.abs(b[k]! - a[k]!) > T && Math.abs(b[k]! - c[k]!) > T && Math.abs(c[k]! - a[k]!) < T / 3) {
          n++; const bx = k % W, by = Math.floor(k / W);
          if (!masked(bx, by)) { no++; x0 = Math.min(x0, bx); y0 = Math.min(y0, by); x1 = Math.max(x1, bx); y1 = Math.max(y1, by); }
        }
      }
      if (n >= a.length * 0.1) big++;
      if (n >= 3) { all++; if (where.length < 8) where.push([i, n, no].map((v) => Math.round(v * 100) / 100)); }
      if (no >= 3) outside++;
    }
    // Swings: the page's mean brightness turning from rising to falling (or back) by 6 levels or more: day and night
    // pulsing while time races, which A-B-A over three frames does not catch.
    let swings = 0, dir = 1, ext = means[0] ?? 0;
    for (const m of means) {
      if (dir >= 0 && m > ext) ext = m;
      else if (dir <= 0 && m < ext) ext = m;
      if (dir >= 0 && ext - m >= 6) { if (dir > 0) swings++; dir = -1; ext = m; }
      else if (dir <= 0 && m - ext >= 6) { if (dir < 0) swings++; dir = 1; ext = m; }
    }
    return { frames: fs.length, swings, blinks: all, big, blinksOutsideCanvas: outside, flat, where };
  }, { fs: fs.map((f) => f.data), masks });
}

type Row = { name: string; secs: number; commitsPerS: number; domPerS: number; cls: number; longN: number; longMs: number; fpsAvg?: number; p95?: number; frames: number; blinks: number; big: number; swingsPerS: number; blinksOut: number; flat: number; where: number[][]; top: [string, number][]; readyMs?: number };
const rows: Row[] = [];
async function scenario(name: string, act: () => Promise<number | void>, measureFps = 0) {
  if (only && !only.includes(name)) return;
  await p.waitForTimeout(300);
  const masks = await canvases().catch(() => []);
  const s0 = await snap();
  frames = [];
  const t0 = Date.now();
  let readyMs: number | void = undefined;
  let f: Awaited<ReturnType<typeof fps>> | undefined;
  if (measureFps) [readyMs, f] = await Promise.all([act(), fps(measureFps)]);
  else readyMs = await act();
  const secs = (Date.now() - t0) / 1000;
  const fs = frames; frames = null;
  const s1 = await snap();
  const bl = await blinks(fs, masks);
  const d = (k: "commits" | "dom" | "longN" | "longMs" | "cls") => (s1?.[k] ?? 0) - (s0?.[k] ?? 0);
  // (The worst blinks' three frames, to look at.)
  for (const [i, n] of [...bl.where].sort((a, b) => b[1]! - a[1]!).slice(0, 2)) for (const k of [-1, 0, 1]) writeFileSync(join(out, `${name.replace(/[^a-z0-9]+/gi, "-")}-blink${i}-${k + 1}.jpg`), Buffer.from(fs[i! + k]!.data, "base64"));
  const top = Object.entries(s1?.renders ?? {}).map(([k, v]) => [k, (v as number) - ((s0?.renders as any)?.[k] ?? 0)] as [string, number]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const r: Row = { name, secs, commitsPerS: d("commits") / secs, domPerS: d("dom") / secs, cls: d("cls"), longN: d("longN"), longMs: d("longMs"), ...(f ? { fpsAvg: 1000 / f.avg, p95: f.p95 } : {}), frames: bl.frames, blinks: bl.blinks, big: bl.big, swingsPerS: bl.swings / secs, blinksOut: bl.blinksOutsideCanvas, flat: bl.flat, where: bl.where, top, ...(typeof readyMs === "number" ? { readyMs } : {}) };
  rows.push(r);
  console.log(`${name.padEnd(18)} commits/s ${r.commitsPerS.toFixed(1).padStart(5)}  dom/s ${r.domPerS.toFixed(0).padStart(5)}  cls ${r.cls.toFixed(3)}  long ${r.longN}/${Math.round(r.longMs)}ms  ${f ? `fps ${r.fpsAvg!.toFixed(0)} p95 ${r.p95!.toFixed(1)}ms  ` : ""}frames ${r.frames} blinks ${r.blinks} (a tenth of the page or more ${r.big}, outside canvas ${r.blinksOut}) swings/s ${r.swingsPerS.toFixed(1)} flat ${r.flat}${r.readyMs !== undefined ? `  ready ${r.readyMs} ms` : ""}`);
  if (r.cls > 0.001) console.log(`${"".padEnd(18)} shifted: ${Object.entries(s1?.shifts ?? {}).map(([k, v]) => `${k} ${(v as number - ((s0?.shifts as any)?.[k] ?? 0)).toFixed(3)}`).join(", ")}`);
  if (top.length) console.log(`${"".padEnd(18)} rendered: ${top.map(([k, v]) => `${k} ${v}`).join(", ")}`);
}
/** From now, the ms until the run page stands: the map's canvas, the rail's words and the timeline. */
const runReady = () => p.evaluate(() => new Promise<number>((res) => {
  const t0 = performance.now();
  const f = () => {
    const ok = document.querySelector(".run-map canvas") && (document.querySelector(".run-rail")?.textContent?.length ?? 0) > 80 && document.querySelector(".tl-canvas canvas");
    if (ok || performance.now() - t0 > 15000) res(Math.round(performance.now() - t0)); else requestAnimationFrame(f);
  };
  f();
}));

// Library, then the run.
await p.goto(`${base}/#/`, { waitUntil: "load" });
await p.waitForSelector(".lib-section", { timeout: 30000 }).catch(() => {});
await p.waitForTimeout(1500);
await scenario("library idle", () => p.waitForTimeout(2000));
await scenario("library→run", async () => { const r = runReady(); await p.evaluate((h: string) => { location.hash = h; }, `#/run/${encodeURIComponent(key!)}`); const ms = await r; await p.waitForTimeout(1500); return ms; });
if (!(await p.$(".run-map"))) { await p.goto(runUrl(), { waitUntil: "load" }); await runReady(); }
await p.waitForTimeout(2500);
await scenario("run idle", () => p.waitForTimeout(3000), 3000);

const speeds = await p.$$eval(".tl-speeds button", (bs) => bs.map((x) => x.textContent ?? ""));
for (const [i, label] of speeds.entries()) {
  await scenario(`play ${label}`, async () => {
    await p.evaluate((i: number) => (document.querySelectorAll(".tl-speeds button")[i] as HTMLElement).click(), i);
    await p.click(".tl-play");
    await p.waitForTimeout(3000);
    await p.click(".tl-play");
  }, 2800);
  await p.keyboard.press("Home");
}
const tl = await p.$(".tl-canvas canvas").then((e: any) => e?.boundingBox());
if (tl) await scenario("scrub", async () => {
  await p.mouse.move(tl.x + 20, tl.y + 30); await p.mouse.down();
  for (let i = 0; i < 90; i++) { await p.mouse.move(tl.x + 20 + (tl.width - 40) * (0.5 - 0.5 * Math.cos(i / 14)), tl.y + 30); await p.waitForTimeout(16); }
  await p.mouse.up();
}, 2000);
const map = await p.$(".run-map").then((e: any) => e?.boundingBox());
if (map) await scenario("hover map", async () => {
  for (let i = 0; i < 80; i++) { await p.mouse.move(map.x + map.width * (0.3 + 0.4 * ((i * 37) % 80) / 80), map.y + map.height * (0.3 + 0.4 * ((i * 53) % 80) / 80)); await p.waitForTimeout(25); }
}, 2000);
await scenario("open a turn", async () => { await p.click(".st-row >> nth=2").catch(() => {}); await p.waitForTimeout(1500); });
await scenario("close the turn", async () => { await p.keyboard.press("Escape"); await p.waitForTimeout(1200); });
if (await p.$(".map-toggle")) {
  await scenario("map→3D", async () => { await p.click(".map-toggle button >> nth=1"); await p.waitForTimeout(2500); });
  await scenario("3D idle", () => p.waitForTimeout(2500), 2500);
  await scenario("3D→map", async () => { await p.click(".map-toggle button >> nth=0"); await p.waitForTimeout(2000); });
}
await scenario("theme toggle", async () => { const sel = '.run-actions button[aria-label^="Switch to"]'; await p.click(sel); await p.waitForTimeout(1200); await p.click(sel); await p.waitForTimeout(1200); });
await scenario("mode toggle", async () => { await p.click(".mode-switch button >> nth=0"); await p.waitForTimeout(1200); await p.click(".mode-switch button >> nth=1"); await p.waitForTimeout(1200); });
await scenario("run→library", async () => { await p.click(".run-home"); await p.waitForTimeout(1500); });

writeFileSync(join(out, "report.json"), JSON.stringify({ base, key, theme, mode, at: new Date().toISOString(), rows, errors }, null, 1));
if (errors.length) console.log("page errors:", errors);
console.log(`report: ${join(out, "report.json")}`);
await b.close();
