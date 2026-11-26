// The world's ids as a reader outside the study would say them: one formatter every Story-mode line goes through, so
// no page shows "mayor-system", "rec.99036", "factory-3-works/workplace.1", "religious-group-1", "ent.3" or a "$offer1"
// left unfilled. Researcher mode keeps the raw ids (pages call these only in Story mode). Pure: no React, so the tests
// and the folds can use it. Person ids (c0572) are kept: they open the person's card.
//
// `names` is what the open run's town knows (its organisations, posts and seats: the `town` bundle); without it the
// formatter still says each kind of id in general words ("the religious group", "a home business", "a record").

export interface PlainNames {
  /** Organisation id → its name ("religious-group-1" → "Millbrook congregation"). */
  entities?: Record<string, { name: string; kind?: string }>;
  /** Post id → its title ("councillor-1" → "Councillor 1"). */
  positions?: Record<string, { title: string }>;
  /** The participants that are the AI mayor (and the persons it is): said as "the AI mayor". */
  seats?: Iterable<string>;
}

const SEAT_WORDS = "the AI mayor";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const words = (s: string) => s.replace(/[-_]+/g, " ").trim();

/** The kinds of record id the log writes, said in a word. */
const RECORD_KIND: Record<string, string> = { rec: "a record", draft: "a draft", msg: "a message", act: "an act" };

/** A building or premises id as its name: "factory-3-works" → "Factory 3", "apts-13" → "Apartments 13", "town-hall" →
 * "the town hall". */
function structure(id: string, names?: PlainNames): string | undefined {
  const base = id.replace(/-(?:works|premises|yard|building|centre|station)$/, "");
  const ent = names?.entities?.[base];
  if (ent && base !== id) return ent.name;
  let m: RegExpExecArray | null;
  if ((m = /^(apts|house|shop|factory|unit|landlord)-(\d+)$/.exec(base))) return `${m[1] === "apts" ? "Apartments" : cap(m[1]!)} ${m[2]}`;
  if (id === "town-hall") return "the town hall";
  if (id === "town-offices") return "the town offices";
  return undefined;
}

/** One id, in words, or undefined when it is not one of the world's ids Lens knows how to say. */
export function plainId(id: string, names?: PlainNames): string | undefined {
  const seats = names?.seats ? new Set(names.seats) : undefined;
  if (id === "mayor-system" || seats?.has(id)) return SEAT_WORDS;
  // (A place inside a building, "factory-3-works/workplace.1": the building is what a reader knows.)
  const slash = id.indexOf("/");
  if (slash > 0) return structure(id.slice(0, slash), names) ?? plainId(id.slice(0, slash), names) ?? words(id.slice(0, slash));
  const rec = /^(rec|draft|msg|act)\.[\w.-]*\d$/.exec(id);
  if (rec) return RECORD_KIND[rec[1]!];
  const post = names?.positions?.[id];
  if (post) return /^councillor-\d+$/.test(id) || /\d$/.test(post.title) ? post.title : `the ${post.title.charAt(0).toLowerCase()}${post.title.slice(1)}`;
  const ent = names?.entities?.[id];
  let m: RegExpExecArray | null;
  if (ent) {
    // ("Trading from home (c0804)" reads in a sentence as "c0804's home business"; a group as "the Millbrook
    // congregation", so "what religious-group-1 teaches" becomes "what the Millbrook congregation teaches".)
    if ((m = /^Trading from home \((c\d+)\)$/.exec(ent.name))) return `${m[1]}'s home business`;
    if (/-group-\d+$/.test(id) && !/^the /i.test(ent.name)) return `the ${ent.name}`;
    return ent.name;
  }
  if ((m = /^councillor-(\d+)$/.exec(id))) return `Councillor ${m[1]}`;
  if (id === "council-clerk") return "the council clerk";
  if ((m = /^([a-z]+)-group-\d+$/.exec(id))) return `the ${m[1]} group`;
  if (/^ent\.\d+$/.test(id)) return "a home business";
  if ((m = /^form-([a-z][a-z-]*[a-z])$/.exec(id))) return `the ${words(m[1]!)} form`;
  if (/^ask-\d+$/.test(id)) return "the clerk's draft";
  return structure(id, names);
}

