// The dev page: the WorldView filling the window, with a minimal clock bar (the real timeline is the shell's).
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useLens } from "../state";
import { WorldView } from "./WorldView";
import type { Mode } from "./engine";

const q = new URLSearchParams(location.search);
const DAY = 86_400;
const num = (k: string) => (q.has(k) ? +q.get(k)! : undefined);
const v = q.get("view")?.split(",").map(Number);
const view = v && v.length === 6 ? { target: [v[0]!, v[1]!, v[2]!] as [number, number, number], dist: v[3]!, tilt: v[4]!, turn: v[5]! } : undefined;

function Dev() {
  const t = useLens((s) => s.t), span = useLens((s) => s.span), playing = useLens((s) => s.playing), speed = useLens((s) => s.speed);
  const st = useLens.getState();
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    st.setRun("dev");
    st.setSpan([0, 200 * DAY]);
    st.setT(((num("day") ?? 121) - 1) * DAY + (num("hour") ?? 17.5) * 3600);
    if (q.get("play")) st.setPlaying(true);
    st.setSpeed(num("speed") ?? 600);
    const sel = q.get("sel");
    if (sel) { const [kind, id] = sel.split(":"); st.select({ kind, id } as any); }
  }
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf = 0;
    const step = (now: number) => { const s = useLens.getState(); s.setT(s.t + ((now - last) / 1000) * s.speed); last = now; raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0 }}><WorldView run="dev" view={view} mode={(q.get("mode") as Mode) ?? undefined} weather={(q.get("weather") as any) ?? undefined} /></div>
      {!q.get("bare") && (
        <div style={{ height: 40, display: "flex", alignItems: "center", gap: 12, padding: "0 14px", background: "#F8F9FA", borderTop: "1px solid #C3CCD3", font: "13px system-ui", color: "#1D2B36" }}>
          <button onClick={() => st.setPlaying(!playing)}>{playing ? "Pause" : "Play"}</button>
          <select value={speed} onChange={(e) => st.setSpeed(+e.target.value)}>
            {[60, 300, 900, 3600, 4 * 3600].map((s) => <option key={s} value={s}>{s < 3600 ? `${s / 60} min a second` : `${s / 3600} h a second`}</option>)}
          </select>
          <input type="range" min={span[0]} max={span[1]} step={60} value={t} onChange={(e) => st.setT(+e.target.value)} style={{ flex: 1 }} />
          <span style={{ minWidth: 110, textAlign: "right" }}>Day {Math.floor(t / DAY) + 1}, {String(Math.floor((t % DAY) / 3600)).padStart(2, "0")}:{String(Math.floor((t % 3600) / 60)).padStart(2, "0")}</span>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Dev />);
