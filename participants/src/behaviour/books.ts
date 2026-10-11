// An office's books, and the clerk who keeps them (docs/behaviour/office-books.md).
//
// The code that runs an office works out, wake after wake, what stands open at it: who is behind with the rent and
// since when, which requests wait for an answer, which invoices are unpaid. A person put in the same office was shown
// each paper once, as it came, and the account's receipts since they last looked: nothing kept the running list. In
// the second living pilot the landlord's code twin wrote to four tenants in arrears on day 37; the seat was shown
// nothing of it and did nothing (runs/pilot-queues/living-2.review.md, fault 2).
//
// A real office has someone who keeps its books. Where a model holds an office, a clerk of the office's staff (the
// office's staff post: its own, where the office has routine work; a post for the books alone where it has none)
// reads the office's own papers and accounts, the same ones and the same way as the office's code (each module's
// `books`), and files a paper on the organisation's own file when what stands open has changed: what is new, what is
// settled, how many stand in all, with the whole list in the paper for whoever opens it. The paper is the
// organisation's own, seen by it alone. Nothing is asked of the engine, nothing is done about any of it by the
// clerk, and a code-run office has no such paper: nothing about a code-only world changes.

import type { Observation, ParticipantAction } from "../contracts";
import { dateWords } from "../forms";
import { params, wait, type BehaviourModule, type Controller, type OfficeBooks, type OpenHeading, type ParticipantContext } from "../module";
import { because, callAction, DAY, say } from "./common";

/** The kind of the paper a clerk files (a statement on the organisation's own file). */
export const BOOKS = "office_books";
/** The most entries of a heading a paper's words name (the rest are in its list), and the most its list holds. */
const NAMED = 4;
const LISTED = 200;

/** Whose staff a post is: the office itself, by the post's own id (`works-staff` is the staff of `works`). */
export const officeOf = (position: string | undefined): string => String(position ?? "").replace(/-staff$/, "");

/** What a paper of the books says, given what stood open at the last one (`before`: id -> line, by heading). */
export function booksPaper(office: string, t: number, open: OpenHeading[], before: Map<string, Map<string, string>> | undefined): { text: string; data: unknown; key: string } {
  const parts: string[] = [];
  const key = JSON.stringify(open.map((h) => [h.what, h.items.map((x) => [x.id, x.running ? "" : x.line])]));
  const whats = [...new Set([...open.map((h) => h.what), ...(before?.keys() ?? [])])];
  for (const what of whats) {
    const items = open.find((h) => h.what === what)?.items ?? [];
    const was = before?.get(what) ?? new Map<string, string>();
    const fresh = items.filter((x) => !was.has(x.id));
    const changed = items.filter((x) => was.has(x.id) && was.get(x.id) !== x.line);
    const moved = changed.every((x) => x.running);
    const gone = [...was.keys()].filter((id) => !items.some((x) => x.id === id));
    if (!items.length && !gone.length) continue;
    const name = (xs: { line: string }[]) => `${xs.slice(0, NAMED).map((x) => x.line).join("; ")}${xs.length > NAMED ? `; and ${xs.length - NAMED} more, in this paper's list` : ""}`;
    const said = [
      before === undefined ? (items.length ? name(items) : "") : "",
      before !== undefined && fresh.length ? `new: ${name(fresh)}` : "",
      before !== undefined && changed.length ? `${moved ? "now" : "changed"}: ${name(changed)}` : "",
      gone.length ? `no longer open: ${gone.slice(0, NAMED * 2).join(", ")}${gone.length > NAMED * 2 ? ` and ${gone.length - NAMED * 2} more` : ""}` : "",
      before !== undefined && !fresh.length && !changed.length && items.length ? "the rest as before" : "",
    ].filter(Boolean).join("; ");
    parts.push(`${what}: ${items.length ? `${items.length} in all` : "none now"}${said ? `${before === undefined ? ":" : ";"} ${said}` : ""}.`);
  }
  const text = `The books of the office, ${dateWords(t)}, as its clerk keeps them from the office's own papers and accounts. ${parts.length ? parts.join(" ") : "Nothing stands open."}${before !== undefined ? " (What is said here is what has changed since the clerk's last paper; the list in this paper is everything that stands open.)" : ""}`;
  // (One list, each thing that stands open an entry: a long one is read a part at a time, as any long paper is.)
  const data = { office, at: t, open: open.flatMap((h) => h.items.slice(0, LISTED).map((x) => ({ what: h.what, about: x.id, says: x.line, ...(x.since !== undefined ? { since: x.since } : {}), ...(x.amount !== undefined ? { amount: x.amount } : {}) }))) };
  return { text, data, key };
}

/** A clerk's keeping of one office's books: fed each observation, and asked at a wake's end whether a paper is due. */
export class Clerk {
  private last: { key: string; day: number; open: Map<string, Map<string, string>> } | undefined;
  constructor(private readonly me: string, private readonly office: string, private readonly books: OfficeBooks) {}
  absorb(obs: Observation): void {
    this.books.absorb(obs);
  }
  /** The paper to file now, if what stands open has changed since the last (at most one a day; none while nothing has ever stood open). */
  due(t: number): ParticipantAction | undefined {
    const open = this.books.open(t).filter((h) => h.items.length);
    const day = Math.floor(t / DAY);
    if (!this.last && !open.length) return undefined;
    const paper = booksPaper(this.office, t, open, this.last?.open);
    if (this.last && (this.last.key === paper.key || this.last.day === day)) return undefined;
    this.last = { key: paper.key, day, open: new Map(open.map((h) => [h.what, new Map(h.items.map((x) => [x.id, x.line]))])) };
    return callAction(because("What stands open on the office's books has changed: filing it for whoever holds the office.", say(BOOKS, paper.text, { to: [this.me], visible: [this.me], data: paper.data })));
  }
}

/** A staff post's controller that also keeps the office's books: the clerk's paper goes out when the staff's own work for the wake is done. */
export function booked<T extends Controller>(controller: T, clerk: Clerk): T {
  const step = controller.step.bind(controller);
  controller.step = ((obs: Observation, ctx: ParticipantContext) => {
    clerk.absorb(obs);
    const a = step(obs, ctx) as ParticipantAction;
    if (a.type !== "wait") return a;
    return clerk.due(obs.t) ?? a;
  }) as T["step"];
  return controller;
}

/** Every module that keeps books, by name: filled by the registry (participants/src/index.ts), read by the clerk. */
export const keepers = new Map<string, BehaviourModule>();

/**
 * office.clerk: the staff post of an office that has no routine work of its own to give its staff, where a model
 * holds the office: a clerk who keeps the office's books (`of`: the module that runs the office when code does;
 * `with`: the office's own parameters) and does nothing else of the office's business.
 */
export const clerk: BehaviourModule = {
  name: "office.clerk",
  version: "0.1.0", // 0.1.0: keeps the books of an office a model holds, and files what has changed
  doc: "docs/behaviour/office-books.md",
  cadence: () => DAY,
  firstWake: (ctx) => 6 * 3_600 + ctx.rng("first-wake").below(3 * 3_600),
  create(ctx: ParticipantContext) {
    const p = params({ of: "", with: {} as { [k: string]: any } }, ctx.params);
    const m = keepers.get(p.of);
    if (!m?.books) throw new Error(`office.clerk: no module "${p.of}" that keeps books`);
    const c = new Clerk(ctx.entity, officeOf(ctx.position), m.books({ ...ctx, position: officeOf(ctx.position), params: p.with ?? {} }));
    return booked({ step: () => wait() } as Controller, c);
  },
};
