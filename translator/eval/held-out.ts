// The held-out part of the translator's test set (VISION §14), and the check that keeps it held out.
//
// It is not in the repository. The first held-out set was: its cases sat beside the seen ones, their failures were
// quoted in the docs, and by 2026-10-05 the wording of several was in the translator's prompt, so a "held-out" score
// measured nothing of the kind (docs/decisions.md). The set that replaced it is a file on the run server, written by
// someone who took no part in the prompt, and read by nobody who does:
//
//   - whoever works on the prompt, or builds training data, never opens it; they see scores, and each failure by its
//     case id, its outcome and the functions involved, never its wording;
//   - nothing from it is quoted in docs, reports, commit messages or run folders (the full results of a run on it are
//     written beside the file, not into the repository's folders);
//   - before a score is reported, the set is checked against the prompt and the seen cases for shared wording
//     (`leaks`), and training data must pass the same check against it before it is used.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Case } from "./cases";

/** Where the held-out cases are: `OIKOS_HELD_OUT`, or a folder beside the repository's, never inside it. */
export const heldOutPath = (): string => process.env.OIKOS_HELD_OUT ?? join(homedir(), "oikos-private/translator/held-out.json");

/** The held-out cases, if this machine has them (undefined if not: a score without them is a seen score only). */
export function loadHeldOut(path = heldOutPath()): Case[] | undefined {
  if (!existsSync(path)) return undefined;
  const cases = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(cases) || cases.some((c) => typeof c?.id !== "string" || typeof c?.request !== "string" || !Array.isArray(c?.expect) || !c.expect.length))
    throw new Error(`${path}: expected a list of cases, each with an id, a request and its accepted answers`);
  return cases.map((c: Case) => ({ ...c, held_out: true }));
}

/** A text's words, as compared: lower case, punctuation dropped. */
const words = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

/** Every run of `n` consecutive words in a text. */
function runs(s: string, n: number): Set<string> {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

/**
 * Held-out cases whose request shares a run of `n` consecutive words with any of the texts given (the prompt, the
 * seen cases, a document, a batch of training data): each by its id and the text's name, never by the wording.
 */
export function leaks(heldOut: Case[], texts: { name: string; text: string }[], n = 5): { id: string; source: string }[] {
  const sources = texts.map((t) => ({ name: t.name, runs: runs(t.text, n) }));
  const out: { id: string; source: string }[] = [];
  for (const c of heldOut) {
    const mine = runs(c.request, n);
    for (const s of sources) if ([...mine].some((r) => s.runs.has(r))) out.push({ id: c.id, source: s.name });
  }
  return out;
}

/** Whether a text shares a run of `n` consecutive words with any held-out case's request: for dropping such texts
 * from training data one by one. */
export function sharesWording(heldOut: Case[], n = 5): (text: string) => boolean {
  const theirs = new Set(heldOut.flatMap((c) => [...runs(c.request, n)]));
  return (text) => [...runs(text, n)].some((r) => theirs.has(r));
}
