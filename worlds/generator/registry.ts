// The generator's figure registry (law 11: docs/design/foundations-2.md 5.1, step N4). A number the generator computes
// with is a convention (a unit, a count of days in a week, basis points), read from the profile or the spec, or a figure
// declared here once, its class first in its comment (`sourced`, `to_confirm`, `derived`, `fitted`, `placeholder` or
// `convention`) and then its source or why. orchestrator/test/every-number-has-a-basis.test.ts refuses a figure here with
// no class, and counts the literals still written in the generator (its inventory only shrinks).
//
// Empty at its start (2026-11-08): the generator's literals are still where they are written, counted by file. (Where
// a generated config's numbers come from is worlds/generator/figures.ts, a separate table.)

/** placeholder (to confirm; WM-1): of a paper's time, the share that is composing it (working out what it says), not
 * writing it out and sending it: what a principal that hands over the finished act still spends (`compose/<kind>`;
 * docs/design/handing-over.md 4.2). Would be sourced by a time-use study of drafting correspondence. */
export const COMPOSE_BPS = 5_000;

/** placeholder (to confirm; WM-1): five minutes for a principal to weigh a request for more scope and answer it in
 * writing (`publish/scope_answer`), as long as the request takes to write. */
export const SCOPE_ANSWER_SECONDS = 300;

/** placeholder (to confirm; MT-32): how often a body's clerk wrongly sends back a paper in order, in basis points of the
 * papers it checks, at obstacle levels 0, 1 and 2 (docs/design/obstacles.md section 6). Leads: e-filing reject rates,
 * accounts-payable exception rates. Level 0: no check at all. */
export const WRONG_RETURN_BPS = [0, 200, 800];
