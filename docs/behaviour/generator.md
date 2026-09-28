# The town generator (`worlds/generator/generate.ts`, v0.13.0)

Turns a short spec (`worlds/town.yaml`) and a **profile** (`worlds/profiles/`, docs/profiles.md: every place-specific figure, with its source) into a full, explicit contracts v0.5 world config. The generator's code holds no place's figures; what it needs beyond the profile it derives by general formulas:
- **a factory's item:** its labour share of the world price, as hours at the factory wage; its input share, as kg of inputs;
- **a shop's item:** its retail price from the purchases share; its serving time from the labour share, at the shop wage;
- **shops' opening staff:** from the sales the town's expected incomes would make;
- **the world market's demand**, if the spec doesn't set it: what the factories' opening staff make, less the town's own purchases (a boundary condition, set by rule). It's deterministic from the spec's seed, using the kernel's keyed randomness. The kernel never generates anything; it receives this output. Everything generated is example **content** (D23).

**What it makes:**
- **Land:** a grid of cells, each a lot on the town's registry (a `lot` record naming its cell). The southern row is the river.
- **Catalogue:** the kinds of building, each with its materials, hours of building and demolition work, and least time to build ([building.md](building.md)), including a `park` and the builder's `yard`. Three resource kinds: `goods` (items), `inputs` (kg) and `materials` (kg). Three tasks: `make` (a factory's), `serve` (a shop's) and `consume` (a household's). A working day of 8 hours.
- **Buildings:** apartment blocks (12 units: 3 one-bedroom, 7 two, 2 three) and houses (three or four bedrooms) owned by landlords; shops and factories owning their premises; the builder's yard (a workplace for its crew of up to 12; it starts with 4); a town hall. Every other lot is recorded as the town's. A home's physical capacity is 2 per bedroom plus 2.
- **Entities:** the outside world, the town, one bank, a builder, landlords, shops, factories, and the people, in **households** drawn from ABS Census 2021 shares, with ages and birth dates ([households.md](households.md)).
- **Money:** every account is held at the bank, except the outside world's, which it holds itself.
- **Holdings:** the builder starts with a house's worth of materials (120 t) in its yard.
- **Genesis records:**
  - the example legal code (`worlds/law/basic.json`): charter, property, tenancy, planning and tax law;
  - ownership claims;
  - each household (a `household` record);
  - leases and jobs already in force (tenancies part-way through, 12–24-month terms; a lease is the leaseholder's, naming the household and the account the rent is paid from);
  - the standing orders that pay rent, the other adults' shares of the rent, and wages;
  - the town's `signatories` list for its account (the finance officer's position) and its payments procedure.
- **Positions and participants:** every organisation acts through positions, each held at the start by a system participant running the job's module:
  - the mayor: with `mayor: llm`, a language-model participant (weekly cadence; the laws and the forms on file as standing documents; until a real model is used, the mock, with `city.mayor_code` as its brain, see docs/design/m2-llm-participants.md), or with `mayor: code` the rule-following code mayor (the all-code control);
  - the finance officer's budget brief (`budget_lines`): one line, parks, at the builder's price for a park (as the builder publishes it);
  - the city's finance officer, planning officer, inspector, tax clerk, council clerk, and five councillors at positions −80, −40, 0, 40 and 80 ([government.md](government.md));
  - the bank's payment system; the world market (`world.trade`: materials at $1.25 a kg and inputs at $2.50 a kg, and goods (imports) at $66; buying the factories' goods at $60, `exports_per_month` split by the size of their works);
  - the builder's site foreman (what each kind of building takes, from the catalogue, as its own business knowledge; it publishes its prices, and the mayor, finance and landlords read them there, D57), landlords' letting offices, the managers of shops (`firm.retailer`: serving takes 1.5 hours an item; it opens at 1.1 × marginal cost; it starts with 3 staff, room for 6, 100 items in stock, and its own shareholders register) and factories (`firm.producer`: the task `make`, 10 kg of inputs and 1.5 hours an item; wholesale at $60; each factory's `shareholders` register, every household's leaseholder in proportion to the household's savings; opening stock of a month's inputs and a week's goods);
  - every person, as themselves (`<person>-self`), with their sex as a trait.
