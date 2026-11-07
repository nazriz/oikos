// Diagnostic: of the requests left "not_copied", how many the two readers read alike (by meaning, free text aside).
import { readFileSync } from "node:fs";
import { sameButForFreeText, sameMeaning } from "../meaning";
import { OUT, jsonl } from "./lib";
const rejects = jsonl(`${OUT}/rejects.jsonl`).filter((r: any) => r.why === "not_copied");
let same = 0, sameFree = 0;
const diff: string[] = [];
for (const r of rejects) {
  const [a, b] = Object.values(r.answers) as string[];
  if (!a || !b) continue;
  if (sameMeaning(a, b)) same++;
  if (sameButForFreeText(a, b)) sameFree++; else if (diff.length < 4) diff.push(`${a.slice(0, 160)}\n${b.slice(0, 160)}`);
}
console.log({ n: rejects.length, same, sameFree });
console.log(diff.join("\n\n"));
void readFileSync;
