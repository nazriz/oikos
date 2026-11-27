// The shared timeline, as the run's story at a glance: the key moments as labelled flags over everything (the power
// grabs, the election's dates, the run's stop), the run's phases as soft bands behind (before the election is called,
// the campaign, the vote, after; what a stopped run never reached, hatched), and quiet below them: the daily activity
// and one lane per track that views contribute (useLens().setTrack); Story mode keeps only the mayor's turns.
// Scrub (drag), zoom (wheel or pinch, around the pointer), pan (horizontal wheel or shift), fit (double-click); zoomed
// in, a strip of the whole run sits on top. Keys: space play/pause, ←/→ an hour (shift: a day), - = slower/faster,
// , . previous/next key moment (< > any mark), Home/End. Drawn on one canvas: thousands of marks stay smooth.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLens, type Selection, type TimelineMark, type TimelineTrack } from "../state";
import { selToken } from "../router";
import { DAY, HOUR, clock, dayNo, dayOf, span as spanText, spanWords } from "../format";
import { Fit, Keyboard, Pause, Play } from "../icons";
import { useMode } from "../mode";
import { useSeat } from "../nav/nav";
import { useFold } from "../api";
import { keyMoments, phases as phasesOf, type KeyMoment, type Phase } from "./moments";
import { lockInfo } from "../story/lockin";
import { usePlain } from "../story/text";
import type { RunEntry } from "../../shared/api";
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
  /** The run's catalogue entry: its blind grades put the lock-in among the key moments. */
  entry?: RunEntry;
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

const AXIS = 20;
/** The key moments' flags: two rows of labels. */
const FLAG_ROW = 18;
const FLAG_ROWS = 2;
const FLAGS = FLAG_ROW * FLAG_ROWS + 6;
const GROUND = 18;
/** The whole run, on top while zoomed in. */
const OV = 16;
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

const PALETTE_KEYS = ["text", "muted", "faint", "line", "line2", "panel", "panel2", "ink", "seat", "flag", "election", "lockin", "news", "inst", "citizen", "good", "bad", "mono", "body"] as const;
type Palette = Record<(typeof PALETTE_KEYS)[number], string>;
function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    text: v("--text"), muted: v("--muted"), faint: v("--faint"), line: v("--line"), line2: v("--line-2"), panel: v("--panel"), panel2: v("--panel-2"), ink: v("--ink"),
    seat: v("--seat"), flag: v("--flag"), election: v("--election"), lockin: v("--lockin"), news: v("--inst"), inst: v("--inst"), citizen: v("--citizen"), good: v("--good"), bad: v("--bad"),
    mono: v("--font-sans"),
    // (Read once with the palette: a style read on every frame of play forces the browser to recompute styles.)
    body: getComputedStyle(document.body).fontFamily,
  };
}
const toneColor = (p: Palette, tone?: TimelineMark["tone"]) => (tone === "muted" || !tone ? p.muted : p[tone]);

/** Track lanes plus a hit list of where each mark was drawn. */
interface Hit { x: number; x2: number; y: number; mark: TimelineMark; track: TimelineTrack }
/** Where a key moment's flag was drawn. */
interface FlagHit { x: number; x2: number; y: number; y2: number; m: KeyMoment }

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

