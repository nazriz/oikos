// The inspector: what a click opens. Plain DOM from strings; links carry data-go ("person:c0123", "org:bank",
// "building:12", "act:345", "seat:mayor-system") and data-trace (a line's causal trace, opened in place).

import { CLASSES, CLASS_COLOR, CLASS_LABEL, CLASS_SHORT, DAY, HARD_COLOR, esc, money, stampOf, type Cls, type WorldData } from "./api";

export interface Ctx { data: WorldData; t: number; seatColor: Map<string, string>; nameOf: (id: string) => string; structName: (i: number) => string }

const badge = (cls: Cls | undefined, label?: string) => cls ? `<span class="badge" style="--c:${CLASS_COLOR[cls]}">${esc(label ?? CLASS_SHORT[cls])}</span>` : "";
const link = (kind: string, id: string | number, text: string) => `<a class="go" data-go="${kind}:${esc(id)}">${esc(text)}</a>`;
export const who = (ctx: Ctx, id: string | undefined) => {
  if (!id) return "the world";
  if (/-self$/.test(id) || ctx.data.persons.includes(id)) { const p = id.replace(/-self$/, ""); return link("person", p, p); }
  if (ctx.data.meta.seats.includes(id)) return link("seat", id, id);
  const org = ctx.data.world.orgs.find((o) => o.id === id);
  if (org) return link("org", id, org.name);
  const post = ctx.data.world.posts.find((p) => p.holder === id || p.id === id);
  if (post?.entity) return `${esc(id)} (${link("org", post.entity, ctx.nameOf(post.entity))})`;
  return esc(id);
};

/** A small line chart as SVG, with the moment shown marked. */
export function spark(values: number[], t: number, fmt: (v: number) => string, color = "#7fd3ff", missing = (v: number) => false): string {
  const pts = values.map((v, i) => [i, v] as const).filter(([, v]) => !missing(v));
  if (pts.length < 2) return `<div class="dim">not on record</div>`;
  const W = 340, H = 64, xs = values.length - 1 || 1;
  let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
  if (hi === lo) { hi += 1; lo -= 1; }
  const X = (i: number) => (i / xs) * W, Y = (v: number) => H - 6 - ((v - lo) / (hi - lo)) * (H - 14);
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const day = Math.min(values.length - 1, Math.floor(t / DAY));
  const now = values[day];
  return `<div class="spark"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/><path d="${d}L${X(pts.at(-1)![0])},${H}L${X(pts[0]![0])},${H}Z" fill="${color}" opacity="0.10"/><line x1="${X(day)}" x2="${X(day)}" y1="0" y2="${H}" stroke="#fff" stroke-opacity="0.55" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/></svg><div class="spark-now">${now === undefined || missing(now) ? "—" : esc(fmt(now))}<span class="dim"> at day ${day}</span> · <span class="dim">from ${esc(fmt(lo))} to ${esc(fmt(hi))}</span></div></div>`;
}

function classBar(counts: Record<string, number>): string {
  const total = CLASSES.reduce((s, c) => s + (counts[c] ?? 0), 0);
  if (!total) return `<div class="dim">nothing on record yet</div>`;
  return `<div class="cbar">${CLASSES.filter((c) => counts[c]).map((c) => `<span style="flex:${counts[c]};background:${CLASS_COLOR[c]}" title="${CLASS_LABEL[c]}: ${counts[c]}"></span>`).join("")}</div><div class="cleg">${CLASSES.filter((c) => counts[c]).map((c) => `<span><i style="background:${CLASS_COLOR[c]}"></i>${esc(CLASS_SHORT[c])} ${counts[c]}</span>`).join("")}</div>`;
}

