// People and cars as instances: a simple low-poly person whose legs and arms swing as they walk (in the vertex
// shader, from a phase per instance), and a car with lamps that light at night. Clothes and paint come per instance;
// skin, trousers, glass and tyres per vertex.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

function part(g: THREE.BufferGeometry, id: number, c: [number, number, number]): THREE.BufferGeometry {
  const n = g.attributes.position!.count;
  g.setAttribute("aPart", new THREE.Float32BufferAttribute(new Float32Array(n).fill(id), 1));
  const cc = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) cc.set(c, i * 3);
  g.setAttribute("color", new THREE.Float32BufferAttribute(cc, 3));
  return g.index ? g.toNonIndexed() : g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/** A person 1.75 m tall facing +z, feet at y = 0. Parts: 0 torso, 1-2 legs, 3-4 arms, 5 head, 6 hair. */
export function personGeometry(): THREE.BufferGeometry {
  const trousers: [number, number, number] = [0.22, 0.24, 0.28];
  const g = mergeGeometries([
    part(box(0.38, 0.6, 0.24, 0, 1.16, 0), 0, [1, 1, 1]),
    part(box(0.16, 0.86, 0.18, -0.105, 0.43, 0), 1, trousers),
    part(box(0.16, 0.86, 0.18, 0.105, 0.43, 0), 2, trousers),
    part(box(0.1, 0.6, 0.12, -0.25, 1.15, 0), 3, [0.85, 0.85, 0.85]),
    part(box(0.1, 0.6, 0.12, 0.25, 1.15, 0), 4, [0.85, 0.85, 0.85]),
    part(new THREE.IcosahedronGeometry(0.12, 1).scale(1, 1.12, 1).translate(0, 1.6, 0), 5, [1, 1, 1]),
    part(box(0.25, 0.08, 0.25, 0, 1.73, -0.01), 6, [0.18, 0.14, 0.11]),
  ])!;
  g.computeBoundingSphere();
  return g;
}

/** A car 4.2 m long facing +z, wheels on y = 0. Parts: 0 body (painted), 1 glass, 2 tyres, 3 head lamps, 4 tail lamps. */
export function carGeometry(): THREE.BufferGeometry {
  const glass: [number, number, number] = [0.12, 0.14, 0.17], tyre: [number, number, number] = [0.07, 0.07, 0.07];
  const wheels = [[-0.8, 1.35], [0.8, 1.35], [-0.8, -1.35], [0.8, -1.35]].map(([x, z]) => part(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 10).rotateZ(Math.PI / 2).translate(x!, 0.33, z!), 2, tyre));
  const g = mergeGeometries([
    part(box(1.76, 0.62, 4.2, 0, 0.62, 0), 0, [1, 1, 1]),
    part(box(1.56, 0.52, 2.2, 0, 1.19, -0.25), 1, glass),
    part(box(1.5, 0.06, 2.0, 0, 1.47, -0.25), 0, [1, 1, 1]),
    part(box(0.32, 0.14, 0.04, -0.6, 0.72, 2.11), 3, [0.95, 0.95, 0.9]),
    part(box(0.32, 0.14, 0.04, 0.6, 0.72, 2.11), 3, [0.95, 0.95, 0.9]),
    part(box(0.3, 0.12, 0.04, -0.62, 0.74, -2.11), 4, [0.5, 0.06, 0.05]),
    part(box(0.3, 0.12, 0.04, 0.62, 0.74, -2.11), 4, [0.5, 0.06, 0.05]),
    ...wheels,
  ])!;
  g.computeBoundingSphere();
  return g;
}

export interface FigureUniforms { uNight: { value: number } }

/** Material for people: clothes from instanceColor, skin from the instance's aSkin, walk from aWalk (phase, swing). */
export function personMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        attribute float aPart;
        attribute vec2 aWalk;
        attribute vec3 aSkin;`)
      .replace("#include <color_vertex>", `
        vColor = vec4(1.0);
        vColor.rgb = color;
        #ifdef USE_INSTANCING_COLOR
          if (aPart < 0.5 || (aPart > 2.5 && aPart < 4.5)) vColor.rgb = instanceColor.rgb * color;
        #endif
        if (aPart > 4.5 && aPart < 5.5) vColor.rgb = aSkin;`)
      .replace("#include <begin_vertex>", `
        vec3 transformed = vec3(position);
        float sw = sin(aWalk.x) * aWalk.y;
        // A step's rise and fall, twice a stride, and a slight lean into the walk.
        transformed.y += abs(cos(aWalk.x)) * 0.04 * aWalk.y;
        transformed.z += position.y * 0.025 * aWalk.y;
        if (aPart > 0.5 && aPart < 2.5) {
          float a = (aPart < 1.5 ? sw : -sw) * 0.5; float py = 0.86;
          float yy = transformed.y - py; float zz = transformed.z;
          transformed.y = py + yy * cos(a) - zz * sin(a); transformed.z = yy * sin(a) + zz * cos(a);
        } else if (aPart > 2.5 && aPart < 4.5) {
          float a = (aPart < 3.5 ? -sw : sw) * 0.42; float py = 1.44;
          float yy = transformed.y - py; float zz = transformed.z;
          transformed.y = py + yy * cos(a) - zz * sin(a); transformed.z = yy * sin(a) + zz * cos(a);
        }`);
  };
  return m;
}

/** Material for cars: paint from instanceColor; lamps glow by night (uNight). */
export function carMaterial(u: FigureUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.25 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = u.uNight;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        attribute float aPart;
        varying float vPart;`)
      .replace("#include <color_vertex>", `
        vColor = vec4(1.0);
        vColor.rgb = color;
        #ifdef USE_INSTANCING_COLOR
          if (aPart < 0.5) vColor.rgb = instanceColor.rgb;
        #endif
        vPart = aPart;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform float uNight;
        varying float vPart;`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        if (vPart > 2.5 && vPart < 3.5) totalEmissiveRadiance += vec3(1.0, 0.92, 0.75) * (0.2 + uNight * 3.0);
        if (vPart > 3.5) totalEmissiveRadiance += vec3(0.9, 0.05, 0.03) * (0.1 + uNight * 1.6);`);
  };
  return m;
}

/** Clothes: muted, varied, a little brighter for children; by where they are headed (src/client/world/README in decisions). */
export const CLOTHES = {
  workplace: ["#3f5e7a", "#4a5560", "#5d6b78", "#34495c"],
  classroom: ["#b5654a", "#c27a52", "#a85a44"],
  dwelling: ["#8c7b6b", "#7d6e60", "#9b8a77", "#6f6a62"],
  hall: ["#1f5fad", "#2a69b5"],
  waiting: ["#c9c2b6", "#b8b2a8"],
  other: ["#8c7b6b", "#7a7f72"],
} as Record<string, string[]>;

export const SKIN = ["#d4a888", "#c4926e", "#a87552", "#86593b", "#5e3f2b", "#dcb699"].map((h) => new THREE.Color(h));
export const PAINT = ["#2f3a45", "#7c2a2a", "#c8c6c0", "#3e4f43", "#1f2a3a", "#8a8d90", "#5a4a3a", "#e4e1da", "#30466b", "#6b6f72"].map((h) => new THREE.Color(h));
