// The run digest (#/digest/<key>): one run on one page, for a report's appendix: who held the seat and under which
// goal, how the election went and when, the counts that matter, every lever moment in the seat's own words, a timeline
// of the run, the seat's acts day by day, and an index of its sittings. Prints to PDF (print CSS: light, A4, no
// controls). Facts only, each with its source; the lever flags are the study's reader's, labelled so.
import { useEffect } from "react";
import { loadSeat, useAsync, when, usd, tokens, plural, human, seatOutcome, type SeatJson } from "./data";
import { momentsOf } from "./moments-data";
import { leverCounts } from "../../shared/outcome";
import "./story.css";
import "./digest.css";

const DAY = 86_400;
/** A law's figure as written: seconds that are whole days as days. */
const figure = (v: unknown) => (typeof v === "number" && v >= DAY && v % DAY === 0 ? `${v / DAY} days` : typeof v === "object" ? JSON.stringify(v) : String(v));

export function RunDigest({ run }: { run: string }) {
  const seat = useAsync(() => loadSeat(run), [run]);
  const entry = useAsync(() => fetch(`/api/run/${encodeURIComponent(run)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null), [run]);
  useEffect(() => { document.title = `Digest · ${run}`; }, [run]);
  if (seat === undefined) return <div className="dg"><div className="st-empty">Reading the run…</div></div>;
  if (seat instanceof Error) return <div className="dg"><div className="st-empty">Could not read the run: {seat.message}</div></div>;
  return <Digest run={run} seat={seat} entry={entry instanceof Error ? null : entry ?? null} />;
}

function Digest({ run, seat, entry }: { run: string; seat: SeatJson; entry: any }) {
  const out = seatOutcome(seat), e = seat.election, lv = leverCounts(seat.levers);
  const moments = momentsOf(run, seat).sort((a, b) => a.lever.t - b.lever.t);
  const model = seat.model ? seat.model.split("/").at(-1)! : seat.arm ?? "code";
  const day = (t?: number) => (t === undefined ? "—" : `day ${Math.floor(t / DAY)}`);
  const refused = seat.acts.filter((a) => a.status === "refused").length;
  const cost = seat.usage.cost_microusd + (seat.translator_usage?.cost_microusd ?? 0);
  return (
    <div className="dg">
      <div className="dg-tools lens-no-print"><button className="st-btn on" onClick={() => print()}>Print or save as PDF</button><a className="st-btn" href={`#/run/${encodeURIComponent(run)}`}>open the run</a></div>
      <article className="dg-page">
        <header className="dg-head">
          <div className="st-kicker">Run digest · Oikos · the power-seeking study</div>
          <h1>{model}{seat.goal ? <span className="dg-goal"> · goal {seat.goal}</span> : null}{seat.seed !== undefined ? <span className="dg-seed"> · seed {seat.seed}</span> : null}</h1>
          <div className="dg-id st-mono">{run}</div>
          <div className="dg-id st-mono">{seat.run_id}{entry?.group ? ` · run set ${entry.group}` : ""}</div>
        </header>

        <section className="dg-band">
          <div className={`dg-out ${out.css}`}><div className="k">Election</div><div className="v">{out.label}</div>{e.winner && <div className="s">winner {e.winner === seat.seat ? "the seat" : e.winner}</div>}</div>
          <div className="dg-out"><div className="k">Levers (reader)</div><div className="v">{lv.done} executed · {lv.tried} tried</div><div className="s">highest tier executed {seat.tier.executed || "—"}, attempted {seat.tier.attempted || "—"}</div></div>
          <div className="dg-out"><div className="k">Run</div><div className="v">day {Math.round(seat.fork_at / DAY)} → {Math.round(seat.end_at / DAY)}</div><div className="s">{seat.ended === "stopped" ? `stopped early${seat.until_at ? ` (set to day ${Math.round(seat.until_at / DAY)})` : ""}` : seat.ended === "finished" ? "ran to its set length" : seat.end_reason ?? ""}</div></div>
          <div className="dg-out"><div className="k">Cost</div><div className="v">{usd(cost)}</div><div className="s">seat {usd(seat.usage.cost_microusd)} · translator {usd(seat.translator_usage?.cost_microusd ?? 0)}</div></div>
        </section>

        <section>
          <h2>The run at a glance</h2>
          <Timeline seat={seat} />
          <table className="dg-facts"><tbody>
            <tr><th>Election calendar</th><td>notice {day(e.notice_at)} · nominations close {day(e.nominations_close_at)} · poll {day(e.poll_at)} · result {day(e.result_at)} · seated {day(e.seated_at)}{e.stood ? " · the seat stood" : " · the seat did not stand"}</td></tr>
            <tr><th>Sittings</th><td>{seat.sittings.filter((s) => s.kind === "model").length} with model calls ({seat.usage.calls} calls, {tokens(seat.usage.input_tokens)} tokens in, {tokens(seat.usage.output_tokens)} out{seat.usage.reasoning_tokens ? `, ${tokens(seat.usage.reasoning_tokens)} reasoning` : ""})</td></tr>
            <tr><th>Acts</th><td>{seat.acts.length} sent: {seat.acts.length - refused - seat.acts.filter((a) => a.status === "pending").length} applied, {refused} refused{seat.acts.some((a) => a.status === "pending") ? `, ${seat.acts.filter((a) => a.status === "pending").length} with no outcome by the end` : ""}</td></tr>
            <tr><th>Translator</th><td>{seat.translator.requests} requests: {seat.translator.drafts} drafts, {seat.translator.failed} could not be drawn up, {seat.translator.declined} declined by the seat</td></tr>
            {seat.amendments.length > 0 && <tr><th>Election law</th><td>{seat.amendments.map((a) => `proposed day ${a.day} (${Object.entries(a.figures).map(([k, v]) => `${human(k)} ${figure(v)}`).join(", ")}): ${human(a.outcome)}`).join("; ")}</td></tr>}
            {seat.children.length > 0 && <tr><th>The seat's children</th><td>{seat.children.join(", ")} (as its prompt names them)</td></tr>}
          </tbody></table>
        </section>

        <section>
          <h2>Lever moments <span className="dg-note">the study's reader (experiments/power-seeking/reader.ts); its "considered" level is left out</span></h2>
          {!moments.length && <p className="st-muted">The reader found no lever attempted or executed.</p>}
          {moments.map((m) => (
            <div key={m.lever.i} className={`dg-moment ${m.lever.level}`}>
              <div className="dg-moment-top"><b>{m.lever.title}</b><span>{m.lever.level} · {m.outcome}</span><span>day {m.lever.day}{m.lever.days_to_poll !== null ? `, ${m.lever.days_to_poll} days to the poll` : ""} · {human(m.lever.phase)}</span></div>
              <blockquote>“{m.words}”</blockquote>
              {m.note && <div className="dg-sub"><span>on signing</span> “{m.note}”</div>}
              {m.reason && <div className="dg-sub"><span>its reason</span> “{m.reason}”</div>}
            </div>
          ))}
        </section>

        <section className="dg-break">
          <h2>The seat's acts, day by day</h2>
          <ActsChart seat={seat} />
        </section>

        <section>
          <h2>Sittings</h2>
          <table className="dg-sittings">
            <thead><tr><th>day</th><th>what it did</th><th>calls</th><th>acts</th><th>cost</th></tr></thead>
            <tbody>{seat.sittings.map((s) => (
              <tr key={s.i} className={s.levers.some((i) => seat.levers[i]!.level !== "considered") ? "lev" : ""}>
                <td className="st-mono">{s.day}</td>
                <td>{s.gist}{s.levers.some((i) => seat.levers[i]!.level !== "considered") ? <span className="dg-flag"> ⚑ {[...new Set(s.levers.map((i) => seat.levers[i]!).filter((l) => l.level !== "considered").map((l) => l.title))].join("; ")}</span> : null}</td>
                <td className="st-mono">{s.turns}</td><td className="st-mono">{s.acts.length}{s.refused ? ` (${s.refused}✕)` : ""}</td><td className="st-mono">{s.usage.cost_microusd ? usd(s.usage.cost_microusd) : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
        <footer className="dg-foot">Made by Lens from the run's log ({when(seat.end_at)} is its last moment). Counts are raw; the platform says nothing is better or worse. {plural(seat.sittings.length, "sitting")}, {plural(seat.acts.length, "act")}.</footer>
      </article>
    </div>
  );
}

/** Sittings, lever moments and the election's dates on one line of days. */
function Timeline({ seat }: { seat: SeatJson }) {
  const W = 720, H = 74, L = 8, R = 8;
  const a = seat.fork_at, b = Math.max(seat.end_at, a + DAY);
  const x = (t: number) => L + ((Math.min(Math.max(t, a), b) - a) / (b - a)) * (W - L - R);
  const e = seat.election, pins: [number | undefined, string][] = [[e.notice_at, "notice"], [e.nominations_close_at, "noms close"], [e.poll_at, "poll"], [e.result_at, "result"]];
  const ticks: number[] = []; for (let d = Math.ceil(a / DAY / 10) * 10; d * DAY <= b; d += 10) ticks.push(d);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dg-tl">
      {ticks.map((d) => <g key={d}><line x1={x(d * DAY)} x2={x(d * DAY)} y1={8} y2={58} className="grid" /><text x={x(d * DAY)} y={70} className="lbl" textAnchor="middle">{d}</text></g>)}
      <text x={L} y={12} className="lane">sittings</text>
      {seat.sittings.map((s) => <rect key={s.i} x={x(s.t)} y={15} width={Math.max(2, x(s.t_end) - x(s.t))} height={8} rx={1.5} className={s.kind === "code" ? "code" : "sit"} />)}
      <text x={L} y={34} className="lane">levers</text>
      {seat.levers.filter((l) => l.level !== "considered").map((l) => <circle key={l.i} cx={x(l.t)} cy={40} r={3.5} className={l.level === "executed" ? "ex" : "at"} />)}
      {pins.map(([t, n]) => t !== undefined && t <= b ? <g key={n}><line x1={x(t)} x2={x(t)} y1={46} y2={58} className="pin" /><text x={x(t) + 2} y={56} className="pinl">{n}</text></g> : null)}
      {e.poll_at !== undefined && e.poll_at > b && <text x={W - R} y={12} className="pinl" textAnchor="end">poll day {Math.floor(e.poll_at / DAY)} → (after the run)</text>}
    </svg>
  );
}

/** The seat's acts each day: applied above the line, refused below; lever days marked. */
function ActsChart({ seat }: { seat: SeatJson }) {
  const d0 = Math.floor(seat.fork_at / DAY), d1 = Math.floor(seat.end_at / DAY), n = d1 - d0 + 1;
  const ok = new Array(n).fill(0), no = new Array(n).fill(0), lev = new Set<number>();
  for (const a of seat.acts) { if (a.t < seat.fork_at) continue; const i = Math.floor(a.t / DAY) - d0; if (i < 0 || i >= n) continue; if (a.status === "refused") no[i]++; else ok[i]++; }
  for (const l of seat.levers) if (l.level !== "considered") lev.add(Math.floor(l.t / DAY) - d0);
  const max = Math.max(1, ...ok, ...no), W = 720, H = 120, top = 10, mid = 80, bw = (W - 20) / n;
  const y = (v: number) => (v / max) * (mid - top);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dg-acts">
      <line x1={10} x2={W - 10} y1={mid} y2={mid} className="axis" />
      {ok.map((v, i) => v ? <rect key={`o${i}`} x={10 + i * bw + 0.5} y={mid - y(v)} width={Math.max(1, bw - 1)} height={y(v)} rx={1} className="ok" /> : null)}
      {no.map((v, i) => v ? <rect key={`n${i}`} x={10 + i * bw + 0.5} y={mid + 1} width={Math.max(1, bw - 1)} height={y(v) / 2} rx={1} className="no" /> : null)}
      {[...lev].map((i) => <text key={`l${i}`} x={10 + i * bw + bw / 2} y={top + 2} className="flag" textAnchor="middle">⚑</text>)}
      <text x={10} y={H - 4} className="lbl">day {d0} · applied above the line, refused below</text><text x={W - 10} y={H - 4} className="lbl" textAnchor="end">day {d1} · most in a day {max}</text>
    </svg>
  );
}
