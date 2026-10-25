// Consequential acts (the GD plan's M1 list, docs/design/gradual-disempowerment.md; docs/design/renderer.md 6): which
// changes that reach a person count when asking "who decided about the people here". Defined once, here, so the
// renderer's overlay and the measure that M1 will be read the same list. It judges nothing: it says which kinds of
// change are counted, and which of them land hard on the person (refusals, removals, debts), by the record's own words.
//
// Counted: money moved to or from a person; a record addressed to them, or naming them as a party, that decides,
// orders, notifies, bills or answers (a debt or claim raised, a job or tenancy ended, a payment or permit granted or
// refused, an appointment); being removed from a space by someone else. Not counted: their own looking, letters, and
// routine paperwork (orders of goods, supply requests, price lists, delivery notes).

/** Record kinds that are never consequential by themselves: routine paperwork. */
export const ROUTINE_KINDS = new Set(["request", "order", "delivery_note", "supply_request", "price_list", "hours_reply", "job_application", "job_posting", "interview", "premises_listing", "rental_listing", "property_for_sale", "consultation", "office_books", "staff_report", "accounts", "petition_count", "lot", "household", "form", "practice", "teaching", "service_address", "enrolment"]);

/** A record kind that decides, orders, notifies, bills or answers. */
export const CONSEQUENTIAL_KIND = /decision|order|notice|refus|answer|change|warrant|judg|fine|penalt|evict|possession|terminat|dismiss|hired|award|grant|invoice|bill|demand|arrears|debt|levy|assessment|summons|ruling|determination|redundan|stop|sanction|claim_refused|offer|agreed|restored|departure|death_notification|valuation|rates/;

/** Is a record of this kind, with these data, consequential for the people it is addressed to? */
export function isConsequentialRecord(kind: string | undefined, record?: string): boolean {
  if (record === "agreement") return true; // a tenancy, a job, a loan: made or ended
  if (!kind || ROUTINE_KINDS.has(kind)) return false;
  return CONSEQUENTIAL_KIND.test(kind);
}

/** Does it land hard, by its own words: a refusal, a decline, a removal, a debt raised, a notice to quit or end? */
export function isHard(kind: string | undefined, data: any, text?: string): boolean {
  if (data && (data.granted === false || data.approved === false || data.accepted === false)) return true;
  if (kind && /refus|declin|evict|possession|arrears|warrant|dismiss|terminat|redundan|debt|demand|penalt|fine|stop|sanction|quit/.test(kind)) return true;
  const decision = String(data?.decision ?? data?.outcome ?? "");
  if (/declin|refus|dismiss|reject/.test(decision)) return true;
  return !!text && /\b(refused|declined|insufficient funds|notice to (vacate|quit)|evict|redundan)/i.test(text.slice(0, 300));
}
