// The explorer's client: picks a run, loads its world and tracks, and ties the scene, the timeline and the inspector
// together: playback over the run, overlays, search, selection, and the URL (#run=..&t=..&sel=..) so a view can be linked.

import * as THREE from "three/webgpu";
import { BASE, CATEGORY, CLASSES, CLASS_COLOR, CLASS_LABEL, CLASS_SHORT, DAY, HARD_COLOR, SEAT_COLORS, clock, esc, getBin, getJson, money, stampOf, type Cls, type SeatAct, type WorldData } from "./api";
import { Town } from "./scene";
import { Timeline } from "./timeline";
import * as I from "./inspector";

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const params = new URLSearchParams(location.hash.slice(1));
const SPEEDS = [{ s: 900, l: "¼ h/s" }, { s: 3600, l: "1 h/s" }, { s: 3 * 3600, l: "3 h/s" }, { s: 12 * 3600, l: "12 h/s" }, { s: DAY, l: "1 day/s" }, { s: 4 * DAY, l: "4 days/s" }];
const CHUNK = 8; // days of moves fetched at once
const IMPORTANT_KINDS = new Set(["government", "tribunal", "bank", "police", "health_service", "school", "registry", "ombudsman", "consumer_desk", "electoral_commission", "union", "builder", "utility", "land_registry"]);

async function boot() {
  const app = $("#app");
  let runs: any;
  try { runs = await getJson("api/runs"); } catch (e) { app.innerHTML = `<div class="splash"><h1>Oikos explorer</h1><p class="hardtxt">${esc((e as Error).message)}</p></div>`; return; }
  const key = params.has("all") ? undefined : params.get("run") ?? runs.single ?? (runs.runs.length === 1 ? runs.runs[0].key : undefined);
  if (!key) return picker(app, runs.runs);
  await openRun(app, key, runs);
}

function picker(app: HTMLElement, runs: any[]) {
  app.innerHTML = `<div class="picker"><header><div class="brand"><span class="logo"></span>Oikos <b>explorer</b></div><p>Every run with a pilot. Each is indexed the first time it is opened (about a minute for 3,000 people over 90 days), then opens at once. The researcher's view: it may see everything, and feeds nothing back.</p></header>
  <div class="cards">${runs.map((r) => `<a class="card" href="#run=${encodeURIComponent(r.key)}"><div class="cname">${esc(r.name)}</div><div class="cnote">${esc(r.note ?? "")}</div><div class="cmeta">${new Date(r.mtime).toISOString().slice(0, 16).replace("T", " ")} · ${r.state === "ready" ? "indexed" : r.state === "indexing" ? "indexing…" : "not yet indexed"}</div></a>`).join("")}</div></div>`;
  window.addEventListener("hashchange", () => location.reload(), { once: true });
}

