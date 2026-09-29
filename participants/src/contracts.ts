// TypeScript views of the contract types code participants handle (contracts
// v0.5: participant-api, blocks, records). The JSON Schemas are the source of
// truth; participants/test/contracts.test.ts validates these shapes against them.

export type Id = string;

export type Visibility = "public" | Id[];

export interface RecordBase {
  id: Id;
  author: string; // participant id, or "genesis"
  /** The position the author made it in (absent: as itself). */
  in_position?: Id;
  speaks_for?: Id;
  at: number;
  visible_to: Visibility;
  basis?: Id;
}

export type Record =
  | (RecordBase & { record: "claim"; position: "right" | "liberty" | "power" | "immunity"; holder: Id; counterparty?: Id; about: Json })
  | (RecordBase & { record: "claim_transfer"; claim: Id; to: Id })
  | (RecordBase & { record: "claim_release"; claim: Id })
  | (RecordBase & { record: "agreement"; terms: AgreementTerms })
  | (RecordBase & { record: "signature"; agreement: Id; as: Id })
  | (RecordBase & { record: "notice"; agreement: Id; as: Id; text?: string })
  | (RecordBase & { record: "statement"; kind: string; text: string; data?: Json; adico?: Json; formal?: { language: "cel"; condition: string }; offer?: Offer; practice?: Practice; addressed_to?: Id[]; place?: Id })
  | (RecordBase & { record: "withdrawal"; withdraws: Id; text?: string })
  | (RecordBase & { record: "vote"; ballot: Id; choice: string })
  | (RecordBase & { record: "entity_declaration"; entity: Id; kind: string; name: string });

export type StatementRecord = Extract<Record, { record: "statement" }>;

/** What a commitment comes to, in the world's terms (blocks: Outcome; named apart from an act's Outcome): exactly one. */
export type CommitmentOutcome =
  | { money: { from?: Id; to?: Id; amount: string; for?: string; settles?: Id } }
  | { goods: { kind: string; quantity: string; to?: Id; at?: Id; from?: Id } }
  | { occupancy: { who?: Id; in: Id; leave?: boolean } }
  | { structure: { type?: string; on?: Id; remove?: Id } }
  | { account: { holder?: Id; close?: Id } }
  | { work: { task: string; at?: Id; hours?: number; units?: string } }
  | { attend: { practice: Id; role?: string } };

/** What a party commits to (blocks: Does): an outcome, or anything else in words. */
export type Does = { outcome: CommitmentOutcome } | { text: string };

/** Who may take something up or take part (blocks: Eligibility): every condition given must hold. */
export interface Eligibility { anyone?: true; members_of?: Id; holds?: Id; entities?: Id[]; min_age_years?: number }

/** What someone may take up, on what terms, and how (blocks: Offer; docs/design/ai-citizens.md 2a). Facts only. */
export interface Offer {
  by?: Id;
  to?: Eligibility;
  take_up: "sign" | "apply" | "order" | "join" | "attend";
  terms?: { commitments: { who: Id | "taker"; does: Does; every?: number; per?: "unit" }[]; term?: number; termination?: { party: Id | "taker"; notice: number }[]; template?: string };
  available?: number;
  until?: number;
  practice?: Id;
}

/** A recurring situation people take part in (blocks: Practice; 2b). It has no power. */
export interface Practice {
  at: Id;
  every: number;
  first?: number;
  lasts?: number;
  roles?: { role: string; who?: Eligibility; open?: boolean }[];
  during?: { role?: string; does: Does; optional?: boolean }[];
}

export interface AgreementTerms {
  template?: string;
  parties: Id[];
  /** (`does` is typed in the contract, `Does`; read loosely here, and checked by the kernel.) */
  commitments: { who: Id; does: Json; every?: number }[];
  term?: number;
  termination?: { party: Id; notice: number }[];
  text?: string;
  attrs?: Json;
}

// deno-lint-ignore no-explicit-any
export type Json = any;

/** A block, as the kernel accepts it (contracts/blocks.schema.json). */
export type Block = { block: string } & { [k: string]: Json };

export type ParticipantAction =
  | { type: "act"; blocks: Block[]; as?: Id; reasoning?: string }
  | { type: "propose"; text: string; as?: Id; reasoning?: string }
  | { type: "sign"; draft: string; decision: "accept" | "reject"; note?: string }
  | { type: "message"; to: Id[]; text: string; re?: Id; as?: Id }
  | { type: "wait"; until?: number }
  | { type: "call"; call: string; as?: Id; reasoning?: string }
  | { type: "look"; looks: LookRequest[] }
  | { type: "opt_out"; statement: string };

/** Look through a channel now (attention); a records channel can be searched (contracts/participant-api.schema.json, Query). */
export interface LookRequest {
  channel: Id;
  query?: {
    standing?: boolean;
    where?: { field: string; op: "=" | "!=" | "<" | "<=" | ">" | ">="; value: number | string | boolean }[];
    order?: { field: string; desc?: boolean };
    limit?: number;
  };
}

export interface Outcome {
  action: Id;
  t: number;
  status: "applied" | "refused";
  created?: { [ref: string]: Id };
  refusal?: { code: string; block?: number; detail?: string };
}

export interface Message { id: Id; t: number; from: Id; as?: Id; to: Id[]; text: string; re?: Id }

/** Amounts and balances are decimal-string integers in the currency's smallest unit (D58); `cents` (money.ts) reads them. */
export interface Transaction { t: number; from: Id; to: Id; amount: string; currency: string; by: Id; settles?: Id; per_instruction?: Id; memo?: string }

