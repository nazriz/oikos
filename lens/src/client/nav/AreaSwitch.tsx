// The three parts of Lens, one switch at the top of every page (Naz, 2026-11-28: "selectors at the top of the page to go
// between the overview part, map viewer thing and data"): Overview (the landing, with Models, Findings and Moments as
// its own tabs), Town (a run's page, the map in front: the last run looked at, else the featured one) and Data (the
// study's raw data: the table, and one run's raw view). The part you are in is the one selected.
import { townHref, runHref, useRoute, type Route } from "../router";
import { lastPlace } from "./nav";
import { views } from "../views";

export type Area = "overview" | "town" | "data";

export function areaOf(r: Route): Area {
  if (r.page === "library" || r.page === "models" || r.page === "findings" || r.page === "moments") return "overview";
  if (r.page === "data" || r.page === "rundata") return "data";
  return "town";
}

/** Where Town goes: the run last looked at in this browser, at its moment; else the featured run. */
export function townTarget(): string {
  const l = lastPlace();
  return l ? runHref(l.key, { t: l.t }) : townHref();
}

export function AreaSwitch() {
  const area = areaOf(useRoute());
  const items: { id: Area; label: string; href: string; title: string }[] = [
    { id: "overview", label: "Overview", href: "#/", title: "What the study found, across every run" },
    { id: "town", label: "Town", href: townTarget(), title: "One run's town on its map, turn by turn (the last run you looked at)" },
    { id: "data", label: "Data", href: "#/data", title: "The study's raw data: every run's fields, and each run's files as written" },
  ];
  return (
    <nav className="seg area-switch" aria-label="Part of Lens">
      {items.map((x) => (
        <a key={x.id} href={x.href} aria-current={area === x.id ? "page" : undefined} aria-pressed={area === x.id} title={x.title}>
          {x.label}
        </a>
      ))}
    </nav>
  );
}

/** The Overview's own pages, as a row of tabs under the switch: the landing, Models, Findings, Moments. */
export function OverviewTabs() {
  const r = useRoute();
  const tabs = [
    { page: "library", href: "#/", label: "The finding" },
    views.models ? { page: "models", href: "#/models", label: "Models" } : null,
    views.findings ? { page: "findings", href: "#/findings", label: "Findings" } : null,
    views.moments ? { page: "moments", href: "#/moments", label: "Moments" } : null,
  ].filter((x): x is { page: string; href: string; label: string } => x !== null);
  return (
    <nav className="overview-tabs" aria-label="Overview">
      {tabs.map((t) => (
        <a key={t.page} href={t.href} aria-current={r.page === t.page ? "page" : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}
