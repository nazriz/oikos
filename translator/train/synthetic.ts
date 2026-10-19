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

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { calls, groupDigits, type Currency } from "@oikos/participants";
// (The papers offices issue, as their modules declare them: read for their names, fields and types only.)
import * as PAPERS from "../../participants/src/shared/papers";
import { amountWritings, FIELD_TYPES, goldText, howOften, implausible, literals, sampler, shapeOf, shuffled, whyNot, type FormField, type FormSpec, type Gold, type WrittenCurrency } from "./data";

/**
 * How invented worlds write their money: a sign before the amount or only a code; two decimal places, none, or three;
 * words for the unit and its smallest part, or none; and, in the last few, a way of writing numbers that is not the
 * first worlds' (the config's own fields for it, data.ts `WrittenCurrency`): a decimal comma with points between the thousands, the sign after the digits or
 * spaced from them, digits grouped in twos with the words for those groups, a sign of letters, a sign other
 * currencies share written with letters of the code. None is any place's: the model is to learn that an amount is
 * whatever span is written as one. (`$` is among them because a real world's may be; nothing depends on it.)
 */
export const CURRENCIES: WrittenCurrency[] = [
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
  { code: "GLD", minor_units: 2, symbol: "₲", unit_words: ["gulden", "guldens"], minor_words: ["stiver", "stivers"], decimal_mark: ",", symbol_after: true },
  { code: "NVO", minor_units: 2, symbol: "N$", unit_words: ["novo", "novos"], minor_words: ["centimo", "centimos"], decimal_mark: ",", symbol_spaced: true },
  { code: "RPA", minor_units: 2, symbol: "₨", unit_words: ["rupa", "rupas"], minor_words: ["pai", "pais"], grouping: [3, 2], symbol_spaced: true, number_words: { lakh: 100_000, lakhs: 100_000, crore: 10_000_000, crores: 10_000_000 } },
  { code: "TSH", minor_units: 2, symbol: "TSh", unit_words: ["shilling", "shillings", "bob"], minor_words: ["cent", "cents"], symbol_spaced: true },
  { code: "PSO", minor_units: 2, symbol: "$", unit_words: ["peso", "pesos"], minor_words: ["centavo", "centavos"], country_sign: true },
  { code: "ZEN", minor_units: 0, symbol: "圓", unit_words: ["zen"], symbol_after: true },
];

/**
 * The money of the worlds there are: each profile's currency (worlds/profiles/), as its profile gives it, with the
 * way its place writes numbers where the profile says it (the config's own fields); where it does not, these are
 * written the ways every world's money is. In the order of the profiles' file names; one that is an invented world's exactly is not said twice.
 */
export function worldsCurrencies(dir = join(import.meta.dir, "../../worlds/profiles")): Currency[] {
  const out: Currency[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const cur = JSON.parse(readFileSync(join(dir, f), "utf8")).values?.currency as Currency | undefined;
    if (cur && typeof cur.code === "string" && Number.isInteger(cur.minor_units) && ![...CURRENCIES, ...out].some((x) => JSON.stringify(x) === JSON.stringify(cur))) out.push(cur);
  }
  return out;
}

/** The money generated programs are in, unless told otherwise: the invented worlds', then the worlds' there are
 * (read once). So what is generated for a seed changes when a profile is added: a set's manifest counts its examples
 * by currency (`by_currency`). */
