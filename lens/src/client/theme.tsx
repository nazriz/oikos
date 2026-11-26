// Dark or light: the viewer's choice (kept in this browser), else the system's.
import { useEffect, useState } from "react";
import { Moon, Sun } from "./icons";

type Theme = "dark" | "light";
const system = (): Theme => (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark");
const chosen = (): Theme | undefined => {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : undefined;
};

/** The theme in force, following the system until the viewer picks one. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => chosen() ?? system());
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    const f = () => !chosen() && setTheme(system());
    mq?.addEventListener("change", f);
    return () => mq?.removeEventListener("change", f);
  }, []);
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", theme === "light" ? "#f6f3ec" : "#0b0f17");
  }, [theme]);
  const set = (t: Theme) => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("lens.theme", t);
    } catch {}
    setTheme(t);
    window.dispatchEvent(new Event("lens-theme"));
  };
  return [theme, set];
}

export function ThemeToggle() {
  const [theme, set] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button className="btn ghost icon" title={`Switch to ${next}`} aria-label={`Switch to ${next} theme`} onClick={() => set(next)}>
      {theme === "dark" ? <Sun /> : <Moon />}
    </button>
  );
}
