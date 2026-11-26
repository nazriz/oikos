// The library's "Carry on": the run and moment this browser last had open, one click back to it.
import { useState } from "react";
import { ago, dayOf } from "../format";
import { runHref } from "../router";
import { lastPlace } from "./nav";
import "./nav.css";

export function CarryOn() {
  const [last] = useState(lastPlace);
  if (!last?.label) return null;
  return (
    <p className="carry-on">
      <span>Carry on where you were:</span>
      <a href={runHref(last.key, { t: last.t, sel: last.sel })}>
        {last.label}, day {dayOf(last.t)}
      </a>
      <span className="muted">{ago(last.at)}</span>
    </p>
  );
}
