// Lens's client: the shell. Fonts are served from this machine (no CDN), the theme is set before paint (index.html).
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import "./theme.css";
import "./shell.css";
import { createRoot } from "react-dom/client";
import { Library } from "./library/Library";
import { RunPage } from "./run/RunPage";
import { useRoute } from "./router";

function App() {
  const route = useRoute();
  if (route.page === "run") return <RunPage key={route.key} runKey={route.key} q={route.q} />;
  return <Library q={route.q} />;
}

createRoot(document.getElementById("root")!).render(<App />);
