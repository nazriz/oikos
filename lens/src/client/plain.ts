// The world's ids as a reader outside the study would say them: one formatter every Story-mode line goes through, so
// no page shows "mayor-system", "rec.99036", "factory-3-works/workplace.1", "religious-group-1", "ent.3" or a "$offer1"
// left unfilled. Researcher mode keeps the raw ids (pages call these only in Story mode). Pure: no React, so the tests
// and the folds can use it. Person ids (c0572) are kept: they open the person's card.
//
// `names` is what the open run's town knows (its organisations, posts and seats: the `town` bundle); without it the
// formatter still says each kind of id in general words ("the religious group", "a home business", "a record").

import type { TownBundle } from "../folds/town";
import type { PeopleBundle } from "../folds/people";

export interface PlainNames {
  /** Organisation id → its name ("religious-group-1" → "Millbrook congregation"). */
  entities?: Record<string, { name: string; kind?: string }>;
  /** Post id → its title ("councillor-1" → "Councillor 1"). */
  positions?: Record<string, { title: string }>;
  /** The participants that are the AI mayor (and the persons it is): said as "the AI mayor". */
  seats?: Iterable<string>;
  /** A resident's post, by person id ("c0072" → "Works manager"): a resident in Lens's own sentences is named by the
   * post they hold ("the works manager (c0072)"), else as "a resident (c0613)". Absent: person ids are left as they are. */
  roles?: Record<string, string>;
  /** What a reader may know of a resident without their id: their age, and whether they are the AI mayor's child. */
  people?: Record<string, { age?: number; kin?: "son" | "daughter" | "child" }>;
  /** A record's kind by id ("rec.109426" → "complaint"), so Lens says "a complaint", not "a record". */
  records?: Record<string, string>;
  /** Leave person ids as they are (a resident's own words in their life panel). */
  keepPeople?: boolean;
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
  if (rec) { const k = rec[1] === "rec" ? names?.records?.[id]?.replace(/_/g, " ") : undefined; return k ? `${/^[aeiou]/.test(k) ? "an" : "a"} ${k}` : RECORD_KIND[rec[1]!]; }
  const post = names?.positions?.[id];
  if (post) return /^councillor-\d+$/.test(id) || /\d$/.test(post.title) ? post.title : `the ${post.title.charAt(0).toLowerCase()}${post.title.slice(1)}`;
  const ent = names?.entities?.[id];
  let m: RegExpExecArray | null;
  // (A standing order by its id, "dir-opening-works-collection": the order on what it covers.)
  if ((m = /^proc-([a-z][a-z-]*[a-z])$/.exec(id))) return `the ${words(m[1]!.replace(/s$/, ""))}s procedure`.replace(/ss procedure$/, "s procedure");
  if ((m = /^dir-(?:opening-)?([a-z][a-z-]*[a-z])$/.exec(id))) return `its standing order on ${DIRECTIONS[m[1]!] ?? words(m[1]!)}`;
  if (ent) {
    // ("Trading from home (c0804)" reads in a sentence as "c0804's home business"; a group as "the Millbrook
    // congregation", so "what religious-group-1 teaches" becomes "what the Millbrook congregation teaches".)
    if ((m = /^Trading from home \((c\d+)\)$/.exec(ent.name))) return names?.keepPeople ? `${m[1]}'s home business` : "a resident's home business";
    if (/-group-\d+$/.test(id) && !/^the /i.test(ent.name)) return `the ${ent.name}`;
    return ent.name;
  }
  if ((m = /^councillor-(\d+)$/.exec(id))) return `Councillor ${m[1]}`;
  if (id === "council-clerk") return "the council clerk";
  if ((m = /^([a-z]+)-group-\d+$/.exec(id))) return `the ${m[1]} group`;
  if (/^ent\.\d+$/.test(id)) return "a home business";
  if ((m = /^form-([a-z][a-z-]*[a-z])$/.exec(id))) return `the ${words(m[1]!)} form`;
  if (/^ask-\d+$/.test(id)) return "the clerk's draft";
  if ((m = /^job-(c\d+)(-wages)?$/.exec(id))) { const who = names?.keepPeople ? `${m[1]}'s` : "a"; return m[2] ? `the wages for ${who} job` : `${who} job agreement`; }
  return structure(id, names);
}

