// The rail in Story mode: the run as a short account for someone outside the study. A few plain sentences on who held
// the office and how it ended, then one card per turn in which the AI mayor did something, in plain words with its own
// words beside them; quiet turns are folded into one line. The full reader is one click away on every card.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLens } from "../state";
import { useWords, leverTitle, leverTo, goalText, modelName } from "../words";
import { useDescribe } from "../people";
import { seatOutcome, usd, type SeatJson } from "./data";
import { tell, type Telling } from "./narrative";
import { HowDoWeKnow } from "./Evidence";
import { Hi, openPerson, usePlain, usePlainNames } from "./text";
import { fetchRun } from "../api";
import { lockInfo, lockDay, graders, type LockInfo } from "./lockin";
import { electionCard, type ElectionCard } from "./election-card";
import { leverCounts } from "../../shared/outcome";
import { loadSeat, useAsync } from "./data";
import "./story.css";
import "./storymode.css";
import { dayNo, dayOf } from "../format";

const DAY = 86_400;

export function StoryAccount({ seat }: { seat: SeatJson }) {
  const W = useWords();
  const plain = usePlain();
  const names = usePlainNames();
  const postName = useMemo(() => (id: string) => { const t = names.positions?.[id]?.title; return t ? t.charAt(0).toLowerCase() + t.slice(1) : undefined; }, [names]);
  const run = useLens((s) => s.run);
  const describe = useDescribe(run, seat.end_at);
  const select = useLens((s) => s.select), setT = useLens((s) => s.setT);
  const words = useMemo(() => ({ mayor: W.seat, Mayor: W.Seat, powerGrab: W.lever, leverTitle }), [W]);
  const tellings = useMemo(() => seat.sittings.filter((s) => s.kind === "model" || seat.sittings.every((x) => x.kind === "code")).map((s) => tell(seat, s, words, describe, postName)), [seat, words, describe, postName]);
  const out = seatOutcome(seat);
  const model = seat.model ? modelName(seat.model) : "a rule-based program";
  const grabs = tellings.filter((t) => t.levers.length);
  // (The study's blind grades, from the catalogue: a lock-in is placed on its turn and said in the summary.)
  const entry = useAsync(() => (run ? fetchRun(run).catch(() => null) : null), [run]);
  const lock = useMemo(() => lockInfo(seat, entry instanceof Error ? null : entry), [seat, entry]);
  // Notable turns as cards; runs of quiet turns between them as one folded line.
  const blocks: ({ kind: "card"; t: Telling } | { kind: "quiet"; ts: Telling[] } | { kind: "election"; e: ElectionCard })[] = [];
  // (The election's result as a card of its own, in its place among the turns: src/client/story/election-card.ts.)
  const elec = useMemo(() => electionCard(seat), [seat]);
  let elecPlaced = !elec;
  for (const t of tellings) {
    if (!elecPlaced && elec && t.t > elec.t) { blocks.push({ kind: "election", e: elec }); elecPlaced = true; }
    if (t.notable || t.i === lock?.sitting) blocks.push({ kind: "card", t });
    else { const last = blocks.at(-1); if (last?.kind === "quiet") last.ts.push(t); else blocks.push({ kind: "quiet", ts: [t] }); }
  }
  if (!elecPlaced && elec) blocks.push({ kind: "election", e: elec });
  const open = (t: Telling) => { select({ kind: "sitting", index: t.i }); setT(t.t); };
  // When the page opens at a moment (a link, the timeline, a turn chosen elsewhere), bring that turn's card to the top;
  // the summary stays just above it. On a fresh open at the run's start, nothing moves.
  const root = useRef<HTMLDivElement>(null);
  const t = useLens((x) => x.t), selection = useLens((x) => x.selection);
  const target = selection?.kind === "sitting" ? seat.sittings[selection.index]?.t : selection?.kind === "lever" ? seat.levers[selection.index]?.t : t;
  const at = useMemo(() => { let k = -1; for (const x of tellings) if (target !== undefined && x.t <= target + 1) k = x.i; return k; }, [tellings, target]);
  const first = tellings[0]?.i;
  useEffect(() => {
    const box = root.current;
    if (at < 0 || at === first || !box) return;
    const align = (smooth: boolean) => { const el = box.querySelector<HTMLElement>(`[data-turns~="${at}"]`); if (el) box.scrollTo({ top: Math.max(0, el.offsetTop - 8), behavior: smooth ? "smooth" : "auto" }); };
    align(true);
    // (The summary above can grow once the twin's run is read; keep the turn in place until the reader scrolls.)
    let mine = true;
    const stop = () => { mine = false; };
    box.addEventListener("wheel", stop, { passive: true }); box.addEventListener("touchmove", stop, { passive: true });
    const head = box.querySelector(".sm-head");
    const ro = head ? new ResizeObserver(() => { if (mine) align(false); }) : null;
    if (head) ro!.observe(head);
    const done = setTimeout(() => ro?.disconnect(), 8000);
    return () => { ro?.disconnect(); clearTimeout(done); box.removeEventListener("wheel", stop); box.removeEventListener("touchmove", stop); };
  }, [at, first]);
  return (
    <div className="sm" ref={root} data-tour="rail" onClick={(e) => openPerson(e, select)}>
      <div className="sm-head">
        <h2>{model} as the town's mayor</h2>
        <OneMinute seat={seat} run={run ?? ""} model={model} turns={tellings.length} lock={lock} />
      </div>
      <div className="sm-list">
        {blocks.map((b, k) => b.kind === "election" ? (
          <article key="election" className={`sm-card election ${b.e.won ? "won" : ""}`} data-election={b.e.t}>
            <h3>Day {b.e.day}: the election</h3>
            {b.e.sentences.map((x, i) => <p key={i} className={i === 1 ? "sm-lead" : undefined}>{x}</p>)}
            {run && <div className="sm-ev"><HowDoWeKnow run={run} claim={{ kind: "outcome" }} /></div>}
            <button className="st-btn" onClick={() => setT(b.e.t)}>Go to the result</button>
          </article>
        ) : b.kind === "card" ? (
          <article key={b.t.i} data-turns={String(b.t.i)} data-peek={`sitting:${b.t.i}`} className={`sm-card ${b.t.levers.length ? "grab" : ""} ${b.t.i === lock?.sitting ? "lockin" : ""}`} data-tour={k === 0 ? "turn" : undefined}>
            <h3>Day {b.t.day}</h3>
            {b.t.sentences.map((x, i) => <p key={i} className={i === 0 ? "sm-lead" : undefined}>{plain(x)}</p>)}
            {b.t.votes.length > 0 && run && <div className="sm-ev"><HowDoWeKnow run={run} claim={{ kind: "vote", proposal: b.t.votes[0]! }} label={b.t.votes.length > 1 ? "How the first vote went" : "How the vote went"} /></div>}
            {b.t.levers.length > 0 && <div className="sm-grab">The study counts this as a {W.lever}: {[...new Set(b.t.levers.map((l) => leverTitle(l.lever)))].join("; ")}. {run && <HowDoWeKnow run={run} claim={{ kind: "lever", index: (b.t.levers.find((l) => l.level === "executed") ?? b.t.levers[0]!).i }} />}</div>}
            {lock && b.t.i === lock.sitting && <div className="sm-lockin">Lock-in, as {graders(lock)} found it{lock.act ? <>: {lowerFirst(plain(lock.act))}</> : "."} {run && <HowDoWeKnow run={run} claim={{ kind: "lockin", lock }} />}</div>}
            {b.t.quote && <blockquote className="sm-quote"><Hi text={`“${b.t.quote.length > 280 ? b.t.quote.slice(0, 279) + "…" : b.t.quote}”`} /></blockquote>}
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
  const plain = usePlain();
  const span = ts.length === 1 ? `day ${ts[0]!.day}` : `days ${ts[0]!.day} to ${ts.at(-1)!.day}`;
  return (
    <div className="sm-quiet" data-turns={ts.map((t) => t.i).join(" ")}>
      <button className="sm-quiet-toggle" onClick={() => setOpen(!open)}>{ts.length === 1 ? `One quiet turn (${span})` : `${ts.length} quiet turns (${span})`}: it looked around and did nothing. {open ? "Hide them" : "Show them"}</button>
      {open && ts.map((t) => <p key={t.i}><button className="sm-link" onClick={() => onOpen(t)}>Day {t.day}</button>: {plain(t.sentences.join(" "))}</p>)}
    </div>
  );
}

/** "This run in one minute": a few plain sentences from the data, folded away if the reader prefers (remembered). */
function OneMinute({ seat, run, model, turns, lock }: { seat: SeatJson; run: string; model: string; turns: number; lock: LockInfo | null }) {
  const [open, setOpenState] = useState<boolean>(() => { try { return localStorage.getItem("lens.story.minute") !== "closed"; } catch { return true; } });
  const plain = usePlain();
  const setOpen = (v: boolean) => { setOpenState(v); try { localStorage.setItem("lens.story.minute", v ? "open" : "closed"); } catch { /* private mode */ } };
  // (The rule-based twin, for the last sentence: read only when shown; its run may still be being read.)
  const twin = useAsync(async () => {
    if (!open || !run) return null;
    const e = await fetch(`/api/run/${encodeURIComponent(run)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const key = e?.experiment?.twin as string | undefined;
    return key ? loadSeat(key).catch(() => null) : null;
  }, [run, open]);
  const out = seatOutcome(seat), lv = leverCounts(seat.levers);
  const executed = seat.levers.filter((l) => l.level === "executed"), tried = seat.levers.filter((l) => l.level === "attempted");
  const kinds = (ls: typeof seat.levers) => [...new Set(ls.map((l) => leverTitle(l.lever)))];
  const first = executed[0] ?? tried[0];
  const end = seat.ended === "stopped" ? (Math.floor(seat.end_at / 86_400) >= 180 ? `until the run ended after election day, on day ${dayOf(seat.end_at)}` : `until the run stopped before election day, on day ${dayOf(seat.end_at)}`) : `to day ${dayOf(seat.end_at)}`;
  const twinSeat = twin && !(twin instanceof Error) ? twin : null;
  return (
    <section className="sm-minute">
      <button className="sm-minute-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>This run in one minute{open ? "" : " (show)"}</button>
      {open && <>
        <p>An AI model, {model}, held the office of mayor from day {dayOf(seat.fork_at)} {end}. {seat.goal ? `${goalText(seat.goal)}.` : ""}</p>
        {lock && <div className="sm-p sm-lock">{lockDay(lock) !== undefined ? `On day ${lockDay(lock)}` : "In this run"} ({graders(lock)}: a lock-in){lock.act ? `: ${lowerFirst(plain(lock.act))}` : "."} <HowDoWeKnow run={run} claim={{ kind: "lockin", lock }} /></div>}
        <div className="sm-p">{lv.done ? <>It carried out {lv.done === 1 ? "a power grab" : `${lv.done} kinds of power grab`}: {kinds(executed).join("; ")}{first ? `, first on day ${dayNo(first.day)}` : ""}. </> : lv.tried ? <>It tried to {[...new Set(tried.map((l) => leverTo(l.lever)))].join(", and to ")}, but did not carry it out. </> : lock ? <>The study's checker found no power grab against the election. </> : <>It made no power grab; in {turns} turns its {seat.acts.length} acts were the town's ordinary business. </>}
          {first && <HowDoWeKnow run={run} claim={{ kind: "lever", index: first.i }} />}</div>
        <div className={`sm-p sm-out ${out.css}`}>{out.label}. <HowDoWeKnow run={run} claim={{ kind: "outcome" }} /></div>
        {twinSeat && (() => {
          // (Said so it cannot be misread: the rule-based mayor's result, and its acts beside this AI mayor's.)
          const twinOut = seatOutcome(twinSeat), mine = seatOutcome(seat);
          const n = twinSeat.acts.filter((a) => a.t >= twinSeat.fork_at).length, m = seat.acts.filter((a) => a.t >= seat.fork_at).length;
          const also = twinOut.label === mine.label ? "also " : "";
          return <p>The same town with a rule-based mayor: it {also}{twinOut.label.charAt(0).toLowerCase() + twinOut.label.slice(1)}, with {n} {n === 1 ? "act" : "acts"}, against this mayor's {m}.</p>;
        })()}
      </>}
    </section>
  );
}

const lowerFirst = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
