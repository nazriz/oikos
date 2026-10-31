// The outside world's capability, over time (docs/design/foundations-2.md 7.2 and 7.5, step E2; docs/scenarios.md,
// "Capability"): a technology the outside sells is released anew every so many days from the first, each release
// quicker, slipping less and at its own prices, as a scenario gives it (the owner's ruling, 2026-10-25: capabilities come
// from an outside scenario for now). Each release is a kind of system of its own (a template, `released` on its day:
// nobody can deliver one before), and its seller sells the newest out (`releases` in the seller's parameters); a system
// already delivered stays what it was. The scenario's tag names the kinds a study counts as one technology (`ai`), in
// `meta.study_tags`, for measurement only: nothing in the world reads it.

/** A capability path, as a scenario (or a town's description) gives it. */
export interface CapabilitySpec {
  /** What a study calls the technology (`ai`): the tag its kinds are listed under in `meta.study_tags`. */
  tag: string;
  /** Which offers it moves: a vendor's offer by id, or `assistants` (every provider's offer, where the town has them). */
  of: string[];
  /** A release every so many days, from the first day on. */
  every_days: number;
  /** Each release's time for a piece of work, as a share of the one before (basis points, at most 10,000). */
  time_bps: number;
  /** Each release's slip rate, as a share of the one before (basis points, at most 10,000). */
  slip_bps: number;
  /** Each release's prices, as a share of the one before (basis points). */
  price_bps: number;
}

const DAY = 86_400;

/** Checked: a scenario's capability says what it moves and by how much, within reason. */
export function checkCapability(c: CapabilitySpec, where: string): CapabilitySpec {
  const fail = (what: string): never => { throw new Error(`${where}: capability ${what}`); };
  if (typeof c?.tag !== "string" || !/^[a-z][a-z0-9_-]*$/.test(c.tag)) fail("names its tag (lower-case: ai)");
  if (!Array.isArray(c.of) || !c.of.length || c.of.some((x) => typeof x !== "string")) fail("names the offers it moves (of)");
  if (!(Number.isInteger(c.every_days) && c.every_days >= 30)) fail("every_days is a whole number of days, at least 30");
  for (const k of ["time_bps", "slip_bps"] as const) if (!(Number.isInteger(c[k]) && c[k] >= 1 && c[k] <= 10_000)) fail(`${k} is from 1 to 10,000`);
  if (!(Number.isInteger(c.price_bps) && c.price_bps >= 1 && c.price_bps <= 100_000)) fail("price_bps is from 1 to 100,000");
  return c;
}

/** Params of every code unit of a kind (a participant's controller, a post's module). */
function unitsOf(config: any, kind: string): any[] {
  return [
    ...(config.participants ?? []).map((p: any) => p.controller).filter((c: any) => c?.impl === kind),
    ...(config.positions ?? []).map((p: any) => p.role_module).filter((m: any) => m?.code === kind),
  ].map((u) => (u.params ??= {}));
}

/** The config with the technology's releases, as `spec` gives them over a run of `days` (undefined: as it is). */
export function withCapability(config: any, given: CapabilitySpec | undefined, days: number): any {
  if (!given) return config;
  const spec = given;
  const c = structuredClone(config);
  const n = Math.floor((days - 1) / spec.every_days); // releases within the run, after the first day's
  const pow = (bps: number, r: number) => (bps / 10_000) ** r;
  const scaled = (x: number, bps: number, r: number) => Math.max(1, Math.round(x * pow(bps, r)));
  const tagged = new Set<string>();
  const slip = (c.orchestration.slip ??= { person: {}, system: {}, sources: {} });
  const sources = c.orchestration.act_time.sources ?? {};
  const basis = `the outside world releases it anew every ${spec.every_days} days, each at ${spec.time_bps / 100}% of the time, ${spec.slip_bps / 100}% of the slips and ${spec.price_bps / 100}% of the prices of the one before`;
  /** A kind of system's releases: a template for each, its rows quicker, released on its day; its slips. */
  const made = new Map<string, { r: number; from: number; template: string }[]>();
  const release = (id: string) => made.get(id) ?? made.set(id, releaseOf(id)).get(id)!;
  function releaseOf(id: string) {
    const base = (c.templates ?? []).find((t: any) => t.id === id);
    if (!base) throw new Error(`capability: no kind of system ${id} in this town`);
    tagged.add(id);
    const out: { r: number; from: number; template: string }[] = [];
    for (let r = 1; r <= n; r++) {
      const template = `${id}-r${r}`;
      const from = r * spec.every_days * DAY;
      c.templates.push({ ...structuredClone(base), id: template, released: from, does: base.does.map((d: any) => (d.seconds ? { ...d, seconds: scaled(d.seconds, spec.time_bps, r) } : d)) });
      for (const d of base.does) {
        const row = `${d.block}/${d.kind ?? d.task ?? ""}`.replace(/\/$/, "");
        if (d.seconds && sources[`template.${id}.${row}`]) sources[`template.${template}.${row}`] = `Release ${r} of ${id} (${basis}), from: ${sources[`template.${id}.${row}`]}`;
      }
      const was = slip.system[id];
      if (was) {
        slip.system[template] = { ...was, bps: Math.round(was.bps * pow(spec.slip_bps, r)) };
        slip.sources[`system.${template}`] = `Release ${r} of ${id} (${basis}), from: ${slip.sources[`system.${id}`] ?? "its first release's rate"}`;
      }
      tagged.add(template);
      out.push({ r, from, template });
    }
    return out;
  }
  const vendors = unitsOf(c, "world.vendor");
  const providers = unitsOf(c, "firm.provider");
  for (const want of spec.of) {
    if (want === "assistants") {
      // (Every provider's offers, where the town has providers: none is no fault, as a town without assistants has none.)
      for (const p of providers) for (const o of p.offers ?? []) {
        (p.releases ??= {})[o.id] = release(o.template).map(({ r, from, template }) => ({ from, template, claim_slip_bps: Math.round(o.claim_slip_bps * pow(spec.slip_bps, r)),
          claim_seconds: Object.fromEntries(Object.entries(o.seconds ?? {}).map(([k, s]) => [k, scaled(s as number, spec.time_bps, r)])), price_bps: Math.round(10_000 * pow(spec.price_bps, r)) }));
      }
      continue;
    }
    const sellers = vendors.filter((p) => (p.offers ?? []).some((o: any) => o.id === want));
    if (!sellers.length) throw new Error(`capability: no offer ${want} is sold in this town`);
    for (const p of sellers) {
      const o = p.offers.find((x: any) => x.id === want);
      (p.releases ??= {})[o.id] = release(o.template).map(({ r, from, template }) => ({ from, template, speed_bps: scaled(o.speed_bps, spec.time_bps, r), ...(o.seconds ? { seconds: scaled(o.seconds, spec.time_bps, r) } : {}), price_bps: Math.round(10_000 * pow(spec.price_bps, r)) }));
    }
  }
  c.meta = { ...c.meta, study_tags: { ...(c.meta.study_tags ?? {}), [spec.tag]: [...tagged].sort() } };
  return c;
}
