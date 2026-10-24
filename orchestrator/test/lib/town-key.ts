// The key of a generated town written to a file for the Rust tests (write-town.ts): a hash of everything the generator reads, so that a
// cached copy is used only when regenerating it would give the same bytes. A copy made by an older generator can then neither pass nor
// fail a test by being stale (2026-10-24: a cached town without `life.majority` failed three tests that a fresh checkout passed, and a
// stale one passed a test a fresh one failed).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** What the generator reads, relative to the repository: its own sources, the profiles, the contracts (schemas), the rules it calls (the
 * participants' sources and, where built, the engine's native module). The spec and the overrides are given by the caller. */
export const INPUTS = ["worlds/generator", "worlds/profiles", "worlds/package.json", "participants/src", "contracts"];
const NATIVE = ["kernel/target/release", "kernel/target/debug"].flatMap((d) => ["liboikos_napi.dylib", "liboikos_napi.so"].map((f) => join(d, f)));

function files(root: string, rel: string, out: string[]): void {
  const p = join(root, rel);
  if (!existsSync(p)) return;
  if (statSync(p).isFile()) { out.push(rel); return; }
  for (const e of readdirSync(p).sort()) if (e !== "node_modules" && !e.startsWith(".")) files(root, join(rel, e), out);
}

export function townKey(root: string, parts: string[]): string {
  const h = new Bun.CryptoHasher("sha256");
  const list: string[] = [];
  for (const i of INPUTS) files(root, i, list);
  const native = NATIVE.find((f) => existsSync(join(root, f)));
  if (native) list.push(native);
  for (const f of list) h.update(f).update("\0").update(readFileSync(join(root, f))).update("\0");
  for (const x of parts) h.update(x).update("\0");
  return h.digest("hex");
}
