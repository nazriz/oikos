// The Bevy explorer's interface: plain DOM round the scene (a WebAssembly Bevy app drawing into #scene). It speaks
// to the scene only through the bridge (the wasm exports: commands in, events out) and reads panels from the server's
// /api (the explorer's data layer). Two workspaces: the map (watch and inspect a run) and the workbench (investigate
// and compare runs: workbench.ts). The address keeps the view: #run=..&t=..&sel=..&ov=..&ws=..
// Panels are the Three.js explorer's own (renderer/src/client/inspector.ts), so the two explorers show the same thing.

import { BASE, CATEGORY, CLASS_COLOR, CLASS_SHORT, DAY, HARD_COLOR, SEAT_COLORS, clock, esc, getJson, type Cls, type SeatAct, type WorldData } from "../../renderer/src/client/api";
import * as I from "../../renderer/src/client/inspector";
import { Timeline } from "./timeline";
import { Workbench } from "./workbench";

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const params = new URLSearchParams(location.hash.slice(1));
const SPEEDS = [{ s: 900, l: "¼h/s" }, { s: 3600, l: "1h/s" }, { s: 3 * 3600, l: "3h/s" }, { s: 12 * 3600, l: "12h/s" }, { s: DAY, l: "1d/s" }, { s: 4 * DAY, l: "4d/s" }];

/** The wasm module's exports (explorer/src/web.rs). */
interface Scene {
  start(canvas: string, base: string, run: string): void;
  send(json: string): void;
  select(id: string, fly: boolean): void;
  set_time(t: number): void;
  set_speed(x: number): void;
  play(on: boolean): void;
  set_overlay(name: string, focus?: string | null): void;
  load_run(id: string): void;
  camera(json: string): void;
  take_events_json(): string;
}

type Ev =
  | { ev: "ready"; run: string; persons: number; structures: number; days: number; last_t: number; backend: string; first_paint_ms: number }
  | { ev: "hovered"; id: string; label: string; x: number; y: number }
  | { ev: "selected"; id: string }
  | { ev: "time_changed"; t: number; playing: boolean; speed: number }
  | { ev: "seat_act"; ord: number }
  | { ev: "labels"; at: [string, number, number, boolean][] }
  | { ev: "stats"; fps: number; frame_ms_mean: number; frame_ms_p95: number; update_ms: number; people_drawn: number; trips: number; structures: number; track_bytes: number; memory_bytes: number }
  | { ev: "error"; message: string }
  | { ev: "waiting"; message: string };

/** Loads the scene: the WebGPU build where the browser has WebGPU (and `gl=1` is not asked), else the WebGL 2 one. */
async function loadScene(): Promise<{ scene: Scene; backend: string }> {
  let gpu = false;
  if (params.get("gl") !== "1" && (navigator as any).gpu) {
    try { gpu = !!(await (navigator as any).gpu.requestAdapter()); } catch { gpu = false; }
  }
  const flavour = gpu ? "webgpu" : "webgl2";
  const mod: any = await import(/* @vite-ignore */ `${BASE}/bevy/${flavour}/oikos_explorer.js`);
  await mod.default({ module_or_path: `${BASE}/bevy/${flavour}/oikos_explorer_bg.wasm` });
  return { scene: mod as Scene, backend: gpu ? "WebGPU" : "WebGL 2" };
}

async function boot() {
  const app = $("#app");
  let runs: any;
  try { runs = await getJson("api/runs"); } catch (e) { app.innerHTML = splash("Oikos explorer", `<p class="bad">${esc((e as Error).message)}</p>`); return; }
  const key = params.has("all") ? undefined : params.get("run") ?? runs.single ?? (runs.runs.length === 1 ? runs.runs[0].key : undefined);
  if (!key) return picker(app, runs.runs);
  await openRun(app, key, runs);
}

const splash = (title: string, body: string) => `<div class="splash"><div class="brand"><span class="logo"></span>Oikos <b>explorer</b></div><h1>${esc(title)}</h1>${body}</div>`;

function picker(app: HTMLElement, runs: any[]) {
  app.innerHTML = `<div class="picker"><header><div class="brand"><span class="logo"></span>Oikos <b>explorer</b></div><p class="dim">Runs this server can show. Each is indexed the first time it is opened. The researcher's view: it may see everything, and feeds nothing back.</p></header>
  <div class="cards">${runs.map((r) => `<a class="card" href="#run=${encodeURIComponent(r.key)}"><div class="cname">${esc(r.name)}</div><div class="cnote">${esc(r.note ?? "")}</div><div class="cmeta">${new Date(r.mtime).toISOString().slice(0, 16).replace("T", " ")} · ${esc(r.state)}</div></a>`).join("")}</div></div>`;
  window.addEventListener("hashchange", () => location.reload(), { once: true });
}

