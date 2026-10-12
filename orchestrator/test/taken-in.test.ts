// Where a household goes when it loses its home (docs/behaviour/households.md, "Taken in during the year"; the fifth
// living pilot: none of 50 households that lost a home found another, and nothing could become of them but leaving).
// The possession test's tenant, who cannot pay and goes on the notice, asks the people they have come to know whether
// they may stay. Each one asked answers, yes or no and why; on a yes the tenant's body is in that home, as a guest,
// and they do not leave town for want of a home; with no yes they are without a dwelling and leave when their days
// run out. Everything is a person's own paper to another: no office is told any of it.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const base = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

async function town(willing: number) {
  const config = generate({ ...base, living: { initiative_bps: 10_000 } }) as any;
  const leases = config.world.records.filter((r: any) => r.record === "agreement" && r.terms.template === "lease");
  const age = (id: string) => -config.world.entities.find((e: any) => e.id === id).born_at / (365 * DAY);
  const alone = leases.find((l: any) => !/with their household/.test(l.terms.text) && age(l.terms.parties[1]) >= 25 && age(l.terms.parties[1]) < 55)!;
  const tenant = alone.terms.parties[1] as string;
  const job = config.world.records.find((r: any) => r.record === "agreement" && r.terms.template === "employment" && r.terms.parties[1] === tenant);
  if (job) config.world.records = config.world.records.filter((r: any) => r.id !== job.id && r.agreement !== job.id && r.basis !== job.id);
  config.world.accounts.find((a: any) => a.id === `acc-${tenant}`).balance = "0";
  // (For the test: the tenant goes at the notice's date; nobody leaves town for want of work; a roofless household
  // leaves after 30 days; and how close someone must be to take another in is set by the test.)
  for (const p of config.participants) if (p.controller?.impl === "citizen.default") p.controller = { ...p.controller, params: { ...p.controller.params, stay: { ask: 5, ask_again_days: 30, willing_affinity_bps: willing }, leave_after_jobless_days: 9_999 } };
  const who = config.participants.find((p: any) => p.person === tenant);
  who.controller = { ...who.controller, params: { ...who.controller.params, in_labour_force: false, possession: { stay_bps: 0, obey_bps: 10_000 }, leave_after_homeless_days: 30 } };
  const out = mkdtempSync(join(tmpdir(), "oikos-taken-in-"));
  try {
    const s = await runWorld({ config: { ...config, log: { ...config.log, detail: "lean" } }, runId: `taken-in-${willing}`, outDir: out, until: 170 * DAY, recordObservations: "none" });
    expect(s.participantErrors).toBe(0);
    const ev = readFileSync(s.logPath, "utf8").trim().split("\n").filter((l) => l.includes('"event"')).map((l) => JSON.parse(l)).filter((e) => e.kind === "event").map((e) => ({ t: e.t, ...e.body }));
    return { ev, recs: ev.filter((e) => e.event === "recorded").map((e) => e.record) as any[], tenant, lease: alone.id as string };
  } finally { rmSync(out, { recursive: true, force: true }); }
}

test("a tenant who has lost their home asks the people they know; each answers; a yes puts them under that roof and they stay in town; with no yes they leave when their days run out", async () => {
  // (Anyone who has come to know the tenant at all is willing: room, means and whose home it is still decide.)
  const { ev, recs, tenant, lease } = await town(1);
  const went = recs.find((r) => r.record === "notice" && r.agreement === lease && r.as === tenant);
  expect(went).toBeDefined();
  const asked = recs.filter((r) => r.kind === "stay_request" && r.speaks_for === tenant);
  const answers = recs.filter((r) => r.kind === "stay_answer" && (r.addressed_to ?? []).includes(tenant));
  // Asked of people, on a paper between the two of them alone.
  for (const q of asked) {
    expect(q.at).toBeGreaterThanOrEqual(went.at);
    expect(q.visible_to).toEqual([tenant, q.addressed_to[0]]);
    expect(q.data).toMatchObject({ adults: 1, children: 0, without_income: 1 });
    const a = answers.find((x) => x.data.request === q.id);
    if (q.at < 155 * DAY) expect(a).toBeDefined();
    if (a) expect(a.data.yes === true ? typeof a.data.space : a.data.why).toMatch(/^(string|not_mine|hosting|no_room|means|not_willing)$/);
  }
  const yes = answers.filter((a) => a.data.yes === true).sort((x, y) => x.at - y.at)[0];
  const left = ev.find((e) => e.event === "person_left" && e.person === tenant);
  if (yes) {
    // Under the host's roof, and still in town at the end though the 30 days are long past.
    expect(ev.some((e) => e.event === "occupied" && e.occupant === tenant && e.space === yes.data.space && e.t >= yes.at)).toBe(true);
    expect(left).toBeUndefined();
  } else {
    // Nobody had them: without a dwelling, and gone when their days ran out.
    expect(left).toBeDefined();
    expect(left!.t).toBeGreaterThanOrEqual(went.at + 30 * DAY * 0.5);
  }
  // No office was told any of it.
  for (const r of [...asked, ...answers]) expect((r.visible_to as string[]).every((v) => /^c\d+$/.test(v))).toBe(true);
  console.log(`gone day ${Math.floor(went.at / DAY)}; asked ${asked.length}; answers ${answers.map((a) => (a.data.yes ? `yes (${a.data.space})` : a.data.why)).join(", ") || "none"}; ${yes ? "taken in" : left ? `left town day ${Math.floor(left.t / DAY)}` : "no dwelling"}`);
}, 900_000);
