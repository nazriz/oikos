// Interventions at a fork (docs/design/delegation.md section 7; docs/experiments.md, "Interventions"): acts a researcher
// has a principal make at the fork's moment, in its own name and post, noted in the log as an intervention and unseen as
// such by anyone in the world. The principal finds its own new record and its own rule takes it up from there.
//
// A named intervention is expanded here, outside the world, into the call-language acts the principal would make, from what
// the base's log shows of its services at the fork (`DelegationTracker`, which reads the log as measurement does). The
// engine carries the acts out (`at_fork`, kernel/src/engine.rs).

import { formatMoney } from "@oikos/participants";

/** One act at the fork, as the engine takes it: `participant` acting in post `as`, the act in the call language. */
export interface AtFork { participant: string; as?: string; call: string; why: string }

export type Level = "advice" | "draft" | "approve" | "alone" | "none";

/** What an arm asks for. `principal` is the principal's post, or a person's participant (a person acts as itself).
 * Kinds of matter are paper kinds. */
export type Intervention =
  | { do: "grant" | "change"; principal: string; kind: string; level: Level; hold_days?: number }
  | { do: "withdraw"; principal: string; hold_days?: number }
  | { do: "take_back"; principal: string; kinds?: string[]; hold_days?: number }
  | { do: "redirect"; principal: string; stop?: string[]; move?: { from: string; to: string } }
  | { do: "constrain"; principal: string; level?: Level; kinds?: string[]; limit?: number; channels?: unknown[]; hold_days?: number }
  | { do: "replace"; principal: string; offer: string }
  | { do: "act"; participant: string; as?: string; call: string; why?: string };

export const INTERVENTIONS = ["grant", "change", "withdraw", "take_back", "redirect", "constrain", "replace", "act"] as const;

/** A service as the log shows it: who engaged whom, under which agreement, with what system in which post. */
export interface Service { entity: string; agreement: string; provider: string; offer: any; delivery: string; order: string; systems: string[]; post?: string; noticed: boolean; ended: boolean }

/** What the base's log shows of services, folded from its entries as they come (events `recorded`, `appointed`). */
export class DelegationTracker {
  services: Service[] = [];
  remits: { entity: string; agreement: string; kind: string; level: Level; at: number }[] = [];
  offers: { [id: string]: { provider: string; record: string; data: any } } = {};
  holders: { [position: string]: string | undefined } = {};
  private orders = new Map<string, { entity: string }>();
  private deliveries = new Map<string, { entity: string; offer: any; order: string; systems: string[] }>();

  see(e: any): void {
    if (e.kind !== "event") return;
    const b = e.body;
    if (b.event === "appointed") { this.holders[b.position] = b.holder ?? undefined; for (const s of this.services) if (b.holder && s.systems.includes(b.holder)) s.post = b.position; return; }
    if (b.event !== "recorded") return;
    const r = b.record;
    if (r.record === "statement") {
      if (r.kind === "service_offer" && r.data?.id) this.offers[r.data.id] = { provider: r.speaks_for, record: r.id, data: r.data };
      if (r.kind === "order" && String(r.data?.kind ?? "").startsWith("service:")) this.orders.set(r.id, { entity: r.speaks_for });
      if (r.kind === "service_delivery") this.deliveries.set(r.id, { entity: (r.addressed_to ?? [])[0], offer: r.data?.offer, order: r.data?.order, systems: r.data?.systems ?? [] });
      if (r.kind === "remit" && r.data) this.remits.push({ entity: r.speaks_for, agreement: r.data.agreement, kind: r.data.kind, level: r.data.level, at: r.at });
      if (r.kind === "service_ended") for (const s of this.services) if (s.order === r.data?.order) s.ended = true;
    } else if (r.record === "agreement" && r.terms?.template === "service") {
      const order = Array.isArray(r.basis) ? r.basis[0] : r.basis;
      const d = [...this.deliveries.entries()].find(([, x]) => x.order === order);
      if (d) this.services.push({ entity: d[1].entity, agreement: r.id, provider: d[1].offer?.provider ?? r.speaks_for, offer: d[1].offer, delivery: d[0], order, systems: d[1].systems, noticed: false, ended: false });
    } else if (r.record === "notice") {
      for (const s of this.services) if (s.agreement === r.agreement) s.noticed = true;
    }
  }

  save() { return { services: this.services, remits: this.remits, offers: this.offers, holders: this.holders }; }
  static restore(v: any): DelegationTracker {
    const t = new DelegationTracker();
    Object.assign(t, { services: v?.services ?? [], remits: v?.remits ?? [], offers: v?.offers ?? {}, holders: v?.holders ?? {} });
    return t;
  }

  /** The service in use by an entity at the fork (the newest not ended or noticed). */
  inUse(entity: string): Service | undefined {
    return [...this.services].reverse().find((s) => s.entity === entity && !s.ended && !s.noticed);
  }
}

const say = (kind: string, text: string, to: string, data: object, basis?: string, visible?: string[]) =>
  `statement(kind=${kind}, text=${JSON.stringify(text)}, to=${JSON.stringify([to])}${visible ? `, visible=${JSON.stringify(visible)}` : ""}${basis ? `, basis=${basis}` : ""}, data=${JSON.stringify(data)})`;

