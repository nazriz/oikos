// The view index (docs/design/renderer.md 3): one pass over a run's log, read only through the repo's reader, into files
// the explorer serves. Derived and disposable: the log is the truth, the index can be deleted and made again, and it is
// named by the log's head hash so a stale one is never reused. It is written outside the run's folder (paths.ts).
//
// What it holds:
// - frames.bin: the kept lines, zstd-compressed in frames of FRAME_LINES (any line comes back by its ordinal). Kept is
//   everything but what nobody watching needs: observe, look and advance commands, observations, the start and apply of
//   actions (folded into actions.bin), occupied (folded into the tracks), record-chain events, debriefs (never read).
// - lines.bin: per kept line, its seq, t, action (the act that caused it, -1 for none) and name code.
// - actions.bin: per action, the ordinal of its act command, the participant who acted, its status and end time.
// - index.sqlite: postings (every known id to the kept lines that name it), records (id to the line that made it),
//   answers (a record to the lines that cite it as basis), genesis records, performers (who did the work, if others).
// - tracks: where.bin (every body's space at each midnight), moves.bin (each day's moves), money.bin and agency.bin
//   (each holder's money and each person's sense of agency at each midnight), pulses.bin (each consequential change
//   that reached a person: when, whom, where, who decided, hard or not, its line).
// - world.json (the static world, slim), seatacts.json, meta.json.

import { Database } from "bun:sqlite";
import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";
import { logLines } from "../../orchestrator/src/logs";
import { isConsequentialRecord, isHard } from "../../measure/src/consequential";
import { accountsOf, classOf, CLASS_CODE, personOfParticipant, spaceParts, worldOf, type DeciderClass, type WorldStatic } from "./world";

export const INDEX_VERSION = 4;
export const FRAME_LINES = 4096;
export const DAY = 86_400;
export const LINE_INTS = 5; // seq, t, action, name, who decided (participant index; -1 the world)
export const ACTION_INTS = 4; // act ordinal, participant index, status (0 pending, 1 applied, 2 refused), end t
export const PULSE_INTS = 6; // t, person index, structure index, class code, flags (1 hard, 2 seat), line ordinal
export const MOVE_INTS = 3; // t, person index, space index + 1 (0: out of every space)

export interface SeatAct { ord: number; seq: number; t: number; participant: string; as: string; draft?: string; via?: string; action: number; status?: string; endT?: number; kinds: string[]; text: string; from: number; targets: { id: string; kind: "person" | "org"; struct: number }[] }
export interface IndexMeta {
  version: number; runId: string; log: string; logBytes: number; logMtime: number; headHash: string; days: number; lastT: number; end?: { reason?: string; detail?: string; t: number };
  lines: number; kept: number; frames: number[]; names: string[]; persons: number; holders: string[]; spaces: { id: string; struct: number; kind: string; n: number }[]; extraStructures: string[];
  actions: number; pulses: number; moves: number; movesDay: number[]; participants: { id: string; cls: DeciderClass }[]; seats: string[]; pilot: boolean; seconds: { read: number; total: number }; builtAt: string;
}

class Grow {
  a: Int32Array; n = 0;
  constructor(cap = 1 << 16) { this.a = new Int32Array(cap); }
  push(...xs: number[]) { if (this.n + xs.length > this.a.length) { const b = new Int32Array(Math.max(this.a.length * 2, this.n + xs.length)); b.set(this.a); this.a = b; } for (const x of xs) this.a[this.n++] = x; }
  view() { return this.a.subarray(0, this.n); }
}

const TOKEN = /"([A-Za-z0-9][A-Za-z0-9_.\-/]{0,80})"/g;
/** Events whose effect may be an act's: they follow the act's action_applied under the same cause. The rest are the world's. */
const ACTED = new Set(["transfer", "recorded", "message_delivered", "goods_moved", "account_opened", "entity_created", "appointed", "worked", "vacated", "condition_treated", "person_left", "position_created", "participant_created", "person_created", "person_arrived", "action_refused", "visited", "ask_answered"]);

export interface BuildOptions { log?: (s: string) => void; pilotData?: (log: string) => Promise<any> }

