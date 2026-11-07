// The researcher workbench: the map's second workspace, for investigating and comparing runs. Everything heavy is
// done on the server: the events table, cohorts and per-building counts by the Rust data layer
// (kernel/crates/explore/src/bench.rs), the measures of stewardship by measure/'s Ledger (renderer/src/workbench.ts).
// The browser draws, pages and filters only what it is sent. Nothing judges an outcome; a measure is named, with what it
// counts. Debriefs are not shown in this build (VISION 15): the server names the hook for a separate, deliberate view.

import { BASE, CLASS_COLOR, CLASS_SHORT, DAY, esc, getJson, stampOf, type Cls, type WorldData } from "../../renderer/src/client/api";
import { traceHtml, type Ctx } from "../../renderer/src/client/inspector";

export interface BenchOpts { key: string; runs: any[]; data: WorldData; seatColor: Map<string, string>; ctx: () => Ctx; onCompare: (values: number[] | null, label: string, otherPulse?: number[]) => void }

/** Series colours: a categorical order stepped for the dark surface (#0f172a), checked for lightness, chroma, colour-blind
 * and normal-vision separation and contrast (docs/explorer.md, "The workbench"); assigned to runs or arms in a fixed
 * order, never by rank. */
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"];

interface RunInfo { key: string; name: string; group: null | { experiment: string; arm?: string; seed?: number; reference?: string; registered?: { primary: { measure: string; arm?: string; vs?: string; expect?: string }[]; secondary: { measure: string }[]; question?: string } } }
interface Def { name: string; family: string; unit: string; what: string }
interface Series { days: number; defs: Def[]; series: Record<string, (number | null)[]>; seconds: number }

const fmt = (v: number | null | undefined, unit: string) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (unit === "share") return `${(v * 100).toFixed(1)}%`;
  if (unit === "money") return Math.round(v).toLocaleString();
  return Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : (Math.round(v * 100) / 100).toLocaleString();
};

export class Workbench {
  private runs: RunInfo[] = [];
  private chosen = new Set<string>();
  private tab: "compare" | "measures" | "events" | "cohorts" = "measures";
  private measure = "decisions";
  private byArm = true;
  private cache = new Map<string, Series>();
  private evq: Record<string, string> = { order: "desc" };
  private evOffset = 0;
  private debriefNote = "";

  constructor(readonly host: HTMLElement, readonly o: BenchOpts) {}

  async show() {
    if (!this.runs.length) {
      const r = await getJson("wb/runs");
      this.runs = r.runs;
      this.debriefNote = r.debriefs?.note ?? "";
      this.chosen.add(this.o.key);
      // the run's experiment, if any: all its arms and seeds to start with
      const g = this.runs.find((x) => x.key === this.o.key)?.group;
      if (g) for (const x of this.runs) if (x.group?.experiment === g.experiment) this.chosen.add(x.key);
    }
    this.render();
  }

  private group() { return this.runs.find((x) => x.key === this.o.key)?.group ?? this.runs.find((x) => this.chosen.has(x.key) && x.group)?.group ?? null; }