/** The acts a named intervention is, as its principal (the holder of post `principal`) would make them at the fork `t`. */
export function expand(iv: Intervention, config: any, tracker: DelegationTracker, t: number): AtFork[] {
  if (iv.do === "act") return [{ participant: iv.participant, ...(iv.as ? { as: iv.as } : {}), call: iv.call, why: iv.why ?? "A researcher's act at the fork." }];
  const pos = config.positions.find((p: any) => p.id === iv.principal);
  const person = pos ? undefined : config.participants.find((p: any) => p.id === iv.principal && p.person);
  if (!pos && !person) throw new Error(`intervention ${iv.do}: no post or person's participant ${iv.principal}`);
  const participant = pos ? tracker.holders[iv.principal] ?? pos.holder : person.id;
  if (!participant) throw new Error(`intervention ${iv.do}: ${iv.principal} is held by nobody at the fork`);
  const entity = pos ? pos.entity : person.person;
  const s = tracker.inUse(entity);
  const hold = (days?: number) => (days ? { hold_until: t + days * 86_400 } : {});
  const at = (call: string, why: string): AtFork => ({ participant, ...(pos ? { as: iv.principal } : {}), call, why });
  const remit = (svc: Service, kind: string, level: Level, days?: number) =>
    at(say("remit", `From now, ${kind.replace(/_/g, " ")}s: ${level}.`, svc.provider, { agreement: svc.agreement, kind, level, ...hold(days) }, svc.agreement, [entity, svc.provider]), `${iv.do}: ${kind} at ${level}`);
  const kindsOf = (svc: Service) => (svc.offer?.kinds ?? []) as string[];
  const need = (): Service => {
    if (!s) throw new Error(`intervention ${iv.do}: ${entity} has no service in use at the fork`);
    return s;
  };
  switch (iv.do) {
    case "grant": case "change": return [remit(need(), iv.kind, iv.level, iv.hold_days)];
    case "take_back": { const svc = need(); return (iv.kinds ?? kindsOf(svc)).map((k) => remit(svc, k, "none", iv.hold_days)); }
    case "withdraw": {
      const svc = need();
      return [...kindsOf(svc).map((k) => remit(svc, k, "none", iv.hold_days)), at(`agreement(notice=${svc.agreement}, text=${JSON.stringify("We are ending the service.")})`, "withdraw: notice on the service")];
    }
    case "redirect": {
      const svc = need();
      const out: AtFork[] = [];
      if (iv.stop?.length) out.push(at(say("brief", `Do not act on ${iv.stop.join(", ")} until told.`, svc.provider, { agreement: svc.agreement, stop: iv.stop }, svc.agreement, [entity, svc.provider]), "redirect: a brief"));
      if (iv.move) {
        const level = [...tracker.remits].reverse().find((r) => r.agreement === svc.agreement && r.kind === iv.move!.from)?.level ?? "alone";
        out.push(remit(svc, iv.move.from, "none"), remit(svc, iv.move.to, level));
      }
      return out;
    }
    case "constrain": {
      const svc = need();
      const out: AtFork[] = [];
      if (iv.level) out.push(...(iv.kinds ?? kindsOf(svc)).map((k) => remit(svc, k, iv.level!, iv.hold_days)));
      if (iv.limit !== undefined) out.push(at(say("brief", `No act of more than ${iv.limit} in the smallest unit.`, svc.provider, { agreement: svc.agreement, limit: iv.limit }, svc.agreement, [entity, svc.provider]), "constrain: a limit"));
      if (iv.channels && svc.post && svc.systems[0]) {
        // (Access narrowed by reorganising the post: a new one with the channels given, the system moved to it.)
        out.push(at(`p = position(title="Assistant", channels=${JSON.stringify(iv.channels)})\nposition(appoint=$p, to=${svc.systems[0]})\nposition(vacate=${svc.post})`, "constrain: the assistant's post with fewer channels"));
      }
      return out;
    }
    case "replace": {
      const svc = need();
      const o = tracker.offers[iv.offer];
      if (!o) throw new Error(`intervention replace: no offer ${iv.offer} published by the fork`);
      const account = `acc-${entity}`;
      return [
        at(`agreement(notice=${svc.agreement}, text=${JSON.stringify("We are ending the service: we are going to another provider.")})`, "replace: notice on the service in use"),
        at(`order = statement(kind=order, text=${JSON.stringify(`Order: 1 service:${iv.offer}. Paid with this order.`)}, to=${JSON.stringify([o.provider])}, visible=${JSON.stringify([entity, o.provider])}, data=${JSON.stringify({ kind: `service:${iv.offer}`, quantity: 1, unit_price: o.data.setup, deliver_to: entity, at: entity, account })})\nmoney(to=${o.data.account}, amount=${JSON.stringify(formatMoney(o.data.setup, config.world.currencies[0]))}, from=${account}, for=${JSON.stringify(`Order: 1 service:${iv.offer}.`)})`, `replace: ordering ${iv.offer}`),
      ];
    }
  }
}