/** Builds the index of `logPath` into `outDir` (made afresh: written to a temporary folder and renamed when complete). */
export async function buildIndex(logPath: string, outDir: string, o: BuildOptions = {}): Promise<IndexMeta> {
  const say = o.log ?? (() => {});
  const t0 = performance.now();
  const tmp = `${outDir}.building-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const st = statSync(logPath);

  let header: any, headHash = "", world!: WorldStatic;
  let lines = 0, kept = 0, lastT = 0, end: IndexMeta["end"];
  const names: string[] = [], nameCode = new Map<string, number>();
  const codeOf = (n: string) => nameCode.get(n) ?? (nameCode.set(n, names.length), names.push(n), names.length - 1);
  const lineMeta = new Grow(1 << 20);
  const framesFd = openSync(join(tmp, "frames.bin"), "w");
  const frameOffsets: number[] = [0];
  let frameBuf: string[] = [];
  const flushFrame = () => {
    if (!frameBuf.length) return;
    const z = zlib.zstdCompressSync(Buffer.from(frameBuf.join("\n")), { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } });
    writeSync(framesFd, z);
    frameOffsets.push(frameOffsets.at(-1)! + z.length);
    frameBuf = [];
  };

  // ---- ids
  const postings = new Map<string, number[]>();
  const known = new Set<string>();
  const post = (id: string, ord: number) => { const p = postings.get(id); if (!p) postings.set(id, [ord]); else if (p[p.length - 1] !== ord) p.push(ord); };
  const postTokens = (line: string, ord: number) => {
    const cut = line.lastIndexOf(',"hash":"');
    const body = cut > 0 ? line.slice(0, cut) : line;
    for (const m of body.matchAll(TOKEN)) if (known.has(m[1]!)) post(m[1]!, ord);
  };

  // ---- participants and their classes
  const partIdx = new Map<string, number>(), partIds: string[] = [], partCls: DeciderClass[] = [];
  const headerPart = new Map<string, any>();
  const part = (id: string): number => {
    let i = partIdx.get(id);
    if (i === undefined) { i = partIds.length; partIdx.set(id, i); partIds.push(id); partCls.push(classOf(headerPart.get(id), id)); known.add(id); }
    return i;
  };

  // ---- people, holders, spaces
  const personIdx = new Map<string, number>(); // person id -> index
  const holderIdx = new Map<string, number>(), holders: string[] = []; // persons first, then organisations
  const holder = (id: string) => { let i = holderIdx.get(id); if (i === undefined) { i = holders.length; holderIdx.set(id, i); holders.push(id); } return i; };
  let where: number[] = [], home: number[] = [], last: number[] = [], money: number[] = [], agency: number[] = [];
  const spaceIdx = new Map<string, number>(), spaces: IndexMeta["spaces"] = [], extraStructures: string[] = [];
  let structIdx = new Map<string, number>();
  const space = (id: string): number => {
    let i = spaceIdx.get(id);
    if (i === undefined) {
      const p = spaceParts(id);
      let s = structIdx.get(p.structure);
      if (s === undefined) { s = (world.structures.length + extraStructures.length); structIdx.set(p.structure, s); extraStructures.push(p.structure); }
      i = spaces.length; spaceIdx.set(id, i); spaces.push({ id, struct: s, kind: p.kind, n: p.n });
    }
    return i;
  };
  const addPerson = (id: string, participant?: string) => {
    if (personIdx.has(id)) return personIdx.get(id)!;
    const i = personIdx.size; personIdx.set(id, i); holder(id); known.add(id);
    if (participant) { part(participant); participantPerson.set(participant, id); }
    where.push(0); home.push(-1); last.push(-1); agency.push(-1);
    return i;
  };
  const participantPerson = new Map<string, string>();
  const personOf = (p: string) => participantPerson.get(p) ?? personOfParticipant(p);

  // ---- accounts and money
  const accHolder = new Map<string, string>();
  const balance = new Map<string, number>();

  // ---- tracks
  const whereDays: Uint32Array[] = [], moneyDays: Float64Array[] = [], agencyDays: Int16Array[] = [];
  const moves = new Grow(1 << 18), movesDay: number[] = [];
  const pulses = new Grow(1 << 16);
  let day = -1;
  const snapshot = () => {
    day++;
    whereDays.push(Uint32Array.from(where));
    const m = new Float64Array(holders.length);
    for (let i = 0; i < holders.length; i++) m[i] = money[i] ?? 0;
    moneyDays.push(m);
    agencyDays.push(Int16Array.from(agency));
    movesDay.push(moves.n / MOVE_INTS);
  };

  // ---- actions, records, chains
  const actOrdBySeq = new Map<number, number>();
  const actionIdx = new Map<string, number>();
  const actions = new Grow(1 << 18);
  const appliedByCause = new Map<number, number>();
  const performers: [number, string][] = [];
  const recordOrd = new Map<string, number>();
  const recordAuthor = new Map<string, string>(); // record id -> author participant ("genesis" before the run)
  const recordSpeaks = new Map<string, string>();
  const answers: [string, number][] = [];
  const seats = new Set<string>();
  const seatActs: SeatAct[] = [];
  const seatActByAction = new Map<number, SeatAct>();
  const posOrg = new Map<string, string>();
  const orgPremises = new Map<string, number[]>();

  const keep = (line: string, seq: number, t: number, name: string, action = -1, who = -1): number => {
    const ord = kept++;
    frameBuf.push(line);
    lineMeta.push(seq, t, action, codeOf(name), who);
    if (frameBuf.length === FRAME_LINES) flushFrame();
    return ord;
  };

  /** Who decided an effect for person `p`: the actor of its action, or the maker of the standing instruction it carries out. */
  const decider = (action: number, instruction?: string): string | undefined => {
    if (instruction) {
      const a = recordAuthor.get(instruction);
      if (a && a !== "genesis") return a;
      const sp = recordSpeaks.get(instruction);
      if (sp) return personIdx.has(sp) ? `${sp}-self` : `${sp}#org`;
    }
    if (action < 0) return undefined;
    return partIds[actions.a[action * ACTION_INTS + 1]!];
  };
  const clsFor = (p: string, by: string | undefined): number => {
    if (!by) return CLASS_CODE.world;
    if (by.endsWith("#org")) return CLASS_CODE.system;
    if (personOf(by) === p) return CLASS_CODE.self;
    const i = partIdx.get(by);
    return CLASS_CODE[i === undefined ? classOf(undefined, by) : partCls[i]!];
  };
  const structFor = (id: string): number => {
    const pi = personIdx.get(id);
    if (pi !== undefined) { const s = where[pi]!; if (home[pi]! >= 0) return home[pi]!; return s ? spaces[s - 1]!.struct : last[pi]!; }
    return orgPremises.get(id)?.[0] ?? -1;
  };
  const pulse = (t: number, person: string, cls: number, hard: boolean, seat: boolean, ord: number) => {
    const pi = personIdx.get(person);
    if (pi === undefined) return;
    pulses.push(t, pi, structFor(person), cls, (hard ? 1 : 0) | (seat ? 2 : 0), ord);
  };

  const tR = performance.now();
  for await (const line of logLines(logPath)) {
    lines++;
    if (!line) continue;
    if (lines === 1) {
      const h = JSON.parse(line);
      header = h.body; headHash = h.hash ?? "";
      world = worldOf(header);
      structIdx = new Map(world.structures.map((s, i) => [s.id, i]));
      for (const p of header.config?.participants ?? []) headerPart.set(p.id, p);
      for (const p of world.participants) { part(p.id); if (p.cls === "seat") seats.add(p.id); }
      for (const p of world.persons) addPerson(p.id, p.participant);
      for (const g of world.orgs) { holder(g.id); known.add(g.id); orgPremises.set(g.id, g.premises); }
      for (const p of world.posts) { known.add(p.id); if (p.entity) posOrg.set(p.id, p.entity); }
      for (const a of accountsOf(header)) { accHolder.set(a.id, a.holder); balance.set(a.id, Number(a.balance)); known.add(a.id); const hi = holder(a.holder); money[hi] = (money[hi] ?? 0) + Number(a.balance); }
      for (const s of world.structures) known.add(s.id);
      for (const r of header.config?.world?.records ?? []) { if (r.id) { recordAuthor.set(r.id, "genesis"); if (r.speaks_for) recordSpeaks.set(r.id, r.speaks_for); known.add(r.id); } }
      for (const o of world.occupancy) { const pi = personIdx.get(o.occupant); if (pi === undefined) continue; const si = space(o.space); where[pi] = si + 1; last[pi] = spaces[si]!.struct; if (spaces[si]!.kind === "dwelling") home[pi] = spaces[si]!.struct; }
      // (Structures that do not hold anyone at the start but are workplaces: their spaces are made on first use.)
      snapshot();
      continue;
    }
    const cut = line.lastIndexOf('"kind":"');
    const tail = cut > 0 ? line.slice(cut) : "";
    const kind = /^"kind":"(\w+)"/.exec(tail)?.[1] ?? "";
    const seq = Number(/"seq":(\d+)/.exec(tail)?.[1] ?? -1);
    const t = Number(/"t":(-?\d+)/.exec(tail)?.[1] ?? 0);
    if (kind === "end") { const e = JSON.parse(line); end = { reason: e.body.reason, detail: e.body.detail, t }; lastT = Math.max(lastT, t); continue; }
    if (kind === "checkpoint") continue;
    lastT = Math.max(lastT, t);
    while (t >= (day + 1) * DAY) snapshot();

    if (kind === "command") {
      const name = /"command":"(\w+)"/.exec(line)?.[1] ?? "?";
      if (name === "observe" || name === "look" || name.startsWith("advance")) continue;
      if (name === "act") {
        const e = JSON.parse(line), b = e.body;
        const ord = keep(line, seq, t, "act", -1, part(b.participant));
        actOrdBySeq.set(seq, ord);
        postTokens(line, ord);
        if (seats.has(b.participant)) {
          const kinds = (b.blocks ?? []).map((x: any) => x.block + (x.kind ? `:${x.kind}` : ""));
          const text = (b.blocks ?? []).map((x: any) => x.text).filter(Boolean).join(" / ").slice(0, 300);
          const org = b.as ? posOrg.get(b.as) : undefined;
          seatActs.push({ ord, seq, t, participant: b.participant, as: String(b.as ?? ""), draft: b.provenance?.draft, via: b.provenance?.via, action: -1, kinds, text, from: org ? orgPremises.get(org)?.[0] ?? -1 : -1, targets: [] });
        }
        continue;
      }
      if (name === "entity_record") {
        const p = /"participant":"([^"]+)"/.exec(line)?.[1];
        const ord = keep(line, seq, t, "entity_record", -1, p ? part(p) : -1);
        if (p) {
          post(p, ord);
          const ag = /"agency":\{"now":(-?\d+)/.exec(line);
          const pi = personIdx.get(personOf(p));
          if (ag && pi !== undefined) agency[pi] = Math.max(-1, Math.min(32767, Number(ag[1])));
        }
        continue;
      }
      const p = /"participant":"([^"]+)"/.exec(line)?.[1];
      const ord = keep(line, seq, t, name, -1, p ? part(p) : -1);
      postTokens(line, ord);
      continue;
    }

    if (kind === "annotation") {
      const name = /"annotation":"(\w+)"/.exec(line)?.[1] ?? "?";
      if (name === "debrief" || name === "observation") continue; // (debriefs are never read here: VISION 15)
      const ord = keep(line, seq, t, `annotation:${name}`);
      if (name === "decision" || name === "outcome") { const s = /"subject":"([^"]+)"\},"hash"/.exec(line)?.[1] ?? /"subject":"([^"]+)"/.exec(line)?.[1]; if (s) post(s, ord); }
      else postTokens(line, ord);
      continue;
    }

    if (kind !== "event") continue;
    const name = /"event":"(\w+)"/.exec(line)?.[1] ?? "?";
    if (name === "observation" || name === "entity_recorded" || name === "ask_started" || name === "visit_started" || name === "birth_started") continue;
    if (name === "action_started") {
      const action = /"action":"([^"]+)"/.exec(line)![1]!;
      const cause = Number(/"cause":(\d+)/.exec(line)?.[1] ?? -1);
      const actOrd = actOrdBySeq.get(cause) ?? -1;
      const participant = /"participant":"([^"]+)"/.exec(line)?.[1] ?? "";
      const i = actions.n / ACTION_INTS;
      actions.push(actOrd, part(participant), 0, t);
      actionIdx.set(action, i);
      const sa = seatActs.length && seatActs[seatActs.length - 1]!.ord === actOrd ? seatActs[seatActs.length - 1] : undefined;
      if (sa) { sa.action = i; seatActByAction.set(i, sa); }
      continue;
    }
    if (name === "action_applied") {
      const i = actionIdx.get(/"action":"([^"]+)"/.exec(line)?.[1] ?? "");
      if (i === undefined) continue;
      const cause = Number(/"cause":(\d+)/.exec(line)?.[1] ?? -1);
      actions.a[i * ACTION_INTS + 2] = 1; actions.a[i * ACTION_INTS + 3] = t;
      appliedByCause.set(cause, i);
      const by = /"by":\[([^\]]*)\]/.exec(line)?.[1];
      const who = partIds[actions.a[i * ACTION_INTS + 1]!];
      if (by && by !== `"${who}"`) performers.push([i, by.replace(/"/g, "")]);
      continue;
    }
    if (name === "occupied") {
      const occ = /"occupant":"([^"]+)"/.exec(line)?.[1] ?? "";
      const sp = /"space":"([^"]+)"/.exec(line)?.[1] ?? "";
      const pi = personIdx.get(occ);
      if (pi === undefined || !sp) continue;
      const si = space(sp);
      where[pi] = si + 1; last[pi] = spaces[si]!.struct;
      if (spaces[si]!.kind === "dwelling") home[pi] = spaces[si]!.struct;
      moves.push(t, pi, si + 1);
      continue;
    }

    const e = JSON.parse(line), b = e.body;
    const cause: number | undefined = b.cause;
    const action = ACTED.has(name) && cause !== undefined ? appliedByCause.get(cause) ?? -1 : -1;
    const sa = action >= 0 ? seatActByAction.get(action) : undefined;
    const target = (id: string, k: "person" | "org") => { if (sa && sa.targets.length < 40 && !sa.targets.some((x) => x.id === id)) sa.targets.push({ id, kind: k, struct: structFor(id) }); };
    const touchedTarget = (id: string) => { const pid = personIdx.has(id) ? id : participantPerson.get(id) ?? (personIdx.has(personOfParticipant(id)) ? personOfParticipant(id) : undefined); if (pid) target(pid, "person"); else if (orgPremises.has(id)) target(id, "org"); else if (posOrg.has(id)) target(posOrg.get(id)!, "org"); };

    const whoIdx = (by: string | undefined) => (by ? part(by.replace(/#org$/, "")) : -1);
    if (name === "vacated") {
      const pi = personIdx.get(b.occupant);
      if (pi !== undefined) { where[pi] = 0; moves.push(t, pi, 0); }
      if (b.reason === "left" || b.reason === "died" || !b.reason) continue;
      const ord = keep(line, seq, t, name, action, whoIdx(b.by ?? decider(action)));
      postTokens(line, ord);
      if (pi !== undefined) pulse(t, b.occupant, clsFor(b.occupant, b.by ?? decider(action)), true, !!sa, ord);
      continue;
    }

    const effectBy = name === "transfer" ? decider(action, b.per_instruction) : name === "recorded" ? (b.record?.author ? String(b.record.author) : decider(action)) : b.by && typeof b.by === "string" ? b.by : decider(action);
    const ord = keep(line, seq, t, name, action, effectBy && effectBy !== "genesis" ? whoIdx(effectBy) : -1);
    postTokens(line, ord);
    switch (name) {
      case "transfer": {
        const amt = Number(b.amount);
        for (const [acc, sign] of [[b.from, -1], [b.to, 1]] as [string, number][]) {
          balance.set(acc, (balance.get(acc) ?? 0) + sign * amt);
          const h = accHolder.get(acc);
          if (h) { const hi = holder(h); money[hi] = (money[hi] ?? 0) + sign * amt; }
        }
        const by = decider(action, b.per_instruction);
        const seat = !!sa || (by ? seats.has(by) : false);
        const hard = /insufficient|failed|penalt|fine/i.test(String(b.memo ?? ""));
        for (const acc of [b.from, b.to]) { const h = accHolder.get(acc); if (h && personIdx.has(h)) pulse(t, h, clsFor(h, by), hard, seat, ord); if (h) touchedTarget(h); }
        break;
      }
      case "recorded": {
        const r = b.record ?? {};
        if (r.id) { recordOrd.set(r.id, ord); recordAuthor.set(r.id, String(r.author ?? "")); if (r.speaks_for) recordSpeaks.set(r.id, r.speaks_for); if (!known.has(r.id)) { known.add(r.id); post(r.id, ord); } }
        for (const bs of [].concat(r.basis ?? [])) answers.push([String(bs), ord]);
        const touched = new Set<string>([...[].concat(r.addressed_to ?? []), ...(r.terms?.parties ?? []), ...(r.record === "claim" && r.holder ? [r.holder] : [])].map(String));
        const by = r.author ? String(r.author) : decider(action);
        const consequential = isConsequentialRecord(r.kind, r.record);
        const hard = isHard(r.kind, r.data, r.text);
        for (const x of touched) {
          const pid = personIdx.has(x) ? x : participantPerson.get(x) ?? (personIdx.has(personOfParticipant(x)) ? personOfParticipant(x) : undefined);
          if (pid && consequential) pulse(t, pid, clsFor(pid, by), hard, !!sa || (!!by && seats.has(by)), ord);
          touchedTarget(x);
        }
        break;
      }
      case "action_refused": { const i = actionIdx.get(String(b.action)); if (i !== undefined) { actions.a[i * ACTION_INTS + 2] = 2; actions.a[i * ACTION_INTS + 3] = t; lineMeta.a[ord * LINE_INTS + 2] = i; } break; }
      case "message_delivered": for (const x of [].concat(b.to ?? [])) touchedTarget(String(x)); break;
      case "person_created": case "person_arrived": { const id = String(b.person); addPerson(id, b.participant); break; }
      case "participant_created": { part(String(b.participant)); if (b.person) participantPerson.set(String(b.participant), String(b.person)); break; }
      case "account_opened": { accHolder.set(String(b.account), String(b.holder)); known.add(String(b.account)); holder(String(b.holder)); break; }
      case "entity_created": { known.add(String(b.entity)); holder(String(b.entity)); break; }
      case "position_created": {
        known.add(String(b.position)); if (b.entity) posOrg.set(String(b.position), String(b.entity));
        const prem = b.role_module?.params?.premises; const si = prem ? structIdx.get(String(prem)) : undefined;
        if (si !== undefined && b.entity) orgPremises.set(String(b.entity), [si]);
        break;
      }
      case "person_died": case "person_left": { const pi = personIdx.get(String(b.person)); if (pi !== undefined) { pulse(t, String(b.person), name === "person_left" ? clsFor(String(b.person), b.by) : CLASS_CODE.world, name === "person_died", false, ord); } break; }
      case "condition_began": { pulse(t, String(b.person), CLASS_CODE.world, true, false, ord); break; }
    }
  }
  flushFrame();
  closeSync(framesFd);
  const readSecs = (performance.now() - tR) / 1000;
  const days = Math.max(1, Math.ceil(lastT / DAY));
  while (day < days) snapshot();
  say(`read ${lines.toLocaleString()} lines (${kept.toLocaleString()} kept) in ${readSecs.toFixed(1)} s`);

  // ---- seat acts: status and where each landed
  for (const sa of seatActs) {
    if (sa.action < 0) { sa.status = "not started"; continue; }
    const st = actions.a[sa.action * ACTION_INTS + 2]!;
    sa.status = st === 1 ? "applied" : st === 2 ? "refused" : "pending";
    sa.endT = actions.a[sa.action * ACTION_INTS + 3]!;
  }

  // ---- write the tracks (each day's arrays padded to the final width)
  const P = personIdx.size, H = holders.length;
  const whereAll = new Uint32Array((days + 1) * P);
  whereDays.forEach((w, d) => whereAll.set(w.subarray(0, P), d * P));
  const moneyAll = new Float64Array((days + 1) * H);
  moneyDays.forEach((m, d) => moneyAll.set(m.subarray(0, H), d * H));
  const agencyAll = new Int16Array((days + 1) * P).fill(-1);
  agencyDays.forEach((a, d) => agencyAll.set(a.subarray(0, P), d * P));
  writeFileSync(join(tmp, "where.bin"), whereAll);
  writeFileSync(join(tmp, "money.bin"), moneyAll);
  writeFileSync(join(tmp, "agency.bin"), agencyAll);
  writeFileSync(join(tmp, "moves.bin"), moves.view());
  movesDay.push(moves.n / MOVE_INTS);
  writeFileSync(join(tmp, "pulses.bin"), pulses.view());
  writeFileSync(join(tmp, "lines.bin"), lineMeta.view());
  writeFileSync(join(tmp, "actions.bin"), actions.view());

  // ---- the database
  const db = new Database(join(tmp, "index.sqlite"));
  db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;");
  db.exec("CREATE TABLE postings (id TEXT PRIMARY KEY, ords BLOB) WITHOUT ROWID; CREATE TABLE records (id TEXT PRIMARY KEY, ord INTEGER) WITHOUT ROWID; CREATE TABLE answers (record TEXT, ord INTEGER); CREATE TABLE genesis (id TEXT PRIMARY KEY, json TEXT) WITHOUT ROWID; CREATE TABLE performers (action INTEGER PRIMARY KEY, by TEXT);");
  db.transaction(() => {
    const ip = db.prepare("INSERT INTO postings VALUES (?, ?)");
    for (const [id, ords] of postings) ip.run(id, new Uint8Array(Uint32Array.from(ords).buffer));
    const ir = db.prepare("INSERT OR REPLACE INTO records VALUES (?, ?)");
    for (const [id, ord] of recordOrd) ir.run(id, ord);
    const ia = db.prepare("INSERT INTO answers VALUES (?, ?)");
    for (const [r, ord] of answers) ia.run(r, ord);
    const ig = db.prepare("INSERT OR REPLACE INTO genesis VALUES (?, ?)");
    for (const r of header?.config?.world?.records ?? []) if (r.id) ig.run(r.id, JSON.stringify(r));
    const iperf = db.prepare("INSERT OR REPLACE INTO performers VALUES (?, ?)");
    for (const [a, by] of performers) iperf.run(a, by);
  })();
  db.exec("CREATE INDEX answers_record ON answers(record);");
  db.close();

  // ---- the static world, slim, and the seat acts
  const slim = { ...world, occupancy: undefined, lots: world.lots.map((l) => ({ id: l.id, cells: l.cells })), extraStructures, accounts: [...accHolder] };
  writeFileSync(join(tmp, "world.json"), JSON.stringify(slim));
  writeFileSync(join(tmp, "seatacts.json"), JSON.stringify(seatActs));
  let pilot = false;
  if (seats.size && o.pilotData) {
    try { const data = await o.pilotData(logPath); if (data) { writeFileSync(join(tmp, "pilot.json"), JSON.stringify(data)); pilot = true; } }
    catch (err) { say(`the pilot's seats were not read: ${(err as Error).message}`); }
  }
  const meta: IndexMeta = {
    version: INDEX_VERSION, runId: world.runId, log: logPath, logBytes: st.size, logMtime: st.mtimeMs, headHash, days, lastT, end,
    lines, kept, frames: frameOffsets, names, persons: P, holders, spaces, extraStructures, actions: actions.n / ACTION_INTS, pulses: pulses.n / PULSE_INTS, moves: moves.n / MOVE_INTS, movesDay,
    participants: partIds.map((id, i) => ({ id, cls: partCls[i]! })), seats: [...seats], pilot,
    seconds: { read: Math.round(readSecs * 10) / 10, total: Math.round((performance.now() - t0) / 100) / 10 }, builtAt: new Date().toISOString(),
  };
  writeFileSync(join(tmp, "meta.json"), JSON.stringify(meta));
  rmSync(outDir, { recursive: true, force: true });
  renameSync(tmp, outDir);
  say(`indexed in ${meta.seconds.total} s`);
  return meta;
}
