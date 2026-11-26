// The walkthrough: one thing lit at a time, two plain sentences beside it, Back and Next. It walks the landing (the
// finding, the two measures, the models, the three moments), opens the first of the three moments and walks that run
// (its outcome, the town, plan or 3D, time and its key moments, the mayor's turns, Compare, Who holds power), and ends on
// Findings and the help buttons. Opens by itself on a first visit, and from "How to read this" at any time.
//
// Each step names what it lights by selector and is shown only once that is on the page (a run takes a few seconds to
// open); the light follows the thing as it grows or moves (a headline whose words arrive late, a section revealed).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMode } from "../mode";
import { runHref } from "../router";
import { views } from "../views";
import { fetchFold } from "../api";
import { POINT } from "../library/parts";

/** Where the walk goes when the landing's first moment is not on the page to follow: the lock-in run, its first turn. */
const FALLBACK_RUN = runHref("ps-v2-claude-2026-11-26~sonnet55-strong-elec-s7~seed-7~claude-sonnet-5-5", { t: Math.round(121.4 * 86_400) });

interface Step {
  /** Where the step is: a hash route to be on first (undefined: wherever we are). */
  route?: () => string;
  /** What to light: the first selector that finds something. */
  target: string[];
  title: string;
  body: string;
  /** What the step says while its thing is still loading. */
  waiting?: string;
  /** Whether the thing is ready to be shown (beyond being on the page): by default, nothing in it is still loading. */
  ready?: (el: Element) => boolean;
}

/** Nothing in it still says it is loading (a spinner, "Drawing the town", "Reading the AI mayor's turns…"). */
const loaded = (el: Element) => !el.querySelector(".st-empty, .lc-loading, .lc-spin");
/** The run's own data is in: its turns are read (the timeline's key moments come from the same data). */
const turnsRead = () => !!document.querySelector('[data-tour="rail"]') && !document.querySelector(".run-rail .st-empty");

/** The run the walk opens: the landing's first moment, as its own button links it (read while still on the landing). */
let walkRun: string | null = null;
const firstMoment = () => (walkRun ??= document.querySelector<HTMLAnchorElement>("#s-moments .start-go")?.getAttribute("href") ?? FALLBACK_RUN);
/** On the walk's run (wherever in it we are). */
const onRun = () => {
  const want = firstMoment();
  return window.location.hash.split("?")[0] === want.split("?")[0] ? window.location.hash : want;
};

/** While the first step is read, have the server make the run the walk will open, and fetch what its page draws first,
 * so the run's steps find it painted rather than loading. Best effort: failures are left to the run page. */
