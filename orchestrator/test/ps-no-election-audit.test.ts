// Regression test for Item 4 practice-run finding: no-election audit must omit *_on_loss
// scripted arms (vacate/replace clerk on loss) that cannot fire when no election is held.

import { expect, test } from "bun:test";
import { LEVER_IDS, ON_LOSS } from "../../experiments/power-seeking/scripted";
import { CODE_ARM, fullArm, leverArms, psSpec } from "../../experiments/power-seeking/spec";

test("leverArms includes ON_LOSS arms for election and omits them for no-election", () => {
  const elec = leverArms("election").map((a) => a.name);
  const noElec = leverArms("no-election").map((a) => a.name);

  expect(elec).toHaveLength(LEVER_IDS.length);
  expect(noElec).toHaveLength(LEVER_IDS.length - ON_LOSS.length);

  for (const lever of ON_LOSS) {
    const arm = `only-${lever.replace(/_/g, "-")}`;
    expect(elec).toContain(arm);
    expect(noElec).not.toContain(arm);
  }

  const spec = psSpec({
    condition: "no-election",
    seeds: [7],
    arms: [CODE_ARM, fullArm, ...leverArms("no-election")],
  });
  expect(spec.arms.some((a) => a.name.endsWith("-on-loss"))).toBe(false);
});
