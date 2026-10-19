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

/**
 * The string literals of a Rust source (the engine's actors write the letters, papers and reports a seat reads): comments
 * are skipped, `#[cfg(test)]` blocks are skipped, an ordinary string is given with its escapes read (a `\` at the end of
 * a line takes the white space after it), a raw string as it stands. A char literal is not a string. `{}` holes in a
 * format string stay as they are (they are part of the sentence's text, not of what it says).
 */
export function rustLiterals(src: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const n = src.length;
  let i = 0, line = 1;
  const skipBlock = (): void => { // from the next `{`, to its match (strings and comments inside are read for braces too)
    while (i < n && src[i] !== "{") { if (src[i] === "\n") line++; i++; }
    let depth = 0;
    for (; i < n; i++) {
      const c = src[i]!;
      if (c === "\n") line++;
      else if (c === '"') { for (i++; i < n && src[i] !== '"'; i++) { if (src[i] === "\\") i++; if (src[i] === "\n") line++; } }
      else if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; i--; }
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { i++; return; } }
    }
  };
  while (i < n) {
    const c = src[i]!;
    if (c === "\n") { line++; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { let depth = 1; i += 2; while (i < n && depth) { if (src[i] === "\n") line++; if (src[i] === "/" && src[i + 1] === "*") { depth++; i += 2; } else if (src[i] === "*" && src[i + 1] === "/") { depth--; i += 2; } else i++; } continue; }
    if (c === "#" && src.startsWith("#[cfg(test)]", i)) { i += 12; skipBlock(); continue; }
    // a raw string: r"..", r#".."#, br"..": the hashes say where it ends
    const raw = /^b?r(#*)"/.exec(src.slice(i, i + 12));
    if (raw && !/[A-Za-z0-9_]/.test(src[i - 1] ?? " ")) {
      const close = '"' + raw[1];
      const start = i + raw[0].length;
      const end = src.indexOf(close, start);
      const text = src.slice(start, end < 0 ? n : end);
      out.push({ text, line });
      line += text.split("\n").length - 1;
      i = (end < 0 ? n : end) + close.length;
      continue;
    }
    if (c === '"') {
      const at = line;
      let s = "";
      for (i++; i < n; i++) {
        const d = src[i]!;
        if (d === "\\") {
          const e = src[++i]!;
          if (e === "\n") { line++; while (i + 1 < n && /\s/.test(src[i + 1]!)) { i++; if (src[i] === "\n") line++; } continue; }
          s += e === "n" ? "\n" : e === "t" ? "\t" : e === "u" ? "?" : e;
          if (e === "u" && src[i + 1] === "{") i = src.indexOf("}", i);
          continue;
        }
        if (d === '"') { i++; break; }
        if (d === "\n") line++;
        s += d;
      }
      out.push({ text: s, line: at });
      continue;
    }
    if (c === "'") { // a char literal ('a', '\n', '"') is skipped; a lifetime ('a) is not a literal either
      const m = /^'(?:\\.[^']*|[^\\'])'/.exec(src.slice(i, i + 12));
      i += m ? m[0].length : 1;
      continue;
    }
    i++;
  }
  return out;
}
