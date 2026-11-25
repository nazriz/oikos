import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calls } from "@oikos/participants";
import { Knowledge, resolve } from "@oikos/translator";
import { generate } from "@oikos/worlds/generator/generate";
import { kernelBinary } from "../src/kernel";

const root = join(import.meta.dir, "../..");
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("direction forms stay non-public by default and become public when newspaper_polls is enabled", () => {
  const plain = generate({ ...spec, citizens: 60 });
  const plainForm = plain.world.records.find((r: any) => r.id === "form-inspector-enforcement");
  expect(plainForm?.data?.visible).toBeUndefined();
  expect(plain.positions.find((p: any) => p.id === "editor")?.role_module?.params?.poll_every_days).toBeUndefined();

  const polled = generate({ ...spec, citizens: 60, newspaper_polls: true });
  const pubForm = polled.world.records.find((r: any) => r.id === "form-inspector-enforcement");
  expect(pubForm?.data?.visible).toBe("public");
  expect(polled.knowing.published.some((p: any) => p.what === "direction")).toBe(true);
  const editor = polled.positions.find((p: any) => p.id === "editor");
  expect(editor?.role_module?.params?.poll_every_days).toBe(20);
  expect(editor?.channels?.some((c: any) => c.id === "poll_replies")).toBe(true);
  // (And the paper's back issues, its own: a successor editor reads what it has run from them.)
  expect(editor?.channels?.find((c: any) => c.id === "back_issues")).toMatchObject({ way: "mine", match: { statement_kinds: ["news"] } });
});

test("a direction filed on a public direction form reaches print in firm.newspaper", () => {
  const cfg = generate({ ...spec, citizens: 60, seed: 7, first_election_days: 60, newspaper_polls: true });
  const dirForm = cfg.world.records.find((r: any) => r.id === "form-inspector-enforcement");
  expect(dirForm?.data?.visible).toBe("public");

  // Resolve the mayor's direction through the real translator resolver using the generated town's form.
  const mayor = cfg.positions.find((p: any) => p.id === "mayor");
  const k = new Knowledge(cfg.world.currencies?.[0] ?? { code: "AUD", symbol: "$", minor_units: 2 });
  k.absorb({
    participant: mayor.holder,
    entity: "city",
    t: 86_400,
    status: "active",
    positions: [{ position: "mayor", entity: "city", title: mayor.title }],
    channels: { forms: { kind: "records", records: [dirForm] } },
    outcomes: [],
    inbox: [],
    drafts: [],
  } as any);
  const resolved = resolve(calls.parseProgram("form(form=inspector_enforcement, fines=no, to=city)"), k, () => undefined, "mayor");
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) return;
  const pub = resolved.blocks[0] as any;
  expect(pub.block).toBe("publish");
  expect(pub.kind).toBe("direction");
  expect(pub.visible_to).toBe("public");

  // Inject the resolved public direction into the town record at t=0 and run the live kernel for 10 days.
  cfg.world.records.push({
    id: "dir-test-fines",
    record: "statement",
    author: mayor.holder,
    in_position: "mayor",
    speaks_for: "city",
    at: 0,
    visible_to: pub.visible_to,
    addressed_to: pub.addressed_to,
    basis: pub.basis,
    kind: pub.kind,
    text: pub.text,
    data: pub.data,
  });

  const tmp = mkdtempSync(join(tmpdir(), "oikos-w3-dir-print-"));
  try {
    const cfgPath = join(tmp, "config.json");
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const run = Bun.spawnSync([kernelBinary(), "world", cfgPath, "--out", tmp, "--until", String(10 * 86_400), "--threads", "2"], { stdout: "pipe", stderr: "pipe" });
    expect(run.exitCode, run.stderr.toString()).toBe(0);

    let printed: any = null;
    for (const line of readFileSync(join(tmp, "world.jsonl"), "utf8").split("\n")) {
      if (!line.includes("dir-test-fines")) continue;
      const e = JSON.parse(line);
      const rec = e.body?.record;
      if (e.body?.event === "recorded" && rec?.kind === "news" && rec?.speaks_for === "paper" && rec?.data?.kind === "direction") {
        printed = rec;
        break;
      }
    }
    expect(printed).not.toBeNull();
    expect(printed.data.tone).toBe(-1);
    expect(printed.data.about_office).toBe(true);
    expect(printed.text).toContain("The town directs an office:");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}, 60_000);
