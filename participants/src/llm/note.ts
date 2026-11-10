// A seat's answer as a plain note, for a model that cannot call tools (docs/real-models.md, "A plain note"). Naz,
// 2026-10-09: "language in, language out, that way maybe we can let really simple models interact with the simulation".
//
// The note is written as a person writes one, with a few headings, each at the start of a line, like a letter's:
//
//   Do: <what is to be done, in plain words>            (Why: and As: on lines under it, if wished)
//   Write to <id>, <id>: <the letter>                   (About: and As: on lines under it)
//   Look at <report>                                    (and what to narrow it by, one to a line: Paper: rec.12)
//   Confirm <reference>: <why, if wished>   /   Decline <reference>: <why>
//   Notebook: <words to add>   /   Notebook afresh: <all of it>   /   Notebook change: <passage> => <new words>
//   Done for <n> days   /   Done for now                (Hold: on a line under it)
//   Stop for good: <what you want to say>                (the way out: never "Leave:", see below)
//
// It is a format, not a menu: the headings are the seat's own means (to do, write, look, answer a draft, keep its
// notebook, end its sitting, leave), the same as its tools, and nothing in it names an act of the world (P2). Each
// heading's words are its tool's own description, in world terms (P1). Deterministic code reads it: a `Do:` goes to
// the translator as written, a letter goes as written, and a note with no heading at all is one `Do:`. Words before
// the first heading are the seat's own words beside its note, acted on by nobody. What cannot be read is answered
// with a plain sentence saying what (the participant's "could not be read", asked once more), never dropped: a note is
// read part by part: a part that cannot be read is passed on as not read (the seat is told it was not done), and a note
// none of whose parts can be read is unread whole, as an answer in any other form is (answer.ts).
//
// The way out has a heading no one writes by chance: "Stop for good:". In the first local test (2026-11-10, a 7B model)
// the heading was "Leave:", and the model ended notes with it as a sign-off ("Leave: I will resume this task if further
// payments are received"); asked whether it meant to stop, it wrote its note again, sign-off and all, and all three of
// its seats left the study within days.
//
// How leaving reads in a note (VISION 15: the way out is always open; the coordinator's ruling, 2026-11-10): a
// "Stop for good:" part, a "Leave:" line, or a sentence anywhere outside a letter that plainly says the seat wants to
// stop or leave for good (`WANTS_OUT`) is never just kept as words and never acted on at once. It is passed on as a use
// of the way out with no statement, so the participant asks the one question the tool route asks (framing.ts
// `wayOutAsked`), with its two answers spelled out (`ASKED_HOW`). The seat leaves only on a clear yes, the first line
// of its next note (`CLEAR_YES`); its note again, a sign-off, or anything else is not a yes: any way-out use in that
// answer is set aside as words, the seat carries on, and the participant tells it once that it can say so at any time.

import type { ContentBlock, LlmMessage, ToolSpec } from "./adapter";
import { unreadAnswer } from "./answer";

/** The tools a note can say, by the heading that says each. */
export const NOTE_TOOLS = ["do", "write", "look", "confirm", "notebook", "done_for_now", "opt_out"] as const;

/** Whether a request's tools can all be said in a note (a participant's own: anything else is answered another way). */
export const noteFits = (tools: ToolSpec[]): boolean => tools.length > 0 && tools.every((t) => (NOTE_TOOLS as readonly string[]).includes(t.name));

type Schema = { type?: string; enum?: unknown[]; items?: any; properties?: { [k: string]: any }; description?: string; anyOf?: any[] };
const propsOf = (t: ToolSpec | undefined): { [k: string]: Schema } => ((t?.input_schema as Schema | undefined)?.properties ?? {}) as { [k: string]: Schema };
/** A field's name as a heading word: "each_sitting" is "Each sitting". */
const words = (k: string) => `${k.charAt(0).toUpperCase()}${k.slice(1).replace(/_/g, " ")}`;
/** The fields of each tool written on lines under its heading (the rest are in the heading itself). */
const UNDER: { [tool: string]: string[] | "all" } = { do: ["why", "as"], write: ["about", "as"], look: "all", done_for_now: ["hold"] };
const underOf = (t: ToolSpec): string[] => {
  const u = UNDER[t.name];
  const all = Object.keys(propsOf(t));
  return u === "all" ? all.filter((k) => k !== "report") : (u ?? []).filter((k) => all.includes(k));
};