export function rows(ctx: Ctx, list: any[], about?: string, max = 400): string {
  const seatOrds = new Set(ctx.data.seatActs.map((a) => a.ord));
  return `<div class="rows">${list.slice(0, max).map((r) => `<div class="row${r.t > ctx.t ? " future" : ""}${r.hard ? " hard" : ""}" data-trace="${r.ord}" data-at="${r.t}"${about ? ` data-about="${esc(about)}"` : ""}>
    <span class="when">${esc(stampOf(r.t))}</span><span class="cdot" style="background:${CLASS_COLOR[r.cls as Cls] ?? "#888"}" title="${esc(CLASS_LABEL[r.cls as Cls] ?? "")}"></span>
    <span class="txt">${r.own ? '<span class="own">own</span> ' : ""}${r.hard ? `<span class="hardtag">hard</span> ` : ""}${esc(r.text)}${seatOrds.has(r.ord) ? ` ${link("act", r.ord, "open the act")}` : ""}</span></div>`).join("")}${list.length > max ? `<div class="dim">… ${list.length - max} more</div>` : ""}</div>`;
}

export function traceHtml(ctx: Ctx, links: any[]): string {
  const seatOrds = new Set(ctx.data.seatActs.map((a) => a.ord));
  const roleWord: Record<string, string> = { change: "what changed", act: "who decided", instruction: "the standing instruction", basis: "what it rested on", genesis: "before the run", world: "no one's act", stop: "" };
  return `<div class="trace">${links.map((l) => `<div class="link role-${l.role}" style="--d:${Math.min(l.depth, 8)}">
    <div class="lhead"><span class="role">${esc(roleWord[l.role] ?? l.role)}</span>${l.t !== undefined ? `<span class="when">${esc(stampOf(l.t))}</span>` : ""}${badge(l.cls)}${l.model ? `<span class="model">${esc(l.model)}</span>` : ""}${l.status && l.status !== "applied" ? `<span class="hardtag">${esc(l.status)}</span>` : ""}</div>
    <div class="ltext">${l.who ? `${who(ctx, l.who)}${l.as ? ` <span class="dim">as ${esc(l.as)}</span>` : ""}: ` : ""}${esc(l.role === "act" && l.who ? l.text.replace(/^[^:]+:\s*/, "") : l.text)}</div>
    ${l.by?.length ? `<div class="dim">the work done by ${l.by.map((b: string) => esc(b)).join(", ")}</div>` : ""}
    ${l.why ? `<div class="why why-${l.why.kind}"><span>why</span> ${esc(l.why.text)}${l.why.kind === "seat" && seatOrds.has(l.ord) ? ` ${link("act", l.ord, "see its words, draft and twin")}` : ""}</div>` : ""}
  </div>`).join("")}</div>`;
}

export function personHtml(ctx: Ctx, p: any): string {
  const cur = ctx.data.world.currency;
  const hh = p.household;
  return `<header class="ph"><div class="kicker">Person${p.seat ? ` · <span style="color:${ctx.seatColor.get(p.seat)}">seat ${esc(p.seat)}</span>` : ""}</div><h2>${esc(p.id)}</h2>
  <div class="sub">${p.age !== undefined ? `${p.age} years` : ""}${p.sex ? ` · ${esc(p.sex)}` : ""}${hh ? ` · household of ${hh.members.length}` : ""}${p.gone ? ` · <b class="hardtxt">${p.gone.what === "person_died" ? "died" : "left town"} ${esc(stampOf(p.gone.t))}</b>` : ""}</div></header>
  <div class="facts">
    <div><span>now</span>${p.now ? `${link("building", p.now.struct, p.now.structure)} <span class="dim">${esc(p.now.space.split("/")[1] ?? "")}</span>` : `<span class="dim">in no building</span>`}</div>
    <div><span>home</span>${p.home ? link("building", p.home.struct, p.home.structure) : '<span class="dim">none on record</span>'}</div>
    <div><span>work</span>${p.job ? `${who(ctx, p.job.employer)} at ${link("building", p.job.struct, p.job.structure)}` : '<span class="dim">no job at the start</span>'}</div>
    ${hh ? `<div><span>household</span>${hh.members.map((m: string) => m === p.id ? `<b>${esc(m)}</b>` : link("person", m, m)).join(" ")}</div>` : ""}
  </div>
  <section><h3>Money held <span class="dim">(their accounts, each midnight)</span></h3>${spark(p.money, ctx.t, (v) => money(v, cur), "#7fd3ff")}</section>
  <section><h3>Sense of agency <span class="dim">(their own record, 0–10,000)</span></h3>${spark(p.agency, ctx.t, (v) => String(v), "#c49bff", (v) => v < 0)}</section>
  <section><h3>Who decided what reached them <span class="dim">(to this moment, their own acts apart)</span></h3>${classBar(p.byClass)}</section>
  <section><h3>Their life in the log <span class="dim">${p.events.length} entries${p.routine ? `, besides ${p.routine} comings, goings and work of their own` : ""}; click one for why</span></h3>${lifeStrip(ctx, p.events)}${rows(ctx, [...p.events].reverse(), p.id)}</section>
  <section><h3>Their own record at this moment <span class="dim">(${p.record.changes} changes so far)</span></h3>${recordHtml(p.record.sections)}</section>`;
}

