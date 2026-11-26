// The Run page's slots (src/client/run/RunPage.tsx): what fills the map in the middle, the story rail on the right, the
// sitting reader over them, and the inspector drawer's body. Each view's owner registers its component here with one
// line; an empty slot shows a quiet placeholder. Views talk to each other only through src/client/state.ts.
import type { ComponentType } from "react";
import type { Meta, RunEntry } from "../shared/api";
import type { Selection } from "./state";

export interface SlotProps {
  /** The open run's key. */
  run: string;
  meta: Meta;
  entry?: RunEntry;
}
export interface InspectorProps extends SlotProps {
  selection: NonNullable<Selection>;
}

export interface Views {
  /** Center: the town (city's CityView). Fills its box. */
  map?: ComponentType<SlotProps>;
  /** Right: the seat's story (story's StoryRail), ~420 px wide, fills the height. */
  rail?: ComponentType<SlotProps>;
  /** Over the map and rail, when the selection is a sitting, a lever or an act (story's SittingReader). */
  reader?: ComponentType<SlotProps>;
  /** The inspector drawer's body, by selection kind (person, structure, entity...). */
  inspector?: Partial<Record<NonNullable<Selection>["kind"], ComponentType<InspectorProps>>>;
}

// Registered views (one line each, by their owners):
export const views: Views = {};
