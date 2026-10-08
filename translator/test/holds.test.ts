// A hold, an entry on one's own file and the refusal sentences (contracts/calls.md; docs/design/call-language-gaps.md
// B.1, B.2, B.5): this repository's resolver on the table both resolvers are held to (contracts/test/holds.json; the
// engine's reads the same file in kernel/crates/resolver/src/resolve.rs), and what the preview says of each.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import HOLDS from "../../contracts/test/holds.json";
import { LABEL_TEXT } from "../src/index";
import { Knowledge } from "../src/knowledge";
import { Preview } from "../src/preview";
import { resolve } from "../src/resolver";

interface Case { name: string; program: string; as?: string; blocks?: unknown[]; asks?: string[] }
const CASES = HOLDS.cases as Case[];

function seat(): Knowledge {
  const k = new Knowledge(HOLDS.currency);
  k.absorb(HOLDS.observation as any);
  return k;
}

test("every case of the shared table: the acts, or the questions back", () => {
  const k = seat();
  expect(CASES.length).toBeGreaterThan(15);
  for (const c of CASES) {
    const r = resolve(calls.parseProgram(c.program), k, () => undefined, c.as);
    expect({ name: c.name, ...(r.ok ? { blocks: r.blocks } : { asks: r.questions }) } as any).toEqual({ name: c.name, ...(c.blocks ? { blocks: c.blocks } : { asks: c.asks }) });
  }
});

test("every act in the table is one the contract accepts", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  const schemas = ["blocks", "common", "records", "world-config", "participant-api", "log", "calls", "outcomes", "dataset", "module"].map((f) => JSON.parse(readFileSync(join(import.meta.dir, `../../contracts/${f}.schema.json`), "utf8")));
  for (const s of schemas) ajv.addSchema(s);
  const valid = ajv.getSchema(`${schemas[0].$id}#/$defs/Block`)!;
  for (const c of CASES) for (const b of c.blocks ?? []) expect({ name: c.name, errors: valid(b) ? null : valid.errors }).toEqual({ name: c.name, errors: null });
});

test("the program parses as the contract's schema says, with the new argument and the new label", () => {
  expect(calls.contractErrors(calls.parseProgram("statement(hold=rec.44)"))).toEqual([]);
  expect(calls.contractErrors(calls.parseProgram('money(to=acc-9, amount="5", hold=rec.44)'))).toEqual(["line 1: money takes no argument hold"]);
  expect(calls.parseProgram("none(look_first)")).toEqual({ none: "look_first" });
  expect(calls.LABELS).toContain("look_first");
  expect(calls.ARGS.statement!.allowed!.has("hold")).toBe(true);
});

test("the sentence for look_first names nothing: it is the same whatever was asked and whatever the seat knows", () => {
  const empty = new Knowledge(HOLDS.currency);
  const said = (k: Knowledge) => resolve(calls.parseProgram("none(look_first)"), k);
  expect(said(empty)).toEqual(said(seat()));
  expect(said(empty)).toEqual({ ok: false, questions: [LABEL_TEXT.look_first] });
  // No id, no name and no number in it: nothing of the world.
  expect(LABEL_TEXT.look_first).not.toMatch(/[0-9]|rec\.|acc-|bank/i);
});

test("the preview of a hold and of an entry: what will happen, and what won't", () => {
  const k = seat();
  const preview = (src: string) => {
    const r = resolve(calls.parseProgram(src), k, () => undefined, "finance");
    if (!r.ok) throw new Error(r.questions.join(" "));
    return new Preview(k, "city").of(r.blocks);
  };
  expect(preview("statement(hold=rec.44)")).toBe('You will instruct Millbrook Bank (bank) to hold rec.44, seen only by you, Millbrook Bank (bank). It stays on record. This by itself stops nothing and settles nothing: whoever you instruct acts on it, or doesn\'t, and whatever it was for is still owed. To resume it, withdraw this instruction. Your instruction will read: "Please hold rec.44: nothing is to be done under it until this is withdrawn.".');
  expect(preview('statement(hold=["rec.44","rec.45"], text="While the payroll is checked.", basis=rec.50)')).toBe('You will instruct Millbrook Bank (bank) to hold rec.44, rec.45, seen only by you, Millbrook Bank (bank), citing rec.50. They stay on record. This by itself stops nothing and settles nothing: whoever you instruct acts on it, or doesn\'t, and whatever they were for is still owed. To resume them, withdraw this instruction. Your instruction will read: "While the payroll is checked.".');
  expect(preview('statement(kind=entry, visible=own, text="Tax withheld, to be passed on.", basis=rec.44)')).toBe('You will put an entry on your own file, seen by nobody else: "Tax withheld, to be passed on.", citing rec.44. It moves nothing and tells nobody.');
  // A statement seen by one other party is not an entry on one's own file.
  expect(preview('statement(kind=note, visible=bank, text="For your file.")')).toStartWith("You will publish a note, seen only by Millbrook Bank (bank)");
});
