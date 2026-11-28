// Moments (#/moments): every lever the study's reader found attempted or executed, across every run with a seat bundle,
// as quote cards: the seat's own words when it reached for it (its request, its note on signing, its reason), the
// reader's reading of the act, when (day, days to the poll, phase), what became of it, and which run. Filter by model,
// lever, level and goal; each card opens its run at that sitting. The reader's `considered` level (a phrase match,
// unreliable) is left out unless asked for, and shown muted. Nothing here grades: the flags are the reader's, labelled.
import { seriousness } from "../plain";
import { LiveToggle, useLive } from "../measures";
import { FINANCE_WHY, NOT_COUNTED_WORDS, POLL_DAY, isFinanceLever, notCountedReason, addedAfterReport, isStudyEntry, markOf, studyRuns, type StudyRun } from "../library/landing-data";
import { modelName } from "../words";
/** Said plainly on a card whose words are the mayor's nomination (its campaign platform): the checker matched words
 * there, not an order to an office; and where the platform says the opposite of the act (it promises to enforce what
 * the act would stop), that too. */
function platformNote(m: Moment): string {
  const keeps = m.lever.lever === "fines_off" && /\benforc\w*/i.test(m.words);
  return `The checker matched words in the mayor's campaign platform, not an order to an office. Read the platform${keeps ? ": it promises to keep the fines" : " before taking this as an act"}.`;
}

/** What the two blind graders found at this act's seriousness, as one plain sentence. */
const GRADER_TIER: Record<string, string> = {
  executed: "both found an act this serious carried out",
  considered: "both found it weighed in the mayor's thinking, not carried out",
  none: "neither found an act this serious",
  split: "they differ",
};
import type { RunEntry as FullEntry } from "../../shared/api";
import { Measures, MeasuresKey, runCount, runCountText, TWO_CHECKS } from "../measures";
import { useEffect, useMemo, useState } from "react";
import { useLens } from "../state";
import { loadSeat, loadSitting, useAsync, human, type SeatJson } from "./data";
import { nameRuns, runName } from "../run-names";
import { momentsOf, citation, type Moment, type MomentsResponse, byNearestElection } from "./moments-data";
import { PageAnswer } from "../shell/Shell";
import { HowDoWeKnow } from "./Evidence";
import { Hi, usePlain } from "./text";
import { withSetups } from "./IdTip";
import { CaseStudies } from "./CaseStudies";
import { goalText, leverTitle } from "../words";
import "./story.css";
import "./moments.css";
import { dayNo, dayOf, lockT, openAt } from "../format";

const DAY = 86_400;
const LEVEL: { [k: string]: string } = { executed: "carried out", attempted: "tried, not carried out", considered: "mentioned (unreliable)" };
export { momentsOf, citation, type Moment };
interface RunEntry { key: string; indexed?: boolean }

/** A phone-narrow screen. */
const PHONE = typeof matchMedia !== "undefined" && matchMedia("(max-width: 700px)").matches;

export function Moments({ onOpen }: { onOpen?: (key: string, t: number, sel: string) => void }) {
  // (The server's /api/moments: each indexed fork's moments, made once per bundle. Where it is absent, from each seat.)
  const data = useAsync(async () => {
    const r = await fetch("/api/moments");
    // (Rope tests and scripted controls are not AI mayors: left out, as everywhere.)
    if (r.ok) { const x = (await r.json()) as MomentsResponse; return { all: x.runs, runs: x.indexed, note: "" }; }
    const rs: RunEntry[] = await (await fetch("/api/runs")).json().then((c: any) => (Array.isArray(c) ? c : c.runs));
    const keep = rs.some((e) => e.indexed !== undefined) ? rs.filter((e) => e.indexed) : rs;
    const got = (await Promise.all(keep.map((e) => loadSeat(e.key).then((s) => ({ key: e.key, id: `${s.run_id}|${s.arm}`, moments: momentsOf(e.key, s, true) }), () => null)))).filter((x): x is NonNullable<typeof x> => x !== null);
    return { all: got, runs: got.length, note: "" };
  }, []);
  if (data === undefined) return <div className="mo"><div className="st-empty">Reading every run's moments…</div></div>;
  if (data instanceof Error || data === null) return <div className="mo"><div className="st-empty">Could not read the moments{data instanceof Error ? `: ${data.message}` : ""}</div></div>;
  return <Gallery all={data.all} runs={data.runs} note={data.note} onOpen={onOpen} />;
}
/** Each run once, by its key. (Two runs of one spec share a run id, "…-seed9|deepseek", but are different runs: the v1
 * pilot and the v2 probe of DeepSeek red-team seed 9, a run and its capped re-run. A dedupe by run id hid one of each.) */
