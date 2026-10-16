// A notice counts from when it is on the record, which is after it is sent (foundations F7, 2026-10-16): the act of giving it takes the
// publisher's time. A date counted from the moment of sending was short of the law's notice for one sent in the last minutes of a day: found
// in a landlord's notice of 29 days, 23 hours and 34 minutes, where the law asks 30 days.
import { expect, test } from "bun:test";
import { DAY, NOTICE_LAG, startsOn } from "../src/behaviour/common";

test("a notice sent at any moment of a day, and on the record up to the lag after, runs its days before the change begins", () => {
  const lead = 30 * DAY;
  for (const sent of [0, 3_600, 12 * 3_600, DAY - 3_600, DAY - 901, DAY - 60, DAY - 1]) {
    const from = startsOn(sent, lead);
    expect(from % DAY, "an increase begins with a day").toBe(0);
    expect(from - (sent + NOTICE_LAG), `sent at ${sent}`).toBeGreaterThanOrEqual(lead);
    expect(from - sent, `sent at ${sent}`).toBeLessThanOrEqual(lead + DAY + NOTICE_LAG);
  }
  // (And what takes a quarter of an hour and waits half an hour more is within the lag.)
  expect(startsOn(DAY - 60, lead) - (DAY - 60 + 900 + 1_800)).toBeGreaterThanOrEqual(lead);
});
