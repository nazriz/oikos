// The 3D town's engine: one Three.js scene that follows Lens's clock. It reads the shared state every frame (no React
// re-render per frame), places everyone who is on their way along the streets (from the people fold's occupied and
// vacated rows), drives the cars of those who drive, lights windows where people are, sets the sky by the hour and the
// weather, flies the seat's acts from the town hall to what they reached, and sets out the polling station on the day
// of the poll. Camera: orbit and fly, a swoop to what is double-clicked, a walk at street level, and following a person.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { useLens, type Selection } from "../state";
import { tripOf, placeAt, type CityData } from "../city/data";
import type { WorldBundle } from "../../folds/world";
import { at as along, drivePoint, h01, hashStr, Plan, type Route } from "./layout";
import { buildTown, type TownModel } from "./town";
import { beyondTexture, detailTexture, groundMaterial, paintGround } from "./ground";
import { lightAt, stars, type Light, type Weather } from "./sky";
import { carGeometry, carMaterial, CLOTHES, PAINT, personGeometry, personMaterial, SKIN } from "./figures";
import { Buf, Frame, col } from "./geo";
import { crownGeometries, foliageMaterial } from "./trees";

const DAY = 86_400;
/** A gap between leaving one place and entering the next longer than this is not a walk: they are away (as the map). */
const MAX_TRIP = 3 * 3600;
/** Longer walks than this are driven, by those who may drive a car (a display convention). */
const DRIVE_OVER = 650;
const NOTICE_DAYS = 3;

export type Mode = "fly" | "walk" | "follow";

export interface WorldInput {
  city: CityData;
  world?: WorldBundle;
  /** From the seat fold: the election, when the run has one. */
  election?: { poll_at?: number; result_at?: number };
}

export interface Info { hour: number; weather: Weather; walking: number; driving: number; fps: number; who?: { name: string; doing: string } }

export interface EngineEvents {
  /** The act's sentence for a floating caption ("The AI mayor wrote to the works manager"). */
  caption?(seq: number): string | undefined;
  onMode?(m: Mode): void;
  onInfo?(s: Info): void;
}