  private render() {
    const exps = new Map<string, RunInfo[]>();
    const order = [...this.runs].sort((a, b) => (a.group?.experiment ?? "~").localeCompare(b.group?.experiment ?? "~") || (a.group?.seed ?? 0) - (b.group?.seed ?? 0) || (a.group?.arm ?? a.name).localeCompare(b.group?.arm ?? b.name));
    for (const r of order) { const k = r.group?.experiment ?? ""; exps.set(k, [...(exps.get(k) ?? []), r]); }
    this.host.innerHTML = `
      <aside class="wb-side">
        <h4>Runs</h4>
        ${[...exps].map(([e, rs]) => `<div class="wb-exp">${e ? `<div class="wb-exp-name">experiment <b>${esc(e)}</b>${rs[0]?.group?.registered ? ` <span class="tag reg">pre-registered</span>` : ""}</div>` : rs.length ? `<div class="wb-exp-name dim">single runs</div>` : ""}
          ${rs.map((r) => `<label class="wb-run"><input type="checkbox" data-run="${esc(r.key)}" ${this.chosen.has(r.key) ? "checked" : ""}><span>${esc(r.group?.arm ? `${r.group.arm} · seed ${r.group.seed}` : r.name)}</span>${r.key === this.o.key ? `<em>on the map</em>` : ""}</label>`).join("")}</div>`).join("")}
        <p class="dim small">Pick runs to compare: a model seat and its code twin, an experiment's arms and seeds, a fork and its parent. Runs this server was started with: <span class="mono">oikos explore --all --runs DIR</span> or several run folders.</p>
        <p class="dim small">Debriefs: ${esc(this.debriefNote || "not shown in this build (VISION 15).")}</p>
      </aside>
      <section class="wb-main">
        <nav class="wb-tabs">${(["measures", "compare", "events", "cohorts"] as const).map((t) => `<button data-tab="${t}" class="${this.tab === t ? "on" : ""}">${{ measures: "Measures", compare: "Compare", events: "Events", cohorts: "Cohorts" }[t]}</button>`).join("")}</nav>
        <div class="wb-body" id="wbbody"></div>
      </section>`;
    for (const c of this.host.querySelectorAll<HTMLInputElement>("[data-run]")) c.addEventListener("change", () => { if (c.checked) this.chosen.add(c.dataset.run!); else this.chosen.delete(c.dataset.run!); void this.body(); });
    for (const b of this.host.querySelectorAll<HTMLElement>("[data-tab]")) b.addEventListener("click", () => { this.tab = b.dataset.tab as any; this.render(); });
    void this.body();
  }

  private async series(keys: string[]): Promise<Map<string, Series>> {
    const want = keys.filter((k) => !this.cache.has(k));
    if (want.length) {
      const got = await getJson<Record<string, Series>>(`wb/measures?runs=${want.map(encodeURIComponent).join(",")}`);
      for (const [k, v] of Object.entries(got)) this.cache.set(k, v);
    }
    return new Map(keys.map((k) => [k, this.cache.get(k)!]));
  }

  private async body() {
    const el = this.host.querySelector<HTMLElement>("#wbbody")!;
    el.innerHTML = `<div class="loading"><div class="spinner"></div>reading the logs (measures are computed once per run, from its log)…</div>`;
    try {
      if (this.tab === "measures") await this.measures(el);
      else if (this.tab === "compare") await this.compare(el);
      else if (this.tab === "events") await this.events(el);
      else await this.cohorts(el);
    } catch (e) { el.innerHTML = `<div class="bad">${esc((e as Error).message)}</div>`; }
  }

  /** Which way a measure is registered in the chosen runs' experiment: primary, secondary, or exploratory. */
  private regOf(name: string): "primary" | "secondary" | "exploratory" | undefined {
    const reg = this.group()?.registered;
    if (!reg) return undefined;
    if (reg.primary.some((p) => p.measure === name)) return "primary";
    if (reg.secondary.some((p) => p.measure === name)) return "secondary";
    return "exploratory";
  }
  private regTag(name: string) {
    const r = this.regOf(name);
    return r ? `<span class="tag ${r === "exploratory" ? "expl" : "reg"}">${r === "exploratory" ? "exploratory" : `registered · ${r}`}</span>` : "";
  }

  private exportLinks(what: string, q: Record<string, string>) {
    const p = (format: string) => `${BASE}/wb/export?${new URLSearchParams({ what, format, ...q })}`;
    return `<span class="wb-export">export <a href="${p("csv")}" download>CSV</a> · <a href="${p("parquet")}" download>Parquet</a></span>`;
  }

  // ---------------------------------------------------------------- measures over time

