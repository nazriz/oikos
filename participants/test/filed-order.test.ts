import { expect, test } from "bun:test";
import { filedBefore } from "../src/behaviour/common";

test("records are in the order they were filed, not the order of their digits as text", () => {
  const ids = ["rec.1000", "rec.999", "rec.12", "rec.9", "rec.101"].map((id) => ({ id }));
  expect(ids.sort(filedBefore).map((x) => x.id)).toEqual(["rec.9", "rec.12", "rec.101", "rec.999", "rec.1000"]);
  // (What is not `<name>.<n>` falls back to the text, and two names compare by name.)
  expect([{ id: "b" }, { id: "a" }].sort(filedBefore).map((x) => x.id)).toEqual(["a", "b"]);
  expect([{ id: "x.2" }, { id: "w.10" }].sort(filedBefore).map((x) => x.id)).toEqual(["w.10", "x.2"]);
});
