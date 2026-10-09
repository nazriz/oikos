// Standing work orders (contracts/calls.md; docs/behaviour/standing-work.md): this repository's resolver on the table
// both resolvers are held to (contracts/test/standing-work.json; the engine's reads the same file in
// kernel/crates/resolver/src/resolve.rs), that each act is one the contract accepts, and what the preview says.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calls, canonical } from "@oikos/participants";
import TABLE from "../../contracts/test/standing-work.json";
import { Knowledge } from "../src/knowledge";
import { Preview } from "../src/preview";
import { resolve } from "../src/resolver";

interface Case { name: string; program: string; as?: string; blocks?: unknown[]; asks?: string[] }
const CASES = TABLE.cases as Case[];
const seat = () => { const k = new Knowledge(TABLE.currency); k.absorb(TABLE.observation as any); return k; };

test("every case of the shared table: the acts, or the questions back", () => {
  expect(JSON.stringify(TABLE.observation)).toBe(canonical(TABLE.observation));
  expect(CASES.length).toBeGreaterThanOrEqual(23);
  const k = seat();
  for (const c of CASES) {
    const r = resolve(calls.parseProgram(c.program), k, () => undefined, c.as);
    expect({ name: c.name, ...(r.ok ? { blocks: r.blocks } : { asks: r.questions }) } as any).toEqual({ name: c.name, ...(c.blocks ? { blocks: c.blocks } : { asks: c.asks }) });
  }
});

test("every act in the table is one the contract accepts, and the call's new arguments are the contract's", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  const schemas = ["blocks", "common", "records", "world-config", "participant-api", "log", "calls", "outcomes", "dataset", "module"].map((f) => JSON.parse(readFileSync(join(import.meta.dir, `../../contracts/${f}.schema.json`), "utf8")));
  for (const s of schemas) ajv.addSchema(s);
  const valid = ajv.getSchema(`${schemas[0].$id}#/$defs/Block`)!;
  for (const c of CASES) for (const b of c.blocks ?? []) expect({ name: c.name, errors: valid(b) ? null : valid.errors }).toEqual({ name: c.name, errors: null });
  for (const arg of ["every", "first", "until"]) expect(calls.ARGS.work!.allowed!.has(arg)).toBe(true);
  expect(calls.ARGS.work!.required).toEqual(["task", "at"]);
  expect(calls.contractErrors(calls.parseProgram('work(task=collect, at=town-hall, every="7 days")'))).toEqual([]);
  expect(calls.contractErrors(calls.parseProgram('goods(kind=waste, quantity="3", at=town-hall, until="7 days")'))).toEqual(["line 1: goods takes no argument until"]);
});

test("an order that ends says the moment it ends, counted from when it is made", () => {
  const k = seat();
  const r = resolve(calls.parseProgram('work(task=collect, at=town-hall, every="weekly", first="3 days", until="8 weeks")'), k, () => undefined, "works");
  expect(r.ok && (r.blocks[0] as any).data).toEqual({ work: { task: "collect", at: "town-hall" }, every: 7 * 86_400, first: 3 * 86_400, until: TABLE.observation.t + 56 * 86_400 });
});

test("the preview of a standing order, and of a hold on one: what will happen, and that nothing is done now", () => {
  const k = seat();
  const preview = (src: string) => { const r = resolve(calls.parseProgram(src), k, () => undefined, "works"); if (!r.ok) throw new Error(r.questions.join(" ")); return new Preview(k, "city").of(r.blocks); };
  expect(preview('work(task=collect, at=town-hall, every="7 days")')).toBe('You will put a standing work order on your own file: "Standing work order: collect at town-hall, every 7 days.". Nothing is done now: the staff whose work it is follow it each time it falls due, in their own working hours, while it stands. It is in force as soon as it is on file. To change it, withdraw it and make another; to pause it, put it on hold.');
  expect(preview('work(task=collect, at=town-hall, by="Sam Okoro", every="7 days")')).toContain("on your own file, shown to Sam Okoro (c0061):");
  expect(preview("statement(hold=rec.70)")).toStartWith("You will tell your own staff, on your own file, to hold rec.70, seen only by you.");
});
