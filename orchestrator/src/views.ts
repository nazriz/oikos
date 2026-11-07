// What each kind of seat in a world is shown whole (docs/no-god-view.md; docs/design/knowing.md). Information lives
// with whoever keeps it, and reaches a seat in four ways: it is theirs, they are there (or go to look), it was
// published, or they asked its keeper for one thing. The contract lets a channel say nothing else, and the kernel
// refuses a world that gives a register to a seat that does not keep it. This is the backstop behind that: it reads a
// world's config and lists every view that is still a whole collection: a keeper's register (which must be declared),
// a seat's own files when they hold a whole collection, premises that are most of the ground, a parameter naming
// everyone of a kind, or the run's future. It decides nothing; orchestrator/test/no-god-view.test.ts holds the list to
// what is declared.

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

type Channel = { id: string; kind: string; way?: string; on_request?: boolean; match?: { records?: string[]; statement_kinds?: string[]; has?: string[] }; area?: unknown; from?: string[] };
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
  // (What the world publishes is read, not kept: never a whole view.)
  const published = new Set<string>((config.knowing?.published ?? []).map((p: { what: string }) => p.what));
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
  /** How many accounts an organisation keeps for others. */
  const operators = new Set<string>(((config.world.network?.supplies ?? []) as { holder: string }[]).map((s) => s.holder));
  const kept = (entity: string) => ((config.world.accounts ?? []) as { holder: string; custodian?: string }[]).filter((a) => a.custodian === entity && a.holder !== entity).length;

  const found = new Map<string, WholeView>();
  const add = (module: string, through: string, what: string, seat: string) => {
    if (published.has(what)) return;
    const key = `${module}|${through}|${what}`;
    const had = found.get(key);
    if (had) had.seats++;
    else found.set(key, { module, through, what, seat, seats: 1 });
  };

  /** The collections a filter names: a statement kind, statements having something, a record type; none: every record. */
  const collections = (m: NonNullable<Channel["match"]>): string[] =>
    m.statement_kinds ?? m.has?.map((h) => `has:${h}`) ?? m.records?.map((t) => `records:${t}`) ?? ["records:*"];
  const channelsOf = (module: string, seat: string, entity: string | undefined, channels: Channel[]) => {
    for (const ch of channels ?? []) {
      const through = `channel:${ch.id}`;
      // A ledger: the accounts its organisation keeps for others (it is their custodian). Whole, and to be declared:
      // a bank keeps its customers' accounts, and nobody else is shown anyone's balance but their own.
      if (ch.kind === "accounts") {
        if (entity && kept(entity) >= WHOLE.least) add(module, through, "accounts", seat);
        continue;
      }
      // An operator's network (foundations-2 C3): a supply's holder is shown every connection on its tree and its links,
      // through its holdings channel. Whole, and to be declared (`connections`): nobody else sees anyone's but their own.
      if (ch.kind === "holdings") {
        if (entity && operators.has(entity)) add(module, through, "connections", seat);
        continue;
      }
      // What a seat is asked about, goes to, reads as published, or sees where it is, is not a whole view: the kernel
      // holds each to its scope. Premises that are half the ground are a map all the same.
      if (ch.kind === "sites" || ch.way === "here") {
        const premises = (ch.area as { premises?: string[] } | undefined)?.premises;
        if (ch.kind === "sites" && premises && cells > 0 && premises.length * 2 >= cells) add(module, through, "map", seat);
        continue;
      }
      if (ch.kind !== "records" || ch.way === "ask" || ch.way === "published") continue;
      // Its keeper's register: whole, and to be declared.
      if (ch.way === "kept") {
        for (const what of collections(ch.match ?? {})) add(module, through, what, seat);
        continue;
      }
      // Its own files (`mine`): whole only if they hold a whole collection (counted on the records the world starts with).
      // (Looked through only on request, they are searched: each search is cut to what the contract allows.)
      if (!entity || ch.on_request) continue;
      const m = ch.match ?? {};
      const shown = new Map<string, number>();
      for (const r of records) {
        if (m.records && !m.records.includes(r.record)) continue;
        if (m.statement_kinds && !(r.record === "statement" && m.statement_kinds.includes(r.kind ?? ""))) continue;
        if (r.visible_to !== "public" && !r.visible_to.includes(entity) && r.speaks_for !== entity) continue;
        if (!named(r).includes(entity)) continue;
        shown.set(collection(r), (shown.get(collection(r)) ?? 0) + 1);
      }
      for (const [what, n] of shown) if (n >= WHOLE.least && n * 10_000 >= (total.get(what) ?? 0) * WHOLE.share_bps) add(module, through, what, seat);
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
  // (An office's clerk is the office's own, shown what the office is shown and nothing more: a whole view it has is its
  // office's, to be declared by the module that runs the office. docs/behaviour/office-books.md.)
  const moduleOf = (controller: any, role?: { code?: string; params?: { of?: string } }): string => (role?.code === "office.clerk" && role.params?.of ? role.params.of : role?.code) ?? (controller?.type === "code" ? controller.impl : controller?.params?.mock?.brain) ?? "(none)";
  // (A person in a post runs the post's module: their own controller is the citizen's, and its parameters are not the post's.)
  const paramsFor = (controller: any, role?: { params?: object }, person?: boolean) => ({ ...(role?.params ?? {}), ...(controller?.type === "code" ? (person ? {} : controller.params) : controller?.params?.mock?.params) });
  for (const pos of config.positions ?? []) {
    const holder = participant.get(pos.holder);
    const module = moduleOf(holder?.controller, pos.role_module);
    channelsOf(module, pos.id, pos.entity, pos.channels);
    paramsOf(module, pos.id, paramsFor(holder?.controller, pos.role_module, holder?.kind === "person"));
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
