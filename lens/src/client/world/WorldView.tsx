// The town in 3D: a second view of the run page's map slot and a full-screen route of its own. It reads the city's
// folds (town, people) through the city's loader, the `world` fold (vehicles, weather) and the seat fold's election,
// and follows Lens's one clock: scrub the timeline and everyone in the town moves to where they were.
import { useEffect, useMemo, useRef, useState } from "react";
import { useCity } from "../city/CityView";
import { fetchFold } from "../api";
import { useLens } from "../state";
import type { WorldBundle } from "../../folds/world";
import { WorldEngine, type Info, type Mode } from "./engine";
import type { Weather } from "./sky";
import { WORLD_CSS } from "./style";
import { buildSteps, Tour } from "../city/Tour";
import { actSentence } from "../city/words";
import { plainWords } from "../story/text";

export interface WorldViewProps {
  run: string;
  /** Where the bundle is served; defaults to `/api/run/<key>`. */
  base?: string;
  /** Start the camera here: target (metres), distance, tilt and turn (degrees). */
  view?: { target: [number, number, number]; dist: number; tilt: number; turn: number };
  /** Start in this mode. */
  mode?: Mode;
  /** False while the view is hidden (kept mounted under the map): the engine stops drawing. */
  active?: boolean;
  /** Dev only: show this weather whatever the run's. */
  weather?: Weather;
}

const WEATHER_WORDS: Record<Weather, string> = { clear: "", heavy_rain: "Heavy rain.", heatwave: "A heatwave.", drought: "Drought." };

export function WorldView({ run, base, view, mode: startMode, weather, active = true }: WorldViewProps) {
  const url = base ?? `/api/run/${encodeURIComponent(run)}`;
  const { city, error } = useCity(url);
  const [extra, setExtra] = useState<{ world?: WorldBundle; election?: { poll_at?: number; result_at?: number }; seat?: any } | null>(null);
  const [tourAt, setTourAt] = useState<number | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<WorldEngine | null>(null);
  const [mode, setMode] = useState<Mode>("fly");
  const [info, setInfo] = useState<Info | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const selection = useLens((s) => s.selection);

  useEffect(() => {
    let live = true;
    Promise.all([
      fetchFold<WorldBundle>(run, "world").catch(() => undefined),
      fetchFold<any>(run, "seat").catch(() => undefined),
    ]).then(([world, seat]) => { if (live) setExtra({ world, election: seat?.election ?? undefined, seat }); });
    return () => { live = false; };
  }, [run]);

  useEffect(() => {
    if (!city || !extra || !host.current) return;
    let e: WorldEngine;
    try {
      const bySeq = new Map(city.town.acts.map((a) => [a.seq, a] as const));
      const caption = (seq: number) => { const a = bySeq.get(seq); return a ? plainWords(actSentence(city.town, a)) : undefined; };
      e = new WorldEngine(host.current, { city, world: extra.world, election: extra.election }, { onMode: setMode, onInfo: setInfo, caption, onReady: () => setReady(true) });
    } catch (err) {
      setFailed(String((err as Error)?.message ?? err));
      return;
    }
    engine.current = e;
    if (view) e.setView(view.target, view.dist, view.tilt, view.turn);
    if (startMode) setTimeout(() => e.setMode(startMode), 800);
    if (weather) e.forceWeather = weather;
    (window as any).__world = e;
    return () => { e.dispose(); engine.current = null; setReady(false); };
  }, [city, extra]);

  useEffect(() => { engine.current?.setActive(active); }, [active, ready]);
  const pick = (m: Mode) => engine.current?.setMode(m);
  // The tour: the run's key moments (the city map's steps, from the story fold), each a camera move through the town.
  const steps = useMemo(() => (city ? buildSteps(city, extra?.seat ?? null) : []), [city, extra]);
  useEffect(() => {
    if (tourAt === null || !engine.current) return;
    const step = steps[tourAt];
    if (!step) return;
    const st = useLens.getState();
    st.setPlaying(false);
    st.setT(step.t);
    engine.current.tourTo(step.acts, !!step.election);
    engine.current.invalidate();
  }, [tourAt, steps]);
  const endTour = () => { setTourAt(null); engine.current?.endTour(); };
  const canFollow = selection?.kind === "person";
  // The key is on request; the walking hint shows for a few seconds after Walk is chosen.
  const [keyOpen, setKeyOpen] = useState(false);
  const [hint, setHint] = useState(false);
  useEffect(() => { if (mode !== "walk") return; setHint(true); const id = setTimeout(() => setHint(false), 8000); return () => clearTimeout(id); }, [mode]);

  return (
    <div className="lens-world">
      <style>{WORLD_CSS}</style>
      <div ref={host} className="lw-host" />
      {(!city || !extra || !ready) && !failed && <div className="lw-loading">{error ? `The town could not be read: ${error}` : "Building the town"}</div>}
      {failed && <div className="lw-loading">This browser could not draw the town in 3D ({failed}). The map view still works.</div>}
      {city && extra && !failed && (
        <>
          <div className="lw-modes" role="group" aria-label="Camera">
            <button className={mode === "fly" ? "on" : ""} onClick={() => pick("fly")} title="Drag to turn, right-drag to move, scroll to zoom; double-click to go down to a building or a person">Fly</button>
            <button className={mode === "walk" ? "on" : ""} onClick={() => pick("walk")} title="Walk the streets: click, then W A S D and the mouse; on a phone, tap where to go and drag to look">Walk</button>
            <button className={mode === "follow" ? "on" : ""} disabled={!canFollow} onClick={() => pick("follow")} title={canFollow ? "Keep the selected person in view" : "Select a person to follow them"}>Follow</button>
          </div>
          {info && (
            <div className="lw-status" title="The clock is the timeline's">
              {WEATHER_WORDS[info.weather] ? `${WEATHER_WORDS[info.weather]} ` : ""}{info.walking ? `${info.walking} walking` : "Nobody walking"}{info.driving ? `, ${info.driving} driving` : ""}
            </div>
          )}
          {info?.who && tourAt === null && <div className="lw-who"><b>{info.who.name}</b><span>{info.who.doing}</span></div>}
          {mode === "walk" && hint && <div className="lw-hint">Click to look around, then W A S D to walk and Shift to hurry; Esc frees the mouse. On a phone, tap where to go.</div>}
          {tourAt === null && (
            <div className="lw-extra">
              {steps.length > 0 && <button onClick={() => setTourAt(0)}>Fly me through it</button>}
              <button aria-pressed={keyOpen} onClick={() => setKeyOpen(!keyOpen)}>Key</button>
            </div>
          )}
          {tourAt !== null && <Tour steps={steps} at={tourAt} setAt={setTourAt} onExit={endTour} />}
          {keyOpen && tourAt === null && <div className="lw-key">People are dressed by where they are going: <i style={{ background: "#3f5e7a" }} /> to work, <i style={{ background: "#b5654a" }} /> to school, <i style={{ background: "#8c7b6b" }} /> home, <i style={{ background: "#1f5fad" }} /> to a hall, <i style={{ background: "#c9c2b6" }} /> to the clinic. Yellow lines carry the mayor's acts.</div>}
        </>
      )}
    </div>
  );
}
