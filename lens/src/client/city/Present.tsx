// Presentation: the map for a room or a recording. The chrome goes; a caption bar at the bottom says what is happening
// (the seat's current sitting in its own words, a lever as the study's reader flags it, the election), the clock
// runs, and the camera moves on its own toward what the seat's acts touch, else drifts slowly round the town.
// A recording is the map's canvas with the caption drawn on, through MediaRecorder: a WebM (or MP4 where the
// browser offers it) of whatever plays, the tour included.
import type { TownBundle } from "./data";
import { fmtDay } from "./Panel";
import { W } from "../words";
import { plainText } from "../plain";

export interface Caption { kicker: string; title: string; words?: string; tone: "seat" | "flag" | "election" | "town" }

const DAY = 86_400, H = 3600;
const short = (s: string | undefined, n: number) => (!s ? undefined : s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** What the caption says at t: a lever just flagged (attempted or executed), else the election just declared, else the
 * seat's current sitting while it is fresh, else the day. */
export function captionAt(t: number, seat: any, town: TownBundle): Caption {
  const f = fmtDay(t);
  const when = `day ${f.dayOfYear} at ${f.clock}`;
  const lever = (seat?.levers ?? []).filter((l: any) => (l.level === "attempted" || l.level === "executed") && l.t <= t && t - l.t < 12 * H).at(-1);
  if (lever) return { kicker: `${W.Lever}, ${(W as any)[lever.level] ?? lever.level}, ${when}`, title: lever.title ?? lever.lever, words: short(lever.words, 260), tone: "flag" };
  for (const e of town.elections) if (e.result && e.result.t <= t && t - e.result.t < DAY) return { kicker: `The election, ${when}`, title: short(e.result.text, 200) ?? "The result", tone: "election" };
  const sittings: any[] = seat?.sittings ?? [];
  let s: any;
  for (const x of sittings) if (x.t <= t) s = x;
  if (s && t - s.t < 1.5 * DAY) return { kicker: `${W.Sitting} ${s.i + 1} of ${W.seat}, ${when}`, title: short(plainText(s.gist ?? "", town), 160) ?? "The seat sits", words: short(s.words, 260), tone: "seat" };
  return { kicker: when, title: `${town.name ?? "The town"}, ${f.clock < "06:00" || f.clock >= "21:00" ? "at night" : f.clock < "12:00" ? "in the morning" : f.clock < "18:00" ? "in the afternoon" : "in the evening"}`, tone: "town" };
}

export function PresentBar({ c, onExit, recording }: { c: Caption; onExit: () => void; recording: boolean }) {
  return (
    <div className={`lc-present tone-${c.tone}`}>
      <div className="lc-present-k">{recording && <span className="rec">Recording</span>}{c.kicker}</div>
      <div className="lc-present-t" key={c.title}>{c.title}</div>
      {c.words && <div className="lc-present-w" key={c.words}>“{c.words}”</div>}
      <button className="lc-present-x" onClick={onExit} aria-label="Leave presentation">Esc</button>
    </div>
  );
}

/** The recorder: a 2D canvas the size of the map, onto which each rendered frame is copied with the caption, captured
 * as a stream. `frame` is called after each deck.gl render; `stop` resolves with the file. */
export function makeRecorder(): { frame: (src: HTMLCanvasElement, c: Caption) => void; stop: () => Promise<Blob>; type: string } {
  // The video is the map's own size (at most 1920 wide, even sides for the encoder), set from the first frame.
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  let dpr = 1;
  const types = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const type = types.find((x) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(x)) ?? "video/webm";
  let stream: MediaStream | undefined, rec: MediaRecorder | undefined;
  const chunks: Blob[] = [];
  const begin = (src: HTMLCanvasElement) => {
    const k = Math.min(1, 1920 / src.width);
    canvas.width = Math.round((src.width * k) / 2) * 2; canvas.height = Math.round((src.height * k) / 2) * 2;
    dpr = canvas.width / Math.max(1, src.clientWidth || src.width);
    stream = canvas.captureStream(30);
    rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.start(500);
  };
  const serif = getComputedStyle(document.documentElement).getPropertyValue("--font-serif").trim() || "Fraunces Variable, Georgia, serif";
  const sans = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || "Inter Variable, system-ui, sans-serif";
  const wrap = (text: string, max: number, font: string) => {
    ctx.font = font;
    const out: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) { const next = line ? `${line} ${word}` : word; if (ctx.measureText(next).width > max && line) { out.push(line); line = word; } else line = next; }
    if (line) out.push(line);
    return out;
  };
  return {
    type,
    frame(src, c) {
      if (!rec) { if (src.width < 400 || src.height < 300) return; begin(src); } // (deck.gl's canvas starts at 300 by 150)
      const W = canvas.width, Hh = canvas.height;
      ctx.drawImage(src, 0, 0, W, Hh);
      // The caption bar, as on screen.
      const pad = 28 * dpr, maxW = Math.min(W - pad * 2, 1100 * dpr);
      const titleL = wrap(c.title, maxW, `400 ${26 * dpr}px ${serif}`).slice(0, 2);
      const wordsL = c.words ? wrap(`“${c.words}”`, maxW, `italic 400 ${17 * dpr}px ${serif}`).slice(0, 3) : [];
      const barH = pad * 1.6 + 16 * dpr + titleL.length * 32 * dpr + wordsL.length * 24 * dpr;
      const g = ctx.createLinearGradient(0, Hh - barH - 40 * dpr, 0, Hh);
      g.addColorStop(0, "rgba(11,15,23,0)"); g.addColorStop(0.35, "rgba(11,15,23,.78)"); g.addColorStop(1, "rgba(11,15,23,.92)");
      ctx.fillStyle = g; ctx.fillRect(0, Hh - barH - 40 * dpr, W, barH + 40 * dpr);
      const accent = c.tone === "flag" ? "#f0647a" : c.tone === "election" ? "#b48cf2" : "#f2b44b";
      let y = Hh - barH + pad * 0.6;
      ctx.fillStyle = accent; ctx.fillRect(pad, y - 14 * dpr, 36 * dpr, 2 * dpr);
      ctx.font = `600 ${11.5 * dpr}px ${sans}`; ctx.fillStyle = "rgba(232,230,225,.7)"; ctx.fillText(c.kicker.charAt(0).toUpperCase() + c.kicker.slice(1), pad, y);
      y += 32 * dpr;
      ctx.font = `400 ${26 * dpr}px ${serif}`; ctx.fillStyle = "#e8e6e1";
      for (const l of titleL) { ctx.fillText(l, pad, y); y += 32 * dpr; }
      ctx.font = `italic 400 ${17 * dpr}px ${serif}`; ctx.fillStyle = "rgba(232,230,225,.85)";
      for (const l of wordsL) { ctx.fillText(l, pad, y); y += 24 * dpr; }
    },
    stop: () => new Promise<Blob>((res) => { if (!rec) return res(new Blob([], { type })); rec.onstop = () => res(new Blob(chunks, { type })); rec.stop(); stream!.getTracks().forEach((t) => t.stop()); }),
  };
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export const PRESENT_CSS = `
.lens-city .lc-present { position: absolute; left: 0; right: 0; bottom: 0; z-index: 7; padding: 60px 32px 26px; pointer-events: none;
  background: linear-gradient(to bottom, rgba(11,15,23,0), rgba(11,15,23,.8) 40%, rgba(11,15,23,.94)); color: #e8e6e1; }
.lens-city .lc-present::before { content: ""; display: block; width: 36px; height: 2px; background: var(--lc-seat); margin-bottom: 10px; }
.lens-city .lc-present.tone-flag::before { background: var(--lc-flag); }
.lens-city .lc-present.tone-election::before { background: #b48cf2; }
.lens-city .lc-present-k { font-size: 11.5px; letter-spacing: .12em; text-transform: uppercase; color: rgba(232,230,225,.7); display: flex; gap: 12px; align-items: center; }
.lens-city .lc-present-k .rec { color: #f0647a; letter-spacing: .04em; animation: lc-blink 1.2s steps(2) infinite; }
@keyframes lc-blink { 50% { opacity: .2; } }
.lens-city .lc-present-t { font-family: var(--lc-serif); font-size: 27px; line-height: 1.25; margin-top: 8px; max-width: 1100px; animation: lc-fadeup .7s ease-out; }
.lens-city .lc-present-w { font-family: var(--lc-serif); font-style: italic; font-size: 17px; line-height: 1.5; margin-top: 8px; max-width: 1000px; color: rgba(232,230,225,.85); animation: lc-fadeup .9s ease-out; }
@keyframes lc-fadeup { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.lens-city .lc-present-x { position: absolute; right: 20px; bottom: 22px; pointer-events: auto; border: 1px solid #ffffff26; background: #ffffff10; color: #e8e6e1; border-radius: 8px; padding: 4px 10px; font: inherit; font-size: 11px; cursor: pointer; opacity: .6; }
.lens-city .lc-present-x:hover { opacity: 1; }
@media (max-width: 640px) { .lens-city .lc-present { padding: 40px 16px 16px; } .lens-city .lc-present-t { font-size: 19px; } .lens-city .lc-present-w { font-size: 14px; } }
`;
