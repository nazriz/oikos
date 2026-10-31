// Skills that grow with use and fade without it (docs/design/foundations-2.md 7.4, step E4; docs/behaviour/skills.md).
//
// Off unless a town's description asks (`skills`): then every kind of work in the town's catalogue (each task that takes
// time, grouped by the stem of its id: `make-food` is making, `serve-food` serving) and a person's papers (`publish`, any
// kind) have a skill of their own, a body variable the kernel practises and fades (`practice`), and the work's time scales
// with it. A study treats skill decay as a factor: off, or on at its own rates. Off, the config is untouched.

/** A town's skills, as its description asks for them (every figure has its default, a placeholder: SKILL_DEFAULTS). */
export interface SkillsSpec {
  /** Of the distance still to mastery, what an hour's use closes, in basis points. */
  gain_bps_per_hour?: number;
  /** Unused, the part of a skill above its floor halves every so many days. */
  half_life_days?: number;
  /** What is never lost, as a share of mastery (basis points). */
  floor_bps?: number;
  /** A novice's time, as a share of an ordinary hand's (basis points, 10,000 or more). */
  novice_bps?: number;
  /** A master's time, as a share of an ordinary hand's (basis points, at most 10,000). */
  expert_bps?: number;
  /** Only these skills are live (by name: a task's stem, `make`, `serve`, ..., or `papers`). Absent: all. */
  only?: string[];
}

/** Each a placeholder (docs/behaviour/skills.md): the shapes are from the literature (to confirm), the sizes are not fitted. */
export const SKILL_DEFAULTS = { gain_bps_per_hour: 10, half_life_days: 365, floor_bps: 2_500, novice_bps: 20_000, expert_bps: 8_000 } as const;

/** A skill's scale: none to mastery. */
export const SKILL_MAX = 10_000;

/** The skill of a person's papers: every `publish` act a person does, whatever its kind. */
export const PAPERS = "papers";

/** The name of a task's skill: its id's stem (`make-food` is `make`). */
export const skillOfTask = (task: string) => task.split("-")[0];

/** The body variable of a skill. */
export const skillVariable = (skill: string) => `skill-${skill}`;

/**
 * The level of an ordinary hand: where a full-time worker settles, the hours of a week's work spread over its days
 * gaining what the days unused take away (derived from the run's own rates; the table of work's times are this hand's).
 */
export function ordinaryLevel(s: Required<Omit<SkillsSpec, "only">>, hoursPerDay: number): number {
  const floor = (s.floor_bps * SKILL_MAX) / 10_000;
  const gain = (s.gain_bps_per_hour / 10_000) * hoursPerDay;
  const fade = 1 - 2 ** (-1 / s.half_life_days);
  return Math.round(floor + ((SKILL_MAX - floor) * gain) / (gain + fade));
}

/** The config with skills, as `spec` asks (undefined or false: the config as it is). */
export function withSkills(config: any, spec: boolean | SkillsSpec | undefined, hoursPerDay: number): any {
  if (!spec) return config;
  const s = { ...SKILL_DEFAULTS, ...(spec === true ? {} : spec) };
  if (!(s.half_life_days >= 1) || !(s.floor_bps >= 0 && s.floor_bps <= 10_000) || !(s.gain_bps_per_hour >= 0 && s.gain_bps_per_hour <= 10_000)
    || !(s.novice_bps >= 10_000) || !(s.expert_bps >= 0 && s.expert_bps <= 10_000)) throw new Error(`skills: ${JSON.stringify(spec)} is out of range (docs/behaviour/skills.md)`);
  const live = (skill: string) => !s.only || s.only.includes(skill);
  const cat = config.catalogue;
  const tasks = (cat.tasks ?? []).map((t: any) => (t.labour > 0 && live(skillOfTask(t.id)) ? { ...t, skill: { variable: skillVariable(skillOfTask(t.id)), novice_bps: s.novice_bps, expert_bps: s.expert_bps } } : t));
  const skills = [...new Set(tasks.filter((t: any) => t.skill).map((t: any) => skillOfTask(t.id))), ...(live(PAPERS) ? [PAPERS] : [])];
  const known = new Set([...tasks.map((t: any) => skillOfTask(t.id)), PAPERS]);
  for (const x of s.only ?? []) if (!known.has(x)) throw new Error(`skills.only: ${x} is no skill of this town (its skills: ${[...known].join(", ")})`);
  const initial = ordinaryLevel(s, hoursPerDay);
  const practice = { gain_bps_per_hour: s.gain_bps_per_hour, half_life_days: s.half_life_days, floor: Math.round((s.floor_bps * SKILL_MAX) / 10_000) };
  return {
    ...config,
    catalogue: {
      ...cat,
      tasks,
      body_variables: [...(cat.body_variables ?? []), ...skills.map((k) => ({ id: skillVariable(k), min: 0, max: SKILL_MAX, initial, practice }))],
      ...(live(PAPERS) ? { act_skills: [{ act: "publish", variable: skillVariable(PAPERS), novice_bps: s.novice_bps, expert_bps: s.expert_bps }] } : {}),
    },
  };
}
