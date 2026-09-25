// World words for platform facts (principle 14: the platform is invisible to
// seats). A seat never reads a refusal code; it reads what stood in the way.

const REFUSAL: Record<string, string> = {
  seat_opted_out: "you are no longer taking part",
  unknown_ref: "it refers to something that doesn't exist yet",
  duplicate_ref: "it names two different things the same way",
  not_custodian: "only whoever keeps that account can move money from it",
  not_holder: "that account isn't yours",
  insufficient_funds: "the account doesn't have enough money",
  overflow: "the amount is too large",
  unknown_account: "there's no such account",
  account_not_empty: "the account still has money in it",
  boundary_protected: "that can't be closed",
  unknown_parcel: "there's no such lot",
  parcel_occupied: "there's already a building on that lot",
  unknown_structure_type: "that isn't a kind of building that can be built here",
  unknown_structure: "there's no such building",
  structure_incomplete: "the building isn't finished",
  unknown_slot: "that building has no space of that kind",
  capacity_exceeded: "there isn't room",
  not_present: "they aren't there",
  unknown_entity: "there's no one by that name",
  reserved_kind: "that isn't something that can be created",
  unknown_record: "there's no such record",
  wrong_record_kind: "that record isn't the right kind of thing",
  cap_exceeded: "the world's limit on that has been reached",
};

/**
 * What stood in the way, in plain words. The kernel's detail text stays in the
 * log: it's written for researchers (ids, cents, the grammar of acts), not
 * for someone living in the world. `item` says which part, when there were several.
 */
export function refusalText(code: string | undefined, item?: number, items = 1): string {
  const base = (code && REFUSAL[code]) ?? "it isn't possible";
  return item !== undefined && items > 1 ? `${base} (item ${item + 1})` : base;
}
