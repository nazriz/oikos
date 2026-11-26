// Every fold Lens runs over a log, in one pass (src/shared/fold.ts; docs/design/lens.md section 3). One line each.
import type { FoldFactory } from "../shared/fold";

export const FOLDS: FoldFactory[] = [];