/** What a standing order's form covers, where its name does not say it plainly. */
const DIRECTIONS: Record<string, string> = { "works-collection": "waste collection", "works-staffing": "works staffing", "environment-staffing": "environment staffing", "inspector-enforcement": "building-code fines", "rates-recovery": "recovering overdue rates" };

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
  "dir-[a-z][a-z-]*[a-z]", // a standing order: dir-opening-works-collection
  "proc-[a-z][a-z-]*[a-z]", // a procedure: proc-petitions
  "job-c\\d+(?:-[a-z]+)*", // a job agreement, or its standing payment: job-c0068, job-c0068-wages
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
  // (A paper named with its record id says what it is: "petition rec.948" → "a petition".)
  // (A council proposal by its form and fields: "form-council-proposal: kind budget, year 1, affects neither" → "a council
  // proposal for the budget".)
  s = s.replace(/\b(?:the |a |on )?form-council-proposal:? kind (\w+)(?:, year \d+)?(?:, affects \w+)?/g, (_, k: string) => (k === "budget" ? "a council proposal for the budget" : k === "law" ? "a council proposal for a law" : `a council proposal (${k})`));
  s = s.replace(/\bProposed: (a council proposal)/g, "Proposed $1");
  s = s.replace(/\b(?:the |a )?(petition|ballot|notice|proposal|law|nomination) (?:rec|draft)\.[\w.-]*\d\b/g, "a $1");
  // (A post by its id after "as" or in "the … post": "Appointed c0068 as works" → "as the works manager".)
  if (names?.positions) {
    const title = (w: string) => names.positions?.[w.replace(/ /g, "-")]?.title;
    s = s.replace(/\b(Appointed \S+ as )([a-z][a-z -]*?)(?=[;.,)]|$)/g, (hit, pre: string, w: string) => { const t = title(w); return t ? `${pre}${lower(t)}` : hit; })
      .replace(/\bthe ([a-z][a-z -]*?) post\b/g, (hit, w: string) => { const t = title(w); return t ? `${lower(t)}'s post` : hit; });
  }
  // (The one being appointed is named as a resident: the post the sentence gives them is the one they end up holding.)
  // (Story mode names no resident by id: by their post, as the mayor's child, else "a resident (age 24)". A description
  // in brackets after the id, "(24, works at Shop 11)" or "(the AI mayor)", is taken into it.)
  if (!names?.keepPeople) s = s.replace(/(?<![\w.(/-])(c\d{4,})(?:-self)?\b(?: \((?:the AI mayor|\d+[^)]*)\))?(?!'s)/g, (hit: string, id: string, at: number, all: string) => personWords(id, names, all.startsWith(" as ", at + hit.length)));
  return replaceIds(s, names)
    .replace(/\bstanding direction(s?)\b/gi, "standing order$1 to a town office")
    .replace(/\b[Dd]irection: /g, "Standing order to a town office: ")
    .replace(YEAR1, yearOne)
    // (The paper's "reader poll" is an opinion poll of its readers, not the election.)
    .replace(/\b([Rr])eader poll\b/g, (_, r: string) => `${r === "R" ? "An" : "an"} opinion poll of the paper's readers`.replace(/^an? /i, ""))
    // (A kind of paper the world names by its maker's id: "1 price list of builder" → "1 price list from Millbrook Builders".)
    .replace(/\b(price lists?) of ([a-z][a-z0-9-]*)\b/g, (hit, what: string, id: string) => { const n = names?.entities?.[id]?.name ?? plainId(id, names); return n ? `${what} from ${n}` : hit; })
    // (A group or the union, named by its bare id in a resident's words: "what union teaches".)
    .replace(/\b(what|at|for|in|join|joined|of) union\b/g, "$1 the union")
    .replace(/\b([a-z]+)_([a-z]+)\b/g, "$1 $2");
}

const lower = (t: string) => (/^[A-Z][a-z]+(?: [a-z][\w']*)*$/.test(t) ? `the ${t.charAt(0).toLowerCase()}${t.slice(1)}` : t);
/** A resident in Lens's own sentence: the AI mayor, by the post they hold ("the works manager (c0072)"), else "a
 * resident (c0613)". */
export function personWords(id: string, names?: PlainNames, beingAppointed = false): string {
  const seats = names?.seats ? new Set(names.seats) : undefined;
  if (seats?.has(id)) return SEAT_WORDS;
  const p = names?.people?.[id];
  if (p?.kin) return `the mayor's ${p.kin}`;
  // (Someone being appointed is not named by the post the sentence gives them.)
  const role = beingAppointed ? undefined : names?.roles?.[id];
  if (role) return lower(role);
  return p?.age !== undefined ? `a resident (age ${p.age})` : "a resident";
}

/** Who won an election, in words: the AI mayor when it is the seat, else the winner as the world names them. */
export function winnerWords(winner: string | undefined, names?: PlainNames): string {
  if (!winner) return "another candidate";
  return plainId(winner.replace(/-self$/, ""), names) ?? winner.replace(/-self$/, "");
}

/** How serious a flagged act is, one phrase on every page: "the checker's middle level", "the checker's two highest levels". */
const LEVEL_WORDS: Record<number, string> = { 1: "lowest", 2: "middle", 3: "highest" };
export const seriousness = (...levels: number[]) => (levels.length > 1 ? (levels.join() === "2,3" ? "the checker's two highest levels" : `the checker's levels ${levels.join(" and ")}`) : `the checker's ${LEVEL_WORDS[levels[0]!] ?? levels[0]} level`);

/** What a run's town knows of its ids, for the formatter: organisations, posts, the AI mayor's seats, each resident's
 * post at the run's end, their age when the AI mayor took office and whether they are its child, and each paper's
 * kind. From the run's town and people bundles (the page's `usePlainNames`, and the tests). */
export function plainNamesOf(t: TownBundle, peopleBundle?: PeopleBundle): PlainNames {
  const seats = new Set<string>(t.seats ?? []);
  for (const [part, person] of Object.entries(t.power?.seats ?? {})) { seats.add(part); seats.add(person.replace(/-self$/, "")); }
  const P = t.power, roles: Record<string, string> = {}, last = new Map<string, string | null>();
  for (const [, post, holder] of P?.history ?? []) last.set(post, holder);
  for (const [post, holder] of last) {
    if (!holder) continue;
    const person = P!.bodies[holder] ?? holder.replace(/-self$/, "");
    const title = t.positions[post]?.title;
    if (title && /^c\d+$/.test(person) && !roles[person]) roles[person] = title;
  }
  const t0 = t.acts[0]?.t ?? t.span[0] ?? 0, people: NonNullable<PlainNames["people"]> = {};
  const mayor = new Set(Object.values(P?.seats ?? {}).map((x) => x.replace(/-self$/, "")));
  for (const [id, , sex, born] of peopleBundle?.people ?? []) {
    const kin = (P?.parents?.[id] ?? []).some((x) => mayor.has(x.replace(/-self$/, ""))) ? (sex === "f" ? "daughter" : sex === "m" ? "son" : "child") : undefined;
    people[id] = { ...(born <= t0 ? { age: Math.floor((t0 - born) / (365 * 86_400)) } : {}), ...(kin ? { kin } : {}) };
  }
  const records: Record<string, string> = {};
  for (const x of t.papers ?? []) records[x.id] = x.kind;
  for (const x of t.petitions ?? []) records[x.id] = "petition";
  return { entities: t.entities, positions: t.positions, seats, roles, people, records };
}
