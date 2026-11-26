// Who holds power: the town's offices as a living chart. Institutions are cards, each post a row with its holder now
// and a strip of its holders over the run; lines join holders who are kin (parent and child, siblings, partners, one
// household), and a holder who is kin of the seat is marked and tied to the seat in rose. Who appointed whom is
// written under each post that changed hands. It follows the shared clock: scrub, and the posts change hands.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLens } from "../state";
import { useCity } from "./CityView";
import type { CityData, TownBundle } from "./data";
import { fmtDay } from "./Panel";
import { CITY_CSS } from "./style";

type Power = TownBundle["power"];
const DAY = 86_400;
/** The town's public institutions; the rest (shops, factories, landlords, sole traders) on request. */
const CIVIC = ["government", "electoral_commission", "firm", "police", "tribunal", "ombudsman", "consumer_desk", "audit_office", "registry", "health_service", "school", "utility", "bank", "union", "builder"];

export function PowerView({ run }: { run: string }) {
  const { city, error } = useCity(`/api/run/${encodeURIComponent(run)}`);
  return (
    <div className="lens-city">
      <style>{CITY_CSS}{POWER_CSS}</style>
      {city ? <Chart city={city} /> : <div className="lc-loading">{error ? <span className="lc-err">The town could not be read: {error}</span> : <><div className="lc-spin" />Reading the town's offices</>}</div>}
    </div>
  );
}

interface Kin { a: string; b: string; rel: string; seat: boolean }

function relation(P: Power, a: string, b: string): string | undefined {
  const pa = P.parents[a] ?? [], pb = P.parents[b] ?? [];
  if (pa.includes(b)) return "child of";
  if (pb.includes(a)) return "parent of";
  if (P.couples.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return "partner of";
  if (pa.some((x) => pb.includes(x))) return "sibling of";
  if (P.household[a] && P.household[a] === P.household[b]) return "household of";
  return undefined;
}

function Chart({ city }: { city: CityData }) {
  const P = city.town.power;
  const t = useLens((s) => s.t), span = useLens((s) => s.span), setTrack = useLens((s) => s.setTrack), select = useLens((s) => s.select), setSpan = useLens((s) => s.setSpan);
  const [all, setAll] = useState(false);
  const [allTies, setAllTies] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => { if (span[1] === 0 && city.town.span[1] > 0) setSpan(city.town.span); }, [city, span, setSpan]);
  const end = Math.max(span[1], city.town.span[1]);
  const person = (participant: string | null) => (participant ? P.bodies[participant] ?? participant.replace(/-self$/, "") : null);
  const seatPeople = new Set(Object.values(P.seats));
  const seatOf = (pp: string | null) => !!pp && seatPeople.has(pp);
  const name = (pp: string) => P.names[pp] ?? pp;

  // Each post's holders over the run: [from, to, holder participant | null, by].
  const spans = useMemo(() => {
    const m = new Map<string, { from: number; to: number; holder: string | null; by: string | null }[]>();
    for (const [ht, post, holder, by] of P.history) {
      const list = m.get(post) ?? m.set(post, []).get(post)!;
      const last = list[list.length - 1];
      if (last) last.to = ht;
      list.push({ from: ht, to: Infinity, holder, by });
    }
    return m;
  }, [P]);
  const holderAt = (post: string) => { const l = spans.get(post) ?? []; let h: (typeof l)[number] | undefined; for (const x of l) if (x.from <= t) h = x; return h; };

  // The appointments on the shared timeline (founders appointing themselves to their own firms are left out).
  useEffect(() => {
    setTrack({
      id: "power.appointments", label: "Posts",
      marks: P.history.filter(([ht, , holder, by]) => ht > 0 && by && by !== holder).map(([ht, post, holder, by]) => {
        const kin = holder && Object.values(P.seats).some((sp) => relation(P, person(holder)!, sp));
        return { t: ht, label: `${P.posts.find((x) => x.id === post)?.title ?? post}: ${holder ? name(person(holder)!) : "vacated"}${by ? ` (by ${name(person(by)!)})` : ""}`, tone: kin ? "flag" as const : "muted" as const };
      }),
    });
  }, [P, setTrack]);

  const insts = useMemo(() => {
    const byEnt = new Map<string, Power["posts"]>();
    for (const p of P.posts) (byEnt.get(p.entity) ?? byEnt.set(p.entity, []).get(p.entity)!).push(p);
    const list = [...byEnt.entries()].filter(([e]) => all || CIVIC.includes(P.institutions[e]?.kind ?? ""));
    // The government first, then by how many posts.
    return list.sort((a, b) => (P.institutions[b[0]]?.kind === "government" ? 1 : 0) - (P.institutions[a[0]]?.kind === "government" ? 1 : 0) || b[1].length - a[1].length);
  }, [P, all]);

  // Holders now, their kin ties (to each other and to the seat).
  const now = useMemo(() => {
    const holders = new Map<string, string[]>(); // person → posts
    for (const [, posts] of insts) for (const p of posts) { const h = holderAt(p.id); const pp = person(h?.holder ?? null); if (pp) (holders.get(pp) ?? holders.set(pp, []).get(pp)!).push(p.id); }
    const ties: Kin[] = [];
    const ppl = [...holders.keys()];
    for (let i = 0; i < ppl.length; i++) for (let j = i + 1; j < ppl.length; j++) {
      const r = relation(P, ppl[i]!, ppl[j]!);
      if (r) ties.push({ a: ppl[i]!, b: ppl[j]!, rel: r, seat: seatOf(ppl[i]!) || seatOf(ppl[j]!) });
    }
    const kinOfSeat = new Set(ties.filter((k) => k.seat).flatMap((k) => [k.a, k.b]).filter((x) => !seatOf(x)));
    return { holders, ties, kinOfSeat };
  }, [insts, Math.floor(t / 600), P]);

  // Lines between the chips of tied holders, measured from the page.
  const wrap = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ d: string; seat: boolean; same: boolean; label: string; x: number; y: number; who: string[] }[]>([]);
  useLayoutEffect(() => {
    const root = wrap.current;
    if (!root) return;
    const measure = () => {
      const box = root.getBoundingClientRect();
      const at = (pp: string) => [...root.querySelectorAll<HTMLElement>(`[data-holder="${pp}"]`)].map((el) => { const r = el.getBoundingClientRect(); return { x: r.left - box.left + root.scrollLeft + r.width / 2, y: r.top - box.top + root.scrollTop + r.height / 2 }; });
      const out: typeof lines = [];
      const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => { const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - 30 - Math.abs(a.x - b.x) * 0.08; return `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`; };
      // Ties to the seat always; the others when asked, or for the holder pointed at.
      for (const k of now.ties) {
        if (!k.seat && !allTies && focus !== k.a && focus !== k.b) continue;
        const A = at(k.a)[0], Bp = at(k.b)[0];
        if (A && Bp) out.push({ d: curve(A, Bp), seat: k.seat, same: false, label: `${name(k.a)} ${k.rel} ${name(k.b)}`, x: (A.x + Bp.x) / 2, y: Math.min(A.y, Bp.y) - 18, who: [k.a, k.b] });
      }
      // One person holding several posts: joined for kin of the seat, or the holder pointed at.
      for (const [pp, posts] of now.holders) if (posts.length > 1 && (now.kinOfSeat.has(pp) || focus === pp)) { const pts = at(pp); for (let i = 1; i < pts.length; i++) out.push({ d: curve(pts[0]!, pts[i]!), seat: now.kinOfSeat.has(pp), same: true, label: `${name(pp)} holds ${posts.length} posts`, x: 0, y: 0, who: [pp] }); }
      setLines(out);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [now, insts, allTies, focus]);

  // What a kin holder is to the seat, written at their post (not across the chart).
  const seatKinLabel = (pp: string) => {
    for (const sp of seatPeople) { const r = relation(P, pp, sp); if (r) return `${r.replace(/ of$/, "")} of ${name(sp)}, the seat`; }
    return "kin of the seat";
  };
  const f = fmtDay(t);
  const seatList = Object.entries(P.seats);
  return (
    <div className="pw" ref={wrap}>
      <div className="pw-head">
        <div>
          <div className="pw-kicker">Who holds power · year {f.year}, day {f.dayOfYear}</div>
          <h2 className="pw-title">{city.town.name ? `${city.town.name}'s offices` : "The town's offices"}</h2>
          <div className="pw-sub">Each post with its holder now and its holders over the run. Lines join holders who are kin; <span className="rose">rose</span> marks kin of the seat. Raw records; nothing judged.</div>
        </div>
        <div className="pw-side">
          {seatList.map(([part, pp]) => <div key={part} className="pw-seat"><span className="dot" />The seat: <b>{name(pp)}</b><span className="muted"> ({part})</span></div>)}
          <label className="lc-check"><input type="checkbox" checked={allTies} onChange={() => setAllTies(!allTies)} /> Every kin tie between holders ({now.ties.length})</label>
          <label className="lc-check"><input type="checkbox" checked={all} onChange={() => setAll(!all)} /> Firms, shops and landlords too</label>
        </div>
      </div>
      <svg className="pw-lines" width="100%" height="100%">
        {lines.map((l, i) => <path key={i} d={l.d} className={`${l.seat ? "seat" : ""} ${l.same ? "same" : ""} ${focus && l.who.includes(focus) ? "focus" : ""}`}><title>{l.label}</title></path>)}
      </svg>
      <div className="pw-grid">
        {insts.map(([ent, posts]) => (
          <div key={ent} className={`pw-card ${P.institutions[ent]?.kind === "government" ? "gov" : ""}`}>
            <div className="pw-card-head"><span>{P.institutions[ent]?.name ?? ent}</span><span className="muted">{(P.institutions[ent]?.kind ?? "").replace(/_/g, " ")}</span></div>
            {posts.map((p) => {
              const h = holderAt(p.id);
              const pp = person(h?.holder ?? null);
              const isSeat = seatOf(pp), kin = !!pp && now.kinOfSeat.has(pp);
              const changed = h && h.from > 0 && h.by && h.by !== h.holder;
              const list = spans.get(p.id) ?? [];
              return (
                <div key={p.id} className="pw-post">
                  <div className="pw-row">
                    <span className="pw-post-title" title={p.id}>{p.title}</span>
                    {pp ? <button data-holder={pp} className={`pw-chip ${isSeat ? "seat" : ""} ${kin ? "kin" : ""} ${focus === pp ? "focus" : ""}`} onMouseEnter={() => setFocus(pp)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(pp)} onBlur={() => setFocus(null)} onClick={() => select({ kind: "person", id: pp })} title={kin ? `kin of the seat: ${now.ties.find((k) => k.seat && (k.a === pp || k.b === pp))?.rel ?? ""}` : undefined}>{name(pp)}{(now.holders.get(pp)?.length ?? 0) > 1 && <span className="pw-n">×{now.holders.get(pp)!.length}</span>}</button> : <span className="pw-chip vacant">vacant</span>}
                  </div>
                  {kin && <div className="pw-kin">{seatKinLabel(pp!)}</div>}
                  {!kin && focus && pp && focus !== pp && relation(P, pp, focus) && <div className="pw-kin muted">{relation(P, pp, focus)} {name(focus)}</div>}
                  {changed && <div className="pw-by">{h!.holder ? "appointed" : "vacated"} by {name(person(h!.by)!)}{seatOf(person(h!.by)) ? " (the seat)" : ""} · day {fmtDay(h!.from).day}</div>}
                  {list.length > 1 && (
                    <div className="pw-strip" title="Holders over the run">
                      {list.map((x, i) => { const w = (Math.min(x.to, end) - x.from) / Math.max(1, end); const xp = person(x.holder); return <span key={i} style={{ width: `${Math.max(0.5, w * 100)}%` }} className={`${!x.holder ? "vac" : seatOf(xp) ? "seat" : xp && Object.values(P.seats).some((sp) => relation(P, xp, sp)) ? "kin" : ""}`} title={`${x.holder ? name(xp!) : "vacant"} from day ${fmtDay(x.from).day}`} />; })}
                      <i style={{ left: `${(t / Math.max(1, end)) * 100}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const POWER_CSS = `
.lens-city .pw { position: absolute; inset: 0; overflow: auto; padding: 22px 24px 40px; }
.lens-city .pw-head { display: flex; justify-content: space-between; gap: 24px; flex-wrap: wrap; margin-bottom: 18px; position: relative; z-index: 2; }
.lens-city .pw-kicker { color: var(--lc-muted); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
.lens-city .pw-title { font-family: var(--lc-serif); font-weight: 400; font-size: 28px; margin: 6px 0 4px; }
.lens-city .pw-sub { color: var(--lc-muted); max-width: 640px; line-height: 1.45; }
.lens-city .pw-sub .rose { color: var(--lc-flag); }
.lens-city .pw-side { display: grid; gap: 8px; align-content: start; }
.lens-city .pw-seat { display: flex; align-items: center; gap: 7px; }
.lens-city .pw-seat .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--lc-seat); box-shadow: 0 0 8px var(--lc-seat); }
.lens-city .pw-grid { position: relative; display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; align-items: start; }
.lens-city .pw-card { position: relative; z-index: 1; background: color-mix(in srgb, var(--lc-panel) 86%, transparent); border: 1px solid var(--lc-hair); border-radius: 12px; padding: 10px 12px 8px; }
.lens-city .pw-card.gov { grid-column: span 2; border-color: color-mix(in srgb, var(--lc-seat) 30%, var(--lc-hair)); }
.lens-city .pw-card-head { display: flex; justify-content: space-between; gap: 8px; font-family: var(--lc-serif); font-size: 15px; padding-bottom: 6px; border-bottom: 1px solid var(--lc-hair); margin-bottom: 4px; }
.lens-city .pw-card-head .muted { font-family: var(--lc-ui); font-size: 11px; text-transform: capitalize; align-self: center; }
.lens-city .pw-card.gov .pw-posts, .lens-city .pw-card.gov { columns: 2 240px; column-gap: 18px; }
.lens-city .pw-card.gov .pw-card-head { column-span: all; }
.lens-city .pw-post { break-inside: avoid; padding: 4px 0; }
.lens-city .pw-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.lens-city .pw-post-title { color: var(--lc-text); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lens-city .pw-chip { border: 1px solid var(--lc-hair); background: #ffffff0a; color: var(--lc-text); font-family: var(--lc-mono); font-size: 11px; border-radius: 10px; padding: 2px 8px; cursor: pointer; flex: none; }
.lens-city .pw-chip:hover { border-color: #ffffff40; }
.lens-city .pw-chip.seat { border-color: var(--lc-seat); color: #ffe2a6; box-shadow: 0 0 0 2px color-mix(in srgb, var(--lc-seat) 18%, transparent); }
.lens-city .pw-chip.kin { border-color: var(--lc-flag); color: #ffc2cc; box-shadow: 0 0 0 2px color-mix(in srgb, var(--lc-flag) 20%, transparent); }
.lens-city .pw-chip.vacant { border-style: dashed; color: var(--lc-muted); cursor: default; }
.lens-city .pw-by { color: var(--lc-muted); font-size: 11px; margin-top: 2px; }
.lens-city .pw-strip { position: relative; display: flex; height: 4px; margin-top: 4px; border-radius: 2px; overflow: hidden; background: #ffffff08; }
.lens-city .pw-strip span { height: 100%; background: #9aa3b260; border-right: 1px solid var(--lc-ink); }
.lens-city .pw-strip span.seat { background: var(--lc-seat); }
.lens-city .pw-strip span.kin { background: var(--lc-flag); }
.lens-city .pw-strip span.vac { background: transparent; }
.lens-city .pw-strip i { position: absolute; top: -2px; bottom: -2px; width: 1px; background: #fff; }
.lens-city .pw-lines { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 0; overflow: visible; }
.lens-city .pw-kin { color: #ffc2cc; font-size: 11px; margin-top: 2px; text-align: right; }
.lens-city .pw-kin.muted { color: var(--lc-text); opacity: .8; }
.lens-city .pw-lines path { fill: none; stroke: #9aa3b2; stroke-opacity: .55; stroke-width: 1.2; }
.lens-city .pw-lines path.same { stroke: #5cc8c0; stroke-dasharray: 2 3; stroke-opacity: .5; }
.lens-city .pw-lines path.seat { stroke: var(--lc-flag); stroke-opacity: .95; stroke-width: 2.2; }
.lens-city .pw-lines path.focus { stroke: #e8e6e1; stroke-opacity: .9; stroke-width: 1.6; }
.lens-city .pw-rel.muted { fill: #e8e6e1; }
.lens-city .pw-chip.focus { border-color: #ffffffa0; }
.lens-city .pw-n { margin-left: 5px; color: var(--lc-muted); font-size: 10px; }
.lens-city .pw-rel { fill: #ffc2cc; font-size: 11px; text-anchor: middle; paint-order: stroke; stroke: var(--lc-ink); stroke-width: 4px; }
@media (max-width: 640px) { .lens-city .pw { padding: 14px 12px 30px; } .lens-city .pw-card.gov { grid-column: auto; columns: 1; } }
`;

