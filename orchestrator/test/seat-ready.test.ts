// A seat is seated with a real model only where its office can do its work (orchestrator/src/seat-ready.ts): forms of
// its own for its main duties, and a working way to answer those who write to it. Anything else is refused, with a
// message for whoever runs the pilot.

import { expect, test } from "bun:test";
import type { BehaviourModule } from "@oikos/participants";
import { refuseUnframed, refuseUnready, seatReadiness, SeatNotReady } from "../src/seat-ready";

test("a run with model seats whose framing was not chosen is refused, naming them; with every one chosen, nothing is said", () => {
  expect(() => refuseUnframed(["mayor-system", "finance-system"])).toThrow('Not started: no framing is chosen for 2 model seats mayor-system, finance-system. Every pilot and experiment chooses what each seat is told the town is');
  expect(() => refuseUnframed([])).not.toThrow();
});

const llm = (id: string, params: object = {}) => ({ id, kind: "system", controller: { type: "llm", params } });
const pos = (id: string, holder: string, code: string) => ({ id, entity: "city", title: id.replace(/-/g, " "), holder, role_module: { code } });
const form = (office: string, name: string, writes: object, submit_as?: string) => ({ id: `form-${office}-${name}`, record: "statement", kind: "form", author: "genesis", at: 0, data: { form: name, office, submit_as: submit_as ?? name, writes } });
const mods: { [k: string]: BehaviourModule } = {
  lending: { name: "lending", issues: [{ form: "loan_decision", title: "", fields: {}, writes: { kind: "loan_decision", text: "" } }] } as any,
  school: { name: "school", issues: [{ form: "job_advertisement", title: "", fields: {}, writes: { kind: "job_advertisement", text: "" } }] } as any,
  registry: { name: "registry", routines: [{ task: "answer", what: "", at: "office" }] } as any,
  none: { name: "none" } as any,
};

test("an office with its forms and a form that answers a paper filed with it is ready", () => {
  const cfg = { participants: [llm("bank-lending-system")], positions: [pos("bank-lending", "bank-lending-system", "lending")],
    world: { records: [form("bank-lending", "loan_decision", { kind: "loan_decision", basis: "=application", to: ["=applicant"] })] } };
  const [r] = seatReadiness(cfg, mods);
  expect(r).toMatchObject({ seat: "bank-lending-system", post: "bank-lending", ready: true, forms: ["loan_decision"], answers: ["the form loan_decision"], why: [] });
  expect(refuseUnready([r!])).toHaveLength(1);
});

test("a school whose only form answers nobody is refused, with what it lacks", () => {
  const cfg = { participants: [llm("principal-system")], positions: [pos("principal", "principal-system", "school")],
    world: { records: [form("principal", "job_advertisement", { kind: "job_advertisement", visible: "public" })] } };
  const [r] = seatReadiness(cfg, mods);
  expect(r!.ready).toBe(false);
  expect(r!.why.join(" ")).toContain("no way to answer those who write to it");
  expect(() => refuseUnready([r!])).toThrow(SeatNotReady);
  try { refuseUnready([r!]); } catch (e) {
    expect((e as Error).message).toContain("Not started: a seat's office is not ready");
    expect((e as Error).message).toContain("principal-system (principal, post principal)");
    expect((e as Error).message).toContain("Take these seats out of the line-up");
  }
});

test("an office with no form of its own, or one its procedure issues that is not published, is refused", () => {
  const cfg = { participants: [llm("a-system"), llm("b-system")], positions: [pos("a", "a-system", "none"), pos("b", "b-system", "lending")],
    world: { records: [form("a", "steer_a", { kind: "direction", basis: "=x" }, "direction")] } };
  const [a, b] = seatReadiness(cfg, mods);
  expect(a!.why[0]).toContain("no form of its own is published for it"); // (a form others direct it by is not its own)
  expect(b!.missing).toEqual(["loan_decision"]);
  expect(b!.why.join(" ")).toContain("its procedure issues loan_decision, and no published form for it does");
});

test("counter staff who answer, or a member's vote on its body's ballots, are a working way to answer", () => {
  const cfg = { participants: [llm("registry-system"), llm("councillor-1-system", { ballot_count: "member" })],
    positions: [pos("registry", "registry-system", "registry"), pos("councillor-1", "councillor-1-system", "none")],
    world: { records: [form("registry", "death_registration", { kind: "death_registration" })] } };
  const [reg, cllr] = seatReadiness(cfg, mods);
  expect(reg).toMatchObject({ ready: true, answers: ["its counter staff"] });
  expect(cllr).toMatchObject({ ready: true, answers: ["its vote on its body's ballots"] });
});

test("a seat of a person's own, and code-run participants, have nothing here to check; `only` narrows it", () => {
  const cfg = { participants: [llm("p-self"), { id: "code", controller: { type: "code" } }, llm("x-system")], positions: [pos("x", "x-system", "none")], world: { records: [] } };
  expect(seatReadiness(cfg, mods).map((r) => [r.seat, r.ready])).toEqual([["p-self", true], ["x-system", false]]);
  expect(seatReadiness(cfg, mods, ["p-self"]).map((r) => r.seat)).toEqual(["p-self"]);
});
