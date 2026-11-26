// A small geometry kit for the town: boxes, gabled and hipped roofs, prisms and quads, written straight into one merged
// buffer per material (with a colour per vertex and the structure each triangle belongs to, for picking). Shapes are
// placed in a building's own frame (x along its front, z toward its street, y up) and turned into the world's axes.
import * as THREE from "three";

export type Col = [number, number, number];

export const col = (hex: string): Col => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
export const shade = (c: Col, f: number): Col => [c[0] * f, c[1] * f, c[2] * f];
export const blend = (a: Col, b: Col, f: number): Col => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

/** A building's frame: origin (ox, oz) on the ground, front facing (fx, fz). Local (x, y, z) → world. */
export class Frame {
  // Local x axis in the world: to the right of the front, seen from the street.
  readonly ex: [number, number];
  constructor(readonly ox: number, readonly oz: number, readonly fx: number, readonly fz: number, readonly oy = 0) {
    this.ex = [-fz, fx];
  }
  x(x: number, z: number) { return this.ox + this.ex[0] * x + this.fx * z; }
  z(x: number, z: number) { return this.oz + this.ex[1] * x + this.fz * z; }
  /** The world heading of the local +z axis (radians, for an object whose own front is +z). */
  get heading() { return Math.atan2(this.fx, this.fz); }
}

export class Buf {
  pos: number[] = [];
  nor: number[] = [];
  colr: number[] = [];
  /** Per triangle: the structure index it belongs to (-1 none). */
  owner: number[] = [];
  who = -1;

  private v(x: number, y: number, z: number, n: THREE.Vector3, c: Col) {
    this.pos.push(x, y, z);
    this.nor.push(n.x, n.y, n.z);
    this.colr.push(c[0], c[1], c[2]);
  }