let every: WrittenCurrency[] | undefined;
export const everyCurrency = (): WrittenCurrency[] => (every ??= [...CURRENCIES, ...worldsCurrencies()]);

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
  list: ["members", "children", "witnesses", "parcels", "signatories", "copies_to", "attached", "also_tell", "sites", "parties"],
  date: ["date", "from_day", "due", "starts", "ends", "born_at", "closes", "hearing", "effective", "inspected_on"],
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
export class Draw {
  names: { [id: string]: string } = {};
  /** What kind of program a recipe made, where it is one a part can be asked for by name (`Gold.tag`), and what
   * else its writer is to be told (`Gold.notes`). */
  tag?: string;
  notes: string[] = [];
  /** A wide part's draws (0.13.1; `SyntheticOptions.wide`): now and then a large count written with the place's
   * digit grouping ("1,200"), and a start or an end given as a day ("year 1, day 22") where it may be a length of time. */
  wide = false;
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
  officeId(w: string = this.pick(OFFICE_WORDS)): string {
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
  /** A day, as reports write one: of a year, or (the first year's) by itself. */
  date(): V {
    return tx(this.maybe(0.7) ? `year ${this.int(1, 12)}, day ${this.int(1, 365)}` : `day ${this.int(1, 365)}`);
  }
  /** Several things of one kind, by id: one to four, each once (one alone is written bare: data.ts `goldText`). */
  several(kind: "person" | "org" | "record" | "lot" | "structure" = this.pick(["person", "person", "org", "record", "lot", "structure"])): V {
    const one = () => (kind === "person" ? this.personId() : kind === "org" ? this.orgId() : kind === "record" ? `rec.${this.int(1, 40000)}` : kind === "lot" ? (this.lot() as { id: string }).id : this.structureId());
    return list([...new Set(Array.from({ length: this.pick([1, 2, 2, 3, 3, 4]) }, one))]);
  }
  count(max = 400): V {
    if (this.wide && max >= 60 && this.maybe(0.15)) return tx(groupDigits(String(this.int(1, 60) * this.pick([1000, 1000, 500, 250]) + this.pick([0, 0, 0, 40, 125])), this.currency));
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
  /** What an entry in one's own books says: something noted for the file, most with a sum in the world's money. */
  entryWords(): V {
    const sum = (this.amount() as { text: string }).text;
    return tx(this.pick([
      `${sum} withheld from this fortnight's wages, to be passed on at the month's end`, `${sum} charged to the ${this.pick(SPENT_ON)} line`, `Deposit of ${sum} held for the tenant of the ${this.pick(SITES)}`,
      `${sum} set aside for ${this.pick(PURPOSES)}`, `Invoice ${this.int(100, 9999)} checked against the delivery notes and found in order`, `${sum} owed to us for ${this.pick(PURPOSES)}, not yet received`,
      `The keys to the ${this.pick(SITES)} were returned ${this.pick(WHEN)}`, `Payment of ${sum} for ${this.pick(PURPOSES)} counted against this year's budget`, `Stock at the ${this.pick(SITES)} counted ${this.pick(WHEN)}: nothing missing`,
      `${sum} received in cash at the counter, to be banked ${this.pick(WHEN)}`,
    ]));
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
    return [call("money", { to: d.maybe(0.6) ? d.account() : d.party(), amount: d.amount(), from: d.maybe(0.6) ? d.account() : undefined, every: every ? d.every() : undefined, first: every && d.maybe(0.25) ? (d.wide && d.maybe(0.5) ? d.date() : d.duration()) : undefined, for: d.maybe(0.55) ? d.purpose() : undefined, basis: d.maybe(0.15) ? d.record() : undefined, settles: d.maybe(0.12) ? d.rec() : undefined })];
  },
  // (No `for`: only a payment has a purpose, and nothing reads whose name goods move or work is done in.)
  goods: (d) => [delivery(d, d.maybe(0.6) ? d.party(["org", "person"]) : undefined)],
  work: (d) => {
    const by = () => (d.maybe(0.7) ? d.person() : list(Array.from({ length: d.int(2, 4) }, () => d.personId())));
    const r = d.rand();
    if (r < 0.12) return [call("work", { task: id("survey"), at: d.maybe(0.5) ? d.lot() : d.structure(), survey: d.word(SURVEYED), cells: list(Array.from({ length: d.int(1, 4) }, () => d.cellId())), by: d.maybe(0.7) ? by() : undefined, units: d.maybe(0.3) ? d.count(8) : undefined })];
    if (r < 0.22) return [call("work", { task: id("investigate"), units: d.count(12), at: d.structure(), by: d.maybe(0.8) ? by() : undefined, investigate: d.party(["org", "person"]), taken_at: d.structure(), kind: d.word(GOODS) })];
    // A standing order: the work as a routine for one's own staff (what, where, how often), and now and then what it
    // is done to (one thing or several), who does it, how much each time, how long until the first and for how long.
    if (r < 0.5) {
      const task = d.pick(TASKS);
      const on = !d.maybe(0.4) ? undefined : DONE_TO_PEOPLE.includes(task) ? id(d.spaceId()) : d.maybe(0.5) ? d.structure() : d.several(d.pick(["structure", "structure", "lot"]));
      d.tag = "standing_work";
      return [call("work", {
        task: id(task), at: d.maybe(0.85) ? d.structure() : d.ground(), every: tx(d.pick(howOften(d.pick(["1 day", "1 day", "2 days", "7 days", "7 days", "7 days", "14 days", "14 days", "28 days", "30 days", "3 weeks", "90 days"])))),
        on, by: !d.maybe(0.45) ? undefined : d.maybe(0.6) ? id(d.personId()) : d.several("person"), units: d.maybe(0.3) ? d.count(12) : undefined,
        first: d.maybe(0.2) ? (d.wide && d.maybe(0.5) ? d.date() : tx(d.pick(["1 day", "2 days", "3 days", "7 days", "a week", "10 days", "14 days", "a fortnight", "a month"]))) : undefined,
        until: d.maybe(0.3) ? d.wide && d.maybe(0.35) ? d.date() : tx(d.maybe(0.6) ? `${d.int(2, 12)} weeks` : d.pick(["30 days", "60 days", "90 days", "3 months", "6 months", "a year", "a month", "a fortnight"])) : undefined,
      })];
    }
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
    // A hold on something standing (one record, or a few), and an entry on one's own file.
    if (d.maybe(0.14)) {
      // (A third of them are standing work orders, an office's own routines, held by id like any standing paper.)
      const orders = d.maybe(1 / 3);
      const held = Array.from({ length: d.maybe(0.6) ? 1 : d.int(2, 4) }, () => ((orders ? d.rec() : d.job()) as { id: string }).id);
      if (orders) {
        d.tag = "standing_work_hold";
        d.notes.push(`What is put on hold is ${held.length > 1 ? "standing work orders, each" : "a standing work order:"} a routine set for the office's own staff (a round, a roster, a schedule). Say that that is what ${held.length > 1 ? "they are" : "it is"}, in words of your own, beside the id: it is paused, stays on record and is to be taken up again.`);
      } else d.tag = "hold";
      return [call("statement", { hold: held.length === 1 ? id(held[0]!) : list([...new Set(held)]), basis: d.maybe(0.08) ? d.record() : undefined })];
    }
    // (Tagged, like the hold above, so that a part can be made of them by name: nothing about the program changes.)
    if (d.maybe(0.12)) return (d.tag = "entry"), [call("statement", { kind: id("entry"), visible: id("own"), text: d.entryWords(), basis: d.maybe(0.5) ? d.rec() : undefined })];
    if (d.maybe(0.15)) {
      // (A quarter of what is withdrawn is a standing work order: the routine ended for good, with no words of its own.)
      if (d.maybe(0.25)) {
        d.tag = "standing_work_withdraw";
        d.notes.push("What is withdrawn is a standing work order: a routine set for the office's own staff (a round, a roster, a schedule). Say that that is what it is, in words of your own, beside the id: the routine is ended for good, not paused.");
        return [call("statement", { withdraw: d.rec() })];
      }
      return [call("statement", { withdraw: d.rec(), text: d.maybe(0.3) ? tx(d.pick(["It was issued in error.", "It has been replaced.", "The matter is settled.", "The figures were wrong."])) : undefined })];
    }
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
function goldOf(lines: Lines, d: Draw, source: string, forms?: FormSpec[], dropped?: { [reason: string]: number }, o: { /** As many values as this, where a sentence or two's ten is too few (an office's paper has more). */ most?: number; /** Fields whose lists are of plain words. */ wordLists?: string[]; /** A payment that carries out a request to pay (`payments`): kept, where a log's own is a keeper's bookkeeping. */ carriesOut?: boolean; /** A statement carrying data in the contract's typed vocabulary (a practice, an offer) and payments with their report: kept (`lateKinds`). */ late?: boolean } = {}): Gold | undefined {
  let p: calls.Program;
  try {
    p = calls.parseProgram(calls.programText(calls.programOf(...lines)));
  } catch {
    return undefined;
  }
  const not = whyNot(p);
  if (calls.contractErrors(p).length || (not !== undefined && !(not === "more than ten values" && literals(p).length <= (o.most ?? 10)) && !(o.carriesOut && not.startsWith("carries out")) && !(o.late && /^structured data: statement\.(practice|offer)$/.test(not)))) return undefined;
  const why = implausible(p, { invented: true, ...(forms ? { forms } : {}), ...(o.wordLists ? { wordLists: o.wordLists } : {}), ...(o.late ? { together: true } : {}) });
  if (why) {
    if (dropped) dropped[why] = (dropped[why] ?? 0) + 1;
    return undefined;
  }
  const program = goldText(p);
  const mentioned = new Set<string>();
  const walk = (v: V) => ("id" in v ? mentioned.add(v.id) : "json" in v && Array.isArray(v.json) ? v.json.forEach((x) => mentioned.add(String(x))) : "call" in v ? Object.values(v.call.args).forEach(walk) : undefined);
  if (!("none" in p)) for (const l of p.lines) Object.values(l.call.args).forEach(walk);
  return { program, shape: shapeOf(calls.parseProgram(program)), names: Object.fromEntries(Object.entries(d.names).filter(([k]) => mentioned.has(k))), source, origin: "synthetic", currency: d.currency, ...(forms ? { forms } : {}), ...(d.tag ? { tag: d.tag } : {}), ...(d.notes.length ? { notes: [...d.notes] } : {}) };
}

export interface SyntheticOptions {
  /** Different programs to make for each function (default 300). */
  perFunction?: number;
  /** A wide part's draws: grouped counts, and starts and ends as days (`Draw.wide`). The programs of a seed made
   * without it are what they were. */
  wide?: boolean;
  seed?: number;
  /** Only these functions (default: all of the call language's). */
  only?: string[];
  /** The share of a function's programs that are several dependent lines, where it has such programs (default 0.12). */
  dependent?: number;
  /** The money the programs are in (default: `everyCurrency()`, the invented worlds' and each profile's). */
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
      // A fifth of them directions on an office's own form, a fifth papers of an office's own (`directions`,
      // `papers`); the rest forms handed in to whoever takes them.
      const common = { seed: o.seed ?? 1, ...(o.currencies ? { currencies: o.currencies } : {}), ...(o.dropped ? { dropped: o.dropped } : {}) };
      const own = [...directions({ ...common, n: Math.floor(per / 5) }), ...papers({ ...common, n: Math.floor(per / 5) })];
      out.push(...syntheticForms({ sets: Math.ceil(per / 10), perForm: 5, ...common }).slice(0, per - own.length), ...own);
      continue;
    }
    const rand = sampler(hash(`${o.seed ?? 1}:${fn}`));
    const seen = new Set<string>();
    const dependent = DEPENDENT[fn] ?? [];
    // (One letter in eight directs an office in something it would take a form for, were one listed: `directions`.)
    if (fn === "message") for (const g of directions({ seed: o.seed ?? 1, ...(o.currencies ? { currencies: o.currencies } : {}), ...(o.dropped ? { dropped: o.dropped } : {}), n: Math.floor(per / 8), unlisted: true })) (seen.add(g.program), out.push(g));
    for (let tries = 0; seen.size < per && tries < per * 40; tries++) {
      const d = new Draw(rand, o.currencies ?? everyCurrency());
      d.wide = !!o.wide;
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
    case "list": return d.several();
    case "date": return d.date();
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
  const d = new Draw(rand, o.currencies ?? everyCurrency());
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
      const d = new Draw(rand, o.currencies ?? everyCurrency());
      // (A set of forms is one world's: its amounts are all in that world's money.)
      d.currency = (o.currencies ?? everyCurrency())[si % (o.currencies ?? everyCurrency()).length]!;
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

// ---------------------------------------------------------------- an office's own forms: directions and papers

const fd = (type: string, description: string, o: { required?: boolean; options?: string[] } = {}): FormField => ({ type, ...(o.required ? { required: true } : {}), ...(o.options ? { options: o.options } : {}), description });
const YES_NO = ["yes", "no"];
/**
 * What an office can be directed in, on a form of its own: each a subject (the form is named for the office and it:
 * `parks_staffing`, `harbour_rounds`) and the form's fields, the first required. Invented, in the shapes the worlds'
 * own offices take directions in (participants: an office's `takes`): a yes or no on something the office does of its
 * own accord, how often, how many, how long, how much. No place's offices or figures.
 */
const DIRECTION_SUBJECTS: { subject: string; fields: [string, FormField][] }[] = [
  { subject: "staffing", fields: [["recruit", fd("choice", "Whether the office recruits: yes, it advertises and fills the posts it is short of; no, it advertises none and takes nobody on", { required: true, options: YES_NO })], ["posts", fd("count", "The most staff it is to have")]] },
  { subject: "collection", fields: [["every", fd("duration", "How often each address on the round is collected from", { required: true })]] },
  { subject: "rounds", fields: [["every", fd("duration", "How often the round is made", { required: true })], ["crew", fd("count", "How many go out on each round")], ["shift", fd("choice", "When in the day it goes out", { options: ["morning", "afternoon", "night"] })]] },
  { subject: "opening", fields: [["open", fd("choice", "Which days the counter is open", { required: true, options: ["weekdays", "weekends", "both"] })], ["hours", fd("count", "How many hours a day it is open")]] },
  { subject: "enforcement", fields: [["fines", fd("choice", "Whether a breach the office finds is fined: yes, as it does of its own accord; no, it is recorded and nothing more", { required: true, options: YES_NO })], ["fine", fd("amount", "The fine for a breach, where it is to be other than the usual one")], ["grace", fd("duration", "How long someone is given to put a breach right before anything is done")]] },
  { subject: "recovery", fields: [["interest", fd("choice", "Whether what is left unpaid after its due day is charged interest", { required: true, options: YES_NO })], ["after", fd("duration", "How long something is overdue before the office chases it")]] },
  { subject: "purchasing", fields: [["limit", fd("amount", "The most the office may spend on one purchase without asking", { required: true })], ["tender_above", fd("amount", "The sum above which a purchase is put out to tender")]] },
  { subject: "inspections", fields: [["every", fd("duration", "How often each place is inspected", { required: true })], ["notice", fd("duration", "How much notice is given of an inspection")], ["priority", fd("choice", "Which are taken first", { options: ["complaints", "routine"] })]] },
  { subject: "reminders", fields: [["send", fd("choice", "Whether the office sends reminders of what is due", { required: true, options: YES_NO })], ["after", fd("duration", "How long after the due day a reminder goes out")]] },
  { subject: "overtime", fields: [["allow", fd("choice", "Whether the office's staff work overtime", { required: true, options: YES_NO })], ["cap", fd("count", "The most hours of it a week")]] },
  { subject: "repairs", fields: [["within", fd("duration", "How soon a fault reported is to be put right", { required: true })], ["ceiling", fd("amount", "The most to be spent on one repair without asking")]] },
  { subject: "intake", fields: [["accept", fd("choice", "Whether the office takes in new applications", { required: true, options: YES_NO })], ["weekly", fd("count", "The most it takes in a week")]] },
  { subject: "patrols", fields: [["every", fd("duration", "How often a patrol goes out", { required: true })], ["pairs", fd("choice", "Whether patrols go out in pairs", { options: YES_NO })]] },
  { subject: "stock", fields: [["reorder", fd("choice", "Whether the office reorders by itself when stock runs low", { required: true, options: YES_NO })], ["keep", fd("count", "How many of each thing it is to keep in store")], ["budget", fd("amount", "The most to be spent on stock in a month")]] },
];

export interface OwnFormOptions {
  /** How many programs (default 60). */
  n?: number;
  /** Ways each form is filled in (default 5). */
  perForm?: number;
  seed?: number;
  currencies?: Currency[];
  dropped?: { [reason: string]: number };
}

/** The offices of one invented organisation that take directions, with the forms each takes them on: a set, as one
 * person knows of them. For a seed and a set's number, always the same. */
function directionSet(seed: number, si: number, currencies: Currency[], taken: Set<string>): { d: Draw; forms: FormSpec[] } {
  const d = new Draw(sampler(hash(`${seed}:directions ${si}`)), currencies);
  d.currency = currencies[si % currencies.length]!;
  const forms: FormSpec[] = [];
  const words = shuffled(OFFICE_WORDS, d.rand).slice(0, d.pick([1, 1, 2, 2, 3]));
  // (Two offices of a set now and then take the same direction, each on its own form: whose it is, is the office's.)
  const shared = d.maybe(0.5) ? d.pick(DIRECTION_SUBJECTS) : undefined;
  for (const [i, w] of words.entries()) {
    const to = d.officeId(w);
    const subjects = [...new Set([...(shared && i < 2 ? [shared] : []), ...shuffled(DIRECTION_SUBJECTS, d.rand).slice(0, d.pick([1, 1, 2, 3]))])];
    for (const s of subjects) {
      const form = `${w}_${s.subject}`;
      if (taken.has(form)) continue;
      taken.add(form);
      forms.push({ form, to, office: "direction", fields: Object.fromEntries(s.fields) });
    }
  }
  return { d, forms };
}

/** A direction's answers in a few plain words, for a writer who has no form to go by. */
const answersSaid = (spec: FormSpec, args: { [k: string]: V }): string =>
  Object.entries(args).map(([k, v]) => `${k.replace(/_/g, " ")}: ${"id" in v ? v.id : "text" in v ? v.text : ""} (${spec.fields[k]?.description ?? k})`).join("; ");

/**
 * Directions to offices, as gold programs. `unlisted: false` (`tag: "direction"`): the office's own form for the
 * direction filled in (`form(form=parks_staffing, to=<the office>, recruit=no)`), shown with the form, alone or beside
 * others of its set (another direction the same office takes; the same direction as another office takes it).
 * `unlisted: true` (`tag: "direction_unlisted"`): the same directions for someone who knows of no form for them: by
 * the translator's rules a letter to the office, `message(to=<the office>, text=…)`, asked for indirectly, its words
 * the writer's (data.ts `planOf`) from what the direction says (`notes`). It is shown with no form, or with other forms
 * of the set that are not that office's form for that direction, so that what decides between the two is the form
 * listed and nothing in how the request is worded. Both are made of the same sets of forms, for a seed always the same.
 */
export function directions(o: OwnFormOptions & { unlisted?: boolean } = {}): Gold[] {
  const out: Gold[] = [];
  const seen = new Set<string>();
  const taken = new Set<string>();
  const currencies = o.currencies ?? everyCurrency();
  const want = o.n ?? 60;
  for (let si = 0; out.length < want && si < want * 4 + 8; si++) {
    const set = directionSet(o.seed ?? 1, si, currencies, taken);
    for (const [fi, spec] of set.forms.entries()) {
      const rand = sampler(hash(`${o.seed ?? 1}:direction ${si}.${fi}${o.unlisted ? " unlisted" : ""}`));
      for (let n = 0, tries = 0; n < (o.unlisted ? Math.ceil((o.perForm ?? 5) / 2) : o.perForm ?? 5) && tries < 40 && out.length < want; tries++) {
        const d = new Draw(rand, currencies);
        d.currency = set.d.currency;
        d.names[spec.to] = set.d.names[spec.to]!;
        // (How often, how soon and how many, as offices are told them: days and weeks, a few dozen at most.)
        const value = (k: string, f: FormField): V =>
          f.type === "duration" ? tx(d.pick([...(k === "every" ? ["weekly", "fortnightly", "monthly", "daily"] : []), "a week", "7 days", "2 weeks", "14 days", "a fortnight", "10 days", "3 days", "2 days", "21 days", "28 days", "30 days", "a month", "6 weeks", "90 days"]))
          : f.type === "count" ? d.count(40) : fieldValue(d, f);
        const filled = Object.fromEntries(Object.entries(spec.fields).filter(([, f]) => f.required || d.maybe(0.45)).map(([k, f]) => [k, value(k, f)]));
        const others = set.forms.filter((x) => x !== spec);
        let g: Gold | undefined;
        if (o.unlisted) {
          // Who is directed: the office by its id, or now and then by what it is called.
          const to = d.maybe(0.8) ? id(spec.to) : tx(d.names[spec.to]!);
          d.tag = "direction_unlisted";
          d.notes.push(`What the office is directed to do, to be put in your own words between the marks (there is no form for it: it is said to the office): ${answersSaid(spec, filled)}.`);
          const shown = d.maybe(0.4) ? [] : shuffled(others, rand).slice(0, d.pick([1, 1, 2]));
          g = goldOf([call("message", { to, text: tx(Object.entries(filled).map(([k, v]) => `${k.replace(/_/g, " ")} ${"id" in v ? v.id : "text" in v ? v.text : ""}`).join(", ")) })], d, `synthetic: direction with no form (${spec.form})`, shown.length ? shown : undefined, o.dropped);
        } else {
          d.tag = "direction";
          const shown = shuffled([spec, ...shuffled(others, rand).slice(0, d.pick([0, 1, 1, 2]))], rand);
          g = goldOf([call("form", { form: id(spec.form), to: id(spec.to), ...filled })], d, `synthetic: direction ${spec.form}`, shown, o.dropped);
        }
        if (!g || seen.has(g.program)) continue;
        seen.add(g.program);
        out.push(g);
        n++;
      }
    }
  }
  return out;
}

const PAPER_WORDS = ["burial", "stall", "rates", "tender", "vacancy", "mooring", "allotment", "hall", "market", "water", "waste", "tree", "kennel", "road", "school", "clinic", "depot", "harbour", "footpath", "festival", "grazing", "well", "ferry", "tenancy", "meter", "weighbridge", "library", "stores"];
const PAPER_ENDS = ["registration", "register", "entry", "advertisement", "listing", "approval", "certificate", "licence", "order", "decision", "result", "notice", "warning", "docket", "return", "receipt", "roll", "summons", "permit"];

/** An invented paper of an office's own: a name of two words, and two to eight fields of every type, lists and dates
 * among them more often than chance would have it. */
function inventPaper(d: Draw, taken: Set<string>, to: string, types: string[]): FormSpec {
  let form = "";
  for (let tries = 0; tries < 200 && (!form || taken.has(form)); tries++) form = `${d.pick(PAPER_WORDS)}_${d.pick(PAPER_ENDS)}`;
  taken.add(form);
  const fields: FormSpec["fields"] = {};
  const n = d.int(2, 8);
  for (let i = 0; i < n; i++) {
    const type = i === 0 ? types.shift() ?? d.pick(FIELD_TYPES) : d.maybe(0.3) ? d.pick(["list", "date"]) : d.pick(FIELD_TYPES);
    const free = FIELD_NAMES[type]!.filter((x) => !(x in fields));
    const name = free.length ? d.pick(free) : `${type}_${i + 1}`;
    fields[name] = { type, ...(d.maybe(i === 0 ? 0.8 : 0.4) ? { required: true } : {}), ...(type === "choice" ? { options: d.maybe(0.25) ? YES_NO : optionsFor(d) } : {}) };
  }
  return { form, to, office: "paper", fields };
}

/** The papers the worlds' own offices issue (participants: papers.ts), as forms someone holding such an office knows
 * of: each form's name, fields, types and what each field is for, as its module declares them. Whose office it is,
 * is invented with everything else (`to`). In the order declared. */
export function declaredPapers(): Omit<FormSpec, "to">[] {
  const all = Object.values(PAPERS).flatMap((x): PAPERS_Issued[] => (Array.isArray(x) ? x : typeof x === "object" && x && "form" in x && "fields" in x ? [x as PAPERS_Issued] : []));
  // (A paper two offices issue under one name is the first's here: one form to a name.)
  return all.filter((p, i) => all.findIndex((x) => x.form === p.form) === i).map((p) => ({ form: p.form, office: "paper" as const, fields: Object.fromEntries(Object.entries(p.fields).map(([k, f]) => [k, { type: f.type, ...(f.required ? { required: true } : {}), ...(f.options ? { options: [...f.options] } : {}), ...(f.description ? { description: f.description } : {}) }])) }));
}
type PAPERS_Issued = (typeof PAPERS.REGISTRY)[number];

/**
 * Papers of an office's own, filled in, as gold programs (`tag: "paper"`): the office's stationery (`to` is the
 * office, the asker's own), every required field and some of the others, shown alone or beside another of the same
 * office's. Most are invented (`inventPaper`); every third set (unless `declared: false`) is of the papers the
 * worlds' own offices issue (`declaredPapers`), under an invented office. A paper has more to say than a sentence or
 * two holds: up to fourteen values. For a seed, always the same.
 */
export function papers(o: OwnFormOptions & { declared?: boolean } = {}): Gold[] {
  const out: Gold[] = [];
  const seen = new Set<string>();
  const taken = new Set<string>();
  const currencies = o.currencies ?? everyCurrency();
  const want = o.n ?? 60;
  const real = declaredPapers();
  const types: string[] = [];
  for (let si = 0; out.length < want && si < want * 4 + 8; si++) {
    const rand = sampler(hash(`${o.seed ?? 1}:papers ${si}`));
    const sd = new Draw(rand, currencies);
    sd.currency = currencies[si % currencies.length]!;
    const to = sd.officeId();
    if (types.length < 4) types.push(...shuffled(FIELD_TYPES, rand));
    // A set: one office's stationery, two or three papers. Every third set is of the worlds' own papers (each once
    // for a seed, while there are any left: a split by form keeps a paper's examples together).
    const declared = si % 3 === 2 && o.declared !== false ? real.filter((p) => !taken.has(p.form)) : [];
    const set: FormSpec[] = declared.length
      ? shuffled(declared, rand).slice(0, 2).map((p) => (taken.add(p.form), { ...p, to }))
      : Array.from({ length: sd.int(2, 3) }, () => inventPaper(sd, taken, to, types));
    for (const spec of set) for (let n = 0, tries = 0; n < (o.perForm ?? 5) && tries < 60 && out.length < want; tries++) {
      const d = new Draw(rand, currencies);
      d.currency = sd.currency;
      d.names[to] = sd.names[to]!;
      d.tag = "paper";
      const filled = Object.entries(spec.fields).filter(([, f]) => f.required || d.maybe(0.4));
      const fields = filled.length ? filled : Object.entries(spec.fields).slice(0, 1);
      // (Who a paper is about is as often a person as an organisation.)
      const value = (f: FormField): V => (f.type === "entity" && d.maybe(0.6) ? id(d.personId()) : f.type === "text" && d.maybe(0.5) ? tx(d.pick(PURPOSES)) : fieldValue(d, f));
      const shown = shuffled([spec, ...shuffled(set.filter((x) => x !== spec), rand).slice(0, d.pick([0, 1, 1]))], rand);
      const g = goldOf([call("form", { form: id(spec.form), to: id(to), ...Object.fromEntries(fields.map(([k, f]) => [k, value(f)])) })], d, `synthetic: paper ${spec.form}`, shown, o.dropped, { most: 14 });
      if (!g || seen.has(g.program)) continue;
      seen.add(g.program);
      out.push(g);
      n++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- every paper the worlds' own offices issue

/** What a text field of a declared paper says, by the field's name (a `kind` of goods is a word for goods, a `post` a
 * title): ordinary words from the pools, none any place's. A name not listed here is a purpose or a short letter. */
const TEXT_FIELDS: { [name: string]: (d: Draw) => string } = {
  kind: (d) => d.pick(GOODS), goods: (d) => `${d.int(2, 40)} ${d.pick(GOODS)}`, post: (d) => d.pick(TITLES), name: (d) => d.personName(),
  headline: (d) => `The ${d.pick(SITES)} ${d.pick(EVENTS)} ${d.pick(WHEN)}`, platform: (d) => d.pick(PURPOSE_LINES),
  reason: (d) => d.pick(["the income shown does not cover the repayments", "the application is complete and in order", "the security offered is not enough", "the figures could not be confirmed"]),
  why: (d) => d.pick(["takings are down on last year", "prices have risen since the last settlement", "the order book is full until the spring", "it is what the business can bear this year"]),
  memo: (d) => d.pick(PURPOSES),
};

/** The list fields of declared papers that hold plain words (what a ballot is about, what a candidate stands for,
 * what an application lacks), and words for them. */
const LIST_WORDS = ["tags", "values", "missing"];
const TAG_WORDS = ["budget", "roads", "housing", "parks", "rates", "water", "schools", "markets", "harbour", "waste", "safety", "jobs", "rents", "drainage", "lighting"];

/**
 * Every paper the worlds' own offices issue (participants: papers.ts; 41 over its offices, a name two offices share
 * once for each), filled in `perForm` ways, as gold programs (`tag: "world_form"`). `papers` reaches a declared paper
 * only in every third set and may never fill a field that is not required; here none is left out and no field is:
 * the first two ways of filling a paper have, between them, every field it has (the required ones in both), and the
 * rest draw the others by chance. Whose office it is, is invented (`to`); who would ask for it is the office's holder
 * (`Gold.asker`: a landlord for a rental listing, a union's organiser for a wage claim). Each way is in another
 * world's money. A paper may have more to say than a sentence or two holds: up to twenty values. For a seed, always the same.
 */
export function worldForms(o: { perForm?: number; seed?: number; currencies?: Currency[]; dropped?: { [reason: string]: number }; /** Who asks for an office's papers (data.ts `PAPER_ASKERS`). */ askers?: { [office: string]: string }; /** Fill in only these papers (by form name; the others still stand beside them in what is shown, and the programs of these are those of a run without the limit). */ only?: string[]; /** Ways to fill a paper, for papers named here (in place of `perForm`). */ perFormOf?: { [form: string]: number } } = {}): Gold[] {
  const out: Gold[] = [];
  const seen = new Set<string>();
  const currencies = o.currencies ?? everyCurrency();
  const offices = Object.entries(PAPERS).flatMap(([office, x]) => (Array.isArray(x) ? [{ office, papers: x as PAPERS_Issued[] }] : typeof x === "object" && x && "form" in x && "fields" in x ? [{ office, papers: [x as PAPERS_Issued] }] : []));
  let fi = 0;
  for (const { office, papers } of offices) {
    const srand = sampler(hash(`${o.seed ?? 1}:world forms ${office}`));
    const sd = new Draw(srand, currencies);
    const to = sd.officeId();
    const specs: FormSpec[] = papers.map((p) => ({ form: p.form, to, office: "paper" as const, fields: Object.fromEntries(Object.entries(p.fields).map(([k, f]) => [k, { type: f.type, ...(f.required ? { required: true } : {}), ...(f.options ? { options: [...f.options] } : {}), ...(f.description ? { description: f.description } : {}) }])) }));
    for (const spec of specs) {
      if (o.only && !o.only.includes(spec.form)) { fi++; continue; }
      const rand = sampler(hash(`${o.seed ?? 1}:world form ${office}.${spec.form}`));
      const optional = Object.entries(spec.fields).filter(([, f]) => !f.required).map(([k]) => k);
      for (let n = 0, tries = 0; n < (o.perFormOf?.[spec.form] ?? o.perForm ?? 6) && tries < 80; tries++) {
        const d = new Draw(rand, currencies);
        d.currency = currencies[(fi * 7 + n * 3 + (o.seed ?? 1)) % currencies.length]!;
        d.names[to] = sd.names[to]!;
        d.tag = "world_form";
        const filled = Object.entries(spec.fields).filter(([k, f]) => f.required || (n < 2 ? optional.indexOf(k) % 2 === n : d.maybe(0.5)));
        const value = (k: string, f: FormField): V =>
          f.type === "text" ? tx(spec.form === "news_item" && k === "kind" ? d.pick(NEWS_KINDS) : (TEXT_FIELDS[k] ?? ((x: Draw) => (x.maybe(0.5) ? x.pick(PURPOSES) : (x.letter() as { text: string }).text)))(d))
          // (A list is of what its field's name says: lots, people, records, or plain words such as a ballot's tags.)
          : f.type === "list" ? (LIST_WORDS.includes(k) ? list(shuffled(TAG_WORDS, d.rand).slice(0, d.pick([1, 2, 2, 3]))) : d.several(k === "lots" ? "lot" : k === "laws" || k === "estate" ? "record" : "person"))
          : f.type === "entity" && d.maybe(0.6) ? id(d.personId())
          : f.type === "count" ? (/_bps$/.test(k) ? tx(String(d.pick([50, 100, 150, 200, 250, 300, 400, 500, 650, 800]))) : k === "year" || k === "edition" || k === "round" ? tx(String(d.int(1, 12))) : d.count(60))
          : fieldValue(d, f);
        const shown = shuffled([spec, ...shuffled(specs.filter((x) => x !== spec), rand).slice(0, d.pick([0, 1, 1]))], rand);
        const g = goldOf([call("form", { form: id(spec.form), to: id(to), ...Object.fromEntries(filled.map(([k, f]) => [k, value(k, f)])) })], d, `synthetic: world form ${office}.${spec.form}`, shown, o.dropped, { most: 20, wordLists: LIST_WORDS });
        if (!g || seen.has(g.program)) continue;
        seen.add(g.program);
        out.push({ ...g, asker: o.askers?.[office] ?? "officer" });
        n++;
      }
      fi++;
    }
  }
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
  const currencies = o.currencies ?? everyCurrency();
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

// ---------------------------------------------------------------- payments of a bank's and of a finance office's kinds

/** What a wage is for, and what a remittance of what was withheld from wages is for: no place's words. */
const WAGES_FOR = ["wages", "this fortnight's wages", "wages for the month", "net wages", "pay for the week", "salary", "wages for the last pay period", "net pay"];
const WITHHELD_FOR = ["tax withheld from wages", "withheld tax for the month", "wage tax withheld this quarter", "amounts withheld from pay", "payroll tax withheld", "tax deducted from wages", "withholding for the period"];
const OUTSIDE = ["revenue", "tax-office", "treasury", "state-revenue", "national-revenue", "exchequer", "pension-fund", "insurance-fund"];
const ORDERED = ["goods", "bread", "timber", "flour", "tools", "cloth", "fuel", "medicine", "seed", "bricks"];

/**
 * Payments of the kinds a bank's and a finance office's seats ask for, which the function's own recipe makes few or
 * none of (0.14.0; the retrain of 2026-10-10 found two examples of `per_request` in all the data, and the model weak
 * on a finance office's payments). `kind`:
 *  - `per_request` (tag `per_request`): a keeper of accounts pays out of an account it keeps, carrying out a request
 *    to pay that is on record: `money(to, amount, from, per_request=<that record's id>)`, with a purpose most of the
 *    time (now and then one that names the account's holder, as tellers write it: "c0585's order of 9 goods") and
 *    now and then what it settles. Whoever asks is someone at a bank's counter (`asker`). A log's own such payments
 *    are a code keeper's bookkeeping and stay out of the gold set (data.ts `whyNot`): these are the same act as a
 *    seat that keeps accounts asks for it in words.
 *  - `finance` (tag `finance_payment`), four in turn: a wage paid net, the request also stating the gross and what was
 *    withheld (figures the call does not have: the writer is given them, `notes`, and what is paid is the amount
 *    stated as paid); what was withheld remitted to an outside account, on a law or a record; a payment resting on
 *    several records and laws (`basis` a list) that mostly settles something; a standing payment with its first day
 *    or wait said (`first`).
 * For a seed, always the same.
 */
export function payments(o: { kind: "per_request" | "finance"; n?: number; seed?: number; currencies?: Currency[]; dropped?: { [reason: string]: number } }): Gold[] {
  const rand = sampler(hash(`${o.seed ?? 1}:payments ${o.kind}`));
  const want = o.n ?? 100;
  const out: Gold[] = [];
  const seen = new Set<string>();
  for (let tries = 0; out.length < want && tries < want * 40; tries++) {
    const d = new Draw(rand, o.currencies ?? everyCurrency());
    const per = 10 ** d.currency.minor_units;
    const write = (n: number) => d.pick(amountWritings(BigInt(n), d.currency));
    let c: calls.Call;
    if (o.kind === "per_request") {
      const holder = `c${pad(d.int(1, 9999), 4)}`;
      const own = d.maybe(0.65);
      const from = own ? id(`acc-${holder}`) : d.account();
      const r = d.rand();
      const what = r < 0.3 ? d.purpose() : r < 0.5 ? tx(`${d.int(2, 40)} ${d.pick(ORDERED)}`) : r < 0.7 && own ? tx(`${holder}'s ${d.pick(["order of", "purchase of"])} ${d.int(2, 40)} ${d.pick(ORDERED)}`) : r < 0.8 && own ? tx(`${holder}'s ${d.pick(["rent", "dues", "school fees", "water bill", "loan repayment"])}`) : undefined;
      const request = d.rec() as { id: string };
      c = call("money", { to: d.maybe(0.7) ? d.account() : d.party(["org", "person"]), amount: d.amount(), from, per_request: request, for: what, settles: d.maybe(0.1) ? d.rec() : undefined });
      d.tag = "per_request";
      d.notes.push(`The speaker keeps the account the money leaves (a bank, at its counter) and is carrying out a request to pay that is on record as ${request.id}: say that this payment is made under that request, in words of your own and with its id ("as asked in ${request.id}", "carrying out the request to pay ${request.id}", "as the account's holder requested in ${request.id}", "Carry out ${request.id}: pay …", "on the holder's instruction ${request.id}"; never a bare "per ${request.id}" or "under ${request.id}", which is how a record a payment rests on is cited). It is neither what the payment settles nor a record it rests on, and nobody is named as having asked unless the call's own words name them.`);
    } else {
      const sub = out.length % 4;
      d.tag = "finance_payment";
      if (sub === 0) {
        // A wage paid net: the gross and what was withheld are said beside it, and are no part of the call.
        const gross = d.int(40, 900) * d.pick([10, 50, 100]) * per * (d.currency.minor_units === 0 ? d.pick([1, 10, 100]) : 1) + (per > 1 && d.maybe(0.3) ? d.int(1, per - 1) : 0);
        const unit = per > 1 && d.maybe(0.5) ? 1 : per; // (to the smallest unit, or in whole units)
        const withheld = Math.max(unit, Math.round((gross * d.int(5, 35)) / 100 / unit) * unit);
        const net = gross - withheld;
        // (The three figures written one way where each can be: the k-th of its writings, the first where it has fewer.)
        const k = d.int(0, 5);
        const [g, w, n] = [gross, withheld, net].map((x) => { const ways = amountWritings(BigInt(x), d.currency); return ways[k] ?? ways[0]!; }) as [string, string, string];
        if (new Set([g, w, n]).size < 3) continue;
        c = call("money", { to: d.maybe(0.5) ? id(`acc-c${pad(d.int(1, 9999), 4)}`) : id(d.personId()), amount: tx(n), from: d.maybe(0.8) ? id(`acc-${d.pick(["payroll", "wages", "city", "town", "works", "finance", "treasury"])}${d.maybe(0.3) ? `-${d.int(1, 40)}` : ""}`) : undefined, for: tx(d.pick(WAGES_FOR)), basis: d.maybe(0.3) ? d.rec() : undefined });
        d.notes.push(`Beside what is paid, the request states two more figures, each exactly as written here and each said for what it is: the gross wage, ${g}, and what was withheld from it, ${w}. What is to be paid is ${n}, and the request says that figure as the sum to pay (the net wage, what is left after what was withheld): it is given, never left to be worked out. Neither of the other two figures is paid to anyone by this request. (Whatever the instructions or the style say of amounts the call doesn't have: these two are given to you to state, and no other.)`);
      } else if (sub === 1) {
        c = call("money", { to: id(`acc-${d.pick(OUTSIDE)}${d.maybe(0.4) ? `-${d.int(1, 40)}` : ""}`), amount: d.amount(), from: d.maybe(0.85) ? d.account() : undefined, for: tx(d.pick(WITHHELD_FOR)), basis: d.maybe(0.6) ? d.record() : undefined, settles: d.maybe(0.2) ? d.rec() : undefined });
        d.notes.push("What is paid over is money that was withheld (from wages, from payments) and is now passed on to the outside body whose account that is: say so in words of your own (remit, pass on, pay over).");
      } else if (sub === 2) {
        const cited = [...new Set(Array.from({ length: d.int(2, 3) }, () => (d.record() as { id: string }).id))];
        if (cited.length < 2) continue;
        c = call("money", { to: d.maybe(0.6) ? d.account() : d.party(), amount: d.amount(), from: d.maybe(0.7) ? d.account() : undefined, for: d.maybe(0.7) ? d.purpose() : undefined, basis: list(cited), settles: d.maybe(0.55) ? d.rec() : undefined });
        d.notes.push(`The payment rests on ${cited.length} things on record (${cited.join(", ")}): each is cited as what the payment is made under, in the order the call lists them.${"settles" in c.args ? ` What it settles (${(c.args.settles as { id: string }).id}) is said apart from them, as the bill, claim or debt this pays off.` : ""}`);
      } else {
        const first = d.maybe(0.5) ? d.date() : tx(d.pick(["1 day", "2 days", "3 days", "7 days", "a week", "10 days", "14 days", "a fortnight", "a month", "30 days"]));
        c = call("money", { to: d.maybe(0.6) ? d.account() : d.party(), amount: d.amount(), from: d.maybe(0.7) ? d.account() : undefined, every: d.every(), first, for: d.maybe(0.7) ? d.purpose() : undefined, basis: d.maybe(0.3) ? d.record() : undefined });
        d.notes.push(`When the first of the payments is made is said beside how often: ${"text" in first && /^(year|day) /.test(first.text) ? `on ${first.text}, a day ("the first on ${first.text}", "starting ${first.text}")` : `${(first as { text: string }).text} from now, a wait ("the first in ${(first as { text: string }).text}", "starting in ${(first as { text: string }).text}")`}.`);
      }
    }
    const g = goldOf([c], d, `synthetic: ${o.kind === "per_request" ? "payment carrying out a request" : "finance payment"}`, undefined, o.dropped, { carriesOut: o.kind === "per_request" });
    if (!g || seen.has(g.program)) continue;
    seen.add(g.program);
    out.push(o.kind === "per_request" ? { ...g, asker: "banker" } : g);
  }
  return out;
}

// ---------------------------------------------------------------- kinds the call language gained and the prompt taught later

/** The lines of a body's budget, as a request names one: a bare word (neutral: no place's budget). */
const BUDGET_LINES = ["parks", "roads", "schools", "services", "libraries", "health", "housing", "water", "waste", "safety", "works", "culture", "transport", "lighting", "markets", "relief"];
const GATHERERS = ["Circle", "Club", "Society", "Guild", "Fellowship", "Union", "League", "Association", "Choir", "Congregation"];
const GATHERINGS = ["every 7 days", "every 14 days", "every 14 days", "every 28 days", "every 21 days", "every 10 days", "every week", "every fortnight", "every month"];
const REPORT_PARTS = ["withheld from", "paid to", "taken from", "due from", "deducted from", "owed by"];

export type LateKind = "line" | "report" | "split" | "hours" | "practice" | "offer";
/** The tag each kind of program carries (`Gold.tag`; `inOnly`: `--only line_payment`). */
export const LATE_TAGS: { [kind in LateKind]: string } = { line: "line_payment", report: "report_amounts", split: "split_payment", hours: "hours_term", practice: "practice_notice", offer: "offer_notice" };

/**
 * Programs of kinds the call language gained after the data was first made, or that the model was weak on and no
 * recipe made enough of (docs/design/translator-round-3.md, section 2; prompt 0.9.5). By `kind`:
 *  - `line` (tag `line_payment`): a payment the request says is drawn on a line of the budget, `money(..., line=<label>)`,
 *    half of them settling an invoice, a few standing.
 *  - `report` (tag `report_amounts`): a payment (or two) together with a report naming each of several amounts, which
 *    is one program of two or three lines: the money, then `statement(kind=report, text=...)` whose words carry each
 *    amount as written. What is paid is the one figure the request states as the sum to pay.
 *  - `split` (tag `split_payment`): the same sum paid to several accounts, each amount stated: a line each. (The ones
 *    that state no share as a figure are `needs_calculation` refusals: data.ts `refusalBriefs` makes them from these.)
 *  - `hours` (tag `hours_term`): an offer of employment, with the job's ordinary hours in a week stated (`hours="40 hours"`)
 *    in half of them and not stated in the other half (a request that states none gets none).
 *  - `practice` (tag `practice_notice`): a public notice of something held again and again at a place, one statement
 *    carrying `practice=` (its lengths of time as the request writes them, no start) and `on=`.
 *  - `offer` (tag `offer_notice`): a public offer anyone may take up (joining a group, with dues or without), one
 *    statement carrying `offer=`, never an agreement.
 * For a seed, always the same.
 */
export function lateKinds(o: { kind: LateKind; n?: number; seed?: number; currencies?: Currency[]; dropped?: { [reason: string]: number } }): Gold[] {
  const rand = sampler(hash(`${o.seed ?? 1}:late ${o.kind}`));
  const want = o.n ?? 100;
  const out: Gold[] = [];
  const seen = new Set<string>();
  for (let tries = 0; out.length < want && tries < want * 40; tries++) {
    const d = new Draw(rand, o.currencies ?? everyCurrency());
    d.tag = LATE_TAGS[o.kind];
    const per = 10 ** d.currency.minor_units;
    let lines: Lines;
    if (o.kind === "line") {
      const label = d.pick(BUDGET_LINES);
      const settles = d.maybe(0.5);
      const every = !settles && d.maybe(0.2);
      lines = [call("money", { to: d.maybe(0.6) ? d.account() : d.party(), amount: d.amount(), from: d.maybe(0.85) ? d.account() : undefined, every: every ? d.every() : undefined, for: d.maybe(0.6) ? d.purpose() : undefined, settles: settles ? d.rec() : undefined, basis: d.maybe(0.1) ? d.record() : undefined, line: id(label) })];
      d.notes.push(`The payment is drawn on the ${label} line of the budget: say so in words of your own ("charged to the ${label} line", "out of the ${label} line of the budget", "under the ${label} line"), naming the line exactly as it is written here (${label}). A line of the budget is not an account: the account the money leaves is named separately.`);
    } else if (o.kind === "report") {
      const parts = d.int(2, 4);
      const k = d.int(0, 5);
      const figures = Array.from({ length: parts }, () => (d.int(10, 400) * (d.maybe(0.5) ? 10 : 1) * per) + (per > 1 && d.maybe(0.3) ? d.int(1, per - 1) : 0));
      const total = figures.reduce((a, b) => a + b, 0);
      const written = (x: number) => { const ways = amountWritings(BigInt(x), d.currency); return ways[k] ?? ways[0]!; };
      const who = Array.from({ length: parts }, () => d.personId());
      const what = d.pick(REPORT_PARTS);
      const text = who.map((w, i) => `${written(figures[i]!)} ${what} ${w}`).join(", ").replace(/, ([^,]*)$/, " and $1");
      const two = d.maybe(0.25);
      const to = d.maybe(0.6) ? d.account() : d.party(["org", "person"]);
      const from = d.maybe(0.8) ? d.account() : undefined;
      const pay = (x: number, dest: V) => call("money", { to: dest, amount: tx(written(x)), from, for: d.maybe(0.5) ? d.purpose() : undefined });
      lines = two && parts >= 3 ? [pay(figures.slice(0, 2).reduce((a, b) => a + b, 0), to), pay(figures.slice(2).reduce((a, b) => a + b, 0), d.account()), call("statement", { kind: id("report"), text: tx(text) })]
        : [pay(total, to), call("statement", { kind: id("report"), text: tx(text) })];
      d.notes.push(two && parts >= 3 ? `Two payments are made, and one report beside them names every amount: ${text}. Say the report's words exactly as written (the amounts and who each is for), as the words of the report, and the two sums to pay as the sums to pay.` : `One payment is made, of the total, ${written(total)}, and a report beside it names each of ${parts} amounts: ${text}. Say the report's words exactly as written (the amounts and who each is for), as the words of the report; the sum to pay is the total, ${written(total)}, stated as the sum to pay.`);
    } else if (o.kind === "split") {
      const n = d.int(2, 3);
      const from = d.maybe(0.8) ? d.account() : undefined;
      const why = d.maybe(0.6) ? d.purpose() : undefined;
      const tos = Array.from({ length: n }, () => d.account());
      if (new Set(tos.map((t) => (t as { id: string }).id)).size < n) continue;
      const k = d.int(0, 5);
      const sums = tos.map(() => d.int(10, 900) * d.pick([1, 10, 100]) * per + (per > 1 && d.maybe(0.3) ? d.int(1, per - 1) : 0));
      const written = (x: number) => { const ways = amountWritings(BigInt(x), d.currency); return ways[k] ?? ways[0]!; };
      lines = tos.map((to, i) => call("money", { to, amount: tx(written(sums[i]!)), from, for: why }));
      d.notes.push(`One request pays ${n} accounts, each a sum stated as a figure: the same payment to each of them, one line apiece. Every account and its sum are said.`);
    } else if (o.kind === "hours") {
      const stated = out.length % 2 === 0;
      const other = d.party(["person"]);
      const wage = call("money", { to: d.maybe(0.5) ? d.account() : id(`acc-c${pad(d.int(1, 9999), 4)}`), amount: d.amount(), every: d.every(), from: d.maybe(0.7) ? d.account() : undefined });
      const hours = `${d.pick([8, 12, 15, 16, 20, 24, 25, 30, 32, 35, 36, 37, 38, 40, 42, 44, 48])} hours`;
      lines = [call("agreement", { with: other, template: id(d.pick(["employment", "employment", "apprenticeship", "retainer"])), term: d.maybe(0.3) ? d.term() : undefined, our_notice: d.maybe(0.6) ? d.notice() : undefined, their_notice: d.maybe(0.6) ? d.notice() : undefined, hours: stated ? tx(hours) : undefined, we_do: { call: wage }, they_do: nest("work", { task: d.word(TASKS), at: d.structure() }), basis: d.maybe(0.15) ? d.record() : undefined })];
      d.notes.push(stated ? `The request states the job's ordinary hours in a week: ${hours} ("${hours} a week", "${hours} each week"): the number of hours is written exactly as ${hours} somewhere in the request.` : "The request states no hours for the job and no number of hours a week: none is written.");
    } else if (o.kind === "practice") {
      const name = `${d.place()} ${d.pick(GATHERERS)}`;
      const at = d.maybe(0.7) ? (d.inside() as { id: string }).id : d.cellId();
      const on = d.ground() as { id: string };
      const every = d.pick(GATHERINGS);
      const lasts = d.pick(["30 minutes", "45 minutes", "60 minutes", "90 minutes", "2 hours", "3 hours"]);
      const hasLasts = d.maybe(0.85);
      const text = `${name} gathers ${every}${hasLasts ? `, for ${lasts}` : ""}. All welcome.`;
      lines = [call("statement", { kind: id("notice"), visible: id("public"), text: tx(text), on, practice: { json: { at, every, ...(hasLasts ? { lasts } : {}) } } })];
      d.notes.push(`This is a public notice of something held again and again at ${at}: ${name} gathers ${every}${hasLasts ? ` for ${lasts}` : ""}. The notice is put up on ${on.id}, and it says where it is held (${at}) and how often${hasLasts ? " and for how long" : ""}, in exactly these words for the lengths of time (${every}${hasLasts ? `, ${lasts}` : ""}). The notice's words are copied exactly: ${text}`);
    } else {
      const name = `${d.place()} ${d.pick(GATHERERS)}`;
      const dues = d.maybe(0.7);
      const account = d.account() as { id: string };
      const notice = d.pick(["7 days", "14 days", "a month", "two weeks", "a week", "30 days"]);
      const amount = d.amount() as { text: string };
      const text = `Anyone may join ${name}.${dues ? ` Members pay ${amount.text} a month.` : " Nothing is asked but to come."}`;
      const commitment = dues ? { who: "taker", does: { outcome: { money: { to: account.id, amount: amount.text, for: "dues" } } }, every: "a month" } : { who: "taker", does: { text: "take part" } };
      lines = [call("statement", { kind: id("notice"), visible: id("public"), text: tx(text), offer: { json: { take_up: "join", terms: { commitments: [commitment], termination: [{ party: "taker", notice }] } } } })];
      d.notes.push(`This is a public offer that anyone may take up: to join ${name}${dues ? `, with dues of ${amount.text} a month paid into ${account.id}` : ", asking nothing"}, and a notice of ${notice} to leave (said in exactly those words). It is made to anyone, in public, never to a named person, and is no agreement with anyone. The notice's words are copied exactly: ${text}`);
    }
    const g = goldOf(lines, d, `synthetic: late ${o.kind}`, undefined, o.dropped, { late: true, most: 14 });
    if (!g || seen.has(g.program)) continue;
    seen.add(g.program);
    out.push(g);
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
    const d = new Draw(rand, o.currencies ?? everyCurrency());
    const person = d.maybe(0.6);
    const who = person ? d.personId() : d.orgId();
    const acts = shuffled(person ? ABOUT_A_PERSON : ABOUT_AN_ORG, rand).slice(0, d.maybe(0.3) ? 3 : 2);
    const gold = acts.map((act) => goldOf([act(d, who)], d, "synthetic: piled")).filter((g): g is Gold => !!g);
    if (gold.length === acts.length) out.push(gold);
  }
  return out;
}
