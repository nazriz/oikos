// Gold programs generated from the call language's own contract (docs/design/translator-and-resolver.md §16.4:
// "seeded and driven from the call-language schema"), for what runs' logs hold little or none of.
//
// A town's own code writes thousands of payments and a handful of claims, and never sets up a system or a post, so
// gold programs sampled from logs are lopsided (measured 2026-10-06: of about 6,200, money 1,510 and work 1,199; take,
// position, entity, claim, system and harm a handful or none). A model trained on that would know one town's verbs.
// Here every function of contracts/calls.schema.json (read through `calls.ARGS`) gets programs across its sensible
// combinations of arguments (contracts/calls.md says what each means), with values drawn from seeded pools that look
// like real worlds': ids in the styles logs show (acc-…, rec.N, c0042, ent.N, lot-NN-NN, str.N, apts-N/dwelling.N,
// job-…), invented organisations and people, kinds, tasks, templates and structure types as ordinary words, and
// amounts in several invented currencies (a sign before, a code only, no decimals, three). The numbers and the
// combinations are many, so a model that learns from these has to copy what a request says: there's nothing to
// memorise.
//
// Every program made here parses, passes the contract's argument table and is one a person could ask for in a
// sentence or two (data.ts `askable`); a program of several lines is one whose later lines use what an earlier line
// made (an organisation, then its charter), never unrelated lines (that is `too_much`).
//
// Forms are invented too: a name, the office it goes to, and two to seven fields of every type the resolver reads,
// in small sets (what one person knows of), each filled in several ways and carried with its specification as the
// translator would be shown it.
//
// No structured data but a claim's slots is written (data.ts `JSON_OUT_OF_SCOPE`): the first model copies and chooses.

import { calls, type Currency } from "@oikos/participants";
import { amountWritings, askable, FIELD_TYPES, goldText, sampler, shapeOf, shuffled, type FormField, type FormSpec, type Gold } from "./data";

/**
 * How invented worlds write their money: a sign before the amount or only a code; two decimal places, none, or three;
 * words for the unit and its smallest part, or none. None is any place's: the model is to learn that an amount is
 * whatever span is written as one. (`$` is among them because a real world's may be; nothing depends on it.)
 */
export const CURRENCIES: Currency[] = [
  { code: "DLR", minor_units: 2, symbol: "$", unit_words: ["dollar", "dollars"], minor_words: ["cent", "cents"] },
  { code: "FLN", minor_units: 2, symbol: "ƒ", unit_words: ["florin", "florins"], minor_words: ["penny", "pence"] },
  { code: "KRN", minor_units: 2, symbol: "kr", unit_words: ["krona", "kronor"], minor_words: ["ore"] },
  { code: "MRK", minor_units: 2, symbol: "₥", unit_words: ["mark", "marks"] },
  { code: "YUN", minor_units: 0, symbol: "¥", unit_words: ["yun"] },
  { code: "WON", minor_units: 0, symbol: "₩" },
  { code: "XYZ", minor_units: 2 },
  { code: "TAL", minor_units: 2, unit_words: ["taler", "talers"], minor_words: ["groat", "groats"] },
  { code: "ORO", minor_units: 0, unit_words: ["oro", "oros"] },
  { code: "DNR", minor_units: 3, unit_words: ["dinar", "dinars"], minor_words: ["fils"] },
  { code: "LRA", minor_units: 3, symbol: "₤", unit_words: ["lira", "lire"] },
];

// ---------------------------------------------------------------- pools

const PLACES = ["Harrow", "Tarn", "Eastmere", "Quill", "Marrow", "Oster", "Pennick", "Salt", "Dunmere", "Alder", "Wex", "Thistle", "Brack", "Corrie", "Fenn", "Garth", "Holm", "Ivel", "Kestrel", "Lark", "Mossy", "North", "Orchard", "Pike", "Rill", "Stone", "Under", "Vale", "Wold", "Yarrow"];
const PLACE_ENDS = ["", "", " Vale", " Hollow", " Ford", " Bay", " Reach", " Cross", " Down", " Hill", " Green", " Bridge", " End", " Side"];
const TRADES = ["Builders", "Bakery", "Joinery", "Haulage", "Stores", "Farms", "Mill", "Brickworks", "Dairy", "Foundry", "Nursery", "Laundry", "Print Works", "Surveyors", "Carriers", "Fisheries", "Pharmacy", "Workshop", "Quarry", "Timber", "Glassworks", "Weavers", "Motors", "Supplies"];
const BODIES = ["Land Trust", "Housing Cooperative", "Tenants' Association", "Workers' Union", "Savings Bank", "Benevolent Society", "Traders' Guild", "School Board", "Water Board", "Allotment Society", "Credit Union", "Residents' Committee", "Community Fund", "Burial Society", "Growers' Cooperative"];
const SUFFIXES = ["", "", "", " & Sons", " & Daughters", " Ltd", " Co", " Group", " Brothers"];
const FIRST = ["Ana", "Bram", "Cleo", "Dana", "Edda", "Farid", "Greta", "Hugo", "Ines", "Jory", "Kaya", "Leif", "Mina", "Nico", "Odile", "Pavel", "Quinn", "Rosa", "Sami", "Tova", "Ula", "Viktor", "Wren", "Xavi", "Yara", "Zeno", "Amit", "Bea", "Caio", "Dalia", "Emre", "Freya", "Goran", "Hana", "Idris", "Juno", "Kofi", "Luz", "Maren", "Naoki"];
const LAST = ["Silva", "Reyes", "Okafor", "Lindqvist", "Marsh", "Dubois", "Tanaka", "Novak", "Haddad", "Petrov", "Greene", "Castell", "Imani", "Farrow", "Bjork", "Quist", "Abara", "Mercer", "Sandoval", "Thorne", "Underhill", "Vance", "Whitlock", "Yoon", "Zamora", "Achebe", "Brandt", "Corbin", "Delacroix", "Ekwueme", "Falk", "Guerra", "Holt", "Iyer", "Jansen", "Kovac", "Lowry", "Moreau", "Nakata", "Osei"];
const ROLES_DESCRIBED = ["the builder", "the works manager", "the clerk", "the treasurer", "the registrar", "the landlord", "the planning officer", "the harbour master", "the school", "the bank", "the union", "the finance office", "the caretaker", "the head teacher", "my neighbour", "the supplier"];

