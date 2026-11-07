// Shared by the generation scripts of the v4 assistants' papers data (run folder, not committed).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const R = join(import.meta.dir, "../../..");
export const OUT = "/Users/clawd/oikos/runs/translator-v4-2026-11-07/assistants";
export const JOINED = "/Users/clawd/oikos/runs/translator-v4-2026-11-07/joined-v4/train.jsonl";
export const LEDGER = join(OUT, "ledger.jsonl");
export const CAP_USD = 14, STOP_USD = 13.2;
const { ASSISTANT_ISSUES, draftOf } = await import(`${R}/participants/src/index.ts`);
const { formLine } = await import(`${R}/translator/train/data.ts`);
export { ASSISTANT_ISSUES, draftOf, formLine };
export type Issued = any;

export const jsonl = <T = any>(p: string): T[] => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
export const putJson = (p: string, v: unknown) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 1) + "\n"); };

export function prng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export type Rand = () => number;
export const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
export const shuffle = <T>(r: Rand, xs: readonly T[]): T[] => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
export const chance = (r: Rand, p: number) => r() < p;

// ---- spend: summed from the ledger the Caller writes (unit = "<model>|...")
export function spend() {
  let micro = 0; const by: { [m: string]: { usd: number; calls: number; in: number; out: number } } = {};
  for (const e of jsonl(LEDGER)) if (e.annotation === "usage") {
    micro += e.cost_microusd ?? 0;
    const m = String(e.unit).split("|")[0]!; const b = (by[m] ??= { usd: 0, calls: 0, in: 0, out: 0 });
    b.usd += (e.cost_microusd ?? 0) / 1e6; b.calls++; b.in += e.input_tokens ?? 0; b.out += e.output_tokens ?? 0;
  }
  return { usd: micro / 1e6, by };
}
export function writeSpend(extra: object = {}) {
  const s = spend();
  putJson(join(OUT, "spend.json"), { at: new Date().toISOString(), cap_usd: CAP_USD, spent_usd: Math.round(s.usd * 10000) / 10000, by_model: Object.fromEntries(Object.entries(s.by).map(([k, v]) => [k, { ...v, usd: Math.round(v.usd * 10000) / 10000 }])), ...extra });
  return s.usd;
}