/** A space in a building: its kind and attributes (the world's vocabulary), how many bodies it holds at most, how many
 * are in it, and who (in the capacity's own buildings, or where its channel shows names). */
export interface Departure { occupant: Id; reason: "left" | "removed" | "demolition" | "departed" | "died"; at: number }
export interface SiteSpace { space: Id; kind: string; capacity: number; attrs?: Json; count: number; occupants?: Id[]; left?: Departure[] }
/** A state variable as perceived (phase B): its value on a day, its change each whole day since, and its bounds. */
export interface VariableView { value: number; as_of_day: number; per_day: number; min: number; max: number }
export interface SiteStructure { structure: Id; type: Id; at: Id; w: number; h: number; built_by?: Id; complete: boolean; completes_at?: number; coming_down?: boolean; variables?: { [id: Id]: VariableView }; spaces: SiteSpace[] }
/** A cell of ground, and the building standing on it (the same on every cell of its footprint). */
export interface SiteCell { cell: Id; x: number; y: number; terrain?: string; structure?: SiteStructure }
export interface PositionItem { position: Id; entity: Id; title?: string; role?: string; holder?: Id; held_by?: string }
export interface Condition { id: Id; kind: "illness" | "injury"; severity: string; since: number; until: number }
export type Sex = "female" | "male";
/** A child, as their parent knows them. */
export interface ChildView { person: Id; born_at: number; sex?: Sex; alive: boolean }
export interface Body { born_at: number; sex?: Sex; present: boolean; alive: boolean; parents?: Id[]; conditions?: Condition[]; children?: ChildView[] }

/** What an entity holds, and where (phase B): a quantity (a decimal-string integer) of a resource kind at a place. */
export interface HoldingItem { kind: Id; at: Id; quantity: string }

export type ChannelData =
  | { kind: "accounts"; accounts: { account: Id; holder: Id; custodian: Id; currency: string; balance: string; closed?: true }[]; transactions: Transaction[] }
  | { kind: "holdings"; holdings: HoldingItem[] }
  | { kind: "records"; records: Record[]; search?: true; whole?: true }
  | { kind: "sites"; as_of: number; cells: SiteCell[]; whole?: true }
  | { kind: "directory"; entities: { entity: Id; kind: string; name: string; participant?: Id }[]; positions: PositionItem[] };

/**
 * What a participant perceives (contracts/participant-api.schema.json). The runtime hands a code module the slice for
 * one capacity: its channels by their own ids, `entity` the one it acts for (its person, or the position's
 * organisation) and `as` the position (absent: as itself). A language-model participant sees all its capacities at
 * once, positions' channels as `<position>/<channel>`.
 */
export interface Observation {
  participant: Id;
  t: number;
  status: "active" | "opted_out" | "ended";
  /** The entity it acts for in this capacity (its person, or the position's organisation). */
  entity: Id;
  /** The position it acts in, for a code module's slice (absent: as itself). */
  as?: Id;
  body?: Body;
  positions?: { position: Id; entity: Id; title?: string; role?: string }[];
  outcomes: Outcome[];
  inbox: Message[];
  drafts: Json[];
  /** The orchestrator's notes about the participant's own requests (not world state); absent when there are none. */
  notices?: { t: number; text: string; re?: string }[];
  channels: { [id: string]: ChannelData };
}

/** Convenience accessors over an observation's channels. */
export const channels = {
  records(obs: Observation): Record[] {
    return Object.values(obs.channels).flatMap((c) => (c.kind === "records" ? c.records : []));
  },
  accounts(obs: Observation) {
    return Object.values(obs.channels).flatMap((c) => (c.kind === "accounts" ? c.accounts : []));
  },
  /** What the entity holds, and where (the holdings channels' current picture). */
  holdings(obs: Observation): HoldingItem[] {
    return Object.values(obs.channels).flatMap((c) => (c.kind === "holdings" ? c.holdings : []));
  },
  transactions(obs: Observation): Transaction[] {
    return Object.values(obs.channels).flatMap((c) => (c.kind === "accounts" ? c.transactions : []));
  },
  cells(obs: Observation): SiteCell[] {
    return Object.values(obs.channels).flatMap((c) => (c.kind === "sites" ? c.cells : []));
  },
  /** The buildings in view, once each (a building is reported on every cell it stands on). */
  structures(obs: Observation): SiteStructure[] {
    const seen = new Map<Id, SiteStructure>();
    for (const c of channels.cells(obs)) if (c.structure && !seen.has(c.structure.structure)) seen.set(c.structure.structure, c.structure);
    return [...seen.values()];
  },
  directory(obs: Observation) {
    return Object.values(obs.channels).find((c): c is Extract<ChannelData, { kind: "directory" }> => c.kind === "directory");
  },
};

/**
 * One capacity's slice of an observation, as a code module reads it: the channels of that capacity by their own ids
 * (a position's `<position>/<channel>` loses its prefix), `entity` the one it acts for, and `as` the position.
 * The inbox, outcomes, drafts and notices are passed through (the kernel keys them by capacity already when asked
 * for one).
 */
export function slice(obs: Observation, capacity: Id, entity: Id): Observation {
  const self = capacity === "self";
  const prefix = `${capacity}/`;
  const channels: Observation["channels"] = {};
  for (const [id, ch] of Object.entries(obs.channels)) {
    if (self ? !id.includes("/") : id.startsWith(prefix)) channels[self ? id : id.slice(prefix.length)] = ch;
  }
  return { ...obs, entity, ...(self ? {} : { as: capacity }), channels };
}