const ENTITY_KINDS = ["trust", "firm", "cooperative", "association", "charity", "union", "club", "partnership", "company", "school", "clinic", "society", "guild", "agency", "foundation", "committee", "fund", "bank", "household", "church", "party", "league"];
const GOODS = ["goods", "timber", "bricks", "grain", "bread", "tools", "cloth", "coal", "flour", "steel", "glass", "seedlings", "fuel", "paper", "medicine", "fish", "wool", "cement", "nails", "apples", "milk", "tiles", "rope", "salt", "books", "blankets", "seed", "wire", "paint", "gravel"];
const TASKS = ["make", "build", "repair", "clean", "teach", "treat", "harvest", "plant", "inspect", "demolish", "deliver", "patrol", "mill", "bake", "weave", "mine", "fish", "mend", "paint", "dig", "pave", "sort", "audit", "collect", "prune", "weld", "print", "log", "thresh", "quarry"];
const SURVEYED = ["trout", "heron", "frogs", "otter", "pollution", "water", "kingfisher", "reed", "moss", "salmon", "noise", "soil", "bees", "lichen", "voles"];
const STRUCTURE_TYPES = ["park", "shed", "house", "school", "clinic", "factory", "bakery", "warehouse", "road", "bridge", "library", "depot", "mill", "greenhouse", "workshop", "hall", "market", "well", "dam", "barn", "playground", "terrace", "cottage", "tower", "jetty", "stable", "kiln", "granary", "chapel", "shelter"];
const AGREEMENTS = ["lease", "employment", "supply", "service", "loan", "sale", "construction", "tenancy", "licence", "partnership", "maintenance", "carriage", "apprenticeship", "retainer", "mortgage", "hire"];
const NEWCOMERS = ["newcomer", "visitor", "worker", "settler", "trader", "student", "pensioner", "apprentice", "refugee", "seasonal_worker"];
const CHILDREN = ["child", "infant", "newborn", "baby"];
const SYSTEMS = ["assistant", "ledger_keeper", "dispatcher", "monitor", "scheduler", "records_clerk", "billing_agent", "inspector_aid", "helpdesk", "auditor", "translator_aid", "planner"];
const STATEMENTS = ["notice", "law", "report", "charter", "minutes", "order", "policy", "budget", "announcement", "bylaw", "resolution", "invoice", "receipt", "petition", "complaint", "decision", "warning", "schedule", "advertisement", "timetable", "apology", "tender", "price_list", "roster"];
const ROLES = ["staff", "manager", "clerk", "treasurer", "director", "officer", "secretary", "inspector", "foreman", "apprentice", "trustee", "steward", "auditor", "teacher", "nurse", "driver"];
const TITLES = ["Baker", "Head Gardener", "Treasurer", "Night Watch", "Site Foreman", "Clerk of Works", "Chief Steward", "Bookkeeper", "Owner", "Chair", "Harbour Pilot", "School Nurse", "Depot Manager", "Second Miller", "Records Keeper", "Lead Surveyor", "Warden", "Dispatcher", "Head of Stores", "Rent Collector", "Quarry Master", "Apprentice Joiner"];
const OFFICE_WORDS = ["planning", "works", "finance", "clerk", "rates", "licensing", "housing", "parks", "registry", "council", "health", "harbour", "records", "treasury", "mayor", "inspector", "roads", "markets", "schools", "water"];
const ACTIONS = ["build", "demolish", "occupy", "sell", "fish", "trade", "farm", "enter", "graze", "quarry", "moor", "sublet", "inspect", "use", "cross", "log", "park", "camp", "survey", "sign"];
const CHOICES = ["yes", "no", "abstain", "for", "against", "approve", "reject", "option_a", "option_b", "defer"];

const PURPOSES = ["rent", "the fence", "wages", "the kerb", "the drain", "repairs", "school fees", "the deposit", "materials", "the survey", "last month's deliveries", "the water bill", "membership dues", "the annual levy", "stall hire", "the roof", "back pay", "the first instalment", "a refund", "the festival", "cleaning", "the energy bill", "fuel", "the loan repayment", "pension support", "overtime", "the grant", "legal costs", "the retainer", "damages"];
const NOUNS = ["minutes", "invoice", "estimate", "roster", "survey results", "keys", "draft budget", "permit", "inspection report", "delivery schedule", "list of tenants", "accounts", "plans for the hall", "water readings", "contract", "price list"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "the end of the week", "tomorrow", "the first of the month", "noon"];
const ASKS = ["Please send me the", "Could you bring the", "I still need the", "Thank you for the", "Please check the", "We have not received the", "Kindly return the", "Let me know when you have the"];
const SITES = ["depot", "market", "library", "footbridge", "school", "clinic", "hall", "north road", "harbour", "park", "mill", "yard", "office", "allotments", "ferry"];
const EVENTS = ["will be closed", "opens", "will be inspected", "is out of use", "will be repainted", "reopens", "will have no water", "is reserved for the fair"];
const REASONS = ["for repairs", "for the holiday", "until further notice", "for cleaning", "while the roof is mended", "for stocktaking", "by order of the council", "for the season"];
const RULES = ["No fires are to be lit", "Carts must keep left", "Stalls close at dusk", "Dogs must be leashed", "Rubbish goes out on collection day only", "Nobody may fish from the weir", "Rents fall due on the first of the month", "Meetings are open to every member"];
const TERMS = ["Deliveries on the first of each month.", "Either side may end it in writing.", "The premises are kept in good repair.", "Payment falls due on receipt.", "Work is done on weekdays only.", "Tools are supplied by the employer.", "Disputes go to the council.", "The rate is reviewed each year."];
const PURPOSE_LINES = ["It holds land for the town, in perpetuity.", "It exists to house its members at cost.", "It bakes bread and sells it at a fair price.", "It speaks for those who work at the mill.", "It keeps the river clean for everyone downstream.", "It lends to members who cannot borrow elsewhere.", "It runs the market on behalf of its stallholders.", "It teaches a trade to anyone who asks."];

