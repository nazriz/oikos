// `oikos lens [--runs DIR] [--port 4322] [--dev] [--no-background]`: serve Lens on 127.0.0.1 (docs/design/lens.md).
//   oikos lens index <key>   make one run's bundle and print its manifest (no server)
//   oikos lens list          print the catalogue
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
  const { url, paths } = startServer({ runs, views, port: flag("port") ? Number(flag("port")) : undefined, development: has("dev"), background: !has("no-background") });
  console.log(`Lens on ${url} (runs: ${paths.runs}; its own files: ${paths.views})`);
  await new Promise(() => {});
}

if (import.meta.main) await runLens(process.argv.slice(2));
