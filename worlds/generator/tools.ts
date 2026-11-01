// Technologies that are goods (docs/design/foundations-2.md 7.2, step E2; docs/behaviour/automation.md, "Tools"): a tool
// the outside world sells at its price, held by a firm where its staff work, one for each of them, with which the work
// takes a share of its time (a task's `tool`). A firm weighs buying one as it weighs any technology, by the numbers: the
// time it saves its staff, at their wage, against its price over the payback it asks, by the hurdle (`automation.firms`).
// Where the profile's automation lists none, the town is as before.

/** A tool on offer (the profile's `automation.tools`, each with its source). */
export interface ToolOffer {
  /** The kind (a good): what is sold and held. */
  kind: string;
  title: string;
  /** The task it is used at (a factory's `make`, say). */
  task: string;
  /** The share of the time the work takes with it, in basis points. */
  labour_bps: number;
  /** Its price, in the currency's smallest unit. */
  price: number;
}

/** Params of every code unit of a kind (a participant's controller, a post's module). */
function unitsOf(config: any, kind: string): any[] {
  return [
    ...[...(config.participants ?? []), ...(config.templates ?? [])].map((p: any) => p.controller).filter((c: any) => c?.impl === kind),
    ...(config.positions ?? []).map((p: any) => p.role_module).filter((m: any) => m?.code === kind),
  ].map((u) => (u.params ??= {}));
}

/** The config with the tools on offer: their kinds, the outside's price for each, the tasks they are used at, and the
 * firms that do those tasks weighing them (none: the config as it is). */
export function withTools(config: any, tools: ToolOffer[] | undefined, firms: { payback_months: { small: number }; hurdle_bps: number } | undefined, sellerOf: (kind: string) => string): any {
  if (!tools?.length || !firms) return config;
  const c = structuredClone(config);
  for (const t of tools) {
    if (!c.catalogue.tasks.some((x: any) => x.id === t.task)) throw new Error(`automation.tools: no task ${t.task} for ${t.kind}`);
    c.catalogue.resources.push({ id: t.kind, unit: "item" });
    c.catalogue.tasks = c.catalogue.tasks.map((x: any) => (x.id === t.task ? { ...x, tool: { kind: t.kind, per_performer: 1, labour_bps: t.labour_bps } } : x));
    const weighs = { kind: t.kind, seller: sellerOf(t.kind), labour_bps: t.labour_bps, payback_months: firms.payback_months.small, hurdle_bps: firms.hurdle_bps };
    for (const p of unitsOf(c, "firm.producer").filter((p) => (p.task ?? "make") === t.task)) p.tool = weighs;
    // (And a factory founded in the run weighs it as one the town began with.)
    for (const p of unitsOf(c, "citizen.default")) for (const v of p.ventures ?? []) if (v.role_module?.code === "firm.producer" && (v.role_module.params.task ?? "make") === t.task) v.role_module.params.tool = weighs;
  }
  return c;
}
