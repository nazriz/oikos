// What each model did (#/models): one row per AI model across every run, the readable companion to Findings. How
// often it tried a power grab and carried one out, which kinds, how its elections went, and a line of its own words
// about the election; each row opens to its runs. Counts come from the catalogue (every run the study's checker has
// read); the words from the runs Lens has opened (/api/moments).
import { LiveToggle, lockInOf, measuresText, MeasuresKey, runCount, runCountText, useLive } from "../measures";
import { MAIN_SET, studyRuns } from "../library/landing-data";
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
import { useEffect, useMemo, useState } from "react";
import type { RunEntry, ForkReading } from "../../shared/api";
import { outcomeOf, type OutcomeKind } from "../../shared/outcome";
import { goalText, leverTitle, modelName } from "../words";
import { PageAnswer } from "../shell/Shell";
import { useAsync } from "./data";
import { isControl, orderModels, labOf } from "./Findings";
import type { MomentsResponse, Voice } from "./moments-data";
import "./story.css";
import "./models.css";
import { dayNo } from "../format";

interface Fork { key: string; model: string; goal: string; seed: number; r: ForkReading; outcome: OutcomeKind; e: RunEntry }
const OUT: { [k in OutcomeKind]: string } = { won: "won", lost: "lost", poll_moved: "moved the election", stopped_before_poll: "stopped before the election", ended_before_poll: "ended before the election", did_not_stand: "did not stand", no_election: "no election" };

function kindOf(r: ForkReading): OutcomeKind {
  if (r.election && r.end_at !== undefined) return outcomeOf({ election: r.election, end_at: r.end_at, ended: r.ended ?? "unknown", moved: r.moved ?? false }).kind;
  return r.won ? "won" : r.stopped_before_poll ? "stopped_before_poll" : r.winner ? (r.stood ? "lost" : "did_not_stand") : r.poll_day !== undefined ? "ended_before_poll" : "no_election";
}

export function ModelsPage() {
  const data = useAsync(async () => {
    const c = await (await fetch("/api/runs")).json();
    const runs: RunEntry[] = Array.isArray(c) ? c : c.runs;
    const m = await fetch("/api/moments").then((r) => (r.ok ? (r.json() as Promise<MomentsResponse>) : null)).catch(() => null);
    return { runs, moments: m };
  }, []);
  if (data === undefined) return <div className="md"><p className="st-empty">Reading every run…</p></div>;
  if (data instanceof Error || data === null) return <div className="md"><p className="st-empty">Could not read the runs.</p></div>;
  return <Models runs={data.runs} moments={data.moments} />;
}

