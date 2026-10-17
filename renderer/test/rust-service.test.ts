// The Rust data layer (kernel/crates/explore) against the TS index: the same fixture log, the same routes, the same
// bodies. Both are asked over HTTP (the TS `serve`, and the built `oikos-explore`), so what the Three.js client reads is
// what is compared. Skipped, with a message, when the binary is not built (`cargo build -p oikos-explore` in kernel/).
//
// Documented harmless differences, left out of the comparison: `meta.indexSeconds` (timings) and `meta.state` (the Rust
// index says whether it is reading a finished log or a live run; the TS index has no such field).

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pilotRuns } from "../src/paths";
import { rustBinary } from "../src/rust";
import { serve } from "../src/server";
import { writeFixtureRun } from "./fixture";

const bin = rustBinary();
const base = mkdtempSync(join(tmpdir(), "oikos-renderer-rust-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const same = bin ? test : test.skip;
if (!bin) console.log("skipped: oikos-explore is not built (cargo build -p oikos-explore, in kernel/)");

const scrub = (w: any) => { if (w?.meta) { delete w.meta.indexSeconds; delete w.meta.state; } return w; };

same("the Rust service and the TS index give the same bodies for the fixture", async () => {
  const dir = join(base, "runs", "fixture-run");
  const log = writeFixtureRun(dir);
  const entries = pilotRuns("/nonexistent", [dir]);
  const key = entries[0]!.key;
  const ts = await serve({ port: 0, prefix: "", runs: entries, single: key });
  const child = Bun.spawn([bin!, "serve", "--port", "0", "--watch-stdin", "--run", `${key}=${log}`], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  try {
    const reader = child.stdout.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    const rust = /http:\/\/127\.0\.0\.1:\d+/.exec(first)![0];
    const tsUrl = ts.url.replace(/\/$/, "");
    const wait = async (base: string) => { for (let i = 0; i < 300; i++) { const st = await (await fetch(`${base}/api/r/${key}/status?open=1`)).json(); if (st.state === "ready") return; if (st.state === "failed") throw new Error(st.message); await Bun.sleep(50); } throw new Error("never ready"); };
    await wait(tsUrl); await wait(rust);
    const get = async (base: string, p: string) => (await fetch(`${base}/api/r/${key}/${p}`));
    const both = async (p: string) => {
      const [a, b] = await Promise.all([get(tsUrl, p), get(rust, p)]);
      expect(b.status, p).toBe(a.status);
      return [await a.json(), await b.json()] as const;
    };
    const [wa, wb] = await both("world");
    expect(scrub(wb)).toEqual(scrub(wa));
    const T = 3 * 86400;
    for (const p of [`person/c1?t=${T}`, `person/c2?t=${T}`, `person/c2?t=${86400 + 5000}`, "person/nobody", `org/tribunal?t=${T}`, `org/tribunal?t=86400`, "org/bank", `building/0?t=${T}`, `building/2?t=${86400 + 5000}`, "building/99"]) {
      const [a, b] = await both(p);
      expect(b, p).toEqual(a);
    }
    const kept = wa.meta.kept as number;
    for (let o = 0; o < kept; o++) {
      for (const p of [`trace/${o}`, `trace/${o}?about=c1`, `trace/${o}?about=c2`]) { const [a, b] = await both(p); expect(b, p).toEqual(a); }
      const [la, lb] = await Promise.all([get(tsUrl, `line/${o}`), get(rust, `line/${o}`)]);
      expect(await lb.text()).toBe(await la.text());
    }
    for (const a of wa.seatActs) { const [x, y] = await both(`act/${a.ord}`); expect(y).toEqual(x); }
    const [sa, sb] = await both("seat/member-system"); expect(sb).toEqual(sa);
    for (const name of ["where", "pulses", "money", "agency", "moves", "moves?from=1&to=2"]) {
      const [a, b] = await Promise.all([get(tsUrl, `bin/${name}`), get(rust, `bin/${name}`)]);
      expect(new Uint8Array(await b.arrayBuffer()), name).toEqual(new Uint8Array(await a.arrayBuffer()));
    }
    // and the TS server, pointed at the Rust one, passes the Rust bodies through unchanged
    const proxied = await serve({ port: 0, prefix: "", runs: entries, single: key, api: rust });
    try {
      const pw = await (await fetch(`${proxied.url}api/r/${key}/world`)).json();
      expect(scrub(pw)).toEqual(scrub(wb));
      const pr = await (await fetch(`${proxied.url}api/runs`)).json();
      expect(pr.runs[0].key).toBe(key);
      expect((await fetch(`${proxied.url}api/r/${key}/world`, { method: "POST" })).status).toBe(405);
    } finally { proxied.server.stop(true); }
  } finally { child.kill(); ts.server.stop(true); }
}, 120_000);
