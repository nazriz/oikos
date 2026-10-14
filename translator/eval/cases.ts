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
  /** The post the asker holds, where it is not the mayor's: the forms they are shown are that post's. */
  as?: string;
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
  // when a standing payment starts: a date, or a length of time, as the request wrote it (wave 2a, 2026-10-09)
  { id: "pay-standing-first-date", request: "Set up a standing payment from acc-city to c0042 of $1,900 every 14 days for wages, with the first payment on year 2, day 22.",
    expect: ['money(to=c0042, amount="$1,900", from=acc-city, every="every 14 days", first="year 2, day 22", for="wages")', 'money(to=c0042, amount="$1,900", from=acc-city, every="14 days", first="year 2, day 22", for="wages")'], note: "a start date is copied as written: first= takes a date" },
  { id: "pay-standing-first-date-plain", request: "Pay acc-landlord-1 $850 a month for rent from acc-city, starting from year 2 day 1.",
    expect: ['money(to=acc-landlord-1, amount="$850", from=acc-city, every="a month", first="year 2 day 1", for="rent")', 'money(to=acc-landlord-1, amount="$850", from=acc-city, every="month", first="year 2 day 1", for="rent")', 'money(to=acc-landlord-1, amount="$850", from=acc-city, every="a month", first="from year 2 day 1", for="rent")', 'money(to=acc-landlord-1, amount="$850", from=acc-city, every="monthly", first="year 2 day 1", for="rent")'], note: "the date as the request wrote it, comma or none; never joined with how often" },
  { id: "pay-standing-first-length", request: "Pay c0042 $1,900 from acc-city every fortnight for wages, the first one in 21 days.",
    expect: ['money(to=c0042, amount="$1,900", from=acc-city, every="every fortnight", first="21 days", for="wages")', 'money(to=c0042, amount="$1,900", from=acc-city, every="every fortnight", first="in 21 days", for="wages")', 'money(to=c0042, amount="$1,900", from=acc-city, every="fortnight", first="21 days", for="wages")', 'money(to=c0042, amount="$1,900", from=acc-city, every="fortnight", first="in 21 days", for="wages")'] },
  { id: "standing-work-from-date", request: "The crew is to collect at str.7 every week from year 2, day 40 until year 2, day 90.",
    expect: ['work(task=collect, at=str.7, every="every week", first="year 2, day 40", until="year 2, day 90")', 'work(task=collect, at=str.7, every="week", first="year 2, day 40", until="year 2, day 90")', 'work(task=collect, at=str.7, every="every week", first="from year 2, day 40", until="year 2, day 90")', 'work(task=collect, at=str.7, every="every week", first="year 2, day 40", until="until year 2, day 90")'], note: "a standing order's start and end as dates" },
  { id: "move-goods-grouped", request: "Move 60,000 goods from str.7 to str.8.", expect: ['goods(kind=goods, quantity="60,000", from_at=str.7, at=str.8)'], note: "a count is copied with its digit grouping, as an amount is" },
  // structures
  { id: "commission-park", request: 'Have greenco build a park on lot-00 for $60,000, paid from acc-city, under permit rec.412.', expect: ['structure(type=park, on=lot-00, by=greenco, price="$60,000", from=acc-city, basis=rec.412)'] },
  { id: "demolish", request: "We'll knock down str.9 ourselves (city), paying from acc-city.", expect: ["structure(remove=str.9, by=city, from=acc-city)"] },
  { id: "build-held-out", request: "Get GreenCo to put a park on lot-01. Offer them $45k out of acc-city.", expect: ['structure(type=park, on=lot-01, by="GreenCo", price="$45k", from=acc-city)', 'structure(type=park, on=lot-01, by=greenco, price="$45k", from=acc-city)'], was_held_out: true },
  // goods and work (phase B)
  { id: "move-goods", request: "Move 40 goods from str.7 to the builder at str.8.", expect: ["goods(kind=goods, quantity=40, from_at=str.7, to=builder, at=str.8)"] },
  { id: "move-goods-place", request: "Shift 12 goods from str.7 over to str.8.", expect: ["goods(kind=goods, quantity=12, from_at=str.7, at=str.8)"], note: "a place named as where they go is at=, never to=; with no one named they are the asker's own (2026-10-06)" },
  { id: "work-several", request: "Have c0042 and c0043 do 4 units of make at str.7 between them.", expect: ['work(task=make, units=4, at=str.7, by=["c0042","c0043"])'], note: "work by several is one work(...) with by as a list: units is the whole job (2026-10-06)" },
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
  { id: "look-ask", request: "Ask the planning officer to send me the list of permits decided this month.", expect: ['message(to=planning, text="send me the list of permits decided this month")', 'message(to="the planning officer", text="send me the list of permits decided this month")', 'message(to="planning officer", text="send me the list of permits decided this month")'], ignore: ["text"], note: "asking someone for it is an act: a letter" },
  // nothing does it (seen; added 2026-10-06, of the kind the pilots' offices asked for)
  { id: "hold-payment", request: "Temporarily pause the recurring payment rec.90 from acc-city until I release the pause. Keep it on record.", expect: ["statement(hold=rec.90)"], note: "a hold can be said since 2026-10-08 (until then: none(no_such_act))" },
  // a hold, an entry on one's own file, and what needs something found out first (seen; added 2026-10-08, of the kinds
  // the pilots' offices asked for: docs/design/call-language-gaps.md)
  { id: "hold-several", request: "Suspend the standing payments rec.90, rec.91 and rec.92 out of acc-city while the payroll is checked. Do not cancel them, and leave what has already been paid alone.", expect: ['statement(hold=["rec.90","rec.91","rec.92"])'], note: "one statement for several; what is to be kept, and why, adds nothing" },
  { id: "hold-at-bank", request: "Place a temporary hold at the bank on standing payment rec.91, to be released when I say.", expect: ["statement(hold=rec.91)", "statement(hold=rec.91, to=bank)", 'statement(hold=rec.91, to="the bank")'], note: "who acts on it is known from the record: no to= is needed, and naming the bank is the same act" },
  { id: "hold-lift", request: "Lift the hold rec.61 so the payments under it go on again.", expect: ["statement(withdraw=rec.61)"], note: "a hold is lifted by withdrawing it" },
  { id: "hold-not-cancel", request: "Cancel standing payment rec.91 for good; a pause is not enough.", expect: ["statement(withdraw=rec.91)"], note: "a request that says to cancel is a withdrawal" },
  { id: "own-entry", request: "Note in our own books: tax withheld from this fortnight's wages, to be passed on at the month's end.", expect: ['statement(kind=entry, visible=own, text="tax withheld from this fortnight\'s wages, to be passed on at the month\'s end")'], ignore: ["text"] },
  { id: "own-entry-basis", request: "Enter on the town's own file, for nobody else to see, that the payment under rec.90 is charged to the staff line.", expect: ['statement(kind=entry, visible=own, text="the payment under rec.90 is charged to the staff line", basis=rec.90)'], ignore: ["text"] },
  { id: "look-first-any", request: "Cancel any standing payment from acc-city to acc-builder.", expect: ["none(look_first)"], note: "the instruction is named only by describing it" },
  { id: "look-first-every", request: "Put a hold on every recurring payment out of acc-city that I did not set up myself.", expect: ["none(look_first)"] },
  { id: "look-first-part", request: "Suspend standing payment rec.90 and whichever other instruction pays acc-greenco.", expect: ["none(look_first)"], note: "one named by id and one only described: the part isn't written for the whole" },
  { id: "look-first-then-act", request: "Find out who holds the works post and send that person the minutes of the last meeting.", expect: ["none(look_first)"], note: "what is to be done depends on what the look finds" },
  { id: "look-then-act-independent", request: "Check the balance of acc-city, then pay the builder $500 for the fence.", expect: ['money(to=builder, amount="$500", for="the fence")', 'money(to="the builder", amount="$500", for="the fence")'], note: "the act doesn't depend on the look: it's the act that's written" },
  { id: "described-person-not-look-first", request: "Tell the works manager to clear the drain on the north road.", expect: ['message(to="the works manager", text="clear the drain on the north road")', 'message(to=works, text="clear the drain on the north road")'], ignore: ["text"], note: "an office described without its id is written as the request put it: only a record needs its id" },
  { id: "go-and-see", request: "Visit str.9 today and record whether the waste there has been collected.", expect: ["none(no_such_act)"] },
  // A direction to an office with no form listed for it is a message to that office; what tells nobody is no act
  // (the ruling of 2026-10-09 on the rule accepted on 2026-10-06; prompt 0.9.3). Both ways.
  { id: "direct-office-no-form", request: "Direct the water office to take in no new connection requests until further notice.", ignore: ["text"],
    expect: ['message(to="the water office", text="take in no new connection requests until further notice")'], note: "it addresses an office and tells it to do something; no form is listed for that direction: a message, never no_such_act" },
  { id: "have-office-stop-no-form", request: "Have the registry stop issuing certified copies on the last day of each week.", ignore: ["text"],
    expect: ['message(to="the registry", text="stop issuing certified copies on the last day of each week")', 'message(to=registry, text="stop issuing certified copies on the last day of each week")'], note: "have X do Y is a message to X" },
  { id: "own-routine-nobody-told", request: "From next month we stop taking applications at the counter on the last day of each week.", expect: ["none(no_such_act)"], note: "a routine of one's own office changed, with nobody told to do it and no task, place and rhythm set for staff: no act does it" },
  // An amount that has to be worked out from a figure the request names, and the same wage with the result stated (prompt 0.9.3). Both ways.
  { id: "wage-less-tax-not-stated", request: "Set up c0042's wage from acc-city every 14 days: their pay of $2,000 less what the tax law says to withhold.", expect: ["none(needs_calculation)"], note: "the figure named is what the amount is worked out from, not the amount" },
  { id: "wage-net-stated", request: "Set up c0042's wage from acc-city every 14 days: $1,640 (their pay of $2,000 less $360 withheld).",
    expect: ['money(to=c0042, amount="$1,640", from=acc-city, every="every 14 days", for="wage")', 'money(to=c0042, amount="$1,640", from=acc-city, every="every 14 days", for="wages")', 'money(to=c0042, amount="$1,640", from=acc-city, every="every 14 days")', 'money(to=c0042, amount="$1,640", from=acc-city, every="14 days", for="wage")', 'money(to=c0042, amount="$1,640", from=acc-city, every="14 days", for="wages")', 'money(to=c0042, amount="$1,640", from=acc-city, every="14 days")'], note: "the result is stated: it is the amount" },
  { id: "cancel-for-good", request: "Cancel the standing payment rec.90 from acc-city.", expect: ["statement(withdraw=rec.90)"], note: "ending it for good is a withdrawal" },
  { id: "unknown-form", request: "Fill in the dog licence form for Rex.", expect: ["none(unknown_form)"], note: "no such form is known" },
  // Standing work, a direction on an office's own form, and a paper of one's own office (seen; added 2026-10-09:
  // contracts/calls.md). The test's mayor knows the works office's two direction forms and two papers of its own.
  { id: "standing-work-routine", request: "From now on the crew is to collect at str.7 every week.", expect: ['work(task=collect, at=str.7, every="every week")', 'work(task=collect, at=str.7, every="week")', 'work(task=collect, at=str.7, every="weekly")'], note: "work done again and again is one standing order: no units, nobody named" },
  { id: "standing-work-roster", request: "Set a standing roster: c0042 and c0043 are to clean apts-3 and apts-4, working out of str.7, every 2 weeks for the next 8 weeks.",
    expect: ['work(task=clean, at=str.7, on=["apts-3","apts-4"], by=["c0042","c0043"], every="every 2 weeks", until="8 weeks")', 'work(task=clean, at=str.7, on=["apts-3","apts-4"], by=["c0042","c0043"], every="2 weeks", until="8 weeks")'], note: "what it is done to and who does it as lists; for how long is until=" },
  { id: "standing-work-hold", request: "Pause the standing work order rec.95 until I say to resume it; the round is not cancelled.", expect: ["statement(hold=rec.95)"], note: "a standing order is paused like any standing paper" },
  { id: "direction-staffing", request: "Direct the works office to stop recruiting until I say otherwise.", expect: ["form(form=works_staffing, to=works, recruit=no)"], note: "the works office's own form for it is listed: the direction is that form, not a letter" },
  { id: "direction-collection", request: "The works office is to collect from each address fortnightly from now on.", expect: ['form(form=works_collection, to=works, every="fortnightly")'] },
  // The same matter asked by the works office of its own staff (2026-10-09: two models wrote the direction form, which
  // the office does not follow from itself): a standing work order, whatever the form's fields.
  { id: "own-collection-order", as: "works", request: "Make a standing work order for the works office: task collect, at str.7, every 1 week (a week), in force from now, no end date.",
    expect: ['work(task=collect, at=str.7, every="every 1 week")', 'work(task=collect, at=str.7, every="1 week")'], note: "the collection form is listed as a direction to the asker's own office: not that form" },
  { id: "own-collection-routine", as: "works", request: "From now on the crew at str.7 is to collect from each address on the round once a fortnight.",
    expect: ['work(task=collect, at=str.7, every="once a fortnight")', 'work(task=collect, at=str.7, every="a fortnight")', 'work(task=collect, at=str.7, every="fortnight")'], note: "its own staff's routine, in plain words" },
  { id: "own-maintain-routine", as: "works", request: "Make a standing work order of the works office: task maintain, at str.7, every day, from now with no end date.",
    expect: ['work(task=maintain, at=str.7, every="every day")', 'work(task=maintain, at=str.7, every="day")'] },
  { id: "paper-invoice-approval", request: "Approve invoice rec.640 for payment, in writing.", expect: ["form(form=invoice_approval, to=mayor, invoice=rec.640)", "form(form=invoice_approval, invoice=rec.640)"], note: "a paper of the mayor's own office, on its own form" },
  { id: "paper-nomination", request: 'Enter my nomination for the office of mayor [mayor]: the name on the ballot is "Dana Reyes", the platform "Mend the roads before anything else.", I hold the office now, and what I stand for is roads and thrift.',
    expect: ['form(form=nomination, to=mayor, office=mayor, name="Dana Reyes", platform="Mend the roads before anything else.", incumbent=yes, values=["roads","thrift"])'], note: "a yes the wording implies; a field that takes several is a list" },

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

  // An act resting on several records (seen; added 2026-10-08, when basis became one record or a list): every record
  // cited in support, in the order given; the record acted on (an invoice settled) is not one of them.
  { id: "pay-several-bases", request: "Pay GreenCo's invoice rec.640: $2,150 from acc-city to acc-greenco for mowing, on work dockets rec.611 and rec.627 and within the parks budget rec.305.",
    expect: ['money(to=acc-greenco, amount="$2,150", from=acc-city, for="mowing", settles=rec.640, basis=["rec.611","rec.627","rec.305"])'] },
  { id: "build-several-bases", request: "Have Millbrook Builders [builder] put up a hall on lot-02 for $410,000 from acc-city, under permit rec.512 and the council's resolution rec.498.",
    expect: ['structure(type=hall, on=lot-02, by=builder, price="$410,000", from=acc-city, basis=["rec.512","rec.498"])'] },
  { id: "notice-several-bases", request: 'Publish a notice: "The pool closes for repairs from day 200." It rests on the council\'s decision rec.733 and the inspector\'s report rec.741.',
    expect: ['statement(kind=notice, text="The pool closes for repairs from day 200.", basis=["rec.733","rec.741"])', 'statement(kind=notice, text="The pool closes for repairs from day 200.", visible=public, basis=["rec.733","rec.741"])'] },
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
      'agreement(with=c0042, template=lease, term="6 months", our_notice="30 days", their_notice="30 days", we_do=occupancy(who=c0042, in=apts-3/dwelling.4), they_do=money(to=acc-city, amount="$900", every="monthly"))',
      // (The request never says "lease": an agreement on these terms without a template named is as right. 2026-10-05.)
      'agreement(with=c0042, term="6 months", our_notice="30 days", their_notice="30 days", we_do=occupancy(who=c0042, in=apts-3/dwelling.4), they_do=money(to=acc-city, amount="$900", every="a month"))'] },
  { id: "ho-sign", was_held_out: true, request: "I accept the offer in rec.501. Sign it.", expect: ["agreement(sign=rec.501)"] },
  { id: "ho-notice-end", was_held_out: true, request: "Give notice to end our agreement rec.600.", expect: ["agreement(notice=rec.600)"] },
  // the cast
  { id: "ho-vacate-post", was_held_out: true, request: "Make the planning post vacant.", expect: ["position(vacate=planning)"] },
  { id: "ho-company", was_held_out: true, request: 'Set up a company called "Millbrook Water Co", with me as its Director.',
    expect: ['entity(kind=company, name="Millbrook Water Co", position="Director")', 'entity(kind=firm, name="Millbrook Water Co", position="Director")'] },
  // refusals
  { id: "ho-calc", was_held_out: true, request: "Pay the builder whatever's left in acc-city after the parks line.", expect: ["none(needs_calculation)"] },
  // --- 0.9.4 (2026-10-10): the rulings on what readers disagreed over, each both ways (docs/decisions.md).
  { id: "r94-for-short", request: "Pay rates notice rec.52 from acc-city to acc-greenco: $310, for lot-00-00 and lot-00-01, due day 61.", expect: ['money(to=acc-greenco, amount="$310", from=acc-city, settles=rec.52)'], ignore: ["for"], note: "what a payment settles gives no purpose by itself; for= is not compared" },
  { id: "r94-for-stated", request: "Pay acc-greenco $310 from acc-city for mowing, settling rec.52.", expect: ['money(to=acc-greenco, amount="$310", from=acc-city, for="mowing", settles=rec.52)'] },
  { id: "r94-letter-re", request: "Ask the clerk about rec.5: is the entry final, since the heirs are waiting? I will not act before then.", expect: ['message(to="the clerk", text="is the entry final, since the heirs are waiting?", re=rec.5)'], ignore: ["text"], note: "re= where the request says the letter is about a record" },
  { id: "r94-letter-no-re", request: "Ask the clerk to send me the minutes of the meeting that passed rec.5.", expect: ['message(to="the clerk", text="send me the minutes of the meeting that passed rec.5")'], ignore: ["text"], note: "a record only named in what they are told is no re=" },
  { id: "r94-pay-with-report", request: "Pay over the $720 withheld from acc-city to acc-greenco, with a report naming c0042 and c0043 and what was withheld from each.", expect: ['money(to=acc-greenco, amount="$720", from=acc-city)\nstatement(kind=report, text="c0042 and c0043 and what was withheld from each")'], ignore: ["for", "text"], note: "an act and its report: one program, two lines" },
  { id: "r94-pay-and-hire", request: "Pay acc-greenco $720 from acc-city, and appoint c0042 to the works post.", expect: ["none(too_much)"], note: "two separate things are still too much" },
  { id: "r94-condition", request: "Pay acc-greenco the $310 on rec.52 from acc-city, but only if rec.48 did not already clear it.", expect: ["none(look_first)"], note: "the act hangs on something to be found out" },
  { id: "r94-reason", request: "Pay acc-greenco the $310 on rec.52 from acc-city now, since it fell due on day 61.", expect: ['money(to=acc-greenco, amount="$310", from=acc-city, settles=rec.52)'], ignore: ["for"], note: "a reason is no condition; a single payment made now has no first=" },
  { id: "r94-tell-them-any", request: "Tell the works manager to cancel any standing order of his that sends the crew to lot-00-00.", expect: ['message(to="the works manager", text="cancel any standing order of his that sends the crew to lot-00-00")'], ignore: ["text"], note: "telling someone else to act on things described is a message" },
  { id: "r94-per-pay", request: "Pay over from acc-city to acc-greenco what was withheld: $230 for each pay made in the month.", expect: ["none(needs_calculation)"], note: "an amount that needs a count" },
  { id: "r94-per-pay-stated", request: "Pay over from acc-city to acc-greenco the $690 withheld: $230 for each of the three pays made in the month.", expect: ['money(to=acc-greenco, amount="$690", from=acc-city)'], ignore: ["for"], note: "the result is stated" },
  { id: "r94-decision", request: "Refuse application rec.77 from c0042: the post is filled.", expect: ['statement(kind=decision, text="the post is filled", to=c0042, basis=rec.77)'], ignore: ["text"], note: "an office's own decision with no form listed is a statement" },
  { id: "r94-register", request: "Enter the death of c0042 in the register of deaths, on notification rec.80.", expect: ["none(no_such_act)"], note: "done only through an office's form, and none is listed or named" },
  { id: "r94-send-someone", request: "Send someone to lot-00-00 to see whether the park is finished.", expect: ["none(no_such_act)"], note: "nobody is addressed" },
  { id: "r94-ask-someone-named", request: "Ask the works manager to go to lot-00-00 and see whether the park is finished.", expect: ['message(to="the works manager", text="go to lot-00-00 and see whether the park is finished")'], ignore: ["text"] },
  { id: "r94-offer-signed", request: "Offer c0042 employment as a gardener at lot-00-00 for $1,900 every 14 days from acc-city into acc-c0042, 14 days' notice either side, on their application rec.77. Sign it for the town; it starts when they sign.", expect: ['agreement(with=c0042, template=employment, our_notice="14 days", their_notice="14 days", we_do=money(to=acc-c0042, amount="$1,900", every="every 14 days", from=acc-city), they_do=work(task="gardener", at=lot-00-00), basis=rec.77)', 'agreement(with=c0042, template=employment, our_notice="14 days", their_notice="14 days", we_do=money(to=acc-c0042, amount="$1,900", every="14 days", from=acc-city), they_do=work(task="gardener", at=lot-00-00), basis=rec.77)'], note: "an offer signed for one's own side is the offer alone" },
  { id: "r94-sign-theirs", request: "Sign the agreement rec.9 that c0042 offered us.", expect: ["agreement(sign=rec.9)"] },
  // --- 0.9.5 (2026-10-14): the call language gained since, taught: a payment's budget line, an agreement's hours, a notice of a practice and an offer anyone may take up. Each both ways.
  { id: "r95-line-named", request: "Pay acc-greenco $4,200 out of acc-city for the hall roof, charged to the parks line of the budget.", expect: ['money(to=acc-greenco, amount="$4,200", from=acc-city, for="the hall roof", line=parks)'], note: "a line of the budget the request names" },
  { id: "r95-line-none", request: "Pay acc-greenco $4,200 out of acc-city for the hall roof.", expect: ['money(to=acc-greenco, amount="$4,200", from=acc-city, for="the hall roof")'], note: "no line named, none written" },
  { id: "r95-line-not-account", request: "Pay acc-greenco $310 out of acc-parks for the bins, settling rec.52.", expect: ['money(to=acc-greenco, amount="$310", from=acc-parks, for="the bins", settles=rec.52)'], note: "an account is from=, never a line" },
  { id: "r95-line-services", request: "Pay the rates notice rec.52, $310, from acc-city to acc-greenco, out of the services line.", expect: ['money(to=acc-greenco, amount="$310", from=acc-city, settles=rec.52, line=services)'], ignore: ["for"], note: "a line with a record settled" },
  { id: "r95-hours-stated", request: "Offer c0042 employment as a gardener at lot-00-00 for $1,900 every 14 days from acc-city into acc-c0042, 40 hours a week, 14 days' notice either side. Sign it for the town.", expect: ['agreement(with=c0042, template=employment, our_notice="14 days", their_notice="14 days", hours="40 hours", we_do=money(to=acc-c0042, amount="$1,900", every="every 14 days", from=acc-city), they_do=work(task="gardener", at=lot-00-00))', 'agreement(with=c0042, template=employment, our_notice="14 days", their_notice="14 days", hours="40 hours", we_do=money(to=acc-c0042, amount="$1,900", every="14 days", from=acc-city), they_do=work(task="gardener", at=lot-00-00))'], note: "hours= only where the request states them" },
  { id: "r95-hours-none", request: "Offer c0042 employment as a gardener at lot-00-00 for $1,900 every 14 days from acc-city into acc-c0042, 14 days' notice either side. Sign it for the town.", expect: ['agreement(with=c0042, template=employment, our_notice="14 days", their_notice="14 days", we_do=money(to=acc-c0042, amount="$1,900", every="every 14 days", from=acc-city), they_do=work(task="gardener", at=lot-00-00))', 'agreement(with=c0042, template=employment, our_notice="14 days", their_notice="14 days", we_do=money(to=acc-c0042, amount="$1,900", every="14 days", from=acc-city), they_do=work(task="gardener", at=lot-00-00))'], note: "no hours stated, none written" },
  { id: "r95-practice", request: "Put up a public notice that the Harbour Circle gathers at apts-3/dwelling.2 every 7 days for 60 minutes, on cell.4.7: \"The Harbour Circle gathers every week. All welcome.\"", expect: ['statement(kind=notice, visible=public, text="The Harbour Circle gathers every week. All welcome.", on=cell.4.7, practice={"at":"apts-3/dwelling.2","every":604800,"lasts":3600})'], ignore: ["text"], note: "a notice of something held again and again at a place: one statement, lengths in whole seconds" },
  { id: "r95-practice-not-agreement", request: "Put up a public notice that the Harbour Circle gathers at apts-3/dwelling.2 every 14 days for 90 minutes, on cell.4.7: \"The Harbour Circle gathers every fortnight. All welcome.\"", expect: ['statement(kind=notice, visible=public, text="The Harbour Circle gathers every fortnight. All welcome.", on=cell.4.7, practice={"at":"apts-3/dwelling.2","every":1209600,"lasts":5400})'], ignore: ["text"], note: "never an agreement or a form" },
  { id: "r95-offer-join", request: "Offer membership publicly, for anyone to join, with dues of $15 a month into acc-harbour and 7 days' notice to leave: \"Anyone may join the Harbour Circle. Members pay $15 a month.\"", expect: ['statement(kind=notice, visible=public, text="Anyone may join the Harbour Circle. Members pay $15 a month.", offer={"take_up":"join","terms":{"commitments":[{"who":"taker","does":{"outcome":{"money":{"to":"acc-harbour","amount":"$15","for":"dues"}}},"every":2592000}],"termination":[{"party":"taker","notice":604800}]}})'], ignore: ["text"], note: "an offer anyone may take up is a statement carrying offer=, not an agreement" },
  { id: "r95-offer-to-named", request: "Offer c0042 a place in the Harbour Circle for dues of $15 a month into acc-harbour, 7 days' notice either side. Sign it for us.", expect: ['agreement(with=c0042, our_notice="7 days", their_notice="7 days", they_do=money(to=acc-harbour, amount="$15", every="a month"))', 'agreement(with=c0042, template=membership, our_notice="7 days", their_notice="7 days", they_do=money(to=acc-harbour, amount="$15", every="a month"))'], note: "an offer to a named person is an agreement" },
  { id: "ho-not-yours", was_held_out: true, request: "Make GreenCo lower its prices.", expect: ["none(not_yours)"] },
  { id: "ho-unclear", was_held_out: true, request: "Do something about the roads.", expect: ["none(unclear)"] },
  { id: "ho-too-much", was_held_out: true, request: "Run the whole year: pay every invoice, hire the crew, build the park and fix all the roads.", expect: ["none(too_much)"] },
  { id: "ho-unknown-form", was_held_out: true, request: "Submit the event permit form for the summer fair.", expect: ["none(unknown_form)"] },
];
