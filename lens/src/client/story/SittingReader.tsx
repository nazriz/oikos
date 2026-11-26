// The sitting reader: one sitting in full, across the width. What the seat was shown (its prompt, in sections), what it
// thought and said (each call: reasoning, words, tool calls with what came back), and what happened (each request to
// the translator, the draft, the seat's sign-off, the act sent, and what the world did with it). The study reader's
// lever flags sit beside the act or the words they came from. Opens on selection of a sitting, an act or a lever.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLens } from "../state";
import { loadSeat, loadSitting, loadSystem, useAsync, when, worldDay, usd, tokens, plural, human, STAGE, type SeatAct, type SeatDraft, type SeatJson, type SeatLever, type SittingDetail, type SittingTurn } from "./data";
import { Hi, Md, MarksContext, hasQuery, openPerson, type Marks } from "./text";
import { leverTitle } from "../words";
import { useResearcher } from "../mode";
import { firstPoll } from "./moments-data";
import { HowDoWeKnow } from "./Evidence";
import "./story.css";

export type Detail = SittingDetail & { acts: SeatAct[] };

/** Which sitting the selection points at, and what in it to bring into view. */
function target(seat: SeatJson, sel: ReturnType<typeof useLens.getState>["selection"]): { sitting: number; act?: number; lever?: number } | null {
  if (!sel) return null;
  if (sel.kind === "sitting") return seat.sittings[sel.index] ? { sitting: sel.index } : null;
  if (sel.kind === "lever") { const l = seat.levers[sel.index]; return l && l.sitting !== null ? { sitting: l.sitting, lever: l.i, ...(l.act !== undefined ? { act: l.act } : {}) } : null; }
  if (sel.kind === "act") { const a = seat.acts.find((x) => x.seq === sel.seq); return a && a.sitting !== null ? { sitting: a.sitting, act: a.i } : null; }
  return null;
}

export function SittingReader({ run: runProp }: { run?: string }) {
  const storeRun = useLens((s) => s.run);
  const run = runProp ?? storeRun;
  const selection = useLens((s) => s.selection);
  const seat = useAsync(() => (run ? loadSeat(run) : null), [run]);
  if (!run || !seat || seat instanceof Error) return null;
  const tg = target(seat, selection);
  if (!tg) return null;
  return <Reader run={run} seat={seat} tg={tg} />;
}

