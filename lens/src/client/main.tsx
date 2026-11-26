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

function App() {
  const route = useRoute();
  if (route.page === "run") return <RunPage key={route.key} runKey={route.key} q={route.q} />;
  if (route.page === "compare") {
    const Compare = views.compare;
    if (Compare) return <Compare a={route.a} b={route.b} />;
    return (
      <div className="lib-empty">
        Comparing two runs side by side is on its way. Meanwhile, open <a href={runHref(route.a)}>the first</a> or <a href={runHref(route.b)}>the second</a>.
      </div>
    );
  }
  if (route.page === "moments" && views.moments) {
    const Moments = views.moments;
    return <Moments />;
  }
  if (route.page === "digest" && views.digest) {
    const Digest = views.digest;
    return <Digest run={route.key} />;
  }
  if (route.page === "power" && views.power) {
    const Power = views.power;
    return <Power run={route.key} />;
  }
  if (route.page === "models" && views.models) {
    const Models = views.models;
    return <Models />;
  }
  if (route.page === "findings" && views.findings) {
    const Findings = views.findings;
    return <Findings />;
  }
  if (route.page === "diff" && views.diff) {
    const Diff = views.diff;
    const day = Number(route.q.get("day"));
    return <Diff keys={route.keys} {...(route.q.has("day") && Number.isFinite(day) ? { day } : {})} />;
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
  </>,
);
