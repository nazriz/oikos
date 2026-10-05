// The translator's test set (VISION §14: a translation model is adopted only if it passes a held-out set that
// includes novel requests). Each case: a plain-language request as a participant might write it, what it knows
// (the fixture), and the call it should become, or the refusal it should get.
//
// Every case in this file is SEEN: it may be read, and tuned on. The held-out cases are not in the repository at all
// (eval/held-out.ts says where they are and why): whoever works on the translator's prompt, or builds its training
// data, must not read them. The cases marked `was_held_out` were the held-out set until 2026-10-05, when an audit
// found the wording of several of them in the prompt (docs/decisions.md); they are seen cases now.

export interface Case {
  id: string;
  request: string;
  /** Acceptable answers, in the call language (compared in canonical form). */
  expect: string[];
  /** Only on cases loaded from outside the repository (eval/held-out.ts): never set in this file. */
  held_out?: boolean;
  /** Held out until 2026-10-05; seen since. */
  was_held_out?: boolean;
  /** Arguments whose text isn't compared (a letter's wording: what matters is that it's a letter, to whom). */
  ignore?: string[];
  note?: string;
}

export const CASES: Case[] = [
  // money
  { id: "pay-once", request: 'Pay the builder $500 for the fence.', expect: ['money(to=builder, amount="$500", for="the fence")'] },
  { id: "pay-monthly", request: "Pay acc-landlord-1 $850 every month for rent.", expect: ['money(to=acc-landlord-1, amount="$850", every="every month", for="rent")', 'money(to=acc-landlord-1, amount="$850", every="monthly", for="rent")', 'money(to=acc-landlord-1, amount="$850", every="month", for="rent")'] },
  { id: "pay-from", request: "Send $1,200 to greenco from acc-city, settling inv.1.", expect: ['money(to=greenco, amount="$1,200", from=acc-city, settles=inv.1)'] },
  { id: "pay-held-out", request: "Could you get $75 over to Millbrook Builders out of the town account (acc-city)? It's for the gate repair.", expect: ['money(to="Millbrook Builders", amount="$75", from=acc-city, for="the gate repair")', 'money(to="Millbrook Builders", amount="$75", from=acc-city, for="gate repair")'], was_held_out: true },
  // structures
  { id: "commission-park", request: 'Have greenco build a park on lot-00 for $60,000, paid from acc-city, under permit rec.412.', expect: ['structure(type=park, on=lot-00, by=greenco, price="$60,000", from=acc-city, basis=rec.412)'] },
  { id: "demolish", request: "We'll knock down str.9 ourselves (city), paying from acc-city.", expect: ["structure(remove=str.9, by=city, from=acc-city)"] },
  { id: "build-held-out", request: "Get GreenCo to put a park on lot-01. Offer them $45k out of acc-city.", expect: ['structure(type=park, on=lot-01, by="GreenCo", price="$45k", from=acc-city)', 'structure(type=park, on=lot-01, by=greenco, price="$45k", from=acc-city)'], was_held_out: true },
  // goods and work (phase B)
  { id: "move-goods", request: "Move 40 goods from str.7 to the builder at str.8.", expect: ["goods(kind=goods, quantity=40, from_at=str.7, to=builder, at=str.8)"] },
  { id: "work", request: "Have c0042 do 3 units of make at str.7.", expect: ["work(task=make, units=3, at=str.7, by=c0042)", 'work(task=make, units=3, at=str.7, by=["c0042"])'] },
  { id: "work-held-out", request: "Put Dana Reyes on the job at str.5: two hours of building (7200 units of build), working out of the yard at str.2.", was_held_out: true,
    expect: ['work(task=build, units=7200, at=str.2, by="Dana Reyes", on=str.5)', "work(task=build, units=7200, at=str.2, by=c0042, on=str.5)", 'work(task=build, units=7200, at=str.2, by=["c0042"], on=str.5)'] },
  // forms
  { id: "form-permit", request: "Apply to planning for a permit to build a park on lot-00.", expect: ["form(to=planning, form=permit_application, lot=lot-00, structure_type=park)"] },
  { id: "form-held-out", request: "Lodge the planning application: lot-01, apartments, and note that it's affordable housing.", expect: ['form(to=planning, form=permit_application, lot=lot-01, structure_type=apartments, notes="affordable housing")', 'form(to=planning, form=permit_application, lot=lot-01, structure_type=apartments, notes="it\'s affordable housing")'], was_held_out: true },
  // statements, votes, messages
  { id: "notice", request: 'Publish a notice: "The town hall opens at nine."', expect: ['statement(kind=notice, text="The town hall opens at nine.")'] },
  { id: "notice-on-lot", request: 'Put up a notice on lot-00 saying "Park works start Monday."', expect: ['statement(kind=notice, text="Park works start Monday.", on=lot-00)'] },
  { id: "withdraw", request: "Withdraw rec.2.", expect: ["statement(withdraw=rec.2)"] },
  { id: "vote", request: "Vote yes on rec.3.", expect: ["vote(ballot=rec.3, choice=yes)"] },
  { id: "message", request: 'Write to the builder: "When can you start?"', expect: ['message(to=builder, text="When can you start?")'] },
  { id: "message-held-out", request: 'Drop GreenCo a line to say "Thanks for the quote, we\'ll be in touch."', expect: ['message(to="GreenCo", text="Thanks for the quote, we\'ll be in touch.")', 'message(to=greenco, text="Thanks for the quote, we\'ll be in touch.")'], was_held_out: true },
  // occupancy, agreements, claims, entities, positions
  { id: "move-in", request: "Move into apts-3/dwelling.2.", expect: ["occupancy(in=apts-3/dwelling.2)"] },
  { id: "lease", request: 'Offer c0042 a 12-month lease of apts-3/dwelling.2 for $850 a month, paid to acc-city, with 60 days\' notice from us and 30 days\' notice from them.', expect: ['agreement(with=c0042, template=lease, term="12 months", our_notice="60 days", their_notice="30 days", we_do=occupancy(who=c0042, in=apts-3/dwelling.2), they_do=money(to=acc-city, amount="$850", every="a month"))', 'agreement(with=c0042, template=lease, term="12 months", our_notice="60 days", their_notice="30 days", we_do=occupancy(who=c0042, in=apts-3/dwelling.2), they_do=money(to=acc-city, amount="$850", every="monthly"))'] },
  { id: "permit-claim", request: 'Record that c0042 is permitted to build on lot-00.', expect: ['claim(position=liberty, holder=c0042, about={"action":"build","object":"lot-00"})'] },
  { id: "trust", request: 'Set up a trust called "River Land Trust".', expect: ['entity(kind=trust, name="River Land Trust")'] },
  { id: "position", request: 'Create a new post of Clerk, with the role clerk.', expect: ['position(title="Clerk", role=clerk)'] },
  { id: "appoint-held-out", request: "Give the planning job to c0042-self.", expect: ["position(appoint=planning, to=c0042-self)"], was_held_out: true },
  // refusals
  { id: "not-yours", request: "Make the council pass the budget.", expect: ["none(not_yours)"] },
  { id: "calculation", request: "Pay the builder 10% of what's in acc-city.", expect: ["none(needs_calculation)"] },
  { id: "calculation-held-out", request: "Give each councillor a fifth of the parks budget.", expect: ["none(needs_calculation)"], was_held_out: true },
  { id: "unclear", request: "Sort out the housing thing.", expect: ["none(unclear)"] },
  // not an act (seen; added 2026-10-05 from the kind of thing the pilots' offices asked for, reworded)
  { id: "look-ledger", request: "Inspect the transaction ledger for acc-city and show me every payment over $2,000 this month.", expect: ["none(not_an_act)"] },
  { id: "look-record", request: "Read rec.3 and tell me what it says.", expect: ["none(not_an_act)"] },
  { id: "look-post", request: "Show me who currently holds the planning post.", expect: ["none(not_an_act)"] },
  { id: "look-ask", request: "Ask the planning officer to send me the list of permits decided this month.", expect: ['message(to=planning, text="Please send me the list of permits decided this month.")'], ignore: ["text"], note: "asking someone for it is an act: a letter" },
  { id: "unknown-form", request: "Fill in the dog licence form for Rex.", expect: ["none(unknown_form)"], note: "no such form is known" },

  // Seen, from the pilots (2026-10-03): requests a model mayor made that the translator got wrong (docs/real-models.md,
  // pilots 7c–7e), reworded a little. These may be tuned on.
  { id: "pilot-direct", request: "As Mayor, direct the works manager [works] to send a crew to house-1 today to collect the waste reported in [rec.17285], and report back.",
    expect: ['message(to=works, text="Send a crew to house-1 today to collect the waste reported in rec.17285, and report back.", re=rec.17285)', 'message(to=works, text="Send a crew to house-1 today to collect the waste reported in rec.17285, and report back.")'],
    ignore: ["text", "re"] },
  { id: "pilot-road", request: "As Town of Millbrook, enter an agreement with Millbrook Builders [builder] to build a road on town lot [lot-00] for $33,000, paid from [acc-city], under permit decision [rec.8031].",
    expect: ['structure(type=road, on=lot-00, by=builder, price="$33,000", from=acc-city, basis=rec.8031)'] },
  { id: "pilot-notice", request: "Give notice to end the employment agreement [rec.56179] between the Town of Millbrook [city] and Dana Reyes.",
    expect: ["agreement(notice=rec.56179)"] },
  { id: "pilot-buy-building", request: "Buy one finished park on town lot [lot-01] from GreenCo [greenco] for $97,500 out of [acc-city].",
    expect: ['structure(type=park, on=lot-01, by=greenco, price="$97,500", from=acc-city)'] },

  // Added 2026-10-02 as held-out cases, phrased as the pilots' mayors wrote; seen since 2026-10-05 (above).
  // money
  { id: "ho-pay-words", was_held_out: true, request: "Please transfer $2,500 from acc-city to Millbrook Builders for the footpath.",
    expect: ['money(to=builder, amount="$2,500", from=acc-city, for="the footpath")', 'money(to=builder, amount="$2,500", from=acc-city, for="footpath")', 'money(to="Millbrook Builders", amount="$2,500", from=acc-city, for="the footpath")'],
    note: "answer key: the firm by name added after the first run (2026-10-02), as pay-held-out already accepts" },
  { id: "ho-settle", was_held_out: true, request: "Settle invoice rec.88: $12,400 to GreenCo out of the town account.",
    expect: ['money(to=greenco, amount="$12,400", from=acc-city, settles=rec.88)'] },
  { id: "ho-wages", was_held_out: true, request: "Set up a fortnightly payment of $3,000 from acc-city to Dana Reyes for her wages.",
    expect: ['money(to=c0042, amount="$3,000", from=acc-city, every="fortnightly", for="wages")', 'money(to=c0042, amount="$3,000", from=acc-city, every="fortnightly", for="her wages")'] },
  // messages
  { id: "ho-message-two", was_held_out: true, request: 'Let the builder and GreenCo both know: "Tenders close Friday."',
    expect: ['message(to=["builder","greenco"], text="Tenders close Friday.")', 'message(to=builder, text="Tenders close Friday.")\nmessage(to=greenco, text="Tenders close Friday.")', 'message(to=builder, text="Tenders close Friday.")\nmessage(to="GreenCo", text="Tenders close Friday.")'],
    note: "answer key: two letters accepted as one to both, after the first run (2026-10-02)" },
  { id: "ho-message-re", was_held_out: true, request: 'Reply to rec.77, telling the planning officer "Approved in principle."',
    expect: ['message(to=planning, text="Approved in principle.", re=rec.77)', 'message(to=planning-system, text="Approved in principle.", re=rec.77)'] },
  // statements and votes
  { id: "ho-withdraw", was_held_out: true, request: "Take down my notice rec.19, it's out of date.", expect: ["statement(withdraw=rec.19)"] },
  { id: "ho-vote-no", was_held_out: true, request: "Put me down as a no on ballot rec.31.", expect: ["vote(ballot=rec.31, choice=no)"] },
  { id: "ho-notice", was_held_out: true, request: 'Post this for everyone to see: "Water restrictions apply from today."',
    expect: ['statement(kind=notice, text="Water restrictions apply from today.")', 'statement(kind=notice, text="Water restrictions apply from today.", visible=public)', 'statement(kind=announcement, text="Water restrictions apply from today.")'] },
  // forms and buildings
  { id: "ho-form-road", was_held_out: true, request: "Can you lodge a planning application for a road on lot-01?",
    expect: ["form(to=planning, form=permit_application, lot=lot-01, structure_type=road)"] },
  { id: "ho-demolish-by", was_held_out: true, request: "Get Millbrook Builders to pull down str.12; we'll pay $8k from acc-city.",
    expect: ['structure(remove=str.12, by=builder, price="$8k", from=acc-city)'] },
  { id: "ho-build-basis", was_held_out: true, request: "Now that permit rec.205 is through, have the builder put up a park on lot-00 for $97,500 from acc-city.",
    expect: ['structure(type=park, on=lot-00, by=builder, price="$97,500", from=acc-city, basis=rec.205)'] },
  { id: "ho-goods", was_held_out: true, request: "Ship 25 goods from our depot at str.7 over to GreenCo at str.9.",
    expect: ["goods(kind=goods, quantity=25, from_at=str.7, to=greenco, at=str.9)"] },
  // agreements
  { id: "ho-lease", was_held_out: true, request: "Offer Dana Reyes the flat at apts-3/dwelling.4 for 6 months at $900 a month, paid into acc-city, with 30 days' notice either way.",
    expect: ['agreement(with=c0042, template=lease, term="6 months", our_notice="30 days", their_notice="30 days", we_do=occupancy(who=c0042, in=apts-3/dwelling.4), they_do=money(to=acc-city, amount="$900", every="a month"))',
      'agreement(with=c0042, template=lease, term="6 months", our_notice="30 days", their_notice="30 days", we_do=occupancy(who=c0042, in=apts-3/dwelling.4), they_do=money(to=acc-city, amount="$900", every="monthly"))'] },
  { id: "ho-sign", was_held_out: true, request: "I accept the offer in rec.501. Sign it.", expect: ["agreement(sign=rec.501)"] },
  { id: "ho-notice-end", was_held_out: true, request: "Give notice to end our agreement rec.600.", expect: ["agreement(notice=rec.600)"] },
  // the cast
  { id: "ho-vacate-post", was_held_out: true, request: "Make the planning post vacant.", expect: ["position(vacate=planning)"] },
  { id: "ho-company", was_held_out: true, request: 'Set up a company called "Millbrook Water Co", with me as its Director.',
    expect: ['entity(kind=company, name="Millbrook Water Co", position="Director")', 'entity(kind=firm, name="Millbrook Water Co", position="Director")'] },
  // refusals
  { id: "ho-calc", was_held_out: true, request: "Pay the builder whatever's left in acc-city after the parks line.", expect: ["none(needs_calculation)"] },
  { id: "ho-not-yours", was_held_out: true, request: "Make GreenCo lower its prices.", expect: ["none(not_yours)"] },
  { id: "ho-unclear", was_held_out: true, request: "Do something about the roads.", expect: ["none(unclear)"] },
  { id: "ho-too-much", was_held_out: true, request: "Run the whole year: pay every invoice, hire the crew, build the park and fix all the roads.", expect: ["none(too_much)"] },
  { id: "ho-unknown-form", was_held_out: true, request: "Submit the event permit form for the summer fair.", expect: ["none(unknown_form)"] },
];
