

/** Schooling: who goes to school (the ages), and what adults have had (their highest level, as years). */
export interface SchoolingSpec { school_ages: [number, number]; attainment: { label: string; share_bps: number; years: number }[] }

/** Years of schooling at an age: a child's, the years since starting (to the end of school); an adult's, drawn from the
 * attainment shares (`pick(n)`: a uniform draw below n). Shared by the world's generator and the migration office. */
export function yearsOfSchooling(age: number, s: SchoolingSpec, pick: (n: number) => number): number {
  if (age < 18) return Math.max(0, Math.min(age, s.school_ages[1] + 1) - s.school_ages[0]);
  const total = s.attainment.reduce((a, x) => a + x.share_bps, 0);
  let x = pick(Math.max(1, total));
  for (const a of s.attainment) {
    if (x < a.share_bps) return a.years;
    x -= a.share_bps;
  }
  return s.attainment.at(-1)?.years ?? 0;
}
