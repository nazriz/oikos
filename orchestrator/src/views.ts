// What each kind of seat in a world is shown whole (docs/no-god-view.md). Nobody has a god's view: a seat is shown its
// own records, its addressed mail and its own premises, and asks whoever keeps anything else for the one thing it
// needs. This reads a world's config and lists every view that is a whole collection: a register, a population, a map,
// or the run's future. It decides nothing; orchestrator/test/no-god-view.test.ts holds the list to what is declared.

/** One whole view: which module's seats have it, how it reaches them, and what it is a whole of. */
export interface WholeView {
  /** The behaviour module that does the seat's job (a model seat: its role's module). */
  module: string;
  /** How it reaches the seat: a channel shown unasked (`channel:<id>`), or a parameter it is handed (`param:<name>`). */
  through: string;
  /** What it is a whole of: a statement kind (`price_list`), a record type (`records:claim`), every record
   * (`records:*`), statements having something (`has:practice`), `directory`, `map`, every entity of a kind
   * (`every:shop`), or what is still to come (`future`). */
  what: string;
  /** One seat it was found at, and how many seats have it. */
  seat: string;
  seats: number;
}

/** A collection counts as held whole through a seat's own files when the seat is shown at least this many of its
 * records at the start, and at least this share of all there are (a landlord's own leases are a few of the town's; the
 * town's offices were shown every lot there is, because the town issued them). */
export const WHOLE = { least: 25, share_bps: 9000 };
/** A kind of entity is a population once a world has this many (a list naming every one of them is a list of them all;
 * naming the one bank is not). */
export const POPULATION = 5;

/**
 * What is put out to the whole public by whoever makes it, so that being shown it is being one of its readers, not
 * having a view of the town: the law as promulgated, an office's public notices, the paper, a notice board. Each with
 * the reason. A market is not one of these: every seller's prices and every home for sale are many parties' offers,
 * found by going and looking (a search), and neither is a register, a roll or a file (docs/no-god-view.md).
 */
export const PUBLISHED: { [what: string]: string } = {
  law: "The law in force is promulgated to everyone it binds.",
  charter: "The town's charter is public, as its laws are.",
  procedure: "A public body's adopted procedures are published with its laws.",
  law_schedule: "How a law is written from its figures is published with the law.",
  form: "An office's forms are put out for anyone to use.",
  news: "The local paper is printed for whoever reads it.",
  election_notice: "The electoral office's notice of an election is given to the whole town.",
  nomination: "Who stands for office is announced to the electors.",
  ballot: "A question put to a vote is put before those who vote on it, and the public.",
  ballot_result: "The result of a vote is declared in public.",
  weather_warning: "The bureau's warnings are broadcast.",
  budget: "A public body's adopted budget is a public document.",
  petition: "A petition is put up for the public to read and sign.",
  petition_count: "A petition's organiser publishes how many have signed.",
  petition_response: "A public body's answer to a petition is given in public.",
  permit_decision: "Planning decisions are entered in a register open to the public.",
  environment_report: "The environment office publishes its report.",
  support_statistics: "Published statistics.",
  price_index: "Published statistics.",
  closure: "A firm's winding up is given by public notice.",
  "has:practice": "A notice of a gathering is put up for whoever may come.",
  "has:assertion": "What is put forward to be believed (a teaching, a platform, a report) is addressed to the public.",
};

type Channel = { id: string; kind: string; on_request?: boolean; match?: { records?: string[]; statement_kinds?: string[]; involving?: string[]; has?: string[] }; area?: unknown };
type Rec = { id: string; record: string; kind?: string; visible_to: "public" | string[]; speaks_for?: string; holder?: string; counterparty?: string; addressed_to?: string[]; terms?: { parties?: string[] }; as?: string; [k: string]: unknown };

/** What a record is filed under: a statement's kind, or its record type. */
const collection = (r: Rec): string => (r.record === "statement" ? r.kind ?? "statement" : `records:${r.record}`);

/** The entities a record names (who holds it, whom it is against or addressed to, its parties, whom it speaks for). */
function named(r: Rec): string[] {
  return [r.speaks_for, r.holder, r.counterparty, r.as, ...(r.addressed_to ?? []), ...(r.terms?.parties ?? [])].filter((x): x is string => typeof x === "string");
}

/** Every text in a value, with the texts that are an object's keys. */
function texts(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof v === "string") out.add(v);
  else if (Array.isArray(v)) for (const x of v) texts(x, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); texts(x, out); }
  return out;
}

/** Does a value hold a list of things dated after the start (each with a day or a time it comes on)? */
function dated(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => (x && typeof x === "object" && !Array.isArray(x) && ["from_day", "on_day", "day"].some((k) => typeof (x as any)[k] === "number" && (x as any)[k] > 0)) || dated(x));
  if (v && typeof v === "object") return Object.values(v).some(dated);
  return false;
}

