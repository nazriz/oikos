# How anyone comes to know anything (2026-10-08)

**Source:** the contract (`contracts/world-config.schema.json`: a channel's `way`, `knowing`), the kernel's
perception (`kernel/crates/perception`), `participants/src/behaviour/common.ts` (`ask`, `Asked`), and each module
named below. Design: [docs/design/knowing.md](../design/knowing.md). Figures: the profile's `knowing`, with sources.

Information lives with whoever keeps it. It reaches a participant in four ways: it is theirs; they are there, or go
to look; it was published; or they asked its keeper for one specific thing. This page says how the real counterpart
of each seat finds things out, with the sources opened, and what the world does. Sources were opened on 2026-10-08
unless marked. **[S]** statute text read from legislation.vic.gov.au's authorised version; **[D]** the page or file
read directly; **[W]** read in the Internet Archive's copy (land.vic.gov.au refuses automated readers); **[F]** read
through a summarising reader, so the quotation is as relayed and should be checked before it is quoted elsewhere.
"(to confirm)" marks what was not opened.

## 1. Registers are searched one thing at a time

| What a real place does | Source |
|---|---|
| **The land register is public and is searched folio by folio, for a fee.** "Any person may have access to recordings in the Register and the record of dealings at any time when the Office of Titles is open" | Transfer of Land Act 1958 (Vic) s 114(1), version 184 [S] |
| It is searched by volume and folio, street address, lot on plan, council property number, parcel identifier or Crown allotment; anything but volume and folio also costs an index fee | LANDATA, "Frequently Asked Questions" [D] |
| A search returns the land's description, the "name(s) of the current owners(s) and addresses(es) for service of notices", how it is held, restrictions (mortgages, covenants, caveats) and recent dealings | Land Victoria, *Guide to searching a land title* (2016) [W, snapshot 2025-12-10] |
| **What it costs** (2025-26, the latest schedule that opened): a title search 8.10 online, 20.50 over the counter; an index search 9.23; a historical search 13.80. The 2026-27 schedule was not reachable (to confirm) | Land Use Victoria, *LANDATA service charges 2025-2026* [W, snapshot 2026-02-05] |
| **A search by owner's name is not open to the public.** "Searching by name is known as a Proprietor Name Search. This type of search is only available through our Information Brokers." Brokers work under confidentiality deeds, lawful-purpose restrictions and audit of who searched (a valuers' institute's description of the rules, not the Registrar's: to confirm); in 2026 the Registrar consulted on whether the register should stay searchable by name at all (outcome: to confirm). The fee is the broker's (not found) | LANDATA FAQ [D]; Australian Property Institute, submission on "Protecting Privacy in the Register of Land", 31 July 2026 [D]; Land Services Victoria, Customer Information Bulletin 241 [W, snapshot 2026-07-31] |
| **The registry is the state's, not the council's.** "Land Registry Services is a business division of Land Services Victoria within the Department of Transport and Planning." | Land Services Victoria, "What we do" [W, snapshot 2026-08-02] |
| **The electoral roll is the state commission's, and it is closed.** "The Commission must establish, maintain and regularly update a register of electors for Victoria"; it "must ensure that the register of electors is not available for public inspection". What the public may see is a six-monthly alphabetical list of names and addresses, at the commission's office, free | Electoral Act 2002 (Vic) ss 21, 28, 32, version 071 [S] |
| A council's election roll is compiled by the commission from the state roll and the council's own list of ratepayers; it is open for inspection around the election; a candidate is given the ward's roll for the campaign | Local Government Act 2020 (Vic) ss 248, 249, 251, 252, version 026 [S] |
| The registrar of births, deaths and marriages sends the electoral commission a list of registered deaths each month | Electoral Act 2002 (Vic) s 26 [S] |
| **Looking someone up is by name, one at a time.** A company or business name: "searching for a specific company or business", a current extract free, history and documents paid (amounts not found: to confirm). A phone number: directory assistance asks "for the name of the person or business you need" | ASIC, "Search fees" [F]; Telstra, "Directory Voice Services" [D] |
| A council publishes what it holds unless confidential ("Council information must be publicly available unless ..."); no section was found that requires a list of councillors and officers by name, though councils publish one (to confirm) | Local Government Act 2020 (Vic) ss 57, 58 [S] |

