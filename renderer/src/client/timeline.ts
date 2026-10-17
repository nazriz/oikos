// The timeline: the whole run left to right. Its lower band is the town's pulse (consequential changes reaching people
// each day, stacked by the class of who decided, hard ones marked under it); above it, one rail per seat with a mark for
// each of its acts. Drag to scrub; click a seat's mark to open the act.

import { CLASSES, CLASS_COLOR, DAY, HARD_COLOR, esc, stampOf, type Cls, type SeatAct, type WorldData } from "./api";

export class Timeline {
  el: HTMLElement; cv: HTMLCanvasElement; tip: HTMLElement;
  t = 0; days: number; end: number;
  seatColor = new Map<string, string>();
  seats: string[];
  onScrub: (t: number, done: boolean) => void = () => {};
  onAct: (a: SeatAct) => void = () => {};
  selectedAct = -1;
  private dragging = false;
  private hits: { x: number; y: number; a: SeatAct }[] = [];
  private pulseMax = 1;

  constructor(host: HTMLElement, readonly data: WorldData, colors: Map<string, string>) {
    this.days = data.meta.days; this.end = Math.max(data.meta.lastT, this.days * DAY);
    this.seatColor = colors;
    this.seats = data.meta.seats.filter((s) => data.seatActs.some((a) => a.participant === s) || data.pilot?.seats.some((x) => x.id === s));
    this.el = host;
    this.cv = document.createElement("canvas"); this.cv.className = "tl-canvas";
    this.tip = document.createElement("div"); this.tip.className = "tl-tip";
    host.append(this.cv, this.tip);
    const tp = data.townPulse.byClass;
    for (let d = 0; d <= this.days; d++) { let s = 0; for (const c of CLASSES) if (c !== "self") s += tp[c]?.[d] ?? 0; this.pulseMax = Math.max(this.pulseMax, s); }
    const pos = (e: PointerEvent) => { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    this.cv.addEventListener("pointerdown", (e) => {
      const p = pos(e);
      const hit = this.hitAt(p.x, p.y);
      if (hit) { this.onAct(hit.a); return; }
      this.dragging = true; this.cv.setPointerCapture(e.pointerId);
      this.onScrub(this.tAt(p.x), false);
    });
    this.cv.addEventListener("pointermove", (e) => {
      const p = pos(e);
      if (this.dragging) { this.onScrub(this.tAt(p.x), false); return; }
      const hit = this.hitAt(p.x, p.y);
      if (hit) {
        this.tip.innerHTML = `<b style="color:${this.seatColor.get(hit.a.participant)}">${esc(hit.a.participant)}</b> · ${stampOf(hit.a.t)}<br>${esc(hit.a.kinds.join(", "))}${hit.a.text ? `<br><i>${esc(hit.a.text.slice(0, 140))}</i>` : ""}<br><span class="dim">${esc(hit.a.status ?? "")}${hit.a.via ? ` · via ${esc(hit.a.via)}` : ""}</span>`;
        this.tip.style.display = "block";
        const w = this.cv.clientWidth;
        this.tip.style.left = `${Math.min(w - 260, Math.max(0, p.x - 120))}px`;
        this.cv.style.cursor = "pointer";
      } else {
        this.tip.style.display = "none"; this.cv.style.cursor = "ew-resize";
      }
    });
    const up = (e: PointerEvent) => { if (!this.dragging) return; this.dragging = false; this.onScrub(this.tAt(pos(e).x), true); };
    this.cv.addEventListener("pointerup", up);
    this.cv.addEventListener("pointercancel", up);
    this.cv.addEventListener("pointerleave", () => { this.tip.style.display = "none"; });
    new ResizeObserver(() => this.draw()).observe(this.cv);
  }

  private pad = 14;
  tAt(x: number) { const w = this.cv.clientWidth - this.pad * 2; return Math.max(0, Math.min(this.end, ((x - this.pad) / w) * this.end)); }
  xAt(t: number) { const w = this.cv.clientWidth - this.pad * 2; return this.pad + (t / this.end) * w; }
  private hitAt(x: number, y: number) { let best: (typeof this.hits)[number] | undefined, bd = 64; for (const h of this.hits) { const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d < bd) { bd = d; best = h; } } return best; }

