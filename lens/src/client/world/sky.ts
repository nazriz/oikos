// The light of the hour for the 3D town: where the sun and moon are, the colour of sunlight, skylight and haze, from
// the time of day and the weather the run was given. Sunrise and sunset are the city map's (src/client/city/sky.ts),
// so the two views agree; the sun's path is a reading aid, not a place's latitude.
import * as THREE from "three";

export interface Light {
  /** Unit vector toward the sun (y up). */
  sun: THREE.Vector3;
  /** Unit vector toward the moon. */
  moon: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  skyColor: THREE.Color;
  groundColor: THREE.Color;
  hemiIntensity: number;
  fog: THREE.Color;
  fogDensity: number;
  /** 0 by day, 1 at full night. */
  night: number;
  /** Preetham sky parameters. */
  turbidity: number;
  rayleigh: number;
  clouds: number;
  exposure: number;
}

const RISE = 6.0, SET = 18.5;
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const C = (h: string) => new THREE.Color(h);

/** Keyed by the sun's height (sine of elevation, -0.3 .. 1): sunlight, sky, haze. */
const KEYS: { e: number; sun: THREE.Color; sky: THREE.Color; ground: THREE.Color; fog: THREE.Color }[] = [
  { e: -0.3, sun: C("#8fa3d6"), sky: C("#2e4170"), ground: C("#141b29"), fog: C("#14213d") },
  { e: -0.08, sun: C("#9e8fb5"), sky: C("#3a4a78"), ground: C("#20232f"), fog: C("#2c3658") },
  { e: 0.0, sun: C("#ff9a5c"), sky: C("#8a8fb0"), ground: C("#4a4038"), fog: C("#c49a86") },
  { e: 0.12, sun: C("#ffbf80"), sky: C("#a9bdd6"), ground: C("#6a5e48"), fog: C("#d8bfa4") },
  { e: 0.35, sun: C("#ffe2bd"), sky: C("#b5cbe2"), ground: C("#76705a"), fog: C("#ccd2d4") },
  { e: 1.0, sun: C("#fff6ea"), sky: C("#bcd2ea"), ground: C("#7b7660"), fog: C("#c8d4dc") },
];

function at(e: number, k: "sun" | "sky" | "ground" | "fog", out: THREE.Color) {
  for (let i = 1; i < KEYS.length; i++) {
    if (e <= KEYS[i]!.e || i === KEYS.length - 1) {
      const a = KEYS[i - 1]!, b = KEYS[i]!;
      const f = Math.max(0, Math.min(1, (e - a.e) / (b.e - a.e)));
      return out.copy(a[k]).lerp(b[k], f);
    }
  }
  return out;
}

export type Weather = "clear" | "heavy_rain" | "heatwave" | "drought";

export function lightAt(hour: number, weather: Weather, out?: Light): Light {
  const L: Light = out ?? {
    sun: new THREE.Vector3(), moon: new THREE.Vector3(), sunColor: new THREE.Color(), sunIntensity: 0, skyColor: new THREE.Color(), groundColor: new THREE.Color(),
    hemiIntensity: 0, fog: new THREE.Color(), fogDensity: 0, night: 0, turbidity: 2, rayleigh: 1, clouds: 0.3, exposure: 0.5,
  };
  // The sun climbs from the east (+x) through the south (+z) to the west, peaking at 52 degrees.
  const f = (hour - RISE) / (SET - RISE);
  const ang = f * Math.PI;
  const el = Math.sin(ang) * 0.9; // sine of elevation, roughly
  const sx = Math.cos(ang), sz = 0.55;
  L.sun.set(sx, el, sz).normalize();
  // The moon: opposite in the sky, a little to the south.
  L.moon.set(-sx * 0.8, Math.max(0.25, -el + 0.35), 0.5).normalize();
  const e = L.sun.y;
  at(e, "sun", L.sunColor); at(e, "sky", L.skyColor); at(e, "ground", L.groundColor); at(e, "fog", L.fog);
  const day = smooth(-0.04, 0.25, e);
  L.night = 1 - smooth(-0.1, 0.06, e);
  L.sunIntensity = day > 0 ? 0.4 + day * 3.4 : 0;
  L.hemiIntensity = 0.5 + day * 0.6;
  L.fogDensity = 0.00032;
  L.turbidity = 2.6; L.rayleigh = 1.2 + (1 - day) * 1.2; L.clouds = 0.28; L.exposure = 0.56 + L.night * 0.44;
  if (weather === "heavy_rain") {
    L.sunIntensity *= 0.18; L.hemiIntensity *= 0.85;
    L.fog.lerp(C("#8d959b"), 0.75 * (1 - L.night)).multiplyScalar(1 - L.night * 0.5);
    L.fogDensity = 0.0011; L.clouds = 0.95; L.turbidity = 10; L.rayleigh = 0.6;
    L.skyColor.lerp(C("#9aa3a8"), 0.6);
  } else if (weather === "heatwave") {
    L.sunIntensity *= 1.12;
    L.fog.lerp(C("#d9c8a6"), 0.55 * (1 - L.night));
    L.fogDensity = 0.0006; L.turbidity = 9; L.clouds = 0.05;
  } else if (weather === "drought") {
    L.turbidity = 6; L.clouds = 0.08;
  }
  return L;
}

/** Stars: points on a far sphere, shown at night. */
export function stars(n = 1800, r = 9000): THREE.Points {
  const pos = new Float32Array(n * 3), size = new Float32Array(n);
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n; i++) {
    const u = rnd(), v = rnd() * 0.95 + 0.05;
    const th = u * Math.PI * 2, y = v;
    const rr = Math.sqrt(1 - y * y);
    pos.set([Math.cos(th) * rr * r, y * r, Math.sin(th) * rr * r], i * 3);
    size[i] = rnd() < 0.08 ? 2.2 : 1.1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: `attribute float aSize; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * mv; gl_PointSize = aSize; }`,
    fragmentShader: `uniform float uOpacity; void main(){ gl_FragColor = vec4(vec3(0.9,0.92,1.0), uOpacity); }`,
    transparent: true, depthWrite: false, fog: false,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = -1;
  return p;
}
