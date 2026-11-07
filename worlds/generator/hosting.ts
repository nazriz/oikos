// A host in the town for the assistants' systems (docs/behaviour/hosting.md; docs/design/foundations-2.md 7.3, step E5):
// where a study asks for the assistants' providers to run their systems in the town (`hosting: "local"`; the owner's
// ruling, 2026-10-25: AI suppliers are abroad or local), a hosting firm holds the servers they run on, in a building of its
// own on a lot of its own, on the town's feeders, main and sewer like any building. Each server is a lane of a system
// (kernel `runs_on`); an hour of its work draws its power (with the building's overhead) and its cooling water there, and
// the building draws what the work does not all day. The town's network carries it with the homes', so in a shortage
// who goes short is the network's physics, the supply in force and the operators' acts (foundations-2 2.1).

/** The profile's figures for a hosting firm (`values.hosting`, each with its source or marked a placeholder). */
export interface HostingFigures {
  /** Servers the building holds: the room for the systems run there, a lane each. */
  servers: number;
  /** A server's draw at work, in watts. */
  server_watts: number;
  /** The building's power over its servers' (power usage effectiveness), in basis points (15,600: 1.56). */
  pue_bps: number;
  /** Cooling water a kWh of the building's draw takes, in millilitres. */
  water_ml_per_kwh: number;
  /** What the host asks of its clients over what its power and water cost it, in basis points. */
  margin_bps: number;
  /** Months of its bills it opens with in hand. */
  opening_months: number;
}

export interface Hosting {
  at: string;
  holder: string;
  /** An hour of a server's work there: kWh and litres. */
  kwh_per_hour: number;
  litres_per_hour: number;
  energy_day: number;
  water_day: number;
  runsOn: { hardware: string; per_lane: number; holder: string; at: string; hour: string };
  tasks: any[];
  holdings: any[];
  structureType: any;
  opening: number;
  /** Each provider's fee a month. */
  fee: number;
}

/** The host's figures, for the providers there are, at the profile's tariffs (energy and water a unit, and the grid's emissions). */
export function hostingOf(H: HostingFigures | undefined, profile: string, providers: number, t: { price_per_kwh: number; price_per_kl: number; grams_per_kwh: number }, build: { materials: number; labour_hours: number; days: number }): Hosting {
  if (!H) throw new Error(`profile ${profile} has no hosting figures (values.hosting), and the town asks for a host in the town`);
  if (!(providers > 0)) throw new Error("a host in the town needs assistants on offer (assistants: true)");
  const kwh_per_hour = Math.max(1, Math.round((H.server_watts * H.pue_bps) / 10_000 / 1000));
  const litres_per_hour = Math.max(1, Math.round((kwh_per_hour * H.water_ml_per_kwh) / 1000));
  const energy_day = H.servers * kwh_per_hour * 24, water_day = H.servers * litres_per_hour * 24;
  const bills = Math.round(energy_day * 30 * t.price_per_kwh + (water_day * 30 * t.price_per_kl) / 1000);
  const at = "data-centre", holder = "host";
  return {
    at, holder, kwh_per_hour, litres_per_hour, energy_day, water_day,
    runsOn: { hardware: "hardware", per_lane: 1, holder, at, hour: "compute" },
    tasks: [
      // (An hour of a server's work: its power and the building's overhead, dissipated with the grid's emissions; its
      // cooling water, out to the sewer.)
      { id: "compute", labour: 0, consumes: { energy: String(kwh_per_hour), water: String(litres_per_hour) }, produces: { wastewater: String(litres_per_hour) }, emits: { greenhouse_gas: kwh_per_hour * t.grams_per_kwh } },
      // (What the building draws beyond the work: idle servers, cooling, lighting; a unit a kWh, or a litre.)
      { id: "plant-energy", labour: 0, consumes: { energy: "1" }, emits: { greenhouse_gas: t.grams_per_kwh } },
      { id: "plant-water", labour: 0, consumes: { water: "1" }, produces: { wastewater: "1" } },
    ],
    holdings: [
      { kind: "hardware", holder, at, quantity: String(H.servers) },
      // (A day's draw in hand as the town opens.)
      { kind: "energy", holder, at, quantity: String(energy_day) },
      { kind: "water", holder, at, quantity: String(water_day) },
    ],
    structureType: { id: "data_centre", category: "commercial", materials: { materials: build.materials }, build_labour: build.labour_hours * 3600, demolition_labour: Math.round((build.labour_hours * 3600) / 10), build_time: build.days * 86_400, footprint: { w: 1, h: 1 }, spaces: [] },
    opening: bills * H.opening_months,
    fee: Math.ceil((bills * (10_000 + H.margin_bps)) / 10_000 / providers),
  };
}
