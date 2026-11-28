// "What happened": one run told by world day from its own log, for reading what happened without asking anyone. Built
// only from the run's records and the mayor's turns (src/server/run-story.ts). Not opinionated: every text is as written,
// in order; Lens adds plain headings, grouping and order, never a verdict, a label of its own or a colour that judges.
// "Cited by grader" markers are facts from the grade files: that grader quoted these words.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAsync } from "../story/data";
import { runHref } from "../router";
import { Value } from "./RunData";
import "./happened.css";

const DAY = 86_400;
const enc = encodeURIComponent;
const dayOf = (t: number) => Math.floor(t / DAY) + 1;
const clock = (t: number) => {
  const s = ((t % DAY) + DAY) % DAY;
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
};
const num = (n: number | undefined) => (n === undefined ? "" : n.toLocaleString("en-US"));

// ------------------------------------------------------------------ the account's shape (src/server/run-story.ts)

type Cat = "sittings" | "laws" | "budgets" | "ballots" | "directions" | "agreements" | "appointments" | "letters" | "notebook" | "election" | "news";
interface RecRef { id: string; kind: string; t: number; author?: string; speaks_for?: string; text: string; data?: unknown }
interface Vote { yes?: number; no?: number; passed?: boolean; voted_for: string[]; voted_against: string[]; not_voting: string[]; text: string; id: string; t: number }
interface Outcome { ballot?: RecRef; result?: Vote; made: RecRef[] }
interface Request { kind: "request"; what: string; why?: string; tool: string; draft?: { id: string; summary?: string; call?: string }; signoff?: { decision: string; note?: string; t: number }; failure?: string; made: RecRef[]; refused: { t: number; code?: string; detail?: string }[]; outcome?: Outcome[] }
type Item = { cats: Cat[] } & (
  | { kind: "shown"; sections: { title: string; text: string }[] }
  | { kind: "came_back"; to: string; asked?: string; text: string }
  | { kind: "wrote"; text: string }
  | { kind: "looked"; what: string[] }
  | Request
  | { kind: "confirm"; ref?: string; decision?: string; note?: string }
  | { kind: "notebook"; input: Record<string, unknown> }
  | { kind: "letter"; input: Record<string, unknown>; request?: Request }
  | { kind: "tool"; name: string; input: unknown }
  | { kind: "done" }
);
type Entry =
  | { type: "sitting"; t: number; end: number; turns: number; continued?: boolean; items: Item[] }
  | { type: "record"; t: number; rec: RecRef; cats: Cat[]; vote?: Vote; outcome?: Outcome }
  | { type: "appointment"; t: number; position: string; holder?: string; by?: string; cats: Cat[] };
interface Story {
  seat: string;
  told: { opening: string; full: string; first_t?: number; changed: { t: number; added: string[]; removed: string[] }[] };
  glance: {
    first_turn?: number; last_turn?: number; turns: number; sittings: number;
    end?: { t: number; reason?: string; detail?: string };
    results?: { t?: number; stopped?: unknown; framing?: unknown; debrief?: unknown; limitUsd?: unknown; untilDay?: unknown; forkDay?: unknown };
    election?: { notice?: RecRef; poll_at?: number; nominations_close_at?: number; nominations: { who: string; name: string; id: string; t: number; text: string }[]; result?: { rec: RecRef; winner?: string; winner_name?: string; rounds: { who: string; name: string; votes: number }[][]; electors?: number; formal?: number; turnout_bps?: number } };
    counts: Record<string, number>;
    requests: { asked: number; letters: number; drafted: number; confirmed: number; declined: number; failed: number; refused: number };
  };
  days: { day: number; entries: Entry[] }[];
}
interface Cite { grader: string; section: string; n: number; day?: number; quote: string; at?: [number, number, number?] }

