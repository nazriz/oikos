// "What it was shown": the prompt of a sitting's first call, laid out as a document (prompt-parts.ts reads its parts). The
// mayor's notebook (its own words, in the serif); then what came in since it last looked, a day at a time; then today,
// each section folded to a one-line summary. Records are compact rows (day, kind, who from and to, the paper's words);
// money is set in tabular figures and aligned; ids are quiet, and a person's id opens their life (nav's hover card).
// Skim folds everything; "Read in full" opens it. Nothing of the prompt is dropped (prompt-parts.ts).
import { useMemo, type ReactNode } from "react";
import { Hi, Md, hasQuery } from "./text";
import { readPrompt, sectionGist, shortTitle, type PromptDay, type PromptItem, type PromptRecord, type PromptSection } from "./prompt-parts";
import { useFull } from "./readmode";

/** The prompt as a document, or null when it does not have the shape (the caller shows it as plain sections). */
export function PromptDoc({ input, query }: { input: string; query: string }) {
  const full = useFull();
  const p = useMemo(() => readPrompt(input), [input]);
  if (!p.shaped) return null;
  let prevFacts = "";
  const factsOf = (d: PromptDay) => { const f = d.facts.join(" "); const changed = f !== prevFacts; prevFacts = f; return { f, changed }; };
  return (
    <div className={`pr ${full ? "full" : "skim"}`} key={full ? "full" : "skim"}>
      {p.notebook && (
        <Fold className="pr-notebook" title="Its notebook" gist={firstLine(p.notebook.text)} open={full || hasQuery(p.notebook.text, query)}>
          <Md text={notebookMd(p.notebook.text)} className="st-prose pr-words" />
          {p.notebook.used && <p className="pr-small">{p.notebook.used.charAt(0).toUpperCase() + p.notebook.used.slice(1)}.</p>}
        </Fold>
      )}
      {p.groups.map((g, gi) => {
        const days = g.days.map((d) => d.day).filter((x): x is number => x !== undefined);
        const head = g.label === "Now" ? `Today, day ${days[0] ?? ""}` : g.label ? `What came in since it last looked${days.length > 1 ? `, days ${days[0]} to ${days.at(-1)}` : days.length ? `, day ${days[0]}` : ""}` : days.length ? `Day ${days[0]}` : "";
        const past = g.label === "Since you last looked";
        return (
          <section key={gi} className={`pr-group ${past ? "past" : "now"}`}>
            {head && <h4 className="pr-group-h">{head}</h4>}
            {g.days.map((d, di) => {
              const { f, changed } = factsOf(d);
              const body = (
                <>
                  {f && (changed ? <p className="pr-facts"><Hi text={f} /></p> : full ? <p className="pr-facts same">About the mayor: as the day before.</p> : null)}
                  {d.items.length > 0 && <Items items={d.items} />}
                  {d.sections.map((s, si) => (past ? <Flat key={si} s={s} /> : <Section key={si} s={s} query={query} />))}
                </>
              );
              if (!past) return <div key={di} className="pr-day">{body}</div>;
              const gist = d.sections.filter((s) => s.items.length && !/accounts/i.test(s.title)).map((s) => `${shortTitle(s.title)}${s.count ? ` (${s.count})` : ""}`);
              return (
                <Fold key={di} className="pr-pastday" title={d.day !== undefined ? `Day ${d.day}` : "Earlier"} gist={gist.length ? gist.join("; ") : "accounts only"} open={full || hasQuery(dayText(d), query)}>
                  {body}
                </Fold>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function Fold({ title, gist, count, open, className = "", children }: { title: ReactNode; gist?: string; count?: string; open: boolean; className?: string; children: ReactNode }) {
  return (
    <details className={`pr-fold ${className}`} open={open}>
      <summary>
        <span className="pr-fold-t">{title}</span>
        {gist && <span className="pr-fold-g"><Hi text={gist} /></span>}
        {count && <span className="pr-fold-n">{count}</span>}
      </summary>
      <div className="pr-fold-body">{children}</div>
    </details>
  );
}

/** A section of today's digest: folded to its summary line. */
function Section({ s, query }: { s: PromptSection; query: string }) {
  const full = useFull();
  const { main, rest } = splitTitle(s.title);
  if (!s.items.length) return <p className="pr-small pr-empty"><Hi text={s.title} /></p>;
  return (
    <Fold title={<Hi text={main} />} gist={sectionGist(s)} {...(s.count ? { count: s.count } : {})} open={full || hasQuery(sectionText(s), query)}>
      {rest && <p className="pr-small"><Hi text={rest} /></p>}
      <Items items={s.items} />
    </Fold>
  );
}
/** A section inside a past day: small enough to show flat, under its name. */
function Flat({ s }: { s: PromptSection }) {
  const { main } = splitTitle(s.title);
  if (!s.items.length) return <p className="pr-small pr-empty"><Hi text={s.title} /></p>;
  return (
    <div className="pr-flat">
      <h5 className="pr-sub"><Hi text={main} />{s.count && <span className="pr-fold-n">{s.count}</span>}</h5>
      <Items items={s.items} />
    </div>
  );
}

function Items({ items }: { items: PromptItem[] }) {
  return (
    <div className="pr-items">
      {items.map((x, k) => {
        if (x.k === "rec") return <Record key={k} r={x.rec} sub={x.sub} />;
        if (x.k === "li") return <Line key={k} text={x.text} sub={x.sub} />;
        if (x.k === "head") return <h5 key={k} className="pr-sub"><Hi text={x.text} /></h5>;
        if (x.k === "note") return <p key={k} className="pr-small"><Hi text={x.text} /></p>;
        if (x.k === "list") return (
          <div key={k} className="pr-list">
            <span className="pr-list-l">{x.label}</span>
            <ul>{x.items.map((it, j) => <li key={j}><Hi text={it} /></li>)}</ul>
          </div>
        );
        return <p key={k} className="pr-p"><Hi text={x.text} /></p>;
      })}
    </div>
  );
}

const MONEY_END = /^(.*?)(?::\s*|\s+)(-?\$[\d,]+(?:\.\d+)?)\.?$/;
/** A list line: an amount at its end is set apart, right-aligned, in tabular figures. */
function Line({ text, sub }: { text: string; sub: string[] }) {
  const m = MONEY_END.exec(text);
  return (
    <div className="pr-li">
      <div className="pr-li-row">
        <span className="pr-li-t"><Hi text={m ? m[1]! : text} /></span>
        {m && <span className="pr-num">{m[2]}</span>}
      </div>
      {sub.map((s, k) => <div key={k} className="pr-li-sub"><Hi text={s} /></div>)}
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** One record: the day it bears, what kind of paper, who from and to, its words; in full, what else it carries. */
function Record({ r, sub }: { r: PromptRecord; sub: string[] }) {
  const full = useFull();
  const parts = r.text ? r.text.split(/;\s+/) : [];
  const table = full && parts.length >= 4 && parts.filter((p) => /\$[\d,]/.test(p)).length >= 3;
  return (
    <div className="pr-rec">
      <span className="pr-day-n">{r.day !== undefined ? `day ${r.day}` : ""}</span>
      <div className="pr-rec-main">
        <div className="pr-rec-head">
          <b>{cap(r.kind)}</b>
          {r.from && <> from <Hi text={r.from} /></>}
          {r.to && <> to <Hi text={r.to} /></>}
          <span className="pr-id"><Hi text={r.id} /></span>
        </div>
        {r.text !== undefined && (table ? (
          <div className="pr-rec-text">
            <ul className="pr-tbl">{parts.map((p, k) => { const m = /^(.*?)\s(\$[\d,]+(?:\.\d+)?)(.*)$/.exec(p.replace(/\.$/, "")); return <li key={k}>{m ? <><span><Hi text={m[1]!} /></span><span className="pr-num">{m[2]}</span>{m[3] && <span className="pr-faint"><Hi text={m[3]!.trim()} /></span>}</> : <span><Hi text={p} /></span>}</li>; })}</ul>
          </div>
        ) : <div className="pr-rec-text"><Hi text={r.text} /></div>)}
        {full && (r.meta || r.citing || sub.length > 0) && (
          <div className="pr-rec-meta">
            {r.meta && <div><Hi text={r.meta} /></div>}
            {r.citing && <div>Citing <Hi text={r.citing} /></div>}
            {sub.map((s, k) => <div key={k}><Hi text={s} /></div>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** "Who's who (look someone up: ...)" → the name, and what the parenthesis says. */
function splitTitle(t: string): { main: string; rest?: string } {
  const looked = /^(.*): what you looked up$/.exec(t);
  if (looked) return { main: `${looked[1]}, looked up` };
  const k = t.indexOf(" (");
  if (k > 0 && t.endsWith(")")) return { main: t.slice(0, k), rest: t.slice(k + 2, -1) };
  const c = t.indexOf(": ");
  if (c > 0 && t.length > 70) return { main: t.slice(0, c), rest: t.slice(c + 2) };
  return { main: t };
}
/** The notebook as the mayor kept it, a line a paragraph, each line's own label ("Council:", "HOLD:") set in bold. */
const notebookMd = (t: string) => t.split("\n").filter((l) => l.trim()).map((l) => l.replace(/^([A-Z][\w' -]{1,40}?):\s/, "**$1:** ")).join("\n\n");
const firstLine =(t: string) => { const l = t.split("\n").find((x) => x.trim()) ?? ""; return l.length > 110 ? `${l.slice(0, 109)}…` : l; };
const itemText = (x: PromptItem): string => x.k === "rec" ? `${x.rec.id} ${x.rec.kind} ${x.rec.from ?? ""} ${x.rec.to ?? ""} ${x.rec.text ?? ""} ${x.rec.meta ?? ""} ${x.rec.citing ?? ""} ${x.sub.join(" ")}` : x.k === "li" ? `${x.text} ${x.sub.join(" ")}` : x.k === "list" ? `${x.label} ${x.items.join(" ")}` : x.text;
const sectionText = (s: PromptSection) => `${s.title} ${s.items.map(itemText).join(" ")}`;
const dayText = (d: PromptDay) => `${d.facts.join(" ")} ${d.items.map(itemText).join(" ")} ${d.sections.map(sectionText).join(" ")}`;
