# CEL feasibility check

*2026-09-25. Question: can a TypeScript CEL library evaluate the optional `formal` condition of Oikos statements (laws, procedures) under our rules? CEL is used only by code-run institutions, the translator and measurement, never by the kernel (design v0.2 §4.3, D19).*

**Library:** [`@bufbuild/cel`](https://github.com/bufbuild/cel-es) 0.6.1 (Buf; Apache-2.0; implements the CEL spec, standard `cel.expr` syntax tree). Pinned exactly, because it's pre-1.0.

**Result: every requirement met** (`bun install && bun test`, 6/6):

| Requirement | Result |
|---|---|
| Integers only, exact | All inputs are passed as `bigint`, which CEL treats as `int` (int64). Division truncates (`7/2 == 3`). Values beyond 2^53 stay exact. |
| Failures are errors, not wrong answers | int64 overflow, division by zero, missing fields and unknown variables all return a `CelError`, which callers treat as "can't evaluate" |
| No decimals, time or regex | A static walk of the syntax tree enforces an **allowlist**: operators, `size`/`int`/`string`, the bounded list macros (`has`, `all`, `exists`, `exists_one`, `map`, `filter`), and Oikos's own functions. Decimal and unsigned literals are rejected, as are `double()`, `timestamp()` and `matches()`. |
| Custom functions | Registered with `celFunc`, e.g. `holds_liberty(actor, 'build', parcel)` looking up claims |
| Terminates | The macros range only over finite lists and maps; there are no loops or recursion |
| Deterministic | 100,000 repeated evaluations give an identical result; map comprehensions don't depend on insertion order |
| Fast | About 1 µs per evaluation |

**Found along the way:** this parser keeps macros as calls until planning, so the allowlist must include them by name.

**Fallback if Buf's library stalls:** [`@marcbachmann/cel-js`](https://github.com/marcbachmann/cel-js) (actively maintained). Both implement the same language, so conditions written for one run on the other.
