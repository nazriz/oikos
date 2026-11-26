// The hour the town is lit by. It follows the clock, but when time runs faster than about a day a second (playing at
// a day or a week a second, or dragging the timeline across days) day and night would strobe several times a second:
// then the light holds where it was, and when time slows again it takes the true hour, once. A lone jump (a click on
// the timeline, a turn opened) is one change and is shown at once.
// (docs/decisions.md, "Lens: smooth light".) The map (city/) uses the hook; the 3D town can use the class in its loop.
import { useEffect, useRef, useState } from "react";
import { useLens } from "./state";

const DAY = 86_400;
/** Above this many simulated seconds a real second, the light holds. */
const FAST = 0.75 * DAY;
/** Seconds: how fast the measured rate follows. */
const RATE_TAU = 0.5;
/** One step counts at most this many simulated seconds toward the rate: a single jump (a click) eases, it does not hold. */
const STEP_CAP = 2 * 3600;

const hourOf = (t: number) => (((t % DAY) + DAY) % DAY) / 3600;
/** The signed way round the clock from a to b, in hours (-12..12). */
const turn = (a: number, b: number) => ((((b - a) % 24) + 36) % 24) - 12;

export class LightClock {
  private t: number | null = null;
  private at = 0;
  private rate = 0;
  private shown = 0;
  /** Consecutive steps that each ran faster than FAST, and when the last one was (ms): two in a row hold the light at
   * once, before the smoothed rate has caught up. */
  private fastSteps = 0;
  private fastAt = -1e9;
  /** The hour to light by at moment t, real time now (ms). */
  update(t: number, now: number): number {
    const h = hourOf(t);
    if (this.t === null) {
      this.t = t; this.at = now; this.shown = h;
      return h;
    }
    const dt = Math.max(1e-3, (now - this.at) / 1000);
    const k = 1 - Math.exp(-dt / RATE_TAU);
    const step = Math.abs(t - this.t);
    this.rate += (Math.min(STEP_CAP, step) / dt - this.rate) * k;
    if (step > 0) {
      if (step / dt > FAST) { this.fastSteps++; this.fastAt = now; } else this.fastSteps = 0;
    }
    this.t = t; this.at = now;
    // (No easing across a jump: every step of an ease re-lights the whole map, which cost two seconds of long tasks
    // for one click. A single change is not a flicker; a strobe is.)
    if (!this.holdingAt(now)) this.shown = h;
    return this.shown;
  }
  /** True while the shown hour is not the clock's (held: a look again is wanted, to let it go). */
  settling(t: number): boolean {
    return Math.abs(turn(this.shown, hourOf(t))) >= 0.02;
  }
  /** True while time races and the light holds. */
  get holding(): boolean {
    return this.holdingAt(this.at);
  }
  private holdingAt(now: number): boolean {
    return this.rate >= FAST || (this.fastSteps >= 2 && now - this.fastAt < 150);
  }
}

/** The hour to light the map by at t (see above). Held and paused, it looks again every 120 ms to let the light go. */
export function useLightHour(t: number): number {
  const clock = useRef<LightClock>(null);
  clock.current ??= new LightClock();
  const [, tick] = useState(0);
  const h = clock.current.update(t, performance.now());
  const settling = clock.current.settling(t);
  const playing = useLens((s) => s.playing);
  useEffect(() => {
    if (!settling || playing) return;
    const id = setTimeout(() => tick((n) => n + 1), 120);
    return () => clearTimeout(id);
  });
  return h;
}
