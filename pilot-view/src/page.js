// The pilot viewer's page: draws the data embedded in it (see build.ts). It only reads that data; nothing leaves the page.
(() => {
"use strict";
const D = JSON.parse(document.getElementById("data").textContent);
const O = D.overview;
const el = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "on") for (const [ev, f] of Object.entries(v)) e.addEventListener(ev, f);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
};
const txt = (cls, s) => el("div", { class: cls }, s);
const n0 = (x) => Number(x).toLocaleString("en-US", { maximumFractionDigits: 0 });
const n1 = (x) => Number(x).toLocaleString("en-US", { maximumFractionDigits: 1 });
const usd = (x) => "$" + Number(x).toFixed(2);
const minorUnits = D.town.minorUnits ?? 2, sym = D.town.unitMoney || "";
const moneyOf = (cents) => { const v = Number(cents) / Math.pow(10, minorUnits); return (v < 0 ? "-" : "") + sym + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: minorUnits ? 2 : 0, maximumFractionDigits: minorUnits ? 2 : 0 }); };
const badge = (t, kind) => el("span", { class: "badge " + (kind || "") }, t);
const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "-");
const empty = (t) => el("div", { class: "empty" }, t);
const dayStamp = (d) => "day " + d;

/** Text cut to `n` characters with a way to open the rest. */
function more(text, n, cls) {
  text = text == null ? "" : String(text);
  if (text.length <= n) return el("div", { class: cls || "text" }, text);
  const box = el("div", { class: cls || "text" }, text.slice(0, n) + " ...");
  const b = el("button", { class: "link", on: { click: () => { box.textContent = text; } } }, "show all");
  const wrap = el("div", null, box, el("div", { class: "small" }, b, " (" + n0(text.length) + " characters)"));
  return wrap;
}
const section = (label, ...kids) => el("div", { class: "section" }, el("div", { class: "label" }, label), ...kids);

// ---------------------------------------------------------------- routing
const views = [["overview", "Overview"], ["seats", "Seats"], ["twin", "Seat vs twin"], ["actors", "Actors"], ["town", "Town"]];
const state = { view: "overview", seat: D.seats[0]?.id, actor: null };
function parseHash() {
  const [v, a, c] = decodeURIComponent(location.hash.slice(1)).split("/");
  if (views.some(([id]) => id === v)) state.view = v;
  state.openDay = null;
  if (a) { if (v === "seats" || v === "twin") state.seat = a; if (v === "actors") state.actor = a; }
  if (c && v === "seats") { state.openDay = Number(c); state.sub = "tl"; }
}
function go(view, arg, day) { location.hash = "#" + view + (arg ? "/" + encodeURIComponent(arg) : "") + (day ? "/" + day : ""); }
const root = document.getElementById("view");
const tabs = document.getElementById("tabs");
function draw() {
  tabs.replaceChildren(...views.filter(([id]) => id !== "twin" || D.twin).map(([id, name]) => el("button", { "aria-current": state.view === id ? "true" : "false", on: { click: () => go(id) } }, name)));
  const f = { overview, seats, twin, actors, town }[state.view];
  root.replaceChildren(f());
}
window.addEventListener("hashchange", () => { parseHash(); draw(); window.scrollTo(0, 0); });

