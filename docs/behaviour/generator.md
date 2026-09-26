# The town generator (`worlds/generator/generate.ts`, v0.7.0)

Turns a short spec (`worlds/town.yaml`) into a full, explicit contracts v0.2 world config. It's deterministic from the spec's seed, using the kernel's keyed randomness. The kernel never generates anything; it receives this output. Everything generated is example **content** (D23).

**What it makes:**
- **Land:** a grid of parcels, with the southern row as river parcels.
- **Catalogue:** includes a `park` (green; $50,000, 30 days).
- **Buildings:** apartment blocks (12 homes each) and houses owned by landlords; shops and factories owning their premises; a town hall. Every other parcel is recorded as the town's.
- **Entities:** the outside world, the town, one bank, a builder, landlords, shops, factories, and the citizens (persons).
- **Money:** every account is held at the bank, except the outside world's, which it holds itself.
- **Genesis records:**
  - the example legal code (`worlds/law/basic.json`): charter, property, tenancy, planning and tax law;
  - ownership claims;
  - leases and jobs already in force (tenancies part-way through, 12–24-month terms);
  - the standing orders that pay rent and wages;
  - the town's `signatories` list for its account (the finance officer) and its payments procedure.
- **Seats:**
  - the mayor: with `mayor: llm`, a language-model seat (weekly cadence; the laws as standing documents; until a real model is used, the mock, with `city.mayor_code` as its brain, see docs/design/m2-llm-seats.md), or with `mayor: code` the rule-following code mayor (the all-code control);
  - the city's finance officer, planning officer, inspector, tax clerk, council clerk, and five councillors at positions −80, −40, 0, 40 and 80 ([government.md](government.md));
  - the bank's payment system and the outside world's export demand;
  - landlords, shop and factory managers;
  - every citizen.