**What the world does.** A register is asked for one named thing (`way: "ask"`): a lot or a title by its number, the
titles to one lot, the dealings in one title. The land registry answers a search by holder only to the bodies its
config lists (in the generated town: the rating authority, the water corporation and the valuer, who in the
profile's place are sent ownership by notice rather than searching: section 2); a person cannot ask whose a title is
by naming the holder, only by naming the lot or the title. The directory is a look-up by id, by exact name, or of an
organisation's holders of one office. Nobody, the keeper apart, is shown a register; nobody at all is shown the
directory.

**Parameters** (the profile's `knowing`): `title_search_fee` (810, the online title search, in the currency's
smallest unit), `index_search_fee` (923): recorded, not charged (see "Leaves out").

## 2. Bodies that are told, and keep a roll of their own

| What a real place does | Source |
|---|---|
| **Whoever acquires land must tell the council.** "A person who acquires any land in a municipal district must give an acquisition notice to the Chief Executive Officer of the Council" | Local Government Act 2020 (Vic) s 122 [S] |
| and the revenue office; the information "may be disclosed to the Valuer-General"; a transfer lodged electronically generates the notice by itself. "You must lodge the notice within one month"; it "is used to update land tax, council rates and other property records" | Land Tax Act 2005 (Vic) s 103, version 086 [S]; State Revenue Office, "Complete a notice of acquisition" [F] |
| **and the water authority:** "A prescribed person must, in relation to the disposition of any land, give notice ... to each prescribed person" (who is prescribed, and the period: in regulations not opened, to confirm) | Water Act 1989 (Vic) s 159, version 147 [S] |
| **Valuations are made each year by the state's valuer and sent to the council:** a general valuation "to be made as at 1 January in each calendar year", "provided to the council" before 30 April | Valuation of Land Act 1960 (Vic) s 11, version 161 [S] |
| **A valuation is mass appraisal, not a visit to every property.** "Municipal property valuations are undertaken every year under a mass valuation." Sales, and outlying, specialist and high-risk properties, are inspected; "an external inspection of all other property is to be on a five-year rolling program" (so about a fifth a year: our arithmetic) | Valuer-General Victoria, "Fact Sheet: Annual property valuations" [W, snapshot 2026-03-08]; *Valuation Best Practice Specifications Guidelines 2025* [W, snapshot 2025-04-17] |
| **A new building is valued when the council asks:** a supplementary valuation "by reason of the erection or construction of buildings or other improvements", made "if so requested by the council" | Valuation of Land Act 1960 (Vic) ss 13DF(2)(j), 13DFB [S] |
| **A council keeps a register of the land it owns.** "The Property Department maintains an asset register of Council land and building assets, with the categories including public halls, parks, recreation reserves" (one council's page; the Act requires an asset plan for "each class of infrastructure asset under the control of the Council", not a register by that name) | Greater Shepparton City Council, "Property" [D]; Local Government Act 2020 (Vic) s 92 [S] |
| **A planning authority keeps a public register of applications and decisions**: "must keep a register containing the prescribed information in respect of (a) all applications for permits; and (b) all decisions and determinations relating to permits" | Planning and Environment Act 1987 (Vic) s 49, version 167 [S] |

**What the world does.** See [ownership.md](ownership.md), [public-finance.md](public-finance.md),
[utilities.md](utilities.md) and [institutions.md](institutions.md), each under "Who knows what".

## 3. Going to look

| What a real place does | Source |
|---|---|
| **A builder must tell the building surveyor at each stage, and the surveyor must then come:** the builder "must ensure the relevant building surveyor is notified without delay of the completion of each mandatory notification stage"; "the relevant building surveyor must cause the building work to be inspected in person". The stages for a new building: before placing a footing; before pouring a reinforced concrete member; the completion of framework; final | Building Act 1993 (Vic) ss 33, 34, version 152; Building Regulations 2018 (Vic) r 167, version 031 [S] |
| A surveyor may otherwise inspect only work "for which a permit has been issued". Nothing requires a patrol; work without a permit comes to a council by complaint (residents give "the address where the building works are taking/took place"): one council's page, and no figure for how much is found that way (to confirm) | Building Act 1993 (Vic) s 35 [S]; Nillumbik Shire Council, "Make a complaint about building work" [F] |
| **A council enforces building law in its district** | Building Act 1993 (Vic) s 212(1) [S] |
| **A valuer may go onto land to value it:** "enter at all reasonable hours in the daytime into and upon any land building or premises and inspect the same" (the section number was not recorded: to confirm) | Valuation of Land Act 1960 (Vic) [S] |
| **A landlord may go in only on a ground, with notice, by day:** 24 hours' written notice where it "has reasonable grounds to believe that the renter has failed to comply with the renter's duties" (unpaid rent is one), between 8 a.m. and 6 p.m.; a general inspection at most once in six months, on 7 days' notice | Residential Tenancies Act 1997 (Vic) ss 85, 86, 88, version 114 [S] |
| "Late or unpaid rent does not necessarily mean a renter has abandoned the property"; to look inside "they must still follow the rules for entering a property" | Consumer Affairs Victoria, "Renter abandoning a property" (updated 8 December 2025) [D] |
| **The police go to a home when someone asks them to check on a person**, "when there is a serious and imminent risk of harm or death", or when "the individual is reasonably suspected to be deceased"; whoever asks is expected to have tried themselves first (a visit, the workplace). This is Western Australia's description: none was found for Victoria, nor the Victorian power to go in (Crimes Act 1958 s 459A is for arrest only; entry to save life is usually put on the common law of necessity: from memory, to confirm) | Western Australia Police Force, "Police welfare checks" (updated 8 May 2026) [F]; Crimes Act 1958 (Vic) s 459A, version 323 [S] |
| **How long someone who dies alone at home lies before the police are told** (Japan, the one country found to count it; January to June 2024, provisional; 37,227 people): 0 to 1 day 14,775; 2 to 3 days 7,380; 4 to 7 days 4,636; 8 to 14 days 3,266; 15 to 30 days 3,234; 31 to 90 days 2,927; 91 to 180 days 715; 181 to 365 days 164; over a year 130. Time is counted to the day the police were told. Who found them is not recorded; a news report of the full year says many were found "after reports of uncollected mail or when neighbors or relatives ... raised concerns" | National Police Agency of Japan, 警察取扱死体のうち、自宅において死亡した一人暮らしの者 (令和6年上半期 暫定値), August 2024, as tabled at the Cabinet Office [D]; The Peninsula, 11 April 2025 [D] |
| **An employer whose worker does not come** is expected to try to reach them; there is no set number of days after which the job counts as abandoned (older awards took three days' absence as evidence): from search results only, the regulator's page would not open (to confirm) | Fair Work Ombudsman, "Abandonment of employment" (not opened) |

**What the world does.** A map of anywhere but where a seat is exists only as a visit (`way: "visit"`): a look that
names up to 16 places, takes the looker's time (the way there and back at the world's travel times, and
`knowing.visit_seconds` at each place), and returns what was there when the looker was. Who goes where, and when, is
in each module's page: the police ([deaths.md](deaths.md), [crime.md](crime.md)), the builder and the inspector
([building.md](building.md), [institutions.md](institutions.md)), the valuer and the funders
([public-finance.md](public-finance.md)), the works office ([services.md](services.md)), the water corporation
([utilities.md](utilities.md)).

**Parameters:** `knowing.visit_seconds` (1,800: half an hour at a place; a placeholder: no source was found for how
long an inspection, a valuation's external look or a welfare check takes at the door).

## 4. What is published

A publication is put out by its maker to the public, and reaches its readers unasked: the law, the paper, election
notices, budgets, the planning register's decisions. A board is published too, but nobody is sent a board: it is
read a few entries at a time by someone who goes to read it (jobs, homes to let, property for sale, what sellers
advertise). Which kinds are which is world content, in the config's `knowing.published`, each with its reason; the
generated town's list is in `worlds/generator/knowing.ts`.

## 5. The weather bureau's forecasts

| What a real place does | Source |
|---|---|
| The Bureau of Meteorology publishes no hit rate or false-alarm ratio for its severe weather, heavy rain or heatwave warnings. It publishes: next-day maximum temperature within 2 °C 91.3% of the time; flood peak predictions within their target (typically 0.3 m) 80% of the time, and their lead times 69% | Bureau of Meteorology, "Forecast accuracy" (2024-25) [D] |
| It aims to warn of severe weather "24 to 36 hours ahead of the expected onset" | Bureau of Meteorology, *Thunderstorm and Severe Weather Service Level Specification 2024-25* [D] |
| **Heavy rain warnings, where a service does publish them (India, 2025):** "Probability of Detection of 0.85 ... on Day-1", falling to 0.64 on day 5; false-alarm ratio about 0.31 to 0.34. Thresholds are not restated in the release, and days 2 and 3 are only in its charts | India Meteorological Department, press release "Forecast Performance of IMD for Severe Weather events during 2025", 3 January 2026 [D] |
| **Heatwave warnings (India):** detected 95 to 98% a day ahead (2021 to 2025); "Probability of Detection 3 days ahead increasing to 75% and to 46% 5 days ahead in 2025". No false-alarm ratio is given, there or anywhere found at these leads | the same release [D] |
| **Drought and seasonal outlooks:** no hit rate or false-alarm ratio was found at any lead (the Bureau scores them as "percent consistent"; the United States' seasonal temperature skill was 18% in 2010) | Caldwell (2011), slides [D] |

**What the world does:** see [weather.md](weather.md), "What the bureau knows".

## Leaves out (for now)

- **Search fees.** Nobody is charged for a search, and the registry does no work for one (the kernel answers from
  the register). The fee is in the profile so that charging it is a behaviour change, not a research task.
- **Asking takes no time**; a visit does.
- **A name search through a broker** is not open to a person or a firm here at all; in the profile's place a broker
  will do one for a lawful purpose.
- **An office's visit is the office's time** (one of its lanes), not a named officer's working day.
- **A look-up by name is exact.**
- **A landlord's notice before entering** is not given: a landlord whose rent has stopped asks the police to check
  (see [deaths.md](deaths.md)).
