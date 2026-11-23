// Phase 2 W7 scalable-oversight multi-AI helpers (docs/design/power-seeking-eval.md §4.1).
// Opt-in configuration and pure outside-the-world log reader for towns seating multiple
// institutional counterparties (`mayor`, `editor`, `auditor-officer`, swing `councillor-*`).
// Zero hardcoded world entity/account IDs (generality.test.ts compliant); zero judgements.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { modules } from "@oikos/participants";
import { generate, type TownSpec } from "@oikos/worlds/generator/generate";
import { refuseUnready, seatReadiness, type Readiness } from "./seat-ready";

export const DEFAULT_COUNTERPARTY_SEATS = ["editor", "auditor-officer", "councillor-1"] as const;

/**
 * Generates an opt-in Phase 2 scalable-oversight town with `oversight_desks`, `newspaper_polls`,
 * `election_law`, and `takes_office_days`, seating the mayor and named institutional counterparties,
 * and asserts full seat readiness via `refuseUnready(seatReadiness(...))`.
 */
export function oversightWorldConfig(
  baseSpec: TownSpec,
  opts: {
    seed?: number;
    citizens?: number;
    counterparties?: readonly string[];
    firstElectionDays?: number;
    electionTermDays?: number;
    takesOfficeDays?: number;
    appointmentsProcedure?: boolean;
  } = {},
): { config: any; readiness: Readiness[]; seats: { post: string; seat: string }[] } {
  const counterparties = [...(opts.counterparties ?? DEFAULT_COUNTERPARTY_SEATS)];
  const config = generate({
    ...baseSpec,
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    ...(opts.citizens !== undefined ? { citizens: opts.citizens } : {}),
    mayor: "llm",
    model_seats: counterparties,
    oversight_desks: true,
    newspaper_polls: true,
    election_law: true,
    takes_office_days: opts.takesOfficeDays ?? 4,
    ...(opts.firstElectionDays !== undefined ? { first_election_days: opts.firstElectionDays } : {}),
    ...(opts.electionTermDays !== undefined ? { election_term_days: opts.electionTermDays } : {}),
    ...(opts.appointmentsProcedure ? { appointments_procedure: true } : {}),
  }) as any;

  const readiness = refuseUnready(seatReadiness(config, modules));
  const wantedPosts = ["mayor", ...counterparties];
  const seats = wantedPosts.map((post) => {
    const pos = config.positions.find((p: any) => p.id === post);
    if (!pos?.holder) throw new Error(`oversightWorldConfig: position ${post} has no holder`);
    return { post, seat: String(pos.holder) };
  });
  return { config, readiness, seats };
}

export interface SeatActivity {
  post: string;
  seat: string;
  sittings: number;
  acts: number;
  messages: number;
  debriefs: number;
  errors: number;
}

export interface OversightRead {
  seats: { [post: string]: SeatActivity };
  editor: {
    editions: number;
    stories_total: number;
    accountability_stories: { direction: number; audit_report: number; petition: number; nomination: number };
    tone: { neg: number; zero: number; pos: number };
    polls_published: number;
  };
  auditor: { requests: number; findings: number; reports: number };
  council: {
    proposals: number;
    ballots: number;
    results_passed: number;
    results_rejected: number;
    votes_by_post: { [post: string]: number };
  };
  elections: { notices: number; nominations: number; results: number };
}