const CATS: { id: Cat | ""; label: string }[] = [
  { id: "", label: "Everything" },
  { id: "sittings", label: "The mayor's sittings" },
  { id: "laws", label: "Laws" },
  { id: "budgets", label: "Budgets" },
  { id: "ballots", label: "Council ballots" },
  { id: "directions", label: "Directions" },
  { id: "agreements", label: "Agreements" },
  { id: "appointments", label: "Appointments" },
  { id: "letters", label: "Letters" },
  { id: "notebook", label: "Notebook" },
  { id: "election", label: "Election" },
  { id: "news", label: "News" },
];

export function WhatHappened({ run, day, toGrades }: { run: string; day?: number | null; toGrades: (grader: string, section: string, n: number) => void }) {
  const data = useAsync(() => fetch(`/api/data/run/${enc(run)}/story`).then(async (r) => { const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error ?? String(r.status)); return j as { story: Story; cites: Cite[]; sets: { set: string; packet: string }[] }; }), [run]);
  const [cat, setCat] = useState<Cat | "">("");
  const [words, setWords] = useState("");
  // (Where each grader's quote is: entry "d.e" and item "d.e.i" keys.)
  const citeAt = useMemo(() => {
    const m = new Map<string, Cite[]>();
    if (data && !(data instanceof Error)) for (const c of data.cites) if (c.at) { const k = c.at.filter((x) => x !== undefined).join("."); m.set(k, [...(m.get(k) ?? []), c]); }
    return m;
  }, [data]);
  // (From a grader's day: that day, in view, once the account is here; else the nearest day after it.)
  useEffect(() => {
    if (!day || !data || data instanceof Error) return;
    const d = data.story.days.find((x) => x.day >= day);
    if (d) document.getElementById(`day-${d.day}`)?.scrollIntoView({ block: "start" });
  }, [day, data]);
  if (data === undefined) return <p className="rd-note">Reading the run's log. The first time takes a few seconds (one pass over the whole log); after that it is kept.</p>;
  if (data instanceof Error) return <p className="rd-note">Could not read the run's log: {data.message}</p>;
  const { story } = data;
  const w = words.trim().toLowerCase();
  const marks = (k: string) => {
    const cs = citeAt.get(k);
    if (!cs) return null;
    return (
      <span className="wh-cites">
        {cs.map((c) => (
          <button key={`${c.grader}${c.section}${c.n}`} className="wh-cite" onClick={() => toGrades(c.grader, c.section, c.n)} title={`Grader ${c.grader} quoted these words (${c.section}, entry ${c.n + 1}): "${c.quote}"`}>
            cited by grader {c.grader}
          </button>
        ))}
      </span>
    );
  };
  return (
    <div className="wh">
      <Glance story={story} run={run} />
      <div className="wh-filters" role="group" aria-label="Show">
        {CATS.map((c) => (
          <button key={c.id} className="wh-chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
        <input className="wh-words" placeholder="words in it" value={words} onChange={(e) => setWords(e.target.value)} aria-label="Words" />
      </div>
      {story.days.map((d, di) => {
        const shown = d.entries.map((e, ei) => ({ e, ei })).filter(({ e }) => keep(e, cat, w));
        if (!shown.length) return null;
        return (
          <section key={d.day} className="wh-day" id={`day-${d.day}`}>
            <h2 className="wh-dayh">
              Day {d.day}
              <a className="wh-open" href={runHref(run, { t: (d.day - 1) * DAY + 12 * 3600 })} title="Open the town on this day">
                open the town on this day
              </a>
            </h2>
            {shown.map(({ e, ei }) => (
              <EntryView key={ei} e={e} cat={cat} words={w} k={`${di}.${ei}`} marks={marks} run={run} seat={story.seat} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function itemWords(i: Item): string {
  switch (i.kind) {
    case "wrote": return i.text;
    case "request": return `${i.what} ${i.why ?? ""} ${i.made.map((m) => m.text).join(" ")}`;
    case "notebook": case "letter": case "tool": return JSON.stringify(i.input);
    case "came_back": return i.text;
    case "confirm": return i.note ?? "";
    case "shown": return i.sections.map((s) => s.text).join(" ");
    default: return "";
  }
}
function keepItem(i: Item, cat: Cat | "", w: string) {
  if (cat && cat !== "sittings" && !i.cats.includes(cat)) return false;
  if (w && !itemWords(i).toLowerCase().includes(w)) return false;
  return true;
}
function keep(e: Entry, cat: Cat | "", w: string) {
  if (e.type === "sitting") {
    if (cat && cat !== "sittings" && !e.items.some((i) => i.cats.includes(cat))) return false;
    return !w || e.items.some((i) => keepItem(i, cat, w));
  }
  if (cat === "sittings") return false;
  if (cat && !e.cats.includes(cat)) return false;
  if (w) return (e.type === "record" ? `${e.rec.id} ${e.rec.kind} ${e.rec.text}` : `${e.position} ${e.holder ?? ""}`).toLowerCase().includes(w);
  return true;
}

// ------------------------------------------------------------------ at a glance

function Glance({ story, run }: { story: Story; run: string }) {
  const g = story.glance;
  const [whole, setWhole] = useState(false);
  const el = g.election;
  const res = el?.result;
  return (
    <section className="wh-glance">
      <div className="wh-told">
        <h2>What the mayor was told</h2>
        <p className="rd-note">The opening of its standing instructions, as sent{g.first_turn !== undefined ? ` at its first sitting (day ${dayOf(g.first_turn)})` : ""}.</p>
        <blockquote className="wh-quote">{story.told.opening || "(No instructions found in the log.)"}</blockquote>
        <button className="btn" onClick={() => setWhole(!whole)} aria-expanded={whole}>
          {whole ? "Hide" : "Show"} the whole instructions as sent ({num(story.told.full.length)} characters)
        </button>
        {whole && <pre className="wh-pre">{story.told.full}</pre>}
        {story.told.changed.length > 0 && (
          <details className="wh-det">
            <summary>Sent again with changes {story.told.changed.length === 1 ? "once" : `${story.told.changed.length} times`}: days {story.told.changed.map((c) => dayOf(c.t)).join(", ")}</summary>
            {story.told.changed.map((c, i) => (
              <div key={i} className="wh-change">
                <h3>Day {dayOf(c.t)}, {clock(c.t)}</h3>
                {c.added.length > 0 && <p className="wh-lbl">Lines added</p>}
                {c.added.length > 0 && <pre className="wh-pre">{c.added.join("\n")}</pre>}
                {c.removed.length > 0 && <p className="wh-lbl">Lines taken out</p>}
                {c.removed.length > 0 && <pre className="wh-pre">{c.removed.join("\n")}</pre>}
              </div>
            ))}
          </details>
        )}
      </div>
      <div className="wh-facts">
        <dl className="wh-dl">
          <dt>The mayor's sittings</dt>
          <dd>
            {g.sittings} sittings, {g.turns} turns{g.first_turn !== undefined && g.last_turn !== undefined ? `, day ${dayOf(g.first_turn)} to day ${dayOf(g.last_turn)}` : ""}
          </dd>
          {typeof g.results?.forkDay === "number" && (
            <>
              <dt>The fork</dt>
              <dd>
                The run forks at day {g.results.forkDay + 1} (the spec's forkDay, {g.results.forkDay}); the log's earlier days are the world before the fork, the same in each run of its setup.
              </dd>
            </>
          )}
          {el?.nominations_close_at !== undefined && (
            <>
              <dt>Nominations closed</dt>
              <dd>end of day {dayOf(el.nominations_close_at - 1)}</dd>
            </>
          )}
          {el?.poll_at !== undefined && (
            <>
              <dt>Polling day</dt>
              <dd>day {dayOf(el.poll_at)}</dd>
            </>
          )}
          <dt>Requests</dt>
          <dd>
            {g.requests.asked} asked; {g.requests.drafted} drafted; {g.requests.confirmed} confirmed{g.requests.declined ? `, ${g.requests.declined} declined` : ""}
            {g.requests.failed ? `; ${g.requests.failed} not drafted` : ""}
            {g.requests.refused ? `; ${g.requests.refused} refused once confirmed` : ""}; {g.requests.letters} letters written
          </dd>
          <dt>The run ended</dt>
          <dd>
            {g.end ? `day ${dayOf(g.end.t)}, ${clock(g.end.t)}: ${[g.end.reason, g.end.detail].filter(Boolean).join(", ")}` : "no end in the log"}
            {g.results?.stopped !== undefined && g.results.stopped !== null ? (
              <>
                {"; results.json stopped: "}
                <Value v={g.results.stopped} />
              </>
            ) : g.results?.untilDay !== undefined ? `; results.json has no stop; the spec's untilDay is ${String(g.results.untilDay)} (day ${Number(g.results.untilDay) + 1})` : ""}
          </dd>
          <dt>Records</dt>
          <dd>
            {Object.entries(g.counts)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => `${k} ${n}`)
              .join(" · ")}
          </dd>
        </dl>
        {el && (
          <div className="wh-elect">
            <h3>The election</h3>
            {res ? (
              <>
                <p>{res.rec.text}</p>
                {res.rounds.map((round, i) => (
                  <table key={i} className="wh-count">
                    <caption>{res.rounds.length > 1 ? `Round ${i + 1}` : "First preferences"}, as the commission counted them</caption>
                    <tbody>
                      {round.map((c) => (
                        <tr key={c.who}>
                          <td>
                            {c.name}
                            {c.who === story.seat ? " (the mayor)" : ""}
                          </td>
                          <td className="rd-num">{num(c.votes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
                <p className="rd-note">
                  {res.formal !== undefined && `${num(res.formal)} formal votes`}
                  {res.electors !== undefined && ` of ${num(res.electors)} on the roll`}
                  {res.turnout_bps !== undefined && ` (turnout ${(res.turnout_bps / 100).toFixed(1)}%)`}. Record{" "}
                  <a href={runHref(run, { t: Math.round(res.rec.t) })}>{res.rec.id}</a>, day {dayOf(res.rec.t)}.
                </p>
              </>
            ) : (
              <p className="rd-note">No election result in the log.</p>
            )}
            {el.nominations.length > 0 && (
              <details className="wh-det">
                <summary>{el.nominations.length} nominations</summary>
                <ul className="wh-list">
                  {el.nominations.map((n) => (
                    <li key={n.id}>
                      <span className="wh-meta">
                        day {dayOf(n.t)} · {n.id} · {n.who === story.seat ? "the mayor" : n.who}
                      </span>
                      <div>{n.text}</div>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ one entry

function EntryView({ e, cat, words, k, marks, run, seat }: { e: Entry; cat: Cat | ""; words: string; k: string; marks: (k: string) => ReactNode; run: string; seat: string }) {
  if (e.type === "appointment")
    return (
      <div className="wh-entry wh-rec">
        <div className="wh-meta">
          {clock(e.t)} · appointment
        </div>
        <div>
          {e.holder ? `${who(e.holder, seat)} appointed to ${e.position}` : `${e.position} left empty`}
          {e.by ? `, by ${who(e.by, seat)}` : ""}
        </div>
      </div>
    );
  if (e.type === "record")
    return (
      <div className="wh-entry wh-rec">
        <div className="wh-meta">
          <a href={runHref(run, { t: Math.round(e.t) })} title="Open the town at this moment">{clock(e.t)}</a> · {e.rec.kind} · {e.rec.id} · {who(e.rec.author ?? "", seat)}
          {e.rec.speaks_for ? ` for ${e.rec.speaks_for}` : ""}
          {marks(k)}
        </div>
        <Long text={e.rec.text} />
        {e.vote && <VoteView v={e.vote} />}
        {e.outcome && <OutcomeView o={e.outcome} />}
      </div>
    );
  const items = e.items.map((it, ii) => ({ it, ii })).filter(({ it }) => keepItem(it, cat, words));
  return (
    <div className="wh-entry wh-sit">
      <div className="wh-sith">
        The mayor's sitting{e.continued ? ", continued" : ""} · {clock(e.t)}
        {e.end > e.t && dayOf(e.end) === dayOf(e.t) ? `–${clock(e.end)}` : ""} · {e.turns} {e.turns === 1 ? "turn" : "turns"}
      </div>
      {items.map(({ it, ii }) => (
        <ItemView key={ii} it={it} mark={marks(`${k}.${ii}`)} run={run} seat={seat} />
      ))}
    </div>
  );
}

const who = (id: string, seat: string) => (id === seat ? "the mayor" : id.replace(/-self$/, ""));

function ItemView({ it, mark, run, seat }: { it: Item; mark: ReactNode; run: string; seat: string }) {
  switch (it.kind) {
    case "shown":
      return (
        <details className="wh-det wh-in">
          <summary>
            What it was shown{it.sections.length > 1 ? `: ${it.sections.filter((s) => s.title).map((s) => s.title).join(" · ")}` : ""}
          </summary>
          {it.sections.map((s, i) => (
            <div key={i}>
              {s.title && <h4>{s.title}</h4>}
              <pre className="wh-pre">{s.text}</pre>
            </div>
          ))}
        </details>
      );
    case "came_back":
      return (
        <details className="wh-det wh-in">
          <summary>
            Came back to {it.to === "look" ? `its look-up${it.asked ? ` (${it.asked})` : ""}` : it.to === "do" ? "its request" : it.to === "write" ? "its letter" : it.to}
            {mark}
          </summary>
          <pre className="wh-pre">{it.text}</pre>
        </details>
      );
    case "looked":
      return <div className="wh-small">Looked up: {it.what.join("; ")}</div>;
    case "wrote":
      return (
        <div className="wh-item">
          <div className="wh-lbl">It wrote{mark}</div>
          <div className="wh-words-t">{it.text}</div>
        </div>
      );
    case "request":
      return <RequestView r={it} mark={mark} run={run} />;
    case "confirm":
      return (
        <div className="wh-small">
          It answered {it.ref ?? "?"}: {it.decision ?? "?"}
          {it.note ? ` (“${it.note}”)` : ""}
          {mark}
        </div>
      );
    case "notebook":
      return (
        <div className="wh-item">
          <div className="wh-lbl">Its notebook{mark}</div>
          <Notebook input={it.input} />
        </div>
      );
    case "letter": {
      const i = it.input as Record<string, any>;
      return (
        <div className="wh-item">
          <div className="wh-lbl">
            It wrote a letter{i.to ? ` to ${Array.isArray(i.to) ? i.to.join(", ") : String(i.to)}` : ""}
            {i.about ? `, about: ${String(i.about)}` : ""}
            {i.as ? ` (as ${String(i.as)})` : ""}
            {mark}
          </div>
          <div className="wh-words-t">{String(i.text ?? "")}</div>
          {Object.keys(i).some((x) => !["to", "about", "text", "as"].includes(x)) && (
            <details className="wh-det">
              <summary>Every field of it</summary>
              <Value v={i} />
            </details>
          )}
        </div>
      );
    }
    case "tool":
      return (
        <div className="wh-item">
          <div className="wh-lbl">It used {it.name}{mark}</div>
          <Value v={it.input} />
        </div>
      );
    case "done":
      return <div className="wh-small">Done for now.</div>;
  }
}

function Notebook({ input }: { input: Record<string, unknown> }) {
  const i = input as Record<string, any>;
  if (typeof i.add === "string" && Object.keys(i).length === 1) return <pre className="wh-pre">{i.add}</pre>;
  if (Array.isArray(i.change))
    return (
      <ul className="wh-list">
        {i.change.map((c: any, n: number) => (
          <li key={n}>
            <div className="wh-small">Changed from</div>
            <pre className="wh-pre">{String(c?.from ?? "")}</pre>
            <div className="wh-small">to</div>
            <pre className="wh-pre">{String(c?.to ?? "")}</pre>
          </li>
        ))}
      </ul>
    );
  return <Value v={i} />;
}

function RequestView({ r, mark, run }: { r: Request; mark: ReactNode; run: string }) {
  return (
    <div className="wh-item wh-req">
      <div className="wh-lbl">It asked{mark}</div>
      <div className="wh-words-t">{r.what}</div>
      {r.why && (
        <div className="wh-why">
          <span className="wh-small">Why, as it gave it: </span>
          {r.why}
        </div>
      )}
      <div className="wh-chain">
        {r.draft ? (
          <details className="wh-det">
            <summary>Drafted as {r.draft.id}{r.draft.call ? `: ${r.draft.call.length > 90 ? `${r.draft.call.slice(0, 89)}…` : r.draft.call}` : ""}</summary>
            {r.draft.summary && <pre className="wh-pre">{r.draft.summary}</pre>}
            {r.draft.call && <pre className="wh-pre">{r.draft.call}</pre>}
          </details>
        ) : (
          <div className="wh-small">No draft on file for this request.</div>
        )}
        {r.failure && <div className="wh-small">Not drafted: {r.failure}</div>}
        {r.signoff && (
          <div className="wh-small">
            {r.signoff.decision === "accept" ? "Confirmed" : `Answered: ${r.signoff.decision}`}, day {dayOf(r.signoff.t)} {clock(r.signoff.t)}
            {r.signoff.note ? ` (“${r.signoff.note}”)` : ""}
          </div>
        )}
        {r.refused.map((x, i) => (
          <div key={i} className="wh-small">
            Refused by the world, day {dayOf(x.t)} {clock(x.t)}: {[x.code, x.detail].filter(Boolean).join(": ")}
          </div>
        ))}
        {r.made.map((m) => (
          <div key={m.id} className="wh-made">
            <div className="wh-meta">
              Became <a href={runHref(run, { t: Math.round(m.t) })}>{m.id}</a>, a {m.kind}, day {dayOf(m.t)} {clock(m.t)}
            </div>
            <Long text={m.text} />
          </div>
        ))}
        {r.outcome?.map((o, i) => <OutcomeView key={i} o={o} />)}
      </div>
    </div>
  );
}

function OutcomeView({ o }: { o: Outcome }) {
  return (
    <div className="wh-outcome">
      {o.ballot && (
        <div className="wh-small">
          Put to the council as ballot {o.ballot.id}, day {dayOf(o.ballot.t)}
        </div>
      )}
      {o.result ? <VoteView v={o.result} /> : o.ballot && <div className="wh-small">No result recorded for this ballot in the run.</div>}
      {o.made.map((m) => (
        <div key={m.id} className="wh-made">
          <div className="wh-meta">
            Recorded as {m.id}, a {m.kind}, day {dayOf(m.t)}
          </div>
          <Long text={m.text} />
        </div>
      ))}
    </div>
  );
}

function VoteView({ v }: { v: Vote }) {
  return (
    <div className="wh-vote">
      <div>
        Council ballot result {v.id}, day {dayOf(v.t)}: {v.passed === undefined ? "" : v.passed ? "passed" : "not passed"}
        {v.yes !== undefined ? `, ${v.yes} for, ${v.no ?? 0} against` : ""}
      </div>
      <table className="wh-count">
        <tbody>
          {v.voted_for.map((c) => (
            <tr key={`f${c}`}>
              <td>{c}</td>
              <td>for</td>
            </tr>
          ))}
          {v.voted_against.map((c) => (
            <tr key={`a${c}`}>
              <td>{c}</td>
              <td>against</td>
            </tr>
          ))}
          {v.not_voting.map((c) => (
            <tr key={`n${c}`}>
              <td>{c}</td>
              <td>did not vote</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A text as written: in full when short, else its start with the rest a click away. */
function Long({ text, at = 700 }: { text: string; at?: number }) {
  const [open, setOpen] = useState(false);
  if (text.length <= at) return <div className="wh-text">{text}</div>;
  return (
    <div className="wh-text">
      {open ? text : `${text.slice(0, at - 1)}…`}{" "}
      <button className="wh-more" onClick={() => setOpen(!open)}>
        {open ? "less" : `all ${num(text.length)} characters`}
      </button>
    </div>
  );
}
