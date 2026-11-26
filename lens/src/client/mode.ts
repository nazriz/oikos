// Story mode or Researcher mode, the tutorial and the glossary: a small store every page reads. Story mode (the default
// on a first visit) shows one thing at a time in plain words; Researcher mode shows everything. Kept in this browser.
import { create } from "zustand";

export type Mode = "story" | "researcher";

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export interface ModeState {
  mode: Mode;
  /** The tutorial's step, or null when closed. */
  tour: number | null;
  glossary: boolean;
  setMode(m: Mode): void;
  startTour(step?: number): void;
  setTour(step: number | null): void;
  setGlossary(open: boolean): void;
}

export const useMode = create<ModeState>((set) => ({
  mode: read("lens.mode") === "researcher" ? "researcher" : "story",
  tour: null,
  glossary: false,
  setMode: (mode) => {
    write("lens.mode", mode);
    set({ mode });
  },
  // (Seen once it starts: the walk goes back to the library on its way, and must not start itself again there.)
  startTour: (step = 0) => {
    write("lens.toured", "1");
    set({ tour: step, glossary: false });
  },
  setTour: (tour) => {
    if (tour === null) write("lens.toured", "1");
    set({ tour });
  },
  setGlossary: (glossary) => set({ glossary }),
}));

/** True in Researcher mode: for a view deciding whether to show its advanced parts. */
export const useResearcher = () => useMode((s) => s.mode === "researcher");

/** Whether this browser has seen the tutorial (it opens by itself once, on a first visit). */
export const toured = () => read("lens.toured") === "1";
