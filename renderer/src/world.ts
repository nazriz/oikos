// The static world of a run, from its log's header alone: the ground, structures and their spaces, people, organisations,
// posts and who holds them, and the class of every participant (who decides: a person, an organisation's code system, a
// model seat, or the outside world). Pure functions over the header's body; nothing here reads a file.
//
// "Who decided" is by role in the world, not by what runs it (docs/design/renderer.md 10.2): every person is simulated,
// and the legend says so.

export type DeciderClass = "self" | "person" | "system" | "seat" | "world";
export const CLASSES: DeciderClass[] = ["self", "person", "system", "seat", "world"];
export const CLASS_CODE: Record<DeciderClass, number> = { self: 0, person: 1, system: 2, seat: 3, world: 4 };

export interface Structure { id: string; type: string; category: string; x: number; y: number; w: number; h: number; spaces: number; levels: number }
export interface Person { id: string; participant: string; born?: number; sex?: string; household?: string; name?: string }
export interface Org { id: string; kind: string; name: string; premises: number[] }
export interface Post { id: string; entity?: string; title?: string; role?: string; holder?: string; code?: string }
export interface ParticipantInfo { id: string; kind?: string; cls: DeciderClass; impl?: string; model?: string; title?: string; person?: string }

export interface WorldStatic {
  runId: string; name: string; description: string; seed: number; currency: { code?: string; symbol?: string; minor_units?: number; group_mark?: string; decimal_mark?: string };
  ground: { w: number; h: number; cell: number; terrain: { x: number; y: number; w: number; h: number; label: string }[] };
  water: [number, number][];
  lots: { id: string; cells: [number, number][] }[];
  structures: Structure[];
  persons: Person[];
  orgs: Org[];
  posts: Post[];
  participants: ParticipantInfo[];
  households: { id: string; members: string[]; leaseholder?: string }[];
  /** Initial space of each person (by person index), as the header's occupancy has it. */
  occupancy: { occupant: string; space: string }[];
  /** Employment agreements in force at the start: [employer, employee, workplace structure index]. */
  jobs: [string, string, number][];
  /** Lot titles: holder of each lot. */
  titles: { lot: string; holder: string }[];
}

