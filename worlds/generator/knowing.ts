// Who knows what in a generated town (docs/design/knowing.md; docs/behaviour/knowing.md). Information lives with
// whoever keeps it, and reaches a seat in four ways: it is theirs (`mine`); they are there (`here`), or go to look
// (`visit`); it was published (`published`); or they asked its keeper for one specific thing (`ask`). Only a register's
// keeper is shown it whole (`kept`). Each channel a seat is given is made by one of the helpers here, so that the way
// is said where the channel is written; the kernel refuses a world whose channels say anything else.

import { modules } from "@oikos/participants";

type Match = { records?: string[]; statement_kinds?: string[]; has?: string[] };
type Extra = { title?: string; every?: number; on_request?: boolean; look_seconds?: number };
const kinds = (k: string[] | Match): Match => (Array.isArray(k) ? { statement_kinds: k } : k);

/** Its own papers: records that name the seat's entity (it is a party, or they are addressed to it). */
export const mine = (id = "mine", match: string[] | Match = {}, extra: Extra = {}) => ({ id, kind: "records", way: "mine", match: kinds(match), ...extra });
/** What its maker put out to the public, shown to its readers as it comes (each kind is in `PUBLISHED`). */
export const published = (id: string, match: string[] | Match, extra: Extra = {}) => ({ id, kind: "records", way: "published", match: kinds(match), ...extra });
/** A board (jobs, homes to let, what sellers advertise): read a few at a time, by searching it. `placed`: the notices
 * put up at places (a shop's prices at its door), wherever they are. */
export const board = (id: string, match: string[] | Match, extra: Extra & { placed?: boolean } = {}) => {
  const { placed, ...rest } = extra;
  return { id, kind: "records", way: "published", match: kinds(match), ...(placed ? { area: "all" } : {}), on_request: true, ...rest };
};
/** What named publishers themselves put out (a supplier's price list), whatever its kind. */
export const from = (id: string, publishers: string[], match: string[] | Match, extra: Extra = {}) => ({ id, kind: "records", way: "published", match: kinds(match), from: publishers, ...extra });
/** Notices placed near where the seat is. */
export const posted = (id: string, match: string[] | Match, near: number, extra: Extra = {}) => ({ id, kind: "records", way: "here", match: kinds(match), area: { near }, ...extra });
/** A register its own organisation keeps (the organisation must be its declared keeper). */
export const kept = (id: string, match: string[] | Match, extra: Extra = {}) => ({ id, kind: "records", way: "kept", match: kinds(match), ...extra });
/** A register someone else keeps, asked for one named thing: `by` the fields a question may name its subject by. */
export const ask = (id: string, of: string, match: string[] | Match, by: string[], extra: Extra = {}) => ({ id, kind: "records", way: "ask", match: kinds(match), of, by, on_request: true, ...extra });
/** The ground at an organisation's own premises (its cells), and who is there by name. */
export const premises = (id: string, cells: string[], extra: Extra & { occupants?: "names" | "counts" } = { occupants: "names" }) => ({ id, kind: "sites", way: "here", area: { premises: cells }, ...extra });
/** The ground around where a person is. */
export const around = (id: string, near: number, extra: Extra = {}) => ({ id, kind: "sites", way: "here", area: { near }, ...extra });
/** Places gone to: nothing until a look names them, which takes the looker's time. `enters`: who is inside, by name. */
export const visits = (id: string, extra: Extra & { enters?: boolean } = {}) => {
  const { enters, ...rest } = extra;
  return { id, kind: "sites", way: "visit", ...(enters ? { occupants: "names" } : {}), on_request: true, ...rest };
};
/** Who's who, looked up one at a time. */
export const lookUp = (id = "who", extra: Extra = {}) => ({ id, kind: "directory", way: "ask", on_request: true, ...extra });

/**
 * What is put out to the whole public by whoever makes it, so that being shown it is being one of its readers: the
 * law as promulgated, an office's public notices, the paper. Each with the reason. A **board** is many parties'
 * notices (a market): it is published, but nobody is shown a market: it is gone round, a few entries at a time
 * (`most`, how many one reading takes in).
 */
