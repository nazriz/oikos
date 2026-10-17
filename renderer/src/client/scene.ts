// The town in three dimensions: an isometric orthographic view of the world's ground, its buildings (instanced boxes with
// roofs, lit windows at night), trees on woodland and parks, and its people as small lights on the roof of the building
// they are in, hopping between buildings when the log says they moved (the hop is drawn, not logged: the log says where
// people are, never the route). Seats' acts are arcs from the office to where they land; consequential changes are rings.
// Three.js on WebGPU, falling back to WebGL 2 by itself where WebGPU is missing.

import * as THREE from "three/webgpu";
import { MapControls } from "three/addons/controls/MapControls.js";
import { CATEGORY, DAY, type WorldData } from "./api";

const ISO_POLAR = Math.acos(1 / Math.sqrt(3)); // 54.74 degrees from straight down: the true isometric angle
const FLAT = new Set(["road", "park"]);
const TERRAIN: Record<string, string> = { grassland: "#86ad66", farmland: "#c4b06a", woodland: "#4c7a47", scrub: "#97a46a", wetland: "#6c9886", riverbank: "#79aaa0", cleared: "#b4a382", built: "#bdb4a3", water: "#3f7fb4" };
const KIND_COLOR: Record<string, THREE.Color> = { dwelling: new THREE.Color("#ffd27a"), workplace: new THREE.Color("#7fd3ff"), other: new THREE.Color("#d2a8ff") };

