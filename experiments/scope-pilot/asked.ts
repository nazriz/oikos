// Whether a seat's request asked for more than its matter needed (2026-11-17: one definition, here, read by the episode
// reader, the funnel, the report and the broad report alike; until then the funnel counted every scope request as one
// "for more", 7 of them in rung 3's decision-slow-situation seed 7 that asked for exactly what a block needed).
// "More" is more than the block needs AND more than the seat already holds.

export const LEVEL_RANK: { [l: string]: number } = { none: 0, advice: 1, draft: 2, approve: 3, alone: 4 };

/** The acts reader's request rows (`oikos-kernel delegation`, table requests), each with the body's notice on the client's
 * file beside it where a request for an authority has no paper of its own matter sent back: the notice asks by kind.
 * Rung 2, 2026-11-15: a second loan's authority, the bank having sent the first back, read as asked ahead of any notice. */
export function weighedRequests(rows: any[]): any[] {
  const obstacles = rows.filter((x) => x.table === "obstacles");
  return rows.filter((x) => x.table === "requests").map((q) => {
    if (q.axes || q.obstacle || typeof q.asked?.authority !== "string") return q;
    const kind = String(q.needed?.kind ?? q.asked?.kind ?? "");
    const notice = obstacles.find((o) => o.principal === q.principal && o.need?.authority?.with === q.asked.authority && (o.t ?? 0) <= (q.t ?? Infinity)
      && ([].concat(o.need.authority.kinds ?? []).some((k: string) => sameKind(k, kind)) || o.kind === kind));
    return notice ? { ...q, notice: { paper: notice.paper, matter: notice.matter, need: notice.need } } : q;
  });
}

export function askedMore(q: any): boolean {
  return askedClass(q) === "more";
}
/** How a request stands against the need: what was needed, more, or (an authority with a body asked where no notice of
 * that body's stood beside it: no paper of the matter sent back) asked ahead of any notice, neither. Run d of the stakes
 * run's rung 1, 2026-11-15: two benefit changes' authorities, asked before the office had sent anything back, read as
 * "more". */
export function askedClass(q: any): "needed" | "more" | "ahead" {
  // ("More" is more than the block needs AND more than the seat holds: a level it already holds for the kind it names,
  // asked again with the authority the block needs, asks nothing more on the level or on which matters, whatever the
  // acts reader's axes say of them against the block. DeepSeek V4.1 Flash, run c of the stakes run's rung 1 (situation),
  // day 39: c0485's authority with outside, "level draft", the level the desk held, read as "more".)
  // (The kind it asks is the matter's, or the kind whose remit governs it: a reply on a claim is under the claim's remit
  // (the acts reader's `needed.governed_by`; principal.rs `governing_kind`). Rung 4, decision-slow seed 7, c0014's
  // rec.35188: "benefit claims at draft" for evidence handed under its claims remit, held at draft, read as more.)
  const ofMatter = (k: unknown) => !q?.needed?.kind || [q.needed.kind, q.needed.governed_by].some((n) => n && sameKind(String(n), String(k)));
  const holds = (LEVEL_RANK[String(q?.level_then ?? "")] ?? -1) >= 0 && typeof q?.asked?.level === "string" && (LEVEL_RANK[q.asked.level] ?? 9) <= (LEVEL_RANK[String(q.level_then)] ?? -1)
    && (!q.asked.kind || ofMatter(q.asked.kind));
  // (A record it names that is the very paper the body sent back (the obstacle's, or the notice's) cites the return; it
  // asks no access. Rung 4, decision-slow-situation seed 9, c0788's rec.26957, the authority outside needed, naming the
  // claim outside returned, read as more where nine like it without the record read as needed.)
  const cites = typeof q?.asked?.record === "string" && [q?.obstacle?.paper, q?.notice?.paper].includes(q.asked.record);
  const axes = q?.axes && typeof q.axes === "object" ? Object.entries(q.axes).filter(([k]) => !(holds && (k === "level" || k === "matters")) && !(cites && k === "access")).map(([, v]) => v) : [];
  if (axes.length || (holds && q?.axes && Object.keys(q.axes).length)) return axes.some((v) => v === "beyond") ? "more" : "needed";
  const a0 = q?.asked ?? {}, has = (x: unknown) => x !== null && x !== undefined && x !== "";
  const a = cites ? { ...a0, record: null } : a0;
  // (A level it asks no higher than the matter was handed at is no asking for more: "at draft level" for a matter handed to
  // draft, rung 2.)
  const levelWithin = !has(a.level) || (LEVEL_RANK[String(a.level)] ?? 9) <= (LEVEL_RANK[String(q?.needed?.wants ?? "")] ?? 0);
  if (has(a.authority) && !q?.obstacle && levelWithin && ![a.access, a.limit, a.record].some(has)) {
    // (Another matter's notice from that body, for the kind: what it asks, by its terms.)
    const n = q?.notice?.need?.authority;
    if (!n) return "ahead";
    const kinds: string[] = [].concat(n.kinds ?? []);
    return n.with === a.authority && (!has(a.kind) || kinds.some((k) => sameKind(k, String(a.kind)))) ? "needed" : "more";
  }
  return wantedMore({ ...q, asked: a }) ? "more" : "needed";
}
/** A kind in words ("loan applications") and by id (`loan_application`) the same: delegation/beyond.rs, `same_kind`. */
export function sameKind(id: string, said: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[ -]/g, "_").split("_").map((w) => (w.endsWith("s") && w.length > 3 ? w.slice(0, -1) : w)).join("_");
  return norm(id) === norm(said);
}
function wantedMore(q: any): boolean {
  const a = q?.asked ?? {}, n = q?.needed ?? {};
  if (typeof a.level === "string" && (LEVEL_RANK[a.level] ?? 0) > (LEVEL_RANK[String(n.wants ?? "")] ?? 0)) return true;
  if (typeof a.kind === "string" && n.kind && ![n.kind, n.governed_by].some((k) => k && sameKind(String(k), a.kind))) return true;
  return [a.authority, a.access, a.limit].some((x) => x !== null && x !== undefined && x !== "");
}

