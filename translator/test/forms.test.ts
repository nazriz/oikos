// Forms (contracts/calls.md; docs/behaviour/directions.md): a direction filed on an office's own form. This
// repository's resolver on the table both resolvers are held to (contracts/test/forms.json; the engine's reads the
// same file in kernel/crates/resolver/src/resolve.rs), what the translator is shown of such a form, and what the
// preview says of a direction.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calls, canonical } from "@oikos/participants";
import FORMS from "../../contracts/test/forms.json";
import { formShown } from "../src/index";
import { Knowledge } from "../src/knowledge";
import { Preview } from "../src/preview";
import { durationWords, resolve } from "../src/resolver";

interface Case { name: string; program: string; as?: string; blocks?: unknown[]; asks?: string[] }
const CASES = FORMS.cases as Case[];

function seat(): Knowledge {
  const k = new Knowledge(FORMS.currency);
  k.absorb(FORMS.observation as any);
  return k;
}

test("the table's records are as a seat is shown them: every object's keys in order", () => {
  // (Both resolvers read a form's fields in the order the record has them; the engine writes a record's keys in order.)
  expect(JSON.stringify(FORMS.observation)).toBe(canonical(FORMS.observation));
});

test("every case of the shared table: the acts, or the questions back", () => {
  const k = seat();
  expect(CASES.length).toBeGreaterThanOrEqual(12);
  for (const c of CASES) {
    const r = resolve(calls.parseProgram(c.program), k, () => undefined, c.as);
    expect({ name: c.name, ...(r.ok ? { blocks: r.blocks } : { asks: r.questions }) } as any).toEqual({ name: c.name, ...(c.blocks ? { blocks: c.blocks } : { asks: c.asks }) });
  }
});

test("every act in the table is one the contract accepts, and every form in it is a form as the contract has one", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  const schemas = ["blocks", "common", "records", "world-config", "participant-api", "log", "calls", "outcomes", "dataset", "module"].map((f) => JSON.parse(readFileSync(join(import.meta.dir, `../../contracts/${f}.schema.json`), "utf8")));
  for (const s of schemas) ajv.addSchema(s);
  const block = ajv.getSchema(`${schemas[0].$id}#/$defs/Block`)!;
  for (const c of CASES) for (const b of c.blocks ?? []) expect({ name: c.name, errors: block(b) ? null : block.errors }).toEqual({ name: c.name, errors: null });
  const form = ajv.getSchema("urn:oikos:contracts:0.8:outcomes#/$defs/FormData")!;
  for (const f of seat().forms) expect({ form: f.id, errors: form(f.data) ? null : form.errors }).toEqual({ form: f.id, errors: null });
});

test("a form that is one office's is shown to the translator as going to that office", () => {
  const shown = seat().forms.map(formShown);
  expect(shown).toContain("- works_staffing, to=works, id form-works-staffing: fields posts (count), recruit (one of yes | no, required)");
  expect(shown).toContain("- environment_staffing, to=environment, id form-environment-staffing: fields posts (count), recruit (one of yes | no, required)");
  // A form of the whole organisation's goes where it did.
  expect(shown).toContain("- permit_application, to=city, id form-permit: fields lot (lot, required), structure_type (structure_type, required)");
});

test("another office of the same organisation is not where one office's form goes, even when the seat knows that office", () => {
  const k = seat();
  k.absorb({ ...FORMS.observation, channels: { who: { kind: "directory", entities: [], positions: [{ position: "environment", entity: "city", role: "environment_officer", title: "Environment officer" }] } } } as any);
  const r = resolve(calls.parseProgram("form(form=works_staffing, to=environment, recruit=no)"), k, () => undefined, "mayor");
  expect(r).toEqual({ ok: false, questions: ["The works staffing form isn't one environment takes: it goes to works."] });
});

test("the preview of a direction says what is filed and to whom, and nothing of what the office will do", () => {
  const k = seat();
  const r = resolve(calls.parseProgram('form(form=works_collection, to=works, every="2 weeks")'), k, () => undefined, "mayor");
  if (!r.ok) throw new Error(r.questions.join(" "));
  expect(new Preview(k, "city").of(r.blocks)).toBe('You will give the Works manager (works) a written direction on its works collection form (form-works-collection): "works collection: every 14 days.". This by itself changes nothing: the office follows a direction only from those its organisation\'s rules say may direct it, and writes back to say whether it does. It stands until you replace it with another or withdraw it.');
  // Filed by someone as themselves, it says in whose name.
  const own = resolve(calls.parseProgram("form(form=works_staffing, to=works, recruit=no)"), k);
  if (!own.ok) throw new Error(own.questions.join(" "));
  expect(new Preview(k, "c0001").of(own.blocks)).toStartWith('You will give the Works manager (works) a written direction on its works staffing form (form-works-staffing): "works staffing: recruit no."');
});

test("a length of time in words", () => {
  expect([86_400, 14 * 86_400, 3600, 0].map(durationWords)).toEqual(["1 day", "14 days", "1 hour", "0 days"]);
});
