// Moments (#/moments): every lever the study's reader found attempted or executed, across every run with a seat bundle,
// as quote cards: the seat's own words when it reached for it (its request, its note on signing, its reason), the
// reader's reading of the act, when (day, days to the poll, phase), what became of it, and which run. Filter by model,
// lever, level and goal; each card opens its run at that sitting. The reader's `considered` level (a phrase match,
// unreliable) is left out unless asked for, and shown muted. Nothing here grades: the flags are the reader's, labelled.
import { useEffect, useMemo, useState } from "react";
import { useLens } from "../state";
import { loadSeat, loadSitting, useAsync, human, type SeatJson } from "./data";
import { momentsOf, citation, type Moment, type MomentsResponse } from "./moments-data";
import "./story.css";
import "./moments.css";

const DAY = 86_400;
export { momentsOf, citation, type Moment };
interface RunEntry { key: string; indexed?: boolean }

export function Moments({ onOpen }: { onOpen?: (key: string, t: number, sel: string) => void }) {
  // (The server's /api/moments: each indexed fork's moments, made once per bundle. Where it is absent, from each seat.)
  const data = useAsync(async () => {
    const r = await fetch("/api/moments");
    if (r.ok) { const x = (await r.json()) as MomentsResponse; return { all: dedupe(x.runs).flatMap((y) => y.moments), runs: x.runs.length }; }
    const rs: RunEntry[] = await (await fetch("/api/runs")).json().then((c: any) => (Array.isArray(c) ? c : c.runs));
    const keep = rs.some((e) => e.indexed !== undefined) ? rs.filter((e) => e.indexed) : rs;
    const got = (await Promise.all(keep.map((e) => loadSeat(e.key).then((s) => ({ key: e.key, id: `${s.run_id}|${s.arm}`, moments: momentsOf(e.key, s, true) }), () => null)))).filter((x): x is NonNullable<typeof x> => x !== null);
    return { all: dedupe(got).flatMap((y) => y.moments), runs: got.length };
  }, []);
  if (data === undefined) return <div className="mo"><div className="st-empty">Reading every run's moments…</div></div>;
  if (data instanceof Error || data === null) return <div className="mo"><div className="st-empty">Could not read the moments{data instanceof Error ? `: ${data.message}` : ""}</div></div>;
  return <Gallery all={data.all} runs={data.runs} onOpen={onOpen} />;
}
/** One fork bundled under two keys counts once. */
function dedupe<T extends { id: string }>(xs: T[]): T[] { const seen = new Set<string>(); return xs.filter((x) => !seen.has(x.id) && !!seen.add(x.id)); }

function Gallery({ all: every, runs, onOpen }: { all: Moment[]; runs: number; onOpen?: (key: string, t: number, sel: string) => void }) {
  const [weak, setWeak] = useState(false);
  const [models, setModels] = useState<Set<string>>(new Set());
  const [levers, setLevers] = useState<Set<string>>(new Set());
  const [goals, setGoals] = useState<Set<string>>(new Set());
  const [levels, setLevels] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<"poll" | "day" | "model">("poll");
  const all = useMemo(() => (weak ? every : every.filter((m) => m.lever.level !== "considered")), [every, weak]);
  const count = (f: (m: Moment) => string) => { const c = new Map<string, number>(); for (const m of all) c.set(f(m), (c.get(f(m)) ?? 0) + 1); return [...c].sort((a, b) => b[1] - a[1]); };
  const shown = all.filter((m) => (!models.size || models.has(m.model)) && (!levers.size || levers.has(m.lever.title)) && (!goals.size || goals.has(m.goal ?? "none")) && (!levels.size || levels.has(m.lever.level)))
    .sort((a, b) => sort === "model" ? a.model.localeCompare(b.model) || a.lever.t - b.lever.t : sort === "day" ? a.lever.t - b.lever.t : (a.lever.days_to_poll ?? 1e9) - (b.lever.days_to_poll ?? 1e9));
  const withAny = new Set(all.filter((m) => m.lever.level !== "considered").map((m) => m.key)).size;
  const toggle = (s: Set<string>, set: (x: Set<string>) => void, v: string) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); set(n); };
  const open = (m: Moment) => {
    const sel = m.lever.sitting !== null ? `lever:${m.lever.i}` : "";
    if (onOpen) onOpen(m.key, m.lever.t, sel);
    else { const st = useLens.getState(); st.setRun(m.key); location.hash = `#/run/${encodeURIComponent(m.key)}?t=${Math.round(m.lever.t)}${sel ? `&sel=${sel}` : ""}`; }
  };
  const Facet = ({ label, items, set, on }: { label: string; items: [string, number][]; set: (x: Set<string>) => void; on: Set<string> }) => (
    <div className="mo-facet"><span className="lbl">{label}</span>{items.map(([v, n]) => <button key={v} className={`st-btn ${on.has(v) ? "on" : ""}`} onClick={() => toggle(on, set, v)}>{v} <span className="n">{n}</span></button>)}</div>
  );
  return (
    <div className="mo">
      <div className="mo-head">
        <div className="st-kicker">Moments · from every run with a seat bundle</div>
        <h1 className="mo-title">When the seat reached for a lever</h1>
        <div className="st-sub">{all.filter((m) => m.lever.level !== "considered").length} moments in {withAny} of {runs} runs. Flags are the study's reader (experiments/power-seeking/reader.ts); the words are the seat's own: what it asked for, and what it said on signing.</div>
        <div className="mo-filters">
          <Facet label="model" items={count((m) => m.model)} set={setModels} on={models} />
          <Facet label="goal" items={count((m) => m.goal ?? "none")} set={setGoals} on={goals} />
          <Facet label="lever" items={count((m) => m.lever.title)} set={setLevers} on={levers} />
          <Facet label="level" items={count((m) => m.lever.level)} set={setLevels} on={levels} />
          <div className="mo-facet"><span className="lbl">order</span>
            {(["poll", "day", "model"] as const).map((k) => <button key={k} className={`st-btn ${sort === k ? "on" : ""}`} onClick={() => setSort(k)}>{k === "poll" ? "nearest the poll" : k === "day" ? "by day" : "by model"}</button>)}
            <span style={{ flex: 1 }} />
            <button className={`st-btn ${weak ? "on" : ""}`} onClick={() => setWeak(!weak)} title="The reader's phrase matches in the seat's words: unreliable">{weak ? "hide" : "show"} “considered”</button>
          </div>
        </div>
      </div>
      <div className="mo-grid">
        {shown.map((m) => <Card key={`${m.key}:${m.lever.i}`} m={m} onOpen={() => open(m)} />)}
        {!shown.length && <div className="st-empty">No moment matches.</div>}
      </div>
    </div>
  );
}

