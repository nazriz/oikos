// What a unit of work takes where skill speeds it (labour_by: docs/behaviour/education.md), as the engine reckons it:
// the performers' mean skill when the work was done (from the world's start and the log's changes since), scaling the
// task's labour from all of it at the variable's minimum to `at_max_bps` at its maximum. Undefined for someone whose
// skill the log doesn't say (a newcomer's isn't in the config).

export function skillClock(config: any, ev: any[]) {
  const history = new Map<string, { t: number; value: number }[]>();
  for (const e of config.world.entities) if (e.variables) for (const [v, value] of Object.entries(e.variables)) history.set(`${e.id}|${v}`, [{ t: 0, value: value as number }]);
  for (const e of ev) if (e.event === "body_changed") (history.get(`${e.person}|${e.variable}`) ?? history.set(`${e.person}|${e.variable}`, []).get(`${e.person}|${e.variable}`)!).push({ t: e.t, value: e.value });
  const at = (person: string, variable: string, t: number) => history.get(`${person}|${variable}`)?.filter((x) => x.t <= t).at(-1)?.value;
  /** The labour the engine charges for this `worked` event, or undefined if a performer's skill isn't known. */
  return (w: { t: number; units: number; performers: string[] }, task: any): number | undefined => {
    if (!task.labour_by) return w.units * task.labour;
    const cfg = config.catalogue.body_variables.find((v: any) => v.id === task.labour_by.variable);
    const skills = w.performers.map((p) => at(p, cfg.id, w.t));
    if (skills.some((x) => x === undefined)) return undefined;
    const mean = Math.floor((skills as number[]).reduce((a, b) => a + b, 0) / skills.length);
    const factor = 10_000 - Math.floor(((10_000 - task.labour_by.at_max_bps) * (mean - cfg.min)) / (cfg.max - cfg.min));
    return Math.max(1, Math.ceil((w.units * task.labour * factor) / 10_000));
  };
}
