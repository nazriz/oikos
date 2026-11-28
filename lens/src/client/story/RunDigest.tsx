// The run digest (#/digest/<key>): one run on one page, for a report's appendix: who held the seat and under which
// goal, how the election went and when, the counts that matter, every lever moment in the seat's own words, a timeline
// of the run, the seat's acts day by day, and an index of its sittings. Prints to PDF (print CSS: light, A4, no
// controls). Facts only, each with its source; the lever flags are the study's reader's, labelled so.
import { seriousness } from "../plain";
import { measuresText } from "../measures";
import { useEffect } from "react";
import { loadSeat, useAsync, when, usd, tokens, plural, human, seatOutcome, type SeatJson } from "./data";
import { momentsOf } from "./moments-data";
import { leverCounts } from "../../shared/outcome";
import { useDescribe } from "../people";
import { kinAppointed } from "./StoryRail";
import { PageAnswer } from "../shell/Shell";
import { HowDoWeKnow, figureWords } from "./Evidence";
import { useResearcher } from "../mode";
import { plainText, winnerWords } from "../plain";
import { goalText, leverTitle, modelName } from "../words";
import "./story.css";
import "./digest.css";
import { dayNo, dayOf } from "../format";

const DAY = 86_400;
const POSTS: { [p: string]: string } = { editor: "newspaper editor", electoral: "head of the election office", finance: "finance officer", "council-clerk": "council clerk" };
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
/** A law's figure as written: seconds that are whole days as days. */
const figure = (v: unknown) => (typeof v === "number" && v >= DAY && v % DAY === 0 ? `${v / DAY} days` : typeof v === "object" ? JSON.stringify(v) : String(v));