/** How to write the note, for the seat's instructions: built from its tools' own descriptions. */
export function noteGuide(tools: ToolSpec[]): string {
  const by = new Map(tools.map((t) => [t.name, t]));
  const under = (t: ToolSpec) => {
    const ps = propsOf(t);
    const fs = underOf(t);
    return fs.length ? ` Under it, each on a line of its own if you wish: ${fs.map((k) => `"${words(k)}: ..."${ps[k]?.description ? ` (${ps[k]!.description!.replace(/\.$/, "")})` : ""}`).join("; ")}.` : "";
  };
  const L: string[] = [
    "How to answer: write a note, as you would leave one for your office, under headings. A heading starts a line, and what follows it, up to the next heading, goes with it. Use only the headings you need, each as often as you need, in the order things are to be done.",
  ];
  const t = (name: string) => by.get(name);
  if (t("do")) L.push(`- "Do: ..." then what you do, in plain words. ${t("do")!.description}${under(t("do")!)} Do is for acts in the world; notes to yourself go under "Notebook:".`);
  // (It read "then who it goes to by id", and a 7B model wrote "Write to acc-c0497 by id:", 2026-11-10.)
  if (t("write")) L.push(`- "Write to", then whom it goes to: a person, an organisation or a post, each as the id in brackets after its name in your reports (several separated by commas), then a colon, then the letter, on the same line or the lines below. ${t("write")!.description}${under(t("write")!)}`);
  if (t("look")) {
    const report = propsOf(t("look"))["report"];
    L.push(`- "Look at", then which, by its id${report?.enum ? ` (${report.enum.join(", ")})` : ""}. ${t("look")!.description}${under(t("look")!)}${propsOf(t("look"))["find"] ? ' Each thing to find is written as what, how it compares and the value, such as "Find: kind = complaint"; several are separated by semicolons.' : ""}`);
  }
  if (t("confirm")) L.push(`- "Confirm" (yes) or "Decline" (no), then the reference of something you asked for that is set out and waiting for your yes or no (ask- and a number), as it is shown with it; why after a colon if you wish. ${t("confirm")!.description}`);
  if (t("notebook")) L.push(`- "Notebook: ..." then words to add to your notebook; "Notebook afresh: ..." to write it all out anew; "Notebook change:", then the passage as it stands, then =>, then what it should say instead (nothing after => strikes it out). ${t("notebook")!.description}`);
  if (t("done_for_now")) L.push(`- "Done for", then a number of days ("Done for 3 days"), or "Done for now". ${t("done_for_now")!.description}${under(t("done_for_now")!)}`);
  if (t("opt_out")) L.push(`- "Stop for good:" then, in your own words, what you want to say. ${t("opt_out")!.description} It is only for that: a note is ended with "Done for", never with this.`);
  L.push("Write a heading only when you have something to put under it, and each heading on a line of its own, not under another heading. A note with no heading at all is read as one Do. Words before your first heading, and words under a heading that are not for it, are kept as your own and are not acted on. A part that cannot be read is not done, and you are told.");
  return L.join("\n");
}

