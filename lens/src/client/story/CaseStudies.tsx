// "Case studies": a strip at the top of Moments, the runs the study's lead researcher picked to read first (cases.ts).
// Each card: what happened in one plain line, the run's name, whether the study counts it (the shared status function),
// the key day(s), one quote from the blind graders and one from the mayor, word for word, and a button to the key turn.
import type { RunEntry } from "../../shared/api";
import { runName } from "../run-names";
import { runHref } from "../router";
import { notCountedReason, NOT_COUNTED_WORDS } from "../library/landing-data";
import { CASES, type Case, type CaseQuote } from "./cases";
import { Hi } from "./text";
import { withSetups } from "./IdTip";

function Quote({ q }: { q: CaseQuote }) {
  return (
    <figure className="cs-q">
      <blockquote className="st-serif"><Hi text={`“${q.text}”`} town={false} /></blockquote>
      <figcaption>{q.who}</figcaption>
    </figure>
  );
}

function status(e: RunEntry | undefined, c: Case): string {
  if (!e) return "";
  const why = notCountedReason(e);
  return why ? `Not counted in the study: ${NOT_COUNTED_WORDS[why]}.${c.stop ? ` ${c.stop}` : ""}` : `Counted in the study.${c.stop ? ` ${c.stop}` : ""}`;
}

export function CaseStudies({ runs }: { runs: RunEntry[] | undefined }) {
  const byKey = new Map((runs ?? []).map((e) => [e.key, e]));
  return (
    <section className="cs" aria-label="Case studies">
      <h2 className="cs-h">Case studies</h2>
      <p className="cs-sub">Runs worth reading first: what the AI mayor did, in the graders' words and its own, with the turn where it happened.</p>
      <div className="cs-strip">
        {CASES.map((c) => {
          const e = byKey.get(c.key), b = c.beside && c.beside.key !== c.key ? byKey.get(c.beside.key) : undefined;
          return (
            <article key={c.id} className={`cs-card ${c.contrast ? "contrast" : ""}`}>
              <h3 className="cs-title">{c.title}</h3>
              <div className="cs-run">{e ? withSetups(runName(e)) : c.key.split("~")[1]}</div>
              <div className="cs-status">{status(e, c)}</div>
              <div className="cs-days">{c.days}</div>
              {c.figure && <p className="cs-fig">{c.figure}</p>}
              <Quote q={c.grader} />
              {c.mayor && <Quote q={c.mayor} />}
              {c.after && <p className="cs-fig cs-after">{c.after}</p>}
              <a className="st-btn cs-go" href={runHref(c.key, { t: c.t, sel: `sitting:${c.sitting}` })}>Open the key turn</a>
              {c.beside && (
                <div className="cs-beside">
                  <p className="cs-fig">{c.beside.line}</p>
                  {b && <div className="cs-run">{withSetups(runName(b))}</div>}
                  {b && <div className="cs-status">{status(b, c)}</div>}
                  <Quote q={c.beside.grader} />
                  {c.beside.mayor && <Quote q={c.beside.mayor} />}
                  {c.beside.key !== c.key && <a className="st-btn cs-go" href={runHref(c.beside.key, { t: c.beside.t, sel: `sitting:${c.beside.sitting}` })}>Open its turn</a>}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
