// What holds a run's memory, by the code that allocated it: reads a dump of the kernel's sampling heap profiler
// (kernel/src/heapprof.rs; a build with `--features heapprof`) and names its stacks.
//
//   cargo build --profile heapprof --features heapprof --manifest-path kernel/Cargo.toml --bin oikos-kernel
//   OIKOS_HEAPPROF_OUT=/tmp/hp kernel/target/heapprof/oikos-kernel world <config.json> --out <dir> --until S
//   bun scripts/heapprof.ts /tmp/hp.peak.txt kernel/target/heapprof/deps/oikos_kernel-<hash>.dSYM/Contents/Resources/DWARF/oikos_kernel-<hash> [TOP] [DEPTH]
//   bun scripts/heapprof.ts <dump> <dwarf> --focus <regex> [N]     the N largest stacks through a frame matching regex, inlined frames and all
//   bun scripts/heapprof.ts <dump> <dwarf> --components [PEOPLE]   live bytes by component, and per person
//
// Live bytes are summed by the first DEPTH frames that are the kernel's own (a function whose path starts `oikos_`).
// Names come from `atos` (macOS) and `rustfilt` (`cargo install rustfilt`). docs/design/performance.md says what a
// profile of a 10,000-person month found.
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const [dump, dwarf] = args;
if (!dump || !dwarf) throw new Error("usage: bun scripts/heapprof.ts <dump> <dwarf> [TOP] [DEPTH] | --focus <regex> [N]");
const focus = args[2] === "--focus" ? new RegExp(args[3]!) : undefined;
const filt = Bun.which("rustfilt") ?? join(homedir(), ".cargo/bin/rustfilt");
const lines = (await Bun.file(dump).text()).split("\n").filter(Boolean);
const head = lines[0]!.match(/load (0x[0-9a-f]+) live (\d+) rate (\d+)/);
if (!head) throw new Error(`${dump}: not a heapprof dump`);
const load = head[1]!, live = Number(head[2]);
const rows = lines.slice(1).map((l) => { const [w, c, ...a] = l.split(" "); return { w: Number(w), c: Number(c), a }; });
const atos = (addrs: string[], inline: boolean) =>
  Bun.spawnSync(["sh", "-c", `atos -o '${dwarf}' -l ${load} ${inline ? "-i" : ""} ${addrs.join(" ")} | '${filt}'`], { stdout: "pipe" }).stdout.toString();
const outer = new Map<string, string>();
const addrs = [...new Set(rows.flatMap((r) => r.a))];
for (let i = 0; i < addrs.length; i += 1000) {
  const chunk = addrs.slice(i, i + 1000);
  const out = atos(chunk, false).split("\n");
  chunk.forEach((a, j) => outer.set(a, out[j] ?? "?"));
}
const clean = (f: string) => f.replace(/ \(in [^)]*\)/, "").replace(/::h[0-9a-f]{16}/, "");
// (A frame's path without its generic arguments, but keeping `<X as Trait>`.)
const bare = (f: string) => { let s = f, t; while ((t = s.replace(/<([^<>]*)>(?=[^ ]*::|\s|$)/, (m, x) => (/ as /.test(x) ? m : ""))) !== s) s = t; return s; };
const mb = (w: number) => `${(w / 1e6).toFixed(0).padStart(7)} MB`;
console.log(`live ${(live / 1e9).toFixed(2)} GB (sampled), ${rows.length} stacks`);
if (focus) {
  const hit = rows.filter((r) => r.a.some((a) => focus.test(outer.get(a)!)));
  console.log(`${mb(hit.reduce((s, r) => s + r.w, 0))} in ${hit.length} stacks through ${focus}`);
  for (const r of hit.slice(0, Number(args[4] ?? 5))) {
    console.log(`\n==${mb(r.w)}`);
    const out = atos(r.a.slice(1, 30), true).split("\n").filter((l) => l && !/heapprof|__rust_alloc|alloc\.rs|boxed\.rs|raw_vec|mimalloc/.test(l));
    for (const l of out.slice(0, 26)) console.log("   " + clean(l).slice(0, 200));
  }
} else if (args[2] === "--components") {
  // Live bytes by component (docs/design/performance.md, "Bytes per person"): the state hash's and the log's are known
  // by any frame of theirs on the stack; the rest by the innermost of the kernel's own frames.
  const people = Number(args[3] ?? 0);
  const anywhere: [string, RegExp][] = [
    ["state hash: encoded copies", /World::(write_state|canonical_state|state_hash|write_records|write_order)|write_map|canonical_state|canon::canonical_members/],
    ["the log on its way out", /spool::|LogWriter|append_canonical|annotate_canonical/],
  ];
  const innermost: [string, RegExp][] = [
    ["the config (typed, controllers)", /^<?oikos_contracts::(config|controller)/],
    ["the contract's schemas, compiled and checking (fixed)", /^<?oikos_contracts::contracts/],
    ["what's been seen (sites, knowledge, views)", /^<?oikos_world::sites|^<?oikos_resolver::knowledge|Knowledge|^<?oikos_sight|View>::apply|::shown/],
    ["world state: records made, accounts, bodies", /^<?oikos_world::(exec|state)|^<?oikos_world::kernel::World>::(advance|apply)/],
    ["observations being made", /^<?oikos_perception/],
    ["citizens' memory (books)", /citizen::memory|common::book|Book/],
    ["citizens' minds", /^<?oikos_actors::mind::/],
    ["citizens (person, params)", /^<?oikos_actors::citizen::/],
    ["offices, firms, other actors", /^<?oikos_actors::/],
    ["world state", /^<?oikos_(world|nature)/],
    ["engine (units, rounds, scheduler)", /^<?oikos_kernel::(engine|pool|schedule|run|kernel)/],
  ];
  const by = new Map<string, number>();
  for (const r of rows) {
    const frames = r.a.slice(1).map((a) => outer.get(a)!).filter((f) => !/heapprof/.test(f));
    const all = frames.map(bare).join("\n");
    let k = anywhere.find(([, re]) => re.test(all))?.[0];
    if (!k) {
      const own = frames.map(bare).find((f) => /^<?oikos_/.test(f)) ?? "";
      k = innermost.find(([, re]) => re.test(own))?.[0] ?? "other";
    }
    by.set(k, (by.get(k) ?? 0) + r.w);
  }
  for (const [k, w] of [...by].sort((a, b) => b[1] - a[1])) {
    console.log(`${mb(w)} ${(100 * w / live).toFixed(1).padStart(5)}%${people ? `  ${(w / people / 1000).toFixed(1).padStart(7)} KB/person` : ""}  ${k}`);
  }
  if (people) console.log(`${mb(live)}         ${(live / people / 1000).toFixed(1).padStart(7)} KB/person  all live (sampled)`);
} else {
  const [TOP, DEPTH] = [Number(args[2] ?? 40), Number(args[3] ?? 1)];
  const own = (r: { a: string[] }) => {
    const got: string[] = [];
    for (const a of r.a.slice(1)) {
      const f = outer.get(a)!;
      if (/^<?oikos_/.test(bare(f)) && !/heapprof/.test(f)) { got.push(clean(f)); if (got.length >= DEPTH) break; }
    }
    return got.join("  <-  ") || "?";
  };
  const by = new Map<string, number>();
  for (const r of rows) { const k = own(r); by.set(k, (by.get(k) ?? 0) + r.w); }
  for (const [k, w] of [...by].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`${mb(w)} ${(100 * w / live).toFixed(1).padStart(5)}%  ${k.slice(0, 400)}`);
}
