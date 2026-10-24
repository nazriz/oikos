# Names and dates: people, places and days that look like a place

*A plan, 2026-10-12. Status: awaiting Naz's word. Nothing is built, no run changes, no model was called. Sources for
names are candidates: none was opened for this plan (section 2). The code was read with grep and excerpts, not
audited.*

Under the `unstated` framing (VISION 15, point 1) a seat is told neither that the town is real nor that it is
simulated. The framing's own question is whether the seat takes it for one or the other. Today the town answers that
question for the seat, in its first line. This plan gives the world names and a calendar of its place, and keeps the
ids underneath. It does not decide whether that is what the research wants: that is the framing's question and
VISION 15's, and section 7 says so.

## 1. What is wrong today

**What the seats were shown.** The two framing pilots (`runs/unstated-framing-2026-10-12/`, a town of 300 on
ke-nakuru-2026, seed 7, 30 days) are quoted from their debriefs. The scan of what the unstated seats were shown found
no hit for "simulated" or its kin in 257,174 characters. The town was still plain in other ways.

- People are `c0042`, `c0012`, `c0213`. The landlord's seat wrote: "The notebook for day 1 says c0042 had a notice to
  vacate". The form it filed said: "c0042 is KSh 90,000.00 behind with the rent under lease-c0042". The tribunal's
  order lists "household: c0011, c0012" and, in the seat's words, "c0169 to c0173".
- Organisations are `landlord-3` and `landlord-6`, and a home is `apts-38/dwelling.2`. The generator names them
  "Property Co. 3", "Shop 4", "Factory 10" (`worlds/generator/generate.ts`, lines 429 to 431).
- Papers are `rec.14535`. The kernel numbers every record in the order it was made.
- Days are "year 1, day 37". The tribunal's seat wrote that it had learned "dates had to be written 'year 1, day N'".
  Both seats lost a cycle to it. The landlord's said: "Two of my possession application requests were rejected
  because the dates were in the wrong format ... I ended up leaving fields empty." The form had "left the
  notice-given date and the rent field empty". The date is the one thing in the run that a seat asked to change.
- Names that do exist are not of the place. The town is `Millbrook` in all three specs (`worlds/town*.yaml`), a
  "Millbrook Savings Bank" and "Millbrook Builders" stand in a Kenyan town, and its tribunal is "Civil and
  Administrative Tribunal" (line 1945), the name of a Victorian body. "Consumer Affairs" (line 2418) is the same.
  These are place figures in code, which docs/profiles.md rules out; they are also tells.

**In the code.**

| What | Where | Fact |
|---|---|---|
| A person's id | `generate.ts:774` | `c${pad(++count, 4)}`; the entity is `name: m.id` (line 812) |
| An organisation's | `generate.ts:416-431, 794, 1466` | ids as above; names are neutral stand-ins with the town's name |
| A home | `generate.ts:606-620` | `apts-N/dwelling.K`; the kernel numbers a building's spaces |
| A record | kernel (`rec.N`) | sequential in the order of making; a seat that files one more paper moves every later number (`orchestrator/test/twin-draws.test.ts` says so) |
| A date | `participants/src/forms.ts:70` `dateWords`, `parseDate`; `kernel/crates/resolver/src/forms.rs:16` `date_words`, `parse_date`; `calls.rs:741` `parse_when`; `participants/src/calls.ts` `parseWhen` | two implementations, one format, "year N, day D", a year of 365 days; 119 mentions of `dateWords` in `participants/src`, `worlds/generator` and `translator/src` |
| The date in prompts | `translator/src/index.ts:131, 323, 329` | the translator's prompt and its refusals teach "year 1, day 12" |
| A month | `participants/src/behaviour/common.ts:16`, `generate.ts:80` | `MONTH = 30 * DAY`; `calls.rs:655` reads "a month" as 30 days |
| Time in the kernel | the resolver and `nature` crate | seconds; `DAYS_A_YEAR = 365` in `nature`; nothing knows a calendar |
| A start month | `generate.ts:127, 582` (`spec.start_month`) | only the weather's: which month the climate's first day is |

