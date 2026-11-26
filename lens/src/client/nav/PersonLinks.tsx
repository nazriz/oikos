// Every person's id, anywhere, opens their life. In an open run that is the inspector (a selection); on a page about a
// run that has no inspector (Who holds power, Compare, the same day side by side, the digest), it is that run opened
// with the person selected, at the moment shown. Mounted once (main.tsx).
//   - Clicks on [data-person] (the id links in the mayor's words, src/client/story/text.tsx) select the person, wherever
//     they are; a view that handles them itself first is left alone.
//   - A person selected on a page with no inspector (Who holds power's chips select one) goes to the run.
import { useEffect } from "react";
import { parseHash, runHref, useRoute, type Route } from "../router";
import { useLens } from "../state";

/** The run a page is about, if any. */
export function runOfRoute(r: Route): string | undefined {
  if (r.page === "run" || r.page === "power" || r.page === "digest") return r.key;
  if (r.page === "compare") return useLens.getState().run ?? r.a;
  if (r.page === "diff") return r.keys[0];
  return undefined;
}

function openLife(id: string) {
  const r = parseHash(window.location.hash);
  if (r.page === "run") return useLens.getState().select({ kind: "person", id });
  const run = runOfRoute(r);
  if (!run) return;
  const s = useLens.getState();
  window.location.hash = runHref(run, { t: s.run === run && s.t ? Math.round(s.t) : undefined, sel: `person:${id}` });
}

export function PersonLinks() {
  const route = useRoute();
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-person]");
      if (!el?.dataset.person) return;
      e.preventDefault();
      e.stopPropagation();
      openLife(el.dataset.person.replace(/-self$/, ""));
    };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, []);
  // (Off a run's own page, a person selected by a view goes to the run, where their life opens.)
  useEffect(() => {
    if (route.page === "run") return;
    return useLens.subscribe((s, prev) => {
      if (s.selection === prev.selection || s.selection?.kind !== "person") return;
      openLife(s.selection.id.replace(/-self$/, ""));
    });
  }, [route.page]);
  return null;
}