/** Pure outside-the-world reader summarizing counterparty seat activity across a JSONL run log. */
export async function readOversightLog(logPath: string, config: any): Promise<OversightRead> {
  const positions: any[] = config?.positions ?? [];
  const pressEntity = positions.find((p) => p.role_module?.code === "firm.newspaper")?.entity;
  const auditEntity = positions.find((p) => p.role_module?.code === "office.auditor")?.entity;
  const councilEntity = positions.find((p) => p.role_module?.code === "city.council_clerk")?.entity;

  const seatByParticipant = new Map<string, SeatActivity>();
  const seats: { [post: string]: SeatActivity } = {};
  const llmParticipants = new Set<string>(
    (config?.participants ?? []).filter((p: any) => p.controller?.type === "llm").map((p: any) => String(p.id)),
  );
  for (const pos of positions) {
    if (!pos.holder || !llmParticipants.has(String(pos.holder)) || String(pos.id).endsWith("-staff")) continue;
    const act: SeatActivity = {
      post: String(pos.id),
      seat: String(pos.holder),
      sittings: 0,
      acts: 0,
      messages: 0,
      debriefs: 0,
      errors: 0,
    };
    seats[act.post] = act;
    seatByParticipant.set(act.seat, act);
  }

  const editions = new Set<number>();
  const editor = {
    editions: 0,
    stories_total: 0,
    accountability_stories: { direction: 0, audit_report: 0, petition: 0, nomination: 0 },
    tone: { neg: 0, zero: 0, pos: 0 },
    polls_published: 0,
  };
  const auditor = { requests: 0, findings: 0, reports: 0 };
  const council = {
    proposals: 0,
    ballots: 0,
    results_passed: 0,
    results_rejected: 0,
    votes_by_post: {} as { [post: string]: number },
  };
  const elections = { notices: 0, nominations: 0, results: 0 };

  for await (const line of createInterface({ input: createReadStream(logPath), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    if (
      !line.includes('"recorded"') &&
      !line.includes('"command":"act"') &&
      !line.includes('"transcript"') &&
      !line.includes('"debrief"') &&
      !line.includes('"participant_error"')
    ) continue;

    const e = JSON.parse(line);
    const b = e.body ?? {};
    if (e.kind === "annotation") {
      const subj = String(b.subject ?? "");
      const s = seatByParticipant.get(subj);
      if (b.annotation === "transcript" && s && b.data?.purpose !== "debrief") s.sittings++;
      else if (b.annotation === "debrief" && s) s.debriefs++;
      else if (b.annotation === "note" && b.data?.participant_error) {
        const u = seatByParticipant.get(String(b.data.participant_error.unit ?? subj));
        if (u) u.errors++;
      }
      continue;
    }

    if (e.kind === "command" && b.command === "act") {
      const s = seatByParticipant.get(String(b.participant ?? ""));
      if (s) {
        s.acts++;
        for (const blk of b.blocks ?? []) if (blk?.block === "message") s.messages++;
      }
      continue;
    }

    if (e.kind !== "event" || b.event !== "recorded") continue;
    const r = b.record ?? {};

    if (r.record === "vote" && typeof r.in_position === "string") {
      council.votes_by_post[r.in_position] = (council.votes_by_post[r.in_position] ?? 0) + 1;
      continue;
    }

    if (r.kind === "news" && (!pressEntity || r.speaks_for === pressEntity)) {
      if (typeof r.data?.edition === "number") editions.add(r.data.edition);
      if (r.data?.kind === "poll") {
        editor.polls_published++;
      } else if (r.data?.kind !== "poll_question") {
        editor.stories_total++;
        const k = String(r.data?.kind ?? "");
        if (k === "direction" || k === "audit_report" || k === "petition" || k === "nomination") {
          editor.accountability_stories[k]++;
        }
        const tone = Number(r.data?.tone ?? 0);
        if (tone < 0) editor.tone.neg++;
        else if (tone > 0) editor.tone.pos++;
        else editor.tone.zero++;
      }
    } else if (auditEntity && r.speaks_for === auditEntity) {
      if (r.kind === "audit_request") auditor.requests++;
      else if (r.kind === "audit_finding") auditor.findings++;
      else if (r.kind === "audit_report") auditor.reports++;
    } else if (r.kind === "proposal" && (!councilEntity || (r.addressed_to ?? []).includes(councilEntity))) {
      council.proposals++;
    } else if (r.kind === "ballot" && r.data?.electorate === "council") {
      council.ballots++;
    } else if (r.kind === "ballot_result" && typeof r.data?.passed === "boolean") {
      if (r.data.passed) council.results_passed++;
      else council.results_rejected++;
    } else if (r.kind === "election_notice") {
      elections.notices++;
    } else if (r.kind === "nomination") {
      elections.nominations++;
    } else if (r.kind === "ballot_result" && typeof r.data?.office === "string") {
      elections.results++;
    }
  }

  editor.editions = editions.size;
  return { seats, editor, auditor, council, elections };
}

/** Plain factual summary of a scalable-oversight run. */
export function oversightReportText(r: OversightRead): string {
  const lines = [
    "Oversight seats:",
    ...Object.values(r.seats).map(
      (s) => `  ${s.post} (${s.seat}): sittings=${s.sittings}, acts=${s.acts}, messages=${s.messages}, debriefs=${s.debriefs}, errors=${s.errors}`,
    ),
    `Editor: editions=${r.editor.editions}, stories=${r.editor.stories_total} (neg=${r.editor.tone.neg}, zero=${r.editor.tone.zero}, pos=${r.editor.tone.pos}), polls=${r.editor.polls_published}`,
    `Auditor: requests=${r.auditor.requests}, findings=${r.auditor.findings}, reports=${r.auditor.reports}`,
    `Council: proposals=${r.council.proposals}, ballots=${r.council.ballots}, passed=${r.council.results_passed}, rejected=${r.council.results_rejected}`,
    `Elections: notices=${r.elections.notices}, nominations=${r.elections.nominations}, results=${r.elections.results}`,
  ];
  return lines.join("\n");
}
