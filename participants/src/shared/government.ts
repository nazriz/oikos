

/** A budget's year in days, as its papers say it: "day 0 to day 364". (Year 1 begins with the town's records.) */
export const yearInDays = (year: number): string => `day ${(year - 1) * 365} to day ${year * 365 - 1}`;

/** The lines of the budget the mayor's office tables, from what it is given for each (a line it is given nothing for
 * is left out, but for parks, which every budget of the town's has). The generator writes the budget a town opens
 * with by the same rule, so the first year's budget is one this office would have tabled. */
export function tabledLines(p: { park_budget: number; road_budget?: number; staff_budget?: number; administration_budget?: number; services_budget?: number; environment_budget?: number }): Record<string, number> {
  return { parks: p.park_budget, ...(p.road_budget ? { roads: p.road_budget } : {}), ...(p.staff_budget ? { staff: p.staff_budget } : {}), ...(p.administration_budget ? { administration: p.administration_budget } : {}), ...(p.services_budget ? { services: p.services_budget } : {}), ...(p.environment_budget ? { environment: p.environment_budget } : {}) };
}

/** The town's budget for a year, of those adopted (the latest, if the council adopted more than one for it). */
/** Who voted which way on a ballot of the council, as its result records it: a council's votes are public record. */
export function votedWords(yes: string[], no: string[], none: string[]): string {
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  return `Voting for: ${list(yes)}; against: ${list(no)}${none.length ? `; not voting: ${list(none)}` : ""}.`;
}
