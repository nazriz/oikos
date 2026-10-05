# How real seats phrase a request

For whoever generates the translator's training data. From the 194 requests the pilots' model seats made with `do` (mayor 144, finance officer 38, planning officer 12; pilot-cases.ts has them word for word). Two voices: **early** (gpt-6-sol; one seat, the mayor; 95 requests) and **late** (gpt-6.1-sol; three seats; 99 requests). Write for both.

**Length.** Median 400 characters (55 words, 3 sentences); a tenth under 150, a tenth over 940, the longest 1,812. Early: median 300, rarely over 500. Late: median 630, a tenth over 1,160. One-line requests exist, and nearly all of them ask to read something.

**Register.** Formal, administrative, complete sentences, no small talk, no "please" (once in 194), no questions. British spelling mostly ("authorise", "itemised"), sometimes American in the same run.

**How they open.**
- An imperative verb, three in four: Submit (33), Inspect (24), Direct (17), Withdraw (17), Review (15), Read (11), Prepare (8), Show me (6); then Suspend, Cancel, Pause, Obtain, Attend, Visit, Put, Place.
- "As mayor, …", "As Mayor of Millbrook, …", "As mayor [mayor], …": nearly half of the early requests, none of the late ones.
- First person, now and then: "I inspect the transaction record for …", "I propose this budget …", "I personally convene …".
- The capacity or the route first, sometimes: "As the holder of [acc-city], request from …", "Through finance, the authorised instructor of acc-city at bank, place …", "For Town of Millbrook [city], disable …".

**How they name things.** Always by id; one request in a hundred has none. Median 4 ids a request, a tenth have 10 or more, one has 27.
- In square brackets, early (four in five): `[rec.133]`, `[acc-city]`, `[house-165]`. Usually a description and then the id: "the works manager [works]", "the town account [acc-city]", "council ballot [rec.2045]", "Millbrook Savings Bank [bank]".
- Bare, late (more than half): "from acc-city to acc-c0003", "budget rec.4754", "job-c0003-wages". The two styles are mixed within one run, and sometimes within one request.
- Lists of ids run on in a sentence: "[acc-c0003], [acc-c0004], [acc-c0008], [acc-c0009], [acc-c0011], or [acc-c0013]"; shorthand appears: "rec.4751/rec.4752", "job-cXXXX-sig-city", "lot-00-29 through lot-39-29".
- Authority is cited by id: "under law-charter", "under [law-rates]", "under proc-payments", "using my sole-signatory authority [signatories-city]" (one in ten).
- A form is named by its record's id, not its name: "using form-council-proposal", "on [form-council-proposal]", "[form-permit]"; once "the council proposal form".
- People by role and id, not by name; a seat names another seat by its system id ("mayor-system", "bank-payments-system") or its post ("finance", "council-clerk"), and uses both for the same office.

**Amounts and time.** Exact, with cents: "$469,285.68", "$2,393.34"; totals restated ("totalling $11,966.70"); once a seat distrusted the form and wrote "staff 50000000 cents ($500,000)". Recurrence as "every 14 days", "fortnightly". Dates as "year 1 day 3", "day 31", "D39", "Y1 day26": never a calendar date.

**How a form is asked for.** The form, then its fields as a list, then the text. Fields as "Kind: law. Mainly affects: tenants." (early) or "kind budget; affects neither; staff $469,285.68" (late). Budget lines as "staff $500,000 for the works crew, services $40,000 for landfill charges": the amount, then what it is for, which has no field. A law's words follow "Proposed law:" or "Proposal text:", unquoted, several sentences.

**How clauses stack.** One sentence says the act; the rest qualify it. Late requests carry three to eight sentences after the first:
- what it rests on: "responding to petitions rec.1127 and rec.1179", "whose proposal [rec.1641] was withdrawn in [rec.2685]";
- a second thing for someone else: "Ask the council clerk [council-clerk] to put it to the councillors' 14-day ballot." (a third of the form requests); or the same with nobody named, "Put it to the councillors' 14-day ballot.", which is no letter to anyone (six requests);
- what must stay as it is: "Preserve the instructions and their history, employment contracts, earned entitlements and accruals." (a third of late requests);
- what it must not do: "Do not reverse completed transfers, recover employees' money, terminate employment or create replacement payments.", "This submission authorises no payment." (half of late requests; none early);
- what it wants to see first: "Show the exact proposed hold and its scope for confirmation.", "Present the actual process controls to be changed in the preview; withdrawal of a posting alone does not implement this request." (a fifth of late requests);
- what to do if it can't be done: "If a reversible pause is unavailable, report that limitation rather than substituting permanent cancellation."
- Several acts in one request are numbered or sequenced: "Take these actions in order: (1) … (2) … (3) …", "1. Ask the electoral commissioner [electoral] to …".

**What they ask for** (of 180 distinct requests). To read or inspect something, a third: a ledger, a petition, replies, who holds a post. A form filled in, a quarter. A direction to another office ("Direct the works manager [works] to …"), a sixth. Something withdrawn, a tenth. A standing arrangement paused or a practice stopped, a tenth, and going somewhere to see, one in twenty: nothing in the call language says these (`none(no_such_act)`), and they often come with something that can be said ("Withdraw posting [rec.15866]. Suspend the automatic creation of further vacancies …"), which is still refused whole. A withdrawal with a pause given as its reason ("Withdraw … pending verification") is a withdrawal. Payments, buildings, agreements: a handful.

**A seat rewords after a failure,** and the retries are a style of their own: shorter, one act, plainer ("Show me the result of council ballot [rec.1760]." after a 260-character version failed), or longer and defensive, naming what went wrong last time ("a letter to the bank does not implement this action").

**Verbatim.**
1. `Read the full text of petition [rec.133].`
2. `Show me the result of council ballot [rec.1760].`
3. `Read any replies I have received from [bank] about my letter [codex-375].`
4. `Submit planning permit application [form-permit] to the planning office for a park on town-owned lot [lot-00-00].`
5. `Direct the rates officer [rates] to obtain the valuer's current valuations for all rateable land in Millbrook under [law-rates].`
6. `As Mayor of Millbrook [mayor], direct the town works manager [works] to arrange collection of the uncollected waste at [house-165] today and report when it is complete, why it was missed, and whether other homes were missed.`
7. `As mayor, visit house-150 and record whether waste is awaiting collection there today.`
8. `Using form-council-proposal, submit a law proposal to the council clerk on petitions rec.3919 and rec.3971. Proposed law: A landlord must give at least 90 days’ written notice to end a tenancy and may not increase residential rent by more than 5% in any 12 months. Kind: law. Mainly affects: tenants.`
9. `I propose this budget for year 2 to the council on form-council-proposal: staff $650,000; environment $250,000; parks $100,000; roads $100,000; services $40,000. It is a budget proposal affecting neither tenants nor development. Please put it to the councillors' ballot.`
10. `Withdraw my unadopted year-1 budget proposal [rec.1337], preserving its history. No replacement proposal or payment is part of this action.`
11. `Withdraw council ballot [rec.1642], whose proposal [rec.1641] was withdrawn in [rec.2685]. Keep replacement proposal [rec.2678] and its ballot [rec.2679] unchanged.`
12. `Temporarily pause the recurring bank payment instruction job-c0011-wages, which pays $2,393.34 from acc-city to acc-c0011 every 14 days. Keep the instruction so it can be resumed. Leave the worker's employment, earned wages and payment history intact. Do not permanently cancel the instruction.`
13. `Stop automatically advertising new works crew vacancies for city at town-hall/workplace.1. Keep existing employment agreements and payroll in place.`
