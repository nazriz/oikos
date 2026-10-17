// The explorer only reads a run (docs/design/renderer.md 1): nothing in the package imports the kernel's client, the
// run driver or anything that starts a process; indexing and serving a run leave every file in its folder with the same
// bytes and times; the index goes beside the runs, never inside a run; the server answers GET only, on 127.0.0.1, and
// never shows a debrief.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertOutside, pilotRuns, viewsRoot } from "../src/paths";
import { serve } from "../src/server";
import { writeFixtureRun } from "./fixture";

const base = mkdtempSync(join(tmpdir(), "oikos-renderer-ro-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const snapshot = (dir: string) => readdirSync(dir, { recursive: true }).map(String).sort().map((f) => { const s = statSync(join(dir, f)); return `${f}:${s.size}:${s.mtimeMs}:${s.isFile() ? Bun.hash(readFileSync(join(dir, f))) : "d"}`; });

test("no file of the package imports the kernel client, the run driver or a process spawner", () => {
  const src = join(import.meta.dir, "..", "src");
  for (const f of readdirSync(src, { recursive: true }).map(String).filter((x) => x.endsWith(".ts"))) {
    const text = readFileSync(join(src, f), "utf8");
    expect(text, f).not.toMatch(/from ["'][^"']*orchestrator\/src\/(kernel|run|batch|resume|watchdog)["']/);
    // (the one exception: rust.ts starts the built Rust data layer, `oikos-explore`, and nothing else; checked below)
    if (f !== "rust.ts") expect(text, f).not.toMatch(/node:child_process|Bun\.spawn|\bspawnSync\b|\bexecSync\b/);
    expect(text, f).not.toMatch(/writeFileSync\([^)]*run|rmSync\([^)]*entry\.dir/);
  }
});

test("the one process the package starts is the Rust data layer, with the runs' logs and nothing that writes", () => {
  const text = readFileSync(join(import.meta.dir, "..", "src", "rust.ts"), "utf8");
  expect(text.match(/Bun\.spawn\(/g)).toHaveLength(1);
  expect(text).toMatch(/Bun\.spawn\(\[bin, \.\.\.args\]/);
  expect(text).not.toMatch(/node:child_process|\bspawnSync\b|\bexecSync\b/);
  expect(text).toContain("assertOutside(r.dir, out)"); // (the pilot's data goes beside the runs, never inside one)
});

test("indexing and serving a run changes nothing in its folder; the index lives beside it", async () => {
  const runs = join(base, "runs"), dir = join(runs, "fixture-run");
  writeFixtureRun(dir);
  const before = snapshot(dir);
  expect(viewsRoot(dir)).toBe(join(runs, "views"));
  expect(() => assertOutside(dir, join(dir, "views"))).toThrow("only reads");
  const entries = pilotRuns("/nonexistent", [dir]);
  const { server, url } = await serve({ port: 0, prefix: "/explore", runs: entries, single: entries[0]!.key });
  try {
    const api = `${url}api/r/${entries[0]!.key}`;
    for (let i = 0; i < 100; i++) { const st = await (await fetch(`${api}/status?open=1`)).json(); if (st.state === "ready") break; if (st.state === "failed") throw new Error(st.message); await Bun.sleep(100); }
    expect(url.startsWith("http://127.0.0.1:")).toBe(true);
    const world = await (await fetch(`${api}/world`)).json();
    expect(world.meta.persons).toBe(2);
    expect(world.seatActs).toHaveLength(1);
    const person = await (await fetch(`${api}/person/c1?t=${3 * 86400}`)).json();
    expect(person.home.structure).toBe("house-1");
    const act = await (await fetch(`${api}/act/${world.seatActs[0].ord}`)).json();
    expect(act.trace[0]).toMatchObject({ role: "act", cls: "seat" });
    const page = await (await fetch(url)).text();
    expect(page).toContain("/explore/app.js");
    const js = await (await fetch(`${url}app.js`)).text();
    expect(js).not.toMatch(/https?:\/\/(cdn|unpkg|fonts)\./);
    expect((await fetch(`${api}/world`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${url.replace("/explore/", "/")}api/runs`)).status).toBe(404);
    for (const p of ["world", `person/c1`, `act/${world.seatActs[0].ord}`]) expect(await (await fetch(`${api}/${p}`)).text()).not.toContain("SECRET-DEBRIEF");
  } finally { server.stop(true); }
  expect(snapshot(dir)).toEqual(before);
  expect(readdirSync(join(runs, "views")).length).toBe(1);
}, 60_000);
