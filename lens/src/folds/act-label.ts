// An act of the seat in a line, from its blocks: shared by the seat fold (which writes each act's label) and the client
// (which brings the labels of a copy prepared before a change up to date, by relabel). Types only beyond this file, so
// the client can use it without the study reader.
import type { SeatJson } from "./seat";

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
      if (b.kind === "proposal" && typeof basis === "string" && basis.startsWith("form-")) return `Proposed: ${human(basis.slice(5))}`;
      if (b.kind === "direction" && typeof basis === "string" && basis.startsWith("form-")) return `Direction: ${human(basis.slice(5))} (${Object.entries(b.data ?? {}).map(([k, v]) => `${human(k)} ${typeof v === "number" && v >= DAY && v % DAY === 0 ? `${v / DAY} days` : v}`).join(", ")})`;
      const to = Array.isArray(b.addressed_to) ? b.addressed_to.join(", ") : b.addressed_to;
      return `Published ${kind || "a statement"}${to ? ` to ${to}` : ""}`;
    }
    case "appoint": return b.participant ? `Appointed ${b.participant} as ${b.position}` : `Left ${b.position} empty`;
    case "withdraw": return `Withdrew ${b.record}`;
    case "message": return `Wrote to ${[].concat(b.to ?? []).join(", ")}`;
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
  for (const d of seat.drafts) if (d.label?.includes("$")) d.label = swap(d.label);
  for (const s of seat.sittings) if (s.gist?.includes("$")) s.gist = swap(s.gist);
  return seat;
}
