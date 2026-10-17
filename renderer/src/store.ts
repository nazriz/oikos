// Reading a view index (indexer.ts): any kept line by its ordinal, the lines that name an id, the act behind an effect,
// records by id, and where every body was at any moment. Reads only the index's own files.

import { Database } from "bun:sqlite";
import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";
import { ACTION_INTS, DAY, FRAME_LINES, LINE_INTS, MOVE_INTS, PULSE_INTS, type IndexMeta, type SeatAct } from "./indexer";
import { CLASS_CODE, personOfParticipant, type DeciderClass, type WorldStatic } from "./world";

const i32 = (p: string) => { const b = readFileSync(p); return new Int32Array(b.buffer, b.byteOffset, b.byteLength / 4); };

export class Store {
  readonly meta: IndexMeta;
  readonly world: WorldStatic & { extraStructures: string[]; accounts: [string, string][] };
  readonly accountsOf = new Map<string, string[]>();
  readonly lines: Int32Array;
  readonly actions: Int32Array;
  readonly pulses: Int32Array;
  readonly moves: Int32Array;
  readonly seatActs: SeatAct[];
  readonly db: Database;
  private fd: number;
  private cache = new Map<number, string[]>();
  private partCls = new Map<string, DeciderClass>();
  readonly personIdx = new Map<string, number>();
  readonly holderIdx = new Map<string, number>();
  readonly structIdx = new Map<string, number>();
  private whereCache?: Uint32Array;
  private moneyCache?: Float64Array;
  private agencyCache?: Int16Array;

  constructor(readonly dir: string) {
    this.meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    this.world = JSON.parse(readFileSync(join(dir, "world.json"), "utf8"));
    this.lines = i32(join(dir, "lines.bin"));
    this.actions = i32(join(dir, "actions.bin"));
    this.pulses = i32(join(dir, "pulses.bin"));
    this.moves = i32(join(dir, "moves.bin"));
    this.seatActs = JSON.parse(readFileSync(join(dir, "seatacts.json"), "utf8"));
    this.db = new Database(join(dir, "index.sqlite"), { readonly: true });
    this.fd = openSync(join(dir, "frames.bin"), "r");
    for (const p of this.meta.participants) this.partCls.set(p.id, p.cls);
    this.meta.holders.forEach((h, i) => { this.holderIdx.set(h, i); if (i < this.meta.persons) this.personIdx.set(h, i); });
    this.world.structures.forEach((s, i) => this.structIdx.set(s.id, i));
    for (const [acc, h] of this.world.accounts ?? []) (this.accountsOf.get(h) ?? this.accountsOf.set(h, []).get(h)!).push(acc);
    this.meta.extraStructures.forEach((s, i) => this.structIdx.set(s, this.world.structures.length + i));
  }
  close() { try { closeSync(this.fd); } catch { /* */ } this.db.close(); }

