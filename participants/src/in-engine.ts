// A kind whose actor runs in the engine (kernel/crates/actors): the module here says what the generator, the host and
// the seat-side readers read of it, and has no code behind `create` (docs/decisions.md, 2026-10-19, "The cut-over").

import type { Controller } from "./module";

export const inEngine = (name: string) => (): Controller => {
  throw new Error(`${name} runs in the engine (kernel/crates/actors); its TypeScript actor was deleted at the cut-over`);
};
