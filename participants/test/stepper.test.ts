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

test("what a module needs to look up is asked before it plans, one look after another, and what followed from its last act is kept over the looks", () => {
  // It needs two things looked up (a register, say), each found by the look it asks; then it plans, knowing them.
  const known = new Set<string>();
  const wanted = ["lot-1", "lot-2"];
  let planned: string[] = [];
  const s = stepper(
    (o) => { for (const ch of Object.values(o.channels) as any[]) for (const r of ch.records ?? []) known.add(r.id); },
    () => { planned = [...known].sort(); return [note(1)]; },
    undefined,
    () => { const next = wanted.find((w) => !known.has(w)); return next ? [{ channel: "lots", query: { where: [{ field: "id", op: "=", value: next }], limit: 1 } }] : []; },
  );
  const found = (t: number, id: string): Observation => ({ t, entity: "firm", outcomes: [], channels: { lots: { kind: "records", search: true, records: [{ id }] } } }) as unknown as Observation;
  const first: any = s.step(obs(0));
  expect(first).toEqual({ type: "look", looks: [{ channel: "lots", query: { where: [{ field: "id", op: "=", value: "lot-1" }], limit: 1 } }] });
  const second: any = s.step(found(0, "lot-1"));
  expect(second.looks[0].query.where[0].value).toBe("lot-2");
  expect(which(s.step(found(0, "lot-2")))).toBe("step 1");
  expect(planned).toEqual(["lot-1", "lot-2"]);
  expect(which(s.step(obs(0)))).toBe("wait");

  // An act whose outcome says what comes next, done as the last of a wake; at the next wake a look comes first, and
  // what followed is still done, before what is planned then.
  let wake = 0, ask = false;
  const act: Step = Object.assign(because("order", C.call("message", { to: C.json(["x"]), text: C.text("o") })), { then: () => [note(7)] });
  const m = stepper(() => {}, () => (wake++ === 0 ? [act] : [note(8)]), undefined, () => (ask ? ((ask = false), [{ channel: "lots" }]) : []));
  expect(which(m.step(obs(0)))).toBe("order");
  ask = true;
  const done = { ...obs(3600), outcomes: [{ action: "a", t: 3600, status: "applied" }] } as unknown as Observation;
  expect((m.step(done) as any).type).toBe("look");
  expect([which(m.step(obs(3600))), which(m.step(obs(3600))), which(m.step(obs(3600)))]).toEqual(["step 7", "step 8", "wait"]);
});

test("an act's outcome goes to the act it is of, however late: a refusal that comes at once is not the end of the work sent before it", () => {
  // (Foundations F1, 2026-10-15. An office that sets a crew to work is free again before the crew is done, and an order that
  // will not fit the crew's day is refused at once: its outcome comes before that of the long work sent earlier.)
  const heard: string[] = [];
  const order = (name: string): Step => Object.assign(note(0), { then: (o: any) => void heard.push(`${name}:${o.status}`) });
  let wake = 0;
  const s = stepper(() => {}, () => (wake++ === 0 ? [order("long"), order("short")] : []));
  s.step(obs(0));
  (s as any).sent("act.1");
  s.step({ ...obs(2), outcomes: [] } as any);
  (s as any).sent("act.2");
  // The short one is refused at once; the long one is applied hours later.
  s.step({ ...obs(4), outcomes: [{ action: "act.2", status: "refused", t: 3 }] } as any);
  s.step({ ...obs(20_000), outcomes: [{ action: "act.1", status: "applied", t: 18_000 }] } as any);
  expect(heard).toEqual(["short:refused", "long:applied"]);
});
