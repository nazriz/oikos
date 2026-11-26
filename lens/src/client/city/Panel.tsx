// The map's furniture: the overlays panel with its legends, the hover card, the clock, the selection card.
import { useState } from "react";
import type { Selection } from "../state";
import type { CityData, TownBundle } from "./data";
import { personRows, tripOf } from "./data";
import { PAL, WHERE_LABEL } from "./scene";
import type { Sky } from "./sky";
import { PAPER_GROUPS, paperGroup, structureStory, type ElectionView } from "./civic";
import { actSentence, CITY_WORDS } from "./words";
import { describePerson } from "../people";

export interface Overlays {
  people: boolean;
  acts: boolean;
  wildlife: boolean;
  networks: boolean;
  labels: boolean;
  colour: "kind" | "disrepair";
  election: boolean;
  papers: boolean;
  /** Paper groups shown (indices into PAPER_GROUPS). */
  paperGroups: number[];
  /** Days back from now that papers are shown (0: everything so far). */
  paperDays: number;
  paperMode: "pins" | "heat";
  /** Two towns: show where this arm differs from the other. */
  diff: boolean;
}
export const DEFAULT_OVERLAYS: Overlays = { people: true, acts: true, wildlife: false, networks: false, labels: true, colour: "kind", election: false, papers: false, paperGroups: PAPER_GROUPS.map((_, i) => i).filter((i) => !["money", "building"].includes(PAPER_GROUPS[i]!.id)), paperDays: 7, paperMode: "pins", diff: true };

export interface HoverInfo { x: number; y: number; layer: string; object: any; index: number }

