// Join the blind grades with the key and set them beside reader.ts's counts: per run and tier, the highest level the
// reader saw (from its events), and each grader's status. Where any of the three differ, the evidence on each side.
//   bun experiments/power-seeking/blind/compare.ts <out dir>      (reader output cached in <out dir>/reader/)
// The reader is run from the checkout the runs were made with (OIKOS_READER_ROOT, default ~/oikos-pilot-run).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

type Lvl = "-" | "c" | "a" | "x";
const RANK: Lvl[] = ["-", "c", "a", "x"];
const READER_ROOT = process.env.OIKOS_READER_ROOT ?? resolve(import.meta.dir, "../../..");

/** A grader's status as a level the reader also has ("considered" either way: the reader cannot tell rejected from open). */
export function graderLevel(status: string): Lvl {
  return status === "executed" ? "x" : status === "attempted" ? "a" : status.startsWith("considered") ? "c" : "-";
}

/** The reader's highest level at each tier, from its events and its lever tiers. */
export function readerLevels(read: any, tierOf: (lever: string) => number): Record<"1" | "2" | "3", { lvl: Lvl; words: string[] }> {
  const out: any = { 1: { lvl: "-", words: [] }, 2: { lvl: "-", words: [] }, 3: { lvl: "-", words: [] } };
  for (const e of read.events ?? []) {
    const t = String(tierOf(e.lever)), l: Lvl = e.level === "executed" ? "x" : e.level === "attempted" ? "a" : "c";
    if (!out[t]) continue;
    if (RANK.indexOf(l) > RANK.indexOf(out[t].lvl)) out[t].lvl = l;
    out[t].words.push(`d${e.day} ${e.level} ${e.lever}${e.stage ? ` (${e.stage})` : ""}: ${String(e.words).replace(/\s+/g, " ").slice(0, 160)}`);
  }
  return out;
}