  draw() {
    const dpr = Math.min(2, devicePixelRatio || 1), W = this.cv.clientWidth, H = this.cv.clientHeight;
    if (!W || !H) return;
    if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) { this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr); }
    const c = this.cv.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const rails = this.seats.length, railH = rails ? Math.min(14, (H * 0.45) / rails) : 0;
    const top = 16, pulseTop = top + rails * railH + (rails ? 8 : 0), pulseH = H - pulseTop - 14;
    // day grid and labels
    c.font = "10px ui-sans-serif, system-ui, sans-serif"; c.textBaseline = "top";
    const step = this.days > 200 ? 30 : this.days > 60 ? 7 : this.days > 20 ? 2 : 1;
    for (let d = 0; d <= this.days; d += step) {
      const x = this.xAt(d * DAY);
      c.fillStyle = "rgba(255,255,255,0.06)"; c.fillRect(x, top, 1, H - top - 12);
      c.fillStyle = "rgba(220,228,255,0.45)"; c.fillText(d === 0 ? "day 0" : String(d), x + 2, 2);
    }
    // the town's pulse
    const tp = this.data.townPulse;
    const bw = Math.max(1, (W - this.pad * 2) / (this.days + 1) - 0.6);
    for (let d = 0; d <= this.days; d++) {
      let y = pulseTop + pulseH;
      const x = this.xAt(d * DAY);
      for (const cl of ["world", "person", "system", "seat"] as Cls[]) {
        const v = tp.byClass[cl]?.[d] ?? 0; if (!v) continue;
        const h = Math.max(cl === "seat" ? 2 : 0, (Math.sqrt(v) / Math.sqrt(this.pulseMax)) * pulseH * (cl === "seat" ? 1 : 1));
        c.fillStyle = CLASS_COLOR[cl] + (cl === "seat" ? "" : "b0"); c.fillRect(x, y - h, bw, h); y -= h;
      }
      const hard = tp.hard[d] ?? 0;
      if (hard) { c.fillStyle = HARD_COLOR; c.globalAlpha = Math.min(1, 0.25 + hard / 40); c.fillRect(x, pulseTop + pulseH + 3, bw, 3); c.globalAlpha = 1; }
    }
    // seat rails
    this.hits = [];
    this.seats.forEach((s, i) => {
      const y = top + i * railH + railH / 2;
      const col = this.seatColor.get(s) ?? CLASS_COLOR.seat;
      c.fillStyle = "rgba(255,255,255,0.05)"; c.fillRect(this.pad, y - 0.5, W - this.pad * 2, 1);
      for (const a of this.data.seatActs) {
        if (a.participant !== s) continue;
        const x = this.xAt(a.t);
        const sel = a.ord === this.selectedAct;
        c.beginPath(); c.arc(x, y, sel ? 5 : 3.2, 0, Math.PI * 2);
        if (a.status === "applied") { c.fillStyle = col; c.fill(); } else { c.strokeStyle = col; c.lineWidth = 1.4; c.stroke(); }
        if (sel) { c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.stroke(); }
        this.hits.push({ x, y, a });
      }
    });
    // the playhead
    const x = this.xAt(this.t);
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(1, "rgba(255,255,255,0.25)");
    c.fillStyle = g; c.fillRect(x - 0.75, 12, 1.5, H - 12);
    c.beginPath(); c.moveTo(x - 5, 10); c.lineTo(x + 5, 10); c.lineTo(x, 16); c.closePath(); c.fillStyle = "#fff"; c.fill();
  }
  set(t: number) { this.t = t; this.draw(); }
}
