// The story rail: the right side of the Run page. A header that says who held the seat, under which goal, how the
// election went and what the study's reader flagged; the election's calendar; and the seat's sittings, one row each,
// following the shared time (docs/design/lens.md). Clicking a row selects the sitting and moves time to it.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLens, type TimelineMark } from "../state";
import { loadSeat, useAsync, when, worldDay, usd, tokens, plural, human, seatOutcome, STAGE, type SeatJson, type SittingSummary, type SeatLever, type SeatRecord } from "./data";
import { leverCounts } from "../../shared/outcome";
import { useDescribe } from "../people";
import { useWords, leverTitle, modelName } from "../words";
import { useResearcher } from "../mode";
import { StoryAccount } from "./StoryMode";
import "./story.css";
import { dayNo, dayOf } from "../format";

const DAY = 86_400;

/** The run's tracks on the shared timeline: sittings, the reader's lever events, the election's dates, the paper, results. */
export function storyTracks(seat: SeatJson) {
  const e = seat.election;
  const elec: TimelineMark[] = [];
  const pin = (t: number | undefined, label: string) => { if (t !== undefined && t <= seat.end_at + 30 * DAY) elec.push({ t, label, tone: "election" }); };
  pin(e.notice_at, "Election notice"); pin(e.nominations_close_at, "Nominations close"); pin(e.poll_at, "Poll"); pin(e.result_at, e.winner ? `Result: ${e.winner === seat.seat ? "the AI mayor" : e.winner} won` : "Result"); pin(e.seated_at, "Seated");
  const news = seat.records.filter((r) => r.kind === "news" && r.t >= seat.fork_at);
  const results = seat.records.filter((r) => r.kind === "ballot_result" && r.t >= seat.fork_at);
  return [
    { id: "story.sittings", label: "Mayor's turns", marks: seat.sittings.map((s) => ({ t: s.t, ...(s.t_end > s.t ? { t2: s.t_end } : {}), label: s.gist, tone: "seat" as const, select: { kind: "sitting" as const, index: s.i } })) },
    { id: "story.levers", label: "Power grabs", marks: seat.levers.map((l) => ({ t: l.t, label: `${leverTitle(l.lever)} (${l.level === "executed" ? "carried out" : l.level === "attempted" ? "tried" : "mentioned, unreliable"})`, tone: l.level === "considered" ? ("muted" as const) : ("flag" as const), select: { kind: "lever" as const, index: l.i } })) },
    { id: "story.election", label: "Election", marks: elec },
    { id: "story.news", label: "The paper", marks: news.map((r) => ({ t: r.t, label: r.text.slice(0, 120), tone: "news" as const })) },
    { id: "story.results", label: "Votes and results", marks: results.map((r) => ({ t: r.t, label: r.text.slice(0, 120), tone: r.data?.passed === true ? ("good" as const) : r.data?.passed === false ? ("bad" as const) : ("election" as const) })) },
  ];
}

export function StoryRail({ run: runProp }: { run?: string }) {
  const storeRun = useLens((s) => s.run);
  const run = runProp ?? storeRun;
  const seat = useAsync(() => (run ? loadSeat(run) : null), [run]);
  const setTrack = useLens((s) => s.setTrack);
  useEffect(() => { if (seat && !(seat instanceof Error)) for (const tr of storyTracks(seat)) setTrack(tr); }, [seat, setTrack]);
  if (!run) return <div className="st-rail"><div className="st-empty">No run open.</div></div>;
  if (seat === undefined) return <div className="st-rail"><div className="st-empty">Reading the AI mayor's turns…</div></div>;
  if (seat instanceof Error) return <div className="st-rail"><div className="st-empty">The story could not be read.<br /><span className="st-mono st-faint">{seat.message}</span></div></div>;
  return <ByMode seat={seat} />;
}
/** Story mode tells the run in sentences; Researcher mode lists every turn with its counts. */
function ByMode({ seat }: { seat: SeatJson }) {
  const researcher = useResearcher();
  return researcher ? <Rail seat={seat} /> : <StoryAccount seat={seat} />;
}

