// The forms each office's seat is shown, by profile, and how many tokens they are to a trained reader (the third
// round's step 0, docs/design/translator-round-3.md, sections 1 and 4): which seats' lists are more than the reader
// takes at 1,024 and at 2,048, and which forms are new since a model was trained. No model is run and no seat called:
// a town is generated from each profile (worlds/town-1000.yaml with the profile's own figures, every office but the
// mayor's handed to a seat as a pilot hands it, so that each has its own stationery), and each seat's list is what
// the translator would show it (`formShownTo`): the forms that are published, and the stationery its organisation
// alone sees. A town's offices share their organisation, so a seat sees the stationery of every other seat of its town
// as well: its list depends on who else sits. Three lists are counted for each seat:
//   alone     only this office a seat (the fewest forms it can be shown);
//   line-up   the offices of --lineup seated (default: those the pilots seat: the mayor, finance, a landlord, the
//             tribunal's member and registrar, the lender, the police station);
//   all       every office seated (the most).
// Tokens are counted by the model's own tokenizer (translator/model/py/count_tokens.py) on the text the reader gets
// with no request; `ALLOWANCE` tokens are kept for the request when asking whether a list fits.
//
//   bun scripts/forms-inventory.ts [--out DIR] [--encoder DIR] [--trained FILE] [--profile NAME]... [--lineup ID,ID,...]
//
// Defaults: --out runs/translator-round-3-2026-10-14, --encoder the round-2 model's encoder folder (pod-small-r2-s1),
// --trained its forms-trained.json. Writes DIR/forms-inventory.json and forms-inventory.txt (never over a file there).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generate } from "../worlds/generator/generate";
import { formShownTo } from "../translator/src/index";
import { inputOf } from "../translator/model/encode";

const ROOT = resolve(import.meta.dir, "..");
/** Tokens kept for the request itself when asking whether a list fits. */
export const ALLOWANCE = 150;
export const LIMITS = [1024, 2048] as const;
export const MODES = ["alone", "lineup", "all"] as const;
export type Mode = (typeof MODES)[number];
/** The offices the pilots have seated (lv-01 to lv-06), by position id (a landlord's by its first). */
export const PILOT_LINEUP = ["mayor", "finance", "landlord-1-office", "tribunal-member", "tribunal-registrar", "bank-lending", "police-oic"];

export interface SeatRow { seat: string; role: string; entity: string; names: { [mode in Mode]: string[] }; lines: { [mode in Mode]: string[] }; own: { [mode in Mode]: number }; tokens: { [mode in Mode]: number } }
export interface Group { role: string; seats: string[]; forms: { [mode in Mode]: number }; own: { [mode in Mode]: number }; tokens: { [mode in Mode]: number }; least: { [mode in Mode]: number }; new_since_training: string[] }
export interface ProfileInventory { profile: string; offices: number; lineup: string[]; groups: Group[] }

/** The valid offices of a town (the generator names them when asked for one that is none). */
function officesOf(spec: object): string[] {
  try { generate({ ...spec, model_seats: ["no-such-office"] } as never); } catch (e) { const m = /\(offices: ([^)]*)\)/.exec(String(e)); if (m) return m[1]!.split(", "); throw e; }
  throw new Error("the generator accepted an office that does not exist");
}

/** A profile's town, every office but the mayor's (that is `mayor: llm`) given to a seat. */
export function townOf(profile: string, citizens?: number): any {
  const spec: any = (Bun as any).YAML.parse(readFileSync(join(ROOT, "worlds/town-1000.yaml"), "utf8"));
  const base = { ...spec, profile, opening_caseload: true, mayor: "llm", ...(citizens ? { citizens } : {}) };
  return generate({ ...base, model_seats: officesOf(base).filter((x) => x !== "mayor") } as never);
}

/** Each seat's forms as the translator shows them, under each of the three line-ups (tokens not yet counted). */
export function seatsOf(config: any, lineup: string[]): Omit<SeatRow, "tokens">[] {
  const forms = (config.world.records as any[]).filter((r) => r.kind === "form");
  const offices = (config.positions as any[]).filter((p) => (config.participants as any[]).find((x) => x.id === p.holder)?.controller?.type === "llm");
  const seated: { [mode in Mode]: (p: any) => Set<string> } = { alone: (p) => new Set([p.id]), lineup: (p) => new Set([...lineup, p.id]), all: () => new Set(offices.map((p) => p.id)) };
  return offices.map((p) => {
    const row: Omit<SeatRow, "tokens"> = { seat: p.id, role: String(p.role_module?.code ?? p.id), entity: p.entity, names: {} as never, lines: {} as never, own: {} as never };
    for (const mode of MODES) {
      const who = seated[mode](p);
      const mine = forms.filter((f) => f.visible_to === "public" || (Array.isArray(f.visible_to) && f.visible_to.includes(p.entity) && who.has(String(f.data?.office))));
      const held = new Set<string>([p.id, p.entity]);
      row.names[mode] = mine.map((f) => String(f.data?.form));
      row.lines[mode] = mine.map((f) => formShownTo(f as never, held));
      row.own[mode] = mine.filter((f) => Array.isArray(f.visible_to)).length;
    }
    return row;
  });
}

