// World words for platform facts (principle 14: the platform is invisible to
// participants). A participant never reads a refusal code; it reads what stood in the way.

const REFUSAL: Record<string, string> = {
  participant_inactive: "you no longer act here",
  not_in_position: "you don't hold that post",
  unknown_ref: "it refers to something that doesn't exist yet",
  duplicate_ref: "it names two different things the same way",
  not_custodian: "only whoever keeps that account can move money from it",
  not_holder: "that account isn't yours",
  insufficient_funds: "the account doesn't have enough money",
  overflow: "the amount is too large",
  unknown_account: "there's no such account",
  account_not_empty: "the account still has money in it",
  boundary_protected: "that can't be closed",
  unknown_cell: "there's no such ground",
  ground_occupied: "there's already a building there",
  unsuitable_terrain: "that kind of building can't stand on that ground",
  unknown_structure_type: "that isn't a kind of building that can be built here",
  unknown_structure: "there's no such building",
  structure_incomplete: "the building isn't finished",
  unknown_space: "there's no such place in that building",
  not_a_place: "what was named as the place to be or to work is not a place: name a building, or a space in one",
  capacity_exceeded: "there isn't room",
  not_present: "they aren't there",
  already_present: "they're already here",
  not_a_person: "only a person can do that",
  dead: "they have died",
  too_far: "they're too far away",
  not_fertile: "that isn't possible at that age",
  not_modelled: "that doesn't happen here",
  unknown_entity: "there's no one by that name",
  unknown_participant: "there's no one by that name",
  unknown_position: "there's no such post",
  unknown_template: "there's no such kind of newcomer or system",
  not_theirs: "that isn't yours to fill or switch off",
  reserved_kind: "that isn't something that can be created",
  unknown_record: "there's no such record",
  wrong_record_kind: "that record isn't the right kind of thing",
  cap_exceeded: "the limit on that has been reached",
  currency_mismatch: "the two accounts are in different currencies, so money can't simply move between them (it would have to be exchanged)",
  unknown_currency: "there's no such currency here",
  not_a_boundary: "that isn't a way out of here",
  unknown_resource: "there's no such thing here",
  insufficient_quantity: "there isn't that much of it there",
  unknown_place: "that isn't somewhere things can be kept",
  unknown_task: "that isn't a kind of work anyone knows how to do here",
  not_at_work: "the people named aren't there to do it",
  not_capable: "that kind of system can't do that",
  not_supplier: "only whoever supplies that kind of system can put one to work",
  no_time_left: "there aren't enough working hours left today for that",
  bad_survey: "a survey has to say what it's counting and in which places, one unit of work for each place",
  flooded: "it's under water",
  bad_investigation: "an investigation has to say what was taken, from whom, and where (and the work has to be an investigation)",
  field_exhausted: "there isn't enough of it there to take (the river is too low, say)",
  no_body_effect: "that work isn't done to a person (or it is, and needs saying to whom: someone there, or a room of people)",
  not_being_built: "that isn't being built",
  not_coming_down: "that isn't being demolished",
  coming_down: "it's being demolished",
  offer_withdrawn: "the offer has been taken back by whoever made it, so there is nothing to sign",
  unpriced: "nobody here knows what doing that takes, so it can't be done",
  beyond_supply: "there is no more of that to be had from outside this time: what is offered of it has all been taken",
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
