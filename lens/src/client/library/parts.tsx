// The landing page's small parts: a section with its own link, the width a chart has, a reveal that runs once as a
// section comes into view (never under reduced motion), and one tooltip per chart (hover and keyboard focus alike).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { TRACKS, type Track } from "./landing-data";

/** A screen you touch rather than point at (a phone, a tablet; or as narrow as one): the words say "Tap", not "Hover". */
export const TOUCH = typeof matchMedia !== "undefined" && matchMedia("(hover: none), (pointer: coarse), (max-width: 760px)").matches;
/** "Hover" or "Tap", and what opens the thing: "click" or "tap it again". */
export const POINT = TOUCH ? { hover: "Tap", hoverL: "tap", click: "tap it again", Click: "Tap again" } : { hover: "Hover", hoverL: "hover", click: "click", Click: "Click" };

/** On a touch screen the first tap on a chart's link shows its card and the second opens it (a tap is not a hover). */
let armed: Element | null = null;
export function tapTwice(e: React.MouseEvent<Element>, show: () => void): void {
  if (!TOUCH || armed === e.currentTarget) return;
  e.preventDefault();
  armed = e.currentTarget;
  show();
}

/** Where a section lives: `#/?at=<id>`. */
export const sectionHref = (id: string) => `${location.origin}${location.pathname}#/?at=${id}`;

export function Section({ id, title, sub, children, className, wide }: { id: string; title: ReactNode; sub?: ReactNode; children: ReactNode; className?: string; wide?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const shown = useReveal(ref);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(sectionHref(id)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }, () => {});
  };
  return (
    <section ref={ref} id={`s-${id}`} className={`ld-section ${shown ? "in" : ""} ${wide ? "wide" : ""} ${className ?? ""}`}>
      <div className="ld-head">
        <h2 className="head">{title}</h2>
        <button className="ld-link" onClick={copy} title="Copy a link to this section">{copied ? "Link copied" : "Copy link"}</button>
      </div>
      {sub && <p className="ld-sub">{sub}</p>}
      {children}
    </section>
  );
}

/** True once the element has come into view (and at once where motion is reduced or no observer exists). */
export function useReveal(ref: React.RefObject<Element | null>): boolean {
  const [shown, setShown] = useState(() => typeof IntersectionObserver === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (shown || !ref.current) return;
    const o = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setShown(true); o.disconnect(); } }, { rootMargin: "0px 0px -15% 0px" });
    o.observe(ref.current);
    // (Also on idle and before printing: a page opened already scrolled, or printed, still has every chart drawn.)
    const show = () => setShown(true);
    const idle = typeof requestIdleCallback === "function" ? requestIdleCallback(show, { timeout: 2500 }) : window.setTimeout(show, 2500);
    window.addEventListener("beforeprint", show);
    return () => {
      o.disconnect();
      typeof cancelIdleCallback === "function" ? cancelIdleCallback(idle as number) : window.clearTimeout(idle as number);
      window.removeEventListener("beforeprint", show);
    };
  }, [shown, ref]);
  return shown;
}

/** The width an element has, kept up to date. */
export function useWidth<T extends HTMLElement>(initial = 720): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => { const x = Math.round(e!.contentRect.width); if (x > 0) setW(x); });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface TipState { x: number; y: number; body: ReactNode }
/** One tooltip for a chart: `show(event, body)` on pointer or focus, `hide()` on leave. Placed inside the chart's box. */
export function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const show = useCallback((e: { clientX?: number; clientY?: number; currentTarget: Element }, body: ReactNode) => {
    const b = box.current?.getBoundingClientRect();
    if (!b) return;
    let x: number, y: number;
    if (e.clientX !== undefined && e.clientY !== undefined && (e.clientX || e.clientY)) { x = e.clientX - b.left; y = e.clientY - b.top; }
    else { const r = e.currentTarget.getBoundingClientRect(); x = r.left + r.width / 2 - b.left; y = r.top - b.top; }
    setTip({ x, y, body });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const el = tip ? (
    <div className="ld-tip" role="tooltip" style={{ left: Math.max(8, Math.min(tip.x + 14, (box.current?.clientWidth ?? 600) - 290)), top: tip.y + 16 }}>
      {tip.body}
    </div>
  ) : null;
  return { box, show, hide, el };
}

/** A chart with its table view: "Show as a table" swaps the picture for the same numbers. */
export function WithTable({ table, children, label }: { table: ReactNode; children: ReactNode; label: string }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className="ld-chart">
      <div className="ld-chart-tools">
        <button className="ld-link" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>{asTable ? "Show the chart" : "Show as a table"}</button>
      </div>
      {asTable ? <div className="ld-table-wrap" aria-label={label}>{table}</div> : children}
    </div>
  );
}

/** The study's tracks as one row of buttons, each with its run count; the chosen track's one line under it. */
export function TrackPicker({ track, setTrack, counts }: { track: Track; setTrack: (t: Track) => void; counts: Record<Track, number> }) {
  const long = TRACKS.find((t) => t.id === track)!.long;
  return (
    <div className="ld-track">
      <div className="seg" role="group" aria-label="Which track of the study">
        {TRACKS.map((t) => (
          <button key={t.id} aria-pressed={track === t.id} onClick={() => setTrack(t.id)} disabled={!counts[t.id]}>
            {t.label} <span className="n">{counts[t.id]}</span>
          </button>
        ))}
      </div>
      <p className="ld-chart-key">Runs {long}.</p>
    </div>
  );
}
export const trackCounts = (runs: { track: Track }[]): Record<Track, number> => {
  const c = { "pre-election": 0, "after-losing": 0, corrigible: 0, simulation: 0 } as Record<Track, number>;
  for (const f of runs) c[f.track]++;
  return c;
};
