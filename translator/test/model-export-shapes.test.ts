// What the call language gained on 2026-10-08 and -09, as the export writes it for the trainer (translator/model/
// export.ts): a hold of one record or a list, the lifting of one, an entry on one's own file, a standing work order
// (every, first, until, on and by as lists), a direction on an office's form and a paper of one's own office (fields
// that are lists and dates), and amounts as every currency drawn writes them. encode.ts is held to an exact rebuild
// by the pipeline's own tests (train-holds, train-forms-work); this holds the step after it: each pointer as whole
// pieces of the input, and the program rebuilt exactly from the pieces. An example the export would cut never
// reaches a model, so none of these kinds may be cut.

import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import type { LlmAdapter, LlmRequest } from "@oikos/participants/llm";
import { decode, encode, vocabulary } from "../model/encode";
import { pieces, row, stepsOf } from "../model/export";
import { cannotSay } from "../model/adapter";
import { generate, literals, type Example, type Gold } from "../train/data";
import { directions, everyCurrency, papers, synthetic } from "../train/synthetic";

const SEED = 11;
const parsed = (program: string) => calls.parseProgram(program) as { lines: calls.Line[] };

/** A writer that says a program's values as they stand, the way the new kinds are worded: a form unnamed, a yes or no
 * and a paper's own office unsaid, the words of a letter asked for indirectly marked. */
let n = 0;
const writer: LlmAdapter = { provider: "stand-in", model: "w", complete: async (req: LlmRequest) => {
  const content = String((req.messages[0] as any).content);
  const program = content.slice("Call:\n".length, content.indexOf("\n\n"));
  const p = parsed(program.replace("⟦…⟧", "x"));
  const a = p.lines[0]!.call.args as { [k: string]: any };
  let text: string;
  if (program.includes("⟦…⟧")) text = `Direct ${"id" in a.to ? a.to.id : a.to.text} to ⟦keep to arrangement ${++n} from now on⟧.`;
  else if (p.lines[0]!.call.fn === "form") {
    const paper = content.includes("This is a paper of the speaker's own office");
    const rest = literals(p).filter((x) => x !== a.form.id && !["yes", "no"].includes(x) && !(paper && x === a.to.id));
    text = paper ? `Make out the paper with these particulars: ${rest.join("; ")}.` : `Direct ${a.to.id} as follows: ${rest.filter((x) => x !== a.to.id).join("; ")}.`;
  } else text = `Please see to this: ${literals(p).join(", ")}.`;
  return { content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } };
} };

/** An example through the export: its steps over pieces, and the program those come back to. Undefined where the
 * export would cut it (a span that ends inside a piece). */
function exported(e: Example): string | undefined {
  const enc = encode(e);
  const r = row(e.id, e.kind, enc);
  return r ? decode(enc.input, stepsOf(r, r.steps)) : undefined;
}

test("the export cuts none of the new kinds: holds, entries, standing work, directions, papers with lists and dates, every currency's amounts", async () => {
  const statements = synthetic({ only: ["statement"], perFunction: 600, seed: SEED });
  const holds = statements.filter((g) => /^statement\(hold=/.test(g.program));
  const entries = statements.filter((g) => g.program.includes("visible=own"));
  const work = synthetic({ only: ["work"], perFunction: 400, seed: SEED }).filter((g) => g.tag === "standing_work");
  const money = synthetic({ only: ["money"], perFunction: 600, seed: SEED }).filter((g) => !g.program.includes("\n"));
  // (Every way of writing money the generator draws is among the payments: the invented ones and each profile's.)
  const drawn = new Set(money.map((g) => g.currency?.code));
  for (const c of everyCurrency()) expect(drawn.has(c.code)).toBe(true);
  const gold: Gold[] = [
    ...holds.slice(0, 80), ...entries.slice(0, 60), ...work.slice(0, 80), ...money,
    ...directions({ n: 60, seed: SEED }), ...papers({ n: 120, seed: SEED }),
  ];
  expect(holds.some((g) => /hold=\[/.test(g.program)) && holds.some((g) => /hold=[a-z]/.test(g.program))).toBe(true);
  expect(work.some((g) => /[(,]until[,)]/.test(g.shape)) && work.some((g) => /[(,]first[,)]/.test(g.shape))).toBe(true);
  const back = { model: "stand-in/back", translate: async (_q: string, _forms: string[], g?: Gold) => g?.program ?? "none(unclear)" };
  const r = await generate(gold, { writers: [writer], perGold: 1, styles: ["formal", "terse"], seed: SEED, back });
  const kept = r.examples.filter((e) => e.kind === "positive");
  const kinds: { [kind: string]: (e: Example) => boolean } = {
    "a hold of one": (e) => /^statement\(hold=[a-z]/.test(e.program), "a hold of several": (e) => /^statement\(hold=\[/.test(e.program),
    "an entry": (e) => e.program.includes("visible=own"), "standing work": (e) => /^work\(/.test(e.program) && e.program.includes("every="),
    "standing work that ends": (e) => /^work\(/.test(e.program) && e.program.includes("until="), "standing work that starts later": (e) => /^work\(/.test(e.program) && e.program.includes("first="),
    "a form": (e) => /^form\(/.test(e.program), "a form with a list": (e) => /^form\(/.test(e.program) && /=\[/.test(e.program), "a form with a date": (e) => /^form\(/.test(e.program) && /="(?:year \d+, )?day \d+"/.test(e.program),
    "a payment": (e) => /^money\(/.test(e.program),
  };
  const cut: string[] = [];
  for (const [kind, is] of Object.entries(kinds)) {
    const of = kept.filter(is);
    expect([kind, of.length > 5]).toEqual([kind, true]);
    for (const e of of) {
      const back = exported(e);
      if (back === undefined) cut.push(`${kind}: ${e.program}`);
      else expect(back).toBe(calls.programText(calls.parseProgram(e.program)));
    }
  }
  expect(cut).toEqual([]);
  // Payments in every currency drawn came through, each amount whole pieces of its request.
  const paid = new Set(kept.filter((e) => /^money\(/.test(e.program)).map((e) => e.currency?.code));
  for (const c of everyCurrency()) expect([c.code, paid.has(c.code)]).toEqual([c.code, true]);
  // The closed set a model trained on these and one refusal to look first would have lacks nothing the language has
  // gained; a refusal is a choice and an end, with no span to cut.
  const refusal = { id: "r", kind: "refusal", request: "Put a hold on every standing payment out of acc-1 to acc-9.", forms: [], program: "none(look_first)" };
  expect(row(refusal.id, refusal.kind, encode(refusal))!.steps).toEqual(["none:look_first", "eos"]);
  expect(cannotSay(vocabulary([...kept, refusal].map((e) => encode(e))))).toEqual([]);
});

test("pieces: a sign of money written against its digits is a piece of its own or part of the amount's, never part of a neighbour's", () => {
  for (const amount of ["$1,200.90", "1.234,50 kr", "₹3,00,000", "3 lakh", "KSh 4,500", "¥80100", "ƒ930000", "500€", "twelve thousand marks"]) {
    const request = `Pay acc-9 ${amount} from acc-1.`;
    const at = request.indexOf(amount);
    const ps = pieces(request);
    expect([amount, ps.some((p) => p.at[0] === at), ps.some((p) => p.at[1] === at + amount.length)]).toEqual([amount, true, true]);
  }
});
