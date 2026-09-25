# The town generator (`worlds/generator/generate.ts`, v0.1.0)

Turns a short spec (`worlds/town.yaml`) into a full, explicit contracts v0.2 world config. It's deterministic from the spec's seed, using the kernel's keyed randomness. The kernel never generates anything; it receives this output. Everything generated is example **content** (D23).

**What it makes:**
- **Land:** a grid of parcels, with the southern row as river parcels.
- **Buildings:** apartment blocks (12 homes each) and houses owned by landlords; shops and factories owning their premises; a town hall. Every other parcel is recorded as the town's.
- **Entities:** the outside world, the town, one bank, a builder, landlords, shops, factories, and the citizens (persons).
- **Money:** every account is held at the bank, except the outside world's, which it holds itself.
- **Genesis records:**
  - the example legal code (`worlds/law/basic.json`): charter, property, tenancy, planning and tax law;
  - ownership claims;
  - leases and jobs already in force (tenancies part-way through, 12–24-month terms);
  - the standing orders that pay rent and wages.
- **Seats:**
  - the mayor (an LLM seat, mocked until M2);
  - the city's finance officer, planning officer, inspector, tax clerk and council clerk (idle until M1c);
  - the bank's payment system and the outside world's export demand;
  - landlords, shop and factory managers;
  - every citizen.