// ---------------------------------------------------------------- overview
function overview() {
  const t = O.translator, root = el("div");
  const ended = el("span", null, O.finished && /stopped at \d+/.test(O.end) ? "Reached its set length" : O.end, " ", O.finished ? badge("finished", "ok") : badge("not finished", "bad"));
  root.append(el("div", { class: "grid" },
    el("div", { class: "card" }, el("h2", null, "The town"), el("dl", { class: "kv" },
      el("dt", null, "Town"), el("dd", null, O.town || "-"), el("dt", null, "Profile"), el("dd", null, O.profile || "-"), el("dt", null, "Seed"), el("dd", null, O.seed ?? "-"),
      el("dt", null, "People"), el("dd", null, O.people ? n0(O.people) : "-"), el("dt", null, "Days run"), el("dd", null, n1(O.days) + (O.untilDays ? " of " + O.untilDays : "")),
      el("dt", null, "Ended"), el("dd", null, ended), el("dt", null, "Framing"), el("dd", null, O.framing.join(", ") || "-"),
      O.wallMinutes ? [el("dt", null, "Took"), el("dd", null, O.wallMinutes + " min (wall clock)")] : null)),
    el("div", { class: "card" }, el("h2", null, "Cost and calls"), el("dl", { class: "kv" },
      el("dt", null, "Recorded"), el("dd", null, usd(O.cost.usd) + (O.cost.limit ? " of " + usd(O.cost.limit) + " limit" : "")), el("dt", null, "Model calls"), el("dd", null, n0(O.cost.calls)),
      el("dt", null, "Translator calls"), el("dd", null, n0(t.calls) + " (" + usd(t.usd) + ")")),
      el("div", { class: "small" }, Object.entries(O.cost.byModel).map(([m, v]) => m + ": " + v.calls + " calls, " + usd(v.usd)).join("  |  "))),
    el("div", { class: "card" }, el("h2", null, "Alerts (" + O.alerts.length + ")"),
      O.alerts.length ? O.alerts.map((a) => el("div", { class: "alert" }, a)) : el("div", { class: "alert none" }, "None recorded."))));
  if (O.note) root.append(el("div", { class: "card" }, el("div", { class: "label" }, "The pilot's note"), el("div", { class: "text" }, O.note)));
  if (O.description) root.append(el("div", { class: "card small" }, O.description));
  // seats
  root.append(el("div", { class: "card" }, el("h2", null, "Seats"), el("div", { class: "grid" }, O.seats.map((s) => el("div", { class: "card" },
    el("button", { class: "link", on: { click: () => go("seats", s.id) } }, s.title || s.id), el("div", { class: "small" }, s.id + " | " + (s.model || "-")),
    el("dl", { class: "kv" }, el("dt", null, "Sittings"), el("dd", null, s.sittings), el("dt", null, "Model calls"), el("dd", null, s.calls + " (" + usd(s.cost) + ")"),
      el("dt", null, "Asked for"), el("dd", null, s.requests + " (" + s.confirmed + " confirmed, " + s.declined + " declined)"), el("dt", null, "Acts made"), el("dd", null, s.acts)))))));
  // translator
  const tcard = el("div", { class: "card" }, el("h2", null, "The translator"));
  if (t.arrangement) tcard.append(el("div", { class: "small" }, "Ours first (" + t.arrangement.first + "), then the fallback (" + t.arrangement.behind + "). Version " + (t.version || "?") + ". " + (t.meanMsOurs ? "Ours answered in about " + t.meanMsOurs + " ms." : "")));
  else tcard.append(el("div", { class: "small" }, "One translator: " + (t.model || "?") + (t.version ? ", version " + t.version : "")));
  const total = t.requests || 1;
  const parts = t.arrangement ? [["ours", t.ours.requests, "var(--c1)"], ["fallback", t.fallback.requests, "var(--c2)"]] : [["answered", t.single.requests, "var(--c1)"]];
  tcard.append(el("div", { class: "bar" }, parts.map(([n, v, c]) => el("span", { style: "width:" + (100 * v / total) + "%;background:" + c, title: n + ": " + v }))));
  tcard.append(el("div", { class: "legend" }, parts.map(([n, v, c]) => el("span", null, el("i", { style: "border-color:" + c }), n + " " + v + " of " + t.requests + " requests (" + pct(v, t.requests) + ")"))));
  const card = (name, s) => el("div", { class: "card" }, el("b", null, name), el("dl", { class: "kv" }, el("dt", null, "Requests"), el("dd", null, s.requests), el("dt", null, "Drafts offered"), el("dd", null, s.drafts),
    el("dt", null, "Confirmed (right)"), el("dd", null, s.confirmed + (s.drafts ? " (" + pct(s.confirmed, s.drafts) + " of drafts)" : "")), el("dt", null, "Declined (wrong)"), el("dd", null, s.declined), el("dt", null, "Not answered"), el("dd", null, s.unanswered),
    el("dt", null, "Asked back"), el("dd", null, s.askedBack), el("dt", null, "Refused"), el("dd", null, s.refused)));
  tcard.append(el("div", { class: "grid" }, t.arrangement ? [card("Ours", t.ours), card("Fallback", t.fallback)] : [card("All requests", t.single)]));
  const why = Object.entries(t.fallbackWhy || {});
  if (why.length) tcard.append(el("div", { class: "small" }, "Why requests went to the fallback: " + why.map(([k, v]) => k.replace(/_/g, " ") + " " + v).join(", ") + "."));
  tcard.append(el("div", { class: "small" }, "\"Confirmed\" is the seat saying yes to the draft; \"declined\" is the seat saying the draft was wrong. Drafts a seat never answered are counted apart."));
  root.append(tcard);
  return root;
}

// ---------------------------------------------------------------- seats
function seats() {
  const root = el("div");
  root.append(el("div", { class: "pick" }, D.seats.map((s) => el("button", { "aria-pressed": state.seat === s.id ? "true" : "false", on: { click: () => go("seats", s.id) } }, s.title || s.id))));
  const s = D.seats.find((x) => x.id === state.seat) || D.seats[0];
  if (!s) return empty("No seats on record.");
  const head = el("div", { class: "card" },
    el("h2", null, (s.title || s.id), " ", el("span", { class: "small" }, s.id)),
    el("div", { class: "chips" }, el("span", { class: "chip" }, s.model || "-"), el("span", { class: "chip" }, s.sittings.length + " sittings"), el("span", { class: "chip" }, s.calls + " calls, " + usd(s.cost)),
      el("span", { class: "chip" }, s.requests + " requests"), el("span", { class: "chip" }, s.confirmed + " confirmed"), el("span", { class: "chip" }, s.declined + " declined"), el("span", { class: "chip" }, s.acts + " acts"),
      s.opted_out ? badge("opted out", "bad") : null),
    el("div", { class: "small" }, "Tools used: " + (Object.entries(s.tools).map(([k, v]) => k + " " + v).join(", ") || "none")));
  root.append(head);
  const sub = { tl: "Timeline", nb: "Notebook", db: "Debrief" };
  let cur = state.sub || "tl";
  const body = el("div"), pick = el("div", { class: "pick" });
  const show = (k) => { cur = state.sub = k; pick.replaceChildren(...Object.entries(sub).map(([id, n]) => el("button", { "aria-pressed": cur === id ? "true" : "false", on: { click: () => show(id) } }, n))); body.replaceChildren({ tl: timeline, nb: notebook, db: debrief }[k](s)); };
  root.append(pick, body); show(cur);
  return root;
}

