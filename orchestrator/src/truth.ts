// Truth audits (docs/design/rebuild.md 8.2): what a code module believes about the world when a wake is done, checked
// against the terms' readings of the agreements it's about. Test and calibration runs only; a divergence is recorded
// (the log's `audit` annotation), never acted on. It catches stale private copies of the world: a register that
// missed a change, an end worked out by hand.

import type { Belief } from "@oikos/participants";
import type { Kernel } from "./kernel";

export interface Divergence { belief: Belief; expected: unknown; found: unknown }

interface Read { id: string; template?: string; parties: string[]; reading: { status: string } }
const inForce = (a?: Read) => a?.reading.status === "in_force" || a?.reading.status === "ending";

export async function divergences(k: Kernel, beliefs: Belief[]): Promise<Divergence[]> {
  if (!beliefs.length) return [];
  const ids = beliefs.flatMap((b) => (b.of === "agreement" ? [b.agreement] : []));
  const parties = [...new Set(beliefs.flatMap((b) => (b.of === "between" ? [b.parties[0]] : b.of === "held" ? [b.party] : [])))];
  const byId = new Map<string, Read>();
  if (ids.length) for (const a of (await k.request({ op: "agreements", ids })).agreements as Read[]) byId.set(a.id, a);
  const byParty = new Map<string, Read[]>();
  for (const p of parties) byParty.set(p, (await k.request({ op: "agreements", party: p })).agreements);
  const out: Divergence[] = [];
  for (const b of beliefs) {
    if (b.of === "agreement") {
      const found = inForce(byId.get(b.agreement));
      if (found !== b.in_force) out.push({ belief: b, expected: b.in_force, found });
    } else if (b.of === "between") {
      const found = (byParty.get(b.parties[0]) ?? []).some((a) => a.template === b.template && a.parties.includes(b.parties[1]) && inForce(a));
      if (found !== b.in_force) out.push({ belief: b, expected: b.in_force, found });
    } else {
      const found = (byParty.get(b.party) ?? []).filter((a) => a.template === b.template && inForce(a)).map((a) => a.id).sort();
      const expected = [...b.agreements].sort();
      if (found.join() !== expected.join()) out.push({ belief: b, expected, found });
    }
  }
  return out;
}
