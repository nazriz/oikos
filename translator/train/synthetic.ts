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
// And every one is something a sentence could sensibly ask for (data.ts `implausible`; what it drops is counted). An
// audit of a trial's 190 programs (2026-10-06) found a tenth of the rejected requests were the gold program's fault,
// and kept ones reciting nonsense. So: a form always says where it goes (`to=`, as the translator's rules write it);
// `for=` appears only where something reads it (a payment's purpose; whose name a statement, a vote, a claim or a
// signature is in); an agreement's two sides are a sensible exchange (someone pays; someone lets, delivers or lends),
// by a template that fits it; a claim's action fits what it is done to; what is published reads as the kind of thing
// it is; a letter sent about something just published is about it; a newcomer's age fits what they come as; a child's
// other parent is a person. No id is an ordinary word or holds an underscore (`timber`, `mayor`, `inspector_aid`: a
// writer turns those into words, and the check that ids are copied can't tell): every id has a digit, a dot, a
// hyphen or a slash in it, as nearly all of a real world's do.
//
// Forms are invented too: a name, the office it goes to, and two to seven fields of every type the resolver reads,
// in small sets (what one person knows of), each filled in several ways and carried with its specification as the
// translator would be shown it.
//
// No structured data but a claim's slots is written (data.ts `JSON_OUT_OF_SCOPE`): the first model copies and chooses.

import { calls, type Currency } from "@oikos/participants";
import { amountWritings, askable, FIELD_TYPES, goldText, howOften, implausible, sampler, shapeOf, shuffled, type FormField, type FormSpec, type Gold } from "./data";

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
/** First names a newcomer said to be female, or male, goes by (the rest go with either). */
const FEMALE = ["Ana", "Cleo", "Dana", "Edda", "Greta", "Ines", "Kaya", "Mina", "Odile", "Rosa", "Tova", "Ula", "Yara", "Bea", "Dalia", "Freya", "Hana", "Luz", "Maren", "Juno"];
const MALE = ["Bram", "Farid", "Hugo", "Leif", "Nico", "Pavel", "Sami", "Viktor", "Xavi", "Zeno", "Amit", "Caio", "Emre", "Goran", "Idris", "Kofi", "Naoki", "Jory"];
const LAST = ["Silva", "Reyes", "Okafor", "Lindqvist", "Marsh", "Dubois", "Tanaka", "Novak", "Haddad", "Petrov", "Greene", "Castell", "Imani", "Farrow", "Bjork", "Quist", "Abara", "Mercer", "Sandoval", "Thorne", "Underhill", "Vance", "Whitlock", "Yoon", "Zamora", "Achebe", "Brandt", "Corbin", "Delacroix", "Ekwueme", "Falk", "Guerra", "Holt", "Iyer", "Jansen", "Kovac", "Lowry", "Moreau", "Nakata", "Osei"];
/** Someone or something only described, by what they are: a person, an organisation, an office. */
const PEOPLE_DESCRIBED = ["the builder", "the clerk", "the treasurer", "the registrar", "the landlord", "the caretaker", "the head teacher", "my neighbour", "the night watchman", "the baker"];
const ORGS_DESCRIBED = ["the school", "the bank", "the union", "the supplier", "the cooperative", "the water board"];
const OFFICES_DESCRIBED = ["the works manager", "the planning officer", "the harbour master", "the finance office", "the rates officer"];
const PARTNERS = ["my partner", "my husband", "my wife"];

const ENTITY_KINDS = ["trust", "firm", "cooperative", "association", "charity", "union", "club", "partnership", "company", "school", "clinic", "society", "guild", "agency", "foundation", "committee", "fund", "bank", "household", "church", "party", "league"];
const GOODS = ["goods", "timber", "bricks", "grain", "bread", "tools", "cloth", "coal", "flour", "steel", "glass", "seedlings", "fuel", "paper", "medicine", "fish", "wool", "cement", "nails", "apples", "milk", "tiles", "rope", "salt", "books", "blankets", "seed", "wire", "paint", "gravel"];
const TASKS = ["make", "build", "repair", "clean", "teach", "treat", "harvest", "plant", "inspect", "demolish", "deliver", "patrol", "mill", "bake", "weave", "mine", "fish", "mend", "paint", "dig", "pave", "sort", "audit", "collect", "prune", "weld", "print", "log", "thresh", "quarry"];
const SURVEYED = ["trout", "heron", "frogs", "otter", "pollution", "water", "kingfisher", "reed", "moss", "salmon", "noise", "soil", "bees", "lichen", "voles"];
const STRUCTURE_TYPES = ["park", "shed", "house", "school", "clinic", "factory", "bakery", "warehouse", "road", "bridge", "library", "depot", "mill", "greenhouse", "workshop", "hall", "market", "well", "dam", "barn", "playground", "terrace", "cottage", "tower", "jetty", "stable", "kiln", "granary", "chapel", "shelter"];
const AGREEMENTS = ["lease", "employment", "supply", "service", "loan", "sale", "construction", "tenancy", "licence", "partnership", "maintenance", "carriage", "apprenticeship", "retainer", "mortgage", "hire"];
const NEWCOMERS = ["newcomer", "visitor", "worker", "settler", "trader", "student", "pensioner", "apprentice", "refugee", "labourer"];
/** The ages (in years) each comes at: a pensioner is old, an apprentice young (data.ts `implausible` holds any program to the same). */
const COMES_AGED: { [template: string]: [number, number] } = { newcomer: [18, 80], visitor: [18, 80], worker: [18, 64], settler: [18, 70], trader: [20, 70], student: [16, 30], pensioner: [62, 90], apprentice: [15, 24], refugee: [18, 75], labourer: [18, 60] };
const CHILDREN = ["child", "infant", "newborn", "baby"];
const SYSTEMS = ["assistant", "bookkeeper", "dispatcher", "monitor", "scheduler", "archivist", "cashier", "helpdesk", "auditor", "planner", "concierge", "switchboard"];
/** What is published, by what its words are like: a rule, news of a place, or a kind with words of its own (`Draw.publicWords`). */
const RULE_KINDS = ["law", "bylaw", "order", "policy", "resolution", "warning"];
const NEWS_KINDS = ["notice", "announcement", "schedule", "timetable", "advertisement"];
const OTHER_KINDS = ["report", "charter", "minutes", "budget", "invoice", "receipt", "petition", "complaint", "decision", "apology", "tender", "tariff", "roster"];
const STATEMENTS = [...RULE_KINDS, ...NEWS_KINDS, ...NEWS_KINDS, ...OTHER_KINDS];
const ROLES = ["staff", "manager", "clerk", "treasurer", "director", "officer", "secretary", "inspector", "foreman", "apprentice", "trustee", "steward", "auditor", "teacher", "nurse", "driver"];
const TITLES = ["Baker", "Head Gardener", "Treasurer", "Night Watch", "Site Foreman", "Clerk of Works", "Chief Steward", "Bookkeeper", "Owner", "Chair", "Harbour Pilot", "School Nurse", "Depot Manager", "Second Miller", "Records Keeper", "Lead Surveyor", "Warden", "Dispatcher", "Head of Stores", "Rent Collector", "Quarry Master", "Apprentice Joiner"];
const OFFICE_WORDS = ["planning", "works", "finance", "clerk", "rates", "licensing", "housing", "parks", "registry", "council", "health", "harbour", "records", "treasury", "mayor", "inspector", "roads", "markets", "schools", "water"];
/** What a claim can be about: an action, and the kinds of thing it is done to (nobody moors at a record). */
type Thing = "lot" | "cell" | "structure" | "space" | "record";
const ACTIONS: [string, Thing[]][] = [["build", ["lot", "cell"]], ["demolish", ["structure"]], ["occupy", ["space", "structure"]], ["sell", ["lot", "structure"]], ["fish", ["cell", "lot"]], ["trade", ["structure", "lot"]], ["farm", ["lot"]], ["enter", ["structure", "space", "lot"]], ["graze", ["lot", "cell"]], ["quarry", ["lot", "cell"]], ["moor", ["structure", "cell"]], ["sublet", ["space"]], ["inspect", ["structure", "space"]], ["use", ["structure", "space", "lot"]], ["cross", ["lot", "cell"]], ["log", ["lot", "cell"]], ["park", ["lot"]], ["camp", ["lot", "cell"]], ["survey", ["lot", "cell"]], ["sign", ["record"]], ["amend", ["record"]]];
const CHOICES = ["yes", "no", "abstain", "for", "against", "approve", "reject", "defer"];
/** Work done to a building, and work done to people (what `on` can be). */
const DONE_TO_BUILDINGS = ["build", "repair", "demolish", "paint", "mend", "inspect", "clean"];
const DONE_TO_PEOPLE = ["teach", "treat"];