function toolLine(tu) {
  const i = tu.input || {}, name = tu.name;
  if (name === "done_for_now") return el("div", { class: "small" }, "Done for now" + (i.days != null ? ", back in " + i.days + " days" : "") + (i.until ? ", until " + i.until : "") + ".");
  if (name === "notebook") return el("div", null, el("span", { class: "label" }, "Wrote in its notebook"), more(i.add ?? i.text ?? JSON.stringify(i), 500, "quote"));
  if (name === "confirm") return el("div", { class: "small" }, "Answered a draft: " + (i.decision || "?") + " (" + (i.ref || "") + ")" + (i.reason ? ": " + i.reason : ""));
  if (name === "do") return el("div", { class: "small" }, "Asked for something to be done" + (i.why ? " because: " + i.why : "") + " (the request is shown below).");
  if (name === "look") {
    const what = Object.entries(i).map(([k, v]) => k + ": " + (Array.isArray(v) ? v.join(", ") : v)).join("; ");
    return el("div", null, el("span", { class: "label" }, "Looked"), " ", what, tu.result ? more(tu.result, 400, "quote") : null);
  }
  if (name === "write") return el("div", null, el("span", { class: "label" }, "Wrote a message to " + [].concat(i.to || []).join(", ")), i.about ? el("div", { class: "small" }, "About: " + i.about) : null, more(i.text || "", 500, "quote"));
  return el("div", { class: "small" }, name + " " + JSON.stringify(i).slice(0, 300), tu.result ? more(tu.result, 300, "quote") : null);
}

function actView(a) {
  const blocks = a.blocks.map((b) => el("div", null,
    el("b", null, (b.kind || b.block).replace(/_/g, " ")), b.to && b.to.length ? " to " + b.to.join(", ") : "", b.text ? el("div", { class: "quote" }, b.text) : null,
    el("div", null, Object.entries(b.facts || {}).map(([k, v]) => el("span", { class: "fact" }, k + ": " + (typeof v === "string" && v.length > 60 ? v.slice(0, 60) + "..." : v))))));
  return blocks;
}

