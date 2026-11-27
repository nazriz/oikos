// The sitting reader: one sitting in full, across the width. What the seat was shown (its prompt, in sections), what it
// thought and said (each call: reasoning, words, tool calls with what came back), and what happened (each request to
// the translator, the draft, the seat's sign-off, the act sent, and what the world did with it). The study reader's
// lever flags sit beside the act or the words they came from. Opens on selection of a sitting, an act or a lever.
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLens } from "../state";
import { loadSeat, loadSitting, loadSystem, useAsync, when, worldDay, usd, tokens, plural, human, STAGE, type SeatAct, type SeatDraft, type SeatJson, type SeatLever, type SittingDetail, type SittingTurn } from "./data";
import { Hi, Md, MarksContext, hasQuery, openPerson, keyWords, keySentences, usePlain, usePlainNames, plainReason, type Marks } from "./text";
import { leverTitle } from "../words";
import { useResearcher } from "../mode";
import { firstPoll } from "./moments-data";
import { HowDoWeKnow } from "./Evidence";
import { PromptDoc } from "./PromptDoc";
import { readPrompt } from "./prompt-parts";
import { useReadMode, useFull } from "./readmode";
import { plainId, type PlainNames } from "../plain";
import { actClause } from "./narrative";
import "./story.css";
import "./read.css";

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
          {firstPoll(seat) !== undefined && <span style={{ color: "var(--st-election)" }}> {plural(Math.round((firstPoll(seat)! - s.t) / 86_400), "day")} before the election was due.</span>}
          </p>
        </div>
        <div className="grow" />
        <div className="st-search">
          <span className="st-faint">⌕</span>
          <input placeholder="Find words in this turn" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setHit((h) => (hits ? (h + (e.shiftKey ? hits - 1 : 1)) % hits : 0)); }} />
          {query.trim().length >= 2 && <span className="n">{hits ? `${hit + 1}/${hits}` : "none"}</span>}
        </div>
        <ReadToggle />
        <div className="group">
          <button className="st-btn" disabled={tg.sitting === 0} onClick={() => go(-1)} title="Key: k">Previous turn</button>
          <button className="st-btn" disabled={tg.sitting === seat.sittings.length - 1} onClick={() => go(1)} title="Key: j">Next turn</button>
        </div>
        {/* (Only where the checker found a power grab tried or carried out: a run with none has nothing to step to.) */}
        {strong.length > 0 && <div className="group">
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

/** Skim (each part folded to its summary, long passages to their key sentences) or read in full; remembered. Key: v. */
function ReadToggle() {
  const mode = useReadMode((s) => s.mode), set = useReadMode((s) => s.set);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "v" && !e.metaKey && !e.ctrlKey && (e.target as HTMLElement)?.tagName !== "INPUT") set(useReadMode.getState().mode === "full" ? "skim" : "full"); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [set]);
  return (
    <div className="group st-seg" role="group" aria-label="How much to show">
      <button className={`st-btn ${mode === "skim" ? "on" : ""}`} aria-pressed={mode === "skim"} onClick={() => set("skim")} title="Summaries and highlighted lines only (key: v)">Skim</button>
      <button className={`st-btn ${mode === "full" ? "on" : ""}`} aria-pressed={mode === "full"} onClick={() => set("full")} title="Everything open (key: v)">Read in full</button>
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

function Saw({ run, d, query }: { run: string; seat: SeatJson; d: Detail; query: string }) {
  const full = useFull();
  const plain = usePlain();
  const first = d.turns.find((t) => t.purpose === "participant" && typeof t.input === "string");
  const input = first?.input as string | undefined;
  const shaped = useMemo(() => (input ? readPrompt(input).shaped : false), [input]);
  if (!first || input === undefined) return <div className="st-muted" style={{ fontSize: 13 }}>{d.turns.length ? "This sitting carried on from the one before: no new prompt." : "A code seat: it reads the world directly, with no prompt."}</div>;
  // (A prompt without the digest's shape is shown as before: its prelude, then each "## " section.)
  if (!shaped) {
    const { prelude, parts } = sections(input);
    return (
      <>
        <Md text={prelude} className="st-prose st-prelude" />
        {parts.map((p, k) => (
          <details key={`${k}${full}`} className="st-sec" open={full || hasQuery(p.body, query)}>
            <summary><Hi text={plain(p.title)} /><span className="n">{p.count ?? ""}{p.body.length > 2_400 ? `, ${Math.round(p.body.length / 1000)}k characters` : ""}</span></summary>
            <div className="body"><Md text={p.body} className="st-prose small" /></div>
          </details>
        ))}
        {first.system && <System run={run} sha={first.system} />}
      </>
    );
  }
  return <><PromptDoc input={input} query={query} />{first.system && <System run={run} sha={first.system} />}</>;
}

function System({ run, sha }: { run: string; sha: string }) {
  const researcher = useResearcher();
  const [open, setOpen] = useState(false);
  const text = useAsync(() => (open ? loadSystem(run, sha) : null), [open, run, sha]);
  return (
    <details className="pr-fold pr-standing" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><span className="pr-fold-t">Standing instructions</span><span className="pr-fold-g">the same at every turn: its office, its powers and what it was told to aim for</span>{researcher && <span className="pr-fold-n">{sha.slice(0, 10)}</span>}</summary>
      <div className="pr-fold-body">{text === undefined ? <div className="st-muted">Reading…</div> : text instanceof Error ? <div className="st-muted">{text.message}</div> : <Md text={text} className="st-prose small" />}</div>
    </details>
  );
}

// ---------- what it thought and said ----------

function resultsOf(turns: SittingTurn[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of turns) if (Array.isArray(t.input)) for (const x of t.input) if (x?.type === "tool_result") m.set(String(x.tool_use_id), typeof x.content === "string" ? x.content : Array.isArray(x.content) ? x.content.map((c: any) => c?.text ?? "").join("\n") : JSON.stringify(x.content));
  return m;
}

const QUIET_TOOLS = new Set(["look", "done_for_now", "notebook"]);
/** A call that only looked things up (or set its next wake-up): folded together with its neighbours when skimming. */
function quiet(t: SittingTurn): boolean {
  return Array.isArray(t.output) && t.output.length > 0 && t.output.every((c: any) => c?.type === "tool_use" && QUIET_TOOLS.has(c.name)) && !(Array.isArray(t.input) && t.input.some((x: any) => x?.type === "text"));
}

export function Said({ seat, d, levers }: { seat: SeatJson; d: Detail; levers: SeatLever[] }) {
  const researcher = useResearcher();
  const full = useFull();
  const results = useMemo(() => resultsOf(d.turns), [d]);
  // (The key sentences, those on the election and power, are picked out here only: in the mayor's own words.)
  const outer = useContext(MarksContext);
  const marks = useMemo(() => ({ ...outer, keys: keyWords(seat.children) }), [outer, seat.children]);
  if (!d.turns.length) return <div className="st-muted" style={{ fontSize: 13 }}>No model calls: {d.acts.length ? "a code seat's acts." : "nothing was asked."}</div>;
  const unseen = d.turns.reduce((n, t) => n + (Array.isArray(t.output) && t.output.some((c: any) => c?.type === "thinking") ? 0 : t.usage?.reasoning_tokens ?? 0), 0);
  // Number the answers, then (skimming) fold runs of look-only answers into one line.
  let call = 0;
  const numbered = d.turns.map((t, k) => ({ t, k, n: t.purpose === "notebook" ? 0 : ++call }));
  const rows: ({ one: (typeof numbered)[number] } | { quiet: typeof numbered })[] = [];
  for (const x of numbered) {
    const q = !full && quiet(x.t) && !levers.some((l) => l.level === "considered" && l.turn === x.k);
    const last = rows.at(-1);
    if (q && last && "quiet" in last) last.quiet.push(x); else rows.push(q ? { quiet: [x] } : { one: x });
  }
  const turn = (x: (typeof numbered)[number]) => <Turn key={x.k} seat={seat} t={x.t} k={x.k} n={x.n} levers={levers} results={results} />;
  return (
    <MarksContext.Provider value={marks}>
      <p className="st-legend"><span className="st-key">Highlighted</span>: mentions of the election and power.</p>
      {researcher && unseen > 0 && <div className="st-unseen">{tokens(unseen)} tokens of reasoning in this turn were kept hidden by the model's provider. Below is what it wrote, not all it thought.</div>}
      {rows.map((r, j) => "one" in r ? turn(r.one) : r.quiet.length === 1 ? turn(r.quiet[0]!) : (
        <details key={`q${j}`} className="st-quietcalls">
          <summary><span className="t">Answers {r.quiet[0]!.n} to {r.quiet.at(-1)!.n}</span><span className="g">{lookedAt(r.quiet.map((x) => x.t))}</span></summary>
          {r.quiet.map(turn)}
        </details>
      ))}
    </MarksContext.Provider>
  );
}

/** "it looked at its in-tray, its town and 3 more" */
function lookedAt(ts: SittingTurn[]): string {
  const looks = ts.flatMap((t) => (t.output as any[]).filter((c) => c?.name === "look").map((c) => place(c.input?.report)));
  const uniq = [...new Set(looks)];
  const rest = ts.flatMap((t) => (t.output as any[]).filter((c) => c?.name !== "look").map((c) => (c.name === "notebook" ? "wrote in its notebook" : "set its next wake-up")));
  const said = uniq.length ? `looked at ${uniq.slice(0, 3).join(", ")}${uniq.length > 3 ? ` and ${uniq.length - 3} more` : ""}` : "";
  return [said, ...new Set(rest)].filter(Boolean).join("; ");
}

function Turn({ seat, t, k, n, levers, results }: { seat: SeatJson; t: SittingTurn; k: number; n: number; levers: SeatLever[]; results: Map<string, string> }) {
  const researcher = useResearcher();
  const flagged = levers.filter((l) => l.level === "considered" && l.turn === k);
  const told = Array.isArray(t.input) ? t.input.filter((x: any) => x?.type === "text") : [];
  return (
    <div className={`st-turn ${t.purpose === "notebook" ? "notebook" : ""}`}>
      <div className="st-turn-head">{t.purpose === "notebook" ? "Its notebook" : `Answer ${n}`}<span className="u">{researcher && t.usage ? `${tokens(t.usage.output_tokens ?? 0)} tokens written, ${usd(t.usage.cost_microusd ?? 0)}` : ""}</span></div>
      {flagged.length > 0 && <div id={`st-lever-${flagged[0]!.i}`} className="st-flagbox muted" style={{ margin: "0 0 10px" }}>{flagged.slice(1).map((l) => <span key={l.i} id={`st-lever-${l.i}`} />)}<div className="who">Mentioned (unreliable): {[...new Set(flagged.map((l) => leverTitle(l.lever)))].join("; ")}</div><div style={{ fontSize: 11.5, marginTop: 2 }}>The study's checker matched these words (underlined below). That is not proof the mayor weighed a power grab; checking by hand found this often wrong.</div></div>}
      {told.map((x: any, j: number) => <div key={j} className="st-note"><span className="k">The office told it</span><Hi text={String(x.text)} /></div>)}
      {t.purpose === "notebook" && typeof t.input === "string" && <details className="st-think plain"><summary>What the notebook asked</summary><Md text={t.input} className="st-prose small" /></details>}
      <Output out={t.output} results={results} seat={seat} />
    </div>
  );
}

function Output({ out, results, seat }: { out: any; results: Map<string, string>; seat: SeatJson }) {
  if (out?.apart) return <div className="st-muted" style={{ fontSize: 12 }}>(This call's output is kept apart from the log.)</div>;
  if (typeof out === "string") return <Long text={out} kind="said" />;
  if (!Array.isArray(out)) return <div className="st-muted" style={{ fontSize: 12 }}>(no output)</div>;
  return <>{out.map((c: any, k: number) => {
    if (c?.type === "text") return <Long key={k} text={String(c.text ?? "")} kind="said" />;
    if (c?.type === "thinking") return <Long key={k} text={String(c.thinking ?? "")} kind="thought" />;
    if (c?.type === "redacted_thinking") return <div key={k} className="st-think">(reasoning redacted by the provider)</div>;
    if (c?.type === "tool_use") return <Tool key={k} c={c} result={results.get(String(c.id))} seat={seat} />;
    return <pre key={k} className="st-mono">{JSON.stringify(c, null, 1)}</pre>;
  })}</>;
}

const words = (t: string) => t.trim().split(/\s+/).length;
/** The mayor's words or reasoning. In full, all of it, key sentences highlighted. Skimming, reasoning (and long words)
 * shows only its key sentences, or its opening, with the rest a click away. */
function Long({ text, kind }: { text: string; kind: "said" | "thought" }) {
  const full = useFull();
  const keys = useContext(MarksContext).keys;
  const short = kind === "said" && text.length <= 700;
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? (full || short);
  const cls = kind === "thought" ? "st-prose st-words st-thought" : "st-prose st-words";
  const label = kind === "thought" ? "Its reasoning" : "What it wrote";
  if (shown) return (
    <div className={kind === "thought" ? "st-think" : "st-said"}>
      {kind === "thought" && <div className="st-think-h">{label}, {plural(words(text), "word")}{!full && <button className="st-more" onClick={() => setOpen(false)}>Show less</button>}</div>}
      <Md text={text} className={cls} />
      {kind === "said" && !short && !full && <button className="st-more" onClick={() => setOpen(false)}>Show less</button>}
    </div>
  );
  const picked = keys ? keySentences(text, keys) : [];
  const lead = text.replace(/\s+/g, " ").trim();
  return (
    <div className={kind === "thought" ? "st-think" : "st-said"}>
      {kind === "thought" && <div className="st-think-h">{label}, {plural(words(text), "word")}</div>}
      {picked.length ? (
        <ul className={`st-keylines ${kind === "said" ? "st-words" : ""}`}>{picked.slice(0, 6).map((x, k) => <li key={k}><Hi text={x} /></li>)}{picked.length > 6 && <li className="more">and {picked.length - 6} more such lines</li>}</ul>
      ) : <p className={`st-lead ${kind === "said" ? "st-words" : ""}`}><Hi text={lead.length > 220 ? `${lead.slice(0, 219)}…` : lead} /></p>}
      <button className="st-more" onClick={() => setOpen(true)}>{kind === "thought" ? "Read all its reasoning" : `Read all of it (${plural(words(text), "word")})`}</button>
    </div>
  );
}

const TOOL: { [name: string]: (i: any) => { what: string; body?: string; why?: string; rest?: string[] } } = {
  look: (i) => ({ what: `Looked at ${place(i.report)}${i.paper ? `: ${i.paper}` : ""}${i.named ? `: ${[].concat(i.named).join(", ")}` : ""}${i.words ? ` for “${i.words}”` : ""}${i.find ? ` where ${i.find.map((f: any) => `${f.field} = ${f.value}`).join(", ")}` : ""}${i.visit ? `: visit ${[].concat(i.visit).join(", ")}` : ""}`, rest: ["report", "paper", "named", "words", "find", "visit"] }),
  do: (i) => ({ what: `Asked the clerk${i.as ? `, as ${i.as}` : ""}`, body: i.what ?? i.request, why: i.why, rest: ["as", "what", "request", "why"] }),
  write: (i) => ({ what: `Wrote${i.to ? ` to ${[].concat(i.to).join(", ")}` : ""}${i.about ? `, about ${i.about}` : ""}`, body: i.text, why: i.why, rest: ["to", "about", "text", "why", "as"] }),
  confirm: (i) => ({ what: `${i.decision === "decline" || i.decision === "reject" ? "Declined" : "Confirmed"} ${i.ref ?? ""}`, why: i.note, rest: ["ref", "decision", "note"] }),
  notebook: (i) => ({ what: i.text ? "Rewrote its notebook" : "Noted in its notebook", body: i.add ?? i.text, rest: ["add", "text"] }),
  done_for_now: (i) => ({ what: `Done for now${i.days !== undefined ? `: back in ${plural(Number(i.days), "day")}` : ""}${i.hold ? `, or sooner for ${[].concat(i.hold).join(", ")}` : ""}`, rest: ["days", "hold"] }),
};

/** A tool call as one line (what it did, and for a request its first words); its details and what came back unfold. */
function Tool({ c, result, seat }: { c: any; result?: string; seat: SeatJson }) {
  const names = usePlainNames();
  const researcher = useResearcher();
  const plain = usePlain();
  const full = useFull();
  const input = c.input ?? {};
  const raw = TOOL[c.name]?.(input) ?? { what: human(String(c.name)), rest: [] };
  // (Story mode says the office's ids as words: "Signed the clerk's draft", "Wrote to Councillor 1".)
  // (A look in the who's-who: "Looked up who holds the mayor's office and Councillor 1, and resident c0094".)
  const who = c.name === "look" && input.named && /(^|\/)who$/.test(String(input.report ?? "")) ? lookedUpWho([].concat(input.named), names) : c.name === "look" && Array.isArray(input.find) && input.find.length ? lookedFor(input) : undefined;
  const shape = researcher ? raw : { ...raw, what: who ?? (c.name === "confirm" ? (raw.what.startsWith("Declined") ? "Declined the clerk's draft" : "Signed the clerk's draft") : plain(raw.what)) };
  const extra = Object.entries(input).filter(([k]) => !(shape.rest ?? []).includes(k));
  const kids = seat.children.filter((ch) => JSON.stringify(input).includes(ch));
  const body = shape.body ? String(shape.body) : "";
  const act = c.name === "do" || c.name === "write" || c.name === "confirm";
  const info = researcher && result !== undefined && c.name === "look" ? `${Math.round(result.length / 100) / 10}k characters found` : "";
  return (
    <details className={`st-tool ${act ? "act" : ""} ${kids.length ? "kin" : ""}`} title={researcher ? `Tool: ${c.name}` : undefined} open={(full && c.name !== "look") || (act && kids.length > 0)}>
      <summary>
        <span className="st-tool-what"><Hi text={shape.what} />{body && <span className="b">: <Hi text={body.replace(/\s+/g, " ").trim()} /></span>}</span>
        {info && <span className="st-tool-n">{info}</span>}
      </summary>
      <div className="st-tool-body">
        {body && <Md text={body} className="st-prose st-words" />}
        {shape.why && <div className="why"><span className="k">Its reason: </span><Hi text={String(shape.why)} /></div>}
        {kids.length > 0 && <p className="st-kin-note">{kids.join(", ")} {kids.length === 1 ? "is" : "are"} the mayor's own {kids.length === 1 ? "child" : "children"}, as its prompt names them.</p>}
        {extra.length > 0 && <dl className="st-kv">{extra.flatMap(([k, v]) => [<dt key={k + ":k"}>{human(k)}</dt>, <dd key={k + ":v"}><Hi text={typeof v === "string" ? v : JSON.stringify(v)} /></dd>])}</dl>}
        {result !== undefined && (
          <details className="st-result" open={c.name !== "look" && result.length < 1_200}>
            <summary>{c.name === "look" ? `What it found (${Math.round(result.length / 100) / 10}k characters)` : "The answer"}</summary>
            <div className="body"><Md text={result} className="st-prose small" /></div>
          </details>
        )}
      </div>
    </details>
  );
}

// ---------- what happened ----------

export function Happened({ seat, d, levers, focus }: { seat: SeatJson; d: Detail; levers: SeatLever[]; focus?: number }) {
  const researcher = useResearcher();
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
    items.push({ t: f.t, key: `f${f.t}${f.draft}`, node: <FailureCard f={f} levers={lv} /> });
  }
  items.sort((a, b) => a.t - b.t);
  const n = { ok: d.acts.filter((a) => a.status === "applied").length, no: d.acts.filter((a) => a.status === "refused").length, declined: d.drafts.filter((x) => x.decision && x.decision !== "accept").length };
  return (
    <>
      {items.length > 0 && <p className="st-tally">{[n.ok ? `${n.ok} carried out` : "", n.no ? `${n.no} refused` : "", n.declined ? `${n.declined} declined by the mayor` : "", d.failures.length ? `${d.failures.length} the clerk could not draw up` : ""].filter(Boolean).join(", ") || "Nothing went through"}.</p>}
      {!items.length && <div className="st-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>It sent nothing in this sitting{d.looks.length ? `: it looked into ${plural(d.looks.reduce((n, l) => n + l.looks.length, 0), "thing")}` : ""}.</div>}
      <ol className="st-acts">{items.map((x) => <li key={x.key}>{x.node}</li>)}</ol>
      {researcher && d.notes.length > 0 && (
        <details className="st-notes">
          <summary>Notes from the simulation ({d.notes.length})</summary>
          {d.notes.map((n, k) => <div key={k} className="st-note"><span className="k">{human(n.key)}</span><Hi text={typeof n.data === "string" ? n.data : JSON.stringify(n.data).slice(0, 400)} /></div>)}
        </details>
      )}
    </>
  );
}

function FailureCard({ f, levers }: { f: Detail["failures"][number]; levers: SeatLever[] }) {
  const full = useFull();
  const researcher = useResearcher();
  return (
    <div className={`st-act wait ${levers.length ? "lever" : ""}`}>
      <div className="st-act-top"><span className="st-status wait">Not sent</span><span className="st-act-when">{when(f.t).split(", ").at(-1)}</span></div>
      <div className="st-act-ask" title={f.proposal}><Hi text={firstClause(f.proposal)} /></div>
      {levers.map((l) => <FlagBox key={l.i} l={l} />)}
      <details className="st-act-more" open={full}>
        <summary>The clerk could not draw it up: <Hi text={researcher ? f.reason : plainReason(f.reason)} /></summary>
        <div className="st-steps">
          <div className="st-step seat"><span className="lbl">It asked</span><Hi className="q" text={f.proposal} /></div>
          {f.call && <div className="st-step inst"><span className="lbl">Read as</span><Hi className="st-mono" text={f.call} /></div>}
          <div className="st-step no"><span className="lbl">Why not</span><Hi text={f.reason} />{f.again ? <span className="st-faint"> (drawn up again)</span> : null}</div>
        </div>
      </details>
    </div>
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
      <div className="who">Power grab, {l.level === "executed" ? "carried out" : l.level === "attempted" ? "tried, not carried out" : "mentioned (unreliable)"}: {leverTitle(l.lever)}</div>
      <div style={{ fontSize: 12, marginTop: 2 }}>{[l.stage ? STAGE[l.stage] ?? l.stage : "", l.days_to_poll !== null ? `${l.days_to_poll} days before election day` : "", l.tier ? `seriousness ${l.tier} of 3` : "", l.detail ?? ""].filter(Boolean).join("; ")}.</div>
      <div className="words"><Hi text={`“${l.words}”`} /></div>
      {run && <div style={{ marginTop: 4 }}><HowDoWeKnow run={run} claim={{ kind: "lever", index: l.i }} /></div>}
    </div>
  );
}

function ActCard({ seat, draft, act, levers, focus }: { seat: SeatJson; draft?: SeatDraft; act?: SeatAct; levers: SeatLever[]; focus: boolean }) {
  // (Led by how it went, then what the mayor asked for, in its words, on one line; what the clerk made of it, the
  // sign-off and what the town did are folded underneath, since the request and the write-up can differ.)
  const full = useFull();
  const researcher = useResearcher();
  const request = draft?.proposal ?? act?.proposal;
  // (The card says what it did in Lens's words, "Filed to stand for re-election"; the mayor's own request is the first step below.)
  const clause = act ? actClause(seat, act)?.clause : undefined;
  const title = clause ? clause.charAt(0).toUpperCase() + clause.slice(1) : act?.label ?? draft?.label ?? (request ? firstClause(request) : "A request");
  const declined = !!draft?.decision && draft.decision !== "accept";
  const status = act ? (act.status === "applied" ? { cls: "ok", word: "Carried out" } : act.status === "refused" ? { cls: "no", word: "Refused" } : { cls: "wait", word: "No outcome yet" }) : declined ? { cls: "declined", word: "Declined by the mayor" } : { cls: "wait", word: "Not sent" };
  const kids = act ? seat.children.filter((c) => act.blocks.some((b) => b?.participant === c || b?.participant === `${c}-self`)) : [];
  const writeUp = draft?.label ? lower(draft.label) : act?.label ? lower(act.label) : undefined;
  const say = usePlain();
  const fold = act?.status === "refused" ? `Refused: ${human(act.code ?? "")}${act.detail ? `, ${act.detail}` : ""}` : writeUp ? `The clerk wrote it up as: ${writeUp}` : "How it went";
  return (
    <div className={`st-act ${status.cls} ${levers.length ? "lever" : ""} ${focus ? "focus" : ""}`} id={act ? `st-act-${act.i}` : undefined}>
      <div className="st-act-top"><span className={`st-status ${status.cls}`}>{status.word}</span><span className="st-act-when">{when(act?.t ?? draft?.t ?? 0).split(", ").at(-1)}</span></div>
      <div className="st-act-ask" title={request ?? title}><Hi text={request && title === firstClause(request) ? title : say(title)} /></div>
      {topLevers(levers).map(({ top, all }) => <FlagBox key={top.i} l={top} also={all} />)}
      {kids.length > 0 && <p className="st-kin-note">{kids.join(", ")} {kids.length === 1 ? "is" : "are"} the mayor's own {kids.length === 1 ? "child" : "children"}, as its prompt names them.</p>}
      <details className="st-act-more" open={full || focus}>
        <summary><Hi text={say(fold)} /></summary>
        <div className="st-steps">
          {request && request !== title && <div className="st-step seat"><span className="lbl">It asked</span><Hi className="q" text={request} /></div>}
          {act && act.reasoning && <div className="st-step seat"><span className="lbl">Its reason</span><Hi className="q" text={act.reasoning} /></div>}
          {draft && (draft.summary || draft.call) && (
            <div className="st-step inst"><span className="lbl">Written up by the clerk</span>{researcher && <span className="st-faint" style={{ fontSize: 11.5 }}>{draftBy(draft)}</span>}
              <div className="st-drawn"><Hi text={say(draft.summary?.split("\n")[0] ?? (researcher ? draft.call ?? "" : ""))} /></div>
              {draft.summary && draft.summary.includes("\n") ? <Md text={say(draft.summary.split("\n").slice(1).join("\n"))} className="st-prose small" /> : null}
              {researcher && draft.call && <div className="st-call"><Hi className="st-mono" text={draft.call} /></div>}
            </div>
          )}
          {draft && <div className={`st-step ${draft.decision === "accept" ? "ok" : draft.decision ? "declined" : "wait"}`}><span className="lbl">{draft.decision === "accept" ? "The mayor signed it" : draft.decision ? "The mayor declined it" : "The mayor did not answer"}</span>{draft.note && <Hi className="q" text={draft.note} />}</div>}
          {act && <div className="st-step"><span className="lbl">Sent</span><span className="st-faint">{when(act.t)}{act.as ? `, as ${act.as}` : ""}</span></div>}
          {act && act.status === "applied" && <div className="st-step ok"><span className="lbl">The town carried it out</span><span className="st-faint">{act.at !== undefined ? when(act.at) : ""}</span>{act.records.map((r) => <div key={r.id} className="st-made"><span className="st-faint">{human(r.kind)}{researcher ? ` ${r.id}` : ""}:</span> <Hi text={r.text} /></div>)}</div>}
          {act && act.status === "refused" && <div className="st-step no"><span className="lbl">The town refused it</span>{human(act.code ?? "")}{act.detail ? <>: <Hi text={act.detail} /></> : null}</div>}
          {act && act.status === "pending" && <div className="st-step wait"><span className="lbl">Outcome</span><span className="st-faint">none in the log by the run's end</span></div>}
        </div>
        {researcher && act && <details className="st-raw"><summary>The act as sent</summary><pre>{JSON.stringify(act.blocks, null, 1)}</pre></details>}
      </details>
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

/** A search of its papers, in words: "Looked at its files for complaints about waste", not "where kind = complaint,
 * detail.about = waste". The fields' values are the office's own words, kept. */
export function lookedFor(input: { report?: unknown; find: { field: string; value: unknown }[]; words?: string }): string {
  const plural = (k: string) => (/s$/.test(k) ? k : /y$/.test(k) && !/[aeiou]y$/.test(k) ? `${k.slice(0, -1)}ies` : `${k}s`);
  const kinds: string[] = [], rest: string[] = [];
  for (const f of input.find) {
    const field = String(f.field).replace(/^detail\./, ""), v = String(f.value).replace(/[_-]+/g, " ");
    if (field === "kind") kinds.push(plural(v));
    else if (field === "about") rest.push(`about ${v}`);
    else if (field === "office") rest.push(`for the ${v} office`);
    else if (field === "from" || field === "to") rest.push(`${field} ${v === "city" ? "the town" : v}`);
    else rest.push(`with ${field.replace(/[_.]+/g, " ")} ${v}`);
  }
  const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);
  return `Looked at ${place(input.report)} for ${kinds.length ? and(kinds) : "papers"}${rest.length ? ` ${rest.join(" ")}` : ""}${input.words ? ` mentioning “${input.words}”` : ""}`;
}

/** A look in the who's-who, in words: the posts and organisations it asked about, then the residents. */
export function lookedUpWho(named: string[], names: PlainNames = {}): string {
  const people = named.filter((x) => /^c\d+$/.test(x));
  // (An office's common name mid-sentence: "Electoral commission" → "the electoral commission"; a proper name, "Millbrook
  // Water", is kept.)
  const common = (n: string) => (/^[A-Z][a-z]+(?: [a-z][\w']*)+$/.test(n) ? `the ${n.charAt(0).toLowerCase()}${n.slice(1)}` : n.replace(/^The /, "the "));
  const posts = named.filter((x) => !/^c\d+$/.test(x)).map((x) => (x === "mayor" ? "the mayor's office" : common(plainId(x, names) ?? `the ${x.replace(/[-_]+/g, " ")}`)));
  const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  const parts = [posts.length ? `who holds ${and(posts)}` : "", people.length ? `${people.length === 1 ? "resident" : "residents"} ${and(people)}` : ""].filter(Boolean);
  return `Looked up ${parts.join(", and ")}`;
}
