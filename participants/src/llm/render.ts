// What a language-model participant reads (principle 14: the platform is
// invisible to participants). An Observation becomes the reports a person in that role would
// read, in the world's own terms: accounts, letters, filings, titles,
// agreements, a survey of the town. No blocks, records, channels or refusal
// codes. Deterministic: the same observation always reads the same.

import { cents, formatMoney } from "../money";
import type { Body, Observation, Record, SiteStructure, Transaction } from "../contracts";
import { channels } from "../contracts";
import { refusalText } from "./words";

const DAY = 86_400;
const YEAR = 365 * DAY;

/** Money as people write it (money.ts). */
export const money = formatMoney;

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
/** A statement's details. A form's are always whole: its fields are what it's filled in from, and whoever reads the
 * request made on it sees every one (a long form cut short reads as a form without its last fields). */
const dataWords = (r: { kind: string; data?: unknown }) => details(r.data, r.kind === "form" ? Infinity : 400);

/** An outcome someone commits to or is asked for (§9), in words. */
export function outcomeWords(o: any, every?: number): string {
  const rep = every ? ` every ${duration(every)}` : "";
  if (o?.goods) return `deliver ${o.goods.quantity} ${o.goods.kind} to ${o.goods.to} at ${o.goods.at}${rep}`;
  if (o?.money) return `pay ${money(o.money.amount)}${o.money.from ? ` from ${o.money.from}` : ""} to ${o.money.to}${rep}${o.money.for ? ` (${o.money.for})` : ""}`;
  if (o?.structure) return o.structure.remove ? `demolish ${o.structure.remove}` : `build a ${o.structure.type} on ${o.structure.on}`;
  if (o?.occupancy) return o.occupancy.leave ? `have ${o.occupancy.who} leave ${o.occupancy.in}` : `let ${o.occupancy.who} live or be in ${o.occupancy.in}`;
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
      const d = dataWords(r);
      return `[${r.id}] ${words(r.kind)} from ${who}${r.place ? `, put up on ${r.place}` : ""}${r.addressed_to ? `, to ${r.addressed_to.join(", ")}` : ""}${from}: "${clip(r.text, 1000)}"${d ? ` (${d})` : ""}${r.basis ? `, citing ${r.basis}` : ""}`;
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
      // Grouped by what the claims say, in the world's own words (its `about.kind`), with no special cases.
      const what = `${g.length} ${c.about?.kind ? `${words(c.about.kind)} ` : ""}claims: ${c.holder} ${POSITION[c.position] ?? c.position}${c.counterparty ? ` against ${c.counterparty}` : ""}`;
      return `${what}${total ? `, totalling ${money(total)}` : ""}: ${objects.slice(0, 12).join(", ")}${objects.length > 12 ? `, and ${objects.length - 12} more` : ""}`;
    }
    const v = tallies.get(x)!;
    const counts = new Map<string, number>();
    for (const r of v) counts.set(r.choice, (counts.get(r.choice) ?? 0) + 1);
    return `${v.length} vote${v.length === 1 ? "" : "s"} on ${v[0]!.ballot}: ${[...counts].sort().map(([c, n]) => `${c} ${n}`).join(", ")}`;
  });
}

const attrWords = (a: unknown) => (a && typeof a === "object" && Object.keys(a).length ? ` (${details(a, 120)})` : "");

