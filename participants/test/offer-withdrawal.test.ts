// An offer taken back before it is signed (docs/behaviour/offers.md): whoever made it withdraws the paper, as they would
// any paper of theirs (`statement(withdraw=<offer>)`), and from then on it cannot be signed. Nothing in the world could
// take an offer back before: a hire was signed after the employer had been directed not to hire.

import { expect, test } from "bun:test";

import { Book } from "../src/shared/common";
import { inCurrency } from "../src/money";
import PROFILE from "../../worlds/profiles/au-vic-2026.json";
import { DAY, employment, person } from "./stepping";
import { engine } from "./engine";
const citizen = engine("citizen.default");

inCurrency(PROFILE.values.currency);

const OFFER = employment("J9", 5 * DAY, "factory-1", "c1", 120_000);
const sig = (as: string, at: number) => ({ id: `sig-J9-${as}`, at, author: `${as}-x`, record: "signature", agreement: "J9", as, visible_to: ["factory-1", "c1"] });
const taken = (at: number) => ({ id: "w-J9", at, record: "withdrawal", author: "factory-1-manager-system", speaks_for: "factory-1", visible_to: ["factory-1", "c1"], withdraws: "J9" });
const offer = [OFFER, sig("factory-1", 5 * DAY)];
const book = (...records: any[]) => { const b = new Book(); b.absorb({ t: 9 * DAY, entity: "x", participant: "x", woke_for: "cadence", outcomes: [], inbox: [], channels: { mine: { kind: "records", records } } } as any); return b; };

test("a book reads an offer withdrawn before it was signed as one that cannot be signed, and a signature made after it concludes nothing", () => {
  const open = book(...offer);
  expect(open.takenBack("J9")).toBe(false);
  const back = book(...offer, taken(6 * DAY));
  expect(back.takenBack("J9")).toBe(true);
  expect(back.concluded("J9")).toBe(false);
  // (The worker signs after: the signature is on the record, and concludes nothing. Nobody takes the job.)
  const late = book(...offer, taken(6 * DAY), sig("c1", 7 * DAY));
  expect(late.signedBy("J9", "c1")).toBe(true);
  expect(late.takenBack("J9")).toBe(true);
  expect(late.concluded("J9")).toBe(false);
  expect(late.inForce("J9")).toBe(false);
  // Signed by both before the paper was withdrawn: an agreement in force. Withdrawing the paper ends nothing; a notice does.
  const kept = book(...offer, sig("c1", 6 * DAY), taken(7 * DAY));
  expect(kept.takenBack("J9")).toBe(false);
  expect(kept.concluded("J9")).toBe(true);
});

test("someone out of work signs the offer made to them, and does not sign one that has been taken back", async () => {
  const kind = async (records: any[]) => (await person(citizen, {}).wake(8 * DAY, { records, balance: 500_000 })).filter((c) => c.fn === "agreement" && c.args.sign);
  expect((await kind(offer)).map((c) => c.args.sign)).toEqual(["J9"]);
  // (Both reach them together, or the offer first and the withdrawal after: either way they do not sign.)
  expect(await kind([...offer, taken(6 * DAY)])).toEqual([]);
  const p = person(citizen, {});
  await p.wake(4 * DAY, { records: [], balance: 500_000 });
  expect((await p.wake(9 * DAY, { records: [...offer, taken(8 * DAY)], balance: 500_000 })).filter((c) => c.fn === "agreement" && c.args.sign)).toEqual([]);
});