const FORM_WORDS = ["permit", "licence", "grant", "rates", "tenancy", "event", "burial", "market", "stall", "water", "noise", "building", "demolition", "road", "tree", "waste", "business", "vehicle", "dog", "parking", "heritage", "subdivision", "budget", "council", "leave", "hardship", "rebate", "fence", "planning", "festival", "food", "trade", "mooring", "allotment", "busking", "signage", "drainage", "footpath", "kiosk", "relief"];
const FORM_ENDS = ["application", "request", "proposal", "notice", "claim", "return", "declaration", "registration", "renewal", "report", "complaint", "submission", "objection", "appeal", "variation", "transfer"];
/** Names a field of each type goes by. */
const FIELD_NAMES: { [type: string]: string[] } = {
  amount: ["amount", "fee", "budget", "cost", "deposit", "total", "estimate", "grant", "bond", "staff_line", "parks_line", "roads_line", "rent", "value", "payment"],
  duration: ["duration", "term", "period", "notice_period", "length", "lease_term", "review_after", "valid_for", "delay"],
  count: ["count", "attendees", "storeys", "dwellings", "staff", "vehicles", "days_open", "stalls", "animals", "copies"],
  text: ["notes", "reason", "details", "description", "purpose", "summary", "comments", "proposal", "conditions"],
  choice: ["kind", "category", "affects", "priority", "zone", "outcome", "method", "status", "season", "tier"],
  space: ["space", "dwelling", "room", "unit", "premises"],
  structure_type: ["structure_type", "building_type", "type_of_building", "proposed_use"],
  lot: ["lot", "site", "parcel", "land"],
  cell: ["cell", "corner", "location"],
  account: ["account", "pay_from", "refund_to", "charge_to"],
  record: ["record", "permit", "ballot", "law", "replaces", "reference", "agreement"],
  entity: ["applicant", "organisation", "on_behalf_of", "employer", "owner"],
  person: ["person", "tenant", "occupant", "witness", "contact"],
  structure: ["structure", "building", "property"],
  position: ["office", "post", "reports_to"],
};
const OPTIONS = [["landlords", "tenants", "neither"], ["law", "budget", "motion"], ["low", "medium", "high"], ["residential", "commercial", "industrial", "rural"], ["new", "renewal"], ["spring", "summer", "autumn", "winter"], ["granted", "refused", "deferred"], ["cash", "transfer"], ["urgent", "routine"], ["north", "south", "east", "west", "centre"], ["owner", "tenant", "agent"], ["small", "medium", "large", "very_large"], ["weekdays", "weekends", "both"], ["indoor", "outdoor"], ["temporary", "permanent"]];

// ---------------------------------------------------------------- drawing

