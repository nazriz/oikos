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

test("a day's work left undone when the day's over is dropped, and the module hears it wasn't done", () => {
  let wake = 0;
  const heard: string[] = [];
  const work = (i: number): Step => {
    const s = because(`work ${i}`, C.call("work", { task: "serve", units: C.text("1"), at: "shop" }));
    s.then = (o) => { heard.push(`${i} ${o.status} ${o.refusal?.code ?? ""}`.trim()); };
    return s;
  };
  const s = stepper(() => {}, () => (wake++ === 0 ? [...Array.from({ length: 12 }, (_, i) => note(i)), work(50), note(51)] : [note(100)]));
  for (let i = 0; i < 12; i++) s.step(obs(3600));
  // The next day: the day's work is dropped (and told so); the other leftover step still comes first.
  const next = Array.from({ length: 3 }, () => which(s.step(obs(86_400 + 3600))));
  expect(next).toEqual(["step 51", "step 100", "wait"]);
  expect(heard).toEqual(["50 refused not_done"]);
});

test("a step that counts from when it's done is made again if it's done later than planned", () => {
  let wake = 0;
  const made: number[] = [];
  const notice = (at: number): Step => { made.push(at); return Object.assign(because(`notice from ${at + 5}`, C.call("message", { to: C.json(["x"]), text: C.text("n") })), { redo: notice }); };
  const s = stepper(() => {}, () => (wake++ === 0 ? [...Array.from({ length: 12 }, (_, i) => note(i)), notice(0)] : []));
  for (let i = 0; i < 12; i++) s.step(obs(0));
  // Carried to the next wake, at 3600: remade for then.
  expect(which(s.step(obs(3600)))).toBe("notice from 3605");
  expect(made).toEqual([0, 3600]);
});
