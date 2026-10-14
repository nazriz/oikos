// The gathering's request names a place on the ground (docs/decisions.md, 2026-10-14): the founder's home is a space
// inside a building, and the translator's `on=` takes a lot or a cell, so the request names the cell the home stands
// on. The first living pilot's founding requests were failed by both translators for want of it (26 of 26).

import { expect, test } from "bun:test";
import { inCurrency } from "../src/money";
import { founded } from "../src/behaviour/founded";
import { acceptGathering } from "../src/behaviour/founding";
import { context, DAY } from "./stepping";

inCurrency({ code: "XTS", minor_units: 2 });
const ME = "ent.9";
const purpose = { id: "rec.1", at: 0, record: "statement", author: `${ME}-convenor-system`, speaks_for: ME, visible_to: "public", kind: "purpose", text: "We are for something." };
const composed = { purpose: "x", asks: "Come as you are.", gathers: "The group gathers every two weeks at 19:00.", choice: { dues: 0, every_days: 14, starts_in_days: 7, lasts_minutes: 90 }, model: "m" };

function gathersRequest(extra: object): { text: string; accept: (b: any[]) => any } {
  const m = founded.create(context(`${ME}-convenor-system`, ME, { founder: "c0001", shape: "gathering", idea: "idea.1", name: "The Circle", purpose: "x", want: { about: "loss", since: 0, weight: 1 }, composed,
    place: "house-1/dwelling.1", bank: "bank", founded_at: 0, dues: [0], every_days: [14], starts_in_days: [7], lasts_minutes: [90], ...extra }, { position: `${ME}-convenor` }));
  const a: any = m.step({ t: DAY, entity: ME, participant: `${ME}-convenor-system`, channels: { mine: { kind: "records", records: [purpose] } }, inbox: [], outcomes: [], woke_for: "cadence" } as any, undefined as any);
  const words = a[Symbol.for("oikos.words")];
  return { text: a.text, accept: words.accept };
}

test("with the cell the home stands on, the gathering's request puts the notice up on it; without, as before", () => {
  const withCell = gathersRequest({ place_on: "cell.4.7" });
  expect(withCell.text).toBe('Put up a public notice of our gathering, a practice held at house-1/dwelling.1, on cell.4.7: "The group gathers every two weeks at 19:00."');
  expect(gathersRequest({}).text).toBe('Put up a public notice of our gathering, a practice held at house-1/dwelling.1: "The group gathers every two weeks at 19:00."');
});

test("a draft with the notice put up on that cell is still the gathering the module accepts (the cell is the translator's `on=`, not the practice's place)", () => {
  const g = acceptGathering(ME, { at: "house-1/dwelling.1", every_days: [14], lasts_minutes: [90], first: [DAY, 31 * DAY], at_seconds: 68_400 });
  const draft = [{ block: "publish", kind: "notice", text: "The group gathers every two weeks.", visible_to: "public", speaks_for: ME, place: "cell.4.7", practice: { at: "house-1/dwelling.1", every: 14 * DAY, lasts: 5400 } }];
  const out: any = g(draft as any);
  expect(typeof out).not.toBe("string");
  expect(out[0].practice).toMatchObject({ at: "house-1/dwelling.1", every: 14 * DAY, lasts: 5400 });
});
