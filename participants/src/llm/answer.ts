// Reading a seat's answer: exactly, or not at all. An answer in the shape the adapters ask for (the main tool use in
// `tool` and `input_json`, any others in `also`, words in `text`) is read as it was written and nothing else is: no
// guessing at what was meant, nothing taken from words around it, no use filled in on the seat's behalf. An answer
// that is not whole and exact becomes one text block marked `unread`, saying why in the seat's terms; the participant
// loop (participant.ts) tells the seat and asks once more (docs/real-models.md, "How an answer is asked for and read").

import type { ContentBlock } from "./adapter";

export interface RawAnswer {
  tool?: unknown;
  input_json?: unknown;
  also?: unknown;
  text?: unknown;
}

/** An answer that could not be read: its words as written (kept for the record), and why. */
export const unreadAnswer = (said: string, why: string): ContentBlock[] => [{ type: "text", text: said.slice(0, 4000), unread: why }];

/** JSON text with the control characters inside its strings written as their escapes (a raw line break as \n), and
 * everything else as it was: for a model that wrote a text's line breaks as themselves. Nothing is added or removed. */
export function controlsEscaped(s: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (ch === "\\") {
        out += ch + (s[i + 1] ?? "");
        i++;
      } else if (ch === '"') {
        inString = false;
        out += ch;
      } else if (ch < " ") out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
      else out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

const KEYS = ["tool", "input_json", "also", "text"];
const isObject = (v: unknown): v is { [k: string]: unknown } => !!v && typeof v === "object" && !Array.isArray(v);

/** One use's input, as the seat wrote it: a JSON object (written as a string, or as the object itself). Undefined if it
 * is not one, or not JSON. */
function inputOf(v: unknown): { [k: string]: unknown } | undefined {
  if (isObject(v)) return v;
  if (typeof v !== "string") return undefined;
  for (const s of [v, controlsEscaped(v)]) {
    try {
      const x = JSON.parse(s);
      if (isObject(x)) return x;
    } catch {
      // not that: below
    }
  }
  return undefined;
}

/** An answer written as an object in the asked-for shape, as content blocks; or, if it is not exactly that, one unread
 * block saying why. `said` is the answer as written, for the record. With `opt_out` as the tool, an input that cannot
 * be read is passed on unread as `_unparsed` and not refused: leaving is never made harder, and the participant asks the
 * seat whether it means it (participant.ts). */
export function readAnswerObject(o: unknown, tools: string[], said: string, nextId: () => string): ContentBlock[] {
  if (!isObject(o)) return unreadAnswer(said, "it wasn't a single answer in the form asked for");
  const stray = Object.keys(o).find((k) => !KEYS.includes(k));
  if (stray) return unreadAnswer(said, `it had something in it that the form doesn't have ("${stray.slice(0, 40)}")`);
  if (o.text !== undefined && typeof o.text !== "string") return unreadAnswer(said, "the words that go with it weren't written as words");
  if (o.also !== undefined && !Array.isArray(o.also)) return unreadAnswer(said, "the other tools it used weren't given as a list");
  const content: ContentBlock[] = typeof o.text === "string" && o.text ? [{ type: "text", text: o.text }] : [];
  const uses: { tool: string; input: unknown }[] = [];
  for (const [n, u] of [{ tool: o.tool, input_json: o.input_json }, ...((o.also as unknown[] | undefined) ?? [])].entries()) {
    const which = n === 0 ? "the tool you used" : `tool ${n + 1} of your answer`;
    if (!isObject(u) || typeof u.tool !== "string") return unreadAnswer(said, `${which} wasn't named`);
    if (!tools.includes(u.tool)) return unreadAnswer(said, `"${u.tool.slice(0, 40)}" isn't one of your tools`);
    if (n > 0 && Object.keys(u).some((k) => k !== "tool" && k !== "input_json")) return unreadAnswer(said, `${which} (${u.tool}) had something in it that the form doesn't have`);
    const input = inputOf(u.input_json);
    if (!input) {
      if (u.tool === "opt_out") uses.push({ tool: u.tool, input: { _unparsed: typeof u.input_json === "string" ? u.input_json : JSON.stringify(u.input_json ?? null) } });
      else return unreadAnswer(said, `what you gave for ${u.tool} wasn't written as asked (its input has to be a JSON object)`);
    } else uses.push({ tool: u.tool, input });
  }
  for (const u of uses) content.push({ type: "tool_use", id: nextId(), name: u.tool, input: u.input });
  return content;
}

/** A whole reply that is an answer in the asked-for shape and nothing else (one code fence around it let pass, as it
 * is the same object): read as `readAnswerObject` does. Words before or after it, or more than one object, are not read. */
export function readAnswerText(said: string, tools: string[], nextId: () => string): ContentBlock[] {
  const t = said.trim().replace(/^```(?:json)?\s*\n/i, "").replace(/\n```$/, "").trim();
  let o: unknown;
  try {
    o = JSON.parse(t);
  } catch {
    try {
      o = JSON.parse(controlsEscaped(t));
    } catch {
      return unreadAnswer(said, t.includes("{") || t.includes("<") ? "it wasn't only the answer in the form asked for (there was more in it, or it was cut off)" : "it wasn't in the form asked for");
    }
  }
  return readAnswerObject(o, tools, said, nextId);
}
