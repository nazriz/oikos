// What a seat's counter saves (docs/behaviour/standing-work.md, "The counter"): from a run's log, per seat, the sittings
// (a transcript with turn 1 starts one), the model calls, the input tokens (total, mean per call, and the largest single
// prompt), and the papers filed by kind. No model is called; it reads the log's annotations only.
//
//   bun scripts/counter-measure.ts RUN_DIR [RUN_DIR ...] [--kinds complaint,death_notification,...]
import { currentLogs, logLines } from "../orchestrator/src/logs";

const args = process.argv.slice(2);
const kindsAt = args.indexOf("--kinds");
const KINDS = new Set((kindsAt >= 0 ? args[kindsAt + 1]! : "complaint,death_notification,birth_notification,death_registration,birth_registration,request,work_order,staff_report").split(","));
const dirs = args.filter((a, i) => !a.startsWith("--") && (kindsAt < 0 || i !== kindsAt + 1));
if (!dirs.length) { console.error("usage: bun scripts/counter-measure.ts RUN_DIR... [--kinds a,b]"); process.exit(2); }

for (const dir of dirs) for (const log of currentLogs(dir)) {
  const seats = new Map<string, { sittings: number; calls: number; input: number; largest: number }>();
  const seat = (id: string) => seats.get(id) ?? (seats.set(id, { sittings: 0, calls: 0, input: 0, largest: 0 }), seats.get(id)!);
  const filed = new Map<string, number>();
  for await (const line of logLines(log)) {
    const note = line.includes('"annotation":"transcript"') || line.includes('"annotation":"usage"');
    const recorded = !note && line.includes('"event":"recorded"') && line.includes('"record":"statement"');
    if (!note && !recorded) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    const b = e.body ?? {};
    if (recorded) { const k = b.record?.kind; if (KINDS.has(k)) filed.set(k, (filed.get(k) ?? 0) + 1); continue; }
    if (b.annotation === "transcript" && b.data?.purpose === "participant") {
      const s = seat(b.subject);
      s.calls++;
      if (b.data.turn === 1) s.sittings++;
    } else if (b.annotation === "usage" && b.purpose === "participant") {
      const s = seat(b.subject), n = Number(b.input_tokens ?? 0);
      s.input += n;
      s.largest = Math.max(s.largest, n);
    }
  }
  console.log(`${log}`);
  console.log("seat".padEnd(28) + "sittings".padStart(9) + "calls".padStart(8) + "input tokens".padStart(14) + "mean".padStart(9) + "largest".padStart(9));
  for (const [id, s] of [...seats].sort(([x], [y]) => (x < y ? -1 : 1))) console.log(id.padEnd(28) + String(s.sittings).padStart(9) + String(s.calls).padStart(8) + String(s.input).padStart(14) + String(s.calls ? Math.round(s.input / s.calls) : 0).padStart(9) + String(s.largest).padStart(9));
  console.log(`papers filed: ${[...filed].sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}\n`);
}
