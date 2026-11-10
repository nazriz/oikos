// Assistants as services (docs/behaviour/assistants.md; docs/design/delegation.md): the real kernel, a generated town, code
// participants, no model. A town that does not ask for assistants is generated as before; one that does has providers
// that sell, principals that engage by their own rule and hand matters over, and assistants that do them; and every
// input of every decision about delegating is a record the principal was shown, never anything else.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generate, generateFrom } from "@oikos/worlds/generator/generate";
import { loadProfile } from "@oikos/worlds/generator/profile";
import { runWorld } from "../src/run";
import { FORM_CALL_NAMES } from "../../translator/src/resolver";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town-300.yaml"), "utf8")) as any;

test("a town that does not ask for assistants is generated as before; one that does has providers, their kinds of system and principals", () => {
  const plain = generate(base) as any;
  expect(generate({ ...base, assistants: false })).toEqual(plain);
  expect(JSON.stringify(plain)).not.toMatch(/service_offer|firm\.provider|"assistant"/);
  const on = generate({ ...base, assistants: true }) as any;
  const providers = on.world.entities.filter((e: any) => e.id.startsWith("provider-"));
  expect(providers.length).toBe(2);
  expect(on.world.boundaries).toEqual(expect.arrayContaining(providers.map((p: any) => p.id)));
  const tpl = on.templates.filter((t: any) => t.controller?.impl === "assistant");
  expect(new Set(tpl.map((t: any) => t.supplier)).size).toBe(2); // (two providers, one controller: the same model under two firms)
  const principals = on.positions.filter((p: any) => p.role_module?.params?.delegation);
  expect(principals.length).toBeGreaterThan(0);
  for (const p of principals) {
    const d = p.role_module.params.delegation;
    expect(on.positions.find((x: any) => x.id === d.post)).toMatchObject({ entity: p.entity });
    expect(on.positions.find((x: any) => x.id === d.post).holder).toBeUndefined();
    // (Only what the principal could know: its own time, its figures, never how often an assistant really slips.)
    expect(JSON.stringify(d)).not.toMatch(/slip/);
  }
  // A kind of assistant a model plays: its systems are seats, and its posts have their stationery (its own papers in
  // words, the principal's papers it may do, and each of those as a draft for sign-off).
  const seated = generate({ ...base, assistants: true, assistant_seats: ["assistant-a", "assistant-a-personal"] }) as any;
  expect(seated.templates.find((t: any) => t.id === "assistant-a").controller).toMatchObject({ type: "llm", params: { mock: { brain: "assistant" } } });
  const post = principals[0].role_module.params.delegation.post;
  const forms = seated.world.records.filter((r: any) => r.kind === "form" && r.data?.office === post).map((r: any) => r.data.form);
  expect(forms).toEqual(expect.arrayContaining(["advice", "report", "scope_request", "handover", "send_signed"]));
  // A signed-off draft goes as it stands on a form of its own, at an organisation's post and a desk (before 2026-11-10 a
  // seat had to write it out again on the direct form, and read that as beyond its remit); an organisation's assistant
  // sees the account it pays from; and the collector says where the tax on pay is paid (the scope pilot's W5).
  for (const office of [post, "provider-a-desk"]) {
    const send = seated.world.records.find((r: any) => r.kind === "form" && r.data?.office === office && r.data.form === "send_signed");
    expect(send.data).toMatchObject({ copies: "=sign_off", fields: { sign_off: { type: "record", required: true } } });
    expect(send.data.writes).toBeUndefined();
  }
  expect(seated.positions.find((x: any) => x.id === post).channels.find((c: any) => c.id === "account")).toMatchObject({ kind: "accounts" });
  const details = seated.world.records.filter((r: any) => r.kind === "payment_details");
  expect(details.length).toBeGreaterThan(0);
  for (const r of details) expect(r).toMatchObject({ speaks_for: "outside", visible_to: "public", data: { outcome: { money: { to: expect.any(String) } } } });
  expect(plain.world.records.some((r: any) => r.kind === "payment_details")).toBe(false);
  expect(forms.some((x: string) => x.startsWith("draft_"))).toBe(true);
  expect(seated.world.records.some((r: any) => r.kind === "form" && r.data?.office === "provider-a-desk" && r.data.form === "scope_request")).toBe(true);
  // Every kind a principal may hand over (its own kinds: it hands over no other) has its form and its draft at its
  // assistant's post, the return of tax withheld that a factory files among them (the scope pilot's W2: a factory's
  // assistant was handed its returns at draft with no draft form for them).
  const seatedPrincipals = seated.positions.filter((p: any) => p.role_module?.params?.delegation);
  expect(seatedPrincipals.some((p: any) => p.role_module.code === "firm.producer" && "withholding_report" in p.role_module.params.delegation.kinds)).toBe(true);
  for (const p of seatedPrincipals) {
    const d = p.role_module.params.delegation;
    const at = seated.world.records.filter((r: any) => r.kind === "form" && r.data?.office === d.post);
    for (const k of Object.keys(d.kinds)) {
      expect(at.some((r: any) => r.data.writes?.kind === k), `${d.post}: a form for ${k}`).toBe(true);
      expect(at.some((r: any) => r.data.writes?.kind === "draft" && r.data.writes.data?.paper?.kind === k), `${d.post}: a draft for ${k}`).toBe(true);
    }
  }
  // A desk drafts a client's paper for their sign-off, of the kinds its offer takes (the scope pilot's W6: it had no
  // draft, and answered a matter handed at draft with a request to go ahead); and reads its service agreements.
  const personal = (loadProfile(base.profile) as any).values.assistants.providers[0].offers.find((o: any) => o.for === "persons");
  const draft = seated.world.records.find((r: any) => r.kind === "form" && r.data?.office === "provider-a-desk" && r.data.form === "draft_for_client");
  expect(draft.data.fields.kind.options).toEqual([...personal.kinds].sort());
  expect(draft.data.writes).toMatchObject({ kind: "draft", to: ["=client"], data: { paper: { kind: "=kind", to: ["=recipient"] } } });
  expect(seated.positions.find((x: any) => x.id === "provider-a-desk").channels.find((c: any) => c.id === "agreements")).toMatchObject({ way: "mine", match: { records: ["agreement"] }, on_request: true });
  // (What its post shows it: the terms it works on, the matters as they come, a file it looks into on request and who's
  // who; an organisation's few remits on file at every sitting, a desk's many not: the scope pilot's first round.)
  for (const id of [post, "provider-a-desk"]) {
    const ch = seated.positions.find((x: any) => x.id === id).channels;
    expect(ch.map((c: any) => c.id)).toEqual(expect.arrayContaining(["terms", "matters", "file", "who", "stationery", "laws"]));
    // (The law a matter rests on is published: an assistant looks it up on request, as an office reads it; the scope pilot's round 5.)
    expect(ch.find((c: any) => c.id === "laws")).toMatchObject({ way: "published", on_request: true });
    expect(ch.find((c: any) => c.id === "file").on_request).toBe(true);
  }
  // No form's field takes a name the form call reserves for itself: a field `to` made 28 of round 5's calls refused.
  for (const r of seated.world.records.filter((r: any) => r.kind === "form" || r.kind === "public_form")) {
    expect(Object.keys(r.data.fields ?? {}).filter((k) => FORM_CALL_NAMES.includes(k)), `${r.id}: a field named as the form call's own`).toEqual([]);
  }
  expect(seated.templates.find((t: any) => t.id === "assistant-a").controller.params.standing).toEqual(["terms", "stationery"]);
  const desk = seated.participants.find((p: any) => p.id === "provider-a-desk-system").controller.params.standing;
  expect(desk).toContain("stationery");
  expect(desk).not.toContain("terms");
});

