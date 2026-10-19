import type { Offer } from "../contracts";
import { usd } from "./common";


/** What a venue says it hears (the contract's Offer.hears), with how it goes about it. */
export interface Hears {
  about: string;
  can?: ("order" | "recommend" | "mediate" | "refer" | "represent" | "publish")[];
  undoes?: boolean;
  form?: string;
  within?: number;
  /** What applying about this costs, where it differs from the body's own fee (the law on a decision's appeal states its own: foundations F8). */
  fee?: number;
}

/** The offer a venue publishes: who it is, what it hears, what applying costs. */
export function hearingOffer(me: string, hears: Hears[], o: { fee?: number; account?: string; members_of?: string } = {}): Offer {
  return {
    by: me, take_up: "apply", ...(o.members_of ? { to: { members_of: o.members_of } } : {}),
    hears: hears.map((h) => ({ about: h.about, ...(h.can?.length ? { can: h.can } : {}), ...(h.undoes ? { undoes: true } : {}), ...(h.form ? { form: h.form } : {}), ...(h.within ? { within: h.within } : {}) })),
    ...(o.fee && o.fee > 0 && o.account ? { terms: { commitments: [{ who: "taker", does: { outcome: { money: { to: o.account, amount: String(o.fee), for: "application fee" } } } }] } } : {}),
  } as Offer;
}

/** What a body that hears grievances says it hears: its public notice, with the offer whoever has such a matter takes up. */
export function hearingNotice(me: string, words: string, hears: Hears[], o: { fee?: number; account?: string; members_of?: string; members_apply?: boolean } = {}): { kind: string; text: string; data: unknown; offer: Offer } {
  const fee = o.fee ?? 0;
  return { kind: "hearing", text: `${words}: ${hears.map((h) => h.about.replace(/_/g, " ")).join(", ")}. ${o.members_apply ? "Members apply" : "Apply"} in writing${fee > 0 ? `; the fee is ${usd(fee)}` : "; there is no fee"}.`,
    offer: hearingOffer(me, hears, { fee: o.fee, account: o.account, members_of: o.members_of }), data: { hears: hears.map((h) => h.about), ...(fee > 0 ? { fee } : {}) } };
}

/** The notices of what a body hears: one, or one for each fee where what it hears is charged differently (an appeal the law makes free beside its other lists). */
export function hearingNotices(me: string, words: string, hears: Hears[], o: { fee?: number; account?: string; members_of?: string; members_apply?: boolean } = {}): ReturnType<typeof hearingNotice>[] {
  const byFee = new Map<number, Hears[]>();
  for (const h of hears) { const fee = h.fee ?? o.fee ?? 0; byFee.set(fee, [...(byFee.get(fee) ?? []), h]); }
  return [...byFee].sort(([a], [b]) => a - b).map(([fee, hs]) => hearingNotice(me, words, hs, { ...o, fee }));
}
