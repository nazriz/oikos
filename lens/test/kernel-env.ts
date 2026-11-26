// Imported first by the tests that make a mock run: a worktree often has no kernel build of its own, so point at the
// main checkout's (as Lens itself falls back to), before any module that reads the kernel's path is loaded. With no
// kernel anywhere, say so at once rather than letting the mock run wait out the test's time limit.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "../../kernel/target/release");
if (!process.env.OIKOS_KERNEL && !existsSync(join(repo, "oikos-kernel"))) {
  const main = join(homedir(), "oikos/kernel/target/release");
  if (existsSync(join(main, "oikos-kernel"))) {
    process.env.OIKOS_KERNEL = join(main, "oikos-kernel");
    for (const f of ["liboikos_napi.dylib", "liboikos_napi.so"]) if (existsSync(join(main, f))) process.env.OIKOS_ENGINE_MODULE ??= join(main, f);
  }
}
if (!process.env.OIKOS_KERNEL && !existsSync(join(repo, "oikos-kernel")))
  throw new Error("no kernel build: run `bun run kernel` (or set OIKOS_KERNEL and OIKOS_ENGINE_MODULE) before this test");
