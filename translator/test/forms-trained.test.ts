// scripts/forms-trained.ts: the list of forms a model was taught, written beside (never into) its config.json, and
// read by the adapter's `readerOf` (translator/model/adapter.ts).
import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formNamesOf, writeSidecar } from "../../scripts/forms-trained";
import { readerOf } from "../model/adapter";

const line = (name: string) => `- ${name}, to=city, id form-city-${name.replace(/_/g, "-")}: fields notes (text)`;
const scratch = () => mkdtempSync(join(tmpdir(), "forms-trained-"));

function made() {
  const root = scratch(), model = join(root, "model"), exp = join(root, "export"), pieces = join(root, "pieces");
  for (const d of [model, exp, pieces]) mkdirSync(d);
  const config = '{"vocabulary": ["a"], "max_pieces": 640,  "dropout": 0.1}';
  writeFileSync(join(model, "config.json"), config);
  writeFileSync(join(model, "model.safetensors"), "weights");
  const rows = [
    { forms: [line("permit_application"), line("council_proposal")] },
    { forms: [] },
    { forms: [line("council_proposal"), line("works_collection")] },
  ];
  writeFileSync(join(exp, "train.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  // the same, encoded: the form line begins at each break piece "-", its name the pieces up to the first ","
  const enc = (names: string[]) => {
    const p: string[] = ["Do", "it", "."], breaks: number[] = [];
    for (const n of names) { breaks.push(p.length); p.push("-", ...n.split(/(_)/), ",", "to", "=", "city", ",", "id", "form"); }
    return { pieces: p, breaks };
  };
  const encoded = [enc(["permit_application", "council_proposal"]), enc([]), enc(["council_proposal", "works_collection"])];
  writeFileSync(join(pieces, "train.jsonl"), encoded.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return { model, exp, pieces, config };
}

test("the names are the sorted distinct ones of the train rows, from the joined rows or the encoded ones alike", () => {
  const { exp, pieces } = made();
  const want = ["council_proposal", "permit_application", "works_collection"];
  expect(formNamesOf(exp)).toEqual(want);
  expect(formNamesOf(pieces)).toEqual(want);
});

test("the sidecar carries the list; config.json is not touched; a second run does nothing; a different list is refused", () => {
  const { model, exp, config } = made();
  const before = readFileSync(join(model, "config.json"));
  const names = formNamesOf(exp);
  expect(readerOf(model).trained).toBeUndefined();
  expect(writeSidecar(model, exp, names)).toBe("wrote");
  expect(readFileSync(join(model, "config.json")).equals(before)).toBe(true);
  expect(readFileSync(join(model, "config.json"), "utf8")).toBe(config);
  const side = JSON.parse(readFileSync(join(model, "forms-trained.json"), "utf8"));
  expect(side).toEqual({ forms_trained: ["council_proposal", "permit_application", "works_collection"], export: exp });
  const bytes = readFileSync(join(model, "forms-trained.json"));
  expect(writeSidecar(model, exp, names)).toBe("same");
  expect(readFileSync(join(model, "forms-trained.json")).equals(bytes)).toBe(true);
  expect(() => writeSidecar(model, exp, ["other"])).toThrow();
  expect(readerOf(model)).toEqual({ most: 640, forms: undefined, trained: names });
});

test("readerOf: none with neither; config.json's own list wins over the sidecar; a malformed sidecar means none", () => {
  const { model, exp } = made();
  expect(readerOf(model).trained).toBeUndefined();
  writeFileSync(join(model, "forms-trained.json"), "{not json");
  expect(readerOf(model).trained).toBeUndefined();
  writeSidecar(scratch(), exp, []); // (another folder: no effect here)
  writeFileSync(join(model, "forms-trained.json"), JSON.stringify({ forms_trained: ["a", "b"] }));
  expect(readerOf(model).trained).toEqual(["a", "b"]);
  const own = scratch();
  writeFileSync(join(own, "config.json"), JSON.stringify({ max_pieces: 640, forms_trained: ["x"] }));
  copyFileSync(join(model, "forms-trained.json"), join(own, "forms-trained.json"));
  expect(readerOf(own).trained).toEqual(["x"]);
  writeFileSync(join(model, "forms-trained.json"), JSON.stringify({ forms_trained: [1] }));
  expect(readerOf(model).trained).toBeUndefined();
});
