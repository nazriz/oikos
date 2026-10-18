import { officesBy } from "./offices";

// A rents board for a test's town. The Rust landlord reviews a rent by what comparable homes let and ask for, and moves
// it part of the way (oikos_rules::rent; docs/behaviour/firms.md, "Rent reviews follow the market"); the TS landlord
// raised it to its own going rent plus 5%. In a generated town no home comes to let for months, so on the Rust world
// there is no evidence to move a rent and a test about what follows a rent increase would see none. A test that needs
// rises says the market has moved: the town's rents board (the kind of paper `world.rent_portal` writes) publishes, for
// each kind of home, what the dearest let for lately, `rise_bps` over the rents in force, and every landlord's office
// reads it with its listings. On the TS world the paper is ignored (its landlords never read one).
export function publishRentsBoard(config: any, rise_bps: number): void {
  const typeOf = new Map<string, string>(config.world.structures.map((s: any) => [s.id, s.type]));
  const dearest = new Map<string, number>();
  for (const r of config.world.records) {
    if (r.record !== "agreement" || r.terms?.template !== "lease") continue;
    const space: string | undefined = r.terms.commitments.find((c: any) => c.does?.outcome?.occupancy)?.does.outcome.occupancy.in;
    const rent = Number(r.terms.commitments.find((c: any) => c.does?.outcome?.money)?.does.outcome.money.amount);
    const type = space && typeOf.get(space.split("/")[0]!);
    if (type && rent > (dearest.get(type) ?? 0)) dearest.set(type, rent);
  }
  for (const [type, rent] of dearest) {
    config.world.records.push({ id: `rents-board-${type}`, record: "statement", author: "genesis", at: 0, visible_to: "public", speaks_for: "city", kind: "rental_evidence",
      text: `Homes of the kind ${type} have let for ${Math.floor(rent * (10_000 + rise_bps) / 10_000)} a month lately.`,
      data: { type, lets: [Math.floor(rent * (10_000 + rise_bps) / 10_000)], asking: [], homes: 0, vacant: 0, window_days: 90 } });
  }
  if (!config.knowing.published.some((k: any) => k.what === "rental_evidence"))
    config.knowing.published.push({ what: "rental_evidence", why: "A letting portal, or a rents board, publishes what homes of each kind let for, as a listing site does." });
  for (const o of officesBy(config, "firm.landlord")) {
    const post = config.positions.find((x: any) => x.id === o.id);
    post.channels.push({ id: "rents", kind: "records", way: "published", match: { statement_kinds: ["rental_evidence"] } });
  }
}