type V = calls.Value;
const id = (s: string): V => ({ id: s });
const tx = (s: string): V => ({ text: s });
const list = (xs: string[]): V => ({ json: xs });
const pad = (n: number, w: number) => String(n).padStart(w, "0");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** One program's draws: a world's money, and the names of whatever it mentions by id. */
class Draw {
  names: { [id: string]: string } = {};
  currency: Currency;
  constructor(readonly rand: () => number, currencies: Currency[]) {
    this.currency = this.pick(currencies);
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rand() * xs.length)]!;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.rand() * (hi - lo + 1));
  }
  maybe(p = 0.5): boolean {
    return this.rand() < p;
  }
  word(xs: readonly string[]): V {
    return id(this.pick(xs));
  }
  place(): string {
    return `${this.pick(PLACES)}${this.pick(PLACE_ENDS)}`;
  }
  orgName(): string {
    return this.maybe(0.3) ? `${this.place()} ${this.pick(BODIES)}` : this.maybe(0.25) ? `${this.pick(LAST)}${this.pick([" & Sons", " Brothers", " & Co", "'s"])} ${this.pick(TRADES)}` : `${this.place()} ${this.pick(TRADES)}${this.pick(SUFFIXES)}`;
  }
  personName(): string {
    return `${this.pick(FIRST)} ${this.pick(LAST)}`;
  }
  personId(): string {
    const s = this.maybe(0.7) ? `c${pad(this.int(1, 9999), 4)}` : this.maybe() ? `ent.${this.int(1, 4000)}` : `par.${this.int(1, 900)}`;
    this.names[s] = this.personName();
    return s;
  }
  orgId(): string {
    const name = this.orgName();
    const words = slug(name).split("-").filter((w) => !["sons", "daughters", "co", "ltd", "s", "group"].includes(w));
    const s = this.maybe(0.3) ? `ent.${this.int(1, 4000)}` : this.maybe(0.4) ? words[words.length - 1]! : this.maybe() ? `${words[0]}-${words[words.length - 1]}` : words.map((w) => w[0]).join("") + this.int(1, 99);
    this.names[s] = name;
    return s;
  }
  officeId(): string {
    const w = this.pick(OFFICE_WORDS);
    const s = this.maybe(0.6) ? w : this.maybe() ? `${slug(this.pick(PLACES))}-${w}` : `pos.${this.int(1, 600)}`;
    if (s.startsWith("pos.")) this.names[s] = `the ${w} office`;
    return s;
  }
  /** Someone or something acted on or for: an organisation, a person or an office by id; sometimes by name alone, or
   * only described (both written as the request put them, quoted: the resolver finds who is meant). */
  party(kinds: ("org" | "person" | "office")[] = ["org", "person", "office"]): V {
    const kind = this.pick(kinds);
    const r = this.rand();
    if (r < 0.12) return tx(kind === "person" ? this.personName() : kind === "org" ? this.orgName() : `the ${this.pick(OFFICE_WORDS)} office`);
    if (r < 0.18) return tx(this.pick(ROLES_DESCRIBED));
    return id(kind === "person" ? this.personId() : kind === "org" ? this.orgId() : this.officeId());
  }
  person(): V {
    return this.party(["person"]);
  }
  account(): V {
    const r = this.rand();
    return id(r < 0.35 ? `acc-${this.pick([...OFFICE_WORDS, "city", "town", "parks", "payroll", "reserve", "works"])}${this.maybe(0.3) ? `-${this.int(1, 40)}` : ""}` : r < 0.6 ? `acc-c${pad(this.int(1, 9999), 4)}` : r < 0.8 ? `acc-${slug(this.pick(TRADES))}-${this.int(1, 90)}` : `acc.${this.int(1, 9000)}`);
  }
  /** A record cited: mostly by its number, sometimes a law by its name. */
  record(): V {
    return this.maybe(0.85) ? this.rec() : id(`law-${slug(this.pick([...OFFICE_WORDS, "charter", "tenancy", "property", "noise"]))}`);
  }
  /** A record acted on (a ballot, an agreement, a claim, a notice). */
  rec(): V {
    return id(`rec.${this.int(1, 40000)}`);
  }
  lot(): V {
    return id(`lot-${pad(this.int(0, 40), 2)}-${pad(this.int(0, 40), 2)}`);
  }
  cellId(): string {
    return `cell.${this.int(0, 60)}.${this.int(0, 60)}`;
  }
  ground(): V {
    return this.maybe(0.75) ? this.lot() : id(this.cellId());
  }
  structureId(): string {
    return this.maybe(0.6) ? `str.${this.int(1, 900)}` : `${this.pick(["apts", "house", "shop", "hall", "works", "store"])}-${this.int(1, 120)}`;
  }
  structure(): V {
    return id(this.structureId());
  }
  spaceId(): string {
    return `${this.structureId()}/${this.pick(["dwelling", "room", "unit", "shop", "office"])}.${this.int(1, 24)}`;
  }
  /** Where someone lives or goes: a space, or a building. */
  inside(): V {
    return this.maybe(0.6) ? id(this.spaceId()) : this.structure();
  }
  job(): V {
    return id(this.maybe(0.6) ? `job-c${pad(this.int(1, 9999), 4)}-${this.pick(["wages", "rent", "dues", "fees"])}` : `rec.${this.int(1, 40000)}`);
  }
  /** An amount of the world's money, written one of the ways it's written. */
  amount(): V {
    const per = 10 ** this.currency.minor_units;
    const r = this.rand();
    let whole = r < 0.3 ? this.int(1, 999) : r < 0.75 ? this.int(1, 999) * this.pick([10, 50, 100, 100, 1000]) : r < 0.9 ? this.int(1, 99) * this.pick([1000, 5000, 10000]) : this.int(1, 40) * 1_000_000;
    if (this.currency.minor_units === 0 && this.maybe(0.5)) whole *= this.pick([10, 100, 1000]);
    const frac = per > 1 && whole < 100_000 && this.maybe(0.3) ? this.int(1, per - 1) : 0;
    return tx(this.pick(amountWritings(BigInt(whole) * BigInt(per) + BigInt(frac), this.currency)));
  }
  duration(): V {
    const r = this.rand();
    return tx(r < 0.75 ? `${this.pick([2, 3, 6, 7, 10, 12, 14, 18, 21, 24, 28, 30, 45, 60, 90])} ${this.pick(["days", "weeks", "months", "days", "months"])}` : r < 0.9 ? this.pick(["a week", "a fortnight", "a month", "a year", "one year", "two years", "three months", "six weeks"]) : `${this.int(2, 10)} years`);
  }
  every(): V {
    const r = this.rand();
    return tx(r < 0.5 ? this.pick(["weekly", "fortnightly", "monthly", "quarterly", "yearly", "annually", "daily"]) : r < 0.75 ? `every ${this.pick([2, 3, 4, 6, 14, 28])} ${this.pick(["days", "weeks", "months"])}` : `${this.pick([7, 14, 28, 30, 90])} days`);
  }
  count(max = 400): V {
    return tx(this.maybe(0.1) ? this.pick(["one", "two", "three", "four", "five", "six", "ten", "twelve"]) : String(this.maybe(0.6) ? this.int(1, 20) : this.int(1, max)));
  }
  purpose(): V {
    const r = this.rand();
    return tx(r < 0.6 ? this.pick(PURPOSES) : r < 0.8 ? `invoice ${this.int(100, 9999)}` : `${this.pick(["the", "this month's", "last week's", "the overdue"])} ${this.pick(NOUNS)}`);
  }
  letter(): V {
    const r = this.rand();
    return tx(r < 0.45 ? `${this.pick(ASKS)} ${this.pick(NOUNS)} by ${this.pick(DAYS)}.` : r < 0.7 ? `The ${this.pick(SITES)} ${this.pick(EVENTS)} on ${this.pick(DAYS)}.` : r < 0.85 ? `Work on the ${this.pick(SITES)} starts on ${this.pick(DAYS)}.` : `${this.pick(ASKS)} ${this.pick(NOUNS)}.`);
  }
  publicWords(): V {
    const r = this.rand();
    return tx(r < 0.5 ? `The ${this.pick(SITES)} ${this.pick(EVENTS)} on ${this.pick(DAYS)} ${this.pick(REASONS)}.` : r < 0.8 ? `${this.pick(RULES)} at the ${this.pick(SITES)}.` : `${this.pick(RULES)}. ${this.pick(TERMS)}`);
  }
}

