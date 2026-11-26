// Trees as soft masses of foliage rather than faceted balls: a crown is a cluster of rounded blobs whose normals point
// out from the crown's centre (so light falls across the whole crown as it does on a real one), shaded darker
// underneath, in three shapes (a broad tree, a columnar one, a conifer), with a slight sway in the wind.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { h01 } from "./layout";

/** Unit-ish crown, base near y = -1, top near y = +1, centred on the origin. */
function cluster(blobs: [number, number, number, number][], detail: number, seed: number, stretchY = 1): THREE.BufferGeometry {
  const parts = blobs.map(([x, y, z, r], k) => {
    const g = new THREE.IcosahedronGeometry(r, detail).translate(x, y, z);
    // Jitter the surface a little so the blobs are not perfect spheres.
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      // By position, so the corners shared by neighbouring triangles move together (no cracks).
      const key = Math.round(p.getX(i) * 97) * 73856093 ^ Math.round(p.getY(i) * 97) * 19349663 ^ Math.round(p.getZ(i) * 97) * 83492791;
      const j = 1 + (h01(key + k * 131, seed) - 0.5) * 0.14;
      p.setXYZ(i, x + (p.getX(i) - x) * j, y + (p.getY(i) - y) * j, z + (p.getZ(i) - z) * j);
    }
    return g;
  });
  const g = mergeGeometries(parts)!;
  g.scale(1, stretchY, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = new Float32Array(p.count * 3), c = new Float32Array(p.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    // Normals from the crown's centre, blended with a little of the blob's own, for a soft, lumpy mass.
    v.set(p.getX(i), p.getY(i) / stretchY, p.getZ(i)).normalize();
    n.set([v.x, v.y, v.z], i * 3);
    // Darker inside and underneath, lighter at the top, with a little variety from leaf to leaf.
    const y = p.getY(i) / stretchY;
    const key = Math.round(p.getX(i) * 31) * 73856093 ^ Math.round(p.getY(i) * 31) * 19349663 ^ Math.round(p.getZ(i) * 31) * 83492791;
    const s = 0.62 + 0.38 * Math.max(0, Math.min(1, (y + 1) / 2)) + (h01(key, seed + 9) - 0.5) * 0.1;
    c.set([s * 0.96, s, s * 0.92], i * 3);
  }
  g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

export function crownGeometries() {
  const broadBlobs: [number, number, number, number][] = [[0, 0.1, 0, 0.72], [0.45, -0.15, 0.2, 0.52], [-0.42, -0.1, 0.25, 0.5], [0.1, -0.2, -0.48, 0.5], [-0.25, 0.45, -0.15, 0.48], [0.3, 0.42, 0.25, 0.45], [-0.5, -0.3, -0.3, 0.42]];
  const columnBlobs: [number, number, number, number][] = [[0, -0.6, 0, 0.42], [0.05, -0.1, 0.05, 0.46], [-0.05, 0.35, 0, 0.4], [0, 0.75, 0.02, 0.3], [0.15, 0.1, -0.15, 0.32]];
  const coneHi = coneStack(12), coneLo = coneStack(6);
  return {
    broadHi: cluster(broadBlobs, 2, 3),
    broadLo: cluster([[0, 0, 0, 0.95]], 1, 4),
    columnHi: cluster(columnBlobs, 2, 5, 1),
    columnLo: cluster([[0, 0, 0, 0.9]], 1, 6, 1.6),
    coneHi, coneLo,
  };
}

/** A conifer: three tiers of cone, base at y = 0, top at y = 1. */
function coneStack(sides: number): THREE.BufferGeometry {
  const tiers = [[0.0, 0.55, 1.0], [0.3, 0.8, 0.72], [0.55, 1.0, 0.45]].map(([y0, y1, r]) => new THREE.ConeGeometry(r!, y1! - y0!, sides, 1, true).translate(0, (y0! + y1!) / 2, 0));
  const g = mergeGeometries(tiers.map((t) => t.toNonIndexed()))!;
  const p = g.attributes.position as THREE.BufferAttribute;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const s = 0.65 + 0.35 * p.getY(i); c.set([s, s, s], i * 3); }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

/** Foliage: colour per vertex times per tree, swaying with the wind (uTime), the top more than the bottom. */
export function foliageMaterial(uTime: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.3 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float ph = ip.x * 0.071 + ip.z * 0.053;
          float k = clamp(position.y * 0.5 + 0.5, 0.0, 1.0);
          transformed.x += (sin(uTime * 1.1 + ph) * 0.03 + sin(uTime * 2.7 + ph * 3.0) * 0.012) * k;
          transformed.z += cos(uTime * 0.9 + ph) * 0.02 * k;
        #endif`);
  };
  return m;
}
