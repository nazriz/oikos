// The library's masthead: the street plan of the town these runs are about, drawn like a surveyor's sheet from a real
// run's town (its ground, roads, buildings and river), with the town hall marked in the AI mayor's yellow. The one
// picture on the page; everything else stays quiet.
import { useEffect, useState } from "react";
import type { TownBundle } from "../../folds/town";
import { fetchFold } from "../api";

const COVER: Record<string, string> = { woodland: "var(--plan-wood)", farmland: "var(--plan-farm)", wetland: "var(--plan-wet)", riverbank: "var(--plan-wet)", scrub: "var(--plan-scrub)" };

export function Masthead({ run }: { run: string }) {
  const [town, setTown] = useState<TownBundle | null>(null);
  useEffect(() => {
    let live = true;
    fetchFold<TownBundle>(run, "town").then((t) => live && setTown(t), () => {});
    return () => {
      live = false;
    };
  }, [run]);
  if (!town) return <div className="masthead masthead-empty" aria-hidden />;
  const hall = town.hall !== undefined ? town.structures[town.hall] : undefined;
  // (The sheet is cut to the built town and a margin of its fields: the ground runs far beyond the streets.)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of town.structures) {
    x0 = Math.min(x0, s.x);
    y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x + s.w);
    y1 = Math.max(y1, s.y + s.h);
  }
  const m = 4;
  const vx = Math.max(0, x0 - m), vy = Math.max(0, y0 - m);
  const w = Math.min(town.ground.w, x1 + m) - vx, h = Math.min(town.ground.h, y1 + m) - vy;
  return (
    <figure className="masthead">
      <svg viewBox={`${vx} ${vy} ${w} ${h}`} role="img" aria-label={`Street plan of ${town.name ?? "the town"}`} shapeRendering="crispEdges">
        <rect x={vx} y={vy} width={w} height={h} className="plan-ground" />
        {town.terrain.map((c, i) => (COVER[c.cover] ? <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} fill={COVER[c.cover]} /> : null))}
        {town.river.map((chain, i) => (
          <polyline key={i} points={chain.map(([x, y]) => `${x + 0.5},${y + 0.5}`).join(" ")} className="plan-river" />
        ))}
        {town.structures.map((s, i) =>
          s.category === "transport" ? <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} className="plan-road" /> : null,
        )}
        {town.structures.map((s, i) =>
          s.category !== "transport" && s !== hall ? <rect key={i} x={s.x + 0.15} y={s.y + 0.15} width={s.w - 0.3} height={s.h - 0.3} className={`plan-b ${s.category}`} /> : null,
        )}
        {hall && (
          <g>
            {/* (Once, as the page opens: the reach of the mayor's office, a ring going out from the town hall.) */}
            <circle cx={hall.x + hall.w / 2} cy={hall.y + hall.h / 2} r={Math.max(w, h) / 3} className="plan-reach" />
            <rect x={hall.x - 0.4} y={hall.y - 0.4} width={hall.w + 0.8} height={hall.h + 0.8} className="plan-hall" />
            <text x={hall.x + hall.w + w / 80} y={hall.y + hall.h / 2 + w / 110} className="plan-label" style={{ fontSize: w / 34, strokeWidth: w / 160 }}>
              Town hall
            </text>
          </g>
        )}
      </svg>
      <figcaption>
        {town.name ?? "The town"}, the town in these runs: about a thousand people. The town hall, where the AI mayor works, is marked in yellow.
      </figcaption>
    </figure>
  );
}
