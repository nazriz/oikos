// A work takes its performers' hours (foundations F1, 2026-10-15), so it takes effect hours after it was ordered: the
// `worked` event is at the end. A working day is counted on the day the work starts, and the hours it is done in are the
// hours it was worked in. This gives, for each `worked` event of a run's events, the second its work started.
export function workStarts(ev: any[]): Map<any, number> {
  const startedAt = new Map<string, number>();
  for (const e of ev) if (e.event === "action_started") startedAt.set(e.action, e.starts as number);
  const out = new Map<any, number>();
  let applied = "";
  for (const e of ev) {
    if (e.event === "action_applied") applied = e.action;
    else if (e.event === "worked") out.set(e, startedAt.get(applied) ?? e.t);
  }
  return out;
}