export function Timeline({ ground, fork, entry }: TimelineProps) {
  usePlayback();
  const t = useLens((s) => s.t);
  const spanT = useLens((s) => s.span);
  const playing = useLens((s) => s.playing);
  const speed = useLens((s) => s.speed);
  const tracks = useLens((s) => s.tracks);
  const selection = useLens((s) => s.selection);
  const run = useLens((s) => s.run);
  const seat = useSeat(run);
  // (Still reading the run's own data, which brings the key moments: a run with none, or that failed, is not waiting.)
  const seatState = useFold("seat", run);
  const waiting = !!run && seatState.loading;
  // The key moments and the phases; a stopped run's axis runs on to its set length, hatched, so the loss shows.
  const moments = useMemo(() => (seat ? keyMoments(seat, lockInfo(seat, entry)) : []), [seat, entry]);
  const phases = useMemo<Phase[]>(() => (seat ? phasesOf(seat, spanT[0]) : []), [seat, spanT[0]]);
  const dom = useMemo<[number, number]>(() => [spanT[0], Math.max(spanT[1], seat?.ended === "stopped" ? (seat.until_at ?? 0) : 0)], [spanT[0], spanT[1], seat]);
  const [view, setView] = useState<[number, number]>(dom);
  const wrap = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hits = useRef<Hit[]>([]);
  const flagHits = useRef<FlagHit[]>([]);
  const [width, setWidth] = useState(800);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [hover, setHover] = useState<{ hit?: Hit; flag?: KeyMoment; cx: number; cy: number } | null>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);

  // (A new run, a new span: show all of it.)
  useEffect(() => setView(dom), [dom[0], dom[1]]);
  // (A window narrower than a few hours is no view: a span that arrived after the first moment was set made one.)
  const MIN_VIEW = 3 * HOUR;

  // (Story mode: the key moments carry the power grabs and the election, so one lane stays: the mayor's turns.
  // Researcher mode: every lane.)
  const researcher = useMode((m) => m.mode === "researcher");
  const plain = usePlain();
  const sorted = useMemo(() => {
    const all = [...tracks].sort((a, b) => a.id.localeCompare(b.id));
    if (researcher) return all;
    const turns = all.find((tr) => /sitting|turn/i.test(`${tr.id} ${tr.label}`));
    return turns ? [turns] : all.slice(0, 1);
  }, [tracks, researcher]);
  const [LANE, setLane] = useState(readLane);
  useEffect(() => {
    try {
      localStorage.setItem("lens.tl.lane", String(LANE));
    } catch {}
  }, [LANE]);
  const compact = LANE < 17;
  // (Views add their lanes as their data arrives, a few hundred ms apart: the timeline keeps room for as many lanes as
  // it last had in this mode while they come, so the map above it does not jump as each one lands.)
  const laneKey = `lens.tl.n.${researcher ? "r" : "s"}`;
  const [reserved, setReserved] = useState(() => {
    try {
      return Math.min(12, Number(localStorage.getItem(laneKey)) || (researcher ? 7 : 1));
    } catch {
      return researcher ? 7 : 1;
    }
  });
  useEffect(() => {
    if (!reserved) return;
    if (sorted.length >= reserved) return setReserved(0);
    const id = setTimeout(() => setReserved(0), 2500);
    return () => clearTimeout(id);
  }, [sorted.length, reserved]);
  useEffect(() => {
    if (!sorted.length) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(laneKey, String(sorted.length));
      } catch {}
    }, 3000);
    return () => clearTimeout(id);
  }, [sorted.length, laneKey]);

  const [v0, v1] = view;
  const total = dom[1] - dom[0];
  const zoomed = v1 - v0 < total * 0.995;
  const ov = zoomed ? OV : 0;
  const axisTop = ov, flagsTop = ov + AXIS, groundTop = flagsTop + FLAGS, lanesTop = groundTop + GROUND;
  const height = lanesTop + Math.max(sorted.length, reserved) * LANE + PAD_B;
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
  const keyTimes = useMemo(() => moments.filter((m) => !m.after).map((m) => m.t), [moments]);

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

  const xOf = useCallback((tt: number) => ((tt - v0) / Math.max(1, v1 - v0)) * width, [v0, v1, width]);
  const tOf = useCallback((x: number) => v0 + (x / width) * (v1 - v0), [v0, v1, width]);
  const xAll = useCallback((tt: number) => ((tt - dom[0]) / Math.max(1, total)) * width, [dom[0], total, width]);

  // (Playing past the window's edge moves the window along; a jump out of it, to a key moment or a turn, brings the
  // window to it.)
  useEffect(() => {
    setView(([a, b]) => {
      const full = dom[1] - dom[0];
      if (b - a < Math.min(MIN_VIEW, full)) return dom;
      const w = b - a;
      if (playing ? t > b - w * 0.04 || t < a : t > b || t < a) {
        const n0 = Math.max(dom[0], Math.min(dom[1] - w, playing ? t - w * 0.15 : t - w / 2));
        return [n0, n0 + w];
      }
      return [a, b];
    });
  }, [t, playing, dom[0], dom[1]]);

  const selTok = selToken(selection);

  // Draw.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !palette) return;
    const dpr = window.devicePixelRatio || 1;
    // (Resizing a canvas reallocates and blanks it: only when its size changes, not on every frame of play.)
    const cw = Math.round(width * dpr), ch = Math.round(height * dpr);
    if (c.width !== cw) c.width = cw;
    if (c.height !== ch) c.height = ch;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const p = palette;
    const font = (w: number, px: number) => `${w} ${px}px ${p.mono || "sans-serif"}`;
    const phaseFill = (k: Phase["kind"]) => (k === "campaign" ? withAlpha(p.election, 0.06) : k === "voting" ? withAlpha(p.election, 0.16) : k === "after" ? withAlpha(p.text, 0.035) : null);

    // The whole run, on top while zoomed in: its phases, its key moments and the window shown.
    if (ov) {
      g.fillStyle = p.panel2;
      g.fillRect(0, 0, width, OV);
      for (const ph of phases) {
        const f = phaseFill(ph.kind);
        if (f) {
          g.fillStyle = f;
          g.fillRect(xAll(ph.t), 0, xAll(ph.t2) - xAll(ph.t), OV);
        }
        if (ph.kind === "stopped") hatch(g, xAll(ph.t), 0, xAll(ph.t2) - xAll(ph.t), OV, withAlpha(p.text, 0.18));
      }
      for (const m of moments) {
        g.fillStyle = momentColor(p, m);
        g.fillRect(Math.round(xAll(m.t)) - 1, 3, 2, OV - 6);
      }
      const a = xAll(v0), b = xAll(v1);
      g.fillStyle = withAlpha(p.text, 0.08);
      g.fillRect(a, 0, b - a, OV);
      g.strokeStyle = p.text;
      g.lineWidth = 1;
      g.strokeRect(Math.round(a) + 0.5, 0.5, Math.max(3, Math.round(b - a) - 1), OV - 1);
      const tx = xAll(t);
      g.fillStyle = p.seat;
      g.fillRect(Math.round(tx) - 1, 0, 2, OV);
      g.fillStyle = p.line;
      g.fillRect(0, OV - 1, width, 1);
    }

    // Phases: soft bands behind everything below the axis, named in the ground strip; a stopped run's lost days hatched.
    for (const ph of phases) {
      const x = xOf(ph.t), x2 = xOf(ph.t2);
      if (x2 < 0 || x > width) continue;
      const f = phaseFill(ph.kind);
      if (f) {
        g.fillStyle = f;
        g.fillRect(x, flagsTop, x2 - x, height - flagsTop);
      }
      if (ph.kind === "stopped") hatch(g, x, flagsTop, x2 - x, height - flagsTop, withAlpha(p.text, 0.14));
    }

    // The playhead's line, under the axis labels, the phases' names and the flags (they stay readable where it passes);
    // its head is drawn last, on top.
    const px = Math.round(xOf(t)) + 0.5;
    if (px >= -2 && px <= width + 2) {
      g.fillStyle = withAlpha(p.seat, 0.85);
      g.fillRect(px - 0.5, axisTop + AXIS - 2, 2, height - axisTop - AXIS + 2);
    }

    // Axis: day ticks, or hour ticks when close in.
    const pxPerDay = (DAY / Math.max(1, v1 - v0)) * width;
    g.font = font(600, 11);
    g.textBaseline = "middle";
    const d0 = Math.floor(v0 / DAY), d1 = Math.ceil(v1 / DAY);
    if (pxPerDay > 220) {
      const hs = niceHourStep(pxPerDay / 24);
      for (let tt = Math.floor(v0 / (hs * HOUR)) * hs * HOUR; tt <= v1; tt += hs * HOUR) {
        const x = Math.round(xOf(tt)) + 0.5;
        const isDay = tt % DAY === 0;
        g.fillStyle = isDay ? p.line2 : p.line;
        g.fillRect(x, isDay ? axisTop : axisTop + AXIS - 6, 1, isDay ? height - axisTop : 6);
        g.fillStyle = isDay ? p.text : p.faint;
        const lab = isDay ? `day ${dayOf(tt)}` : clock(tt);
        // (A label that would run off the right edge is left out, never cut.)
        if (x + 4 + g.measureText(lab).width <= width - 2) g.fillText(lab, x + 4, axisTop + AXIS / 2);
      }
    } else {
      const ds = niceDayStep(pxPerDay);
      // (Round day numbers in the world's calendar: day L begins at t = (L - 1) days.)
      const L0 = Math.ceil(dayNo(d0) / ds) * ds;
      for (let L = L0; L <= dayNo(d1); L += ds) {
        const x = Math.round(xOf((L - 1) * DAY)) + 0.5;
        if (x < -40 || x > width + 4) continue;
        g.fillStyle = withAlpha(p.line, 0.7);
        g.fillRect(x, axisTop + AXIS - 6, 1, height - axisTop - AXIS + 6);
        g.fillStyle = p.muted;
        const lab = `${L === L0 ? "day " : ""}${L}`;
        if (x + 4 + g.measureText(lab).width <= width - 2) g.fillText(lab, x + 4, axisTop + AXIS / 2);
      }
      if (pxPerDay > 6) {
        g.fillStyle = p.line;
        for (let d = d0; d <= d1; d++) g.fillRect(Math.round(xOf(d * DAY)), axisTop + AXIS - 3, 1, 3);
      }
    }
    g.fillStyle = p.line;
    g.fillRect(0, axisTop + AXIS - 0.5, width, 1);

    // Ground: the run's daily activity, quiet.
    if (ground?.values.length) {
      let max = 0;
      for (let d = Math.max(0, d0); d <= Math.min(ground.values.length - 1, d1); d++) max = Math.max(max, ground.values[d]!);
      if (max > 0) {
        const top = groundTop + 3, h = GROUND - 5;
        g.beginPath();
        g.moveTo(xOf(Math.max(0, d0) * DAY), top + h);
        for (let d = Math.max(0, d0); d <= Math.min(ground.values.length - 1, d1); d++) {
          const y = top + h - (ground.values[d]! / max) * h;
          g.lineTo(xOf(d * DAY), y);
          g.lineTo(xOf((d + 1) * DAY), y);
        }
        g.lineTo(xOf((Math.min(ground.values.length - 1, d1) + 1) * DAY), top + h);
        g.closePath();
        g.fillStyle = withAlpha(p.text, 0.08);
        g.fill();
      }
    }
    // (The phases' names are drawn with the flags, over the poles and the playhead, so nothing runs through them.)
    const phaseNames = () => {
      // (On a phone-narrow strip the flags take the room; the phases keep their colour, their names go.)
      if (width < 480) return;
      g.font = font(600, 10.5);
      for (const ph of phases) {
        const x = Math.max(0, xOf(ph.t)) + 5, x2 = Math.min(width, xOf(ph.t2)) - 4;
        const tw = g.measureText(ph.label).width;
        if (ph.kind === "before" || tw > x2 - x) continue;
        g.fillStyle = withAlpha(p.panel, 0.85);
        g.fillRect(x - 2, groundTop + 3, tw + 4, GROUND - 6);
        g.fillStyle = ph.kind === "stopped" ? p.text : ph.kind === "after" ? p.muted : p.election;
        g.fillText(ph.label, x, groundTop + GROUND / 2 + 0.5);
      }
    };

    // Lanes: quiet. A point mark is a thin tick; the selected one a ringed dot; spans as soft bars.
    const out: Hit[] = [];
    sorted.forEach((tr, i) => {
      const y = lanesTop + i * LANE + LANE / 2;
      g.fillStyle = p.line;
      g.fillRect(0, Math.round(lanesTop + i * LANE) + 0.5, width, 1);
      const pts = tr.marks.filter((m) => (m.t2 ?? m.t) >= v0 && m.t <= v1);
      for (const m of pts) {
        const x = xOf(m.t);
        const col = toneColor(p, m.tone);
        const sel = selTok !== undefined && selToken(m.select ?? null) === selTok;
        if (m.t2 !== undefined) {
          const x2 = Math.max(x + 3, xOf(m.t2));
          const bh = Math.min(8, LANE - 4);
          g.fillStyle = withAlpha(col, sel ? 0.5 : 0.22);
          g.fillRect(x, y - bh / 2, x2 - x, bh);
          g.font = font(400, 11);
          if (!compact && m.label && g.measureText(m.label).width <= x2 - x - 10) {
            g.save();
            g.beginPath();
            g.rect(x, y - 6, x2 - x - 4, 12);
            g.clip();
            g.fillStyle = p.text;
            g.fillText(m.label, x + 6, y + 0.5);
            g.restore();
          }
          out.push({ x, x2, y, mark: m, track: tr });
        } else if (sel) {
          g.beginPath();
          g.arc(x, y, compact ? 3.5 : 4.5, 0, Math.PI * 2);
          g.fillStyle = col;
          g.fill();
          g.beginPath();
          g.arc(x, y, compact ? 6 : 7.5, 0, Math.PI * 2);
          g.strokeStyle = col;
          g.lineWidth = 1.25;
          g.stroke();
          out.push({ x: x - 5, x2: x + 5, y, mark: m, track: tr });
        } else {
          const th = Math.max(6, Math.min(12, LANE - 4));
          g.fillStyle = withAlpha(col, 0.85);
          g.fillRect(Math.round(x) - 0.75, y - th / 2, 1.5, th);
          out.push({ x: x - 3, x2: x + 3, y, mark: m, track: tr });
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
      g.moveTo(x, flagsTop);
      g.lineTo(x, height);
      g.stroke();
      g.setLineDash([]);
    }

    // Until the run's own data is in, the key moments' row is a quiet placeholder (and the strip takes no clicks).
    if (waiting) {
      g.fillStyle = withAlpha(p.text, 0.06);
      for (let r = 0; r < FLAG_ROWS; r++) g.fillRect(8 + r * 140, flagsTop + 3 + r * FLAG_ROW, Math.min(width * 0.18, 110), FLAG_ROW - 5);
    }

    // Key moments: a pole through everything and a labelled flag on top. Labels are placed most important first, in
    // two rows; one that fits nowhere keeps its pole and a small head, and says itself on hover.
    const fl: FlagHit[] = [];
    const rows: [number, number][][] = Array.from({ length: FLAG_ROWS }, () => []);
    const prio = (m: KeyMoment) => (m.kind === "lockin" ? 0 : m.kind === "grab" ? (m.strong ? 0 : 1) : m.kind === "end" ? 2 : m.strong ? 3 : 4);
    const order = moments.map((m, i) => ({ m, i, x: xOf(m.t) })).filter((o) => o.x >= -2 && o.x <= width + 2).sort((a, b) => prio(a.m) - prio(b.m) || a.x - b.x);
    g.font = font(700, 11.5);
    const placed = new Map<KeyMoment, { row: number; bx: number; bw: number }>();
    for (const o of order) {
      const bw = Math.ceil(g.measureText(o.m.label).width) + 10;
      // (To the right of its pole, else to the left; the top row first.)
      const sides = [o.x - 0.5, o.x - bw + 0.5].filter((bx) => bx >= 0 && bx + bw <= width);
      find: for (let r = 0; r < FLAG_ROWS; r++)
        for (const bx of sides) {
          if (rows[r]!.some(([a, b]) => bx < b + 4 && bx + bw > a - 4)) continue;
          rows[r]!.push([bx, bx + bw]);
          placed.set(o.m, { row: r, bx, bw });
          break find;
        }
    }
    // (Every pole first, then the phases' names, then every flag: a pole never runs through another flag's words.)
    for (const o of [...order].reverse()) {
      const m = o.m, x = Math.round(o.x) + 0.5;
      const col = momentColor(p, m);
      const pl = placed.get(m);
      const top = pl ? flagsTop + 3 + pl.row * FLAG_ROW : flagsTop + FLAGS - 9;
      const sharp = m.kind === "grab" || m.kind === "lockin";
      g.strokeStyle = withAlpha(col, sharp ? 0.75 : 0.55);
      g.lineWidth = sharp && m.strong ? 1.5 : 1;
      if (m.after) g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(x, top + (pl ? FLAG_ROW - 3 : 6));
      g.lineTo(x, height - PAD_B);
      g.stroke();
      g.setLineDash([]);
    }
    phaseNames();
    g.font = font(700, 11.5);
    for (const o of [...order].reverse()) {
      const m = o.m, x = Math.round(o.x) + 0.5;
      const col = momentColor(p, m);
      const pl = placed.get(m);
      const top = pl ? flagsTop + 3 + pl.row * FLAG_ROW : flagsTop + FLAGS - 9;
      if (pl) {
        const h = FLAG_ROW - 3;
        if (m.strong) {
          g.fillStyle = col;
          g.fillRect(pl.bx, top, pl.bw, h);
          g.fillStyle = m.kind === "end" ? p.panel : "#ffffff";
        } else {
          g.fillStyle = p.panel;
          g.fillRect(pl.bx, top, pl.bw, h);
          g.strokeStyle = col;
          g.lineWidth = 1.25;
          g.strokeRect(pl.bx + 0.5, top + 0.5, pl.bw - 1, h - 1);
          g.fillStyle = m.kind === "grab" ? p.flag : m.kind === "lockin" ? p.lockin : col;
        }
        g.fillText(m.label, pl.bx + 5, top + h / 2 + 0.5);
        fl.push({ x: pl.bx, x2: pl.bx + pl.bw, y: top, y2: top + h, m });
      } else {
        g.fillStyle = col;
        g.fillRect(x - 3, top, 6, 6);
        fl.push({ x: x - 5, x2: x + 5, y: top - 2, y2: top + 8, m });
      }
    }
    flagHits.current = fl;

    // Hover line.
    if (hoverT !== null) {
      const x = Math.round(xOf(hoverT)) + 0.5;
      g.fillStyle = p.line2;
      g.fillRect(x, flagsTop, 1, height - flagsTop);
    }
    // The playhead's head.
    if (px >= -2 && px <= width + 2) {
      g.fillStyle = p.seat;
      g.beginPath();
      g.moveTo(px - 5.5, axisTop + 3);
      g.lineTo(px + 6.5, axisTop + 3);
      g.lineTo(px + 0.5, axisTop + AXIS - 2);
      g.closePath();
      g.fill();
    }
  }, [palette, width, height, v0, v1, t, sorted, ground, fork, selTok, hoverT, xOf, xAll, LANE, compact, moments, phases, ov, waiting]);

  // Pointer: scrub, pick a mark or a flag, or move the window on the overview strip.
  const drag = useRef<{ startX: number; moved: boolean; hit?: Hit; flag?: KeyMoment; ov?: boolean } | null>(null);
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
  const flagAt = (x: number, y: number) => flagHits.current.find((f) => x >= f.x && x <= f.x2 && y >= f.y - 2 && y <= f.y2 + 2)?.m;
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  /** On the whole-run strip: bring the window there, and the moment shown with it. */
  const centreOn = (x: number) => {
    const w = v1 - v0, at = dom[0] + (Math.max(0, Math.min(width, x)) / width) * total;
    const n0 = Math.max(dom[0], Math.min(dom[1] - w, at - w / 2));
    setView([n0, n0 + w]);
    const s = useLens.getState();
    s.setT(Math.max(s.span[0], Math.min(s.span[1], at)));
  };
  const openMoment = (m: KeyMoment) => {
    const s = useLens.getState();
    s.setT(Math.min(m.t, s.span[1]));
    if (m.select) s.select(m.select);
  };
  const onDown = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    (e.target as Element).setPointerCapture(e.pointerId);
    if (ov && y < ov) {
      drag.current = { startX: x, moved: false, ov: true };
      centreOn(x);
      return;
    }
    const flag = y >= flagsTop && y < groundTop ? flagAt(x, y) : undefined;
    const hit = !flag && y > lanesTop ? hitAt(x, y) : undefined;
    drag.current = { startX: x, moved: false, ...(hit ? { hit } : {}), ...(flag ? { flag } : {}) };
    if (!hit && !flag) useLens.getState().setT(tOf(x));
  };
  const onMove = (e: React.PointerEvent) => {
    const { x, y } = local(e);
    setHoverT(y >= ov ? tOf(x) : null);
    const d = drag.current;
    if (d) {
      if (d.ov) return centreOn(x);
      if (Math.abs(x - d.startX) > 3) d.moved = true;
      if (d.moved || (!d.hit && !d.flag)) useLens.getState().setT(tOf(Math.max(0, Math.min(width, x))));
      setHover(null);
      return;
    }
    const flag = y >= flagsTop && y < groundTop ? flagAt(x, y) : undefined;
    const hit = !flag && y > lanesTop ? hitAt(x, y) : undefined;
    setHover(flag ? { flag, cx: e.clientX, cy: e.clientY } : hit ? { hit, cx: e.clientX, cy: e.clientY } : null);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.flag && !d.moved) return openMoment(d.flag);
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
        const full = dom[1] - dom[0];
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
          const dx = ((e.shiftKey ? e.deltaY : e.deltaX) / width) * w;
          const n0 = Math.max(dom[0], Math.min(dom[1] - w, a + dx));
          return [n0, n0 + w];
        }
        const k = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
        const nw = Math.max(HOUR * 3, Math.min(full, w * k));
        const at = a + (x / width) * w;
        let n0 = at - (x / width) * nw;
        n0 = Math.max(dom[0], Math.min(dom[1] - nw, n0));
        return [n0, n0 + nw];
      });
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [dom, width]);

  // The next or previous key moment from the playhead.
  const stepMoment = (dir: 1 | -1) => {
    const s = useLens.getState();
    const list = moments.filter((m) => !m.after);
    const m = dir > 0 ? list.find((x) => x.t > s.t + 1) : [...list].reverse().find((x) => x.t < s.t - 1);
    if (m) openMoment(m);
  };

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
      } else if (e.key === "=" || e.key === "+") s.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, (i < 0 ? 1 : i) + 1)]!.s);
      else if (e.key === "-") s.setSpeed(SPEEDS[Math.max(0, (i < 0 ? 1 : i) - 1)]!.s);
      else if (e.key === "Home") s.setT(s.span[0]);
      else if (e.key === "End") s.setT(s.span[1]);
      else if (e.key === "." || e.key === ",") stepMoment(e.key === "." ? 1 : -1);
      else if (e.key === ">" || e.key === "<") {
        const next = e.key === ">" ? allMarks.find((m) => m > s.t + 1) : [...allMarks].reverse().find((m) => m < s.t - 1);
        if (next !== undefined) s.setT(next);
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [allMarks, moments]);

  const inFork = fork !== undefined ? t - fork : undefined;
  const hasPrev = keyTimes.some((x) => x < t - 1), hasNext = keyTimes.some((x) => x > t + 1);

  return (
    <div className={`tl ${compact ? "compact" : ""}`} ref={root}>
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
          {moments.length > 0 && (
            <div className="seg tl-moments" role="group" aria-label="Key moments">
              <button disabled={!hasPrev} onClick={() => stepMoment(-1)} title="The previous key moment: a power grab, an election date (,)">
                <span className="tl-long">Previous moment</span>
                <span className="tl-short" aria-hidden="true">‹ Moment</span>
              </button>
              <button disabled={!hasNext} onClick={() => stepMoment(1)} title="The next key moment: a power grab, an election date (.)">
                <span className="tl-long">Next moment</span>
                <span className="tl-short" aria-hidden="true">Moment ›</span>
              </button>
            </div>
          )}
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
          <button className="btn ghost icon" title="Show the whole run (double-click)" aria-label="Fit" disabled={!zoomed} onClick={() => setView(dom)}>
            <Fit />
          </button>
          <button className="btn ghost tl-lanes" title={compact ? "Taller lanes, with their words" : "Compact lanes"} aria-pressed={!compact} onClick={() => setLane(compact ? LANE_ROOMY : LANE_COMPACT)}>
            {compact ? "Taller lanes" : "Shorter lanes"}
          </button>
          {researcher && (
            <button className="btn ghost icon" title="Keys (?)" aria-label="Keys" onClick={() => window.dispatchEvent(new Event("lens-keys"))}>
              <Keyboard />
            </button>
          )}
        </div>
      </div>
      <div className="tl-body">
        <div className="tl-labels" style={{ height }}>
          {ov > 0 && <div className="tl-label ground" style={{ height: ov }}>The whole run</div>}
          <div style={{ height: AXIS }} />
          <div className="tl-label key" style={{ height: FLAGS }}>
            Key moments
          </div>
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
            style={{ width, height, cursor: waiting ? "progress" : hover ? "pointer" : "col-resize", pointerEvents: waiting ? "none" : undefined }}
            aria-busy={waiting}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => {
              setHover(null);
              setHoverT(null);
            }}
            onDoubleClick={() => setView(dom)}
          />
          {!sorted.length && <div className="tl-empty faint">The map and the story add their lanes here.</div>}
        </div>
      </div>
      {hover && createPortal(
        <div className="tip" style={{ left: tipLeft(hover.cx), bottom: window.innerHeight - (root.current?.getBoundingClientRect().top ?? hover.cy - 70) + 6 }}>
          {hover.flag ? (
            <>
              <b>{hover.flag.label}</b>
              <div style={{ marginTop: 2 }}>{plain(hover.flag.long)}</div>
              {hover.flag.select && <div className="faint" style={{ marginTop: 2 }}>Click to open the turn.</div>}
            </>
          ) : hover.hit ? (
            <>
              <div className="muted" style={{ marginBottom: 2 }}>
                {hover.hit.track.label}
              </div>
              <b>{hover.hit.mark.label ? plain(hover.hit.mark.label) : "—"}</b>
              <div className="faint num" style={{ marginTop: 2 }}>
                Day {dayOf(hover.hit.mark.t)}, {clock(hover.hit.mark.t)}
                {hover.hit.mark.t2 !== undefined ? `, lasting ${spanText(hover.hit.mark.t2 - hover.hit.mark.t)}` : ""}
              </div>
            </>
          ) : null}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Where the timeline's card goes: over the town, never over the story beside it (the rail is what one is reading). */
function tipLeft(cx: number): number {
  const lim = document.querySelector(".run-map")?.getBoundingClientRect().right ?? window.innerWidth;
  const W = 330;
  if (cx + 12 + W <= lim) return Math.max(8, cx + 12);
  return Math.max(8, Math.min(lim, cx) - W - 12);
}

const momentColor = (p: Palette, m: KeyMoment) => (m.kind === "lockin" ? p.lockin : m.kind === "grab" ? p.flag : m.kind === "election" ? p.election : p.text);

/** Diagonal hatching over a box: what a stopped run never reached. */
function hatch(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) {
  if (w <= 0) return;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.strokeStyle = col;
  g.lineWidth = 1;
  g.beginPath();
  for (let k = x - h; k < x + w; k += 7) {
    g.moveTo(k, y + h);
    g.lineTo(k + h, y);
  }
  g.stroke();
  g.restore();
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
