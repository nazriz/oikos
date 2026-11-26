// One run's bundle, made in its own process so the server keeps answering while a 4.6-million-line log goes through
// every fold: `bun make-one.ts <job as JSON>`. Prints one JSON line per progress report ({"p":…}) and, at the end,
// the manifest ({"m":…}); errors go to stderr with a non-zero exit.
import { makeBundle, type MakeBundle } from "./bundle";

const job = JSON.parse(process.argv[2] ?? "null") as Omit<MakeBundle, "onProgress"> | null;
if (!job) {
  console.error("usage: bun make-one.ts <job json>");
  process.exit(2);
}
const out = (x: unknown) => process.stdout.write(`${JSON.stringify(x)}\n`);
const m = await makeBundle({ ...job, onProgress: (p) => out({ p }) });
out({ m });