function Reader({ run, seat, tg }: { run: string; seat: SeatJson; tg: { sitting: number; act?: number; lever?: number } }) {
  const researcher = useResearcher();
  const select = useLens((s) => s.select), setT = useLens((s) => s.setT);
  const s = seat.sittings[tg.sitting]!;
  const detail = useAsync(() => loadSitting(run, tg.sitting) as Promise<Detail>, [run, tg.sitting]);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const [hits, setHits] = useState(0);
  const [tab, setTab] = useState<"saw" | "said" | "happened">(tg.act !== undefined ? "happened" : "said");
  const root = useRef<HTMLDivElement>(null);
  const levers = s.levers.map((i) => seat.levers[i]!);
  const marks: Marks = useMemo(() => ({ query, levers: levers.map((l) => ({ words: l.words.slice(0, 600), muted: l.level === "considered" })) }), [query, tg.sitting]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search: count the hits, bring the current one into view (and its column, on a phone).
  useLayoutEffect(() => {
    const els = root.current ? [...root.current.querySelectorAll<HTMLElement>("mark.st-hit")] : [];
    setHits(els.length);
    els.forEach((e, k) => e.classList.toggle("cur", k === hit));
    const cur = els[hit];
    // (A hit inside a closed section or result is opened to be seen.)
    for (let d = cur?.closest("details"); d; d = d.parentElement?.closest("details") ?? null) if (!d.open) d.open = true;
    if (cur) {
      const col = cur.closest<HTMLElement>(".st-col");
      const which = col?.dataset.col as typeof tab | undefined;
      if (which && which !== tab && getComputedStyle(col!).display === "none") setTab(which);
      cur.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
  useEffect(() => setHit(0), [query, tg.sitting]);
  // Bring the selected act or lever into view.
  useEffect(() => {
    if (!detail || detail instanceof Error) return;
    const id = tg.act !== undefined ? `st-act-${tg.act}` : tg.lever !== undefined ? `st-lever-${tg.lever}` : null;
    const el = id ? document.getElementById(id) : null;
    if (el) { const col = el.closest<HTMLElement>(".st-col"); if (col?.dataset.col) setTab(col.dataset.col as typeof tab); requestAnimationFrame(() => el.scrollIntoView({ block: "center", behavior: "smooth" })); }
  }, [detail, tg.act, tg.lever]);
  // Keys: j/k sittings, [ ] levers, / search, Esc close.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT";
      if (e.key === "Escape") { if (typing) (e.target as HTMLInputElement).blur(); else select(null); return; }
      if (typing) return;
      if (e.key === "j") go(1); else if (e.key === "k") go(-1); else if (e.key === "]") lever(1); else if (e.key === "[") lever(-1);
      else if (e.key === "/") { e.preventDefault(); root.current?.querySelector<HTMLInputElement>(".st-search input")?.focus(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });
  const go = (d: number) => { const n = seat.sittings[tg.sitting + d]; if (n) { select({ kind: "sitting", index: n.i }); setT(n.t); } };
  const strong = seat.levers.filter((l) => l.level !== "considered");
  const lever = (d: number) => {
    const at = tg.lever !== undefined ? seat.levers[tg.lever]!.t : d > 0 ? s.t - 1 : s.t_end + 1;
    const pool = strong.length ? strong : seat.levers;
    const n = d > 0 ? pool.find((l) => l.t > at || (l.t === at && l.i > (tg.lever ?? -1))) : [...pool].reverse().find((l) => l.t < at || (l.t === at && l.i < (tg.lever ?? Infinity)));
    if (n) { select({ kind: "lever", index: n.i }); setT(n.t); }
  };

  return (
    <div className={`st-reader ${researcher ? "researcher" : "story"}`} ref={root} onClick={(e) => openPerson(e, select)}>
      <div className="st-rbar">
        <div>
          <h2>Turn {s.i + 1} of {seat.sittings.length}, day {worldDay(s.t)} at {when(s.t).split(", ").at(-1)}{s.kind === "code" ? " (rule-based mayor)" : ""}</h2>
          <p className="meta">
          {researcher && <>{s.turns > 0 ? `The AI mayor was asked ${s.turns === 1 ? "once" : `${s.turns} times`} in this turn` : "No model was asked in this turn"}{s.usage.calls > 0 ? `, reading ${tokens(s.usage.input_tokens)} tokens and writing ${tokens(s.usage.output_tokens)}${s.usage.reasoning_tokens ? ` (${tokens(s.usage.reasoning_tokens)} of them hidden reasoning)` : ""}, at a cost of ${usd(s.usage.cost_microusd)}` : ""}.</>}
          {firstPoll(seat) !== undefined && <span style={{ color: "var(--st-election)" }}> {Math.round((firstPoll(seat)! - s.t) / 86_400)} days before the election was due.</span>}
          </p>
        </div>
        <div className="grow" />
        <div className="st-search">
          <span className="st-faint">⌕</span>
          <input placeholder="Find words in this turn" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setHit((h) => (hits ? (h + (e.shiftKey ? hits - 1 : 1)) % hits : 0)); }} />
          {query.trim().length >= 2 && <span className="n">{hits ? `${hit + 1}/${hits}` : "none"}</span>}
        </div>
        <div className="group">
          <button className="st-btn" disabled={tg.sitting === 0} onClick={() => go(-1)} title="Key: k">Previous turn</button>
          <button className="st-btn" disabled={tg.sitting === seat.sittings.length - 1} onClick={() => go(1)} title="Key: j">Next turn</button>
        </div>
        {seat.levers.length > 0 && <div className="group">
          <button className="st-btn flag" onClick={() => lever(-1)} title="Key: [">Previous power grab</button>
          <button className="st-btn flag" onClick={() => lever(1)} title="Key: ]">Next power grab</button>
        </div>}
        <button className="st-btn st-close" onClick={() => select(null)} title="Close (Esc)">×</button>
      </div>
      <div className="st-rtabs">
        {(["saw", "said", "happened"] as const).map((k) => <button key={k} className={`st-tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{COLS[k]}</button>)}
      </div>
      {detail === undefined ? <div className="st-loading">Opening the sitting…</div> : detail instanceof Error ? <div className="st-loading">Could not open the sitting: {detail.message}</div> : (
        <MarksContext.Provider value={marks}>
          <div className="st-cols">
            <Col k="saw" tab={tab} n={detail.turns[0] ? undefined : ""}><Saw run={run} seat={seat} d={detail} query={query} /></Col>
            <Col k="said" tab={tab} n={plural(detail.turns.length, "answer")}><Said seat={seat} d={detail} levers={levers} /></Col>
            <Col k="happened" tab={tab} n={plural(detail.acts.length, "act")}><Happened seat={seat} d={detail} levers={levers} focus={tg.act} /></Col>
          </div>
        </MarksContext.Provider>
      )}
    </div>
  );
}

const COLS = { saw: "What it was shown", said: "What it thought and said", happened: "What happened" };
function Col({ k, tab, n, children }: { k: keyof typeof COLS; tab: string; n?: string; children: ReactNode }) {
  return (
    <div className={`st-col ${tab === k ? "on" : ""}`} data-col={k}>
      <div className="st-col-head"><h3>{COLS[k]}</h3>{n && <span className="n">{n}</span>}</div>
      <div className="st-col-body">{children}</div>
    </div>
  );
}

// ---------- what it saw ----------

/** The prompt of a sitting's first call, cut at its "## " headings. */
export function sections(input: string): { prelude: string; parts: { title: string; count?: string; body: string }[] } {
  const chunks = input.split(/^## /m);
  const prelude = chunks.shift() ?? "";
  return { prelude, parts: chunks.map((c) => { const nl = c.indexOf("\n"); const head = (nl < 0 ? c : c.slice(0, nl)).trim(); const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(head); return { title: m ? m[1]! : head, ...(m ? { count: m[2]! } : {}), body: nl < 0 ? "" : c.slice(nl + 1) }; }) };
}

function Saw({ run, seat, d, query }: { run: string; seat: SeatJson; d: Detail; query: string }) {
  const first = d.turns.find((t) => t.purpose === "participant" && typeof t.input === "string");
  if (!first) return <div className="st-muted" style={{ fontSize: 13 }}>{d.turns.length ? "This sitting carried on from the one before: no new prompt." : "A code seat: it reads the world directly, with no prompt."}</div>;
  const { prelude, parts } = sections(first.input as string);
  return (
    <>
      <Md text={prelude} className="st-prose st-prelude" />
      {parts.map((p, k) => {
        const big = p.body.length > 2_400;
        return (
          <details key={k} className="st-sec" open={!big || hasQuery(p.body, query)}>
            <summary><Hi text={p.title} /><span className="n">{p.count ?? ""}{big ? `, ${Math.round(p.body.length / 1000)}k characters` : ""}</span></summary>
            <div className="body"><Md text={p.body} className="st-prose small" /></div>
          </details>
        );
      })}
      {first.system && <System run={run} sha={first.system} />}
    </>
  );
}

function System({ run, sha }: { run: string; sha: string }) {
  const [open, setOpen] = useState(false);
  const text = useAsync(() => (open ? loadSystem(run, sha) : null), [open, run, sha]);
  return (
    <details className="st-sec" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Standing instructions <span className="n st-mono">{sha.slice(0, 10)}</span></summary>
      <div className="body">{text === undefined ? <div className="st-muted">…</div> : text instanceof Error ? <div className="st-muted">{text.message}</div> : <Md text={text} className="st-prose small" />}</div>
    </details>
  );
}

// ---------- what it thought and said ----------

function resultsOf(turns: SittingTurn[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of turns) if (Array.isArray(t.input)) for (const x of t.input) if (x?.type === "tool_result") m.set(String(x.tool_use_id), typeof x.content === "string" ? x.content : Array.isArray(x.content) ? x.content.map((c: any) => c?.text ?? "").join("\n") : JSON.stringify(x.content));
  return m;
}

export function Said({ seat, d, levers }: { seat: SeatJson; d: Detail; levers: SeatLever[] }) {
  const researcher = useResearcher();
  const results = useMemo(() => resultsOf(d.turns), [d]);
  if (!d.turns.length) return <div className="st-muted" style={{ fontSize: 13 }}>No model calls: {d.acts.length ? "a code seat's acts." : "nothing was asked."}</div>;
  let call = 0;
  const unseen = d.turns.reduce((n, t) => n + (Array.isArray(t.output) && t.output.some((c: any) => c?.type === "thinking") ? 0 : t.usage?.reasoning_tokens ?? 0), 0);
  return (
    <>
      {researcher && unseen > 0 && <div className="st-unseen">{tokens(unseen)} tokens of reasoning in this turn were kept hidden by the model's provider. Below is what it wrote, not all it thought.</div>}
      {d.turns.map((t, k) => {
        const flagged = levers.filter((l) => l.level === "considered" && l.turn === k);
        const told = Array.isArray(t.input) ? t.input.filter((x: any) => x?.type === "text") : [];
        return (
          <div key={k} className={`st-turn ${t.purpose === "notebook" ? "notebook" : ""}`}>
            <div className="st-turn-head">{t.purpose === "notebook" ? "Its notebook" : `Answer ${++call}`}<span className="u">{t.usage ? `${tokens(t.usage.output_tokens ?? 0)} tokens written, ${usd(t.usage.cost_microusd ?? 0)}` : ""}</span></div>
            {flagged.length > 0 && <div id={`st-lever-${flagged[0]!.i}`} className="st-flagbox muted" style={{ margin: "0 0 10px" }}>{flagged.slice(1).map((l) => <span key={l.i} id={`st-lever-${l.i}`} />)}<div className="who">Mentioned (unreliable): {[...new Set(flagged.map((l) => leverTitle(l.lever)))].join("; ")}</div><div style={{ fontSize: 11.5, marginTop: 2 }}>The study's checker matched these words (underlined below). That is not proof the mayor weighed a power grab; checking by hand found this often wrong.</div></div>}
            {told.map((x: any, j: number) => <div key={j} className="st-note"><span className="k">told</span><Hi text={String(x.text)} /></div>)}
            {t.purpose === "notebook" && typeof t.input === "string" && <details className="st-think"><summary>what the notebook asked</summary><Md text={t.input} className="st-prose small" /></details>}
            <Output out={t.output} results={results} seat={seat} />
          </div>
        );
      })}
    </>
  );
}

function Output({ out, results, seat }: { out: any; results: Map<string, string>; seat: SeatJson }) {
  if (out?.apart) return <div className="st-muted" style={{ fontSize: 12 }}>(This call's output is kept apart from the log.)</div>;
  if (typeof out === "string") return <Md text={out} />;
  if (!Array.isArray(out)) return <div className="st-muted" style={{ fontSize: 12 }}>(no output)</div>;
  return <>{out.map((c: any, k: number) => {
    if (c?.type === "text") return <Md key={k} text={String(c.text ?? "")} />;
    if (c?.type === "thinking") return <details key={k} className="st-think" open><summary>reasoning</summary><Md text={String(c.thinking ?? "")} className="st-prose" /></details>;
    if (c?.type === "redacted_thinking") return <div key={k} className="st-think">(reasoning redacted by the provider)</div>;
    if (c?.type === "tool_use") return <Tool key={k} c={c} result={results.get(String(c.id))} seat={seat} />;
    return <pre key={k} className="st-mono">{JSON.stringify(c, null, 1)}</pre>;
  })}</>;
}

const TOOL: { [name: string]: (i: any) => { what: string; body?: string; why?: string; rest?: string[] } } = {
  look: (i) => ({ what: `Looked at ${place(i.report)}${i.paper ? `: ${i.paper}` : ""}${i.named ? `: ${[].concat(i.named).join(", ")}` : ""}${i.words ? ` for “${i.words}”` : ""}${i.find ? ` where ${i.find.map((f: any) => `${f.field} = ${f.value}`).join(", ")}` : ""}${i.visit ? `: visit ${[].concat(i.visit).join(", ")}` : ""}`, rest: ["report", "paper", "named", "words", "find", "visit"] }),
  do: (i) => ({ what: `Asked the clerk for this${i.as ? `, as ${i.as}` : ""}`, body: i.what ?? i.request, why: i.why, rest: ["as", "what", "request", "why"] }),
  write: (i) => ({ what: `Wrote${i.to ? ` to ${[].concat(i.to).join(", ")}` : ""}${i.about ? `, about ${i.about}` : ""}`, body: i.text, why: i.why, rest: ["to", "about", "text", "why", "as"] }),
  confirm: (i) => ({ what: `${i.decision === "decline" || i.decision === "reject" ? "Declined" : "Confirmed"} ${i.ref ?? ""}`, why: i.note, rest: ["ref", "decision", "note"] }),
  notebook: (i) => ({ what: i.text ? "Rewrote its notebook" : "Noted in its notebook", body: i.add ?? i.text, rest: ["add", "text"] }),
  done_for_now: (i) => ({ what: `Done for now${i.days !== undefined ? `: back in ${plural(Number(i.days), "day")}` : ""}${i.hold ? `, or sooner for ${[].concat(i.hold).join(", ")}` : ""}`, rest: ["days", "hold"] }),
};

function Tool({ c, result, seat }: { c: any; result?: string; seat: SeatJson }) {
  const researcher = useResearcher();
  const input = c.input ?? {};
  const shape = TOOL[c.name]?.(input) ?? { what: human(String(c.name)), rest: [] };
  const extra = Object.entries(input).filter(([k]) => !(shape.rest ?? []).includes(k));
  const kids = seat.children.filter((ch) => JSON.stringify(input).includes(ch));
  return (
    <div className="st-tool">
      <div className="st-tool-head">{researcher && <span className="st-tool-name">{c.name}</span>}<span className="st-tool-what"><Hi text={shape.what} /></span></div>
      {(shape.body || shape.why || extra.length > 0 || kids.length > 0) && (
        <div className="st-tool-body">
          {shape.body && <Md text={String(shape.body)} />}
          {shape.why && <div className="why"><Hi text={String(shape.why)} /></div>}
          {kids.length > 0 && <div className="st-chip flag" style={{ marginTop: 6 }}>names {kids.join(", ")}: the seat's own child</div>}
          {extra.length > 0 && <dl className="st-kv" style={{ marginTop: 6 }}>{extra.flatMap(([k, v]) => [<dt key={k + ":k"}>{k}</dt>, <dd key={k + ":v"}><Hi text={typeof v === "string" ? v : JSON.stringify(v)} /></dd>])}</dl>}
        </div>
      )}
      {result !== undefined && (
        <details className="st-result" open={c.name !== "look" && result.length < 1_200}>
          <summary>{c.name === "look" ? `What it found (${Math.round(result.length / 100) / 10}k characters)` : "The answer"}</summary>
          <div className="body"><Md text={result} className="st-prose small" /></div>
        </details>
      )}
    </div>
  );
}

// ---------- what happened ----------

export function Happened({ seat, d, levers, focus }: { seat: SeatJson; d: Detail; levers: SeatLever[]; focus?: number }) {
  type Item = { t: number; key: string; node: ReactNode };
  const items: Item[] = [];
  const used = new Set<number>();
  for (const dr of d.drafts) {
    const act = dr.act !== undefined ? d.acts.find((a) => a.i === dr.act) : d.acts.find((a) => a.draft === dr.id);
    if (act) used.add(act.i);
    const lv = levers.filter((l) => l.level !== "considered" && ((act && l.act === act.i) || l.source === `draft ${dr.id}`));
    items.push({ t: dr.t, key: dr.id, node: <ActCard seat={seat} draft={dr} act={act} levers={lv} focus={act !== undefined && act.i === focus} /> });
  }
  for (const a of d.acts) if (!used.has(a.i)) items.push({ t: a.t, key: `a${a.i}`, node: <ActCard seat={seat} act={a} levers={levers.filter((l) => l.level !== "considered" && l.act === a.i)} focus={a.i === focus} /> });
  for (const f of d.failures) {
    const lv = levers.filter((l) => l.source === "translator" && l.t === f.t);
    items.push({ t: f.t, key: `f${f.t}${f.draft}`, node: (
      <div className={`st-act ${lv.length ? "lever" : ""}`}>
        <div className="st-act-title"><span className="grow">The translator could not draw it up</span><span className="st-pill no">Not sent</span></div>
        {lv.map((l) => <FlagBox key={l.i} l={l} />)}
        <div className="st-steps">
          <div className="st-step seat"><span className="lbl">It asked</span><Hi className="q" text={f.proposal} /></div>
          {f.call && <div className="st-step inst"><span className="lbl">Read as</span><Hi className="st-mono" text={f.call} /></div>}
          <div className="st-step no"><span className="lbl">Why not</span><Hi text={f.reason} />{f.again ? <span className="st-faint"> (drawn up again)</span> : null}</div>
        </div>
      </div>) });
  }
  items.sort((a, b) => a.t - b.t);
  return (
    <>
      {!items.length && <div className="st-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>It sent nothing in this sitting{d.looks.length ? `: it looked into ${plural(d.looks.reduce((n, l) => n + l.looks.length, 0), "thing")}` : ""}.</div>}
      {items.map((x) => <div key={x.key}>{x.node}</div>)}
      {d.notes.length > 0 && (
        <div className="st-notes">
          <h4 className="st-h3" style={{ marginBottom: 4 }}>Notes from the simulation</h4>
          {d.notes.map((n, k) => <div key={k} className="st-note"><span className="k">{n.key}</span><Hi text={typeof n.data === "string" ? n.data : JSON.stringify(n.data).slice(0, 400)} /></div>)}
        </div>
      )}
    </>
  );
}

/** One flag per lever on a card: its furthest level, with every event's anchor so a jump to any of them lands here. */
function topLevers(levers: SeatLever[]): { top: SeatLever; all: SeatLever[] }[] {
  const rank = { considered: 1, attempted: 2, executed: 3 };
  const by = new Map<string, SeatLever[]>();
  for (const l of levers) by.set(l.lever, [...(by.get(l.lever) ?? []), l]);
  return [...by.values()].map((all) => ({ top: all.reduce((a, b) => (rank[b.level] > rank[a.level] ? b : a)), all }));
}
function FlagBox({ l, also = [] }: { l: SeatLever; also?: SeatLever[] }) {
  const run = useLens((s) => s.run);
  const levels = [...new Set(also.map((x) => x.level))];
  return (
    <div className="st-flagbox" id={`st-lever-${l.i}`}>
      {also.filter((x) => x.i !== l.i).map((x) => <span key={x.i} id={`st-lever-${x.i}`} />)}
      <div className="who">Power grab, {l.level === "executed" ? "carried out" : l.level === "attempted" ? "tried" : "mentioned (unreliable)"}: {leverTitle(l.lever)}</div>
      <div style={{ fontSize: 12, marginTop: 2 }}>{[l.stage ? STAGE[l.stage] ?? l.stage : "", l.days_to_poll !== null ? `${l.days_to_poll} days before election day` : "", l.tier ? `seriousness ${l.tier} of 3` : "", l.detail ?? ""].filter(Boolean).join("; ")}.</div>
      <div className="words"><Hi text={`“${l.words}”`} /></div>
      {run && <div style={{ marginTop: 4 }}><HowDoWeKnow run={run} claim={{ kind: "lever", index: l.i }} /></div>}
    </div>
  );
}

function ActCard({ seat, draft, act, levers, focus }: { seat: SeatJson; draft?: SeatDraft; act?: SeatAct; levers: SeatLever[]; focus: boolean }) {
  // (Titled by what the mayor asked for, in its words; what the clerk made of it is said underneath, since the two can differ.)
  const asked = draft?.proposal ? firstClause(draft.proposal) : undefined;
  const title = act && !draft ? act.label : asked ?? act?.label ?? draft?.label ?? "A request";
  const declined = draft?.decision && draft.decision !== "accept";
  const pill = act ? (act.status === "applied" ? <span className="st-pill ok">Carried out</span> : act.status === "refused" ? <span className="st-pill no">Refused</span> : <span className="st-pill wait">No outcome yet</span>) : declined ? <span className="st-pill no">Declined by the mayor</span> : <span className="st-pill wait">Not sent</span>;
  const researcher = useResearcher();
  const kids = act ? seat.children.filter((c) => act.blocks.some((b) => b?.participant === c || b?.participant === `${c}-self`)) : [];
  return (
    <div className={`st-act ${levers.length ? "lever" : ""} ${focus ? "focus" : ""}`} id={act ? `st-act-${act.i}` : undefined}>
      <div className="st-act-title"><span className="grow"><Hi text={title} /></span>{pill}</div>
      {topLevers(levers).map(({ top, all }) => <FlagBox key={top.i} l={top} also={all} />)}
      {kids.length > 0 && <div className="st-flagbox"><div className="who">Who</div><div style={{ fontSize: 12.5, marginTop: 2 }}>{kids.join(", ")} is the seat's own child, as its prompt names them.</div></div>}
      <div className="st-steps">
        {draft && draft.label && <p className="st-clerk">{draft.decision && draft.decision !== "accept" ? <>The clerk wrote it up as: <b>{lower(draft.label)}</b>. The mayor declined this draft.</> : act ? <>The clerk wrote it up as: <b>{lower(draft.label)}</b>.</> : <>The clerk wrote it up as: <b>{lower(draft.label)}</b>; it was not sent.</>}</p>}
        {draft && asked !== draft.proposal && <div className="st-step seat"><span className="lbl">It asked</span><Hi className="q" text={draft.proposal} /></div>}
        {draft && (draft.summary || draft.call) && (
          <div className="st-step inst"><span className="lbl">Written up by the clerk</span>{researcher && <span className="st-faint" style={{ fontSize: 11.5 }}>{draftBy(draft)}</span>}
            <details className="st-drawn" open={!!draft.summary && draft.summary.length < 220}>
              <summary><Hi text={draft.summary?.split("\n")[0] ?? draft.call ?? ""} /></summary>
              {draft.summary && draft.summary.includes("\n") ? <Md text={draft.summary.split("\n").slice(1).join("\n")} className="st-prose small" /> : null}
              {draft.call && <div className="st-call"><Hi className="st-mono" text={draft.call} /></div>}
            </details>
          </div>
        )}
        {draft && <div className={`st-step ${draft.decision === "accept" ? "ok" : draft.decision ? "no" : "wait"}`}><span className="lbl">{draft.decision === "accept" ? "The mayor signed it" : draft.decision ? "The mayor declined it" : "Not answered"}</span>{draft.note && <Hi className="q" text={draft.note} />}</div>}
        {act && !draft && act.proposal && <div className="st-step seat"><span className="lbl">It asked</span><Hi className="q" text={act.proposal} /></div>}
        {act && act.reasoning && <div className="st-step seat"><span className="lbl">Its reason</span><Hi className="q" text={act.reasoning} /></div>}
        {act && <div className="st-step"><span className="lbl">Sent</span><span className="st-faint">{when(act.t)}{act.as ? `, as ${act.as}` : ""}</span></div>}
        {act && act.status === "applied" && <div className="st-step ok"><span className="lbl">Applied</span><span className="st-faint">{act.at !== undefined ? when(act.at) : ""}</span>{act.records.map((r) => <div key={r.id}><span className="st-rec">{r.id}</span> <span className="st-faint">{human(r.kind)}</span> <Hi text={r.text} /></div>)}</div>}
        {act && act.status === "refused" && <div className="st-step no"><span className="lbl">Refused</span>{human(act.code ?? "")}{act.detail ? <>: <Hi text={act.detail} /></> : null}</div>}
        {act && act.status === "pending" && <div className="st-step wait"><span className="lbl">Outcome</span><span className="st-faint">none in the log by the run's end</span></div>}
      </div>
      {researcher && act && <details className="st-raw"><summary>The act as sent</summary><pre>{JSON.stringify(act.blocks, null, 1)}</pre></details>}
    </div>
  );
}
function draftBy(d: SeatDraft): string {
  const r = d.route;
  if (r?.used === "behind" && r.behind) return `drawn up by ${r.behind}${r.first ? ` (behind ${r.first})` : ""}`;
  if (r?.first) return `drawn up by ${r.first}${r.agree === false && r.behind ? `; ${r.behind} read it otherwise` : ""}`;
  return d.translator ? `drawn up by ${d.translator}` : "";
}

/** The first clause of a request, for a title ("Appoint my child c0571 to the post of Electoral commissioner"). */
function firstClause(x: string): string {
  const t = x.replace(/\s+/g, " ").trim();
  const cut = t.search(/[.;:](\s|$)|, (?:vacating|replacing|so that|because)\b/);
  const c = cut > 12 ? t.slice(0, cut) : t;
  return c.length > 160 ? c.slice(0, 159) + "…" : c;
}
const lower = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);

/** Where the mayor looked, in plain words: "mayor/in-tray" is its in-tray. */
function place(report: unknown): string {
  const r = String(report ?? "").replace(/^[\w-]+\//, "").replace(/[-_]/g, " ");
  return r ? `its ${r}` : "its papers";
}
