// What a seat needs to find out and could not (the live check of 2026-10-09, finding 4), each within the knowing
// design (docs/design/knowing.md): who holds a post; which names a look-up found nothing under; a person who has no
// name but their id; and that going to see a place is offered in words a seat would recognise. (A paper by its id, and
// a kind in plain words: participants/test/seat-papers.test.ts.)

import { expect, test } from "bun:test";
import type { Observation } from "../src/contracts";
import { tools, type LlmParticipantConfig } from "../src/llm/participant";
import { renderObservation } from "../src/llm/render";

const obs = (channels: object): Observation => ({ t: 0, entity: "city", channels, outcomes: [], inbox: [], drafts: [] }) as unknown as Observation;

test("who's who says who holds a post, which names found nothing, and a person with no name but their id once", () => {
  // As the kernel answers a look-up: a post held by a person carries the person's name; one held by a system of the
  // organisation's own carries the system's title, which is the post's.
  const who = { kind: "directory", entities: [{ entity: "c0297", kind: "person", name: "c0297", participant: "p-c0297" }, { entity: "valuer", kind: "valuer", name: "The valuer" }],
    positions: [{ position: "finance", entity: "city", title: "Finance officer", role: "finance_officer", holder: "finance-system", held_by: "Finance officer" },
      { position: "inspector", entity: "city", title: "Building inspector", role: "inspector", holder: "p-c0412", held_by: "Ada Okafor" },
      { position: "ranger", entity: "city", title: "Ranger", role: "ranger" }, { position: "foreman", entity: "builder", title: "Foreman", holder: "p-c0297", held_by: "c0297" }] };
  const asked = ["finance", "inspector", "ranger", "foreman", "c0297", "valuer", "council clerk", "roads office", "parks office"];
  const text = renderObservation(obs({ who }), { looked: new Map([["who", { named: asked }]]) });
  expect(text).toContain("- post: Finance officer (finance), for city: filled: the office answers for itself, with no person named to it (write to the post, by its id: finance)");
  expect(text).toContain("- post: Building inspector (inspector), for city: held by Ada Okafor");
  expect(text).toContain("- post: Ranger (ranger), for city: vacant: nobody holds it");
  expect(text).toContain("- post: Foreman (foreman), for builder: held by c0297");
  expect(text).toContain("- c0297, a person");
  expect(text).not.toContain("c0297 (c0297)");
  expect(text).toContain("- The valuer (valuer), valuer");
  // The three names that found nothing are said, and how a name is matched.
  expect(text).toContain("Nothing is entered under: council clerk, roads office, parks office. (A name is matched whole: a person or an organisation by its full name or its id; a post by its title, its id or what it is, such as mayor.)");
  // All found: nothing is said of names. None found: as before.
  expect(renderObservation(obs({ who }), { looked: new Map([["who", { named: ["finance"] }]]) })).not.toContain("Nothing is entered under");
  expect(renderObservation(obs({ who: { kind: "directory", entities: [], positions: [] } }), { looked: new Map([["who", { named: ["roads office"] }]]) })).toContain("No one and nothing found by that name.");
});

test("going to see a place is offered where a seat would look for it: in what to do, and at the head of looking", () => {
  const seat = (extra: Partial<LlmParticipantConfig>) => tools({ participant: "x", entity: "city", framing: { disclosure: "simulation", reason: "" }, standing: [], titles: new Map([["mayor/town", "Go and see (takes time: say where)"]]), cadenceDays: 7, draftText: () => "", ...extra });
  const there = seat({ kinds: new Map([["mayor/town", "sites"], ["mayor/files", "records"]]), ways: new Map([["mayor/town", { way: "visit" }]]), onRequest: ["mayor/town", "mayor/files"] });
  const d = (ts: ReturnType<typeof tools>, name: string) => ts.find((t) => t.name === name)!.description;
  expect(d(there, "do")).toEndWith("and to ask someone something, write to them. To find out how a place stands, send someone to go and see it: that is a look too.");
  expect(d(there, "look")).toStartWith("Look into one of your reports yourself, or send someone to go and see a place, when you choose.");
  expect(d(there, "look")).toContain('Places you are not at: "Go and see (takes time: say where)" (mayor/town). Nobody is shown them: name where to send someone (a building by its id, or a piece of ground by its cell, such as cell.3.4; a lot\'s cells are on its plan), up to 16 at a time.');
  // An office with nowhere to send anyone is told nothing of it.
  const desk = seat({ kinds: new Map([["mayor/files", "records"]]), onRequest: ["mayor/files"] });
  expect(d(desk, "do")).toEndWith("and to ask someone something, write to them.");
  expect(d(desk, "look")).toStartWith("Look into one of your reports yourself, when you choose.");
});