function lifeStrip(ctx: Ctx, events: any[]): string {
  const end = Math.max(ctx.data.meta.lastT, 1), W = 340;
  const day = (t: number) => (t / end) * W;
  return `<svg class="strip" viewBox="0 0 ${W} 22" preserveAspectRatio="none">${events.filter((e) => !e.own).map((e) => `<rect x="${day(e.t).toFixed(1)}" y="${e.hard ? 2 : 6}" width="1.4" height="${e.hard ? 18 : 12}" fill="${e.hard ? HARD_COLOR : CLASS_COLOR[e.cls as Cls]}"/>`).join("")}<line x1="${day(ctx.t)}" x2="${day(ctx.t)}" y1="0" y2="22" stroke="#fff" stroke-dasharray="2 2"/></svg>`;
}

function recordHtml(sec: any): string {
  if (!sec || !Object.keys(sec).length) return `<div class="dim">no record changes by this moment</div>`;
  const parts: string[] = [];
  if (sec.circumstances) parts.push(`<div class="kv">${Object.entries(sec.circumstances).map(([k, v]) => `<span><b>${esc(k)}</b> ${esc(v)}</span>`).join("")}</div>`);
  if (sec.agency) parts.push(`<div class="kv"><span><b>agency now</b> ${esc(sec.agency.now)}</span><span><b>own</b> ${esc(sec.agency.own)}</span></div>`);
  if (sec.trust) parts.push(`<div class="kv"><span><b>trust in people</b> ${esc(sec.trust.people)}</span>${(sec.trust.in ?? []).slice(0, 8).map((x: any) => `<span><b>${esc(x.who ?? x.in ?? x.id ?? "?")}</b> ${esc(x.bps ?? x.level ?? "")}</span>`).join("")}</div>`);
  if (sec.wants?.length) parts.push(`<div class="kv">${sec.wants.slice(0, 6).map((w: any) => `<span><b>wants</b> ${esc(w.what ?? w.kind ?? JSON.stringify(w).slice(0, 80))}</span>`).join("")}</div>`);
  if (sec.values) parts.push(`<details><summary>values</summary><div class="kv">${Object.entries(sec.values).map(([k, v]) => `<span><b>${esc(k)}</b> ${esc(v)}</span>`).join("")}</div></details>`);
  parts.push(`<details><summary>the whole record</summary><pre>${esc(JSON.stringify(sec, null, 1).slice(0, 6000))}</pre></details>`);
  return parts.join("");
}

function weeksChart(by: Record<string, number[]>): string {
  const weeks = (by.self ?? []).length;
  const tot = Array.from({ length: weeks }, (_, w) => CLASSES.reduce((s, c) => s + (by[c]?.[w] ?? 0), 0));
  const max = Math.max(1, ...tot), W = 340, H = 70, bw = W / Math.max(1, weeks);
  let out = "";
  for (let w = 0; w < weeks; w++) { let y = H; for (const c of CLASSES) { const v = by[c]?.[w] ?? 0; if (!v) continue; const h = (v / max) * (H - 4); out += `<rect x="${(w * bw + 1).toFixed(1)}" y="${(y - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${CLASS_COLOR[c]}"/>`; y -= h; } }
  return `<svg class="weeks" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${out}</svg>`;
}

