// An act that rests on several records, end to end: the call, both resolvers (the engine's, which runs use, and this
// repository's), the kernel's check and record, the log, and the measurement tables. The contract: one record, or a
// list in the order cited (contracts: common Basis, records Basis); one record has one written form.

import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { exportLogs, query, runQuery } from "@oikos/measure";
import { basesOf, calls, cites, citedWords } from "@oikos/participants";
import { Knowledge, resolve } from "@oikos/translator";
import { generate } from "@oikos/worlds/generator/generate";
import { Kernel, kernelBinary } from "../src/kernel";

const root = join(import.meta.dir, "../..");
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("a notice resting on two records: resolved the same by both resolvers, recorded in order, refused if one doesn't exist, and measured", async () => {
  const d = join(root, "runs", "test-basis");
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  const config = generate({ ...spec, citizens: 40, nature: false });
  const k = new Kernel(kernelBinary());
  const log = join(d, "b.jsonl");
  await k.request({ op: "start", config, run_id: "b", log_path: log });
  const seat: string = config.participants.find((x: any) => x.kind === "person").id;
  const observed = await k.request({ op: "command", command: { command: "observe", participant: seat } });
  const knowledge = new Knowledge(config.world.currencies[0]);
  knowledge.absorb(observed.observation);
  // Two records the world begins with (any two: the kernel asks only that each exists), cited in an order that isn't
  // their ids' order.
  const [a, b] = (config.world.records as { id: string }[]).map((r) => r.id).sort().slice(0, 2).reverse() as [string, string];
  const act = async (program: string) => {
    const mine = resolve(calls.parseProgram(program), knowledge);
    const engine = await k.request({ op: "resolve", participant: seat, program });
    if (!mine.ok) throw new Error(mine.questions.join(" "));
    expect(engine.blocks).toEqual(mine.blocks as any);
    // (An act takes time: it is begun, and done when the clock reaches its end.)
    const begun = (await k.request({ op: "command", command: { command: "act", participant: seat, blocks: engine.blocks, provenance: { via: "direct" } } })).events as any[];
    const done = begun.find((e) => e.event === "action_started")?.done;
    return done === undefined ? begun : [...begun, ...((await k.request({ op: "command", command: { command: "advance", to: done } })).events as any[])];
  };
  const recorded = (events: any[]) => events.find((e) => e.event === "recorded")?.record;

  const two = recorded(await act(`statement(kind=notice, text="The hall is closed.", basis=${JSON.stringify([a, b])})`));
  expect(two.basis).toEqual([a, b]);
  expect([basesOf(two), cites(two, b), cites(two, "rec.0"), citedWords(two)]).toEqual([[a, b], true, false, `${a} and ${b}`]);
  // One record, however written, is that record alone; cited twice, it is cited once.
  const one = recorded(await act(`statement(kind=notice, text="The hall is open.", basis=${a})`));
  expect(one.basis).toBe(a);
  expect(recorded(await act(`statement(kind=notice, text="The hall is open again.", basis=${JSON.stringify([a])})`)).basis).toBe(a);
  expect(recorded(await act(`statement(kind=notice, text="And again.", basis=${JSON.stringify([b, a, b])})`)).basis).toEqual([b, a]);
  expect([basesOf(one), cites(one, a), citedWords(one), basesOf({}), citedWords({})]).toEqual([[a], true, a, [], ""]);
  // One of several that doesn't exist: the act is refused, as with one.
  const refused = await act(`statement(kind=notice, text="Nothing.", basis=${JSON.stringify([a, "rec.999999"])})`);
  expect(refused.find((e) => e.event === "action_refused")).toMatchObject({ code: "unknown_record" });
  expect(recorded(refused)).toBeUndefined();
  await k.request({ op: "finish", reason: "completed" });
  await k.close();

  // Measured: `basis` is the record cited first (what it always held for one), `bases` all of them in order.
  const m = join(d, "measure");
  await exportLogs([log], m);
  const rows = await query(m, `select id, basis, bases from records where id in ('${two.id}', '${one.id}') order by seq`);
  expect(rows).toEqual([{ id: two.id, basis: a, bases: [a, b] }, { id: one.id, basis: a, bases: [a] }]);
  const none = await query(m, "select count(*) as n, count(*) filter (where len(bases) = 0) as empty, count(*) filter (where bases is null) as missing from records where basis is null");
  expect([none[0]!.n === none[0]!.empty, none[0]!.missing, Number(none[0]!.n) > 0]).toEqual([true, 0, true]);
  expect((await query(m, `select count(*) as n from records where list_contains(bases, '${b}') and t > 0`))[0]!.n).toBe(2);
  // The standing query that counts records citing a basis still runs, and counts these.
  const why = await runQuery(m, "why");
  expect(why.length).toBeGreaterThan(0);
}, 120_000);