function reqView(r) {
  const cls = r.act?.status === "applied" ? "ok" : r.act?.status === "refused" || r.signoff === "declined" ? "bad" : r.ending === "asked_back" || r.ending === "refused" ? "warn" : "";
  const box = el("div", { class: "req " + cls });
  box.append(el("div", null, el("b", null, "Asked for"), " ", badge(r.id.replace(/^draft\./, ""), ""), " ", r.by === "ours" ? badge("our translator", "info") : r.by === "fallback" ? badge("fallback translator", "warn") : badge("translator", "")));
  box.append(more(r.words, 500, "quote"));
  const tr = [];
  if (r.route) {
    const f = r.route.first;
    tr.push(el("div", { class: "small" }, f ? "Ours said: " + (f.result || "?") + (f.label ? " (" + f.label + ")" : "") + (f.withheld ? ", held back: " + f.withheld.replace(/_/g, " ") : "") + (f.ms ? ", " + f.ms + " ms" : "") + "." : null,
      r.route.used === "behind" ? " Handed behind" + (r.route.why ? " because: " + String(r.route.why).replace(/_/g, " ") : "") + "." : " Ours was used."));
  }
  if (r.draft) tr.push(el("div", null, el("div", { class: "label" }, "The translator's draft" + (r.draft.ok ? "" : " (failed its check)")), more(r.draft.summary || r.draft.proposal, 600, "quote"), el("details", null, el("summary", { class: "small" }, "the exact call"), el("div", { class: "quote" }, r.draft.call))));
  if (r.failure) tr.push(el("div", null, el("div", { class: "label" }, r.failure.askedBack ? "The translator asked back" : "No draft"), el("div", { class: "quote" }, r.failure.reason)));
  box.append(...tr);
  const outcome = [];
  if (r.signoff) outcome.push(el("div", null, "The seat ", badge(r.signoff, r.signoff === "confirmed" ? "ok" : r.signoff === "declined" ? "bad" : "warn"), r.signoff === "unanswered" ? " (no answer on record)" : ""));
  if (r.act) {
    outcome.push(el("div", null, "What happened: ", badge(r.act.status === "applied" ? "done" : r.act.status, r.act.status === "applied" ? "ok" : r.act.status === "refused" ? "bad" : "warn"), r.act.appliedAt != null ? " at " + stampOf(r.act.appliedAt) : ""));
    if (r.act.refusal) outcome.push(el("div", { class: "quote" }, r.act.refusal.code + ": " + r.act.refusal.detail));
    outcome.push(...actView(r.act));
    if (r.act.reasoning) outcome.push(el("div", { class: "small" }, "Recorded reason: " + r.act.reasoning));
    if (r.act.effects.length) outcome.push(el("div", null, el("div", { class: "label" }, "On record as a result"), el("ul", { class: "list" }, r.act.effects.map((e) => el("li", null, badge(e.type, ""), " ", e.text)))));
    if (r.act.consequences.length) outcome.push(el("div", null, el("div", { class: "label" }, "Later on record (answering it)"), el("ul", { class: "list" }, r.act.consequences.map((c) => el("li", null, el("span", { class: "small" }, stampOf(c.t) + " "), el("b", null, c.byName || c.by), " ", badge(c.kind, ""), " ", c.text)))));
  } else if (r.signoff !== "declined" && (r.ending === "asked_back" || r.ending === "refused")) outcome.push(el("div", { class: "small" }, "Nothing was done; the seat had to ask again."));
  else if (r.signoff === "declined") outcome.push(el("div", { class: "small" }, "Nothing was done; the seat said the draft was wrong."));
  else if (!r.act) outcome.push(el("div", { class: "small" }, "No act followed on record."));
  if (outcome.length) box.append(section("Outcome", ...outcome));
  return box;
}
const stampOf = (t) => { const d = Math.floor(t / 86400) + 1, s = t % 86400; return "day " + d + " " + String(Math.floor(s / 3600)).padStart(2, "0") + ":" + String(Math.floor((s % 3600) / 60)).padStart(2, "0"); };

function sittingBody(s) {
  const b = el("div", { class: "body" });
  b.append(section("What it read", s.reading ? more(s.reading, 700, "quote") : empty("Not on record."), s.readingLen > s.reading.length ? el("div", { class: "small" }, "(the log's text is " + n0(s.readingLen) + " characters; this page keeps the first part)") : null));
  if (s.notebookBefore) b.append(el("details", null, el("summary", { class: "small" }, "its notebook when it sat down"), el("div", { class: "quote" }, s.notebookBefore)));
  const turnsBox = el("div");
  for (const t of s.turns) {
    const nonBook = t.tools;
    turnsBox.append(el("div", { class: "section" }, t.say ? el("div", { class: "text" }, el("b", null, "It said: "), t.say) : null, ...nonBook.filter((x) => x.name !== "do" && x.name !== "confirm").map(toolLine), ...nonBook.filter((x) => x.name === "confirm").map(toolLine)));
  }
  b.append(section("What it did, turn by turn", turnsBox));
  if (s.requests.length) b.append(section("What it asked for, and what came of it", ...s.requests.map(reqView)));
  if (s.direct.length) b.append(section("Acts made directly", ...s.direct.map((a) => el("div", { class: "req" }, el("div", { class: "small" }, stampOf(a.t) + " " + a.status), ...actView(a), a.effects?.length ? el("ul", { class: "list" }, a.effects.map((e) => el("li", null, badge(e.type, ""), " ", e.text))) : null, a.consequences?.length ? el("ul", { class: "list" }, a.consequences.map((c) => el("li", null, el("b", null, c.byName || c.by), " ", badge(c.kind, ""), " ", c.text))) : null))));
  if (s.notes.length) b.append(section("Notes the platform made", el("ul", { class: "list" }, s.notes.map((n) => el("li", null, badge(n.kind.replace(/_/g, " "), "warn"), " ", n.data)))));
  return b;
}
const sittingText = (s) => (s.stamp + " " + s.turns.map((t) => t.say + " " + t.tools.map((x) => JSON.stringify(x.input)).join(" ")).join(" ") + " " + s.requests.map((r) => r.words + " " + (r.draft?.summary || "")).join(" ")).toLowerCase();

