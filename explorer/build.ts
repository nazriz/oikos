#!/usr/bin/env bun
// Builds the Bevy explorer for the browser: two WebAssembly packages from the same crate, one for WebGPU and one for
// WebGL 2 (Bevy picks its backend at compile time; the page loads the one the browser can run), each through
// wasm-bindgen into explorer/pkg/<flavour>/ (not in git). `--native` also builds the desktop binary.
//   bun explorer/build.ts [--only webgl2|webgpu] [--native] [--quick]
// Needs: the Rust toolchain in explorer/rust-toolchain.toml with the wasm32-unknown-unknown target, and wasm-bindgen-cli
// at the version in explorer/Cargo.lock (`cargo install wasm-bindgen-cli --version <it> --locked`).

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = import.meta.dir;
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
// (--quick: no whole-program optimisation, for working on it)
const profile = args.includes("--quick") ? "wasm-quick" : "wasm-release";
const outProfile = profile;
const home = process.env.HOME ?? "";
const env = { ...process.env, PATH: `${home}/.cargo/bin:${process.env.PATH}` };

function run(cmd: string[]) {
  console.error(`$ ${cmd.join(" ")}`);
  const r = Bun.spawnSync(cmd, { cwd: DIR, env, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`${cmd[0]} failed (${r.exitCode})`);
}

const lock = readFileSync(join(DIR, "Cargo.lock"), "utf8");
const want = /name = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1];
const have = new TextDecoder().decode(Bun.spawnSync(["wasm-bindgen", "--version"], { env }).stdout).trim().split(" ")[1];
if (want && have !== want) throw new Error(`wasm-bindgen-cli ${have ?? "is missing"}; the crate uses ${want}: cargo install wasm-bindgen-cli --version ${want} --locked`);

for (const flavour of ["webgl2", "webgpu"]) {
  if (only && only !== flavour) continue;
  const target = join(DIR, "target", flavour);
  run(["cargo", "build", "--lib", "--target", "wasm32-unknown-unknown", "--profile", profile, "--features", flavour, "--target-dir", target]);
  const wasm = join(target, "wasm32-unknown-unknown", outProfile, "oikos_explorer.wasm");
  const out = join(DIR, "pkg", flavour);
  mkdirSync(out, { recursive: true });
  run(["wasm-bindgen", "--target", "web", "--no-typescript", "--out-dir", out, "--out-name", "oikos_explorer", wasm]);
  const size = statSync(join(out, "oikos_explorer_bg.wasm")).size;
  console.error(`${flavour}: ${(size / 1048576).toFixed(1)} MB in ${out}`);
}
if (args.includes("--native")) run(["cargo", "build", "--release", "--features", "native", "--bin", "oikos-explorer"]);
if (!existsSync(join(DIR, "pkg"))) throw new Error("nothing built");
