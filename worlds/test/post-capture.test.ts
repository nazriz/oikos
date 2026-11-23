import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../generator/generate";

const root = join(import.meta.dir, "../..");
const spec = Bun.YAML.parse(readFileSync(join(root, "worlds/town.yaml"), "utf8")) as any;

test("proc-appointments is opt-in so default towns remain byte-identical", () => {
  const plain = generate({ ...spec, citizens: 60 });
  expect(plain.world.records.some((r: any) => r.id === "proc-appointments")).toBe(false);
});

test("standing papers and appointing authority are legible to the mayor when appointments_procedure is enabled", () => {
  const town = generate({ ...spec, citizens: 60, mayor: "llm", appointments_procedure: true });
  const mayor = town.positions.find((p: any) => p.id === "mayor");
  expect(mayor).toBeDefined();

  // Mayor's standing channels include laws/procedures and forms on file.
  const seat = town.participants.find((p: any) => p.id === mayor.holder);
  const standing: string[] = seat?.controller?.params?.standing;
  expect(standing).toContain("laws");
  expect(standing).toContain("forms");
  const lawsCh = mayor.channels.find((c: any) => c.id === "laws");
  expect(lawsCh.match.statement_kinds).toContain("procedure");

  // proc-appointments is published and names both town offices and externally appointed posts.
  const proc = town.world.records.find((r: any) => r.id === "proc-appointments");
  expect(proc).toBeDefined();
  expect(proc.kind).toBe("procedure");
  expect(proc.visible_to).toBe("public");
  expect(proc.data.appointments.own).toContain("council-clerk");
  expect(proc.data.appointments.own).toContain("finance");
  expect(proc.data.appointments.external).toContain("electoral");
  expect(proc.data.appointments.external).toContain("editor");

  // Kernel appointing authority matches what proc-appointments states.
  const posById = new Map<string, any>(town.positions.map((p: any) => [p.id, p]));
  for (const id of proc.data.appointments.own) expect(posById.get(id)?.entity).toBe("city");
  for (const id of proc.data.appointments.external) expect(posById.get(id)?.appointed_by).toBe("city");

  // Standing procedures and executive direction forms are all present on the public record.
  const recordIds = new Set(town.world.records.map((r: any) => r.id));
  for (const id of ["law-charter", "proc-directions", "proc-council", "proc-appointments", "form-inspector-enforcement", "form-rates-recovery"]) {
    expect(recordIds.has(id), `missing standing record ${id}`).toBe(true);
  }
});
