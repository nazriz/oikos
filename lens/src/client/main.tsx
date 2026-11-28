// Lens's client: the shell. Fonts are served from this machine (no CDN), the theme is set before paint (index.html).
import "./fonts.css";
import "./theme.css";
import "./shell.css";
import { createRoot } from "react-dom/client";
import { Library } from "./library/Library";
import { RunPage } from "./run/RunPage";
import { runHref, useRoute } from "./router";
import { views } from "./views";
import { Glossary } from "./shell/Shell";
import { Tour } from "./shell/Tour";
import { Keys } from "./nav/Keys";
import { Peek } from "./nav/Peek";
import { IdTip } from "./story/IdTip";
import { SitePage } from "./nav/SiteBar";
import { RunData } from "./data/RunData";
import { PersonLinks } from "./nav/PersonLinks";
import { DataPage } from "./data/DataPage";

function App() {
  const route = useRoute();
  if (route.page === "run") return <RunPage key={route.key} runKey={route.key} q={route.q} />;
  if (route.page === "compare") {
    const Compare = views.compare;
    if (Compare)
      return (
        <SitePage run={route.a} here="Compare with the rule-based mayor">
          <Compare a={route.a} b={route.b} />
        </SitePage>
      );
    return (
      <div className="lib-empty">
        Comparing two runs side by side is on its way. Meanwhile, open <a href={runHref(route.a)}>the first</a> or <a href={runHref(route.b)}>the second</a>.
      </div>
    );
  }
  if (route.page === "data") {
    return (
      <SitePage here="Data">
        <DataPage q={route.q} />
      </SitePage>
    );
  }
  if (route.page === "moments" && views.moments) {
    const Moments = views.moments;
    return (
      <SitePage here="Moments">
        <Moments />
      </SitePage>
    );
  }
  if (route.page === "digest" && views.digest) {
    const Digest = views.digest;
    return (
      <SitePage run={route.key} here="On one page">
        <Digest run={route.key} />
      </SitePage>
    );
  }
  if (route.page === "power" && views.power) {
    const Power = views.power;
    return (
      <SitePage run={route.key} here="Who holds power">
        <Power run={route.key} />
      </SitePage>
    );
  }
  if (route.page === "models" && views.models) {
    const Models = views.models;
    return (
      <SitePage here="Models">
        <Models />
      </SitePage>
    );
  }
  if (route.page === "findings" && views.findings) {
    const Findings = views.findings;
    return (
      <SitePage here="Findings">
        <Findings />
      </SitePage>
    );
  }
  if (route.page === "rundata")
    return (
      <SitePage run={route.key} here="Raw data">
        <RunData key={route.key} run={route.key} q={route.q} />
      </SitePage>
    );
  if (route.page === "diff" && views.diff) {
    const Diff = views.diff;
    const day = Number(route.q.get("day"));
    return (
      <SitePage {...(route.keys[0] ? { run: route.keys[0] } : {})} here="The same day, other mayors">
        <Diff keys={route.keys} {...(route.q.has("day") && Number.isFinite(day) ? { day } : {})} />
      </SitePage>
    );
  }
  return <Library q={route.q} />;
}

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <Glossary />
    <Tour />
    <Keys />
    <Peek />
    <IdTip />
    <PersonLinks />
  </>,
);
