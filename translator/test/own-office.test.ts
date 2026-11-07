// An office and the form others direct it by (live check 2 of 2026-10-09, findings 3 and 14; the Claude translator
// check of the same day). A works manager asked for a standing work order; two models, as translator, wrote the
// collection direction form addressed to the manager's own office, and the preview said "Nothing stands in the way".
// The preview now says when an office will not follow a direction from its sender (by the organisation's published
// rule); the translator is shown that a direction form is to the asker's own office; and work asked for with neither
// how much nor how often is asked back in the asker's terms.

import { expect, test } from "bun:test";
import { calls } from "@oikos/participants";
import { fixture, passes } from "../eval/run";
import { CASES } from "../eval/cases";
import { draftText, formShown, formShownTo, Preview, translatorContext, translatorSystem, TRANSLATOR_VERSION } from "../src/index";
import { ONCE_OR_ROUTINE, resolve } from "../src/resolver";

/** What a seat of the test town knows, with the town's rule on directions on file (as every seat has it). */
function knowing(as: string) {
  const k = fixture(as);
  k.absorb({ participant: `${as}-system`, as, t: 30 * 86_400, status: "active", entity: "city", outcomes: [], inbox: [], drafts: [], positions: [{ position: as, entity: "city", title: as === "works" ? "Works manager" : "Mayor" }],
    channels: { laws: { kind: "records", records: [{ id: "proc-directions", record: "statement", author: "genesis", at: 0, visible_to: "public", speaks_for: "city", kind: "procedure",
      text: "The town's offices take written directions on how they do their work from the mayor, and from the council by resolution, filed by the council clerk.", data: { directions: { by: ["mayor", "council-clerk"] } } }] },
      who: { kind: "directory", entities: [], positions: [{ position: "mayor", entity: "city", title: "Mayor" }, { position: "council-clerk", entity: "city", title: "Council clerk" }, { position: "works", entity: "city", title: "Works manager" }] } } } as any);
  return k;
}
const direction = (k: ReturnType<typeof fixture>, as: string) => {
  const r = resolve(calls.parseProgram('form(form=works_collection, to=works, every="1 week")'), k, () => undefined, as);
  if (!r.ok) throw new Error(r.questions.join(" "));
  return new Preview(k, k.actingFor(as), undefined, as).of(r.blocks);
};

test("a direction from an office to itself is previewed as one the office will not follow, by the published rule; from the mayor, nothing is added", () => {
  const own = direction(knowing("works"), "works");
  expect(own).toContain("You will give the Works manager (works) a written direction on its works collection form (form-works-collection)");
  expect(own).toContain("The office will not follow it: by the rule on directions (proc-directions) it takes written directions only from the Mayor (mayor) and the Council clerk (council-clerk), and this one is given as the Works manager (works). A direction is how others direct an office; what its own staff are to do as routine is set by a standing work order on its own file.");
  const mayors = direction(knowing("mayor"), "mayor");
  expect(mayors).not.toContain("will not follow it");
  // The line under the preview no longer says nothing stands in the way of something that would change nothing.
  const draft = (summary: string) => draftText({ id: "draft.x.1", summary, check: { ok: true } } as any);
  expect(draft(own)).toContain("Nothing stops it being filed, and filed it would change nothing, as said above.");
  expect(draft(own)).not.toContain("Nothing stands in the way right now.");
  expect(draft(mayors)).toContain("Nothing stands in the way right now.");
  // A seat that has not seen the rule is told nothing it could not know.
  expect(direction(fixture("works"), "works")).not.toContain("will not follow it");
});

