// The causal trace (docs/design/renderer.md 5): from a change that reached someone, back through the act that made it,
// who decided it and why, to the records it rested on, and theirs, as far as the log goes. Each link is a sentence in the
// world's terms with its time, who decided, their class, and the line it comes from. Nothing is inferred that the log
// does not say: an effect with no act is the world's; a payment made by a standing instruction leads to the instruction.

import { DAY } from "./indexer";
import type { Store } from "./store";
import { personOfParticipant, type DeciderClass } from "./world";

export interface Link {
  ord?: number; t?: number; depth: number; role: "change" | "act" | "instruction" | "basis" | "genesis" | "world" | "stop";
  text: string; who?: string; as?: string; cls?: DeciderClass; model?: string; by?: string[]; why?: { kind: "seat" | "decision" | "reason" | "none"; text: string; seq?: number; ord?: number }; status?: string; record?: string;
}

const money = (s: Store, minor: unknown) => {
  const c = s.world.currency, txt = String(minor);
  if (!/^-?\d+$/.test(txt)) return txt;
  const places = c.minor_units ?? 2, neg = txt.startsWith("-"), d = txt.replace("-", "").padStart(places + 1, "0");
  return `${neg ? "-" : ""}${c.symbol ?? ""}${d.slice(0, d.length - places).replace(/\B(?=(\d{3})+(?!\d))/g, c.group_mark ?? ",")}${places ? (c.decimal_mark ?? ".") + d.slice(-places) : ""}`;
};
const clip = (s: unknown, n: number) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n) + "…" : t; };
const list = (x: unknown) => ([] as unknown[]).concat(x ?? []).map(String);

/** One kept line as a sentence in the world's terms. */
export function describe(s: Store, e: any): string {
  const b = e.body ?? {};
  if (e.kind === "command" && b.command === "act") {
    const parts = (b.blocks ?? []).map((x: any) => {
      if (x.block === "publish") return `${x.kind ?? "statement"}${x.addressed_to ? ` to ${list(x.addressed_to).join(", ")}` : ""}${x.text ? `: “${clip(x.text, 220)}”` : ""}`;
      if (x.block === "transfer") return `pay ${money(s, x.amount)} from ${x.from} to ${x.to}${x.memo ? ` (${clip(x.memo, 80)})` : ""}`;
      if (x.block === "message") return `letter to ${list(x.to).join(", ")}: “${clip(x.text, 200)}”`;
      if (x.block === "occupy" || x.block === "vacate") return `${x.block} ${x.space ?? ""}`;
      return `${x.block}${x.kind ? ` ${x.kind}` : ""}${x.text ? `: “${clip(x.text, 200)}”` : ""}`;
    });
    return `${b.participant}${b.as ? ` as ${b.as}` : ""}: ${parts.join("; ") || "acted"}`;
  }
  if (e.kind === "command" && b.command === "entity_record") return `${b.participant} changed their own record (${Object.keys(b.set ?? {}).join(", ")})`;
  if (e.kind === "annotation") {
    if (b.annotation === "decision") { const d = b.data ?? {}; return `${b.subject} weighed ${d.domain ?? "a choice"}: chose ${d.choice ?? "?"} of ${(d.options ?? []).length} options`; }
    return `${b.annotation}${b.subject ? ` (${b.subject})` : ""}`;
  }
  switch (b.event) {
    case "transfer": return `${money(s, b.amount)} from ${b.from} to ${b.to}${b.memo ? ` (${clip(b.memo, 100)})` : ""}${b.per_instruction ? `, by standing instruction ${b.per_instruction}` : ""}`;
    case "recorded": { const r = b.record ?? {}; return `${r.kind ?? r.record ?? "record"} ${r.id ?? ""} by ${r.speaks_for ?? r.author ?? "?"}${r.addressed_to ? ` to ${list(r.addressed_to).join(", ")}` : ""}${r.text ? `: “${clip(r.text, 260)}”` : ""}`; }
    case "message_delivered": return `letter ${b.message} from ${b.participant} delivered to ${list(b.to).join(", ")}`;
    case "vacated": return `${b.occupant} left ${b.space} (${b.reason ?? "moved"}${b.by ? `, by ${b.by}` : ""})`;
    case "action_refused": return `refused (${b.code}): ${clip(b.detail, 200)}`;
    case "condition_began": return `${b.person} fell ${b.kind === "injury" ? "injured" : "ill"} (${b.severity ?? ""})`;
    case "condition_treated": return `${b.person} treated by ${b.by ?? "?"}`;
    case "condition_ended": return `${b.person} recovered`;
    case "person_died": return `${b.person} died (${b.died_of ?? "?"})`;
    case "person_left": return `${b.person} left the town for ${b.to ?? "elsewhere"}`;
    case "person_arrived": return `${b.person} arrived`;
    case "worked": return `work at ${b.at}: ${b.task} (${b.units ?? 0} units)`;
    case "goods_moved": return `${b.quantity} ${b.kind} moved from ${b.from} to ${b.to}`;
    case "appointed": return `appointed to ${b.position}`;
    case "body_changed": return `${b.person}'s ${b.variable} is now ${b.value}`;
    default: return `${b.event ?? e.kind}`;
  }
}

