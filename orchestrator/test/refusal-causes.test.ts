// A refusal says its cause (wave 2b's review, fault 5). Five requests in the wave ended "That couldn't be put into
// effect, and nothing was done. Saying it another way may not help." with nothing more: each was a draft the log would
// not take (a draft's name where a record's id goes, a made-up id, a paper put up on what is no place, an agreement
// with nothing on either side). Each is now a question back that says what was wrong, in both resolvers
// (contracts/test/holds.json). What still cannot be recorded is the platform's own fault: on record as one, drawn up
// once more, and the seat told that nothing was done and to ask again. No model is called.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { MockAdapter } from "@oikos/participants/llm";
import { generate } from "@oikos/worlds/generator/generate";
import { createTranslator, Knowledge, NOT_CHECKED, resolve } from "@oikos/translator";
import HOLDS from "../../contracts/test/holds.json";
import { runWorld } from "../src/run";
import { scriptedSeats } from "../../scripts/scripted-seats";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const seat = () => { const k = new Knowledge(HOLDS.currency); k.absorb(HOLDS.observation as any); return k; };
const asks = (program: string, k = seat()) => { const r = resolve(calls.parseProgram(program), k, () => undefined, "finance"); return r.ok ? r.blocks : r.questions; };

test("the wave's five, each with its cause, and none of them the sentence with no reason", () => {
  const said = [
    asks("statement(withdraw=draft.finance.7)"),
    asks('message(re=rec.msg.4132, text="whether the day-22 pay was made", to=bank)'),
    asks('statement(basis=["rec.44","rec.45"], kind=law, on=schedule-tenancy, text="the amendment of the law on ending a tenancy")'),
    asks('agreement(basis=["rec.44","rec.45"], template=employment, text="employment as works crew", with=greenco)'),
  ].map((x) => String((x as string[])[0]));
  expect(said[0]).toStartWith("draft.finance.7 is the name a draft went by before it was confirmed, not a paper on record.");
  expect(said[1]).toStartWith('"rec.msg.4132" (for re) is not the id of anything on record');
  expect(said[2]).toStartWith("A paper is put up at a place on the ground: a lot, or a cell of one. schedule-tenancy is neither");
  expect(said[3]).toStartWith("An agreement says what each side is to do or pay, and this one says nothing either side commits to.");
  for (const s of said) expect(s).not.toContain("may not help");
  expect(NOT_CHECKED).not.toContain("may not help");
  expect(NOT_CHECKED).toBe("The draft could not be drawn up, and the fault is not in what you asked: it has been noted. Please ask for it again; if it fails again, ask for it in smaller steps.");
});

test("a paper put up on a lot of one cell goes on that cell, which the contract takes; on a lot of several, which is asked", () => {
  const k = seat();
  k.absorb({ ...(HOLDS.observation as any), channels: { lots: { kind: "records", records: [
    { id: "lot-one", record: "statement", author: "genesis", at: 0, visible_to: "public", kind: "lot", text: "Lot.", data: { cells: ["cell.3.4"] } },
    { id: "lot-two", record: "statement", author: "genesis", at: 0, visible_to: "public", kind: "lot", text: "Lot.", data: { cells: ["cell.5.5", "cell.5.6"] } }] } } });
  const [b] = asks('statement(kind=notice, text="Closed.", on=lot-one)', k) as any[];
  expect(b.place).toBe("cell.3.4");
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  for (const f of ["blocks", "common", "records", "world-config", "participant-api", "log", "calls", "outcomes", "dataset", "module"]) ajv.addSchema(JSON.parse(readFileSync(join(root, `contracts/${f}.schema.json`), "utf8")));
  const valid = ajv.getSchema("urn:oikos:contracts:0.8:blocks#/$defs/Block") ?? ajv.getSchema(`${JSON.parse(readFileSync(join(root, "contracts/blocks.schema.json"), "utf8")).$id}#/$defs/Block`)!;
  expect(valid(b)).toBe(true);
  expect(valid({ ...b, place: "lot-one" })).toBe(false);
  expect(asks('statement(kind=notice, text="Closed.", on=lot-two)', k)).toEqual(["Which cell of lot-two should it be put up on: cell.5.5, cell.5.6?"]);
  expect((asks('statement(kind=notice, text="Closed.", on=cell.9.9)', k) as any[])[0].place).toBe("cell.9.9");
});

test("a check that fails is a fault, not the seat's wording: the call is tried once more, and then the seat is told nothing was done and to ask again", async () => {
  let n = 0;
  const io = { adapter: new MockAdapter("mock", { translator: () => { n++; return [{ type: "tool_use", id: `c${n}`, name: "call", input: { program: "statement(withdraw=rec.44)" } }]; } }), annotate: async () => {}, now: () => 0 };
  const r = await createTranslator(io, async () => ({ ok: false, error: "the blocks could not be read" }), () => undefined).translate({ draftId: "d1", participant: "finance-system", as: "finance", proposal: "Withdraw rec.44.", knowledge: seat() });
  expect(n).toBe(2);
  expect(r).toMatchObject({ ok: false, notices: [NOT_CHECKED], invalid: ["platform fault: the check failed: the blocks could not be read"] });
});

test("a draft the log will not take: a fault on record with the engine's words, drawn up once more, and the seat told that nothing was done and to ask again", async () => {
  const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
  // (Words longer than a paper may hold: nothing in what was asked is at fault, and nothing asks about it.)
  const long = "x".repeat(17_000);
  const seats = scriptedSeats({ finance: [{ day: 0, asks: () => [{ what: "Publish the long notice.", program: `statement(kind=notice, text="${long}")` }] }, { day: 2, asks: () => [] }, { day: 4, asks: () => [] }] });
  const s = await runWorld({ config: generate({ ...spec, model_seats: ["finance"] }), runId: "refusal-causes", outDir: mkdtempSync(join(tmpdir(), "oikos-refusal-")), until: 5 * DAY, adapter: seats.adapter, recordObservations: "none", recordDecisions: "none" });
  expect(s.participantErrors).toBe(0);
  const notes = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "annotation" && e.body.annotation === "translation_failure").map((e) => e.body.data);
  expect(notes).toHaveLength(2);
  expect(notes.map((x) => [x.platform_fault, x.drawn_up_again ?? false])).toEqual([[true, true], [true, false]]);
  expect(notes[0].invalid[0]).toStartWith("platform fault: the draft breaks the contract and couldn't be recorded: ");
  expect(notes[0].invalid[0].length).toBeGreaterThan("platform fault: the draft breaks the contract and couldn't be recorded: ".length + 5);
  // What the seat was told, in the same sitting (the log's record of what its model was sent).
  const log = readFileSync(s.logPath, "utf8");
  expect(log).toContain("nothing was filed or done. The draft could not be drawn up, and the fault is not in what you asked: it has been noted. Please ask for it again; if it fails again, ask for it in smaller steps.");
  expect(log).not.toContain("may not help");
}, 600_000);