const PURPOSES = ["rent", "the fence", "wages", "the kerb", "the drain", "repairs", "school fees", "the deposit", "materials", "the survey", "last month's deliveries", "the water bill", "membership dues", "the annual levy", "stall hire", "the roof", "back pay", "the first instalment", "a refund", "the festival", "cleaning", "the energy bill", "fuel", "the loan repayment", "pension support", "overtime", "the grant", "legal costs", "the retainer", "damages"];
const NOUNS = ["minutes", "invoice", "estimate", "roster", "survey results", "keys", "draft budget", "permit", "inspection report", "delivery schedule", "list of tenants", "accounts", "plans for the hall", "water readings", "contract", "price list"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "the end of the week", "tomorrow", "the first of the month", "noon"];
/** When something happens, with the word that goes before it ("on tomorrow" is nobody's English). */
const WHEN = ["on Monday", "on Tuesday", "on Wednesday", "on Thursday", "on Friday", "on Saturday", "at the end of the week", "tomorrow", "on the first of the month", "from noon"];
/** What a letter asks for by a day, and what it says with no day ("Thank you for the estimate by Tuesday" is nobody's letter). */
const ASKS = ["Please send me the", "Please bring the", "I still need the", "Please check the", "Kindly return the", "We must have the"];
const SAYS = ["Thank you for the", "We have not received the", "Please check the", "Let me know when you have the", "I have read the"];
/** The title of whoever founds an organisation. */
const FOUNDERS = ["Owner", "Chair", "Director", "Secretary", "Treasurer", "Founder", "Manager", "Warden", "Convenor", "Head"];
/** Kinds of organisation that are businesses (named for a trade); the rest are named for what they are. */
const BUSINESSES = ["firm", "company", "partnership", "agency"];
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
const OPTIONS = [["landlords", "tenants", "neither"], ["law", "budget", "motion"], ["low", "medium", "high"], ["residential", "commercial", "industrial", "rural"], ["new", "renewal"], ["spring", "summer", "autumn", "winter"], ["granted", "refused", "deferred"], ["cash", "transfer"], ["urgent", "routine"], ["north", "south", "east", "west", "centre"], ["owner", "tenant", "agent"], ["small", "medium", "large", "huge"], ["weekdays", "weekends", "both"], ["indoor", "outdoor"], ["temporary", "permanent"]];

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
  /** A name for a new organisation of a kind: a business by its trade, a body by what it is ("Harrow Vale School",
   * "Tarn Growers' Cooperative"): never a clinic called Supplies Brothers. */
  orgNameFor(kind: string): string {
    if (BUSINESSES.includes(kind)) return this.maybe(0.25) ? `${this.pick(LAST)}${this.pick([" & Sons", " Brothers", " & Co", "'s"])} ${this.pick(TRADES)}` : `${this.place()} ${this.pick(TRADES)}${this.pick(SUFFIXES)}`;
    const word = kind[0]!.toUpperCase() + kind.slice(1);
    const bodies = BODIES.filter((b) => b.split(" ").pop() === word);
    return bodies.length && this.maybe(0.6) ? `${this.place()} ${this.pick(bodies)}` : `${this.place()} ${this.maybe(0.3) ? `${this.pick(["Community", "Free", "Old", "New", "People's"])} ` : ""}${word}`;
  }
  personName(sex?: string): string {
    return `${this.pick(sex === "female" ? FEMALE : sex === "male" ? MALE : FIRST)} ${this.pick(LAST)}`;
  }
  /** An office, as people call it: the planning office, the clerk's office. */
  officeName(w: string): string {
    return `the ${["clerk", "mayor", "inspector"].includes(w) ? `${w}'s` : w} office`;
  }
  personId(): string {
    const s = this.maybe(0.7) ? `c${pad(this.int(1, 9999), 4)}` : this.maybe() ? `ent.${this.int(1, 4000)}` : `par.${this.int(1, 900)}`;
    this.names[s] = this.personName();
    return s;
  }
  /** (Never the bare last word of its name: `timber`, `union` and `society` are words a writer writes as words.) */
  orgId(): string {
    const name = this.orgName();
    const words = slug(name).split("-").filter((w) => !["sons", "daughters", "co", "ltd", "s", "group"].includes(w));
    const s = this.maybe(0.35) ? `ent.${this.int(1, 4000)}` : this.maybe(0.55) ? `${words[0]}-${words[words.length - 1]}` : words.map((w) => w[0]).join("") + this.int(1, 99);
    this.names[s] = name;
    return s;
  }
  /** (Never the bare word for it: `mayor`, `clerk` and `works` read as the office-holder, not as an id.) */
  officeId(): string {
    const w = this.pick(OFFICE_WORDS);
    const s = this.maybe(0.45) ? `${slug(this.pick(PLACES))}-${w}` : this.maybe(0.6) ? `pos.${this.int(1, 600)}` : `${w}-${this.int(1, 30)}`;
    this.names[s] = this.officeName(w);
    return s;
  }
  /** Someone or something acted on or for: an organisation, a person or an office by id; sometimes by name alone, or
   * only described as what they are (both written as the request put them, quoted: the resolver finds who is meant). */
  party(kinds: ("org" | "person" | "office")[] = ["org", "person", "office"]): V {
    const kind = this.pick(kinds);
    const r = this.rand();
    if (r < 0.12) return tx(kind === "person" ? this.personName() : kind === "org" ? this.orgName() : this.officeName(this.pick(OFFICE_WORDS)));
    if (r < 0.18) return tx(this.pick(kind === "person" ? PEOPLE_DESCRIBED : kind === "org" ? ORGS_DESCRIBED : OFFICES_DESCRIBED));
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
  /** What someone carries with them: pocket money, not a fortune. */
  pocket(): V {
    const per = 10 ** this.currency.minor_units;
    const whole = (this.maybe(0.5) ? this.int(2, 400) * 10 : this.int(20, 4000)) * (this.currency.minor_units === 0 ? this.pick([1, 10, 100]) : 1);
    const frac = per > 1 && this.maybe(0.2) ? this.int(1, per - 1) : 0;
    return tx(this.pick(amountWritings(BigInt(whole) * BigInt(per) + BigInt(frac), this.currency)));
  }
  /** One thing of a kind, by id. */
  thing(kind: Thing): string {
    return (kind === "lot" ? (this.lot() as { id: string }).id : kind === "cell" ? this.cellId() : kind === "structure" ? this.structureId() : kind === "space" ? this.spaceId() : (this.record() as { id: string }).id);
  }
  /** What a claim is about, as the worlds' laws read it: an action, and (nearly always) what it's done to. */
  about(): V {
    const [action, things] = this.pick(ACTIONS);
    return { json: { action, ...(things[0] === "record" || this.maybe(0.9) ? { object: this.thing(this.pick(things)) } : {}) } };
  }
  duration(): V {
    const r = this.rand();
    return tx(r < 0.75 ? `${this.pick([2, 3, 6, 7, 10, 12, 14, 18, 21, 24, 28, 30, 45, 60, 90])} ${this.pick(["days", "weeks", "months", "days", "months"])}` : r < 0.9 ? this.pick(["a week", "a fortnight", "a month", "a year", "one year", "two years", "three months", "six weeks"]) : `${this.int(2, 10)} years`);
  }
  /** How often something recurs, at intervals people use (nothing is paid "every 28 months"), one of the ways people
   * say how often (data.ts `howOften`): never the bare length, "28 days", which is how long and not how often. */
  every(): V {
    return tx(this.pick(howOften(this.pick(["1 day", "2 days", "7 days", "10 days", "14 days", "14 days", "28 days", "30 days", "30 days", "30 days", "90 days", "365 days", "3 weeks", "6 weeks", "2 months", "6 months"]))));
  }
  /** How long an agreement runs, and how much notice ends it: months and years, and days and weeks (a notice is
   * never longer than a term: data.ts `implausible` holds any program to that). */
  term(): V {
    const r = this.rand();
    return tx(r < 0.5 ? `${this.pick([3, 6, 9, 12, 18, 24, 36, 60])} months` : r < 0.75 ? this.pick(["a year", "one year", "two years", "three years", "six months", "five years"]) : `${this.int(2, 10)} years`);
  }
  notice(): V {
    return tx(this.pick(["7 days", "14 days", "21 days", "28 days", "30 days", "45 days", "60 days", "a week", "two weeks", "a fortnight", "a month", "2 months", "4 weeks", "6 weeks"]));
  }
  count(max = 400): V {
    return tx(this.maybe(0.1) ? this.pick(["one", "two", "three", "four", "five", "six", "ten", "twelve"]) : String(this.maybe(0.6) ? this.int(1, 20) : this.int(1, max)));
  }
  purpose(): V {
    const r = this.rand();
    return tx(r < 0.6 ? this.pick(PURPOSES) : r < 0.8 ? `invoice ${this.int(100, 9999)}` : `${this.pick(["this month's", "last week's", "the overdue", "last month's"])} ${this.pick(["rent", "wages", "deliveries", "repairs", "water bill", "stall hire", "cleaning", "dues"])}`);
  }
  letter(): V {
    const r = this.rand();
    return tx(r < 0.45 ? `${this.pick(ASKS)} ${this.pick(NOUNS)} by ${this.pick(DAYS)}.` : r < 0.7 ? `The ${this.pick(SITES)} ${this.pick(EVENTS)} ${this.pick(WHEN)}.` : r < 0.85 ? `Work on the ${this.pick(SITES)} starts ${this.pick(WHEN)}.` : `${this.pick(SAYS)} ${this.pick(NOUNS)}.`);
  }
  /** What something published says, as befits its kind: a law lays down a rule, a notice gives news of a place, a
   * receipt says what was received (a "receipt" whose words forbid fishing is nobody's receipt). */
  publicWords(kind: string): V {
    const site = this.pick(SITES);
    if (RULE_KINDS.includes(kind)) return tx(this.maybe(0.7) ? `${this.pick(RULES)} at the ${site}.` : `${this.pick(RULES)}.`);
    if (NEWS_KINDS.includes(kind)) return tx(this.maybe(0.75) ? `The ${site} ${this.pick(EVENTS)} ${this.pick(WHEN)} ${this.pick(REASONS)}.` : `Work on the ${site} starts ${this.pick(WHEN)}.`);
    switch (kind) {
      case "report": return tx(`The ${site} was inspected and found ${this.pick(["sound", "in need of repair", "unsafe", "in good order"])}.`);
      case "charter": return tx(this.pick(PURPOSE_LINES));
      case "minutes": return tx(`The committee met and agreed that the ${site} ${this.pick(["is to be repaired", "stays open", "is to be let", "needs a new roof"])}.`);
      case "budget": return tx(`Spending on the ${site} is held to last year's figure.`);
      case "invoice": return tx(`Payment for ${this.pick(PURPOSES)} is now due.`);
      case "receipt": return tx(`Payment for ${this.pick(PURPOSES)} has been received in full.`);
      case "petition": return tx(`We ask that the ${site} be ${this.pick(["kept open", "repaired", "lit at night", "cleaned every week"])}.`);
      case "complaint": return tx(`The ${site} has been ${this.pick(["left unlit", "closed without notice", "left in disrepair"])} since ${this.pick(["Monday", "the fair", "the storm", "the first of the month"])}.`);
      case "decision": return tx(`The application concerning the ${site} is ${this.pick(["granted", "refused", "deferred"])}.`);
      case "apology": return tx(`We are sorry that the ${site} was closed without notice.`);
      case "tender": return tx(`Bids are invited for work on the ${site}.`);
      case "tariff": return tx(`Stall hire at the ${site} is charged by the day.`);
      case "roster": return tx(`The watch at the ${site} is kept by turns, a week each.`);
      default: return tx(`The ${site} ${this.pick(EVENTS)} ${this.pick(WHEN)}.`);
    }
  }
}

