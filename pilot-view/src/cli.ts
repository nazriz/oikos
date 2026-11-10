// `oikos pilot-view <run-dir | experiment-dir | seed-dir> [--arm NAME] [--out file.html | folder] [--twin DIR | --no-twin]`:
// a finished pilot run, or each model arm of an experiment's forks, as one HTML page each. The run is only read. A page
// goes where --out says (never inside the run's folder), by default <pilot>.html in the working folder; an experiment
// with several arms writes one page per arm into a folder (--out, by default <experiment>/) with an index.

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { buildView, type ForkInput } from "./build";
import { forkInputs, isExperimentDir, isSeedDir } from "./fork";
import { renderPage } from "./render";

const MAX_BYTES = 9_500_000; // (the page stays well under 10 MB: caps are tightened until it does)
const USAGE = "usage: oikos pilot-view <run-dir | experiment-dir | seed-dir> [--arm NAME] [--out file.html | folder] [--twin DIR | --no-twin]";

const inside = (dir: string, target: string) => { const rel = relative(resolve(dir), target); return !rel.startsWith("..") && !rel.startsWith("/"); };

async function page(dir: string, o: { twin?: string | false; fork?: ForkInput; log?: (s: string) => void }): Promise<string> {
  // (An experiment's seat is shown everything it was given: its prompts are kept whole unless the page would be too big.)
  const base = o.fork ? { reading: 200_000, result: 40_000, say: 40_000, actorItems: 40 } : { reading: 12_000, result: 2_500, say: 2_000, actorItems: 40 };
  let scale = 1, html = "";
  for (let attempt = 0; attempt < 8; attempt++) {
    const data = await buildView(dir, { twin: o.twin, fork: o.fork, log: o.log, caps: { reading: Math.round(base.reading * scale), result: Math.round(base.result * scale), say: Math.round(base.say * scale), actorItems: Math.max(8, Math.round(base.actorItems * scale)) } });
    html = renderPage(data);
    if (Buffer.byteLength(html) <= MAX_BYTES) break;
    scale /= 2; // (a very large run: shorter excerpts, the same pages)
    o.log?.(`page is ${(Buffer.byteLength(html) / 1e6).toFixed(1)} MB; shortening excerpts`);
  }
  return html;
}

export async function runPilotView(argv: string[]): Promise<string> {
  const args = [...argv];
  const take = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const has = (name: string) => { const i = args.indexOf(`--${name}`); if (i < 0) return false; args.splice(i, 1); return true; };
  const out = take("out"), twinDir = take("twin"), arm = take("arm"), noTwin = has("no-twin"), quiet = has("quiet");
  const dir = args[0];
  if (!dir) throw new Error(USAGE);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder`);
  const log = quiet ? undefined : (s: string) => console.error(s);
  const refuse = (target: string, runDir: string) => { if (inside(runDir, target)) throw new Error(`refusing to write inside the run's folder (${target}): the viewer only reads a run`); };

  if (isExperimentDir(dir) || isSeedDir(dir)) {
    const forks = forkInputs(dir, arm);
    if (!forks.length) throw new Error(`no model arm with a log in ${dir}`);
    const root = isExperimentDir(dir) ? dir : existsSync(join(dir, "..", "spec.json")) ? join(dir, "..") : dir;
    const one = forks.length === 1 && (!out || out.endsWith(".html"));
    const folder = resolve(one ? dirname(out ?? ".") : out ?? basename(resolve(root)));
    const files: string[] = [];
    const fileOf = (f: (typeof forks)[number]) => (one && out ? resolve(out) : join(folder, `${basename(f.seedDir)}.${f.arm}.html`));
    for (const f of forks) refuse(fileOf(f), root);
    for (const f of forks) {
      log?.(`${basename(f.seedDir)} / ${f.arm}`);
      const target = fileOf(f);
      // (The other arms' pages, for the overview's links; a single page has none.)
      f.input.info.pages = one ? {} : Object.fromEntries(forks.filter((g) => g.seedDir === f.seedDir).map((g) => [g.arm, basename(fileOf(g))]));
      const html = await page(f.seedDir, { twin: noTwin ? false : undefined, fork: f.input, log });
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, html);
      files.push(target);
    }
    if (!one) {
      const index = join(folder, "index.html");
      refuse(index, root);
      const items = forks.map((f) => `<li><a href="${basename(fileOf(f))}">${basename(f.seedDir)} / ${f.arm}</a> (${String(f.input.info.steward?.model ?? f.input.info.steward?.kind ?? "").replace(/[<&>]/g, "")})</li>`).join("\n");
      writeFileSync(index, `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${basename(resolve(root)).replace(/[<&>]/g, "")}</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:720px;padding:16px;background:#fff;color:#111}@media (prefers-color-scheme: dark){body{background:#111;color:#eee}a{color:#8ab4ff}}</style></head><body><h1>${basename(resolve(root)).replace(/[<&>]/g, "")}</h1><p>One page per arm and seed.</p><ul>\n${items}\n</ul></body></html>\n`);
      files.push(index);
    }
    return files.join("\n");
  }

  const target = resolve(out ?? `${basename(resolve(dir))}.html`);
  refuse(target, dir);
  const html = await page(dir, { twin: noTwin ? false : twinDir, log });
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html);
  return target;
}
