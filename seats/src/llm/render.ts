// Rendering for language-model seats: an Observation as the reports a person
// in that role would read, and blocks as plain words. Deterministic, so the
// same observation always renders the same prompt.
//
// describeBlocks is the mechanical reading of a draft: what the blocks
// literally do, independent of the translator's own summary. A seat signing
// a draft sees both, so a translator can't slip something past it by
// describing it favourably.

import type { Block, Observation, Record, SiteParcel, Transaction } from "../contracts";

const DAY = 86_400;
const YEAR = 365 * DAY;

export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const c = Math.abs(cents);
  const dollars = Math.floor(c / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${String(c % 100).padStart(2, "0")}`;
}

export function when(t: number): string {
  return `day ${Math.floor(t / DAY)} (year ${Math.floor(t / YEAR) + 1}, day ${Math.floor((t % YEAR) / DAY) + 1})`;
}

export function duration(s: number): string {
  if (s % YEAR === 0) return `${s / YEAR} year${s === YEAR ? "" : "s"}`;
  if (s % DAY === 0) return `${s / DAY} day${s === DAY ? "" : "s"}`;
  return `${s} seconds`;
}

const json = (x: unknown, max = 600) => {
  const s = JSON.stringify(x);
  return s.length > max ? s.slice(0, max) + "…" : s;
};

const as = (b: Block) => (b.speaks_for ? ` on behalf of ${b.speaks_for}` : "");
const shown = (b: Block) => (b.visible_to === undefined ? "" : b.visible_to === "public" ? " (public)" : ` (visible to ${(b.visible_to as string[]).join(", ")})`);
const ref = (b: Block) => (b.ref ? ` [referred to below as $${b.ref}]` : "");

/** What one block does, literally. */
export function describeBlock(b: Block): string {
  switch (b.block) {
    case "transfer":
      return `Move ${money(b.amount)} from account ${b.from} to ${b.to}${b.settles ? `, settling ${b.settles}` : ""}${b.memo ? ` (memo: "${b.memo}")` : ""}.`;
    case "open_account":
      return `Open an account for ${b.holder}, kept by you${ref(b)}.`;
    case "close_account":
      return `Close account ${b.account}.`;
    case "construct":
      return `Start building a ${b.structure_type} on parcel ${b.parcel}, paying materials from ${b.materials_from}${ref(b)}.`;
    case "demolish":
      return `Demolish ${b.structure}, paying the cost from ${b.costs_from}.`;
    case "occupy":
      return `Take up ${b.count} ${b.slot} slot${b.count === 1 ? "" : "s"} in ${b.structure}.`;
    case "vacate":
      return `Remove ${b.occupant} from ${b.structure}.`;
    case "create_entity":
      return `Declare a new ${b.kind} called "${b.name}"${as(b)}${shown(b)}${ref(b)}.`;
    case "record_claim":
      return `Record that ${b.holder} holds a ${b.position}${b.counterparty ? ` against ${b.counterparty}` : ""}: ${json(b.about)}${b.basis ? `, on the basis of ${b.basis}` : ""}${as(b)}${shown(b)}${ref(b)}.`;
    case "transfer_claim":
      return `Record that claim ${b.claim} now belongs to ${b.to}${as(b)}${ref(b)}.`;
    case "release_claim":
      return `Release claim ${b.claim}${as(b)}${ref(b)}.`;
    case "propose_agreement": {
      const t = b.terms ?? {};
      const commits = (t.commitments ?? []).map((c: any) => `${c.who} commits to ${json(c.does, 300)}${c.every ? ` every ${duration(c.every)}` : ""}`).join("; ");
      return `Propose a ${t.template ?? "an"} agreement between ${(t.parties ?? []).join(" and ")}${t.term ? ` for ${duration(t.term)}` : ""}: ${commits}${t.text ? `. Text: "${t.text}"` : ""}${as(b)}${ref(b)}.`;
    }
    case "sign_agreement":
      return `Sign agreement ${b.agreement} as ${b.as}.`;
    case "give_notice":
      return `Give notice on agreement ${b.agreement} as ${b.as}${b.text ? `: "${b.text}"` : ""}.`;
    case "publish":
      return `Publish a ${b.kind}${as(b)}${b.addressed_to ? `, addressed to ${b.addressed_to.join(", ")}` : ""}${shown(b)}: "${b.text}"${b.data ? ` with data ${json(b.data)}` : ""}${b.adico ? `, meaning ${json(b.adico, 400)}` : ""}${b.formal ? `, formally: ${b.formal.condition}` : ""}${b.basis ? `, citing ${b.basis}` : ""}${ref(b)}.`;
    case "withdraw":
      return `Withdraw ${b.record}${b.text ? `: "${b.text}"` : ""}${as(b)}.`;
    case "vote":
      return `Vote "${b.choice}" on ballot ${b.ballot}${as(b)}${shown(b)}.`;
    case "message":
      return `Send a message to ${b.to.join(", ")}: "${b.text}".`;
    default:
      return `An unrecognised block: ${json(b)}.`;
  }
}

export function describeBlocks(blocks: Block[]): string {
  return blocks.map((b, i) => `${i + 1}. ${describeBlock(b)}`).join("\n");
}

function describeRecord(r: Record): string {
  const by = `${r.author === "genesis" ? "from the start" : `by ${r.author}`}${r.speaks_for ? ` for ${r.speaks_for}` : ""}, ${when(r.at)}`;
  switch (r.record) {
    case "statement":
      return `[${r.id}] ${r.kind} ${by}${r.addressed_to ? `, to ${r.addressed_to.join(", ")}` : ""}: "${r.text}"${r.data ? ` ${json(r.data, 400)}` : ""}${r.basis ? ` (basis: ${r.basis})` : ""}`;
    case "claim":
      return `[${r.id}] claim ${by}: ${r.holder} holds a ${r.position}${r.counterparty ? ` against ${r.counterparty}` : ""}: ${json(r.about, 300)}`;
    case "agreement":
      return `[${r.id}] ${r.terms.template ?? ""} agreement ${by} between ${r.terms.parties.join(", ")}: ${json(r.terms.commitments, 400)}`;
    case "signature":
      return `[${r.id}] ${r.as} signed ${r.agreement} (${when(r.at)})`;
    case "notice":
      return `[${r.id}] ${r.as} gave notice on ${r.agreement} (${when(r.at)})${r.text ? `: "${r.text}"` : ""}`;
    case "withdrawal":
      return `[${r.id}] ${r.withdraws} withdrawn ${by}${r.text ? `: "${r.text}"` : ""}`;
    case "vote":
      return `[${r.id}] vote "${r.choice}" on ${r.ballot} ${by}`;
    case "claim_transfer":
      return `[${r.id}] claim ${r.claim} transferred to ${r.to} ${by}`;
    case "claim_release":
      return `[${r.id}] claim ${r.claim} released ${by}`;
    case "entity_declaration":
      return `[${r.id}] ${r.kind} "${r.name}" (${r.entity}) declared ${by}`;
  }
}

/**
 * Records as report lines. Runs of similar claims are totalled (a registry
 * extract, not 200 titles) and votes are tallied per ballot, as a person would
 * be told them; everything else is listed one by one, in order.
 */
function recordLines(records: Record[]): string[] {
  const groups = new Map<string, Extract<Record, { record: "claim" }>[]>();
  const tallies = new Map<string, Extract<Record, { record: "vote" }>[]>();
  const order: (Record | string)[] = [];
  for (const r of records) {
    if (r.record === "claim") {
      const key = `claim|${r.holder}|${r.position}|${r.counterparty ?? ""}|${r.about?.kind ?? ""}`;
      if (!groups.has(key)) order.push(key);
      groups.set(key, [...(groups.get(key) ?? []), r]);
    } else if (r.record === "vote") {
      const key = `vote|${r.ballot}`;
      if (!tallies.has(key)) order.push(key);
      tallies.set(key, [...(tallies.get(key) ?? []), r]);
    } else order.push(r);
  }
  return order.map((x) => {
    if (typeof x !== "string") return describeRecord(x);
    const g = groups.get(x);
    if (g) {
      if (g.length < 4) return g.map(describeRecord).join("\n- ");
      const c = g[0]!;
      const objects = g.map((r) => r.about?.object ?? r.id);
      const total = g.reduce((a, r) => a + (Number.isInteger(r.about?.amount) ? r.about.amount : 0), 0);
      return `${g.length} ${c.about?.kind ?? ""} claims: ${c.holder} holds a ${c.position}${c.counterparty ? ` against ${c.counterparty}` : ""}${total ? `, totalling ${money(total)}` : ""}, from ${when(g[0]!.at)} to ${when(g.at(-1)!.at)}: ${objects.slice(0, 12).join(", ")}${objects.length > 12 ? `, and ${objects.length - 12} more` : ""}`;
    }
    const v = tallies.get(x)!;
    const counts = new Map<string, number>();
    for (const r of v) counts.set(r.choice, (counts.get(r.choice) ?? 0) + 1);
    return `${v.length} vote${v.length === 1 ? "" : "s"} on ${v[0]!.ballot}: ${[...counts].sort().map(([c, n]) => `${c} ${n}`).join(", ")}`;
  });
}

/** A town survey from a sites channel: counts, not raw parcels. */
function describeSites(parcels: SiteParcel[], asOf: number, capacity: (type: string) => { [slot: string]: number }): string {
  const byType = new Map<string, { done: number; building: number }>();
  const slots = new Map<string, { used: number; total: number }>();
  let empty = 0;
  for (const p of parcels) {
    const s = p.structure;
    if (!s) {
      empty++;
      continue;
    }
    const c = byType.get(s.type) ?? { done: 0, building: 0 };
    s.complete ? c.done++ : c.building++;
    byType.set(s.type, c);
    if (!s.complete) continue;
    for (const [slot, n] of Object.entries(capacity(s.type))) {
      const u = slots.get(slot) ?? { used: 0, total: 0 };
      u.total += n;
      u.used += s.occupancy.filter((o) => o.slot === slot).reduce((a, o) => a + o.count, 0);
      slots.set(slot, u);
    }
  }
  const types = [...byType].sort().map(([t, c]) => `${t}: ${c.done}${c.building ? ` (+${c.building} under construction)` : ""}`).join("; ");
  const use = [...slots].sort().map(([s, u]) => `${s}: ${u.used} of ${u.total} taken`).join("; ");
  return `Survey as of ${when(asOf)}: ${parcels.length} parcels, ${empty} empty. Buildings: ${types || "none"}. Space: ${use || "none"}.`;
}

function describeTransactions(txs: Transaction[], mine: Set<string>): string[] {
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const x of txs) {
    if (mine.has(x.to) && !mine.has(x.from)) inflow.set(x.from, (inflow.get(x.from) ?? 0) + x.amount);
    if (mine.has(x.from) && !mine.has(x.to)) outflow.set(x.to, (outflow.get(x.to) ?? 0) + x.amount);
  }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const line = (label: string, m: Map<string, number>) => {
    if (m.size === 0) return [];
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const t = top(m);
    return [`${label} ${money(total)} across ${m.size} account${m.size === 1 ? "" : "s"}: ${t.slice(0, 8).map(([a, v]) => `${a} ${money(v)}`).join(", ")}${t.length > 8 ? `, and ${t.length - 8} more` : ""}.`];
  };
  return [...line("Received", inflow), ...line("Paid out", outflow)];
}

export interface RenderOptions {
  /** Records shown per channel before the rest are summarised by kind. */
  maxRecords?: number;
  /** Capacity of a catalogue structure type, for the survey. */
  capacity?: (type: string) => { [slot: string]: number };
  /** Channel ids whose records are standing documents (rendered separately, in full). */
  standing?: Set<string>;
}

/** The part of an observation that changes: what's new since the seat last looked. */
export function renderObservation(obs: Observation, o: RenderOptions = {}): string {
  const max = o.maxRecords ?? 40;
  const out: string[] = [`It is ${when(obs.t)}. You act for ${obs.entity}.`];
  for (const x of obs.outcomes) {
    out.push(x.status === "applied" ? `Your action ${x.action} was carried out.${x.created ? ` It created: ${json(x.created)}.` : ""}` : `Your action ${x.action} was refused: ${x.refusal?.code}${x.refusal?.detail ? ` (${x.refusal.detail})` : ""}.`);
  }
  if (obs.inbox.length) {
    out.push("", "## Messages");
    for (const m of obs.inbox) out.push(`- From ${m.from}, ${when(m.t)}${m.re ? ` (re ${m.re})` : ""}: "${m.text}"`);
  }
  for (const [id, ch] of Object.entries(obs.channels)) {
    if (o.standing?.has(id)) continue;
    if (ch.kind === "accounts") {
      out.push("", `## Accounts (${id})`);
      for (const a of ch.accounts) out.push(`- ${a.account}, held by ${a.holder}, kept by ${a.custodian}: ${money(a.balance)}`);
      out.push(...describeTransactions(ch.transactions, new Set(ch.accounts.map((a) => a.account))).map((l) => `  ${l}`));
    } else if (ch.kind === "records") {
      if (ch.records.length === 0) continue;
      out.push("", `## ${id}: ${ch.records.length} new record${ch.records.length === 1 ? "" : "s"}`);
      const lines = recordLines(ch.records);
      if (lines.length > max) out.push(`(${lines.length - max} earlier item${lines.length - max === 1 ? "" : "s"} not listed.)`);
      for (const l of lines.slice(-max)) out.push(`- ${l}`);
    } else if (ch.kind === "sites") {
      out.push("", `## ${id}`, describeSites(ch.parcels, ch.as_of, o.capacity ?? (() => ({}))));
    } else if (ch.kind === "directory") {
      out.push("", `## Directory (${id}): ${ch.entities.length} entities, ${ch.seats.length} seats`);
      const roles = ch.seats.filter((s) => s.role).map((s) => `${s.seat} (${s.role}, for ${s.entity})`);
      if (roles.length) out.push(`Office holders: ${roles.slice(0, 60).join(", ")}${roles.length > 60 ? ", …" : ""}`);
    }
  }
  if (obs.drafts.length) {
    out.push("", "## Drafts awaiting your sign-off");
    for (const d of obs.drafts) out.push(renderDraft(d));
  }
  return out.join("\n");
}

