// What a language seat reads (principle 14: the platform is invisible to the
// seats). An Observation becomes the reports a person in that role would
// read, in the world's own terms: accounts, letters, filings, titles,
// agreements, a survey of the town. No blocks, records, channels or refusal
// codes. Deterministic: the same observation always reads the same.

import type { Observation, Record, SiteParcel, Transaction } from "../contracts";
import { refusalText } from "./words";

const DAY = 86_400;
const YEAR = 365 * DAY;

export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const c = Math.abs(cents);
  const dollars = Math.floor(c / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${String(c % 100).padStart(2, "0")}`;
}

export function when(t: number): string {
  return `year ${Math.floor(t / YEAR) + 1}, day ${Math.floor((t % YEAR) / DAY) + 1}`;
}

export function duration(s: number): string {
  if (s % YEAR === 0) return `${s / YEAR} year${s === YEAR ? "" : "s"}`;
  if (s % DAY === 0) return `${s / DAY} day${s === DAY ? "" : "s"}`;
  return `${s} seconds`;
}

const clip = (s: string, max = 400) => (s.length > max ? s.slice(0, max) + "…" : s);
const words = (label: string) => label.replace(/_/g, " ");
const details = (x: unknown, max = 400) => {
  if (x === null || x === undefined || typeof x !== "object") return "";
  const entries = Object.entries(x as object);
  const flat = entries.every(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v));
  return clip(flat ? entries.map(([k, v]) => `${words(k)}: ${v}`).join("; ") : JSON.stringify(x), max);
};

/** An outcome someone commits to or is asked for (§9), in words. */
export function outcomeWords(o: any, every?: number): string {
  const rep = every ? ` every ${duration(every)}` : "";
  if (o?.money) return `pay ${money(o.money.amount)}${o.money.from ? ` from ${o.money.from}` : ""} to ${o.money.to}${rep}${o.money.for ? ` (${o.money.for})` : ""}`;
  if (o?.structure) return o.structure.remove ? `demolish ${o.structure.remove}` : `build a ${o.structure.type} on lot ${o.structure.on}`;
  if (o?.occupancy) return o.occupancy.leave ? `have ${o.occupancy.who} leave ${o.occupancy.in}` : `give ${o.occupancy.who} a ${o.occupancy.slot ?? "place"} in ${o.occupancy.in}`;
  if (o?.account) return o.account.close ? `close account ${o.account.close}` : `open an account for ${o.account.holder}`;
  return "do what the terms say";
}

const POSITION: { [p: string]: string } = { right: "has a right", liberty: "is permitted", power: "has the power", immunity: "is immune" };

function describeRecord(r: Record): string {
  const from = r.author === "genesis" ? "" : ` (${when(r.at)})`;
  const who = r.speaks_for ?? r.author;
  switch (r.record) {
    case "statement": {
      if (r.kind === "request" && r.data?.outcome) return `[${r.id}] ${who} asked ${(r.addressed_to ?? []).join(", ")} to ${outcomeWords(r.data.outcome, r.data.every)}${from}`;
      const d = details(r.data);
      return `[${r.id}] ${words(r.kind)} from ${who}${r.addressed_to ? `, to ${r.addressed_to.join(", ")}` : ""}${from}: "${clip(r.text, 1000)}"${d ? ` (${d})` : ""}${r.basis ? `, citing ${r.basis}` : ""}`;
    }
    case "claim":
      return `[${r.id}] ${r.holder} ${POSITION[r.position] ?? r.position}${r.counterparty ? ` against ${r.counterparty}` : ""}: ${details(r.about) || "(no details)"}${r.basis ? `, citing ${r.basis}` : ""}${from}`;
    case "agreement": {
      const c = r.terms.commitments.map((x) => `${x.who} will ${x.does?.outcome ? outcomeWords(x.does.outcome, x.every) : clip(JSON.stringify(x.does), 200)}`).join("; ");
      return `[${r.id}] ${r.terms.template ? `${words(r.terms.template)} agreement` : "agreement"} between ${r.terms.parties.join(" and ")}${r.terms.term ? `, for ${duration(r.terms.term)}` : ""}: ${c || "no commitments"}${r.terms.text ? `. "${clip(r.terms.text)}"` : ""}${from}`;
    }
    case "signature":
      return `[${r.id}] ${r.as} signed ${r.agreement}${from}`;
    case "notice":
      return `[${r.id}] ${r.as} gave notice on ${r.agreement}${r.text ? `: "${clip(r.text)}"` : ""}${from}`;
    case "withdrawal":
      return `[${r.id}] ${who} withdrew ${r.withdraws}${r.text ? `: "${clip(r.text)}"` : ""}${from}`;
    case "vote":
      return `[${r.id}] ${who} voted "${r.choice}" on ${r.ballot}${from}`;
    case "claim_transfer":
      return `[${r.id}] ${r.claim} now belongs to ${r.to}${from}`;
    case "claim_release":
      return `[${r.id}] ${r.claim} was released${from}`;
    case "entity_declaration":
      return `[${r.id}] ${who} set up a ${r.kind}, "${r.name}" (${r.entity})${from}`;
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
      const what = c.about?.kind === "ownership" ? `${c.holder} owns ${g.length} lots` : `${g.length} ${c.about?.kind ? `${words(c.about.kind)} ` : ""}records: ${c.holder} ${POSITION[c.position] ?? c.position}${c.counterparty ? ` against ${c.counterparty}` : ""}`;
      return `${what}${total ? `, totalling ${money(total)}` : ""}: ${objects.slice(0, 12).join(", ")}${objects.length > 12 ? `, and ${objects.length - 12} more` : ""}`;
    }
    const v = tallies.get(x)!;
    const counts = new Map<string, number>();
    for (const r of v) counts.set(r.choice, (counts.get(r.choice) ?? 0) + 1);
    return `${v.length} vote${v.length === 1 ? "" : "s"} on ${v[0]!.ballot}: ${[...counts].sort().map(([c, n]) => `${c} ${n}`).join(", ")}`;
  });
}

/** A town survey: counts, not raw parcels. */
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
  const types = [...byType].sort().map(([t, c]) => `${c.done} ${words(t)}${c.building ? ` (and ${c.building} being built)` : ""}`).join(", ");
  const use = [...slots].sort().map(([s, u]) => `${u.used} of ${u.total} ${words(s)} places taken`).join("; ");
  return `As of ${when(asOf)}: ${parcels.length} lots, ${empty} of them empty. Buildings: ${types || "none"}. ${use ? `${use}.` : ""}`.trim();
}

function describeTransactions(txs: Transaction[], mine: Set<string>): string[] {
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const x of txs) {
    if (mine.has(x.to) && !mine.has(x.from)) inflow.set(x.from, (inflow.get(x.from) ?? 0) + x.amount);
    if (mine.has(x.from) && !mine.has(x.to)) outflow.set(x.to, (outflow.get(x.to) ?? 0) + x.amount);
  }
  const line = (label: string, m: Map<string, number>) => {
    if (m.size === 0) return [];
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const t = [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    return [`${label} ${money(total)} since you last looked: ${t.slice(0, 8).map(([a, v]) => `${a} ${money(v)}`).join(", ")}${t.length > 8 ? `, and ${t.length - 8} more` : ""}.`];
  };
  return [...line("Received", inflow), ...line("Paid out", outflow)];
}

export interface RenderOptions {
  /** Items shown per report before earlier ones are only counted. */
  maxRecords?: number;
  /** Spaces in a kind of building (from the world's catalogue), for the survey. */
  capacity?: (type: string) => { [slot: string]: number };
  /** Reports whose items are standing documents (shown separately, in full). */
  standing?: Set<string>;
  /** What the seat's reports are called (Channel.title). */
  titles?: Map<string, string>;
  /** What the seat's last action was, in words ("What you confirmed", "Your letter to …"). */
  lastAction?: string;
  /** How a draft awaiting confirmation reads. */
  draftText?: (d: any) => string;
}

/** What's new since the seat last looked. */
export function renderObservation(obs: Observation, o: RenderOptions = {}): string {
  const max = o.maxRecords ?? 40;
  const title = (id: string) => o.titles?.get(id) ?? words(id).replace(/^./, (c) => c.toUpperCase());
  const out: string[] = [`It is ${when(obs.t)}.`];
  for (const x of obs.outcomes) {
    const what = o.lastAction ?? "What you did";
    out.push(x.status === "applied" ? `Done: ${what.charAt(0).toLowerCase()}${what.slice(1)}.` : `${what} couldn't be done: ${refusalText(x.refusal?.code)}.`);
  }
  for (const n of obs.notices ?? []) out.push(`A note on your request: ${n.text}`);
  if (obs.inbox.length) {
    out.push("", "## Letters");
    for (const m of obs.inbox) out.push(`- From ${m.from} (${when(m.t)})${m.re ? `, about ${m.re}` : ""}: "${m.text}"`);
  }
  // Anything on file (standing documents) isn't repeated in other reports.
  const onFile = new Set(Object.entries(obs.channels).flatMap(([id, ch]) => (o.standing?.has(id) && ch.kind === "records" ? ch.records.map((r) => r.id) : [])));
  for (const [id, ch] of Object.entries(obs.channels)) {
    if (o.standing?.has(id)) continue;
    if (ch.kind === "accounts") {
      out.push("", `## ${title(id)}`);
      for (const a of ch.accounts) out.push(`- ${a.account}${a.holder === obs.entity ? "" : ` (${a.holder}'s)`}, kept by ${a.custodian === obs.entity ? "you" : a.custodian}: ${money(a.balance)}`);
      out.push(...describeTransactions(ch.transactions, new Set(ch.accounts.map((a) => a.account))).map((l) => `  ${l}`));
    } else if (ch.kind === "records") {
      const fresh = ch.records.filter((r) => !onFile.has(r.id));
      if (fresh.length === 0) continue;
      const lines = recordLines(fresh);
      out.push("", `## ${title(id)} (${lines.length} new)`);
      if (lines.length > max) out.push(`(${lines.length - max} earlier ${lines.length - max === 1 ? "item" : "items"} not listed.)`);
      for (const l of lines.slice(-max)) out.push(`- ${l}`);
    } else if (ch.kind === "sites") {
      out.push("", `## ${title(id)}`, describeSites(ch.parcels, ch.as_of, o.capacity ?? (() => ({}))));
    } else if (ch.kind === "directory") {
      const orgs = ch.entities.filter((e) => e.kind !== "person").map((e) => `${e.name} (${e.entity})`);
      const offices = ch.seats.filter((s) => s.role).map((s) => `${s.seat}: ${words(s.role!)}, for ${s.entity}${s.status === "active" ? "" : " (gone)"}`);
      out.push("", `## ${title(id)}`, `Organisations: ${orgs.join(", ") || "none"}.`, ...(offices.length ? [`Office holders: ${offices.slice(0, 60).join("; ")}${offices.length > 60 ? "; …" : ""}.`] : []), `People: ${ch.entities.filter((e) => e.kind === "person").length}.`);
    }
  }
  if (obs.drafts.length) {
    out.push("", "## Waiting for you to confirm");
    for (const d of obs.drafts) out.push(o.draftText ? o.draftText(d) : `(${d.id}) ${d.summary}`);
  }
  return out.join("\n");
}

/** Standing documents (laws, charters, procedures) from the given reports, in full. */
export function renderStanding(obs: Observation, standing: Set<string>): string {
  const out: string[] = [];
  for (const [id, ch] of Object.entries(obs.channels)) {
    if (!standing.has(id) || ch.kind !== "records") continue;
    for (const r of ch.records) if (r.record === "statement") out.push(`- [${r.id}] ${words(r.kind)}${r.speaks_for ? ` of ${r.speaks_for}` : ""}: "${r.text}"${r.data ? ` (${details(r.data)})` : ""}`);
  }
  return out.join("\n");
}
