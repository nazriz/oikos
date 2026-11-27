// Who holds power: the town's offices as a living chart. Institutions are cards, each post a row with its holder now
// and a strip of its holders over the run; lines join holders who are kin (parent and child, siblings, partners, one
// household), and a holder who is kin of the seat is marked and tied to the seat in rose. Who appointed whom is
// written under each post that changed hands. It follows the shared clock: scrub, and the posts change hands.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLens } from "../state";
import { parseHash } from "../router";
import { useCity, useDark } from "./CityView";
import { describePerson } from "../people";
import { useMode } from "../mode";
import type { CityData, TownBundle } from "./data";
import { fmtDay } from "./Panel";
import { actSentence, CITY_WORDS } from "./words";
import { CITY_CSS } from "./style";

type Power = TownBundle["power"];
const DAY = 86_400;
/** The town's public institutions; the rest (shops, factories, landlords, sole traders) on request. */
const CIVIC = ["government", "electoral_commission", "firm", "police", "tribunal", "ombudsman", "consumer_desk", "audit_office", "registry", "health_service", "school", "utility", "bank", "union", "builder"];

export function PowerView({ run }: { run: string }) {
  const { city, error } = useCity(`/api/run/${encodeURIComponent(run)}`);
  return (
    <div className="lens-city pw-root">
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
  // Opened without a moment: start where the AI mayor first acts (a fork's first day), not before it took office.
  // (Opened from a run at a moment (`?t=`): that moment, so the holders are those of the day the reader came from.)
  useEffect(() => {
    const q = parseHash(window.location.hash).q, at = Number(q.get("t"));
    if (q.has("t") && Number.isFinite(at)) return useLens.getState().setT(at);
    const first = city.town.acts[0]?.t;
    if (useLens.getState().t === 0 && first) useLens.getState().setT(first);
  }, [city]);
  const end = Math.max(span[1], city.town.span[1]);
  const person = (participant: string | null) => (participant ? P.bodies[participant] ?? (participant.endsWith("-self") ? participant.slice(0, -5) : `system:${participant}`) : null);
  const seatPeople = new Set(Object.values(P.seats));
  const seatOf = (pp: string | null) => !!pp && seatPeople.has(pp);
  // (Story mode names a holder as a reader would: "a resident (c0066, 52, works at Town hall)"; Researcher, by id.)
  const story = useMode((m) => m.mode !== "researcher");
  // (Story mode names no one by id: the AI mayor, an automated system, else a resident; Researcher mode, by id.)
  const name = (pp: string) => (pp.startsWith("system:") ? "an automated system" : seatOf(pp) ? (story ? "the AI mayor" : `the AI mayor (${pp})`) : story ? "a resident" : P.names[pp] ?? pp);

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
    for (const sp of seatPeople) { const r = relation(P, pp, sp); if (r) return `${r.replace(/ of$/, "")} of ${name(sp)}, the AI mayor`; }
    return "a relative of the AI mayor";
  };
  const f = fmtDay(t);
  const dark = useDark();
  const seatList = Object.entries(P.seats);
  // (Story mode says a holder of several posts once, at the first of them: "c0067 (58) holds 4 posts: Child protection
  // officer, Clerk of the mayor, …"; at the others, "c0067, same as above". One post: "a resident (c0613, 30, works at …)".)
  // (Story mode lists each resident who holds several posts once, above the cards, with all their posts; in the cards
  // such a post says only "a resident who holds several posts" and which entry above, by its number.)
  const several = [...now.holders].filter(([pp, posts]) => posts.length > 1 && !seatOf(pp) && !pp.startsWith("system:"));
  const severalNo = new Map(several.map(([pp], k) => [pp, k + 1]));
  const ageOf = (pp: string) => { const a = describePerson(city, pp, t)?.split(", ")[0]; return a && /^\d+$/.test(a) ? a : undefined; };
  const titleOf = (x: string) => P.posts.find((q) => q.id === x)?.title ?? x;
  const storyHolder = (pp: string) => {
    const posts = now.holders.get(pp) ?? [];
    const d = describePerson(city, pp, t);
    if (posts.length < 2) return <>a resident{d ? <span className="pw-desc-inline"> ({d})</span> : null}</>;
    return <>a resident who holds {posts.length} posts<span className="pw-n"> (no. {severalNo.get(pp)} above)</span></>;
  };
  return (
    <div className={`pw lc-wrap${dark ? "" : " light"}`} ref={wrap} style={{ background: "var(--lc-ink)" }}>
      <div className="pw-head">
        <div>
          <div className="pw-kicker">Who holds which post on day {f.dayOfYear}{f.year > 1 ? ` of year ${f.year}` : ""}</div>
          <h2 className="pw-title">{city.town.name ? `${city.town.name}'s offices` : "The town's offices"}</h2>
          <div className="pw-sub">Each post with its holder now and its holders over the run. Lines join holders who are family. <span className="rose">Red</span> marks a relative of the AI mayor. These are the town's own records; Lens judges nothing.</div>
        </div>
        <div className="pw-side">
          {/* (Why the AI mayor has an age, a job and family: in the world it is a resident who holds the office.) */}
          {seatList.map(([part, pp]) => <div key={part} className="pw-seat"><span className="dot" />{story ? <>The AI mayor is a resident of the town too{describePerson(city, pp, t) ? `: ${describePerson(city, pp, t)}` : ""}.</> : <>The AI mayor holds this office as resident <b>{pp}</b>{describePerson(city, pp, t) ? ` (${describePerson(city, pp, t)})` : ""}.</>}</div>)}
          {story && several.length > 0 && (
            <div className="pw-several">
              <div className="pw-several-h">Residents who hold several posts</div>
              <ol>{several.map(([pp, posts]) => <li key={pp}>A resident{ageOf(pp) ? ` (${ageOf(pp)})` : ""}: {posts.map(titleOf).join(", ")}</li>)}</ol>
            </div>
          )}
          <label className="lc-check"><input type="checkbox" checked={allTies} onChange={() => setAllTies(!allTies)} /> Show every family tie between holders ({now.ties.length})</label>
          <label className="lc-check"><input type="checkbox" checked={all} onChange={() => setAll(!all)} /> Show firms, shops and landlords too</label>
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
                    {pp ? <button data-holder={pp} {...(pp.startsWith("system:") ? {} : { "data-peek": `person:${pp}` })} className={`pw-chip ${isSeat ? "seat" : ""} ${kin ? "kin" : ""} ${focus === pp ? "focus" : ""}`} onMouseEnter={() => setFocus(pp)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(pp)} onBlur={() => setFocus(null)} onClick={() => { if (!pp.startsWith("system:")) select({ kind: "person", id: pp }); }} title={kin ? `kin of the seat: ${now.ties.find((k) => k.seat && (k.a === pp || k.b === pp))?.rel ?? ""}` : undefined}>{story && !isSeat && !pp.startsWith("system:") ? storyHolder(pp) : <>{name(pp)}{(now.holders.get(pp)?.length ?? 0) > 1 && <span className="pw-n">, holds {now.holders.get(pp)!.length} posts</span>}</>}{!story && !isSeat && describePerson(city, pp, t) && <span className="pw-desc">{describePerson(city, pp, t)}</span>}</button> : <span className="pw-chip vacant">vacant</span>}
                  </div>
                  {kin && <div className="pw-kin">{seatKinLabel(pp!)}</div>}
                  {!kin && focus && pp && focus !== pp && relation(P, pp, focus) && <div className="pw-kin muted">{relation(P, pp, focus)} {name(focus)}</div>}
                  {changed && <div className="pw-by">{h!.holder ? "appointed" : "vacated"} by {name(person(h!.by)!)}{seatOf(person(h!.by)) ? `, ${CITY_WORDS.seat}` : ""}, on day {fmtDay(h!.from).day}</div>}
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
/* The page flows with its content (the shell gives it no sized box): never a zero-height absolute layer. */
.lens-city.pw-root { height: auto; min-height: 100vh; overflow: visible; }
.lens-city .pw { position: relative; min-height: 100vh; padding: 22px 24px 40px; }
/* The head in two columns: the title and, under it, the residents who hold several posts (in columns of their own);
   beside them the AI mayor's line and the switches. (The list sat in the right column alone and left the left one
   empty below the title.) */
.lens-city .pw-head { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 0.75fr); column-gap: 32px; row-gap: 6px; align-items: start; margin-bottom: 18px; position: relative; z-index: 2; }
.lens-city .pw-head > :first-child { grid-column: 1; grid-row: 1; }
.lens-city .pw-head .pw-side { display: contents; }
.lens-city .pw-head .pw-seat { grid-column: 2; grid-row: 1; }
.lens-city .pw-head .pw-several { grid-column: 1; grid-row: 2 / span 3; columns: 2 300px; column-gap: 24px; }
.lens-city .pw-head .pw-several-h { column-span: all; }
.lens-city .pw-head .pw-side > .lc-check { grid-column: 2; }
.lens-city .pw-kicker { color: var(--lc-muted); font-size: 13px; }
.lens-city .pw-title { font-weight: 800; font-size: 26px; letter-spacing: -.01em; margin: 4px 0 6px; }
.lens-city .pw-sub { color: var(--lc-muted); max-width: 640px; line-height: 1.45; }
.lens-city .pw-sub .rose { color: var(--lc-flag); font-weight: 700; }
.lens-city .pw-side { display: grid; gap: 8px; align-content: start; }
.lens-city .pw-seat { display: block; line-height: 1.4; }
.lens-city .pw-seat .dot { display: inline-block; width: 10px; height: 10px; margin-right: 7px; background: var(--lc-seat); }
/* The cards flow in columns, each as tall as its posts, so a short card does not leave a row's worth of empty space
   below it (a grid's rows took the tallest card's height); the town's own card goes across the top. */
.lens-city .pw-grid { position: relative; columns: 260px; column-gap: 22px; }
.lens-city .pw-card { position: relative; z-index: 1; background: var(--lc-ink); border-top: 2px solid var(--lc-text); padding: 6px 0 4px; break-inside: avoid; margin: 0 0 22px; display: inline-block; width: 100%; }
.lens-city .pw-card.gov { column-span: all; display: block; border-top-color: var(--lc-seat); columns: 240px; column-gap: 22px; }
.lens-city .pw-card-head { display: flex; justify-content: space-between; gap: 8px; font-weight: 800; font-size: 15px; padding-bottom: 6px; margin-bottom: 2px; column-span: all; }
.lens-city .pw-card-head .muted { font-weight: 400; font-size: 12px; align-self: center; }
.lens-city .pw-post { break-inside: avoid; padding: 4px 0; border-bottom: 1px solid var(--lc-hair); }
/* Each post on two lines, the post above its holder, both wrapping: no name is ever cut, at any width (a post's title
   or a holder's description can be long, "Registrar of births, deaths and marriages", "a resident (c0066, 35, ...)"). */
.lens-city .pw-row { display: grid; grid-template-columns: minmax(0, 1fr); row-gap: 1px; }
.lens-city .pw-post-title { color: var(--lc-muted); font-size: 12px; line-height: 1.3; overflow-wrap: anywhere; }
.lens-city .pw-chip { justify-self: start; max-width: 100%; text-align: left; white-space: normal; overflow-wrap: anywhere; line-height: 1.35; border: 0; background: none; color: var(--lc-text); font: inherit; font-size: 13px; font-weight: 700; padding: 0 0 1px; cursor: pointer; border-bottom: 1px solid transparent; }
.lens-city .pw-chip:hover, .lens-city .pw-chip.focus { border-bottom-color: currentColor; }
.lens-city .pw-chip.seat { color: var(--lc-seat-text); border-bottom: 3px solid var(--lc-seat); }
.lens-city .pw-chip.kin { color: var(--lc-flag); border-bottom: 3px solid var(--lc-flag); }
.lens-city .pw-chip.vacant { color: var(--lc-muted); font-weight: 400; font-style: italic; cursor: default; }
.lens-city .pw-desc { display: block; font-weight: 400; color: var(--lc-muted); font-size: 11.5px; text-align: left; }
.lens-city .pw-n { margin-left: 0; color: var(--lc-muted); font-size: 11.5px; font-weight: 400; white-space: normal; overflow-wrap: anywhere; }
.lens-city .pw-desc-inline { font-weight: 400; color: var(--lc-muted); }
.lens-city .pw-several { font-size: 12px; line-height: 1.45; margin: 6px 0 10px; }
.lens-city .pw-several-h { font-weight: 600; margin-bottom: 2px; }
.lens-city .pw-several ol { margin: 0; padding-left: 18px; color: var(--lc-muted); }
.lens-city .pw-by { color: var(--lc-muted); font-size: 12px; margin-top: 2px; }
.lens-city .pw-kin { color: var(--lc-flag); font-size: 12px; font-weight: 700; margin-top: 2px; text-align: left; }
.lens-city .pw-kin.muted { color: var(--lc-text); font-weight: 400; }
.lens-city .pw-strip { position: relative; display: flex; height: 4px; margin-top: 5px; background: color-mix(in srgb, var(--lc-text) 6%, transparent); }
.lens-city .pw-strip span { height: 100%; background: color-mix(in srgb, var(--lc-muted) 55%, transparent); border-right: 1px solid var(--lc-ink); }
.lens-city .pw-strip span.seat { background: var(--lc-seat); }
.lens-city .pw-strip span.kin { background: var(--lc-flag); }
.lens-city .pw-strip span.vac { background: transparent; }
.lens-city .pw-strip i { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--lc-text); }
.lens-city .pw-lines { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 0; overflow: visible; }
.lens-city .pw-lines path { fill: none; stroke: var(--lc-muted); stroke-opacity: .6; stroke-width: 1.2; }
.lens-city .pw-lines path.same { stroke: var(--lc-inst); stroke-dasharray: 2 3; }
.lens-city .pw-lines path.seat { stroke: var(--lc-flag); stroke-opacity: 1; stroke-width: 2.5; }
.lens-city .pw-lines path.focus { stroke: var(--lc-text); stroke-opacity: .9; stroke-width: 1.6; }
@media (max-width: 640px) { .lens-city .pw-head { grid-template-columns: minmax(0, 1fr); } .lens-city .pw-head > *, .lens-city .pw-head .pw-side > * { grid-column: 1 !important; grid-row: auto !important; } .lens-city .pw-head .pw-several { columns: 1; } .lens-city .pw { padding: 14px 12px 30px; } .lens-city .pw-card.gov { columns: 1; } }
`;

