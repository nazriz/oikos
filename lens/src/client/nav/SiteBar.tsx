// The header of every page that is not the library or an open run: the Lens mark (home), the trail back
// (Library > the run > this page), and the same help and mode buttons as everywhere. The page fills what is below it.
import { useEffect, useState, type ReactNode } from "react";
import type { RunEntry } from "../../shared/api";
import { runHref } from "../router";
import { ThemeToggle } from "../theme";
import { HelpButtons, ModeSwitch, SiteLinks } from "../shell/Shell";
import { getCatalogue } from "./RunNav";
import { useLens } from "../state";
import { runLabel } from "./nav";
import "./nav.css";

/** The catalogue entry of a run, once the catalogue is in. */
export function useEntry(key: string | undefined): RunEntry | undefined {
  const [e, setE] = useState<RunEntry>();
  useEffect(() => {
    if (!key) return;
    let live = true;
    getCatalogue().then((c) => live && setE(c.runs.find((r) => r.key === key)), () => {});
    return () => {
      live = false;
    };
  }, [key]);
  return e;
}

/** The page under a site bar: `run` is the run the page is about (a link back to it), `here` names the page. */
export function SitePage({ run, here, children }: { run?: string; here: string; children: ReactNode }) {
  const entry = useEntry(run);
  // (The run the page is about is the open one, where the page has not said otherwise: the hover cards name its people
  // and buildings from it.)
  useEffect(() => {
    if (!run || useLens.getState().run) return;
    useLens.getState().setRun(run);
    return () => {
      if (useLens.getState().run === run) useLens.getState().setRun(null);
    };
  }, [run]);
  return (
    <div className="site-page">
      <header className="site-bar">
        <a className="site-home head" href="#/" title="Back to all runs">
          Lens
        </a>
        <nav className="crumbs" aria-label="Where you are">
          <a className="crumb" href="#/" title="All runs">
            Library
          </a>
          <Sep />
          {run && (
            <>
              <a className="crumb" href={runHref(run)} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); const s = useLens.getState(); window.location.hash = runHref(run, s.t ? { t: Math.round(s.t) } : undefined); }} title="Back to this run, at the moment shown here">
                {runLabel(entry) || "The run"}
              </a>
              <Sep />
            </>
          )}
          <span className="crumb here">{here}</span>
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
      <div className="site-body">{children}</div>
    </div>
  );
}

const Sep = () => (
  <svg className="crumb-sep" viewBox="0 0 6 10" aria-hidden="true">
    <path d="M1 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);