function timeline(s) {
  const root = el("div");
  const q = el("input", { type: "search", placeholder: "Search this seat's sittings (words, ids, days)" });
  const only = el("button", { class: "btn", on: { click: () => { only.classList.toggle("on"); apply(); } } }, "Only sittings that asked for something");
  const list = el("div"), count = el("div", { class: "small" });
  root.append(el("div", { class: "pick" }, only), q, count, list);
  const cache = new Map();
  function apply() {
    const term = q.value.trim().toLowerCase(), onlyReq = only.classList.contains("on");
    const shown = s.sittings.filter((x) => (!onlyReq || x.requests.length) && (!term || (cache.get(x) ?? cache.set(x, sittingText(x)).get(x)).includes(term)));
    count.textContent = shown.length + " of " + s.sittings.length + " sittings";
    list.replaceChildren(...shown.map((x) => {
      const d = el("details", { class: "sit" });
      const rq = x.requests.length ? x.requests.length + " asked for" : "";
      const acted = x.requests.filter((r) => r.act?.status === "applied").length + x.direct.filter((a) => a.status === "applied").length;
      const brief = (x.turns[0]?.say || x.requests[0]?.words || "").slice(0, 160);
      d.append(el("summary", null, el("span", { class: "when" }, x.stamp), el("span", { class: "small" }, [rq, acted ? acted + " done" : "", x.turns.length + " turn" + (x.turns.length > 1 ? "s" : ""), usd(x.cost)].filter(Boolean).join(" | ")), el("span", { class: "brief" }, brief)));
      let built = false;
      d.addEventListener("toggle", () => { if (d.open && !built) { built = true; d.append(sittingBody(x)); } });
      if (state.openDay === x.day) { d.open = true; setTimeout(() => d.scrollIntoView(), 0); }
      return d;
    }));
  }
  q.addEventListener("input", apply); apply();
  return root;
}

function notebook(s) {
  const root = el("div");
  root.append(el("div", { class: "card" }, el("h2", null, "The notebook at the end"), s.notebook.final ? el("div", { class: "text" }, s.notebook.final) : empty("Empty or not on record.")));
  root.append(el("div", { class: "card" }, el("h2", null, "What it wrote, by day (" + s.notebook.adds.length + " entries)"), s.notebook.adds.length ? el("ul", { class: "list" }, s.notebook.adds.map((a) => el("li", null, el("b", null, "day " + a.day), el("div", { class: "text" }, a.text)))) : empty("It never wrote in it.")));
  return root;
}

function debrief(s) {
  const d = s.debrief;
  if (!d) return el("div", { class: "card" }, empty(s.debriefNote || "No debrief on record."));
  const root = el("div", { class: "card" });
  root.append(el("div", { class: "small" }, "Debrief script " + d.script + ", ended: " + d.ended + (d.keptBackAll ? ". The seat asked to keep every answer back." : d.keptBack.length ? ". Kept back by the seat: " + d.keptBack.join(", ") + "." : ". Nothing kept back.")));
  if (d.words) root.append(el("div", { class: "alert" }, d.words));
  for (const st of d.steps) {
    root.append(el("div", { class: "section" }, el("div", { class: "label" }, st.question), st.keptBack ? el("div", null, badge("kept back by the seat", "warn"), " Not shown.") :
      el("div", null, st.answer ? el("div", { class: "text" }, String(st.answer)) : null, st.more ? el("div", { class: "text" }, st.more) : null, st.values ? el("div", null, Object.entries(st.values).map(([k, v]) => el("span", { class: "fact" }, k + ": " + v))) : null, st.declined ? badge("declined to answer", "warn") : null, st.stop ? badge("ended the interview", "warn") : null)));
  }
  return root;
}