type Args = { [k: string]: V | undefined };
const call = (fn: calls.Fn, args: Args): calls.Call => ({ fn, args: Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)) as { [k: string]: V } });
type Lines = (calls.Call | [string, calls.Call])[];

// ---------------------------------------------------------------- one recipe per function

/** What an agreement's side commits to: money, goods, occupancy, a building or an account (the outcomes a commitment can be). */
function commitment(d: Draw, mine: boolean, other: V): V {
  const r = d.rand();
  if (r < 0.5) return { call: call("money", { to: mine ? d.account() : (d.maybe(0.7) ? d.account() : other), amount: d.amount(), every: d.maybe(0.6) ? d.every() : undefined, for: d.maybe(0.5) ? d.purpose() : undefined }) };
  if (r < 0.7) return { call: call("goods", { kind: d.word(GOODS), quantity: d.count(), to: other, at: d.structure(), every: d.maybe(0.6) ? d.every() : undefined }) };
  if (r < 0.88) return { call: call("occupancy", { who: other, in: d.inside() }) };
  if (r < 0.96) return { call: call("structure", d.maybe(0.8) ? { type: d.word(STRUCTURE_TYPES), on: d.ground() } : { remove: d.structure() }) };
  return { call: call("account", { holder: other }) };
}

const RECIPES: { [fn in Exclude<calls.Fn, "form">]: (d: Draw) => Lines } = {
  money: (d) => {
    const every = d.maybe(0.3);
    return [call("money", { to: d.maybe(0.6) ? d.account() : d.party(), amount: d.amount(), from: d.maybe(0.6) ? d.account() : undefined, every: every ? d.every() : undefined, first: every && d.maybe(0.25) ? d.duration() : undefined, for: d.maybe(0.55) ? d.purpose() : undefined, basis: d.maybe(0.15) ? d.record() : undefined, settles: d.maybe(0.12) ? d.rec() : undefined })];
  },
  goods: (d) => [call("goods", { kind: d.word(GOODS), quantity: d.count(), to: d.maybe(0.6) ? d.party(["org", "person"]) : undefined, at: d.structure(), from_at: d.maybe(0.4) ? d.structure() : undefined, for: d.maybe(0.15) ? d.purpose() : undefined })],
  work: (d) => {
    const by = () => (d.maybe(0.7) ? d.person() : list(Array.from({ length: d.int(2, 4) }, () => d.personId())));
    const r = d.rand();
    if (r < 0.12) return [call("work", { task: id("survey"), at: d.maybe(0.5) ? d.lot() : d.structure(), survey: d.word(SURVEYED), cells: list(Array.from({ length: d.int(1, 4) }, () => d.cellId())), by: d.maybe(0.7) ? by() : undefined, units: d.maybe(0.3) ? d.count(8) : undefined })];
    if (r < 0.22) return [call("work", { task: id("investigate"), units: d.count(12), at: d.structure(), by: d.maybe(0.8) ? by() : undefined, investigate: d.party(["org", "person"]), taken_at: d.structure(), kind: d.word(GOODS) })];
    return [call("work", { task: d.word(TASKS), units: d.count(60), at: d.maybe(0.8) ? d.structure() : d.ground(), by: d.maybe(0.8) ? by() : undefined, on: d.maybe(0.3) ? (d.maybe(0.6) ? d.structure() : d.maybe() ? d.person() : id(d.spaceId())) : undefined, for: d.maybe(0.06) ? id(d.orgId()) : undefined })];
  },
  account: (d) => {
    const r = d.rand();
    if (r < 0.3) return [call("account", { close: d.account() })];
    if (r < 0.45) return [call("account", { at: d.party(["org"]) })];
    return [call("account", { holder: d.party(["org", "person"]), at: d.maybe(0.6) ? d.party(["org"]) : undefined })];
  },
  structure: (d) => {
    const hired = d.maybe(0.75);
    const paid = hired && d.maybe(0.8);
    const terms = { by: hired ? d.party(["org", "person"]) : d.maybe(0.5) ? id(d.orgId()) : undefined, price: paid ? d.amount() : undefined, from: paid && d.maybe(0.7) ? d.account() : undefined, basis: d.maybe(0.3) ? d.record() : undefined };
    if (d.maybe(0.3)) return [call("structure", { remove: d.structure(), ...terms })];
    return [call("structure", { type: d.word(STRUCTURE_TYPES), on: d.ground(), ...terms, materials_at: !hired && d.maybe(0.4) ? d.structure() : undefined })];
  },
  occupancy: (d) => [call("occupancy", { in: d.inside(), who: d.maybe(0.6) ? d.person() : undefined, leave: d.maybe(0.35) ? id("yes") : undefined })],
  entity: (d) => [call("entity", { kind: d.word(ENTITY_KINDS), name: tx(d.orgName()), position: d.maybe(0.4) ? tx(d.pick(TITLES)) : undefined, visible: d.maybe(0.12) ? id("public") : undefined })],
  claim: (d) => {
    const r = d.rand();
    if (r < 0.15) return [call("claim", { release: d.rec(), basis: d.maybe(0.2) ? d.record() : undefined })];
    if (r < 0.32) return [call("claim", { transfer: d.rec(), to: d.party(["org", "person"]), basis: d.maybe(0.2) ? d.record() : undefined })];
    // What it's about, as the worlds' laws read it: an action, and what it's done to.
    const about: { [slot: string]: string } = { action: d.pick(ACTIONS) };
    if (d.maybe(0.9)) about.object = (d.pick([() => d.lot(), () => d.structure(), () => id(d.spaceId()), () => id(d.cellId()), () => d.record(), () => d.lot()])() as { id: string }).id;
    return [call("claim", { position: d.word(["right", "liberty", "power", "immunity", "liberty", "right"]), holder: d.maybe(0.85) ? d.party(["org", "person"]) : undefined, about: { json: about }, against: d.maybe(0.3) ? d.party(["org", "person"]) : undefined, basis: d.maybe(0.3) ? d.record() : undefined, visible: d.maybe(0.1) ? id("public") : undefined, for: d.maybe(0.06) ? id(d.orgId()) : undefined })];
  },
  agreement: (d) => {
    const r = d.rand();
    if (r < 0.14) return [call("agreement", { sign: d.rec(), for: d.maybe(0.15) ? id(d.orgId()) : undefined })];
    if (r < 0.28) return [call("agreement", { notice: d.rec(), text: d.maybe(0.3) ? tx(d.pick(["We are moving out.", "The work is finished.", "We no longer need the service.", "The rent is more than we can pay.", "The post has been filled."])) : undefined })];
    const other = d.party(["org", "person"]);
    const both = d.rand();
    const term = d.maybe(0.6);
    return [call("agreement", {
      with: other, template: d.maybe(0.75) ? d.word(AGREEMENTS) : undefined, term: term ? d.duration() : undefined, then: term && d.maybe(0.2) ? id("periodic") : undefined,
      our_notice: d.maybe(0.3) ? d.duration() : undefined, their_notice: d.maybe(0.3) ? d.duration() : undefined,
      we_do: both < 0.75 ? commitment(d, true, other) : undefined, they_do: both > 0.2 ? commitment(d, false, other) : undefined,
      terms: d.maybe(0.2) ? tx(d.pick(TERMS)) : undefined, basis: d.maybe(0.1) ? d.record() : undefined, visible: d.maybe(0.06) ? id("public") : undefined,
    })];
  },
  statement: (d) => {
    if (d.maybe(0.15)) return [call("statement", { withdraw: d.rec(), text: d.maybe(0.3) ? tx(d.pick(["It was issued in error.", "It has been replaced.", "The matter is settled.", "The figures were wrong."])) : undefined })];
    const to = d.rand();
    return [call("statement", { kind: d.word(STATEMENTS), text: d.publicWords(), to: to < 0.2 ? d.party() : to < 0.3 ? list([d.orgId(), d.personId()]) : undefined, visible: d.maybe(0.3) ? id("public") : undefined, basis: d.maybe(0.2) ? d.record() : undefined, for: d.maybe(0.12) ? id(d.orgId()) : undefined, on: d.maybe(0.12) ? d.lot() : undefined })];
  },
  vote: (d) => [call("vote", { ballot: d.rec(), choice: d.maybe(0.8) ? d.word(CHOICES) : d.maybe() ? id(d.personId()) : tx(d.personName()), visible: d.maybe(0.1) ? id("public") : undefined, for: d.maybe(0.08) ? id(d.orgId()) : undefined })],
  message: (d) => {
    const r = d.rand();
    return [call("message", { to: r < 0.7 ? d.party() : list(Array.from({ length: d.int(2, 3) }, () => (d.maybe(0.5) ? d.personId() : d.maybe() ? d.orgId() : d.officeId()))), text: d.letter(), re: d.maybe(0.2) ? d.rec() : undefined })];
  },
  presence: (d) => {
    const r = d.rand();
    if (r < 0.2) return [call("presence", { leave: id("yes"), who: d.maybe(0.6) ? d.person() : undefined })];
    if (r < 0.35) return [call("presence", { who: d.person() })];
    return [call("presence", { name: tx(d.personName()), age: tx(d.maybe(0.85) ? `${d.int(1, 88)} years` : `${d.int(2, 11)} months`), template: d.word(NEWCOMERS), sex: d.maybe(0.35) ? d.word(["female", "male"]) : undefined, carrying: d.maybe(0.6) ? d.amount() : undefined })];
  },
  birth: (d) => [call("birth", { name: tx(d.maybe(0.5) ? d.personName() : d.pick(FIRST)), template: d.word(CHILDREN), with: d.maybe(0.6) ? d.person() : undefined })],
  take: (d) => [call("take", { kind: d.word(GOODS), quantity: d.count(80), from: d.party(["org", "person"]), at: d.structure() })],
  harm: (d) => [call("harm", { who: d.person() })],
  position: (d) => {
    const r = d.rand();
    const post = () => id(d.maybe(0.6) ? `${slug(d.pick(TRADES))}-${slug(d.pick(TITLES))}` : d.maybe() ? d.officeId() : `pos.${d.int(1, 600)}`);
    if (r < 0.2) return [call("position", { vacate: post() })];
    if (r < 0.5) return [call("position", { appoint: post(), to: d.maybe(0.8) ? d.person() : id(`par.${d.int(1, 900)}`) })];
    return [call("position", { title: tx(d.maybe(0.7) ? d.pick(TITLES) : `${d.pick(["Deputy", "Senior", "Assistant", "Acting", "Night"])} ${d.pick(TITLES)}`), role: d.maybe(0.65) ? d.word(ROLES) : undefined })];
  },
  system: (d) => {
    if (d.maybe(0.3)) return [call("system", { retire: id(d.maybe(0.5) ? `par.${d.int(1, 900)}` : `${d.pick(SYSTEMS).replace(/_/g, "-")}-${d.int(1, 40)}`) })];
    return [call("system", { template: d.word(SYSTEMS), title: d.maybe(0.5) ? tx(`${d.pick(["Front Desk", "Night", "Payroll", "Depot", "Records", "Rates", "Permit", "Stores"])} ${d.pick(["Assistant", "Monitor", "Clerk", "Dispatcher", "Helper"])}`) : undefined })];
  },
};