const hash = (n: number) => { let x = (n + 0x9e3779b9) | 0; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

export interface Ring { x: number; z: number; y: number; color: THREE.Color; born: number; life: number; size: number }
interface Arc { mesh: THREE.Mesh; head: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; born: number; life: number; color: THREE.Color; keep: boolean }

export class Town {
  renderer!: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera!: THREE.OrthographicCamera;
  controls!: MapControls;
  backend = "";
  readonly W: number; readonly H: number; readonly S: number; readonly P: number;
  /** Per structure: centre x, z, roof height; instance index in the box meshes (-1: flat or not placed). */
  sx: Float32Array; sz: Float32Array; top: Float32Array; inst: Int32Array; instStruct: number[] = [];
  walls!: THREE.InstancedMesh; roofs!: THREE.InstancedMesh; pools!: THREE.InstancedMesh; people!: THREE.InstancedMesh; rings!: THREE.InstancedMesh;
  wallMat!: THREE.MeshStandardMaterial;
  sun = new THREE.DirectionalLight(0xffffff, 2.2); hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3b3426, 1.0);
  gate = new THREE.Vector3();
  night = 0;
  /** An overlay is on: its colours must read at any hour, so windows do not glow and the night is kept light. */
  overlayLit = false;
  // people
  spaceStruct: Int32Array; spaceKind: Uint8Array; // 0 dwelling, 1 workplace, 2 other
  cur: Uint32Array; prev: Uint32Array; moveT: Float64Array; hopDur = 900;
  personColor: Float32Array; colorOverride: ((p: number) => THREE.Color | null) | null = null;
  occupancy: Uint16Array;
  selectedPerson = -1;
  private ringList: Ring[] = [];
  private arcs: Arc[] = [];
  private beacons = new THREE.Group();
  private tmpM = new THREE.Matrix4(); private tmpC = new THREE.Color(); private tmpV = new THREE.Vector3();
  private canvas: HTMLCanvasElement;

  constructor(readonly data: WorldData, host: HTMLElement) {
    const g = data.world.ground;
    this.W = g.w; this.H = g.h;
    const structs = data.world.structures;
    this.S = structs.length + data.meta.extraStructures.length;
    this.P = data.meta.persons;
    this.sx = new Float32Array(this.S).fill(-999); this.sz = new Float32Array(this.S).fill(-999); this.top = new Float32Array(this.S); this.inst = new Int32Array(this.S).fill(-1);
    structs.forEach((s, i) => { this.sx[i] = s.x + s.w / 2; this.sz[i] = s.y + s.h / 2; this.top[i] = FLAT.has(s.type) ? 0.04 : s.levels * 0.55 + 0.08; });
    this.spaceStruct = Int32Array.from(data.meta.spaces.map((x) => x[0]));
    this.spaceKind = Uint8Array.from(data.meta.spaces.map((x) => (x[1] === "dwelling" ? 0 : x[1] === "workplace" ? 1 : 2)));
    this.cur = new Uint32Array(this.P); this.prev = new Uint32Array(this.P); this.moveT = new Float64Array(this.P).fill(-1e12);
    this.personColor = new Float32Array(this.P * 3);
    this.occupancy = new Uint16Array(this.S);
    this.gate.set(-5, 0, this.H * 0.5);
    this.canvas = document.createElement("canvas");
    this.canvas.className = "scene";
    host.appendChild(this.canvas);
  }

  async init(forceWebGL = false) {
    this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: true, alpha: true, forceWebGL });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    await this.renderer.init();
    this.backend = (this.renderer.backend as any).isWebGPUBackend ? "WebGPU" : "WebGL 2";
    const aspect = this.aspect();
    const f = Math.max(this.W, this.H) * 0.62;
    this.camera = new THREE.OrthographicCamera(-f * aspect, f * aspect, f, -f, -2000, 4000);
    const target = new THREE.Vector3(this.W / 2, 0, this.H / 2);
    this.camera.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(800, ISO_POLAR, Math.PI / 4));
    this.camera.lookAt(target);
    this.controls = new MapControls(this.camera, this.canvas);
    this.controls.target.copy(target);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12;
    this.controls.minPolarAngle = this.controls.maxPolarAngle = ISO_POLAR;
    this.controls.zoomToCursor = true; this.controls.minZoom = 0.6; this.controls.maxZoom = 40;
    this.controls.screenSpacePanning = false;
    this.controls.update();
    this.build();
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.frameTown();
  }

  /** Opens on the built town, not the whole ground: the centre and extent of the buildings. */
  frameTown() {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const s of this.data.world.structures) { if (s.type === "road") continue; x0 = Math.min(x0, s.x); z0 = Math.min(z0, s.y); x1 = Math.max(x1, s.x + s.w); z1 = Math.max(z1, s.y + s.h); }
    if (!Number.isFinite(x0)) return;
    const c = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const off = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.copy(c); this.camera.position.copy(c).add(off);
    const ext = Math.max(x1 - x0, z1 - z0) * 1.05;
    const f = Math.max(this.W, this.H) * 0.62;
    const a = this.aspect();
    this.camera.zoom = Math.max(1, Math.min(8, (f * 2 * Math.min(a, 1.4)) / (ext * 1.42)));
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private aspect() { const r = this.canvas.getBoundingClientRect(); return Math.max(0.2, (r.width || innerWidth) / (r.height || innerHeight)); }
  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    const a = r.width / Math.max(1, r.height), f = Math.max(this.W, this.H) * 0.62;
    this.camera.left = -f * a; this.camera.right = f * a; this.camera.top = f; this.camera.bottom = -f;
    this.camera.updateProjectionMatrix();
  }

  // ---------- the static town
  private build() {
    const { W, H } = this;
    const d = this.data.world;
    // The ground, painted once: terrain, water, lots, roads and parks.
    const px = 8, cv = document.createElement("canvas");
    cv.width = W * px; cv.height = H * px;
    const c = cv.getContext("2d")!;
    c.fillStyle = TERRAIN.grassland!; c.fillRect(0, 0, cv.width, cv.height);
    for (const t of d.ground.terrain) { c.fillStyle = TERRAIN[t.label] ?? TERRAIN.grassland!; c.fillRect(t.x * px, t.y * px, t.w * px, t.h * px); }
    for (const t of d.ground.terrain) if (t.label === "farmland") { c.strokeStyle = "rgba(90,70,30,0.18)"; c.lineWidth = 1; for (let yy = t.y * px + 2; yy < (t.y + t.h) * px; yy += 4) { c.beginPath(); c.moveTo(t.x * px, yy); c.lineTo((t.x + t.w) * px, yy); c.stroke(); } }
    for (const [x, y] of d.water) { c.fillStyle = TERRAIN.water!; c.fillRect(x * px - 1, y * px - 1, px + 2, px + 2); }
    const built = new Set<string>();
    for (const s of d.structures) built.add(`${s.x},${s.y}`);
    // lots: a faint outline round each lot that is not road
    c.strokeStyle = "rgba(30,25,15,0.16)"; c.lineWidth = 1;
    for (const cells of d.lotCells) {
      if (!cells.length) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of cells) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      if (cells.length === 1 && d.structures.some((s) => s.type === "road" && s.x === x0 && s.y === y0)) continue;
      c.strokeRect(x0 * px + 0.5, y0 * px + 0.5, (x1 - x0 + 1) * px - 1, (y1 - y0 + 1) * px - 1);
    }
    for (const s of d.structures) {
      const x = s.x * px, y = s.y * px, w = s.w * px, h = s.h * px;
      if (s.type === "road") { c.fillStyle = "#4b505b"; c.fillRect(x, y, w, h); c.fillStyle = "rgba(255,255,255,0.10)"; c.fillRect(x + w / 2 - 0.5, y + 1, 1, h - 2); }
      else if (s.type === "park") { c.fillStyle = "#73c062"; c.fillRect(x + 0.5, y + 0.5, w - 1, h - 1); }
      else { c.fillStyle = "#d8cfbd"; c.fillRect(x + 0.5, y + 0.5, w - 1, h - 1); }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, 0, H / 2); ground.receiveShadow = true;
    this.scene.add(ground);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 3, H + 0.6), new THREE.MeshStandardMaterial({ color: "#2a2f3d", roughness: 1 }));
    slab.position.set(W / 2, -1.52, H / 2); this.scene.add(slab);
    const under = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.3, H + 0.6), new THREE.MeshStandardMaterial({ color: "#5d4a36", roughness: 1 }));
    under.position.set(W / 2, -0.16, H / 2); this.scene.add(under);

    // Buildings: walls with windows that light at night, and a roof.
    const boxes = d.structures.map((s, i) => ({ s, i })).filter((x) => !FLAT.has(x.s.type));
    const win = document.createElement("canvas"); win.width = 64; win.height = 64;
    const wc = win.getContext("2d")!; wc.fillStyle = "#000"; wc.fillRect(0, 0, 64, 64);
    for (let yy = 6; yy < 60; yy += 14) for (let xx = 6; xx < 60; xx += 14) { wc.fillStyle = Math.random() < 0.72 ? "#ffcf7a" : "#3a2a10"; wc.fillRect(xx, yy, 7, 8); }
    const winTex = new THREE.CanvasTexture(win); winTex.colorSpace = THREE.SRGBColorSpace;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
    this.wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.02, emissive: new THREE.Color("#ffb85c"), emissiveMap: winTex, emissiveIntensity: 0 });
    this.walls = new THREE.InstancedMesh(boxGeo, this.wallMat, boxes.length);
    this.roofs = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), boxes.length);
    this.walls.castShadow = this.walls.receiveShadow = true; this.roofs.castShadow = true;
    boxes.forEach(({ s, i }, k) => {
      const h = s.levels * 0.55, fw = s.w * (s.category === "industrial" ? 0.86 : 0.74), fh = s.h * (s.category === "industrial" ? 0.86 : 0.74);
      this.tmpM.compose(new THREE.Vector3(this.sx[i]!, 0, this.sz[i]!), new THREE.Quaternion(), new THREE.Vector3(fw, h, fh));
      this.walls.setMatrixAt(k, this.tmpM);
      this.tmpM.compose(new THREE.Vector3(this.sx[i]!, h, this.sz[i]!), new THREE.Quaternion(), new THREE.Vector3(fw + 0.08, 0.08, fh + 0.08));
      this.roofs.setMatrixAt(k, this.tmpM);
      const cat = CATEGORY[s.category] ?? CATEGORY.other!;
      this.walls.setColorAt(k, this.tmpC.set(cat.wall));
      this.roofs.setColorAt(k, this.tmpC.set(cat.roof));
      this.inst[i] = k; this.instStruct.push(i);
    });
    this.scene.add(this.walls, this.roofs);

    // Trees on woodland and in parks.
    const treeSpots: [number, number][] = [];
    let seed = 1;
    for (const t of d.ground.terrain) if (t.label === "woodland" || t.label === "scrub") for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) { if (built.has(`${x},${y}`)) continue; const r = hash(seed++); if (r < (t.label === "woodland" ? 0.55 : 0.12)) treeSpots.push([x + 0.2 + hash(seed++) * 0.6, y + 0.2 + hash(seed++) * 0.6]); }
    for (const s of d.structures) if (s.type === "park") for (let k = 0; k < 3; k++) treeSpots.push([s.x + 0.2 + hash(seed++) * 0.6, s.y + 0.2 + hash(seed++) * 0.6]);
    const treeGeo = new THREE.ConeGeometry(0.26, 0.75, 6); treeGeo.translate(0, 0.45, 0);
    const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), Math.min(treeSpots.length, 12000));
    treeSpots.slice(0, 12000).forEach(([x, z], k) => { const sc = 0.7 + hash(seed++) * 0.6; this.tmpM.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc)); trees.setMatrixAt(k, this.tmpM); trees.setColorAt(k, this.tmpC.setHSL(0.27 + hash(seed++) * 0.06, 0.38, 0.26 + hash(seed++) * 0.08)); });
    trees.castShadow = true; this.scene.add(trees);

    // Night: a pool of warm light round each building that has people in it.
    const pool = document.createElement("canvas"); pool.width = pool.height = 64;
    const pc = pool.getContext("2d")!; const gr = pc.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.4, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0)"); pc.fillStyle = gr; pc.fillRect(0, 0, 64, 64);
    const poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2);
    this.pools = new THREE.InstancedMesh(poolGeo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pool), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff }), boxes.length);
    boxes.forEach(({ i }, k) => { this.tmpM.compose(new THREE.Vector3(this.sx[i]!, 0.02, this.sz[i]!), new THREE.Quaternion(), new THREE.Vector3(2.6, 1, 2.6)); this.pools.setMatrixAt(k, this.tmpM); this.pools.setColorAt(k, this.tmpC.set(0, 0, 0)); });
    this.pools.renderOrder = 1; this.scene.add(this.pools);

    // The way out of town: where the outside world's offices act from.
    const gateMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 6, 24, 1, true), new THREE.MeshBasicMaterial({ color: "#7aa2ff", transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    gateMesh.position.copy(this.gate).setY(3); this.scene.add(gateMesh);
    const gateBase = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.4, 24), new THREE.MeshStandardMaterial({ color: "#2b3350" }));
    gateBase.position.copy(this.gate).setY(-0.1); this.scene.add(gateBase);

    // People: one light each.
    const dot = new THREE.SphereGeometry(1, 10, 8);
    this.people = new THREE.InstancedMesh(dot, new THREE.MeshBasicMaterial({ color: 0xffffff }), this.P);
    this.people.frustumCulled = false;
    this.people.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.people.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.P * 3), 3);
    this.people.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.people);

    // Rings: consequential changes landing.
    const ringGeo = new THREE.RingGeometry(0.78, 1, 40); ringGeo.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 600);
    this.rings.frustumCulled = false; this.rings.renderOrder = 2;
    for (let k = 0; k < 600; k++) { this.rings.setMatrixAt(k, this.tmpM.makeScale(0, 0, 0)); this.rings.setColorAt(k, this.tmpC.set(0, 0, 0)); }
    this.scene.add(this.rings);
    this.scene.add(this.beacons);

    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    const R = Math.max(W, H) * 0.75;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 800;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.02;
    this.sun.target.position.set(W / 2, 0, H / 2);
  }

  // ---------- time of day
  /** Light for an hour of the day: the sun rises at 6 and sets at 18 (an even day: the world gives no season here). */
  setHour(hour: number) {
    const day = Math.sin(((hour - 6) / 12) * Math.PI); // 1 at noon, below 0 at night
    const up = Math.max(0, day);
    this.night = Math.min(1, Math.max(0, (0.25 - day) / 0.45));
    const az = ((hour - 6) / 12) * Math.PI;
    const R = Math.max(this.W, this.H);
    this.sun.position.set(this.W / 2 + Math.cos(az) * R * 0.8, 40 + up * R * 0.9, this.H / 2 - Math.sin(az) * R * 0.3 - R * 0.35);
    const warm = 1 - Math.min(1, up * 2.2);
    this.sun.color.setRGB(1, 0.93 - warm * 0.25, 0.85 - warm * 0.45);
    this.sun.intensity = 0.15 + up * 2.6;
    this.hemi.intensity = 0.35 + up * 0.85;
    this.hemi.color.setRGB(0.55 + up * 0.25, 0.62 + up * 0.25, 0.95);
    this.hemi.groundColor.setRGB(0.18 + up * 0.1, 0.16 + up * 0.08, 0.2);
    this.wallMat.emissiveIntensity = this.overlayLit ? 0 : this.night * 1.15;
    if (this.overlayLit) { this.hemi.intensity = Math.max(this.hemi.intensity, 1.25); this.hemi.color.setRGB(0.9, 0.92, 1); this.sun.intensity = Math.max(this.sun.intensity, 1.1); }
  }

  // ---------- people
  /** Sets where everyone is (space index + 1, or 0) with no hop: after a jump in time. */
  setWhere(where: Uint32Array) { this.cur.set(where); this.prev.set(where); this.moveT.fill(-1e12); }
  /** One move from the log: person `p` is now in space `s1 - 1` (0: in none) as of time t. */
  move(p: number, s1: number, t: number) {
    if (s1 === 0) { this.prev[p] = this.cur[p]!; this.cur[p] = 0; return; } // (the occupied that follows gives the hop)
    const from = this.cur[p] || this.prev[p]!;
    this.prev[p] = from; this.cur[p] = s1; this.moveT[p] = t;
  }

  private slot(p: number, s1: number, out: THREE.Vector3) {
    const st = this.spaceStruct[s1 - 1]!;
    if (st < 0 || this.sx[st]! < -900) return false;
    const a = hash(p * 7 + 1) * Math.PI * 2, r = Math.sqrt(hash(p * 13 + 5)) * 0.3;
    out.set(this.sx[st]! + Math.cos(a) * r, this.top[st]! + 0.06, this.sz[st]! + Math.sin(a) * r);
    return true;
  }

  /** Positions and colours of everyone at time t (sim seconds). `speed`: sim seconds per real second (hops last at
   * least 0.6 s on screen). */
  updatePeople(t: number, speed: number) {
    const arr = this.people.instanceMatrix.array as Float32Array;
    const col = this.people.instanceColor!.array as Float32Array;
    const zoom = this.camera.zoom;
    const base = Math.min(0.11, Math.max(0.035, 0.11 / Math.sqrt(zoom)));
    const hopWin = Math.max(this.hopDur, speed * 0.6);
    this.occupancy.fill(0);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let p = 0; p < this.P; p++) {
      const s1 = this.cur[p]!;
      const o = p * 16;
      let x = 0, y = -50, z = 0, sc = 0;
      if (s1 && this.slot(p, s1, a)) {
        x = a.x; y = a.y; z = a.z; sc = base;
        this.occupancy[this.spaceStruct[s1 - 1]!]!++;
        const dt = t - this.moveT[p]!;
        const from = this.prev[p]!;
        if (dt >= 0 && dt < hopWin && from && from !== s1 && this.slot(p, from, b)) {
          const k = dt / hopWin, e = k * k * (3 - 2 * k);
          const dist = Math.hypot(a.x - b.x, a.z - b.z);
          x = b.x + (a.x - b.x) * e; z = b.z + (a.z - b.z) * e;
          y = b.y + (a.y - b.y) * e + Math.sin(k * Math.PI) * (0.6 + dist * 0.12);
          sc = base * 1.15;
        }
      }
      if (p === this.selectedPerson && sc) sc *= 2.4;
      arr[o] = sc; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = sc; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = sc; arr[o + 11] = 0;
      arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
      let c: THREE.Color | null = this.colorOverride ? this.colorOverride(p) : null;
      if (!c) c = s1 ? KIND_COLOR[["dwelling", "workplace", "other"][this.spaceKind[s1 - 1]!]!]! : KIND_COLOR.other!;
      const lift = 0.75 + this.night * 0.5;
      if (p === this.selectedPerson) { col[p * 3] = 1; col[p * 3 + 1] = 1; col[p * 3 + 2] = 1; }
      else { col[p * 3] = c.r * lift; col[p * 3 + 1] = c.g * lift; col[p * 3 + 2] = c.b * lift; }
    }
    this.people.instanceMatrix.needsUpdate = true;
    this.people.instanceColor!.needsUpdate = true;
  }

  /** Where person p is drawn now (for following and picking). */
  personPos(p: number, out = new THREE.Vector3()): THREE.Vector3 | undefined {
    const arr = this.people.instanceMatrix.array as Float32Array;
    if (!arr[p * 16]) return undefined;
    return out.set(arr[p * 16 + 12]!, arr[p * 16 + 13]!, arr[p * 16 + 14]!);
  }

  /** Building colours: a function of the structure index, or the categories' own. */
  colorBuildings(f: ((struct: number) => THREE.Color | null) | null) {
    this.instStruct.forEach((i, k) => {
      const c = f?.(i);
      const s = this.data.world.structures[i]!;
      this.walls.setColorAt(k, c ?? this.tmpC.set((CATEGORY[s.category] ?? CATEGORY.other!).wall));
      this.roofs.setColorAt(k, c ? this.tmpC.copy(c).multiplyScalar(0.72) : this.tmpC.set((CATEGORY[s.category] ?? CATEGORY.other!).roof));
    });
    this.walls.instanceColor!.needsUpdate = true; this.roofs.instanceColor!.needsUpdate = true;
  }

  updatePools() {
    const n = this.night;
    this.instStruct.forEach((i, k) => {
      const occ = this.occupancy[i]!;
      const v = n * Math.min(1, occ / 6) * 0.55;
      this.pools.setColorAt(k, this.tmpC.setRGB(v, v * 0.72, v * 0.38));
    });
    this.pools.instanceColor!.needsUpdate = true;
  }

  // ---------- rings and arcs
  ring(struct: number, color: string, size = 1, life = 1400, now = performance.now()) {
    if (struct < 0 || this.sx[struct]! < -900) return;
    if (this.ringList.length >= 600) this.ringList.shift();
    this.ringList.push({ x: this.sx[struct]!, z: this.sz[struct]!, y: this.top[struct]! + 0.05, color: new THREE.Color(color), born: now, life, size });
  }
  posOf(struct: number, out = new THREE.Vector3()) { return struct >= 0 && this.sx[struct]! > -900 ? out.set(this.sx[struct]!, this.top[struct]!, this.sz[struct]!) : out.copy(this.gate).setY(4); }
  arc(from: number, to: number, color: string, keep = false, life = 4200) {
    const a = this.posOf(from), b = this.posOf(to);
    if (a.distanceTo(b) < 0.01) { this.ring(to, color, 1.6, 2200); return; }
    const mid = a.clone().add(b).multiplyScalar(0.5); mid.y = Math.max(a.y, b.y) + 2 + a.distanceTo(b) * 0.35;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const c = new THREE.Color(color);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, keep ? 0.07 : 0.05, 6, false), new THREE.MeshBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color(1, 1, 1), 0.5) }));
    mesh.renderOrder = head.renderOrder = 3;
    this.scene.add(mesh, head);
    this.arcs.push({ mesh, head, curve, born: performance.now(), life, color: c, keep });
  }
  clearKept() { for (const a of this.arcs) if (a.keep) a.life = 0; }

  /** Beacons: tall soft columns over what is selected. */
  setBeacons(points: { struct?: number; pos?: THREE.Vector3; color: string }[]) {
    for (const ch of [...this.beacons.children]) { this.beacons.remove(ch); (ch as THREE.Mesh).geometry.dispose(); }
    for (const pt of points) {
      const p = pt.pos ?? this.posOf(pt.struct ?? -1);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.42, 14, 16, 1, true), new THREE.MeshBasicMaterial({ color: pt.color, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.position.set(p.x, p.y + 7, p.z);
      const r = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: pt.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      r.position.set(p.x, (pt.pos ? p.y : 0) + 0.04, p.z);
      this.beacons.add(m, r);
    }
  }

  private animate(now: number) {
    const arr = this.rings.instanceMatrix.array as Float32Array;
    this.ringList = this.ringList.filter((r) => now - r.born < r.life);
    for (let k = 0; k < 600; k++) {
      const r = this.ringList[k];
      if (!r) { arr[k * 16] = arr[k * 16 + 5] = arr[k * 16 + 10] = 0; continue; }
      const age = (now - r.born) / r.life, s = r.size * (0.25 + age * 1.1), f = (1 - age) * (1 - age);
      this.tmpM.makeScale(s, s, s).setPosition(r.x, r.y, r.z);
      this.rings.setMatrixAt(k, this.tmpM);
      this.rings.setColorAt(k, this.tmpC.copy(r.color).multiplyScalar(f * 1.4));
    }
    this.rings.instanceMatrix.needsUpdate = true; if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    this.arcs = this.arcs.filter((a) => {
      const age = (now - a.born) / a.life;
      if (age >= 1 && !(a.keep && a.life > 0)) { this.scene.remove(a.mesh, a.head); a.mesh.geometry.dispose(); a.head.geometry.dispose(); return false; }
      const k = Math.min(1, (now - a.born) / 1100);
      a.head.position.copy(a.curve.getPoint(k));
      a.head.visible = k < 1;
      const fade = a.keep ? 0.9 + 0.1 * Math.sin(now / 300) : Math.max(0, 1 - Math.max(0, age - 0.35) / 0.65);
      (a.mesh.material as THREE.MeshBasicMaterial).color.copy(a.color).multiplyScalar(fade);
      return true;
    });
  }

  render(now: number) {
    this.controls.update();
    this.animate(now);
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- picking and the camera
  /** Screen position (CSS pixels) of a world point, or undefined behind the camera. */
  project(v: THREE.Vector3): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const p = this.tmpV.copy(v).project(this.camera);
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  }
  pickPerson(cx: number, cy: number, radius = 10): number {
    const r = this.canvas.getBoundingClientRect();
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const arr = this.people.instanceMatrix.array as Float32Array;
    let best = -1, bd = radius * radius;
    for (let p = 0; p < this.P; p++) {
      if (!arr[p * 16]) continue;
      const x = arr[p * 16 + 12]!, y = arr[p * 16 + 13]!, z = arr[p * 16 + 14]!;
      const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
      const sx = r.left + ((m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w + 1) / 2 * r.width;
      const sy = r.top + (1 - (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w) / 2 * r.height;
      const d = (sx - cx) ** 2 + (sy - cy) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  pickBuilding(cx: number, cy: number): number {
    const r = this.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.camera);
    this.walls.computeBoundingSphere();
    const hit = ray.intersectObject(this.walls, false)[0];
    if (hit?.instanceId !== undefined) return this.instStruct[hit.instanceId]!;
    // flat things (roads, parks) and empty ground: the structure on the cell under the pointer
    const pt = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt)) return -1;
    const x = Math.floor(pt.x), z = Math.floor(pt.z);
    return this.data.world.structures.findIndex((s) => x >= s.x && x < s.x + s.w && z >= s.y && z < s.y + s.h);
  }
  private flight?: { from: THREE.Vector3; to: THREE.Vector3; z0: number; z1: number; t0: number };
  flyTo(pos: THREE.Vector3, zoom?: number) {
    this.flight = { from: this.controls.target.clone(), to: pos.clone().setY(0), z0: this.camera.zoom, z1: zoom ?? Math.max(this.camera.zoom, 4.5), t0: performance.now() };
  }
  stepFlight(now: number) {
    const f = this.flight; if (!f) return;
    const k = Math.min(1, (now - f.t0) / 900), e = 1 - Math.pow(1 - k, 3);
    const tgt = f.from.clone().lerp(f.to, e);
    const off = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.copy(tgt); this.camera.position.copy(tgt).add(off);
    this.camera.zoom = f.z0 + (f.z1 - f.z0) * e; this.camera.updateProjectionMatrix();
    if (k >= 1) this.flight = undefined;
  }
  follow(pos: THREE.Vector3) {
    const off = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.lerp(pos.clone().setY(0), 0.08); this.camera.position.copy(this.controls.target).add(off);
  }
  rotate(quarter: number) {
    const off = this.camera.position.clone().sub(this.controls.target);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), (quarter * Math.PI) / 2);
    this.camera.position.copy(this.controls.target).add(off); this.camera.lookAt(this.controls.target);
  }
  dayOf(t: number) { return Math.floor(t / DAY); }
}
