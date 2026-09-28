# The town generator (`worlds/generator/generate.ts`, v0.11.0)

Turns a short spec (`worlds/town.yaml`) into a full, explicit contracts v0.4 world config. It's deterministic from the spec's seed, using the kernel's keyed randomness. The kernel never generates anything; it receives this output. Everything generated is example **content** (D23).

**What it makes:**
- **Land:** a grid of cells, each a lot on the town's registry (a `lot` record naming its cell). The southern row is the river.
- **Catalogue:** includes a `park` (green; $50,000, 30 days).
- **Buildings:** apartment blocks (12 units: 3 one-bedroom, 7 two, 2 three) and houses (three or four bedrooms) owned by landlords; shops and factories owning their premises; a town hall. Every other lot is recorded as the town's. A home's physical capacity is 2 per bedroom plus 2.
- **Entities:** the outside world, the town, one bank, a builder, landlords, shops, factories, and the people, in **households** drawn from ABS Census 2021 shares, with ages and birth dates ([households.md](households.md)).
- **Money:** every account is held at the bank, except the outside world's, which it holds itself.
- **Genesis records:**
  - the example legal code (`worlds/law/basic.json`): charter, property, tenancy, planning and tax law;
  - ownership claims;
  - each household (a `household` record);
  - leases and jobs already in force (tenancies part-way through, 12–24-month terms; a lease is the leaseholder's, naming the household and the account the rent is paid from);
  - the builder's materials costs, from the catalogue, as its own parameters: it publishes its prices, and the mayor, finance and landlords read them there (D57);
  - the standing orders that pay rent, the other adults' shares of the rent, and wages;
  - the town's `signatories` list for its account (the finance officer's position) and its payments procedure.
- **Positions and participants:** every organisation acts through positions, each held at the start by a system participant running the job's module:
  - the mayor: with `mayor: llm`, a language-model participant (weekly cadence; the laws and the forms on file as standing documents; until a real model is used, the mock, with `city.mayor_code` as its brain, see docs/design/m2-llm-participants.md), or with `mayor: code` the rule-following code mayor (the all-code control);
  - the finance officer's budget brief (`budget_lines`): one line, parks, at the builder's price for a park (materials plus the builder's 20%, the same constants the builder uses);
  - the city's finance officer, planning officer, inspector, tax clerk, council clerk, and five councillors at positions −80, −40, 0, 40 and 80 ([government.md](government.md));
  - the bank's payment system and the outside world's export demand;
  - the builder's site foreman, landlords' letting offices, shop and factory managers;
  - every person, as themselves (`<person>-self`), with their sex as a trait.