/** Programs of several lines, each later line using what an earlier one made: listed under the first line's function. */
const DEPENDENT: { [fn: string]: ((d: Draw) => Lines)[] } = {
  entity: [
    (d) => [["v1", call("entity", { kind: d.word(ENTITY_KINDS), name: tx(d.orgName()), position: d.maybe(0.3) ? tx(d.pick(TITLES)) : undefined })], call("statement", { kind: id("charter"), for: { var: "v1" }, text: tx(d.pick(PURPOSE_LINES)), visible: d.maybe(0.3) ? id("public") : undefined })],
    (d) => [["v1", call("entity", { kind: d.word(ENTITY_KINDS), name: tx(d.orgName()) })], call("account", { holder: { var: "v1" }, at: d.maybe(0.7) ? d.party(["org"]) : undefined })],
    (d) => [["v1", call("entity", { kind: d.word(ENTITY_KINDS), name: tx(d.orgName()) })], call("claim", { position: d.word(["right", "liberty", "power"]), holder: { var: "v1" }, about: { json: { action: d.pick(ACTIONS), object: (d.lot() as { id: string }).id } } })],
  ],
  account: [(d) => [["v1", call("account", { holder: d.party(["org", "person"]), at: d.maybe(0.6) ? d.party(["org"]) : undefined })], call("money", { to: { var: "v1" }, amount: d.amount(), from: d.maybe(0.6) ? d.account() : undefined, for: d.maybe(0.4) ? d.purpose() : undefined })]],
  position: [(d) => [["v1", call("position", { title: tx(d.pick(TITLES)), role: d.maybe(0.6) ? d.word(ROLES) : undefined })], call("position", { appoint: { var: "v1" }, to: d.person() })]],
  statement: [(d) => [["v1", call("statement", { kind: d.word(STATEMENTS), text: d.publicWords(), visible: d.maybe(0.4) ? id("public") : undefined })], call("message", { to: d.party(), text: d.letter(), re: { var: "v1" } })]],
  presence: [(d) => [["v1", call("presence", { name: tx(d.personName()), age: tx(`${d.int(18, 80)} years`), template: d.word(NEWCOMERS) })], call("occupancy", { who: { var: "v1" }, in: d.inside() })]],
  system: [(d) => [["v1", call("system", { template: d.word(SYSTEMS) })], call("position", { appoint: id(d.officeId()), to: { var: "v1" } })]],
};