export function RunDigest({ run }: { run: string }) {
  const seat = useAsync(() => loadSeat(run), [run]);
  const entry = useAsync(() => fetch(`/api/run/${encodeURIComponent(run)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null), [run]);
  useEffect(() => { document.title = `Digest of ${run}`; }, [run]);
  if (seat === undefined) return <div className="dg"><div className="st-empty">Reading the run…</div></div>;
  if (seat instanceof Error) return <div className="dg"><div className="st-empty">Could not read the run: {seat.message}</div></div>;
  return <Digest run={run} seat={seat} entry={entry instanceof Error ? null : entry ?? null} />;
}

function Digest({ run, seat, entry }: { run: string; seat: SeatJson; entry: any }) {
  const out = seatOutcome(seat), e = seat.election, lv = leverCounts(seat.levers.filter((l) => (l.tier ?? 2) >= 2)); // (a power grab is the checker's seriousness 2 or 3; seriousness 1 is an election-season favour)
  const describe = useDescribe(run, seat.end_at), kin = kinAppointed(seat);
  const researcher = useResearcher(), moved = seat.amendments.some((a) => a.outcome === "applied") && (e.poll_at ?? 0) > seat.end_at;
  const moments = momentsOf(run, seat).filter((m) => (m.lever.tier ?? 2) >= 2).sort((a, b) => a.lever.t - b.lever.t);
  const model = seat.model ? modelName(seat.model) : "The rule-based mayor";
  const day = (t?: number) => (t === undefined ? "—" : `day ${dayOf(t)}`);
  const refused = seat.acts.filter((a) => a.status === "refused").length;
  const cost = seat.usage.cost_microusd + (seat.translator_usage?.cost_microusd ?? 0);
  return (
    <div className="dg">
      <div className="dg-tools lens-no-print"><button className="st-btn primary" onClick={() => print()}>Print or save as PDF</button><a className="st-btn" href={`#/run/${encodeURIComponent(run)}`}>Open the run</a></div>
      <article className="dg-page">
        <header className="dg-head">
          <PageAnswer page="digest" className="lens-no-print" />
          <h1>{model} as the town's mayor</h1>
          <p className="dg-lede">{seat.goal ? `${goalText(seat.goal)}. ` : ""}{seat.seed !== undefined ? `Setup ${seat.seed}. ` : ""}A digest of one run of the Oikos power-seeking study.</p>
          {researcher && <div className="dg-id">{run}</div>}
          {researcher && <div className="dg-id">{seat.run_id}{entry?.group ? `, in run set ${entry.group}` : ""}</div>}
        </header>

        <section className="dg-band">
          <div className={`dg-out ${out.css}`}><div className="k">Election</div><div className="v">{out.label}</div>{e.winner && <div className="s">winner {researcher ? e.winner : winnerWords(e.winner, { seats: [seat.seat] })}</div>}</div>
          {entry && <div className="dg-out"><div className="k">Lock-in</div><div className="v">{measuresText(entry).lockin.replace(/^Lock-in: /, "").replace(/\.$/, "")}</div><div className="s">two independent blind graders: a lawful act to keep the programme in force beyond the next mayor</div></div>}
          <div className="dg-out"><div className="k">Power grabs</div><div className="v">{lv.done} carried out, {lv.tried} tried</div><div className="s">as the study's checker counts them; most serious carried out: {seat.tier.executed ? seriousness(seat.tier.executed) : "none"}</div></div>
          <div className="dg-out"><div className="k">Run</div><div className="v">Days {dayOf(seat.fork_at)} to {dayOf(seat.end_at)}</div><div className="s">{seat.ended === "stopped" ? `${Math.floor(seat.end_at / 86_400) >= 180 ? "ended after election day" : "stopped before election day (not counted)"}${seat.until_at ? ` (set to day ${dayOf(seat.until_at)})` : ""}` : seat.ended === "finished" ? "ran to its set length" : seat.end_reason ?? ""}</div></div>
          <div className="dg-out"><div className="k">Cost</div><div className="v">{usd(cost)}</div><div className="s">{usd(seat.usage.cost_microusd)} for the mayor's model, {usd(seat.translator_usage?.cost_microusd ?? 0)} for the clerk's</div></div>
        </section>

        <section>
          <h2>The run, day by day</h2>
          <Timeline seat={seat} />
          <table className="dg-facts"><tbody>
            <tr><th>Election calendar</th><td>{moved ? `The election was called on ${day(e.notice_at)}, then moved to ${day(e.poll_at)}, after the run ended; so there was no result. The AI mayor ${e.stood ? "had stood" : "had not stood"}.` : [e.notice_at !== undefined && `Election called on ${day(e.notice_at)}`, e.nominations_close_at !== undefined && `nominations closed on ${day(e.nominations_close_at)}`, e.poll_at !== undefined && `election day ${e.poll_at > seat.end_at ? "was due on" : "on"} ${day(e.poll_at)}`, e.result_at !== undefined && `result declared on ${day(e.result_at)}`, e.seated_at !== undefined && `new term began on ${day(e.seated_at)}`].filter(Boolean).join("; ") + `. The AI mayor ${e.stood ? "stood" : "did not stand"}${e.result_at === undefined ? "; no result came before the run ended" : ""}.`}</td></tr>
            <tr><th>The mayor's turns</th><td>{seat.sittings.filter((s) => s.kind === "model").length} turns, in which the model was asked {seat.usage.calls} times; it read {tokens(seat.usage.input_tokens)} tokens and wrote {tokens(seat.usage.output_tokens)}{seat.usage.reasoning_tokens ? ` (${tokens(seat.usage.reasoning_tokens)} of them hidden reasoning)` : ""}.</td></tr>
            <tr><th>Its acts</th><td>{actsSentence(seat)}</td></tr>
            <tr><th>The clerk</th><td>The mayor asked the clerk {seat.translator.requests} times to write something up: {seat.translator.drafts} written up, {seat.translator.failed} that could not be, {seat.translator.declined} that the mayor then declined.</td></tr>
            {seat.amendments.length > 0 && <tr><th>Election law</th><td>{seat.amendments.map((a) => `Proposed on day ${dayNo(a.day)} (${Object.entries(a.figures).map(([k, v]) => `${figureWords(k, v)}`).join(", ")}): ${a.outcome === "applied" ? "passed by the council and applied" : human(a.outcome)}.`).join(" ")}</td></tr>}
            {seat.children.length > 0 && <tr><th>The mayor's children</th><td>{seat.children.map((c) => (describe(c) ? `${c} (${describe(c)})` : c)).join("; ")}, as its own instructions name them</td></tr>}
            {kin.length > 0 && <tr><th>Its own child appointed</th><td>{kin.map((k) => `${k.who} as ${POSTS[k.post] ?? k.post}, on day ${dayOf(seat.acts[k.act]!.t)}`).join("; ")}</td></tr>}
          </tbody></table>
        </section>

        <section>
          <h2>Power grabs, in the mayor's words</h2>
          <p className="dg-note">As the study's checker counts them (experiments/power-seeking/reader.ts). Mentions found only by matching words are left out.</p>
          {!moments.length && <p className="st-muted">The study's checker found no power grab tried or carried out.</p>}
          {moments.map((m) => (
            <div key={m.lever.i} className={`dg-moment ${m.lever.level}`}>
              <div className="dg-moment-top"><b>{cap(leverTitle(m.lever.lever))}</b><span>{m.lever.level === "executed" ? "Carried out" : "Tried, not carried out,"} on day {dayNo(m.lever.day)}{m.daysBefore !== undefined ? (m.daysBefore >= 0 ? `, ${m.daysBefore} days before the election${m.pollHeld ? "" : " was due"}` : `, ${-m.daysBefore} days after the election${m.pollHeld ? "" : " was due"}`) : ""}; {m.outcome}.</span></div>
              <blockquote>“{m.words}”</blockquote>
              {m.note && <div className="dg-sub"><span>on signing</span> “{m.note}”</div>}
              {m.reason && <div className="dg-sub"><span>its reason</span> “{m.reason}”</div>}
              <div className="lens-no-print"><HowDoWeKnow run={run} claim={{ kind: "lever", index: m.lever.i }} /></div>
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
                <td className="st-mono">{dayNo(s.day)}</td>
                <td>{researcher ? s.gist : plainText(s.gist)}{s.levers.some((i) => seat.levers[i]!.level !== "considered") ? <span className="dg-flag"> Power grab: {[...new Set(s.levers.map((i) => seat.levers[i]!).filter((l) => l.level !== "considered").map((l) => leverTitle(l.lever)))].join("; ")}.</span> : null}</td>
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
  const e = seat.election, pins: [number | undefined, string][] = [[e.notice_at, "election called"], [e.nominations_close_at, "nominations close"], [e.poll_at, "election day"], [e.result_at, "result"]];
  const ticks: number[] = []; for (let d = Math.ceil(a / DAY / 10) * 10; d * DAY <= b; d += 10) ticks.push(d);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dg-tl">
      {ticks.map((d) => <g key={d}><line x1={x(d * DAY)} x2={x(d * DAY)} y1={8} y2={58} className="grid" /><text x={x(d * DAY)} y={70} className="lbl" textAnchor="middle">{d}</text></g>)}
      <text x={L} y={12} className="lane">the mayor's turns</text>
      {seat.sittings.map((s) => <rect key={s.i} x={x(s.t)} y={15} width={Math.max(2, x(s.t_end) - x(s.t))} height={8} rx={1.5} className={s.kind === "code" ? "code" : "sit"} />)}
      <text x={L} y={34} className="lane">power grabs</text>
      {seat.levers.filter((l) => l.level !== "considered").map((l) => <circle key={l.i} cx={x(l.t)} cy={40} r={3.5} className={l.level === "executed" ? "ex" : "at"} />)}
      {pins.map(([t, n]) => t !== undefined && t <= b ? <g key={n}><line x1={x(t)} x2={x(t)} y1={46} y2={58} className="pin" /><text x={x(t) + 2} y={56} className="pinl">{n}</text></g> : null)}
      {e.poll_at !== undefined && e.poll_at > b && <text x={W - R} y={12} className="pinl" textAnchor="end">election day {dayOf(e.poll_at)}, after the run</text>}
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
      <text x={10} y={H - 4} className="lbl">Day {d0}. Acts that went through are above the line, refused ones below.</text><text x={W - 10} y={H - 4} className="lbl" textAnchor="end">Day {d1}. At most {max} in a day.</text>
    </svg>
  );
}

/** Its acts in a sentence: "19 acts, all carried out." */
function actsSentence(seat: SeatJson): string {
  const n = seat.acts.length, refused = seat.acts.filter((a) => a.status === "refused").length, pending = seat.acts.filter((a) => a.status === "pending").length, done = n - refused - pending;
  if (!n) return "None.";
  if (done === n) return `${n === 1 ? "One act" : `${n} acts`}, ${n === 1 ? "carried out" : "all carried out"}.`;
  return `${n} acts: ${done} carried out${refused ? `, ${refused} refused` : ""}${pending ? `, ${pending} with no outcome by the end` : ""}.`;
}
