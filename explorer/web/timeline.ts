// The timeline: the whole run left to right, zoomable (wheel) and scrubbable (drag). Day bands with the nights shaded;
// one rail per seat with a mark for each of its acts (filled: applied; hollow: refused or pending); below, the town's
// pulse: the consequential changes reaching people each day, stacked by who decided, the hard ones marked under it.
// A second run's pulse can be drawn against it (the workbench's compare), its difference shaded.

import { CLASS_COLOR, DAY, HARD_COLOR, esc, stampOf, type Cls, type SeatAct, type WorldData } from "../../renderer/src/client/api";

export class Timeline {
  cv = document.createElement("canvas");
  tip = document.createElement("div");
  t = 0;
  end: number;
  days: number;
  /** The span shown, [v0, v1) in world seconds. */
  v0 = 0;
  v1: number;
  seats: string[];
  selectedAct = -1;
  onScrub: (t: number, done: boolean) => void = () => {};
  onAct: (a: SeatAct) => void = () => {};
  /** Another run's pulse by day (the workbench's compare), drawn as a line over this one's. */
  other?: { label: string; byDay: number[] };
  private drag = false;
  private hits: { x: number; y: number; a: SeatAct }[] = [];
  private pulseMax = 1;
  private pad = 12;

  constructor(host: HTMLElement, readonly data: WorldData, readonly seatColor: Map<string, string>) {
    this.days = data.meta.days;
    this.end = Math.max(data.meta.lastT, this.days * DAY, 1);
    this.v1 = this.end;
    this.seats = data.meta.seats.filter((s) => data.seatActs.some((a) => a.participant === s) || data.pilot?.seats.some((x) => x.id === s));
    this.cv.className = "tl-canvas";
    this.tip.className = "tl-tip";
    host.append(this.cv, this.tip);
    for (let d = 0; d <= this.days; d++) this.pulseMax = Math.max(this.pulseMax, this.pulseOf(d));
    const at = (e: PointerEvent | WheelEvent) => { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    this.cv.addEventListener("pointerdown", (e) => {
      const p = at(e);
      const hit = this.hitAt(p.x, p.y);
      if (hit) { this.onAct(hit.a); return; }
      this.drag = true;
      this.cv.setPointerCapture(e.pointerId);
      this.onScrub(this.tAt(p.x), false);
    });
    this.cv.addEventListener("pointermove", (e) => {
      const p = at(e);
      if (this.drag) { this.onScrub(this.tAt(p.x), false); return; }
      const hit = this.hitAt(p.x, p.y);
      if (hit) {
        const a = hit.a;
        this.tip.innerHTML = `<b style="color:${this.seatColor.get(a.participant)}">${esc(a.participant)}</b> · ${stampOf(a.t)}<br>${esc(a.kinds.join(", "))}${a.text ? `<br><i>${esc(a.text.slice(0, 140))}</i>` : ""}<br><span class="dim">${esc(a.status ?? "")}${a.via ? ` · via ${esc(a.via)}` : ""}</span>`;
      } else {
        const t = this.tAt(p.x), d = Math.floor(t / DAY);
        const tp = this.data.townPulse;
        this.tip.innerHTML = `<b>${esc(stampOf(t))}</b><br>${(["person", "system", "seat", "world"] as Cls[]).map((c) => `<span style="color:${CLASS_COLOR[c]}">${c} ${tp.byClass[c]?.[d] ?? 0}</span>`).join(" · ")}${tp.hard[d] ? ` · <span style="color:${HARD_COLOR}">hard ${tp.hard[d]}</span>` : ""}${this.other ? `<br><span class="dim">${esc(this.other.label)}: ${this.other.byDay[d] ?? 0}</span>` : ""}`;
      }
      this.tip.style.display = "block";
      this.tip.style.left = `${Math.min(this.cv.clientWidth - 270, Math.max(0, p.x - 130))}px`;
      this.cv.style.cursor = hit ? "pointer" : "ew-resize";
    });
    const up = (e: PointerEvent) => { if (!this.drag) return; this.drag = false; this.onScrub(this.tAt(at(e).x), true); };
    this.cv.addEventListener("pointerup", up);
    this.cv.addEventListener("pointercancel", up);
    this.cv.addEventListener("pointerleave", () => { this.tip.style.display = "none"; });
    this.cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      // zoom about the pointer; shift or a sideways scroll pans
      const span = this.v1 - this.v0;
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const dt = ((e.deltaX || e.deltaY) / this.cv.clientWidth) * span;
        this.view(this.v0 + dt, this.v1 + dt);
      } else {
        const c = this.tAt(at(e).x), k = Math.exp(e.deltaY * 0.0015);
        this.view(c - (c - this.v0) * k, c + (this.v1 - c) * k);
      }
    }, { passive: false });
    this.cv.addEventListener("dblclick", () => this.view(0, this.end));
    new ResizeObserver(() => this.draw()).observe(this.cv);
  }

  /** The run grew (it was shown while still being indexed): its span and scale again. */
  refresh() {
    const whole = this.v0 === 0 && this.v1 === this.end;
    this.days = this.data.meta.days;
    this.end = Math.max(this.data.meta.lastT, this.days * DAY, 1);
    if (whole) this.v1 = this.end;
    this.pulseMax = 1;
    for (let d = 0; d <= this.days; d++) this.pulseMax = Math.max(this.pulseMax, this.pulseOf(d));
    this.draw();
  }

  view(a: number, b: number) {
    const span = Math.min(this.end, Math.max(6 * 3600, b - a));
    a = Math.max(0, Math.min(this.end - span, a));
    this.v0 = a; this.v1 = a + span;
    this.draw();
  }

  private pulseOf(d: number) {
    const tp = this.data.townPulse;
    let s = 0;
    for (const c of ["person", "system", "seat", "world"] as Cls[]) s += tp.byClass[c]?.[d] ?? 0;
    return s;
  }
  tAt(x: number) { const w = this.cv.clientWidth - this.pad * 2; return Math.max(0, Math.min(this.end, this.v0 + ((x - this.pad) / w) * (this.v1 - this.v0))); }
  xAt(t: number) { const w = this.cv.clientWidth - this.pad * 2; return this.pad + ((t - this.v0) / (this.v1 - this.v0)) * w; }
  private hitAt(x: number, y: number) {
    let best: (typeof this.hits)[number] | undefined, bd = 49;
    for (const h of this.hits) { const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d < bd) { bd = d; best = h; } }
    return best;
  }

  draw() {
    const dpr = Math.min(2, devicePixelRatio || 1), W = this.cv.clientWidth, H = this.cv.clientHeight;
    if (!W || !H) return;
    if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) { this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr); }
    const c = this.cv.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const rails = this.seats.length, railH = rails ? Math.min(13, (H * 0.42) / rails) : 0;
    const top = 16, pulseTop = top + rails * railH + (rails ? 6 : 0), pulseH = H - pulseTop - 10;
    const d0 = Math.max(0, Math.floor(this.v0 / DAY)), d1 = Math.min(this.days, Math.ceil(this.v1 / DAY));
    const pxDay = (W - this.pad * 2) / ((this.v1 - this.v0) / DAY);
    // day bands, nights shaded when a day is wide enough to see them
    for (let d = d0; d <= d1; d++) {
      const x = this.xAt(d * DAY);
      if (d % 2 === 0) { c.fillStyle = "rgba(148,163,184,0.045)"; c.fillRect(x, top - 2, pxDay, H - top); }
      if (pxDay > 40) {
        c.fillStyle = "rgba(15,23,42,0.45)";
        c.fillRect(x, top - 2, pxDay * 0.25, H - top);
        c.fillRect(x + pxDay * 0.75, top - 2, pxDay * 0.25, H - top);
      }
    }
    c.font = "10px Inter, ui-sans-serif, system-ui, sans-serif"; c.textBaseline = "top";
    const step = pxDay > 60 ? 1 : pxDay > 22 ? 2 : pxDay > 9 ? 7 : pxDay > 2.5 ? 30 : 90;
    for (let d = Math.ceil(d0 / step) * step; d <= d1; d += step) {
      const x = this.xAt(d * DAY);
      c.fillStyle = "rgba(148,163,184,0.16)"; c.fillRect(x, top - 2, 1, H - top);
      c.fillStyle = "rgba(203,213,225,0.6)"; c.fillText(d === 0 ? "day 0" : `${d}`, x + 3, 2);
    }
    if (pxDay > 160) for (let d = d0; d <= d1; d++) for (const h of [6, 12, 18]) { const x = this.xAt(d * DAY + h * 3600); c.fillStyle = "rgba(148,163,184,0.35)"; c.fillText(`${h}:00`, x + 2, 2); }
    // the town's pulse
    const tp = this.data.townPulse;
    const bw = Math.max(1, pxDay - (pxDay > 4 ? 1 : 0));
    for (let d = d0; d <= d1; d++) {
      const x = this.xAt(d * DAY);
      let y = pulseTop + pulseH;
      for (const cl of ["world", "person", "system", "seat"] as Cls[]) {
        const v = tp.byClass[cl]?.[d] ?? 0;
        if (!v) continue;
        const h = Math.max(cl === "seat" ? 2 : 0, (Math.sqrt(v) / Math.sqrt(this.pulseMax)) * (pulseH - 6));
        c.fillStyle = CLASS_COLOR[cl] + (cl === "seat" ? "" : "a8");
        c.fillRect(x, y - h, bw, h);
        y -= h;
      }
      const hard = tp.hard[d] ?? 0;
      if (hard) { c.globalAlpha = Math.min(1, 0.25 + hard / 40); c.fillStyle = HARD_COLOR; c.fillRect(x, pulseTop + pulseH + 2, bw, 3); c.globalAlpha = 1; }
    }
    if (this.other) {
      c.beginPath();
      for (let d = d0; d <= d1; d++) {
        const v = this.other.byDay[d] ?? 0, x = this.xAt(d * DAY) + bw / 2;
        const y = pulseTop + pulseH - (Math.sqrt(v) / Math.sqrt(this.pulseMax)) * (pulseH - 6);
        if (d === d0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = 1.4; c.setLineDash([4, 3]); c.stroke(); c.setLineDash([]);
    }
    // seat rails
    this.hits = [];
    this.seats.forEach((s, i) => {
      const y = top + i * railH + railH / 2;
      const col = this.seatColor.get(s) ?? CLASS_COLOR.seat;
      c.fillStyle = "rgba(148,163,184,0.12)"; c.fillRect(this.pad, y - 0.5, W - this.pad * 2, 1);
      for (const a of this.data.seatActs) {
        if (a.participant !== s || a.t < this.v0 || a.t > this.v1) continue;
        const x = this.xAt(a.t), sel = a.ord === this.selectedAct;
        c.beginPath(); c.arc(x, y, sel ? 5 : 3.2, 0, Math.PI * 2);
        if (a.status === "applied") { c.fillStyle = col; c.fill(); } else { c.strokeStyle = col; c.lineWidth = 1.4; c.stroke(); }
        if (sel) { c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.stroke(); }
        this.hits.push({ x, y, a });
      }
    });
    // the zoomed span, on a strip of the whole run
    if (this.v0 > 0 || this.v1 < this.end) {
      const a = this.pad + (this.v0 / this.end) * (W - this.pad * 2), b = this.pad + (this.v1 / this.end) * (W - this.pad * 2);
      c.fillStyle = "rgba(148,163,184,0.2)"; c.fillRect(this.pad, H - 3, W - this.pad * 2, 2);
      c.fillStyle = "rgba(226,232,240,0.8)"; c.fillRect(a, H - 3, Math.max(2, b - a), 2);
    }
    // the playhead
    if (this.t >= this.v0 && this.t <= this.v1) {
      const x = this.xAt(this.t);
      c.fillStyle = "rgba(248,250,252,0.9)"; c.fillRect(x - 0.75, 12, 1.5, H - 14);
      c.beginPath(); c.moveTo(x - 5, 10); c.lineTo(x + 5, 10); c.lineTo(x, 16); c.closePath(); c.fill();
    }
  }

  set(t: number) {
    this.t = t;
    // keep the playhead in view while playing
    if (t > this.v1 || t < this.v0) { const span = this.v1 - this.v0; this.view(t - span * 0.1, t + span * 0.9); return; }
    this.draw();
  }
}
