# Written directions to an office

**Source:** `Directions` in `participants/src/behaviour/common.ts`; the offices that take them (`takes` on
`city.works`, `city.environment`, `city.inspector`, `city.rates_officer`); the generator's `directionForm` and the
record `proc-directions`. Design: docs/design/call-language-gaps.md, B.4. Decision: docs/decisions.md, "Offices that
take written directions" (2026-10-09).

## What it is for

An office works to written procedures, and to directions from whoever it answers to. In the pilots a mayor who wanted
the works office to stop advertising posts had no way to say so that the office would act on: it wrote letters, the
office (run by code) answered each with its standing report and went on advertising, and the mayor withdrew each
advertisement as it reappeared for 140 days (45 requests; docs/design/call-language-gaps.md, A.3).

There is no act for "the office does this from now on by itself". The institution does the work:

1. **An office that can be directed publishes a form for each direction it takes.** What it takes is the module's to
   say (`takes` in its manifest: the form's name, its fields, and what following one means, in words), beside the code
   that follows it. The generator publishes one form for each, in the office's organisation's name, marked with the
   office it is the form of (`data.office`).
2. **Whoever may direct the office files the direction on the form** (`form(form=works_staffing, to=works,
   recruit=no)`). It becomes a statement of kind `direction`, in the name of whoever filed it, addressed to the
   office's organisation, citing the form. Nothing else happens when it is filed.
3. **The office reads the direction that stands and follows it at its next plan**: the latest one on that form, not
   withdrawn, made in a post that may direct it. It writes to whoever filed it, once, to say what it will do while it
   stands. A later direction on the same form replaces an earlier one; withdrawn, it lapses and the office goes back
   to its own practice.
4. **A direction from anyone else is not followed.** The office writes back, once: "your direction rec.N is not being
   followed. This office takes directions on its forms only from those proc-directions names." The letter says
   nothing of the office's own affairs: only the id of the writer's own paper and the rule, which is public.
5. **Where a model holds the office**, the form still stands and the direction arrives among the office's papers. The
   model decides what to do with it, as a person would.

Following is conduct, not physics: `direction_compliance_bps` (default 10,000) is how often an office follows a
direction it is given, as `compliance_bps` is for the finance office's procedure. An office that does not follow one
says nothing; whoever directed it finds out by looking at what the office does.

## Who may direct whom: the town's own rule

It is a record, not a kernel rule and not a module's parameter. The generated town's charter gives it a mayor and a
council and no chief executive, and said nothing of who runs its offices. The gap is filled as law data:

> `proc-directions` (a `procedure`, under the charter): "The town's offices take written directions on how they do
> their work from the mayor, as head of the town's administration, and from the council by resolution, filed by the
> council clerk. A direction is given on the office's own form for it and stands until it is replaced or withdrawn. An
> office follows no other direction on those matters, and a direction changes no law, no budget and nobody's
> employment."
> `data: { directions: { by: ["mayor", "council-clerk"] } }` (one office may have its own list:
> `directions.offices.<office>`).

Each office is told which record the rule is (`directed_under`) and reads it as it stands: amended, the new posts;
withdrawn with nothing in its place, nobody may direct it. A direction counts by the post it was made in
(`in_position`), whoever holds the post.

**Real-world basis.** Who directs a council's staff differs by place, which is why it is data:

- Where the mayor is the executive, the mayor directs the administration: a German municipality's directly elected
  chief officer leads its administration (for Lower Saxony, NKomVG § 85, **to confirm**); a Japanese mayor directs
  and supervises the municipality's staff (Local Autonomy Act, arts 147 to 154, **to confirm**); a mayor under Ohio's
  statutory city plan supervises its departments (Ohio Revised Code 733.03, **to confirm**).
- Where the council appoints a chief executive, staff answer to that officer and councillors may not direct them: in
  Victoria the chief executive officer is responsible for the council's operations and its staff, and a councillor
  must not direct a member of council staff (Local Government Act 2020 (Vic), ss 46 and 124, **to confirm**); in
  England the head of paid service (Local Government and Housing Act 1989, s 4, **to confirm**).
- A council acts by resolution, minuted and carried out by its officers (ordinary council procedure, as
  docs/behaviour/government.md has it for laws).

The generated town has no chief executive, so the mayor stands as head of its administration in every profile. That
is a simplification for two of the nine places and is an open question for the owner (below).

## The directions that exist

| Office | Form | Fields | While it stands |
|---|---|---|---|
| `works` | `works_staffing` | `recruit` (yes, no; required), `posts` (a count) | recruit no: advertises no post, takes down its advertisements, offers nobody employment. recruit yes: recruits up to what the budget's staff line pays for, or up to `posts` where that is fewer. Stands nobody down; pay is unchanged |
| `works` | `works_collection` | `every` (a length of time; required) | the crew collects from each address on the round once in that time, as its hours allow, homes complained about first |
| `environment` | `environment_staffing` | as `works_staffing` | the same, for its scientists |
| `inspector` | `inspector_enforcement` | `fines` (yes, no; required), `fine` (an amount) | fines no: still goes to the sites it is told of and still tells the valuer, but lays no fine and makes no demolition order: the breach is in its report. fines yes: fines and orders, at `fine` if given |
| `rates` | `rates_recovery` | `interest` (yes, no; required) | interest no: adds no penalty interest to overdue rates and writes to nobody about them. The rates are still levied and owed; interest missed is not made up when it is lifted |

Each is the office's main discretionary practice, and each was a small step. The works office's staffing is the one
the evidence asked for (all 45 requests). The others have not been asked for by a seat: they are there so that a
direction is not a special thing one office does.

**Offices with no direction, and why.** The planning officer decides applications under the planning laws: a
direction to grant or refuse would be a direction to break them, and what it follows is amended as law. The finance
officer already follows a procedure (`proc-payments`) and a hold (docs/behaviour/bank-payment-system.md). The
registrar, the electoral commissioner, the council clerk and child protection carry out duties that are not theirs or
the mayor's to vary. The clinic, the school, the police, the tribunal, the utilities and the firms are not the
town's: nobody in the world has authority over them (their boards and owners are outside it).

## What a seat is shown

In the world's terms only: the forms are among the published forms ("Forms on file"), each saying whose it is and
what following it means; the rule is among the town's procedures; a direction's draft says "You will give the Works
manager (works) a written direction on its works staffing form ... This by itself changes nothing: the office follows
a direction only from those its organisation's rules say may direct it, and writes back to say whether it does."

## Leaves out

- **The council's resolution is not checked.** The clerk may file a direction; nothing ties it to a ballot that
  passed. The code clerk files none.
- **A direction with a date** ("until the audit is done"): nobody watches a condition. Whoever gave it lifts it.
- **Standing someone down, or changing pay, by direction.** Those are acts on agreements, which exist.
- **A direction to an office of another organisation.**
- **What an office does when two who may direct it disagree:** the later direction stands.

## Open, for the owner

- Should a town have a chief executive's office, so that in the two profiles whose law forbids a mayor to direct
  staff the direction comes from that officer? It is one record to change (`directions.by`); the office itself would
  be a new seat.

## What a direction reaches, and what it does not end (2026-10-11)

- **A direction to an office binds its staff's post too.** Where a model holds an office, its staff are a post of
  their own (`works-staff`), and they read the office's directions as the office does. Until 2026-10-11 the staff
  looked for forms and for the town's rule under their own post's name, found none, and followed no direction: a
  recovery direction to the rates office (interest: no) and a collection direction to the works office changed nothing
  their staff did. No direction to a seated office's staff took effect in any pilot before that date.
- **A direction on how often binds the round whatever the standing order's rhythm.** A `works_collection` direction
  that stands sets how often each address is collected from, for the staff under their order as for a code office.
- **A direction not to recruit ends no offer already made.** The office advertises no post, takes down its
  advertisements and makes no new offer; an offer of employment it had made before the direction, which the worker
  then signs, is in force. Its acknowledgement says so and names any such offer ("One offer it had already made is
  not yet signed by the worker (rec.4227, to c0863): a direction ends no offer already made, and it stands if the
  worker signs it."). In the first living pilot (`runs/lv-01`) the mayor's direction (rec.4554, day 24) was filed on
  the form, read, acknowledged and followed; the worker signed on day 26 an offer made on day 22, and the
  acknowledgement's "takes nobody on" made that read as the office defying the direction. *Left out:* withdrawing an
  offer not yet signed (nothing in the world can take an offered agreement back today; it would need the kernel to
  refuse a signature on a withdrawn offer).
