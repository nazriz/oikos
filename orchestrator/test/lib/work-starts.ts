// A work takes its performers' hours (foundations F1, 2026-10-15), so it takes effect hours after it was ordered: the
// `worked` event is at the end. A working day is counted on the day the work starts, and the hours it is done in are the
// hours it was worked in. This gives, for each `worked` event of a run's events, the second its work started.
// (Work the world could not yet show would be done when the act was ordered is placed when the act takes effect, and
// the kernel counts its hours on that day: the act's own time then is shorter than a performer's share of the hours,
// and the work starts at the `worked` event, not at the act. Foundations F7, 2026-10-16: a night stint over midnight was
// counted on the day of its act, a day before the kernel counted it, and one person seemed to work 7.7 hours.)
export function workStarts(ev: any[]): Map<any, number> {
  const startedAt = new Map<string, number>();
  for (const e of ev) if (e.event === "action_started") startedAt.set(e.action, e.starts as number);
  const out = new Map<any, number>();
  let applied = "";
  for (const e of ev) {
    if (e.event === "action_applied") applied = e.action;
    else if (e.event === "worked") {
      const from = startedAt.get(applied) ?? e.t, share = Math.ceil(e.labour / Math.max(1, e.performers?.length ?? 1));
      out.set(e, e.t - from < share ? e.t : from);
    }
  }
  return out;
}
