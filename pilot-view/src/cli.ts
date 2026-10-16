// `oikos pilot-view <run-dir> [--out file.html] [--twin DIR | --no-twin]`: a finished pilot run as one HTML page.
// The run is only read. The page goes where --out says (never inside the run's folder), by default <pilot>.html in the
// working folder.

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { buildView } from "./build";
import { renderPage } from "./render";

const MAX_BYTES = 9_500_000; // (the page stays well under 10 MB: caps are tightened until it does)

export async function runPilotView(argv: string[]): Promise<string> {
  const args = [...argv];
  const take = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const has = (name: string) => { const i = args.indexOf(`--${name}`); if (i < 0) return false; args.splice(i, 1); return true; };
  const out = take("out"), twinDir = take("twin"), noTwin = has("no-twin"), quiet = has("quiet");
  const dir = args[0];
  if (!dir) throw new Error("usage: oikos pilot-view <run-dir> [--out file.html] [--twin DIR | --no-twin]");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder`);
  const target = resolve(out ?? `${basename(resolve(dir))}.html`);
  const rel = relative(resolve(dir), target);
  if (!rel.startsWith("..") && !rel.startsWith("/")) throw new Error(`refusing to write inside the run's folder (${target}): the viewer only reads a run`);
  const log = quiet ? undefined : (s: string) => console.error(s);
  let scale = 1, html = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const data = await buildView(dir, { twin: noTwin ? false : twinDir, log, caps: { reading: Math.round(12_000 * scale), result: Math.round(2_500 * scale), say: Math.round(2_000 * scale), actorItems: Math.max(8, Math.round(40 * scale)) } });
    html = renderPage(data);
    if (Buffer.byteLength(html) <= MAX_BYTES) break;
    scale /= 2; // (a very large run: shorter excerpts, the same pages)
    log?.(`page is ${(Buffer.byteLength(html) / 1e6).toFixed(1)} MB; shortening excerpts`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html);
  return target;
}
