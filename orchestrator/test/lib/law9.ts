// The audits of law 9's backstop (orchestrator/test/everything-is-somewhere.test.ts and -runs.test.ts; docs/design/foundations-2.md
// section 3): each reads a world's config, the sources of the modules or a run's log, and names what breaks "everything physical is
// somewhere, and moves only along a network".

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { root } from "./law8";

export const SPACE_INVENTORY = join(import.meta.dir, "../fixtures/space-inventory.json");
/** Where the engine's behaviour is written: the Rust world's actors (the TypeScript kinds do not act). */
export const ACTOR_SOURCES = ["kernel/crates/actors/src"];

// ----------------------------------------------------------------------------------------------------------------- in a world's config

/** Every body, holding and system is somewhere at the start: a body in a space, a holding at a structure or an edge, a system
 * at a structure or an edge (its hardware). Names what is nowhere. */
export function unlocated(c: any): string[] {
  const out = new Set<string>();
  const inSpace = new Set<string>((c.world.occupancy ?? []).map((o: any) => o.occupant));
  for (const e of c.world.entities ?? []) {
    if (e.kind !== "person" || e.present === false || e.alive === false) continue;
    if (!inSpace.has(e.id)) out.add("bodies in no space at the start, so nowhere (the unhoused)");
  }
  const structures = new Set<string>((c.world.structures ?? []).map((s: any) => s.id));
  const edges = new Set<string>(c.world.boundaries ?? []);
  const placed = (at: unknown) => typeof at === "string" && (structures.has(at) || edges.has(at));
  for (const h of c.world.holdings ?? []) if (!placed(h.at)) out.add(`${h.kind} held at ${h.at}, which is no structure or edge`);
  for (const p of c.participants ?? []) if (p.kind === "system" && !placed(p.at)) out.add(`${p.template ?? p.id}: a system with no place (the hardware it runs on held nowhere)`);
  return [...out].sort();
}

/** In a world with a network, every edge is a node of it, so that what an edge sells and takes arrives somewhere. Names the edge. */
export function edgesWithoutNode(c: any): string[] {
  const net = c.world.network;
  if (!net) return [];
  const at = new Set<string>((net.nodes ?? []).map((n: any) => n.edge).filter(Boolean));
  return (c.world.boundaries ?? []).filter((e: string) => !at.has(e)).map((e: string) => `${e}: an edge with no node, so what it sells and takes arrives nowhere`).sort();
}

/** No ground is travelled quicker than on foot by its cover: a way people drive on is links of the network, with a speed and a
 * capacity, not a cheap cell. Names the cover. */
export function waysOffNetwork(c: any): string[] {
  const t = c.catalogue?.travel;
  if (!t) return [];
  return Object.entries(t.by_cover ?? {}).filter(([, s]) => (s as number) < t.seconds_per_cell).map(([cover]) => `${cover}: ground crossed quicker than on foot, a way that is no link of the network`).sort();
}

export const CONFIG_AUDITS: Record<string, (c: any) => string[]> = { unlocated, edgesWithoutNode, waysOffNetwork };

// ----------------------------------------------------------------------------------------------------------------- in the modules' sources

/** Every move of goods a module writes names its carrier (law 9: a vehicle and its driver, a person carrying it, or a link that
 * carries the kind), unless it is within one place. Names the file. */
export function uncarried(dirs = ACTOR_SOURCES, base = root): string[] {
  const out = new Set<string>();
  for (const d of dirs) {
    const dir = join(base, d);
    if (!existsSync(dir)) continue;
    for (const f of [...new Glob("**/*.rs").scanSync(dir)].sort()) {
      const text = readFileSync(join(dir, f), "utf8");
      // (Its tests write moves to check what a module does with them: only the module's own code is read.)
      const code = text.split(/\n#\[cfg\(test\)\]/)[0]!;
      for (const line of code.split("\n")) {
        const c = line.replace(/\/\/.*$/, "");
        if (/call\("goods"/.test(c) && !/"carrier"|"within"/.test(c)) out.add(`${d}/${f}: goods moved with no carrier`);
      }
    }
  }
  return [...out].sort();
}

// ----------------------------------------------------------------------------------------------------------------- in a run's log

/** Which module acts: the role module of the post an act was done in, else the participant's controller. */
export function moduleOf(c: any): (participant: string, post?: string) => string {
  const role = new Map<string, string>();
  for (const p of c.positions ?? []) if (p.role_module?.code) role.set(p.id, p.role_module.code);
  const ctl = new Map<string, string>((c.participants ?? []).map((p: any) => [p.id, p.controller?.impl ?? p.controller?.type ?? p.kind]));
  return (who, post) => (post && role.get(post)) || ctl.get(who) || who;
}

/** What a month's log shows moved from one place to another with no carrier, and work done on a building somewhere else than where
 * its crew is: by module. Read from a log's lines (an act's effects follow its `action_applied`, which names the post). */
export function farActs(lines: string[], c: any): { uncarriedMoves: string[]; workElsewhere: string[] } {
  const mod = moduleOf(c);
  const structures = new Set<string>((c.world.structures ?? []).map((s: any) => s.id));
  const moves = new Set<string>(), far = new Set<string>();
  let post: string | undefined;
  for (const l of lines) {
    const applied = l.includes('"action_applied"');
    if (!applied && !l.includes('"goods_moved"') && !l.includes('"worked"')) continue;
    const e = JSON.parse(l);
    if (e.kind !== "event") continue;
    const b = e.body;
    if (b.event === "action_applied") { post = b.as; continue; }
    if (b.event === "goods_moved" && b.from_at !== b.to_at && !b.carrier) moves.add(`${mod(b.by, post)}: goods moved from one place to another with no carrier`);
    if (b.event === "worked" && b.on && b.on !== b.at && (structures.has(b.on) || /^str\./.test(b.on)) && !b.on.startsWith(`${b.at}/`)) far.add(`${mod(b.by, post)}: ${b.task} done on a building elsewhere, its crew where they were`);
  }
  return { uncarriedMoves: [...moves].sort(), workElsewhere: [...far].sort() };
}
