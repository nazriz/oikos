// The map's furniture: the overlays panel with its legends, the hover card, the clock, the selection card.
import { useState } from "react";
import type { Selection } from "../state";
import type { CityData, TownBundle } from "./data";
import { personRows, tripOf } from "./data";
import { PAL, WHERE_LABEL } from "./scene";
import type { Sky } from "./sky";

export interface Overlays {
  people: boolean;
  acts: boolean;
  wildlife: boolean;
  networks: boolean;
  labels: boolean;
  colour: "kind" | "disrepair";
}
export const DEFAULT_OVERLAYS: Overlays = { people: true, acts: true, wildlife: false, networks: false, labels: true, colour: "kind" };

export interface HoverInfo { x: number; y: number; layer: string; object: any; index: number }

const DAY = 86_400;
export const fmtDay = (t: number) => {
  const d = Math.floor(t / DAY), h = Math.floor((t % DAY) / 3600), m = Math.floor((t % 3600) / 60);
  return { day: d + 1, year: Math.floor(d / 365) + 1, dayOfYear: (d % 365) + 1, clock: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
};
const n0 = (n: number) => n.toLocaleString("en-GB");

export function Clock({ t, sky, town }: { t: number; sky: Sky; town: TownBundle }) {
  const f = fmtDay(t);
  return (
    <div className="lc-clock">
      <div className="lc-clock-time">{f.clock}</div>
      <div className="lc-clock-sub">
        <span>Year {f.year}, day {f.dayOfYear}</span>
        <span className="lc-dot" />
        <span>{sky.label}</span>
      </div>
      {town.name && <div className="lc-clock-place">{town.name}</div>}
    </div>
  );
}

const CAT_ORDER = ["residential", "commercial", "industrial", "civic", "education", "health", "utility", "green"];

export function Panel({ overlays, setOverlays, counts, kinds, city, t, arcs, onHome }: {
  overlays: Overlays; setOverlays: (o: Overlays) => void; counts: Record<string, number>; kinds: string[]; city: CityData; t: number; arcs: number; onHome: () => void;
}) {
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 640);
  const tog = (k: keyof Overlays) => setOverlays({ ...overlays, [k]: !overlays[k] });
  const cats = CAT_ORDER.filter((c) => city.town.structures.some((s) => s.category === c));
  const lastCensus = [...city.town.census].reverse().find((c) => c.t <= t) ?? city.town.census[0];
  const recentActs = city.town.acts.filter((a) => a.t <= t && a.t > t - 7 * DAY).length;
  const people = [...kinds, "moving"].map((k) => [k, counts[k] ?? 0] as const);
  const away = (counts.away ?? 0), gone = (counts.left ?? 0) + (counts.died ?? 0);
  return (
    <div className={`lc-panel ${open ? "" : "closed"}`}>
      <div className="lc-panel-head">
        <button className="lc-ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Layers" : "Layers"}<span className="lc-chev">{open ? "▾" : "▸"}</span></button>
        <button className="lc-ghost" onClick={onHome} title="Frame the town">Frame town</button>
      </div>
      {open && (
        <div className="lc-panel-body">
          <Section on={overlays.people} toggle={() => tog("people")} title="Who is where" note="Each point is a person, in the building they are in; white points are on their way.">
            <div className="lc-legend">
              {people.filter(([, n]) => n > 0 || true).map(([k, n]) => (
                <div key={k} className="lc-row"><span className="lc-sw dot" style={{ background: PAL.where[k] ?? PAL.where.other, boxShadow: `0 0 6px ${PAL.where[k] ?? PAL.where.other}` }} /><span>{WHERE_LABEL[k] ?? k}</span><span className="lc-num">{n0(n)}</span></div>
              ))}
              <div className="lc-row muted"><span className="lc-sw" /><span>Away from town, or between places</span><span className="lc-num">{n0(away)}</span></div>
              {gone > 0 && <div className="lc-row muted"><span className="lc-sw" /><span>Left or died</span><span className="lc-num">{n0(gone)}</span></div>}
            </div>
          </Section>
          <Section on={overlays.acts} toggle={() => tog("acts")} title="The seat's acts" note="Arcs from the town hall to what each act reached, over the last 7 days; the arc fades with age. Rose: refused.">
            <div className="lc-legend">
              <div className="lc-row"><span className="lc-sw line" style={{ background: `linear-gradient(90deg, ${PAL.seat}, #ffe2a6)` }} /><span>Acts in the last 7 days</span><span className="lc-num">{recentActs}</span></div>
              <div className="lc-row muted"><span className="lc-sw" /><span>Places reached</span><span className="lc-num">{arcs}</span></div>
            </div>
          </Section>
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
      <div className="lc-tip-sub"><span className="lc-sw" style={{ background: PAL.category[s.category] ?? PAL.category.other }} />{s.type.replace(/[-_]/g, " ")} · {s.category}<span className="lc-mono">{s.id}</span></div>
      <dl className="lc-dl">
        {owner && <><dt>Owner</dt><dd>{owner}</dd></>}
        {sp && <><dt>Spaces</dt><dd>{sp}</dd></>}
        {s.vars?.disrepair !== undefined && <><dt>Disrepair</dt><dd className="lc-mono">{n0(s.vars.disrepair)} <span className="muted">at start</span></dd></>}
        {s.started !== undefined && <><dt>Built</dt><dd>{s.completed !== undefined && s.completed <= t ? `completed day ${fmtDay(s.completed).day}` : `under way since day ${fmtDay(s.started).day}`}</dd></>}
        <dt>Inside now</dt>
        <dd>{who.length ? `${who.length} — ${Object.entries(byKind).map(([k, n]) => `${n} ${WHERE_LABEL[k]?.toLowerCase().replace(/^at |^in a |^in /, "") ?? k}`).join(", ")}` : "nobody"}</dd>
      </dl>
      {who.length > 0 && (
        <div className="lc-chips">
          {who.slice(0, full ? 40 : 8).map((w) => <span key={w.q} className="lc-chip"><span className="lc-sw dot" style={{ background: PAL.where[w.kind] ?? PAL.where.other }} />{c.people.people[w.q]![1]}</span>)}
          {who.length > (full ? 40 : 8) && <span className="lc-chip muted">+{who.length - (full ? 40 : 8)}</span>}
        </div>
      )}
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
  else if (s >= 0) where = `${WHERE_LABEL[kind] ?? kind} — ${name(s)}`;
  else if (trip && trip.to >= 0 && trip.t2 - trip.t1 <= 3 * 3600) where = `On the way from ${trip.from >= 0 ? name(trip.from) : "?"} to ${name(trip.to)}`;
  else where = trip && trip.from >= 0 ? `Away, since leaving ${name(trip.from)} (day ${fmtDay(trip.t1).day} ${fmtDay(trip.t1).clock})` : "Away";
  return (
    <>
      <div className="lc-tip-title">{p[1]}</div>
      <div className="lc-tip-sub"><span className="lc-sw dot" style={{ background: PAL.citizen }} />person{p[2] ? ` · ${p[2] === "f" ? "female" : "male"}` : ""} · {ageAt(c, q, t)} years{p[1] !== p[0] && <span className="lc-mono">{p[0]}</span>}</div>
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
  if (tip.layer === "buildings" || tip.layer === "parks" || tip.layer === "roofs") body = <StructureBody c={city} i={tip.object as number} t={t} name={name} />;
  else if (tip.layer === "people") body = <PersonBody c={city} q={tip.index} t={t} name={name} />;
  else if (tip.layer === "acts" || tip.layer === "act-hits") body = <ActBody a={tip.object.act} target={tip.object.target} t={t} />;
  else if (tip.layer === "networks") body = <><div className="lc-tip-title">{tip.object.id}</div><div className="lc-tip-sub">{tip.object.mode}{tip.object.capacity ? ` · capacity ${n0(tip.object.capacity)}` : ""}</div></>;
  else if (tip.layer === "wildlife") {
    const c = city.town.wildlife.cells, i = tip.index;
    body = <><div className="lc-tip-title">{city.town.wildlife.species[c[i * 4 + 2]!]?.replace(/-/g, " ")}</div><div className="lc-tip-sub">{c[i * 4 + 3]} at cell {c[i * 4]}, {c[i * 4 + 1]} · at the start</div></>;
  }
  if (!body) return null;
  const left = Math.min(tip.x + 16, (typeof window !== "undefined" ? window.innerWidth : 1600) - 320);
  return <div className="lc-tip" style={{ left, top: tip.y + 16 }}>{body}</div>;
}

function ActBody({ a, target, t }: { a: TownBundle["acts"][number]; target?: string; t: number }) {
  const f = fmtDay(a.t);
  const ago = t - a.t;
  return (
    <>
      <div className="lc-tip-title"><span style={{ color: PAL.seat }}>●</span> {a.blocks.map((b) => b.block + (b.kind ? ` · ${b.kind.replace(/_/g, " ")}` : "")).join(" + ")}</div>
      <div className="lc-tip-sub">{a.as ? `as ${a.as} · ` : ""}year {f.year}, day {f.dayOfYear}, {f.clock}{ago > 0 ? ` · ${ago < DAY ? `${Math.round(ago / 3600)} h` : `${Math.round(ago / DAY)} d`} ago` : ""}<span className={`lc-pill ${a.status}`}>{a.status}</span></div>
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
  else if (selection?.kind === "act") { const a = city.town.acts.find((x) => x.seq === selection.seq); if (a) body = <ActBody a={a} t={t} />; }
  if (!body) return null;
  return (
    <div className="lc-card">
      <button className="lc-x" onClick={onClose} aria-label="Clear selection">×</button>
      {body}
    </div>
  );
}
