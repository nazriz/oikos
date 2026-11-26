// A small map of the whole district in a corner, shown when zoomed in: the painted ground, the town's outline, and
// the part of the ground the camera sees. Click or drag on it to move the camera there.
import { useEffect, useRef } from "react";
import type { OrbitViewState } from "@deck.gl/core";
import { OrbitView } from "@deck.gl/core";
import type { TownBundle } from "./data";

const VIEW = new OrbitView({ id: "mini", orbitAxis: "Z", fovy: 32, near: 1, far: 20000 } as any);

/** Where the screen's corners meet the ground (z = 0), in metres; points past the horizon are pulled in. */
function footprint(view: OrbitViewState, w: number, h: number): [number, number][] {
  const vp: any = (VIEW as any).makeViewport({ width: w, height: h, viewState: view });
  const out: [number, number][] = [];
  for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h]] as const) {
    const a = vp.unproject([x, y, 0]), b = vp.unproject([x, y, 1]);
    const dz = a[2] - b[2];
    let f = dz !== 0 ? a[2] / dz : 0;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
    if (!Number.isFinite(f) || f * len > 6000 || (f < 0 && a[2] > 0)) f = 6000 / len; // the ray meets the ground far off or never (at the horizon): keep it near
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

export function Minimap({ B, town, view, size, setView }: {
  B: { ground: HTMLCanvasElement | OffscreenCanvas | ImageBitmap }; town: TownBundle; view: OrbitViewState; size: { w: number; h: number };
  setView: (v: OrbitViewState | ((v: OrbitViewState) => OrbitViewState)) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const zoom = view.zoom as number;
  const show = zoom > 0.9;
  const phone = size.w < 640;
  const W = phone ? 104 : 150;
  const cell = town.ground.cell, GW = town.ground.w * cell, GH = town.ground.h * cell;
  const H = Math.round((W * GH) / GW);
  useEffect(() => {
    const c = ref.current;
    if (!c || !show) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 0.92;
    ctx.drawImage(B.ground as CanvasImageSource, 0, 0, W, H);
    ctx.globalAlpha = 1;
    const sx = W / GW, sy = H / GH;
    // The town's outline.
    for (const p of town.places) if (p.within) {
      ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1;
      ctx.strokeRect(p.area.x * cell * sx, p.area.y * cell * sy, p.area.w * cell * sx, p.area.h * cell * sy);
    }
    // What the camera sees.
    const fp = footprint(view, size.w, size.h);
    ctx.beginPath();
    fp.forEach(([x, y], i) => { const px = x * sx, py = -y * sy; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.closePath();
    ctx.fillStyle = "rgba(242,180,75,.28)"; ctx.fill();
    ctx.strokeStyle = "#f2b44b"; ctx.lineWidth = 2; ctx.stroke();
  }, [show, view, size.w, size.h, W, H, B, town]);
  if (!show) return null;
  const go = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.type === "pointermove" && e.buttons !== 1) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / W) * GW, y = -((e.clientY - r.top) / H) * GH;
    setView((v) => ({ ...v, target: [x, y, 0], transitionDuration: e.type === "pointerdown" ? 500 : 0 } as any));
  };
  return <canvas ref={ref} className="lc-mini" style={{ width: W, height: H }} onPointerDown={go} onPointerMove={go} aria-label="The whole district; click to move there" />;
}