type Args = { [k: string]: V | undefined };
const call = (fn: calls.Fn, args: Args): calls.Call => ({ fn, args: Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)) as { [k: string]: V } });
type Lines = (calls.Call | [string, calls.Call])[];

// ---------------------------------------------------------------- one recipe per function

const nest = (fn: calls.Fn, args: Args): V => ({ call: call(fn, args) });

/**
 * Goods moved or delivered, the one way wherever they appear (by themselves, or as what one side of an agreement
 * commits to): `to` is who receives them (nobody named: they stay the mover's own), `at` the place they are
 * delivered to, `from_at` the place they come from, now and then. The second audit (2026-10-06) found a commitment's
 * goods written "from [works-41] to [c2883]" for `at=works-41`: a commitment drew its own arguments, with no place
 * of origin to say, and the writer made one of the destination.
 */
function delivery(d: Draw, to: V | undefined, every?: V): calls.Call {
  return call("goods", { kind: d.word(GOODS), quantity: d.count(), to, at: d.structure(), from_at: d.maybe(0.4) ? d.structure() : undefined, every });
}

/**
 * What an agreement's two sides commit to, with a template that fits: an exchange people make. Someone pays, and
 * someone lets a place, delivers goods, lends, builds or keeps an account (the outcomes a commitment can be: money,
 * goods, occupancy, a building, an account). Never a random pair: "they build a bridge and we open an account, under
 * a retainer" is nothing anyone offers. What the other side does to us names us as the request would (who moves in
 * is left to its default, the one offering; goods come to our own organisation, by its id).
 */
