// The generator's figure registry (law 11: docs/design/foundations-2.md 5.1, step N4). A number the generator computes
// with is a convention (a unit, a count of days in a week, basis points), read from the profile or the spec, or a figure
// declared here once, its class first in its comment (`sourced`, `to_confirm`, `derived`, `fitted`, `placeholder` or
// `convention`) and then its source or why. orchestrator/test/every-number-has-a-basis.test.ts refuses a figure here with
// no class, and counts the literals still written in the generator (its inventory only shrinks).
//
// Empty at its start (2026-11-08): the generator's literals are still where they are written, counted by file. (Where
// a generated config's numbers come from is worlds/generator/figures.ts, a separate table.)

export {};
