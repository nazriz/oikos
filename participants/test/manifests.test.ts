// The manifests (participants/manifests) say what the modules do: written from them, and kept in step.

import { expect, test } from "bun:test";
import { join } from "node:path";
import { manifests, modules, paramErrors } from "../src";

test("every module has a manifest that matches it (regenerate with: bun participants/scripts/manifests.ts)", () => {
  const r = Bun.spawnSync(["bun", join(import.meta.dir, "../scripts/manifests.ts"), "--check"]);
  expect(r.stdout.toString()).toBe("");
  expect(r.exitCode).toBe(0);
  for (const [name, m] of Object.entries(modules)) {
    if (!name.includes(".")) continue; // (the do-nothing stand-in)
    expect(manifests().get(name)?.version).toBe(m.version);
  }
});

test("a world's parameters are checked against the module's manifest: unknown or mistyped ones are named", () => {
  expect(paramErrors("firm.landlord", { cut_bps: 500, base_rent: {} })).toEqual([]);
  expect(paramErrors("firm.landlord", { cut_bsp: 500 })).toEqual(['firm.landlord takes no parameter "cut_bsp"']);
  expect(paramErrors("firm.landlord", { cut_bps: "5%" })).toEqual(['firm.landlord\'s "cut_bps" is a whole number, not "5%"']);
  expect(paramErrors("no.such_module", { anything: 1 })).toEqual([]);
});

test("no form has a field named to: it is the routing of the call that fills it in (pilot 7B: three remedy answers misaddressed and declined)", () => {
  const clash: string[] = [];
  for (const [name, m] of manifests()) for (const i of m.issues ?? []) if ("to" in i.fields) clash.push(`${name}: ${i.form}`);
  expect(clash).toEqual([]);
});
