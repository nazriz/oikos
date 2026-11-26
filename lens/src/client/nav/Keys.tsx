// The keyboard, everywhere in Lens, and the sheet that lists it (?). Esc steps out one level; j/k move between the AI
// mayor's turns and [ ] between power grabs (the turn reader has its own, the same, while it is open); g then l goes to
// the library. Other keys belong to their parts (the timeline's play and step, the search, copy link) and are listed.
import { useEffect } from "react";
import { useMode } from "../mode";
import { useLens } from "../state";
import { W } from "../words";
import { goTo, isMoment, stepOut, useNav } from "./nav";
import type { SeatJson } from "../../folds/seat";
import { fetchFold } from "../api";

const typing = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable);
};

async function step(kind: "sitting" | "lever", dir: 1 | -1) {
  const s = useLens.getState();
  if (!s.run) return;
  const seat = await fetchFold<SeatJson>(s.run, "seat").catch(() => undefined);
  if (!seat) return;
  const t = s.t;
  if (kind === "sitting") {
    const list = seat.sittings;
    const n = dir > 0 ? list.find((x) => x.t > t + 1) : [...list].reverse().find((x) => x.t < t - 1);
    if (n) goTo({ kind: "sitting", index: n.i });
  } else {
    const strong = seat.levers.filter((l) => l.level !== "considered");
    const list = strong.length ? strong : seat.levers;
    const n = dir > 0 ? list.find((x) => x.t > t + 1) : [...list].reverse().find((x) => x.t < t - 1);
    if (n) goTo({ kind: "lever", index: n.i });
  }
}

export function Keys() {
  const open = useNav((s) => s.keys);
  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const nav = useNav.getState();
      const m = useMode.getState();
      if (e.key === "?") {
        e.preventDefault();
        nav.setKeys(!nav.keys);
        return;
      }
      if (e.key === "Escape") {
        if (nav.keys) return nav.setKeys(false);
        // (An open popover closes itself first: it carries data-esc-own.)
        if (m.glossary || m.tour !== null || e.defaultPrevented || document.querySelector("[data-esc-own]")) return;
        // (The turn reader closes itself on Esc.)
        if (isMoment(useLens.getState().selection) && document.querySelector(".run-reader")) return;
        // (Handled here alone: a turn reader opened by this very step would otherwise take the same key and close.)
        if (stepOut()) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
      if (g && Date.now() - g < 1200) {
        g = 0;
        const to = e.key === "l" ? "#/" : e.key === "f" ? "#/findings" : e.key === "m" ? "#/moments" : null;
        if (to) {
          e.stopImmediatePropagation();
          e.preventDefault();
          window.location.hash = to;
        }
        return;
      }
      if (e.key === "g") {
        g = Date.now();
        return;
      }
      // j/k and [ ]: in a run, when the turn reader is not open (it has the same keys of its own).
      if (!useLens.getState().run || document.querySelector(".run-reader")) return;
      if (e.key === "j" || e.key === "k") void step("sitting", e.key === "j" ? 1 : -1);
      else if (e.key === "]" || e.key === "[") void step("lever", e.key === "]" ? 1 : -1);
    };
    const onOpen = () => useNav.getState().setKeys(!useNav.getState().keys);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("lens-keys", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("lens-keys", onOpen);
    };
  }, []);
  if (!open) return null;
  return <KeySheet onClose={() => useNav.getState().setKeys(false)} />;
}

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: "Getting around",
    rows: [
      [["Esc"], "step out one level"],
      [["Back"], "back through what you opened"],
      [["g", "l"], "the library of runs"],
      [["g", "f"], "findings across runs"],
      [["g", "m"], "power grab moments"],
      [["⌘K"], "search this run (or /)"],
      [["L"], "copy a link to here"],
      [["?"], "this sheet"],
    ],
  },
  {
    title: W.Seat,
    rows: [
      [["j", "k"], `next or previous ${W.sitting}`],
      [["[", "]"], `previous or next ${W.lever}`],
    ],
  },
  {
    title: "Time",
    rows: [
      [["space"], "play or pause"],
      [["←", "→"], "an hour back or on"],
      [["⇧", "← →"], "a day back or on"],
      [[",", "."], "previous or next key moment"],
      [["<", ">"], "previous or next mark"],
      [["-", "="], "play slower or faster"],
      [["Home", "End"], "start or end of the run"],
    ],
  },
];

function KeySheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="keys-back" onMouseDown={onClose}>
      <section className="keys" role="dialog" aria-label="Keyboard" onMouseDown={(e) => e.stopPropagation()}>
        <div className="keys-head">
          <h2 className="head">Keyboard</h2>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="keys-cols">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h3 className="keys-h">{g.title}</h3>
              <dl>
                {g.rows.map(([ks, what]) => (
                  <div key={what} className="keys-row">
                    <dt>
                      {ks.map((k) => (
                        <kbd key={k} className="kbd">
                          {k}
                        </kbd>
                      ))}
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