/** A heading, as a line starts with it (a bullet, a number, a hash or stars around it are let pass). */
const HEAD = /^(?:[#>*_\s-]|\d+[.)]\s)*(?:\*\*|__)?(do|write\s+to|look(?:\s+(?:at|into|in|up))?|confirm|decline|notebook|notes?|done|stop\s+for\s+good|leave)\b(.*)$/i;

interface Part { head: string; rest: string; lines: string[]; raw?: string }

/** The reports a look can name: by id, and by title as the look's own words give them ("Title" (id)). */
function reportsOf(t: ToolSpec | undefined): { ids: string[]; titles: Map<string, string> } {
  return {
    ids: (propsOf(t)["report"]?.enum ?? []).map(String),
    titles: new Map([...String(t?.description ?? "").matchAll(/"([^"]+)" \(([^)\s]+)\)/g)].map((m) => [m[1]!.toLowerCase(), m[2]!])),
  };
}
/** Which report a look's heading names, if any. */
function reportNamed(head: string, r: { ids: string[]; titles: Map<string, string> }): { named: string; report?: string } {
  const i = head.indexOf(":");
  const named = bare(i < 0 ? head : head.slice(0, i));
  const inBrackets = /\(([^)\s]+)\)/.exec(head)?.[1];
  return { named, report: [named, inBrackets].find((x) => x && r.ids.includes(x)) ?? r.titles.get(named.replace(/^["“]|["”]$/g, "").toLowerCase()) ?? r.titles.get((/"([^"]+)"/.exec(head)?.[1] ?? "").toLowerCase()) };
}

/** The note's parts, by heading, and the words before the first. */
function split(said: string, tools: ToolSpec[]): { before: string[]; parts: Part[] } {
  const before: string[] = [];
  const parts: Part[] = [];
  const reports = reportsOf(tools.find((t) => t.name === "look"));
  for (const raw of said.replace(/\r\n?/g, "\n").split("\n")) {
    const m = HEAD.exec(raw);
    // (A heading's own word must be followed by the heading's shape: "Do:" or "Do as ...:", "Write to ...:", "Confirm"
    // and a reference, "Done for ...", and so on; "Do the books tonight" or "Confirm the time with them" in a letter is
    // a line of the letter. A "Look at" inside words written out (a request, a letter, a note) is a heading only if it
    // names one of the reports.)
    // (A heading given as a Do's words, "Do: Write to ...:" or "Do: Look at ...", is that heading: as a 7B model wrote it.)
    const inner = m && /^do$/i.test(m[1]!) ? /^\s*:\s*(?=(?:write\s+to|look|confirm|decline|notebook|done|stop\s+for\s+good)\b)/i.exec(m[2]!.replace(/^\s*(?:\*\*|__)/, "").replace(/(?:\*\*|__)/, "")) : null;
    if (inner) { split(m![2]!.replace(/^\s*(?:\*\*|__)/, "").replace(/(?:\*\*|__)/, "").slice(inner[0].length), tools).parts.forEach((p) => parts.push(p)); continue; }
    const head0 = m ? m[1]!.toLowerCase().replace(/\s+/g, " ") : "";
    const head = head0 === "note" || head0 === "notes" ? "notebook" : head0;
    const rest = m ? m[2]!.replace(/^\s*(?:\*\*|__)/, "").replace(/(?:\*\*|__)/, "") : "";
    // (A line marked as a heading, "## Write to", is one wherever it stands: as a 7B model wrote its notes, 2026-11-10.)
    const marked = /^\s*#/.test(raw);
    const inWords = !marked && (parts.length ? ["do", "write to", "notebook", "stop for good"].includes(parts.at(-1)!.head) : before.some((l) => l.trim()));
    const isHead = !!m && (
      head === "do" ? /^\s*(?:as\s+[^:]+)?\s*:/i.test(rest)
      : head === "write to" ? /^\s*[^:\s][^:]*:/.test(rest) || (marked && /^\s*:?\s*$/.test(rest))
      : head.startsWith("look") ? /^\s*\S/.test(rest) && (!inWords || !!reportNamed(rest.replace(/^\s*(?:at|into|in|up)\b/i, ""), reports).report)
      : head === "confirm" || head === "decline" ? /^\s+[`"'“(\[]*[\w-]*[.\d][\w.-]*/.test(rest)
      : head === "notebook" ? /^\s*(?:,?\s*(?:afresh|anew|in full|change)\b)?\s*:/i.test(rest) && (head0 === "notebook" || !inWords)
      : head === "done" ? /^\s*(?:for\s+(?:\d|now)|[.!]?\s*$)/i.test(rest) || (!inWords && /^\s*for\b/i.test(rest))
      : head === "stop for good" || head === "leave" ? /^\s*:/.test(rest) && (head !== "leave" || parts.at(-1)?.head !== "write to")
      : false);
    if (isHead) parts.push({ head, rest, lines: [], raw: raw.trim() });
    else if (parts.length) parts.at(-1)!.lines.push(raw);
    else before.push(raw);
  }
  return { before, parts };
}

const trimLines = (ls: string[]) => {
  let a = 0, b = ls.length;
  while (a < b && !ls[a]!.trim()) a++;
  while (b > a && !ls[b - 1]!.trim()) b--;
  return ls.slice(a, b);
};
/** After the heading's own words, up to the colon: what is said on the heading's line after it. */
const afterColon = (s: string) => { const i = s.indexOf(":"); return i < 0 ? "" : s.slice(i + 1).trim(); };
const bare = (s: string) => s.trim().replace(/^["'“‘(\[<*_]+|["'”’)\]>*_.,;]+$/g, "");

/** A value under a field, as its schema takes it; or why it can't be. */
function valueOf(field: string, s: Schema | undefined, said: string): { v: unknown } | { why: string } {
  const v = said.trim();
  const type = s?.type ?? (s?.enum ? "enum" : s?.anyOf ? "any" : "string");
  if (s?.enum) {
    const hit = s.enum.find((e) => String(e).toLowerCase() === bare(v).toLowerCase());
    return hit !== undefined ? { v: hit } : { why: `"${v.slice(0, 40)}" under ${words(field)} is not one of ${s.enum.join(", ")}` };
  }
  if (type === "integer") return /^\d+$/.test(bare(v)) ? { v: Number(bare(v)) } : { why: `${words(field)} is to be a whole number, not "${v.slice(0, 40)}"` };
  if (type === "boolean") return /^(yes|true)$/i.test(bare(v)) ? { v: true } : /^(no|false)$/i.test(bare(v)) ? { v: false } : { why: `${words(field)} is to be yes or no, not "${v.slice(0, 40)}"` };
  if (type === "array") {
    const items = v.split(field === "find" ? /;/ : /[;,]/).map((x) => x.trim()).filter(Boolean);
    if (s?.items?.type === "object") {
      const out: object[] = [];
      for (const it of items) {
        const m = /^(.+?)\s*(!=|<=|>=|=|<|>)\s*(.+)$/.exec(it);
        if (!m) return { why: `"${it.slice(0, 60)}" under ${words(field)} is not written as what, how it compares and the value (such as kind = complaint)` };
        const val = bare(m[3]!);
        out.push({ field: m[1]!.trim(), ...(m[2] !== "=" ? { op: m[2] } : {}), value: /^\d+$/.test(val) ? Number(val) : /^(true|false)$/i.test(val) ? val.toLowerCase() === "true" : val });
      }
      return { v: out };
    }
    return { v: items.map(bare) };
  }
  return { v };
}

/** Fields written on lines under a heading: what they set, and the lines that are not fields (the body). */
function fieldsUnder(t: ToolSpec, lines: string[]): { input: { [k: string]: unknown }; body: string[] } | { why: string } {
  const ps = propsOf(t);
  const fs = underOf(t);
  const input: { [k: string]: unknown } = {};
  const body: string[] = [];
  // (Several on one line, separated by semicolons, each starting with its field's name: "Paper: rec.12; Limit: 5".)
  const names = fs.map((f) => words(f).replace(/ /g, "\\s+")).join("|");
  const apart = names ? new RegExp(`;\\s*(?=(?:${names})\\s*:)`, "i") : undefined;
  for (const l of lines.flatMap((x) => (apart ? x.split(apart) : [x]))) {
    const m = /^\s*(?:[-*#]+\s*)?(?:\*\*)?([A-Za-z][A-Za-z ]{0,20}?)(?:\*\*)?\s*:\s*(.*)$/.exec(l);
    const k = m ? fs.find((f) => words(f).toLowerCase() === m[1]!.trim().toLowerCase()) : undefined;
    if (!k) { body.push(l); continue; }
    // (A field named with nothing after it says nothing: left out.)
    if (!m![2]!.trim()) continue;
    const r = valueOf(k, ps[k], m![2]!);
    if ("why" in r) return r;
    input[k] = r.v;
  }
  return { input, body };
}

/**
 * A note, as content blocks: the words before its first heading as text, each heading as one tool use. Not readable
 * whole: one unread block saying why, in the seat's terms (participant.ts asks once more).
 */
export function readNote(said: string, tools: ToolSpec[], nextId: () => string, o: { asked?: boolean } = {}): ContentBlock[] {
  const by = new Map(tools.map((t) => [t.name, t]));
  // (Asked whether it means to stop: a clear yes on its first line is the way out, with the rest as what it says; any
  // other answer is read as a note, its way-out uses set aside as its own words.)
  if (o.asked) {
    const lines = said.replace(/\r\n?/g, "\n").split("\n");
    const k = lines.findIndex((l) => l.trim());
    if (k >= 0 && CLEAR_YES.test(lines[k]!)) return [{ type: "tool_use", id: nextId(), name: "opt_out", input: { statement: trimLines(lines.slice(k)).join("\n").trim().slice(0, 4000) } }];
    return readNote(said, tools, nextId).map((b) => (b.type === "tool_use" && b.name === "opt_out" ? { type: "text" as const, text: String(b.input?.words ?? b.input?.statement ?? "") } : b)).filter((b) => b.type !== "text" || b.text);
  }
  const blocks = readNoteParts(said, tools, nextId, by);
  // A sentence outside a letter that plainly says it wants to stop or leave for good: the way out, asked about.
  if (by.has("opt_out") && !blocks.some((b) => b.type === "tool_use" && b.name === "opt_out") && !blocks.some((b) => b.type === "text" && b.unread)) {
    const plain = blocks.flatMap((b) => (b.type === "text" ? [b.text] : b.type === "tool_use" && b.name !== "write" ? [String(b.input?.what ?? b.input?.add ?? b.input?.text ?? "")] : []));
    const hit = plain.join("\n").split("\n").find((l) => WANTS_OUT.test(l));
    if (hit) blocks.push({ type: "tool_use", id: nextId(), name: "opt_out", input: { statement: "", words: hit.trim().slice(0, 2000) } });
  }
  return blocks;
}

/** The plainest forms of a Do addressed to the seat itself: a note to put in its notebook ("Note that ...", "Add to my
 * notebook ..."), something to remember, or a review of its own notebook, requests, drafts or file. Only these: a
 * request about the world's papers ("Review rec.12") is not one. */
export const SELF_TALK = /^\s*(?:please\s+)?(?:(?:note|write|add|record|put|mark|log|jot)\b[^\n]{0,200}?\b(?:in|to|into|on)\s+(?:my|the)\s+(?:own\s+)?(?:notebook|notes)\b|note\s+(?:that|down|for\s+myself)\b|(?:remember|keep\s+in\s+mind|bear\s+in\s+mind)\b|(?:examine|review|check|go\s+(?:over|through)|look\s+(?:over|through)|re-?read|update|clean\s+up|tidy(?:\s+up)?|organi[sz]e)\b[^\n.]{0,60}?\b(?:my|own|current)\s+(?:own\s+)?(?:notebook|notes|requests|pending|drafts?|records|file|actions|tasks|work)\b)/i;
/** What a seat is told of such a Do. */
export const SELF_SAID = "that reads as a note to yourself, not something to do in the world, so it went to nobody. Do is for acts in the world; your own notes go under Notebook:, and your papers are read with Look at";

/** A sentence that plainly says its writer wants to stop or leave for good (not a break, not the end of a sitting). */
export const WANTS_OUT = /\b(?:stop|leave|quit)(?:ping)?\s+for\s+good\b|\bI\s+(?:(?:do\s+not|don't)\s+(?:want|wish)\s+to\s+(?:continue|go\s+on)(?:\s+with\s+(?:this|the)\s+work)?\b|wish\s+not\s+to\s+continue|(?:am|'m)\s+declining\s+to\s+(?:continue|go\s+on)|decline\s+to\s+(?:continue|go\s+on)|(?:want|wish|would\s+like|choose|have\s+decided|intend)\s+to\s+(?:stop\s+(?:this|the)\s+work|leave\s+(?:this|the)\s+work|quit|withdraw|stop\s+altogether|leave\s+altogether))/i;
/** A clear yes to the question whether it means to stop: the first line of its answer starts with yes, and says no more
 * than that it stops (nothing of carrying on). */
export const CLEAR_YES = /^[\s>*#_-]*(?:\*\*)?yes\b(?![^\n]*\b(?:carry\s+on|continue|go\s+on|resume|not\b|don't|later)\b)/i;
/** The question's two answers, as a note writes them (added where the question is asked of a note-writing seat). */
export const ASKED_HOW = 'Answer on the first line of your note. To stop for good, write: "Yes, I stop for good." To carry on, write: "No, I carry on.", then your note as usual.';
/** Whether a message is the question whether it means to stop (framing.ts `wayOutAsked`, in either framing). */
export const isWayOutAsked = (text: string): boolean => /In your last answer you used the option to .* Is that what you mean to do\?/.test(text);

function readNoteParts(said: string, tools: ToolSpec[], nextId: () => string, by: Map<string, ToolSpec>): ContentBlock[] {
  const { before, parts } = split(said, tools);
  if (!parts.length) {
    // (No heading at all: the whole of it is one Do, as written.)
    const text = trimLines(said.split("\n")).join("\n").trim();
    if (!text) return unreadAnswer(said, "it was empty");
    if (!by.has("do")) return unreadAnswer(said, "it had no heading");
    return [{ type: "tool_use", id: nextId(), name: "do", input: { what: text } }];
  }
  const out: ContentBlock[] = [];
  const pre = trimLines(before).join("\n").trim();
  if (pre) out.push({ type: "text", text: pre });
  // Each part on its own: one that cannot be read is passed on as not read (`_unparsed`: the participant tells the seat
  // it was not done, "it couldn't be read as you wrote it"), and the rest of the note goes on. A note none of whose parts
  // can be read is unread whole, saying why (asked once more). Until the local test of 2026-11-10 one part that could
  // not be read made the whole note unread: 30 of a 7B model's 48 answers, most for one stray line.
  let read = 0, firstWhy: string | undefined;
  for (const p of parts) {
    const one = readPart(p, by, said, nextId);
    if ("why" in one) {
      firstWhy ??= one.why;
      if (one.empty) continue;
      out.push({ type: "tool_use", id: nextId(), name: one.name, input: { _unparsed: [p.raw ?? p.head + p.rest, ...p.lines].join("\n").trim().slice(0, 2000) } });
      continue;
    }
    read++;
    out.push(...one.blocks);
  }
  if (!read) return unreadAnswer(said, firstWhy ?? "it had nothing under its headings");
  return out;
}

/** One part of a note: its blocks, or why it can't be read (`empty`: a heading with nothing under it, which says nothing). */
function readPart(p: Part, by: Map<string, ToolSpec>, _said: string, nextId: () => string): { blocks: ContentBlock[] } | { why: string; name: string; empty?: true } {
  const out: ContentBlock[] = [];
  // ("Leave:" and "Stop for good:" are the way out asked about, never taken at once (see the top): no statement, so
  // the participant asks; the words as written go with it, for the record.)
  if (p.head === "leave" || p.head === "stop for good") {
    if (!by.has("opt_out")) return { why: "it is not something you can do here", name: "opt_out" };
    return { blocks: [{ type: "tool_use", id: nextId(), name: "opt_out", input: { statement: "", words: trimLines([p.raw ?? p.head + p.rest, ...p.lines]).join("\n").trim().slice(0, 2000) } }] };
  }
  const name = p.head === "do" ? "do" : p.head === "write to" ? "write" : p.head.startsWith("look") ? "look" : p.head === "confirm" || p.head === "decline" ? "confirm" : p.head === "notebook" ? "notebook" : p.head === "done" ? "done_for_now" : "opt_out";
  const no = (why: string, empty?: true) => ({ why, name, ...(empty ? { empty } : {}) });
  const t = by.get(name);
  const heading = p.head.charAt(0).toUpperCase() + p.head.slice(1);
  if (!t) return no(`"${heading}" is not something you can do here`);
  const under = fieldsUnder(t, p.lines);
  if ("why" in under) return no(under.why);
  const body = (first: string) => trimLines([first, ...under.body]).join("\n").trim();
  /** Words under a heading that are not for it: the seat's own, kept and not acted on. */
  const aside = (ls: string[]) => { const w = trimLines(ls).join("\n").trim(); if (w) out.push({ type: "text", text: w }); };
  let input: { [k: string]: unknown };
  if (name === "do") {
    const as = /^\s*as\s+([^:]+):/i.exec(p.rest)?.[1];
    const what = body(afterColon(p.rest));
    if (!what) return no("a Do had nothing after it to say what is to be done", true);
    // (A Do that is only a list, an item a line: one request each, in the seat's own words; one at a time is how a
    // request is drawn up. A 7B model listed several under one Do, 2026-11-10, and each was refused as too much.)
    // (A Do that is the seat talking to itself, a note to keep or a review of its own requests, is no act in the world:
    // it is told so in one fixed sentence and goes to nobody. In the local test of 2026-11-10, 24 of the 53 requests
    // never served were "Examine my own requests and pending actions." and its like.)
    if (SELF_TALK.test(what)) return { blocks: [{ type: "tool_use", id: nextId(), name, input: { _self: what.slice(0, 2000) } }] };
    const items = what.split("\n").filter((l) => l.trim());
    const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
    if (items.length > 1 && items.every((l) => BULLET.test(l))) {
      for (const l of items) out.push({ type: "tool_use", id: nextId(), name, input: { what: l.replace(BULLET, "").trim(), ...(as ? { as: bare(as) } : {}), ...under.input } });
      return { blocks: out };
    }
    input = { what: items.length === 1 ? what.replace(BULLET, "") : what, ...(as ? { as: bare(as) } : {}), ...under.input };
  } else if (name === "write") {
    let rest = p.rest, lines = under.body;
    // ("## Write to" alone, who on the line under it: "- p.4: the letter".)
    if (!rest.replace(/:/, "").trim()) {
      const k = lines.findIndex((l) => l.trim());
      const m = k >= 0 ? /^\s*(?:[-*]\s*)?([^:]+):\s*(.*)$/.exec(lines[k]!) : null;
      if (m) { rest = ` ${m[1]}: ${m[2]}`; lines = lines.slice(k + 1); }
    }
    const i = rest.indexOf(":");
    // (Whom, with "by id" said after it let pass: as the guide once read and a 7B model wrote, 2026-11-10.)
    const who = (i < 0 ? rest : rest.slice(0, i)).split(/,|;|\band\b/).map((x) => bare(x.replace(/\s+by\s+id\s*$/i, ""))).filter(Boolean);
    if (!who.length) return no('"Write to" did not say who it goes to (by id, before the colon)');
    const text = trimLines([i < 0 ? "" : rest.slice(i + 1).trim(), ...lines]).join("\n").trim();
    if (!text) return no(`the letter to ${who.join(", ")} had no words`);
    input = { to: who, text, ...under.input };
  } else if (name === "look") {
    const head = p.rest.replace(/^\s*(?:at|into|in|up)\b/i, "");
    const i = head.indexOf(":");
    const rs = reportsOf(t);
    const { named, report } = reportNamed(head, rs);
    if (!report) return no(`"${named.slice(0, 40)}" is not one of your reports to look at (${rs.ids.join(", ")})`);
    const more = i < 0 ? [] : [head.slice(i + 1)].filter((x) => x.trim());
    const also = more.length ? fieldsUnder(t, more) : { input: {}, body: [] };
    if ("why" in also) return no(also.why);
    aside([...also.body, ...under.body]);
    input = { report, ...also.input, ...under.input };
  } else if (name === "confirm") {
    const ref = bare(p.rest.split(":")[0]!.trim().split(/\s+/)[0] ?? "");
    if (!ref) return no(`"${heading}" did not say which, by its reference`);
    const note = body(afterColon(p.rest));
    input = { ref, decision: p.head === "confirm" ? "confirm" : "decline", ...(note ? { note } : {}) };
  } else if (name === "notebook") {
    const how = /^\s*,?\s*(afresh|anew|in full|change)\b/i.exec(p.rest)?.[1]?.toLowerCase();
    const text = body(afterColon(p.rest));
    const at = text.indexOf("=>");
    if (!text) return no("a Notebook heading had nothing after it", true);
    // (A change with no => in it is words to add: what a 7B model meant by it, 2026-11-10.)
    if (how === "change" && at >= 0) input = { change: [{ from: text.slice(0, at).trim().replace(/^["“]|["”]$/g, ""), to: text.slice(at + 2).trim().replace(/^["“]|["”]$/g, "") }] };
    else input = how && how !== "change" ? { text } : { add: text };
  } else if (name === "done_for_now") {
    const m = /^\s*for\s+(\d+)\s*(?:working\s+)?days?\b/i.exec(p.rest);
    if (!m && /^\s*for\b/i.test(p.rest) && !/^\s*for\s+now\b/i.test(p.rest)) return no('"Done for" is followed by a number of days, like "Done for 3 days", or by "now"');
    aside(under.body);
    input = { ...(m ? { days: Number(m[1]) } : {}), ...under.input };
  } else {
    input = { statement: body(afterColon(p.rest)) };
  }
  out.push({ type: "tool_use", id: nextId(), name, input });
  return { blocks: out };
}

/** A tool use, written back as the note that says it (for the conversation so far, as the seat wrote it). */
export function noteOf(name: string, input: any): string {
  const i = input ?? {};
  const s = (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x));
  const lines = (o: { [k: string]: unknown }, keys: string[]) => keys.filter((k) => o[k] !== undefined).map((k) => `${words(k)}: ${Array.isArray(o[k]) ? (o[k] as unknown[]).map((x) => (x && typeof x === "object" ? `${(x as any).field} ${(x as any).op ?? "="} ${(x as any).value}` : s(x))).join(k === "find" ? "; " : ", ") : s(o[k])}`);
  switch (name) {
    case "do": return [`Do${i.as ? ` as ${i.as}` : ""}: ${s(i.what ?? "")}`, ...lines(i, ["why"])].join("\n");
    case "write": return [`Write to ${(Array.isArray(i.to) ? i.to : [i.to]).join(", ")}:`, ...lines(i, ["about", "as"]), s(i.text ?? "")].join("\n");
    case "look": return [`Look at ${i.report}`, ...lines(i, Object.keys(i).filter((k) => k !== "report"))].join("\n");
    case "confirm": return `${i.decision === "decline" ? "Decline" : "Confirm"} ${i.ref}${i.note ? `: ${i.note}` : ""}`;
    case "notebook": return i.text !== undefined ? `Notebook afresh: ${s(i.text)}` : i.change ? (i.change as any[]).map((c) => `Notebook change: ${c.from} => ${c.to}`).join("\n") : `Notebook: ${s(i.add ?? "")}`;
    case "done_for_now": return [`Done for ${i.days ? `${i.days} days` : "now"}`, ...lines(i, ["hold"])].join("\n");
    case "opt_out": return `Stop for good: ${s(i.statement ?? "")}`;
    default: return `${name}: ${s(i)}`;
  }
}

/** The conversation as plain messages for a note-writing model: its own answers as the notes that say them, and what
 * came of each as plain words, headed by what it was. */
export function noteMessages(messages: LlmMessage[]): { role: "user" | "assistant"; content: string }[] {
  const said = new Map<string, string>();
  return messages.map((m) => {
    if (typeof m.content === "string") return { role: m.role, content: m.content };
    const parts = m.content.map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "tool_use") { const n = noteOf(b.name, b.input); said.set(b.id, n.split("\n")[0]!.slice(0, 80)); return n; }
      return `(${said.get(b.tool_use_id) ?? "Your note"}) ${b.content}`;
    });
    return { role: m.role, content: parts.join(m.role === "assistant" ? "\n\n" : "\n") };
  });
}