async function waitReady(app: HTMLElement, key: string, name: string) {
  for (;;) {
    const s = await getJson(`api/r/${encodeURIComponent(key)}/status?open=1`);
    if (s.state === "ready") return;
    if (s.state === "failed") throw new Error(s.message);
    app.innerHTML = `<div class="splash"><div class="brand"><span class="logo"></span>Oikos <b>explorer</b></div><h1>${esc(name)}</h1><div class="spinner"></div><p>Indexing the run's log, once: ${esc(s.message ?? "")} <span class="dim">(${s.seconds ?? 0} s)</span></p><p class="dim">The index is kept beside the runs, never inside one, and made again only if the log changes.</p></div>`;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function openRun(app: HTMLElement, key: string, runs: any) {
  const entry = runs.runs.find((r: any) => r.key === key) ?? { name: key };
  const api = (p: string) => `api/r/${encodeURIComponent(key)}/${p}`;
  try { await waitReady(app, key, entry.name); } catch (e) { app.innerHTML = `<div class="splash"><h1>${esc(entry.name)}</h1><p class="hardtxt">${esc((e as Error).message)}</p></div>`; return; }
  const data = await getJson<WorldData>(api("world"));
  const [whereBuf, pulseBuf] = await Promise.all([getBin(api("bin/where")), getBin(api("bin/pulses"))]);
  const where = new Uint32Array(whereBuf), pulses = new Int32Array(pulseBuf);
  const P = data.meta.persons, D = data.meta.days, END = Math.max(data.meta.lastT, D * DAY);
  const seatColor = new Map<string, string>();
  data.meta.seats.forEach((s, i) => seatColor.set(s, SEAT_COLORS[i % SEAT_COLORS.length]!));
  const orgName = new Map(data.world.orgs.map((o) => [o.id, o.name]));
  const nameOf = (id: string) => orgName.get(id) ?? id;
  const structName = (i: number) => data.world.structures[i]?.id ?? data.meta.extraStructures[i - data.world.structures.length] ?? "?";
  const ov = data.pilot?.overview;

  app.innerHTML = `
  <div class="stage" id="stage"><div class="labels" id="labels"></div><div class="hover" id="hover"></div></div>
  <div class="tl-wrap glass"><div class="controls">
      <button class="play" id="play" title="play / pause (space)"><svg viewBox="0 0 24 24"><path d="M7 5v14l12-7z"/></svg></button>
      <div class="clock"><span class="sun" id="sun"></span><div><div class="cday" id="cday">day 0</div><div class="ctime" id="ctime">00:00</div></div></div>
      <div class="speed" id="speed">${SPEEDS.map((s, i) => `<button data-speed="${i}">${s.l}</button>`).join("")}</div>
      <div class="tl-legend">${(["person", "system", "seat", "world"] as Cls[]).map((c) => `<span><i style="background:${CLASS_COLOR[c]}"></i>${esc(CLASS_SHORT[c])}</span>`).join("")}<span><i style="background:${HARD_COLOR}"></i>hard</span></div>
    </div><div class="tl" id="tl"></div></div>
  <div class="topleft glass" id="topleft">
    <div class="brand"><span class="logo"></span>Oikos <b>explorer</b>${runs.runs.length > 1 ? `<a class="runs" href="#">all runs</a>` : ""}</div>
    <div class="town"><div class="tname">${esc(data.world.name || data.meta.runId)} <span class="dim mono">${esc(entry.name)}</span></div>
      <div class="tmeta">${P.toLocaleString()} people · ${D} days${ov?.profile ? ` · ${esc(ov.profile)}` : ""}${ov?.cost ? ` · $${ov.cost.usd.toFixed(2)} in ${ov.cost.calls} calls` : data.pilot ? "" : " · code only"}</div></div>
    ${data.pilot?.seats.length ? `<div class="seats">${data.pilot.seats.map((s) => `<a class="seat" data-go="seat:${esc(s.id)}" style="--c:${seatColor.get(s.id)}"><i></i><span>${esc(s.title ?? s.id)}</span><em>${s.acts ?? 0}</em></a>`).join("")}</div><div class="dim small">${esc(data.pilot.seats[0]?.model ?? "")}${data.pilot.twin ? ` · twin ${esc(data.pilot.twin.run ?? "found")}` : " · no twin"}</div>` : ""}
    <div class="search"><input id="q" placeholder="Search a person, office, firm, building…" autocomplete="off" spellcheck="false"><div class="results" id="results"></div></div>
  </div>
  <div class="topright glass" id="topright">
    <div class="chips" id="modes"><button data-mode="town" class="on">Town</button><button data-mode="decided">Who decided</button><button data-mode="hardship">Hardship</button></div>
    <div class="legend" id="legend"></div>
    <div class="hud dim small" id="hud"></div>
  </div>
  <aside class="inspector glass" id="inspector"><button class="close" id="close" title="close (Esc)">×</button><div class="ibody" id="ibody"></div></aside>`;
  $(".runs")?.addEventListener("click", (e) => { e.preventDefault(); location.hash = "all"; location.reload(); });

  const town = new Town(data, $("#stage"));
  await town.init(params.get("gl") === "1");
  const tl = new Timeline($("#tl"), data, seatColor);

  // ---------- moves, fetched a chunk of days at a time
  const movesDay = data.meta.movesDay;
  const chunks = new Map<number, Int32Array>(), loading = new Map<number, Promise<void>>();
  const loadChunk = (c: number) => {
    if (chunks.has(c) || c * CHUNK > D) return Promise.resolve();
    if (!loading.has(c)) loading.set(c, getBin(api(`bin/moves?from=${c * CHUNK}&to=${Math.min(D + 1, (c + 1) * CHUNK)}`)).then((b) => { chunks.set(c, new Int32Array(b)); }));
    return loading.get(c)!;
  };
  const chunkBase = (c: number) => movesDay[c * CHUNK] ?? movesDay.at(-1)!;
  const moveAt = (i: number): [number, number, number] | undefined => {
    // (the chunk holding global move i)
    const d = dayOfMove(i), c = Math.floor(d / CHUNK), arr = chunks.get(c);
    if (!arr) return undefined;
    const j = (i - chunkBase(c)) * 3;
    return [arr[j]!, arr[j + 1]!, arr[j + 2]!];
  };
  const dayOfMove = (i: number) => { let lo = 0, hi = movesDay.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (movesDay[m]! <= i) lo = m; else hi = m - 1; } return lo; };
  const totalMoves = movesDay.at(-1)!;

  // ---------- time
  let t = Math.min(END, Number(params.get("t") ?? 8 * 3600)), playing = false, speedIdx = 2, mi = 0, lastPulse = 0;
  const pulseCount = pulses.length / 6;
  const pulseIdx = (tt: number) => { let lo = 0, hi = pulseCount; while (lo < hi) { const m = (lo + hi) >> 1; if (pulses[m * 6]! <= tt) lo = m + 1; else hi = m; } return lo; };
  const jump = async (tt: number) => {
    t = Math.max(0, Math.min(END, tt));
    const d = Math.min(D, Math.floor(t / DAY));
    await loadChunk(Math.floor(d / CHUNK));
    town.setWhere(where.subarray(d * P, (d + 1) * P));
    mi = movesDay[d] ?? totalMoves;
    for (;;) { if (mi >= totalMoves) break; const m = moveAt(mi); if (!m || m[0] > t) break; town.move(m[1], m[2], m[0]); mi++; }
    lastPulse = pulseIdx(t);
    clockUi(); tl.set(t); overlayDirty = true;
  };
  const advance = (tt: number) => {
    const t0 = t; t = Math.min(END, tt);
    for (;;) {
      if (mi >= totalMoves) break;
      const m = moveAt(mi);
      if (!m) { void loadChunk(Math.floor(dayOfMove(mi) / CHUNK)); break; }
      if (m[0] > t) break;
      town.move(m[1], m[2], m[0]); mi++;
    }
    void loadChunk(Math.floor((t + 2 * DAY) / DAY / CHUNK));
    // changes that land in this step: rings; seats' acts: arcs
    const now = performance.now();
    let spawned = 0;
    while (lastPulse < pulseCount && pulses[lastPulse * 6]! <= t) {
      const k = lastPulse * 6, cls = CLASSES[pulses[k + 3]!]!, flags = pulses[k + 4]!;
      lastPulse++;
      if (cls === "self" && !(flags & 1)) continue;
      if (spawned++ > 50 && !(flags & 3)) continue;
      if (decidedFocus !== "all" && mode === "decided" && cls !== decidedFocus) continue;
      town.ring(pulses[k + 2]!, flags & 1 ? HARD_COLOR : CLASS_COLOR[cls], flags & 1 ? 1.5 : 0.9, flags & 1 ? 2200 : 1300, now);
    }
    for (const a of data.seatActs) if (a.t > t0 && a.t <= t) seatActFires(a);
    if (Math.floor(t0 / DAY) !== Math.floor(t / DAY)) overlayDirty = true;
    if (t >= END) setPlaying(false);
  };
  const seatActFires = (a: SeatAct) => {
    const col = seatColor.get(a.participant) ?? CLASS_COLOR.seat;
    const targets = a.targets.filter((x) => x.struct >= 0 || x.kind === "org");
    for (const tg of targets.slice(0, 12)) town.arc(a.from, tg.struct, col);
    if (!targets.length) town.ring(a.from, col, 2, 2600);
    toast(`<b style="color:${col}">${esc(data.pilot?.seats.find((s) => s.id === a.participant)?.title ?? a.participant)}</b> ${esc(a.kinds.join(", "))}${a.text ? ` · <i>${esc(a.text.slice(0, 90))}</i>` : ""}`, a);
  };

  // ---------- the clock and controls
  const clockUi = () => {
    const c = clock(t);
    $("#cday").textContent = `day ${c.day}`; $("#ctime").textContent = `${c.hh}:${c.mm}`;
    const sun = $("#sun"); sun.className = `sun ${c.hour >= 6 && c.hour < 18 ? "day" : "night"}`;
    town.setHour(c.hour);
    document.body.style.setProperty("--sky", skyOf(c.hour));
  };
  const setPlaying = (p: boolean) => {
    playing = p;
    $("#play").innerHTML = p ? `<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>` : `<svg viewBox="0 0 24 24"><path d="M7 5v14l12-7z"/></svg>`;
    if (!p) { refreshPanel(); writeHash(); }
  };
  const setSpeed = (i: number) => { speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, i)); for (const b of document.querySelectorAll<HTMLElement>("#speed button")) b.classList.toggle("on", Number(b.dataset.speed) === speedIdx); };
  $("#play").addEventListener("click", () => { if (t >= END) void jump(0); setPlaying(!playing); });
  for (const b of document.querySelectorAll<HTMLElement>("#speed button")) b.addEventListener("click", () => setSpeed(Number(b.dataset.speed)));
  setSpeed(speedIdx);
  tl.onScrub = (tt, done) => { setPlaying(false); void jump(tt); if (done) { refreshPanel(); writeHash(); } };
  tl.onAct = (a) => go(`act:${a.ord}`);

  // ---------- overlays
  let mode: "town" | "decided" | "hardship" = "town", decidedFocus: Cls | "all" = "all", hardVar: "agency" | "money" = "agency";
  let overlayDirty = true;
  let decidedCounts: Uint16Array | undefined;
  let agency: Int16Array | undefined, moneyArr: Float64Array | undefined;
  const S = town.S;
  const computeDecided = () => {
    decidedCounts = new Uint16Array((D + 1) * S * 5);
    for (let i = 0; i < pulseCount; i++) { const k = i * 6, st = pulses[k + 2]!; if (st < 0) continue; const d = Math.min(D, Math.floor(pulses[k]! / DAY)); const at = (d * S + st) * 5 + pulses[k + 3]!; if (decidedCounts[at]! < 65535) decidedCounts[at]!++; }
  };
  const ramp = (v: number, out: THREE.Color) => { // 0 low (red) .. 1 high (teal)
    const a = new THREE.Color(HARD_COLOR), b = new THREE.Color("#f2c14e"), c = new THREE.Color("#3fd0c9");
    return v < 0.5 ? out.copy(a).lerp(b, v * 2) : out.copy(b).lerp(c, (v - 0.5) * 2);
  };
  const applyOverlay = () => {
    overlayDirty = false;
    const d = Math.min(D, Math.floor(t / DAY));
    town.overlayLit = mode !== "town"; town.setHour(clock(t).hour);
    if (mode === "town") { town.colorBuildings(null); town.colorOverride = null; }
    else if (mode === "decided") {
      if (!decidedCounts) computeDecided();
      const sum = new Float32Array(S * 5);
      for (let dd = Math.max(0, d - 29); dd <= d; dd++) for (let s = 0; s < S; s++) for (let c = 0; c < 5; c++) sum[s * 5 + c]! += decidedCounts![(dd * S + s) * 5 + c]!;
      let max = 1;
      for (let s = 0; s < S; s++) { const v = decidedFocus === "all" ? sum[s * 5 + 1]! + sum[s * 5 + 2]! + sum[s * 5 + 3]! + sum[s * 5 + 4]! : sum[s * 5 + CLASSES.indexOf(decidedFocus)]!; max = Math.max(max, v); }
      const base = new THREE.Color("#666e80"), tmp = new THREE.Color(), mix = new THREE.Color();
      town.colorBuildings((s) => {
        if (decidedFocus !== "all") { const v = sum[s * 5 + CLASSES.indexOf(decidedFocus)]!; return v ? tmp.copy(base).lerp(new THREE.Color(CLASS_COLOR[decidedFocus]), 0.35 + 0.65 * Math.sqrt(v / max)).clone() : base.clone(); }
        let tot = 0; mix.setRGB(0, 0, 0);
        for (let c = 1; c < 5; c++) { const v = sum[s * 5 + c]!; if (!v) continue; tot += v; mix.add(tmp.set(CLASS_COLOR[CLASSES[c]!]).multiplyScalar(v)); }
        if (!tot) return base.clone();
        mix.multiplyScalar(1 / tot);
        return base.clone().lerp(mix, 0.45 + 0.55 * Math.sqrt(tot / max));
      });
      const dim = new THREE.Color("#c9d3e6");
      town.colorOverride = () => dim;
    } else {
      const P2 = P, val = new Float32Array(P2).fill(NaN);
      if (hardVar === "agency" && agency) for (let p = 0; p < P2; p++) { const v = agency[d * P2 + p]!; if (v >= 0) val[p] = v / 10000; }
      if (hardVar === "money" && moneyArr) { const H = moneyArr.length / (D + 1); const xs: number[] = []; for (let p = 0; p < P2; p++) xs.push(moneyArr[d * H + p]!); const sorted = [...xs].sort((a, b) => a - b); for (let p = 0; p < P2; p++) { const v = xs[p]!; let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m]! < v) lo = m + 1; else hi = m; } val[p] = v <= 0 ? 0 : lo / sorted.length; } }
      const cols = Array.from({ length: P2 }, (_, p) => Number.isNaN(val[p]!) ? null : ramp(val[p]!, new THREE.Color()));
      town.colorOverride = (p) => cols[p] ?? new THREE.Color("#5b6475");
      const acc = new Float32Array(S), n = new Uint16Array(S);
      for (let p = 0; p < P2; p++) { const w = where[d * P2 + p]!; if (!w || Number.isNaN(val[p]!)) continue; const sp = data.meta.spaces[w - 1]!; if (sp[1] !== "dwelling") continue; acc[sp[0]]! += val[p]!; n[sp[0]]!++; }
      const base = new THREE.Color("#666e80");
      town.colorBuildings((s) => n[s] ? base.clone().lerp(ramp(acc[s]! / n[s]!, new THREE.Color()), 0.8) : base.clone());
    }
    legend();
  };
  const legend = () => {
    const L = $("#legend");
    if (mode === "town") L.innerHTML = `<div class="lg-title">People, each a light on the building they are in</div><div class="lg">${[["#ffd27a", "at home"], ["#7fd3ff", "at work"], ["#d2a8ff", "elsewhere"]].map(([c, l]) => `<span><i class="dotc" style="background:${c}"></i>${l}</span>`).join("")}</div><div class="lg-title">Changes reaching people, by who decided</div><div class="lg">${(["person", "system", "seat", "world"] as Cls[]).map((c) => `<span><i class="ringc" style="border-color:${CLASS_COLOR[c]}"></i>${esc(CLASS_SHORT[c])}</span>`).join("")}<span><i class="ringc" style="border-color:${HARD_COLOR}"></i>hard</span></div><div class="lg-title">Buildings</div><div class="lg">${Object.entries(CATEGORY).filter(([k]) => k !== "other").map(([k, v]) => `<span><i style="background:${v.wall};border-top:3px solid ${v.roof}"></i>${k}</span>`).join("")}</div>`;
    else if (mode === "decided") L.innerHTML = `<div class="lg-title">Who decided the consequential changes reaching the people who live in each building, last 30 days</div><div class="lg pick">${(["all", "person", "system", "seat", "world", "self"] as (Cls | "all")[]).map((c) => `<button data-focus="${c}" class="${decidedFocus === c ? "on" : ""}">${c === "all" ? "all but their own" : `<i style="background:${CLASS_COLOR[c as Cls]}"></i>${esc(CLASS_SHORT[c as Cls])}`}</button>`).join("")}</div><p class="dim small">By role in the world, not what runs it: every person here is simulated. Counted: money moved, decisions, orders, notices, bills, agreements, removals (measure/src/consequential.ts).</p>`;
    else L.innerHTML = `<div class="lg-title">Hardship, as people's own records state it</div><div class="lg pick">${[["agency", "sense of agency"], ["money", "money held (rank)"]].map(([k, l]) => `<button data-var="${k}" class="${hardVar === k ? "on" : ""}">${l}</button>`).join("")}</div><div class="ramp"><span>low</span><i></i><span>high</span></div><p class="dim small">${hardVar === "agency" ? "Each person's own record: agency now (0 to 10,000). Buildings: the mean of the people who slept there." : "Money in their accounts at midnight, as a rank in the town (the lowest red). No composite: one raw quantity."} Red rings: refusals, removals, debts, failed payments, illness.</p>`;
    for (const b of L.querySelectorAll<HTMLElement>("[data-focus]")) b.addEventListener("click", () => { decidedFocus = b.dataset.focus as any; overlayDirty = true; });
    for (const b of L.querySelectorAll<HTMLElement>("[data-var]")) b.addEventListener("click", async () => { hardVar = b.dataset.var as any; await loadHardship(); overlayDirty = true; });
  };
  const loadHardship = async () => {
    if (hardVar === "agency" && !agency) agency = new Int16Array(await getBin(api("bin/agency")));
    if (hardVar === "money" && !moneyArr) moneyArr = new Float64Array(await getBin(api("bin/money")));
  };
  for (const b of document.querySelectorAll<HTMLElement>("#modes button")) b.addEventListener("click", async () => {
    mode = b.dataset.mode as any;
    for (const x of document.querySelectorAll<HTMLElement>("#modes button")) x.classList.toggle("on", x === b);
    if (mode === "hardship") await loadHardship();
    overlayDirty = true;
  });

  // ---------- labels over the scene
  const labelsEl = $("#labels");
  const seatOrgs = new Map<string, string>();
  for (const p of data.world.posts) if (p.holder && seatColor.has(p.holder) && p.entity) seatOrgs.set(p.entity, p.holder);
  const labelList: { el: HTMLElement; pos: THREE.Vector3; minZoom: number }[] = [];
  const addLabel = (text: string, pos: THREE.Vector3, cls: string, minZoom: number, go?: string, color?: string) => {
    const el = document.createElement("div"); el.className = `label ${cls}`; el.innerHTML = text; if (color) el.style.setProperty("--c", color);
    if (go) { el.dataset.go = go; el.classList.add("go"); }
    labelsEl.appendChild(el); labelList.push({ el, pos, minZoom });
  };
  const byStruct = new Map<number, { names: string[]; seat?: string; go: string }>();
  for (const o of data.world.orgs) {
    const seat = seatOrgs.get(o.id);
    if (!seat && !IMPORTANT_KINDS.has(o.kind)) continue;
    const st = o.premises[0] ?? -1;
    const g = byStruct.get(st) ?? byStruct.set(st, { names: [], go: `org:${o.id}` }).get(st)!;
    if (seat && !g.seat) { g.seat = seat; g.go = `org:${o.id}`; g.names.unshift(o.name); } else g.names.push(o.name);
  }
  for (const [st, g] of byStruct) {
    const text = `${g.seat ? "<i></i>" : ""}${esc(g.names[0]!)}${g.names.length > 1 ? `<span class="more" title="${esc(g.names.slice(1).join(", "))}"> +${g.names.length - 1}</span>` : ""}`;
    const pos = st < 0 ? town.gate.clone().setY(7.5) : town.posOf(st).add(new THREE.Vector3(0, 0.6, 0));
    addLabel(text, pos, g.seat ? "seat" : "org", g.seat ? 0 : 2.2, g.go, g.seat ? seatColor.get(g.seat) : undefined);
  }
  if (!byStruct.has(-1)) addLabel("the outside world", town.gate.clone().setY(6.2), "gate", 0);
  const placeLabels = () => {
    const z = town.camera.zoom;
    for (const l of labelList) {
      if (z < l.minZoom) { l.el.style.display = "none"; continue; }
      const p = town.project(l.pos);
      l.el.style.display = ""; l.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  };

  // ---------- the inspector
  let sel: { kind: string; id: string } | undefined, follow = false;
  const ctx = (): I.Ctx => ({ data, t, seatColor, nameOf, structName });
  const ibody = $("#ibody"), insp = $("#inspector");
  const show = (html: string) => { ibody.innerHTML = html; insp.classList.add("open"); document.body.classList.add("inspecting"); ibody.scrollTop = 0; };
  const loadingHtml = (what: string) => `<div class="loading"><div class="spinner"></div>${esc(what)}</div>`;
  async function openPanel(kind: string, id: string, scrollKeep = false) {
    const top = ibody.scrollTop;
    sel = { kind, id };
    if (!scrollKeep) show(loadingHtml(`${kind} ${id}`));
    try {
      if (kind === "person") {
        const p = await getJson(api(`person/${encodeURIComponent(id)}?t=${Math.round(t)}`));
        if (p.missing) return show(`<div class="dim">${esc(id)}: not a person of this run</div>`);
        show(I.personHtml(ctx(), p));
        town.selectedPerson = data.persons.indexOf(id);
        town.setBeacons([...(p.home ? [{ struct: p.home.struct, color: "#ffd27a" }] : []), ...(p.job ? [{ struct: p.job.struct, color: "#7fd3ff" }] : [])]);
      } else if (kind === "org") {
        const o = await getJson(api(`org/${encodeURIComponent(id)}?t=${Math.round(t)}`));
        if (o.missing) return show(`<div class="dim">${esc(id)}: not an organisation of this run</div>`);
        show(I.orgHtml(ctx(), o));
        town.selectedPerson = -1;
        town.setBeacons(o.premises.length ? o.premises.slice(0, 12).map((p: any) => ({ struct: p.struct, color: o.seat ? seatColor.get(o.seat.participant) ?? CLASS_COLOR.seat : "#9fd8ff" })) : [{ struct: -1, color: "#7aa2ff" }]);
      } else if (kind === "building") {
        const b = await getJson(api(`building/${id}?t=${Math.round(t)}`));
        show(I.buildingHtml(ctx(), b));
        town.selectedPerson = -1;
        town.setBeacons([{ struct: Number(id), color: "#ffffff" }]);
      } else if (kind === "act") {
        const x = await getJson(api(`act/${id}`));
        if (x.missing) return show(`<div class="dim">no such act</div>`);
        show(I.actHtml(ctx(), x));
        town.selectedPerson = -1;
        tl.selectedAct = Number(id); tl.draw();
        town.clearKept();
        const col = seatColor.get(x.act.participant) ?? CLASS_COLOR.seat;
        const placed = x.act.targets.filter((tg: any) => tg.struct >= 0 || tg.kind === "org").slice(0, 20);
        for (const tg of placed) town.arc(x.act.from, tg.struct, col, true);
        town.setBeacons(placed.map((tg: any) => ({ struct: tg.struct, color: col })));
      } else if (kind === "seat") {
        const s = await getJson(api(`seat/${encodeURIComponent(id)}`));
        show(s.missing ? `<div class="dim">${esc(id)}: no seat data</div>` : I.seatHtml(ctx(), s));
        const org = [...seatOrgs].find(([, h]) => h === id)?.[0];
        const prem = org ? data.world.orgs.find((o) => o.id === org)?.premises ?? [] : [];
        town.setBeacons(prem.length ? prem.slice(0, 4).map((st) => ({ struct: st, color: seatColor.get(id)! })) : [{ struct: -1, color: seatColor.get(id)! }]);
      }
      if (scrollKeep) ibody.scrollTop = top;
      writeHash();
    } catch (e) { show(`<div class="hardtxt">${esc((e as Error).message)}</div>`); }
  }
  const refreshPanel = () => { if (sel && (sel.kind === "person" || sel.kind === "org" || sel.kind === "building")) void openPanel(sel.kind, sel.id, true); };
  const closePanel = () => { insp.classList.remove("open"); document.body.classList.remove("inspecting"); sel = undefined; town.selectedPerson = -1; town.setBeacons([]); town.clearKept(); tl.selectedAct = -1; tl.draw(); follow = false; writeHash(); };
  $("#close").addEventListener("click", closePanel);

  const go = (target: string) => {
    const i = target.indexOf(":"), kind = target.slice(0, i), id = target.slice(i + 1);
    if (kind === "act") {
      const a = data.seatActs.find((x) => x.ord === Number(id));
      if (a) { setPlaying(false); void jump(a.t); const tg = a.targets.find((x) => x.struct >= 0); town.flyTo(town.posOf(tg ? tg.struct : a.from), Math.max(town.camera.zoom, 2.2)); }
    } else if (kind === "person") {
      const p = data.persons.indexOf(id);
      const pos = p >= 0 ? town.personPos(p) : undefined;
      if (pos) town.flyTo(pos, Math.max(town.camera.zoom, 5));
    } else if (kind === "building") town.flyTo(town.posOf(Number(id)), Math.max(town.camera.zoom, 4));
    else if (kind === "org") { const o = data.world.orgs.find((x) => x.id === id); town.flyTo(town.posOf(o?.premises[0] ?? -1), Math.max(town.camera.zoom, 3)); }
    void openPanel(kind, id);
  };
  document.addEventListener("click", async (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-go],[data-trace],[data-time]");
    if (!el) return;
    if (el.dataset.go) { e.preventDefault(); go(el.dataset.go); return; }
    if (el.dataset.time) { setPlaying(false); await jump(Number(el.dataset.time)); return; }
    if (el.dataset.trace) {
      if ((e.target as HTMLElement).classList.contains("when") && el.dataset.at) { setPlaying(false); await jump(Number(el.dataset.at)); refreshPanel(); return; }
      const next = el.nextElementSibling;
      if (next?.classList.contains("trace-wrap")) { next.remove(); el.classList.remove("open"); return; }
      el.classList.add("open");
      const w = document.createElement("div"); w.className = "trace-wrap"; w.innerHTML = loadingHtml("tracing");
      el.after(w);
      const tr = await getJson(api(`trace/${el.dataset.trace}${el.dataset.about ? `?about=${encodeURIComponent(el.dataset.about)}` : ""}`));
      w.innerHTML = I.traceHtml(ctx(), tr.links);
    }
  });

  // ---------- picking in the scene
  const canvas = $("#stage canvas") as HTMLCanvasElement;
  let down: { x: number; y: number } | undefined;
  canvas.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; follow = false; });
  canvas.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const p = town.pickPerson(e.clientX, e.clientY, e.pointerType === "touch" ? 18 : 10);
    if (p >= 0) { void openPanel("person", data.persons[p]!); return; }
    const b = town.pickBuilding(e.clientX, e.clientY);
    if (b >= 0) { const org = data.world.orgs.find((o) => o.premises[0] === b && (IMPORTANT_KINDS.has(o.kind) || seatOrgs.has(o.id))); void openPanel(org ? "org" : "building", org ? org.id : String(b)); }
  });
  const hover = $("#hover");
  let hoverAt = 0;
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || e.buttons) { hover.style.display = "none"; return; }
    const now = performance.now(); if (now - hoverAt < 80) return; hoverAt = now;
    const p = town.pickPerson(e.clientX, e.clientY, 9);
    let text = "";
    if (p >= 0) { const s1 = town.cur[p]!; text = `<b>${esc(data.persons[p])}</b>${s1 ? ` <span class="dim">in ${esc(structName(town.spaceStruct[s1 - 1]!))}</span>` : ""}`; }
    else { const b = town.pickBuilding(e.clientX, e.clientY); if (b >= 0) { const s = data.world.structures[b]; const org = data.world.orgs.find((o) => o.premises.includes(b)); text = `<b>${esc(org?.name ?? s?.id)}</b> <span class="dim">${esc(s?.type)} · ${town.occupancy[b] ?? 0} inside</span>`; } }
    if (!text) { hover.style.display = "none"; return; }
    hover.innerHTML = text; hover.style.display = "block"; hover.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`;
  });
  canvas.addEventListener("pointerleave", () => { hover.style.display = "none"; });

  // ---------- search
  const q = $<HTMLInputElement>("#q"), results = $("#results");
  type Hit = { go: string; label: string; sub: string };
  const index: Hit[] = [
    ...data.pilot?.seats.map((s) => ({ go: `seat:${s.id}`, label: s.title ?? s.id, sub: `model seat · ${s.model}` })) ?? [],
    ...data.world.orgs.map((o) => ({ go: `org:${o.id}`, label: o.name, sub: `${o.kind.replace(/_/g, " ")} · ${o.id}` })),
    ...data.world.posts.filter((p) => p.entity).map((p) => ({ go: `org:${p.entity}`, label: p.title ?? p.id, sub: `post ${p.id} · ${p.holder ?? ""}` })),
    ...data.persons.map((p) => ({ go: `person:${p}`, label: p, sub: "person" })),
    ...data.world.structures.filter((s) => s.type !== "road").map((s, i) => ({ go: `building:${data.world.structures.indexOf(s)}`, label: s.id, sub: s.type })).slice(0, 20000),
  ];
  let hits: Hit[] = [], hi = 0;
  const renderHits = () => { results.innerHTML = hits.map((h, i) => `<div class="hit${i === hi ? " on" : ""}" data-go="${esc(h.go)}"><b>${esc(h.label)}</b><span>${esc(h.sub)}</span></div>`).join(""); results.style.display = hits.length ? "block" : "none"; };
  q.addEventListener("input", () => {
    const s = q.value.trim().toLowerCase();
    if (!s) { hits = []; renderHits(); return; }
    const starts = index.filter((h) => h.label.toLowerCase().startsWith(s) || h.go.toLowerCase().endsWith(`:${s}`));
    const has = index.filter((h) => !starts.includes(h) && (h.label.toLowerCase().includes(s) || h.sub.toLowerCase().includes(s)));
    hits = [...starts, ...has].slice(0, 12); hi = 0; renderHits();
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { hi = Math.min(hits.length - 1, hi + 1); renderHits(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { hi = Math.max(0, hi - 1); renderHits(); e.preventDefault(); }
    else if (e.key === "Enter" && hits[hi]) { go(hits[hi]!.go); q.blur(); hits = []; renderHits(); }
    else if (e.key === "Escape") { q.value = ""; hits = []; renderHits(); q.blur(); }
  });
  results.addEventListener("click", () => { hits = []; setTimeout(renderHits, 0); });

  // ---------- keys
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === "ArrowRight") { setPlaying(false); void jump(t + (e.shiftKey ? DAY : 3600)); }
    else if (e.key === "ArrowLeft") { setPlaying(false); void jump(t - (e.shiftKey ? DAY : 3600)); }
    else if (e.key === "]") setSpeed(speedIdx + 1);
    else if (e.key === "[") setSpeed(speedIdx - 1);
    else if (e.key === "q") town.rotate(1);
    else if (e.key === "e") town.rotate(-1);
    else if (e.key === "f" && sel?.kind === "person") follow = !follow;
    else if (e.key === "Escape") closePanel();
    else if (e.key === "/") { e.preventDefault(); q.focus(); }
  });

  // ---------- toasts: seats' acts as they happen
  const toasts = document.createElement("div"); toasts.className = "toasts"; document.body.appendChild(toasts);
  function toast(html: string, a: SeatAct) {
    const el = document.createElement("div"); el.className = "toast glass"; el.innerHTML = `<span class="dim">${esc(stampOf(a.t))}</span> ${html}`; el.dataset.go = `act:${a.ord}`;
    toasts.prepend(el); while (toasts.children.length > 4) toasts.lastElementChild!.remove();
    setTimeout(() => el.classList.add("fade"), 5200); setTimeout(() => el.remove(), 6200);
  }

  // ---------- the URL
  const writeHash = () => { const h = new URLSearchParams(); h.set("run", key); h.set("t", String(Math.round(t))); if (sel) h.set("sel", `${sel.kind}:${sel.id}`); if (params.get("gl")) h.set("gl", params.get("gl")!); history.replaceState(null, "", `#${h}`); };

  // ---------- the loop
  let last = performance.now(), frames = 0, fpsAt = last, fps = 0, frameMs = 0, poolsAt = 0;
  const hud = $("#hud");
  (window as any).__oikos = { get fps() { return fps; }, get frameMs() { return frameMs; }, backend: town.backend, people: P, jump, go, setPlaying, get t() { return t; } };
  town.renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    const f0 = performance.now();
    if (playing) { advance(t + dt * SPEEDS[speedIdx]!.s); clockUi(); tl.set(t); }
    if (overlayDirty) applyOverlay();
    town.stepFlight(now);
    town.updatePeople(t, SPEEDS[speedIdx]!.s);
    if (follow && town.selectedPerson >= 0) { const p = town.personPos(town.selectedPerson); if (p) town.follow(p); }
    if (now - poolsAt > 250) { town.updatePools(); poolsAt = now; }
    town.render(now);
    placeLabels();
    frameMs = frameMs * 0.9 + (performance.now() - f0) * 0.1;
    frames++;
    if (now - fpsAt > 1000) { fps = Math.round((frames * 1000) / (now - fpsAt)); frames = 0; fpsAt = now; hud.textContent = `${town.backend} · ${fps} fps · ${P.toLocaleString()} people · ${data.meta.kept.toLocaleString()} lines indexed`; }
  });
  await jump(t);
  legend();
  const s0 = params.get("sel");
  if (s0) go(s0);
  if (params.get("play") === "1") setPlaying(true);
  void loadChunk(1);
}

/** The sky behind the town, by the hour. */
function skyOf(h: number): string {
  const stops: [number, string, string][] = [[0, "#060a18", "#10162c"], [5, "#0b1230", "#1d2448"], [6.3, "#33406f", "#e39a6a"], [8, "#6fa3d8", "#cfe3f2"], [12, "#79b4e6", "#e3f0f8"], [16.5, "#77a9dc", "#f1e2c4"], [18.2, "#4c4e86", "#f08a5d"], [19.5, "#161b3c", "#3b2c52"], [24, "#060a18", "#10162c"]];
  let i = 0; while (i < stops.length - 2 && stops[i + 1]![0] <= h) i++;
  const [h0, a0, b0] = stops[i]!, [h1, a1, b1] = stops[i + 1]!;
  const k = (h - h0) / (h1 - h0 || 1);
  const mix = (x: string, y: string) => { const p = new THREE.Color(x).lerp(new THREE.Color(y), Math.max(0, Math.min(1, k))); return `#${p.getHexString()}`; };
  return `linear-gradient(180deg, ${mix(a0, a1)} 0%, ${mix(b0, b1)} 100%)`;
}

void boot();
void BASE; void money; void CLASS_LABEL;