export function orgHtml(ctx: Ctx, o: any): string {
  const cur = ctx.data.world.currency;
  const here = o.staff.filter((s: any) => s.here).length;
  const totals: Record<string, number> = {};
  for (const c of CLASSES) totals[c] = (o.actsByWeek[c] ?? []).reduce((a: number, b: number) => a + b, 0);
  return `<header class="ph"><div class="kicker">${esc(o.kind.replace(/_/g, " "))}${o.seat ? ` · <span style="color:${ctx.seatColor.get(o.seat.participant) ?? CLASS_COLOR.seat}">a model in office</span>` : ""}</div><h2>${esc(o.name)}</h2><div class="sub mono">${esc(o.id)}</div></header>
  <div class="facts">
    <div><span>premises</span>${o.premises.length ? o.premises.slice(0, 6).map((p: any) => link("building", p.struct, p.structure)).join(" ") : '<span class="dim">outside the town</span>'}</div>
    <div><span>staff</span>${o.staff.length ? `<span>${o.staff.length} on its books at the start; <b>${here}</b> at its premises now</span>` : '<span class="dim">none employed in town</span>'}</div>
  </div>
  ${o.posts.length ? `<section><h3>Posts and who holds them</h3><div class="posts">${o.posts.map((p: any) => `<div class="post"><div><b>${esc(p.title ?? p.id)}</b> <span class="dim mono">${esc(p.id)}</span></div><div>${badge(p.cls, p.cls === "seat" ? "model seat" : undefined)} ${p.cls === "seat" ? link("seat", p.holder, p.holder) : who(ctx, p.holder)}${p.model ? ` <span class="model">${esc(p.model)}</span>` : ""}</div></div>`).join("")}</div></section>` : ""}
  <section><h3>Acts in its posts, by week <span class="dim">(${o.acts} in all; by who decided)</span></h3>${weeksChart(o.actsByWeek)}${classBar(totals)}</section>
  <section><h3>Backlog now <span class="dim">(papers to it that nothing since cites)</span></h3>
    <div class="big">${o.backlog.open}<span class="dim"> open of the last ${o.backlog.of} addressed to it</span></div>
    <div class="kv">${Object.entries(o.backlog.kinds).sort((a: any, b: any) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `<span><b>${esc(k)}</b> ${esc(v)}</span>`).join("")}</div>
    ${o.backlog.oldest.length ? `<div class="rows">${o.backlog.oldest.slice(0, 12).map((b: any) => `<div class="row" data-trace="${b.ord}"><span class="when">${b.age} days</span><span class="cdot" style="background:#999"></span><span class="txt">${esc(b.kind)} from ${esc(b.from)}: ${esc(b.text)}</span></div>`).join("")}</div>` : ""}
  </section>
  <section><h3>What it decided <span class="dim">(latest; click for why)</span></h3>${o.decisions.length ? rows(ctx, o.decisions) : '<div class="dim">no decisions on record</div>'}</section>
  ${o.money.length ? `<section><h3>Money held</h3>${spark(o.money, ctx.t, (v) => money(v, cur), "#f2c14e")}</section>` : ""}`;
}

