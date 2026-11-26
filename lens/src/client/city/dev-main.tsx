// The dev page: the CityView filling the window, with a minimal clock bar (the real timeline is the shell's).
import "@fontsource-variable/overpass/index.css";
import "@fontsource-variable/source-serif-4/opsz.css";
import "../theme.css";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useLens } from "../state";
import { CityView } from "./CityView";
import { TwoTowns } from "./TwoTowns";
import { PowerView } from "./Power";

const q = new URLSearchParams(location.search);
const DAY = 86_400;
if (q.get("theme")) document.documentElement.dataset.theme = q.get("theme")!;
const cmp = q.get("compare")?.split(",");
const num = (k: string) => (q.has(k) ? +q.get(k)! : undefined);

function Dev() {
  const t = useLens((s) => s.t), span = useLens((s) => s.span), playing = useLens((s) => s.playing), speed = useLens((s) => s.speed);
  const st = useLens.getState();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    st.setRun(q.get("run") ?? "dev");
    st.setT((num("day") ?? 120) * DAY + (num("hour") ?? 9.5) * 3600);
    if (q.get("play")) st.setPlaying(true);
    if (num("speed")) st.setSpeed(num("speed")!);
    const sel = q.get("sel");
    if (sel) { const [kind, id] = sel.split(":"); st.select(kind === "act" ? { kind: "act", seq: +id! } : ({ kind, id } as any)); }
  }, []);
  // Play: advance the clock (the shell's timeline does this in Lens).
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf = 0;
    const step = (now: number) => { const s = useLens.getState(); s.setT(s.t + ((now - last) / 1000) * s.speed); last = now; raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  const camera = { zoom: num("zoom"), rotationX: num("tilt"), rotationOrbit: num("turn") };
  for (const k of Object.keys(camera) as (keyof typeof camera)[]) if (camera[k] === undefined) delete camera[k];
  const tracks = useLens((s) => s.tracks);
  const acts = tracks.find((x) => x.id === "city.acts")?.marks ?? [];
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}>{q.get("power") ? <div style={{ position: "relative", width: "100%", height: "100%" }}><PowerView run={q.get("run") ?? "dev"} /></div> : cmp ? <TwoTowns a={cmp[0]!} b={cmp[1]!} names={cmp[2] ? [cmp[2], cmp[3] ?? cmp[1]!] : undefined} /> : <CityView camera={camera} layers={!q.get("pill")} tour={num("tour")} present={(q.get("present") as any) ?? undefined} story={q.get("mode") ? q.get("mode") === "story" : undefined} overlays={q.get("ov") ? JSON.parse(q.get("ov")!) : undefined} />}</div>
      {!q.get("bare") && (
        <div style={{ height: 44, display: "flex", alignItems: "center", gap: 12, padding: "0 14px", background: "#111723", borderTop: "1px solid #ffffff14", font: "12px Inter Variable, system-ui" }}>
          <button onClick={() => st.setPlaying(!playing)} style={{ background: "#f2b44b", color: "#0b0f17", border: 0, borderRadius: 6, padding: "5px 12px", fontWeight: 600, cursor: "pointer" }}>{playing ? "Pause" : "Play"}</button>
          <select value={speed} onChange={(e) => st.setSpeed(+e.target.value)} style={{ background: "#161d2b", color: "#e8e6e1", border: "1px solid #ffffff14", borderRadius: 6, padding: 4 }}>
            {[300, 900, 3600, 4 * 3600, DAY].map((s) => <option key={s} value={s}>{s < 3600 ? `${s / 60} min/s` : s < DAY ? `${s / 3600} h/s` : "1 day/s"}</option>)}
          </select>
          <div style={{ position: "relative", flex: 1, height: 24 }}>
            {acts.map((m, i) => <div key={i} style={{ position: "absolute", left: `${(m.t / (span[1] || 1)) * 100}%`, top: 2, width: 2, height: 6, background: m.tone === "bad" ? "#f0647a" : "#f2b44b", opacity: 0.8 }} />)}
            <input type="range" min={span[0]} max={span[1]} step={60} value={t} onChange={(e) => st.setT(+e.target.value)} style={{ position: "absolute", left: 0, right: 0, top: 6, width: "100%", accentColor: "#f2b44b" }} />
          </div>
          <span style={{ fontFamily: "JetBrains Mono Variable, monospace", color: "#9aa3b2", minWidth: 120, textAlign: "right" }}>day {Math.floor(t / DAY)} · {String(Math.floor((t % DAY) / 3600)).padStart(2, "0")}:{String(Math.floor((t % 3600) / 60)).padStart(2, "0")}</span>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Dev />);
