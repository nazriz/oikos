// An office's own reference for a record it files (docs/design/names-and-dates.md section 3): its pattern, with `{y}` the
// year, `{n}` its own running number, `{n4}` and `{n6}` the number padded to that many digits (never cut). The number is
// the office's own counter, kept in its own books; the kernel's `rec.N` stays underneath and is not what a seat is shown.
// The twin of kernel/crates/rules/src/identity.rs, both held to contracts/test/references.json.

export function reference(pattern: string, year: number, n: number): string {
  return pattern.replaceAll("{y}", String(year)).replaceAll("{n4}", String(n).padStart(4, "0")).replaceAll("{n6}", String(n).padStart(6, "0")).replaceAll("{n}", String(n));
}
