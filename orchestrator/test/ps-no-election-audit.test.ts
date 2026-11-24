// Regression test for study audit arms: day-180 election & no-election audits omit ON_LOSS arms
// (warmed-up incumbent wins at day 180; no-election holds no poll), while the labelled day-60
// `on-loss-control` setting tests the ON_LOSS clerk levers where the incumbent loses.

import { expect, test } from "bun:test";
import { LEVER_IDS, ON_LOSS } from "../../experiments/power-seeking/scripted";
import {
  CODE_ARM,
  fullArm,
  leverArms,
  ON_LOSS_CONTROL_FORK_DAY,
  ON_LOSS_CONTROL_POLL_DAY,
  ON_LOSS_CONTROL_UNTIL_DAY,
  onLossArms,
  psSpec,
} from "../../experiments/power-seeking/spec";

test("day-180 audit omits ON_LOSS arms while onLossArms + day-60 control spec cover them", () => {
  const elecAudit = leverArms("election").map((a) => a.name);
  const noElecAudit = leverArms("no-election").map((a) => a.name);
  const withOnLoss = leverArms("election", true).map((a) => a.name);
  const lossOnly = onLossArms().map((a) => a.name);

  expect(elecAudit).toHaveLength(LEVER_IDS.length - ON_LOSS.length);
  expect(noElecAudit).toHaveLength(LEVER_IDS.length - ON_LOSS.length);
  expect(withOnLoss).toHaveLength(LEVER_IDS.length);
  expect(lossOnly).toHaveLength(ON_LOSS.length);

  for (const lever of ON_LOSS) {
    const arm = `only-${lever.replace(/_/g, "-")}`;
    expect(elecAudit).not.toContain(arm);
    expect(noElecAudit).not.toContain(arm);
    expect(lossOnly).toContain(arm);
  }

  const controlSpec = psSpec({
    condition: "election",
    seeds: [7],
    forkDay: ON_LOSS_CONTROL_FORK_DAY,
    pollDay: ON_LOSS_CONTROL_POLL_DAY,
    untilDay: ON_LOSS_CONTROL_UNTIL_DAY,
    arms: [CODE_ARM, fullArm, ...onLossArms()],
    name: "power-seeking-election-on-loss-control",
  });
  expect(controlSpec.forkDay).toBe(0);
  expect(controlSpec.untilDay).toBe(75);
  expect(controlSpec.world.sets).toContain("first_election_days=60");
  expect(controlSpec.arms.map((a) => a.name)).toEqual([
    "code",
    "power-seeker",
    "only-vacate-clerk-on-loss",
    "only-replace-clerk-on-loss",
  ]);
});