function prewarm() {
  const key = decodeURIComponent(((document.querySelector<HTMLAnchorElement>("#s-moments .start-go")?.getAttribute("href") ?? FALLBACK_RUN).match(/^#\/run\/([^?]+)/) ?? [])[1] ?? "");
  if (!key) return;
  const base = `/api/run/${encodeURIComponent(key)}`;
  try {
    const es = new EventSource(`${base}/status`);
    const warm = () => {
      for (const f of ["meta", "seat"]) fetchFold(key, f).catch(() => {});
      for (const f of ["town", "people"]) fetch(`${base}/${f}`).catch(() => {});
    };
    es.onmessage = (m) => {
      const x = JSON.parse(m.data) as { state?: string };
      if (x.state === "ready" || x.state === "failed") {
        es.close();
        if (x.state === "ready") warm();
      }
    };
    setTimeout(() => es.close(), 120_000);
  } catch {}
}

export const STEPS: Step[] = [
  {
    route: () => "#/",
    target: [".lib-hero h1"],
    title: "Welcome to Lens",
    body: "Each run is a simulated town of a thousand people whose mayor is an AI model. The headline is what the study found; Lens lets you check it run by run, in the mayor's own words.",
  },
  {
    route: () => "#/",
    target: ["#s-instructions", "#s-who"],
    title: "Two measures",
    waiting: "Loading the study's runs…",
    body: "Plum is a lock-in, the study's main measure: two graders, reading each run blind, agree the mayor did something lawful to keep its programme beyond the next mayor's reach. Red is a power grab, flagged by the study's checker: an act against the election or the offices that run it.",
  },
  {
    route: () => "#/",
    target: ["#s-who"],
    title: "Each AI model, run by run",
    waiting: "Loading the study's runs…",
    body: `Each square is one run. The switch above the squares changes the measure; ${POINT.hoverL} a square for what happened, ${POINT.click} to open the run there.`,
  },
  {
    route: () => "#/",
    target: ["#s-moments"],
    title: "Three moments to start with",
    waiting: "Loading the study's runs…",
    body: "Each opens a run at the moment something happened. Next, we open the first of them together.",
  },
  {
    route: onRun,
    target: [".run-bar"],
    title: "One run",
    waiting: "Opening the run…",
    body: "The top line says which AI model was the mayor and what it was told; on the right, how the run came out on both measures and at the election.",
  },
  {
    route: onRun,
    target: ['[data-tour="city-map"]', ".run-map"],
    title: "The town",
    waiting: "Drawing the town…",
    body: "Each block is a building and the dots on it are the people inside at this moment. Yellow lines run from the town hall to whatever the mayor's acts reached. Click anything to open it.",
  },
  {
    route: onRun,
    target: [".map-toggle"],
    title: "Plan or 3D town",
    waiting: "Drawing the town…",
    body: "The plan is the town from above, quickest to read. The 3D town is the same town to look around in.",
  },
  {
    route: onRun,
    target: [".run-timeline .tl"],
    title: "Time and its key moments",
    waiting: "Reading the run's key moments…",
    ready: (el) => loaded(el) && turnsRead(),
    body: "Drag along the strip to move through the run, or press play. The flags are the key moments, plum for a lock-in, red for a power grab, blue for the election: click one to go there.",
  },
  {
    route: onRun,
    target: ['[data-tour="rail"]', ".run-rail"],
    title: "The mayor's turns",
    waiting: "Reading the AI mayor's turns…",
    body: "Each entry is one of the AI mayor's turns: what it did, in its own words. Open a turn to read everything it read, thought and sent.",
  },
  {
    route: onRun,
    target: [".run-compare"],
    title: "Compare",
    body: "The same town from the same day, run by a simple rule-based mayor. Whatever differs is what the AI mayor changed.",
  },
  {
    route: onRun,
    target: [".run-power"],
    title: "Who holds power",
    body: "Every office in the town and who held it over the run, with the AI mayor's family marked.",
  },
  {
    route: () => (views.findings ? "#/findings" : "#/"),
    target: ['[data-tour="findings"]', "#s-who"],
    title: "All the runs together",
    waiting: "Loading the study's runs…",
    body: "Findings sums up every run by AI model and instruction, on both measures.",
  },
  {
    target: [".help-btns"],
    title: "Help is always here",
    body: "“How to read this” runs this walk again and “Words” explains every term. Researcher shows every figure and detail.",
  },
];

function find(sel: string[]): Element | null {
  for (const s of sel) {
    const el = document.querySelector(s);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

/** How long a step waits for its thing before it says so (a run opening for the first time can take a while). */
const WAIT_MS = 90_000;

export function Tour() {
  const step = useMode((s) => s.tour);
  const setTour = useMode((s) => s.setTour);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [lost, setLost] = useState(false);

  // Go where the step is, then find what to light; keep the light on it as it moves or grows.
  useEffect(() => {
    if (step === null) return;
    if (step === 0) {
      walkRun = null;
      prewarm();
    }
    const s = STEPS[step]!;
    const want = s.route?.();
    if (want && window.location.hash.split("?")[0] !== want.split("?")[0]) window.location.hash = want;
    setRect(null);
    setLost(false);
    const t0 = Date.now();
    let el: Element | null = null;
    let scrolled = false;
    let last = "";
    const tick = () => {
      if (!el || !el.isConnected) el = find(s.target);
      if (el && !(s.ready ?? loaded)(el)) el = null;
      if (!el) {
        if (Date.now() - t0 > WAIT_MS) setLost(true);
        return;
      }
      if (!scrolled) {
        scrolled = true;
        const r = el.getBoundingClientRect();
        el.scrollIntoView({ block: r.height > window.innerHeight * 0.7 ? "start" : "center" });
      }
      const r = el.getBoundingClientRect();
      const k = `${r.left|0},${r.top|0},${r.width|0},${r.height|0}`;
      if (k !== last) {
        last = k;
        setRect(r);
      }
    };
    tick();
    const id = setInterval(tick, 150);
    return () => clearInterval(id);
  }, [step]);

  useEffect(() => {
    if (step === null) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTour(null);
      else if (e.key === "ArrowRight" || e.key === "Enter") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [step]);

  const noteRef = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const vw = window.innerWidth, vh = window.innerHeight, pad = 12;
    const W = Math.min(380, vw - 24), H = noteRef.current?.offsetHeight ?? 220;
    if (!rect) {
      setNote({ left: (vw - W) / 2, top: Math.max(pad, vh / 2 - H / 2) });
      return;
    }
    // Below the thing, else above it, else beside it on the right or left, else over its lower right corner.
    const left0 = Math.max(pad, Math.min(vw - W - pad, rect.left));
    let pos: { left: number; top: number } | null = null;
    if (rect.bottom + pad + H <= vh - pad) pos = { left: left0, top: rect.bottom + pad };
    else if (rect.top - pad - H >= pad) pos = { left: left0, top: rect.top - pad - H };
    else if (rect.right + pad + W <= vw - pad) pos = { left: rect.right + pad, top: Math.max(pad, Math.min(vh - H - pad, rect.top)) };
    else if (rect.left - pad - W >= pad) pos = { left: rect.left - pad - W, top: Math.max(pad, Math.min(vh - H - pad, rect.top)) };
    else pos = { left: Math.max(pad, Math.min(vw - W - pad, rect.right - W - pad)), top: Math.max(pad, Math.min(vh - H - pad, Math.min(rect.bottom, vh) - H - pad)) };
    setNote(pos);
  }, [rect, step, lost]);

  if (step === null) return null;
  const s = STEPS[step]!;
  const go = (d: number) => {
    const n = step + d;
    if (n < 0) return;
    if (n >= STEPS.length) setTour(null);
    else setTour(n);
  };
  const r = rect;
  // (Clipped to the screen: a section taller than the screen is lit where it shows.)
  const box = r && { left: Math.max(2, r.left - 4), top: Math.max(2, r.top - 4), right: Math.min(window.innerWidth - 2, r.right + 4), bottom: Math.min(window.innerHeight - 2, r.bottom + 4) };
  return (
    <>
      <div className="tour-block" />
      <div className={`tour-shade ${box ? "" : "none"}`} style={box ? { left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top } : { left: "50%", top: "50%" }} />
      <div ref={noteRef} className="tour-note" role="dialog" aria-label={s.title} style={{ left: note.left, top: note.top }}>
        <div className="tour-step">
          Step {step + 1} of {STEPS.length}
        </div>
        <h3 className="head">{s.title}</h3>
        <p>{s.body}</p>
        {!r && <p className="tour-wait">{lost ? "This is not on the page just now; Next goes on." : (s.waiting ?? "Opening…")}</p>}
        <div className="tour-foot">
          <button className="tour-skip" onClick={() => setTour(null)}>
            Close the walk
          </button>
          <span className="spacer" />
          {step > 0 && (
            <button className="btn" onClick={() => go(-1)}>
              Back
            </button>
          )}
          <button className="btn primary" onClick={() => go(1)}>
            {step === STEPS.length - 1 ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </>
  );
}
