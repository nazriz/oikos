// The parts every page shares: the Story / Researcher switch, the help buttons (the walkthrough and the glossary), the
// line saying what a page answers, and the glossary itself.
import { useEffect } from "react";
import { useMode, toured } from "../mode";
import { COLOURS, PAGE_ANSWERS, WORDS, type PageKey } from "../words";
import { useHash } from "../router";
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

/** What a page is for, as a quiet line, only where nothing else says it yet: a run's bar while the run opens. Every
 * other page's title already says what it answers, and the site bar says where it is, so a templated "This page
 * answers: …" above the title only repeated it (docs/decisions.md, 2026-11-27, lens/nav-5). */
export function PageAnswer({ page, className }: { page: PageKey; className?: string }) {
  if (page !== "run") return null;
  return <p className={`page-answer ${className ?? ""}`}>{PAGE_ANSWERS[page]}</p>;
}

export function Glossary() {
  const open = useMode((s) => s.glossary);
  const set = useMode((s) => s.setGlossary);
  // (The study's own names for each word are for researchers: Story mode gives the plain word alone.)
  const researcher = useMode((s) => s.mode === "researcher");
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && set(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  // A link to the words, #/words: the library with the words open over it; closing them leaves the library's own link.
  const hash = useHash();
  const deep = hash.split("?")[0] === "#/words";
  useEffect(() => {
    if (deep) set(true);
  }, [deep]);
  useEffect(() => {
    if (!open && deep) history.replaceState(history.state, "", "#/");
  }, [open]);
  if (!open) return null;
  // (Lens's own machinery, the wake-up and the prepared copy, is for researchers: Story mode leaves it out.)
  const order = ["seat", "fork", "setup", "sitting", "lockin", "lever", "favour", "tier", "attempted", "executed", "considered", "poll", "twin", "translator", "goal", "reader", "refusal", ...(researcher ? (["wake", "bundle"] as const) : [])] as const;
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
                {researcher && <span className="glossary-term"> (in the study: {WORDS[k].term})</span>}
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
    // (Not over a link to the words: the reader asked for those.)
    if (!toured() && window.location.hash.split("?")[0] !== "#/words") startTour(0);
  }, []);
}
