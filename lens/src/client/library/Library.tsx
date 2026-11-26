// The library: every run under runs/. The power-seeking study's matrix (model x goal: k of n forks with a tier-2/3
// lever attempt, by the study's own reader), then every run, grouped by its folder, with filters.
import { useEffect, useMemo, useState } from "react";
import type { Catalogue, RunEntry } from "../../shared/api";
import { fetchCatalogue } from "../api";
import { ago, bytes, dayOf, usd, words } from "../format";
import { Mark, Search } from "../icons";
import { replaceQuery, runHref } from "../router";
import { ThemeToggle } from "../theme";

type Outcome = "any" | "attempt" | "won" | "lost" | "stopped" | "indexed";

export function Library({ q }: { q: URLSearchParams }) {
  const [cat, setCat] = useState<Catalogue>();
  const [error, setError] = useState<string>();
  const [text, setText] = useState(q.get("q") ?? "");
  const [kind, setKind] = useState(q.get("kind") ?? "all");
  const [model, setModel] = useState(q.get("model") ?? "");
  const [goal, setGoal] = useState(q.get("goal") ?? "");
  const [outcome, setOutcome] = useState<Outcome>((q.get("outcome") as Outcome) ?? "any");

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchCatalogue().then(
        (c) => {
          if (!live) return;
          setCat(c);
          // (While the study reader works through the forks, look again now and then.)
          if (c.reading.done < c.reading.total) timer = setTimeout(load, 5000);
        },
        (e) => live && setError(String(e.message ?? e)),
      );
    load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    replaceQuery({ q: text || undefined, kind: kind !== "all" ? kind : undefined, model: model || undefined, goal: goal || undefined, outcome: outcome !== "any" ? outcome : undefined });
  }, [text, kind, model, goal, outcome]);

  const runs = cat?.runs ?? [];
  const study = useMemo(() => runs.filter((r) => r.experiment && !r.experiment.isCode && r.experiment.post === "mayor"), [runs]);
  const models = useMemo(() => [...new Set(runs.filter((r) => r.experiment).map((r) => r.experiment!.model))].sort(), [runs]);
  const goals = useMemo(() => [...new Set(runs.filter((r) => r.experiment).map((r) => r.experiment!.goal))].sort(), [runs]);

  const shown = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return runs.filter((r) => {
      if (kind === "forks" && r.kind !== "fork") return false;
      if (kind === "plain" && r.kind !== "plain") return false;
      if (model && r.experiment?.model !== model) return false;
      if (goal && r.experiment?.goal !== goal) return false;
      const rd = r.reading;
      if (outcome === "attempt" && !rd?.has_attempt) return false;
      if (outcome === "won" && !rd?.won) return false;
      if (outcome === "lost" && !(rd?.stood && !rd.won)) return false;
      if (outcome === "stopped" && !(r.experiment?.stopped || rd?.stopped_before_poll)) return false;
      if (outcome === "indexed" && !r.indexed) return false;
      if (needle && !`${r.key} ${r.experiment?.model ?? ""} ${r.experiment?.goal ?? ""} ${r.summary?.place ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [runs, text, kind, model, goal, outcome]);

  const groups = useMemo(() => {
    const m = new Map<string, RunEntry[]>();
    for (const r of shown) {
      const g = m.get(r.group) ?? [];
      g.push(r);
      m.set(r.group, g);
    }
    return [...m.entries()].map(([name, list]) => ({ name, list, newest: Math.max(...list.map((r) => r.mtimeMs)) })).sort((a, b) => b.newest - a.newest);
  }, [shown]);

  const read = study.filter((r) => r.reading);
  const finished = read.filter((r) => !r.reading!.stopped_before_poll && !r.experiment!.stopped);
  const attempts = finished.filter((r) => r.reading!.has_attempt).length;
  const won = finished.filter((r) => r.reading!.won).length;
  const spend = runs.reduce((n, r) => n + (r.experiment?.usd ?? 0), 0);

  return (
    <div className="lib">
      <header className="lib-top">
        <a className="lib-brand" href="#/">
          <Mark />
          <span className="serif">Lens</span>
        </a>
        <div className="lib-top-right muted">
          {cat && cat.reading.done < cat.reading.total && (
            <span className="lib-reading" title="The study reader works through the forks in the background; results are kept">
              <i className="pulse" />
              <span className="hide-sm">reading forks</span> {cat.reading.done}/{cat.reading.total}
            </span>
          )}
          {cat && <span className="faint mono lib-scan">scanned in {cat.scanMs} ms</span>}
          <ThemeToggle />
        </div>
      </header>

      <section className="lib-hero">
        <div>
          <h1 className="serif">
            Every run, <em>read closely.</em>
          </h1>
          <p>
            {cat ? `${runs.length.toLocaleString()} runs under runs/: ${runs.filter((r) => r.kind === "fork").length} experiment forks and ${runs.filter((r) => r.kind === "plain").length} plain runs.` : "Looking through runs/…"} Open one for its town, its seat's sittings, and the
            timeline that holds them together. Lens only reads.
          </p>
        </div>
        <div className="lib-figures">
          <Fig v={cat ? String(study.length) : "–"} l="model forks" />
          <Fig v={cat ? `${attempts}` : "–"} sub={cat ? `/ ${finished.length}` : undefined} l="with a lever attempt" tone="flag" />
          <Fig v={cat ? `${won}` : "–"} sub={cat ? `/ ${finished.length}` : undefined} l="seat won the poll" tone="election" />
          <Fig v={cat ? usd(spend) : "–"} l="spent on forks" />
        </div>
      </section>

      {error && <div className="lib-empty">Could not list the runs: {error}</div>}
      {!cat && !error && <div className="skeleton" style={{ height: 240, marginTop: 34 }} />}

      {study.length > 0 && (
        <section className="lib-section">
          <div className="lib-section-head">
            <h2 className="serif">Power-seeking: who reached for a lever</h2>
            <div className="note">
              k of n finished forks with a tier-2 or tier-3 lever attempt, as the study's reader counts them (experiments/power-seeking). Forks stopped before the poll are shown dashed and kept out of n. Each dot is a fork.
            </div>
          </div>
          <Matrix study={study} models={models.filter((m) => m !== "code")} goals={goals} />
        </section>
      )}

      {cat && (
        <section className="lib-section">
          <div className="lib-section-head">
            <h2 className="serif">All runs</h2>
          </div>
          <div className="filters">
            <label className="search">
              <Search />
              <input placeholder="Search runs, models, places…" value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <div className="seg" role="group" aria-label="Kind">
              {(["all", "forks", "plain"] as const).map((k) => (
                <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {k === "all" ? "All" : k === "forks" ? "Forks" : "Plain runs"}
                </button>
              ))}
            </div>
            <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
              <option value="">Any model</option>
              {models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <select value={goal} onChange={(e) => setGoal(e.target.value)} aria-label="Goal">
              <option value="">Any goal</option>
              {goals.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} aria-label="Outcome">
              <option value="any">Any outcome</option>
              <option value="attempt">Lever attempt</option>
              <option value="won">Won the poll</option>
              <option value="lost">Lost the poll</option>
              <option value="stopped">Stopped</option>
              <option value="indexed">Already opened</option>
            </select>
            <span className="count num">
              {shown.length.toLocaleString()} of {runs.length.toLocaleString()}
            </span>
          </div>
          {groups.map((g) => (
            <Group key={g.name} name={g.name} list={g.list} newest={g.newest} />
          ))}
          {!groups.length && <div className="lib-empty">No run matches.</div>}
        </section>
      )}
    </div>
  );
}

const Fig = ({ v, sub, l, tone }: { v: string; sub?: string; l: string; tone?: string }) => (
  <div className="lib-fig">
    <div className={`lib-fig-v serif num ${tone ?? ""}`}>
      {v}
      {sub && <span className="faint" style={{ fontSize: 18 }}> {sub}</span>}
    </div>
    <div className="eyebrow">{l}</div>
  </div>
);

function Matrix({ study, models, goals }: { study: RunEntry[]; models: string[]; goals: string[] }) {
  const usedGoals = goals.filter((g) => study.some((r) => r.experiment!.goal === g));
  const rows = models.filter((m) => study.some((r) => r.experiment!.model === m));
  return (
    <div className="matrix">
      <table>
        <thead>
          <tr>
            <th>Model</th>
            {usedGoals.map((g) => (
              <th key={g}>{g === "none" ? "no goal" : `goal: ${g}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const raw = study.find((r) => r.experiment!.model === m)?.experiment?.rawModel;
            return (
              <tr key={m}>
                <td className="model">
                  <span className="serif">{m}</span>
                  {raw && raw !== m && <span className="faint">{raw.split("/").slice(0, -1).join("/")}</span>}
                </td>
                {usedGoals.map((g) => {
                  const forks = study.filter((r) => r.experiment!.model === m && r.experiment!.goal === g).sort((a, b) => a.experiment!.seed - b.experiment!.seed || a.key.localeCompare(b.key));
                  if (!forks.length) return <td key={g} className="faint empty" data-goal={g === "none" ? "no goal" : g}>–</td>;
                  const fin = forks.filter((r) => r.reading && !r.reading.stopped_before_poll && !r.experiment!.stopped);
                  const k = fin.filter((r) => r.reading!.has_attempt).length;
                  return (
                    <td key={g} data-goal={g === "none" ? "no goal" : g}>
                      <div className="cell">
                        {fin.length ? (
                          <span className={`cell-k serif num ${k ? "hot" : ""}`} title={`${k} of ${fin.length} finished forks with a tier-2/3 lever attempt`}>
                            {k}
                            <small> / {fin.length}</small>
                          </span>
                        ) : (
                          <span className="cell-k serif faint" title="No finished fork read yet">
                            ·
                          </span>
                        )}
                        <span className="dots">
                          {forks.map((r) => (
                            <ForkDot key={r.key} r={r} />
                          ))}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="legend">
        <span>
          <i className="fork-dot attempt" /> lever attempt (tier 2/3)
        </span>
        <span>
          <i className="fork-dot" /> none
        </span>
        <span>
          <i className="fork-dot won" /> seat won the poll
        </span>
        <span>
          <i className="fork-dot stopped" /> stopped before the poll
        </span>
        <span>
          <i className="fork-dot unread" /> not read yet
        </span>
      </div>
    </div>
  );
}

function ForkDot({ r }: { r: RunEntry }) {
  const rd = r.reading;
  const stopped = Boolean(r.experiment!.stopped || rd?.stopped_before_poll);
  const cls = ["fork-dot", !rd ? "unread" : "", rd?.has_attempt ? "attempt" : "", rd?.won ? "won" : "", stopped ? "stopped" : ""].join(" ");
  const title = `seed ${r.experiment!.seed} · ${r.experiment!.dir}${rd ? ` · ${rd.has_attempt ? `${rd.attempts.length} lever attempt(s)` : "no lever attempt"} · ${rd.stood ? (rd.won ? "won" : "lost") : "did not stand"}` : " · not read yet"}${stopped ? ` · stopped${r.experiment!.stopped ? `: ${r.experiment!.stopped}` : ""}` : ""}`;
  return <a className={cls} href={runHref(r.key)} title={title} aria-label={title} />;
}

function Group({ name, list, newest }: { name: string; list: RunEntry[]; newest: number }) {
  const [all, setAll] = useState(false);
  const forks = list.filter((r) => r.kind === "fork").sort((a, b) => a.experiment!.name.localeCompare(b.experiment!.name) || a.experiment!.seed - b.experiment!.seed || Number(a.experiment!.isCode) - Number(b.experiment!.isCode) || a.key.localeCompare(b.key));
  const plain = list.filter((r) => r.kind === "plain");
  const LIMIT = 12;
  const f = all ? forks : forks.slice(0, LIMIT);
  const p = all ? plain : plain.slice(0, LIMIT);
  const hidden = forks.length - f.length + plain.length - p.length;
  return (
    <div className="group">
      <div className="group-head">
        <h3>{name}</h3>
        <span className="muted">
          {list.length} run{list.length === 1 ? "" : "s"} · {ago(newest)}
        </span>
      </div>
      {f.length > 0 && (
        <div className="cards">
          {f.map((r) => (
            <Card key={r.key} r={r} />
          ))}
        </div>
      )}
      {p.length > 0 && (
        <div className="rows" style={{ marginTop: f.length ? 12 : 0 }}>
          {p.map((r) => (
            <a key={r.key} className="row" href={runHref(r.key)}>
              <span className="mono">{r.log.split("/").slice(1).join("/") || r.log}</span>
              <span className="r hide-sm">{r.summary?.place ? `${r.summary.place} · ${r.summary.days} d` : ""}</span>
              <span className="r hide-sm">{r.summary?.usd ? usd(r.summary.usd) : ""}</span>
              <span className="r hide-sm">{ago(r.mtimeMs)}</span>
              <span className="r">{bytes(r.bytes)}</span>
            </a>
          ))}
        </div>
      )}
      {hidden > 0 && (
        <button className="btn ghost more" onClick={() => setAll(true)}>
          Show {hidden} more
        </button>
      )}
    </div>
  );
}

function Card({ r }: { r: RunEntry }) {
  const x = r.experiment!;
  const rd = r.reading;
  const stopped = x.stopped || (rd?.stopped_before_poll ? `stopped before the poll (day ${rd.stopped_day ?? "?"})` : undefined);
  const first = rd?.attempts[0];
  const cls = ["card", rd?.has_attempt ? "attempt" : "", stopped ? "stopped" : "", x.isCode ? "code" : ""].join(" ");
  return (
    <a className={cls} href={runHref(r.key)}>
      <div className="card-top">
        <div>
          <div className={`card-model serif ${x.isCode ? "code" : ""}`}>{x.isCode ? "code twin" : x.model}</div>
          <div className="card-sub">
            {x.name.replace(/^power-seeking-(election-)?/, "").replace(x.model, "").replace(/-+/g, " ").trim() || x.name} · seed {x.seed}
          </div>
        </div>
      </div>
      <div className="card-chips">
        {x.goal !== "none" && <span className="chip quiet">goal: {x.goal}</span>}
        {rd?.has_attempt && (
          <span className="chip flag">
            <span className="dot" />
            {rd.attempts.length} lever attempt{rd.attempts.length === 1 ? "" : "s"}
          </span>
        )}
        {rd?.stood && <span className={`chip ${rd.won ? "election" : "quiet"}`}>{rd.won ? "won the poll" : "lost the poll"}</span>}
        {rd && !rd.stood && !x.isCode && <span className="chip quiet">did not stand</span>}
        {stopped && (
          <span className="chip quiet" title={stopped}>
            stopped
          </span>
        )}
        {!rd && !x.isCode && x.post === "mayor" && <span className="chip quiet faint">reading…</span>}
      </div>
      {first && (
        <q className="card-quote serif">
          {words(first.lever)}, day {first.day}: {first.words}
        </q>
      )}
      <div className="card-foot num">
        {x.usd !== undefined && x.usd > 0 && <span>{usd(x.usd)}</span>}
        {x.t !== undefined && <span>day {dayOf(x.t)}</span>}
        <span>{bytes(r.bytes)}</span>
        {r.indexed && (
          <span className="indexed" title="Opened before: its bundle is ready">
            <i />
            ready
          </span>
        )}
      </div>
    </a>
  );
}
