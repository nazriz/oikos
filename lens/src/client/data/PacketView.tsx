// "The run as the graders read it": the grading packet (runs/ps-blind-grades-*/packets/<id>.txt), exactly the text
// graders A, B and C were given, set for reading: its sections as headings, each day as a block, each line under the
// packet's own label ([mayor wrote], [mayor asks], [came back, ...]). The words are the packet's; only the layout is
// Lens's. The packet's debrief section is not served (the Debriefs part shows what the study publishes).
import { useMemo, useState } from "react";
import { useAsync } from "../story/data";

const enc = encodeURIComponent;

interface Line { label: string; text: string }
type Block = { kind: "head"; text: string } | { kind: "para"; text: string } | { kind: "day"; day: number; lines: Line[] };

/** The packet's text as blocks: "## " headings, "Day N:" days with their "  [label] text" lines, and paragraphs. */
export function parsePacket(text: string): Block[] {
  const out: Block[] = [];
  let day: Extract<Block, { kind: "day" }> | null = null;
  for (const line of text.split("\n")) {
    const h = /^## (.+)$/.exec(line);
    if (h) { day = null; out.push({ kind: "head", text: h[1]! }); continue; }
    const d = /^Day (\d+):\s*$/.exec(line);
    if (d) { day = { kind: "day", day: Number(d[1]), lines: [] }; out.push(day); continue; }
    if (day) {
      const m = /^ {2}\[([^\]]+)\]\s?(.*)$/.exec(line);
      if (m) day.lines.push({ label: m[1]!, text: m[2]! });
      else if (line.trim() && day.lines.length) day.lines[day.lines.length - 1]!.text += `\n${line.trim()}`;
      else if (!line.trim()) day = null;
      continue;
    }
    if (!line.trim()) continue;
    const last = out[out.length - 1];
    if (last?.kind === "para") last.text += `\n${line}`;
    else out.push({ kind: "para", text: line });
  }
  return out;
}

export function PacketView({ run }: { run: string }) {
  const got = useAsync(() => fetch(`/api/data/run/${enc(run)}/grades`).then((r) => r.json() as Promise<{ sets: { set: string; packet: string }[] }>), [run]);
  if (got === undefined) return <p className="rd-note">Reading the grade sets…</p>;
  if (got instanceof Error) return <p className="rd-note">Could not read the grade sets: {got.message}</p>;
  return <Packet run={run} sets={got.sets} />;
}

function Packet({ run, sets }: { run: string; sets: { set: string; packet: string }[] }) {
  const [i, setI] = useState(0);
  const s = sets[i];
  const text = useAsync(() => (s ? fetch(`/api/data/run/${enc(run)}/packet?set=${enc(s.set)}&packet=${enc(s.packet)}`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); }) : Promise.resolve(null)), [run, s?.set, s?.packet]);
  const blocks = useMemo(() => (typeof text === "string" ? parsePacket(text) : []), [text]);
  const days = blocks.filter((b): b is Extract<Block, { kind: "day" }> => b.kind === "day").map((b) => b.day);
  if (!sets.length) return <p className="rd-note">No grade set in runs/ graded this run, so there is no packet.</p>;
  return (
    <section className="rd-sec pk">
      <div className="pk-head">
        {sets.length > 1 && (
          <select value={i} onChange={(e) => setI(Number(e.target.value))} aria-label="Grade set">
            {sets.map((x, n) => (
              <option key={x.set + x.packet} value={n}>
                {x.set} · {x.packet}
              </option>
            ))}
          </select>
        )}
        <p className="rd-note">
          The packet {s!.packet} of {s!.set}: exactly the text graders A, B and C read, set out for reading. Days are the packet's, counted from 0 (the
          world's day is one more).{" "}
          <a href={`/api/data/run/${enc(run)}/packet?set=${enc(s!.set)}&packet=${enc(s!.packet)}`} target="_blank" rel="noreferrer">
            The packet as plain text
          </a>
        </p>
        {days.length > 0 && (
          <select onChange={(e) => document.getElementById(`pk-day-${e.target.value}`)?.scrollIntoView({ block: "start" })} aria-label="Go to a day" defaultValue="">
            <option value="" disabled>
              Go to a day
            </option>
            {days.map((d) => (
              <option key={d} value={d}>
                Day {d}
              </option>
            ))}
          </select>
        )}
      </div>
      {text === undefined && <p className="rd-note">Reading the packet…</p>}
      {text instanceof Error && <p className="rd-note">Could not read the packet: {text.message}</p>}
      {blocks.map((b, n) =>
        b.kind === "head" ? (
          <h2 key={n} className="pk-h">
            {b.text}
          </h2>
        ) : b.kind === "para" ? (
          <p key={n} className="pk-p">
            {b.text}
          </p>
        ) : (
          <div key={n} className="pk-day" id={`pk-day-${b.day}`}>
            <h3>Day {b.day}</h3>
            {b.lines.map((l, k) => (
              <div key={k} className={`pk-line${/^mayor (wrote|asks)|^mayor's notebook/.test(l.label) ? " pk-own" : ""}`}>
                <span className="pk-lbl">{l.label}</span>
                <span className="pk-text">{l.text}</span>
              </div>
            ))}
          </div>
        ),
      )}
    </section>
  );
}
