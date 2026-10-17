# Who holds the town's posts, who works in its offices, and what they run on (foundations F5)

**Source:** `worlds/generator/generate.ts` ("who staffs the town's own bodies", `office`, `resolveHolders`, the licence), the profile's
`public_service` block (`worlds/generator/profile.ts`, `worlds/profiles/*.json`), `kernel/crates/contracts/src/config.rs` (a system's
template says what it does), `orchestrator/test/foundations-laws.test.ts`. Plan: `docs/design/foundations.md` (laws 2 and 3, section 2.3).
Decision: `docs/decisions.md`, "Foundations F5".

## The fault

Every office of a generated town was held by a system nobody supplied: a free machine that could do any act in a second, never tired and
cost nothing. A town's finance officer, its tribunal, its newspaper and each shop's manager were all that machine. Each place where it was
noticed had got a patch of its own (a daily case limit, a processing delay, an error rate that doubled under backlog). The foundations'
law 3 says only actors work: a person, or a system someone supplied.

## What a post is held by now

- **A person of the town.** Each body of the town (the town's government, the tribunal, the ombudsman, the consumer desk, the electoral
  commission, the land registry, the paper, the bank, the union, the water and energy bodies, the police) has **staff hired from the
  town through the same jobs as anyone's**: an employment agreement, a standing wage from the body's account, taxed as any wage. The
  number is the profile's rate per 1,000 residents (`public_service.staff_per_1000`, full-time equivalents; a body keeps at least one),
  and the pay the profile's (`public_service.wage_per_pay_period`). Each shop's, factory's and builder's manager, and each clinic's,
  school's and police station's head, is one of the body's own staff. A letting office is held by a **property manager**: the profile's
  rate of them (`property_management`), each employed by one landlord and holding the letting offices of several.
- **Several posts to a person.** A body with fewer staff than posts has its staff hold several each (a town of a thousand has three
  administrative officers for its ten offices). A person has one timeline: what each post makes them do is placed on it, so a post
  waits for the person to be free. **An office that cannot afford staff, or has too few, falls behind: that is a consequence, not a fault.**
- **The mayor and the councillors** are residents drawn for the posts (a stream of their own, `office-holders`), **unpaid** (a placeholder:
  no profile states an allowance yet).
- **A model's seat** (`model_seats`, a model mayor) is a participant of its own **for the person who holds the post** (`shares_body`: the
  person's body and their one timeline are shared, so what the seat does takes that person's time, at a person's speed, and the person's
  own participant goes on with their life and their other posts in code). It holds that post and no other, has the office's papers and no
  private channels, and keeps its old id (`<post>-system`, so logs and tools of earlier runs read the same). Who holds a post is settled by
  the town alone, whether or not a model sits in it, so **a town with a seat is the town without it but for that post** (a pilot and its code
  twin). Two things follow and are not faults: the person is busier (the seat's time is theirs), and a seat is the person to the town (it
  can be written to as them, and is told its own age and where it is).
