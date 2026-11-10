// The viewer on a small mock run (scripts/pilot-mock.ts): it writes one self-contained page, and it changes nothing in the run.

import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockPilot } from "../../scripts/pilot-mock";
import { buildView } from "../src/build";
import { runPilotView } from "../src/cli";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oikos-pilot-view-test-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const entry = { name: "pv", world: "worlds/town.yaml", sets: ["citizens=20", "mayor=llm"], model: "codex/gpt-6.1-sol", translator: "decide/pod-small-d16-s1", until: 100 * 86_400, budget: 25, env: { OIKOS_CLAUDE_BIN: "/nonexistent" } };

const snapshot = (dir: string) => readdirSync(dir, { recursive: true }).map(String).sort().map((f) => { const s = statSync(join(dir, f)); return `${f}:${s.isDirectory() ? "d" : s.size}:${s.mtimeMs}`; });

test("a mock pilot becomes one self-contained page, and the run is left exactly as it was", async () => {
  const out = join(base, "w.mock");
  expect(await mockPilot(entry, out, 3)).toMatchObject({ generated: true, ranToEnd: true });
  const run = join(out, "pv");
  const before = snapshot(run);
  const page = join(base, "views", "pv.html");
  await runPilotView([run, "--out", page, "--quiet"]);
  expect(snapshot(run)).toEqual(before);

  const html = readFileSync(page, "utf8");
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toContain('<meta name="viewport"');
  expect(html).toContain("prefers-color-scheme: dark");
  // no network: nothing is fetched from anywhere
  expect(html).not.toMatch(/(src|href)=["']https?:/);
  expect(html).not.toMatch(/\bfetch\(|XMLHttpRequest|import\(/);
  expect(statSync(page).size).toBeLessThan(10_000_000);

  const data = JSON.parse(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1]!);
  expect(data.overview.days).toBeGreaterThan(2);
  expect(data.overview.seats.length).toBeGreaterThan(0);
  expect(data.seats[0].sittings.length).toBeGreaterThan(0);
  expect(data.actors.length).toBeGreaterThan(0);
  expect(data.town.series.acts.length).toBe(3);
  expect(data.twin).toBeNull();
}, 180_000);

// An experiment's seed folder in small (orchestrator/src/experiment.ts writes the real ones): a model arm and the code arm,
// each a JSONL log (an `.oklog` reads the same, through the kernel's export), with the calls and debriefs files.
function forkFixture(root: string): string {
  const seed = join(root, "seed-1");
  mkdirSync(seed, { recursive: true });
  const D = 86_400, t0 = 31 * D;
  let seq = 0;
  const line = (kind: string, body: any, t: number) => JSON.stringify({ body, kind, seq: seq++, t });
  const ann = (annotation: string, subject: string, data: any, t: number) => line("annotation", { annotation, data, subject }, t);
  const header = line("header", { config: { meta: { name: "Testtown" }, seed: 1, world: { entities: [{ id: "firm-1", kind: "firm", name: "Firm One" }], accounts: [], currencies: [{ code: "USD", symbol: "$", minor_units: 2 }] }, positions: [{ id: "firm-1-assistant", entity: "firm-1", title: "Assistant" }], participants: [] }, run_id: "exp-seed1" }, 0);
  const act = (participant: string, t: number) => { const s = seq; return [line("command", { as: "firm-1-assistant", blocks: [{ block: "publish", kind: "invoice", addressed_to: ["firm-1"], text: "Invoice: 3 goods." }], command: "act", participant, provenance: { draft: "draft.par.1.1" } }, t), line("event", { action: `a${s}`, cause: s, event: "action_started" }, t), line("event", { action: `a${s}`, cause: s, event: "action_applied" }, t)]; };
  const model = [
    header,
    ann("note", "orchestrator", { steward: { seat: "par.1", adapter: "anthropic/claude-test", framing: { disclosure: "unstated", reason: "The study's framing." }, post: "firm-1-assistant", translator: { arrangement: "then", first: "decide/pod-small-x", behind: "anthropic/claude-test" } } }, t0),
    ann("observation", "par.1", { observation: { woke_for: "asked", inbox: [{}], outcomes: [], drafts: [], channels: [] } }, t0),
    ann("transcript", "par.1", { purpose: "participant", turn: 1, provider: "anthropic", model: "claude-test", system: "STANDING INSTRUCTIONS", system_sha256: "s1", input: "Your notebook: (empty)\n\nIt is year 1, day 32.\nA referral came: invoice 3 goods.", output: [{ type: "text", text: "I will draft it." }, { type: "tool_use", id: "tu1", name: "do", input: { request: "Fill in the invoice for 3 goods", why: "the referral" } }] }, t0),
    ann("transcript", "translator", { purpose: "translator", turn: 1, ref: "draft.par.1.1", provider: "decide", model: "pod-small-x", input: "Request: Fill in the invoice for 3 goods\n\nForms this person knows of:\n- invoice", output: [{ type: "tool_use", id: "decide", name: "call", input: { withheld: "probation", wrote: "form(form=invoice)" } }] }, t0),
    ann("transcript", "translator", { purpose: "translator", turn: 1, ref: "draft.par.1.1", provider: "anthropic", model: "claude-test", input: "Request: Fill in the invoice for 3 goods", output: [{ type: "tool_use", id: "t", name: "call", input: { call: "form(form=invoice)" } }] }, t0),
    ann("note", "par.1", { translation_route: { draft: "draft.par.1.1", used: "behind", why: "probation", first: { model: "decide/pod-small-x", result: "refusal", withheld: "probation", wrote: "form(form=invoice)" }, behind: { model: "anthropic/claude-test", result: "draft", call: "form(form=invoice)" } } }, t0),
    line("annotation", { annotation: "draft", draft: { id: "draft.par.1.1", participant: "par.1", call: "form(form=invoice)", proposal: "Fill in the invoice for 3 goods", summary: "This does one thing: an invoice.", check: { ok: true } } }, t0),
    ann("transcript", "par.1", { purpose: "participant", turn: 2, provider: "anthropic", model: "claude-test", system_sha256: "s1", input: [{ type: "tool_result", tool_use_id: "tu1", content: "The draft: This does one thing: an invoice." }], output: [{ type: "tool_use", id: "tu2", name: "confirm", input: { decision: "accept", ref: "draft.par.1.1" } }] }, t0),
    line("annotation", { annotation: "signoff", decision: "accept", draft: "draft.par.1.1", participant: "par.1" }, t0),
    ...act("par.1", t0),
    line("annotation", { annotation: "usage", subject: "par.1", purpose: "participant", provider: "anthropic", model: "claude-test", cost_microusd: 20_000 }, t0),
    ann("observation", "par.1", { observation: { woke_for: "news", inbox: [], outcomes: [], drafts: [], channels: [] } }, t0 + D),
    ann("transcript", "par.1", { purpose: "participant", turn: 1, provider: "anthropic", model: "claude-test", system_sha256: "s1", input: "Your notebook: (empty)\n\nIt is year 1, day 33.\nNothing new.", output: [{ type: "tool_use", id: "tu3", name: "done_for_now", input: { days: 1 } }] }, t0 + D),
    ann("note", "par.1", { empty_sitting: { day: 34, woke_for: "news" } }, t0 + 2 * D),
    ann("debrief", "par.1", { version: "0.5.1", apart: true, ended: "complete", kept_back: [], kept_back_all: false, steps: [{ id: "like", question: "What was taking part like?", status: "answered" }] }, 40 * D),
    line("end", { reason: "completed" }, 40 * D),
  ];
  writeFileSync(join(seed, "sonnet.jsonl"), model.join("\n") + "\n");
  writeFileSync(join(seed, "sonnet.debriefs.jsonl"), JSON.stringify({ kind: "debrief", subject: "par.1", record: { version: "0.5.1", ended: "complete", kept_back: [], kept_back_all: false, steps: [{ id: "like", question: "What was taking part like?", answer: "Quiet work." }] } }) + "\n");
  writeFileSync(join(seed, "sonnet.calls.jsonl"), JSON.stringify({ seat: "par.1", subject: "par.1", purpose: "participant", model: "anthropic/claude-test", cost_microusd: 20_000 }) + "\n");
  writeFileSync(join(seed, "sonnet.json"), JSON.stringify({ arm: "sonnet", steward: { kind: "model", model: "anthropic/claude-test" }, costs: { "par.1": {}, translator: {} } }));
  seq = 1;
  writeFileSync(join(seed, "code.jsonl"), [header, ...act("par.1", t0 + 3600), line("end", { reason: "completed" }, 40 * D)].join("\n") + "\n");
  writeFileSync(join(seed, "code.json"), JSON.stringify({ arm: "code", steward: { kind: "code" }, costs: {} }));
  writeFileSync(join(seed, "template-seats.json"), JSON.stringify({ "par.1": { capacity: "firm-1-assistant" } }));
  writeFileSync(join(root, "spec.json"), JSON.stringify({ name: "exp", forkDay: 30, untilDay: 40 }));
  return seed;
}

test("an experiment's fork: a page per model arm, each sitting with what the model was shown and said, the translator that drafted, and what came of it", async () => {
  const exp = join(base, "exp");
  const seed = forkFixture(exp);
  const before = snapshot(exp);
  const outDir = join(base, "views", "exp");
  const files = (await runPilotView([exp, "--out", outDir, "--quiet"])).split("\n");
  expect(snapshot(exp)).toEqual(before);
  expect(files.map((f) => f.split("/").at(-1))).toEqual(["seed-1.sonnet.html", "index.html"]); // (the code arm is the twin, not a page)
  const data = JSON.parse(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(readFileSync(files[0]!, "utf8"))![1]!);

  const o = data.overview.seats.find((s: any) => s.id === "par.1");
  expect(o).toMatchObject({ model: "anthropic/claude-test", post: "firm-1-assistant", framing: "unstated", requests: 1, ours: 0, fallback: 1, nothing: 0, empty: 1, skipped: 1 });
  expect(data.overview.experiment).toMatchObject({ experiment: "exp", seed: "seed-1", arm: "sonnet", twinArm: "code" });
  const seat = data.seats.find((s: any) => s.id === "par.1");
  const [first, quiet, skipped] = seat.sittings;
  expect(data.systems[first.system]).toBe("STANDING INSTRUCTIONS");
  expect(first.prompt).toContain("A referral came: invoice 3 goods.");
  expect(first.turns[0].say).toBe("I will draft it.");
  expect(first.turns[0].tools[0]).toMatchObject({ name: "do", result: "The draft: This does one thing: an invoice." });
  expect(first.requests[0]).toMatchObject({ by: "fallback", usedModel: "anthropic/claude-test", signoff: "confirmed", route: { why: "probation", first: { model: "decide/pod-small-x", withheld: "probation" } }, act: { status: "applied" } });
  expect([first.empty, quiet.empty, skipped.skipped]).toEqual([false, true, true]);
  expect(seat.debrief.steps.find((s: any) => s.id === "like").answer).toBe("Quiet work.");
  expect(data.twin.seats[0]).toMatchObject({ seat: "par.1", seatActs: 1, twinActs: 1, matched: 1 });

  // One arm asked for, from the seed folder, to one file; never into the run's folders.
  const one = join(base, "views", "one.html");
  expect(await runPilotView([seed, "--arm", "sonnet", "--out", one, "--quiet", "--no-twin"])).toBe(one);
  await expect(runPilotView([seed, "--out", join(exp, "v"), "--quiet"])).rejects.toThrow("only reads");
  expect(snapshot(exp)).toEqual(before);
}, 60_000);

test("the viewer refuses to write inside a run's folder, and a folder with no log", async () => {
  const run = join(base, "w.mock", "pv");
  await expect(runPilotView([run, "--out", join(run, "view.html"), "--quiet"])).rejects.toThrow("only reads");
  expect(existsSync(join(run, "view.html"))).toBe(false);
  await expect(buildView(base)).rejects.toThrow("no run log");
}, 60_000);