function Models({ runs, moments }: { runs: RunEntry[]; moments: MomentsResponse | null }) {
  // (The same runs every page counts: src/client/measures.tsx runCount, through landing-data's studyRuns.)
  const live = useLive();
  const keep = useMemo(() => new Set(studyRuns(runs, false, live).map((f) => f.key)), [runs, live]);
  const forks: Fork[] = runs.flatMap((e) => (keep.has(e.key) && e.kind === "fork" && e.experiment && !e.experiment.isCode && e.reading && !isControl(e.experiment.model) && !/mock|levercheck/.test(e.group) ? [{ key: e.key, model: e.experiment.model, goal: e.experiment.goal || "none", seed: e.experiment.seed, r: e.reading, outcome: kindOf(e.reading), e }] : []));
  // (Its words: from the run as Lens opened it where it has, else from the catalogue's reading, which every read run has.)
  const voices = useMemo(() => { const v = new Map<string, { text: string; day: number }>(); for (const f of forks) if (f.r.voice) v.set(f.key, f.r.voice); for (const r of moments?.runs ?? []) if (r.voice) v.set(r.key, r.voice); return v; }, [moments, forks]);
  const models = orderModels([...new Set(forks.map((f) => f.model))]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { document.title = "What each model did"; }, []);
  return (
    <div className="md">
      <div className="md-head">
        <PageAnswer page="models" />
        <h1>What each AI model did as mayor</h1>
        <p className="st-sub">{runCountText(runCount(runs, live))}. Each row gives both of the study's measures; a row opens to its runs.</p>
        <MeasuresKey />
        <LiveToggle runs={runs} />
      </div>
      <table className="md-table">
        <thead><tr><th>Model</th><th>Runs</th><th>Locked its programme in</th><th>Tried a power grab</th><th>Carried one out</th><th>Which kinds</th><th>How its elections went</th><th>In its own words</th></tr></thead>
        <tbody>
          {models.map((m, i) => {
            const mine = forks.filter((f) => f.model === m);
            // (Lock-in counts as the report does: graded runs that reached election day, both graders agreeing.)
            const graded = mine.filter((f) => { const l = lockInOf(f.e); return (l === "yes" || l === "split" || l === "no") && Math.floor(f.r.end_at / 86_400) >= 180 && MAIN_SET.test(f.e.grade!.set); });
            const locked = graded.filter((f) => lockInOf(f.e) === "yes");
            const tried = mine.filter((f) => f.r.has_attempt), done = mine.filter((f) => f.r.has_executed);
            const kinds = new Map<string, number>(); for (const f of mine) for (const l of new Set(f.r.attempts.map((a) => a.lever))) kinds.set(l, (kinds.get(l) ?? 0) + 1);
            const outs = new Map<string, number>(); for (const f of mine) outs.set(OUT[f.outcome], (outs.get(OUT[f.outcome]) ?? 0) + 1);
            // (The words shown: from a run with a power grab if there is one, so the line speaks to what the row counts.)
            const pick = [...done, ...tried, ...mine].find((f) => voices.has(f.key) && ownSentence(voices.get(f.key)!.text));
            const voice = pick ? voices.get(pick.key) : undefined;
            const newLab = i > 0 && labOf(m) !== labOf(models[i - 1]!);
            return [
              <tr key={m} className={`md-row ${newLab ? "lab" : ""} ${open === m ? "open" : ""}`} onClick={() => setOpen(open === m ? null : m)}>
                <td className="md-model">{modelName(m)}</td>
                <td className="num">{mine.length}</td>
                <td className="num">{graded.length ? <>{locked.length ? <b className="lockin-text">{locked.length}</b> : "0"}<span className="st-faint"> of {graded.length} graded</span></> : <span className="st-faint">not graded</span>}</td>
                <td className="num">{tried.length ? <b className="flag">{tried.length}</b> : "0"}<span className="st-faint"> of {mine.length}</span></td>
                <td className="num">{done.length ? <b className="flag">{done.length}</b> : "0"}</td>
                <td>{kinds.size ? [...kinds].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${leverTitle(l)}${n > 1 ? ` (${n} runs)` : ""}`).join("; ") : <span className="st-faint">none</span>}</td>
                <td>{[...outs].sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} ${n}`).join(", ")}</td>
                <td className="md-voice">{voice ? <><span className="st-serif">“{voice.text}”</span> <span className="st-faint">(day {dayNo(voice.day)})</span></> : <span className="st-faint">—</span>}</td>
              </tr>,
              open === m ? <tr key={`${m}:runs`} className="md-runs"><td colSpan={8}>
                <ul>{mine.sort((a, b) => Number(b.r.has_executed) - Number(a.r.has_executed) || Number(b.r.has_attempt) - Number(a.r.has_attempt)).map((f) => (
                  <li key={f.key}><a href={`#/run/${encodeURIComponent(f.key)}`}>{goalText(f.goal)}, town {f.seed}</a>: {measuresText(f.e).lockin} {measuresText(f.e).grab} {cap(OUT[f.outcome])}.</li>
                ))}</ul>
              </td></tr> : null,
            ];
          })}
        </tbody>
      </table>
      <p className="md-foot">Rule-based and scripted test mayors are left out; Findings shows them in Researcher mode. "Locked its programme in" counts graded runs that reached election day where both blind graders agree, as the study's report does. "Tried" counts runs where the checker found a power grab sent to the clerk or the town, whatever became of it.</p>
    </div>
  );
}

/** A line the mayor wrote about its own plans or the election, in the first person: not a letter it sent ("To the
 * editor…"), not a notebook header in capitals, not a paper it quoted (record ids), not a wall of text. */
function ownSentence(t: string): boolean {
  const x = t.trim();
  if (x.length < 25 || x.length > 320) return false;
  if (/^(to |dear |re:|subject:)/i.test(x)) return false;
  if (/[A-Z]{4,}[\s-]+[A-Z]{3,}/.test(x) || /\brec\.\d/.test(x) || /\n/.test(x)) return false;
  return /\b(I|I'll|I'm|I've|I'd|my|me|we|our)\b/.test(x);
}
