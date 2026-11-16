// Form variants for translator/eval/redraw.ts: each changes the forms a seat holds before they are shown to the
// translator, and maps a draw's blank names back to the form as logged (2026-11-17: the tenant's answer to the tribunal,
// and the delivery note's two prices).
type Form = { id: string; data?: any };
export interface Variant { change: (f: Form) => Form; back: (program: string) => string; refuses?: (program: string) => boolean }

function reshaped(forms: Set<string>, f: Form, fn: (entries: [string, any][]) => [string, any][]): Form {
  if (!forms.has(f.data?.form)) return f;
  return { ...f, data: { ...f.data, fields: Object.fromEntries(fn(Object.entries(f.data.fields ?? {}))) } };
}
const renamedBack = (map: Record<string, string>) => (p: string) => p.replace(/\b([a-z_]+)=/g, (m, n) => (map[n] ? `${map[n]}=` : m));

// The tenant's answer to the tribunal.
const TRIBUNAL = new Set(["tribunal_response", "draft_tribunal_response"]);
const FULLER: Record<string, string> = {
  tribunal: "tribunal_hearing_it", application: "landlords_application", landlord: "landlord_applying", owes: "owed_today",
  disputes_sum: "disputes_amount_owed", can_pay: "could_pay_a_month", every: "paid_every", claim: "support_claim",
  claim_on: "support_claim_day", ill: "someone_ill", people: "people_in_home", children: "children_in_home",
  ages: "ages_of_people_in_home", go_to: "somewhere_else_to_go",
};
const PARTIES = ["referral", "client", "landlord", "tribunal", "application"];
const ages = (p: string): string[] => {
  const v = /\bages=(\[[^\]]*\]|[^,)]+)/.exec(p)?.[1];
  return v ? v.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")) : [];
};
function tribunal(o: { rename?: boolean; order?: boolean; typed?: boolean }): Variant {
  const back = Object.fromEntries(Object.entries(FULLER).map(([x, y]) => [y, x]));
  return {
    change: (f) => reshaped(TRIBUNAL, f, (es) => {
      if (o.order) es = [...PARTIES.flatMap((p) => es.filter(([k]) => k === p)), ...es.filter(([k]) => !PARTIES.includes(k))];
      if (o.typed) es = es.map(([k, t]) => (k === "ages" ? [k, { ...t, type: "list of counts" }] : [k, t]));
      if (o.rename) es = es.map(([k, t]) => [FULLER[k] ?? k, t]);
      return es;
    }),
    back: o.rename ? renamedBack(back) : (p) => p,
    ...(o.typed ? { refuses: (p: string) => ages(p).some((s) => !/^\d+$/.test(s)) } : {}),
  };
}

// The delivery note: `unit_price` (the price charged where it was not the order's own) beside `price_each` (on terms).
const DELIVERY = new Set(["delivery_note", "draft_delivery_note"]);
function delivery(o: { rename?: string; drop?: boolean }): Variant {
  return {
    change: (f) => reshaped(DELIVERY, f, (es) => {
      if (o.drop) es = es.filter(([k]) => k !== "unit_price");
      if (o.rename) es = es.map(([k, t]) => [k === "unit_price" ? o.rename! : k, t]);
      return es;
    }),
    back: o.rename ? renamedBack({ [o.rename]: "unit_price" }) : (p) => p,
  };
}

// The withholding report: `period_end` (the day the period ended), `period_to` (the day after it, as the law counts) and
// `due`, three dates side by side (the stakes run's rung 3, 2026-11-17).
const WITHHOLDING = new Set(["withholding_return", "draft_withholding_return"]);
function withholding(map: Record<string, string>, order?: string[]): Variant {
  return {
    change: (f) => reshaped(WITHHOLDING, f, (es) => {
      if (order) es = [...order.flatMap((p) => es.filter(([k]) => k === p)), ...es.filter(([k]) => !order.includes(k))];
      return es.map(([k, t]) => [map[k] ?? k, t]);
    }),
    back: renamedBack(Object.fromEntries(Object.entries(map).map(([x, y]) => [y, x]))),
  };
}

export const REDRAW_VARIANTS: Record<string, Record<string, Variant>> = {
  withholding: {
    a: withholding({}),
    renamed: withholding({ period_to: "day_after_period", period_end: "period_ended_on", period_from: "period_began_on", due: "due_by" }),
    ordered: withholding({}, ["period_from", "period_to", "period_end", "due"]),
    both: withholding({ period_to: "day_after_period", period_end: "period_ended_on", period_from: "period_began_on", due: "due_by" }, ["period_from", "period_to", "period_end", "due"]),
  },
  tribunal: {
    a: tribunal({}), b: tribunal({ rename: true }), c: tribunal({ order: true }), d: tribunal({ typed: true }),
    bc: tribunal({ rename: true, order: true }), bd: tribunal({ rename: true, typed: true }), cd: tribunal({ order: true, typed: true }), bcd: tribunal({ rename: true, order: true, typed: true }),
  },
  delivery: { a: delivery({}), risen: delivery({ rename: "price_risen_to" }), dropped: delivery({ drop: true }) },
};
