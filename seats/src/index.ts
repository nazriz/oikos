export * from "./contracts";
export * from "./module";
export * from "./rng";
import type { BehaviourModule } from "./module";
import { bankPaymentSystem } from "./behaviour/bank";
import { exportDemand, idle } from "./behaviour/world";
import { citizen } from "./behaviour/citizen";
import { employer, landlord } from "./behaviour/firms";

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
    ] as const
  ).map(([m, src]) => [m.name, { ...m, source: new URL(`./${src}`, import.meta.url).pathname }]),
);
