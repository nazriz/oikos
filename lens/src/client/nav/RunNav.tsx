// The run bar's way-finding: the trail (Library, the run, the day and turn, the person or building open) where each
// step jumps back, and the switcher to the same moment in another run of the same town.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Catalogue, RunEntry } from "../../shared/api";
import { fetchCatalogue } from "../api";
import { dayOf } from "../format";
import { readingOutcome } from "../outcome";
import { runHref, selToken } from "../router";
import { useLens } from "../state";
import { goalText, modelName } from "../words";
import { goTo, isMoment, runLabel, useNames, useNav } from "./nav";
import { useMode } from "../mode";
import { isControl } from "../story/Findings";
import "./nav.css";

/** "Library > GLM 5.3, town 7 > Day 121, turn 1 > Ada Brook": where you are, each step a way back. */
export function Crumbs({ run, entry }: { run: string; entry?: RunEntry }) {
  const trail = useNav((s) => s.trail);
  const day = useLens((s) => dayOf(s.t));
  const { name } = useNames(run);
  const moment = trail.find(isMoment);
  const thing = trail.find((x) => !isMoment(x));
  const closeAll = () => useLens.getState().select(null);
  return (
    <nav className="crumbs" aria-label="Where you are">
      <a className="crumb" href="#/" title="All runs (g then l)">
        Library
      </a>
      <Sep />
      {trail.length ? (
        <button className="crumb" onClick={closeAll} title="Close what is open and see the whole run">
          {runLabel(entry) || "This run"}
        </button>
      ) : (
        <span className="crumb here">{runLabel(entry) || "This run"}</span>
      )}
      <Switcher run={run} entry={entry} />
      <Sep />
      {moment ? (
        thing ? (
          <button className="crumb" data-peek={selToken(moment)} onClick={() => goTo(moment)} title="Back to this (Esc)">
            {name(moment)}
          </button>
        ) : (
          <span className="crumb here">{name(moment)}</span>
        )
      ) : thing ? (
        <button className="crumb" onClick={closeAll} title="Close and stay on this day (Esc)">
          Day {day}
        </button>
      ) : (
        <span className="crumb here">Day {day}</span>
      )}
      {thing && (
        <>
          <Sep />
          <span className="crumb here">{name(thing)}</span>
        </>
      )}
    </nav>
  );
}