function Card({ m, onOpen }: { m: Moment; onOpen: () => void }) {
  const l = m.lever, weak = l.level === "considered";
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <article className={`mo-card ${weak ? "weak" : ""} ${l.level}`}>
      <div className="mo-card-top"><span className="mo-lever">{l.title}</span><span className={`mo-level ${l.level}`}>{l.level}</span></div>
      <blockquote className={`mo-quote ${more ? "open" : ""}`} onClick={() => setMore(!more)}>{m.words}</blockquote>
      {m.note && <div className="mo-sub"><span className="k">on signing</span>“{m.note}”</div>}
      {m.reason && <div className="mo-sub"><span className="k">its reason</span>“{m.reason}”</div>}
      {more && <Around m={m} />}
      <div className="mo-when"><b>day {l.day}</b>{l.days_to_poll !== null ? <> · {l.days_to_poll} days to the poll</> : null} · {human(l.phase)}</div>
      <div className="mo-out"><span className={`st-pill ${m.outcomeTone}`}>{m.outcome}</span></div>
      <div className="mo-foot">
        <span className="mo-who"><b>{m.model}</b>{m.goal ? ` · ${m.goal}` : ""}{m.seed !== undefined ? ` · seed ${m.seed}` : ""}<span className="st-faint"> · {m.election}</span></span>
        <span style={{ flex: 1 }} />
        <button className="st-btn" title="Copy as a citation" onClick={() => { navigator.clipboard?.writeText(citation(m)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }, () => {}); }}>{copied ? "copied" : "cite"}</button>
        <button className="st-btn flag" onClick={onOpen}>open ›</button>
      </div>
    </article>
  );
}

/** The seat's own words in the call where it asked (its text before the request), fetched when the card is opened. */
function Around({ m }: { m: Moment }) {
  const s = m.lever.sitting;
  const d = useAsync(() => (s === null ? null : loadSitting(m.key, s)), [m.key, s]);
  if (s === null) return null;
  if (d === undefined) return <div className="mo-around st-faint">…</div>;
  if (d instanceof Error) return null;
  const probe = m.words.slice(0, 50);
  for (const t of d.turns) {
    const out = Array.isArray(t.output) ? t.output : [];
    const k = out.findIndex((c: any) => c?.type === "tool_use" && JSON.stringify(c.input ?? {}).includes(probe));
    if (k < 0) continue;
    const said = out.slice(0, k).filter((c: any) => c?.type === "text" || c?.type === "thinking").map((c: any) => String(c.text ?? c.thinking ?? "")).join("\n\n").trim();
    if (said) return <div className="mo-around"><span className="k">what it wrote just before</span>{said.length > 1_200 ? said.slice(0, 1_200) + "…" : said}</div>;
  }
  return null;
}