/** A program worth keeping, as gold: it parses back, passes the contract and is askable; otherwise undefined. */
function goldOf(lines: Lines, d: Draw, source: string, forms?: FormSpec[]): Gold | undefined {
  let p: calls.Program;
  try {
    p = calls.parseProgram(calls.programText(calls.programOf(...lines)));
  } catch {
    return undefined;
  }
  if (calls.contractErrors(p).length || !askable(p)) return undefined;
  const program = goldText(p);
  const mentioned = new Set<string>();
  const walk = (v: V) => ("id" in v ? mentioned.add(v.id) : "json" in v && Array.isArray(v.json) ? v.json.forEach((x) => mentioned.add(String(x))) : "call" in v ? Object.values(v.call.args).forEach(walk) : undefined);
  if (!("none" in p)) for (const l of p.lines) Object.values(l.call.args).forEach(walk);
  return { program, shape: shapeOf(calls.parseProgram(program)), names: Object.fromEntries(Object.entries(d.names).filter(([k]) => mentioned.has(k))), source, origin: "synthetic", currency: d.currency, ...(forms ? { forms } : {}) };
}

export interface SyntheticOptions {
  /** Different programs to make for each function (default 300). */
  perFunction?: number;
  seed?: number;
  /** Only these functions (default: all of the call language's). */
  only?: string[];
  /** The share of a function's programs that are several dependent lines, where it has such programs (default 0.12). */
  dependent?: number;
  /** How the invented worlds write money (default: CURRENCIES). */
  currencies?: Currency[];
}

/**
 * Gold programs for every function of the call language (or those asked for), `perFunction` different ones each,
 * from the seed alone: the same seed gives the same programs. Each function's are made from a generator of their own
 * (the seed and the function's name), so asking for one function, or for more of each, changes nothing about the rest.
 * Forms come from `syntheticForms`, a few to each invented form.
 */
export function synthetic(o: SyntheticOptions = {}): Gold[] {
  const per = o.perFunction ?? 300;
  const out: Gold[] = [];
  for (const fn of calls.FUNCTIONS) {
    if (o.only && !o.only.includes(fn)) continue;
    if (!calls.ARGS[fn]) continue;
    if (fn === "form") {
      // About five ways of filling in each form: enough forms that none is learned by heart.
      out.push(...syntheticForms({ sets: Math.ceil(per / 10), perForm: 5, seed: o.seed ?? 1, ...(o.currencies ? { currencies: o.currencies } : {}) }).slice(0, per));
      continue;
    }
    const rand = sampler(hash(`${o.seed ?? 1}:${fn}`));
    const seen = new Set<string>();
    const dependent = DEPENDENT[fn] ?? [];
    for (let tries = 0; seen.size < per && tries < per * 40; tries++) {
      const d = new Draw(rand, o.currencies ?? CURRENCIES);
      const lines = dependent.length && rand() < (o.dependent ?? 0.12) ? d.pick(dependent)(d) : RECIPES[fn](d);
      const g = goldOf(lines, d, `synthetic: ${fn}`);
      if (!g || seen.has(g.program)) continue;
      seen.add(g.program);
      out.push(g);
    }
  }
  return out;
}

