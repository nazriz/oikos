// The inspector drawer's body for what the map selects: a structure (or an organisation, at its premises) or a person.
// Registered by the shell in src/client/views.ts as views.inspector.{structure, entity, person}. It shares the map's
// loaded data (useCity), so it costs nothing more when the map is open.
import type { Selection } from "../state";
import { useLens } from "../state";
import { useCity, structureName } from "./CityView";
import { PersonBody, StructureBody } from "./Panel";
import { CITY_CSS } from "./style";

export function CityInspector({ run, selection }: { run: string; selection: NonNullable<Selection> }) {
  const t = useLens((s) => s.t);
  const { city, error } = useCity(`/api/run/${encodeURIComponent(run)}`);
  if (error) return <div className="lens-city lc-insp"><div className="lc-err">{error}</div></div>;
  if (!city) return <div className="lens-city lc-insp"><div className="lc-note">Reading the town…</div></div>;
  const name = (i: number) => structureName(city, i);
  let body = <div className="lc-note">Not on the map.</div>;
  if (selection.kind === "structure") { const i = city.sById.get(selection.id); if (i !== undefined) body = <StructureBody c={city} i={i} t={t} name={name} full />; }
  else if (selection.kind === "entity") { const i = city.town.entities[selection.id]?.structure; if (i !== undefined) body = <StructureBody c={city} i={i} t={t} name={name} full />; }
  else if (selection.kind === "person") { const q = city.pById.get(selection.id); if (q !== undefined) body = <PersonBody c={city} q={q} t={t} name={name} full />; }
  return (
    <div className="lens-city lc-insp">
      <style>{CITY_CSS}</style>
      {body}
    </div>
  );
}
