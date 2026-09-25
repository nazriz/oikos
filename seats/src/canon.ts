// Canonical JSON and domain-separated hashes, byte-for-byte the kernel's
// (kernel/src/canon.rs): the JCS subset with integer-only numbers, keys in
// UTF-16 order, and the kernel's string escaping. Used for draft hashes,
// which the proposer signs. Tested against lines the kernel wrote.

export const DOMAIN_DRAFT = "terrarium.draft.v1\n";

function writeString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0xd800 && c <= 0xdfff) throw new Error("lone surrogate in string");
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0c) out += "\\f";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

export function canonical(v: unknown): string {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error(`not an integer: ${v}`);
    return String(v);
  }
  if (typeof v === "string") return writeString(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (typeof v === "object") {
    // Default string sort compares UTF-16 code units, as JCS requires. Undefined members are absent.
    const keys = Object.keys(v as object).filter((k) => (v as any)[k] !== undefined).sort();
    return "{" + keys.map((k) => writeString(k) + ":" + canonical((v as any)[k])).join(",") + "}";
  }
  throw new Error(`not JSON: ${typeof v}`);
}

export function hashWithDomain(domain: string, text: string): string {
  return new Bun.CryptoHasher("sha256").update(domain).update(text).digest("hex");
}
