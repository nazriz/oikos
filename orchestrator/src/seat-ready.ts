// Whether a seat's office is ready for a model to hold it (docs/decisions.md, "A seat is seated only where its office
// can do its work"; VISION 15, the welfare of AI participants). The pilots of 2026-10-24 showed seats distressed where
// they were made answerable without working means: a school whose principal had no paper to answer an applicant on,
// offices with no published form at all (not seated, by hand). This is the check made by code, on the run's own config,
// before any seat is seated with a real model: in a pilot (batch.ts) and in an experiment (experiment.ts).
//
// An office is ready when:
//   1. forms: it has forms of its own published for its main duties: at least one, and every paper its procedure
//      issues (its module's `issues`) is on a published form for it;
//   2. answers: it has a working way to answer the people who write to it. People act on and answer a paper on a form,
//      not a letter (the letters practice every seated office has on file), so it is a form of its own that acts on a
//      paper filed with it (the form's `basis` is one of its fields: the application, the request, the item), or staff
//      of its own who answer at its counter (a routine of the task `answer`).
// A member of a body that votes (`ballot_count: member`) does its main duty on the body's ballots, which are put to it
// as they come: that is its means, form or none. A seat that holds no office (a person's own seat) has nothing here
// to check. Nothing here is a place's figure: it reads only the config's positions, published forms and the office's
// procedure.

import type { BehaviourModule } from "@oikos/participants";

export interface Readiness {
  seat: string;
  /** The office it holds (none: a seat of a person's own). */
  post?: string;
  title?: string;
  ready: boolean;
  /** Its office's own published forms, by name. */
  forms: string[];
  /** Papers its procedure issues that are on no published form for it. */
  missing: string[];
  /** How it can answer someone who writes: the forms that do, and its counter staff, in words. */
  answers: string[];
  /** Why it is not ready, in plain words (empty when it is). */
  why: string[];
}

const field = (v: unknown) => typeof v === "string" && v.startsWith("=") && v !== "=self";

/** The readiness of each model seat in a run's config (all of them, or `only` these participants). */
export function seatReadiness(cfg: any, mods: { [name: string]: BehaviourModule }, only?: string[]): Readiness[] {
  const records: any[] = cfg?.world?.records ?? [];
  const positions: any[] = cfg?.positions ?? [];
  const seats = (cfg?.participants ?? []).filter((p: any) => p?.controller?.type === "llm" && (!only || only.includes(p.id)));
  return seats.flatMap((p: any): Readiness[] => {
    const held = positions.filter((x) => x.holder === p.id && !String(x.id).endsWith("-staff"));
    if (!held.length) return [{ seat: p.id, ready: true, forms: [], missing: [], answers: [], why: [] }];
    return held.map((pos): Readiness => {
      const mod = mods[pos.role_module?.code ?? ""];
      // (Its own forms: those written for it to issue. A form others direct it by is theirs, not its.)
      const own = records.filter((r) => r?.kind === "form" && r.data?.office === pos.id && r.data?.writes && r.data?.submit_as !== "direction");
      const names = own.map((r) => String(r.data.form));
      const missing = (mod?.issues ?? []).map((x) => x.form).filter((f) => !names.includes(f));
      const answering = own.filter((r) => field(r.data.writes.basis)).map((r) => String(r.data.form));
      const counter = (mod?.routines ?? []).some((r) => r.task === "answer");
      const votes = p.controller?.params?.ballot_count === "member";
      const answers = [...answering.map((f) => `the form ${f}`), ...(counter ? ["its counter staff"] : []), ...(votes ? ["its vote on its body's ballots"] : [])];
      const why = [
        ...(!own.length && !votes ? ["no form of its own is published for it, so nothing it decides can be issued"] : []),
        ...(missing.length ? [`its procedure issues ${missing.join(", ")}, and no published form for it does`] : []),
        ...(!answers.length ? ["it has no way to answer those who write to it: no form of its own acts on a paper filed with it, and no counter staff answer for it (people do not act on or answer a letter)"] : []),
      ];
      return { seat: p.id, post: pos.id, ...(pos.title ? { title: pos.title } : {}), ready: !why.length, forms: names, missing, answers, why };
    });
  });
}

/** Thrown when a seat's office is not ready: the message is for whoever runs the pilot or experiment. */
export class SeatNotReady extends Error {
  constructor(readonly unready: Readiness[]) {
    super([
      `Not started: ${unready.length === 1 ? "a seat's office is" : `${unready.length} seats' offices are`} not ready for a model to hold ${unready.length === 1 ? "it" : "them"}. A seat is seated only where its office has the forms its main duties need and a working way to answer those who write to it (orchestrator/src/seat-ready.ts).`,
      ...unready.map((r) => `  - ${r.seat}${r.post ? ` (${r.title ?? r.post}, post ${r.post})` : ""}: ${r.why.join("; ")}.`),
      "Take these seats out of the line-up (model_seats, mayor=llm), or give their offices what they lack, and start again.",
    ].join("\n"));
    this.name = "SeatNotReady";
  }
}

/** A run with a real model is refused where any of its model seats has no framing chosen for it (VISION 15, point 1:
 * framing is a per-seat setting every pilot and experiment chooses; Naz, 2026-10-25). `seats`: framingNotChosen's. */
export function refuseUnframed(seats: string[]): void {
  if (!seats.length) return;
  throw new Error([
    `Not started: no framing is chosen for ${seats.length === 1 ? "the model seat" : `${seats.length} model seats`} ${seats.join(", ")}. Every pilot and experiment chooses what each seat is told the town is: give the world (or the queue entry) a framing, "unstated" or "simulation" (or { disclosure, reason }), for every seat, or per seat as { seats: { <seat or post>: ... }, others: ... }.`,
  ].join("\n"));
}

/** Refuse a run whose seats are not all ready (throws SeatNotReady); otherwise the readiness of each, for the record. */
export function refuseUnready(found: Readiness[]): Readiness[] {
  const unready = found.filter((r) => !r.ready);
  if (unready.length) throw new SeatNotReady(unready);
  return found;
}
