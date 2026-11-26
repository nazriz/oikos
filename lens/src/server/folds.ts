// Every fold Lens runs over a log, in one pass (src/shared/fold.ts; docs/design/lens.md section 3). One line each.
import type { FoldFactory } from "../shared/fold";
import { townFold } from "../folds/town";
import { peopleFold } from "../folds/people";
import { seatFold } from "../folds/seat";
import { dailyFold } from "../folds/daily";
import { ledgerFold } from "../folds/ledger";

export const FOLDS: FoldFactory[] = [townFold, peopleFold, seatFold, dailyFold, ledgerFold];
