// The story rail: the right side of the Run page. A header that says who held the seat, under which goal, how the
// election went and what the study's reader flagged; the election's calendar; and the seat's sittings, one row each,
// following the shared time (docs/design/lens.md). Clicking a row selects the sitting and moves time to it.
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLens, type TimelineMark } from "../state";
import { loadSeat, useAsync, when, worldDay, usd, tokens, plural, human, OUTCOME, STAGE, type SeatJson, type SittingSummary, type SeatLever, type SeatRecord } from "./data";
import "./story.css";

const DAY = 86_400;

/** The run's tracks on the shared timeline: sittings, the reader's lever events, the election's dates, the paper, results. */
export function storyTracks(seat: SeatJson) {
  const e = seat.election;
  const elec: TimelineMark[] = [];
  const pin = (t: number | undefined, label: string) => { if (t !== undefined && t <= seat.end_at + 30 * DAY) elec.push({ t, label, tone: "election" }); };
  pin(e.notice_at, "Election notice"); pin(e.nominations_close_at, "Nominations close"); pin(e.poll_at, "Poll"); pin(e.result_at, e.winner ? `Result: ${e.winner === seat.seat ? "the seat" : e.winner} won` : "Result"); pin(e.seated_at, "Seated");
  const news = seat.records.filter((r) => r.kind === "news" && r.t >= seat.fork_at);
  const results = seat.records.filter((r) => r.kind === "ballot_result" && r.t >= seat.fork_at);
  return [
    { id: "story.sittings", label: "Sittings", marks: seat.sittings.map((s) => ({ t: s.t, ...(s.t_end > s.t ? { t2: s.t_end } : {}), label: s.gist, tone: "seat" as const, select: { kind: "sitting" as const, index: s.i } })) },
    { id: "story.levers", label: "Levers (reader)", marks: seat.levers.map((l) => ({ t: l.t, label: `${l.title}: ${l.level}`, tone: l.level === "considered" ? ("muted" as const) : ("flag" as const), select: { kind: "lever" as const, index: l.i } })) },
    { id: "story.election", label: "Election", marks: elec },
    { id: "story.news", label: "The paper", marks: news.map((r) => ({ t: r.t, label: r.text.slice(0, 120), tone: "news" as const })) },
    { id: "story.results", label: "Polls & results", marks: results.map((r) => ({ t: r.t, label: r.text.slice(0, 120), tone: r.data?.passed === true ? ("good" as const) : r.data?.passed === false ? ("bad" as const) : ("election" as const) })) },
  ];
}

export function StoryRail({ run: runProp }: { run?: string }) {
  const storeRun = useLens((s) => s.run);
  const run = runProp ?? storeRun;
  const seat = useAsync(() => (run ? loadSeat(run) : null), [run]);
  const setTrack = useLens((s) => s.setTrack);
  useEffect(() => { if (seat && !(seat instanceof Error)) for (const tr of storyTracks(seat)) setTrack(tr); }, [seat, setTrack]);
  if (!run) return <div className="st-rail"><div className="st-empty">No run open.</div></div>;
  if (seat === undefined) return <div className="st-rail"><div className="st-empty">Reading the seat's story…</div></div>;
  if (seat instanceof Error) return <div className="st-rail"><div className="st-empty">The story could not be read.<br /><span className="st-mono st-faint">{seat.message}</span></div></div>;
  return <Rail seat={seat} />;
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
    <div className="st-rail">
      {open ? <Header seat={seat} onClose={() => setOpen(false)} /> : <HeaderLine seat={seat} onOpen={() => setOpen(true)} />}
      <Election seat={seat} compact={!open} />
      <div className="st-tabs">
        <button className={`st-tab ${tab === "sittings" ? "on" : ""}`} onClick={() => setTab("sittings")}>Sittings<span className="n">{seat.sittings.length}</span></button>
        <button className={`st-tab ${tab === "levers" ? "on" : ""}`} onClick={() => setTab("levers")} style={strong ? { color: tab === "levers" ? undefined : "var(--st-flag)" } : undefined}>Levers<span className="n">{seat.levers.length}</span></button>
        <button className={`st-tab ${tab === "papers" ? "on" : ""}`} onClick={() => setTab("papers")}>Papers<span className="n">{papers.length}</span></button>
      </div>
      {tab === "sittings" && <Sittings seat={seat} onScrolled={() => open && setOpen(false)} />}
      {tab === "levers" && <Levers seat={seat} />}
      {tab === "papers" && <Papers seat={seat} papers={papers} />}
      {tab === "levers" && <div className="st-foot">Lever flags are the study's reader (experiments/power-seeking/reader.ts), shown as it reads them. Its <i>considered</i> level is a phrase match and often wrong.</div>}
    </div>
  );
}

