// The shared timeline: one lane per track that views contribute (useLens().setTrack), over a ground of the run's daily
// activity, with the playhead. Scrub (drag), zoom (wheel or pinch, around the pointer), pan (horizontal wheel or shift),
// fit (double-click). Keys: space play/pause, ←/→ an hour (shift: a day), [ ] slower/faster, , . previous/next mark,
// Home/End. Drawn on one canvas: thousands of marks stay smooth.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLens, type Selection, type TimelineMark, type TimelineTrack } from "../state";
import { selToken } from "../router";
import { DAY, HOUR, clock, dayOf, span as spanText, spanWords } from "../format";
import { Fit, Keyboard, Pause, Play } from "../icons";
import { useMode } from "../mode";
import "./timeline.css";

export interface Ground {
  label: string;
  /** One value per day from day 0. */
  values: number[];
}
export interface TimelineProps {
  ground?: Ground;
  /** The fork point, seconds: drawn as the start of the arm's own time. */
  fork?: number;
}

export const SPEEDS = [
  { s: 600, label: "10 min/s", title: "Ten minutes a second" },
  { s: HOUR, label: "1 h/s", title: "An hour a second" },
  { s: 6 * HOUR, label: "6 h/s", title: "Six hours a second" },
  { s: DAY, label: "1 d/s", title: "A day a second" },
  { s: 7 * DAY, label: "1 wk/s", title: "A week a second" },
];
/** Story mode's three speeds, in words. */
const STORY_SPEEDS = [
  { s: HOUR, label: "Slow", title: "An hour a second" },
  { s: 6 * HOUR, label: "Normal", title: "Six hours a second" },
  { s: DAY, label: "Fast", title: "A day a second" },
];

const AXIS = 22;
const GROUND = 26;
/** Lane heights: compact by default; drag the timeline's top edge, or the toggle, for more. Kept in this browser. */
const LANE_MIN = 11;
const LANE_MAX = 28;
const LANE_COMPACT = 12;
const LANE_ROOMY = 22;
const readLane = () => {
  try {
    const v = Number(localStorage.getItem("lens.tl.lane"));
    return v >= LANE_MIN && v <= LANE_MAX ? v : LANE_COMPACT;
  } catch {
    return LANE_COMPACT;
  }
};
const PAD_B = 6;

const PALETTE_KEYS = ["text", "muted", "faint", "line", "line2", "panel", "panel2", "ink", "seat", "flag", "election", "news", "inst", "citizen", "good", "bad", "mono"] as const;
type Palette = Record<(typeof PALETTE_KEYS)[number], string>;
function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    text: v("--text"), muted: v("--muted"), faint: v("--faint"), line: v("--line"), line2: v("--line-2"), panel: v("--panel"), panel2: v("--panel-2"), ink: v("--ink"),
    seat: v("--seat"), flag: v("--flag"), election: v("--election"), news: v("--inst"), inst: v("--inst"), citizen: v("--citizen"), good: v("--good"), bad: v("--bad"),
    mono: v("--font-sans"),
  };
}
const toneColor = (p: Palette, tone?: TimelineMark["tone"]) => (tone === "muted" || !tone ? p.muted : p[tone]);

/** Track lanes plus a hit list of where each mark was drawn. */
interface Hit { x: number; x2: number; y: number; mark: TimelineMark; track: TimelineTrack }

function niceDayStep(pxPerDay: number): number {
  for (const d of [1, 2, 5, 7, 14, 30, 60, 90]) if (d * pxPerDay >= 54) return d;
  return 180;
}
function niceHourStep(pxPerHour: number): number {
  for (const h of [1, 2, 3, 6, 12]) if (h * pxPerHour >= 54) return h;
  return 24;
}

