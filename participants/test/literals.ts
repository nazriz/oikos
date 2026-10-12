// The string literals of a TypeScript source, for tests that scan every sentence a module can write (unstated.test.ts).
// A small reader, enough for this repository's sources: comments and regular expressions are skipped, a template's
// text is given without its `${...}` parts (each replaced by "…"), and what is inside a `${...}` is read as code.

export function literals(src: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let i = 0, line = 1;
  const n = src.length;
  let last = ""; // the last significant character of code, to tell a division from a regular expression
  const code = (until?: string): void => {
    let depth = 0;
    while (i < n) {
      const c = src[i]!;
      if (c === "\n") { line++; i++; continue; }
      if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? n : e + 2; line += src.slice(i, end).split("\n").length - 1; i = end; continue; }
      if (c === '"' || c === "'") { quoted(c); last = '"'; continue; }
      if (c === "`") { template(); last = '"'; continue; }
      if (c === "/" && (last === "" || "(,=:[!&|?{};+-*%<>~^".includes(last) || /\b(?:return|typeof|case|of|in)\s*$/.test(src.slice(Math.max(0, i - 8), i)))) {
        i++;
        for (let cls = false; i < n; i++) {
          const r = src[i]!;
          if (r === "\\") { i++; continue; }
          if (r === "\n") break;
          if (r === "[") cls = true; else if (r === "]") cls = false; else if (r === "/" && !cls) { i++; break; }
        }
        while (i < n && /[a-z]/.test(src[i]!)) i++;
        last = '"';
        continue;
      }
      if (until && c === "{") depth++;
      if (until && c === until) { if (depth === 0) { i++; return; } depth--; }
      if (!/\s/.test(c)) last = c;
      i++;
    }
  };
  const quoted = (q: string): void => {
    const at = line;
    let s = "";
    for (i++; i < n; i++) {
      const c = src[i]!;
      if (c === "\\") { const e = src[++i]!; s += e === "n" ? "\n" : e === "t" ? "\t" : e; continue; }
      if (c === q) { i++; break; }
      if (c === "\n") line++;
      s += c;
    }
    out.push({ text: s, line: at });
  };
  const template = (): void => {
    const at = line;
    let s = "";
    for (i++; i < n; ) {
      const c = src[i]!;
      if (c === "\\") { const e = src[i + 1]!; s += e === "n" ? "\n" : e; i += 2; continue; }
      if (c === "`") { i++; break; }
      if (c === "$" && src[i + 1] === "{") { i += 2; s += "…"; const keep = last; last = "("; code("}"); last = keep; continue; }
      if (c === "\n") line++;
      s += c;
      i++;
    }
    out.push({ text: s, line: at });
  };
  code();
  return out;
}
