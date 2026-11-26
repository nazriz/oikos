// The parts every page shares: the Story / Researcher switch, the help buttons (the walkthrough and the glossary), the
// line saying what a page answers, and the glossary itself.
import { useEffect } from "react";
import { useMode, toured } from "../mode";
import { COLOURS, PAGE_ANSWERS, WORDS, type PageKey } from "../words";
import "./shell.css";

export function ModeSwitch() {
  const mode = useMode((s) => s.mode);
  const set = useMode((s) => s.setMode);
  return (
    <div className="seg mode-switch" role="group" aria-label="How much to show">
      <button aria-pressed={mode === "story"} onClick={() => set("story")} title="The story, in plain words, one thing at a time">
        Story
      </button>
      <button aria-pressed={mode === "researcher"} onClick={() => set("researcher")} title="Everything: every panel, figure and id">
        Researcher
      </button>
    </div>
  );
}

export function HelpButtons() {
  const startTour = useMode((s) => s.startTour);
  const setGlossary = useMode((s) => s.setGlossary);
  return (
    <>
      <button className="btn ghost help-btn" onClick={() => startTour(0)} title="A walk through Lens, step by step">
        How to read this
      </button>
      <button className="btn ghost help-btn" onClick={() => setGlossary(true)} title="What the words mean">
        Words
      </button>
    </>
  );
}

/** "This page answers: …", the first line of every page. */
export function PageAnswer({ page, className }: { page: PageKey; className?: string }) {
  return (
    <p className={`page-answer ${className ?? ""}`}>
      <span className="page-answer-label">This page answers</span> {PAGE_ANSWERS[page]}
    </p>
  );
}

export function Glossary() {
  const open = useMode((s) => s.glossary);
  const set = useMode((s) => s.setGlossary);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && set(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  if (!open) return null;
  const order = ["seat", "fork", "sitting", "lever", "tier", "attempted", "executed", "considered", "poll", "twin", "translator", "goal", "reader", "wake", "refusal", "bundle"] as const;
  return (
    <div className="glossary-back" onMouseDown={() => set(false)}>
      <aside className="glossary" role="dialog" aria-label="What the words mean" onMouseDown={(e) => e.stopPropagation()}>
        <div className="glossary-head">
          <h2 className="head">What the words mean</h2>
          <button className="btn" onClick={() => set(false)}>
            Close
          </button>
        </div>
        <dl className="glossary-list">
          {order.map((k) => (
            <div key={k} className="glossary-row">
              <dt>
                {WORDS[k].plain.charAt(0).toUpperCase() + WORDS[k].plain.slice(1)}
                <span className="glossary-term"> (in the study: {WORDS[k].term})</span>
              </dt>
              <dd>{WORDS[k].explain}</dd>
            </div>
          ))}
        </dl>
        <h3 className="head glossary-sub">The colours</h3>
        <ul className="glossary-colours">
          {COLOURS.map((c) => (
            <li key={c.token}>
              <span className="swatch" style={{ background: `var(${c.token})` }} />
              <span>
                <b>{c.name.charAt(0).toUpperCase() + c.name.slice(1)}</b> is {c.means}.
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/** Open the walkthrough by itself the first time someone comes. */
export function useFirstVisitTour() {
  const startTour = useMode((s) => s.startTour);
  useEffect(() => {
    if (!toured()) startTour(0);
  }, []);
}
