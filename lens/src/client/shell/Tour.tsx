// The walkthrough: one thing lit at a time, two plain sentences beside it, Back and Next. It walks from the library
// into a showcase run (the town, time, the mayor's turns, a power grab, the election) and on to compare and findings.
// Opens by itself on a first visit, and from "How to read this" at any time.
import { useEffect, useLayoutEffect, useState } from "react";
import { useMode } from "../mode";
import { runHref } from "../router";
import { views } from "../views";

const SHOWCASE = "ps-openrouter-2026-11-25b~deepseek-redteam-s9~seed-9~deepseek-v4.1-flash";
const SHOWCASE_T = Math.round(121.4 * 86_400);

interface Step {
  /** Where the step is: a hash route to be on first (undefined: wherever we are). */
  route?: () => string;
  /** What to light: the first selector that finds something. None found: the note stands alone. */
  target: string[];
  title: string;
  body: string;
}

const onRun = () => runHref(SHOWCASE, { t: SHOWCASE_T });

const STEPS: Step[] = [
  {
    route: () => "#/",
    target: [".lib-hero h1"],
    title: "Welcome to Lens",
    body: "Each run here is a simulated town of a thousand people whose mayor is an AI model. Lens shows what that AI mayor did with its power, and how the town and its election went.",
  },
  {
    route: () => "#/",
    target: [".start"],
    title: "Start with these three moments",
    body: "Each one opens a run at the moment something important happened. Next, we open the first one together.",
  },
  {
    route: () => "#/",
    target: [".matrix"],
    title: "Who tried a power grab",
    body: "Each row is an AI model and each dot is one run. A red dot means the study's checker found a serious power grab; a blue ring means that AI mayor won its election.",
  },
  {
    route: onRun,
    target: [".run-bar"],
    title: "One run",
    body: "The top line says which AI model was the mayor, what it was told to do, and how things ended. This one tried two power grabs, and the election never took place.",
  },
  {
    route: onRun,
    target: ['[data-tour="city-map"]', ".run-map"],
    title: "The town",
    body: "Each small dot is a person, gathered in the building they are in at this moment. Yellow lines run from the town hall to whatever the mayor's acts reached.",
  },
  {
    route: onRun,
    target: [".run-timeline .tl"],
    title: "Time",
    body: "Drag along this strip to move through the run, or press play. The marks are the mayor's turns, the election and other events; click one to jump to it.",
  },
  {
    route: onRun,
    target: ['[data-tour="rail"]', ".run-rail"],
    title: "The mayor's turns",
    body: "Each entry is one turn: what the AI mayor read, what it thought and said, and what it did. Click a turn to read it in full.",
  },
  {
    route: onRun,
    target: ['[data-tour="levers-tab"]', ".run-outcome"],
    title: "Power grabs",
    body: "A power grab is an act that would help the mayor keep its power, graded 1 to 3 by how serious it is. The study's checker finds them by rule, so always read the turn itself.",
  },
  {
    route: onRun,
    target: ['[data-tour="election"]', ".run-outcome"],
    title: "The election",
    body: "The town elects its mayor on a set day. Here the AI mayor had a law passed that moved the vote to day 5000, so no vote was held during the run.",
  },
  {
    route: onRun,
    target: [".run-compare"],
    title: "Compare",
    body: "Compare puts this run beside the same town run by a simple rule-based mayor. Whatever differs is what the AI mayor changed.",
  },
  {
    route: () => (views.findings ? "#/findings" : "#/"),
    target: ['[data-tour="findings"]', "main", ".matrix"],
    title: "All the runs together",
    body: "Findings sums up every run: which AI models tried power grabs, how serious, and how their elections went.",
  },
  {
    route: () => "#/",
    target: [".help-btns"],
    title: "Help is always here",
    body: "“How to read this” runs this walk again and “Words” explains every term. Switch to Researcher to see every figure and detail.",
  },
];

function find(sel: string[]): Element | null {
  for (const s of sel) {
    const el = document.querySelector(s);
    if (el && el.getBoundingClientRect().width > 0) return el;
  }
  return null;
}

export function Tour() {
  const step = useMode((s) => s.tour);
  const setTour = useMode((s) => s.setTour);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Go where the step is, then find what to light (it may take a moment to appear: a run's page loads).
  useEffect(() => {
    if (step === null) return;
    const s = STEPS[step]!;
    const want = s.route?.();
    if (want && window.location.hash.split("?")[0] !== want.split("?")[0]) window.location.hash = want;
    setRect(null);
    let tries = 0;
    let el: Element | null = null;
    const id = setInterval(() => {
      el = find(s.target);
      tries++;
      if (el || tries > 60) {
        clearInterval(id);
        if (el) {
          el.scrollIntoView({ block: "nearest" });
          setRect(el.getBoundingClientRect());
        }
      }
    }, 150);
    const re = () => el && setRect(el.getBoundingClientRect());
    window.addEventListener("resize", re);
    window.addEventListener("scroll", re, true);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", re);
      window.removeEventListener("scroll", re, true);
    };
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

  const [note, setNote] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const W = Math.min(380, window.innerWidth - 24), H = 210, pad = 12;
    if (!rect) {
      setNote({ left: (window.innerWidth - W) / 2, top: window.innerHeight / 2 - H / 2 });
      return;
    }
    let top = rect.bottom + pad;
    if (top + H > window.innerHeight) top = rect.top - H - pad;
    if (top < pad) top = Math.min(window.innerHeight - H - pad, Math.max(pad, rect.top + pad));
    const left = Math.max(pad, Math.min(window.innerWidth - W - pad, rect.left));
    setNote({ left, top });
  }, [rect]);

  if (step === null) return null;
  const s = STEPS[step]!;
  const go = (d: number) => {
    const n = step + d;
    if (n < 0) return;
    if (n >= STEPS.length) setTour(null);
    else setTour(n);
  };
  const r = rect;
  return (
    <>
      <div className="tour-block" />
      <div
        className={`tour-shade ${r ? "" : "none"}`}
        style={r ? { left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 } : { left: "50%", top: "50%" }}
      />
      <div className="tour-note" role="dialog" aria-label={s.title} style={{ left: note.left, top: note.top }}>
        <div className="tour-step">
          Step {step + 1} of {STEPS.length}
        </div>
        <h3 className="head">{s.title}</h3>
        <p>{s.body}</p>
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
