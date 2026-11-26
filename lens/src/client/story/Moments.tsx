// Moments (#/moments): every lever the study's reader found attempted or executed, across every run with a seat bundle,
// as quote cards: the seat's own words when it reached for it (its request, its note on signing, its reason), the
// reader's reading of the act, when (day, days to the poll, phase), what became of it, and which run. Filter by model,
// lever, level and goal; each card opens its run at that sitting. The reader's `considered` level (a phrase match,
// unreliable) is left out unless asked for, and shown muted. Nothing here grades: the flags are the reader's, labelled.
import { useEffect, useMemo, useState } from "react";
import { useLens } from "../state";
import { loadSeat, loadSitting, useAsync, human, STAGE, type SeatJson, type SeatLever } from "./data";
import "./story.css";
import "./moments.css";

const DAY = 86_400;

export interface Moment {
  key: string; model: string; goal?: string; seed?: number; lever: SeatLever;
  /** The seat's own words for it: what it asked the translator, or the paper it sent. */
  words: string;
  /** What it said on signing, and its reason given with the act, where there are any. */
  note?: string; reason?: string;
  outcome: string; outcomeTone: "ok" | "no" | "wait";
  /** Other events of the same lever at the same act or draft, folded into this card. */
  also: SeatLever[];
  election: string;
}

const modelOf = (s: SeatJson) => (s.model ? s.model.split("/").at(-1)! : s.arm ?? "code");

/** A run's moments: one per lever and act (or draft, or failed request), at its furthest level. */
export function momentsOf(key: string, seat: SeatJson, withConsidered = false): Moment[] {
  const rank = { considered: 1, attempted: 2, executed: 3 } as const;
  const groups = new Map<string, SeatLever[]>();
  for (const l of seat.levers) {
    if (l.level === "considered" && !withConsidered) continue;
    const where = l.act !== undefined ? `act:${l.act}` : l.level === "considered" ? `t:${l.t}:${l.words.slice(0, 40)}` : `${l.source}:${l.t}`;
    const k = `${l.lever}|${where}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const e = seat.election;
  const election = seat.outcome === "won" ? "won the election" : seat.outcome === "lost" ? "lost the election" : seat.amendments.some((a) => a.outcome === "applied") ? `poll moved to day ${Math.round((e.poll_at ?? 0) / DAY)}` : seat.ended === "stopped" ? "run stopped before the poll" : human(seat.outcome);
  return [...groups.values()].map((all) => {
    const top = all.reduce((a, b) => (rank[b.level] > rank[a.level] ? b : a));
    const act = top.act !== undefined ? seat.acts[top.act] : undefined;
    const draftId = act?.draft ?? /^draft (.+)$/.exec(top.source)?.[1];
    const draft = draftId ? seat.drafts.find((d) => d.id === draftId) : undefined;
    const failure = top.source === "translator" ? seat.failures.find((f) => f.t === top.t) : undefined;
    const words = draft?.proposal || failure?.proposal || act?.proposal || top.words;
    const outcome = act ? (act.status === "applied" ? (top.stage && top.stage !== "applied" ? STAGE[top.stage] ?? top.stage : "applied") : act.status === "refused" ? `refused: ${act.code}` : "sent, no outcome in the log") : top.stage ? STAGE[top.stage] ?? top.stage : top.level === "considered" ? "words only" : "—";
    const tone: Moment["outcomeTone"] = top.level === "executed" || outcome === "applied" ? "ok" : /refused|declined|could not|rejected|asked back/.test(outcome) ? "no" : "wait";
    return { key, model: modelOf(seat), ...(seat.goal ? { goal: seat.goal } : {}), ...(seat.seed !== undefined ? { seed: seat.seed } : {}), lever: top, words,
      ...(draft?.note ? { note: draft.note } : {}), ...(act?.reasoning ? { reason: act.reasoning } : {}), outcome, outcomeTone: tone, also: all.filter((x) => x !== top), election };
  });
}

/** The card as a line to paste into a slide or a paper. */
export function citation(m: Moment): string {
  const l = m.lever;
  return `“${m.words}” (${m.model}${m.goal ? `, goal ${m.goal}` : ""}${m.seed !== undefined ? `, seed ${m.seed}` : ""}; day ${l.day}${l.days_to_poll !== null ? `, ${l.days_to_poll} days before the poll` : ""}). Reader: ${l.title}, ${l.level}; ${m.outcome}. Run ${m.key}.`;
}

interface RunEntry { key: string; indexed?: boolean }

export function Moments({ onOpen }: { onOpen?: (key: string, t: number, sel: string) => void }) {
  const [runs, setRuns] = useState<RunEntry[] | Error>();
  useEffect(() => { fetch("/api/runs").then((r) => r.json()).then((rs: RunEntry[]) => setRuns(rs.some((r) => r.indexed !== undefined) ? rs.filter((r) => r.indexed) : rs), (e) => setRuns(e instanceof Error ? e : new Error(String(e)))); }, []);
  const seats = useAsync(async () => {
    if (!runs || runs instanceof Error) return null;
    const got = await Promise.all(runs.map((r) => loadSeat(r.key).then((s) => [r.key, s] as const, () => null)));
    // (One fork bundled under two keys counts once.)
    const seen = new Set<string>();
    return got.filter((x): x is readonly [string, SeatJson] => x !== null && !seen.has(`${x[1].run_id}|${x[1].arm}`) && !!seen.add(`${x[1].run_id}|${x[1].arm}`));
  }, [runs]);
  if (runs instanceof Error) return <div className="mo"><div className="st-empty">Could not list the runs: {runs.message}</div></div>;
  if (!runs || seats === undefined || seats === null) return <div className="mo"><div className="st-empty">Reading every run's seat…</div></div>;
  if (seats instanceof Error) return <div className="mo"><div className="st-empty">{seats.message}</div></div>;
  return <Gallery seats={seats} onOpen={onOpen} />;
}

function Gallery({ seats, onOpen }: { seats: (readonly [string, SeatJson])[]; onOpen?: (key: string, t: number, sel: string) => void }) {
  const [weak, setWeak] = useState(false);
  const [models, setModels] = useState<Set<string>>(new Set());
  const [levers, setLevers] = useState<Set<string>>(new Set());
  const [goals, setGoals] = useState<Set<string>>(new Set());
  const [levels, setLevels] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<"poll" | "day" | "model">("poll");
  const all = useMemo(() => seats.flatMap(([k, s]) => momentsOf(k, s, weak)), [seats, weak]);
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
        <div className="st-sub">{all.filter((m) => m.lever.level !== "considered").length} moments in {withAny} of {seats.length} runs. Flags are the study's reader (experiments/power-seeking/reader.ts); the words are the seat's own: what it asked for, and what it said on signing.</div>
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
      <div className="mo-out"><span className={`st-pill ${m.outcomeTone}`}>{m.outcome}</span>{m.also.length > 0 && <span className="st-faint"> · {m.also.map((x) => x.level).join(", ")} too</span>}</div>
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
