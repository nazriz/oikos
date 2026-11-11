// The taught language (2026-11-10, "one right call": docs/decisions.md): a program as a translator writes it now, and
// what a model is trained on (`calls.TAUGHT`). The host sets the rest by rule (translator/src/rules.ts): the records
// cited (`basis`), on whose behalf (`for`); a payment's purpose is `memo`; refusals the seat is told in one sentence are
// one label. A statement's `data`, which no translator writes now, makes no example. The export reads every example
// through this (encode.ts), so data written in the earlier language trains the language served.
import { calls } from "@oikos/participants";
import { LABEL_TEXT } from "../src/resolver";
import { ruled } from "../src/rules";

/** The label a refusal is written as: of the labels told in the same words, `no_such_act` where it is one of them,
 * else the first. */
export function oneLabel(label: string): string {
  const said = LABEL_TEXT[label as calls.Label];
  if (said === undefined) return label;
  const alike = Object.keys(LABEL_TEXT).filter((l) => LABEL_TEXT[l as calls.Label] === said);
  return alike.includes("no_such_act") ? "no_such_act" : alike[0]!;
}

/** A program in the taught language; `undefined` where it composes a statement's `data` (no example now). */
export function taught(program: string): string | undefined {
  const p = calls.parseProgram(program);
  if ("none" in p) return `none(${oneLabel(p.none)})`;
  if (p.lines.some((l) => l.call.fn === "statement" && "data" in l.call.args)) return undefined;
  const r = ruled(p, "", () => false, { keepData: true });
  return r.ok ? calls.programText(r.program) : undefined;
}

/** An example's spans for its taught program: a basis's dropped, a payment's `for` as `memo`, any other `for` dropped.
 * A span's `arg` is the argument's path (`we_do.for` in a nested call), on its `line` where the program has several. */
export function taughtSpans<S extends { arg: string; line?: number }>(spans: S[], program: string): S[] {
  const p = calls.parseProgram(program);
  if ("none" in p) return spans;
  const fnAt = (line: number, path: string[]): string | undefined => {
    let c: calls.Call | undefined = p.lines[line]?.call;
    for (const k of path) {
      const v = c?.args[k];
      c = v && "call" in v ? v.call : undefined;
    }
    return c?.fn;
  };
  const out: S[] = [];
  for (const s of spans) {
    const path = s.arg.split(".");
    const last = path.pop()!;
    if (last === "basis") continue;
    if (last === "for") {
      if (fnAt(s.line ?? 0, path) === "money") out.push({ ...s, arg: [...path, "memo"].join(".") });
      continue;
    }
    out.push(s);
  }
  return out;
}