- **A system, delivered from a template that says what it does** (`does`), by its supplier, under a licence where it is the bank's:
  - the bank's **payment platform** (`payment-system`: message, publish, transfer, open and close an account), held by the bank under
    a licence (`licence-bank-payments`: an agreement with the outside world, and the bank's standing instruction to pay the fee each
    month; the fee is the profile's price per resident per year, `public_service.licences.payment_system`). The supplier may switch it
    off, as the kernel allows, if the fee is not paid;
  - the **outside world's own** (`agency-system`, `market-system`: its agencies, its funders, its market), supplied by itself and
    paying no licence: the outside world is the declared edge. They are the support payments office, the grants, the valuer, the
    statistician, the landfill, the weather bureau, the migration of people, the retirement fund's administrator.
  A system acts only within its template; any other act is `not_capable`. What a system's act takes is a row of the world's table
  (`orchestration.act_time.system`: a second); there is no default for a block its template does not list.

## What pays them

| Body | Paid from | Where the money comes from |
|---|---|---|
| The town | its budget, a line of its own (`administration`) | the council adopts it; its yearly sum is the staff's wages |
| The state's bodies (tribunal, ombudsman, consumer desk, electoral commission, land registry, the paper) | a grant from outside, to each body's account | sized to the wage bill, per home seen, as the police's and the clinic's are |
| The police station's officer in charge | the police's grant | the grant is raised by one officer's pay |
| The bank, the union, the water and energy bodies, the landlords | their own accounts | their takings; each starts with twelve weeks of the wage bill in hand |

Left out, on purpose, and recorded: the paper's advertising (it is grant-paid, a placeholder); an allowance for the mayor and the councillors.

## A body's own paperwork (foundations F6)

A body that employs people does what any employer does with them, through the ordinary forms and laws, and its staff do it.

- **A payroll officer** (`<body>-payroll`, module `body.payroll`, `participants/src/behaviour/payroll.ts`) is a post held by one of the body's
  staff. It runs the same `Staffing` payroll as a firm's manager and the town's finance office: it picks up the wage standing orders the body
  opened with, starts and stops wages, files the **return of the tax withheld** on the days the law states and pays it over, and, when a
  member of staff dies, hears of it as any employer does (the registry's entry, or its bank's word, which now comes at **each** pay day
  until the payment is stopped, because a letter to an office nobody holds is lost), ends the employment on record and withdraws the wage.
  The tribunal, the desks, the electoral commission, the paper, the land registry, the bank, the union and the water and energy bodies have
  one; the clinic's, the school's and the police station's has the same duty for their heads only (their own modules pay their doctors,
  teachers and officers). Before this the tax withheld from these bodies' staff stayed in the bodies' accounts (5 to 11 per cent of the
  year's tax and contributions in au-vic and gb-eng, about 5 per cent in ke-nakuru), and nobody stopped a dead officer's pay.
- **A deputy** (`<body>-payroll-deputy`; for a shop, factory or the builder `<firm>-deputy`) is another of the staff who looks at the
  organisation's posts every few days and, where a post a person held is empty (its holder died), appoints one of the staff to it. It is the
  only way a post is refilled: only a living holder of a post of an organisation can appoint into it. The officer keeps the deputy's post
  filled. A body with two or more staff has a deputy; a body of one has none.
- **When nobody of a body is left** (review of the foundations, finding 6). A body whose only member of staff dies has nobody left to stop the wage or fill the post. Who fills it is the body's constitution, as data: a post may name an `appointed_by` (contract), and the profile's `public_service.appointed_by` says, by kind of body, who that is. Built: **"council"**, for the courts, the oversight bodies, the electoral commission, the land registry and the water and energy bodies (a placeholder in every profile, with its reason). The city has an **appointments officer** (`body.payroll`, part `appointer`) who looks at those bodies' posts every few days (those seen vacant every round) and, where one has stood vacant for 14 days (the body's own deputy fills one from its staff within days, so this is the case only when nobody of its own is left), **seconds one of the city's own administrative staff** to it, as a local government assigns officers to the bodies it runs. The seconded officer is paid by the city as before (ordinary hiring has already paid them); holding the body's payroll post, they hear of the dead staff member and stop the wage as any employer's payroll does. Not done: the bodies not named (the bank, the union, the paper, the letting offices, shops and factories) stay headless if their last staff member dies: their owners or members would appoint, and no owner's or member's office exists to do it (the kernel can say so: a post's `appointed_by` may be a person or any organisation). The appointments officer is a councillor's post (the city's staff may be one person, whose death would take the appointer with the offices) and watches **the city's own offices** too, which have no deputy, so it fills them at its next round (every three days) and not after fourteen; the au-vic profile names the police among the posts the council fills. **Where none of the city's staff is left to second, it recruits for the city through ordinary hiring** (2026-10-17): a posting for the city's administrative role, an applicant, an agreement, the wage paid as any of the city's staff is paid (the finance office once the new officer holds it), and the officer seconds whoever is hired at its next round. Nor does a body otherwise hire a replacement for staff who die, and a body on its own account (a bank, a union, a letting office) with no council authority named stays headless (six landlords' offices at the end of a gb-eng year; shops' deputies). A post whose council officers are all dead too stays vacant.
- **Why it was not seen before.** A transaction was queued once for a person and an organisation, and the first post of theirs to look took it:
  a person holding two posts of one organisation (a payroll officer who is also the registry officer) told the other post nothing. Each
  capacity has its own queue now (`transactions_key`, `kernel/crates/world/src/state.rs`; `kernel/tests/foundations.rs`,
  `a_person_holding_two_posts_of_one_organisation_is_told_of_a_payment_in_each`).

## Where the figures come from

Each figure is the profile's, with its source, or marked a placeholder (`docs/profiles.md`; the sources are in
`sources["public_service.*"]`). **Most are placeholders**: the wage is a local-government clerical officer's pay from a published scale
in seven of the nine places; the administration rate is derived from a published headcount in three; every other rate and every licence
price is an estimate that says what it was made from and is marked "(to confirm)". The property-management rate is one placeholder,
carried unchanged to every profile. Nothing is a place's figure in code (`orchestrator/test/generality.test.ts`).

## What a seat sees

A person in the office sees it as before (its papers, its roster, its books). What is new: it is told **its own body** (age, where it is,
its children) and can be **written to as the person it is** (a neighbour asks the seat's person for work); a paper its office's staff make
carries the **staff member's** id as its author, not a system's, with the post it was made in on the paper (`in_position`); and the town's
file it reads holds the administrative staff's employment agreements and standing payments (a mayor's prompt grew by about 2,000
characters). Nothing of the kernel, the table or the template appears. The translator's forms are unchanged: the `system(...)` form
still has no `to`, so a seat that tries to deploy a system is refused `not_supplier`; nobody seats a supplier yet.

## Revisit if

- the mayor and the councillors should be paid (a profile states an allowance);
- the paper's advertising is to be done by its staff;
- one person holding ten posts is thought too few (the rate is the profile's; a post nobody can staff should be said by the place);
- a system's work should have its own seconds (a payments platform at a second a payment is not a figure anyone sourced).

## Hiring follows need (lane C1, Rust port, 2026-10-17; risk ME-2)

`rules::labour::staff_needed`: a firm has the staff the trade it expects can pay: takings smoothed over the horizon, less what is bought in, divided by a worker's pay with a margin (`required_margin_bps`), within what its premises hold and never below the least it runs with; before it has a trade record, the staff it opened with. It posts a job only while short of that, and does not replace those who leave once over it (existing `LabourPlan`). The ceiling is physical capacity, not a target: a firm no longer hires to a fixed headcount whatever it sells. Basis: Hamermesh 1993 (demand for labour is the marginal revenue product), Holt et al. 1960 (smoothing). Callers: the employer module computes it; retailer and producer (lane C2) may call it in place of their stock-against-demand headcount.

**Owner's posts** (decided 2026-10-17; `bugfix` branch builds it in TS): a firm's owner (or the owner's estate) fills a vacant post of the firm wherever the owner lives, through ordinary hiring, when none of the staff is left (`body.payroll` 0.5.0, params `owner`, `owner_participant`). **Dead owner**: a firm never pays a dead owner or member of staff: when the only post-holder dies the payroll stops their wage orders on the death record.