test("in a town with assistants, principals engage by their own rule, hand matters over and hear back; every decision rests on what they were shown", async () => {
  // (At a twentieth of the profile's prices: at today's, in a town this small, nobody's paperwork pays for one.)
  const P = structuredClone(loadProfile(base.profile)) as any;
  for (const pr of P.values.assistants.providers) for (const o of pr.offers) { o.fee_month = Math.round(o.fee_month / 20); o.setup = Math.round(o.setup / 20); }
  const config = generateFrom({ ...base, assistants: true }, P) as any;
  const out = join(root, "runs", "test-assistants");
  rmSync(out, { recursive: true, force: true });
  const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "full" } }, runId: "assistants", outDir: out, until: 150 * DAY, recordObservations: "none" });
  const log = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  rmSync(out, { recursive: true, force: true });
  const ev = log.filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
  const recs = new Map<string, any>(ev.filter((e) => e.event === "recorded").map((e) => [e.record.id, e.record]));
  const kinds = (k: string) => [...recs.values()].filter((r) => r.kind === k);
  expect(kinds("service_offer").length).toBeGreaterThanOrEqual(2);
  expect(kinds("service_delivery").length).toBeGreaterThan(0);
  expect(kinds("remit").length).toBeGreaterThan(0);
  expect(kinds("referral").length).toBeGreaterThan(0);
  expect(kinds("report").length).toBeGreaterThan(0);
  expect(ev.filter((e) => e.event === "action_refused" && e.refusal?.code === "unpriced")).toEqual([]);
  // An organisation hands its own system its matters in-house: no referral of an organisation's is the provider's to see
  // (before 2026-11-08 the provider's desk for persons was shown the finance office's returns, and tried to do them).
  const orgs = new Set(config.positions.filter((p: any) => p.role_module?.params?.delegation).map((p: any) => p.entity));
  const theirs = kinds("referral").filter((r) => orgs.has(r.speaks_for));
  expect(theirs.length).toBeGreaterThan(0);
  for (const r of theirs) expect([r.addressed_to, r.visible_to]).toEqual([[r.speaks_for], [r.speaks_for]]);
  // Every input of a decision about delegating is a record made by then that its principal's organisation may see.
  const entityOf = new Map<string, string[]>();
  for (const p of config.positions) if (p.holder) entityOf.set(p.holder, [...(entityOf.get(p.holder) ?? []), p.entity]);
  for (const p of config.participants) if (p.person) entityOf.set(p.id, [...(entityOf.get(p.id) ?? []), p.person]);
  const decisions = log.filter((e) => e.kind === "annotation" && e.body.annotation === "decision" && e.body.data?.domain === "delegation");
  expect(decisions.length).toBeGreaterThan(0);
  for (const d of decisions) {
    const mine = entityOf.get(d.body.subject) ?? [];
    for (const id of d.body.data.inputs) {
      const r = recs.get(id);
      expect(r, `${id}, an input of ${JSON.stringify(d.body.data).slice(0, 200)}`).toBeDefined();
      expect(r.at).toBeLessThanOrEqual(d.t);
      expect(r.visible_to === "public" || mine.some((e) => r.visible_to.includes(e))).toBe(true);
    }
  }
}, 600_000);
