// How an act ended, read from a log. An act takes time: the log says it started (action_started, naming the command
// that began it) and later that it was applied or refused (action_applied, action_refused, naming the action and, as
// the cause, the step of the clock that ended it, not the act). So an act is joined to how it ended by its action id.
// An action that was refused without ever starting carries the command itself as its cause. Every reader of a log
// that asks "was this act applied" goes through this, so none looks for the end under the act's own command.

export interface ActEnds {
  /** An action_started event: the action is under way, begun by that command. */
  started(b: any): void;
  /** The command whose act this applied/refused event ends; the action is then no longer under way. */
  ended(b: any): number;
  /** Commands whose action has started and not yet ended. */
  readonly underWay: Set<number>;
}

export function actEnds(): ActEnds {
  const startedBy = new Map<string, number>(); // an action under way -> the command that began it
  const underWay = new Set<number>();
  return {
    underWay,
    started(b) {
      if (typeof b.action !== "string") return;
      // (An act put back and begun again, its performer having run out of the day, is started a second time by the
      // event that put it back: the command that began it is still the first start's.)
      if (startedBy.has(b.action)) return;
      startedBy.set(b.action, b.cause);
      underWay.add(b.cause);
    },
    ended(b) {
      const seq = typeof b.action === "string" && startedBy.has(b.action) ? startedBy.get(b.action)! : b.cause;
      if (typeof b.action === "string") startedBy.delete(b.action);
      underWay.delete(seq);
      return seq;
    },
  };
}