export function buildingHtml(ctx: Ctx, b: any): string {
  return `<header class="ph"><div class="kicker">${esc(b.type)} · ${esc(b.category)}</div><h2>${esc(b.id)}</h2><div class="sub">cell ${b.x}, ${b.y}${b.lot ? ` · lot ${esc(b.lot)}` : ""}${b.owner ? ` · held by ${who(ctx, b.owner)}` : ""}</div></header>
  ${b.usedBy.length ? `<div class="facts"><div><span>used by</span>${b.usedBy.map((o: any) => link("org", o.id, o.name)).join(", ")}</div></div>` : ""}
  <section><h3>Inside now <span class="dim">(${b.inside.length})</span></h3><div class="chips">${b.inside.slice(0, 80).map((x: any) => link("person", x.person, x.person)).join("")}${b.inside.length > 80 ? `<span class="dim">+${b.inside.length - 80}</span>` : ""}</div></section>
  <section><h3>Living here <span class="dim">(slept here last night: ${b.residents.length})</span></h3><div class="chips">${b.residents.slice(0, 60).map((x: string) => link("person", x, x)).join("")}</div></section>
  <section><h3>What reached the people here, last 30 days</h3>${b.recent.length ? rows(ctx, b.recent) : '<div class="dim">nothing consequential</div>'}</section>`;
}

export function actHtml(ctx: Ctx, x: any): string {
  const a = x.act, col = ctx.seatColor.get(a.participant) ?? CLASS_COLOR.seat;
  const r = x.request;
  const sitting = x.sitting;
  const status = a.status === "applied" ? `<span class="ok">applied</span>` : `<span class="hardtag">${esc(a.status)}</span>`;
  const draft = r?.draft;
  return `<header class="ph"><div class="kicker" style="color:${col}">A seat's act · ${esc(x.seat.title ?? x.seat.id)}</div><h2>${esc(a.kinds.join(", "))}</h2>
    <div class="sub">${esc(stampOf(a.t))} · ${status}${x.seat.model ? ` · <span class="model">${esc(x.seat.model)}</span>` : ""}${a.via ? ` · via ${esc(a.via)}` : ""}</div></header>
  ${r ? `<section class="voice"><h3>In its own words</h3><blockquote>${esc(r.words || "(no words recorded)")}</blockquote></section>` : ""}
  ${draft ? `<section><h3>The translator's draft <span class="dim">${esc(r.by === "ours" ? "our model" : r.by === "fallback" ? `the fallback (${r.usedModel})` : r.usedModel)}${r.route?.why ? ` · ${esc(r.route.why)}` : ""}</span></h3><div class="draft"><code>${esc(draft.call)}</code>${draft.summary ? `<p>${esc(draft.summary)}</p>` : ""}</div>
     <div class="signoff ${r.signoff}">${r.signoff === "confirmed" ? "✓ the seat confirmed it" : r.signoff === "declined" ? "✕ the seat declined it" : esc(r.signoff ?? "")}</div></section>` : ""}
  ${a.reasoning ? `<section><h3>Its stated reasoning</h3><blockquote>${esc(a.reasoning)}</blockquote></section>` : ""}
  <section><h3>What it did</h3><div class="ltext">${esc(a.sentence)}</div>
    ${r?.act?.effects?.length ? `<ul class="effects">${r.act.effects.map((e: any) => `<li>${esc(e.text)}</li>`).join("")}</ul>` : ""}
    ${r?.act?.refusal ? `<div class="hardtxt">refused: ${esc(r.act.refusal.code)} ${esc(r.act.refusal.detail)}</div>` : ""}</section>
  <section><h3>Where it landed</h3><div class="chips">${a.targets.length ? a.targets.map((t: any) => t.kind === "person" ? link("person", t.id, t.id) : link("org", t.id, ctx.nameOf(t.id))).join("") : '<span class="dim">no one in town</span>'}</div>
    ${r?.act?.consequences?.length ? `<h4>Later papers that cite it</h4><ul class="effects">${r.act.consequences.map((c: any) => `<li><span class="dim">${esc(stampOf(c.t))}</span> ${esc(c.byName ?? c.by)}: ${esc(c.kind)} ${esc(c.text)}</li>`).join("")}</ul>` : ""}</section>
  <section class="twin"><h3>The code twin <span class="dim">(the same town and seed, code in the seat)</span></h3>${x.twin ? x.twin.act ? `<div class="pair"><div><div class="tlabel" style="color:${col}">seat</div><div>${esc(a.kinds.join(", "))}</div></div><div><div class="tlabel">twin, ${esc(x.twin.act.stamp)}</div><div>${esc((x.twin.act.blocks ?? []).map((b: any) => `${b.block}${b.kind ? ":" + b.kind : ""}${b.text ? ` “${b.text}”` : ""}`).join("; "))}</div><div class="dim mono">${esc(x.twin.act.signature)}</div>${x.twin.act.reasoning ? `<div class="why why-reason"><span>why</span> ${esc(x.twin.act.reasoning)}</div>` : ""}</div></div><div class="${x.twin.same ? "ok" : "hardtxt"}">${x.twin.same ? "the same decision" : "a different decision"}</div>` : `<div class="dim">${esc(x.twin.note ?? "no matching act")}</div>` : '<div class="dim">no twin found for this run</div>'}</section>
  <section><h3>What it rested on</h3>${traceHtml(ctx, x.trace)}</section>
  ${sitting ? `<section><h3>The sitting <span class="dim">${esc(sitting.stamp)} · ${sitting.turns.length} turns${sitting.cost ? ` · $${sitting.cost.toFixed(3)}` : ""}</span></h3>
    ${sitting.turns.map((tu: any) => `<div class="turn"><div class="dim">turn ${tu.turn}</div>${tu.say ? `<p>${esc(tu.say)}</p>` : ""}${tu.tools.length ? `<div class="tools">${tu.tools.map((t: any) => `<code>${esc(t.name)}(${esc(JSON.stringify(t.input).slice(0, 220))})</code>`).join("")}</div>` : ""}</div>`).join("")}
    <details><summary>what it read when it sat (${sitting.readingLen?.toLocaleString?.() ?? "?"} characters)</summary><pre>${esc(sitting.reading)}</pre></details></section>` : ""}`;
}