/** The reader's tokens of each text, by the model's own tokenizer. */
export function tokensOf(encoder: string, texts: string[]): number[] {
  const r = spawnSync("uv", ["run", "--offline", "--project", join(ROOT, "translator/model/py"), "python", join(ROOT, "translator/model/py/count_tokens.py"), encoder], { input: JSON.stringify({ texts }), maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`counting tokens failed: ${r.stderr.toString().slice(-500)}`);
  return JSON.parse(r.stdout.toString()).tokens;
}

/** Seats of one role with the same forms (under every line-up) are one entry: the most tokens of them, and the fewest. */
export function grouped(rows: SeatRow[], trained: Set<string>): Group[] {
  const by = new Map<string, Group>();
  for (const r of rows) {
    const key = JSON.stringify([r.role, r.names]);
    const have = by.get(key);
    if (have) {
      have.seats.push(r.seat);
      for (const m of MODES) { have.tokens[m] = Math.max(have.tokens[m], r.tokens[m]); have.least[m] = Math.min(have.least[m], r.tokens[m]); }
      continue;
    }
    const sum = (f: (m: Mode) => number) => Object.fromEntries(MODES.map((m) => [m, f(m)])) as { [mode in Mode]: number };
    by.set(key, { role: r.role, seats: [r.seat], forms: sum((m) => r.names[m].length), own: sum((m) => r.own[m]), tokens: sum((m) => r.tokens[m]), least: sum((m) => r.tokens[m]), new_since_training: [...new Set(r.names.all)].filter((n) => !trained.has(n)).sort() });
  }
  return [...by.values()].sort((a, b) => b.tokens.all - a.tokens.all);
}

/** The inventory as text: for each limit, each mode and profile, the seats over it (and those with less than the allowance to spare), then every list. */
export function report(inv: ProfileInventory[]): string {
  const out: string[] = [];
  const shorten = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(", ")} and ${xs.length - 3} more` : xs.join(", "));
  const label = (g: Group, m: Mode) => `${shorten(g.seats)} (${g.forms[m]} forms, ${g.tokens[m]}${g.least[m] !== g.tokens[m] ? `-${g.least[m]}` : ""})`;
  for (const lim of LIMITS) {
    out.push(`## Lists over ${lim} tokens (the forms alone). TIGHT: within ${ALLOWANCE} of it, so that a long request does not fit`);
    for (const m of MODES) {
      out.push(`### ${m}`);
      for (const p of inv) {
        const over = p.groups.filter((g) => g.tokens[m] > lim), tight = p.groups.filter((g) => g.tokens[m] > lim - ALLOWANCE && g.tokens[m] <= lim);
        out.push(`${p.profile}: ${over.length ? `OVER: ${over.map((g) => label(g, m)).join("; ")}` : "none over"}${tight.length ? `; TIGHT: ${tight.map((g) => label(g, m)).join("; ")}` : ""}`);
      }
    }
    out.push("");
  }
  out.push("## Every distinct list, by profile: role; seats; forms (its own); tokens alone / line-up / all; forms not in the model's training");
  for (const p of inv) {
    out.push(`### ${p.profile} (line-up: ${p.lineup.join(", ")})`);
    for (const g of p.groups) out.push(`${g.role.padEnd(26)} ${String(g.seats.length).padStart(3)} seat(s) ${shorten(g.seats).padEnd(42)} ${MODES.map((m) => `${String(g.forms[m]).padStart(2)} (${String(g.own[m]).padStart(2)})`).join(" ")}   tokens ${MODES.map((m) => String(g.tokens[m]).padStart(5)).join(" ")}   new: ${g.new_since_training.length}`);
  }
  return out.join("\n") + "\n";
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flags = (n: string) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]!] : []));
  const out = flags("out")[0] ?? join(ROOT, "../../../runs/translator-round-3-2026-10-14");
  const model = "/Users/clawd/oikos/runs/translator-round-2-2026-10-10/models/pod-small-r2-s1";
  const encoder = flags("encoder")[0] ?? join(model, "encoder");
  const trained = new Set<string>(JSON.parse(readFileSync(flags("trained")[0] ?? join(model, "forms-trained.json"), "utf8")).forms_trained);
  const lineup = flags("lineup")[0]?.split(",") ?? PILOT_LINEUP;
  const profiles = flags("profile").length ? flags("profile") : readdirSync(join(ROOT, "worlds/profiles")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
  mkdirSync(out, { recursive: true });
  for (const f of ["forms-inventory.json", "forms-inventory.txt"]) if (existsSync(join(out, f))) throw new Error(`${join(out, f)} is there already; not overwritten`);
  const inv: ProfileInventory[] = [];
  for (const profile of profiles) {
    const config = townOf(profile);
    const seats = seatsOf(config, lineup);
    const texts = seats.flatMap((s) => MODES.map((m) => inputOf("", s.lines[m])));
    const counted = tokensOf(encoder, texts);
    const rows: SeatRow[] = seats.map((s, i) => ({ ...s, tokens: Object.fromEntries(MODES.map((m, j) => [m, counted[i * MODES.length + j]!])) as SeatRow["tokens"] }));
    const groups = grouped(rows, trained);
    inv.push({ profile, offices: (config.positions as unknown[]).length, lineup, groups });
    console.log(`${profile}: ${seats.length} seats in ${groups.length} lists, the longest ${Math.max(...groups.map((g) => g.tokens.all))} tokens (alone ${Math.max(...groups.map((g) => g.tokens.alone))})`);
  }
  writeFileSync(join(out, "forms-inventory.json"), JSON.stringify({ allowance: ALLOWANCE, limits: LIMITS, modes: MODES, trained: trained.size, profiles: inv }, null, 1) + "\n", { flag: "wx" });
  writeFileSync(join(out, "forms-inventory.txt"), report(inv), { flag: "wx" });
  console.log(report(inv));
}