/** A few buildings, one by one: their spaces, how full each is, and who's there where the participant can tell. */
function describeBuildings(structures: SiteStructure[], me: string): string[] {
  return structures.map((s) => {
    const head = `- ${words(s.type)} ${s.structure}, at ${s.at}${s.w * s.h > 1 ? ` (${s.w} by ${s.h} cells)` : ""}${s.complete ? "" : `, being built${s.completes_at ? ` until ${when(s.completes_at)}` : ""}`}`;
    if (!s.complete) return head;
    const lines = s.spaces.length <= 8
      ? s.spaces.map((x) => {
          const who = (x.occupants ?? []).map((o) => (o === me ? "you" : o));
          return `  - ${x.space}, a ${words(x.kind)}${attrWords(x.attrs)}: ${x.count} ${x.count === 1 ? "person" : "people"} (room for ${x.capacity})${who.length ? `: ${who.join(", ")}` : ""}`;
        })
      : [...groupSpaces(s.spaces).values()].map((g) => `  - ${g.n} ${words(g.kind)}s${g.attrs}: ${g.used} in use, ${g.people} people${g.mine.length ? `; yours: ${g.mine.join(", ")}` : ""}`);
    return [head, ...lines].join("\n");
  });

  function groupSpaces(spaces: SiteStructure["spaces"]) {
    const m = new Map<string, { kind: string; n: number; used: number; people: number; attrs: string; mine: string[] }>();
    for (const x of spaces) {
      const key = `${x.kind}${attrWords(x.attrs)}`;
      const g = m.get(key) ?? { kind: x.kind, n: 0, used: 0, people: 0, attrs: attrWords(x.attrs), mine: [] };
      g.n++;
      if (x.count) g.used++;
      g.people += x.count;
      if ((x.occupants ?? []).includes(me)) g.mine.push(x.space);
      m.set(key, g);
    }
    return m;
  }
}

/** A town survey: counts, not raw cells. */
function describeSurvey(cells: number, open: number, structures: SiteStructure[], asOf: number): string {
  const byType = new Map<string, { done: number; building: number }>();
  const spaces = new Map<string, { kind: string; attrs: string; used: number; total: number; people: number }>();
  for (const s of structures) {
    const c = byType.get(s.type) ?? { done: 0, building: 0 };
    s.complete ? c.done++ : c.building++;
    byType.set(s.type, c);
    if (!s.complete) continue;
    for (const x of s.spaces) {
      const key = `${x.kind}${attrWords(x.attrs)}`;
      const u = spaces.get(key) ?? { kind: x.kind, attrs: attrWords(x.attrs), used: 0, total: 0, people: 0 };
      u.total++;
      if (x.count) u.used++;
      u.people += x.count;
      spaces.set(key, u);
    }
  }
  const types = [...byType].sort().map(([t, c]) => `${c.done} ${words(t)}${c.building ? ` (and ${c.building} being built)` : ""}`).join(", ");
  const use = [...spaces].sort().map(([, u]) => `${u.used} of ${u.total} ${words(u.kind)}s${u.attrs} in use, ${u.people} people`).join("; ");
  return `As of ${when(asOf)}: ${cells} cells of ground, ${open} of them open. Buildings: ${types || "none"}. ${use ? `${use}.` : ""}`.trim();
}

/** The participant's own body, in plain words. */
function describeBody(b: Body, t: number): string[] {
  const age = Math.floor((t - b.born_at) / YEAR);
  const out = [`You are ${age} year${age === 1 ? "" : "s"} old${b.present ? "" : ", and away from here"}.`];
  for (const c of b.conditions ?? []) out.push(`You have ${c.severity === "mild" ? "a mild" : `a ${words(c.severity)}`} ${c.kind === "injury" ? "injury" : "illness"}, since ${when(c.since)}; it should pass by ${when(c.until)}.`);
  return out;
}

function describeTransactions(txs: Transaction[], mine: Set<string>): string[] {
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const x of txs) {
    if (mine.has(x.to) && !mine.has(x.from)) inflow.set(x.from, (inflow.get(x.from) ?? 0) + cents(x.amount));
    if (mine.has(x.from) && !mine.has(x.to)) outflow.set(x.to, (outflow.get(x.to) ?? 0) + cents(x.amount));
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
  /** Reports whose items are standing documents (shown separately, in full). */
  standing?: Set<string>;
  /** What the participant's reports are called (Channel.title). */
  titles?: Map<string, string>;
  /** What the participant's last action was, in words ("What you confirmed", "Your letter to …"). */
  lastAction?: string;
  /** How a draft awaiting confirmation reads. */
  draftText?: (d: any) => string;
}

