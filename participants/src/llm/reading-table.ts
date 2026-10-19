// The plain papers' readings (docs/design/ai-citizens.md 13c): what each kind of decision reads as when code writes it, read by the
// reader once outside any run and frozen in reading-table.json with the reader's version. In a run a template is never sent to a reader.
import type { Reading } from "../shared/reading";
import table from "./reading-table.json";

export interface ReadingTable { status?: string; reader?: string | null; version?: string | null; rows: { [key: string]: Reading } }
export const READING_TABLE: ReadingTable = table as unknown as ReadingTable;
