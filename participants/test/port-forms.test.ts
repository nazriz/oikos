// The forms catalogue the Rust rules crate reads (kernel/crates/rules/forms/papers.json) is papers.ts's forms, to the
// letter, until the cut-over (docs/port-guide.md, step 1b): a change to a form in TS without the JSON written again
// fails here. After the cut-over the JSON is the source and this test goes with papers.ts.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { catalogue, OUT } from "../../scripts/port-forms";

test("the Rust forms catalogue is papers.ts's forms", () => {
  expect(readFileSync(OUT, "utf8")).toBe(catalogue());
});