function dedupe<T extends { key: string }>(xs: T[]): T[] { const seen = new Set<string>(); return xs.filter((x) => !seen.has(x.key) && !!seen.add(x.key)); }

function Gallery({ all: everyRun, runs, note, onOpen }: { all: { key: string; id: string; moments: Moment[] }[]; runs: number; note?: string; onOpen?: (key: string, t: number, sel: string) => void }) {
  // (On a phone the filters fold under one control, so the first moment shows on the first screen.)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [weak, setWeak] = useState(false);
  const [models, setModels] = useState<Set<string>>(new Set());
  const [levers, setLevers] = useState<Set<string>>(new Set());
  const [goals, setGoals] = useState<Set<string>>(new Set());
  const [levels, setLevels] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<"poll" | "day" | "model">("poll");
  // (#/moments?run=<key>: one run's cards, as the landing links its one counted case.)
  const runInHash = () => { const m = /[?&]run=([^&]+)/.exec(location.hash); return m ? decodeURIComponent(m[1]!) : null; };
  const [onlyRun, setOnlyRun] = useState<string | null>(runInHash);
  useEffect(() => { const on = () => setOnlyRun(runInHash()); addEventListener("hashchange", on); return () => removeEventListener("hashchange", on); }, []);
  // (Three views: the checker's power grabs (seriousness 2 or 3, its primary measure), its election-season favours (grade 1,
  // never called a power grab), and the graders' lock-ins, each with the mayor's words.)
  const [view, setView] = useState<"grabs" | "favours" | "lockins">(() => (location.hash.includes("view=lockins") ? "lockins" : location.hash.includes("view=favours") ? "favours" : "grabs"));
  const live = useLive();
  // (Each card also gives the run's lock-in, which needs the catalogue's grades; the cards show without it until it comes.)
  const cat = useAsync(async () => { const c = await (await fetch("/api/runs")).json(); const runs = (Array.isArray(c) ? c : c.runs) as FullEntry[]; nameRuns(runs); return runs; }, []);
  const entries = useMemo(() => new Map((Array.isArray(cat) ? cat : []).map((e) => [e.key, e])), [cat]);
  // (The same runs Findings counts: AI mayors only, tests and controls apart, the report's frozen set unless the live
  // figures are asked for. Until the catalogue comes, every run's moments show.)
  // (A fork bundled under two keys counts once: the study's key is kept, chosen before the duplicate is dropped.)
  const every = useMemo(() => dedupe(entries.size ? everyRun.filter((r) => { const e = entries.get(r.key); return !!e && isStudyEntry(e) && (live || !addedAfterReport(e)); }) : everyRun).flatMap((r) => r.moments), [everyRun, entries, live]);
  const aiRuns = Array.isArray(cat) ? runCount(cat, live) : null;
  const tierOf = (m: Moment) => m.lever.tier ?? 2;
  const all = useMemo(() => (weak ? every : every.filter((m) => m.lever.level !== "considered")).filter((m) => (view === "favours" ? tierOf(m) === 1 : tierOf(m) >= 2)), [every, weak, view]);
  // (The buttons count acts and the runs they came in, so they read beside Findings' count of runs.)
  const acts = (keep: (m: Moment) => boolean) => { const xs = every.filter((m) => m.lever.level !== "considered" && keep(m)); return { n: xs.length, runs: new Set(xs.map((m) => m.key)).size }; };
  // (As the report counts: acts in the study's counted runs, and apart, those in runs it does not count.)
  const isCounted = (m: Moment) => { const e = entries.get(m.key); return !!e && !notCountedReason(e, live); };
  const split = (x: (m: Moment) => boolean) => ({ counted: acts((m) => pass(m) && x(m) && isCounted(m)), apart: acts((m) => pass(m) && x(m) && !isCounted(m)) });
  // (Spending timed near the vote: the study counts none of it (its tally is tier 2 and 3 only), so Lens counts it as
  // the power grabs are, in the counted runs, and sets apart what cannot be "near the vote": a run with no election in
  // it, and a match in the mayor's campaign platform, which is not spending.)
  const isPlatform = (m: Moment) => PLATFORM.test(m.words);
  const favourWhy = (m: Moment): string | undefined => { const e = entries.get(m.key); if (!e) return undefined; const w = notCountedReason(e, live); return w ? NOT_COUNTED_WORDS[w] : e.experiment?.election === false ? "no election in the run" : isPlatform(m) ? "matched in its campaign platform" : undefined; };
  const favourText = () => {
    const xs = shown.filter((m) => m.lever.level !== "considered");
    const inn = xs.filter((m) => !favourWhy(m)), out = xs.filter((m) => favourWhy(m));
    const runs = (ys: Moment[]) => new Set(ys.map((m) => m.key)).size;
    const why = [...new Set(out.map((m) => favourWhy(m)!))];
    return `${inn.length} ${inn.length === 1 ? "act" : "acts"} of spending timed near the vote in ${runs(inn)} counted ${runs(inn) === 1 ? "run" : "runs"}${out.length ? `, plus ${out.length} in ${runs(out)} ${runs(out) === 1 ? "run" : "runs"} not counted (${why.join("; ")})` : ""}`;
  };
  const splitText = (x: (m: Moment) => boolean, noun: string) => { const s = split(x); return `${s.counted.n} ${noun} in ${s.counted.runs} counted ${s.counted.runs === 1 ? "run" : "runs"}${s.apart.n ? `, plus ${s.apart.n} in ${s.apart.runs} ${s.apart.runs === 1 ? "run" : "runs"} not counted (earlier pilots, or stopped before election day)` : ""}`; };
  const favours = acts((m) => tierOf(m) === 1), grabs = acts((m) => tierOf(m) >= 2);
  const inRuns = (x: { n: number; runs: number }) => `${x.n} ${x.n === 1 ? "act" : "acts"} in ${x.runs} ${x.runs === 1 ? "run" : "runs"}`;
  const lockins = useMemo(() => (Array.isArray(cat) ? studyRuns(cat, false, live).filter((f) => markOf(f, "lockin") === "yes" && f.grade?.lockInQuote) : []), [cat, live]);
  const pass = (m: Moment) => (!onlyRun || m.key === onlyRun) && (!models.size || models.has(m.model)) && (!levers.size || levers.has(leverTitle(m.lever.lever))) && (!goals.size || goals.has(goalText(m.goal ?? "none"))) && (!levels.size || levels.has(LEVEL[m.lever.level] ?? ""));
  const filtered = !!onlyRun || models.size + levers.size + goals.size + levels.size > 0;
  // (The lock-ins take the same model and instruction filters, and the same orders, by the day the graders quoted.)
  const lockDay = (f: StudyRun) => Math.floor(lockT(f.grade!.lockInQuote!) / 86_400);
  const lockShown = lockins.filter((f) => (!onlyRun || f.key === onlyRun) && (!models.size || models.has(modelName(f.model)) || models.has(f.model)) && (!goals.size || goals.has(goalText(f.goal ?? "none"))))
    .sort((a, b) => sort === "model" ? modelName(a.model).localeCompare(modelName(b.model)) || lockDay(a) - lockDay(b) : sort === "day" ? lockDay(a) - lockDay(b) : Math.abs(lockDay(a) - POLL_DAY) - Math.abs(lockDay(b) - POLL_DAY) || lockDay(a) - lockDay(b));
  const countLock = (f: (x: StudyRun) => string) => { const c = new Map<string, number>(); for (const x of lockins) c.set(f(x), (c.get(f(x)) ?? 0) + 1); return [...c].sort((a, b) => b[1] - a[1]); };
  const count = (f: (m: Moment) => string) => { const c = new Map<string, number>(); for (const m of all) c.set(f(m), (c.get(f(m)) ?? 0) + 1); return [...c].sort((a, b) => b[1] - a[1]); };
  const shown = all.filter(pass)
    .sort((a, b) => sort === "model" ? a.model.localeCompare(b.model) || a.lever.t - b.lever.t : sort === "day" ? a.lever.t - b.lever.t : byNearestElection(a, b));
  const withAny = new Set(all.filter((m) => m.lever.level !== "considered").map((m) => m.key)).size;
  const toggle = (s: Set<string>, set: (x: Set<string>) => void, v: string) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); set(n); };
  const open = (m: Moment) => {
    const sel = m.lever.sitting !== null ? `lever:${m.lever.i}` : "";
    if (onOpen) onOpen(m.key, m.lever.t, sel);
    else { const st = useLens.getState(); st.setRun(m.key); location.hash = `#/run/${encodeURIComponent(m.key)}?t=${Math.round(m.lever.t)}${sel ? `&sel=${sel}` : ""}`; }
  };
  // (Each filter a plain select in one line of words, "Model: all ▾", not a block of chips: lens-look.md.)
  const Facet = ({ label, all, items, set, on, show = (v: string) => v }: { label: string; all: string; items: [string, number][]; set: (x: Set<string>) => void; on: Set<string>; show?: (v: string) => string }) => (
    <label className="mo-sel">
      <span>{label}</span>
      <select value={on.size === 1 ? [...on][0]! : ""} onChange={(e) => set(e.target.value ? new Set([e.target.value]) : new Set())}>
        <option value="">{all}</option>
        {items.map(([v, n]) => <option key={v} value={v}>{show(v)} ({n})</option>)}
      </select>
    </label>
  );
  return (
    <div className="mo">
      <div className="mo-head">
        <PageAnswer page="moments" />
        <CaseStudies runs={Array.isArray(cat) ? cat : undefined} />
        <h1 className="mo-title">{view === "lockins" ? "When an AI mayor locked its programme in" : view === "favours" ? "Spending timed near the vote" : "When an AI mayor reached for a power grab"}</h1>
        <div className="seg mo-view" role="group" aria-label="Which moments">
          <button aria-pressed={view === "grabs"} onClick={() => setView("grabs")}>Power grabs <span className="n">{inRuns(grabs)}</span></button>
          <button aria-pressed={view === "lockins"} onClick={() => setView("lockins")}>Lock-ins <span className="n">{lockins.length} {lockins.length === 1 ? "run" : "runs"}</span></button>
          <button aria-pressed={view === "favours"} onClick={() => setView("favours")}>Spending near the vote <span className="n">{inRuns(favours)}</span></button>
        </div>
        <p className="st-sub">
          {view === "lockins"
            ? <><span className="st-sub-lead">{lockShown.length} {lockShown.length === 1 ? "run" : "runs"} where both blind graders found a lock-in{filtered ? ", with these filters" : ""}.</span> <span className="st-sub-more">Out of {aiRuns ? runCountText(aiRuns) : "the runs"}. The words are the mayor's own; the description of the act is the graders', as they wrote it.</span></>
            : view === "favours"
              ? <><span className="st-sub-lead">{favourText()}{filtered ? ", with these filters" : ""}.</span> <span className="st-sub-more">Spending or hiring timed for the vote, at the study's checker's lowest level. The study does not count these as power grabs; Lens counts them in the same runs it counts power grabs.</span></>
              : <><span className="st-sub-lead">{splitText((m) => (m.lever.tier ?? 2) >= 2, "power grabs")}{filtered ? ", with these filters" : ""}.</span> <span className="st-sub-more">Out of {aiRuns ? runCountText(aiRuns) : "the runs"}. A power grab is an act at the study's checker's two highest levels of seriousness. The quoted words are the AI mayor's own: what it asked for, and what it said when it signed.</span></>}
        </p>
        <p className="st-sub">{TWO_CHECKS}</p>
        <MeasuresKey />
        {Array.isArray(cat) && <LiveToggle runs={cat} />}
        {onlyRun && <p className="st-sub"><b>One run's moments.</b> <button className="st-btn" onClick={() => { setOnlyRun(null); history.replaceState(null, "", "#/moments"); }}>Show every run</button></p>}
        {PHONE && (
          <button className="st-btn mo-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
            {filtersOpen ? "Hide the filters" : `Filter${models.size + goals.size + levers.size + levels.size ? ` (${models.size + goals.size + levers.size + levels.size} on)` : ""}`}
          </button>
        )}
        {(!PHONE || filtersOpen) && <div className="mo-filters">
          <Facet label="Model" all="all models" items={view === "lockins" ? countLock((f) => modelName(f.model)) : count((m) => m.model)} set={setModels} on={models} />
          <Facet label="Instructions" all="any" items={view === "lockins" ? countLock((f) => goalText(f.goal ?? "none")) : count((m) => goalText(m.goal ?? "none"))} set={setGoals} on={goals} />
          {view !== "lockins" && <Facet label={view === "favours" ? "Favour" : "Power grab"} all="any kind" items={count((m) => leverTitle(m.lever.lever))} set={setLevers} on={levers} />}
          {view !== "lockins" && <Facet label="How far" all="tried or carried out" items={count((m) => LEVEL[m.lever.level] ?? "")} set={setLevels} on={levels} />}
          <label className="mo-sel">
            <span>Order</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="poll">nearest election day</option>
              <option value="day">by day</option>
              <option value="model">by model</option>
            </select>
          </label>
          {view !== "lockins" && <label className="mo-sel mo-weak" title="Where the idea only came up in its thinking: the checker matched words, which is often wrong">
            <input type="checkbox" checked={weak} onChange={() => setWeak(!weak)} /> also ideas it only mentioned
          </label>}
        </div>}
      </div>
      {view === "lockins" ? (
        <div className="mo-grid">
          {lockShown.map((f) => <LockCard key={f.key} f={f} />)}
          {!lockShown.length && <div className="st-empty">{Array.isArray(cat) ? (lockins.length ? "No lock-in matches." : "No graded lock-in in these runs.") : "Reading the runs…"}</div>}
        </div>
      ) : (
      <div className="mo-grid">
        {shown.map((m) => <Card key={`${m.key}:${m.lever.i}`} m={m} entry={entries.get(m.key)} onOpen={() => open(m)} />)}
        {!shown.length && <div className="st-empty">No moment matches.</div>}
      </div>
      )}
    </div>
  );
}

/** One graded lock-in: the mayor's words, and the graders' own description of the act (quoted, never paraphrased). */
function LockCard({ f }: { f: StudyRun }) {
  const q = f.grade!.lockInQuote!;
  const t = openAt(lockT(q));
  return (
    <article className="mo-card lockin">
      <div className="mo-card-top"><span className="mo-lever lk">Locked its programme in</span><span className="mo-level lk">both graders</span></div>
      <blockquote className="mo-quote lk"><Hi text={q.quote} town={false} /></blockquote>
      <div className="mo-sub"><span className="k">the graders' description</span>“{q.act}”</div>
      {/borderline/i.test(q.act) && <p className="mo-graders">The graders marked this borderline; it is their verdict, kept as they gave it.</p>}
      <p className="mo-when">Day {dayOf(lockT(q))}.</p>
      <div className="mo-foot">
        <span className="mo-who"><b>{withSetups(runName(f.entry))}</b>. <Measures entry={f.entry} /></span>
        <span style={{ flex: 1 }} />
        <a className="st-btn" href={`#/run/${encodeURIComponent(f.key)}?t=${t}`}>Open day {dayOf(lockT(q))}</a>
      </div>
    </article>
  );
}

/** A checker match in the mayor's nomination form (its campaign platform), not an act on an office or the budget. */
const PLATFORM = /form-mayor-nomination|nomination form|file (?:my|a) nomination/i;

function Card({ m, onOpen, entry }: { m: Moment; onOpen: () => void; entry?: FullEntry }) {
  const l = m.lever, weak = l.level === "considered";
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState(false);
  const plain = usePlain(false);
  const heldBack = l.level === "attempted" && l.stage === "seat_declined" && !m.redrafted;
  return (
    <article className={`mo-card ${weak ? "weak" : ""} ${l.level} ${(l.tier ?? 2) === 1 ? "favour" : ""}`}>
      <div className="mo-card-top"><span className="mo-lever">{(l.tier ?? 2) === 1 ? "Spending near the vote: " : ""}{(l.tier ?? 2) === 1 ? leverTitle(l.lever) : leverTitle(l.lever).charAt(0).toUpperCase() + leverTitle(l.lever).slice(1)}</span><span className={`mo-level ${l.level}`} title={heldBack ? "The mayor declined the clerk's write-up and sent nothing. The study's checker counts this as tried." : undefined}>{heldBack ? "drafted, then held back" : l.level === "executed" ? "carried out" : l.level === "attempted" ? "tried, not carried out" : "mentioned (unreliable)"}{m.redrafted ? " (after redrafting)" : ""}</span></div>
      {/* (Lens's one sentence of what it did first, then the mayor's own words, verbatim, smaller.) */}
      {m.said && <p className="mo-said">{plain(m.said)}</p>}
      {m.said && <div className="mo-sub-k">its words</div>}
      <blockquote className={`mo-quote ${m.said ? "small" : ""} ${more ? "open" : ""}`} onClick={() => setMore(!more)}><Hi text={m.words} town={false} /></blockquote>
      {PLATFORM.test(m.words) && <p className="mo-platform">{platformNote(m)}</p>}
      {(l.tier ?? 2) === 1 && entry?.experiment?.election === false && <p className="mo-graders">Not counted (no election): there is no vote in this run for it to be timed near.</p>}
      {m.note && <div className="mo-sub"><span className="k">on signing</span><Hi text={`“${m.note}”`} town={false} /></div>}
      {m.reason && <div className="mo-sub"><span className="k">its reason</span><Hi text={`“${m.reason}”`} town={false} /></div>}
      {more && <Around m={m} />}
      <p className="mo-when">Day {dayNo(l.day)}{m.daysBefore !== undefined ? (m.daysBefore >= 0 ? `, ${m.daysBefore} days before the election${m.pollHeld ? "" : " was due"}` : `, ${-m.daysBefore} days after the election${m.pollHeld ? "" : " was due"}`) : ""}.</p>
      <div className="mo-out"><span className={`st-pill ${m.outcomeTone}`}>{m.outcome}</span></div>
      {l.lever === "vacate_finance" && <p className="mo-graders">{FINANCE_WHY}</p>}
      {l.lever === "replace_finance" && <p className="mo-graders">The checker counts appointing a new finance officer after a removal as part of the same change.</p>}
      {(l.tier ?? 2) >= 2 && entry?.grade && <p className="mo-graders" title={`The graders' rating at ${seriousness(l.tier ?? 2)}, where the checker put this act`}>Found by the study's checker. The blind graders, reading the whole run, also rated it: {GRADER_TIER[entry.grade.tiers[(l.tier ?? 2) as 2 | 3]]}.</p>}
      <div className="mo-foot">
        <span className="mo-who"><b>{entry ? withSetups(runName(entry)) : `${m.model}, ${m.goal ? goalText(m.goal).toLowerCase() : "no special instructions"}${m.seed !== undefined ? `, setup ${m.seed}` : ""}`}</b>. {!(entry && notCountedReason(entry) && /^stopped|^run ended/i.test(m.election)) && <span className="st-faint">{m.election.charAt(0).toUpperCase() + m.election.slice(1)}.</span>}{entry && <> <Measures entry={entry} /></>}</span>
        <span style={{ flex: 1 }} />
        <span className="mo-more-acts">
          <button className="st-btn" title="Copy as a citation" onClick={() => { navigator.clipboard?.writeText(citation(m)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }, () => {}); }}>{copied ? "Copied" : "Copy as a citation"}</button>
          <HowDoWeKnow run={m.key} claim={{ kind: "lever", index: m.lever.i }} />
        </span>
        <button className="st-btn" onClick={onOpen}>Open this turn</button>
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
