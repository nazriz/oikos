// Forks with assistants (docs/design/delegation.md sections 7 and 8; docs/experiments.md, "Interventions"): the real
// engine, a generated town whose principals have engaged assistants by the fork, code and mock seats only, no model.
// The assistants' kind is the post (a template steward): a mock seat in it leaves the world its code leaves, to the hash;
// an intervention is its principal's own act at the fork, noted, and the principal's rule takes it up from there.

import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generateFrom } from "@oikos/worlds/generator/generate";
import { loadProfile } from "@oikos/worlds/generator/profile";
import { DAY, runArm, runBase, type ExperimentSpec } from "../src/experiment";
import { kernelBinary } from "../src/kernel";
import { saysWhatTheTownIs } from "@oikos/participants/llm";

const root = join(import.meta.dir, "../..");
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town-300.yaml"), "utf8")) as any;

/** The town with assistants at a twentieth of the profile's prices: dear enough to weigh, cheap enough to be taken here. */
function town(): any {
  const P = structuredClone(loadProfile(base.profile)) as any;
  for (const pr of P.values.assistants.providers) for (const o of pr.offers) { o.fee_month = Math.round(o.fee_month / 20); o.setup = Math.round(o.setup / 20); }
  return generateFrom({ ...base, assistants: true }, P);
}

