// The shell's header on every page that is not the library or a run (those have their own): Lens, the trail back
// (Library, the run it belongs to, this page), the site's links, help, the mode and the theme. Nobody lands on a page
// without a way home.
import { useEffect, useState } from "react";
import type { RunEntry } from "../../shared/api";
import { fetchRun } from "../api";
import { runHref, selToken, type Route } from "../router";
import { useLens } from "../state";
import { HelpButtons, ModeSwitch, SiteLinks } from "../shell/Shell";
import { ThemeToggle } from "../theme";
import { runLabel } from "./nav";
import "./nav.css";

const TITLES: Partial<Record<Route["page"], string>> = {
  compare: "Beside the rule-based mayor",
  power: "Who holds power",
  models: "Models",
  findings: "Findings",
  moments: "Moments",
  diff: "The same day, several mayors",
  digest: "On one page",
};

/** The run a page belongs to, if any. */
export const runOf = (r: Route): string | undefined => (r.page === "power" || r.page === "digest" ? r.key : r.page === "compare" ? r.a : r.page === "diff" ? r.keys[0] : undefined);

export function SiteBar({ route }: { route: Route }) {
  const key = runOf(route);
  const [entry, setEntry] = useState<RunEntry>();
  useEffect(() => {
    setEntry(undefined);
    if (key) fetchRun(key).then(setEntry, () => {});
  }, [key]);
  const title = TITLES[route.page] ?? "";
  // (A person, building or turn picked on this page opens in its run, at this page's moment: the run is where a
  // life, a building or a turn is read.)
  useEffect(() => {
    if (!key) return;
    return useLens.subscribe((s, prev) => {
      // (People, buildings and organisations only: a page may use a turn's selection for itself.)
      if (!s.selection || selToken(s.selection) === selToken(prev.selection)) return;
      if (s.selection.kind !== "person" && s.selection.kind !== "structure" && s.selection.kind !== "entity") return;
      window.location.hash = runHref(key, { ...(s.t > 0 ? { t: Math.round(s.t) } : {}), sel: selToken(s.selection) });
    });
  }, [key]);
  return (
    <header className="site-bar lens-no-print">
      <a className="run-home head" href="#/" title="All runs (g then l)">
        Lens
      </a>
      <nav className="crumbs" aria-label="Where you are">
        <a className="crumb" href="#/">
          Library
        </a>
        {key && route.page !== "diff" && (
          <>
            <Sep />
            <a className="crumb" href={runHref(key)} title="Back to this run">
              {runLabel(entry) || "The run"}
            </a>
          </>
        )}
        <Sep />
        <span className="crumb here">{title}</span>
      </nav>
      <span className="site-bar-actions">
        <SiteLinks />
        <span className="help-btns">
          <HelpButtons />
        </span>
        <ModeSwitch />
        <ThemeToggle />
      </span>
    </header>
  );
}

const Sep = () => (
  <svg className="crumb-sep" viewBox="0 0 6 10" aria-hidden="true">
    <path d="M1 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);
