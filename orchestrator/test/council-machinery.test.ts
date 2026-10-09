// A council's machinery in the hands of seats (wave 2b's review, fault 3). In the pilot whose council did business a
// model clerk declared 4 for where 5 had voted (one vote had come twelve days before the count, and it was shown each
// vote only as it came), a councillor could not see its own vote on file (twelve vote drafts for six votes), and a
// passed amendment could not be put in force: the law's figure never changed. Here a mock council does the whole
// chain with seats that follow a script: a motion on the tenancy law's amendment form, a ballot, five votes, the
// count read from what the clerk is shown, the result declared naming who voted, and the law's figure changed by the
// office's drafters. No model is called.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Tally } from "@oikos/participants";
import { generate } from "@oikos/worlds/generator/generate";
import { runWorld } from "../src/run";
import { scriptedSeats, type Seen, type Sitting } from "../../scripts/scripted-seats";

const root = join(import.meta.dir, "../..");
const DAY = 86_400;
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;
const COUNCILLORS = [1, 2, 3, 4, 5].map((n) => `councillor-${n}`);

test("the count is the latest vote of each post cast while the ballot was open, from every vote on file", () => {
  const tally = new Tally("city");
  const vote = (id: string, at: number, post: string | undefined, choice: string, ballot = "rec.20") => ({ id, record: "vote", author: "x", at, ballot, choice, visible_to: ["city"], ...(post ? { in_position: post } : {}) });
  const ballot = (id: string, x: object = {}) => ({ id, record: "statement", author: "clerk", at: DAY, kind: "ballot", speaks_for: "city", text: "Ballot.", visible_to: "public", data: { proposal: "rec.10", options: ["yes", "no"], closes_at: 10 * DAY, electorate: "council", ...x } });
  const show = (t: number, records: object[]) => tally.absorb({ t, entity: "city", channels: { votes: { kind: "records", records } }, outcomes: [], inbox: [] } as any);
  // Votes come over three sittings, as they did in the pilot: one twelve days before the count.
  show(2 * DAY, [ballot("rec.20"), ballot("rec.1", { closed: true, closes_at: 0 }), vote("rec.21", 2 * DAY, "councillor-2", "YES"), vote("rec.22", 2 * DAY, "councillor-3", "YES"), vote("rec.23", 2 * DAY + 60, "councillor-3", "YES")]);
  show(3 * DAY, [vote("rec.24", 3 * DAY, "councillor-4", "yes"), vote("rec.25", 3 * DAY, "councillor-5", "no")]);
  show(9 * DAY, [vote("rec.26", 9 * DAY, "councillor-1", "yes"), vote("rec.27", 9 * DAY, undefined, "yes"), vote("rec.28", 10 * DAY, "councillor-5", "yes")]);
  const [open] = tally.counts(9 * DAY + 60).filter((c) => c.ballot === "rec.20");
  expect(open!.latest.map((v) => [v.post, v.choice, v.vote])).toEqual([["councillor-1", "yes", "rec.26"], ["councillor-2", "YES", "rec.21"], ["councillor-3", "YES", "rec.23"], ["councillor-4", "yes", "rec.24"], ["councillor-5", "no", "rec.25"]]);
  expect(open).toMatchObject({ cast: 8, late: 1, outside: 1, closed: false });
  const text = tally.text(10 * DAY + 60, "Council clerk");
  expect(text).toContain("## Council clerk: The count on each ballot of the council not yet declared, from every vote on file");
  expect(text).toContain("- rec.20 (on rec.10), closed year 1, day 11: 5 posts have voted: no 1 (councillor-5); yes 4 (councillor-1, councillor-2, councillor-3, councillor-4). (8 votes on file in all: 1 earlier vote replaced by the same post's later one; 1 cast at or after it closed, not counted; 1 cast in no post, not counted.) It is closed and no result is declared yet.");
  expect(text).toContain("the whole count, not only what came since you last sat");
  // A member reads its own vote on file, and nobody else's.
  const mine = new Tally("city", "councillor-3");
  mine.absorb({ t: 3 * DAY, entity: "city", channels: { votes: { kind: "records", records: [ballot("rec.20"), vote("rec.22", 2 * DAY, "councillor-3", "YES"), vote("rec.24", 3 * DAY, "councillor-4", "yes")] } }, outcomes: [], inbox: [] } as any);
  expect(mine.text(3 * DAY, "Councillor 3")).toBe('## Councillor 3: Your own votes on file, on the council\'s ballots not yet declared\n- rec.20 (on rec.10), open until year 1, day 11: your vote on file is "YES" (rec.22, cast year 1, day 3). It is the one that counts unless you cast another before the ballot closes.');
  // Declared, a ballot is no longer set out.
  show(11 * DAY, [{ id: "rec.30", record: "statement", author: "clerk", at: 11 * DAY, kind: "ballot_result", speaks_for: "city", text: "Result.", visible_to: "public", data: { ballot: "rec.20", yes: 4, no: 1, passed: true } }]);
  expect(tally.text(11 * DAY, "Council clerk")).toBe("");
});

