// scripts/forms-released.ts: the forms a trained model's draft may be offered for, written beside forms-trained.json and
// read by the adapter (translator/model/adapter.ts `readerOf`, `DecideAdapter.translate`). The owner's ruling of
// 2026-10-14: a form is handed to our model as soon as it passes its own mark, even while the model is under 90% on
// the whole.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARK, arrangement, fromPerForm, table, whyNot, writeSidecar, type FormResult } from "../../scripts/forms-released";
import { DecideAdapter, readerOf } from "../model/adapter";

const result = (form: string, real: [number, number, number], generated: [number, number]): FormResult => ({ form, real: { n: real[0], right: real[1], wrong_drafts: real[2] }, generated: { n: generated[0], right: generated[1] } });

test("the mark: at least 8 real requests, 90% right, no wrong draft, and 90% of the generated tests", () => {
  expect(MARK).toEqual({ real_min: 8, right_share: 0.9, wrong_drafts: 0 });
  expect(whyNot(result("a", [8, 8, 0], [40, 36]))).toBeUndefined();
  expect(whyNot(result("a", [10, 9, 0], [40, 36]))).toBeUndefined();
  expect(whyNot(result("a", [7, 7, 0], [40, 40]))).toContain("fewer than 8");
  expect(whyNot(result("a", [9, 9, 1], [40, 40]))).toContain("wrong drafts");
  expect(whyNot(result("a", [10, 8, 0], [40, 40]))).toContain("under 90%");
  expect(whyNot(result("a", [10, 10, 0], [40, 35]))).toContain("generated tests");
  expect(whyNot(result("a", [10, 10, 0], [0, 0]))).toContain("generated tests");
});

test("the table lists the released forms sorted and why each of the others stays behind; a form twice is refused", () => {
  const t = table([result("tribunal_order", [12, 12, 0], [60, 58]), result("rent_reminder", [9, 9, 0], [40, 40]), result("warrant", [3, 3, 0], [40, 40]), result("hearing_notice", [10, 9, 1], [40, 40])]);
  expect(t.released).toEqual(["rent_reminder", "tribunal_order"]);
  expect(t.behind.map((b) => b.form)).toEqual(["hearing_notice", "warrant"]);
  expect(() => table([result("a", [8, 8, 0], [1, 1]), result("a", [8, 8, 0], [1, 1])])).toThrow("twice");
});

function folder(trained?: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "forms-released-"));
  mkdirSync(join(dir, "model"));
  const model = join(dir, "model");
  writeFileSync(join(model, "config.json"), '{"vocabulary": ["a"], "max_pieces": 640}');
  writeFileSync(join(model, "model.safetensors"), "weights");
  if (trained) writeFileSync(join(model, "forms-trained.json"), JSON.stringify({ forms_trained: trained }));
  return model;
}

test("the sidecar: written once beside the model, config.json untouched, forms the model was not taught refused, a different list never overwrites", () => {
  const model = folder(["a", "b", "c"]);
  const config = readFileSync(join(model, "config.json"));
  const basis = { mark: MARK, behind: [] };
  expect(() => writeSidecar(model, ["a", "z"], basis)).toThrow("not forms the model was taught");
  expect(writeSidecar(model, ["a", "b"], basis)).toBe("wrote");
  expect(writeSidecar(model, ["a", "b"], basis)).toBe("same");
  expect(() => writeSidecar(model, ["a"], basis)).toThrow("different list");
  expect(readFileSync(join(model, "config.json")).equals(config)).toBe(true);
  expect(JSON.parse(readFileSync(join(model, "forms-released.json"), "utf8")).forms_released).toEqual(["a", "b"]);
});

test("readerOf reads the list; a folder without one reads as before", () => {
  const model = folder(["a", "b"]);
  expect(readerOf(model).released).toBeUndefined();
  writeSidecar(model, ["b"], { mark: MARK, behind: [] });
  expect(readerOf(model)).toEqual({ most: 640, forms: undefined, trained: ["a", "b"], released: ["b"] });
  const bad = folder(["a"]);
  writeFileSync(join(bad, "forms-released.json"), "{not json");
  expect(readerOf(bad).released).toBeUndefined();
});

test("a form taught and not released is recorded and not offered, as a form never taught is; a form released is offered; no list, as before", async () => {
  const line = "- works_collection, to=works, id form-works-collection: fields every (duration)";
  const content = `Request: Fill in the works collection form.\n\nForms this person knows of:\n${line}`;
  const filled = async (o: { pieces: string[] }) => { const i = o.pieces.findIndex((x, k) => x === "works" && o.pieces[k - 1] === "-"); return { steps: ["fn:form", "arg:form", ["id", i, i + 2], ")", "eos"], sure: 0.9, ms: 5, read: 40 }; };
  const ask = async (a: DecideAdapter) => (await a.complete({ purpose: "translator", subject: "translator", ref: "draft.works-system.1", system: "", maxTokens: 10, messages: [{ role: "user", content }] })).content[0] as any;
  const made = (reader: object) => { const a = new DecideAdapter("none", { first: true }); (a as any).reader = { most: 1000, ...reader }; (a as any).ask = filled; return a; };
  // Taught and released: offered.
  expect((await ask(made({ trained: ["works_collection"], released: ["works_collection"] }))).input).toMatchObject({ program: "form(form=works_collection)" });
  // Taught, not released: the list of the released wins.
  expect((await ask(made({ trained: ["works_collection"], released: ["rent_reminder"] }))).input).toMatchObject({ program: "none(unclear)", withheld: "form_unseen", wrote: "form(form=works_collection)" });
  // An empty list releases nothing.
  expect((await ask(made({ trained: ["works_collection"], released: [] }))).input).toMatchObject({ withheld: "form_unseen" });
  // No list of the released: the forms taught, as before.
  expect((await ask(made({ trained: ["works_collection"] }))).input).toMatchObject({ program: "form(form=works_collection)" });
  expect((await ask(made({ trained: ["rent_reminder"] }))).input).toMatchObject({ withheld: "form_unseen" });
});

test("the arrangement: the forms served before stay; a new form is released only if the run may release and it passes its mark; a form with no result is behind", () => {
  const per = {
    rent_reminder: { real: { right: 8, of: 8, wrong: 0 }, generated_tests: { right: 4, of: 4 } },
    possession_order: { real: { right: 12, of: 20, wrong: 7 }, generated_tests: { right: 1, of: 3 } },
    warrant: { real: { right: 0, of: 0, wrong: 0 }, generated_tests: { right: 4, of: 5 } },
  };
  const results = fromPerForm(per);
  expect(results.find((r) => r.form === "possession_order")).toEqual({ form: "possession_order", real: { n: 20, right: 12, wrong_drafts: 7 }, generated: { n: 3, right: 1 } });
  const trained = ["old_b", "old_a", "rent_reminder", "possession_order", "warrant", "remedy_answer"], old = ["old_a", "old_b"];
  const fired = arrangement(results, trained, old, true);
  expect(fired.released).toEqual(["old_a", "old_b"]);
  expect(fired.behind.map((b) => b.form)).toEqual(["possession_order", "remedy_answer", "rent_reminder", "warrant"]);
  expect(fired.behind.find((b) => b.form === "rent_reminder")!.why).toContain("run-level rule");
  expect(fired.behind.find((b) => b.form === "remedy_answer")!.why).toContain("no example");
  const clear = arrangement(results, trained, old, false);
  expect(clear.released).toEqual(["old_a", "old_b", "rent_reminder"]);
  expect(clear.old_kept).toBe(2);
});
