// How Lens writes times, money and sizes. Simulated time is seconds since the run began.
//
// Lens uses the world's own calendar: t = 0 is "year 1, day 1", as every prompt, notice and ballot in the world says it
// (participants/src/llm/render.ts). So the day a person reads is floor(t / 86400) + 1. The folds and the study's reader
// keep day *indices* from 0 (floor(t / 86400): `day`, `poll_day`, `forkDay`...): show those through dayNo, never as
// they are. Runs stay within the world's first year, so "Day 181" is "year 1, day 181".
export const DAY = 86_400;
export const HOUR = 3_600;

/** The world's day number of moment t: day 1 is t = 0. For labels; for arrays by day, dayIndex. */
export const dayOf = (t: number) => Math.floor(t / DAY) + 1;
/** The 0-based index of t's day, for arrays by day (the daily series, keyframes). */
export const dayIndex = (t: number) => Math.floor(t / DAY);
/** A day index as data carries it (from 0) as the world's day number. */
export const dayNo = (index: number) => index + 1;
/** The world's own wording of a moment's date: "year 1, day 181". */
export const worldDate = (t: number) => `year ${Math.floor(t / (365 * DAY)) + 1}, day ${Math.floor(((t % (365 * DAY)) + 365 * DAY) % (365 * DAY) / DAY) + 1}`;
export const clock = (t: number) => {
  const s = ((t % DAY) + DAY) % DAY;
  const h = Math.floor(s / HOUR);
  const m = Math.floor((s % HOUR) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
/** "Day 132, 14:00" (the world's day number). */
export const when = (t: number) => `Day ${dayOf(t)}, ${clock(t)}`;

export const span = (seconds: number) => {
  const a = Math.abs(seconds);
  if (a < HOUR) return `${Math.round(a / 60)} min`;
  if (a < DAY) return `${Math.round((a / HOUR) * 10) / 10} h`;
  const d = a / DAY;
  return `${d < 10 ? Math.round(d * 10) / 10 : Math.round(d)} d`;
};

/** A span of time in words: "34 days", "7 hours", "20 minutes". */
export const spanWords = (seconds: number) => {
  const a = Math.abs(seconds);
  if (a < HOUR) return `${Math.round(a / 60)} minutes`;
  if (a < DAY) { const h = Math.round(a / HOUR); return `${h} hour${h === 1 ? "" : "s"}`; }
  const d = Math.round(a / DAY);
  return `${d} day${d === 1 ? "" : "s"}`;
};

export const usd = (x: number | undefined) => (x === undefined ? "–" : x < 0.01 && x > 0 ? "<$0.01" : `$${x < 100 ? x.toFixed(2) : Math.round(x).toLocaleString("en-US")}`);
export const int = (n: number | undefined) => (n === undefined ? "–" : Math.round(n).toLocaleString("en-US"));
export const compact = (n: number) => (n < 1000 ? String(n) : n < 1e6 ? `${Math.round(n / 100) / 10}k` : `${Math.round(n / 1e5) / 10}M`);
export const bytes = (n: number) => (n < 1e6 ? `${Math.round(n / 1e3)} KB` : n < 1e9 ? `${Math.round(n / 1e5) / 10} MB` : `${Math.round(n / 1e8) / 10} GB`);
export const ago = (ms: number) => {
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} d ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/** A lever id as words: "amend_election_rules" -> "amend election rules". */
export const words = (id: string) => id.replace(/[_-]+/g, " ");