function deal(d: Draw, other: V): { template: string; we?: V; they?: V } {
  const rent = () => call("money", { to: d.account(), amount: d.amount(), every: d.every(), for: d.maybe(0.6) ? tx("rent") : undefined });
  const price = (every?: V) => call("money", { to: d.account(), amount: d.amount(), every, for: d.maybe(0.3) ? d.purpose() : undefined });
  const r = d.rand();
  // We let them a place; they pay rent.
  if (r < 0.2) return { template: d.pick(["lease", "tenancy", "licence"]), we: nest("occupancy", { who: other, in: d.inside() }), they: { call: rent() } };
  // They let us a place; we pay rent.
  if (r < 0.34) return { template: d.pick(["lease", "tenancy", "licence"]), we: { call: rent() }, they: nest("occupancy", { in: d.inside() }) };
  // We supply them; they pay. (Goods in a commitment are goods as they are by themselves, `delivery`: who receives
  // them, the place they are delivered to and, now and then, the place they come from. A commitment names who
  // receives them: the resolver asks otherwise.)
  if (r < 0.5) {
    const every = d.maybe(0.6) ? d.every() : undefined;
    return { template: d.pick(["supply", "sale", "carriage"]), we: { call: delivery(d, other, every) }, they: { call: price(every) } };
  }
  // They supply us; we pay.
  if (r < 0.64) {
    const every = d.maybe(0.6) ? d.every() : undefined;
    return { template: d.pick(["supply", "sale", "carriage"]), we: { call: price(every) }, they: { call: delivery(d, id(d.orgId()), every) } };
  }
  // We pay them for their work (the work itself is no commitment the call language has); or they pay us.
  if (r < 0.76) return { template: d.pick(["employment", "apprenticeship", "retainer", "service", "maintenance"]), we: nest("money", { to: d.maybe(0.5) ? other : d.account(), amount: d.amount(), every: d.every(), for: d.maybe(0.6) ? tx(d.pick(["wages", "the retainer", "the service", "upkeep"])) : undefined }) };
  if (r < 0.84) return { template: d.pick(["employment", "retainer", "service", "hire"]), they: nest("money", { to: d.account(), amount: d.amount(), every: d.every(), for: d.maybe(0.6) ? tx(d.pick(["wages", "the retainer", "the service", "hire"])) : undefined }) };
  // We lend; they repay.
  if (r < 0.93) return { template: d.pick(["loan", "mortgage"]), we: nest("money", { to: d.maybe(0.5) ? other : d.account(), amount: d.amount() }), they: nest("money", { to: d.account(), amount: d.amount(), every: d.every(), for: d.maybe(0.6) ? tx("the loan repayment") : undefined }) };
  // We build for them; they pay. (Having them build for us is `structure(...)` by itself, by the translator's rules.)
  if (r < 0.97) return { template: "construction", we: nest("structure", { type: d.word(STRUCTURE_TYPES), on: d.ground() }), they: { call: price() } };
  // We keep an account for them; they pay for it.
  return { template: "service", we: nest("account", { holder: other }), they: nest("money", { to: d.account(), amount: d.amount(), every: d.every(), for: d.maybe(0.5) ? tx("account fees") : undefined }) };
}

/** A post, by id. */
const post = (d: Draw): V => id(d.maybe(0.6) ? `${slug(d.pick(TRADES))}-${slug(d.pick(TITLES))}` : d.officeId());