  /** A kept line's text by its ordinal. */
  text(ord: number): string {
    const f = Math.floor(ord / FRAME_LINES);
    let lines = this.cache.get(f);
    if (!lines) {
      const a = this.meta.frames[f]!, b = this.meta.frames[f + 1]!;
      const buf = Buffer.alloc(b - a);
      readSync(this.fd, buf, 0, b - a, a);
      lines = Buffer.from(zlib.zstdDecompressSync(buf)).toString("utf8").split("\n");
      this.cache.set(f, lines);
      if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!);
    }
    return lines[ord % FRAME_LINES]!;
  }
  line(ord: number): any { return JSON.parse(this.text(ord)); }
  seq(ord: number) { return this.lines[ord * LINE_INTS]!; }
  t(ord: number) { return this.lines[ord * LINE_INTS + 1]!; }
  actionOf(ord: number) { return this.lines[ord * LINE_INTS + 2]!; }
  nameOf(ord: number) { return this.meta.names[this.lines[ord * LINE_INTS + 3]!]!; }
  /** Who decided a kept line (the participant), or undefined for the world's. */
  whoOf(ord: number): string | undefined { const w = this.lines[ord * LINE_INTS + 4]!; return w >= 0 ? this.meta.participants[w]?.id : undefined; }
  get kept() { return this.lines.length / LINE_INTS; }

  /** The act command behind an action, the participant, its status and end. */
  action(i: number) {
    const a = this.actions;
    return { actOrd: a[i * ACTION_INTS]!, participant: this.meta.participants[a[i * ACTION_INTS + 1]!]?.id ?? "?", status: ["pending", "applied", "refused"][a[i * ACTION_INTS + 2]!] ?? "?", endT: a[i * ACTION_INTS + 3]! };
  }
  performers(i: number): string[] | undefined { const r = this.db.query("SELECT by FROM performers WHERE action = ?").get(i) as any; return r ? String(r.by).split(",") : undefined; }

  /** The ordinals of the kept lines that name `id`, in order. */
  postings(id: string): Uint32Array {
    const r = this.db.query("SELECT ords FROM postings WHERE id = ?").get(id) as any;
    if (!r) return new Uint32Array(0);
    const b = r.ords as Uint8Array;
    return new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
  /** The union of several ids' postings, in order. */
  postingsOf(ids: string[]): number[] { const s = new Set<number>(); for (const id of ids) for (const o of this.postings(id)) s.add(o); return [...s].sort((a, b) => a - b); }
  /** A record by id: the line that made it, or the header's copy for one made before the run. */
  record(id: string): { ord?: number; record: any } | undefined {
    const r = this.db.query("SELECT ord FROM records WHERE id = ?").get(id) as any;
    if (r) return { ord: r.ord, record: this.line(r.ord).body.record };
    const g = this.db.query("SELECT json FROM genesis WHERE id = ?").get(id) as any;
    return g ? { record: JSON.parse(g.json) } : undefined;
  }
  /** The lines that cite a record as their basis. */
  answers(id: string): number[] { return (this.db.query("SELECT ord FROM answers WHERE record = ? ORDER BY ord").all(id) as any[]).map((r) => r.ord); }

  clsOf(participant: string, about?: string): DeciderClass {
    if (about && personOfParticipant(participant) === about) return "self";
    return this.partCls.get(participant) ?? (/-self$/.test(participant) ? "person" : participant === "genesis" ? "world" : "system");
  }
  participantInfo(id: string) { return this.world.participants.find((p) => p.id === id); }

  // ---- tracks
  where(): Uint32Array { return (this.whereCache ??= new Uint32Array(readFileSync(join(this.dir, "where.bin")).buffer.slice(0))); }
  money(): Float64Array { return (this.moneyCache ??= new Float64Array(readFileSync(join(this.dir, "money.bin")).buffer.slice(0))); }
  agency(): Int16Array { return (this.agencyCache ??= new Int16Array(readFileSync(join(this.dir, "agency.bin")).buffer.slice(0))); }
  /** Every person's space index + 1 (0: in none) at time t: the day's midnight, then that day's moves up to t. */
  whereAt(t: number): Uint32Array {
    const P = this.meta.persons, d = Math.max(0, Math.min(this.meta.days, Math.floor(t / DAY)));
    const out = this.where().slice(d * P, (d + 1) * P);
    const from = this.meta.movesDay[d] ?? 0, to = this.meta.movesDay[d + 1] ?? this.meta.moves;
    for (let i = from; i < to; i++) { const m = i * MOVE_INTS; if (this.moves[m]! > t) break; out[this.moves[m + 1]!] = this.moves[m + 2]!; }
    return out;
  }
  structOfSpace(s1: number): number { return s1 ? this.meta.spaces[s1 - 1]!.struct : -1; }
  /** A series by day for one person or holder. */
  series(track: "money" | "agency", i: number): number[] {
    const out: number[] = [];
    if (track === "money") { const H = this.meta.holders.length, m = this.money(); for (let d = 0; d <= this.meta.days; d++) out.push(m[d * H + i]!); }
    else { const P = this.meta.persons, a = this.agency(); for (let d = 0; d <= this.meta.days; d++) out.push(a[d * P + i]!); }
    return out;
  }
  pulsesAt(filter: (p: { t: number; person: number; struct: number; cls: number; flags: number; ord: number }) => boolean, limit = 500) {
    const out: { t: number; person: number; struct: number; cls: number; flags: number; ord: number }[] = [];
    for (let i = this.pulses.length / PULSE_INTS - 1; i >= 0 && out.length < limit; i--) {
      const k = i * PULSE_INTS;
      const p = { t: this.pulses[k]!, person: this.pulses[k + 1]!, struct: this.pulses[k + 2]!, cls: this.pulses[k + 3]!, flags: this.pulses[k + 4]!, ord: this.pulses[k + 5]! };
      if (filter(p)) out.push(p);
    }
    return out;
  }
  file(name: string): Buffer | undefined { const p = join(this.dir, name); return existsSync(p) ? readFileSync(p) : undefined; }
}

export { CLASS_CODE };
