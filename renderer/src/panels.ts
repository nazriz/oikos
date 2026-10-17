// What the explorer's panels show, at a moment t: a person's life, an organisation (its posts, staff, acts and backlog),
// a building, a seat's act set beside its sitting and its twin. Reads the index only (store.ts) and the pilot viewer's
// data kept in it. Raw quantities and the log's own words; nothing is scored.

import { isConsequentialRecord, isHard } from "../../measure/src/consequential";
import { DAY, LINE_INTS } from "./indexer";
import type { Store } from "./store";
import { describe, eventRow, trace } from "./trace";
import { CLASSES, personOfParticipant, type DeciderClass } from "./world";

const YEAR = 365 * DAY;
const ROUTINE_BLOCKS = new Set(["occupy", "vacate", "work", "move_goods"]);
const SKIP_IN_LIFE = new Set(["annotation:decision", "annotation:outcome", "entity_record", "annotation:usage", "annotation:transcript", "annotation:note", "annotation:draft", "annotation:signoff", "annotation:translation_failure", "worked", "goods_moved", "body_changed"]);

function spaceAt(s: Store, pi: number, t: number) {
  const w = s.whereAt(t)[pi] ?? 0;
  if (!w) return undefined;
  const sp = s.meta.spaces[w - 1]!;
  return { space: sp.id, struct: sp.struct, structure: s.world.structures[sp.struct]?.id ?? s.meta.extraStructures[sp.struct - s.world.structures.length] };
}

/** The dwelling a person slept in at the start of day d, or the latest before. */
function homeAt(s: Store, pi: number, t: number): number {
  const P = s.meta.persons, w = s.where();
  for (let d = Math.min(s.meta.days, Math.floor(t / DAY)); d >= 0; d--) { const v = w[d * P + pi]!; if (v && s.meta.spaces[v - 1]!.kind === "dwelling") return s.meta.spaces[v - 1]!.struct; }
  for (let d = Math.floor(t / DAY) + 1; d <= s.meta.days; d++) { const v = w[d * P + pi]!; if (v && s.meta.spaces[v - 1]!.kind === "dwelling") return s.meta.spaces[v - 1]!.struct; }
  return -1;
}

export function personPanel(s: Store, id: string, t: number) {
  const pi = s.personIdx.get(id);
  if (pi === undefined) return undefined;
  const p = s.world.persons.find((x) => x.id === id);
  const participant = p?.participant ?? s.world.participants.find((x) => x.person === id)?.id ?? `${id}-self`;
  const hh = s.world.households.find((h) => h.members.includes(id));
  const job = s.world.jobs.find(([, emp]) => emp === id);
  const accounts = s.accountsOf.get(id) ?? [];
  // The person's own record at t: their changes folded in order (records.ts does the same, with the kernel's hashes).
  const sections: Record<string, unknown> = {};
  let recordChanges = 0;
  const ords = s.postingsOf([id, participant, ...accounts]);
  for (const o of s.postings(participant)) { if (s.t(o) > t) break; if (s.nameOf(o) === "entity_record") { Object.assign(sections, s.line(o).body.set ?? {}); recordChanges++; } }
  const life = ords.filter((o) => !SKIP_IN_LIFE.has(s.nameOf(o)));
  // (Their own comings and goings and work are the tracks' to show: the list keeps what they did that mattered, and what reached them.)
  let routine = 0;
  const rows = life.slice(-1500).filter((o) => {
    if (s.nameOf(o) !== "act" || s.whoOf(o) !== participant) return true;
    const blocks = s.line(o).body.blocks ?? [];
    const own = blocks.every((b: any) => ROUTINE_BLOCKS.has(b.block));
    if (own) routine++;
    return !own;
  }).slice(-700).map((o) => eventRow(s, o, id)).map((r) => ({ ...r, hard: isHardRow(s, r.ord) }));
  const byClass: Record<string, number> = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  // (Counted once: the changes that reached them, not the act commands those changes came from.)
  for (const r of rows) if (r.t <= t && !r.own && r.name !== "act") byClass[r.cls] = (byClass[r.cls] ?? 0) + 1;
  const hi = s.holderIdx.get(id)!;
  const dead = s.postings(id).find((o) => s.nameOf(o) === "person_died" || s.nameOf(o) === "person_left");
  return {
    id, participant, kind: "person", born: p?.born, age: p?.born !== undefined ? Math.floor((t - p.born) / YEAR) : undefined, sex: p?.sex,
    household: hh ? { id: hh.id, members: hh.members, leaseholder: hh.leaseholder } : undefined,
    now: spaceAt(s, pi, t), home: (() => { const h = homeAt(s, pi, t); return h >= 0 ? { struct: h, structure: s.world.structures[h]?.id } : undefined; })(),
    job: job ? { employer: job[0], struct: job[2], structure: s.world.structures[job[2]]?.id } : undefined,
    accounts, money: s.series("money", hi), agency: s.series("agency", pi),
    record: { sections, changes: recordChanges }, events: rows, total: life.length, routine, byClass,
    gone: dead !== undefined ? { t: s.t(dead), what: s.nameOf(dead) } : undefined,
    seat: s.meta.seats.find((x) => personOfParticipant(x) === id),
  };
}