test("a mock council: a motion, a ballot, five votes counted, the result declared naming who voted, and the law's figure changed", async () => {
  const config = generate({ ...spec, model_seats: ["council-clerk", ...COUNCILLORS] });
  const law = config.world.records.find((r: any) => r.kind === "law" && r.data?.schedule === "schedule-tenancy");
  const was = law.data.figures.notice.value / DAY, to = was + 30;
  // The office's procedure says what its drafters do, and that declaring a result does not change a law.
  const proc = config.world.records.find((r: any) => r.id === "proc-council-clerk-routines");
  expect(proc.text).toContain("Declaring a result does not by itself change a law: this does.");
  expect(proc.data.routines).toEqual([{ task: "enact", at: "council-clerk", every: DAY }]);
  const find = (seen: Seen, f: (r: any) => boolean) => [...seen.values()].filter(f).sort((a, b) => a.at - b.at)[0];
  const motion = (seen: Seen) => find(seen, (r) => r.kind === "proposal" && r.in_position === "councillor-1");
  const ballotOn = (seen: Seen) => find(seen, (r) => r.kind === "ballot" && r.data?.electorate === "council" && r.data?.closed !== true && r.data?.closes_at > 0 && r.in_position === "council-clerk");
  let seats: ReturnType<typeof scriptedSeats>;
  const clerk: Sitting[] = [
    { day: 0, asks: () => [{ what: "The drafters write passed amendments into the law.", program: "work(at=council-clerk, task=enact)" }] },
    { day: 1, asks: (seen) => { const m = motion(seen); return m ? [{ what: `Put ${m.id} to a ballot of the council, open for 8 days.`, program: `form(form=council_ballot, open_for="8 days", proposal=${m.id}, tags=["tenant_protection"], to=council-clerk)` }] : undefined; } },
    // The count, read from what the clerk is shown at this sitting, and declared as read.
    { day: 11, asks: (seen) => {
      const b = ballotOn(seen);
      const shown = seats.shown.filter((x) => x.seat === "council-clerk").at(-1)!.text;
      const line = shown.split("\n").find((l) => l.startsWith(`- ${b.id} `) && l.includes("have voted"));
      const yes = /yes (\d+) \(([^)]*)\)/.exec(line ?? ""), no = /no (\d+) \(([^)]*)\)/.exec(line ?? "");
      if (!line || !yes) return undefined;
      const list = (m: RegExpExecArray | null) => JSON.stringify(m ? m[2]!.split(", ") : []);
      return [{ what: `Declare the result of ${b.id}.`, program: `form(ballot=${b.id}, form=council_result, no="${no ? no[1] : 0}", passed=${Number(yes[1]) > Number(no?.[1] ?? 0) ? "yes" : "no"}, to=council-clerk, voted_against=${list(no)}, voted_for=${list(yes)}, yes="${yes[1]}")` }];
    } },
    ...[13, 15, 17].map((day) => ({ day, asks: () => [] })),
  ];
  const councillor = (n: number): Sitting[] => [
    ...(n === 1 ? [{ day: 0, asks: () => [{ what: `Propose that a landlord's notice to end a tenancy be ${to} days.`, program: `form(form=amend_tenancy, notice="${to} days")` }] }] : []),
    // (One of them on the second day of the ballot and one on its last, as votes come.)
    { day: n === 2 ? 2 : n === 1 ? 4 : 3, asks: (seen) => { const b = ballotOn(seen); return b ? [{ what: `Vote yes on ${b.id}.`, program: `vote(ballot=${b.id}, choice=yes)` }] : undefined; } },
    { day: 9, asks: () => [] }, { day: 14, asks: () => [] },
  ];
  seats = scriptedSeats({ "council-clerk": clerk, ...Object.fromEntries(COUNCILLORS.map((c, i) => [c, councillor(i + 1)])) });
  const s = await runWorld({ config, runId: "council-machinery", outDir: mkdtempSync(join(tmpdir(), "oikos-council-")), until: 19 * DAY, adapter: seats.adapter, recordObservations: "none", recordDecisions: "none" });
  expect(s.participantErrors).toBe(0);
  const records = readFileSync(s.logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "event" && e.body.event === "recorded").map((e) => e.body.record);
  // The motion, the ballot, five votes.
  const prop = records.find((r) => r.kind === "proposal" && r.in_position === "councillor-1")!;
  const ballot = records.find((r) => r.kind === "ballot" && r.in_position === "council-clerk")!;
  expect(ballot.data).toMatchObject({ proposal: prop.id, electorate: "council" });
  const votes = records.filter((r) => r.record === "vote" && r.ballot === ballot.id);
  expect(votes.map((v) => v.in_position).sort()).toEqual(COUNCILLORS);
  // What the clerk was shown when it counted: all five, though they came over several days and three of its sittings.
  const counted = seats.shown.filter((x) => x.seat === "council-clerk" && x.text.includes("The count on each ballot")).at(-1)!.text;
  expect(counted).toContain(`- ${ballot.id} (on ${prop.id}), closed year 1, day ${Math.floor(ballot.data.closes_at / DAY) + 1}`);
  expect(counted).toMatch(/5 posts have voted: yes 5 \(councillor-1, councillor-2, councillor-3, councillor-4, councillor-5\)\. It is closed and no result is declared yet\./);
  // The result, declared by the seat on its form, naming who voted.
  const result = records.find((r) => r.kind === "ballot_result" && r.in_position === "council-clerk")!;
  expect(result.data).toEqual({ ballot: ballot.id, yes: 5, no: 0, passed: true, voted_for: COUNCILLORS, voted_against: [] });
  // The law's figure changed: the drafters wrote the amended law by its schedule, in place of the law in force.
  const amended = records.find((r) => r.kind === "law" && r.in_position === "council-clerk-staff")!;
  expect(amended).toMatchObject({ basis: ballot.id, visible_to: "public", data: { schedule: "schedule-tenancy", replaces: law.id } });
  expect(amended.data.figures.notice.value).toBe(to * DAY);
  expect(amended.at).toBeGreaterThanOrEqual(result.at);
  expect(records.some((r) => r.record === "withdrawal" && r.withdraws === law.id && r.in_position === "council-clerk-staff")).toBe(true);
  expect(records.filter((r) => r.kind === "law" && r.basis === ballot.id)).toHaveLength(1);
  // The drafters reported it to the clerk, and a councillor was shown its own vote on file.
  expect(records.some((r) => r.kind === "staff_report" && r.data.office === "council-clerk" && /enact \(rec\.\d+, every 1 day\): carried out: 1 amendments written into law/.test(r.text))).toBe(true);
  const own = seats.shown.filter((x) => x.seat === "councillor-2" && x.text.includes("Your own votes on file")).at(-1)!.text;
  expect(own).toMatch(new RegExp(`- ${ballot.id.replace(".", "\\.")} \\(on ${prop.id.replace(".", "\\.")}\\), (open until|closed) year 1, day \\d+(, \\d\\d:\\d\\d)?: your vote on file is "yes" \\(rec\\.\\d+, cast year 1, day 3`));
  console.log(["THE MOCK COUNCIL", `motion ${prop.id} (councillor-1, day ${Math.floor(prop.at / DAY) + 1}): ${prop.text}`, `ballot ${ballot.id} (clerk, day ${Math.floor(ballot.at / DAY) + 1}), closing day ${Math.floor(ballot.data.closes_at / DAY) + 1}`,
    `votes: ${votes.map((v) => `${v.in_position} ${v.choice} day ${Math.floor(v.at / DAY) + 1}`).join("; ")}`, `the clerk was shown: ${counted.split("\n").find((l) => l.startsWith(`- ${ballot.id}`))}`,
    `result ${result.id} (day ${Math.floor(result.at / DAY) + 1}): ${result.text}`, `law ${amended.id} (drafters, day ${Math.floor(amended.at / DAY) + 1}) replaces ${law.id}: notice ${was} days -> ${amended.data.figures.notice.value / DAY} days`].join("\n  "));
}, 600_000);