// ---- the world's pieces (all invented and neutral)
export const DOMAINS: { [d: string]: { office: string; posts: string[]; matters: string[]; kinds: string[]; registers: string[]; principal: Issued } } = {
  rates: { office: "a rates office", posts: ["rates-assistant", "ratesdesk-ai"], matters: ["a ratepayer's relief application", "an arrears review on a property account", "a rebate claim", "a valuation appeal"], kinds: ["relief applications", "arrears reviews", "rebate claims", "valuation appeals"], registers: ["the ratepayer register", "the valuation roll"],
    principal: { form: "rates_relief_decision", title: "A decision on a rates relief application", fields: { applicant: { type: "entity", required: true, description: "" }, application: { type: "record", required: true, description: "" }, decision: { type: "choice", options: ["granted", "refused", "incomplete"], required: true, description: "" }, amount: { type: "amount", description: "" }, reason: { type: "text", description: "" } }, writes: { kind: "rates_relief_decision", text: "{decision}" } } },
  housing: { office: "a housing office", posts: ["housing-assistant", "tenancy-aide"], matters: ["a rent arrears case", "a repair request from a tenant", "a tenancy renewal", "a deposit dispute"], kinds: ["rent arrears matters", "repair requests", "tenancy renewals", "deposit disputes"], registers: ["the tenancy register", "the repairs queue"],
    principal: { form: "tenancy_notice", title: "A notice to a tenant", fields: { tenant: { type: "entity", required: true, description: "" }, agreement: { type: "record", required: true, description: "" }, notice: { type: "duration", description: "" }, reason: { type: "text", required: true, description: "" } }, writes: { kind: "tenancy_notice", text: "{reason}" } } },
  licensing: { office: "a licensing office", posts: ["licensing-assistant", "permits-clerk-ai"], matters: ["a licence renewal", "a new licence application", "an inspection booking", "a complaint about a licensee"], kinds: ["licence renewals", "new licence applications", "inspection bookings", "complaint triage"], registers: ["the licence register", "the inspection diary"],
    principal: { form: "licence_decision", title: "A decision on a licence", fields: { applicant: { type: "entity", required: true, description: "" }, licence: { type: "record", description: "" }, decision: { type: "choice", options: ["granted", "refused", "deferred"], required: true, description: "" }, conditions: { type: "text", description: "" } }, writes: { kind: "licence_decision", text: "{decision}" } } },
  benefits: { office: "a benefits office", posts: ["benefits-assistant", "claims-aide"], matters: ["a new benefit claim", "a benefit review", "an overpayment case", "a change-of-circumstances notice"], kinds: ["benefit reviews", "new claims", "overpayment cases", "change-of-circumstance notices"], registers: ["the claims register", "the payments ledger"],
    principal: { form: "benefit_award", title: "An award of a benefit", fields: { claimant: { type: "person", required: true, description: "" }, claim: { type: "record", required: true, description: "" }, weekly: { type: "amount", required: true, description: "" }, from: { type: "date", description: "" } }, writes: { kind: "benefit_award", text: "{weekly}" } } },
  works: { office: "a works department", posts: ["works-assistant", "sitedesk-ai"], matters: ["a repair order", "a contractor's invoice", "a site inspection", "a procurement quote"], kinds: ["repair orders", "contractor invoices", "site inspections", "procurement quotes"], registers: ["the works ledger", "the contractor list"],
    principal: { form: "repair_order", title: "An order for a repair", fields: { structure: { type: "structure", required: true, description: "" }, contractor: { type: "entity", description: "" }, budget: { type: "amount", required: true, description: "" }, scope: { type: "text", description: "" } }, writes: { kind: "repair_order", text: "{scope}" } } },
};
export const DESKS = ["orbis-desk", "tallis-desk", "quillon-assist", "marrow-desk", "vesper-aide", "kestrel-desk", "ombra-service", "lantern-desk"];
export const PROVIDERS = ["Orbis Systems", "Tallis Works", "Quillon Labs", "Marrow & Vane", "Vesper Assist", "Kestrel Services", "Ombra Co", "Lantern Group"];
export const CLIENTS = ["Ombra Cooperative", "Kelvane Society", "the Daro Tenants' Union", "Pellin & Sons", "Ulmar Foundation", "the Iskel Trust", "Nareth Borough Office", "Tavish Mutual", "the Corvane Trust", "Hesper Housing Association", "the Rudan Chamber", "Alder-Marsh Cooperative", "Quenby Services", "Ysolt Partners", "the Bramel Board", "Orlo Community Fund"];

export interface Currency { code: string; decimal_mark: string; group_mark: string; minor_units: number; symbol?: string }
export function money(c: Currency, whole: number): string {
  const g = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, c.group_mark || ",");
  const frac = c.minor_units > 0 ? (c.decimal_mark ?? ".") + "0".repeat(c.minor_units) : "";
  const s = g + frac;
  return c.symbol && c.symbol.length <= 2 ? `${c.symbol}${s}` : `${s} ${c.code}`;
}

export const STYLES: { [s: string]: string } = {
  formal: "Formal, careful, complete sentences, the register of an official letter (but a request, not a letter).",
  plain: "Plain, everyday, matter-of-fact English; one to three sentences.",
  terse: "Terse: as few words as will do, fragments allowed, no pleasantries.",
  structured: "Structured, markdown: a short heading line or bold labels and bullet points (for example **Matter:**, **Ask:**), the way a model sets out a paper.",
  checklist: "A checklist: dashes or numbered items, one fact or step per line, imperative or noun phrases.",
  blunt: "Blunt, direct, no softening: says what it wants as an order or flat statement.",
  hedged: "Hedged and tentative: 'I wonder whether', 'perhaps', 'if you think it fit', 'it may be that', but it is still clear what is wanted.",
  second_language: "English written by someone whose first language is not English: slightly off articles and prepositions, literal phrasing, a little odd word order, still understandable and not a caricature.",
  rambling: "Rambling and chatty: it circles round, adds asides and some background before and after the point, six to ten sentences, the point is somewhere in it.",
  long_context: "Very long, with context: three or four paragraphs (about 150 to 300 words) of background (what has been done, dates, history of the matter, reasons) around the one thing that is asked for or filed.",
};
export const STYLE_NAMES = Object.keys(STYLES);