function usePlayback() {
  const playing = useLens((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = useLens.getState();
      const next = s.t + s.speed * dt;
      if (next >= s.span[1]) {
        s.setT(s.span[1]);
        s.setPlaying(false);
        return;
      }
      s.setT(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

export function Timeline({ ground, fork }: TimelineProps) {
  usePlayback();
  const t = useLens((s) => s.t);
  const spanT = useLens((s) => s.span);
  const playing = useLens((s) => s.playing);
  const speed = useLens((s) => s.speed);
  const tracks = useLens((s) => s.tracks);
  const selection = useLens((s) => s.selection);
  const [view, setView] = useState<[number, number]>(spanT);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hits = useRef<Hit[]>([]);
  const [width, setWidth] = useState(800);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [hover, setHover] = useState<{ hit: Hit; cx: number; cy: number } | null>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [help, setHelp] = useState(false);

  // (A new run, a new span: show all of it.)
  useEffect(() => setView(spanT), [spanT[0], spanT[1]]);

  // (Story mode shows three lanes: the mayor's turns, its power grabs and the election. Researcher mode, every lane.)
  const researcher = useMode((m) => m.mode === "researcher");
  const sorted = useMemo(() => {
    const all = [...tracks].sort((a, b) => a.id.localeCompare(b.id));
    if (researcher) return all;
    const pick = (re: RegExp) => all.find((tr) => re.test(`${tr.id} ${tr.label}`));
    const chosen = [pick(/sitting|turn/i), pick(/lever|grab/i), pick(/elect/i)].filter((x, i, a): x is TimelineTrack => !!x && a.indexOf(x) === i);
    return chosen.length ? chosen : all.slice(0, 3);
  }, [tracks, researcher]);
  const [LANE, setLane] = useState(readLane);
  useEffect(() => {
    try {
      localStorage.setItem("lens.tl.lane", String(LANE));
    } catch {}
  }, [LANE]);
  const compact = LANE < 17;
  const height = AXIS + GROUND + sorted.length * LANE + PAD_B;
  // (Drag the top edge: the lanes grow or shrink with it.)
  const onGrip = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY, l0 = LANE, n = Math.max(1, sorted.length);
    const move = (ev: PointerEvent) => setLane(Math.round(Math.max(LANE_MIN, Math.min(LANE_MAX, l0 + (y0 - ev.clientY) / n))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const allMarks = useMemo(() => sorted.flatMap((tr) => tr.marks.map((m) => m.t)).sort((a, b) => a - b), [sorted]);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(200, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const f = () => wrap.current && setPalette(readPalette(wrap.current));
    f();
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    mq?.addEventListener("change", f);
    window.addEventListener("lens-theme", f);
    return () => {
      mq?.removeEventListener("change", f);
      window.removeEventListener("lens-theme", f);
    };
  }, []);

  const [v0, v1] = view;
  const xOf = useCallback((tt: number) => ((tt - v0) / Math.max(1, v1 - v0)) * width, [v0, v1, width]);
  const tOf = useCallback((x: number) => v0 + (x / width) * (v1 - v0), [v0, v1, width]);

  // (Playing past the window's edge moves the window along.)
  useEffect(() => {
    if (!playing) return;
    const w = v1 - v0;
    if (t > v1 - w * 0.04 || t < v0) {
      const n0 = Math.max(spanT[0], Math.min(spanT[1] - w, t - w * 0.15));
      setView([n0, n0 + w]);
    }
  }, [t, playing]);

  const selTok = selToken(selection);

  // Draw.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !palette) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const p = palette;
    const mono = `600 11.5px ${p.mono || "sans-serif"}`;

    // Axis: day ticks, or hour ticks when close in.
    const pxPerDay = (DAY / Math.max(1, v1 - v0)) * width;
    g.font = mono;
    g.textBaseline = "middle";
    const d0 = Math.floor(v0 / DAY), d1 = Math.ceil(v1 / DAY);
    if (pxPerDay > 220) {
      const hs = niceHourStep(pxPerDay / 24);
      for (let tt = Math.floor(v0 / (hs * HOUR)) * hs * HOUR; tt <= v1; tt += hs * HOUR) {
        const x = Math.round(xOf(tt)) + 0.5;
        const isDay = tt % DAY === 0;
        g.fillStyle = isDay ? p.line2 : p.line;
        g.fillRect(x, isDay ? 0 : AXIS - 6, 1, isDay ? height : 6);
        g.fillStyle = isDay ? p.text : p.faint;
        g.fillText(isDay ? `day ${dayOf(tt)}` : clock(tt), x + 4, AXIS / 2);
      }
    } else {
      const ds = niceDayStep(pxPerDay);
      for (let d = Math.ceil(d0 / ds) * ds; d <= d1; d += ds) {
        const x = Math.round(xOf(d * DAY)) + 0.5;
        if (x < -40 || x > width + 4) continue;
        g.fillStyle = p.line;
        g.fillRect(x, AXIS - 6, 1, height - AXIS + 6);
        g.fillStyle = p.muted;
        g.fillText(`${d === Math.ceil(d0 / ds) * ds ? "day " : ""}${d}`, x + 4, AXIS / 2);
      }
      // (Minor ticks: each day, where there is room.)
      if (pxPerDay > 6) {
        g.fillStyle = p.line;
        for (let d = d0; d <= d1; d++) g.fillRect(Math.round(xOf(d * DAY)), AXIS - 3, 1, 3);
      }
    }
    g.fillStyle = p.line;
    g.fillRect(0, AXIS - 0.5, width, 1);

    // Ground: the run's daily activity, as a soft stepped area.
    if (ground?.values.length) {
      let max = 0;
      for (let d = Math.max(0, d0); d <= Math.min(ground.values.length - 1, d1); d++) max = Math.max(max, ground.values[d]!);
      if (max > 0) {
        const top = AXIS + 4, h = GROUND - 8;
        g.beginPath();
        g.moveTo(xOf(Math.max(0, d0) * DAY), top + h);
        for (let d = Math.max(0, d0); d <= Math.min(ground.values.length - 1, d1); d++) {
          const y = top + h - (ground.values[d]! / max) * h;
          g.lineTo(xOf(d * DAY), y);
          g.lineTo(xOf((d + 1) * DAY), y);
        }
        g.lineTo(xOf((Math.min(ground.values.length - 1, d1) + 1) * DAY), top + h);
        g.closePath();
        const grad = g.createLinearGradient(0, top, 0, top + h);
        grad.addColorStop(0, withAlpha(p.text, 0.2));
        grad.addColorStop(1, withAlpha(p.text, 0.04));
        g.fillStyle = grad;
        g.fill();
      }
    }
    // Lanes.
    const out: Hit[] = [];
    sorted.forEach((tr, i) => {
      const y = AXIS + GROUND + i * LANE + LANE / 2;
      g.fillStyle = p.line;
      g.fillRect(0, Math.round(AXIS + GROUND + i * LANE) + 0.5, width, 1);
      const pts = tr.marks.filter((m) => (m.t2 ?? m.t) >= v0 && m.t <= v1);
      const dense = pts.filter((m) => m.t2 === undefined).length > width / 5;
      for (const m of pts) {
        const x = xOf(m.t);
        const col = toneColor(p, m.tone);
        const sel = selTok !== undefined && selToken(m.select ?? null) === selTok;
        if (m.t2 !== undefined) {
          const x2 = Math.max(x + 3, xOf(m.t2));
          const bh = Math.min(10, LANE - 4);
          g.fillStyle = withAlpha(col, sel ? 0.55 : 0.3);
          roundRect(g, x, y - bh / 2, x2 - x, bh, Math.min(3, bh / 2));
          g.fill();
          g.fillStyle = col;
          g.fillRect(x, y - bh / 2, 1.5, bh);
          g.font = `11px ${getComputedStyle(document.body).fontFamily}`;
          // (Words in a lane only where they fit whole, and only when the lanes are tall enough to read them.)
          if (!compact && m.label && g.measureText(m.label).width <= x2 - x - 10) {
            g.save();
            g.beginPath();
            g.rect(x, y - 6, x2 - x - 4, 12);
            g.clip();
            g.fillStyle = p.text;
            g.fillText(m.label, x + 6, y + 0.5);
            g.restore();
          }
          g.font = mono;
          out.push({ x, x2, y, mark: m, track: tr });
        } else if (dense) {
          const th = Math.min(10, LANE - 3);
          g.fillStyle = col;
          g.fillRect(Math.round(x), y - th / 2, 1.5, th);
          out.push({ x: x - 2, x2: x + 2, y, mark: m, track: tr });
        } else {
          g.beginPath();
          g.arc(x, y, (sel ? 4.5 : 3.5) * (compact ? 0.8 : 1), 0, Math.PI * 2);
          g.fillStyle = col;
          g.fill();
          if (sel) {
            g.beginPath();
            g.arc(x, y, compact ? 6 : 7.5, 0, Math.PI * 2);
            g.strokeStyle = col;
            g.lineWidth = 1.25;
            g.stroke();
          }
          out.push({ x: x - 5, x2: x + 5, y, mark: m, track: tr });
        }
      }
    });
    hits.current = out;

    // The fork point.
    if (fork !== undefined && fork > v0 && fork < v1) {
      const x = Math.round(xOf(fork)) + 0.5;
      g.strokeStyle = p.seat;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(x, AXIS);
      g.lineTo(x, height);
      g.stroke();
      g.setLineDash([]);
    }
    // Hover line.
    if (hoverT !== null) {
      const x = Math.round(xOf(hoverT)) + 0.5;
      g.fillStyle = p.line2;
      g.fillRect(x, AXIS, 1, height - AXIS);
    }
    // Playhead.
    const px = Math.round(xOf(t)) + 0.5;
    if (px >= -2 && px <= width + 2) {
      g.fillStyle = p.seat;
      g.fillRect(px - 0.5, AXIS - 2, 2, height - AXIS + 2);
      g.beginPath();
      g.moveTo(px - 5.5, 3);
      g.lineTo(px + 6.5, 3);
      g.lineTo(px + 0.5, AXIS - 2);
      g.closePath();
      g.fill();
    }
  }, [palette, width, height, v0, v1, t, sorted, ground, fork, selTok, hoverT, xOf, LANE, compact]);

  // Pointer: scrub, or pick a mark.
  const drag = useRef<{ startX: number; moved: boolean; hit?: Hit } | null>(null);
  const hitAt = (x: number, y: number) => {
    let best: Hit | undefined, bestD = 1e9;
    for (const h of hits.current) {
      if (Math.abs(h.y - y) > LANE / 2) continue;
      if (x >= h.x - 2 && x <= h.x2 + 2) {
        const d = Math.abs((h.x + h.x2) / 2 - x);
        if (d < bestD) (best = h), (bestD = d);
      }
    }
    return best;
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    const hit = y > AXIS + GROUND ? hitAt(x, y) : undefined;
    drag.current = { startX: x, moved: false, ...(hit ? { hit } : {}) };
    (e.target as Element).setPointerCapture(e.pointerId);
    if (!hit) useLens.getState().setT(tOf(x));
  };
  const onMove = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    setHoverT(tOf(x));
    const d = drag.current;
    if (d) {
      if (Math.abs(x - d.startX) > 3) d.moved = true;
      if (d.moved || !d.hit) useLens.getState().setT(tOf(Math.max(0, Math.min(width, x))));
      setHover(null);
      return;
    }
    const hit = y > AXIS + GROUND ? hitAt(x, y) : undefined;
    setHover(hit ? { hit, cx: e.clientX, cy: e.clientY } : null);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.hit && !d.moved) {
      const s = useLens.getState();
      s.setT(d.hit.mark.t);
      if (d.hit.mark.select) s.select(d.hit.mark.select);
    }
  };

  // Wheel: zoom around the pointer, pan sideways.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left;
      setView(([a, b]) => {
        const w = b - a;
        const full = spanT[1] - spanT[0];
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
          const dx = ((e.shiftKey ? e.deltaY : e.deltaX) / width) * w;
          const n0 = Math.max(spanT[0], Math.min(spanT[1] - w, a + dx));
          return [n0, n0 + w];
        }
        const k = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
        const nw = Math.max(HOUR * 3, Math.min(full, w * k));
        const at = a + (x / width) * w;
        let n0 = at - (x / width) * nw;
        n0 = Math.max(spanT[0], Math.min(spanT[1] - nw, n0));
        return [n0, n0 + nw];
      });
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [spanT, width]);

  // Keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useLens.getState();
      const i = SPEEDS.findIndex((x) => x.s === s.speed);
      if (e.key === " ") {
        e.preventDefault();
        if (!s.playing && s.t >= s.span[1]) s.setT(s.span[0]);
        s.setPlaying(!s.playing);
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        s.setT(s.t + dir * (e.shiftKey ? DAY : HOUR));
      } else if (e.key === "]") s.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, (i < 0 ? 1 : i) + 1)]!.s);
      else if (e.key === "[") s.setSpeed(SPEEDS[Math.max(0, (i < 0 ? 1 : i) - 1)]!.s);
      else if (e.key === "Home") s.setT(s.span[0]);
      else if (e.key === "End") s.setT(s.span[1]);
      else if (e.key === "." || e.key === ",") {
        const next = e.key === "." ? allMarks.find((m) => m > s.t + 1) : [...allMarks].reverse().find((m) => m < s.t - 1);
        if (next !== undefined) s.setT(next);
      } else if (e.key === "?") setHelp((h) => !h);
      else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [allMarks]);

  const total = spanT[1] - spanT[0];
  const zoomed = v1 - v0 < total * 0.995;
  const inFork = fork !== undefined ? t - fork : undefined;

  return (
    <div className={`tl ${compact ? "compact" : ""}`}>
      <div className="tl-grip" onPointerDown={onGrip} title="Drag to make the lanes taller or shorter" />
      <div className="tl-bar">
        <div className="tl-controls">
          <button
            className="tl-play"
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause (space)" : "Play (space)"}
            onClick={() => {
              const s = useLens.getState();
              if (!s.playing && s.t >= s.span[1]) s.setT(s.span[0]);
              s.setPlaying(!s.playing);
            }}
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <div className="seg tl-speeds" role="group" aria-label="Speed">
            {(researcher ? SPEEDS : STORY_SPEEDS).map((x) => (
              <button key={x.s} aria-pressed={speed === x.s} onClick={() => useLens.getState().setSpeed(x.s)} title={x.title}>
                {x.label}
              </button>
            ))}
          </div>
        </div>
        <div className="tl-now">
          <span className="tl-day serif num">Day {dayOf(t)}</span>
          <span className="tl-clock num">{clock(t)}</span>
          <span className="tl-rel muted">
            {inFork !== undefined && inFork >= 0 ? `${spanWords(inFork)} after the AI mayor took office` : ""}
            {spanT[1] > t ? `${inFork !== undefined ? ", " : ""}${spanWords(spanT[1] - t)} to the end` : ", the end"}
          </span>
        </div>
        <div className="tl-right">
          {zoomed && (
            <span className="tl-zoom muted">
              {spanText(v1 - v0)} of {spanText(total)}
            </span>
          )}
          <button className="btn ghost icon" title="Show the whole run (double-click)" aria-label="Fit" disabled={!zoomed} onClick={() => setView(spanT)}>
            <Fit />
          </button>
 <button className="btn ghost tl-lanes" title={compact ? "Taller lanes, with their words" : "Compact lanes"} aria-pressed={!compact} onClick={() => setLane(compact ? LANE_ROOMY : LANE_COMPACT)}>
            {compact ? "Taller lanes" : "Shorter lanes"}
          </button>
          {researcher && (
          <button className="btn ghost icon" title="Keys (?)" aria-label="Keys" aria-pressed={help} onClick={() => setHelp((h) => !h)}>
            <Keyboard />
          </button>
          )}
        </div>
      </div>
      <div className="tl-body">
        <div className="tl-labels" style={{ height }}>
          <div style={{ height: AXIS }} />
          <div className="tl-label ground" style={{ height: GROUND }} title={ground?.label}>
            {ground ? ground.label : ""}
          </div>
          {sorted.map((tr) => (
            <div key={tr.id} className="tl-label" style={{ height: LANE }} title={tr.label}>
              {tr.label}
              <span className="faint num">{tr.marks.length}</span>
            </div>
          ))}
        </div>
        <div className="tl-canvas" ref={wrap}>
          <canvas
            ref={canvas}
            style={{ width, height, cursor: hover ? "pointer" : "col-resize" }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => {
              setHover(null);
              setHoverT(null);
            }}
            onDoubleClick={() => setView(spanT)}
          />
          {!sorted.length && <div className="tl-empty faint">The map and the story add their lanes here.</div>}
        </div>
      </div>
      {hover && (
        <div className="tip" style={{ left: Math.min(window.innerWidth - 330, hover.cx + 12), top: hover.cy - 54 }}>
          <div className="eyebrow" style={{ marginBottom: 2 }}>
            {hover.hit.track.label}
          </div>
          <b>{hover.hit.mark.label ?? "—"}</b>
          <div className="faint num" style={{ marginTop: 2 }}>
            day {dayOf(hover.hit.mark.t)} {clock(hover.hit.mark.t)}
            {hover.hit.mark.t2 !== undefined ? `, lasting ${spanText(hover.hit.mark.t2 - hover.hit.mark.t)}` : ""}
          </div>
        </div>
      )}
      {help && <KeysHelp onClose={() => setHelp(false)} />}
    </div>
  );
}

function KeysHelp({ onClose }: { onClose: () => void }) {
  const rows: [string[], string][] = [
    [["space"], "play / pause"],
    [["←", "→"], "an hour back / on"],
    [["⇧", "←→"], "a day"],
    [["[", "]"], "slower / faster"],
    [[",", "."], "previous / next mark"],
    [["Home", "End"], "start / end"],
    [["wheel"], "zoom (with shift: move along)"],
  ];
  return (
    <div className="tl-help" onClick={onClose}>
      {rows.map(([ks, what]) => (
        <div key={what} className="tl-help-row">
          <span>
            {ks.map((k) => (
              <span key={k} className="kbd">
                {k}
              </span>
            ))}
          </span>
          <span className="muted">{what}</span>
        </div>
      ))}
    </div>
  );
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** A CSS colour with an alpha (hex #rrggbb or #rrggbbaa, or anything else through color-mix). */
export function withAlpha(c: string, a: number): string {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c.trim());
  if (m) {
    const base = m[2] ? parseInt(m[2], 16) / 255 : 1;
    return `#${m[1]}${Math.round(base * a * 255).toString(16).padStart(2, "0")}`;
  }
  return `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`;
}

export type { Selection };