/** Every whole view in a world's config, one line for each module, way in and thing (docs/no-god-view.md). */
export function wholeViews(config: any): WholeView[] {
  const records: Rec[] = config.world.records ?? [];
  const entities: { id: string; kind: string }[] = config.world.entities ?? [];
  const total = new Map<string, number>();
  for (const r of records) total.set(collection(r), (total.get(collection(r)) ?? 0) + 1);
  const cells = (config.world.ground?.w ?? 0) * (config.world.ground?.h ?? 0);
  // Populations: each kind of entity there are many of, and the accounts their members hold.
  const byKind = new Map<string, string[]>();
  for (const e of entities) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e.id]);
  const accountsOf = new Map<string, string[]>();
  for (const a of (config.world.accounts ?? []) as { id: string; holder: string }[]) accountsOf.set(a.holder, [...(accountsOf.get(a.holder) ?? []), a.id]);
  const populations = [...byKind].filter(([, ids]) => ids.length >= POPULATION);

  const found = new Map<string, WholeView>();
  const add = (module: string, through: string, what: string, seat: string) => {
    const key = `${module}|${through}|${what}`;
    const had = found.get(key);
    if (had) had.seats++;
    else found.set(key, { module, through, what, seat, seats: 1 });
  };

  const channelsOf = (module: string, seat: string, entity: string | undefined, channels: Channel[]) => {
    for (const ch of channels ?? []) {
      // Records asked for are a search (attention, not a view). A map or a directory can't be searched: asked for, it
      // comes whole, so being shown it only on request doesn't make it less than all of it.
      if (ch.on_request && ch.kind === "records") continue;
      const through = `channel:${ch.id}`;
      if (ch.kind === "directory") add(module, through, "directory", seat);
      else if (ch.kind === "sites") {
        if (ch.area === "all" || (ch.area && typeof ch.area === "object" && "place" in ch.area) || (Array.isArray(ch.area) && cells > 0 && ch.area.length * 2 >= cells)) add(module, through, "map", seat);
      } else if (ch.kind === "records") {
        const m = ch.match ?? {};
        const bounded = Array.isArray(ch.area) || (ch.area && typeof ch.area === "object" && "near" in ch.area);
        if (bounded) continue; // what is put up on its own premises, or near where it is
        if (!m.involving) {
          // Shown every record of what it names that it is let see.
          if (m.statement_kinds) for (const k of m.statement_kinds) add(module, through, k, seat);
          else if (m.has) for (const h of m.has) add(module, through, `has:${h}`, seat);
          else if (m.records) for (const t of m.records) add(module, through, `records:${t}`, seat);
          else add(module, through, "records:*", seat);
          continue;
        }
        // Its own files: whole only if they hold a whole collection (counted on the records the world starts with).
        if (!entity) continue;
        const want = new Set(m.involving.map((e) => (e === "self" ? entity : e)));
        const shown = new Map<string, number>();
        for (const r of records) {
          if (m.records && !m.records.includes(r.record)) continue;
          if (m.statement_kinds && !(r.record === "statement" && m.statement_kinds.includes(r.kind ?? ""))) continue;
          if (r.visible_to !== "public" && !r.visible_to.includes(entity) && r.speaks_for !== entity) continue;
          if (!named(r).some((e) => want.has(e))) continue;
          shown.set(collection(r), (shown.get(collection(r)) ?? 0) + 1);
        }
        for (const [what, n] of shown) if (n >= WHOLE.least && n * 10_000 >= (total.get(what) ?? 0) * WHOLE.share_bps) add(module, through, what, seat);
      }
    }
  };

  const paramsOf = (module: string, seat: string, params: { [k: string]: unknown } | undefined) => {
    for (const [key, value] of Object.entries(params ?? {})) {
      if (dated(value)) add(module, `param:${key}`, "future", seat);
      const said = texts(value);
      for (const [kind, ids] of populations) {
        if (ids.every((id) => said.has(id)) || ids.every((id) => (accountsOf.get(id) ?? []).some((a) => said.has(a)))) add(module, `param:${key}`, `every:${kind}`, seat);
      }
    }
  };

  const participant = new Map<string, any>((config.participants ?? []).map((p: any) => [p.id, p]));
  const moduleOf = (controller: any, role?: { code?: string }): string => role?.code ?? (controller?.type === "code" ? controller.impl : controller?.params?.mock?.brain) ?? "(none)";
  const paramsFor = (controller: any, role?: { params?: object }) => ({ ...(role?.params ?? {}), ...(controller?.type === "code" ? controller.params : controller?.params?.mock?.params) });
  for (const pos of config.positions ?? []) {
    const holder = participant.get(pos.holder);
    const module = moduleOf(holder?.controller, pos.role_module);
    channelsOf(module, pos.id, pos.entity, pos.channels);
    paramsOf(module, pos.id, paramsFor(holder?.controller, pos.role_module));
  }
  for (const p of [...(config.participants ?? []), ...(config.templates ?? [])]) {
    if (p.kind !== "person") continue;
    const module = moduleOf(p.controller);
    channelsOf(module, p.id, p.person, p.channels);
    paramsOf(module, p.id, p.controller?.params);
    // (A venture a person may found: the seat its founder will hold.)
    for (const v of (p.controller?.params?.ventures ?? []) as any[]) {
      channelsOf(v.role_module?.code ?? "(none)", `${p.id}'s venture`, undefined, v.channels);
      paramsOf(v.role_module?.code ?? "(none)", `${p.id}'s venture`, v.role_module?.params);
    }
  }
  return [...found.values()].sort((a, b) => (`${a.module}|${a.through}|${a.what}` < `${b.module}|${b.through}|${b.what}` ? -1 : 1));
}