/** "cell.56.36" as [56, 36]. */
export function cellOf(at: unknown): [number, number] | undefined {
  const m = /^cell\.(-?\d+)\.(-?\d+)$/.exec(String(at ?? ""));
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/** The structure a space belongs to ("apts-14/dwelling.5" is in apts-14) and its kind and number. */
export function spaceParts(space: string): { structure: string; kind: string; n: number } {
  const slash = space.indexOf("/");
  if (slash < 0) return { structure: space, kind: "", n: 0 };
  const rest = space.slice(slash + 1);
  const dot = rest.lastIndexOf(".");
  return { structure: space.slice(0, slash), kind: dot < 0 ? rest : rest.slice(0, dot), n: dot < 0 ? 0 : Number(rest.slice(dot + 1)) || 0 };
}

/** The person a participant stands for ("c0273-self" is c0273); anything else keeps its own id. */
export const personOfParticipant = (p: string): string => p.replace(/-self$/, "");

/** A participant's class from its header entry. An unknown participant is classed by its name: "-self" a person, the
 * rest an organisation's system (staff systems the orchestrator adds are named "<office>-staff-system"). */
export function classOf(p: any | undefined, id: string): DeciderClass {
  if (!p) return /-self$/.test(id) || /^par\.\d+$/.test(id) ? "person" : id === "genesis" ? "world" : "system";
  if (p.controller?.type === "llm") return "seat";
  const impl = String(p.controller?.impl ?? "");
  if (p.kind === "person") return "person";
  if (impl.startsWith("world.")) return "world";
  return "system";
}

const LEVELS: Record<string, number> = { house: 1, "large-house": 1.3, apartments: 3.2, shop: 1.1, factory: 1.8, yard: 0.5, civic: 2.4, offices: 3.4, road: 0, park: 0, station: 1.6, works: 0.8, substation: 0.6, clinic: 2, school: 2 };

export function worldOf(header: any): WorldStatic {
  const c = header?.config ?? {};
  const w = c.world ?? {};
  const types = new Map<string, any>((c.catalogue?.structure_types ?? []).map((t: any) => [t.id, t]));
  const structures: Structure[] = [];
  for (const s of w.structures ?? []) {
    const at = cellOf(s.at);
    if (!at) continue;
    const t = types.get(s.type);
    const spaces = (t?.spaces ?? []).reduce((n: number, x: any) => n + (x.count ?? 1), 0);
    const levels = LEVELS[s.type] ?? (t?.category === "residential" ? Math.max(1, Math.min(6, spaces / 4)) : 1.2);
    structures.push({ id: s.id, type: s.type, category: t?.category ?? "other", x: at[0], y: at[1], w: t?.footprint?.w ?? 1, h: t?.footprint?.h ?? 1, spaces, levels });
  }
  const structIdx = new Map(structures.map((s, i) => [s.id, i]));
  const persons: Person[] = [];
  const participants: ParticipantInfo[] = [];
  const llm = new Map<string, any>();
  for (const p of c.participants ?? []) {
    const cls = classOf(p, p.id);
    participants.push({ id: p.id, kind: p.kind, cls, impl: p.controller?.impl, model: p.controller?.type === "llm" ? [p.controller.provider, p.controller.model].filter(Boolean).join("/") : undefined, title: p.title, person: p.person });
    if (cls === "seat") llm.set(p.id, p);
  }
  const households: WorldStatic["households"] = [];
  const householdOf = new Map<string, string>();
  const lots: WorldStatic["lots"] = [];
  const titles: WorldStatic["titles"] = [];
  const jobs: WorldStatic["jobs"] = [];
  for (const r of w.records ?? []) {
    if (r.kind === "household") {
      const members = (r.data?.members ?? []).map((m: any) => String(m.person));
      households.push({ id: r.id, members, leaseholder: r.data?.leaseholder });
      for (const m of members) householdOf.set(m, r.id);
    } else if (r.kind === "lot") {
      lots.push({ id: r.id, cells: (r.data?.cells ?? []).map(cellOf).filter(Boolean) as [number, number][] });
    } else if (r.record === "claim" && r.about?.kind === "ownership" && r.position === "right") {
      titles.push({ lot: String(r.about.object), holder: String(r.holder) });
    } else if (r.record === "agreement" && r.terms?.template === "employment") {
      const parties: string[] = r.terms.parties ?? [];
      for (const cm of r.terms.commitments ?? []) {
        const occ = cm?.does?.outcome?.occupancy;
        if (occ?.in && occ.who) {
          const employer = parties.find((x) => x !== occ.who) ?? "";
          const si = structIdx.get(spaceParts(String(occ.in)).structure);
          if (si !== undefined) jobs.push([employer, String(occ.who), si]);
        }
      }
    }
  }
  for (const e of w.entities ?? []) if (e.kind === "person") persons.push({ id: e.id, participant: `${e.id}-self`, born: e.born_at, sex: e.sex, household: householdOf.get(e.id), ...(e.name && e.name !== e.id ? { name: e.name } : {}) });
  const premises = new Map<string, Set<number>>();
  for (const [employer, , si] of jobs) (premises.get(employer) ?? premises.set(employer, new Set()).get(employer)!).add(si);
  // An organisation with no workplace in the header (a landlord) is placed at the buildings on the lots it holds.
  const lotCells = new Map(lots.map((l) => [l.id, l.cells]));
  const structAtCell = new Map(structures.map((s, i) => [`${s.x},${s.y}`, i]));
  const held = new Map<string, number[]>();
  for (const t of titles) for (const [x, y] of lotCells.get(t.lot) ?? []) { const si = structAtCell.get(`${x},${y}`); if (si !== undefined && structures[si]!.category !== "transport" && structures[si]!.category !== "green") (held.get(t.holder) ?? held.set(t.holder, []).get(t.holder)!).push(si); }
  const orgs: Org[] = (w.entities ?? []).filter((e: any) => e.kind !== "person").map((e: any) => ({ id: e.id, kind: e.kind, name: e.name ?? e.id, premises: premises.has(e.id) ? [...premises.get(e.id)!] : (held.get(e.id) ?? []).slice(0, 12) }));
  const posts: Post[] = (c.positions ?? []).map((p: any) => ({ id: p.id, entity: p.entity, title: p.title, role: p.role, holder: p.holder, code: p.role_module?.code }));
  const water: [number, number][] = [];
  const seen = new Set<string>();
  for (const f of w.flows ?? []) for (const at of [f.from, f.to]) { const xy = cellOf(at); if (xy && !seen.has(at)) { seen.add(at); water.push(xy); } }
  return {
    runId: String(header?.run_id ?? ""), name: c.meta?.name ?? "", description: c.meta?.description ?? "", seed: c.seed ?? 0, currency: w.currencies?.[0] ?? {},
    ground: { w: w.ground?.w ?? 1, h: w.ground?.h ?? 1, cell: w.ground?.cell ?? 1, terrain: (w.ground?.terrain ?? []).map((t: any) => ({ x: t.x, y: t.y, w: t.w, h: t.h, label: t.label })) },
    water, lots, structures, persons, orgs, posts, participants, households, occupancy: w.occupancy ?? [], jobs, titles,
  };
}

/** The accounts in the header, holder by account. */
export function accountsOf(header: any): { id: string; holder: string; balance: string }[] {
  return (header?.config?.world?.accounts ?? []).map((a: any) => ({ id: a.id, holder: a.holder, balance: String(a.balance ?? "0") }));
}
