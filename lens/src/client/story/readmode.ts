// How the turn reader shows a turn: "skim" (each part folded to its one-line summary, long passages cut to their key
// sentences) or "full" (everything open). Kept per viewer.
import { create } from "zustand";

export type ReadMode = "skim" | "full";
const KEY = "lens.read";
const read = (): ReadMode => { try { return localStorage.getItem(KEY) === "full" ? "full" : "skim"; } catch { return "skim"; } };

export const useReadMode = create<{ mode: ReadMode; set(m: ReadMode): void }>((set) => ({
  mode: read(),
  set: (mode) => { try { localStorage.setItem(KEY, mode); } catch { /* private mode */ } set({ mode }); },
}));
export const useFull = () => useReadMode((s) => s.mode === "full");