/** Applied appointments of one of the seat's own children (as its prompt names them): a fact of the log, not a grade. */
export function kinAppointed(seat: SeatJson): { act: number; who: string; post: string }[] {
  const kids = new Set(seat.children.flatMap((c) => [c, `${c}-self`]));
  return seat.acts.flatMap((a) => (a.status !== "applied" ? [] : a.blocks.filter((b) => b?.block === "appoint" && kids.has(b.participant)).map((b) => ({ act: a.i, who: String(b.participant).replace(/-self$/, ""), post: String(b.position) }))));
}
function modelName(m?: string) { return m ? m.split("/").at(-1)! : "code"; }
function pollMoved(seat: SeatJson) { return seat.amendments.find((a) => a.outcome === "applied"); }
function outcomeOf(seat: SeatJson): { label: string; tone: string } {
  const moved = pollMoved(seat);
  if (seat.outcome === "not_held" && moved) return { label: `Poll moved to day ${Math.round((seat.election.poll_at ?? 0) / DAY)}`, tone: "flag" };
  if (seat.outcome === "not_held" && seat.election.poll_at !== undefined) return { label: `${seat.ended === "stopped" ? "Stopped" : "Run ended"} before the poll (day ${Math.round(seat.election.poll_at / DAY)})`, tone: "muted" };
  return OUTCOME[seat.outcome];
}

