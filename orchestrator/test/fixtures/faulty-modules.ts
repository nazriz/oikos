// Deliberately faulty behaviour modules, for the reliability tests (D59), loaded with `--modules`.
import type { BehaviourModule } from "@terrarium/participants";

const DAY = 86_400;

/** Waits a day at a time; from `hang_at` (seconds) on, never returns (a synchronous infinite loop). */
const hang: BehaviourModule = {
  name: "test.hang",
  version: "0.0.1",
  doc: "orchestrator/test/fixtures/faulty-modules.ts",
  cadence: () => DAY,
  create(ctx) {
    const at = Number(ctx.params.hang_at ?? 0);
    return {
      step(obs) {
        if (obs.t >= at) for (;;) {
          // stuck
        }
        return { type: "wait" };
      },
    };
  },
};

/** Waits a day at a time; from `throw_at` (seconds) on, throws every time it's asked. */
const thrower: BehaviourModule = {
  name: "test.throw",
  version: "0.0.1",
  doc: "orchestrator/test/fixtures/faulty-modules.ts",
  cadence: () => DAY,
  create(ctx) {
    const at = Number(ctx.params.throw_at ?? 0);
    return {
      step(obs) {
        if (obs.t >= at) throw new Error(`a bug at t=${obs.t}`);
        return { type: "wait" };
      },
    };
  },
};

export const modules = { [hang.name]: hang, [thrower.name]: thrower };