test("the translator is shown that a direction form is to the asker's own office, and told the office's own order is never that form", () => {
  const works = fixture("works");
  const form = works.forms.find((f) => f.data?.form === "works_collection")!;
  expect(formShownTo(form, works.held)).toBe("- works_collection, to=works, id form-works-collection (a direction to this person's own office: for whoever directs that office, not for this person): fields every (duration, required)");
  expect(formShown(form)).toBe("- works_collection, to=works, id form-works-collection: fields every (duration, required)");
  const asWorks = translatorContext({ draftId: "d", participant: "works-system", as: "works", proposal: "Collect weekly.", knowledge: works });
  expect(asWorks).toContain("works_collection, to=works, id form-works-collection (a direction to this person's own office");
  expect(asWorks).toContain("works_staffing, to=works, id form-works-staffing (a direction to this person's own office");
  const asMayor = translatorContext({ draftId: "d", participant: "mayor-system", as: "mayor", proposal: "Collect weekly.", knowledge: fixture() });
  expect(asMayor).toContain("- works_collection, to=works, id form-works-collection: fields");
  expect(asMayor).not.toContain("own office");
  const prompt = translatorSystem();
  expect(prompt).toContain("A form listed below as a direction to this person's own office is never how that is written, whatever the form's fields: that form is for whoever directs the office, and the office's own order to its staff is work(...).");
  expect(prompt).toContain('Direct the depot to do the mend round every fortnight.  ->  form(form=mend_round, to=depot, every="every fortnight")');
  expect(prompt).toContain('Advertise 2 posts at 1,900 a fortnight.  ->  form(form=job_advertisement, to=depot, wage="1,900", period="a fortnight", posts="2")');
  expect(TRANSLATOR_VERSION).toBe("0.9.5");
});

test("the works office's own order, both ways: its own seat's is a standing work order; the mayor's is the direction form", () => {
  const own = CASES.filter((c) => c.as === "works");
  expect(own.map((c) => c.id)).toEqual(["own-collection-order", "own-collection-routine", "own-maintain-routine"]);
  for (const c of own) {
    for (const e of c.expect) {
      const r = resolve(calls.parseProgram(e), fixture("works"), () => undefined, "works");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.blocks).toMatchObject([{ block: "publish", kind: "work_order" }]);
    }
    // The direction form, written for the office's own seat, is a wrong answer.
    expect(passes(c, 'form(form=works_collection, to=works, every="1 week")')).toBe(false);
    expect(passes(c, c.expect[0]!)).toBe(true);
  }
  const mayors = CASES.find((c) => c.id === "direction-collection")!;
  expect(mayors.as).toBeUndefined();
  expect(passes(mayors, 'form(form=works_collection, to=works, every="fortnightly")')).toBe(true);
});

test("work asked for with neither how much nor how often is asked back in the asker's terms: once, or a routine and how often", () => {
  const r = resolve(calls.parseProgram("work(at=str.7, task=maintain)"), fixture("works"), () => undefined, "works");
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.questions).toEqual([ONCE_OR_ROUTINE]);
  expect(ONCE_OR_ROUTINE).toBe("Is this work to be done once, or as a standing routine of your staff? Done once: say how much of it. As a routine: say how often (every day, every week), and it is a standing work order.");
  expect(ONCE_OR_ROUTINE).not.toContain("How much of it?");
  // How often, as a seat said it and was refused ("not a duration: once a week"): read now.
  const weekly = resolve(calls.parseProgram('work(at=str.7, task=collect, every="once a week")'), fixture("works"), () => undefined, "works");
  expect(weekly.ok && weekly.blocks[0]).toMatchObject({ kind: "work_order", data: { every: 7 * 86_400 } });
  expect(calls.parseDuration("once every 2 weeks")).toBe(14 * 86_400);
  // Given how often, it is the standing order.
  const order = resolve(calls.parseProgram('work(at=str.7, task=maintain, every="every day")'), fixture("works"), () => undefined, "works");
  expect(order.ok && order.blocks[0]).toMatchObject({ kind: "work_order", data: { work: { task: "maintain", at: "str.7" }, every: 86_400 } });
});

test("an office's own stationery is a form of its holder's only: another office that has seen the same file does not know it as its own", () => {
  const stationery = (k: ReturnType<typeof fixture>) => k.forms.filter((f) => f.data?.writes).map((f) => f.data!.form).sort();
  expect(stationery(fixture("mayor"))).toEqual(["invoice_approval", "nomination"]);
  expect(stationery(fixture("works"))).toEqual([]);
  // (A form that writes no paper of an office's own is whoever has seen it's.)
  expect(fixture("mayor").forms.some((f) => f.data?.form === "works_collection")).toBe(true);
});
