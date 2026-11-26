// "About this view": a few plain sentences, in a corner of the run, saying what is shown and what its numbers mean.
// They change with what is open (the whole town, a turn, a power grab, a person, a building). Folded to one line with a
// click; open by default in Story mode, folded in Researcher mode; the viewer's choice is kept in this browser.
import { useMemo, useState } from "react";
import type { Meta } from "../../shared/api";
import { clock, dayNo, dayOf } from "../format";
import { useMode } from "../mode";
import { useLens } from "../state";
import { PAGE_ANSWERS, W } from "../words";
import { isMoment, useNames } from "./nav";

const read = () => {
  try {
    return localStorage.getItem("lens.about");
  } catch {
    return null;
  }
};

export function About({ run, meta, world }: { run: string; meta: Meta; world: boolean }) {
  const researcher = useMode((m) => m.mode === "researcher");
  const [kept, setKept] = useState(read);
  // (Over a turn the reader fills the page: there the panel stays folded unless opened for that turn.)
  const reading = useLens((s) => isMoment(s.selection));
  const [overReader, setOverReader] = useState(false);
  // (On a phone the panel would cover the town: folded there until opened.)
  const open = reading ? overReader : kept ? kept === "open" : !researcher && window.innerWidth > 760;
  const toggle = () => {
    if (reading) return setOverReader(!open);
    const v = open ? "closed" : "open";
    try {
      localStorage.setItem("lens.about", v);
    } catch {}
    setKept(v);
  };
  return (
    <aside className={`about ${open ? "open" : ""}`} aria-label="About this view">
      <button className="about-head" aria-expanded={open} onClick={toggle} title={open ? "Fold this away" : "What am I looking at?"}>
        <span>About this view</span>
        <svg viewBox="0 0 10 6" aria-hidden="true">
          <path d={open ? "M1 5l4-4 4 4" : "M1 1l4 4 4-4"} fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {open && <AboutText run={run} meta={meta} world={world} />}
    </aside>
  );
}

function AboutText({ run, meta, world }: { run: string; meta: Meta; world: boolean }) {
  const sel = useLens((s) => s.selection);
  // (Whole hours: the sentences change with the hour, not every frame while playing.)
  const hour = useLens((s) => Math.floor(s.t / 3600));
  const t = hour * 3600;
  const { name, seat, city } = useNames(run);
  const residents = useMemo(() => {
    if (!city || sel?.kind !== "structure") return undefined;
    const i = city.sById.get(sel.id);
    if (i === undefined) return undefined;
    // (Each person's home is their first: the people fold keeps it; visits to others' homes don't count. Who moved house
    // later is counted at the first.)
    let n = 0;
    const { people, died, left } = city.people;
    for (let q = 0; q < people.length; q++) {
      if ((died[q] ?? Infinity) <= t || (left[q] ?? Infinity) <= t) continue;
      const first = people[q]![5];
      if ((first >= 0 ? city.sMap[first] : -1) === i) n++;
    }
    return n;
  }, [city, sel, Math.floor(t / 86_400)]);

  const lines: string[] = [];
  const place = meta.place ?? "the town";
  if (!sel) {
    lines.push(PAGE_ANSWERS.run);
    lines.push(
      world
        ? `${place} in 3D on day ${dayOf(t)}, ${clock(t)}. The light follows the hour; the walkers are people going between buildings.`
        : `The map of ${place} on day ${dayOf(t)}, ${clock(t)}. Each block is a building; the dots on it are the people inside now.`,
    );
    lines.push(`Yellow is ${W.seat}'s doing; red is a ${W.lever}, as the study's checker flags it. Click anything to open it.`);
  } else if (sel.kind === "sitting") {
    const i = seat?.sittings.findIndex((x) => x.i === sel.index) ?? -1;
    const x = i >= 0 ? seat!.sittings[i]! : undefined;
    lines.push(x ? `This is turn ${i + 1} of ${seat!.sittings.length}, on day ${dayNo(x.day)}: one working session of ${W.seat}.` : `This is one turn of ${W.seat}.`);
    lines.push("It shows what the mayor read when it woke, what it thought and wrote, and each act it sent, with what became of it.");
    if (x?.acts.length) lines.push(`It sent ${x.acts.length === 1 ? "one act" : `${x.acts.length} acts`} in this turn.`);
    lines.push("j and k move to the next and previous turn; Esc closes it.");
  } else if (sel.kind === "lever") {
    const l = seat?.levers[sel.index];
    lines.push(`This is a ${W.lever} as the study's checker flags it${l ? `, on day ${dayNo(l.day)}` : ""}: ${name(sel).replace(/^Power grab: /, "")}.`);
    if (l) lines.push(l.level === "executed" ? "It was carried out: the town's rules accepted it." : l.level === "attempted" ? "The mayor asked for it; it may have been refused or withdrawn." : "It appears only in the mayor's own thinking, found by matching words: often wrong.");
    if (l?.tier) lines.push(`How serious: ${l.tier} of 3, where 3 is the most serious, such as moving the election.`);
    lines.push("The checker is the study's measure, not a verdict: read the turn itself. [ and ] move between power grabs.");
  } else if (sel.kind === "act") {
    lines.push(`This is one act ${W.seat} sent: ${name(sel).replace(/^Day \d+: /, "")}.`);
    lines.push("The clerk turned the mayor's words into the official form; the town's rules then accepted or refused it.");
  } else if (sel.kind === "person") {
    lines.push(`This is ${name(sel)}'s life in the run: where they lived and spent their days, their money day by day, and everything that reached them.`);
    lines.push(`Each item is coloured by who decided it: yellow ${W.seat}, green an organisation, grey-brown a person.`);
  } else if (sel.kind === "structure") {
    const i = city?.sById.get(sel.id);
    const inside = city && i !== undefined ? (city.where.seek(t), city.where.count[i] ?? 0) : undefined;
    lines.push(`This is ${name(sel)}.${residents ? ` ${residents === 1 ? "One person lives" : `${residents} people live`} here.` : ""}`);
    lines.push(
      `The dots on it are people inside right now${inside !== undefined ? `: ${inside === 0 ? "nobody at this hour" : inside === 1 ? "one" : String(inside)}` : ""}. Click one to open their life.`,
    );
  } else if (sel.kind === "entity") {
    const e = city?.town.entities[sel.id];
    lines.push(`This is ${name(sel)}, one of the town's organisations${e ? ` (${e.kind.replace(/[_-]+/g, " ")})` : ""}.`);
    lines.push("It shows where it works from, who works there and the papers it made.");
  }
  return (
    <div className="about-body">
      {lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
    </div>
  );
}