/** A seed from a text (FNV-1a), so each function's programs depend on the seed and its name only. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// ---------------------------------------------------------------- forms

/** A value for a field of a type, as a call writes it. */
function fieldValue(d: Draw, f: FormField): V {
  switch (f.type) {
    case "amount": return d.amount();
    case "duration": return d.duration();
    case "count": return d.count(300);
    case "text": return d.maybe(0.5) ? d.letter() : d.purpose();
    case "choice": return id(d.pick(f.options ?? ["yes", "no"]));
    case "space": return id(d.spaceId());
    case "structure_type": return d.word(STRUCTURE_TYPES);
    case "lot": return d.lot();
    case "cell": return id(d.cellId());
    case "account": return d.account();
    case "record": return d.record();
    case "entity": return id(d.orgId());
    case "person": return id(d.personId());
    case "structure": return d.structure();
    case "position": return id(d.officeId());
    default: return d.record();
  }
}

/** An invented form: a name of one to three ordinary words, the office it goes to, and two to seven fields. */
function inventForm(d: Draw, taken: Set<string>, types: string[]): FormSpec {
  let form = "";
  for (let tries = 0; tries < 200 && (!form || taken.has(form)); tries++) {
    const r = d.rand();
    const words = r < 0.1 ? [d.pick(FORM_ENDS)] : r < 0.7 ? [d.pick(FORM_WORDS), d.pick(FORM_ENDS)] : [d.pick(FORM_WORDS), d.pick(FORM_WORDS), d.pick(FORM_ENDS)];
    form = [...new Set(words)].join("_");
  }
  taken.add(form);
  const fields: FormSpec["fields"] = {};
  const n = d.int(2, 7);
  // The first field's type is the next of a cycle through all of them, so every type is used whatever the draws.
  for (let i = 0; i < n; i++) {
    const type = i === 0 ? types.shift() ?? d.pick(FIELD_TYPES) : d.pick(FIELD_TYPES);
    const free = FIELD_NAMES[type]!.filter((x) => !(x in fields));
    const name = free.length ? d.pick(free) : `${type}_${i + 1}`;
    fields[name] = { type, ...(d.maybe(i === 0 ? 0.8 : 0.4) ? { required: true } : {}), ...(type === "choice" ? { options: optionsFor(d) } : {}) };
  }
  return { form, to: d.officeId(), fields };
}

/** Two to five options: one of the stock sets, cut to length, or words of another pool. */
function optionsFor(d: Draw): string[] {
  const from = d.maybe(0.7) ? d.pick(OPTIONS) : shuffled(d.pick([STRUCTURE_TYPES, ENTITY_KINDS, GOODS, ROLES]), d.rand).slice(0, 5);
  return from.slice(0, Math.max(2, Math.min(from.length, d.int(2, 5))));
}

export interface FormOptions {
  /** Sets of forms: what one person knows of (default 20). Forms of different sets are never shown together, so a
   * split by form (data.ts `split`) can put a whole set on one side. */
  sets?: number;
  /** Ways each form is filled in (default 5). */
  perForm?: number;
  seed?: number;
  currencies?: Currency[];
}

/** The invented forms, in their sets: for a seed, always the same. */
export function formSets(o: FormOptions = {}): FormSpec[][] {
  const rand = sampler(hash(`${o.seed ?? 1}:form sets`));
  const d = new Draw(rand, o.currencies ?? CURRENCIES);
  const taken = new Set<string>();
  const types: string[] = [];
  const sets: FormSpec[][] = [];
  for (let s = 0; s < (o.sets ?? 20); s++) {
    if (types.length < 4) types.push(...shuffled(FIELD_TYPES, rand));
    const set = Array.from({ length: d.int(2, 4) }, () => inventForm(d, taken, types));
    // Now and then two offices have a form by the same name: then the request must say whose, and so must the call.
    if (d.maybe(0.15)) {
      let to = d.officeId();
      while (to === set[0]!.to) to = d.officeId();
      set.push({ ...inventForm(d, new Set(taken), types), form: set[0]!.form, to });
    }
    sets.push(set);
  }
  return sets;
}

/**
 * Filled-in forms as gold programs: for each invented form, `perForm` ways of filling it in (every required field,
 * some of the others; the office named or, where the name says enough, not), each carrying what the person knows of:
 * the form alone, or with one or two others of its set beside it. The form's specification goes with the example
 * exactly as the translator would be shown it (data.ts `formLine`).
 */
export function syntheticForms(o: FormOptions = {}): Gold[] {
  const out: Gold[] = [];
  const seen = new Set<string>();
  formSets(o).forEach((set, si) => set.forEach((spec, fi) => {
    const rand = sampler(hash(`${o.seed ?? 1}:form ${si}.${fi}`));
    const twin = set.some((x) => x !== spec && x.form === spec.form);
    for (let n = 0, tries = 0; n < (o.perForm ?? 5) && tries < 60; tries++) {
      const d = new Draw(rand, o.currencies ?? CURRENCIES);
      // (A set of forms is one world's: its amounts are all in that world's money.)
      d.currency = (o.currencies ?? CURRENCIES)[si % (o.currencies ?? CURRENCIES).length]!;
      const filled = Object.entries(spec.fields).filter(([, f]) => f.required || d.maybe(0.5));
      const fields = filled.length ? filled : Object.entries(spec.fields).slice(0, 1);
      // Shown alone, or beside one or two others of its set (always beside its namesake, if it has one).
      const others = shuffled(set.filter((x) => x !== spec && x.form !== spec.form), rand).slice(0, d.pick([0, 1, 1, 2]));
      const shown = shuffled([spec, ...set.filter((x) => x !== spec && x.form === spec.form), ...others], rand);
      const g = goldOf([call("form", { form: id(spec.form), to: twin || d.maybe(0.5) ? id(spec.to) : undefined, ...Object.fromEntries(fields.map(([k, f]) => [k, fieldValue(d, f)])) })], d, `synthetic: form ${spec.form}`, shown);
      if (!g || seen.has(g.program)) continue;
      seen.add(g.program);
      out.push(g);
      n++;
    }
  }));
  return out;
}
