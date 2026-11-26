// The Run page's slots (src/client/run/RunPage.tsx): what fills the map in the middle, the story rail on the right, the
// sitting reader over them, and the inspector drawer's body. Each view's owner registers its component here with one
// line; an empty slot shows a quiet placeholder. Views talk to each other only through src/client/state.ts.
import { createElement, type ComponentType } from "react";
import type { Meta, RunEntry } from "../shared/api";
import type { Selection } from "./state";
import { SittingReader } from "./story/SittingReader";
import { StoryRail } from "./story/StoryRail";

/** What a "How do we know?" link explains. */
export type EvidenceClaim = { kind: "outcome" } | { kind: "lever"; index: number } | { kind: "act"; seq: number } | { kind: "vote"; proposal: string };

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
  /** The Compare page, #/compare/<a>/<b> (story's ComparePage). */
  compare?: ComponentType<{ a: string; b: string }>;
  /** The cross-run Moments gallery, #/moments (story's Moments). */
  moments?: ComponentType<{}>;
  /** One row per AI model across all runs, #/models (story's ModelsPage). */
  models?: ComponentType<{}>;
  /** "How do we know?" beside a claim: the evidence from the mayor's words to the checker's call (story's HowDoWeKnow). */
  howDoWeKnow?: ComponentType<{ run: string; claim: EvidenceClaim }>;
  /** The study across runs, #/findings (story's Findings). */
  findings?: ComponentType<{}>;
  /** One day's sittings side by side across forks, #/diff/<a>,<b>[,<c>]?day=<n> (story's SittingDiff). */
  diff?: ComponentType<{ keys: string[]; day?: number }>;
  /** A printable digest of one run, #/digest/<key> (story's RunDigest): the top bar and nothing else around it. */
  digest?: ComponentType<{ run: string }>;
  /** The town in 3D (lens-world's WorldView): offered beside the map in the map slot as "Map | Town in 3D". */
  world?: ComponentType<SlotProps>;
  /** Who holds which office over the run, #/power/<key> (city's PowerView). */
  power?: ComponentType<{ run: string }>;
}

import { CityView } from "./city/CityView";
import { CityInspector } from "./city/Inspector";
import { ComparePage } from "./compare/ComparePage";
import { Moments } from "./story/Moments";
import { Findings } from "./story/Findings";
import { SittingDiff } from "./story/SittingDiff";
import { RunDigest } from "./story/RunDigest";
import { ModelsPage } from "./story/ModelsPage";
import { HowDoWeKnow } from "./story/Evidence";
import { PersonLife } from "./life/PersonLife";
import { PowerView } from "./city/Power";
import { WorldView } from "./world/WorldView";

// Registered views (one line each, by their owners):
export const views: Views = {
  rail: StoryRail,
  reader: SittingReader,
  map: (p) => createElement(CityView, { run: p.run, card: false }),
  inspector: { person: PersonLife, structure: CityInspector, entity: CityInspector },
  compare: ComparePage,
  moments: Moments,
  findings: Findings,
  diff: SittingDiff,
  digest: RunDigest,
  models: ModelsPage,
  howDoWeKnow: HowDoWeKnow,
  power: PowerView,
  world: (p) => createElement(WorldView, { run: p.run }),
};