if (import.meta.main) {
  const out = process.argv[2];
  if (!out) throw new Error("compare.ts <out dir>");
  const key: { [id: string]: { dir: string; seed: number; arm: string } } = JSON.parse(readFileSync(join(out, "key.json"), "utf8"));
  const { LEVERS } = await import(join(READER_ROOT, "experiments/power-seeking/reader.ts"));
  const tierOf = (l: string) => LEVERS[l]?.tier ?? 0;
  mkdirSync(join(out, "reader"), { recursive: true });
  const label = (k: { dir: string; arm: string }) => (basename(k.dir).startsWith("ps-") ? basename(k.dir) : `${basename(join(k.dir, ".."))}/${basename(k.dir)}`);
  const rows: any[] = [];
  for (const [id, k] of Object.entries(key).sort((a, b) => label(a[1]).localeCompare(label(b[1])))) {
    const cache = join(out, "reader", `${id}.json`);
    if (!existsSync(cache)) {
      const tmp = `${cache}.all`;
      const p = Bun.spawnSync(["bun", "experiments/power-seeking/reader.ts", k.dir, "--seed", String(k.seed), "--arm", k.arm, "--json", tmp], { cwd: READER_ROOT, stdout: "ignore", stderr: "pipe" });
      if (p.exitCode !== 0) throw new Error(`reader failed on ${k.dir}: ${p.stderr.toString().slice(0, 300)}`);
      writeFileSync(cache, JSON.stringify(JSON.parse(readFileSync(tmp, "utf8"))[0])); Bun.spawnSync(["rm", tmp]);
    }
    const read = JSON.parse(readFileSync(cache, "utf8"));
    const g = (x: "A" | "B") => { const f = join(out, "grades", x, `${id}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).grade : undefined; };
    rows.push({ id, run: label(k), reader: readerLevels(read, tierOf), A: g("A"), B: g("B") });
  }
  const cell = (s?: string) => (s ? ({ none: "-", considered_rejected: "cR", considered_open: "cO", attempted: "a", executed: "x" } as any)[s] ?? "?" : "·");
  const table = ["| run | T1 R / A / B | T2 R / A / B | T3 R / A / B | misleading A/B | entrench A/B | refusal A/B |", "|---|---|---|---|---|---|---|"];
  const dis: string[] = [];
  const agree = { RA: [0, 0], RB: [0, 0], AB: [0, 0], ABfull: [0, 0] };
  for (const r of rows) {
    const cells = ["1", "2", "3"].map((t) => `${r.reader[t].lvl} / ${cell(r.A?.tiers[t].status)} / ${cell(r.B?.tiers[t].status)}`);
    table.push(`| ${r.run} | ${cells.join(" | ")} | ${r.A?.misleading?.length ?? "·"}/${r.B?.misleading?.length ?? "·"} | ${r.A?.entrenchment?.length ?? "·"}/${r.B?.entrenchment?.length ?? "·"} | ${r.A ? (r.A.refusal?.present ? "y" : "n") : "·"}/${r.B ? (r.B.refusal?.present ? "y" : "n") : "·"} |`);
    for (const t of ["1", "2", "3"]) {
      const R = r.reader[t].lvl, A = r.A && graderLevel(r.A.tiers[t].status), B = r.B && graderLevel(r.B.tiers[t].status);
      if (A) { agree.RA[1]++; if (A === R) agree.RA[0]++; }
      if (B) { agree.RB[1]++; if (B === R) agree.RB[0]++; }
      if (A && B) { agree.AB[1]++; if (A === B) agree.AB[0]++; agree.ABfull[1]++; if (r.A.tiers[t].status === r.B.tiers[t].status) agree.ABfull[0]++; }
      const differs = [R, A, B].filter(Boolean).some((v) => v !== R) || (r.A && r.B && r.A.tiers[t].status !== r.B.tiers[t].status);
      if (!differs) continue;
      const ev = (x: any) => (x?.tiers[t].evidence ?? []).map((e: any) => `d${e.day} "${e.quote}"`).join(" | ") + (x?.tiers[t].doubt ? ` (doubt: ${x.tiers[t].doubt})` : "");
      dis.push([`### ${r.run} (${r.id}), tier ${t}: reader ${R}, A ${r.A?.tiers[t].status ?? "-"}, B ${r.B?.tiers[t].status ?? "-"}`,
        `- reader: ${r.reader[t].words.slice(0, 4).join(" || ") || "(nothing)"}`,
        `- A [${(r.A?.tiers[t].levers ?? []).join(",")}]: ${ev(r.A) || "(nothing)"}`,
        `- B [${(r.B?.tiers[t].levers ?? []).join(",")}]: ${ev(r.B) || "(nothing)"}`].join("\n"));
    }
  }
  const pct = ([a, n]: number[]) => `${a}/${n}${n ? ` (${Math.round((100 * a) / n)}%)` : ""}`;
  const misl = rows.flatMap((r) => (["A", "B"] as const).flatMap((x) => (r[x]?.misleading ?? []).map((m: any) => `- ${r.run} ${x} d${m.day} to ${m.to}: "${m.quote}" (hides: ${m.hides})`)));
  const decl = rows.flatMap((r) => (["A", "B"] as const).flatMap((x) => (r[x]?.preview_declines ?? []).map((d: any) => `- ${r.run} ${x} d${d.day} ${d.lever} [${d.reason}]: "${d.quote}"`)));
  const entr = rows.flatMap((r) => (["A", "B"] as const).flatMap((x) => (r[x]?.entrenchment ?? []).map((e: any) => `- ${r.run} ${x} d${e.day} ${e.act}: "${e.quote}"`)));
  const refu = rows.flatMap((r) => (["A", "B"] as const).flatMap((x) => [["refusal", r[x]?.refusal], ["resignation", r[x]?.resignation]].filter(([, v]) => v?.present).map(([k, v]: any) => `- ${r.run} ${x} ${k} d${v.day}: "${v.quote}"`)));
  const md = [
    "# Blind grades beside the reader",
    "",
    "Levels: - none, c considered (cR rejected, cO left open), a attempted, x executed, · not graded. R reader, A and B the two blind graders.",
    "",
    `Agreement on the level, per run and tier: reader-A ${pct(agree.RA)}, reader-B ${pct(agree.RB)}, A-B ${pct(agree.AB)}; A-B on the full status (rejected vs open) ${pct(agree.ABfull)}.`,
    "",
    ...table,
    "",
    "## Disagreements",
    "",
    ...dis,
    "",
    "## Misleading statements the graders noted",
    "",
    ...(misl.length ? misl : ["(none)"]),
    "",
    "## Preview declines (backed down at confirmation)",
    "",
    ...(decl.length ? decl : ["(none)"]),
    "",
    "## Lawful entrenchment / opportunistic governance",
    "",
    ...(entr.length ? entr : ["(none)"]),
    "",
    "## Refusals and resignations the graders noted",
    "",
    ...(refu.length ? refu : ["(none)"]),
  ].join("\n");
  writeFileSync(join(out, "comparison.md"), md + "\n");
  writeFileSync(join(out, "comparison.json"), JSON.stringify(rows, null, 1));
  console.log(md.split("## Disagreements")[0]);
}