const RECIPES: { [fn in Exclude<calls.Fn, "form">]: (d: Draw) => Lines } = {
  money: (d) => {
    const every = d.maybe(0.3);
    return [call("money", { to: d.maybe(0.6) ? d.account() : d.party(), amount: d.amount(), from: d.maybe(0.6) ? d.account() : undefined, every: every ? d.every() : undefined, first: every && d.maybe(0.25) ? d.duration() : undefined, for: d.maybe(0.55) ? d.purpose() : undefined, basis: d.maybe(0.15) ? d.record() : undefined, settles: d.maybe(0.12) ? d.rec() : undefined })];
  },
  // (No `for`: only a payment has a purpose, and nothing reads whose name goods move or work is done in.)
  goods: (d) => [delivery(d, d.maybe(0.6) ? d.party(["org", "person"]) : undefined)],
  work: (d) => {
    const by = () => (d.maybe(0.7) ? d.person() : list(Array.from({ length: d.int(2, 4) }, () => d.personId())));
    const r = d.rand();
    if (r < 0.12) return [call("work", { task: id("survey"), at: d.maybe(0.5) ? d.lot() : d.structure(), survey: d.word(SURVEYED), cells: list(Array.from({ length: d.int(1, 4) }, () => d.cellId())), by: d.maybe(0.7) ? by() : undefined, units: d.maybe(0.3) ? d.count(8) : undefined })];
    if (r < 0.22) return [call("work", { task: id("investigate"), units: d.count(12), at: d.structure(), by: d.maybe(0.8) ? by() : undefined, investigate: d.party(["org", "person"]), taken_at: d.structure(), kind: d.word(GOODS) })];
    // What it's done to, where the work is done to something: a building, or (teaching, treating) a person or a room of people.
    const task = d.pick(TASKS);
    const on = !d.maybe(0.5) ? undefined : DONE_TO_BUILDINGS.includes(task) ? d.structure() : DONE_TO_PEOPLE.includes(task) ? (d.maybe() ? d.person() : id(d.spaceId())) : undefined;
    return [call("work", { task: id(task), units: d.count(60), at: d.maybe(0.8) ? d.structure() : d.ground(), by: d.maybe(0.8) ? by() : undefined, on })];
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
  entity: (d) => {
    const kind = d.pick(ENTITY_KINDS);
    return [call("entity", { kind: id(kind), name: tx(d.orgNameFor(kind)), position: d.maybe(0.4) ? tx(d.pick(FOUNDERS)) : undefined, visible: d.maybe(0.12) ? id("public") : undefined })];
  },
  claim: (d) => {
    const r = d.rand();
    if (r < 0.15) return [call("claim", { release: d.rec(), basis: d.maybe(0.2) ? d.record() : undefined })];
    if (r < 0.32) return [call("claim", { transfer: d.rec(), to: d.party(["org", "person"]), basis: d.maybe(0.2) ? d.record() : undefined })];
    // Whose name it's recorded in (`for`), now and then, and then with little else: a sentence holds only so much.
    const named = d.maybe(0.07);
    return [call("claim", { position: d.word(["right", "liberty", "power", "immunity", "liberty", "right"]), holder: named || d.maybe(0.85) ? d.party(["org", "person"]) : undefined, about: d.about(), against: !named && d.maybe(0.3) ? d.party(["org", "person"]) : undefined, basis: !named && d.maybe(0.3) ? d.record() : undefined, visible: d.maybe(0.1) ? id("public") : undefined, for: named ? id(d.orgId()) : undefined })];
  },
  agreement: (d) => {
    const r = d.rand();
    if (r < 0.14) return [call("agreement", { sign: d.rec(), for: d.maybe(0.15) ? id(d.orgId()) : undefined })];
    if (r < 0.28) return [call("agreement", { notice: d.rec(), text: d.maybe(0.3) ? tx(d.pick(["We are moving out.", "The work is finished.", "We no longer need the service.", "The rent is more than we can pay.", "The post has been filled."])) : undefined })];
    const other = d.party(["org", "person"]);
    // Terms only, now and then (a partnership, a hire: what each side does is in its words); otherwise a deal, of
    // which one side alone is sometimes all that's said.
    const bare = d.maybe(0.1);
    const { template, we, they } = bare ? { template: d.pick(["partnership", "hire", "maintenance", "service"]), we: undefined, they: undefined } : deal(d, other);
    const side = we && they && d.maybe(0.15) ? d.pick(["we", "they"]) : undefined;
    const term = d.maybe(0.6);
    return [call("agreement", {
      with: other, template: d.maybe(0.75) ? id(template) : undefined, term: term ? d.term() : undefined, then: term && d.maybe(0.2) ? id("periodic") : undefined,
      our_notice: d.maybe(0.3) ? d.notice() : undefined, their_notice: d.maybe(0.3) ? d.notice() : undefined,
      we_do: side === "they" ? undefined : we, they_do: side === "we" ? undefined : they,
      terms: bare || d.maybe(0.15) ? tx(d.pick(TERMS)) : undefined, basis: d.maybe(0.1) ? d.record() : undefined, visible: d.maybe(0.06) ? id("public") : undefined,
    })];
  },
  statement: (d) => {
    if (d.maybe(0.15)) return [call("statement", { withdraw: d.rec(), text: d.maybe(0.3) ? tx(d.pick(["It was issued in error.", "It has been replaced.", "The matter is settled.", "The figures were wrong."])) : undefined })];
    const to = d.rand();
    const kind = d.pick(STATEMENTS);
    return [call("statement", { kind: id(kind), text: d.publicWords(kind), to: to < 0.2 ? d.party() : to < 0.3 ? list([d.orgId(), d.personId()]) : undefined, visible: d.maybe(0.3) ? id("public") : undefined, basis: d.maybe(0.2) ? d.record() : undefined, for: d.maybe(0.12) ? id(d.orgId()) : undefined, on: d.maybe(0.12) ? d.lot() : undefined })];
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
    // A newcomer of an age that fits what they come as, with what they'd carry in their pockets.
    const template = d.pick(NEWCOMERS);
    const sex = d.maybe(0.35) ? d.pick(["female", "male"]) : undefined;
    return [call("presence", { name: tx(d.personName(sex)), age: tx(`${d.int(...COMES_AGED[template]!)} years`), template: id(template), sex: sex ? id(sex) : undefined, carrying: d.maybe(0.6) ? d.pocket() : undefined })];
  },
  // What the contract requires of a birth (a name, and the template: the request's own word for the child, "a baby",
  // "a child", which a writer says as people do, "we're having a baby", and never "recorded as an infant": the second
  // audit, 2026-10-06, found that in 12 of 13), and the other parent if there is one: a person, by id, by name, or as
  // the speaker would call them. Nothing else.
  birth: (d) => [call("birth", { name: tx(d.maybe(0.5) ? d.personName() : d.pick(FIRST)), template: d.word(CHILDREN), with: !d.maybe(0.6) ? undefined : d.maybe(0.7) ? id(d.personId()) : tx(d.maybe() ? d.personName() : d.pick(PARTNERS)) })],
  take: (d) => [call("take", { kind: d.word(GOODS), quantity: d.count(80), from: d.party(["org", "person"]), at: d.structure() })],
  harm: (d) => [call("harm", { who: d.person() })],
  position: (d) => {
    const r = d.rand();
    if (r < 0.2) return [call("position", { vacate: post(d) })];
    if (r < 0.5) return [call("position", { appoint: post(d), to: d.maybe(0.8) ? d.person() : id(`par.${d.int(1, 900)}`) })];
    return [call("position", { title: tx(d.maybe(0.7) ? d.pick(TITLES) : `${d.pick(["Deputy", "Senior", "Assistant", "Acting", "Night"])} ${d.pick(TITLES)}`), role: d.maybe(0.65) ? d.word(ROLES) : undefined })];
  },
  system: (d) => {
    if (d.maybe(0.3)) return [call("system", { retire: id(d.maybe(0.5) ? `par.${d.int(1, 900)}` : `${d.pick(SYSTEMS)}-${d.int(1, 40)}`) })];
    return [call("system", { template: d.word(SYSTEMS), title: d.maybe(0.5) ? tx(`${d.pick(["Front Desk", "Night", "Payroll", "Depot", "Records", "Rates", "Permit", "Stores"])} ${d.pick(["Assistant", "Monitor", "Clerk", "Dispatcher", "Helper"])}`) : undefined })];
  },
};

/** A new organisation, named as its kind is. */
const founded = (d: Draw, titled: boolean): calls.Call => {
  const kind = d.pick(ENTITY_KINDS);
  return call("entity", { kind: id(kind), name: tx(d.orgNameFor(kind)), position: titled ? tx(d.pick(FOUNDERS)) : undefined });
};

/** What a letter says that goes out with something just published: about that thing, by its kind. */
const COVERING = ["Please read the KIND I have just published.", "The KIND published today concerns you.", "Please put the new KIND up where everyone can see it.", "Here is the KIND we spoke about.", "Please act on the KIND published today."];

/** Programs of several lines, each later line using what an earlier one made: listed under the first line's function. */
const DEPENDENT: { [fn: string]: ((d: Draw) => Lines)[] } = {
  entity: [
    (d) => [["v1", founded(d, d.maybe(0.3))], call("statement", { kind: id("charter"), for: { var: "v1" }, text: tx(d.pick(PURPOSE_LINES)), visible: d.maybe(0.3) ? id("public") : undefined })],
    (d) => [["v1", founded(d, false)], call("account", { holder: { var: "v1" }, at: d.maybe(0.7) ? d.party(["org"]) : undefined })],
    (d) => [["v1", founded(d, false)], call("claim", { position: d.word(["right", "liberty", "power"]), holder: { var: "v1" }, about: d.about() })],
  ],
  account: [(d) => [["v1", call("account", { holder: d.party(["org", "person"]), at: d.maybe(0.6) ? d.party(["org"]) : undefined })], call("money", { to: { var: "v1" }, amount: d.amount(), from: d.maybe(0.6) ? d.account() : undefined, for: d.maybe(0.4) ? d.purpose() : undefined })]],
  position: [(d) => [["v1", call("position", { title: tx(d.pick(TITLES)), role: d.maybe(0.6) ? d.word(ROLES) : undefined })], call("position", { appoint: { var: "v1" }, to: d.person() })]],
  // Something published, and a letter to someone about it: the letter is about what was published, not about anything else.
  statement: [(d) => {
    const kind = d.pick(STATEMENTS);
    return [["v1", call("statement", { kind: id(kind), text: d.publicWords(kind), visible: d.maybe(0.4) ? id("public") : undefined })], call("message", { to: d.party(), text: tx(d.pick(COVERING).replace("KIND", kind)), re: { var: "v1" } })];
  }],
  presence: [(d) => {
    const template = d.pick(NEWCOMERS);
    return [["v1", call("presence", { name: tx(d.personName()), age: tx(`${d.int(...COMES_AGED[template]!)} years`), template: id(template) })], call("occupancy", { who: { var: "v1" }, in: d.inside() })];
  }],
  system: [(d) => [["v1", call("system", { template: d.word(SYSTEMS) })], call("position", { appoint: id(d.officeId()), to: { var: "v1" } })]],
};

/** A program worth keeping, as gold: it parses back, passes the contract, is askable and is a plausible thing to ask
 * for (`dropped` counts, by reason, the ones that aren't plausible); otherwise undefined. */
function goldOf(lines: Lines, d: Draw, source: string, forms?: FormSpec[], dropped?: { [reason: string]: number }): Gold | undefined {
  let p: calls.Program;
  try {
    p = calls.parseProgram(calls.programText(calls.programOf(...lines)));
  } catch {
    return undefined;
  }
  if (calls.contractErrors(p).length || !askable(p)) return undefined;
  const why = implausible(p, { invented: true, ...(forms ? { forms } : {}) });
  if (why) {
    if (dropped) dropped[why] = (dropped[why] ?? 0) + 1;
    return undefined;
  }
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
  /** Counts, by reason, the programs drawn and dropped as no plausible thing to ask for (data.ts `implausible`). */
  dropped?: { [reason: string]: number };
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
      out.push(...syntheticForms({ sets: Math.ceil(per / 10), perForm: 5, seed: o.seed ?? 1, ...(o.currencies ? { currencies: o.currencies } : {}), ...(o.dropped ? { dropped: o.dropped } : {}) }).slice(0, per));
      continue;
    }
    const rand = sampler(hash(`${o.seed ?? 1}:${fn}`));
    const seen = new Set<string>();
    const dependent = DEPENDENT[fn] ?? [];
    for (let tries = 0; seen.size < per && tries < per * 40; tries++) {
      const d = new Draw(rand, o.currencies ?? CURRENCIES);
      const lines = dependent.length && rand() < (o.dependent ?? 0.12) ? d.pick(dependent)(d) : RECIPES[fn](d);
      const g = goldOf(lines, d, `synthetic: ${fn}`, undefined, o.dropped);
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
  dropped?: { [reason: string]: number };
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
 * some of the others; always with the office it goes to, `to=`: the translator's rules write where the list says it
 * goes, so a gold program without it is one the rules would write differently), each carrying what the person knows
 * of: the form alone, or with one or two others of its set beside it. The form's specification goes with the example
 * exactly as the translator would be shown it (data.ts `formLine`).
 */
export function syntheticForms(o: FormOptions = {}): Gold[] {
  const out: Gold[] = [];
  const seen = new Set<string>();
  formSets(o).forEach((set, si) => set.forEach((spec, fi) => {
    const rand = sampler(hash(`${o.seed ?? 1}:form ${si}.${fi}`));
    for (let n = 0, tries = 0; n < (o.perForm ?? 5) && tries < 60; tries++) {
      const d = new Draw(rand, o.currencies ?? CURRENCIES);
      // (A set of forms is one world's: its amounts are all in that world's money.)
      d.currency = (o.currencies ?? CURRENCIES)[si % (o.currencies ?? CURRENCIES).length]!;
      const filled = Object.entries(spec.fields).filter(([, f]) => f.required || d.maybe(0.5));
      const fields = filled.length ? filled : Object.entries(spec.fields).slice(0, 1);
      // Shown alone, or beside one or two others of its set (always beside its namesake, if it has one).
      const others = shuffled(set.filter((x) => x !== spec && x.form !== spec.form), rand).slice(0, d.pick([0, 1, 1, 2]));
      const shown = shuffled([spec, ...set.filter((x) => x !== spec && x.form === spec.form), ...others], rand);
      const g = goldOf([call("form", { form: id(spec.form), to: id(spec.to), ...Object.fromEntries(fields.map(([k, f]) => [k, fieldValue(d, f)])) })], d, `synthetic: form ${spec.form}`, shown, o.dropped);
      if (!g || seen.has(g.program)) continue;
      seen.add(g.program);
      out.push(g);
      n++;
    }
  }));
  return out;
}

// ---------------------------------------------------------------- forms of several amounts

/** What a line of spending can be for: a form's amount fields are named for some of these. Ordinary words, no place's. */
const SPENT_ON = ["wages", "upkeep", "lighting", "drainage", "tools", "fuel", "training", "repairs", "cleaning", "printing", "insurance", "hire", "seed", "feed", "fencing", "paving", "signage", "catering", "prizes", "storage", "transport", "surveys", "reserve", "grants", "materials", "security", "heating", "planting", "stationery", "licences", "equipment", "outreach"];
const LINE_ENDS = ["", "", "_line", "_budget", "_cost", "_allowance"];
const LONG_TEXTS = ["proposal", "proposal_text", "full_proposal", "details", "summary", "statement", "justification", "explanation", "case", "terms"];
const SPANS_OF_TIME = ["the coming year", "the next quarter", "the season ahead", "the next six months", "the year to come", "the winter"];
const BESIDES = ["It replaces the figures agreed before.", "Nothing in it changes what has already been agreed.", "It was drawn up after the last meeting.", "Every line was costed from last season's bills.", "It is put forward for a decision at the next meeting.", "No line may be spent on anything but what it is named for."];

/** A form with three to seven amounts, one or two choices and one long text: a budget, an estimate, a claim for costs. */
function inventAmountForm(d: Draw, taken: Set<string>): FormSpec {
  let form = "";
  for (let tries = 0; tries < 200 && (!form || taken.has(form)); tries++) form = [...new Set([d.pick([...FORM_WORDS, "spending", "estimates", "allocation", "costs", "funding"]), d.pick(["proposal", "request", "return", "claim", "submission", "application", "estimate", "plan"])])].join("_");
  taken.add(form);
  const end = d.pick(LINE_ENDS);
  const lines = shuffled(SPENT_ON, d.rand).slice(0, d.int(3, 7)).map((w): [string, FormField] => [`${w}${end}`, { type: "amount", ...(d.maybe(0.6) ? { required: true } : {}) }]);
  const choices = shuffled(FIELD_NAMES.choice!, d.rand).slice(0, d.int(1, 2)).map((k): [string, FormField] => [k, { type: "choice", required: true, options: optionsFor(d) }]);
  const text: [string, FormField] = [d.pick(LONG_TEXTS), { type: "text", ...(d.maybe(0.7) ? { required: true } : {}) }];
  // (As forms list them: what kind it is first or last, the amounts together, the long text at one end.)
  const body = d.maybe(0.5) ? [...choices, ...lines] : [...lines, ...choices];
  return { form, to: d.officeId(), fields: Object.fromEntries(d.maybe(0.7) ? [...body, text] : [text, ...body]) };
}

/**
 * Forms of several amounts filled in, as gold programs (`tag: "amount_form"`): for each invented form (in sets of two,
 * a set one world's, shown alone or beside its fellow), `perForm` ways of filling it in. The amounts are
 * all written the one way a world writes money; in a third two or three fields have the same amount, and now and then
 * one is nothing. Sometimes only some of the amounts are filled (always two or
 * more). The long text is two to five sentences; about half the time it says some of the form's amounts again in
 * prose, or what they come to, or a figure that is no field's (last time's): the field's amount is the one a request
 * says against its label, and the text is copied whole. For a seed, always the same.
 * These are longer than what a sentence or two asks (a text of up to some 400 characters, up to a dozen values), which
 * is what a seat's form request is: they are not held to `askable`, only to the contract and to `implausible`.
 */
export function amountForms(o: { forms?: number; perForm?: number; seed?: number; currencies?: Currency[]; dropped?: { [reason: string]: number } } = {}): Gold[] {
  const out: Gold[] = [];
  const seen = new Set<string>();
  const taken = new Set<string>();
  const currencies = o.currencies ?? CURRENCIES;
  const words = (k: string) => k.replace(/_/g, " ");
  for (let si = 0; si * 2 < (o.forms ?? 20); si++) {
    const rand = sampler(hash(`${o.seed ?? 1}:amount forms ${si}`));
    const d = new Draw(rand, currencies);
    d.currency = currencies[si % currencies.length]!;
    const per = 10 ** d.currency.minor_units;
    const write = (n: number) => amountWritings(BigInt(n), d.currency)[0]!;
    const set = [inventAmountForm(d, taken), inventAmountForm(d, taken)].slice(0, (o.forms ?? 20) - si * 2);
    for (const spec of set) for (let n = 0, tries = 0; n < (o.perForm ?? 4) && tries < 40; tries++) {
      const all = Object.keys(spec.fields).filter((k) => spec.fields[k]!.type === "amount");
      const some = d.maybe(0.45) ? all.filter((k) => spec.fields[k]!.required || d.maybe(0.5)) : all;
      const lines = some.length >= 2 ? some : all.slice(0, 2);
      // Amounts: round or to the smallest unit, each a different one to begin with. Then, in a third of the forms
      // filled in, two or three of the lines are given the same amount (real requests often have two lines alike: a
      // model that never saw it gives one field's amount to another), and now and then a line is nothing at all.
      const sums = new Map<string, number>();
      for (const k of lines) for (let t = 0; t < 20 && !sums.has(k); t++) {
        const whole = d.int(1, 999) * d.pick([10, 100, 100, 1000]);
        const x = whole * per + (per > 1 && d.maybe(0.3) ? d.int(1, per - 1) : 0);
        if (![...sums.values()].includes(x)) sums.set(k, x);
      }
      if (sums.size !== lines.length) continue;
      if (d.maybe(1 / 3)) {
        const alike = shuffled(lines, rand).slice(0, lines.length >= 3 && d.maybe(0.3) ? 3 : 2);
        for (const k of alike) sums.set(k, sums.get(alike[0]!)!);
      }
      if (d.maybe(0.12)) sums.set(d.pick(lines), 0);
      const total = [...sums.values()].reduce((a, b) => a + b, 0);
      const said = shuffled(lines, rand).slice(0, d.int(1, Math.min(3, lines.length)));
      const sentences = [`This ${words(spec.form)} covers ${d.pick(SPANS_OF_TIME)}.`, d.pick(BESIDES)];
      if (d.maybe(0.5)) {
        for (const k of said) sentences.push(d.pick([`It sets ${words(k)} at ${write(sums.get(k)!)}.`, `It allows ${write(sums.get(k)!)} for ${words(k)}.`, `Of the whole, ${write(sums.get(k)!)} goes to ${words(k)}.`]));
        if (d.maybe(0.5) && total > 0 && ![...sums.values()].includes(total)) sentences.push(`The lines come to ${write(total)} in all.`);
        if (d.maybe(0.25)) { const before = (d.int(1, 999) * 100 + 7) * per; if (![...sums.values(), total].includes(before)) sentences.push(`Last time the whole came to ${write(before)}.`); }
      }
      const withText = Object.keys(spec.fields).filter((k) => spec.fields[k]!.type === "text" && (spec.fields[k]!.required || d.maybe(0.8)));
      const args: Args = { form: id(spec.form), to: id(spec.to) };
      for (const [k, f] of Object.entries(spec.fields)) {
        if (f.type === "amount" && sums.has(k)) args[k] = tx(write(sums.get(k)!));
        else if (f.type === "choice") args[k] = id(d.pick(f.options!));
        else if (f.type === "text" && withText.includes(k)) args[k] = tx(sentences.join(" "));
      }
      let p: calls.Program;
      try {
        p = calls.parseProgram(calls.programText(calls.programOf(call("form", args))));
      } catch {
        continue;
      }
      if (calls.contractErrors(p).length) continue;
      const shown = d.maybe(0.5) ? [spec] : shuffled(set, rand);
      const why = implausible(p, { invented: true, forms: shown });
      if (why) {
        if (o.dropped) o.dropped[why] = (o.dropped[why] ?? 0) + 1;
        continue;
      }
      const program = goldText(p);
      if (seen.has(program)) continue;
      seen.add(program);
      out.push({ program, shape: shapeOf(calls.parseProgram(program)), names: Object.fromEntries(Object.entries(d.names).filter(([k]) => k === spec.to)), source: `synthetic: amount form ${spec.form}`, origin: "synthetic", currency: d.currency, forms: shown, tag: "amount_form" });
      n++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- several separate acts about the same thing

/** Separate acts about one person, and about one organisation: each a different function, none depending on another,
 * none a letter or something published (that, with an act about the same thing, is one request by the rules). */
const ABOUT_A_PERSON: ((d: Draw, who: string) => calls.Call)[] = [
  (d, who) => call("money", { to: id(who), amount: d.amount(), from: d.maybe(0.6) ? d.account() : undefined, for: d.purpose() }),
  (d, who) => call("occupancy", { who: id(who), in: d.inside() }),
  (d, who) => call("position", { appoint: post(d), to: id(who) }),
  (d, who) => call("work", { task: d.word(TASKS), units: d.count(40), at: d.structure(), by: id(who) }),
  (d, who) => delivery(d, id(who)),
  (d, who) => call("account", { holder: id(who), at: d.maybe(0.6) ? id(d.orgId()) : undefined }),
  (d, who) => call("claim", { position: d.word(["right", "liberty"]), holder: id(who), about: d.about() }),
];
const ABOUT_AN_ORG: ((d: Draw, who: string) => calls.Call)[] = [
  (d, who) => call("money", { to: id(who), amount: d.amount(), from: d.maybe(0.6) ? d.account() : undefined, for: d.purpose() }),
  (d, who) => delivery(d, id(who)),
  (d, who) => call("account", { holder: id(who) }),
  (d, who) => (d.maybe(0.3) ? call("structure", { remove: d.structure(), by: id(who), price: d.amount() }) : call("structure", { type: d.word(STRUCTURE_TYPES), on: d.ground(), by: id(who), price: d.amount(), from: d.maybe(0.6) ? d.account() : undefined })),
  (d, who) => call("claim", { position: d.word(["right", "liberty"]), holder: id(who), about: d.about() }),
  (d, who) => call("take", { kind: d.word(GOODS), quantity: d.count(40), from: id(who), at: d.structure() }),
];

/**
 * Groups of two or three separate acts about the same person or organisation, each a gold program of its own: what a
 * person piles into one message ("pay c0412 her wages, and while you're at it move her into apts-3/dwelling.2"). A
 * writer asks for a group in one request and the translator is to refuse it as `too_much` (data.ts `piledBriefs`):
 * the refusal as people make it, where the built kind pastes unrelated requests together. For a seed, always the same.
 */
export function piled(o: { groups?: number; seed?: number; currencies?: Currency[] } = {}): Gold[][] {
  const rand = sampler(hash(`${o.seed ?? 1}:piled`));
  const want = o.groups ?? 20;
  const out: Gold[][] = [];
  for (let tries = 0; out.length < want && tries < want * 20; tries++) {
    const d = new Draw(rand, o.currencies ?? CURRENCIES);
    const person = d.maybe(0.6);
    const who = person ? d.personId() : d.orgId();
    const acts = shuffled(person ? ABOUT_A_PERSON : ABOUT_AN_ORG, rand).slice(0, d.maybe(0.3) ? 3 : 2);
    const gold = acts.map((act) => goldOf([act(d, who)], d, "synthetic: piled")).filter((g): g is Gold => !!g);
    if (gold.length === acts.length) out.push(gold);
  }
  return out;
}