  /** A flat polygon (convex, 3 or 4 points in world space), its winding made to face away from `inside`. */
  poly(p: THREE.Vector3[], c: Col, inside?: THREE.Vector3, up?: boolean) {
    const n = new THREE.Vector3().subVectors(p[1]!, p[0]!).cross(new THREE.Vector3().subVectors(p[2]!, p[0]!)).normalize();
    let flip = false;
    if (inside) {
      const cen = p.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / p.length);
      if (n.dot(cen.sub(inside)) < 0) flip = true;
    } else if (up !== undefined && (n.y < 0) === up) flip = true;
    if (flip) { p = p.slice().reverse(); n.negate(); }
    for (let i = 1; i + 1 < p.length; i++) {
      this.v(p[0]!.x, p[0]!.y, p[0]!.z, n, c);
      this.v(p[i]!.x, p[i]!.y, p[i]!.z, n, c);
      this.v(p[i + 1]!.x, p[i + 1]!.y, p[i + 1]!.z, n, c);
      this.owner.push(this.who);
    }
  }

  /** A box in a frame: local x0..x1, y0..y1, z0..z1. `top` colours the top face; `noBottom` drops the base. */
  box(F: Frame, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: Col, top?: Col, sides = true) {
    const P = (x: number, y: number, z: number) => new THREE.Vector3(F.x(x, z), y + F.oy, F.z(x, z));
    const inside = P((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const a = P(x0, y0, z0), b = P(x1, y0, z0), cc = P(x1, y0, z1), d = P(x0, y0, z1);
    const e = P(x0, y1, z0), f = P(x1, y1, z0), g = P(x1, y1, z1), h = P(x0, y1, z1);
    this.poly([e, f, g, h], top ?? c, inside);
    if (!sides) return;
    // Faces lit a touch differently by side keeps the model readable even in flat light.
    this.poly([a, b, f, e], c, inside);
    this.poly([b, cc, g, f], c, inside);
    this.poly([cc, d, h, g], c, inside);
    this.poly([d, a, e, h], c, inside);
  }

  /** A gabled roof over local x0..x1 × z0..z1 from height y0, ridge `rise` above, running along x (alongX) or z.
   * `over`: the eaves' overhang. Gable ends in `wall` colour. */
  gable(F: Frame, x0: number, x1: number, z0: number, z1: number, y0: number, rise: number, roof: Col, wall: Col, alongX = true, over = 0.4) {
    const P = (x: number, y: number, z: number) => new THREE.Vector3(F.x(x, z), y + F.oy, F.z(x, z));
    const inside = P((x0 + x1) / 2, y0 + rise * 0.3, (z0 + z1) / 2);
    if (alongX) {
      const zm = (z0 + z1) / 2, yr = y0 + rise;
      const X0 = x0 - over * 0.6, X1 = x1 + over * 0.6, Z0 = z0 - over, Z1 = z1 + over, drop = (over * rise) / ((z1 - z0) / 2);
      this.poly([P(X0, y0 - drop, Z0), P(X1, y0 - drop, Z0), P(X1, yr, zm), P(X0, yr, zm)], roof, inside);
      this.poly([P(X0, y0 - drop, Z1), P(X1, y0 - drop, Z1), P(X1, yr, zm), P(X0, yr, zm)], roof, inside);
      this.poly([P(x0, y0, z0), P(x0, y0, z1), P(x0, yr, zm)], wall, inside);
      this.poly([P(x1, y0, z0), P(x1, y0, z1), P(x1, yr, zm)], wall, inside);
      // Under the eaves.
      this.poly([P(X0, y0 - drop, Z0), P(X1, y0 - drop, Z0), P(X1, y0, z0), P(X0, y0, z0)], shade(roof, 0.6), inside);
      this.poly([P(X0, y0 - drop, Z1), P(X1, y0 - drop, Z1), P(X1, y0, z1), P(X0, y0, z1)], shade(roof, 0.6), inside);
    } else {
      const xm = (x0 + x1) / 2, yr = y0 + rise;
      const X0 = x0 - over, X1 = x1 + over, Z0 = z0 - over * 0.6, Z1 = z1 + over * 0.6, drop = (over * rise) / ((x1 - x0) / 2);
      this.poly([P(X0, y0 - drop, Z0), P(X0, y0 - drop, Z1), P(xm, yr, Z1), P(xm, yr, Z0)], roof, inside);
      this.poly([P(X1, y0 - drop, Z0), P(X1, y0 - drop, Z1), P(xm, yr, Z1), P(xm, yr, Z0)], roof, inside);
      this.poly([P(x0, y0, z0), P(x1, y0, z0), P(xm, yr, z0)], wall, inside);
      this.poly([P(x0, y0, z1), P(x1, y0, z1), P(xm, yr, z1)], wall, inside);
    }
  }

  /** A hipped roof: four slopes to a ridge `inset` in from each end (a pyramid when the ridge has no length). */
  hip(F: Frame, x0: number, x1: number, z0: number, z1: number, y0: number, rise: number, roof: Col, over = 0.4) {
    const P = (x: number, y: number, z: number) => new THREE.Vector3(F.x(x, z), y + F.oy, F.z(x, z));
    const X0 = x0 - over, X1 = x1 + over, Z0 = z0 - over, Z1 = z1 + over, yd = y0 - over * 0.5;
    const inside = P((x0 + x1) / 2, y0 + rise * 0.3, (z0 + z1) / 2);
    const half = (Z1 - Z0) / 2, zm = (Z0 + Z1) / 2;
    const r0 = Math.min((X0 + X1) / 2, X0 + half), r1 = Math.max((X0 + X1) / 2, X1 - half), yr = yd + rise;
    this.poly([P(X0, yd, Z0), P(X1, yd, Z0), P(r1, yr, zm), P(r0, yr, zm)], roof, inside);
    this.poly([P(X0, yd, Z1), P(X1, yd, Z1), P(r1, yr, zm), P(r0, yr, zm)], roof, inside);
    this.poly([P(X0, yd, Z0), P(X0, yd, Z1), P(r0, yr, zm)], shade(roof, 0.96), inside);
    this.poly([P(X1, yd, Z0), P(X1, yd, Z1), P(r1, yr, zm)], shade(roof, 0.96), inside);
    this.poly([P(X0, yd, Z0), P(X1, yd, Z0), P(X1, yd, Z1), P(X0, yd, Z1)], shade(roof, 0.55), inside);
  }

  /** An upright n-sided prism (a chimney stack, a tank, a column) centred at local (x, z). */
  prism(F: Frame, x: number, z: number, r: number, y0: number, y1: number, c: Col, n = 8, top?: Col, r1 = r) {
    const cx = F.x(x, z), cz = F.z(x, z);
    const inside = new THREE.Vector3(cx, (y0 + y1) / 2 + F.oy, cz);
    const ring = (rr: number, y: number) => Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2;
      return new THREE.Vector3(cx + Math.cos(a) * rr, y + F.oy, cz + Math.sin(a) * rr);
    });
    const lo = ring(r, y0), hi = ring(r1, y1);
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      this.poly([lo[k]!, lo[k2]!, hi[k2]!, hi[k]!], c, inside);
    }
    if (r1 > 0.001) for (let k = 1; k + 1 < n; k++) this.poly([hi[0]!, hi[k]!, hi[k + 1]!], top ?? c, inside);
  }

  /** A flat quad on the ground (world coordinates), facing up. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, c: Col) {
    this.poly([new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z0), new THREE.Vector3(x1, y, z1), new THREE.Vector3(x0, y, z1)], c, undefined, true);
  }
  /** A flat quad on the ground in a frame. */
  flatF(F: Frame, x0: number, x1: number, z0: number, z1: number, y: number, c: Col) {
    const P = (x: number, z: number) => new THREE.Vector3(F.x(x, z), y + F.oy, F.z(x, z));
    this.poly([P(x0, z0), P(x1, z0), P(x1, z1), P(x0, z1)], c, undefined, true);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colr, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
  get triangles() { return this.owner.length; }
}

/** Windows, doors, signs: flat panels set on walls, drawn as instances (one quad each). */
export class Panels {
  /** Per instance: x, y, z (centre), heading (the wall's outward normal as an angle), width, height. */
  data: number[] = [];
  /** Per instance: the structure index, a random value (which windows light first), and a kind. */
  owner: number[] = [];
  seed: number[] = [];
  add(F: Frame, x: number, y: number, z: number, w: number, h: number, outward: "front" | "back" | "left" | "right", owner: number, seed: number) {
    const ang = F.heading + (outward === "front" ? 0 : outward === "back" ? Math.PI : outward === "right" ? -Math.PI / 2 : Math.PI / 2);
    this.data.push(F.x(x, z), y + F.oy, F.z(x, z), ang, w, h);
    this.owner.push(owner);
    this.seed.push(seed);
  }
  get n() { return this.owner.length; }
}
