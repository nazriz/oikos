// The client, built once at start (Bun.build of src/client/index.html) and served compressed: brotli or gzip, made
// ahead, with the hashed files cached for good and the page itself never. Bun's own HTML-import serving sent ~3.6 MB
// uncompressed and inlined the fonts into the CSS as base64; over the tailnet to a phone that was most of the wait.
// The fonts are real woff2 files under /fonts/, the three the first screen uses preloaded (docs/decisions.md,
// "Lens: smooth"). In development (--dev) the page is built again on each load of "/", so a refresh shows a change.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const CLIENT = join(import.meta.dir, "../client/index.html");
/** The faces the first screen draws with, fetched before the CSS asks for them. */
const PRELOAD = ["overpass-latin-wght-normal.woff2", "source-serif-4-latin-opsz-normal.woff2", "source-serif-4-latin-opsz-italic.woff2"];

type Bytes = Uint8Array<ArrayBuffer>;
interface Asset { type: string; raw: Bytes; gz?: Bytes; br?: Bytes }

async function build(dev: boolean): Promise<Map<string, Asset>> {
  const r = await Bun.build({
    entrypoints: [CLIENT],
    minify: !dev,
    target: "browser",
    // (The fonts stay files, served below: inlined, they were 0.8 MB of base64 in the CSS.)
    external: ["/fonts/*"],
    naming: { entry: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
    publicPath: "/",
  });
  if (!r.success) throw new AggregateError(r.logs, "the client did not build");
  const out = new Map<string, Asset>();
  for (const o of r.outputs) {
    let raw: Bytes = new Uint8Array(await o.arrayBuffer());
    const name = o.path.replace(/^\.\//, "");
    const isPage = name.endsWith(".html");
    if (isPage) {
      const links = PRELOAD.map((f) => `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/${f}">`).join("");
      raw = new Uint8Array(new TextEncoder().encode(new TextDecoder().decode(raw).replace("</head>", `${links}</head>`)));
    }
    out.set(isPage ? "" : name, compress(o.type, raw, !dev));
  }
  return out;
}

function compress(type: string, raw: Bytes, yes: boolean): Asset {
  if (!yes || raw.length < 1024) return { type, raw };
  const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
  return { type, raw, gz: new Uint8Array(Bun.gzipSync(raw, { level: 9 })), br: new Uint8Array(br) };
}

function respond(req: Request, a: Asset, cache: string): Response {
  const accept = req.headers.get("accept-encoding") ?? "";
  const headers: Record<string, string> = { "content-type": a.type, "cache-control": cache, vary: "accept-encoding" };
  if (a.br && /\bbr\b/.test(accept)) return new Response(a.br, { headers: { ...headers, "content-encoding": "br" } });
  if (a.gz && accept.includes("gzip")) return new Response(a.gz, { headers: { ...headers, "content-encoding": "gzip" } });
  return new Response(a.raw, { headers });
}

/** The client's routes: the page, its hashed files and the fonts. */
export function clientRoutes(dev: boolean) {
  let built = build(dev);
  built.catch((e) => console.error(e));
  return {
    async page(req: Request): Promise<Response> {
      if (dev) built = build(dev);
      const page = (await built).get("")!;
      return respond(req, page, "no-cache");
    },
    async asset(req: Request): Promise<Response | null> {
      const name = new URL(req.url).pathname.slice(1);
      const a = (await built).get(name);
      return a ? respond(req, a, dev ? "no-cache" : "public, max-age=31536000, immutable") : null;
    },
    font(name: string): Response | null {
      const path = fontFile(name);
      // (woff2 is compressed already.)
      return path ? new Response(readFileSync(path), { headers: { "content-type": "font/woff2", "cache-control": "public, max-age=31536000, immutable" } }) : null;
    },
  };
}

const fonts = new Map<string, string>();
/** Where a font named in src/client/fonts.css (/fonts/<name>) is on disk: in its fontsource package. */
export function fontFile(name: string): string | null {
  if (!/^[a-z0-9-]+\.woff2$/.test(name)) return null;
  let path = fonts.get(name);
  if (!path) {
    const pkg = ["overpass", "source-serif-4", "jetbrains-mono"].find((p) => name.startsWith(`${p}-`));
    if (!pkg) return null;
    path = join(dirname(Bun.resolveSync(`@fontsource-variable/${pkg}/package.json`, import.meta.dir)), "files", basename(name));
    if (!existsSync(path)) return null;
    fonts.set(name, path);
  }
  return path;
}
