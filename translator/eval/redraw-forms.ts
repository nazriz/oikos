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

export const REDRAW_VARIANTS: Record<string, Record<string, Variant>> = {
  tribunal: {
    a: tribunal({}), b: tribunal({ rename: true }), c: tribunal({ order: true }), d: tribunal({ typed: true }),
    bc: tribunal({ rename: true, order: true }), bd: tribunal({ rename: true, typed: true }), cd: tribunal({ order: true, typed: true }), bcd: tribunal({ rename: true, order: true, typed: true }),
  },
  delivery: { a: delivery({}), risen: delivery({ rename: "price_risen_to" }), dropped: delivery({ drop: true }) },
};
