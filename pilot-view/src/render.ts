// The page: one self-contained HTML file (CSS, script and the run's data inline; no network).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ViewData } from "./build";

const here = import.meta.dir;

/** JSON safe inside a <script> element. */
export const embed = (data: unknown): string => JSON.stringify(data).replace(/</g, "\\u003c").replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028").replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");

export function renderPage(data: ViewData): string {
  const css = readFileSync(join(here, "page.css"), "utf8"), js = readFileSync(join(here, "page.js"), "utf8");
  const title = `Pilot ${data.overview.pilot}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<&>]/g, "")}</title>
<style>
${css}
</style>
</head>
<body>
<header class="top"><h1 id="title"></h1><div class="sub" id="subtitle"></div><nav class="tabs" id="tabs"></nav></header>
<main id="view"></main>
<noscript><main><p>This page needs JavaScript to show the run.</p></main></noscript>
<script id="data" type="application/json">${embed(data)}</script>
<script>
${js.replace(/<\/script/gi, "<\\/script")}
</script>
</body>
</html>
`;
}
