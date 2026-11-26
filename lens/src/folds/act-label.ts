// An act of the seat in a line, from its blocks: shared by the seat fold (which writes each act's label) and the client
// (which brings the labels of a copy prepared before a change up to date, by relabel). Types only beyond this file, so
// the client can use it without the study reader.
import type { SeatAct, SeatJson } from "./seat";

const DAY = 86_400;
const human = (s: string) => s.replace(/[_-]+/g, " ");

/** An agreement offered in a block, in words: "a job offer" (the employment template), "an offer of a lease agreement". */
function offerWords(b: any): string {
  const tpl = typeof b?.terms?.template === "string" ? b.terms.template : "";
  return tpl === "employment" ? "a job offer" : tpl ? `an offer of a ${human(tpl)} agreement` : "an agreement";
}
/** Who an offer is made to: the parties other than the one it speaks for. */
const offerTo = (b: any) => (Array.isArray(b?.terms?.parties) ? b.terms.parties.filter((p: unknown) => p !== b.speaks_for).join(", ") : "");

/** An act's blocks in a line ("Offered a job to c0501; Signed the job offer"). A block may name an earlier one of the same
 * act by its `ref` ("$offer1"): said as what that block made, never as the placeholder. */
export function actLabel(blocks: any[]): string {
  return blocks.map((b) => blockLabel(b, blocks)).join("; ");
}

/** One block of an act, in a line; `act` its act's blocks, to fill a "$ref" to one of them. */
export function blockLabel(b: any, act: any[] = []): string {
  const kind = typeof b?.kind === "string" ? human(b.kind) : "";
  switch (b?.block) {
    case "publish": {
      const basis = Array.isArray(b.basis) ? b.basis[0] : b.basis;
      if (b.kind === "nomination") return "Filed a nomination" + (b.data?.office ? ` for ${b.data.office}` : "");
      if (b.kind === "proposal" && typeof basis === "string" && basis.startsWith("form-")) {
        // (What the council is asked for: "Proposed a law", "Proposed a budget", "Proposed changing the rules on tenancy".)
        if (b.data?.kind === "law") return "Proposed a law";
        if (b.data?.kind === "budget") return "Proposed a budget";
        const f = basis.slice(5);
        return f.startsWith("amend-") ? `Proposed changing the rules on ${human(f.slice(6))}` : `Proposed: ${human(f)}`;
      }
      if (b.kind === "direction" && typeof basis === "string" && basis.startsWith("form-")) return `Direction: ${human(basis.slice(5))} (${Object.entries(b.data ?? {}).map(([k, v]) => `${human(k)} ${typeof v === "number" && v >= DAY && v % DAY === 0 ? `${v / DAY} days` : v}`).join(", ")})`;
      const to = Array.isArray(b.addressed_to) ? b.addressed_to.join(", ") : b.addressed_to;
      return `Published ${kind || "a statement"}${to ? ` to ${to}` : ""}`;
    }
    case "appoint": return b.participant ? `Appointed ${b.participant} as ${b.position}` : `Left ${b.position} empty`;
    case "withdraw": return `Withdrew ${b.record}`;
    case "message": return `Wrote to ${toWords([].concat(b.to ?? []))}`;
    case "propose_agreement": {
      const to = offerTo(b), w = offerWords(b);
      return `Offered ${w === "a job offer" ? "a job" : w.replace(/^an offer of /, "")}${to ? ` to ${to}` : ""}`;
    }
    case "sign_agreement": {
      const ag = typeof b.agreement === "string" ? b.agreement : "";
      if (ag.startsWith("$")) {
        const made = act.find((x) => x?.ref === ag.slice(1));
        return `Signed ${made?.block === "propose_agreement" ? offerWords(made).replace(/^an? /, "the ") : "the agreement it drew up"}`;
      }
      return ag ? `Signed agreement ${ag}` : "Signed an agreement";
    }
    case "transfer": return `Paid ${b.to ?? ""}`.trim();
    case "vote": return "Voted";
    default: return human(String(b?.block ?? "act")) + (kind ? ` ${kind}` : "");
  }
}

const PERSON = /^c\d+(?:-self)?$/;
/** Who a letter went to, in a line: named when a few, counted when many ("Wrote to works and 195 residents"); the
 * names are a hover away (lettersTo). */
export function toWords(to: string[]): string {
  const people = to.filter((x) => PERSON.test(x)), councillors = to.filter((x) => /^councillor-\d+$/.test(x));
  const others = to.filter((x) => !PERSON.test(x) && !(councillors.length > 1 && councillors.includes(x)));
  if (people.length <= 1 && councillors.length <= 1) return to.join(", ");
  const parts = [...others, ...(councillors.length > 1 ? [`${councillors.length} councillors`] : []), ...(people.length > 1 ? [`${people.length} residents`] : people)];
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
/** Everyone a turn's letters went to, in order, once each (the hover list behind "Wrote to 195 residents"). */
export function lettersTo(acts: SeatAct[]): string[] {
  return [...new Set(acts.flatMap((a) => a.blocks.filter((b) => b?.block === "message").flatMap((b) => [].concat(b.to ?? []) as string[])))];
}
/** A turn's acts in a line, as the seat fold says them (its gist), with all its letters told as one: "Proposed: council
 * proposal; Wrote to works and 195 residents". */
export function actsGist(acts: SeatAct[]): string {
  const letter = (a: SeatAct) => a.blocks.length > 0 && a.blocks.every((b) => b?.block === "message");
  const weight = (a: SeatAct) => (a.levers.length ? 0 : 1);
  const labels = [...new Set(acts.filter((a) => !letter(a)).sort((a, b) => weight(a) - weight(b) || a.i - b.i).map((a) => a.label))];
  if (acts.some(letter)) labels.push(`Wrote to ${toWords(lettersTo(acts.filter(letter)))}`);
  return labels.length > 3 ? `${labels.slice(0, 3).join("; ")} and ${labels.length - 3} more` : labels.join("; ");
}

/** A copy prepared before actLabel filled "$ref"s, brought up to it where it is read (the client), so no prepared copy
 * needs making again: each act's label from its blocks, and the drafts and turn lines that carried the old one. */
export function relabel(seat: SeatJson): SeatJson {
  const swaps = new Map<string, string>();
  for (const a of seat.acts) {
    if (!Array.isArray(a.blocks) || !a.blocks.length || a.blocks.some((b) => b?.trimmed)) continue;
    const label = actLabel(a.blocks);
    if (label && label !== a.label) { swaps.set(a.label, label); a.label = label; }
  }
  const swap = (s: string) => { for (const [from, to] of swaps) s = s.split(from).join(to); return s.replace(/\$[a-z]\w*/gi, "it"); };
  // (A draft that was sent says what its act says; one never sent keeps its own line.)
  const sent = new Map(seat.acts.filter((a) => a.draft).map((a) => [a.draft!, a.label]));
  for (const d of seat.drafts) {
    if (sent.has(d.id)) d.label = sent.get(d.id)!;
    else if (d.label?.includes("$")) d.label = swap(d.label);
  }
  for (const s of seat.sittings) {
    const own = s.acts.map((i) => seat.acts[i]!).filter(Boolean);
    if (own.length) s.gist = actsGist(own);
    else if (s.gist?.includes("$")) s.gist = swap(s.gist);
  }
  return seat;
}