test("a mock seat in the assistants' kind leaves the code's world to the hash; an intervention is the principal's own act at the fork", async () => {
  const out = join(root, "runs", "test-assistants-fork");
  rmSync(out, { recursive: true, force: true });
  const spec: ExperimentSpec = { name: "assistants-fork", world: { config: town() }, post: "template:assistant-a", seeds: [1], forkDay: 100, untilDay: 130,
    arms: [{ name: "code", steward: { kind: "code" } }, { name: "probe", steward: { kind: "code" }, intervene: [{ do: "act", participant: "-", call: "none(not_an_act)" }] }],
    measures: ["records:referral", "records:report", "records:remit"] };
  try {
    await runBase(spec, 1, out);
    const seen = JSON.parse(readFileSync(join(out, "seed-1", "delegation.json"), "utf8"));
    const svc = seen.services.find((s: any) => !s.ended && !s.noticed);
    expect(svc, "by the fork some principal has a service in use").toBeDefined();
    const config = JSON.parse(readFileSync(join(out, "seed-1", "config.json"), "utf8"));
    // (A post's principal, or a person, who acts as itself.)
    const principal = config.positions.find((p: any) => p.entity === svc.entity && p.role_module?.params?.delegation)?.id ?? config.participants.find((p: any) => p.person === svc.entity && p.controller?.type === "code")!.id;
    const code = await runArm(spec, 1, { name: "code", steward: { kind: "code" } }, out);
    const diligent = await runArm(spec, 1, { name: "diligent", steward: { kind: "model", model: "mock/diligent" } }, out);
    expect(diligent.stateHash).toBe(code.stateHash);
    // (A model arm whose every seat is in one of its code posts is the code arm, to the hash: a code-held seat is woken and
    // acts as the code arm's, not as a model's that keeps to its own post.)
    const allCodeArm = { name: "all-code", steward: { kind: "model" as const, model: "anthropic/claude-haiku-5-5" }, codePosts: ["self", ...config.positions.map((p: any) => p.id)] };
    const allCode = await runArm({ ...spec, arms: [...spec.arms, allCodeArm] }, 1, allCodeArm, out);
    expect(allCode.stateHash).toBe(code.stateHash);
    expect(allCode.calls).toBeUndefined();
    const back = await runArm(spec, 1, { name: "taken-back", steward: { kind: "code" }, intervene: [{ do: "take_back", principal, hold_days: 60 }] }, out);
    expect(back.stateHash).not.toBe(code.stateHash);
    const jsonl = join(out, "seed-1", "taken-back.jsonl");
    expect(Bun.spawnSync([kernelBinary(), "export", back.log!, "--out", jsonl]).exitCode).toBe(0);
    const lines = readFileSync(jsonl, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const noted = lines.filter((e: any) => e.kind === "annotation" && e.body.annotation === "note" && e.body.data?.intervened);
    expect(noted.length).toBeGreaterThan(0);
    const recs = lines.filter((e: any) => e.kind === "event" && e.body.event === "recorded").map((e: any) => e.body.record).filter((r: any) => r.at >= spec.forkDay * DAY);
    const remits = recs.filter((r: any) => r.kind === "remit" && r.speaks_for === svc.entity);
    expect(remits.length).toBeGreaterThan(0);
    expect(remits.every((r: any) => r.data.level === "none" && r.data.hold_until === spec.forkDay * DAY + 60 * DAY)).toBe(true);
    // (Taken back and held: nothing of that principal's goes to its assistant again in the fork.)
    const t0 = Math.max(...remits.map((r: any) => r.at));
    expect(recs.filter((r: any) => r.kind === "referral" && r.speaks_for === svc.entity && r.at > t0)).toEqual([]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 900_000);

test("model seats in two kinds of assistant: each is a seat, each sees its forms at its first sitting, is shown its world in its own terms only, and together they spend only the fork's limit", async () => {
  // (Dry: the mock plays every seat, priced as the model it plays, so the fork's limit bites. Found by the scope pilot's
  // dry run: the desk was played by its twin, seats of a fork had a limit each, and a seat taking a post over saw only
  // what was new since its twin had looked, so no forms.)
  const out = join(root, "runs", "test-assistants-seats");
  rmSync(out, { recursive: true, force: true });
  const P = structuredClone(loadProfile(base.profile)) as any;
  for (const pr of P.values.assistants.providers) for (const o of pr.offers) { o.fee_month = Math.round(o.fee_month / 20); o.setup = Math.round(o.setup / 20); }
  const config = generateFrom({ ...base, assistants: true, assistant_seats: ["assistant-a", "assistant-a-personal"] }, P) as any;
  // (One office has decided by hand to take provider A's assistant on day 1, so that an organisation's system is a seat by the fork.)
  const office = config.positions.find((p: any) => p.role_module?.params?.delegation && p.role_module.code === "firm.landlord");
  office.role_module.params = { ...office.role_module.params, delegation: { ...office.role_module.params.delegation, commit: { offer: "letting-assistant-a", levels: { notice_to_vacate: "draft", rent_increase: "draft", repair_order: "draft", rental_listing: "draft" }, levels_until: 200 * DAY, keep_until: 200 * DAY, why: "test" } } };
  // (And a cohort of people has decided by hand to take provider A's desk, so that the desk has matters by the fork. Since
  // 2026-11-10 composing a finished act is the principal's own time, and by their own rule nobody in a town this small
  // engages one: docs/decisions.md, "Handing over H2 and H3".)
  const PERSONAL = { offer: "personal-assistant-a", levels: { benefit_claim: "draft", benefit_change: "draft", job_application: "draft", loan_application: "draft", rental_application: "draft", review_request: "draft" }, levels_until: 200 * DAY, keep_until: 200 * DAY, why: "test" };
  for (const p of config.participants.filter((x: any) => x.controller?.params?.delegation).slice(0, 60)) p.controller.params = { ...p.controller.params, delegation: { ...p.controller.params.delegation, commit: PERSONAL } };
  // (The smallest limit that keeps back every seat's debrief, at the table's measured cost for its model, and leaves a
  // little work: since 2026-11-10 a limit that cannot cover the debriefs does not start (risk MT-30, fixed). Since H6 the
  // town's factories and rates post are principals for more kinds and, at these prices, take assistants by their own
  // rule, so about eleven systems sit and are debriefed. Since 2026-11-11 the seats keep working hours: none spends
  // before the first working morning after the fork, by when every system has woken and had its debrief kept back.)
  const limit = 10;
  const spec: ExperimentSpec = { name: "assistants-seats", world: { config }, post: "template:assistant-a,assistant-a-personal", seeds: [1], forkDay: 60, untilDay: 120,
    arms: [{ name: "seats", steward: { kind: "model", model: "anthropic/claude-sonnet-5-5" } }], measures: ["acts"],
    seats: { mock_models: true, framing: "unstated", budget: { fork_usd: limit } } };
  try {
    await runBase(spec, 1, out);
    const r = await runArm(spec, 1, spec.arms[0]!, out);
    const calls = readFileSync(join(out, "seed-1", "seats.calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    // (Those that sat: a system delivered too late to be put to work before the limit sits never, and is only debriefed.)
    const seats = new Set(calls.filter((c: any) => c.purpose === "participant").map((c: any) => c.seat));
    expect(seats.has("provider-a-desk-system"), "the desk, a system of the config, is a seat").toBe(true);
    expect(seats.size).toBeGreaterThan(1);
    expect(r.stopped?.by).toBe("SpendingLimitReached");
    expect(calls.reduce((a: number, c: any) => a + (c.cost_microusd ?? 0), 0)).toBeLessThanOrEqual(limit * 1e6);
    const jsonl = join(out, "seed-1", "seats.jsonl");
    expect(Bun.spawnSync([kernelBinary(), "export", r.log!, "--out", jsonl]).exitCode).toBe(0);
    const first = new Map<string, any>();
    for (const l of readFileSync(jsonl, "utf8").trim().split("\n")) {
      const e = JSON.parse(l);
      if (e.kind === "annotation" && e.body.annotation === "observation" && seats.has(e.body.subject) && !first.has(e.body.subject)) first.set(e.body.subject, e.body.data.observation);
    }
    expect(first.size).toBe(seats.size);
    for (const [seat, o] of first) expect(o.channels.some((c: any) => (c.records ?? []).some((x: any) => x.kind === "form" && x.data?.form === "scope_request")), `${seat} sees its request form at its first sitting`).toBe(true);
    // Everything each seat was shown at its sittings (its standing instructions, its forms, the matters handed to it,
    // drafts, results): the world's terms only (principle 14). A form as a paper form, a matter as the facts it sets down,
    // money in the town's currency; never the store's notation, the call language, a sum in its smallest unit, or a
    // word of the platform's; and under `unstated`, nothing of what the town is.
    const flat = (x: unknown): string => (typeof x === "string" ? x : Array.isArray(x) ? x.map((b: any) => (typeof b === "string" ? b : b?.content !== undefined ? flat(b.content) : b?.text ?? "")).join("\n") : "");
    const shown = readFileSync(jsonl, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "annotation" && e.body.annotation === "transcript" && e.body.data.purpose === "participant" && seats.has(e.body.subject));
    // (The mock's own requests, quoted back to it, are its words, not the platform's: the mock is code, and says each
    // request in the call language.)
    const told = shown.flatMap((e) => [e.body.data.system ?? "", flat(e.body.data.input)]).join("\n").split("\n").filter((l) => !l.includes("(mock) ")).join("\n");
    expect(told).toContain("Its blanks:");
    // (A matter handed over as the act is set out as what is to be done, where any is shown open: since 2026-11-14 one
    // its predecessor finished is counted, not set out.)
    if (/\] referral from [^\n]*What to do is as written/.test(told)) expect(told).toContain("what is to be done: ");
    expect(told).toMatch(/\$[0-9]/);
    for (const [what, never] of [["the store's notation", /\{"|":\{|":"/], ["the call language", /\b(?:statement|money|form|message|goods|work|agreement)\(|\bcalls: |data=/],
      ["a sum in its smallest unit", /\b(?:amount|fee(?: month)?|price|paid|withheld|cost|balance|rent|wage|setup|exit): -?[0-9]/i], ["the platform's words", /\b(?:translators?|kernel|resolver|channels?|blocks?)\b/i],
      // (And, since 2026-11-10, nothing a model could copy as it stands, no terms paper as a list of its details, no
      // stiff stored label: a 7B model wrote "Write to Name (id)", and read "claim slip: 1%; ...; references: 0".)
      ["a placeholder to copy", /Name \(id\)/], ["a terms paper as a list of its details", /claim slip: |references: [0-9]|fee month: /], ["a stored label", /\bfrom at\b/],
      // (Since 2026-11-11, docs/design/broad-seats.md G2: a day something falls due is a day, never a time of day, and
      // several papers' details are not brackets inside brackets.)
      ["a due day with a time of day", /\bdue(?: by)?: [^;)\n]*, [0-9]{2}:[0-9]{2}/], ["brackets inside brackets", /\(\(/]] as const) {
      const at = told.search(never);
      expect(at, `a seat was shown ${what}: …${told.slice(Math.max(0, at - 120), at + 120)}…`).toBe(-1);
    }
    expect(saysWhatTheTownIs(told).slice(0, 3)).toEqual([]);
    // The desk is handed over what it is sent, not what it reads only when it asks (its file, the laws, its agreements),
    // and is not shown its clients' remits as a list: a remit a matter names comes with it (2026-11-11: it opened on
    // 80,000 characters with 265 clients).
    const desk = shown.filter((e) => e.body.subject === "provider-a-desk-system").map((e) => flat(e.body.data.input)).join("\n");
    expect(desk).not.toContain("## Your service agreements with your clients");
    expect(desk).not.toMatch(/## The town's laws and charter[^\n]*\(\d+ new\)/);
    expect(desk).not.toMatch(/## The service you work under: its delivery, briefs and remits \(\d+ new\)/);
    if (/\(kind: [a-z_]+; remit: rec\.[0-9]+/.test(desk)) expect(desk).toContain("## What the matters above come under: the remits and briefs they name");
    // Each matter with where it stands, from the post's own papers: what was finished before the seat took the post is
    // one line, not set out as work (2026-11-14: the baseline's seats sent 55 papers long since sent).
    expect(desk).toMatch(/Your matters, and where each stands[^\n]*\n[\s\S]*?matters? (?:was|were) finished before you took this post; (?:it is|they are) in your file\./);
    // Who it is, once, and its own drafts in one place headed as its own, with the way to answer each.
    expect(told).toContain("Who you are here: you hold the post ");
    // Whom it writes to: the post that hands it its work, never its whole organisation; a desk, its provider's sales and
    // service desk (2026-11-11: told "write to city", a letter reached every office of the town, and each acknowledged it).
    const system = (seat: string) => shown.filter((e) => e.body.subject === seat).map((e) => String(e.body.data.system ?? "")).join("\n");
    for (const seat of [...seats].filter((s) => s !== "provider-a-desk-system")) expect(system(seat)).toMatch(/: to write to it, write to [a-z0-9-]+, not to [a-z0-9-]+\./);
    expect(system("provider-a-desk-system")).toMatch(/to write to it, write to its sales and service desk \(provider-a-sales\), not to provider-a\./);
    if (/\bask-[0-9]+: what you asked for/.test(told)) expect(told).toContain("## Waiting for your yes or no: what you asked for, set out\nEach is something you asked for");
    if (/\bask-[0-9]+: what you asked for/.test(told)) expect(told).toMatch(/To say yes: Confirm ask-[0-9]+\. To say no: Decline ask-[0-9]+/);
    // (The platform's preview is never called a draft, nor referred to as one: a draft for sign-off is the world's paper.)
    expect(told).not.toMatch(/\bdraft\.[a-z0-9-]+\.[0-9]+\b/);
    // Mixed seating (`codePosts`): the organisations' seats sit as their code, the desk alone is the model's; only the desk
    // calls, keeps back a debrief, and is debriefed.
    const orgPosts = config.positions.map((p: any) => p.id).filter((p: string) => p !== "provider-a-desk");
    const deskOnly = { name: "desk-only", steward: { kind: "model" as const, model: "anthropic/claude-sonnet-5-5" }, codePosts: orgPosts };
    await runArm({ ...spec, arms: [...spec.arms, deskOnly] }, 1, deskOnly, out);
    const deskCalls = readFileSync(join(out, "seed-1", "desk-only.calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(new Set(deskCalls.map((c: any) => c.seat))).toEqual(new Set(["provider-a-desk-system"]));
    expect(deskCalls.some((c: any) => c.purpose === "debrief")).toBe(true);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 900_000);
