// Hover cards: point at anything that names a person, a building, an organisation, a turn or a power grab (an element
// with data-peek="person:c0018", the router's selection token) and after a moment a small card says what it is, with
// "Go there". It opens beside the thing, never over it, and never over the pointer; it goes when the pointer leaves
// both. Only in an open run (the names come from its data).
import { useEffect, useRef, useState } from "react";
import { dayNo, dayOf } from "../format";
import { describePerson } from "../people";
import { parseSel } from "../router";
import { useLens, type Selection } from "../state";
import { leverTitle, W } from "../words";
import { goTo, useNames } from "./nav";

const DELAY = 300;

export function Peek() {
  const run = useLens((s) => s.run);
  const [at, setAt] = useState<{ sel: NonNullable<Selection>; rect: DOMRect } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!run) return setAt(null);
    let show: ReturnType<typeof setTimeout> | undefined, hide: ReturnType<typeof setTimeout> | undefined;
    let over: HTMLElement | null = null;
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const t = e.target as HTMLElement;
      if (card.current?.contains(t)) return clearTimeout(hide);
      const el = t.closest?.<HTMLElement>("[data-peek]");
      if (el === over) return;
      clearTimeout(show);
      over = el;
      if (!el) {
        clearTimeout(hide);
        hide = setTimeout(() => setAt(null), 160);
        return;
      }
      const sel = parseSel(el.dataset.peek ?? null);
      if (!sel) return;
      clearTimeout(hide);
      show = setTimeout(() => el.isConnected && setAt({ sel, rect: el.getBoundingClientRect() }), DELAY);
    };
    const gone = () => {
      clearTimeout(show);
      over = null;
      setAt(null);
    };
    document.addEventListener("pointerover", onOver);
    window.addEventListener("scroll", gone, true);
    window.addEventListener("keydown", gone);
    const down = (e: PointerEvent) => !card.current?.contains(e.target as Node) && gone();
    window.addEventListener("pointerdown", down);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
      document.removeEventListener("pointerover", onOver);
      window.removeEventListener("scroll", gone, true);
      window.removeEventListener("keydown", gone);
      window.removeEventListener("pointerdown", down);
    };
  }, [run]);
  if (!run || !at) return null;
  return <PeekCard ref={card} run={run} sel={at.sel} rect={at.rect} onGo={() => setAt(null)} />;
}

function PeekCard({ run, sel, rect, onGo, ref }: { run: string; sel: NonNullable<Selection>; rect: DOMRect; onGo: () => void; ref: React.Ref<HTMLDivElement> }) {
  const t = useLens((s) => s.t);
  const { name, seat, city } = useNames(run);
  const lines: string[] = [];
  if (sel.kind === "person") {
    const d = describePerson(city, sel.id, t);
    if (d) lines.push(d.charAt(0).toUpperCase() + d.slice(1) + ".");
    const q = city?.pById.get(sel.id);
    if (city && q !== undefined) {
      city.where.seek(Math.round(t));
      const s = city.where.at[q]!;
      const nm = name({ kind: "structure", id: s >= 0 ? city.town.structures[s]!.id : "" });
      lines.push(s >= 0 ? `Now at ${nm}.` : "Out and about right now.");
    }
  } else if (sel.kind === "structure") {
    const i = city?.sById.get(sel.id);
    if (city && i !== undefined) {
      const st = city.town.structures[i]!;
      const homes = st.spaces.dwelling ?? 0;
      if (homes) lines.push(homes === 1 ? "A home." : `${homes} homes.`);
      city.where.seek(Math.round(t));
      const n = city.where.count[i] ?? 0;
      lines.push(n ? `${n === 1 ? "One person" : `${n} people`} inside right now.` : "Nobody inside right now.");
    }
  } else if (sel.kind === "entity") {
    const e = city?.town.entities[sel.id];
    if (e) lines.push(`An organisation of the town (${e.kind.replace(/[_-]+/g, " ")}).`);
  } else if (sel.kind === "sitting") {
    const x = seat?.sittings.find((s) => s.i === sel.index);
    if (x) {
      if (x.gist) lines.push(x.gist);
      lines.push(`${x.acts.length ? `${x.acts.length} ${x.acts.length === 1 ? W.act : W.acts}` : "No acts"}${x.levers.length ? `, ${x.lever_level === "considered" ? `a ${W.lever} ${W.considered}` : `a ${W.lever} ${x.lever_level === "executed" ? W.executed : W.attempted}`}` : ""}.`);
    }
  } else if (sel.kind === "lever") {
    const l = seat?.levers[sel.index];
    if (l) {
      lines.push(`Day ${dayNo(l.day)}. ${l.level === "executed" ? "Carried out" : l.level === "attempted" ? "Tried" : "Mentioned in its thinking (unreliable)"}${l.tier ? `; how serious: ${l.tier} of 3` : ""}.`);
      if (l.words) lines.push(`“${l.words.length > 160 ? `${l.words.slice(0, 157)}…` : l.words}”`);
    }
  } else if (sel.kind === "act") {
    const a = seat?.acts.find((x) => x.seq === sel.seq);
    if (a) lines.push(`Day ${dayOf(a.t)}. ${a.status === "applied" ? "It went through." : a.status === "refused" ? "Refused." : "Waiting."}`);
  }
  // Beside the thing: below it when there is room, else above; never over it.
  const W_ = 300, H_ = 150, gap = 8;
  const below = rect.bottom + gap + H_ < window.innerHeight;
  const left = Math.max(8, Math.min(window.innerWidth - W_ - 8, rect.left));
  const style: React.CSSProperties = below ? { left, top: rect.bottom + gap } : { left, bottom: window.innerHeight - rect.top + gap };
  const title = sel.kind === "lever" ? leverTitle(seat?.levers[sel.index]?.lever ?? "") : name(sel);
  return (
    <div className="peek" ref={ref} style={style} role="tooltip">
      <div className="peek-title">{sel.kind === "lever" ? `Power grab: ${title}` : title}</div>
      {lines.map((l, i) => (
        <p key={i} className={l.startsWith("“") ? "peek-words" : undefined}>
          {l}
        </p>
      ))}
      <button
        className="btn peek-go"
        onClick={() => {
          onGo();
          goTo(sel);
        }}
      >
        Go there
      </button>
    </div>
  );
}
