// The light of the hour: where the sun is, how bright, what colour the air is, from the time of day alone (the world
// has no sky; this is a reading aid, so night reads as night and lit windows mean someone is home).
import type { RGB } from "./scene";

export interface Sky {
  /** 0 at night, 1 in full day. */
  day: number;
  /** 0..1, strongest at dawn and dusk. */
  golden: number;
  /** Direction the sunlight travels (x, y, z), for a DirectionalLight. */
  sunDir: [number, number, number];
  sunColor: RGB;
  sunIntensity: number;
  ambientColor: RGB;
  ambientIntensity: number;
  /** Multiplies the painted ground. */
  groundTint: RGB;
  /** The backdrop behind the district. */
  backdrop: RGB;
  /** 0..1: how much windows glow. */
  night: number;
  label: string;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const lerp3 = (a: RGB, b: RGB, f: number): RGB => [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** hour in [0, 24). Sunrise ~6:00, sunset ~18:30; the world has no seasons we read here. */
export function skyAt(hour: number, dark = true): Sky {
  const rise = 6.0, set = 18.5;
  const dayLen = set - rise;
  const f = (hour - rise) / dayLen; // 0 at sunrise, 1 at sunset
  const elev = Math.sin(Math.PI * Math.max(0, Math.min(1, f))); // 0..1
  const up = hour > rise - 0.6 && hour < set + 0.6;
  const day = up ? smooth(-0.05, 0.35, Math.sin(Math.PI * f) + (f < 0 || f > 1 ? -0.3 : 0)) : 0;
  const golden = up ? Math.max(0, 1 - Math.abs(Math.sin(Math.PI * f)) * 2.2) * smooth(-0.15, 0.05, Math.sin(Math.PI * Math.max(-0.1, Math.min(1.1, f)))) : 0;
  // The sun travels east (+x) to west (-x), a little south of overhead (light travels north, +y).
  const az = Math.PI * Math.max(0, Math.min(1, f));
  const sunDir: [number, number, number] = [Math.cos(az), 0.45, -Math.max(0.15, elev)];
  const noonSun: RGB = [255, 247, 232], goldSun: RGB = [255, 176, 110], moon: RGB = [150, 170, 230];
  const sunColor = day > 0 ? lerp3(noonSun, goldSun, golden) : moon;
  const sunIntensity = day > 0 ? lerp(0.25, 1.35, day) : 0.18;
  const ambientColor = lerp3([96, 132, 150], [255, 250, 240], day);
  const ambientIntensity = lerp(0.42, 0.9, day);
  const groundTint = lerp3(lerp3([62, 92, 104], [255, 222, 190], golden * 0.6), [255, 252, 246], Math.max(0, day - golden * 0.3));
  const backdrop: RGB = dark ? lerp3([7, 9, 15], [11, 15, 23], day) : lerp3([214, 210, 200], [246, 243, 236], day);
  const night = 1 - smooth(0.05, 0.6, day);
  const label = hour < 5 ? "night" : hour < 7 ? "dawn" : hour < 11.5 ? "morning" : hour < 14 ? "midday" : hour < 17.5 ? "afternoon" : hour < 19.5 ? "dusk" : hour < 22 ? "evening" : "night";
  return { day, golden, sunDir, sunColor, sunIntensity, ambientColor, ambientIntensity, groundTint, backdrop, night, label };
}