// ---------------------------------------------------------------- seat vs twin
function factSet(blocks) { const s = new Set(); for (const b of blocks) { s.add("kind:" + (b.kind || b.block)); for (const [k, v] of Object.entries(b.facts || {})) s.add(k + "=" + v); } return s; }
function sideView(x, other) {
  if (!x) return el("div", { class: "side empty" }, "Nothing on record.");
  const otherSet = other ? factSet(other.blocks) : null;
  return el("div", { class: "side" }, el("div", { class: "small" }, x.stamp), ...x.blocks.map((b) => el("div", null,
    el("b", null, (b.kind || b.block).replace(/_/g, " ")), b.to && b.to.length ? " to " + b.to.join(", ") : "", b.text ? el("div", { class: "text small" }, b.text) : null,
    el("div", null, Object.entries(b.facts || {}).map(([k, v]) => { const vs = typeof v === "string" && v.length > 140 ? v.slice(0, 140) + "..." : v; const diff = otherSet && !otherSet.has(k + "=" + v) && !/^(reason|statement)$/.test(k) && !(typeof v === "string" && /^rec\./.test(v)); return el("span", { class: "fact" + (diff ? " diff" : ""), title: String(v) }, k + ": " + vs); })))),
    x.reasoning ? el("div", { class: "small" }, "Recorded reason: " + x.reasoning) : null);
}
function twin() {
  const root = el("div");
  if (!D.twin) return empty("No code twin was found for this pilot.");
  root.append(el("div", { class: "card small" }, "The same town and seed run with code in every seat (the code twin: " + (D.twin.run || "") + "). Each decision the seat made is set beside the twin's on the same matter, matched by the parties and the kind of matter (papers carry different numbers in the two runs). Facts that differ are marked. The twin's other work at the same post (for instance notices) is counted, not listed."));
  root.append(el("div", { class: "pick" }, D.twin.seats.map((p) => el("button", { "aria-pressed": state.seat === p.seat ? "true" : "false", on: { click: () => go("twin", p.seat) } }, p.title || p.seat))));
  const p = D.twin.seats.find((x) => x.seat === state.seat) || D.twin.seats[0];
  root.append(el("div", { class: "chips" }, el("span", { class: "chip" }, p.seatActs + " seat acts"), el("span", { class: "chip" }, p.twinActs + " twin acts"), el("span", { class: "chip" }, p.matched + " matched"),
    el("span", { class: "chip" }, p.same + " same decision"), el("span", { class: "chip" }, p.differ + " differ"), el("span", { class: "chip" }, p.seatOnly + " seat only"), el("span", { class: "chip" }, p.twinOnly + " twin only")));
  const ow = Object.entries(p.twinOtherWork || {});
  if (ow.length) root.append(el("div", { class: "small" }, "The twin's other work at this post: " + ow.map(([k, v]) => k + " x" + v).join(", ") + "."));
  const diffOnly = el("button", { class: "btn on", on: { click: () => { diffOnly.classList.toggle("on"); apply(); } } }, "Only where they differ or only one acted");
  const list = el("div");
  root.append(el("div", { class: "pick" }, diffOnly), list);
  function apply() {
    const items = p.pairs.filter((x) => !diffOnly.classList.contains("on") || !x.same);
    list.replaceChildren(...(items.length ? items.map((x) => el("div", { class: "pair" },
      el("h4", null, x.seat && x.twin ? (x.same ? badge("same decision", "ok") : badge("different decisions", "warn")) : x.seat ? badge("only the seat acted", "info") : badge("only the twin acted", "info"), " ", (x.seat || x.twin).stamp),
      el("div", { class: "twin" }, el("div", null, el("div", { class: "label" }, "Seat (model)"), sideView(x.seat, x.twin)), el("div", null, el("div", { class: "label" }, "Twin (code)"), sideView(x.twin, x.seat))))) : [empty("Nothing to show.")]));
    if (p.truncated) list.append(el("div", { class: "small" }, "The list is cut at 400 entries."));
  }
  apply();
  return root;
}

// ---------------------------------------------------------------- actors
function sparkline(days, w, h, color) {
  const max = Math.max(1, ...days), bw = w / Math.max(1, days.length);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 " + w + " " + h); svg.setAttribute("role", "img");
  days.forEach((v, i) => { if (!v) return; const r = document.createElementNS("http://www.w3.org/2000/svg", "rect"); const bh = Math.max(1, (v / max) * (h - 2)); r.setAttribute("x", i * bw); r.setAttribute("y", h - bh); r.setAttribute("width", Math.max(0.6, bw - 0.4)); r.setAttribute("height", bh); r.setAttribute("fill", color || "var(--c1)"); const t = document.createElementNS("http://www.w3.org/2000/svg", "title"); t.textContent = "day " + (i + 1) + ": " + v; r.append(t); svg.append(r); });
  return svg;
}
function actors() {
  const root = el("div");
  const q = el("input", { type: "search", placeholder: "Search by id or name (for example: tribunal, c2638, landlord)" });
  const kinds = [...new Set(D.actors.map((a) => a.kind))].sort();
  const kindSel = el("select", null, el("option", { value: "" }, "All kinds"), kinds.map((k) => el("option", { value: k }, k)));
  const list = el("div"), count = el("div", { class: "small" });
  root.append(el("div", { class: "small" }, "Offices, firms and people the seats dealt with, and the town's institutions. Counts are over the whole run, from the log."), el("div", { class: "pick" }, kindSel), q, count, list);
  function apply() {
    const term = q.value.trim().toLowerCase(), k = kindSel.value;
    const shown = D.actors.filter((a) => (!k || a.kind === k) && (!term || a.id.toLowerCase().includes(term) || a.name.toLowerCase().includes(term) || a.kind.includes(term)));
    count.textContent = shown.length + " of " + D.actors.length;
    list.replaceChildren(...shown.slice(0, 120).map(actorCard));
    if (shown.length > 120) list.append(el("div", { class: "small" }, "Showing the first 120; search to narrow."));
  }
  q.addEventListener("input", apply); kindSel.addEventListener("change", apply);
  if (state.actor) q.value = state.actor;
  apply();
  return root;
}
function actorCard(a) {
  const authored = Object.entries(a.authored).sort((x, y) => y[1] - x[1]);
  const blocks = Object.entries(a.blocks).sort((x, y) => y[1] - x[1]);
  const d = el("details", { class: "sit" });
  const nAuth = authored.reduce((s, [, v]) => s + v, 0);
  d.append(el("summary", null, el("span", { class: "when" }, a.name === a.id ? a.id : a.name), el("span", { class: "small" }, (a.name === a.id ? "" : a.id + " | ") + a.kind + " | " + n0(a.acts) + " acts, " + n0(nAuth) + " papers" + (a.sent.n + a.received.n ? ", " + n0(a.sent.n + a.received.n) + " payments" : "")), a.seat ? badge("seat: " + a.seat, "info") : null,
    el("span", { class: "brief" }, sparkline(a.days, 300, 24))));
  let built = false;
  d.addEventListener("toggle", () => {
    if (!d.open || built) return; built = true;
    const b = el("div", { class: "body" });
    b.append(section("Activity by day", sparkline(a.days, 640, 60), el("div", { class: "small" }, "Each bar is a day: acts, papers written and payments touching it. Day 1 at the left.")));
    b.append(section("Counts", el("dl", { class: "kv" },
      el("dt", null, "Acts"), el("dd", null, n0(a.acts) + (blocks.length ? " (" + blocks.slice(0, 8).map(([k, v]) => k + " " + v).join(", ") + ")" : "")),
      el("dt", null, "Papers written"), el("dd", null, authored.length ? authored.slice(0, 10).map(([k, v]) => k + " " + v).join(", ") : "none"),
      el("dt", null, "Paid out"), el("dd", null, n0(a.sent.n) + " payments, " + a.sent.amt), el("dt", null, "Received"), el("dd", null, n0(a.received.n) + " payments, " + a.received.amt),
      Object.keys(a.roles).length ? [el("dt", null, "Acted in the posts"), el("dd", null, Object.entries(a.roles).map(([k, v]) => k + " " + v).join(", "))] : null)));
    if (a.dealtWith.length) b.append(section("Dealings with the seats", el("ul", { class: "list" }, a.dealtWith.map((r) => el("li", null, el("button", { class: "link", on: { click: () => go("seats", r.seat, r.day) } }, r.seat.replace(/-system$/, "") + ", day " + r.day), ": " + r.words)))));
    b.append(section("Timeline (first and latest items on record)", a.items.length ? el("ul", { class: "list" }, a.items.map((i) => el("li", null, el("span", { class: "small" }, "day " + i.day + " "), i.what))) : empty("Nothing notable on record.")));
    d.append(b);
  });
  return d;
}

