// The translator's test set (VISION §14: a translation model is adopted only if it passes a held-out set that
// includes novel requests). Each case: a plain-language request as a participant might write it, what it knows
// (the fixture), and the call it should become, or the refusal it should get. `held_out` cases are phrased
// unlike anything in the call language's own examples (contracts/calls.md) and must never be used to tune a prompt
// or train a model.

export interface Case {
  id: string;
  request: string;
  /** Acceptable answers, in the call language (compared in canonical form). */
  expect: string[];
  held_out?: boolean;
  note?: string;
}

export const CASES: Case[] = [
  // money
  { id: "pay-once", request: 'Pay the builder $500 for the fence.', expect: ['money(to=builder, amount="$500", for="the fence")'] },
  { id: "pay-monthly", request: "Pay acc-landlord-1 $850 every month for rent.", expect: ['money(to=acc-landlord-1, amount="$850", every="every month", for="rent")', 'money(to=acc-landlord-1, amount="$850", every="monthly", for="rent")', 'money(to=acc-landlord-1, amount="$850", every="month", for="rent")'] },
  { id: "pay-from", request: "Send $1,200 to greenco from acc-city, settling inv.1.", expect: ['money(to=greenco, amount="$1,200", from=acc-city, settles=inv.1)'] },
  { id: "pay-held-out", request: "Could you get $75 over to Millbrook Builders out of the town account (acc-city)? It's for the gate repair.", expect: ['money(to="Millbrook Builders", amount="$75", from=acc-city, for="the gate repair")', 'money(to="Millbrook Builders", amount="$75", from=acc-city, for="gate repair")'], held_out: true },
  // structures
  { id: "commission-park", request: 'Have greenco build a park on lot-00 for $60,000, paid from acc-city, under permit rec.412.', expect: ['structure(type=park, on=lot-00, by=greenco, price="$60,000", from=acc-city, basis=rec.412)'] },
  { id: "demolish", request: "We'll knock down str.9 ourselves (city), paying from acc-city.", expect: ["structure(remove=str.9, by=city, from=acc-city)"] },
  { id: "build-held-out", request: "Get GreenCo to put a park on lot-01. Offer them $45k out of acc-city.", expect: ['structure(type=park, on=lot-01, by="GreenCo", price="$45k", from=acc-city)', 'structure(type=park, on=lot-01, by=greenco, price="$45k", from=acc-city)'], held_out: true },
  // forms
  { id: "form-permit", request: "Apply to planning for a permit to build a park on lot-00.", expect: ["form(to=planning, form=permit_application, lot=lot-00, structure_type=park)"] },
  { id: "form-held-out", request: "Lodge the planning application: lot-01, apartments, and note that it's affordable housing.", expect: ['form(to=planning, form=permit_application, lot=lot-01, structure_type=apartments, notes="affordable housing")', 'form(to=planning, form=permit_application, lot=lot-01, structure_type=apartments, notes="it\'s affordable housing")'], held_out: true },
  // statements, votes, messages
  { id: "notice", request: 'Publish a notice: "The town hall opens at nine."', expect: ['statement(kind=notice, text="The town hall opens at nine.")'] },
  { id: "notice-on-lot", request: 'Put up a notice on lot-00 saying "Park works start Monday."', expect: ['statement(kind=notice, text="Park works start Monday.", on=lot-00)'] },
  { id: "withdraw", request: "Withdraw rec.2.", expect: ["statement(withdraw=rec.2)"] },
  { id: "vote", request: "Vote yes on rec.3.", expect: ["vote(ballot=rec.3, choice=yes)"] },
  { id: "message", request: 'Write to the builder: "When can you start?"', expect: ['message(to=builder, text="When can you start?")'] },
  { id: "message-held-out", request: 'Drop GreenCo a line to say "Thanks for the quote, we\'ll be in touch."', expect: ['message(to="GreenCo", text="Thanks for the quote, we\'ll be in touch.")', 'message(to=greenco, text="Thanks for the quote, we\'ll be in touch.")'], held_out: true },
  // occupancy, agreements, claims, entities, positions
  { id: "move-in", request: "Move into apts-3/dwelling.2.", expect: ["occupancy(in=apts-3/dwelling.2)"] },
  { id: "lease", request: 'Offer c0042 a 12-month lease of apts-3/dwelling.2 for $850 a month, paid to acc-city, with 60 days\' notice from us and 30 days\' notice from them.', expect: ['agreement(with=c0042, template=lease, term="12 months", our_notice="60 days", their_notice="30 days", we_do=occupancy(who=c0042, in=apts-3/dwelling.2), they_do=money(to=acc-city, amount="$850", every="a month"))', 'agreement(with=c0042, template=lease, term="12 months", our_notice="60 days", their_notice="30 days", we_do=occupancy(who=c0042, in=apts-3/dwelling.2), they_do=money(to=acc-city, amount="$850", every="monthly"))'] },
  { id: "permit-claim", request: 'Record that c0042 is permitted to build on lot-00.', expect: ['claim(position=liberty, holder=c0042, about={"action":"build","object":"lot-00"})'] },
  { id: "trust", request: 'Set up a trust called "River Land Trust".', expect: ['entity(kind=trust, name="River Land Trust")'] },
  { id: "position", request: 'Create a new post of Clerk, with the role clerk.', expect: ['position(title="Clerk", role=clerk)'] },
  { id: "appoint-held-out", request: "Give the planning job to c0042-self.", expect: ["position(appoint=planning, to=c0042-self)"], held_out: true },
  // refusals
  { id: "not-yours", request: "Make the council pass the budget.", expect: ["none(not_yours)"] },
  { id: "calculation", request: "Pay the builder 10% of what's in acc-city.", expect: ["none(needs_calculation)"] },
  { id: "calculation-held-out", request: "Give each councillor a fifth of the parks budget.", expect: ["none(needs_calculation)"], held_out: true },
  { id: "unclear", request: "Sort out the housing thing.", expect: ["none(unclear)"] },
  { id: "unknown-form", request: "Fill in the dog licence form for Rex.", expect: ["none(unknown_form)"], note: "no such form is known" },
];