/** Who decided an act and the why the log gives for it. */
function actLink(s: Store, actOrd: number, depth: number, about?: string, action?: number): Link {
  const e = s.line(actOrd), b = e.body;
  const p = s.participantInfo(b.participant);
  const cls = s.clsOf(b.participant, about);
  let why: Link["why"];
  if (cls === "seat") why = { kind: "seat", text: b.provenance?.via === "translator" ? `asked in its own words; the translator drafted ${b.provenance?.draft ?? "a draft"}, which the seat confirmed` : `the seat's own call`, seq: e.seq };
  else {
    // A code citizen's choice: the decision it recorded just before acting, where the run recorded decisions.
    const posts = s.postings(b.participant);
    let dec: number | undefined;
    for (let i = posts.length - 1; i >= 0; i--) { const o = posts[i]!; if (o >= actOrd) continue; if (s.t(o) < e.t - 3600) break; if (s.nameOf(o) === "annotation:decision") { dec = o; break; } }
    if (dec !== undefined) { const d = s.line(dec).body.data ?? {}; why = { kind: "decision", ord: dec, text: `weighed ${d.domain ?? "a choice"}: ${(d.options ?? []).slice(0, 5).map((x: any) => `${x.key} ${x.score}`).join(", ")}; chose ${d.choice}${d.strategy ? ` (${d.strategy})` : ""}` }; }
    else if (b.reasoning) why = { kind: "reason", text: String(b.reasoning) };
    else {
      const reason = (b.blocks ?? []).map((x: any) => x.data?.reason).find(Boolean);
      why = reason ? { kind: "reason", text: String(reason) } : { kind: "none", text: `${p?.impl ?? "its code"}: reasoning not logged in this run` };
    }
  }
  const by = action !== undefined ? s.performers(action) : undefined;
  return { ord: actOrd, t: e.t, depth, role: "act", text: describe(s, e), who: b.participant, as: b.as, cls, model: p?.model, by, why, status: action !== undefined ? s.action(action).status : undefined };
}

/** The basis records an act or a record cites. */
function basesOf(e: any): string[] {
  const b = e.body ?? {};
  const out = new Set<string>();
  if (b.record) for (const x of list(b.record.basis)) out.add(x);
  for (const bl of b.blocks ?? []) { for (const x of list(bl.basis)) out.add(x); if (bl.per_instruction) out.add(String(bl.per_instruction)); }
  if (b.per_instruction) out.add(String(b.per_instruction));
  if (b.settles) out.add(String(b.settles));
  return [...out];
}

/** The trace of one kept line: newest first, down to depth `max`. `about`: the person it is traced for (their own acts are
 * marked "self"). */
export function trace(s: Store, ord: number, about?: string, max = 8): Link[] {
  const out: Link[] = [];
  const seen = new Set<number>();
  const walk = (o: number, depth: number, role: Link["role"]) => {
    if (seen.has(o) || out.length > 60) return;
    seen.add(o);
    const e = s.line(o);
    const isAct = e.kind === "command" && e.body.command === "act";
    if (isAct) out.push(actLink(s, o, depth, about));
    else {
      out.push({ ord: o, t: e.t, depth, role, text: describe(s, e), record: e.body?.record?.id });
      const a = s.actionOf(o);
      if (a >= 0) { const act = s.action(a); if (act.actOrd >= 0 && !seen.has(act.actOrd)) { seen.add(act.actOrd); out.push(actLink(s, act.actOrd, depth, about, a)); walkBases(s.line(act.actOrd), depth + 1); } }
      else if (!basesOf(e).length && e.kind === "event") out.push({ depth, role: "world", text: "no act of anyone's: the world (a scheduled payment, a life event, nature, a rule taking its course)", cls: "world" });
    }
    walkBases(e, depth + 1);
  };
  const walkBases = (e: any, depth: number) => {
    if (depth > max) { if (basesOf(e).length) out.push({ depth, role: "stop", text: `… and further back (depth ${max})` }); return; }
    for (const id of basesOf(e)) {
      const r = s.record(id);
      if (!r) { out.push({ depth, role: "stop", text: `${id}: not a record of this run` }); continue; }
      if (r.ord === undefined) { out.push({ depth, role: "genesis", text: `${r.record.kind ?? r.record.record} ${id} by ${r.record.speaks_for ?? r.record.author}, made before the run${r.record.text ? `: “${clip(r.record.text, 200)}”` : ""}`, record: id, cls: "world" }); continue; }
      const instructions = [e.body?.per_instruction, ...(e.body?.blocks ?? []).map((b: any) => b.per_instruction)].filter(Boolean).map(String);
      walk(r.ord, depth, instructions.includes(id) ? "instruction" : "basis");
    }
  };
  walk(ord, 0, "change");
  return out;
}

/** What a kept line is, for a list: its time, sentence, who decided it for `about`, hard or not. */
export function eventRow(s: Store, ord: number, about?: string) {
  const e = s.line(ord);
  const who = e.kind === "command" ? e.body.participant : s.whoOf(ord);
  const cls: DeciderClass = who ? s.clsOf(who, about) : "world";
  return { ord, t: e.t, day: Math.floor(e.t / DAY), name: s.nameOf(ord), text: describe(s, e), who, cls, own: !!who && !!about && personOfParticipant(who) === about };
}