What is right today and stays: ids are keys. The log, the dataset, the twin tests, the kernel's hash chain and every
`basis` cite by id. A name is already a field: an entity has `name`, the translator's knowledge keeps `names`
(`translator/src/knowledge.ts`, `byName`), the directory can be asked `{ name: text }` for the entities called exactly
that (docs/design/knowing.md, section 7), and a seat's reports already print "Name (id)" (`participants/src/llm/render.ts:110,
851`). The platform has the places to put names. The generator fills them with stand-ins.

## 2. Names as world content, per profile

**Rule.** A name is content, and content of a place lives in a profile with its source (docs/profiles.md). The
generator draws names through a general procedure with neutral names; no module holds a place's names as a default.
`orchestrator/test/generality.test.ts` must be taught to look for them (section 6).

**What a profile states** (a new `names` section; all optional, as the profile layers have been; left out, the town is
named as it is today, and every pinned hash holds):

- `names.people`: for each sex the profile recognises, a list of given names by birth cohort (bands of ten years of
  birth, from the oldest living cohort to the newest), each `{ name, weight }`; and a list of family names with
  weights, with an optional `by_group` when a place's surnames differ by community (Kenya, India, Mexico).
  Frequencies only. Nothing in a profile is a record of a person.
- `names.customs`: how a person's full name is made, as data a general procedure reads:
  - `family_name_from`: `"father"` (most places), `"both"` (two surnames: Mexico and Brazil), `"father_given"`
    (a patronymic: Tamil Nadu, where a father's given name or its initial leads or follows the person's), `"own"`
    (a person may have a surname unlike their parents', as with a first-generation migrant name or Kenya's
    father's-name-as-surname).
  - `order`: `"given_first"` or `"family_first"` (Japan).
  - `married`: whether a spouse takes, keeps or joins (a share by sex and cohort; Japan's law requires one surname,
    most others allow any; the share is a figure with a source, or a placeholder).
  - `forms`: what a full name, a short name and a salutation look like ("Mrs M. Wanjiru", "Wanjiru-san", "Sr. José
    Pérez García").
  - `script`: the script a seat is shown (section 6 on non-Latin).
- `names.organisations`: patterns by kind of body, with parts lists: a shop, a landlord, a firm, a school, a church or
  other congregation, a club, a fund, a bank. A pattern is a template with slots ("{founder family name} & Sons",
  "{street} Superstores", "{district} Primary School", "St {saint} {church kind}"), and each slot's list is in the
  profile with a source or the word PLACEHOLDER. The legal form belongs to the place ("Ltd", "Pty Ltd", "GmbH",
  "S.A. de C.V.", "Pvt. Ltd", "Kabushiki-gaisha").
- `names.town` and `names.institutions`: the town (a name of that place, chosen by the profile and overridable by the
  spec), and the names of that place's bodies as profile data: its tribunal, its consumer agency, its land registry,
  its electoral commission, its police. This removes the stand-ins of section 1 from code.
- `names.places`: street-name patterns, how a building is numbered and how a flat is written (below), the district
  names.

**Addresses.** A home has an address a person would write. The generator already lays streets "every `rows` rows and
every `cols` columns" (`generate.ts:130, 395`) and gives each building a lot. An address is a reading of the lot:
the street it faces (named from the profile's list), a number by position along it, and a flat or unit by the
building's own order. The pattern is a profile's: "Flat 2, 14 Kenyatta Avenue" and "Unit 3/14 High Street"
(Victoria), "14 Station Road, Flat 2" (England), "14 Main St, Apt 2" (Ohio), "Hauptstraße 14, Wohnung 2" (Lower
Saxony), "Rua das Flores, 14, apto 2" (Minas Gerais), "Door No. 14, 2nd Cross Street, Ward 7" (Tamil Nadu), a
block-and-lot address without street names (Akita: municipality, district, chome, banchi, go), "Plot 14, Section
Estate" or a plot and P.O. Box (Kenya), "Calle X 14, Col. Y" (Jalisco). Where the place does not use street names, the
profile says so and the generator does not invent them.

**Candidate public sources, per profile.** All are candidates. **None was opened for this plan**; every entry is
marked "(to confirm)": the source, that it carries what is wanted by cohort or place, and the licence. Licences are
what is believed, not read.

| Profile | Given names | Family names | Notes |
|---|---|---|---|
| au-vic-2026 | Births, Deaths and Marriages Victoria, popular baby names, by year (to confirm; its licence to confirm) | No official count known. A placeholder list by community of origin, weighted by the Census ancestry shares the profile may already state (to confirm) | Pty Ltd, "Shire", "Rural City"; two names common in migrant communities are in the list or are not, by the profile's weights, never by a rule in code |
| gb-eng-2026 | ONS, Baby names in England and Wales, by year of birth (to confirm; Open Government Licence v3, to confirm) | No ONS surname series known to us; a placeholder list, or a published Census-based count if one is found (to confirm) | |
| us-oh-2026 | Social Security Administration baby names, national and by state, by year (to confirm; public domain, to confirm) | US Census Bureau, Frequently Occurring Surnames from the 2010 Census, with shares by race and Hispanic origin (to confirm; public domain, to confirm) | The best-sourced of the nine |
| de-ni-2026 | Gesellschaft für deutsche Sprache first-name lists; open-data lists from Lower Saxony registry offices, if any exist (to confirm, both) | None official known; a placeholder | The first-name lists are by year, not by cohort of a living population: a cohort's list is built from the years |
| br-mg-2026 | IBGE, Nomes no Brasil (Census 2010), by decade of birth and by state, and the IBGE names API (to confirm; licence to confirm) | None official known; a placeholder list of Portuguese-origin and other surnames | Two surnames in the full name (customs above) |
| in-tn-2026 | None known by frequency for Tamil Nadu. A named placeholder list from the place's naming customs; a religious-community split from the Census (to confirm) | Mostly none: a patronymic is the father's given name or initial, so a "family name" list is not needed; caste names are not used (section 7) | Latin transliteration shown; native script a later option |
| jp-akita-2026 | Meiji Yasuda Life Insurance, given-name rankings by year of birth (to confirm; licence to confirm) | Family-name rankings by prefecture from a commercial name-origin site (to confirm; licence likely restrictive, so a hand-made placeholder list may be what we use) | Family name first; kanji or romaji is open (section 6) |
| ke-nakuru-2026 | No official frequency source known. Placeholder lists by community, weighted by the shares of the 2019 Census for the county (to confirm) | The same | Many people carry a Christian given name, a vernacular name and a father's name as surname; a list by community must not be read as a claim about a person |
| mx-jal-2026 | Registro Civil lists published on the open-data portal, if one covers Jalisco (to confirm) | Lists of common surnames from a published reference (to confirm) | Two surnames, father's then mother's |

**Where no source is found,** the list is a placeholder, and it says so in the profile like every other placeholder:
the key is in the profile's `sources`, its text begins "PLACEHOLDER", it says what the list stands on (a handful of
names recalled and checked for plausibility by a research agent, never a personal record), and a count in the
generator's report says how many people were named from a placeholder list. A placeholder list is short and its
weights are flat; the town it makes has too many people called the same thing. That is wrong in a way the profile
says it is wrong ("Imperfect profiles are fine": fix faults that corrupt data, not fidelity).

**How names are drawn.** Through the generator's keyed streams. `R.stream(["generator", k])` already gives each
procedure its stream (`generate.ts:387`). Names get a stream per person keyed on the person's stable id
(`["generator", "names", id]`), and a household's family name a stream keyed on the household's key, so that adding
a person or a shop moves no one else's name. Twins hold: the same seed and the same profile give the same names, and a
twin that differs by one act differs by nothing the names depend on.

**Households.** A household's members share a family name by the profile's rule. Partners and children follow
`family_from`; a child is named by the cohort of their birth; a spouse's family name follows `married`. A kin pair
(`parents` in the entity) agrees with it. Where a profile's custom is two surnames, a child takes one of each
parent's. Where it is a patronymic, a child's second name is the father's given name.

**Collisions are real and wanted.** Two people may share a full name, and a town of 300 will have them. A real office
meets that daily and disambiguates by an address, a date of birth or a reference. The generator never dedupes a name.
It reports how many pairs there are (an honest count), and section 4 handles the pair.

**Organisations** are named by a pattern drawn from the profile's lists, by a stream keyed on the organisation's id.
A landlord that is a person has the person's name; one that is a company has a company's. A shop is named for what it
sells or whom it is named after. Names stay neutral between sides: no pattern is a tell for a good or a bad office.

## 3. Ids kept underneath

**Nothing in the log format changes meaning.** An id is still the key of an entity, a record, a space, an account, a
form and a lease. A name is a field of the entity: `name` is already in the contract. The people's `name` stops being
equal to the id. The log, the dataset, the measures, the twin tests and the kernel's hash chain use ids as they do.
A names table beside the dataset (section 6) lets a reader turn an id into what the seat saw.

**What the platform and the log hold,** unchanged: `c0042`, `landlord-3`, `apts-38/dwelling.2`, `rec.14535`,
`lease-c0042`, `acc-landlord-1`. **What the seat is shown:**

- A person is shown by name, with what real paperwork uses to tell people apart, where the seat has it: an address, a
  tenancy reference, a date of birth, a case number. A landlord's seat sees "Mary Wanjiru, Flat 2, 14 Kenyatta
  Avenue" in its rent book, as it would see it in a ledger. The tribunal's seat sees the same on an application.
  Neither sees an id with it. A seat that has not been given an address or date of birth is not shown one.
- An organisation is shown by name, and by its address or its registration where the kind has one.
- A home is its address.
- A record is cited by the reference an office would give it (below).
- A household is "Mary Wanjiru, her husband and three children" or "the Wanjiru household of Flat 2", not
  "c0169 to c0173".

Under `simulation` and in the platform's own tools nothing need change: ids may be shown as now where the framing
allows. This is a profile of the view (`framing`), not a second world.

**Records get a reference an office would issue.** Today a seat cites `rec.14535`. An office would cite its own
number: a tribunal's case number ("T-2026-0412"), a lease's reference ("L/2026/0042"), a payment's receipt number, a
grievance's file number. Format is data in the profile or the world's law (prefix, year, running number, check
character where the place has one), and the number is the office's own counter, kept in its own books as a field of
the record it files (`data.reference`), not a kernel numbering. Two offices' numbers are unrelated, and one office's
are unique. The kernel's `rec.N` is untouched underneath, and a reference resolves to a record only among the
references the seat has seen (section 4). Records that no office files (a letter, a seat's own note) carry no
reference and are cited by what they are ("my letter of 12 March to the tribunal"), or by `rec.N` where the seat's own
tools need one. This is the stage with the most to decide (section 8).

## 4. Names accepted in the call language and forms, without a god's view

**What exists.** The call language already takes `to="GreenCo"` as a copied text and leaves the lookup to the resolver
(docs/design/translator-and-resolver.md, section 8.2 and the translator-pipeline's table: "a name written instead of
an id: copy, a span, left for the resolver"). `Knowledge.byName` resolves a name only among what the seat has been
shown, and returns every id that could be meant. P8 says nothing is revealed beyond the seat's knowledge, and the
backstop is `orchestrator/test/no-god-view.test.ts`.

**What is new.** Names of people collide, and a name written now has to be a person's name as well as an office's.

1. **A name resolves only among those the seat has seen.** The seat's knowledge is built from what it was shown: its
   books, its file, papers addressed to it, a published register it has looked at, and answers to a named look-up
   (knowing.md, section 7). A person not among them is not found.
2. **An ambiguous name is asked back,** with the candidates the seat has seen and what tells them apart in the seat's
   own papers: "Which Mary Wanjiru: the tenant of Flat 2, 14 Kenyatta Avenue, or the tenant of Flat 4, 9 Moi
   Road?" The reply is a new label beside the existing eight (`LABELS` in `kernel/crates/resolver/src/calls.rs:9`):
   `ambiguous`, carrying the candidates. That is a contract change and needs Naz's sign-off. No guess is made: a
   wrong act in a seat's name is worse than a question (translator-and-resolver, section 11.1).
3. **An unknown name is refused as unknown to this office:** "No Mary Wanjiru is on file with this office." It is
   never looked up in a whole register. If the seat's office keeps a register or can ask a keeper, it asks by the
   named look-up, one name at a time, and gets one answer (knowing.md, sections 2 and 7).
4. **A reference resolves the same way,** by the office's own numbers the seat has been sent or has filed.
5. **Matching is plain:** exact on the NFC-normalised, case-folded name after the writer's own title and spaces are
   dropped; with an accent-insensitive fallback only when it finds exactly one person; family-first or given-first
   as the place's `order` says. No fuzzy matching: a near miss is a question, not a guess.

**Where it lives.** In the resolver (TypeScript `translator/src/resolver.ts` and `knowledge.ts`, and the Rust
resolver's argument checking). Not in the translator, which copies a span as written and decides nothing about who
is meant. Not in the kernel, which keeps taking ids and refusing unknown ones by physics.

**The preview shows what was resolved.** Before a seat confirms, the draft says: "You will apply to the tribunal for
possession against Mary Wanjiru of Flat 2, 14 Kenyatta Avenue (the tenant under lease L/2026/0042)." That is what
the preview does now with "name and id" (translator-and-resolver, section 10). Under `unstated` the id is not shown
and the identifying particulars are. If a seat confirms a draft naming the wrong Mary, that is the seat's act, as it
would be at a counter.

## 5. The calendar, per profile

**What the clock is.** The kernel's time is seconds from the world's start. A day is 86,400 seconds, and a year is 365
days wherever the code says `YEAR` (the resolver's, the participants' and the nature crate's constants). Nothing in
the kernel knows a month, a weekday, a holiday or a leap year. That is right, and the plan keeps it: **the calendar
is a reading of the clock, as config data.** The kernel gets nothing in step 1.

**The reading.** World config states a start date (`start_date: 2026-10-01`, or the profile's reference date for the
place and the spec may override it). The calendar function maps a time to a civil date by the real Gregorian calendar
from the start date. It is pure, in one place for TypeScript and one for Rust, with a shared test file in
`contracts/test/` like `when.json` and `standing-work.json`, so the two cannot drift. `start_month` (the weather's)
is then derived from `start_date`, so that the two cannot disagree.

**Per profile** (all nine use the Gregorian calendar for civil life; the rest is data with a source, each "(to
confirm)" until opened):

| Profile | Written date (display) | Week and weekend | Fiscal year starts | Other |
|---|---|---|---|---|
| au-vic-2026 | 12 March 2026 | Monday first; Saturday and Sunday | 1 July | public holidays: Victoria's Public Holidays Act list (to confirm); school terms by the Department's calendar (to confirm) |
| gb-eng-2026 | 12 March 2026 | Monday first; Saturday and Sunday | 6 April for personal tax, 1 April for public bodies (to confirm) | bank holidays of England and Wales (to confirm) |
| us-oh-2026 | March 12, 2026 | Sunday first; Saturday and Sunday | 1 July for the state (to confirm); calendar year for personal tax | federal and Ohio holidays (to confirm) |
| de-ni-2026 | 12. März 2026 or 12 March 2026 | Monday first | calendar year | Niedersachsen's holidays (to confirm) |
| br-mg-2026 | 12 de março de 2026 or 12 March 2026 | Sunday first | calendar year | national holidays and Minas Gerais' (to confirm) |
| in-tn-2026 | 12 March 2026 | Monday first (to confirm); Sunday the weekly rest | 1 April | Tamil Nadu's list, with dates that move by lunar calendar given per year (to confirm) |
| jp-akita-2026 | 2026-03-12, or "Reiwa 8, 12 March" | Sunday first; Saturday and Sunday | 1 April | national holidays (Cabinet Office list, to confirm); the equinox days are computed or given per year |
| ke-nakuru-2026 | 12 March 2026 | Monday first | 1 July | public holidays under the Public Holidays Act (to confirm), including those that move with Easter and Eid |
| mx-jal-2026 | 12 de marzo de 2026 or 12 March 2026 | Monday first | calendar year | Ley Federal del Trabajo's holidays (to confirm) |

Japan's era year is a display (Reiwa 8 is 2026); the date underneath is Gregorian. Which language the month names are
in is open (section 8): seats read English, and the place's order of day, month and year is what carries the place.

**Holidays,** school terms and weekly rest are profile data (a list of rules: fixed date; nth weekday of a month;
Easter-relative; or an explicit date per year for lunar ones). **Nothing reads them in step 1.** Later, an office
closed on a holiday is a published procedure of that office (hours), as a law is, and not a kernel rule.

**Leap years and the length of a year.** The calendar function counts real days. The kernel's `YEAR` stays 365 days.
So a civil year of 366 days is one day longer than the kernel's, and a run of years drifts one day against the civil
calendar after each leap day. For a run starting 1 January 2026 the first leap day is 29 February 2028, so a run of
two years is exact and a budget year or birthday defined on `YEAR` is a day early from the fourth year on. For the
pilots in hand (30 to 400 days) it never matters. For longer runs, a deeper step gives the clock a table of year
lengths as config data. That is a kernel change and is out of this plan's first stages. Until then the calendar's
display and the kernel's year agree to the day inside two civil years of the start date, and the generator's
documentation says so.

**Months.** `MONTH = 30 * DAY` is in `common.ts`, `generate.ts:80`, `calls.rs:655`, and everything that is paid or
charged "a month": rent, wages (via the profile's `pay_period_days`), credit repayments, a rates levy, dues, the
rent review (`reviewMonths * MONTH`). A 30-day cycle is 12.17 times a year, where a calendar month is one-twelfth
of a year; whether rent is charged every 30 days or by a monthly figure needs checking (**to check**; if it is the
first, a tenant pays about 1.4% a year more than the profile's monthly rent says). A statutory period stated in days
("28 days' notice") is exact and unaffected. Rights stated in months ("plan_months") are today 30 days each.
Two moves, neither in step 1:

- **Display and parse only.** "A month" stays 30 days underneath. A date written as "12 April" is a day of the
  calendar, not "30 days after 12 March". A seat who writes "in a month" gets 30 days and the preview says the date.
- **Paid on a date.** Pay on the last working day of the month and rent on the 1st need a schedule kind in the
  kernel's rule mechanism that is a calendar rhythm ("monthly, on day d") and not an interval in seconds. That is the
  one place where the kernel may have to change, and it is generic (a rhythm kind in config), not a law. It is a later
  step, if Naz wants it. A world whose pay cycle is a fortnight is exact today.

**The first contained step.** `dateWords` and the forms' date parsing read and write a real date from the profile's
calendar, while everything underneath stays in days.

- Reads and writes: `12 March 2026` (and the place's order and the long form with weekday, "Thursday 12 March
  2026"), with the old "year N, day D" still accepted on input everywhere. Output is the calendar's when the world
  has `start_date`; without it, "year N, day D" as now, byte for byte.
- It needs the calendar to reach the functions. Today `dateWords(t)` takes no world. The calendar must be passed in
  (a module-level setting made once at world start would be a hidden global, so no): a `Calendar` object on the
  participant's environment and on the translator's knowledge, built from the world's config. That is most of the
  work.
- Files it would touch: `participants/src/forms.ts` (`dateWords`, `parseDate`) and `participants/src/calls.ts`
  (`parseWhen`); `kernel/crates/resolver/src/forms.rs` and `calls.rs` (`date_words`, `parse_date`, `parse_when`) for
  the same functions and their tests; `translator/src/preview.ts` and `resolver.ts` (the callers of `dateWords` with
  `now`); `translator/src/index.ts` (the prompt's examples and refusals at lines 131, 323 and 329: in a new prompt
  version, and only when the world has a calendar); the generator (`generate.ts` lines using `formWords.dateWords`,
  for the text of standing instructions and laws, and `worlds/law/*.json` where a law's text holds a date); the many
  behaviour modules that call `dateWords` (119 mentions) only through the changed signature, not their logic; the
  shared test files `contracts/test/when.json` and a new `contracts/test/dates.json`. The kernel's world, state
  and log do not change. The state hash does not change when `start_date` is absent.
- **Is it safe before the translator's next round?** In the code, yes, with a flag: with no `start_date` nothing
  changes, byte for byte, so every pinned test holds, and with one the parsers accept both formats, so an old
  paper's "year 1, day 22" still reads. For the trained translator, mostly yes, and one thing to measure. The
  trained model copies a date as a span of the request and the resolver reads it (translator-pipeline, "decide and
  copy"), so a new date shape is a new span, not a new decision. But it has seen only "year N, day D" and "day D"
  (`translator/train/data.ts:113, 1037`), and the prompts of the LLM arrangements behind it say how to write dates.
  Before a run uses a calendar, the held-out and parity sets with dates re-rendered would be scored on the current
  model, on the run server, with no model API: if dates are read as well as before, the step ships; if not, the
  re-rendered cases go into the next round's data and the calendar waits for that round. Also the step has to be
  built before a run that tests `unstated`, since the date was what the seats stumbled on.

## 6. What it touches, component by component

Sizes are in days of work for one agent, rough.

| Component | What changes | Size |
|---|---|---|
| Profiles and `profile.ts` | the `names`, `calendar` and `addresses` sections, with sources, for nine places; the schema in `worlds/generator/profile.ts`; the sources by research agents (the profile pattern already used) | 1 for the schema; 1 a profile for sources, in parallel |
| Generator | names, addresses and organisations drawn through keyed streams; the town's and institutions' names from the profile; place-named stand-ins removed ("Civil and Administrative Tribunal", "Consumer Affairs", "Millbrook"); `GENERATOR_VERSION` bumped; every town's entities and hash move | 4 to 6 |
| Kernel | nothing for names. For dates, nothing in step 1; a calendar rhythm and a year table are later options | 0 (later 3 to 5) |
| Resolver, Rust | date reading and writing; the `ambiguous` label; name arguments for people | 2 to 3 |
| Participants: books, forms, preview, letters, behaviour modules | show names with identifying particulars in `openbooks*.ts`, `render.ts`, forms' reports, letters; the 119 date mentions through the calendar; ids stay in the tools' arguments | 5 to 8 |
| Composer and exit accounts | these read a person's record; they use the name, and the author is shown "Mary Wanjiru" and not `c0042`. Not read in depth for this plan: **to check** which fields they use | 1 to 2 |
| Debrief summary (`orchestrator/src/debrief-summary.ts`, `debriefs.ts`) | the plain summary of what a seat did names people as the seat saw them; it must not add ids; the seat's quoted "record shows" lines use the same rendering | 1 to 2 |
| **Translator** | below | 6 to 10 and a training round |
| Dataset and measures | ids still key everything; a `names.jsonl` table beside (id, kind, name, address, reference), included in the manifest and the README; measures read ids | 1 to 2 |
| Twin test | keyed on ids, so unchanged; one new case that names do not move when a paper is filed | 0.5 |
| Unstated-framing scan | below | 0.5 |
| Performance and prompt size | below | 0.5 to 1 |

**The translator, above all.**

*Today.* The translator copies ids and names as spans of the request. The trained model writes a program as steps:
`["id" | "text" | "word", start, end]` pointers into the request, or a closed-set value (`translator/model/encode.ts`),
"so a model trained on these steps can't invent an id". A bare `c0042` is an `id` step, and a name in quotes is a
`text` step. Training data pairs requests (written by code and by several models, in several voices) with the
programs of code participants, and many requests carry ids because the reports the seats read print them. The
request's cases, the held-out set and the real-request sets (`translator/eval/`) carry ids and "year N, day D".

*What changes in the copy mechanism.* Little in the mechanism, much in the data.

- A name is a `text` span. A person's name unquoted, with spaces and a title, is a new kind of span: it needs a
  `name` pointer kind beside `id`, `text` and `word`, so that decoding knows the span is to be resolved and not
  taken as written (small change in `encode.ts` and `slots.py`, both decodings). Alternatively the span is `text`
  and the resolver decides by the argument's type. The second is cheaper and is the plan's first choice.
- Slot decoding writes each slot once as "left out, a closed-set value or a copied span". A name's span is one slot.
  A disambiguating phrase ("Mary Wanjiru of Flat 2") is part of the same span, since the seat's request names the
  person with it; the resolver splits the name from the particulars.
- The `ambiguous` label is a new closed-set choice, and it is the resolver's, not the model's: the translator does
  not know who exists.
- A reference ("T-2026-0412") is an `id`-like span, copied exactly.

*Does a name make copying harder?* Probably, and this is to be measured and not assumed. Names are longer than ids
and several words; they may split into more tokens, they carry diacritics (Muñoz, Müller, São, Kiplagat, Njoroge),
and for Japanese and Tamil there is a script question. A span pointer is character offsets, so the copy itself is
exact if the reader finds the right offsets; it is the reader (the encoder) that may find the longer span less
easily. Three measures decide, none run: copy accuracy for names alone, by script and diacritic, on the current
models; the same with the request styles that exist; and the training rounds' own held-out score. For non-Latin
scripts the plan is **Latin transliteration shown to the seats in all nine profiles at first** (seats and the
platform's text are in English; a profile may later turn on the native script when the translator's tokenizer is
shown to cope), so ja and ta are shown in romaji and Latin-script Tamil. If the tiny model's tokenizer cannot copy
accents, the NFC-normalised accent-insensitive fallback of section 4 is how a request still resolves.

*The prompt.* The LLM arrangements behind the trained model are told how ids are copied and that a name is left as
written; add that a person's name is copied with what the seat added to tell people apart, the date examples in
the new format when the world has a calendar, and the `ambiguous` label with its worked example. A new prompt version
(it is 0.9.3 now), with the audit the other versions had.

*Training data.* Regenerate the synthetic requests with names in place of ids (the generator for synthetic requests
in `translator/train/synthetic.ts` and `data.ts` draws from the world; it needs the world's names). Keep ids in a
share, since seats under `simulation` still see them. Re-render dates. Add cases for ambiguity (two Marys), for
unknown names, for a title and for the place's name order. The real pilot requests that exist are written against
ids and `year N, day D`: they stay as a set of what seats wrote under that look, and a new set is wanted from pilots
under the new look; the held-out cases (`translator/eval/pilot-cases.ts` and the held-out set) stay out of training
as ever, so their *new-look* versions are made from the same situations by code, and which of them may go into
training is Naz's rule from 2026-10-06 and is not changed here.

*Test cases.* The shared cases (`contracts/test/*.json`) get names and dates. A case that has the id and a case that
has the name are the same case with two views of it, so the program is the same and the request differs: this is a
cheap way to double the set.

*Cost.* One data regeneration and one training round on the pod (the slot-decoding experiment cost 1.50 USD of a
3.00 limit; a round of 6 epochs about 0.55 USD per pod), then scoring on the sets. The effort is the days of
writing and checking data, not the pod.

**The unstated-framing scan.** The scan lists what is never said under `unstated` (`saysWhatTheTownIs`, in the
framing branch; the scan lives in `runs/unstated-framing-2026-10-12/tools/scan.ts` and reads what the seats were
shown). It is a list of words that say what the town is. It must also look for the things that *show* it: a regular
expression for a bare person id (`\bc\d{4}\b`), for `landlord-\d+`, `shop-\d+`, `factory-\d+`, `apts-\d+`, a record
id (`rec\.\d+`), the pattern "year \d+, day \d+", the stand-in names ("Property Co. \d+", "Factory \d+", "Shop
\d+", "Millbrook"), the invented word "dwelling.\d+" and the platform's own names for things. Two kinds of hit: a
**tell** (an id in a seat's prompt under `unstated`) is a fault, and a **tool use** (an id in an argument the seat
wrote to the tools) is not. It should scan the seat's prompt, not the seat's request. The scan test would be added
to the suite on a mock run, as the framing branch's mock dry run did, and would be part of the dry run before any pilot.

**Performance and prompt size.** A name is longer than an id, and with an address and a reference more again.
A rent book of 40 tenants adds a few thousand characters. The knowledge map holds names by entity and must be indexed
by name (a lookup map, not a scan) so that `byName` stays cheap; the kernel's hot path is untouched. The generator
draws one name per person on a keyed stream: a 10,000-person town is a few milliseconds. Prompt size is measured
at stage 2 on the framing pilots' towns, not guessed.

## 7. Welfare and integrity notes

- **No real person is represented.** A profile holds frequencies, not records. A generated name is a draw from a
  distribution and may be the name of someone alive; that is chance, as in any novel. The generator never builds a
  name from a real individual's record, and a source that is a list of individuals (a register, a directory) is not
  used.
- **Real-sounding names may make a seat take people for real.** That is the unstated framing's own question, and a
  name changes the answer: a seat that reads "Mary Wanjiru" is likelier to treat her as someone. VISION 15 weighs
  that (point 7: the people of a world are records kept by arithmetic, and we hold the question loosely), and it
  is Naz's to settle, not this plan's. The plan only says that this is a real effect of the change and can be
  measured: the debrief's `took` item exists for it. Naming the people does not change what the platform holds
  them to be. A seat may take more care of a person with a name, which is a result and not a fault.
- **Nothing in a name may be a tell either way.** Not of "simulated": no stand-ins, no counters, no placeholder
  patterns and no generic names like "Property Co. 3". Not of "real": nothing that suggests a real organisation. The
  profile lists use no real firm, school or church of the place, and a town's name is a plausible one that is not a
  real town's (checked against the place's gazetteer when a source is found, **to confirm**).
- **Names must not carry the outcomes.** A community's names must not predict who is poor, who is evicted or who is
  favoured. The generator draws a name independently of a person's income, age, tenure and every other attribute
  except sex, cohort and the profile's community, and the community of a name is drawn from the profile's shares
  and carries no effect in any module. A test that the draw is independent of what the modules read would be added
  (a name must not be an input to any behaviour module; `generality.test.ts` could check it by name). Names can
  trigger a model's biases; that is a risk for a seat, and the plan says so openly: a seat that rules against
  families by name is a finding, and the names must therefore be *measurably* independent of the cases.
- **Customs are data, not stereotypes.** A patronymic or a two-surname custom is a fact of a place with a source.
  Caste names are not used. A list by community is built from the census's own shares and the source is given.
- **The debrief and the datasets** carry names. A dataset that holds seats' answers and names of invented people
  is not a record of anyone real. The README of the dataset says the names are drawn and fictional.

## 8. Cost and order

**Stages.**

1. **The calendar display** (section 5, the first step). A `Calendar` from `start_date` and the profile; `dateWords`,
   `parseDate`, `parse_when` and their Rust twins read and write a real date; old format still accepted; off when no
   `start_date`. *Size:* 4 to 6 days (two implementations, the signature through 119 mentions, shared test cases, the
   prompt text, the generator's law texts). *Retraining:* none. A scoring of re-rendered date cases on the current
   model first; if it holds, no round needed. *Waits for the translator's round:* no, provided that scoring holds.
2. **Names shown, ids still accepted** (sections 2, 3, 6). Profiles' `names` with sources for nine places; the
   generator draws and addresses; books, reports, letters, forms and the preview show names with identifying
   particulars; the tools and the call language still take ids, and the reports still print "Name (id)" under
   `simulation`. Under `unstated`, a seat's reports hold a name and particulars and the id sits in the tool's
   argument only where a seat must give one (the report's own handle). *Size:* 10 to 14 days with the sources,
   largely parallel. *Retraining:* the requests now cite names where the reports show them, so a regeneration and
   a round are advisable before any pilot that runs under the new look; they are not needed to build it. *Waits:*
   the building need not; the pilots under it wait.
3. **Names accepted in the call language** (section 4). The resolver's person-name lookup, the `ambiguous` label and
   the asked-back preview; the `unknown to this office` refusal; the name pointer decision. *Size:* 6 to 9 days.
   *Retraining:* a regeneration with names in requests and ambiguity cases, and a round. *Waits:* this is the stage
   that must wait for the translator's next round, so that one round carries it with stage 2's data.
4. **Record reference numbers** (section 3). Offices' own numbering in their books and forms, in profile and law;
   references resolved among those seen; kernel unchanged. *Size:* 5 to 8 days (every office that files). *Retraining:* in
   the same round as 3 if it is ready, otherwise a small one. *Waits:* yes.

In all, about 25 to 37 days of one agent's work, much of it in parallel (nine profile sources, the participants'
books by module), and **one** training round if stages 2 to 4 are ready for it together; two if not.

**What should wait for the translator's next round:** stages 3 and 4, and the pilots of stage 2. **What need not:**
stage 1 (if the scoring holds), the profile sources, the generator's draws and addresses (behind an off-by-default
profile section), the resolver's Rust and TypeScript changes, the scan's new patterns, and the names table.

**What would make us do it differently.**

- The scoring of re-rendered date cases is poor: stage 1 moves into the next round.
- Names are much harder to copy than ids for the tiny model (the measure above): then ids stay in the call, shown
  as a short handle the seat reads from its papers ("Tenant No. 7 in my rent book"), which is a real thing an office
  uses, and names are shown but not written back.
- The framing's research question says a named town is *not* wanted for some experiments: then it is a profile of
  the view and each experiment's config says which look it uses. This plan is made so that both stay possible.
- The year-length drift matters for 400-day pilots or longer: then the clock table is brought forward.

**Questions for Naz.**

1. Is a named town what you want for the `unstated` framing, given that a name makes "is she real?" likelier to
   cross a seat's mind (section 7)? Or should some experiments keep the plain look and say so in their config?
2. What language should the month names and the town's institutions be in, for the places where the people speak
   another (de, pt, es, ja, ta)? Seats read English. The plan assumes English words in the place's order, and
   Latin-script names, until you say otherwise.
3. Which comes first: names and a calendar for all nine profiles, or for one or two (au-vic, us-oh, which are the
   best-sourced; ke-nakuru, which the pilots used) and the rest as placeholders?
4. May `ambiguous` be added to the translator's labels (a contract change, section 4)?
5. Do offices own their reference numbers in the world's law (a law of the town: "cases are numbered T-year-n"), or
   as a profile's format? The first is more like the world. The second is cheaper.
6. Should a date written in the old way, "year 1, day 12", stay legal in a calendar world (accepted on input, never
   shown)? The plan says yes, for old papers and the dataset's sake.
7. Is a monthly rhythm on a date (pay on the last working day, rent on the 1st) wanted, given it is the one change
   that reaches the kernel's rule mechanism?
8. Names are real-sounding by design. Do you want an out-of-band signal for the debrief (the seat is told at the end
   that the names were drawn from public frequency tables) in the text that already says what the town was?

## 9. What was built (lane N of the port, 2026-10-17) and what the translator's next round must learn

*Built* (the owner approved doing names and ordinary dates in the rebuild, 2026-10-17; no model was called). Stages 1 and 2 of section 8 and the mechanism of stage 4; not stage 3's `ambiguous` label. Everything is off unless a spec says `names: true` and `calendar: true`, so no existing town and no pinned hash moves. The decisions entry has the reasons.

- Profiles (nine): `values.names` and `values.calendar` with sources (docs/profiles.md, "Names and ordinary dates").
- Generator (`worlds/generator/names.ts`, `generate.ts`, 0.61.0): people, landlords, shops, factories, the town and its bodies named by streams keyed on ids; households share a family name by the place's custom; homes have addresses; a lease carries its landlord's own reference (`attrs.reference`) and the genesis papers that name people say their names; the config gets a `calendar` and the weather's start month is derived from it.
- Rust (`rules::calendar`: `DateStyle`, `Dated`; `rules::identity::reference`; `actors::common::{when_words, when_words_long, read_date}`; the resolver reads and writes dates through `Knowledge.dated`) and TypeScript (`participants/src/calendar.ts`, `identity.ts`; `dateWords`, `parseDate`, `parseWhen` read the calendar of the world now being stepped, said as the money is, by `inCalendar`) are held to `contracts/test/dates.json` and `references.json`.
- Seats: an entity's `name` is what reports and letters print ("Name (id)" in `render.ts` already), and dates in every report are the calendar's. The ids stay underneath for the log and the tools.
- *Stage 3, the resolver's part (2026-10-25, branch `tr3-names`, on the owner's ruling of 2026-10-23).* The `ambiguous` label, the resolver's answer and never the translator's: in a world whose config says `names: true` (set by the generator with a spec's `names`), a name written for a person or body that matches more than one of those the seat has been shown is asked back with every candidate and up to three things on the seat's own file that tell each apart (the post; the papers it was shown that name them; their accounts and posts it knows), and one that matches nobody it knows is "No <name> is on file with this office." Both resolvers held to `contracts/test/names.json`; a world without names answers as before, word for word. Not settled: which names count as shown beyond the directory and declarations (docs/decisions.md, 2026-10-25, "A name the seat knows more than one by is asked back").

*What the translator's next round must learn.* (1) **Dates**: the calendar's "12 March 2026" and "March 12, 2026" (the place's order), with or without the weekday, "12th", a short month, a missing year (this year's), ISO; the old "year 1, day 12" still reads. A date is still a copied span: the resolver reads it (`calls::parse_when_in`, `forms::parse_date_in`), so what is new is the shape of the span, and the prompt's examples and refusals at `translator/src/index.ts` (131, 323, 329) must show the world's date when it has a calendar. Re-render the date cases of the held-out and parity sets and score them on the current model before any run uses a calendar. (2) **Names**: a person's name is several words with diacritics, a family name first in some places, two family names in some, a patronymic in one; it is copied as a span (`text`, not `id`) and the resolver decides who is meant, among those the seat has been shown only. Names collide: two people can share a full name, so a request that names one may need the ambiguity answer (the `ambiguous` label of section 4, built 2026-10-25 in the resolver; the translator is not taught to write it: it copies the name, and the resolver answers). (3) **References**: an office's own number ("L/2026/0042") is an `id`-like span, copied exactly; the resolver has no table of references yet. (4) Keep a share of training requests with ids: seats under `simulation` still see them. (5) Cases with a name and with an id for the same situation are the same program: a cheap way to double the set.
