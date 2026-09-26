// TypeScript views of the contract types code seats handle (contracts v0.2:
// seat-api, blocks, records). The JSON Schemas are the source of truth;
// seats/test/contracts.test.ts validates these shapes against them.

export type Id = string;

export type Visibility = "public" | Id[];

export interface RecordBase {
  id: Id;
  author: string; // seat id, or "genesis"
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
  | (RecordBase & { record: "statement"; kind: string; text: string; data?: Json; adico?: Json; formal?: { language: "cel"; condition: string }; addressed_to?: Id[] })
  | (RecordBase & { record: "withdrawal"; withdraws: Id; text?: string })
  | (RecordBase & { record: "vote"; ballot: Id; choice: string })
  | (RecordBase & { record: "entity_declaration"; entity: Id; kind: string; name: string });

export type StatementRecord = Extract<Record, { record: "statement" }>;

export interface AgreementTerms {
  template?: string;
  parties: Id[];
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

export type SeatAction =
  | { type: "act"; blocks: Block[]; reasoning?: string }
  | { type: "propose"; text: string; reasoning?: string }
  | { type: "sign"; draft: string; decision: "accept" | "reject"; note?: string }
  | { type: "message"; to: Id[]; text: string; re?: Id }
  | { type: "wait"; until?: number }
  | { type: "call"; call: string; reasoning?: string }
  | { type: "opt_out"; statement: string };

export interface Outcome {
  action: Id;
  t: number;
  status: "applied" | "refused";
  created?: { [ref: string]: Id };
  refusal?: { code: string; block?: number; detail?: string };
}

export interface Message { id: Id; t: number; from: Id; to: Id[]; text: string; re?: Id }

export interface Transaction { t: number; from: Id; to: Id; amount: number; by: Id; settles?: Id; per_instruction?: Id; memo?: string }

export interface SiteParcel {
  parcel: Id; x: number; y: number; w: number; h: number;
  structure?: { structure: Id; type: Id; built_by?: Id; complete: boolean; completes_at?: number; occupancy: { occupant: Id; slot: string; count: number }[] };
}

export type ChannelData =
  | { kind: "accounts"; accounts: { account: Id; holder: Id; custodian: Id; balance: number; closed?: true }[]; transactions: Transaction[] }
  | { kind: "records"; records: Record[] }
  | { kind: "sites"; as_of: number; parcels: SiteParcel[] }
  | { kind: "directory"; entities: { entity: Id; kind: string; name: string }[]; seats: { seat: Id; entity: Id; title?: string; role?: string; status: "active" | "opted_out" }[] };

export interface Observation {
  seat: Id;
  t: number;
  status: "active" | "opted_out";
  entity: Id;
  outcomes: Outcome[];
  inbox: Message[];
  drafts: Json[];
  /** The orchestrator's notes about the seat's own requests (not world state); absent when there are none. */
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
  transactions(obs: Observation): Transaction[] {
    return Object.values(obs.channels).flatMap((c) => (c.kind === "accounts" ? c.transactions : []));
  },
  sites(obs: Observation): SiteParcel[] {
    return Object.values(obs.channels).flatMap((c) => (c.kind === "sites" ? c.parcels : []));
  },
  directory(obs: Observation) {
    return Object.values(obs.channels).find((c): c is Extract<ChannelData, { kind: "directory" }> => c.kind === "directory");
  },
};
