// How many of a set's examples read in two passes (`cards`: encode.ts, "Read twice"), and why the rest do not:
//   bun translator/model/cards-check.ts <examples.jsonl> [most]
// An example cut here is cut from a `cards` export (export.ts `cardRows`); the plan's stop rule is 5% of rows
// (docs/design/translator-v3.md, section 9). Slot by slot's own cuts are counted apart: they are not this decoding's.
import { readFileSync } from "node:fs";
import { calls } from "@oikos/participants";
import { decodeSlots, encode, joinCards, NotEncodable, ORDER, splitCards } from "./encode";
import { cardRows } from "./export";

if (import.meta.main) {
  const [file, most] = process.argv.slice(2);
  if (!file) throw new Error("usage: bun translator/model/cards-check.ts <examples.jsonl> [most]");
  const max = Number(most ?? Infinity);
  const why = new Map<string, number>();
  const count = (k: string) => why.set(k, (why.get(k) ?? 0) + 1);
  let n = 0, ok = 0, slotsOk = 0, withForm = 0, fills = 0;
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim() || n >= max) continue;
    n++;
    const e = JSON.parse(l);
    if (e.program.includes("form(")) withForm++;
    let slotsFine = true;
    try { encode(e, ORDER, "slots"); } catch { slotsFine = false; }
    if (slotsFine) slotsOk++;
    try {
      const enc = encode(e, ORDER, "cards");
      if (decodeSlots(enc.input, enc.steps) !== calls.programText(calls.parseProgram(e.program))) { count("decodes to another program"); continue; }
      const sp = splitCards(e.request, e.forms, enc.steps);
      if (JSON.stringify(joinCards(e.request, e.forms, sp.choose.steps, sp.fills.map((f) => f.steps))) !== JSON.stringify(enc.steps)) { count("joined, not the same decisions"); continue; }
      if (!cardRows(e)) { count("a span cuts a piece"); continue; }
      ok++;
      fills += sp.fills.length;
    } catch (x) {
      if (!(x instanceof NotEncodable)) throw x;
      count(`${slotsFine ? "cards only: " : "slot by slot too: "}${x.message.replace(/ [^ ]*=.*$/, "").slice(0, 70)}`);
    }
  }
  console.log(JSON.stringify({ examples: n, read_in_two_passes: ok, slot_by_slot_reads: slotsOk, with_a_form: withForm, fill_rows: fills, not: Object.fromEntries([...why].sort((a, b) => b[1] - a[1])) }, null, 1));
}