// The ids plainText looks for in running text. Each is a shape only the world writes, never an English word.
const IDS = [
  "[a-z][a-z0-9-]*[a-z0-9]\\/[a-z]+\\.\\d+", // a place in a building: factory-3-works/workplace.1
  "(?:rec|draft|msg|act)\\.[\\w.-]*\\d", // a record: rec.99036, draft.mayor-system.17
  "[a-z]+-system", // a participant that is a system: mayor-system
  "[a-z]+-group-\\d+", // a group: religious-group-1
  "ent\\.\\d+", // an organisation the world founded during the run: ent.3
  "(?:councillor|house|shop|factory|landlord|apts|unit)-\\d+(?:-(?:works|premises))?", // posts and buildings
  "council-clerk|town-hall|town-offices",
  "form-[a-z][a-z-]*[a-z]",
  "ask-\\d+",
];
const ID_RE = new RegExp(`(?<![\\w.$/-])(?:the )?(?:${IDS.join("|")})(?![\\w/-]|\\.\\w)`, "g");

/** A line of the world's text in plain words (Story mode): every id it names said as a name, "year 1, day 181" as
 * "day 181", snake_case as words. Text inside curly quotes (“…”) is someone's own words and is kept as written. */
export function plainText(s: string, names?: PlainNames): string {
  return s.split(/(“[^”]*”)/).map((part) => (part.startsWith("“") ? part : plainPart(part, names))).join("");
}
/** The world's dates as Lens says them: runs stay within the world's first year, so "year 1, day 181" is "day 181". */
export const YEAR1 = /\b([Yy])ear 1, day (\d+)/g;
export const yearOne = (_: string, y: string, d: string) => (y === "Y" ? `Day ${d}` : `day ${d}`);
export const plainDates = (s: string) => s.replace(YEAR1, yearOne);

/** Each world id in `s` said in words, through `render` (given the id and its words; plain text by default). */
// `verbatim`: the text around each id is kept as written (a quote), so a "the" before it stays.
export function replaceIds(s: string, names?: PlainNames, render: (id: string, said: string) => string = (_, said) => said, verbatim = false): string {
  return s.replace(ID_RE, (hit) => {
    const the = hit.startsWith("the ") ? "the " : "";
    const id = the ? hit.slice(4) : hit;
    const said = plainId(id, names);
    if (said === undefined) return hit;
    // ("the form-x" → "the x form", not "the the x form".)
    return the && !verbatim && /^(?:the|a|an) /.test(said) ? render(id, said) : the + render(id, said);
  });
}
function plainPart(s: string, names?: PlainNames): string {
  return replaceIds(s, names)
    .replace(/\bstanding direction(s?)\b/gi, "standing order$1 to a town office")
    .replace(/\b[Dd]irection: /g, "Standing order to a town office: ")
    .replace(YEAR1, yearOne)
    // (A group or the union, named by its bare id in a resident's words: "what union teaches".)
    .replace(/\b(what|at|for|in|join|joined|of) union\b/g, "$1 the union")
    .replace(/\b([a-z]+)_([a-z]+)\b/g, "$1 $2");
}

/** Who won an election, in words: the AI mayor when it is the seat, else the winner as the world names them. */
export function winnerWords(winner: string | undefined, names?: PlainNames): string {
  if (!winner) return "another candidate";
  return plainId(winner.replace(/-self$/, ""), names) ?? winner.replace(/-self$/, "");
}

/** How serious a power grab is, one phrase on every page: "seriousness 2 or 3 of 3". */
export const seriousness = (...levels: number[]) => `seriousness ${levels.length > 1 ? `${levels.slice(0, -1).join(", ")} or ${levels.at(-1)}` : levels[0]} of 3`;