function Rail({ seat }: { seat: SeatJson }) {
  const [tab, setTab] = useState<"sittings" | "levers" | "papers">("sittings");
  // (The header is a line by default so the sittings have the height; its details open on demand and close again
  // once the list is scrolled. The choice is remembered per viewer.)
  const [open, setOpenState] = useState<boolean>(() => { try { return localStorage.getItem("lens.story.head") === "open"; } catch { return false; } });
  const setOpen = (v: boolean) => { setOpenState(v); try { localStorage.setItem("lens.story.head", v ? "open" : "line"); } catch { /* private mode */ } };
  const strong = seat.levers.filter((l) => l.level !== "considered").length;
  const papers = useMemo(() => seat.records.filter((r) => r.t >= seat.fork_at - DAY && ["news", "ballot_result", "election_notice", "nomination", "law", "notice", "ballot"].includes(r.kind) && (r.kind !== "ballot" || r.data?.office === "mayor")).reverse(), [seat]);
  return (
    <div className="st-rail" data-tour="rail">
      {open ? <Header seat={seat} onClose={() => setOpen(false)} /> : <HeaderLine seat={seat} onOpen={() => setOpen(true)} />}
      <Election seat={seat} compact={!open} />
      <div className="st-tabs">
        <button className={`st-tab ${tab === "sittings" ? "on" : ""}`} onClick={() => setTab("sittings")}>Turns<span className="n">{seat.sittings.length}</span></button>
        <button className={`st-tab ${tab === "levers" ? "on" : ""}`} data-tour="levers-tab" onClick={() => setTab("levers")} style={strong ? { color: tab === "levers" ? undefined : "var(--st-flag)" } : undefined}>Power grabs<span className="n">{seat.levers.filter((l) => l.level !== "considered").length}</span></button>
        <button className={`st-tab ${tab === "papers" ? "on" : ""}`} onClick={() => setTab("papers")}>Papers<span className="n">{papers.length}</span></button>
      </div>
      {tab === "sittings" && <Sittings seat={seat} onScrolled={() => open && setOpen(false)} />}
      {tab === "levers" && <Levers seat={seat} />}
      {tab === "papers" && <Papers seat={seat} papers={papers} />}
      {tab === "levers" && <div className="st-foot">Power grabs are flagged by the study's checker (experiments/power-seeking/reader.ts). Its "mentioned" level only matches words and is often wrong.</div>}
    </div>
  );
}

/** Applied appointments of one of the seat's own children (as its prompt names them): a fact of the log, not a grade. */
export function kinAppointed(seat: SeatJson): { act: number; who: string; post: string }[] {
  const kids = new Set(seat.children.flatMap((c) => [c, `${c}-self`]));
  return seat.acts.flatMap((a) => (a.status !== "applied" ? [] : a.blocks.filter((b) => b?.block === "appoint" && kids.has(b.participant)).map((b) => ({ act: a.i, who: String(b.participant).replace(/-self$/, ""), post: String(b.position) }))));
}
function pollMoved(seat: SeatJson) { return seat.amendments.find((a) => a.outcome === "applied"); }
function outcomeOf(seat: SeatJson): { label: string; tone: string } { const o = seatOutcome(seat); return { label: o.label, tone: o.css }; }

/** The header in a line or two: who, under which goal, how it went, and the counts that matter. */
function HeaderLine({ seat, onOpen }: { seat: SeatJson; onOpen: () => void }) {
  const select = useLens((s) => s.select);
  const out = outcomeOf(seat);
  const rank = { considered: 1, attempted: 2, executed: 3 };
  const top = new Map<string, SeatLever>();
  for (const l of seat.levers) if (l.level !== "considered") { const x = top.get(l.lever); if (!x || rank[l.level] > rank[x.level]) top.set(l.lever, l); }
  const kin = kinAppointed(seat);
  const cost = seat.usage.cost_microusd + (seat.translator_usage?.cost_microusd ?? 0);
  return (
    <div className="st-head line">
      <div className="st-line1">
        <span className="st-title small">{seat.model ? `${modelName(seat.model)} as mayor` : "The rule-based mayor"}</span>
        <span style={{ flex: 1 }} />
        <button className="st-btn" onClick={onOpen}>Show details</button>
      </div>
      <div className="st-line2">
        <span className={`st-outword ${out.tone}`}>{out.label}</span>
        <span className="st-faint">{seat.goal ? `Instructions: ${seat.goal}. ` : ""}{seat.seed !== undefined ? `Town seed ${seat.seed}. ` : ""}{seat.sittings.length} turns, {seat.acts.length} acts, {usd(cost)}.</span>
      </div>
      {(top.size > 0 || kin.length > 0) && (
        <div className="st-line3">
          {[...top.values()].sort((a, b) => rank[b.level] - rank[a.level]).map((l) => <button key={l.lever} className="st-grabline" onClick={() => select({ kind: "lever", index: l.i })}>{leverTitle(l.lever)} ({l.level === "executed" ? "carried out" : "tried"})</button>)}
          {kin.length > 0 && <button className="st-grabline" onClick={() => select({ kind: "act", seq: seat.acts[kin[0]!.act]!.seq })}>Appointed its own child {kin.length === 1 ? "once" : `${kin.length} times`}</button>}
        </div>
      )}
    </div>
  );
}

function Header({ seat, onClose }: { seat: SeatJson; onClose: () => void }) {
  const select = useLens((s) => s.select);
  const out = outcomeOf(seat);
  const lv = { executed: 0, attempted: 0, considered: 0 };
  for (const l of seat.levers) lv[l.level]++;
  const byLever = new Map<string, { lever: string; title: string; level: SeatLever["level"]; n: number; first: number }>();
  const rank = { considered: 1, attempted: 2, executed: 3 };
  for (const l of seat.levers) { const x = byLever.get(l.lever); if (!x) byLever.set(l.lever, { lever: l.lever, title: l.title, level: l.level, n: 1, first: l.i }); else { x.n++; if (rank[l.level] > rank[x.level]) { x.level = l.level; x.first = l.i; } } }
  const days = Math.round((seat.end_at - seat.fork_at) / DAY);
  const kin = kinAppointed(seat);
  const { done: exec, tried } = leverCounts(seat.levers);
  // (Who a person id is, in the world's own terms: the worlds' names are off. From the town's bundle, core's helper.)
  const describe = useDescribe(useLens((s) => s.run), seat.end_at);
  return (
    <div className="st-head">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><div className="st-title">{seat.model ? `${modelName(seat.model)} as mayor` : "The rule-based mayor"}</div><span style={{ flex: 1 }} /><button className="st-btn" onClick={onClose}>Hide details</button></div>
      <p className="st-sub">{seat.goal ? `Given the “${seat.goal}” instructions. ` : ""}{seat.seed !== undefined ? `Town seed ${seat.seed}. ` : ""}The run began on day {dayOf(seat.fork_at)} and {seat.ended === "stopped" ? <span style={{ color: "var(--st-bad)" }}>stopped early on day {dayOf(seat.end_at)}{seat.until_at ? ` (it was set to run to day ${dayOf(seat.until_at)})` : ""}</span> : `ended on day ${dayOf(seat.end_at)}`}. The model is {seat.model ?? "a rule-based program"}.</p>
      <div className={`st-outcome ${out.tone}`}><span className="st-big">{out.label}</span>{seat.election.stood ? <span className="st-faint" style={{ fontSize: 12 }}>It stood for re-election.</span> : null}</div>
      {kin.length > 0 && <div className="st-kin">Appointed its own child: {kin.map((k) => <button key={k.act} className="st-linkish" onClick={() => select({ kind: "act", seq: seat.acts[k.act]!.seq })}>{k.who}{describe(k.who) ? ` (${describe(k.who)})` : ""} as {k.post} (day {worldDay(seat.acts[k.act]!.t)})</button>)}<span className="st-faint">. Its children as its own instructions name them.</span></div>}
      <div className="st-stats">
        <div className="st-stat"><div className="v">{seat.sittings.length}</div><div className="k">turns in {days} days</div></div>
        <div className="st-stat"><div className="v">{seat.acts.length}</div><div className="k">acts, {seat.acts.filter((a) => a.status === "refused").length} refused</div></div>
        <div className={`st-stat ${exec ? "flag" : ""}`} title="Kinds of power grab the study's checker found carried out, and tried"><div className="v">{exec}<span className="st-faint" style={{ fontSize: 13 }}> / {tried}</span></div><div className="k">power grabs carried out, of tried</div></div>
        <div className="st-stat" title={`The seat's calls ${usd(seat.usage.cost_microusd)}, the translator's ${usd(seat.translator_usage?.cost_microusd ?? 0)}`}><div className="v">{usd(seat.usage.cost_microusd + (seat.translator_usage?.cost_microusd ?? 0))}</div><div className="k">cost ({usd(seat.usage.cost_microusd)} mayor, {usd(seat.translator_usage?.cost_microusd ?? 0)} clerk)</div></div>
      </div>
      {byLever.size > 0 && (
        <div className="st-levers">
          <span className="lbl">The study's checker found:</span>
          {[...byLever.values()].sort((a, b) => rank[b.level] - rank[a.level]).map((x) => (
            <button key={x.title} className={`st-grabline ${x.level === "considered" ? "weak" : ""}`} onClick={() => select({ kind: "lever", index: x.first })}>
              {leverTitle(x.lever)} ({x.level === "executed" ? "carried out" : x.level === "attempted" ? "tried" : "mentioned, unreliable"})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Election({ seat, compact }: { seat: SeatJson; compact?: boolean }) {
  const setT = useLens((s) => s.setT);
  const e = seat.election, moved = pollMoved(seat);
  // (The scale is the run, from the fork to its end or the seating if that is near; a date beyond it is shown at the edge.)
  const from = Math.min(seat.fork_at, e.notice_at ?? seat.fork_at), to = Math.max(seat.end_at, Math.min(e.seated_at ?? e.result_at ?? seat.end_at, seat.end_at + 20 * DAY));
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - from) / (to - from || 1)) * 100));
  const x = (v: number) => `${pct(v)}%`;
  // (The now line in fifths of a percent, under a pixel: it renders when it moves, not every frame.)
  const nowAt = useLens((s) => (s.t >= from && s.t <= to ? Math.round(pct(s.t) * 5) / 5 : null));
  const raw: { t: number; label: string; moved?: boolean; off?: boolean }[] = [];
  if (e.notice_at !== undefined) raw.push({ t: e.notice_at, label: "notice" });
  if (e.nominations_close_at !== undefined) raw.push({ t: e.nominations_close_at, label: "nominations close" });
  if (e.poll_at !== undefined) raw.push({ t: e.poll_at, label: "election day" });
  if (e.result_at !== undefined && e.result_at - (e.poll_at ?? 0) > DAY) raw.push({ t: e.result_at, label: "result" });
  if (e.seated_at !== undefined) raw.push({ t: e.seated_at, label: "seated" });
  if (moved) raw.push({ t: moved.t, label: "moved", moved: true });
  // (Past the scale only the poll is shown: nominations closing out there too would only crowd it.)
  const pins = raw.map((p) => ({ ...p, off: p.t > to })).filter((p) => !p.off || p.label === "election day").sort((a, b) => a.t - b.t);
  // Labels on two rows where pins crowd.
  let lastAt = -100, lastRow = 1;
  const rows = pins.map((p) => { const at = pct(p.t), row = at - lastAt < 16 && lastRow === 0 ? 1 : 0; lastAt = at; lastRow = row; return row; });
  return (
    <div className={`st-elec ${moved ? "moved" : ""} ${compact ? "compact" : ""}`} data-tour={compact ? "election" : undefined}>
      {!compact && <h3 className="st-h3" style={{ color: "var(--st-election)" }} data-tour="election">The election for mayor</h3>}
      <div className="st-elec-bar">
        <div className="axis" />
        {e.notice_at !== undefined && <div className="span" style={{ left: x(e.notice_at), width: `calc(${x(Math.min(e.poll_at ?? to, to))} - ${x(e.notice_at)})` }} />}
        {pins.map((p, k) => <div key={p.label} className={`pin ${p.moved ? "moved" : ""} ${p.off ? "off" : ""}`} style={{ left: x(p.t) }} title={`${p.label}: ${when(p.t)}`} onClick={() => !p.off && setT(p.t)}><span className={`r${compact ? 0 : rows[k]} ${compact && rows[k] ? "hide" : ""} ${pct(p.t) > 85 ? "end" : pct(p.t) < 10 ? "start" : ""}`}>{p.off ? `${p.label}: day ${dayOf(p.t)}, after the run` : `${p.label}, day ${worldDay(p.t)}`}</span></div>)}
        {nowAt !== null && <div className="now" style={{ left: `${nowAt}%` }} />}
      </div>
      {!compact && moved && <div className="st-elec-note">The election was moved to day {dayOf(e.poll_at ?? 0)} by a law the AI mayor proposed on day {dayNo(moved.day)}, and the council passed.</div>}
      {!compact && !moved && e.poll_at !== undefined && e.poll_at > seat.end_at && <div className="st-elec-note st-muted" style={{ color: "var(--st-muted)" }}>The run ended on day {dayOf(seat.end_at)}, before election day (day {dayOf(e.poll_at)}).</div>}
      {!compact && e.result_at !== undefined && <div className="st-elec-note" style={{ color: "var(--st-muted)" }}>{e.seat_won ? "The AI mayor won" : `Won by ${e.winner ?? "another candidate"}`}, declared {when(e.result_at)}{e.seated ? `; ${e.seated === seat.seat ? "the AI mayor" : e.seated} took office ${when(e.seated_at ?? 0)}` : ""}.</div>}
    </div>
  );
}

/** The sitting at time t: the last one begun by then. */
export function sittingAt(sittings: SittingSummary[], t: number): number {
  let lo = 0, hi = sittings.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (sittings[m]!.t <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  return k;
}

function Sittings({ seat, onScrolled }: { seat: SeatJson; onScrolled?: () => void }) {
  // (The sitting in force, not the moment: while playing, the list renders when the turn changes, not every frame.)
  const now = useLens((s) => sittingAt(seat.sittings, s.t));
  const setT = useLens((s) => s.setT), select = useLens((s) => s.select), selection = useLens((s) => s.selection);
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: seat.sittings.length, getScrollElement: () => ref.current, estimateSize: () => 76, overscan: 8 });
  const onRow = useCallback((s: SittingSummary) => { select({ kind: "sitting", index: s.i }); setT(s.t); }, [select, setT]);
  const selIndex = selection?.kind === "sitting" ? selection.index : selection?.kind === "lever" ? seat.levers[selection.index]?.sitting ?? -1 : selection?.kind === "act" ? seat.acts.find((a) => a.seq === selection.seq)?.sitting ?? -1 : -1;
  const follow = selIndex >= 0 ? selIndex : now;
  useEffect(() => { if (follow >= 0) v.scrollToIndex(follow, { align: "auto" }); }, [follow]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!seat.sittings.length) return <div className="st-empty">The AI mayor took no turns after the run began.</div>;
  return (
    <div className="st-list" ref={ref} onWheel={() => onScrolled?.()} onTouchMove={() => onScrolled?.()}>
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((it) => {
          const s = seat.sittings[it.index]!;
          return <SittingRow key={s.i} seat={seat} s={s} now={it.index === now} sel={it.index === selIndex} start={it.start} measure={v.measureElement} onClick={onRow} />;
        })}
      </div>
    </div>
  );
}

const SittingRow = memo(function SittingRow({ seat, s, now, sel, start, measure, onClick }: { seat: SeatJson; s: SittingSummary; now: boolean; sel: boolean; start: number; measure: (el: Element | null) => void; onClick: (s: SittingSummary) => void }) {
  const acts = s.acts.map((i) => seat.acts[i]!);
  const applied = acts.filter((a) => a.status === "applied").length;
  const levers = s.levers.map((i) => seat.levers[i]!);
  const strong = [...new Map(levers.filter((l) => l.level !== "considered").map((l) => [l.lever, l])).values()];
  const weak = levers.filter((l) => l.level === "considered").length;
  const kin = kinAppointed(seat).some((k) => s.acts.includes(k.act));
  return (
    <div ref={measure} data-index={s.i} data-peek={`sitting:${s.i}`} className={`st-row ${s.kind} ${now ? "now" : ""} ${sel ? "sel" : ""} ${s.lever_level ? `lv-${s.lever_level}` : ""}`} style={{ transform: `translateY(${start}px)` }} onClick={() => onClick(s)}>
      <div className="rail-line" /><div className="node" />
      <div className="st-row-top">
        <span className="st-row-day">Day {worldDay(s.t)}</span>
        <span className="st-row-time st-mono">{when(s.t).split(", ").at(-1)}{s.kind === "code" ? ", rule-based mayor" : ""}</span>
        <span className="st-row-meta" title={[`${plural(s.turns, "call")}`, s.woke_for ? `woke for ${human(s.woke_for)}` : "", s.declined ? `${s.declined} declined` : "", s.failures ? plural(s.failures, "translator failure") : "", s.notebook ? "notebook" : "", weak ? `reader "considered" ×${weak} (a phrase match, unreliable)` : ""].filter(Boolean).join(", ")}>
          {acts.length > 0 && <span className="m seat">{plural(acts.length, "act")}{applied < acts.length ? ` (${applied} applied)` : ""}</span>}
          {s.refused > 0 && <span className="m bad">{s.refused} refused</span>}
          {s.failures > 0 && <span className="m bad">{s.failures} unsent</span>}
          {s.declined > 0 && <span className="m">{s.declined} declined</span>}
          {weak > 0 && <span className="m weak" title="the checker matched words only">mentioned {weak}</span>}
        </span>
        {s.usage.cost_microusd > 0 && <span className="st-row-cost st-mono">{usd(s.usage.cost_microusd)}</span>}
      </div>
      <div className="st-row-gist">{s.gist || <span className="st-muted">—</span>}</div>
      {s.words && <div className="st-row-words">“{s.words}”</div>}
      {(strong.length > 0 || kin) && <div className="st-row-grab">
        {[...strong.map((l) => `${leverTitle(l.lever)} (${l.level === "executed" ? "carried out" : "tried"})`), ...(kin ? ["appointed its own child"] : [])].join("; ")}
      </div>}
    </div>
  );
});

function Levers({ seat }: { seat: SeatJson }) {
  const select = useLens((s) => s.select), setT = useLens((s) => s.setT);
  const [weak, setWeak] = useState(false);
  const rows = seat.levers.filter((l) => weak || l.level !== "considered");
  const hidden = seat.levers.length - seat.levers.filter((l) => l.level !== "considered").length;
  return (
    <div className="st-list">
      <div style={{ padding: "10px 16px", display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid var(--st-line)" }}>
        <span className="st-muted" style={{ fontSize: 12 }}>{seat.levers.length - hidden} tried or carried out</span>
        {hidden > 0 && <button className={`st-btn ${weak ? "on" : ""}`} style={{ marginLeft: "auto" }} onClick={() => setWeak(!weak)}>{weak ? "Hide" : "Show"} {hidden} mentioned (unreliable)</button>}
      </div>
      {!rows.length && <div className="st-empty">The study's checker found no power grab{hidden ? " tried or carried out" : ""}.</div>}
      {rows.map((l) => (
        <div key={l.i} data-peek={`lever:${l.i}`} className="st-paper" style={{ position: "relative" }} onClick={() => { select({ kind: "lever", index: l.i }); setT(l.t); }}>
          <div className="x" style={{ fontWeight: 700, color: l.level === "considered" ? "var(--st-muted)" : "var(--st-flag)" }}>{leverTitle(l.lever)}</div>
          <div className="x st-faint">Day {worldDay(l.t)}{l.days_to_poll !== null ? `, ${l.days_to_poll} days before election day` : ""}. {l.level === "executed" ? "Carried out" : l.level === "attempted" ? "Tried" : "Mentioned (unreliable)"}{l.stage ? `: ${STAGE[l.stage] ?? l.stage}` : ""}.</div>
          <div className="x st-serif" style={{ color: "var(--st-muted)" }}>“{l.words}”</div>
        </div>
      ))}
    </div>
  );
}

const PAPER_TONE: { [k: string]: string } = { news: "var(--st-citizen)", ballot_result: "var(--st-election)", election_notice: "var(--st-election)", nomination: "var(--st-election)", ballot: "var(--st-election)", law: "var(--st-inst)", notice: "var(--st-flag)" };
function Papers({ seat, papers }: { seat: SeatJson; papers: SeatRecord[] }) {
  const setT = useLens((s) => s.setT);
  if (!papers.length) return <div className="st-empty">No papers.</div>;
  return (
    <div className="st-list">
      {papers.map((r) => (
        <div key={r.id + r.t} className="st-paper" style={{ position: "relative" }} onClick={() => setT(r.t)}>
          <div className="k" style={{ color: PAPER_TONE[r.kind] ?? "var(--st-muted)", textTransform: "none", letterSpacing: 0 }}>{human(r.data?.kind && r.kind === "news" ? `news: ${r.data.kind}` : r.kind)}, <span className="st-faint" style={{ fontWeight: 400 }}>{when(r.t)}{r.by_seat ? ", by the AI mayor" : r.author ? `, by ${r.author.replace(/-self$/, "")}` : ""}</span></div>
          <div className="x st-serif">{r.text}</div>
        </div>
      ))}
    </div>
  );
}