export function seatHtml(ctx: Ctx, s: any): string {
  const col = ctx.seatColor.get(s.id) ?? CLASS_COLOR.seat;
  const acts = ctx.data.seatActs.filter((a) => a.participant === s.id);
  return `<header class="ph"><div class="kicker" style="color:${col}">A model seat</div><h2>${esc(s.title ?? s.id)}</h2><div class="sub"><span class="model">${esc(s.model ?? "")}</span>${s.framing ? ` · framing ${esc(s.framing)}` : ""}</div></header>
  <div class="stats"><div><b>${s.calls ?? 0}</b><span>calls</span></div><div><b>${(s.sittings ?? []).length}</b><span>sittings</span></div><div><b>${acts.length}</b><span>acts</span></div><div><b>${s.confirmed ?? 0}/${s.requests ?? 0}</b><span>drafts confirmed</span></div><div><b>$${(s.cost ?? 0).toFixed(2)}</b><span>cost</span></div></div>
  <section><h3>Its acts <span class="dim">(click one)</span></h3><div class="rows">${acts.map((a) => `<div class="row" data-go="act:${a.ord}"><span class="when">${esc(stampOf(a.t))}</span><span class="cdot" style="background:${a.status === "applied" ? col : "transparent"};border:1px solid ${col}"></span><span class="txt"><b>${esc(a.kinds.join(", "))}</b> ${esc(a.text)}</span></div>`).join("") || '<div class="dim">none</div>'}</div></section>
  ${s.notebook?.final ? `<section><h3>Its notebook at the end</h3><pre>${esc(s.notebook.final)}</pre></section>` : ""}
  <section><h3>Sittings</h3><div class="rows">${(s.sittings ?? []).map((x: any) => `<div class="row" data-time="${x.t}"><span class="when">${esc(x.stamp)}</span><span class="cdot" style="background:${col}"></span><span class="txt">${x.calls} calls · ${x.requests} requests${x.say ? ` · <i>${esc(x.say.slice(0, 160))}</i>` : ""}</span></div>`).join("")}</div></section>`;
}
