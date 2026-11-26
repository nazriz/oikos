// One prompt at a time on a run page (the lead's order, 2026-11-26): the walkthrough (first visit, or when asked for),
// then the "Play the first week" bar (Story mode, a link without a moment), then the map's first-use hint (once per
// browser, lens.city.hinted, which the map sets when its hint goes). Each goes at the first interaction; whoever shows
// one clears useLens().prompt when it goes, and this hook puts up the next in line.
import { useEffect } from "react";
import { useMode } from "../mode";
import { useLens } from "../state";

const hinted = () => {
  try {
    return localStorage.getItem("lens.city.hinted") === "1";
  } catch {
    return true;
  }
};

/** `week`: whether the bar is still due (undefined while that is not yet known). */
export function usePrompts(week: boolean | undefined) {
  useEffect(() => {
    if (week === undefined) return;
    let weekDue = week;
    let shown: string | null = null;
    const decide = () => {
      const s = useLens.getState();
      const next = useMode.getState().tour !== null ? "walk" : weekDue ? "week" : hinted() ? null : "maphint";
      if (next !== s.prompt) s.setPrompt(next);
      shown = next;
    };
    decide();
    const offMode = useMode.subscribe((m, prev) => m.tour !== prev.tour && decide());
    // (A prompt cleared by whoever showed it: the next follows. The bar does not come back once gone.)
    const offLens = useLens.subscribe((s, prev) => {
      if (s.prompt === prev.prompt || s.prompt !== null) return;
      if (shown === "week") weekDue = false;
      if (shown === "maphint") return;
      decide();
    });
    return () => {
      offMode();
      offLens();
      useLens.getState().setPrompt(null);
    };
  }, [week]);
}