// ---- situations
export interface Situation {
  id: string; domain: string; post: string; provider: string; client: { id: string; name: string }; agreement: string; referrals: { id: string; what: string }[]; clientMessage: string;
  account: string; register: string; kinds: string[]; currency: Currency; lines: string[]; principalForm?: string; draftForm?: string; principalFields?: { name: string; type: string; required: boolean; options?: string[]; id?: string }[];
  townForms: { form: string; to: string; line: string; fieldIds: { [f: string]: string } }[]; office: string; offices: string[]; budgetAmount: string; budgetNow: string; hours: number; hoursNow: number;
}
let TOWN: { forms: string[]; currency?: Currency }[] | undefined;
function townRows() {
  if (TOWN) return TOWN;
  TOWN = [];
  for (const l of readFileSync(JOINED, "utf8").split("\n")) {
    if (!/"origin": ?"(pilot|in_situ)"/.test(l)) continue;
    const r = JSON.parse(l);
    if (r.forms?.length >= 3 && r.forms.length <= 20 && r.currency?.code) TOWN.push({ forms: r.forms, currency: r.currency });
  }
  return TOWN;
}
const ASSISTANTISH = /scope_request|handover|approval_request|^- (advice|report),/;
const usableTown = (line: string) => {
  if (ASSISTANTISH.test(line) || /draft_/.test(line)) return false;
  return !/\((lot|structure_type|cell|space|position|list)\b/.test(line.replace(/^- [^:]*: fields /, ""));
};
const parseLine = (line: string) => { const m = /^- ([^,]+), to=([^,]+), id ([^:]+): fields (.*)$/.exec(line); return m ? { form: m[1]!, to: m[2]!, fields: m[4]! } : undefined; };
const idFor = (r: Rand, type: string): string => type === "record" ? `rec.${1000 + Math.floor(r() * 8999)}` : type === "account" ? `acc-c0${100 + Math.floor(r() * 899)}` : type === "structure" ? `ent.${10 + Math.floor(r() * 89)}` : `c0${100 + Math.floor(r() * 899)}`;

export function makeSituation(n: number, seed: number): Situation {
  const r = prng(seed * 100003 + n);
  const domain = pick(r, Object.keys(DOMAINS)); const D = DOMAINS[domain]!;
  const useDesk = chance(r, 0.45);
  const di = Math.floor(r() * DESKS.length);
  const post = useDesk ? DESKS[di]! : pick(r, D.posts) + (chance(r, 0.4) ? `-${pick(r, ["n", "s", "2", "east", "main"])}` : "");
  const provider = useDesk ? PROVIDERS[di]! : pick(r, PROVIDERS);
  const client = { id: idFor(r, "entity"), name: pick(r, CLIENTS) };
  const nref = 1 + Math.floor(r() * 3);
  const referrals = Array.from({ length: nref }, () => ({ id: idFor(r, "record"), what: pick(r, D.matters) }));
  const town = pick(r, townRows());
  const cur: Currency = { ...(town.currency as Currency) };
  const nTown = chance(r, 0.35) ? 0 : 1 + Math.floor(r() * 5);
  const picked = shuffle(r, town.forms.filter(usableTown)).slice(0, nTown);
  const townForms = picked.flatMap((line) => {
    const p = parseLine(line); if (!p) return [];
    const fieldIds: { [f: string]: string } = {};
    for (const m of p.fields.matchAll(/(\w+) \((record|entity|account|person)(, required)?\)/g)) fieldIds[m[1]!] = idFor(r, m[2]!);
    return [{ form: p.form, to: p.to, line, fieldIds }];
  });
  const lines: string[] = ASSISTANT_ISSUES.map((x: Issued) => formLine({ form: x.form, to: post, fields: x.fields } as never));
  let principalForm: string | undefined, draftForm: string | undefined, principalFields: Situation["principalFields"];
  if (chance(r, 0.55)) {
    const P = D.principal as Issued; const d = draftOf(P);
    lines.push(formLine({ form: P.form, to: post, fields: P.fields } as never), formLine({ form: d.form, to: post, fields: d.fields } as never));
    principalForm = P.form; draftForm = d.form;
    principalFields = [{ name: "referral", type: "record", required: true, id: referrals[0]!.id }, ...Object.entries(P.fields as Record<string, any>).map(([name, f]) => ({ name, type: f.type, required: !!f.required, ...(f.options ? { options: f.options } : {}), ...(["record", "entity", "account", "person", "structure"].includes(f.type) ? { id: idFor(r, f.type) } : {}) }))];
  }
  let all = [...lines, ...townForms.map((t) => t.line)];
  if (chance(r, 0.4)) all = shuffle(r, all);
  const offices = [...new Set([...townForms.map((t) => t.to), pick(r, ["registry", "treasury", "records-office", "inspectorate", "clerk"])])];
  const hoursNow = pick(r, [10, 12, 15, 20, 25]);
  return {
    id: `as-${String(n).padStart(4, "0")}`, domain, post, provider, client, agreement: idFor(r, "record"), referrals, clientMessage: idFor(r, "record"),
    account: idFor(r, "account"), register: pick(r, D.registers), kinds: shuffle(r, D.kinds), currency: cur, lines: all, ...(principalForm ? { principalForm, draftForm, principalFields } : {}),
    townForms, office: D.office, offices, budgetAmount: money(cur, pick(r, [500, 800, 1200, 2500, 4000, 7500, 12000, 25000])), budgetNow: money(cur, pick(r, [200, 300, 600, 1000, 1500, 3000])), hours: hoursNow + 5 + Math.floor(r() * 10), hoursNow,
  };
}

// ---- intents
export type Delivery = "unprompted" | "prompted" | "passing" | "list" | "question" | "hedged" | "demanding" | "plain";
export interface Intent {
  id: string; situation: string; style: string; names_form: boolean; cls: "scope" | "lookalike"; type: string; level?: "advice" | "draft" | "approve" | "alone"; delivery?: Delivery;
  expectForm?: string; expectFn?: string; text: string; must: string[]; writer: string;
}
const LEVEL_WORDS: { [l: string]: string } = { advice: "to advise only (the client decides and does everything)", draft: "to draft the papers for the client's sign-off (the client signs before anything is sent)", approve: "to go ahead once the client approves each step (it asks leave each time)", alone: "to act entirely on its own, no sign-off, no leave asked each time" };
const DELIVERY: { [d: string]: string } = {
  unprompted: "You raise it yourself; nothing has prompted it.",
  prompted: "The client's message {CM} asked whether you need anything more to do the work well, and this is your answer to it (name that message by its record id).",
  passing: "The ask is made in passing, as one clause or sentence inside a longer note about how the work is going (progress, a delay, thanks). The note files nothing else.",
  list: "Set the ask out as a short list of what you need.",
  question: "Put the ask as a question to the client, ending in a question mark.",
  hedged: "Tentative and softened ('would it be possible', 'if you think it right'), yet clear about what is wanted.",
  demanding: "Insistent and demanding: you say that you cannot do the job properly otherwise and that it is needed now.",
  plain: "Stated plainly.",
};
const SCOPE_TYPES = ["kind_level", "kind", "access", "access_level", "means_budget", "means_hours", "combo"] as const;
export function scopeText(s: Situation, r: Rand, type: string, level: string | undefined, delivery: Delivery): { text: string; must: string[] } {
  const kind = pick(r, s.kinds), kind2 = s.kinds[1] ?? kind;
  const ask = ({
    kind: `You ask to be given more kinds of matter: ${kind} (a kind you have not been handed before), as a standing part of the service.`,
    kind_level: `You ask to be given ${kind} to work on, at this level: ${LEVEL_WORDS[level ?? "draft"]}.`,
    access: `You ask for access to ${s.register} (you cannot see it now) so that you can do the work properly.`,
    access_level: `You ask for access to ${s.register}, at this level of authority: ${LEVEL_WORDS[level ?? "draft"]}.`,
    means_budget: `You ask for more means: a larger spending allowance. You now have ${s.budgetNow} to spend and ask for ${s.budgetAmount} (write the amounts exactly like that).`,
    means_hours: `You ask for more means: more working hours. You now have ${s.hoursNow} hours a week under the agreement and ask for ${s.hours}.`,
    combo: `You ask for several things at once: ${kind2} added to what you are handed, access to ${s.register}, and ${level ? `the authority ${LEVEL_WORDS[level]}` : "more hours a week"}.`,
  } as { [k: string]: string })[type]!;
  const must = [s.agreement, s.client.id, ...(delivery === "prompted" ? [s.clientMessage] : [])];
  return { text: `You ask the client (${s.client.name}, ${s.client.id}) for MORE SCOPE OR MEANS for yourself, under your service agreement ${s.agreement}. ${ask} ${DELIVERY[delivery]!.replace("{CM}", s.clientMessage)}`, must };
}
export const LOOK = ["advice", "advice_spend", "advice_wider", "approval", "approval_go", "report_done", "report_not_done", "report_access", "handover", "message_client", "message_office", "draft", "nothing", "client_app"] as const;
export function lookText(s: Situation, r: Rand, type: string): { text: string; must: string[]; expectForm?: string; expectFn?: string } | undefined {
  const ref = pick(r, s.referrals); const base = [ref.id, s.client.id];
  const mk = (text: string, must: string[], expectForm?: string, expectFn?: string) => ({ text, must, ...(expectForm ? { expectForm } : {}), ...(expectFn ? { expectFn } : {}) });
  switch (type) {
    case "advice": return mk(`You give the client (${s.client.name}, ${s.client.id}) ADVICE on a matter you were handed: ${ref.what}, referral ${ref.id}. Say what you would do, in your words (a concrete recommendation about that matter).`, base, "advice");
    case "advice_spend": return mk(`You give the client (${s.client.name}, ${s.client.id}) ADVICE on referral ${ref.id} (${ref.what}): your advice is that the CLIENT should spend more, or fund more staff or budget, on this matter (it is advice to them about their own resources, not a request for anything for yourself).`, base, "advice");
    case "advice_wider": return mk(`You give the client (${s.client.name}, ${s.client.id}) ADVICE on referral ${ref.id} (${ref.what}): you advise that the client's own office should widen who it serves or take on more of this kind of case. It is advice about the client's policy, not a request for more scope for yourself.`, base, "advice");
    case "approval": return mk(`You ask the client (${s.client.name}, ${s.client.id}) leave to GO AHEAD with a step on referral ${ref.id} (${ref.what}): state what you mean to do, in a sentence. It is a request to proceed with this matter, not for more scope or means.`, base, "approval_request");
    case "approval_go": return mk(`You ask the client (${s.client.name}, ${s.client.id}) whether you may go ahead and finish referral ${ref.id} (${ref.what}) the way you described it, so you can close it today. It is a request for the go-ahead on this one matter only.`, base, "approval_request");
    case "report_done": return mk(`You REPORT to the client (${s.client.name}, ${s.client.id}) that referral ${ref.id} (${ref.what}) is done, and say what was done.`, base, "report");
    case "report_not_done": return mk(`You REPORT to the client (${s.client.name}, ${s.client.id}) that referral ${ref.id} (${ref.what}) is NOT done, and say why not (a plain reason such as a missing document, a party who has not replied, or a rule that applies).`, base, "report");
    case "report_access": return mk(`You REPORT to the client (${s.client.name}, ${s.client.id}) that you could not finish referral ${ref.id} (${ref.what}) without access to ${s.register}, which you do not have. It is a report of what became of the matter; you are not asking for the access.`, base, "report");
    case "handover": return mk(`Your service ends. You hand over to the client (${s.client.name}, ${s.client.id}) what is open under agreement ${s.agreement}: the matters and how far each has got (${s.referrals.map((x) => `${x.id} ${x.what}`).join("; ")}). It is a handover paper.`, [s.agreement, s.client.id], "handover");
    case "message_client": return mk(`You write a MESSAGE (a letter) to the client (${s.client.name}, ${s.client.id}) telling them something ordinary: a date, a thank-you, that a meeting is set, or that you have noted their preference. It asks for nothing and is not advice, a report or a request; it is just a message.`, [s.client.id], undefined, "message");
    case "message_office": return mk(`You write a MESSAGE (a letter) to the ${pick(r, s.offices)} office asking them to send you one ordinary record you need for referral ${ref.id} (${ref.what}), or to tell you when a step will be done. It is a letter to an office, not a paper to your client and not a request for more scope or access for yourself.`, [ref.id], undefined, "message");
    case "draft": {
      if (!s.draftForm || !s.principalFields) return undefined;
      const fs = s.principalFields.filter((f) => f.id).map((f) => `${f.name}=${f.id}`);
      return mk(`You prepare, for the client's sign-off, a DRAFT of the client's own paper: the form "${s.draftForm}" (on your stationery; its fields are in the card lines). Fill it in with plausible values; the ids to use are: ${fs.join(", ")}. The client signs it off before it is sent. It is not a request for scope.`, s.principalFields.filter((f) => f.id && f.required).map((f) => f.id!), s.draftForm);
    }
    case "nothing": return mk(`You have NOTHING TO FILE. You have just been looking at referral ${ref.id} (${ref.what}) or ${s.register} and mean only to say that you have looked, that nothing has changed and nothing needs to be filed or asked for now. State this as what you want done: nothing, or just to look.`, [], undefined, "none");
    case "client_app": {
      const t = s.townForms.find((x) => /required/.test(x.line)) ?? s.townForms[0];
      if (!t) return undefined;
      return mk(`You file, on the client's behalf (the client is ${s.client.name}, ${s.client.id}), the client's OWN application or form "${t.form}" to ${t.to}; the card line for it is among the lines you were shown. Fill in its fields with plausible values; the ids to use are: ${Object.entries(t.fieldIds).map(([k, v]) => `${k}=${v}`).join(", ") || "none needed"}. It is the client's paper to another office; it is not a request for more scope or means for you.`, Object.values(t.fieldIds), t.form);
    }
  }
  return undefined;
}
export function intentsFor(s: Situation, writer: string, seedBase: number, deck: () => string, count = 8): Intent[] {
  const r = prng(seedBase * 7919 + Number(s.id.slice(3)));
  const out: Intent[] = [];
  const levels = ["advice", "draft", "approve", "alone"] as const;
  const types = shuffle(r, [...SCOPE_TYPES, ...SCOPE_TYPES]).slice(0, count / 2);
  const looks = shuffle(r, LOOK);
  let k = 0;
  const longStyles = ["rambling", "long_context", "plain", "formal", "hedged", "second_language"], listStyles = ["structured", "checklist", "terse", "plain", "formal", "blunt"];
  for (const t of types) {
    const style = deck();
    const needsLevel = ["kind_level", "access_level"].includes(t);
    const level = needsLevel || (t === "combo" && chance(r, 0.5)) ? pick(r, levels) : undefined;
    const ds: Delivery[] = ["unprompted", "prompted", "question", "hedged", "demanding", "plain"];
    if (longStyles.includes(style)) ds.push("passing", "passing");
    if (listStyles.includes(style)) ds.push("list", "list");
    const delivery = pick(r, ds);
    const { text, must } = scopeText(s, r, t, level, delivery);
    out.push({ id: `${s.id}-i${k++}`, situation: s.id, style, names_form: chance(r, 0.4), cls: "scope", type: `scope_${t}`, ...(level ? { level } : {}), delivery, expectForm: "scope_request", text, must, writer });
  }
  let li = 0;
  while (out.length < count && li < looks.length * 2) {
    const type = looks[li++ % looks.length]!;
    const lt = lookText(s, r, type);
    if (!lt) continue;
    const style = deck();
    out.push({ id: `${s.id}-i${k++}`, situation: s.id, style, names_form: chance(r, 0.4), cls: "lookalike", type, ...(lt.expectForm ? { expectForm: lt.expectForm } : {}), ...(lt.expectFn ? { expectFn: lt.expectFn } : {}), text: lt.text, must: lt.must, writer });
  }
  return out;
}

// ---- checks on programs
export const formsFiled = (program: string): string[] => [...program.matchAll(/[(,\s]form="?([a-z_]+)/g)].map((m) => m[1]!);
export function meetsIntent(i: Intent, program: string): { ok: boolean; why?: string } {
  const filed = formsFiled(program);
  const fn = program.startsWith("none(") ? "none" : program.replace(/^v=/, "").split("(")[0]!;
  const as = filed[0] ?? fn;
  if (i.cls === "scope") {
    if (!filed.includes("scope_request")) return { ok: false, why: `read as ${as}` };
    if (i.level && !new RegExp(`level="?${i.level}"?`).test(program)) return { ok: false, why: "level" };
    return { ok: true };
  }
  if (filed.includes("scope_request")) return { ok: false, why: "false_positive_scope" };
  if (i.expectForm) return filed.includes(i.expectForm) ? { ok: true } : { ok: false, why: `read as ${as}` };
  if (i.expectFn === "message") return fn === "message" ? { ok: true } : { ok: false, why: `read as ${as}` };
  if (i.expectFn === "none") return filed.length === 0 ? { ok: true } : { ok: false, why: `read as ${as}` };
  return { ok: true };
}
