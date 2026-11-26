// The map's words, in plain English for someone who has never seen the platform. One place, so the shared vocabulary
// (src/client/words.ts, lens-core's) can take them over or replace them without hunting through the components.
import type { TownBundle } from "./data";
import { W } from "../words";

export const CITY_WORDS = {
  seat: W.seat,
  Seat: W.Seat,
  hall: "Town hall, where the AI mayor works",
  where: {
    dwelling: "At home", workplace: "At work", classroom: "At school", hall: "At a meeting", waiting: "At the clinic", moving: "On the way", other: "Somewhere else",
  } as Record<string, string>,
  whereLegend: "Each glowing dot is a person, on the building they are in. Its colour says where they are:",
  whereAway: "Out of town, or between places",
  whereGone: "Moved away or died",
  actsTitle: "What the AI mayor does",
  actsLegend: "A gold arc runs from the town hall to whoever the AI mayor's action reached, and fades over a week. Hover one to read it.",
  actsRefused: "A red arc: the town refused the action.",
  hint: "Hover a building or a dot to see who is there. Click one to follow it. Drag to move, scroll to zoom.",
  moreInResearcher: "More layers (elections, papers, networks) are in Researcher mode.",
};

/** A post's or organisation's plain name: "the works manager", "the electoral commission", "a resident". */
export function plainTarget(town: TownBundle, id: string): string {
  const p = town.positions[id];
  if (p) return `the ${p.title.toLowerCase()}`;
  const e = town.entities[id];
  if (e) return /^the /i.test(e.name) ? e.name.replace(/^The /, "the ") : e.kind === "government" ? "the town council" : e.name;
  return "a resident";
}

/** One action in a sentence: "The AI mayor wrote to the works manager". */
export function actSentence(town: TownBundle, act: TownBundle["acts"][number]): string {
  const b = act.blocks[0];
  if (!b) return `${CITY_WORDS.Seat} acted`;
  const to = [...new Set(act.blocks.flatMap((x) => x.to))];
  const who = to.length === 0 ? "" : to.length === 1 ? plainTarget(town, to[0]!) : to.length === 2 ? `${plainTarget(town, to[0]!)} and ${plainTarget(town, to[1]!)}` : `${plainTarget(town, to[0]!)} and ${to.length - 1} others`;
  const kind = (b.kind ?? "").replace(/_/g, " ");
  let verb: string;
  if (b.block === "message") verb = `wrote to ${who || "someone"}`;
  else if (b.block === "publish" && /proposal/.test(kind)) verb = `put a proposal to ${who || "the council"}`;
  else if (b.block === "publish" && /nomination/.test(kind)) verb = "put their name forward for mayor";
  else if (b.block === "publish" && /direction/.test(kind)) verb = `gave an instruction to ${who || "an office"}`;
  else if (b.block === "publish") verb = `published ${kind ? `a ${kind}` : "a notice"}${who ? ` to ${who}` : ""}`;
  else if (b.block === "withdraw") verb = "withdrew an earlier paper";
  else if (b.block === "appoint") verb = "appointed someone to a post";
  else verb = `${b.block.replace(/_/g, " ")}${who ? ` (${who})` : ""}`;
  return `${CITY_WORDS.Seat} ${verb}${act.status === "refused" ? ", and the town refused it" : ""}`;
}
