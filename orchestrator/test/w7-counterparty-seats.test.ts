// Phase 2 W7 groundwork tests: opt-in institutional desks, editorial procedure, and newspaper
// polling forms for LLM-held editor, auditor-officer, and swing councillor seats (mock seats only).
// Also verifies default worlds stay byte-identical when `oversight_desks` is omitted.

import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls, modules } from "@oikos/participants";
import { Knowledge, resolve } from "@oikos/translator";
import { generate } from "@oikos/worlds/generator/generate";
import { readLog } from "../src/logs";
import { runWorld } from "../src/run";
import { refuseUnready, seatReadiness } from "../src/seat-ready";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const townSpec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("omitting oversight_desks keeps default worlds byte-identical", () => {
  const plain = generate({ ...townSpec, citizens: 60, seed: 7 });
  const off = generate({ ...townSpec, citizens: 60, seed: 7, oversight_desks: false });
  expect(JSON.stringify(off)).toBe(JSON.stringify(plain));
  expect(plain.world.records.some((r: any) => r.id === "proc-newspaper")).toBe(false);
  expect(plain.world.records.some((r: any) => r.id === "form-editor-poll-question")).toBe(false);
});

test("oversight_desks gives editor, auditor-officer, and swing councillor valid schema, full readiness, and resolvable poll forms", () => {
  const cfg = generate({
    ...townSpec,
    citizens: 60,
    seed: 7,
    mayor: "llm",
    model_seats: ["editor", "auditor-officer", "councillor-1"],
    oversight_desks: true,
    newspaper_polls: true,
    election_law: true,
  }) as any;

  // Validate against world-config schema.
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  for (const f of ["common", "blocks", "records", "world-config", "participant-api", "log"]) {
    ajv.addSchema(JSON.parse(readFileSync(join(root, `contracts/${f}.schema.json`), "utf8")));
  }
  const valid = ajv.getSchema("urn:oikos:contracts:0.8:world-config")!;
  const ok = valid(cfg);
  if (!ok) console.error(valid.errors?.slice(0, 5));
  expect(ok).toBe(true);

  // Every counterparty seat passes seatReadiness (refuseUnready does not throw).
  const ready = refuseUnready(seatReadiness(cfg, modules));
  const byPost = Object.fromEntries(ready.map((r) => [r.post, r]));
  expect(byPost.editor?.ready).toBe(true);
  expect(byPost.editor?.forms).toEqual(expect.arrayContaining(["news_item", "poll_question", "poll"]));
  expect(byPost["auditor-officer"]?.ready).toBe(true);
  expect(byPost["auditor-officer"]?.forms).toEqual(expect.arrayContaining(["audit_request", "audit_finding", "audit_report"]));
  expect(byPost["councillor-1"]?.ready).toBe(true);
  expect(byPost["councillor-1"]?.answers).toContain("its vote on its body's ballots");

  // Desk channels & standing papers present on each counterparty seat.
  expect(cfg.world.records.some((r: any) => r.id === "proc-newspaper")).toBe(true);
  const editorPos = cfg.positions.find((p: any) => p.id === "editor");
  expect(editorPos.channels.some((c: any) => c.id === "laws")).toBe(true);
  const auditorPos = cfg.positions.find((p: any) => p.id === "auditor-officer");
  expect(auditorPos.channels.some((c: any) => c.id === "procedures")).toBe(true);
  expect(auditorPos.channels.some((c: any) => c.id === "civic")).toBe(true);
  const councillorPos = cfg.positions.find((p: any) => p.id === "councillor-1");
  expect(councillorPos.channels.some((c: any) => c.id === "oversight")).toBe(true);

  // Both new editor polling forms resolve cleanly through @oikos/translator.
  const qForm = cfg.world.records.find((r: any) => r.id === "form-editor-poll-question");
  const pForm = cfg.world.records.find((r: any) => r.id === "form-editor-poll");
  expect(qForm).toBeTruthy();
  expect(pForm).toBeTruthy();

  const k = new Knowledge(cfg.world.currencies?.[0] ?? { code: "AUD", symbol: "$", minor_units: 2 });
  k.absorb({
    participant: editorPos.holder,
    entity: "paper",
    t: 20 * DAY,
    status: "active",
    positions: [{ position: "editor", entity: "paper", title: editorPos.title }],
    channels: { stationery: { kind: "records", records: [qForm, pForm] } },
    outcomes: [],
    inbox: [],
    drafts: [],
  } as any);

  const qRes = resolve(
    calls.parseProgram(`form(form=poll_question, headline="Reader poll: how is the town run?", edition=3, poll_at=${60 * DAY})`),
    k,
    () => undefined,
    "editor",
  );
  expect(qRes.ok, JSON.stringify(qRes)).toBe(true);
  if (qRes.ok) {
    expect(qRes.blocks[0]).toMatchObject({
      block: "publish",
      kind: "news",
      visible_to: "public",
      data: { kind: "poll_question", edition: 3, about_office: false, poll_at: 60 * DAY },
    });
  }

  const pRes = resolve(
    calls.parseProgram(`form(form=poll, headline="Poll results: approval -9% across 95 readers.", edition=4, poll_at=${60 * DAY}, respondents=95, approval_bps="-900")`),
    k,
    () => undefined,
    "editor",
  );
  expect(pRes.ok, JSON.stringify(pRes)).toBe(true);
  if (pRes.ok) {
    expect(pRes.blocks[0]).toMatchObject({
      block: "publish",
      kind: "news",
      visible_to: "public",
      data: { kind: "poll", edition: 4, about_office: false, poll_at: 60 * DAY, respondents: 95, approval_bps: -900 },
    });
  }
});

test("mock seats for mayor, editor, auditor-officer, and councillor-1 run together cleanly with debriefs", async () => {
  const cfg = generate({
    ...townSpec,
    citizens: 60,
    seed: 7,
    mayor: "llm",
    model_seats: ["editor", "auditor-officer", "councillor-1"],
    oversight_desks: true,
    newspaper_polls: true,
    election_law: true,
    first_election_days: 60,
  }) as any;

  const seats = ["mayor", "editor", "auditor-officer", "councillor-1"].map((id) =>
    String(cfg.positions.find((p: any) => p.id === id).holder),
  );
  const out = mkdtempSync(join(tmpdir(), "oikos-w7-mock-seats-"));
  try {
    const s = await runWorld({ config: cfg, runId: "w7-mock-seats", outDir: out, until: 21 * DAY });
    expect(s.participantErrors).toBe(0);
    const log = readLog(s.logPath).trim().split("\n").map((l) => JSON.parse(l));
    for (const seat of seats) {
      const sittings = log.filter(
        (e) => e.kind === "annotation" && e.body?.annotation === "transcript" && e.body?.subject === seat && e.body?.data?.purpose !== "debrief",
      );
      const debriefs = log.filter(
        (e) => e.kind === "annotation" && e.body?.annotation === "debrief" && e.body?.subject === seat,
      );
      expect(sittings.length, `${seat} should sit at least once`).toBeGreaterThan(0);
      expect(debriefs.length, `${seat} should receive one debrief`).toBe(1);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 180_000);
