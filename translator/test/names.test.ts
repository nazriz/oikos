// A person or body named by name (docs/design/names-and-dates.md section 4; contracts/calls.md, `ambiguous`): this
// repository's resolver on the table both resolvers are held to (contracts/test/names.json; the engine's reads the same
// file in kernel/crates/resolver/src/resolve.rs). Where the world's people have names, a name the seat knows more than
// one by is asked back with every candidate and what tells each apart on its own file, never guessed; one it knows
// nobody by is not on file. Without names, the old answers.

import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import NAMES from "../../contracts/test/names.json";
import { Knowledge } from "../src/knowledge";
import { LABEL_TEXT, resolve } from "../src/resolver";

interface Case { name: string; names?: boolean; program: string; as?: string; blocks?: unknown[]; asks?: string[]; ambiguous?: unknown[] }
const CASES = NAMES.cases as Case[];

function seat(named: boolean): Knowledge {
  const k = new Knowledge(NAMES.currency, named);
  k.absorb(NAMES.observation as any);
  return k;
}

test("every case of the shared table: the acts, or the questions back and the ambiguity", () => {
  expect(CASES.length).toBeGreaterThanOrEqual(13);
  for (const c of CASES) {
    const r = resolve(calls.parseProgram(c.program), seat(c.names !== false), () => undefined, c.as);
    const got = r.ok ? { blocks: r.blocks } : { asks: r.questions, ...(r.ambiguous ? { ambiguous: r.ambiguous } : {}) };
    const want = { ...(c.blocks ? { blocks: c.blocks } : {}), ...(c.asks ? { asks: c.asks } : {}), ...(c.ambiguous ? { ambiguous: c.ambiguous } : {}) };
    expect({ name: c.name, ...got } as any).toEqual({ name: c.name, ...want });
  }
});

test("`ambiguous` is a label of the call language and the resolver's alone: no translator is taught it", () => {
  expect(calls.LABELS).toContain("ambiguous");
  expect(calls.TRANSLATOR_LABELS as readonly string[]).not.toContain("ambiguous");
  expect(calls.LABELS.filter((l) => l !== "ambiguous")).toEqual([...calls.TRANSLATOR_LABELS]);
  expect(LABEL_TEXT.ambiguous).toMatch(/by their id/);
  // (A translator that writes it is refused as unclear, and the log says why.)
  const r = resolve(calls.parseProgram("none(ambiguous)"), seat(true));
  expect(r).toEqual({ ok: false, questions: [LABEL_TEXT.unclear], invalid: ["`ambiguous` answers a name known by more than one; it is never written for a request"] });
});

test("nothing the seat was not shown: a candidate is told apart only by its own papers, accounts and posts", () => {
  const k = seat(true);
  // (Who the seat was shown a paper about; nobody else, and no paper it was not shown.)
  expect([...k.namedIn.keys()].sort()).toEqual(["c0002", "c0003", "landlord-1", "tribunal"]);
  expect(k.knownBy("c0005")).toEqual([]);
  // (Without names, nothing is kept of who is named where.)
  expect(seat(false).namedIn.size).toBe(0);
});
