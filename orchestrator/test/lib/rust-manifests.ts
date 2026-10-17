// The Rust actor kinds' manifests (kernel/crates/actors; `oikos-kernel manifests`), for the backstops: what the Rust
// world's actors declare is held to the same lists as the TS modules' (docs/port-guide.md section 7).

import { kernelBinary } from "../../src/kernel";

export interface RustManifest { name: string; keeps?: { what: string; why: string }[]; boundary?: { what: string; why: string }[]; params?: { [k: string]: any } }

let cached: RustManifest[] | undefined;
export function rustManifests(): RustManifest[] {
  if (!cached) {
    const r = Bun.spawnSync([kernelBinary(), "manifests"], { stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`oikos-kernel manifests: ${r.stderr.toString()}`);
    cached = JSON.parse(r.stdout.toString()) as RustManifest[];
  }
  return cached;
}
