// The rail in Story mode: the run as a short account for someone outside the study. A few plain sentences on who held
// the office and how it ended, then one card per turn in which the AI mayor did something, in plain words with its own
// words beside them; quiet turns are folded into one line. The full reader is one click away on every card.
import { useMemo, useState } from "react";
import { useLens } from "../state";
import { useWords, leverTitle, goalText, modelName } from "../words";
import { useDescribe } from "../people";
import { seatOutcome, usd, type SeatJson } from "./data";
import { tell, type Telling } from "./narrative";
import "./story.css";
import "./storymode.css";

const DAY = 86_400;

export function StoryAccount({ seat }: { seat: SeatJson }) {
  const W = useWords();
  const run = useLens((s) => s.run);
  const describe = useDescribe(run, seat.end_at);
  const select = useLens((s) => s.select), setT = useLens((s) => s.setT);
  const words = useMemo(() => ({ mayor: W.seat, Mayor: W.Seat, powerGrab: W.lever, leverTitle }), [W]);
  const tellings = useMemo(() => seat.sittings.filter((s) => s.kind === "model" || seat.sittings.every((x) => x.kind === "code")).map((s) => tell(seat, s, words, describe)), [seat, words, describe]);
  const out = seatOutcome(seat);
  const model = seat.model ? modelName(seat.model) : "a rule-based program";
  const grabs = tellings.filter((t) => t.levers.length);
  // Notable turns as cards; runs of quiet turns between them as one folded line.
  const blocks: ({ kind: "card"; t: Telling } | { kind: "quiet"; ts: Telling[] })[] = [];
  for (const t of tellings) {
    if (t.notable) blocks.push({ kind: "card", t });
    else { const last = blocks.at(-1); if (last?.kind === "quiet") last.ts.push(t); else blocks.push({ kind: "quiet", ts: [t] }); }
  }
  const open = (t: Telling) => { select({ kind: "sitting", index: t.i }); setT(t.t); };
  return (
    <div className="sm" data-tour="rail">
      <div className="sm-head">
        <h2>{model} as the town's mayor</h2>
        <p>
          An AI model ({model}) held the office of mayor from day {Math.round(seat.fork_at / DAY)} {seat.ended === "stopped" ? `until the run stopped early on day ${Math.round(seat.end_at / DAY)}` : `to day ${Math.round(seat.end_at / DAY)}`}. {seat.goal ? `${goalText(seat.goal)}. ` : ""}It took {tellings.length} turns and cost {usd(seat.usage.cost_microusd + (seat.translator_usage?.cost_microusd ?? 0))} to run.
        </p>
        <p className={`sm-out ${out.css}`}>{out.label}.</p>
        <p>{grabs.length ? `${W.Seat} made what the study counts as a ${W.lever} in ${grabs.length === 1 ? "one turn" : `${grabs.length} turns`}, shown in red below.` : `The study's checker found no ${W.lever} in this run.`}</p>
      </div>
      <div className="sm-list">
        {blocks.map((b, k) => b.kind === "card" ? (
          <article key={b.t.i} className={`sm-card ${b.t.levers.length ? "grab" : ""}`} data-tour={k === 0 ? "turn" : undefined}>
            <h3>Day {b.t.day}</h3>
            {b.t.sentences.map((x, i) => <p key={i}>{x}</p>)}
            {b.t.levers.length > 0 && <p className="sm-grab">The study counts this as a {W.lever}: {[...new Set(b.t.levers.map((l) => leverTitle(l.lever)))].join("; ")}.</p>}
            {b.t.quote && <blockquote className="sm-quote">“{b.t.quote.length > 280 ? b.t.quote.slice(0, 279) + "…" : b.t.quote}”</blockquote>}
            <button className="st-btn" onClick={() => open(b.t)}>Read this turn in full</button>
          </article>
        ) : <Quiet key={`q${k}`} ts={b.ts} onOpen={open} />)}
        {!tellings.length && <p className="sm-quiet">{W.Seat} took no turns after the run began.</p>}
      </div>
    </div>
  );
}

function Quiet({ ts, onOpen }: { ts: Telling[]; onOpen: (t: Telling) => void }) {
  const [open, setOpen] = useState(false);
  const span = ts.length === 1 ? `day ${ts[0]!.day}` : `days ${ts[0]!.day} to ${ts.at(-1)!.day}`;
  return (
    <div className="sm-quiet">
      <button className="sm-quiet-toggle" onClick={() => setOpen(!open)}>{ts.length === 1 ? `One quiet turn (${span})` : `${ts.length} quiet turns (${span})`}: it looked around and did nothing. {open ? "Hide them" : "Show them"}</button>
      {open && ts.map((t) => <p key={t.i}><button className="sm-link" onClick={() => onOpen(t)}>Day {t.day}</button>: {t.sentences.join(" ")}</p>)}
    </div>
  );
}