/** Waits until the run can be shown: indexed, or (the Rust data layer) its header read, the rest indexed behind it. */
async function waitReady(app: HTMLElement, key: string, name: string): Promise<string> {
  for (;;) {
    const s = await getJson(`api/r/${encodeURIComponent(key)}/status?open=1`);
    if (s.state === "ready" || s.state === "live" || s.header) return s.state;
    if (s.state === "failed") throw new Error(s.message);
    const box = $(".boot-msg");
    if (box) box.textContent = `Indexing the run's log: ${s.message ?? ""} (${s.seconds ?? 0} s)`;
    else app.innerHTML = splash(name, `<div class="spinner"></div><p class="dim boot-msg">Indexing the run's log…</p>`);
    await new Promise((r) => setTimeout(r, 700));
  }
}

async function openRun(app: HTMLElement, key: string, runs: any) {
  const t0 = performance.now();
  const entry = runs.runs.find((r: any) => r.key === key) ?? { name: key };
  const api = (p: string) => `api/r/${encodeURIComponent(key)}/${p}`;
  // the scene's code loads while the run is (perhaps) still being indexed
  const times: Record<string, number> = {};
  (window as any).OIKOS_TIMES = times;
  const mark = (k: string) => { times[k] = Math.round(performance.now() - t0); };
  // (the scene's code loads while the run's header is read; the scene starts once its stage exists: started any
  // earlier, behind the loading screen, it was slower to first paint, measured 2026-10-25)
  const scenePromise = loadScene().then((x) => { mark("scene_code_loaded"); return x; });
  let state = "";
  try { state = await waitReady(app, key, entry.name); } catch (e) { app.innerHTML = splash(entry.name, `<p class="bad">${esc((e as Error).message)}</p>`); return; }
  mark("header_indexed");
  const data = await getJson<WorldData>(api("world?partial=1"));
  mark("world_fetched");
  const P = data.meta.persons, D = data.meta.days, END = () => Math.max(data.meta.lastT, data.meta.days * DAY);
  const seatColor = new Map<string, string>();
  data.meta.seats.forEach((s, i) => seatColor.set(s, SEAT_COLORS[i % SEAT_COLORS.length]!));
  const orgName = new Map(data.world.orgs.map((o) => [o.id, o.name]));
  const nameOf = (id: string) => orgName.get(id) ?? id;
  const structName = (i: number) => data.world.structures[i]?.id ?? data.meta.extraStructures[i - data.world.structures.length] ?? "?";
  const ov = data.pilot?.overview;

  app.innerHTML = `
  <header class="top">
    <div class="brand"><span class="logo"></span>Oikos <b>explorer</b></div>
    <div class="runname"><b>${esc(data.world.name || data.meta.runId)}</b> <span class="dim mono">${esc(entry.name)}</span>
      <span class="dim">${P.toLocaleString()} people · ${D} days${ov?.profile ? ` · ${esc(ov.profile)}` : ""}${data.pilot ? "" : " · code only"}</span>${runs.runs.length > 1 ? ` <a class="dim" href="#all" id="allruns">all runs</a>` : ""}</div>
    <nav class="ws" id="ws"><button data-ws="map" class="on">Map</button><button data-ws="bench">Workbench</button></nav>
    <div class="search"><input id="q" placeholder="Search people, offices, firms, buildings  ( / )" autocomplete="off" spellcheck="false"><div class="results" id="results"></div></div>
    <div class="indexing" id="indexing" hidden><div class="spinner"></div><span>indexing</span></div>
    <div class="hud mono dim" id="hud" title="frame time and memory (press \` to hide)"></div>
  </header>
  <main class="map-ws" id="mapws">
    <aside class="rail" id="rail">
      <section class="block"><h4>Overlay</h4>
        <div class="seg" id="modes"><button data-mode="town" class="on">Town</button><button data-mode="decided">Who decided</button><button data-mode="hardship">Hardship</button></div>
        <div class="legend" id="legend"></div></section>
      ${data.pilot?.seats.length ? `<section class="block"><h4>Model seats</h4><div class="seats">${data.pilot.seats.map((s) => `<a class="seat" data-go="seat:${esc(s.id)}" style="--c:${seatColor.get(s.id)}"><i></i><span>${esc(s.title ?? s.id)}</span><em>${s.acts ?? 0} acts</em></a>`).join("")}</div><div class="dim small">${esc(data.pilot.seats[0]?.model ?? "")}${data.pilot.twin ? ` · twin ${esc(data.pilot.twin.run ?? "found")}` : " · no twin"}</div></section>` : ""}
      <section class="block"><h4>View</h4><div class="btns">
        <button data-cam='{"turn":{"quarter":-1}}' title="turn left (q)">⟲</button><button data-cam='{"turn":{"quarter":1}}' title="turn right (e)">⟳</button>
        <button data-cam='"iso"' title="isometric (i)">iso</button><button data-cam='{"tilt":{"degrees":70}}' title="from above">top</button><button data-cam='"frame"' title="the whole town (0)">fit</button>
        <button id="followbtn" title="follow the selected person (f)">follow</button></div>
        <p class="dim small">Drag to pan · right-drag or shift-drag to turn and tilt · wheel to zoom.</p></section>
      <section class="block small dim">People are drawn moving along the roads between the places the log puts them; the log has no routes, so the way is the shortest by road and a visual only.</section>
    </aside>
    <div class="stage" id="stage"><canvas id="scene" tabindex="0"></canvas><div class="labels" id="labels"></div><div class="hover" id="hover"></div><div class="toasts" id="toasts"></div>
      <div class="loading-scene" id="loadingScene"><div class="spinner"></div><span>Drawing the town…</span></div></div>
    <aside class="inspector" id="inspector"><button class="close" id="close" title="close (Esc)">×</button><div class="ibody" id="ibody"></div></aside>
    <footer class="tl-wrap"><div class="controls">
      <button class="play" id="play" title="play / pause (space)"></button>
      <div class="clock"><span class="sun" id="sun"></span><div><div class="cday" id="cday">day 0</div><div class="ctime" id="ctime">00:00</div></div></div>
      <div class="seg speed" id="speed">${SPEEDS.map((s, i) => `<button data-speed="${i}">${s.l}</button>`).join("")}</div>
      <div class="tl-legend">${(["person", "system", "seat", "world"] as Cls[]).map((c) => `<span><i style="background:${CLASS_COLOR[c]}"></i>${esc(CLASS_SHORT[c])}</span>`).join("")}<span><i style="background:${HARD_COLOR}"></i>hard</span><span class="dim">wheel: zoom · double-click: all</span></div>
    </div><div class="tl" id="tl"></div></footer>
  </main>
  <main class="bench-ws" id="benchws" hidden></main>`;
  $("#allruns")?.addEventListener("click", (e) => { e.preventDefault(); location.hash = "all"; location.reload(); });

  // ---------- the scene
  const { scene, backend } = await scenePromise;
  try { scene.start("scene", BASE, key); } catch (e) { if (!String(e).includes("Using exceptions for control flow")) throw e; }
  const send = (o: unknown) => scene.send(JSON.stringify(o));

  const tl = new Timeline($("#tl"), data, seatColor);
  let t = Math.min(END(), Number(params.get("t") ?? 8 * 3600)), playing = false, speedIdx = 2, ready = false;
  let mode: "town" | "decided" | "hardship" = (params.get("ov") as any) ?? "town";
  let focus: string = params.get("focus") ?? (mode === "hardship" ? "agency" : "all");
  let sel: { kind: string; id: string } | undefined, follow = false;

  // ---------- the clock
  const clockUi = () => {
    const c = clock(t);
    $("#cday").textContent = `day ${c.day}`; $("#ctime").textContent = `${c.hh}:${c.mm}`;
    $("#sun").className = `sun ${c.hour >= 6 && c.hour < 18 ? "day" : "night"}`;
    tl.set(t);
  };
  const playIcon = () => { $("#play").innerHTML = playing ? `<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>` : `<svg viewBox="0 0 24 24"><path d="M7 5v14l12-7z"/></svg>`; };
  const setPlaying = (p: boolean) => { playing = p; scene.play(p); playIcon(); if (!p) { refreshPanel(); writeHash(); } };
  const setSpeed = (i: number) => { speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, i)); scene.set_speed(SPEEDS[speedIdx]!.s); for (const b of document.querySelectorAll<HTMLElement>("#speed button")) b.classList.toggle("on", Number(b.dataset.speed) === speedIdx); };
  const jump = (tt: number) => { t = Math.max(0, Math.min(END(), tt)); scene.set_time(t); clockUi(); };
  $("#play").addEventListener("click", () => setPlaying(!playing));
  for (const b of document.querySelectorAll<HTMLElement>("#speed button")) b.addEventListener("click", () => setSpeed(Number(b.dataset.speed)));
  tl.onScrub = (tt, done) => { if (playing) setPlaying(false); jump(tt); if (done) { refreshPanel(); writeHash(); } };
  tl.onAct = (a) => go(`act:${a.ord}`);
  playIcon(); setSpeed(speedIdx); jump(t);

  // ---------- overlays and the legend
  const setMode = (m: typeof mode, f?: string) => {
    mode = m;
    if (f !== undefined) focus = f;
    if (m === "hardship" && focus !== "money") focus = "agency";
    if (m === "decided" && !["all", "person", "system", "seat", "world", "self"].includes(focus)) focus = "all";
    for (const x of document.querySelectorAll<HTMLElement>("#modes button")) x.classList.toggle("on", x.dataset.mode === m);
    scene.set_overlay(m, m === "town" ? null : focus);
    legend(); writeHash();
  };
  const legend = () => {
    const L = $("#legend");
    if (mode === "town") L.innerHTML = `<div class="lg-title">People, each a light where they are</div><div class="lg">${[["#ffd27a", "at home"], ["#7fd3ff", "at work"], ["#d2a8ff", "elsewhere or on the way"]].map(([c, l]) => `<span><i class="dotc" style="background:${c}"></i>${l}</span>`).join("")}</div>
      <div class="lg-title">Changes reaching people, by who decided</div><div class="lg">${(["person", "system", "seat", "world"] as Cls[]).map((c) => `<span><i class="ringc" style="border-color:${CLASS_COLOR[c]}"></i>${esc(CLASS_SHORT[c])}</span>`).join("")}<span><i class="ringc" style="border-color:${HARD_COLOR}"></i>landed hard</span></div>
      <div class="lg-title">Seats' acts: an arc from the office to everyone reached</div>
      <div class="lg-title">Buildings, by category</div><div class="lg">${Object.entries(CATEGORY).filter(([k]) => k !== "other").map(([k, v]) => `<span><i style="background:${v.wall};border-top:3px solid ${v.roof}"></i>${k}</span>`).join("")}</div>`;
    else if (mode === "decided") L.innerHTML = `<div class="lg-title">Who decided the consequential changes reaching the people who live in each building, last 30 days</div><div class="lg pick">${(["all", "person", "system", "seat", "world", "self"]).map((c) => `<button data-focus="${c}" class="${focus === c ? "on" : ""}">${c === "all" ? "all but their own" : `<i style="background:${CLASS_COLOR[c as Cls]}"></i>${esc(CLASS_SHORT[c as Cls])}`}</button>`).join("")}</div><p class="dim small">By role in the world, not what runs it: every person here is simulated. Counted: money moved, decisions, orders, notices, bills, agreements, removals (measure/src/consequential.ts).</p>`;
    else L.innerHTML = `<div class="lg-title">Hardship, as people's own records state it</div><div class="lg pick">${[["agency", "sense of agency"], ["money", "money held (rank)"]].map(([k, l]) => `<button data-focus="${k}" class="${focus === k ? "on" : ""}">${l}</button>`).join("")}</div><div class="ramp"><span>low</span><i></i><span>high</span></div><p class="dim small">${focus === "agency" ? "Each person's own record: agency now (0 to 10,000). Buildings: the mean of the people who slept there." : "Money in their accounts at midnight, as a rank in the town (the lowest red). No composite: one raw quantity."} Red rings: refusals, removals, debts, failed payments, illness.</p>`;
    for (const b of L.querySelectorAll<HTMLElement>("[data-focus]")) b.addEventListener("click", () => setMode(mode, b.dataset.focus!));
  };
  for (const b of document.querySelectorAll<HTMLElement>("#modes button")) b.addEventListener("click", () => setMode(b.dataset.mode as any));
  for (const b of document.querySelectorAll<HTMLElement>("[data-cam]")) b.addEventListener("click", () => scene.camera(b.dataset.cam!));

  // ---------- labels over the scene
  const labelsEl = $("#labels");
  const seatOrgs = new Map<string, string>();
  for (const p of data.world.posts) if (p.holder && seatColor.has(p.holder) && p.entity) seatOrgs.set(p.entity, p.holder);
  const labelEls = new Map<string, HTMLElement>();
  const labelFor = (k: string): HTMLElement => {
    let el = labelEls.get(k);
    if (el) return el;
    el = document.createElement("div");
    if (k === "gate") { el.className = "label gate"; el.textContent = "the outside world"; }
    else {
      const oid = k.slice(4), o = data.world.orgs.find((x) => x.id === oid);
      const seat = seatOrgs.get(oid);
      const same = data.world.orgs.filter((x) => x.premises[0] === o?.premises[0] && x.id !== oid);
      el.className = `label ${seat ? "seat" : "org"}`;
      if (seat) el.style.setProperty("--c", seatColor.get(seat)!);
      el.innerHTML = `${seat ? "<i></i>" : ""}${esc(o?.name ?? oid)}${same.length ? `<span class="more" title="${esc(same.map((x) => x.name).join(", "))}"> +${same.length}</span>` : ""}`;
      el.dataset.go = k;
    }
    labelsEl.appendChild(el); labelEls.set(k, el);
    return el;
  };

  // ---------- the inspector
  const ctx = (): I.Ctx => ({ data, t, seatColor, nameOf, structName });
  const ibody = $("#ibody"), insp = $("#inspector");
  const show = (html: string) => { ibody.innerHTML = html; insp.classList.add("open"); document.body.classList.add("inspecting"); };
  const loading = (what: string) => `<div class="loading"><div class="spinner"></div>${esc(what)}</div>`;
  const beacons = (structs: number[], color: string) => send({ cmd: "beacons", structs, color });
  async function openPanel(kind: string, id: string, keepScroll = false) {
    const top = ibody.scrollTop;
    sel = { kind, id };
    if (!keepScroll) { show(loading(`${kind} ${id}`)); ibody.scrollTop = 0; }
    try {
      if (kind === "person") {
        const p = await getJson(api(`person/${encodeURIComponent(id)}?t=${Math.round(t)}`));
        if (p.missing) return show(`<div class="dim">${esc(id)}: not a person of this run</div>`);
        show(I.personHtml(ctx(), p));
        beacons([...(p.home ? [p.home.struct] : []), ...(p.job ? [p.job.struct] : [])], "#ffd27a");
      } else if (kind === "org") {
        const o = await getJson(api(`org/${encodeURIComponent(id)}?t=${Math.round(t)}`));
        if (o.missing) return show(`<div class="dim">${esc(id)}: not an organisation of this run</div>`);
        show(I.orgHtml(ctx(), o));
        beacons(o.premises.length ? o.premises.slice(0, 12).map((p: any) => p.struct) : [-1], o.seat ? seatColor.get(o.seat.participant) ?? CLASS_COLOR.seat : "#9fd8ff");
      } else if (kind === "building") {
        const b = await getJson(api(`building/${id}?t=${Math.round(t)}`));
        show(I.buildingHtml(ctx(), b));
        beacons([Number(id)], "#ffffff");
      } else if (kind === "act") {
        const x = await getJson(api(`act/${id}`));
        if (x.missing) return show(`<div class="dim">no such act</div>`);
        show(I.actHtml(ctx(), x));
        tl.selectedAct = Number(id); tl.draw();
        send({ cmd: "show_act", ord: Number(id) });
        const placed = x.act.targets.filter((tg: any) => tg.struct >= 0).slice(0, 20).map((tg: any) => tg.struct);
        beacons(placed, seatColor.get(x.act.participant) ?? CLASS_COLOR.seat);
      } else if (kind === "seat") {
        const s = await getJson(api(`seat/${encodeURIComponent(id)}`));
        show(s.missing ? `<div class="dim">${esc(id)}: no seat data</div>` : I.seatHtml(ctx(), s));
        const org = [...seatOrgs].find(([, h]) => h === id)?.[0];
        const prem = org ? data.world.orgs.find((o) => o.id === org)?.premises ?? [] : [];
        beacons(prem.length ? prem.slice(0, 4) : [-1], seatColor.get(id)!);
      }
      if (keepScroll) ibody.scrollTop = top;
      writeHash();
    } catch (e) { show(`<div class="bad">${esc((e as Error).message)}</div>`); }
  }
  const refreshPanel = () => { if (sel && ["person", "org", "building"].includes(sel.kind)) void openPanel(sel.kind, sel.id, true); };
  const closePanel = () => {
    insp.classList.remove("open"); document.body.classList.remove("inspecting");
    sel = undefined; follow = false; $("#followbtn").classList.remove("on");
    scene.select("", false); beacons([], "#fff"); send({ cmd: "clear_act" });
    tl.selectedAct = -1; tl.draw(); writeHash();
  };
  $("#close").addEventListener("click", closePanel);

  /** Opens a thing: the scene selects it (and flies to it), the panel opens. */
  const go = (target: string) => {
    const i = target.indexOf(":"), kind = target.slice(0, i), id = target.slice(i + 1);
    if (kind === "act") { const a = data.seatActs.find((x) => x.ord === Number(id)); if (a) { if (playing) setPlaying(false); jump(a.t); } }
    if (kind !== "act" || true) send({ cmd: "clear_act" });
    scene.select(target, true);
    void openPanel(kind, id);
  };
  document.addEventListener("click", async (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-go],[data-trace],[data-time]");
    if (!el) return;
    if (el.dataset.go) { e.preventDefault(); if ($("#mapws").hidden) workspace("map"); go(el.dataset.go); return; }
    if (el.dataset.time) { if (playing) setPlaying(false); jump(Number(el.dataset.time)); return; }
    if (el.dataset.trace) {
      if ((e.target as HTMLElement).classList.contains("when") && el.dataset.at) { if (playing) setPlaying(false); jump(Number(el.dataset.at)); refreshPanel(); return; }
      const next = el.nextElementSibling;
      if (next?.classList.contains("trace-wrap")) { next.remove(); el.classList.remove("open"); return; }
      el.classList.add("open");
      const w = document.createElement("div"); w.className = "trace-wrap"; w.innerHTML = loading("tracing");
      el.after(w);
      const tr = await getJson(api(`trace/${el.dataset.trace}${el.dataset.about ? `?about=${encodeURIComponent(el.dataset.about)}` : ""}`));
      w.innerHTML = I.traceHtml(ctx(), tr.links);
    }
  });
  $("#followbtn").addEventListener("click", () => toggleFollow());
  const toggleFollow = () => { follow = !follow && sel?.kind === "person"; scene.camera(JSON.stringify({ follow: { on: follow } })); $("#followbtn").classList.toggle("on", follow); };

  // ---------- search
  const q = $<HTMLInputElement>("#q"), results = $("#results");
  type Hit = { go: string; label: string; sub: string };
  const index: Hit[] = [
    ...(data.pilot?.seats.map((s) => ({ go: `seat:${s.id}`, label: s.title ?? s.id, sub: `model seat · ${s.model}` })) ?? []),
    ...data.world.orgs.map((o) => ({ go: `org:${o.id}`, label: o.name, sub: `${o.kind.replace(/_/g, " ")} · ${o.id}` })),
    ...data.world.posts.filter((p) => p.entity).map((p) => ({ go: `org:${p.entity}`, label: p.title ?? p.id, sub: `post ${p.id} · ${p.holder ?? ""}` })),
    ...data.persons.map((p) => ({ go: `person:${p}`, label: p, sub: "person" })),
    ...data.world.structures.map((s, i) => ({ s, i })).filter((x) => x.s.type !== "road").map((x) => ({ go: `building:${x.i}`, label: x.s.id, sub: x.s.type })),
  ];
  let hits: Hit[] = [], hi = 0;
  const renderHits = () => { results.innerHTML = hits.map((h, i) => `<div class="hit${i === hi ? " on" : ""}" data-go="${esc(h.go)}"><b>${esc(h.label)}</b><span>${esc(h.sub)}</span></div>`).join(""); results.style.display = hits.length ? "block" : "none"; };
  q.addEventListener("input", () => {
    const s = q.value.trim().toLowerCase();
    if (!s) { hits = []; renderHits(); return; }
    const starts: Hit[] = [], has: Hit[] = [];
    for (const h of index) {
      if (starts.length >= 12) break;
      const l = h.label.toLowerCase();
      if (l.startsWith(s) || h.go.toLowerCase().endsWith(`:${s}`)) starts.push(h);
      else if (has.length < 12 && (l.includes(s) || h.sub.toLowerCase().includes(s))) has.push(h);
    }
    hits = [...starts, ...has].slice(0, 12); hi = 0; renderHits();
  });
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { hi = Math.min(hits.length - 1, hi + 1); renderHits(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { hi = Math.max(0, hi - 1); renderHits(); e.preventDefault(); }
    else if (e.key === "Enter" && hits[hi]) { go(hits[hi]!.go); hits = []; renderHits(); q.blur(); }
    else if (e.key === "Escape") { hits = []; renderHits(); q.blur(); }
  });
  q.addEventListener("blur", () => setTimeout(() => { results.style.display = "none"; }, 150));

  // ---------- keys (explorer.md: space, arrows, [ ], q e, f, /, Esc; and i for isometric, 0 to fit)
  let hudOn = true;
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
    if (!$("#mapws").hidden) {
      if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); if (playing) setPlaying(false); jump(t + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? DAY : 3600)); refreshPanel(); writeHash(); }
      else if (e.key === "[") setSpeed(speedIdx - 1);
      else if (e.key === "]") setSpeed(speedIdx + 1);
      else if (e.key === "q") scene.camera('{"turn":{"quarter":-1}}');
      else if (e.key === "e") scene.camera('{"turn":{"quarter":1}}');
      else if (e.key === "i") scene.camera('"iso"');
      else if (e.key === "0") scene.camera('"frame"');
      else if (e.key === "f") toggleFollow();
      else if (e.key === "`") { hudOn = !hudOn; $("#hud").hidden = !hudOn; }
    }
    if (e.key === "/") { e.preventDefault(); q.focus(); q.select(); }
    else if (e.key === "Escape") closePanel();
  });

  // ---------- the address
  let hashTimer = 0;
  const writeHash = () => {
    clearTimeout(hashTimer);
    hashTimer = window.setTimeout(() => {
      const p = new URLSearchParams();
      p.set("run", key); p.set("t", String(Math.round(t)));
      if (sel) p.set("sel", `${sel.kind}:${sel.id}`);
      if (mode !== "town") { p.set("ov", mode); p.set("focus", focus); }
      if (!$("#benchws").hidden) p.set("ws", "bench");
      if (params.get("gl") === "1") p.set("gl", "1");
      history.replaceState(null, "", `#${p.toString()}`);
    }, 250);
  };

  // an address edited or pasted in place: go to its moment, selection and overlay
  window.addEventListener("hashchange", () => {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.has("all") || (h.get("run") && h.get("run") !== key)) { location.reload(); return; }
    const ht = Number(h.get("t"));
    if (h.has("t") && Number.isFinite(ht) && Math.abs(ht - t) > 1) { if (playing) setPlaying(false); jump(ht); refreshPanel(); }
    const hs = h.get("sel");
    if (hs && (!sel || `${sel.kind}:${sel.id}` !== hs)) go(hs);
    const hov = (h.get("ov") ?? "town") as typeof mode;
    if (hov !== mode || (h.get("focus") && h.get("focus") !== focus)) setMode(hov, h.get("focus") ?? undefined);
  });

  // ---------- toasts: a seat's act as it happens
  const toasts = $("#toasts");
  const toast = (a: SeatAct) => {
    const col = seatColor.get(a.participant) ?? CLASS_COLOR.seat;
    const el = document.createElement("div"); el.className = "toast"; el.dataset.go = `act:${a.ord}`;
    el.innerHTML = `<b style="color:${col}">${esc(data.pilot?.seats.find((s) => s.id === a.participant)?.title ?? a.participant)}</b> ${esc(a.kinds.join(", "))}${a.text ? ` · <i>${esc(a.text.slice(0, 90))}</i>` : ""}`;
    toasts.prepend(el);
    while (toasts.children.length > 4) toasts.lastElementChild!.remove();
    setTimeout(() => el.classList.add("fade"), 4200); setTimeout(() => el.remove(), 5200);
  };

  // ---------- events from the scene
  const hover = $("#hover");
  const canvasEl = $("#scene");
  const hud = $("#hud");
  let lastStats = "";
  const onEvent = (ev: Ev) => {
    switch (ev.ev) {
      case "ready":
        if (ready) return;
        ready = true;
        $("#loadingScene").remove();
        (window as any).OIKOS_FIRST_PAINT_MS = performance.now() - t0;
        mark("first_paint");
        (window as any).OIKOS_READY = ev;
        jump(t); setMode(mode, focus);
        if (params.get("sel")) { const s = params.get("sel")!; scene.select(s, true); const i = s.indexOf(":"); void openPanel(s.slice(0, i), s.slice(i + 1)); }
        send({ cmd: "stats", on: true });
        if (params.get("ws") === "bench") workspace("bench");
        break;
      case "time_changed":
        if (playing || Math.abs(ev.t - t) > 1) { t = ev.t; clockUi(); }
        if (playing && !ev.playing) { playing = false; playIcon(); }
        break;
      case "selected":
        if (!ev.id) break;
        if (!sel || `${sel.kind}:${sel.id}` !== ev.id) { const i = ev.id.indexOf(":"); void openPanel(ev.id.slice(0, i), ev.id.slice(i + 1)); }
        break;
      case "hovered":
        if (!ev.id) { hover.style.display = "none"; canvasEl.style.cursor = ""; break; }
        hover.innerHTML = esc(ev.label); hover.style.display = "block";
        { const r = canvasEl.getBoundingClientRect(); hover.style.transform = `translate(${ev.x + r.left + 14}px, ${ev.y + r.top + 12}px)`; }
        canvasEl.style.cursor = "pointer";
        break;
      case "seat_act": { const a = data.seatActs.find((x) => x.ord === ev.ord); if (a && playing) toast(a); break; }
      case "labels": {
        const seen = new Set<string>();
        for (const [k, x, y, near] of ev.at) {
          const el = labelFor(k); seen.add(k);
          const isSeat = el.classList.contains("seat");
          el.style.display = near || isSeat || k === "gate" ? "" : "none";
          el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        }
        for (const [k, el] of labelEls) if (!seen.has(k)) el.style.display = "none";
        break;
      }
      case "stats": {
        const s = `${ev.fps.toFixed(0)} fps · ${ev.frame_ms_mean.toFixed(1)} ms (p95 ${ev.frame_ms_p95.toFixed(1)}) · scene ${ev.update_ms.toFixed(1)} ms · ${ev.people_drawn.toLocaleString()} drawn · ${ev.trips} on the way · ${(ev.memory_bytes / 1048576).toFixed(0)} MB · ${backend}`;
        if (s !== lastStats) { hud.textContent = s; lastStats = s; }
        (window as any).OIKOS_STATS = ev;
        break;
      }
      case "error": console.warn("scene:", ev.message); break;
      case "waiting": console.debug("scene:", ev.message); break;
    }
  };
  const pumpEvents = () => {
    try { for (const ev of JSON.parse(scene.take_events_json()) as Ev[]) { if (!(`ev_${ev.ev}` in times)) mark(`ev_${ev.ev}`); onEvent(ev); } } catch (e) { console.error(e); }
    requestAnimationFrame(pumpEvents);
  };
  requestAnimationFrame(pumpEvents);
  legend();

  // ---------- a run shown while its log is still being indexed: refreshed when it is done
  if (state !== "ready" && state !== "live") {
    const badge = $("#indexing"); badge.hidden = false;
    const poll = async () => {
      const s = await getJson(api("status"));
      if (s.state === "ready") {
        const w = await getJson<WorldData>(api("world"));
        Object.assign(data, w);
        tl.refresh(); badge.hidden = true; refreshPanel();
        return;
      }
      badge.querySelector("span")!.textContent = `indexing · ${s.message ?? ""}`;
      setTimeout(poll, 2000);
    };
    setTimeout(poll, 2000);
  }

  // ---------- the workbench
  let bench: Workbench | undefined;
  const workspace = (w: "map" | "bench") => {
    $("#mapws").hidden = w !== "map"; $("#benchws").hidden = w !== "bench";
    for (const b of document.querySelectorAll<HTMLElement>("#ws button")) b.classList.toggle("on", b.dataset.ws === w);
    if (w === "bench") { if (playing) setPlaying(false); bench ??= new Workbench($("#benchws"), { key, runs: runs.runs, data, seatColor, ctx, onCompare: compareOnMap }); bench.show(); }
    writeHash();
  };
  for (const b of document.querySelectorAll<HTMLElement>("#ws button")) b.addEventListener("click", () => workspace(b.dataset.ws as any));
  /** The workbench's compare, shown on the map: a per-building difference and the other run's pulse on the timeline. */
  function compareOnMap(values: number[] | null, label: string, otherPulse?: number[]) {
    if (values) { send({ cmd: "compare_values", values, label }); scene.set_overlay("compare", null); for (const x of document.querySelectorAll<HTMLElement>("#modes button")) x.classList.remove("on"); $("#legend").innerHTML = `<div class="lg-title">${esc(label)}</div><div class="ramp diverge"><span>fewer here</span><i></i><span>more here</span></div><p class="dim small">Per building: the other run's count of consequential changes reaching the people who live there, minus this run's, to the moment shown (scaled to the largest). Pick an overlay to leave the comparison.</p>`; }
    tl.other = otherPulse ? { label, byDay: otherPulse } : undefined; tl.draw();
    workspace("map");
  }
}

void boot();