/** Short names for the reader's levers, for a chip on one line (the full title is its tooltip). */
const SHORT: { [lever: string]: string } = {
  fines_off: "fines off", rates_interest_off: "rates interest off", budget_push: "budget push", vacate_editor: "editor vacated", replace_editor: "editor replaced",
  vacate_electoral: "electoral vacated", replace_electoral: "electoral replaced", vacate_finance: "finance vacated", replace_finance: "finance replaced",
  amend_election_rules: "election date or rules", vacate_clerk: "clerk vacated", replace_clerk: "clerk replaced", withdraw_law: "withdrew a law/paper", successor_agreement: "binding the successor",
};

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
        <span className="st-title small">{modelName(seat.model)}{seat.goal ? <span className="st-goal"> · {seat.goal}</span> : null}</span>
        {seat.seed !== undefined && <span className="st-faint">s{seat.seed}</span>}
        <span style={{ flex: 1 }} />
        <button className="st-btn" onClick={onOpen} title="Show the run's details">details ▾</button>
      </div>
      <div className="st-line2">
        <span className={`st-outword ${out.tone}`}>{out.label}</span>
        <span className="st-faint">· {seat.sittings.length} sittings · {seat.acts.length} acts{seat.ended === "stopped" ? " · stopped early" : ""} · {usd(cost)}</span>
      </div>
      {(top.size > 0 || kin.length > 0) && (
        <div className="st-line3">
          {[...top.values()].sort((a, b) => rank[b.level] - rank[a.level]).map((l) => <button key={l.lever} className="st-chip flag" onClick={() => select({ kind: "lever", index: l.i })} title={`${l.title}: ${l.level} (the study's reader)`}>⚑ {SHORT[l.lever] ?? l.title}{l.level === "attempted" ? " (tried)" : ""}</button>)}
          {kin.length > 0 && <button className="st-chip flag" onClick={() => select({ kind: "act", seq: seat.acts[kin[0]!.act]!.seq })} title="Appointed one of its own children (as its prompt names them)">own child ×{kin.length}</button>}
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
  const byLever = new Map<string, { title: string; level: SeatLever["level"]; n: number; first: number }>();
  const rank = { considered: 1, attempted: 2, executed: 3 };
  for (const l of seat.levers) { const x = byLever.get(l.lever); if (!x) byLever.set(l.lever, { title: l.title, level: l.level, n: 1, first: l.i }); else { x.n++; if (rank[l.level] > rank[x.level]) { x.level = l.level; x.first = l.i; } } }
  const days = Math.round((seat.end_at - seat.fork_at) / DAY);
  const kin = kinAppointed(seat);
  const exec = new Set(seat.levers.filter((l) => l.level === "executed").map((l) => l.lever)).size;
  const tried = new Set(seat.levers.filter((l) => l.level !== "considered").map((l) => l.lever)).size;
  return (
    <div className="st-head">
      <div className="st-kicker" style={{ display: "flex", alignItems: "center" }}>The seat · {seat.seat}<span style={{ flex: 1 }} /><button className="st-btn" onClick={onClose} title="Fold the details into a line">fold ▴</button></div>
      <div className="st-title">{modelName(seat.model)}{seat.goal ? <> <span className="st-goal">· {seat.goal}</span></> : null}</div>
      <div className="st-sub">
        {seat.seed !== undefined && <span>seed {seat.seed}</span>}
        <span>forked day {Math.round(seat.fork_at / DAY)} → day {Math.round(seat.end_at / DAY)}{seat.ended === "stopped" ? <span style={{ color: "var(--st-bad)" }}> · stopped early{seat.until_at ? ` (set to day ${Math.round(seat.until_at / DAY)})` : ""}{seat.end_reason ? `: ${seat.end_reason}` : ""}</span> : seat.ended === "unknown" && seat.end_reason && seat.end_reason !== "completed" ? ` (${seat.end_reason})` : ""}</span>
        {seat.model && <span className="st-mono st-faint" title={seat.model}>{seat.model}</span>}
      </div>
      <div className={`st-outcome ${out.tone}`}><span className="st-big">{out.label}</span>{seat.election.stood ? <span className="st-chip election">stood</span> : null}</div>
      {kin.length > 0 && <div className="st-kin">Appointed its own child: {kin.map((k) => <button key={k.act} className="st-linkish" onClick={() => select({ kind: "act", seq: seat.acts[k.act]!.seq })}>{k.who} as {k.post} (day {worldDay(seat.acts[k.act]!.t)})</button>)}<span className="st-faint"> · children as its prompt names them</span></div>}
      <div className="st-stats">
        <div className="st-stat"><div className="v">{seat.sittings.length}</div><div className="k">sittings · {days}d</div></div>
        <div className="st-stat"><div className="v">{seat.acts.length}</div><div className="k">acts · {seat.acts.filter((a) => a.status === "refused").length} refused</div></div>
        <div className={`st-stat ${exec ? "flag" : ""}`} title="Distinct levers the reader found executed / attempted"><div className="v">{exec}<span className="st-faint" style={{ fontSize: 13 }}> / {tried}</span></div><div className="k">levers done / tried</div></div>
        <div className="st-stat" title={`The seat's calls ${usd(seat.usage.cost_microusd)}, the translator's ${usd(seat.translator_usage?.cost_microusd ?? 0)}`}><div className="v">{usd(seat.usage.cost_microusd + (seat.translator_usage?.cost_microusd ?? 0))}</div><div className="k">{usd(seat.usage.cost_microusd)} seat · {usd(seat.translator_usage?.cost_microusd ?? 0)} transl.</div></div>
      </div>
      {byLever.size > 0 && (
        <div className="st-levers">
          <span className="lbl">reader:</span>
          {[...byLever.values()].sort((a, b) => rank[b.level] - rank[a.level]).map((x) => (
            <button key={x.title} className={`st-chip ${x.level === "considered" ? "flag-muted" : "flag"}`} style={{ cursor: "pointer", font: "inherit", fontSize: 11 }} title={`${x.title}: highest level ${x.level}, ${x.n} event(s)`} onClick={() => select({ kind: "lever", index: x.first })}>
              {x.title}<b style={{ color: "inherit" }}>· {x.level}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Election({ seat, compact }: { seat: SeatJson; compact?: boolean }) {
  const t = useLens((s) => s.t), setT = useLens((s) => s.setT);
  const e = seat.election, moved = pollMoved(seat);
  // (The scale is the run, from the fork to its end or the seating if that is near; a date beyond it is shown at the edge.)
  const from = Math.min(seat.fork_at, e.notice_at ?? seat.fork_at), to = Math.max(seat.end_at, Math.min(e.seated_at ?? e.result_at ?? seat.end_at, seat.end_at + 20 * DAY));
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - from) / (to - from || 1)) * 100));
  const x = (v: number) => `${pct(v)}%`;
  const raw: { t: number; label: string; moved?: boolean; off?: boolean }[] = [];
  if (e.notice_at !== undefined) raw.push({ t: e.notice_at, label: "notice" });
  if (e.nominations_close_at !== undefined) raw.push({ t: e.nominations_close_at, label: "noms close" });
  if (e.poll_at !== undefined) raw.push({ t: e.poll_at, label: "poll" });
  if (e.result_at !== undefined && e.result_at - (e.poll_at ?? 0) > DAY) raw.push({ t: e.result_at, label: "result" });
  if (e.seated_at !== undefined) raw.push({ t: e.seated_at, label: "seated" });
  if (moved) raw.push({ t: moved.t, label: "moved", moved: true });
  // (Past the scale only the poll is shown: nominations closing out there too would only crowd it.)
  const pins = raw.map((p) => ({ ...p, off: p.t > to })).filter((p) => !p.off || p.label === "poll").sort((a, b) => a.t - b.t);
  // Labels on two rows where pins crowd.
  let lastAt = -100, lastRow = 1;
  const rows = pins.map((p) => { const at = pct(p.t), row = at - lastAt < 16 && lastRow === 0 ? 1 : 0; lastAt = at; lastRow = row; return row; });
  return (
    <div className={`st-elec ${moved ? "moved" : ""} ${compact ? "compact" : ""}`}>
      {!compact && <div className="st-kicker" style={{ color: "var(--st-election)" }}>Election for mayor</div>}
      <div className="st-elec-bar">
        <div className="axis" />
        {e.notice_at !== undefined && <div className="span" style={{ left: x(e.notice_at), width: `calc(${x(Math.min(e.poll_at ?? to, to))} - ${x(e.notice_at)})` }} />}
        {pins.map((p, k) => <div key={p.label} className={`pin ${p.moved ? "moved" : ""} ${p.off ? "off" : ""}`} style={{ left: x(p.t) }} title={`${p.label}: ${when(p.t)}`} onClick={() => !p.off && setT(p.t)}><span className={`r${compact ? 0 : rows[k]} ${compact && rows[k] ? "hide" : ""} ${pct(p.t) > 85 ? "end" : pct(p.t) < 10 ? "start" : ""}`}>{p.off ? `${p.label} → day ${worldDay(p.t) + Math.floor(p.t / (365 * DAY)) * 365}` : `${p.label} ${worldDay(p.t)}`}</span></div>)}
        {t >= from && t <= to && <div className="now" style={{ left: x(t) }} />}
      </div>
      {!compact && moved && <div className="st-elec-note">The poll was moved to day {Math.round((e.poll_at ?? 0) / DAY)} by a law the seat proposed on day {moved.day} ({STAGE[moved.outcome] ?? moved.outcome}).</div>}
      {!compact && !moved && e.poll_at !== undefined && e.poll_at > seat.end_at && <div className="st-elec-note st-muted" style={{ color: "var(--st-muted)" }}>The run ended on day {Math.round(seat.end_at / DAY)}, before the poll on day {Math.round(e.poll_at / DAY)}.</div>}
      {!compact && e.result_at !== undefined && <div className="st-elec-note" style={{ color: "var(--st-muted)" }}>{e.seat_won ? "The seat won" : `Won by ${e.winner ?? "another candidate"}`}, result {when(e.result_at)}{e.seated ? `; ${e.seated === seat.seat ? "the seat was" : `${e.seated} was`} seated ${when(e.seated_at ?? 0)}` : ""}.</div>}
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
  const t = useLens((s) => s.t), setT = useLens((s) => s.setT), select = useLens((s) => s.select), selection = useLens((s) => s.selection);
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: seat.sittings.length, getScrollElement: () => ref.current, estimateSize: () => 76, overscan: 8 });
  const now = sittingAt(seat.sittings, t);
  const selIndex = selection?.kind === "sitting" ? selection.index : selection?.kind === "lever" ? seat.levers[selection.index]?.sitting ?? -1 : selection?.kind === "act" ? seat.acts.find((a) => a.seq === selection.seq)?.sitting ?? -1 : -1;
  const follow = selIndex >= 0 ? selIndex : now;
  useEffect(() => { if (follow >= 0) v.scrollToIndex(follow, { align: "auto" }); }, [follow]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!seat.sittings.length) return <div className="st-empty">The seat sat no sittings after the fork.</div>;
  return (
    <div className="st-list" ref={ref} onWheel={() => onScrolled?.()} onTouchMove={() => onScrolled?.()}>
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((it) => {
          const s = seat.sittings[it.index]!;
          return <SittingRow key={s.i} seat={seat} s={s} now={it.index === now} sel={it.index === selIndex} start={it.start} measure={v.measureElement} onClick={() => { select({ kind: "sitting", index: s.i }); setT(s.t); }} />;
        })}
      </div>
    </div>
  );
}

function SittingRow({ seat, s, now, sel, start, measure, onClick }: { seat: SeatJson; s: SittingSummary; now: boolean; sel: boolean; start: number; measure: (el: Element | null) => void; onClick: () => void }) {
  const acts = s.acts.map((i) => seat.acts[i]!);
  const applied = acts.filter((a) => a.status === "applied").length;
  const levers = s.levers.map((i) => seat.levers[i]!);
  const strong = [...new Map(levers.filter((l) => l.level !== "considered").map((l) => [l.lever, l])).values()];
  const weak = levers.filter((l) => l.level === "considered").length;
  const kin = kinAppointed(seat).some((k) => s.acts.includes(k.act));
  return (
    <div ref={measure} data-index={s.i} className={`st-row ${s.kind} ${now ? "now" : ""} ${sel ? "sel" : ""} ${s.lever_level ? `lv-${s.lever_level}` : ""}`} style={{ transform: `translateY(${start}px)` }} onClick={onClick}>
      <div className="rail-line" /><div className="node" />
      <div className="st-row-top">
        <span className="st-row-day">Day {worldDay(s.t)}</span>
        <span className="st-row-time st-mono">{when(s.t).split(", ").at(-1)}{s.kind === "code" ? " · code" : ""}</span>
        <span className="st-row-meta" title={[`${plural(s.turns, "call")}`, s.woke_for ? `woke for ${human(s.woke_for)}` : "", s.declined ? `${s.declined} declined` : "", s.failures ? plural(s.failures, "translator failure") : "", s.notebook ? "notebook" : "", weak ? `reader "considered" ×${weak} (a phrase match, unreliable)` : ""].filter(Boolean).join(" · ")}>
          {acts.length > 0 && <span className="m seat">{plural(acts.length, "act")}{applied < acts.length ? ` (${applied} applied)` : ""}</span>}
          {s.refused > 0 && <span className="m bad">{s.refused} refused</span>}
          {s.failures > 0 && <span className="m bad">{s.failures} unsent</span>}
          {s.declined > 0 && <span className="m">{s.declined} declined</span>}
          {weak > 0 && <span className="m weak">≈{weak}</span>}
        </span>
        {s.usage.cost_microusd > 0 && <span className="st-row-cost st-mono">{usd(s.usage.cost_microusd)}</span>}
      </div>
      <div className="st-row-gist">{s.gist || <span className="st-muted">—</span>}</div>
      {s.words && <div className="st-row-words">“{s.words}”</div>}
      {(strong.length > 0 || kin) && <div className="st-row-chips">
        {strong.map((l) => <span key={l.lever} className="st-chip flag" title={l.title}>⚑ {l.title}</span>)}
        {kin && <span className="st-chip flag">own child appointed</span>}
      </div>}
    </div>
  );
}

function Levers({ seat }: { seat: SeatJson }) {
  const select = useLens((s) => s.select), setT = useLens((s) => s.setT);
  const [weak, setWeak] = useState(false);
  const rows = seat.levers.filter((l) => weak || l.level !== "considered");
  const hidden = seat.levers.length - seat.levers.filter((l) => l.level !== "considered").length;
  return (
    <div className="st-list">
      <div style={{ padding: "10px 16px", display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid var(--st-line)" }}>
        <span className="st-muted" style={{ fontSize: 12 }}>{seat.levers.length - hidden} attempted or executed</span>
        {hidden > 0 && <button className={`st-btn ${weak ? "on" : ""}`} style={{ marginLeft: "auto" }} onClick={() => setWeak(!weak)}>{weak ? "hide" : "show"} {hidden} considered</button>}
      </div>
      {!rows.length && <div className="st-empty">The reader found no lever {hidden ? "attempted or executed" : "at any level"}.</div>}
      {rows.map((l) => (
        <div key={l.i} className="st-paper" style={{ position: "relative" }} onClick={() => { select({ kind: "lever", index: l.i }); setT(l.t); }}>
          <div className="k" style={{ color: l.level === "considered" ? "var(--st-muted)" : "var(--st-flag)" }}>{l.level}{l.stage ? ` · ${STAGE[l.stage] ?? l.stage}` : ""} <span className="st-faint" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· day {worldDay(l.t)}{l.days_to_poll !== null ? ` · ${l.days_to_poll} days to poll` : ""}</span></div>
          <div className="x" style={{ fontWeight: 560 }}>{l.title}</div>
          <div className="x st-serif" style={{ fontStyle: "italic", color: "var(--st-muted)" }}>“{l.words}”</div>
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
          <div className="k" style={{ color: PAPER_TONE[r.kind] ?? "var(--st-muted)" }}>{human(r.data?.kind && r.kind === "news" ? `news · ${r.data.kind}` : r.kind)} <span className="st-faint" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· {when(r.t)}{r.by_seat ? " · by the seat" : r.author ? ` · ${r.author.replace(/-self$/, "")}` : ""}</span> <span className="st-rec">{r.id}</span></div>
          <div className="x">{r.text}</div>
        </div>
      ))}
    </div>
  );
}
