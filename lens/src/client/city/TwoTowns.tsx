// Two towns: the model arm and its code twin side by side (stacked on a phone), one camera and one clock for both, and
// on the first the difference from the second (people somewhere else, papers in only one arm). For the Compare page
// (story's ComparePage hosts it); it fills its box.
import { useState } from "react";
import type { OrbitViewState } from "@deck.gl/core";
import { useCity, CityPane } from "./CityView";
import { DEFAULT_OVERLAYS, type Overlays } from "./Panel";
import { CITY_CSS } from "./style";
import { modelName } from "../words";

/** A model id as people say it ("DeepSeek V4.1 Flash"); other names as given. */
const nice = (n?: string) => (!n ? undefined : /[a-z0-9]-[a-z0-9]/.test(n) && !/\s/.test(n) ? modelName(n) : n);

export function TwoTowns({ a, b, names }: { a: string; b: string; names?: [string, string] }) {
  const A = useCity(`/api/run/${encodeURIComponent(a)}`);
  const B = useCity(`/api/run/${encodeURIComponent(b)}`);
  const [view, setView] = useState<OrbitViewState | null>(null);
  const [overlays, setOverlays] = useState<Overlays>(() => {
    try { return { ...DEFAULT_OVERLAYS, ...JSON.parse(localStorage.getItem("lens.city.overlays") ?? "{}"), diff: true }; } catch { return { ...DEFAULT_OVERLAYS, diff: true }; }
  });
  const shared: [OrbitViewState | null, any] = [view, setView];
  const err = A.error ?? B.error;
  if (!A.city || !B.city) {
    return <div className="lens-city"><style>{CITY_CSS}</style><div className="lc-loading">{err ? <span className="lc-err">The towns could not be read: {err}</span> : <><div className="lc-spin" />Drawing both towns</>}</div></div>;
  }
  return (
    <div className="lc-two">
      <div className="lc-two-pane">
        <CityPane city={A.city} card={false} layersOpen={false} base={`/api/run/${encodeURIComponent(a)}`} sharedView={shared} sharedOverlays={[overlays, setOverlays]} twin={B.city} label={nice(names?.[0]) ?? "This town"} />
      </div>
      <div className="lc-two-pane">
        <CityPane city={B.city} card={false} layersOpen={false} base={`/api/run/${encodeURIComponent(b)}`} sharedView={shared} sharedOverlays={[{ ...overlays, diff: false }, setOverlays]} label={nice(names?.[1]) ?? "The other town"} bare />
      </div>
      <style>{`
        .lc-two { position: relative; width: 100%; height: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 2px; background: var(--line, #ffffff14); }
        .lc-two-pane { position: relative; min-width: 0; min-height: 0; }
        @media (max-width: 760px) { .lc-two { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; } }
      `}</style>
    </div>
  );
}
