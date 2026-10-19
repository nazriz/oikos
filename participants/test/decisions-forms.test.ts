// The forms for what a person files with an office that decides (foundations F9): a claimant's papers, an employer's confirmation, a request to look at a
// decision again. Each, filled in, writes the paper the code citizen or the employer's own books write, word for word and field for field: so a model
// in a claimant's, an employer's or any person's chair can do what code does (docs/decisions.md, "Foundations F9").
import { expect, test } from "bun:test";
import { CLAIM_EVIDENCE, CONFIRMATION_ANSWER, REVIEW_REQUEST } from "../src/shared/papers";
import { writePaper } from "../src/forms";

const money = (a: string) => `$${a}`;
const asForm = (x: typeof CLAIM_EVIDENCE) => ({ form: x.form, submit_as: x.writes.kind, submit_to: ["city"], fields: x.fields, writes: x.writes });
const NOW = 86_400 * 40;

test("the claimant's papers, filled in, are the paper the code citizen files for a claim that waits for them (decisions.ts, citizen.ts)", () => {
  const p = writePaper(asForm(CLAIM_EVIDENCE) as any, { office: "outside", claim: "rec.12", need: "papers", request: "rec.14", what: "proof of who I am", last_employer: "shop-3" }, { self: "c0080", now: NOW, money });
  expect(p.kind).toBe("evidence");
  expect(p.text).toBe("For my claim rec.12: proof of who I am");
  expect(p.addressed_to).toEqual(["outside"]);
  expect(p.visible_to).toEqual(["c0080", "outside"]);
  expect(p.basis).toBe("rec.14");
  expect(p.data).toEqual({ claim: "rec.12", need: "papers", request: "rec.14", last_employer: "shop-3" });
  // (Without the employer, none is claimed: the key is left out, as the code leaves it out.)
  expect(writePaper(asForm(CLAIM_EVIDENCE) as any, { office: "outside", claim: "rec.12", need: "papers", request: "rec.14", what: "proof" }, { self: "c0080", now: NOW, money }).data).toEqual({ claim: "rec.12", need: "papers", request: "rec.14" });
});

test("an employer's confirmation, filled in, is the paper its payroll office writes from its own books (firms.ts)", () => {
  const p = writePaper(asForm(CONFIRMATION_ANSWER) as any, { office: "outside", claim: "rec.12", need: "employer", request: "rec.15", subject: "c0080", what: "c0080 is in our employment", employed: "yes", known: "yes" }, { self: "shop-3", now: NOW, money });
  expect(p.kind).toBe("confirmation_answer");
  expect(p.addressed_to).toEqual(["outside"]);
  expect(p.basis).toBe("rec.15");
  expect(p.data).toEqual({ claim: "rec.12", need: "employer", request: "rec.15", subject: "c0080", employed: true, known: true });
  const gone = writePaper(asForm(CONFIRMATION_ANSWER) as any, { office: "outside", claim: "rec.12", need: "employer", request: "rec.15", subject: "c0080", what: "their employment ended", employed: "no", known: "yes", ended_on: 30 * 86_400 }, { self: "shop-3", now: NOW, money });
  expect(gone.data).toEqual({ claim: "rec.12", need: "employer", request: "rec.15", subject: "c0080", employed: false, known: true, ended_on: 30 * 86_400 });
});

test("a request to look at a decision again, filled in, is the request every grievance makes (citizen.ts, frictions.ts)", () => {
  const p = writePaper(asForm(REVIEW_REQUEST) as any, { office: "outside", matter: "claim_refused", about: "rec.40", seeks: "pension" }, { self: "c0080", now: NOW, money });
  expect(p.kind).toBe("review_request");
  expect(p.addressed_to).toEqual(["outside"]);
  expect(p.visible_to).toEqual(["c0080", "outside"]);
  expect(p.basis).toBe("rec.40");
  expect(p.data).toEqual({ matter: "claim_refused", against: "outside", about: "rec.40", seeks: "pension" });
});
