// Town memory (docs/design/ai-citizens.md 14e; docs/behaviour/culture.md, "Town memory"): what a person carries of what happened to others and
// was public. Nothing here is the town's: a few typed slots in one person's own record, each with a strength that fades, and a count of the hands it
// has passed through. An event reaches a person only three ways and no fourth: they were there (their own place put them there), it was published and
// they read it, or someone they know told them. Telling is by the same typed phrases catching up uses; fading is worked out when read, from the days
// gone (nothing runs daily); there is no draw. Arithmetic only: no model, no clock.
//
// The platform judges nothing: what an event does to a person's trust is the sign of their OWN view of the conduct it shows, never the platform's.
// Every size is a PLACEHOLDER unless docs/behaviour/culture.md names a source; one set for every kind of event.


/** What a person may remember of the town, in the order the record keeps them (a closed list; the kinds that something in the world makes public). */
export const EVENT_KINDS = ["put_out", "strike", "ruling", "law", "vote", "founded"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** The conduct an event shows, for the sighting it is of that conduct and for the sign of its bearing on trust (a person's own view of that conduct). */
export const EVENT_CONDUCT: { [k in EventKind]?: "apply_possession" | "strike" } = { put_out: "apply_possession", strike: "strike" };

/**
 * Which way an event bears on trust in whoever did it, for a person whose own view of the conduct it shows is `ownBps`: +1 (trust rises), -1 (it falls), 0 (no view, no move).
 * A removal held right is the doer vindicated; a walk-out held right is the employer's trust lost. The sign is the person's, never the platform's; the measure of
 * movement toward or away from the party reads it from the same place.
 */
export const trustDirection = (kind: EventKind, ownBps: number): 1 | -1 | 0 => (ownBps === 5_000 || !EVENT_CONDUCT[kind] ? 0 : (kind === "put_out" ? ownBps > 5_000 : ownBps < 5_000) ? 1 : -1);