const Sep = () => (
  <svg className="crumb-sep" viewBox="0 0 6 10" aria-hidden="true">
    <path d="M1 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

let catalogue: Promise<Catalogue> | null = null;
const getCatalogue = () => (catalogue ??= fetchCatalogue().catch((e) => ((catalogue = null), Promise.reject(e))));

interface Peer {
  key: string;
  name: string;
  note: string;
  isCode: boolean;
}

/** Runs of the same town (same seed, same day the AI took office): other models with the same instructions, the rule-based
 * mayor, and this model under other instructions. One per model: the finished, most recent run. */
export function peersOf(runs: RunEntry[], me: RunEntry): { same: Peer[]; other: Peer[]; controls: Peer[] } {
  const x = me.experiment;
  if (!x) return { same: [], other: [], controls: [] };
  // (Rehearsals and mock runs are tests of the machinery, not mayors.)
  const town = runs.filter((r) => r.key !== me.key && !/rehearsal|mock/.test(r.group) && r.experiment && r.experiment.seed === x.seed && r.experiment.forkDay === x.forkDay && r.experiment.post === x.post);
  const rank = (r: RunEntry) => (r.experiment!.stopped ? 0 : 4) + (r.group === me.group ? 2 : 0) + (r.indexed ? 1 : 0);
  const best = (list: RunEntry[], by: (r: RunEntry) => string) => {
    const m = new Map<string, RunEntry>();
    for (const r of list) {
      const k = by(r), cur = m.get(k);
      if (!cur || rank(r) > rank(cur) || (rank(r) === rank(cur) && r.mtimeMs > cur.mtimeMs)) m.set(k, r);
    }
    return [...m.values()];
  };
  const note = (r: RunEntry) => {
    const rd = r.reading;
    if (!rd) return r.experiment!.stopped ? "Stopped early" : "";
    const grab = r.experiment!.isCode ? "" : rd.levers?.tried ? `Tried ${rd.levers.tried === 1 ? "a power grab" : `${rd.levers.tried} power grabs`}.` : "No power grab.";
    const out = readingOutcome(rd);
    return [grab, out ? `${out.label}.` : ""].filter(Boolean).join(" ");
  };
  const peer = (r: RunEntry, label: string): Peer => ({ key: r.key, name: label, note: note(r), isCode: r.experiment!.isCode });
  // The rule-based mayor: this run's own twin first.
  const twin = (x.twin && runs.find((r) => r.key === x.twin)) || (x.isCode ? undefined : best(town.filter((r) => r.experiment!.isCode && r.experiment!.goal === x.goal), () => "code")[0]);
  // (Scripted controls and rope tests are not mayors: story's rule, plus the older pilots' control names.)
  const control = (m: string) => isControl(m) || /^(diligent|skip|delay|overstep|nobody|rubber)/i.test(m);
  const peersBy = (keep: (m: string) => boolean) =>
    best(
      town.filter((r) => !r.experiment!.isCode && r.experiment!.goal === x.goal && r.experiment!.model !== x.model && keep(r.experiment!.model)),
      (r) => r.experiment!.model,
    ).sort((a, b) => modelName(a.experiment!.model).localeCompare(modelName(b.experiment!.model)));
  const models = peersBy((m) => !control(m));
  const controls = peersBy(control).map((r) => peer(r, modelName(r.experiment!.model)));
  const same = [...models.map((r) => peer(r, modelName(r.experiment!.model))), ...(twin && twin.key !== me.key ? [peer(twin, "The rule-based mayor")] : [])];
  const other = x.isCode
    ? []
    : best(town.filter((r) => !r.experiment!.isCode && r.experiment!.model === x.model && r.experiment!.goal !== x.goal), (r) => r.experiment!.goal).map((r) => peer(r, goalText(r.experiment!.goal)));
  return { same, other, controls };
}

/** "Same town, other mayors": opens the same day (and the same person or building) in another run. */
function Switcher({ run, entry }: { run: string; entry?: RunEntry }) {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunEntry[]>();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (entry?.experiment) getCatalogue().then((c) => setRuns(c.runs), () => {});
  }, [entry]);
  const peers = useMemo(() => (runs && entry ? peersOf(runs, entry) : { same: [], other: [], controls: [] }), [runs, entry]);
  const researcher = useMode((m) => m.mode === "researcher");
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", off);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", off);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
  const n = peers.same.length + peers.other.length + (researcher ? peers.controls.length : 0);
  if (!entry?.experiment || !n) return null;
  // The same moment there: the time, and a person, building or organisation (the towns share them); a turn is this run's own.
  const href = (key: string) => {
    const s = useLens.getState();
    const keep = s.selection && !isMoment(s.selection) ? selToken(s.selection) : undefined;
    return runHref(key, { t: Math.round(s.t), sel: keep });
  };
  const go = (e: React.MouseEvent<HTMLAnchorElement>, key: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    setOpen(false);
    window.location.hash = href(key);
  };
  return (
    <div className="switcher" ref={box}>
      <button className="switcher-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="The same day in this town, under another mayor">
        Other mayors
        <svg viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {open && (
        <div className="switcher-pop" role="menu" data-esc-own="">
          <p className="switcher-lead">Open the same day in this town under another mayor.</p>
          <PeerList title="Same town, same instructions" peers={peers.same} href={href} go={go} />
          <PeerList title={`${modelName(entry.experiment.model)}, other instructions`} peers={peers.other} href={href} go={go} />
          {researcher && <PeerList title="Test mayors (scripted controls, not AI models)" peers={peers.controls} href={href} go={go} />}
        </div>
      )}
    </div>
  );
}

function PeerList({ title, peers, href, go }: { title: string; peers: Peer[]; href: (k: string) => string; go: (e: React.MouseEvent<HTMLAnchorElement>, k: string) => void }) {
  if (!peers.length) return null;
  return (
    <>
      <h3 className="switcher-h">{title}</h3>
      <ul>
        {peers.map((p) => (
          <li key={p.key}>
            <a role="menuitem" href={href(p.key)} onClick={(e) => go(e, p.key)}>
              <b>{p.name}</b>
              {p.note && <span>{p.note}</span>}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