function isHardRow(s: Store, ord: number): boolean {
  const n = s.nameOf(ord);
  if (n === "recorded") { const r = s.line(ord).body.record ?? {}; return isConsequentialRecord(r.kind, r.record) && isHard(r.kind, r.data, r.text); }
  if (n === "vacated" || n === "action_refused" || n === "condition_began" || n === "person_died") return true;
  if (n === "transfer") return /insufficient|failed|penalt|fine/i.test(String(s.line(ord).body.memo ?? ""));
  return false;
}

export function orgPanel(s: Store, id: string, t: number) {
  const g = s.world.orgs.find((o) => o.id === id);
  if (!g) return undefined;
  const posts = s.world.posts.filter((p) => p.entity === id).map((p) => { const info = p.holder ? s.participantInfo(p.holder) : undefined; return { id: p.id, title: p.title, role: p.role, holder: p.holder, cls: p.holder ? s.clsOf(p.holder) : undefined, model: info?.model, code: p.code }; });
  const where = s.whereAt(t);
  const prem = new Set(g.premises);
  const staff = s.world.jobs.filter(([emp]) => emp === id).map(([, person, struct]) => {
    const pi = s.personIdx.get(person); const w = pi !== undefined ? where[pi]! : 0;
    return { person, struct, here: !!w && prem.has(s.meta.spaces[w - 1]!.struct) };
  });
  // Acts in each of its posts, by week, by the class of who decided (from the index, no line read).
  const weeks = Math.ceil(s.meta.days / 7) + 1;
  const actsByWeek: Record<string, number[]> = Object.fromEntries(CLASSES.map((c) => [c, new Array(weeks).fill(0)]));
  const postOrds = s.postingsOf(posts.map((p) => p.id));
  let acts = 0;
  for (const o of postOrds) { if (s.nameOf(o) !== "act") continue; const w = Math.floor(s.t(o) / (7 * DAY)); const who = s.whoOf(o); const c: DeciderClass = who ? s.clsOf(who) : "world"; actsByWeek[c]![Math.min(w, weeks - 1)]!++; acts++; }
  // Decisions it made (records speaking for it that decide), newest first, to t.
  const own = s.postings(id);
  const decisions: ReturnType<typeof eventRow>[] = [];
  const backlog: { ord: number; id: string; kind: string; t: number; from: string; text: string }[] = [];
  let scanned = 0;
  const addressed: { ord: number; id: string; kind: string; t: number; from: string; text: string }[] = [];
  for (let i = own.length - 1; i >= 0 && scanned < 6000; i--) {
    const o = own[i]!; if (s.t(o) > t || s.nameOf(o) !== "recorded") continue;
    scanned++;
    const r = s.line(o).body.record ?? {};
    if (r.speaks_for === id && isConsequentialRecord(r.kind, r.record) && decisions.length < 60) decisions.push(eventRow(s, o));
    // (its own reports to itself, books and staff reports, are not papers waiting on it)
    if (r.speaks_for !== id && [].concat(r.addressed_to ?? []).map(String).includes(id) && addressed.length < 800) addressed.push({ ord: o, id: r.id, kind: r.kind ?? r.record, t: s.t(o), from: String(r.speaks_for ?? r.author ?? "?"), text: String(r.text ?? "").slice(0, 200) });
  }
  // Its backlog at t: papers addressed to it that nothing it wrote by t cites as basis (oldest first).
  for (const a of addressed) { const ans = s.answers(a.id).filter((o) => s.t(o) <= t); if (!ans.length) backlog.push(a); }
  backlog.sort((a, b) => a.t - b.t);
  const kinds: Record<string, number> = {};
  for (const b of backlog) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
  const hi = s.holderIdx.get(id);
  const seat = posts.find((p) => p.cls === "seat");
  return {
    id, kind: g.kind, name: g.name, premises: g.premises.map((i) => ({ struct: i, structure: s.world.structures[i]?.id })), posts, staff,
    money: hi !== undefined ? s.series("money", hi) : [], actsByWeek, acts, decisions,
    backlog: { open: backlog.length, of: addressed.length, kinds, oldest: backlog.slice(0, 25).map((b) => ({ ...b, age: Math.floor((t - b.t) / DAY) })) },
    seat: seat ? { participant: seat.holder, post: seat.id, model: seat.model } : undefined,
  };
}

