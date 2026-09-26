export * from "./contracts";
export * from "./module";
export * from "./rng";
export * from "./law";
export * from "./canon";
export * as calls from "./calls";
export { View } from "./view";
import type { BehaviourModule } from "./module";
import { bankPaymentSystem } from "./behaviour/bank";
import { exportDemand, idle } from "./behaviour/world";
import { citizen } from "./behaviour/citizen";
import { employer, landlord } from "./behaviour/firms";
import { builder, inspector, planningOfficer } from "./behaviour/institutions";
import { councilClerk, councillor, financeOfficer, mayorCode, taxClerk } from "./behaviour/government";

/** Every behaviour module available to worlds, by the name used in controller.impl. */
export const modules: { [name: string]: BehaviourModule & { source: string } } = Object.fromEntries(
  (
    [
      [bankPaymentSystem, "behaviour/bank.ts"],
      [exportDemand, "behaviour/world.ts"],
      [idle, "behaviour/world.ts"],
      [citizen, "behaviour/citizen.ts"],
      [landlord, "behaviour/firms.ts"],
      [employer, "behaviour/firms.ts"],
      [planningOfficer, "behaviour/institutions.ts"],
      [inspector, "behaviour/institutions.ts"],
      [builder, "behaviour/institutions.ts"],
      [mayorCode, "behaviour/government.ts"],
      [councilClerk, "behaviour/government.ts"],
      [councillor, "behaviour/government.ts"],
      [financeOfficer, "behaviour/government.ts"],
      [taxClerk, "behaviour/government.ts"],
    ] as const
  ).map(([m, src]) => [m.name, { ...m, source: new URL(`./${src}`, import.meta.url).pathname }]),
);
