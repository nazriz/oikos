import { expect, test } from "bun:test";
import * as C from "../src/calls";
import type { Observation } from "../src/contracts";
import { because, type Step } from "../src/behaviour/common";
import { stepper } from "../src/behaviour/firms";

/** An observation at `t` with nothing in it. */
const obs = (t: number): Observation => ({ t, entity: "firm", channels: {}, outcomes: [] }) as unknown as Observation;
const note = (i: number): Step => because(`step ${i}`, C.call("message", { to: C.json(["x"]), text: C.text(String(i)) }));
/** The step an action carries out (its reasoning names it), or "wait". */
const which = (a: any) => (a.type === "wait" ? "wait" : a.reasoning);

test("what a wake didn't get to is done first at the next, never dropped (a module's state counts on it)", () => {
  let wake = 0;
  const s = stepper(() => {}, () => (wake++ === 0 ? Array.from({ length: 20 }, (_, i) => note(i)) : [note(100)]));
  // The first wake: 12 actions (a wake's allowance), then the moment passes.
  const first = Array.from({ length: 12 }, () => which(s.step(obs(0))));
  expect(first).toEqual(Array.from({ length: 12 }, (_, i) => `step ${i}`));
  // The next wake: the 8 left over, in order, then what it plans now; then nothing more.
  const next = Array.from({ length: 10 }, () => which(s.step(obs(86_400))));
  expect(next).toEqual([...Array.from({ length: 8 }, (_, i) => `step ${12 + i}`), "step 100", "wait"]);
});
