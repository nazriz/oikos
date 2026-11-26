// The one store every view shares (zustand). Time, play, the selection and the open run live here, so the map, the
// story rail and the timeline move together: scrub the timeline and the map and the story follow; click a sitting
// and the map jumps to its moment. Owners may add fields for their own view; the ones below are the contract.

import { create } from "zustand";

/** What can be selected anywhere in Lens: opening it shows its inspector, and the map and story highlight it. */
export type Selection =
  | { kind: "person"; id: string }
  | { kind: "structure"; id: string }
  | { kind: "entity"; id: string } // an organisation: "city", "electoral-commission", "shop-5"...
  | { kind: "sitting"; index: number } // one of the seat's sittings (the story fold's order)
  | { kind: "act"; seq: number } // one act in the log
  | { kind: "lever"; index: number } // one lever event (experiments/power-seeking/reader.ts LeverEvent)
  | null;

/** A mark on the shared timeline. Views contribute tracks; the timeline draws them in its lanes. */
export interface TimelineMark { t: number; t2?: number; label?: string; tone?: "seat" | "flag" | "election" | "news" | "muted" | "good" | "bad"; select?: Selection }
export interface TimelineTrack { id: string; label: string; marks: TimelineMark[] }

export interface LensState {
  /** The open run's key (server's /api/runs `key`), or null on the library. */
  run: string | null;
  /** The current moment, seconds since the run began. */
  t: number;
  /** The run's span: [start, end] seconds (a fork's start is its fork point; t before it is the shared history). */
  span: [number, number];
  playing: boolean;
  /** Simulated seconds per real second while playing. */
  speed: number;
  selection: Selection;
  hovered: Selection;
  tracks: TimelineTrack[];
  setRun(run: string | null): void;
  setT(t: number): void;
  setSpan(span: [number, number]): void;
  setPlaying(p: boolean): void;
  setSpeed(s: number): void;
  select(s: Selection): void;
  hover(s: Selection): void;
  /** Replace one view's track (by id). */
  setTrack(track: TimelineTrack): void;
}

export const useLens = create<LensState>((set) => ({
  run: null,
  t: 0,
  span: [0, 0],
  playing: false,
  speed: 3600,
  selection: null,
  hovered: null,
  tracks: [],
  setRun: (run) => set({ run, selection: null, hovered: null, tracks: [] }),
  setT: (t) => set((s) => ({ t: Math.max(s.span[0], Math.min(s.span[1] || t, t)) })),
  setSpan: (span) => set({ span }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  select: (selection) => set({ selection }),
  hover: (hovered) => set({ hovered }),
  setTrack: (track) => set((s) => ({ tracks: [...s.tracks.filter((x) => x.id !== track.id), track] })),
}));
