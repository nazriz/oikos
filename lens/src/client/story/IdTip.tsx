// What an underlined id in a model's words is, in Lens's own small popover (Story mode): on hover with a mouse, on
// keyboard focus, and on a click or tap, where a native title shows nothing. The text is the element's data-tip, written
// by the quote component (text.tsx markText). A click pins the popover, with "Go there" where the id is a place or a
// person the page can open (data-go). On a run page a person's or a record's own hover card (nav/Peek) answers the mouse.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLens } from "../state";

/** A run's name with its "setup N" explained in the same popover: "setup 9 = the same town, started from a different
 * random seed". Not for text inside a link (a tap there explains instead of following it). */
export function withSetups(text: string): ReactNode {
  const parts = text.split(/(\b[Ss]etup \d+\b)/);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 ? <span key={i} className="st-id" tabIndex={0} data-tip={`${p} = the same town as every other run, started from a different random seed`}>{p}</span> : p));
}

type Tip = { text: string; go?: string; x: number; y: number; pinned: boolean };

export function IdTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const run = useLens((s) => s.run);
  useEffect(() => {
    const at = (el: HTMLElement, pin: boolean) => {
      const r = el.getBoundingClientRect();
      pinned.current = pin;
      setTip({ text: el.dataset.tip ?? "", ...(run && el.dataset.go ? { go: el.dataset.go } : {}), x: Math.min(r.left, window.innerWidth - 300), y: r.bottom + 6, pinned: pin });
    };
    const find = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.<HTMLElement>("[data-tip]") ?? null;
    // (A run page's own hover cards take the mouse over a person or a record.)
    const peeked = (el: HTMLElement) => !!run && !!el.dataset.peek;
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch" || box.current?.contains(e.target as Node)) return;
      if (pinned.current) return;
      const el = find(e.target);
      if (el && !peeked(el)) at(el, false);
      else setTip(null);
    };
    const focus = (e: FocusEvent) => { const el = find(e.target); if (el) at(el, false); };
    // (A click or tap on an underlined id pins its popover and does nothing else: not the card's own click. On a run
    // page a person's id still opens their life.)
    const click = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      const el = find(e.target);
      if (!el) { pinned.current = false; return setTip(null); }
      if (run && el.dataset.person) return;
      e.stopPropagation();
      e.preventDefault();
      at(el, true);
    };
    const gone = (e?: Event) => { if (e?.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return; pinned.current = false; setTip(null); };
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
  const go = () => {
    const [kind, id] = (tip.go ?? "").split(/:(.*)/);
    if ((kind === "person" || kind === "structure") && id) useLens.getState().select({ kind, id } as any);
    pinned.current = false;
    setTip(null);
  };
  return (
    <div ref={box} className={`id-tip ${tip.pinned ? "pinned" : ""}`} role="tooltip" style={{ left: Math.max(8, tip.x), top: tip.y }}>
      {tip.text}
      {tip.pinned && tip.go && <button className="id-tip-go" onClick={go}>Go there</button>}
    </div>
  );
}
