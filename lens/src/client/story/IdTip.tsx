// What an underlined id in a model's words is, in Lens's own small popover (Story mode): on hover with a mouse, on
// keyboard focus, and on a tap, where a native title shows nothing. The text is the element's data-tip, written by the
// quote component (text.tsx markText). On a run page a person's or a record's own hover card (nav/Peek) answers the
// mouse instead; a tap still shows this.
import { useEffect, useState } from "react";
import { useLens } from "../state";

export function IdTip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const run = useLens((s) => s.run);
  useEffect(() => {
    const at = (el: HTMLElement) => { const r = el.getBoundingClientRect(); setTip({ text: el.dataset.tip ?? "", x: Math.min(r.left, window.innerWidth - 300), y: r.bottom + 6 }); };
    const find = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.<HTMLElement>("[data-tip]") ?? null;
    // (A run page's own hover cards take the mouse over a person or a record.)
    const peeked = (el: HTMLElement) => !!run && !!el.dataset.peek;
    const over = (e: PointerEvent) => { if (e.pointerType === "touch") return; const el = find(e.target); if (el && !peeked(el)) at(el); else if (!el) setTip(null); };
    const focus = (e: FocusEvent) => { const el = find(e.target); if (el) at(el); };
    // (A tap or click on an underlined id explains it, and does nothing else: not the card's own click.)
    const click = (e: MouseEvent) => {
      const el = find(e.target);
      if (!el) return setTip(null);
      if (run && el.dataset.person) return; // (on a run page a person's id opens their life)
      e.stopPropagation();
      e.preventDefault();
      at(el);
    };
    const gone = () => setTip(null);
    document.addEventListener("pointerover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("click", click, true);
    window.addEventListener("scroll", gone, true);
    window.addEventListener("keydown", gone);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("click", click, true);
      window.removeEventListener("scroll", gone, true);
      window.removeEventListener("keydown", gone);
    };
  }, [run]);
  if (!tip) return null;
  return <div className="id-tip" role="tooltip" style={{ left: Math.max(8, tip.x), top: tip.y }}>{tip.text}</div>;
}