  private async measures(el: HTMLElement) {
    const keys = [...this.chosen];
    if (!keys.length) { el.innerHTML = `<p class="dim">Pick a run on the left.</p>`; return; }
    const ss = await this.series(keys);
    const defs = [...ss.values()][0]!.defs;
    const def = defs.find((d) => d.name === this.measure) ?? defs[0]!;
    this.measure = def.name;
    const infos = keys.map((k) => this.runs.find((r) => r.key === k)!).filter(Boolean);
    const arms = [...new Set(infos.map((r) => r.group?.arm).filter(Boolean))] as string[];
    const byArm = this.byArm && arms.length > 0 && infos.every((r) => r.group?.arm);
    const lines: Line[] = [];
    if (byArm) {
      arms.forEach((arm, i) => {
        const xs = infos.filter((r) => r.group!.arm === arm).map((r) => ss.get(r.key)!.series[def.name] ?? []);
        const s = spread(xs);
        lines.push({ label: `${arm} (${xs.length} seed${xs.length > 1 ? "s" : ""})`, color: SERIES[i % SERIES.length]!, values: s.mean, lo: s.lo, hi: s.hi, ciLo: s.ciLo, ciHi: s.ciHi });
      });
    } else {
      infos.forEach((r, i) => lines.push({ label: r.group?.arm ? `${r.group.arm} · seed ${r.group.seed}` : r.name, color: SERIES[i % SERIES.length]!, values: ss.get(r.key)!.series[def.name] ?? [] }));
    }
    const families = [...new Set(defs.map((d) => d.family))];
    const reg = this.group()?.registered;
    el.innerHTML = `
      <div class="wb-row">
        <label>Measure <select id="wbm">${families.map((f) => `<optgroup label="${esc(f)}">${defs.filter((d) => d.family === f).map((d) => `<option value="${d.name}" ${d.name === def.name ? "selected" : ""}>${esc(d.name)}${this.regOf(d.name) && this.regOf(d.name) !== "exploratory" ? " ★" : ""}</option>`).join("")}</optgroup>`).join("")}</select></label>
        ${arms.length ? `<label><input type="checkbox" id="wbarm" ${this.byArm ? "checked" : ""}> by arm, across seeds (mean; band: least to most; darker: 95% interval)</label>` : ""}
        ${this.exportLinks("measures", { runs: keys.join(","), measures: def.name })}
      </div>
      <h3 class="wb-h">${esc(def.name)} ${this.regTag(def.name)} <span class="dim">${esc(def.unit)}</span></h3>
      <p class="dim wb-what">${esc(def.what)} Read from each run's log by measure/'s Ledger (version ${esc((ss.get(keys[0]!) as any).version ?? "1")}), taken at each midnight: a count is to date; a share or mean is of what happened to date.</p>
      ${reg ? `<p class="small wb-reg">${esc(reg.question ?? "")}<br>Registered primary: ${reg.primary.map((p) => `<b>${esc(p.measure)}</b> (${esc(p.arm ?? "")} vs ${esc(p.vs ?? "")}${p.expect ? `, expects ${esc(p.expect)}` : ""})`).join("; ")}. Every other measure here is exploratory: a lead, not a finding.</p>` : ""}
      <div class="chart" id="wbchart"></div>
      ${legend(lines)}
      <h4>At the end <span class="dim">(last day; table view of the chart)</span></h4>
      <table class="wb-table"><thead><tr><th>${byArm ? "arm" : "run"}</th><th>value</th>${byArm ? "<th>least</th><th>most</th><th>95% interval of the mean</th>" : ""}</tr></thead><tbody>
      ${lines.map((l) => { const d = l.values.length - 1; return `<tr><td><i class="sw" style="background:${l.color}"></i>${esc(l.label)}</td><td>${fmt(l.values[d], def.unit)}</td>${byArm ? `<td>${fmt(l.lo?.[d], def.unit)}</td><td>${fmt(l.hi?.[d], def.unit)}</td><td>${l.ciLo?.[d] !== null && l.ciLo?.[d] !== undefined ? `${fmt(l.ciLo[d], def.unit)} to ${fmt(l.ciHi![d], def.unit)}` : "—"}</td>` : ""}</tr>`; }).join("")}
      </tbody></table>`;
    lineChart(el.querySelector("#wbchart")!, lines, def.unit);
    el.querySelector<HTMLSelectElement>("#wbm")!.addEventListener("change", (e) => { this.measure = (e.target as HTMLSelectElement).value; void this.body(); });
    el.querySelector<HTMLInputElement>("#wbarm")?.addEventListener("change", (e) => { this.byArm = (e.target as HTMLInputElement).checked; void this.body(); });
  }

