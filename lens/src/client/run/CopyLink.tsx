// "Copy a link to this moment": the page's address with the moment and the selection in it (#/run/<key>?t=…&sel=…),
// as whoever copies it reached Lens (the tailnet name or localhost). Also on the keyboard: L.
import { useEffect, useState } from "react";
import { replaceQuery, selToken } from "../router";
import { useLens } from "../state";

export function linkHere(): string {
  const s = useLens.getState();
  replaceQuery({ t: String(Math.round(s.t)), sel: selToken(s.selection) });
  return window.location.href;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // (Over plain http on a phone the clipboard API may be closed: the old way.)
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CopyLink() {
  const [done, setDone] = useState(false);
  const go = async () => {
    if (await copy(linkHere())) {
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key.toLowerCase() === "l" && !e.metaKey && !e.ctrlKey && !e.altKey) void go();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <button className={`btn ghost run-copy ${done ? "done" : ""}`} onClick={go} title="Copy a link to this moment and selection (L)">
      {done ? "Link copied" : "Copy link"}
    </button>
  );
}