/** Standing documents (laws, charters, procedures) from the given channels, in full. */
export function renderStanding(obs: Observation, standing: Set<string>): string {
  const out: string[] = [];
  for (const [id, ch] of Object.entries(obs.channels)) {
    if (!standing.has(id) || ch.kind !== "records") continue;
    for (const r of ch.records) if (r.record === "statement") out.push(`- [${r.id}] ${r.kind}${r.speaks_for ? ` of ${r.speaks_for}` : ""}: "${r.text}"${r.data ? ` ${json(r.data, 400)}` : ""}${r.formal ? ` Formally: ${r.formal.condition}` : ""}`);
  }
  return out.join("\n");
}

export function renderDraft(d: any): string {
  return [
    `### Draft ${d.id}`,
    `Your proposal: "${d.proposal}"`,
    `The translator's summary: ${d.summary}`,
    `What the blocks literally do:`,
    describeBlocks(d.blocks),
    d.check.ok ? "Physics check: possible right now." : `Physics check: NOT possible right now: ${d.check.refusal?.code}${d.check.refusal?.detail ? ` (${d.check.refusal.detail})` : ""}.`,
    ...(d.check.warnings?.length ? [`Warnings: ${d.check.warnings.join(" ")}`] : []),
    ...(d.caveats ? [`Caveats (not expressed): ${d.caveats}`] : []),
  ].join("\n");
}