/** What a town where things go wrong publishes besides (docs/behaviour/frictions.md): given only to such a town. */
export const PUBLISHED_HEARINGS = { what: "has:hears", why: "A body that hears grievances says publicly what it hears, so that whoever has such a matter can bring it." };
/** What a town where people found things publishes besides (docs/behaviour/founding.md): given only to such a town. */
export const PUBLISHED_MEMBERSHIPS = { what: "membership", why: "A group says publicly what joining it asks, so that whoever it is for can find it." };
export const PUBLISHED: { what: string; why: string; board?: true; most?: number }[] = [
  { what: "law", why: "The law in force is promulgated to everyone it binds." },
  { what: "charter", why: "The town's charter is public, as its laws are." },
  { what: "procedure", why: "A public body's adopted procedures are published with its laws." },
  { what: "law_schedule", why: "How a law is written from its figures is published with the law." },
  { what: "form", why: "An office's forms are put out for anyone to use." },
  { what: "news", why: "The local paper is printed for whoever reads it." },
  { what: "election_notice", why: "The electoral office's notice of an election is given to the whole town." },
  { what: "nomination", why: "Who stands for office is announced to the electors." },
  { what: "ballot", why: "A question put to a vote is put before those who vote on it, and the public." },
  { what: "ballot_result", why: "The result of a vote is declared in public." },
  { what: "weather_warning", why: "The bureau's warnings are broadcast." },
  { what: "budget", why: "A public body's adopted budget is a public document." },
  { what: "petition", why: "A petition is put up for the public to read and sign." },
  { what: "petition_count", why: "A petition's organiser publishes how many have signed." },
  { what: "petition_response", why: "A public body's answer to a petition is given in public." },
  { what: "permit_decision", why: "Planning decisions are entered in a register open to the public." },
  { what: "environment_report", why: "The environment office publishes its report." },
  { what: "support_statistics", why: "Published statistics of who is paid support." },
  { what: "price_index", why: "Published statistics of prices." },
  { what: "population_estimate", why: "Published statistics of how many live in the town." },
  { what: "system_offer", why: "A vendor of systems advertises what it sells and at what price to the businesses and offices that might buy." },
  { what: "tender", why: "A public body invites bids for a contract in public, so that any seller may bid." },
  { what: "closure", why: "A firm's winding up is given by public notice." },
  { what: "has:practice", why: "A notice of a gathering is put up for whoever may come." },
  { what: "has:assertion", why: "What is put forward to be believed (a teaching, a platform, a report) is addressed to the public." },
  // Boards: read on request, a few at a time.
  { what: "rental_listing", why: "Homes to let are advertised to whoever is looking for one.", board: true },
  { what: "job_posting", why: "Jobs are advertised to whoever is looking for work.", board: true },
  { what: "property_for_sale", why: "Property for sale is advertised to whoever may buy.", board: true },
  { what: "property_sold", why: "Sale results are published, property by property.", board: true },
  { what: "price_list", why: "What a seller advertises is read by those who go to it or look it up.", board: true },
  { what: "enterprise_agreement", why: "A workplace's registered agreement is published and looked up by the employer it binds.", board: true },
];

/**
 * What each register's keeper answers when asked (docs/behaviour/knowing.md, section 1): a question naming its
 * subject by this field, to these (none: anyone), at most so many at once. A register not here answers nothing.
 */
export function answersOf(what: string, town: { holderSearch: string[]; dealings: number }): { by: string; to?: string[]; most?: number }[] {
  switch (what) {
    // A lot's plan, by its number, or by a cell of its ground (an address).
    case "lot": return [{ by: "id", most: 1 }, { by: "data.cells", most: 1 }];
    // A title by its number, or the titles to one lot; by holder only to the bodies a statute supplies.
    case "records:claim": return [{ by: "id", most: 1 }, { by: "about.object", most: town.dealings }, ...(town.holderSearch.length ? [{ by: "holder", to: town.holderSearch }] : [])];
    // The dealings in one title.
    case "records:claim_transfer": case "records:claim_release": return [{ by: "id", most: 1 }, { by: "claim", most: town.dealings }];
    default: return [];
  }
}

/**
 * The world's `knowing`: what is published, and the keeper of each register, taken from the behaviour module that
 * does each seat's job (its `keeps`, with the reason) for the organisation the seat belongs to.
 */
export function knowing(positions: { entity: string; role_module?: { code?: string } }[], town: { holderSearch: string[]; dealings: number; visit_seconds?: number; hearings?: boolean; founding?: boolean }) {
  const keepers = new Map<string, { entity: string; what: string; why: string; answers?: ReturnType<typeof answersOf> }>();
  for (const pos of positions) {
    for (const k of modules[pos.role_module?.code ?? ""]?.keeps ?? []) {
      // (A map and every entity of a kind are not registers: the guard's test holds those to what is declared.)
      if (k.what === "map" || k.what === "directory" || k.what === "accounts" || k.what.startsWith("every:")) continue;
      const answers = answersOf(k.what, town);
      if (!keepers.has(`${pos.entity}|${k.what}`)) keepers.set(`${pos.entity}|${k.what}`, { entity: pos.entity, what: k.what, why: k.why, ...(answers.length ? { answers } : {}) });
    }
  }
  return { published: [...PUBLISHED, ...(town.hearings ? [PUBLISHED_HEARINGS] : []), ...(town.founding ? [PUBLISHED_MEMBERSHIPS] : [])].map((p) => ({ ...p })), keepers: [...keepers.values()].sort((a, b) => (`${a.entity}|${a.what}` < `${b.entity}|${b.what}` ? -1 : 1)), ...(town.visit_seconds !== undefined ? { visit_seconds: town.visit_seconds } : {}) };
}