/** What's new since the participant last looked. */
export function renderObservation(obs: Observation, o: RenderOptions = {}): string {
  const max = o.maxRecords ?? 40;
  const cap = (x: string) => words(x).replace(/^./, (c) => c.toUpperCase());
  const postTitle = new Map((obs.positions ?? []).map((p) => [p.position, p.title ?? words(p.role ?? p.position)]));
  // A post's reports are named after the post (`mayor/budget` reads "Mayor: Budget").
  const title = (id: string) => o.titles?.get(id) ?? (id.includes("/") ? `${cap(postTitle.get(id.split("/")[0]!) ?? id.split("/")[0]!)}: ${cap(id.split("/").slice(1).join("/"))}` : cap(id));
  const out: string[] = [`It is ${when(obs.t)}.`];
  if (obs.body) out.push(...describeBody(obs.body, obs.t));
  if (obs.positions?.length) out.push(`You hold ${obs.positions.length === 1 ? "a post" : "these posts"}: ${obs.positions.map((p) => `${p.title ?? words(p.role ?? p.position)} (${p.position}), for ${p.entity}`).join("; ")}.`);
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
    } else if (ch.kind === "holdings") {
      out.push("", `## ${title(id)}`);
      if (!ch.holdings.length) out.push("- (nothing)");
      for (const h of ch.holdings) out.push(`- ${h.quantity.replace(/\B(?=(\d{3})+(?!\d))/g, ",")} ${h.kind} at ${h.at}`);
    } else if (ch.kind === "records") {
      const fresh = ch.records.filter((r) => !onFile.has(r.id));
      if (fresh.length === 0) continue;
      const lines = recordLines(fresh);
      out.push("", `## ${title(id)} (${lines.length} new)`);
      if (lines.length > max) out.push(`(${lines.length - max} earlier ${lines.length - max === 1 ? "item" : "items"} not listed.)`);
      for (const l of lines.slice(-max)) out.push(`- ${l}`);
    } else if (ch.kind === "sites") {
      // A few buildings (the participant's surroundings) one by one; a whole town as a survey.
      const structures = channels.structures({ ...obs, channels: { [id]: ch } });
      const open = ch.cells.filter((c) => !c.structure).length;
      if (structures.length <= 30) {
        out.push("", `## ${title(id)}`, ...(structures.length ? describeBuildings(structures, obs.entity) : ["No buildings here."]));
        if (open) out.push(`Open ground: ${open} cell${open === 1 ? "" : "s"}${open <= 12 ? ` (${ch.cells.filter((c) => !c.structure).map((c) => `${c.cell}${c.terrain ? `, ${words(c.terrain)}` : ""}`).join("; ")})` : ""}.`);
      } else out.push("", `## ${title(id)}`, describeSurvey(ch.cells.length, open, structures, ch.as_of));
    } else if (ch.kind === "directory") {
      const orgs = ch.entities.filter((e) => e.kind !== "person").map((e) => `${e.name} (${e.entity})`);
      const nameOf = new Map(ch.entities.filter((e) => e.participant).map((e) => [e.participant!, `${e.name} (${e.entity})`]));
      // Posts with a public role (mayor, councillor…) are listed with who holds them; the rest are only counted.
      const roled = ch.positions.filter((p) => p.role);
      const offices = roled.map((p) => `${p.title ?? words(p.role!)} (${p.position}), for ${p.entity}: ${p.holder ? (nameOf.get(p.holder) ?? p.held_by ?? "filled") : "vacant"}`);
      const others = ch.positions.length - roled.length;
      out.push("", `## ${title(id)}`, `Organisations: ${orgs.join(", ") || "none"}.`,
        ...(offices.length ? [`Posts: ${offices.slice(0, 60).join("; ")}${offices.length > 60 ? "; …" : ""}${others ? `; and ${others} other post${others === 1 ? "" : "s"} in organisations' own offices` : ""}.`] : []),
        `People: ${ch.entities.filter((e) => e.kind === "person").length}.`);
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
    for (const r of ch.records) if (r.record === "statement") out.push(`- [${r.id}] ${words(r.kind)}${r.speaks_for ? ` of ${r.speaks_for}` : ""}: "${r.text}"${r.data ? ` (${dataWords(r)})` : ""}`);
  }
  return out.join("\n");
}