export function buildingPanel(s: Store, idx: number, t: number) {
  const st = s.world.structures[idx];
  if (!st) return undefined;
  const lot = s.world.lots.find((l) => l.cells.some(([x, y]) => x === st.x && y === st.y));
  const owner = lot ? s.world.titles.find((tt) => tt.lot === lot.id)?.holder : undefined;
  const where = s.whereAt(t);
  const inside: { person: string; space: string }[] = [];
  for (let pi = 0; pi < where.length; pi++) { const w = where[pi]!; if (w && s.meta.spaces[w - 1]!.struct === idx) inside.push({ person: s.meta.holders[pi]!, space: s.meta.spaces[w - 1]!.id }); }
  const P = s.meta.persons, d = Math.min(s.meta.days, Math.floor(t / DAY)), wd = s.where();
  const residents: string[] = [];
  for (let pi = 0; pi < P; pi++) { const v = wd[d * P + pi]!; if (v && s.meta.spaces[v - 1]!.struct === idx && s.meta.spaces[v - 1]!.kind === "dwelling") residents.push(s.meta.holders[pi]!); }
  const recent = s.pulsesAt((p) => p.struct === idx && p.t <= t && p.t > t - 30 * DAY, 40).map((p) => ({ ...eventRow(s, p.ord, s.meta.holders[p.person]), person: s.meta.holders[p.person], hard: !!(p.flags & 1), seat: !!(p.flags & 2) }));
  const usedBy = s.world.orgs.filter((o) => o.premises.includes(idx)).map((o) => ({ id: o.id, name: o.name, kind: o.kind }));
  return { id: st.id, struct: idx, type: st.type, category: st.category, x: st.x, y: st.y, spaces: st.spaces, lot: lot?.id, owner, usedBy, inside, residents, recent };
}

/** A seat's act as the pilot viewer has it (its words, the translator's draft, the sign-off, the outcome) beside its
 * sitting, its twin, where it landed, and the trace of what it rested on. */
export function seatActPanel(s: Store, pilot: any, ord: number) {
  const a = s.seatActs.find((x) => x.ord === ord);
  if (!a) return undefined;
  const seat = pilot?.seats?.find((x: any) => x.id === a.participant);
  let request: any, sitting: any, direct: any;
  for (const sit of seat?.sittings ?? []) {
    const r = (sit.requests ?? []).find((q: any) => q.act?.seq === a.seq || (a.draft && q.id === a.draft));
    const d = (sit.direct ?? []).find((q: any) => q.seq === a.seq);
    if (r || d) { request = r; direct = d; sitting = { t: sit.t, day: sit.day, stamp: sit.stamp, model: sit.model, reading: String(sit.reading ?? "").slice(0, 6000), readingLen: sit.readingLen, turns: (sit.turns ?? []).map((tu: any) => ({ turn: tu.turn, say: tu.say, tools: (tu.tools ?? []).map((x: any) => ({ name: x.name, input: x.input })) })), cost: sit.cost }; break; }
  }
  const twinSeat = pilot?.twin?.seats?.find((x: any) => x.seat === a.participant);
  const pair = twinSeat?.pairs?.find((p: any) => p.seat?.seq === a.seq);
  const e = s.line(ord);
  return {
    act: { ...a, sentence: describe(s, e), reasoning: e.body.reasoning, provenance: e.body.provenance, blocks: e.body.blocks },
    seat: seat ? { id: seat.id, title: seat.title, model: seat.model, framing: seat.framing } : { id: a.participant, model: s.participantInfo(a.participant)?.model },
    request, direct, sitting,
    twin: pair ? { same: pair.same, act: pair.twin ?? null, run: s.meta.runId } : twinSeat ? { same: false, act: null, note: "no matching act of the code twin on the same parties and matter" } : null,
    trace: trace(s, ord),
  };
}

/** Counts of kept lines by day, by the class of who decided, of the consequential changes (pulses). */
export function townPulse(s: Store) {
  const D = s.meta.days + 1;
  const byClass: number[][] = CLASSES.map(() => new Array(D).fill(0));
  const hard: number[] = new Array(D).fill(0);
  for (let i = 0; i < s.pulses.length; i += 6) { const d = Math.min(D - 1, Math.floor(s.pulses[i]! / DAY)); byClass[s.pulses[i + 3]!]![d]!++; if (s.pulses[i + 4]! & 1) hard[d]!++; }
  return { byClass: Object.fromEntries(CLASSES.map((c, i) => [c, byClass[i]])), hard };
}

export { LINE_INTS };