const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpM = new THREE.Matrix4(), tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class WorldEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private look?: PointerLockControls;
  private plan: Plan;
  private model: TownModel;
  private city: CityData;
  private world?: WorldBundle;
  private light!: Light;
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private hemi = new THREE.HemisphereLight(0xbcd2ea, 0x6a6450, 0.6);
  private sky = new Sky();
  private skyScene = new THREE.Scene();
  private pmrem: THREE.PMREMGenerator;
  private envRT?: THREE.WebGLRenderTarget;
  private envAt = { hour: -99, weather: "", real: 0 };
  private starField = stars();
  private moon: THREE.Mesh;
  private fog = new THREE.FogExp2(0xc8d4dc, 0.0003);
  private phone: boolean;
  // Dynamic parts.
  private people!: THREE.InstancedMesh;
  private pWalk!: THREE.InstancedBufferAttribute;
  private pSkin!: THREE.InstancedBufferAttribute;
  private pickP: Int32Array;
  private cars!: THREE.InstancedMesh;
  private pickCar: Int32Array;
  private vehicles: { home: number; drivers: number[]; paint: THREE.Color }[] = [];
  private driverOf!: Int32Array;
  private windows!: THREE.InstancedMesh;
  private wLit!: THREE.InstancedBufferAttribute;
  private shopGlass!: THREE.InstancedMesh;
  private gLit!: THREE.InstancedBufferAttribute;
  private uNight = { value: 0 };
  private uSky = { value: new THREE.Color() };
  private uTime = { value: 0 };
  private uRain = { value: 0 };
  private lampHeads!: THREE.MeshStandardMaterial;
  private pools!: THREE.MeshBasicMaterial;
  private smoke!: THREE.InstancedMesh;
  private rain!: THREE.LineSegments;
  private asphaltMat!: THREE.MeshStandardMaterial;
  private buildingsMesh!: THREE.Mesh;
  private later: { mesh: THREE.Mesh; scaffold: THREE.Mesh; started: number; completed?: number; i: number }[] = [];
  private clockHands: { h: THREE.Object3D; m: THREE.Object3D }[] = [];
  private dials: THREE.MeshStandardMaterial[] = [];
  private couriers!: THREE.InstancedMesh;
  private beads!: THREE.InstancedMesh;
  private slips!: THREE.InstancedMesh;
  private notices!: THREE.InstancedMesh;
  private polling?: { group: THREE.Group; at: number; from: number; to: number; t: number[]; who: number[]; label: HTMLDivElement; p: THREE.Vector3; box: THREE.Vector3 };
  private ring: THREE.Mesh;
  private lotBox: THREE.LineLoop;
  private labels: { el: HTMLDivElement; p: THREE.Vector3; i: number; hidden?: boolean }[] = [];
  private labelLayer: HTMLDivElement;
  private acts: { t: number; to: number; refused: boolean; seq: number }[] = [];
  private hall?: number;
  private personPos: Float32Array;
  private personHead: Float32Array;
  private personVisible: Uint8Array;
  private lastVersion = -1;
  private lastLitKey = "";
  private raf = 0;
  private lastReal = performance.now();
  private lastInfo = 0;
  private composer?: EffectComposer;
  private gtao?: GTAOPass;
  private fpsAcc = { n: 0, t: 0, fps: 60 };
  private mode: Mode = "fly";
  private swoop?: { t0: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; q0: THREE.Vector3; q1: THREE.Vector3 };
  private keys = new Set<string>();
  private walkTarget?: THREE.Vector3;
  private yawPitch = { yaw: 0, pitch: 0 };
  private disposed = false;
  private resizeObs: ResizeObserver;
  private unsub: () => void;
  private lastSel: Selection = null;
  private weather: Weather = "clear";
  private pollAt?: number;
  /** For the dev page: show this weather whatever the run's. */
  forceWeather?: Weather;
  private sat = 1;

  constructor(private host: HTMLDivElement, input: WorldInput, private ev: EngineEvents = {}) {
    this.city = input.city;
    this.world = input.world;
    this.pollAt = input.election?.poll_at;
    this.phone = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600 || /[?&]phone=1/.test(location.search);
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: !this.phone, powerPreference: "high-performance", alpha: false }));
    r.setPixelRatio(Math.min(devicePixelRatio, this.phone ? 1.5 : 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.6;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.domElement.style.display = "block";
    r.domElement.style.touchAction = "none";
    host.appendChild(r.domElement);
    this.labelLayer = Object.assign(document.createElement("div"), { className: "lw-labels" });
    host.appendChild(this.labelLayer);
    this.pmrem = new THREE.PMREMGenerator(r);

    const town = this.city.town;
    this.plan = new Plan(town);
    this.model = buildTown(town, this.plan);
    this.hall = town.hall;
    const W = town.ground.w * town.ground.cell, H = town.ground.h * town.ground.cell;

    this.camera = new THREE.PerspectiveCamera(42, 1, 1.5, 24000);
    // Ambient occlusion (desktop): the soft shade where walls meet the ground and roofs meet walls, which is most of
    // what makes a model read as solid. Phones draw without it. \`?ao=0\` on the dev page turns it off.
    if (!this.phone && !/[?&]ao=0/.test(location.search)) {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(r, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
      this.gtao.updateGtaoMaterial({ radius: 3.5, distanceExponent: 1.4, thickness: 3, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
      this.gtao.blendIntensity = 0.85;
      this.composer.addPass(this.gtao);
      this.composer.addPass(new OutputPass());
    }
    const tp = town.places.find((p) => p.kind !== "district")?.area ?? { x: 0, y: 0, w: town.ground.w, h: town.ground.h };
    const c = town.ground.cell;
    const centre = new THREE.Vector3((tp.x + tp.w / 2) * c, 0, (tp.y + tp.h / 2) * c);
    this.camera.position.set(centre.x + 330, 300, centre.z + 500);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.copy(centre);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 4200;
    this.controls.screenSpacePanning = false;
    this.controls.zoomToCursor = true;
    this.controls.update();

    this.scene.fog = this.fog;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.sun.castShadow = true;
    const sm = this.phone ? 2048 : 4096;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.5;
    this.sky.scale.setScalar(20000);
    this.sky.material.uniforms.showSunDisc!.value = 1;
    this.scene.add(this.sky);
    this.scene.add(this.starField);
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(110, 24, 12), new THREE.MeshBasicMaterial({ color: 0xe8e6dc, fog: false }));
    this.scene.add(this.moon);
    // The environment (reflections and skylight) comes from a sky of its own, re-rendered as the hour moves.
    const envSky = new Sky();
    envSky.scale.setScalar(10000);
    envSky.material.uniforms.showSunDisc!.value = 0;
    this.skyScene.add(envSky);

    this.buildGround(W, H);
    this.buildStatic();
    this.buildDynamic();
    this.buildLabels();

    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe8b400, transparent: true, opacity: 0.95, depthWrite: false }));
    this.ring.renderOrder = 3;
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.lotBox = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xe8b400 }));
    this.lotBox.visible = false;
    this.scene.add(this.lotBox);

    const nP = this.city.where.nP;
    this.pickP = new Int32Array(nP).fill(-1);
    this.pickCar = new Int32Array(Math.max(1, this.vehicles.length)).fill(-1);
    this.personPos = new Float32Array(nP * 3);
    this.personHead = new Float32Array(nP);
    this.personVisible = new Uint8Array(nP);

    // Acts: what the seat's acts reached, by structure.
    for (const a of town.acts) {
      const seen = new Set<number>();
      for (const bl of a.blocks) for (const id of bl.to) {
        const tg = town.targets[id];
        let s = -1;
        if (tg?.kind === "entity" && tg.structure !== undefined) s = tg.structure;
        else if (tg?.kind === "person" && tg.person) s = placeAt(this.city, tg.person, a.t);
        // What reached no building of its own (a publication, a body with no premises, the town itself) goes up on
        // the town hall's board.
        if (s < 0) s = this.hall ?? -1;
        if (s < 0 || seen.has(s)) continue;
        seen.add(s);
        this.acts.push({ t: a.t, to: s, refused: a.status === "refused", seq: a.seq });
      }
    }
    this.acts.sort((a, b) => a.t - b.t);
    this.buildPolling();

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.bindInput();
    this.unsub = useLens.subscribe((s) => { if (s.selection !== this.lastSel) { this.lastSel = s.selection; this.onSelection(s.selection); } });
    this.lastSel = useLens.getState().selection;
    if (this.lastSel) this.onSelection(this.lastSel);
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- building the scene

  private buildGround(W: number, H: number) {
    const tex = new THREE.CanvasTexture(paintGround(this.city.town, this.phone ? 6 : 10));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const detail = detailTexture();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2).translate(W / 2, 0, H / 2), groundMaterial(tex, detail, [W, H]));
    ground.receiveShadow = true;
    this.scene.add(ground);
    // The land beyond: a quiet meadow that the haze takes.
    const bt = beyondTexture(2400);
    bt.repeat.set(60000 / 2400, 60000 / 2400);
    const beyondMat = new THREE.MeshStandardMaterial({ map: bt, roughness: 1, envMapIntensity: 0.3 });
    const beyond = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2).translate(W / 2, -0.6, H / 2), beyondMat);
    beyond.receiveShadow = false;
    this.scene.add(beyond);
    // The river: a ribbon of moving water along its chain of cells.
    const cell = this.city.town.ground.cell;
    for (const chain of this.city.town.river) {
      if (chain.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(chain.map(([x, y]) => new THREE.Vector3((x + 0.5) * cell, 0, (y + 0.5) * cell)), false, "centripetal");
      const n = Math.max(8, Math.round(curve.getLength() / 4));
      const pts = curve.getSpacedPoints(n);
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      let dist = 0;
      for (let i = 0; i <= n; i++) {
        const p = pts[i]!, q = pts[Math.min(n, i + 1)]!, o = pts[Math.max(0, i - 1)]!;
        const dx = q.x - o.x, dz = q.z - o.z, l = Math.hypot(dx, dz) || 1;
        const w = 7 + Math.sin(i * 0.37) * 1.5 + h01(i, 3) * 0.8;
        if (i > 0) dist += p.distanceTo(pts[i - 1]!);
        pos.push(p.x - (dz / l) * w, 0.08, p.z + (dx / l) * w, p.x + (dz / l) * w, 0.08, p.z - (dx / l) * w);
        uv.push(dist, 0, dist, 1);
        if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.MeshStandardMaterial({ color: 0x2c4248, roughness: 0.14, metalness: 0.0, envMapIntensity: 0.9 });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.uTime;
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vRiv;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvRiv = uv;");
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying vec2 vRiv;\nuniform float uTime;")
          .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
            float fl = vRiv.x * 0.6 - uTime * 1.2;
            float near = 1.0 / (1.0 + length(vViewPosition) / 120.0);
            float ac = vRiv.y * 6.2832;
            vec3 nw = vec3((sin(fl + sin(ac * 1.7 + uTime * 0.7) * 1.3) * 0.05 + sin(fl * 2.7 + ac) * 0.02) * near, 1.0, cos(fl * 1.9 - ac * 0.6) * 0.04 * near);
            normal = normalize((viewMatrix * vec4(normalize(nw), 0.0)).xyz);
            float edge = smoothstep(0.0, 0.12, vRiv.y) * smoothstep(1.0, 0.88, vRiv.y);
            diffuseColor.rgb = mix(vec3(0.34, 0.37, 0.28), diffuseColor.rgb, edge);`);
      };
      const mesh = new THREE.Mesh(g, m);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  private buildStatic() {
    const M = this.model;
    const mat = (rough: number, env = 0.5) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0, envMapIntensity: env });
    const add = (g: THREE.BufferGeometry, m: THREE.Material, cast = true, recv = true) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = cast; mesh.receiveShadow = recv;
      this.scene.add(mesh);
      return mesh;
    };
    this.buildingsMesh = add(M.buildings, mat(0.86, 0.45));
    add(M.ground, mat(0.95, 0.3), true, true);
    this.asphaltMat = mat(0.9, 0.35);
    add(M.asphalt, this.asphaltMat, false, true);
    add(M.pavement, mat(0.92, 0.3), false, true);
    add(M.markings, mat(0.7, 0.3), false, true);
    add(M.hedges, mat(1, 0.25), true, true);
    for (const L of M.later) {
      const mesh = new THREE.Mesh(L.geo, mat(0.86, 0.45));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.visible = false;
      const scaffold = new THREE.Mesh(scaffoldGeometry(L.geo.boundingBox!), mat(0.8, 0.3));
      scaffold.castShadow = true;
      scaffold.visible = false;
      this.scene.add(mesh, scaffold);
      this.later.push({ mesh, scaffold, started: L.started, completed: L.completed, i: L.i });
    }

    // Windows and shop glass: instanced panels; glass reflects the sky by day, warm when lit.
    const panels = (P: TownModel["windows"], frameCol: number | null, glassCol: number, warm: THREE.Color): [THREE.InstancedMesh, THREE.InstancedBufferAttribute] => {
      const n = P.n;
      const geo = new THREE.PlaneGeometry(1, 1);
      const lit = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      geo.setAttribute("aLit", lit);
      const m = new THREE.MeshStandardMaterial({ color: glassCol, roughness: 0.12, metalness: 0.4, envMapIntensity: 1.1 });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uNight = this.uNight;
        sh.uniforms.uWarm = { value: warm };
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aLit;\nvarying float vLit;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvLit = aLit;");
        sh.fragmentShader = sh.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform float uNight;\nuniform vec3 uWarm;\nvarying float vLit;")
          .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\nvec3 wc = mix(uWarm, vec3(1.0, 0.78, 0.52), fract(vLit * 13.7));\ntotalEmissiveRadiance += wc * vLit * (0.04 + uNight * 0.95);");
      };
      const mesh = new THREE.InstancedMesh(geo, m, n);
      const fr = frameCol !== null ? new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: frameCol, roughness: 0.7 }), n) : undefined;
      for (let k = 0; k < n; k++) {
        const [x, y, z, ang, w, h] = P.data.slice(k * 6, k * 6 + 6) as [number, number, number, number, number, number];
        tmpQ.setFromAxisAngle(UP, ang);
        const nx = Math.sin(ang) * 0.02, nz = Math.cos(ang) * 0.02;
        mesh.setMatrixAt(k, tmpM.compose(tmpV.set(x + nx, y, z + nz), tmpQ, tmpS.set(w, h, 1)));
        fr?.setMatrixAt(k, tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(w + 0.22, h + 0.22, 1)));
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      if (fr) { fr.receiveShadow = true; this.scene.add(fr); }
      return [mesh, lit];
    };
    [this.windows, this.wLit] = panels(M.windows, 0xe9e4d8, 0x2a333c, new THREE.Color(1.0, 0.52, 0.2));
    [this.shopGlass, this.gLit] = panels(M.shopGlass, null, 0x323b42, new THREE.Color(1.0, 0.7, 0.42));

    // Street lamps: a pole with an arm, a lantern that lights at dusk, and the pool of light it casts.
    const n = M.lamps.length;
    const pole = new THREE.CylinderGeometry(0.07, 0.1, 6, 6).translate(0, 3, 0);
    const arm = new THREE.BoxGeometry(0.08, 0.08, 1.3).translate(0, 5.95, 0.6);
    const poleGeo = mergeSimple([pole, arm]);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x2d3338, roughness: 0.6, metalness: 0.4 }), n);
    this.lampHeads = new THREE.MeshStandardMaterial({ color: 0xd9d4c4, emissive: new THREE.Color(1.0, 0.66, 0.34), emissiveIntensity: 0, roughness: 0.4 });
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.16, 0.7).translate(0, 5.84, 1.15), this.lampHeads, n);
    const poolTex = radialTexture();
    this.pools = new THREE.MeshBasicMaterial({ map: poolTex, color: new THREE.Color(1.0, 0.6, 0.28), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(17, 17).rotateX(-Math.PI / 2).translate(0, 0.2, 1.6), this.pools, n);
    M.lamps.forEach((l, k) => {
      tmpQ.setFromAxisAngle(UP, l.heading);
      tmpM.compose(tmpV.set(l.x, 0, l.z), tmpQ, tmpS.set(1, 1, 1));
      poles.setMatrixAt(k, tmpM); heads.setMatrixAt(k, tmpM); pools.setMatrixAt(k, tmpM);
    });
    poles.castShadow = true;
    pools.renderOrder = 2;
    this.scene.add(poles, heads, pools);

    // Trees, by chunk, with a nearer and a farther shape.
    this.buildTrees();
    // The clock's dials and hands.
    if (M.clock) {
      for (const f of M.clock.faces) {
        const g = new THREE.Group();
        g.position.set(f.x, f.y, f.z);
        g.rotation.y = f.heading;
        const dm = new THREE.MeshStandardMaterial({ color: 0xf1ede2, roughness: 0.5, emissive: new THREE.Color(1, 0.93, 0.78), emissiveIntensity: 0 });
        this.dials.push(dm);
        const dial = new THREE.Mesh(new THREE.CircleGeometry(M.clock.r, 32), dm);
        const rim = new THREE.Mesh(new THREE.RingGeometry(M.clock.r, M.clock.r + 0.12, 32), new THREE.MeshStandardMaterial({ color: 0x2b2a26 }));
        const handMat = new THREE.MeshStandardMaterial({ color: 0x1d1b18 });
        const h = new THREE.Object3D(), m = new THREE.Object3D();
        h.add(new THREE.Mesh(new THREE.BoxGeometry(0.11, M.clock.r * 0.55, 0.03).translate(0, M.clock.r * 0.25, 0.04), handMat));
        m.add(new THREE.Mesh(new THREE.BoxGeometry(0.07, M.clock.r * 0.85, 0.03).translate(0, M.clock.r * 0.4, 0.06), handMat));
        for (let k = 0; k < 12; k++) {
          const tick = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.02).translate(0, M.clock.r * 0.82, 0.02), handMat);
          tick.rotation.z = (k / 12) * Math.PI * 2;
          g.add(tick);
        }
        g.add(dial, rim, h, m);
        this.scene.add(g);
        this.clockHands.push({ h, m });
      }
    }
  }

  private buildTrees() {
    const T = this.model.trees;
    const chunk = 450;
    const groups = new Map<string, typeof T>();
    for (const t of T) {
      const k = `${Math.floor(t.x / chunk)},${Math.floor(t.z / chunk)}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
    }
    const G = crownGeometries();
    const trunk = new THREE.CylinderGeometry(0.12, 0.22, 1, 6).translate(0, 0.5, 0);
    const leaf = foliageMaterial(this.uTime);
    const bark = new THREE.MeshStandardMaterial({ color: 0x4a3c30, roughness: 1 });
    // Greens by kind, varied tree to tree: broad trees warmer, columnar ones cooler, conifers dark.
    const tint = { broad: [new THREE.Color("#55743a"), new THREE.Color("#7d9148")], column: [new THREE.Color("#4d6b3c"), new THREE.Color("#66804a")], cone: [new THREE.Color("#2f4a32"), new THREE.Color("#45603c")] };
    this.treeChunks = [];
    const shape = (t: (typeof T)[number]) => (t.kind === 1 ? "cone" : t.tone > 0.84 ? "column" : "broad") as "broad" | "column" | "cone";
    for (const [k, list] of groups) {
      const [cx, cz] = k.split(",").map(Number) as [number, number];
      const mk = (geo: THREE.BufferGeometry, kind: "broad" | "column" | "cone") => {
        const items = list.filter((t) => shape(t) === kind);
        const m = new THREE.InstancedMesh(geo, leaf, Math.max(1, items.length));
        m.count = items.length;
        items.forEach((t, i) => {
          if (kind === "cone") tmpM.compose(tmpV.set(t.x, t.h * 0.22, t.z), tmpQ.setFromAxisAngle(UP, t.tone * 6), tmpS.set(t.r, t.h * 0.82, t.r));
          else if (kind === "column") tmpM.compose(tmpV.set(t.x, t.h + 2 - t.r * 1.5, t.z), tmpQ.setFromAxisAngle(UP, t.tone * 6), tmpS.set(t.r * 0.62, t.r * 1.55, t.r * 0.62));
          else tmpM.compose(tmpV.set(t.x, t.h - t.r * 0.85, t.z), tmpQ.setFromAxisAngle(UP, t.tone * 17), tmpS.set(t.r, t.r * 0.88, t.r));
          m.setMatrixAt(i, tmpM);
          const [a, b] = tint[kind];
          m.setColorAt(i, tmpC.copy(a!).lerp(b!, h01(Math.round(t.x * 13 + t.z * 7), 3)));
        });
        m.castShadow = true; m.receiveShadow = true;
        m.computeBoundingSphere();
        this.scene.add(m);
        return m;
      };
      const tr = new THREE.InstancedMesh(trunk, bark, Math.max(1, list.length));
      tr.count = list.length;
      list.forEach((t, i) => tr.setMatrixAt(i, tmpM.compose(tmpV.set(t.x, 0, t.z), tmpQ.identity(), tmpS.set(1.2, shape(t) === "cone" ? t.h * 0.3 : t.h - t.r * 1.1, 1.2))));
      tr.castShadow = true;
      tr.computeBoundingSphere();
      this.scene.add(tr);
      this.treeChunks.push({
        c: new THREE.Vector3((cx + 0.5) * chunk, 0, (cz + 0.5) * chunk),
        hi: [mk(G.broadHi, "broad"), mk(G.columnHi, "column"), mk(G.coneHi, "cone"), tr], lo: [mk(G.broadLo, "broad"), mk(G.columnLo, "column"), mk(G.coneLo, "cone")],
      });
    }
  }
  private treeChunks: { c: THREE.Vector3; hi: THREE.Object3D[]; lo: THREE.Object3D[] }[] = [];

  private buildDynamic() {
    const nP = this.city.where.nP;
    const pg = personGeometry();
    this.pWalk = new THREE.InstancedBufferAttribute(new Float32Array(nP * 2), 2);
    this.pSkin = new THREE.InstancedBufferAttribute(new Float32Array(nP * 3), 3);
    pg.setAttribute("aWalk", this.pWalk);
    pg.setAttribute("aSkin", this.pSkin);
    this.people = new THREE.InstancedMesh(pg, personMaterial(), nP);
    this.people.count = 0;
    this.people.castShadow = true;
    this.people.frustumCulled = false;
    this.people.setColorAt(0, tmpC.set(1, 1, 1));
    this.scene.add(this.people);

    // Vehicles: each stands on its home lot's drive; those who may drive it take it for the longer trips.
    const town = this.city.town;
    const sById = this.city.sById, pById = this.city.pById;
    this.driverOf = new Int32Array(nP).fill(-1);
    for (const v of this.world?.vehicles ?? []) {
      const home = v.at ? sById.get(v.at) ?? -1 : -1;
      if (home < 0 || !this.plan.lots[home]) continue;
      const drivers = v.drivers.map((d) => pById.get(d) ?? -1).filter((q) => q >= 0);
      const k = this.vehicles.length;
      this.vehicles.push({ home, drivers, paint: PAINT[hashStr(v.id) % PAINT.length]!.clone() });
      for (const q of drivers) if (this.driverOf[q]! < 0) this.driverOf[q] = k;
    }
    this.cars = new THREE.InstancedMesh(carGeometry(), carMaterial({ uNight: this.uNight }), Math.max(1, this.vehicles.length));
    this.cars.count = 0;
    this.cars.castShadow = true; this.cars.receiveShadow = true;
    this.cars.frustumCulled = false;
    this.cars.setColorAt(0, tmpC.set(1, 1, 1));
    this.scene.add(this.cars);
    void town;

    // Smoke from the factories' stacks while anyone is at work there.
    const ch = this.model.chimneys;
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xcfcac2, roughness: 1, transparent: true, opacity: 0.42, depthWrite: false }), Math.max(1, ch.length * 26));
    this.smoke.count = 0;
    this.smoke.frustumCulled = false;
    this.scene.add(this.smoke);

    // Rain: streaks in a box that follows the camera.
    const N = this.phone ? 3000 : 9000;
    const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (h01(i, 1) - 0.5) * 220, y = h01(i, 2) * 120, z = (h01(i, 3) - 0.5) * 220;
      pos.set([x, y, z, x + 0.25, y + 1.4, z + 0.12], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const rm = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime, uRain: this.uRain, uCam: { value: new THREE.Vector3() }, uCol: { value: new THREE.Color(0.75, 0.8, 0.86) } },
      vertexShader: `uniform float uTime; uniform vec3 uCam; varying float vA;
        void main(){ vec3 p = position;
          float y0 = mod(position.y - uTime * 24.0 + 600.0, 120.0);
          float top = mod(float(gl_VertexID), 2.0);
          vec3 w = vec3(0.0);
          w.x = uCam.x + mod(p.x - uCam.x + 110.0, 220.0) - 110.0; w.z = uCam.z + mod(p.z - uCam.z + 110.0, 220.0) - 110.0;
          w.y = uCam.y - 50.0 + y0 + top * 1.4;
          vA = 1.0 - smoothstep(60.0, 110.0, length(w.xz - uCam.xz));
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
      fragmentShader: `uniform float uRain; uniform vec3 uCol; varying float vA; void main(){ gl_FragColor = vec4(uCol, 0.32 * uRain * vA); }`,
      transparent: true, depthWrite: false,
    });
    this.rain = new THREE.LineSegments(rg, rm);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);

    // The seat's acts: a letter carried from the town hall, a notice pinned where it reached.
    const paperTex = noticeTexture();
    this.couriers = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.6, 2.1), new THREE.MeshStandardMaterial({ map: paperTex, side: THREE.DoubleSide, roughness: 0.8, emissive: new THREE.Color(0.9, 0.75, 0.3), emissiveIntensity: 0.25 }), 24);
    this.couriers.count = 0;
    this.couriers.frustumCulled = false;
    this.scene.add(this.couriers);
    // Its path: beads in the mayor's road-marking yellow (stop-sign red when the act was refused), sized to stay
    // visible from far off.
    this.beads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), 24 * 40);
    this.beads.count = 0;
    this.beads.frustumCulled = false;
    this.beads.setColorAt(0, tmpC.set(1, 1, 1));
    this.scene.add(this.beads);
    this.slips = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshBasicMaterial({ color: 0x1f5fad, side: THREE.DoubleSide }), 40);
    this.slips.count = 0;
    this.slips.frustumCulled = false;
    this.scene.add(this.slips);
    this.notices = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.62, 0.82), new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.9 }), 400);
    this.notices.count = 0;
    this.notices.frustumCulled = false;
    this.scene.add(this.notices);
  }

  private buildPolling() {
    // The election's ballot: the one with the most ranked votes on file (the world fold's vote blocks). People vote by
    // a paper they send while the ballot is open (docs/behaviour/elections.md), not by going anywhere, so each vote is
    // drawn as a slip carried from where the voter is to the polling place, and the boxes stand out while it is open.
    const V = this.world?.votes;
    if (!V || !V.t.length) return;
    const n = new Map<number, number>();
    V.ballot.forEach((b, k) => { if (V.ranked[k]) n.set(b, (n.get(b) ?? 0) + 1); });
    const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < 5) return;
    const ts: number[] = [], who: number[] = [];
    V.ballot.forEach((b, k) => { if (b === best[0] && V.ranked[k]) { ts.push(V.t[k]!); who.push(this.city.pById.get(V.who[k]!) ?? -1); } });
    const order = ts.map((_, k) => k).sort((a, b) => ts[a]! - ts[b]!);
    const T = order.map((k) => ts[k]!), W = order.map((k) => who[k]!);
    // The polling place: the electoral body's premises if it has any, else the town hall.
    const body = Object.entries(this.city.town.entities).find(([id, e]) => /elect/.test(id) && e.structure !== undefined)?.[1].structure;
    const at = body ?? this.hall;
    if (at === undefined) return;
    const L = this.plan.lots[at];
    if (!L) return;
    const B = new Buf();
    const F = new Frame(L.door[0] + L.face[0] * 2.5, L.door[1] + L.face[1] * 2.5, L.face[0], L.face[1]);
    const blue = col("#1F5FAD"), white = col("#f1efe8"), wood = col("#6b5a46");
    // A sign on two posts, and two ballot boxes on a table by the door.
    B.box(F, 2.6, 2.7, 0, 2.4, 0, 0.1, wood); B.box(F, 4.6, 4.7, 0, 2.4, 0, 0.1, wood);
    B.box(F, 2.5, 4.8, 1.3, 2.45, 0.1, 0.16, blue);
    B.box(F, 2.65, 4.65, 1.95, 2.25, 0.16, 0.18, white);
    B.box(F, 2.65, 4.65, 1.45, 1.6, 0.16, 0.18, white);
    B.box(F, -3.2, -0.8, 0.74, 0.8, -0.45, 0.45, wood);
    for (const x of [-2.75, -1.25]) { B.box(F, x - 0.32, x + 0.32, 0.8, 1.42, -0.32, 0.32, blue); B.box(F, x - 0.2, x + 0.2, 1.42, 1.44, -0.03, 0.03, col("#0e2340")); }
    for (const x of [-3.0, -1.0]) for (const z of [-0.4, 0.4]) B.box(F, x - 0.04, x + 0.04, 0, 0.74, z - 0.04, z + 0.04, wood);
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(B.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    mesh.castShadow = true;
    g.add(mesh);
    g.visible = false;
    this.scene.add(g);
    const el = document.createElement("div");
    el.className = "lw-label lw-poll";
    this.labelLayer.appendChild(el);
    const from = T[0]! - DAY / 2, to = Math.max(T[T.length - 1]!, this.pollAt ?? 0) + DAY / 2;
    this.polling = { group: g, at, from, to, t: T, who: W, label: el, p: new THREE.Vector3(F.x(3.6, 0), 3.2, F.z(3.6, 0)), box: new THREE.Vector3(F.x(-2, 0), 1.4, F.z(-2, 0)) };
  }

  private buildLabels() {
    const town = this.city.town;
    town.structures.forEach((s, i) => {
      const named = ["civic", "health", "education", "utility"].includes(s.category) || /office/.test(s.type) || (s.category === "industrial" && !/yard/.test(s.type));
      if (!named || !this.plan.lots[i]) return;
      const el = document.createElement("div");
      el.className = "lw-label";
      el.textContent = nameOf(this.city, i);
      el.dataset.kind = s.category;
      this.labelLayer.appendChild(el);
      this.labels.push({ el, p: new THREE.Vector3(this.model.centres[i * 2]!, this.model.tops[i]! + 1.5, this.model.centres[i * 2 + 1]!), i });
    });
  }

  // ---------------------------------------------------------------- input

  private down = { x: 0, y: 0, t: -1e9 };
  private bindInput() {
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("dblclick", this.onDbl);
    el.addEventListener("pointermove", this.onMove);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
  }
  private onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; if (this.mode === "walk" && e.pointerType !== "mouse") this.dragLook = { x: e.clientX, y: e.clientY }; };
  private dragLook?: { x: number; y: number };
  private onMove = (e: PointerEvent) => {
    if (this.mode === "walk" && this.dragLook && e.pointerType !== "mouse") {
      this.yawPitch.yaw -= (e.clientX - this.dragLook.x) * 0.005;
      this.yawPitch.pitch = Math.max(-1.2, Math.min(1.2, this.yawPitch.pitch - (e.clientY - this.dragLook.y) * 0.005));
      this.dragLook = { x: e.clientX, y: e.clientY };
      this.applyLook();
    }
  };
  private onUp = (e: PointerEvent) => {
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
    this.dragLook = undefined;
    if (moved > 6 || performance.now() - this.down.t > 600) return;
    if (this.mode === "walk") {
      if (e.pointerType === "mouse") { if (!this.look?.isLocked) this.look?.lock(); return; }
      const hit = this.pickGround(e);
      if (hit) this.walkTarget = hit.setY(1.7);
      return;
    }
    const sel = this.pick(e);
    useLens.getState().select(sel);
  };
  private onDbl = (e: MouseEvent) => {
    if (this.mode === "walk") return;
    const sel = this.pick(e);
    if (sel) { useLens.getState().select(sel); this.swoopTo(sel); return; }
    const g = this.pickGround(e);
    if (g) this.flyTo(g, 120);
  };
  private onKey = (e: KeyboardEvent) => {
    if (this.mode !== "walk") return;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "q", "e", "shift"].includes(k)) { this.keys.add(k); e.preventDefault(); }
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };

  private ray = new THREE.Raycaster();
  private ndc(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  private pick(e: { clientX: number; clientY: number }): Selection {
    this.ray.setFromCamera(this.ndc(e), this.camera);
    // People first: a generous radius round each figure, since they are small.
    let best = -1, bd = Infinity;
    const ro = this.ray.ray;
    for (let k = 0; k < this.people.count; k++) {
      const q = this.pickP[k]!;
      tmpV.set(this.personPos[q * 3]!, this.personPos[q * 3 + 1]! + 0.9, this.personPos[q * 3 + 2]!);
      const dist = ro.origin.distanceTo(tmpV);
      const rad = Math.max(0.8, dist * 0.012);
      if (ro.distanceSqToPoint(tmpV) < rad * rad && dist < bd) { bd = dist; best = q; }
    }
    for (let k = 0; k < this.cars.count; k++) {
      const q = this.pickCar[k]!;
      if (q < 0) continue;
      tmpV.set(this.personPos[q * 3]!, 0.8, this.personPos[q * 3 + 2]!);
      const dist = ro.origin.distanceTo(tmpV);
      const rad = Math.max(2.4, dist * 0.014);
      if (ro.distanceSqToPoint(tmpV) < rad * rad && dist < bd) { bd = dist; best = q; }
    }
    const hits = this.ray.intersectObjects([this.buildingsMesh, ...this.later.filter((l) => l.mesh.visible).map((l) => l.mesh)], false);
    const h = hits[0];
    if (best >= 0 && (!h || bd < h.distance + 2)) return { kind: "person", id: this.city.people.people[best]![0] };
    if (h && h.faceIndex !== undefined && h.faceIndex !== null) {
      let i = -1;
      if (h.object === this.buildingsMesh) i = this.model.buildingOwner[h.faceIndex] ?? -1;
      else i = this.later.find((l) => l.mesh === h.object)?.i ?? -1;
      if (i >= 0) return { kind: "structure", id: this.city.town.structures[i]!.id };
    }
    return null;
  }
  private pickGround(e: { clientX: number; clientY: number }): THREE.Vector3 | undefined {
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(new THREE.Plane(UP, 0), p) ?? undefined;
  }

  // ---------------------------------------------------------------- camera

  setMode(m: Mode) {
    if (m === this.mode) return;
    const prev = this.mode;
    this.mode = m;
    if (prev === "walk") { this.look?.unlock(); this.controls.enabled = true; this.keys.clear(); this.walkTarget = undefined; }
    if (m === "walk") {
      this.controls.enabled = false;
      if (!this.look) {
        this.look = new PointerLockControls(this.camera, this.renderer.domElement);
        this.look.addEventListener("unlock", () => { /* stays in walk; click to look again */ });
      }
      // Stand behind someone walking near the point being looked at, if anyone is, else on the nearest street.
      const tg = this.controls.target.clone();
      let best = -1, bd = 300 * 300;
      for (let k = 0; k < this.people.count; k++) {
        const q = this.pickP[k]!;
        const d2 = (this.personPos[q * 3]! - tg.x) ** 2 + (this.personPos[q * 3 + 2]! - tg.z) ** 2;
        if (d2 < bd) { bd = d2; best = q; }
      }
      if (best >= 0) {
        const hd = this.personHead[best]!, px = this.personPos[best * 3]!, pz = this.personPos[best * 3 + 2]!;
        this.camera.position.set(px - Math.sin(hd) * 9 + Math.cos(hd) * 1.5, 1.7, pz - Math.cos(hd) * 9 - Math.sin(hd) * 1.5);
        this.yawPitch.yaw = hd + Math.PI;
        this.yawPitch.pitch = -0.05;
        this.applyLook();
        this.ev.onMode?.(m);
        return;
      }
      const road = this.plan.nearestRoad(tg.x, tg.z);
      const [rx, rz] = road >= 0 ? this.plan.centre(road) : [tg.x, tg.z];
      const fromCam = new THREE.Vector3().subVectors(tg, this.camera.position).setY(0).normalize();
      this.camera.position.set(rx + 5.2, 1.7, rz + 5.2);
      this.yawPitch.yaw = Math.atan2(-fromCam.x, -fromCam.z);
      this.yawPitch.pitch = 0;
      this.applyLook();
    }
    if (m === "fly" && prev === "walk") {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const tgt = this.camera.position.clone().addScaledVector(dir.setY(0).normalize(), 40).setY(0);
      this.flyTo(tgt, 160);
    }
    if (m === "follow") this.controls.enabled = true;
    this.ev.onMode?.(m);
  }
  getMode() { return this.mode; }

  private applyLook() {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.yawPitch.pitch, this.yawPitch.yaw, 0, "YXZ"));
  }

  private flyTo(target: THREE.Vector3, dist: number, height = 0.62) {
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).setY(0);
    if (dir.lengthSq() < 1) dir.set(1, 0, 1);
    dir.normalize();
    const p1 = target.clone().addScaledVector(dir, dist * Math.cos(Math.asin(height))).setY(target.y + dist * height);
    this.swoop = { t0: performance.now(), dur: 1300, p0: this.camera.position.clone(), p1, q0: this.controls.target.clone(), q1: target.clone() };
  }

  private swoopTo(sel: Selection) {
    if (!sel) return;
    if (sel.kind === "structure") {
      const i = this.city.sById.get(sel.id);
      if (i === undefined) return;
      const top = this.model.tops[i]!;
      this.flyTo(new THREE.Vector3(this.model.centres[i * 2]!, top * 0.35, this.model.centres[i * 2 + 1]!), Math.max(45, top * 3.2), 0.42);
    } else if (sel.kind === "person") {
      const q = this.city.pById.get(sel.id);
      if (q === undefined) return;
      const p = this.whereIs(q);
      this.flyTo(p, 22, 0.4);
    }
  }

  /** The selected person, in words: where they are or where they are going. */
  private whoInfo(sel: Selection, _t: number): Info["who"] {
    if (sel?.kind !== "person") return undefined;
    const q = this.city.pById.get(sel.id);
    if (q === undefined) return undefined;
    const P = this.city.people.people[q]!;
    const name = P[1] && P[1] !== P[0] ? P[1] : P[0];
    const s = this.city.where.at[q]!;
    if (s >= 0) return { name, doing: `In ${this.placeWords(s)}` };
    const trip = tripOf(this.city, q);
    if (this.personVisible[q] && trip && trip.to >= 0) return { name, doing: `${this.carUsedBy.has(q) ? "Driving" : "Walking"} to ${this.placeWords(trip.to)}` };
    return { name, doing: "Out of town, or somewhere the log does not say" };
  }
  private carUsedBy = new Set<number>();
  private placeWords(i: number): string {
    const st = this.city.town.structures[i]!;
    const n = nameOf(this.city, i);
    return st.houses && this.city.town.entities[st.houses] ? (n === "Town hall" ? "the town hall" : n) : n.charAt(0).toLowerCase() + n.slice(1);
  }

  private whereIs(q: number): THREE.Vector3 {
    if (this.personVisible[q]) return new THREE.Vector3(this.personPos[q * 3]!, 1, this.personPos[q * 3 + 2]!);
    const s = this.city.where.at[q]!;
    const L = s >= 0 ? this.plan.lots[s] : undefined;
    if (L) return new THREE.Vector3(L.door[0], 1, L.door[1]);
    return this.controls.target.clone();
  }

  private onSelection(sel: Selection) {
    this.ring.visible = false;
    this.lotBox.visible = false;
    if (sel?.kind === "structure") {
      const i = this.city.sById.get(sel.id);
      const L = i !== undefined ? this.plan.lots[i] : undefined;
      if (L) {
        const F = new Frame(L.cx, L.cz, L.face[0], L.face[1]);
        const w = L.w / 2 - 0.6, d = L.d / 2 - 0.6;
        const pts = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, z]) => new THREE.Vector3(F.x(x!, z!), 0.25, F.z(x!, z!)));
        this.lotBox.geometry.setFromPoints(pts);
        this.lotBox.visible = true;
      }
    }
    if (sel?.kind === "person" && this.mode === "follow") this.followSnap = true;
    if (sel && (sel.kind === "structure" || sel.kind === "person") && !this.fromOwnClick(sel)) this.swoopTo(sel);
    // An act picked in the story: frame what it reached.
    if (sel?.kind === "act" && this.mode === "fly") this.tourTo([sel.seq], false, false);
  }
  private followSnap = false;
  /** A selection that came from a click in this view is already in sight; one from elsewhere (the story) is flown to. */
  private fromOwnClick(_sel: Selection) { return performance.now() - this.down.t < 800; }

  // ---------------------------------------------------------------- the frame

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastReal) / 1000);
    this.lastReal = now;
    this.fpsAcc.n++; this.fpsAcc.t += dt;
    if (this.fpsAcc.t > 1) { this.fpsAcc.fps = this.fpsAcc.n / this.fpsAcc.t; this.fpsAcc = { n: 0, t: 0, fps: this.fpsAcc.fps }; }
    const st = useLens.getState();
    const t = st.t;
    this.uTime.value = now / 1000;
    const hour = (((t % DAY) + DAY) % DAY) / 3600;
    const day = Math.floor(t / DAY);
    this.weather = this.forceWeather ?? weatherOn(this.world, day);

    this.updateLight(hour, now);
    this.city.where.seek(t);
    this.updateCamera(dt);
    const counts = this.updatePeople(t, st.speed, st.playing, now);
    this.updateWindows(hour);
    this.updateSmoke(now / 1000);
    this.updateActs(t, st.speed);
    this.updateLater(t);
    this.updateClock(hour);
    this.updateSelection();
    this.updateTrees();
    this.updatePolling(t, st.speed);
    this.updateCaptions(t, st.speed);
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    if (now - this.lastInfo > 400) this.lastInfo = now, this.ev.onInfo?.({ hour, weather: this.weather, walking: counts.walking, driving: counts.driving, fps: this.fpsAcc.fps, who: this.whoInfo(st.selection, t) });
  };

  private updateLight(hour: number, now: number) {
    const L = (this.light = lightAt(hour, this.weather, this.light));
    const sunUp = L.sun.y > -0.02;
    const dir = sunUp ? L.sun : L.moon;
    // The shadow-casting light sits over what the camera looks at, its box fitted to the view's reach.
    const focus = this.mode === "walk" ? this.camera.position.clone().setY(0) : this.controls.target.clone().setY(0);
    const reach = this.mode === "walk" ? 140 : Math.min(1500, Math.max(110, this.camera.position.distanceTo(this.controls.target) * 0.95));
    const sc = this.sun.shadow.camera;
    // Snap the focus to the shadow map's texels, so shadows do not shimmer as the camera moves.
    const texel = (reach * 2) / this.sun.shadow.mapSize.x;
    focus.x = Math.round(focus.x / texel) * texel; focus.z = Math.round(focus.z / texel) * texel;
    this.sun.position.copy(focus).addScaledVector(dir, 1500);
    this.sun.target.position.copy(focus);
    if (sc.right !== reach) { sc.left = -reach; sc.right = reach; sc.top = reach; sc.bottom = -reach; sc.near = 10; sc.far = 3200; sc.updateProjectionMatrix(); }
    this.sun.color.copy(sunUp ? L.sunColor : tmpC.set(0.55, 0.63, 0.85));
    this.sun.intensity = sunUp ? L.sunIntensity : 0.55 * (this.weather === "heavy_rain" ? 0.2 : 1);
    this.hemi.color.copy(L.skyColor);
    this.hemi.groundColor.copy(L.groundColor);
    this.hemi.intensity = L.hemiIntensity * 0.6;
    this.fog.color.copy(L.fog);
    this.fog.density = L.fogDensity * (this.mode === "walk" ? 1.6 : 1);
    const u = this.sky.material.uniforms;
    u.sunPosition!.value.copy(L.sun).multiplyScalar(10000);
    u.turbidity!.value = L.turbidity; u.rayleigh!.value = L.rayleigh;
    u.cloudCoverage!.value = L.clouds; u.cloudDensity!.value = this.weather === "heavy_rain" ? 0.9 : 0.45;
    u.time!.value = now / 1000;
    this.sky.visible = L.night < 0.98;
    this.scene.background = tmpC.copy(L.fog);
    (this.starField.material as THREE.ShaderMaterial).uniforms.uOpacity!.value = L.night * (this.weather === "heavy_rain" ? 0.1 : 0.9);
    this.starField.position.copy(this.camera.position);
    this.moon.position.copy(this.camera.position).addScaledVector(L.moon, 8000);
    this.moon.visible = L.night > 0.2 && this.weather !== "heavy_rain";
    this.renderer.toneMappingExposure = L.exposure;
    this.uNight.value = L.night;
    this.uSky.value.copy(L.fog);
    this.lampHeads.emissiveIntensity = L.night * 3.2;
    this.pools.opacity = L.night * 0.38;
    const nightLabels = L.night > 0.5;
    if (nightLabels !== this.labelLayer.classList.contains("night")) this.labelLayer.classList.toggle("night", nightLabels);
    for (const d of this.dials) d.emissiveIntensity = L.night * 0.9;
    // Rain, and wet streets.
    const rainy = this.weather === "heavy_rain";
    this.rain.visible = rainy;
    this.uRain.value = rainy ? 1 : 0;
    if (rainy) ((this.rain.material as THREE.ShaderMaterial).uniforms.uCam!.value as THREE.Vector3).copy(this.camera.position);
    this.asphaltMat.roughness = rainy ? 0.55 : 0.9;
    this.asphaltMat.color.setScalar(rainy ? 0.72 : 1);
    // The environment map, from the same sky, when the hour or weather has moved on.
    const gap = this.phone ? 4000 : 1200;
    if ((Math.abs(hour - this.envAt.hour) > 0.25 && now - this.envAt.real > gap) || this.envAt.weather !== this.weather) {
      const es = this.skyScene.children[0] as Sky;
      const eu = es.material.uniforms;
      eu.sunPosition!.value.copy(L.sun).multiplyScalar(10000);
      eu.turbidity!.value = L.turbidity; eu.rayleigh!.value = L.rayleigh; eu.cloudCoverage!.value = L.clouds;
      this.skyScene.background = L.night > 0.7 ? tmpC.copy(L.fog).multiplyScalar(0.4) : null;
      const rt = this.pmrem.fromScene(this.skyScene, 0, 1, 20000, { size: this.phone ? 64 : 128 } as any);
      this.envRT?.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = 0.35 + (1 - L.night) * 0.15;
      this.envAt = { hour, weather: this.weather, real: now };
    }
  }

  private updateCamera(dt: number) {
    if (this.swoop) {
      const s = this.swoop;
      const f = Math.min(1, (performance.now() - s.t0) / s.dur);
      const e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
      this.camera.position.lerpVectors(s.p0, s.p1, e);
      // Lift in the middle of a long flight, so the swoop clears the roofs.
      const lift = Math.sin(f * Math.PI) * Math.min(120, s.p0.distanceTo(s.p1) * 0.15);
      this.camera.position.y += lift;
      this.controls.target.lerpVectors(s.q0, s.q1, e);
      if (f >= 1) this.swoop = undefined;
    }
    if (this.mode === "walk") {
      const fwd = new THREE.Vector3(-Math.sin(this.yawPitch.yaw), 0, -Math.cos(this.yawPitch.yaw));
      if (this.look?.isLocked) { const d = new THREE.Vector3(); this.camera.getWorldDirection(d); fwd.copy(d.setY(0).normalize()); }
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const v = new THREE.Vector3();
      const sp = this.keys.has("shift") ? 9 : 3.2;
      if (this.keys.has("w")) v.add(fwd);
      if (this.keys.has("s")) v.sub(fwd);
      if (this.keys.has("d")) v.add(right);
      if (this.keys.has("a")) v.sub(right);
      if (v.lengthSq() > 0) { this.camera.position.addScaledVector(v.normalize(), sp * dt); this.walkTarget = undefined; }
      if (this.walkTarget) {
        const to = new THREE.Vector3().subVectors(this.walkTarget, this.camera.position).setY(0);
        const l = to.length();
        if (l < 0.3) this.walkTarget = undefined;
        else this.camera.position.addScaledVector(to.normalize(), Math.min(l, 4 * dt));
      }
      this.camera.position.y = 1.7;
      return;
    }
    if (this.mode === "follow") {
      const sel = useLens.getState().selection;
      const q = sel?.kind === "person" ? this.city.pById.get(sel.id) : undefined;
      if (q !== undefined) {
        const p = this.whereIs(q);
        const k = this.followSnap ? 1 : 1 - Math.exp(-dt * 3);
        this.followSnap = false;
        const delta = new THREE.Vector3().subVectors(p, this.controls.target).multiplyScalar(k);
        this.controls.target.add(delta);
        this.camera.position.add(delta);
        if (this.camera.position.distanceTo(this.controls.target) > 90) this.camera.position.lerp(this.controls.target, 0.04);
      }
    }
    // Keep the camera above the ground and the target in the district.
    this.controls.update();
    if (this.camera.position.y < 1.2) this.camera.position.y = 1.2;
  }

  private updatePeople(t: number, speed: number, playing: boolean, now: number) {
    const c = this.city, W = c.where, nP = W.nP;
    const pos = { x: 0, z: 0, heading: 0 };
    let k = 0, kc = 0, walking = 0, driving = 0;
    const carUsed = new Int32Array(this.vehicles.length).fill(-1);
    this.carUsedBy.clear();
    const kinds = c.people.spaceKinds;
    this.personVisible.fill(0);
    for (let q = 0; q < nP; q++) {
      if (W.at[q]! >= 0) continue;
      const trip = tripOf(c, q);
      if (!trip || trip.from < 0 || trip.to < 0 || trip.from === trip.to || trip.t2 - trip.t1 > MAX_TRIP) continue;
      if (!this.plan.lots[trip.from] || !this.plan.lots[trip.to]) continue;
      const f = Math.max(0, Math.min(1, (t - trip.t1) / Math.max(1, trip.t2 - trip.t1)));
      let route: Route = this.plan.walk(trip.from, trip.to);
      const v = this.driverOf[q]!;
      let drive = false;
      if (v >= 0 && route.len > DRIVE_OVER && carUsed[v]! < 0 && (this.vehicles[v]!.home === trip.from || this.vehicles[v]!.home === trip.to)) {
        drive = true;
        carUsed[v] = q;
        this.carUsedBy.add(q);
        route = this.plan.drive(trip.from, trip.to);
      }
      const d = f * route.len;
      along(route, d, pos);
      const side = drive ? 0 : (h01(q, 9) - 0.5) * 1.1;
      const x = pos.x + Math.cos(pos.heading) * side, z = pos.z - Math.sin(pos.heading) * side;
      this.personPos[q * 3] = x; this.personPos[q * 3 + 1] = 0; this.personPos[q * 3 + 2] = z;
      this.personHead[q] = pos.heading;
      this.personVisible[q] = 1;
      if (drive) {
        driving++;
        tmpQ.setFromAxisAngle(UP, pos.heading);
        this.cars.setMatrixAt(kc, tmpM.compose(tmpV.set(x, 0, z), tmpQ, tmpS.set(1, 1, 1)));
        this.cars.setColorAt(kc, this.vehicles[v]!.paint);
        this.pickCar[kc] = q;
        kc++;
        continue;
      }
      walking++;
      const age = (t - c.people.people[q]![3]) / (365.25 * DAY);
      const sc = age < 5 ? 0.55 : age < 13 ? 0.7 : age < 16 ? 0.88 : 1;
      tmpQ.setFromAxisAngle(UP, pos.heading);
      this.people.setMatrixAt(k, tmpM.compose(tmpV.set(x, 0.14, z), tmpQ, tmpS.set(sc, sc, sc)));
      // Dressed by where they are going.
      const nx = c.nextIn[c.where.out[q]!]!;
      const kind = nx >= 0 ? kinds[Math.abs(c.rows.k[nx]!) - 1] ?? "other" : "other";
      const pal = CLOTHES[kind] ?? CLOTHES.other!;
      this.people.setColorAt(k, tmpC.set(pal[hashStr(c.people.people[q]![0]) % pal.length]!));
      const skin = SKIN[Math.floor(h01(q, 21) * SKIN.length)]!;
      this.pSkin.setXYZ(k, skin.r, skin.g, skin.b);
      // The stride: from the distance walked, unless the clock runs too fast for legs to read.
      const mps = speed * (route.len / Math.max(1, trip.t2 - trip.t1));
      const phase = playing && mps > 5 ? now / 1000 * 9 + q : (d / 0.72) * Math.PI;
      this.pWalk.setXY(k, phase, f > 0.01 && f < 0.99 ? 1 : 0);
      this.pickP[k] = q;
      k++;
    }
    // Parked cars: every vehicle not on the road stands on its home's drive.
    for (let v = 0; v < this.vehicles.length; v++) {
      if (carUsed[v]! >= 0) continue;
      const V = this.vehicles[v]!;
      const L = this.plan.lots[V.home]!;
      const [x, z] = drivePoint(L, this.city.town.ground.cell);
      tmpQ.setFromAxisAngle(UP, Math.atan2(L.face[0], L.face[1]) + Math.PI);
      this.cars.setMatrixAt(kc, tmpM.compose(tmpV.set(x, 0, z), tmpQ, tmpS.set(1, 1, 1)));
      this.cars.setColorAt(kc, V.paint);
      this.pickCar[kc] = -1;
      kc++;
    }
    this.people.count = k;
    this.people.instanceMatrix.needsUpdate = true;
    if (this.people.instanceColor) this.people.instanceColor.needsUpdate = true;
    this.pWalk.needsUpdate = true; this.pSkin.needsUpdate = true;
    this.cars.count = kc;
    this.cars.instanceMatrix.needsUpdate = true;
    if (this.cars.instanceColor) this.cars.instanceColor.needsUpdate = true;
    return { walking, driving };
  }

  private updateWindows(hour: number) {
    const W = this.city.where;
    // Late at night most lights go out (people asleep); a display reading of the hour, not from the log.
    const awake = hour >= 23.5 || hour < 5.5 ? 0.12 : hour >= 22.5 ? 0.5 : 1;
    const key = `${W.version}:${awake}`;
    if (key === this.lastLitKey) return;
    this.lastLitKey = key;
    const town = this.city.town;
    const P = this.model.windows;
    for (let k = 0; k < P.n; k++) {
      const s = P.owner[k]!;
      const st = town.structures[s]!;
      const n = W.count[s]!;
      const cap = Math.max(1, Object.values(st.spaces).reduce((a, b) => a + b, 0) * (st.category === "residential" ? 2.2 : 6));
      const frac = n > 0 ? Math.min(1, 0.25 + (n / cap) * 0.9) : 0;
      this.wLit.setX(k, P.seed[k]! < frac * (st.category === "residential" ? awake : 1) ? 0.45 + 0.55 * h01(k, 99) : 0);
    }
    this.wLit.needsUpdate = true;
    const G = this.model.shopGlass;
    for (let k = 0; k < G.n; k++) this.gLit.setX(k, W.count[G.owner[k]!]! > 0 ? 1 : 0.06);
    this.gLit.needsUpdate = true;
  }

  private updateSmoke(time: number) {
    const ch = this.model.chimneys, W = this.city.where;
    let k = 0;
    const per = 26;
    for (const c of ch) {
      if (W.count[c.owner]! <= 0) continue;
      for (let j = 0; j < per; j++) {
        const a = (time * 0.05 + j / per + h01(c.owner, j) * 0.02) % 1;
        const wob = Math.sin(time * 0.6 + j) * 1.5 * a;
        const s = (1.2 + a * 6.5) * (a > 0.85 ? (1 - a) / 0.15 : 1);
        this.smoke.setMatrixAt(k++, tmpM.compose(tmpV.set(c.x + a * 34 + wob, c.y + a * 26, c.z + a * 14 - wob), tmpQ.identity(), tmpS.set(s, s * 0.85, s)));
      }
    }
    this.smoke.count = k;
    this.smoke.instanceMatrix.needsUpdate = true;
  }

  private updateActs(t: number, speed: number) {
    // A letter is on its way for a few real seconds of the clock after the act; afterwards its notice is pinned up.
    const dur = Math.max(600, Math.min(8 * 3600, speed * 3.5));
    const hall = this.hall;
    let kc = 0, kn = 0, kb = 0;
    if (hall === undefined || !this.plan.lots[hall]) { this.couriers.count = 0; this.notices.count = 0; this.beads.count = 0; return; }
    const hx = this.model.centres[hall * 2]!, hz = this.model.centres[hall * 2 + 1]!, hy = this.model.tops[hall]! - 4;
    // From the newest back, until notices are older than their days.
    let lo = 0, hi = this.acts.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.acts[m]!.t <= t) lo = m + 1; else hi = m; }
    const seenNotice = new Map<number, number>();
    for (let i = lo - 1; i >= 0; i--) {
      const a = this.acts[i]!;
      const age = t - a.t;
      if (age > NOTICE_DAYS * DAY) break;
      const L = this.plan.lots[a.to];
      if (!L) continue;
      const tx = L.door[0], tz = L.door[1];
      if (age < dur && kc < 24 && a.to !== hall) {
        const f = age / dur;
        const dist = Math.hypot(tx - hx, tz - hz), peak = hy + 20 + dist * 0.25;
        const P = (u: number, out: THREE.Vector3) => out.set(hx + (tx - hx) * u, hy + (2.6 - hy) * u + (peak - hy) * 4 * u * (1 - u) * (1 - u * 0.2), hz + (tz - hz) * u);
        const ease = 1 - Math.pow(1 - f, 2);
        const n = Math.min(40, Math.max(8, Math.round(dist / 12)));
        const colour = tmpC2.set(a.refused ? 0xc8102e : 0xe8b400);
        for (let j = 0; j < n && kb < 24 * 40; j++) {
          P(((j + 0.5) / n) * ease, tmpV);
          const s = Math.max(0.28, this.camera.position.distanceTo(tmpV) * 0.0022);
          this.beads.setMatrixAt(kb, tmpM.compose(tmpV, tmpQ.identity(), tmpS.set(s, s, s)));
          this.beads.setColorAt(kb++, colour);
        }
        P(ease, tmpV);
        const s = Math.max(1, this.camera.position.distanceTo(tmpV) * 0.006);
        tmpQ.setFromAxisAngle(UP, now() * 0.002 + i);
        this.couriers.setMatrixAt(kc, tmpM.compose(tmpV, tmpQ, tmpS.set(s, s, s)));
        kc++;
      }
      if (!a.refused && age >= dur * 0.9 && kn < 400) {
        const nth = seenNotice.get(a.to) ?? 0;
        seenNotice.set(a.to, nth + 1);
        if (nth > 5) continue;
        const F = new Frame(L.door[0], L.door[1], L.face[0], L.face[1]);
        const x = 1.15 + (nth % 3) * 0.72, y = 1.75 + Math.floor(nth / 3) * 0.9;
        tmpQ.setFromAxisAngle(UP, F.heading);
        this.notices.setMatrixAt(kn++, tmpM.compose(tmpV.set(F.x(x, -0.55), y, F.z(x, -0.55)), tmpQ, tmpS.set(1, 1, 1)));
      }
    }
    this.couriers.count = kc;
    this.couriers.instanceMatrix.needsUpdate = true;
    this.beads.count = kb;
    this.beads.instanceMatrix.needsUpdate = true;
    if (this.beads.instanceColor) this.beads.instanceColor.needsUpdate = true;
    this.notices.count = kn;
    this.notices.instanceMatrix.needsUpdate = true;
  }

  private updatePolling(t: number, speed: number) {
    const P = this.polling;
    if (!P) return;
    const open = t >= P.from && t <= P.to;
    P.group.visible = open;
    // How many have voted so far, written on the sign.
    let lo = 0, hi = P.t.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (P.t[m]! <= t) lo = m + 1; else hi = m; }
    const cast = lo;
    tmpV.copy(P.p).project(this.camera);
    const d = this.camera.position.distanceTo(P.p);
    if (!open || tmpV.z > 1 || d > 900) P.label.style.display = "none";
    else {
      const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
      P.label.style.display = "";
      const text = `Polling station: ${cast} ${cast === 1 ? "vote" : "votes"} in`;
      if (P.label.textContent !== text) P.label.textContent = text;
      P.label.style.transform = `translate(-50%, -100%) translate(${((tmpV.x + 1) / 2) * w}px, ${((1 - tmpV.y) / 2) * h}px)`;
    }
    // Slips on their way: each vote in the last few real seconds of the clock, from the voter to the boxes.
    const dur = Math.max(300, Math.min(4 * 3600, speed * 2.5));
    let k = this.slipBase;
    for (let i = cast - 1; i >= 0 && t - P.t[i]! < dur && k < 40; i--) {
      const q = P.who[i]!;
      if (q < 0) continue;
      const s = placeAt(this.city, this.city.people.people[q]![0], P.t[i]!);
      const L = s >= 0 ? this.plan.lots[s] : undefined;
      if (!L) continue;
      const f = (t - P.t[i]!) / dur, e = 1 - Math.pow(1 - f, 2);
      const x0 = L.door[0], z0 = L.door[1], dist = Math.hypot(P.box.x - x0, P.box.z - z0);
      const peak = 12 + dist * 0.18;
      tmpV.set(x0 + (P.box.x - x0) * e, 2 + (P.box.y - 2) * e + peak * 4 * e * (1 - e), z0 + (P.box.z - z0) * e);
      const sc = Math.max(0.7, this.camera.position.distanceTo(tmpV) * 0.005);
      tmpQ.setFromAxisAngle(UP, now() * 0.003 + i);
      this.slips.setMatrixAt(k - this.slipBase, tmpM.compose(tmpV, tmpQ, tmpS.set(sc, sc, sc)));
      k++;
    }
    this.slips.count = k - this.slipBase;
    this.slips.instanceMatrix.needsUpdate = true;
  }
  private slipBase = 0;

  /** Floating signs over what the mayor's latest acts reached, in words, for a little while after each. */
  private captions: HTMLDivElement[] = [];
  private updateCaptions(t: number, speed: number) {
    const keep = Math.max(1800, Math.min(12 * 3600, speed * 6));
    let lo = 0, hi = this.acts.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.acts[m]!.t <= t) lo = m + 1; else hi = m; }
    const shown: { a: { t: number; to: number; refused: boolean; seq: number }; text: string }[] = [];
    const seenTo = new Set<number>();
    for (let i = lo - 1; i >= 0 && shown.length < 3 && t - this.acts[i]!.t < keep; i--) {
      const a = this.acts[i]!;
      if (seenTo.has(a.to)) continue;
      const text = this.ev.caption?.(a.seq);
      if (!text) continue;
      seenTo.add(a.to);
      shown.push({ a, text });
    }
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    const placed: [number, number, number, number][] = [];
    for (let k = 0; k < Math.max(shown.length, this.captions.length); k++) {
      let el = this.captions[k];
      if (!el) { el = document.createElement("div"); el.className = "lw-caption"; this.labelLayer.appendChild(el); this.captions.push(el); }
      const c = shown[k];
      if (!c) { el.style.display = "none"; continue; }
      const L = this.plan.lots[c.a.to];
      tmpV.set(this.model.centres[c.a.to * 2]!, (this.model.tops[c.a.to] ?? 6) + 6, this.model.centres[c.a.to * 2 + 1]!);
      if (!L) { el.style.display = "none"; continue; }
      tmpV.project(this.camera);
      if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.05 || Math.abs(tmpV.y) > 1.05) { el.style.display = "none"; continue; }
      el.style.display = "";
      if (el.textContent !== c.text) el.textContent = c.text;
      el.classList.toggle("refused", c.a.refused);
      // Kept inside the view: a sign near the edge slides in rather than being cut off.
      const half = (el.offsetWidth || 200) / 2, eh = el.offsetHeight || 34;
      const x = Math.max(half + 8, Math.min(w - half - 8, ((tmpV.x + 1) / 2) * w));
      // Stacked upward where signs would overlap.
      let y = ((1 - tmpV.y) / 2) * h;
      for (let tries = 0; tries < 4 && placed.some(([a, b, c, d]) => x - half < c && x + half > a && y - eh < d && y > b); tries++) y = Math.min(...placed.filter(([a, , c]) => x - half < c && x + half > a).map(([, b]) => b)) - 4;
      y = Math.max(y, eh + 100); // below the view's own controls
      placed.push([x - half, y - eh, x + half, y]);
      el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
    }
  }

  /** The tour: frame what a moment's acts reached (or the town hall, or the polling place), and turn slowly round it. */
  tourTo(actSeqs: number[], election: boolean, turn = true) {
    const set = new Set(actSeqs);
    const pts: THREE.Vector3[] = [];
    const add = (i: number | undefined) => { if (i !== undefined && i >= 0 && this.plan.lots[i]) pts.push(new THREE.Vector3(this.model.centres[i * 2]!, 0, this.model.centres[i * 2 + 1]!)); };
    for (const a of this.acts) if (set.has(a.seq)) add(a.to);
    if (election && this.polling) add(this.polling.at);
    if (!pts.length) add(this.hall);
    if (!pts.length) return;
    const c = pts.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    const spread = Math.max(...pts.map((p) => p.distanceTo(c)));
    if (this.mode !== "fly") this.setMode("fly");
    this.flyTo(c.setY(4), Math.max(85, Math.min(900, spread * 2.2 + 60)), pts.length > 1 ? 0.55 : 0.4);
    this.controls.autoRotate = turn;
    this.controls.autoRotateSpeed = 0.35;
  }
  endTour() { this.controls.autoRotate = false; }

  private updateLater(t: number) {
    for (const L of this.later) {
      const on = t >= L.started;
      L.mesh.visible = on;
      const end = L.completed ?? L.started + 120 * DAY;
      const done = L.completed !== undefined && t >= L.completed;
      const f = done ? 1 : Math.max(0.08, Math.min(1, (t - L.started) / Math.max(1, end - L.started)));
      L.mesh.scale.y = f;
      L.scaffold.visible = on && !done;
      const h = Math.min(1, f + 0.12);
      L.scaffold.scale.y = h;
    }
  }

  private updateClock(hour: number) {
    const m = (hour % 1) * Math.PI * 2, h = ((hour % 12) / 12) * Math.PI * 2;
    for (const c of this.clockHands) { c.h.rotation.z = -h; c.m.rotation.z = -m; }
  }

  private updateSelection() {
    const sel = useLens.getState().selection;
    if (sel?.kind === "person") {
      const q = this.city.pById.get(sel.id);
      if (q !== undefined) {
        const p = this.whereIs(q);
        this.ring.position.set(p.x, 0.22, p.z);
        const d = this.camera.position.distanceTo(p);
        const s = Math.max(1, d / 60);
        this.ring.scale.set(s, 1, s);
        this.ring.visible = true;
      }
    }
  }

  private updateTrees() {
    const cam = this.camera.position;
    const near = this.phone ? 420 : 750;
    for (const c of this.treeChunks) {
      const d = Math.hypot(c.c.x - cam.x, c.c.z - cam.z) - 320;
      const hi = d < near;
      for (const o of c.hi) o.visible = hi;
      for (const o of c.lo) o.visible = !hi;
    }
  }

  private updateLabels() {
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    const cam = this.camera.position;
    const walk = this.mode === "walk";
    this.labelTick = (this.labelTick + 1) % 6;
    const order = this.labels.map((L) => ({ L, d: cam.distanceTo(L.p) })).sort((a, b) => a.d - b.d);
    const placed: [number, number, number, number][] = [];
    for (const { L, d } of order) {
      tmpV.copy(L.p).project(this.camera);
      const minor = L.el.dataset.kind === "industrial" || L.el.dataset.kind === "utility";
      let show = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 && d < (walk ? 260 : minor ? 420 : 1100) && d > 12;
      // Hidden behind another building (checked every few frames against the buildings' boxes).
      if (show && this.labelTick === 0) L.hidden = this.occluded(L.p, L.i);
      if (L.hidden) show = false;
      const x = ((tmpV.x + 1) / 2) * w, y = ((1 - tmpV.y) / 2) * h;
      const lw = L.el.textContent!.length * 7 + 14;
      if (show && placed.some(([a, b, c, e]) => x - lw / 2 < c && x + lw / 2 > a && y - 18 < e && y > b)) show = false;
      if (!show) { if (L.el.style.display !== "none") L.el.style.display = "none"; continue; }
      placed.push([x - lw / 2, y - 18, x + lw / 2, y]);
      L.el.style.display = "";
      L.el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      L.el.style.opacity = String(Math.max(0.4, Math.min(1, 1.6 - d / 1100)));
    }
  }
  private labelTick = 0;

  /** Does the line from the camera to p pass through any building but structure `own`? (Slab test on their boxes.) */
  private occluded(p: THREE.Vector3, own: number): boolean {
    const o = this.camera.position, B = this.model.boxes;
    const dx = p.x - o.x, dy = p.y - o.y, dz = p.z - o.z;
    for (let i = 0; i * 6 < B.length; i++) {
      if (i === own || B[i * 6]! === Infinity) continue;
      let t0 = 0, t1 = 0.98;
      const ax = [dx, dy, dz], ao = [o.x, o.y, o.z];
      let hit = true;
      for (let a = 0; a < 3 && hit; a++) {
        const lo = B[i * 6 + a]!, hi = B[i * 6 + 3 + a]!;
        if (Math.abs(ax[a]!) < 1e-9) { if (ao[a]! < lo || ao[a]! > hi) hit = false; continue; }
        let ta = (lo - ao[a]!) / ax[a]!, tb = (hi - ao[a]!) / ax[a]!;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) hit = false;
      }
      if (hit) return true;
    }
    return false;
  }

  private resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setSize(w, h);
      // Ambient occlusion at half resolution: soft contact shade does not need every pixel.
      const pr = this.renderer.getPixelRatio();
      this.gtao!.setSize(Math.round((w * pr) / 2), Math.round((h * pr) / 2));
    }
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** For the dev page and tests: place the camera. */
  setView(target: [number, number, number], dist: number, tilt: number, turn: number) {
    const el = (tilt * Math.PI) / 180, az = (turn * Math.PI) / 180;
    this.controls.target.set(...target);
    this.camera.position.set(target[0] + Math.sin(az) * Math.cos(el) * dist, target[1] + Math.sin(el) * dist, target[2] + Math.cos(az) * Math.cos(el) * dist);
    this.controls.update();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.unsub();
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    this.look?.unlock();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
    });
    this.envRT?.dispose();
    this.composer?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }
}

const now = () => performance.now();

function weatherOn(w: WorldBundle | undefined, day: number): Weather {
  for (const e of w?.weather ?? []) if (day >= e.from_day && day < e.from_day + e.days) return (e.kind as Weather) ?? "clear";
  return "clear";
}

export function nameOf(c: CityData, i: number): string {
  const s = c.town.structures[i]!;
  if (s.houses && c.town.entities[s.houses]) {
    const e = c.town.entities[s.houses]!;
    if (e.kind === "government") return s.category === "civic" ? "Town hall" : e.name;
    return e.name;
  }
  const t = s.id.replace(/^apts-/, "apartments-").replace(/[-_]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function mergeSimple(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ps: number[] = [], ns: number[] = [];
  for (let g of gs) {
    if (g.index) g = g.toNonIndexed();
    ps.push(...(g.attributes.position!.array as Float32Array));
    ns.push(...(g.attributes.normal!.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(ps, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(ns, 3));
  return out;
}

function radialTexture(): THREE.CanvasTexture {
  const N = 128;
  const cv = Object.assign(document.createElement("canvas"), { width: N, height: N });
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.45, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  return new THREE.CanvasTexture(cv);
}

/** A notice: cream paper with a band in the mayor's colour and lines of text. */
function noticeTexture(): THREE.CanvasTexture {
  const cv = Object.assign(document.createElement("canvas"), { width: 64, height: 84 });
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#f3efe3"; ctx.fillRect(0, 0, 64, 84);
  ctx.fillStyle = "#E8B400"; ctx.fillRect(0, 0, 64, 12);
  ctx.fillStyle = "#59636b";
  for (let y = 20; y < 76; y += 7) ctx.fillRect(7, y, 50 - ((y * 7) % 17), 2);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Scaffolding round a building going up: standards every few metres, ledgers and boards at each lift. */
function scaffoldGeometry(bb: THREE.Box3): THREE.BufferGeometry {
  const B = new Buf();
  const pole = col("#8d9093"), board = col("#9b7a4e");
  const x0 = bb.min.x - 1.2, x1 = bb.max.x + 1.2, z0 = bb.min.z - 1.2, z1 = bb.max.z + 1.2, top = Math.max(3, bb.max.y + 1);
  // A frame facing +z: its local x runs to world -x.
  const F = new Frame(0, 0, 0, 1);
  const along = (a: number, b: number) => { const n = Math.max(1, Math.round((b - a) / 2.6)); return Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n); };
  for (const x of along(x0, x1)) for (const z of [z0, z1]) B.box(F, -x - 0.05, -x + 0.05, 0, top, z - 0.05, z + 0.05, pole);
  for (const z of along(z0, z1)) for (const x of [x0, x1]) B.box(F, -x - 0.05, -x + 0.05, 0, top, z - 0.05, z + 0.05, pole);
  for (let y = 2; y < top; y += 2) {
    for (const z of [z0, z1]) B.box(F, -x1, -x0, y - 0.06, y, z - 0.35, z + 0.35, board);
    for (const x of [x0, x1]) B.box(F, -x - 0.35, -x + 0.35, y - 0.06, y, z0, z1, board);
  }
  return B.geometry();
}