const DAY = 86_400;
export const fmtDay = (t: number) => {
  const d = Math.floor(t / DAY), h = Math.floor((t % DAY) / 3600), m = Math.floor((t % 3600) / 60);
  // Days count from 0, as everywhere in Lens (dayOf(t) = floor(t / 86400)).
  return { day: d, year: Math.floor(d / 365) + 1, dayOfYear: d % 365, clock: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
};
const n0 = (n: number) => n.toLocaleString("en-GB");

export function Clock({ t, sky, town }: { t: number; sky: Sky; town: TownBundle }) {
  const f = fmtDay(t);
  return (
    <div className="lc-clock" data-tour="city-clock" id="city-clock">
      <div className="lc-clock-time">{f.clock}</div>
      <div className="lc-clock-sub">Day {f.dayOfYear}{f.year > 1 ? ` of year ${f.year}` : ""}, {sky.label}</div>
    </div>
  );
}

const CAT_ORDER = ["residential", "commercial", "industrial", "civic", "education", "health", "utility", "green"];

export function Panel({ story, onPresent, onRecord, twin, open0, overlays, setOverlays, counts, kinds, city, t, arcs, onHome, ev, candCol, papersShown, onTour }: {
  story?: boolean; onPresent?: () => void; onRecord?: () => void; twin?: boolean; open0: boolean; overlays: Overlays; setOverlays: (o: Overlays) => void; counts: Record<string, number>; kinds: string[]; city: CityData; t: number; arcs: number; onHome: () => void;
  ev?: ElectionView; candCol: Record<string, string>; papersShown: number[]; onTour?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState(() => open0 && (typeof window === "undefined" || window.innerWidth > 640));
  const tog = (k: keyof Overlays) => setOverlays({ ...overlays, [k]: !overlays[k] });
  const cats = CAT_ORDER.filter((c) => city.town.structures.some((s) => s.category === c));
  const lastCensus = [...city.town.census].reverse().find((c) => c.t <= t) ?? city.town.census[0];
  const recentActs = city.town.acts.filter((a) => a.t <= t && a.t > t - 7 * DAY).length;
  const people = [...kinds, "moving"].map((k) => [k, counts[k] ?? 0] as const);
  const away = (counts.away ?? 0), gone = (counts.left ?? 0) + (counts.died ?? 0);
  return (
    <div className={`lc-panel ${open ? "" : "closed"}`} data-tour="city-layers" id="city-layers">
      <div className="lc-panel-head">
        <button className="lc-ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Close" : "Layers"}</button>
        {(onTour || onPresent) && <span className="lc-menuwrap"><button className="lc-ghost" onClick={() => setMenu(!menu)} aria-expanded={menu}>Play</button>
          {menu && <div className="lc-menu" onMouseLeave={() => setMenu(false)}>
            {onTour && <button onClick={() => { setMenu(false); onTour(); }}>Play the story<span>The run's key moments, one by one</span></button>}
            {onPresent && <button onClick={() => { setMenu(false); onPresent(); }}>Present<span>Full screen, captions, the camera on its own</span></button>}
            {onRecord && !story && <button onClick={() => { setMenu(false); onRecord(); }}>Record a video<span>The story as a video file, saved at the end</span></button>}
          </div>}</span>}
        <button className="lc-ghost" onClick={onHome} title="Frame the town">Frame</button>
      </div>
      {open && (
        <div className="lc-panel-body">
          <Section on={overlays.people} toggle={() => tog("people")} title="Who is where" note={story ? "Zoomed out, a soft disc on a building stands for everyone in it." : "Zoomed out, each building's people show as one soft disc sized by how many."}>
            <div className="lc-legend" data-tour="city-legend" id="city-legend">
              <div className="lc-lead">{CITY_WORDS.whereLegend}</div>
              {people.filter(([k, n]) => n > 0 || !story || k === "moving").map(([k, n]) => (
                <div key={k} className="lc-row"><span className="lc-sw dot" style={{ background: PAL.where[k] ?? PAL.where.other, boxShadow: `0 0 6px ${PAL.where[k] ?? PAL.where.other}` }} /><span>{CITY_WORDS.where[k] ?? WHERE_LABEL[k] ?? k}</span><span className="lc-num">{n0(n)}</span></div>
              ))}
              <div className="lc-row muted"><span className="lc-sw" /><span>{CITY_WORDS.whereAway}</span><span className="lc-num">{n0(away)}</span></div>
              {gone > 0 && <div className="lc-row muted"><span className="lc-sw" /><span>{CITY_WORDS.whereGone}</span><span className="lc-num">{n0(gone)}</span></div>}
            </div>
          </Section>
          {city.town.seats.length > 0 && (
            <Section on={overlays.acts} toggle={() => tog("acts")} title={CITY_WORDS.actsTitle} note={`${CITY_WORDS.actsLegend} ${CITY_WORDS.actsRefused}`}>
            <div className="lc-legend">
              <div className="lc-row"><span className="lc-sw line" style={{ background: "var(--lc-seat-text)" }} /><span>Actions in the last 7 days</span><span className="lc-num">{recentActs}</span></div>
              <div className="lc-row muted"><span className="lc-sw" /><span>Places they reached</span><span className="lc-num">{arcs}</span></div>
            </div>
          </Section>
          )}
          {story ? <div className="lc-note lc-more">{CITY_WORDS.moreInResearcher}</div> : <>
          <div className="lc-section">
            <div className="lc-sec-head"><span className="lc-sec-title">Buildings</span>
              <div className="lc-seg">
                <button className={overlays.colour === "kind" ? "on" : ""} onClick={() => setOverlays({ ...overlays, colour: "kind" })}>Kind</button>
                <button className={overlays.colour === "disrepair" ? "on" : ""} onClick={() => setOverlays({ ...overlays, colour: "disrepair" })}>Disrepair</button>
              </div>
            </div>
            {overlays.colour === "kind" ? (
              <div className="lc-legend cols">
                {cats.map((c) => <div key={c} className="lc-row"><span className="lc-sw" style={{ background: PAL.category[c] }} /><span>{c}</span></div>)}
              </div>
            ) : (
              <div className="lc-legend">
                <div className="lc-ramp" />
                <div className="lc-ramp-l"><span>0</span><span>the world's <code>disrepair</code>, at the start (square-root scale)</span><span>{n0(Math.max(...city.town.structures.map((s) => s.vars?.disrepair ?? 0)))}</span></div>
              </div>
            )}
          </div>
          {twin && <Section on={overlays.diff} toggle={() => tog("diff")} title="What differs from the other town" note="Green arcs: a person is somewhere else in the other town right now (from there to here). Filled marks: papers of the last 7 days only in this town; rings: only in the other (matched by kind, place and day)."><div /></Section>}
          {city.town.elections.length > 0 && (
            <Section on={overlays.election} toggle={() => tog("election")} title="The election" note={ev ? electionNote(ev) : "No election in this run."}>
              {ev && <ElectionLegend ev={ev} col={candCol} />}
            </Section>
          )}
          <Section on={overlays.papers} toggle={() => tog("papers")} title="Papers" note="Each paper at the address it concerns (a person's: their home at the time). Raw counts, nothing judged.">
            <div className="lc-sec-head" style={{ marginTop: 8 }}>
              <div className="lc-seg">
                {[[1, "1 d"], [7, "7 d"], [30, "30 d"], [0, "all"]].map(([d, l]) => <button key={d} className={overlays.paperDays === d ? "on" : ""} onClick={() => setOverlays({ ...overlays, paperDays: d as number })}>{l}</button>)}
              </div>
              <div className="lc-seg">
                <button className={overlays.paperMode === "pins" ? "on" : ""} onClick={() => setOverlays({ ...overlays, paperMode: "pins" })}>Pins</button>
                <button className={overlays.paperMode === "heat" ? "on" : ""} onClick={() => setOverlays({ ...overlays, paperMode: "heat" })}>Heat</button>
              </div>
            </div>
            <div className="lc-legend">
              {PAPER_GROUPS.map((g, i) => {
                const on = overlays.paperGroups.includes(i);
                return (
                  <button key={g.id} className={`lc-row lc-rowbtn ${on ? "" : "off"}`} onClick={() => setOverlays({ ...overlays, paperGroups: on ? overlays.paperGroups.filter((x) => x !== i) : [...overlays.paperGroups, i] })}>
                    <span className="lc-sw dot" style={{ background: on ? g.colour : "transparent", border: `1px solid ${g.colour}` }} /><span>{g.label}</span><span className="lc-num">{n0(papersShown[i] ?? 0)}</span>
                  </button>
                );
              })}
            </div>
          </Section>
          <Section on={overlays.wildlife} toggle={() => tog("wildlife")} title="Wildlife" note="Where each species was at the start; counts from the latest nature census.">
            <div className="lc-legend">
              {city.town.wildlife.species.map((s, i) => (
                <div key={s} className="lc-row"><span className="lc-sw dot" style={{ background: SPECIES[i % SPECIES.length] }} /><span>{s.replace(/-/g, " ")}</span><span className="lc-num">{lastCensus?.species[s] ? n0(lastCensus.species[s]!.count) : ""}</span></div>
              ))}
            </div>
          </Section>
          <Section on={overlays.networks} toggle={() => tog("networks")} title="Utility networks" note="Pipes, sewers and wires, node to node, as the world lays them.">
            <div className="lc-legend">
              {[["pipe", "Water pipes", "#5fb0e8"], ["sewer", "Sewers", "#a48a62"], ["wire", "Power lines", "#f2d36b"]].map(([k, l, c]) => (
                <div key={k} className="lc-row"><span className="lc-sw line" style={{ background: c }} /><span>{l}</span><span className="lc-num">{city.town.networks.filter((n) => n.mode === k).length}</span></div>
              ))}
            </div>
          </Section>
          <label className="lc-check"><input type="checkbox" checked={overlays.labels} onChange={() => tog("labels")} /> Names of places</label>
          </>}
        </div>
      )}
    </div>
  );
}
const SPECIES = ["#9fe0a0", "#7fd0e6", "#f0c987", "#e7a3d8", "#c0c8ff"];

function Section({ on, toggle, title, note, children }: { on: boolean; toggle: () => void; title: string; note: string; children: any }) {
  return (
    <div className={`lc-section ${on ? "" : "off"}`}>
      <div className="lc-sec-head">
        <span className="lc-sec-title">{title}</span>
        <button className={`lc-switch ${on ? "on" : ""}`} onClick={toggle} role="switch" aria-checked={on} aria-label={title}><span /></button>
      </div>
      {on && <>{children}<div className="lc-note">{note}</div></>}
    </div>
  );
}

function inside(c: CityData, s: number): { q: number; kind: string }[] {
  const out: { q: number; kind: string }[] = [];
  const W = c.where;
  for (let q = 0; q < W.nP; q++) if (W.at[q] === s) out.push({ q, kind: c.people.spaceKinds[W.kind[q]!] ?? "?" });
  return out;
}

function ageAt(c: CityData, q: number, t: number) {
  const born = c.people.people[q]![3];
  return Math.floor((t - born) / (365.25 * DAY));
}

export function StructureBody({ c, i, t, name, full }: { c: CityData; i: number; t: number; name: (i: number) => string; full?: boolean }) {
  const s = c.town.structures[i]!;
  const who = inside(c, i);
  const byKind: Record<string, number> = {};
  for (const w of who) byKind[w.kind] = (byKind[w.kind] ?? 0) + 1;
  const owner = s.owner ? c.town.entities[s.owner]?.name ?? s.owner : undefined;
  const sp = Object.entries(s.spaces).map(([k, n]) => `${n} ${k}${n > 1 ? "s" : ""}`).join(", ");
  return (
    <>
      <div className="lc-tip-title">{name(i)}</div>
      <div className="lc-tip-sub">{kindSentence(s.type, s.category)}</div>
      <dl className="lc-dl">
        {owner && <><dt>Owner</dt><dd>{owner}</dd></>}
        {sp && <><dt>Spaces</dt><dd>{sp}</dd></>}
        {s.vars?.disrepair !== undefined && <><dt>Disrepair</dt><dd>{n0(s.vars.disrepair)} <span className="muted">at the start</span></dd></>}
        {s.started !== undefined && <><dt>Built</dt><dd>{s.completed !== undefined && s.completed <= t ? `completed day ${fmtDay(s.completed).day}` : `under way since day ${fmtDay(s.started).day}`}</dd></>}
        <dt>Inside now</dt>
        <dd>{who.length ? `${who.length} ${who.length === 1 ? "person" : "people"}: ${Object.entries(byKind).map(([k, n]) => `${n} ${(CITY_WORDS.where[k] ?? k).toLowerCase()}`).join(", ")}` : "Nobody"}</dd>
      </dl>
      {who.length > 0 && (
        <div className="lc-names">{who.slice(0, full ? 40 : 8).map((w) => c.people.people[w.q]![1]).join(", ")}{who.length > (full ? 40 : 8) ? `, and ${who.length - (full ? 40 : 8)} more` : ""}</div>
      )}
      {full && <StructureStoryBody c={c} i={i} t={t} name={name} />}
    </>
  );
}

export function PersonBody({ c, q, t, name, full }: { c: CityData; q: number; t: number; name: (i: number) => string; full?: boolean }) {
  const p = c.people.people[q]!;
  const s = c.where.at[q]!;
  const kind = s >= 0 ? c.people.spaceKinds[c.where.kind[q]!] ?? "" : "";
  const trip = s < 0 ? tripOf(c, q) : undefined;
  const home = p[5] >= 0 ? c.sMap[p[5]]! : -1;
  const hh = p[4] >= 0 ? c.people.people.filter((x) => x[4] === p[4]).length : 0;
  const died = c.people.died[q], left = c.people.left[q];
  let where = "";
  if (died !== undefined && died <= t) where = `died, day ${fmtDay(died).day}`;
  else if (left !== undefined && left <= t) where = `left town, day ${fmtDay(left).day}`;
  else if (s >= 0) where = `${CITY_WORDS.where[kind] ?? WHERE_LABEL[kind] ?? kind}, ${name(s)}`;
  else if (trip && trip.to >= 0 && trip.t2 - trip.t1 <= 3 * 3600) where = `On the way from ${trip.from >= 0 ? name(trip.from) : "?"} to ${name(trip.to)}`;
  else where = trip && trip.from >= 0 ? `Away, since leaving ${name(trip.from)} (day ${fmtDay(trip.t1).day} ${fmtDay(trip.t1).clock})` : "Away";
  return (
    <>
      <div className="lc-tip-title">{p[1]}</div>
      <div className="lc-tip-sub">{p[2] === "f" ? "A woman" : p[2] === "m" ? "A man" : "A person"}, {ageAt(c, q, t)} years old{describePerson(c, p[0], t)?.replace(/^\d+,?\s*/, "") ? `, ${describePerson(c, p[0], t)!.replace(/^\d+,?\s*/, "")}` : ""}.</div>
      <dl className="lc-dl">
        <dt>Now</dt><dd>{where}</dd>
        {home >= 0 && <><dt>First home</dt><dd>{name(home)}</dd></>}
        {hh > 1 && <><dt>Household</dt><dd>{hh} people</dd></>}
      </dl>
      {full && <Today c={c} q={q} t={t} name={name} />}
    </>
  );
}

/** The person's day so far, from the log's occupied/vacated rows. */
function Today({ c, q, t, name }: { c: CityData; q: number; t: number; name: (i: number) => string }) {
  const day0 = Math.floor(t / DAY) * DAY;
  const items: { t: number; text: string; kind: string }[] = [];
  for (const r of personRows(c)[q] ?? []) {
    const rt = c.rows.t[r]!;
    if (rt < day0 || rt > t) continue;
    const k = c.rows.k[r]!, s = c.rows.s[r]!;
    const kind = c.people.spaceKinds[Math.abs(k) - 1] ?? "";
    items.push({ t: rt, text: `${k > 0 ? "into" : "left"} ${s >= 0 ? name(s) : "?"}`, kind: k > 0 ? kind : "moving" });
  }
  if (!items.length) return <div className="lc-note">No moves yet today.</div>;
  return (
    <div className="lc-today">
      <div className="lc-sec-title" style={{ marginTop: 10 }}>Today</div>
      {items.map((it, i) => (
        <div key={i} className="lc-row"><span className="lc-sw dot" style={{ background: PAL.where[it.kind] ?? PAL.where.other }} /><span>{it.text}</span><span className="lc-num">{fmtDay(it.t).clock}</span></div>
      ))}
    </div>
  );
}

export function Tooltip({ tip, city, t, name }: { tip: HoverInfo; city: CityData; t: number; name: (i: number) => string }) {
  let body: any = null;
  if (tip.layer === "buildings" || tip.layer === "parks" || tip.layer === "roofs" || tip.layer === "hips") body = <StructureBody c={city} i={typeof tip.object === "number" ? tip.object : tip.object.i} t={t} name={name} />;
  else if (tip.layer === "people") body = <PersonBody c={city} q={tip.index} t={t} name={name} />;
  else if (tip.layer === "acts" || tip.layer === "act-hits") body = <ActBody a={tip.object.act} target={tip.object.target} t={t} town={city.town} />;
  else if (tip.layer === "papers") body = <PaperBody p={tip.object.p} />;
  else if (tip.layer === "pies") body = <><div className="lc-tip-title">{name(tip.object.s)}</div><div className="lc-tip-sub">{tip.object.poll ? "opinion-poll answers from here" : "votes cast from here"}: {tip.object.total} · candidate {tip.object.n}: {tip.object.count}</div></>;
  else if (tip.layer === "votes") body = <><div className="lc-tip-title">{tip.object.person}</div><div className="lc-tip-sub">Voted, putting candidate {tip.object.n} first.</div></>;
  else if (tip.layer === "cand-homes") body = <><div className="lc-tip-title">{tip.object.name}</div><div className="lc-tip-sub">Candidate {tip.object.number}{tip.object.seat ? `, ${CITY_WORDS.seat}` : ""}: their home</div></>;
  else if (tip.layer === "networks") body = <><div className="lc-tip-title">{tip.object.id}</div><div className="lc-tip-sub">{tip.object.mode === "pipe" ? "A water pipe" : tip.object.mode === "wire" ? "A power line" : tip.object.mode === "sewer" ? "A sewer" : tip.object.mode}{tip.object.capacity ? `, capacity ${n0(tip.object.capacity)}` : ""}.</div></>;
  else if (tip.layer === "wildlife") {
    const c = city.town.wildlife.cells, i = tip.index;
    body = <><div className="lc-tip-title">{city.town.wildlife.species[c[i * 4 + 2]!]?.replace(/-/g, " ")}</div><div className="lc-tip-sub">{c[i * 4 + 3]} here at the start of the run.</div></>;
  }
  if (!body) return null;
  const left = Math.min(tip.x + 16, (typeof window !== "undefined" ? window.innerWidth : 1600) - 320);
  return <div className="lc-tip" style={{ left, top: tip.y + 16 }}>{body}</div>;
}

function ActBody({ a, target, t, town }: { town: TownBundle; a: TownBundle["acts"][number]; target?: string; t: number }) {
  const f = fmtDay(a.t);
  const ago = t - a.t;
  return (
    <>
      <div className="lc-tip-title">{actSentence(town, a)}</div>
      <div className="lc-tip-sub">Day {f.dayOfYear} at {f.clock}{ago > 0 ? `, ${ago < DAY ? `${Math.round(ago / 3600)} hours` : `${Math.round(ago / DAY)} days`} ago` : ""}. <span className={`lc-status ${a.status}`}>{a.status === "refused" ? "The town refused it." : a.status === "applied" ? "It was carried out." : "Sent."}</span></div>
      {target && <dl className="lc-dl"><dt>Reached</dt><dd>{target}</dd><dt>To</dt><dd>{[...new Set(a.blocks.flatMap((b) => b.to))].join(", ")}</dd></dl>}
      {a.blocks[0]?.text && <div className="lc-quote">{a.blocks[0].text.slice(0, 260)}{a.blocks[0].text.length > 260 ? "…" : ""}</div>}
      {a.refusal && <div className="lc-note rose">Refused: {a.refusal}</div>}
    </>
  );
}

export function Card({ city, t, selection, name, onClose }: { city: CityData; t: number; selection: Selection; name: (i: number) => string; onClose: () => void }) {
  let body: any = null;
  if (selection?.kind === "structure") { const i = city.sById.get(selection.id); if (i !== undefined) body = <StructureBody c={city} i={i} t={t} name={name} full />; }
  else if (selection?.kind === "entity") { const i = city.town.entities[selection.id]?.structure; if (i !== undefined) body = <StructureBody c={city} i={i} t={t} name={name} full />; }
  else if (selection?.kind === "person") { const q = city.pById.get(selection.id); if (q !== undefined) body = <PersonBody c={city} q={q} t={t} name={name} full />; }
  else if (selection?.kind === "act") { const a = city.town.acts.find((x) => x.seq === selection.seq); if (a) body = <ActBody a={a} t={t} town={city.town} />; }
  if (!body) return null;
  return (
    <div className="lc-card">
      <button className="lc-x" onClick={onClose} aria-label="Clear selection">×</button>
      {body}
    </div>
  );
}

function electionNote(ev: ElectionView): string {
  const e = ev.e;
  const poll = e.notice?.poll_at ? ` Poll day ${fmtDay(e.notice.poll_at).day}.` : "";
  if (ev.phase === "before") return `Not yet called.${poll}`;
  if (ev.phase === "campaign") return `The campaign: candidates' homes ringed; a pie on each home of its opinion-poll answers by first choice; petition signatures as violet dots.${poll}`;
  return "A pie on each home: the votes cast from it, by first preference, sized by how many. Blocks are shaded only where turnout differs from the town's by 3 points or more (blue above, orange below; 8+ electors). The researcher's view: the ballot is secret in the world.";
}

function ElectionLegend({ ev, col }: { ev: ElectionView; col: Record<string, string> }) {
  const r = ev.e.result;
  const round = r?.rounds?.[r.rounds.length - 1];
  return (
    <div className="lc-legend">
      {ev.e.candidates.map((c) => (
        <div key={c.number} className="lc-row"><span className="lc-sw dot" style={{ background: col[c.number] }} /><span>{c.number}. {c.name}{ev.homes.find((h) => h.number === c.number)?.seat ? " (the seat)" : ""}</span>
          <span className="lc-num">{ev.phase === "campaign" || ev.phase === "before" ? `${ev.polls.filter((p) => p.n === c.number).length} in polls` : `${ev.first[c.number] ?? 0} first`}</span></div>
      ))}
      <div className="lc-row muted"><span className="lc-sw" /><span>Votes cast / on the roll</span><span className="lc-num">{n0(ev.cast)} / {n0(ev.roll)}</span></div>
      {ev.phase === "declared" && r && (
        <div className="lc-row"><span className="lc-sw" /><span>Declared: {ev.e.candidates.find((c) => c.participant === r.winner)?.name ?? r.winner}</span><span className="lc-num">{r.turnout_bps !== undefined ? `${(r.turnout_bps / 100).toFixed(1)}%` : ""}</span></div>
      )}
      {ev.phase === "declared" && round && <div className="lc-note">Count{r!.rounds!.length > 1 ? ` (round ${r!.rounds!.length})` : ""}: {Object.entries(round).map(([k, v]) => `${ev.e.candidates.find((c) => c.participant === k)?.name ?? k} ${v}`).join(", ")}</div>}
    </div>
  );
}

export function PaperBody({ p }: { p: CityData["town"]["papers"][number] }) {
  const g = PAPER_GROUPS[paperGroup(p.kind)]!;
  const f = fmtDay(p.t);
  return (
    <>
      <div className="lc-tip-title" style={{ borderLeft: `3px solid ${g.colour}`, paddingLeft: 8 }}>{p.kind.replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase())}</div>
      <div className="lc-tip-sub">Day {f.dayOfYear} at {f.clock}{p.by ? `, from ${p.by}` : ""}.</div>
      <div className="lc-quote">{p.text}</div>
    </>
  );
}

/** A building's whole story: who lived and worked there, papers about it, work done there. */
export function StructureStoryBody({ c, i, t, name }: { c: CityData; i: number; t: number; name: (i: number) => string }) {
  const st = structureStory(c, i);
  const s = c.town.structures[i]!;
  const days = (sec: number) => sec / DAY;
  const lists = Object.entries(st.stays).sort((a, b) => b[1].size - a[1].size);
  const work = c.town.work[i];
  return (
    <div className="lc-story">
      {lists.map(([kind, m]) => {
        const rows = [...m.entries()].sort((a, b) => b[1][0] - a[1][0]);
        return (
          <div key={kind}>
            <div className="lc-sec-title" style={{ marginTop: 10 }}>{kind === "dwelling" ? "Lived here" : kind === "workplace" ? "Worked here" : `In its ${kind}s`} <span className="lc-num">{rows.length} people</span></div>
            <div className="lc-today">
              {rows.slice(0, kind === "dwelling" ? 12 : 8).map(([q, [tot, a, b]]) => (
                <div key={q} className="lc-row"><span className="lc-sw dot" style={{ background: PAL.where[kind] ?? PAL.where.other }} /><span>{c.people.people[q]![1]}</span><span className="lc-num">days {fmtDay(a).day} to {fmtDay(b).day}, {days(tot) >= 1 ? `${days(tot).toFixed(0)} days` : `${(tot / 3600).toFixed(0)} hours`}</span></div>
              ))}
              {rows.length > (kind === "dwelling" ? 12 : 8) && <div className="lc-note">and {rows.length - (kind === "dwelling" ? 12 : 8)} more</div>}
            </div>
          </div>
        );
      })}
      {st.papers.length > 0 && (
        <div>
          <div className="lc-sec-title" style={{ marginTop: 10 }}>Papers about it <span className="lc-num">{st.papers.length}</span></div>
          <div className="lc-today">
            {st.papers.slice(-10).reverse().map((p) => (
              <div key={p.id} className="lc-row" title={p.text}><span className="lc-sw dot" style={{ background: PAPER_GROUPS[paperGroup(p.kind)]!.colour, opacity: p.t <= t ? 1 : 0.35 }} /><span>{p.kind.replace(/_/g, " ")}</span><span className="lc-num">day {fmtDay(p.t).day}</span></div>
            ))}
          </div>
        </div>
      )}
      {work && (
        <div>
          <div className="lc-sec-title" style={{ marginTop: 10 }}>Work done here</div>
          <div className="lc-today">
            {Object.entries(work).sort((a, b) => b[1][0] - a[1][0]).slice(0, 6).map(([task, [n, last]]) => (
              <div key={task} className="lc-row"><span className="lc-sw" /><span>{task.replace(/_/g, " ")}</span><span className="lc-num">{n0(n)} times, last on day {fmtDay(last).day}</span></div>
            ))}
          </div>
        </div>
      )}
      <div className="lc-note">Disrepair: {s.vars?.disrepair !== undefined ? `${n0(s.vars.disrepair)} at the start; the log carries no later reading of it.` : "not recorded for this kind."}</div>
    </div>
  );
}

/** "A shop." "A house." From the catalogue's type and category, in a sentence. */
function kindSentence(type: string, category: string): string {
  const t = type.replace(/^shop-(.+)$/, "$1 shop").replace(/[-_]+/g, " ").replace(/eating out/, "café").replace(/personal services/, "personal services shop");
  const w = t === "civic" ? "civic building" : t === "works" ? "works" : t;
  return `${/^[aeiou]/i.test(w) ? "An" : "A"} ${w}${category && !w.includes(category) && category !== "residential" ? ` (${category})` : ""}.`;
}
