// `oikos lens [--runs DIR] [--port 4322] [--no-background] [--dev]`: serve Lens on 127.0.0.1 (docs/design/lens.md).
//   --dev is Bun's development mode (hot reload): it breaks deck.gl's shaders, so the map does not draw under it.
//   oikos lens index <key>   make one run's bundle and print its manifest (no server)
//   oikos lens list          print the catalogue
//   oikos lens inspect <experiment dir> [--with-code]   every fork's seat as an Inspect AI log, in <views>/inspect/<experiment>/
import { startServer } from "./server";
import { Lens } from "./service";
import { lensPaths } from "./paths";

export async function runLens(argv: string[]): Promise<void> {
  const flag = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  };
  const has = (name: string) => argv.includes(`--${name}`);
  const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && /^--(runs|port|views)$/.test(argv[i - 1]!)));
  const runs = flag("runs");
  const views = flag("views");

  if (positional[0] === "inspect" && positional[1]) {
    const { inspectExperiment } = await import("./inspect-export");
    const { join, resolve } = await import("node:path");
    const out = join(lensPaths({ runs, views }).views, "inspect");
    const files = await inspectExperiment(resolve(positional[1]), out, { withCode: has("with-code"), log: (s) => console.error(s) });
    console.log(`${files.length} Inspect logs in ${join(out, positional[1].replace(/\/+$/, "").split("/").pop()!)}; open with: uvx --from inspect-ai inspect view --log-dir <that folder>`);
    return;
  }
  if (positional[0] === "list") {
    const lens = new Lens(lensPaths({ runs, views }), { background: false });
    const c = await lens.list(true);
    for (const r of c.runs) console.log(`${r.kind.padEnd(5)} ${r.indexed ? "*" : " "} ${r.key}`);
    console.error(`${c.runs.length} runs, scanned in ${c.scanMs} ms`);
    return;
  }
  if (positional[0] === "index" && positional[1]) {
    const lens = new Lens(lensPaths({ runs, views }), { background: false });
    const e = await lens.catalogue.find(positional[1]);
    if (!e) throw new Error(`no run ${positional[1]} (oikos lens list)`);
    await new Promise<void>((res, rej) =>
      lens.open(e, (s) => {
        if (s.state === "indexing") process.stderr.write(`\r${s.lines.toLocaleString()} lines, day ${Math.floor(s.t / 86400)}${s.fraction !== null ? ` (${Math.round(s.fraction * 100)}%)` : ""}   `);
        if (s.state === "ready") res();
        if (s.state === "failed") rej(new Error(s.error));
      }),
    );
    process.stderr.write("\n");
    console.log(JSON.stringify(lens.manifest(e), null, 1));
    return;
  }
  const { url, paths, lens } = startServer({ runs, views, port: flag("port") ? Number(flag("port")) : undefined, development: has("dev"), background: !has("no-background") });
  // (Stopping the server stops the reading it started in the background, its child process included.)
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.on(sig, () => {
      lens.stop();
      process.exit(0);
    });
  console.log(`Lens on ${url} (runs: ${paths.runs}; its own files: ${paths.views})`);
  await new Promise(() => {});
}

if (import.meta.main) await runLens(process.argv.slice(2));