  // ---------------------------------------------------------------- compare two runs

  private async compare(el: HTMLElement) {
    // (first the same seed's other arm: the matched comparison; then the rest)
    const me = this.runs.find((r) => r.key === this.o.key)?.group;
    const rank = (k: string) => { const g = this.runs.find((r) => r.key === k)?.group; return g && me && g.seed === me.seed && g.arm !== me.arm ? 0 : g && me && g.experiment === me.experiment ? 1 : 2; };
    const others = [...this.chosen].filter((k) => k !== this.o.key).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const b = others[0];
    if (!b) { el.innerHTML = `<p class="dim">Tick a second run on the left to compare it with the run on the map (<b>${esc(this.o.key)}</b>).</p>`; return; }
    const ss = await this.series([this.o.key, b]);
    const A = ss.get(this.o.key)!, B = ss.get(b)!;
    const end = (s: Series, n: string) => { const v = s.series[n] ?? []; return v[v.length - 1] ?? null; };
    const rows = A.defs.map((d) => { const a = end(A, d.name), x = end(B, d.name); return { d, a, b: x, diff: a !== null && x !== null ? x - a : null }; });
    const differs = rows.filter((r) => r.diff !== null && Math.abs(r.diff) > 1e-9);
    el.innerHTML = `
      <div class="wb-row"><b>${esc(this.o.key)}</b> <span class="dim">(on the map)</span> against <select id="wbb">${others.map((k) => `<option ${k === b ? "selected" : ""}>${esc(k)}</option>`).join("")}</select>
        <button class="btn" id="wbmap">Show the difference on the map</button> ${this.exportLinks("measures", { runs: `${this.o.key},${b}` })}</div>
      <p class="dim small">Each measure at the end of each run's log, and the second minus the first. ${differs.length} of ${rows.length} differ. On the map: per building, the consequential changes reaching the people who live there, the second run's count minus the first's, to the moment shown; the second run's daily pulse is drawn over the timeline.</p>
      <table class="wb-table"><thead><tr><th>measure</th><th></th><th>${esc(this.o.key)}</th><th>${esc(b)}</th><th>difference</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="${r.diff !== null && Math.abs(r.diff) > 1e-9 ? "diff" : ""}"><td title="${esc(r.d.what)}">${esc(r.d.name)}</td><td>${this.regTag(r.d.name)}</td><td>${fmt(r.a, r.d.unit)}</td><td>${fmt(r.b, r.d.unit)}</td><td>${r.diff === null ? "—" : `${r.diff > 0 ? "+" : ""}${fmt(r.diff, r.d.unit === "share" ? "share" : r.d.unit)}`}</td></tr>`).join("")}
      </tbody></table>`;
    el.querySelector<HTMLSelectElement>("#wbb")!.addEventListener("change", (e) => { const v = (e.target as HTMLSelectElement).value; this.chosen.delete(b); this.chosen.add(v); void this.body(); });
    el.querySelector<HTMLElement>("#wbmap")!.addEventListener("click", async () => {
      const t = this.o.ctx().t, d = Math.floor(t / DAY);
      const [ca, cb, wb] = await Promise.all([getJson<number[][]>(`api/r/${encodeURIComponent(this.o.key)}/decided?from=0&to=${d}`), getJson<number[][]>(`api/r/${encodeURIComponent(b)}/decided?from=0&to=${d}`), getJson<WorldData>(`api/r/${encodeURIComponent(b)}/world`)]);
      if (wb.world.structures.length !== this.o.data.world.structures.length) { alert("The two runs are not the same town (their buildings differ): the map cannot set them side by side."); return; }
      // (all but the people's own acts, as the who-decided overlay counts)
      const notOwn = (x?: number[]) => (x ?? []).slice(1).reduce((a, v) => a + v, 0);
      const diff = ca.map((x, i) => notOwn(cb[i]) - notOwn(x));
      const max = Math.max(1, ...diff.map(Math.abs));
      const pulse = Array.from({ length: wb.meta.days + 1 }, (_, i) => (["person", "system", "seat", "world"] as Cls[]).reduce((s, c) => s + (wb.townPulse.byClass[c]?.[i] ?? 0), 0));
      this.o.onCompare(diff.map((x) => x / max), `${b} minus ${this.o.key}: consequential changes reaching the people who live in each building, to day ${d}`, pulse);
    });
  }

  // ---------------------------------------------------------------- events

  private async events(el: HTMLElement) {
    const run = this.o.key;
    const q = new URLSearchParams({ ...this.evq, offset: String(this.evOffset), limit: "100" });
    const r = await getJson(`api/r/${encodeURIComponent(run)}/events?${q}`);
    const orgs = this.o.data.world.orgs;
    el.innerHTML = `
      <div class="wb-filters">
        <select data-f="kind"><option value="">every kind</option>${r.kinds.map(([k, n]: [string, number]) => `<option value="${esc(k)}" ${this.evq.kind === k ? "selected" : ""}>${esc(k)} (${n.toLocaleString()})</option>`).join("")}</select>
        <select data-f="cls"><option value="">anyone deciding</option>${(["self", "person", "system", "seat", "world"] as Cls[]).map((c) => `<option value="${c}" ${this.evq.cls === c ? "selected" : ""}>${esc(CLASS_SHORT[c])}</option>`).join("")}</select>
        <select data-f="office"><option value="">any office</option>${orgs.filter((o) => this.o.data.world.posts.some((p) => p.entity === o.id)).map((o) => `<option value="${esc(o.id)}" ${this.evq.office === o.id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>
        <select data-f="outcome"><option value="">any outcome</option>${["applied", "refused", "pending", "none"].map((x) => `<option ${this.evq.outcome === x ? "selected" : ""}>${x}</option>`).join("")}</select>
        <input data-f="who" placeholder="who (participant or person)" value="${esc(this.evq.who ?? "")}">
        <input data-f="about" placeholder="about (a person, office, record)" value="${esc(this.evq.about ?? "")}">
        <input data-f="from" type="number" min="0" placeholder="from day" value="${esc(this.evq.from ?? "")}"><input data-f="to" type="number" min="0" placeholder="to day" value="${esc(this.evq.to ?? "")}">
        <input data-f="q" placeholder="words in the line" value="${esc(this.evq.q ?? "")}">
        <select data-f="order"><option value="desc" ${this.evq.order === "desc" ? "selected" : ""}>newest first</option><option value="asc" ${this.evq.order !== "desc" ? "selected" : ""}>oldest first</option></select>
      </div>
      <div class="wb-row"><b>${r.total.toLocaleString()}</b>${r.exact ? "" : "+"} lines <span class="dim">${r.exact ? "" : "(the word search stopped after reading 400,000 lines; narrow it by day or kind)"}</span>
        <span class="wb-cls">${(["self", "person", "system", "seat", "world"] as Cls[]).map((c) => `<span><i style="background:${CLASS_COLOR[c]}"></i>${esc(CLASS_SHORT[c])} ${(r.classes[c] ?? 0).toLocaleString()}</span>`).join("")}</span>
        ${this.exportLinks("events", { run, ...this.evq })}</div>
      <table class="wb-table events"><thead><tr><th>when</th><th>kind</th><th>who</th><th></th><th>outcome</th><th>what</th></tr></thead><tbody>
      ${r.rows.map((x: any) => `<tr data-ord="${x.ord}"><td class="when"><a data-time="${x.t}" title="go there on the map">${esc(stampOf(x.t))}</a></td><td class="mono">${esc(x.kind)}</td><td class="mono">${esc(x.who ?? "the world")}</td><td><i class="cdot" style="background:${CLASS_COLOR[x.cls as Cls] ?? "#888"}" title="${esc(x.cls)}"></i></td><td>${x.outcome ? `<span class="${x.outcome === "refused" ? "hardtag" : "dim"}">${esc(x.outcome)}</span>` : ""}</td><td class="txt">${esc(x.text)}</td></tr>`).join("")}
      </tbody></table>
      <div class="wb-row"><button class="btn" id="prev" ${this.evOffset ? "" : "disabled"}>← previous 100</button><span class="dim">${(this.evOffset + 1).toLocaleString()}–${(this.evOffset + r.rows.length).toLocaleString()}</span><button class="btn" id="next" ${this.evOffset + 100 < r.total ? "" : "disabled"}>next 100 →</button><span class="dim small">Click a row for its causal trace; a time to go there on the map.</span></div>`;
    for (const f of el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-f]")) f.addEventListener("change", () => { const v = f.value.trim(); if (v) this.evq[f.dataset.f!] = v; else delete this.evq[f.dataset.f!]; this.evOffset = 0; void this.body(); });
    el.querySelector("#prev")?.addEventListener("click", () => { this.evOffset = Math.max(0, this.evOffset - 100); void this.body(); });
    el.querySelector("#next")?.addEventListener("click", () => { this.evOffset += 100; void this.body(); });
    for (const tr of el.querySelectorAll<HTMLElement>("tr[data-ord]")) tr.addEventListener("click", async (e) => {
      if ((e.target as HTMLElement).closest("a")) return;
      const next = tr.nextElementSibling;
      if (next?.classList.contains("wb-trace")) { next.remove(); return; }
      const t = await getJson(`api/r/${encodeURIComponent(run)}/trace/${tr.dataset.ord}`);
      const row = document.createElement("tr"); row.className = "wb-trace";
      row.innerHTML = `<td colspan="6">${traceHtml(this.o.ctx(), t.links)}</td>`;
      tr.after(row);
    });
  }

  // ---------------------------------------------------------------- cohorts

  private cq: Record<string, string> = { rule: "reached", hard: "1", word: "" };
  private async cohorts(el: HTMLElement) {
    const run = this.o.key;
    const q = new URLSearchParams(Object.entries(this.cq).filter(([, v]) => v !== ""));
    q.set("limit", "200");
    const r = await getJson(`api/r/${encodeURIComponent(run)}/cohort?${q}`);
    const rule = this.cq.rule;
    el.innerHTML = `
      <div class="wb-filters">
        <select data-c="rule"><option value="reached" ${rule === "reached" ? "selected" : ""}>reached by a change</option><option value="agency" ${rule === "agency" ? "selected" : ""}>sense of agency below</option><option value="money" ${rule === "money" ? "selected" : ""}>money held at most</option></select>
        ${rule === "reached" ? `<select data-c="cls"><option value="">decided by anyone but themselves</option>${(["person", "system", "seat", "world"] as Cls[]).map((c) => `<option value="${c}" ${this.cq.cls === c ? "selected" : ""}>decided by: ${esc(CLASS_SHORT[c])}</option>`).join("")}</select>
          <label><input type="checkbox" data-c="hard" ${this.cq.hard === "1" ? "checked" : ""}> landed hard</label>
          <input data-c="word" placeholder="kind or word: refused, benefit, arrears" value="${esc(this.cq.word ?? "")}">
          <input data-c="from" type="number" min="0" placeholder="from day" value="${esc(this.cq.from ?? "")}"><input data-c="to" type="number" min="0" placeholder="to day" value="${esc(this.cq.to ?? "")}">`
        : rule === "agency" ? `<input data-c="bps" type="number" placeholder="bps, 0–10,000" value="${esc(this.cq.bps ?? "3000")}"> on day <input data-c="day" type="number" min="0" value="${esc(this.cq.day ?? "0")}">`
        : `<input data-c="minor" type="number" placeholder="smallest units" value="${esc(this.cq.minor ?? "0")}"> on day <input data-c="day" type="number" min="0" value="${esc(this.cq.day ?? "0")}">`}
        ${this.exportLinks("cohort", { run, ...Object.fromEntries(Object.entries(this.cq).filter(([, v]) => v !== "")) })}
      </div>
      <p><b>${r.members.toLocaleString()}</b> people in the group; <b>${r.rest.toLocaleString()}</b> in the comparison group (everyone else). <span class="dim small">A member counts in the group from the day they joined it (their first matching change), with everyone else before that. Outcomes are as the run's tracks hold them: their own record's sense of agency, the money in their accounts each midnight, whether they were in a dwelling at midnight, and hard changes reaching them. A comparison, not a cause.</span></p>
      <div class="wb-grid">${[["agency_mean_bps", "sense of agency, mean (bps)"], ["money_mean_minor", "money held, mean (smallest units)"], ["at_home_share", "at home at midnight (share)"], ["hard_per_100", "hard changes, per 100 people a day"]].map(([k, l]) => `<div><h4>${esc(l!)}</h4><div class="chart small" data-k="${k}"></div></div>`).join("")}</div>
      ${legend([{ label: "the group", color: SERIES[1]!, values: [] }, { label: "everyone else", color: SERIES[0]!, values: [] }])}
      <h4>Who is in it <span class="dim">(the first ${r.page.length}; when they joined, and the change that put them there)</span></h4>
      <div class="chips">${r.page.map((m: any) => `<a data-go="person:${esc(m.person)}" title="${esc(stampOf(m.t))}">${esc(m.person)}</a>`).join("")}</div>`;
    for (const c of el.querySelectorAll<HTMLElement>("[data-k]")) {
      const k = c.dataset.k!;
      lineChart(c, [{ label: "the group", color: SERIES[1]!, values: r.cohort[k] }, { label: "everyone else", color: SERIES[0]!, values: r.comparison[k] }], k === "at_home_share" ? "share" : "count");
    }
    for (const f of el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-c]")) f.addEventListener("change", () => {
      const k = f.dataset.c!;
      const v = f instanceof HTMLInputElement && f.type === "checkbox" ? (f.checked ? "1" : "") : f.value.trim();
      if (v) this.cq[k] = v; else delete this.cq[k];
      void this.body();
    });
  }
}

// ---------------------------------------------------------------- charts (SVG; hover: a crosshair and the day's values)

interface Line { label: string; color: string; values: (number | null)[]; lo?: (number | null)[]; hi?: (number | null)[]; ciLo?: (number | null)[]; ciHi?: (number | null)[] }

function spread(xs: (number | null)[][]) {
  const len = Math.max(0, ...xs.map((x) => x.length));
  const T = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228];
  const o = { mean: [] as (number | null)[], lo: [] as (number | null)[], hi: [] as (number | null)[], ciLo: [] as (number | null)[], ciHi: [] as (number | null)[] };
  for (let d = 0; d < len; d++) {
    const v = xs.map((x) => x[d]).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    if (!v.length) { o.mean.push(null); o.lo.push(null); o.hi.push(null); o.ciLo.push(null); o.ciHi.push(null); continue; }
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    o.mean.push(m); o.lo.push(Math.min(...v)); o.hi.push(Math.max(...v));
    if (v.length < 2) { o.ciLo.push(null); o.ciHi.push(null); continue; }
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)), h = (T[v.length - 2] ?? 1.96) * sd / Math.sqrt(v.length);
    o.ciLo.push(m - h); o.ciHi.push(m + h);
  }
  return o;
}

function legend(lines: Line[]) {
  return `<div class="wb-legend">${lines.map((l) => `<span><i style="background:${l.color}"></i>${esc(l.label)}</span>`).join("")}</div>`;
}

function lineChart(host: HTMLElement, lines: Line[], unit: string) {
  const W = Math.max(320, host.clientWidth || 720), H = host.classList.contains("small") ? 150 : 260, L = 56, R = 12, T = 10, B = 24;
  const len = Math.max(1, ...lines.map((l) => l.values.length));
  const all = lines.flatMap((l) => [...l.values, ...(l.lo ?? []), ...(l.hi ?? [])]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  let lo = Math.min(0, ...all), hi = Math.max(...all, lo + 1e-9);
  if (unit === "share") { lo = 0; hi = Math.max(hi, 0.0001); }
  const X = (d: number) => L + (d / Math.max(1, len - 1)) * (W - L - R), Y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const path = (vs: (number | null)[]) => { let s = "", pen = false; vs.forEach((v, d) => { if (v === null || !Number.isFinite(v)) { pen = false; return; } s += `${pen ? "L" : "M"}${X(d).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; }); return s; };
  const band = (a: (number | null)[], b: (number | null)[]) => { const pts: string[] = []; a.forEach((v, d) => { if (v !== null && b[d] !== null) pts.push(`${X(d).toFixed(1)},${Y(v).toFixed(1)}`); }); for (let d = b.length - 1; d >= 0; d--) if (b[d] !== null && a[d] !== null) pts.push(`${X(d).toFixed(1)},${Y(b[d]!).toFixed(1)}`); return pts.length > 2 ? `M${pts.join("L")}Z` : ""; };
  const ticks = [lo, (lo + hi) / 2, hi];
  const lab = (v: number) => fmt(v, unit);
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(lines.map((l) => l.label).join(", "))}">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 6}" y="${Y(v) + 3}" class="ax" text-anchor="end">${esc(lab(v))}</text>`).join("")}
    ${[0, Math.floor((len - 1) / 2), len - 1].map((d) => `<text x="${X(d)}" y="${H - 6}" class="ax" text-anchor="middle">day ${d}</text>`).join("")}
    ${lines.map((l) => `${l.lo && l.hi ? `<path d="${band(l.lo, l.hi)}" fill="${l.color}" opacity="0.12"/>` : ""}${l.ciLo && l.ciHi ? `<path d="${band(l.ciLo, l.ciHi)}" fill="${l.color}" opacity="0.22"/>` : ""}<path d="${path(l.values)}" fill="none" stroke="${l.color}" stroke-width="2" stroke-linejoin="round"/>`).join("")}
    <line class="xh" y1="${T}" y2="${H - B}" x1="-10" x2="-10"/>
  </svg><div class="tl-tip wb-tip"></div>`;
  const svg = host.querySelector("svg")!, xh = host.querySelector<SVGLineElement>(".xh")!, tip = host.querySelector<HTMLElement>(".wb-tip")!;
  host.style.position = "relative";
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W;
    const d = Math.max(0, Math.min(len - 1, Math.round(((x - L) / (W - L - R)) * (len - 1))));
    xh.setAttribute("x1", String(X(d))); xh.setAttribute("x2", String(X(d)));
    tip.innerHTML = `<b>day ${d}</b><br>${lines.map((l) => `<span><i class="sw" style="background:${l.color}"></i>${esc(l.label)}: ${lab(l.values[d] as number)}${l.ciLo?.[d] !== null && l.ciLo?.[d] !== undefined ? ` <span class="dim">(${lab(l.ciLo[d]!)} to ${lab(l.ciHi![d]!)})</span>` : ""}</span>`).join("<br>")}`;
    tip.style.display = "block"; tip.style.left = `${Math.min(r.width - 280, Math.max(0, (X(d) / W) * r.width + 12))}px`; tip.style.bottom = "auto"; tip.style.top = "8px";
  });
  svg.addEventListener("pointerleave", () => { tip.style.display = "none"; xh.setAttribute("x1", "-10"); xh.setAttribute("x2", "-10"); });
}
