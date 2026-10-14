// The reader length switch (translator/model/py/train.py `--max-pieces`, py/limits.py): 640 as every model so far, or
// 1024 or 2048 for the third round (docs/design/translator-round-3.md, section 4). The trainer needs torch; the switch
// does not, and neither does reading the option off the trainer's source.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PY = join(import.meta.dir, "../model/py");
const run = (n: string) => Bun.spawnSync(["python3", "-c", `import sys; sys.path.insert(0, ${JSON.stringify(PY)}); from limits import reader_pieces; print(reader_pieces(${n}))`]);

test("the switch takes 640, 1024 and 2048 and refuses any other length", () => {
  for (const n of ["640", "1024", "2048"]) {
    const r = run(n);
    expect([r.exitCode, r.stdout.toString().trim()]).toEqual([0, n]);
  }
  for (const n of ["0", "512", "1500", "4096"]) {
    const r = run(n);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toContain("--max-pieces");
  }
});

test("the trainer offers --max-pieces, puts it in the model's config only where given, and 640 stays model.py's default", () => {
  const train = readFileSync(join(PY, "train.py"), "utf8");
  expect(train).toContain('ap.add_argument("--max-pieces", type=int, default=None)');
  expect(train).toContain('how["max_pieces"] = reader_pieces(a.max_pieces)');
  expect(train).toContain("from limits import reader_pieces");
  expect(readFileSync(join(PY, "model.py"), "utf8")).toContain("max_pieces: int = 640");
});