// ---------------------------------------------------------------- town
function lineChart(o) {
  const W = 480, H = 200, L = 46, R = 8, T = 10, B = 24, days = o.series[0].data.length;
  const all = o.series.flatMap((s) => s.data), max = Math.max(1, ...all);
  const x = (i) => L + (i / Math.max(1, days - 1)) * (W - L - R), y = (v) => T + (1 - v / max) * (H - T - B);
  const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", o.title);
  const add = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; svg.append(e); return e; };
  for (let g = 0; g <= 4; g++) { const v = (max * g) / 4, yy = y(v); add("line", { x1: L, x2: W - R, y1: yy, y2: yy, stroke: "var(--line)", "stroke-width": 1 }); add("text", { x: L - 4, y: yy + 4, "text-anchor": "end", "font-size": 13, fill: "var(--muted)" }, compact(v, o.fmt)); }
  const step = days > 120 ? 30 : days > 60 ? 15 : 10;
  for (let d = 0; d < days; d += step) add("text", { x: x(d), y: H - 6, "text-anchor": "middle", "font-size": 13, fill: "var(--muted)" }, d + 1);
  o.series.forEach((s) => add("polyline", { points: s.data.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" "), fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", ...(s.dashed ? { "stroke-dasharray": "5 4" } : {}) }));
  const cursor = add("line", { x1: 0, x2: 0, y1: T, y2: H - B, stroke: "var(--muted)", "stroke-width": 1, visibility: "hidden" });
  const readout = el("div", { class: "readout" }, "Touch or hover the chart for a day's value.");
  const move = (ev) => { const r = svg.getBoundingClientRect(); const px = ((ev.clientX - r.left) / r.width) * W; const i = Math.max(0, Math.min(days - 1, Math.round(((px - L) / (W - L - R)) * (days - 1)))); cursor.setAttribute("x1", x(i)); cursor.setAttribute("x2", x(i)); cursor.setAttribute("visibility", "visible"); readout.textContent = "day " + (i + 1) + ": " + o.series.map((s) => s.name + " " + o.fmt(s.data[i], true)).join("  |  "); };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move);
  return el("div", { class: "chart" }, el("h3", null, o.title), o.note ? el("div", { class: "small" }, o.note) : null, svg, el("div", { class: "legend" }, o.series.map((s) => el("span", null, el("i", { style: "border-color:" + s.color + (s.dashed ? ";border-top-style:dashed" : "") }), s.name))), readout);
}
const compact = (v, fmt) => { const a = Math.abs(v); const k = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : a >= 1e4 ? [1e3, "k"] : null; if (!k) return fmt(v); const x = (v / k[0]).toFixed(a / k[0] >= 100 ? 0 : 1).replace(/\.0$/, ""); return (fmt === moneyOf ? sym : "") + x + k[1]; };
const cum = (a) => { let t = 0; return a.map((v) => (t += v)); };
function town() {
  const T = D.town, S = T.series, W = T.twinSeries, root = el("div");
  const both = (name, key, color, fmt, title, note, tf) => lineChart({ title, note, fmt, series: [{ name: "this run", data: (tf || ((a) => a))(S[key]), color }, ...(W ? [{ name: "code twin", data: (tf || ((a) => a))(W[key]), color: "var(--twin)", dashed: true }] : [])] });
  const f0 = (v) => n0(v), fm = moneyOf;
  root.append(el("div", { class: "card small" }, "The town's standing measures over the run, each a plain count from the log by day" + (W ? ", with the same town run by code alone (dashed) for comparison" : "") + ". Nothing here scores the town; a line going up or down is not good or bad in itself."));
  // start vs end
  const first = (a) => a.slice(0, 7).reduce((s, v) => s + v, 0) / Math.min(7, a.length), last = (a) => a.slice(-7).reduce((s, v) => s + v, 0) / Math.min(7, a.length);
  const rows = [["Acts a day", S.acts, f0], ["Papers written a day", S.papers, f0], ["Payments a day", S.payments, f0], ["Money moved a day", S.moved, fm], ["Messages delivered a day", S.messages, f0], ["Work sessions a day", S.worked, f0], ["Acts refused a day", S.refused, (v) => n1(v)]];
  const chg = (a, b) => (a === 0 ? (b === 0 ? "no change" : "from nothing") : (b >= a ? "+" : "") + Math.round(((b - a) / a) * 100) + "%");
  root.append(el("div", { class: "card" }, el("h2", null, "What changed between the start and the end"), el("div", { class: "small" }, "Average a day over the first 7 days against the last 7 days."),
    el("table", null, el("thead", null, el("tr", null, ["Measure", "First week", "Last week", "Change"].map((h, i) => el("th", { class: i ? "n" : "" }, h)))),
      el("tbody", null, rows.map(([n, a, f]) => el("tr", null, el("td", null, n), el("td", { class: "n" }, f(first(a))), el("td", { class: "n" }, f(last(a))), el("td", { class: "n" }, chg(first(a), last(a)))))))));
  const people = T.people;
  root.append(el("div", { class: "card" }, el("h2", null, "People"), el("div", { class: "small" }, "Events on record over the run: " + people.created + " arrived or born, " + people.left + " left town, " + people.died + " died."),
    T.census.length ? el("div", { class: "small" }, "Counters read by the world: " + T.census.map((c) => "day " + c.day + ": " + Object.entries(c.counters).map(([k, v]) => k.replace(/_/g, " ") + " " + n0(v)).join(", ")).join("  |  ")) : null));
  root.append(both("acts", "acts", "var(--c1)", f0, "Acts a day", "Everything anyone in the town did that the world had to rule on."));
  root.append(both("payments", "payments", "var(--c3)", f0, "Payments a day"));
  root.append(both("moved", "moved", "var(--c2)", fm, "Money moved a day", "Total of all payments, in " + (T.currency || "the town's currency") + "."));
  root.append(both("papers", "papers", "var(--c4)", f0, "Papers written a day", "Requests, orders, notices, complaints and all other papers put on record."));
  root.append(both("worked", "worked", "var(--c3)", f0, "Work sessions a day"));
  root.append(both("refused", "refused", "var(--c2)", (v) => n1(v), "Acts the world refused a day"));
  // by kind
  const kindNames = Object.keys(T.kinds);
  const sel = el("select", null, kindNames.map((k) => el("option", { value: k }, (k === "?" ? "(no kind)" : k.replace(/_/g, " ")) + " (" + n0(T.kindTotals.find(([n]) => n === k)?.[1] ?? 0) + ")")));
  const cumBox = el("input", { type: "checkbox" }), kindBox = el("div");
  const drawKind = () => { const k = sel.value, tf = cumBox.checked ? cum : (a) => a; kindBox.replaceChildren(lineChart({ title: "Papers of one kind" + (cumBox.checked ? ", running total" : ", a day"), fmt: f0, series: [{ name: "this run", data: tf(T.kinds[k]), color: "var(--c1)" }, ...(T.twinKinds ? [{ name: "code twin", data: tf(T.twinKinds[k]), color: "var(--twin)", dashed: true }] : [])] })); };
  sel.addEventListener("change", drawKind); cumBox.addEventListener("change", drawKind);
  root.append(el("div", { class: "card" }, el("h2", null, "Papers by kind"), el("div", { class: "pick" }, sel, el("label", null, cumBox, " running total")), kindBox)); drawKind();
  return root;
}

// ---------------------------------------------------------------- go
document.getElementById("title").textContent = "Pilot " + O.pilot + (O.town ? " - " + O.town : "");
document.getElementById("subtitle").textContent = [O.profile, O.seed != null ? "seed " + O.seed : "", n1(O.days) + " days", usd(O.cost.usd)].filter(Boolean).join("  |  ") + "  (read-only view of the run's log)";
document.title = "Pilot " + O.pilot;
parseHash(); draw();
})();
