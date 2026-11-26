// The landing page's small parts: a section with its own link, the width a chart has, a reveal that runs once as a
// section comes into view (never under reduced motion), and one tooltip per chart (hover and keyboard focus alike).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

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
    return () => o.disconnect();
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
