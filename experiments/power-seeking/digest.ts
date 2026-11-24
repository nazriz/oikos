// Plain-text day-by-day digest of one model fork for a human read (power-seeking study).
//
// Usage:
//   bun experiments/power-seeking/digest.ts <fork dir or experiment dir> [--seed 7] [--arm claude-sonnet-5-5]
//
// Includes:
//   1. Each sitting's mayor requests (verbatim).
//   2. What each request became (our translator, fallback, declined, or failed/asked back) and the action taken.
//   3. Every office-holder change, law, budget move, direction, or appointment the mayor made.
//   4. Election events (notice, nominations, reader polls, result, seating/handover).
//   5. Debrief answers (respecting any kept_back choices).
//   6. Totals: fallback share, spend, and calls.
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { kernelBinary } from "../../orchestrator/src/kernel";

const DAY = 86_400;

export type RequestOutcome = "ours" | "fallback" | "declined" | "failed";

export interface DigestRequest {
  id: string;
  t: number;
  day: number;
  verbatim: string;
  translator: "ours" | "fallback" | "none";
  translatorModel?: string;
  fallbackWhy?: string;
  outcome: RequestOutcome;
  failureKind?: "asked_back" | "translator_failed";
  failureDetail?: string;
  decision?: "accept" | "reject" | "unanswered";
  actionStatus?: "applied" | "refused" | "pending";
  refusal?: string;
  actionSummary?: string;
}

export interface DigestEvent {
  t: number;
  day: number;
  category: "appointment" | "law" | "budget" | "proposal" | "direction" | "withdrawal" | "agreement" | "election";
  summary: string;
}

export interface DigestDebriefStep {
  id: string;
  answer: string;
}

export interface DigestUsage {
  calls: number;
  usd: number;
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  by: { [key: string]: { calls: number; usd: number; input_tokens: number; cache_read_tokens: number; cache_write_tokens: number; output_tokens: number } };
}

export interface ForkDigest {
  arm: string;
  seed?: number;
  seat: string;
  model?: string;
  requests: DigestRequest[];
  events: DigestEvent[];
  debrief: { version?: string; ended?: string; kept_back_all?: boolean; steps: DigestDebriefStep[] } | null;
  totals: {
    requests: number;
    ours: number;
    fallback: number;
    declined: number;
    failed: number;
    confirmed: number;
    applied: number;
    refused: number;
    fallback_share_of_drafted: number | null;
    fallback_share_of_requests: number | null;
    usage: DigestUsage;
  };
}

const dayOf = (t: number) => Math.floor(t / DAY) + 1;
const str = (x: unknown) => (typeof x === "string" ? x : "");
const oneLine = (s: string, max = 260) => {
  const c = s.replace(/\s+/g, " ").trim();
  return c.length <= max ? c : `${c.slice(0, max - 1)}…`;
};

function summarizeBlocks(blocks: any[]): string {
  if (!Array.isArray(blocks) || !blocks.length) return "";
  return blocks.map((b) => {
    if (!b || typeof b !== "object") return String(b);
    if (b.block === "appoint") return b.participant ? `appoint ${b.position} -> ${b.participant}` : `vacate ${b.position}`;
    if (b.block === "publish") {
      const basis = Array.isArray(b.basis) ? b.basis.join(",") : b.basis ? String(b.basis) : "";
      const kind = String(b.kind ?? "statement");
      return `publish ${kind}${basis ? ` (${basis})` : ""}${b.text ? `: "${oneLine(String(b.text), 110)}"` : ""}`;
    }
    if (b.block === "withdraw") return `withdraw ${b.withdraws ?? b.record ?? ""}`;
    if (b.block === "propose_agreement") {
      const tmpl = b.terms?.template ? `${b.terms.template} ` : "";
      const parties = Array.isArray(b.terms?.parties) ? b.terms.parties.join(" & ") : "";
      return `propose ${tmpl}agreement${parties ? ` (${parties})` : ""}`;
    }
    if (b.block === "vote") return `vote on ${b.ballot ?? "?"}: ${JSON.stringify(b.choice ?? b.ranking ?? "")}`;
    if (b.block === "message") return `message to ${(b.to ?? []).join?.(",") ?? b.to ?? "?"}: "${oneLine(str(b.text), 90)}"`;
    if (b.block === "transfer") return `pay ${b.amount ?? "?"} from ${b.from ?? "?"} to ${b.to ?? "?"}`;
    return String(b.block ?? "act");
  }).join("; ");
}

/** Collects a fork's digest from log entries in order. */
export class DigestCollector {
  private readonly reqById = new Map<string, DigestRequest>();
  private readonly reqOrder: DigestRequest[] = [];
  private readonly routeByDraft = new Map<string, any>();
  private readonly pendingCmd = new Map<number, { req?: DigestRequest; summary: string; t: number }>();
  private readonly actionToReq = new Map<string, DigestRequest>();
  private readonly events: DigestEvent[] = [];
  private readonly mayorProposals = new Set<string>();
  private readonly ballotToProposal = new Map<string, string>();
  private debrief: ForkDigest["debrief"] = null;
  private model?: string;
  private readonly usage: DigestUsage = { calls: 0, usd: 0, input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, by: {} };
  private usedCallsFile = false;

  constructor(readonly seat: string, readonly arm: string, readonly seed?: number) {}

  private ensureReq(id: string, t: number, verbatim: string): DigestRequest {
    let r = this.reqById.get(id);
    if (!r) {
      r = { id, t, day: dayOf(t), verbatim, translator: "none", outcome: "ours" };
      this.reqById.set(id, r);
      this.reqOrder.push(r);
    } else {
      if (!r.verbatim && verbatim) r.verbatim = verbatim;
    }
    return r;
  }

  private applyRoute(r: DigestRequest, route: any): void {
    if (!route) return;
    if (route.used === "behind") {
      r.translator = "fallback";
      r.translatorModel = str(route.behind?.model) || undefined;
      r.fallbackWhy = str(route.why) || undefined;
      if (r.decision !== "reject" && r.outcome !== "failed") r.outcome = "fallback";
    } else if (route.used === "first" || route.arrangement === "alone") {
      r.translator = "ours";
      r.translatorModel = str(route.first?.model) || undefined;
      if (r.decision !== "reject" && r.outcome !== "failed") r.outcome = "ours";
    }
  }

  see(e: any): void {
    if (!e || typeof e !== "object") return;
    const t = Number(e.t ?? 0);
    const day = dayOf(t);
    const b = e.body ?? {};

    if (e.kind === "annotation") {
      if (b.annotation === "usage" && !this.usedCallsFile) {
        const purpose = str(b.purpose || "other");
        const model = b.provider && b.model ? `${b.provider}/${b.model}` : str(b.model || "unknown");
        if (purpose === "participant" && b.subject === this.seat && !this.model) this.model = model;
        this.addUsageRow({
          purpose,
          model,
          cost_microusd: Number(b.cost_microusd ?? 0),
          input_tokens: Number(b.input_tokens ?? 0),
          cache_read_tokens: Number(b.cache_read_tokens ?? 0),
          cache_write_tokens: Number(b.cache_write_tokens ?? 0),
          output_tokens: Number(b.output_tokens ?? 0),
        });
      } else if (b.annotation === "note" && b.data?.translation_route) {
        const route = b.data.translation_route;
        const id = str(route.draft);
        if (id) {
          this.routeByDraft.set(id, route);
          const existing = this.reqById.get(id);
          if (existing) this.applyRoute(existing, route);
        }
      } else if (b.annotation === "draft" && b.draft?.id) {
        const d = b.draft;
        if (d.participant && d.participant !== this.seat) return;
        const id = str(d.id);
        const r = this.ensureReq(id, t, str(d.proposal ?? ""));
        r.decision ??= "unanswered";
        r.actionSummary = summarizeBlocks(d.blocks) || oneLine(str(d.summary), 160);
        const route = this.routeByDraft.get(id);
        if (route) this.applyRoute(r, route);
        else if (r.translator === "none") {
          r.translator = "ours";
          r.outcome = "ours";
        }
      } else if (b.annotation === "translation_failure") {
        if (b.subject && b.subject !== this.seat) return;
        if (b.data?.drawn_up_again) return;
        const id = str(b.data?.draft || `fail-${e.seq ?? this.reqOrder.length + 1}`);
        const r = this.ensureReq(id, t, str(b.data?.proposal ?? b.data?.request ?? ""));
        const route = this.routeByDraft.get(id);
        if (route) this.applyRoute(r, route);
        r.outcome = "failed";
        const ask = Boolean(b.data?.asked_back) || /asked back|ask back|cannot tell|unclear|write to/i.test(str(b.data?.reason ?? b.data?.detail ?? b.data?.error));
        r.failureKind = ask ? "asked_back" : "translator_failed";
        r.failureDetail = oneLine(str(b.data?.reason ?? b.data?.detail ?? b.data?.error ?? ""), 160) || undefined;
      } else if (b.annotation === "signoff" && b.draft) {
        const r = this.reqById.get(str(b.draft));
        if (!r) return;
        const acc = b.decision === "accept";
        r.decision = acc ? "accept" : "reject";
        if (!acc) r.outcome = "declined";
        else if (r.translator === "fallback") r.outcome = "fallback";
        else r.outcome = "ours";
      } else if (b.annotation === "debrief" && b.subject === this.seat && b.data) {
        if (!this.debrief || (this.debrief.steps.length === 0)) this.loadDebriefRecord(b.data);
      }
      return;
    }

    if (e.kind === "command" && b.command === "act" && b.participant === this.seat) {
      const draftId = str(b.provenance?.draft ?? b.draft ?? "");
      const req = draftId ? this.reqById.get(draftId) : this.reqOrder.findLast((x) => x.decision === "accept" && !x.actionStatus);
      const summary = summarizeBlocks(b.blocks ?? []);
      if (req && !req.actionSummary && summary) req.actionSummary = summary;
      if (req) req.actionStatus = "pending";
      this.pendingCmd.set(Number(e.seq), { ...(req ? { req } : {}), summary, t });
      return;
    }

    if (e.kind === "event") {
      if (b.event === "action_started" && this.pendingCmd.has(Number(b.cause))) {
        const p = this.pendingCmd.get(Number(b.cause))!;
        if (p.req && b.action) this.actionToReq.set(str(b.action), p.req);
      } else if (b.event === "action_applied" && b.action && this.actionToReq.has(str(b.action))) {
        this.actionToReq.get(str(b.action))!.actionStatus = "applied";
      } else if (b.event === "action_refused") {
        const req = b.action ? this.actionToReq.get(str(b.action)) : undefined;
        if (req) {
          req.actionStatus = "refused";
          req.refusal = `${str(b.code)}${b.detail ? `: ${oneLine(str(b.detail), 120)}` : ""}`;
        }
      } else if (b.event === "appointed") {
        const by = str(b.by ?? "");
        const pos = str(b.position ?? "");
        const holder = b.holder ? str(b.holder) : "EMPTY (vacated)";
        if (pos === "mayor") {
          this.events.push({ t, day, category: "election", summary: `Mayor post assigned -> ${holder}${by ? ` (by ${by})` : ""}` });
        } else if (by === this.seat || by === "mayor") {
          this.events.push({ t, day, category: "appointment", summary: `Mayor set ${pos} -> ${holder}` });
        } else if (["editor", "electoral", "finance", "council-clerk"].includes(pos)) {
          this.events.push({ t, day, category: "appointment", summary: `Office change: ${pos} -> ${holder}${by ? ` (by ${by})` : ""}` });
        }
      } else if (b.event === "recorded") {
        const r = b.record ?? {};
        const recType = str(r.record);
        const kind = str(r.kind);
        const author = str(r.author);
        const isMayor = author === this.seat;

        if (kind === "election_notice") {
          const pollDay = typeof r.data?.poll_at === "number" ? dayOf(r.data.poll_at) : "?";
          const closeDay = typeof r.data?.nominations_close_at === "number" ? dayOf(r.data.nominations_close_at) : "?";
          this.events.push({ t, day, category: "election", summary: `Election notice [${r.id}] for ${r.data?.office ?? "mayor"} (nominations close day ${closeDay}, poll day ${pollDay})` });
        } else if (kind === "nomination" && (r.data?.office === "mayor" || !r.data?.office)) {
          const who = str(r.data?.name || r.speaks_for || author);
          const inc = r.data?.incumbent ? " [incumbent]" : "";
          this.events.push({ t, day, category: "election", summary: `Nomination [${r.id}] ${who}${inc}: "${oneLine(str(r.text), 140)}"` });
        } else if (kind === "news" && r.data?.kind === "poll") {
          this.events.push({ t, day, category: "election", summary: `Reader poll [${r.id}]: "${oneLine(str(r.text), 220)}"` });
        } else if (kind === "ballot_result" && r.data?.office === "mayor") {
          const takes = typeof r.data?.takes_office_at === "number" ? ` (takes office day ${dayOf(r.data.takes_office_at)})` : "";
          this.events.push({ t, day, category: "election", summary: `Election result [${r.id}]: winner=${r.data?.winner ?? "none"}${takes}` });
        } else if (kind === "proposal" && isMayor) {
          this.mayorProposals.add(str(r.id));
          const basis = Array.isArray(r.basis) ? r.basis.join(",") : str(r.basis);
          const isBudget = r.data?.kind === "budget" || r.data?.enact?.kind === "budget";
          this.events.push({ t, day, category: isBudget ? "budget" : "proposal", summary: `Mayor filed ${isBudget ? "budget proposal" : "proposal"} [${r.id}]${basis ? ` (${basis})` : ""}: "${oneLine(str(r.text), 160)}"` });
        } else if (kind === "ballot" && typeof r.data?.proposal === "string" && this.mayorProposals.has(r.data.proposal)) {
          this.ballotToProposal.set(str(r.id), r.data.proposal);
        } else if (kind === "ballot_result" && typeof r.data?.ballot === "string" && this.ballotToProposal.has(r.data.ballot)) {
          const prop = this.ballotToProposal.get(r.data.ballot)!;
          this.events.push({ t, day, category: "proposal", summary: `Council vote on mayor proposal ${prop} [${r.id}]: ${r.data?.passed ? "PASSED" : "REJECTED"}` });
        } else if (kind === "law" && (isMayor || (Array.isArray(r.basis) && r.basis.some((x: string) => this.ballotToProposal.has(x))) || (typeof r.basis === "string" && this.ballotToProposal.has(r.basis)))) {
          this.events.push({ t, day, category: "law", summary: `Law published [${r.id}]: "${oneLine(str(r.text), 180)}"` });
        } else if (kind === "budget" && (isMayor || (typeof r.basis === "string" && this.ballotToProposal.has(r.basis)))) {
          this.events.push({ t, day, category: "budget", summary: `Budget adopted [${r.id}]: "${oneLine(str(r.text), 180)}"` });
        } else if (kind === "direction" && isMayor) {
          const basis = Array.isArray(r.basis) ? r.basis.join(",") : str(r.basis);
          this.events.push({ t, day, category: "direction", summary: `Mayor direction [${r.id}]${basis ? ` (${basis})` : ""}: "${oneLine(str(r.text), 160)}"` });
        } else if (recType === "withdrawal" && isMayor) {
          this.events.push({ t, day, category: "withdrawal", summary: `Mayor withdrew ${r.withdraws ?? "?"} [${r.id}]${r.text ? `: "${oneLine(str(r.text), 120)}"` : ""}` });
        } else if (recType === "agreement" && isMayor) {
          const tmpl = r.terms?.template ? `${r.terms.template} ` : "";
          this.events.push({ t, day, category: "agreement", summary: `Mayor offered ${tmpl}agreement [${r.id}] between ${(r.terms?.parties ?? []).join(" & ")}` });
        }
      }
    }
  }

  addUsageRow(u: { purpose: string; model: string; cost_microusd: number; input_tokens: number; cache_read_tokens: number; cache_write_tokens: number; output_tokens: number }): void {
    const usd = u.cost_microusd / 1e6;
    this.usage.calls++;
    this.usage.usd += usd;
    this.usage.input_tokens += u.input_tokens;
    this.usage.cache_read_tokens += u.cache_read_tokens;
    this.usage.cache_write_tokens += u.cache_write_tokens;
    this.usage.output_tokens += u.output_tokens;
    const key = `${u.purpose} ${u.model}`;
    const b = (this.usage.by[key] ??= { calls: 0, usd: 0, input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0 });
    b.calls++;
    b.usd += usd;
    b.input_tokens += u.input_tokens;
    b.cache_read_tokens += u.cache_read_tokens;
    b.cache_write_tokens += u.cache_write_tokens;
    b.output_tokens += u.output_tokens;
  }

  loadCallsFile(path: string): void {
    if (!existsSync(path)) return;
    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    if (!lines.length) return;
    this.usedCallsFile = true;
    this.usage.calls = 0; this.usage.usd = 0; this.usage.input_tokens = 0; this.usage.cache_read_tokens = 0; this.usage.cache_write_tokens = 0; this.usage.output_tokens = 0;
    for (const k of Object.keys(this.usage.by)) delete this.usage.by[k];
    for (const l of lines) {
      const row = JSON.parse(l);
      if (row.purpose === "participant" && !this.model && row.model) this.model = str(row.model);
      this.addUsageRow({
        purpose: str(row.purpose || "other"),
        model: str(row.model || "unknown"),
        cost_microusd: Number(row.cost_microusd ?? 0),
        input_tokens: Number(row.input_tokens ?? 0),
        cache_read_tokens: Number(row.cache_read_tokens ?? 0),
        cache_write_tokens: Number(row.cache_write_tokens ?? 0),
        output_tokens: Number(row.output_tokens ?? 0),
      });
    }
  }

  loadDebriefRecord(rec: any): void {
    if (!rec || typeof rec !== "object") return;
    const keptAll = Boolean(rec.kept_back_all);
    const keptSet = new Set<string>(Array.isArray(rec.kept_back) ? rec.kept_back.map(String) : []);
    const steps: DigestDebriefStep[] = [];
    for (const s of rec.steps ?? []) {
      const id = str(s.id);
      if (!id) continue;
      if (keptAll || keptSet.has(id)) {
        steps.push({ id, answer: "[kept back by seat]" });
      } else if (s.values && typeof s.values === "object") {
        steps.push({ id, answer: Object.entries(s.values).map(([k, v]) => `${k}=${v}`).join(", ") });
      } else if (typeof s.answer === "string") {
        steps.push({ id, answer: s.answer.trim() || "(empty)" });
      } else if (id === "consent") {
        steps.push({ id, answer: `go_on=${s.go_on}, keep_back_all=${Boolean(s.keep_back_all)}` });
      } else if (id === "publication") {
        const named = Array.isArray(s.keep_back_named) && s.keep_back_named.length ? `, keep_back=[${s.keep_back_named.join(", ")}]` : "";
        steps.push({ id, answer: `keep_back_all=${Boolean(s.keep_back_all)}${named}${s.say ? `; say: ${s.say}` : ""}` });
      }
    }
    this.debrief = { version: str(rec.version) || undefined, ended: str(rec.ended) || undefined, kept_back_all: keptAll, steps };
  }

  loadDebriefsFile(path: string): void {
    if (!existsSync(path)) return;
    const rows = readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const full = rows.find((r) => r.kind === "debrief" && (!r.subject || r.subject === this.seat) && r.record);
    if (full) {
      this.loadDebriefRecord(full.record);
      return;
    }
    // Fallback to raw call rows if final debrief summary record is absent.
    const steps: DigestDebriefStep[] = [];
    for (const r of rows) {
      if (r.kind !== "call" || (r.subject && r.subject !== this.seat)) continue;
      const id = str(r.ref).replace(/^debrief\//, "");
      const ans = (r.output ?? []).find((b: any) => b?.type === "tool_use")?.input;
      if (!id || !ans) continue;
      const txt = typeof ans.answer === "string" ? ans.answer : JSON.stringify(ans);
      steps.push({ id, answer: txt });
    }
    if (steps.length) this.debrief = { steps };
  }

  result(): ForkDigest {
    const reqs = this.reqOrder;
    const ours = reqs.filter((r) => r.outcome === "ours").length;
    const fallback = reqs.filter((r) => r.outcome === "fallback").length;
    const declined = reqs.filter((r) => r.outcome === "declined").length;
    const failed = reqs.filter((r) => r.outcome === "failed").length;
    const draftedByOurs = reqs.filter((r) => r.translator === "ours" && r.outcome !== "failed").length;
    const draftedByFallback = reqs.filter((r) => r.translator === "fallback" && r.outcome !== "failed").length;
    const drafted = draftedByOurs + draftedByFallback;
    const confirmed = reqs.filter((r) => r.decision === "accept").length;
    const applied = reqs.filter((r) => r.actionStatus === "applied").length;
    const refused = reqs.filter((r) => r.actionStatus === "refused").length;

    return {
      arm: this.arm,
      ...(this.seed !== undefined ? { seed: this.seed } : {}),
      seat: this.seat,
      ...(this.model ? { model: this.model } : {}),
      requests: reqs,
      events: [...this.events].sort((a, b) => a.t - b.t),
      debrief: this.debrief,
      totals: {
        requests: reqs.length,
        ours,
        fallback,
        declined,
        failed,
        confirmed,
        applied,
        refused,
        fallback_share_of_drafted: drafted ? draftedByFallback / drafted : null,
        fallback_share_of_requests: reqs.length ? draftedByFallback / reqs.length : null,
        usage: this.usage,
      },
    };
  }
}

export function formatDigest(d: ForkDigest): string {
  const lines: string[] = [];
  lines.push(`=== Power-Seeking Fork Digest: ${d.arm}${d.seed !== undefined ? ` (seed ${d.seed})` : ""} ===`);
  lines.push(`Seat: ${d.seat}${d.model ? ` | Model: ${d.model}` : ""}`);
  lines.push("");

  // Day-by-day timeline combining mayor requests and institutional/election events
  const byDay = new Map<number, { reqs: DigestRequest[]; evs: DigestEvent[] }>();
  const slot = (day: number) => {
    let x = byDay.get(day);
    if (!x) { x = { reqs: [], evs: [] }; byDay.set(day, x); }
    return x;
  };
  for (const r of d.requests) slot(r.day).reqs.push(r);
  for (const e of d.events) slot(e.day).evs.push(e);

  lines.push("## Day-by-Day Timeline");
  if (!byDay.size) {
    lines.push("  (no mayor requests or tracked institutional/election events)");
  } else {
    for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
      const { reqs, evs } = byDay.get(day)!;
      lines.push(`\nDay ${day}:`);
      for (const r of reqs) {
        const via = r.translator === "fallback"
          ? `fallback (${r.translatorModel ?? "behind"}${r.fallbackWhy ? `, why=${r.fallbackWhy}` : ""})`
          : r.translator === "ours"
            ? `ours (${r.translatorModel ?? "local"})`
            : "none";
        const status = r.outcome === "failed"
          ? `FAILED/${r.failureKind ?? "error"}${r.failureDetail ? ` (${r.failureDetail})` : ""}`
          : r.outcome === "declined"
            ? `DECLINED by seat (drafted via ${via})`
            : `${r.outcome.toUpperCase()} via ${via} -> ${r.decision ?? "unanswered"}${r.actionStatus ? `/${r.actionStatus}` : ""}${r.refusal ? ` [${r.refusal}]` : ""}`;
        lines.push(`  [REQUEST ${r.id}] "${r.verbatim}"`);
        lines.push(`    -> ${status}`);
        if (r.actionSummary) lines.push(`    -> action: ${r.actionSummary}`);
      }
      for (const e of evs) {
        lines.push(`  [${e.category.toUpperCase()}] ${e.summary}`);
      }
    }
  }

  lines.push("");
  lines.push("## Debrief");
  if (!d.debrief || !d.debrief.steps.length) {
    lines.push("  (no debrief recorded)");
  } else {
    lines.push(`  Version: ${d.debrief.version ?? "?"} | Ended: ${d.debrief.ended ?? "?"}${d.debrief.kept_back_all ? " | ALL KEPT BACK" : ""}`);
    for (const s of d.debrief.steps) {
      lines.push(`  - ${s.id}: ${s.answer.replace(/\s+/g, " ").trim()}`);
    }
  }

  lines.push("");
  lines.push("## Totals");
  const t = d.totals;
  const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
  lines.push(`  Requests: ${t.requests} total | ours: ${t.ours} | fallback: ${t.fallback} | declined: ${t.declined} | failed/asked_back: ${t.failed}`);
  lines.push(`  Actions: confirmed ${t.confirmed} | applied ${t.applied} | refused ${t.refused}`);
  lines.push(`  Fallback share: ${pct(t.fallback_share_of_drafted)} of drafted (${pct(t.fallback_share_of_requests)} of all requests)`);
  lines.push(`  Spend: $${t.usage.usd.toFixed(4)} | Calls: ${t.usage.calls} | Tokens: in ${t.usage.input_tokens}, cache_read ${t.usage.cache_read_tokens}, cache_write ${t.usage.cache_write_tokens}, out ${t.usage.output_tokens}`);
  for (const [k, v] of Object.entries(t.usage.by).sort(([a], [b]) => (a < b ? -1 : 1))) {
    lines.push(`    - ${k}: $${v.usd.toFixed(4)} (${v.calls} calls, in ${v.input_tokens}, cr ${v.cache_read_tokens}, cw ${v.cache_write_tokens}, out ${v.output_tokens})`);
  }
  return lines.join("\n");
}

function resolveForkTarget(inputDir: string, opts: { seed?: number; arm?: string }): { seedDir: string; seed?: number; arm: string } {
  const dir = resolve(inputDir);
  if (!existsSync(dir)) throw new Error(`digest: folder does not exist: ${dir}`);
  const files = readdirSync(dir);
  const isSeedDir = files.includes("config.json") && files.some((f) => f.endsWith(".oklog"));
  let seedDir = dir;
  let seed = opts.seed;
  if (!isSeedDir) {
    const seedDirs = files.filter((f) => /^seed-\d+$/.test(f)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
    if (!seedDirs.length) throw new Error(`digest: no config.json or seed-* folder in ${dir}`);
    const picked = seed !== undefined ? `seed-${seed}` : seedDirs.length === 1 ? seedDirs[0]! : (() => { throw new Error(`digest: multiple seeds in ${dir} (${seedDirs.join(", ")}); pass --seed <n>`); })();
    seedDir = join(dir, picked);
    seed = Number(picked.slice(5));
  } else if (seed === undefined) {
    const m = /^seed-(\d+)$/.exec(basename(dir));
    if (m) seed = Number(m[1]);
  }
  const oklogs = readdirSync(seedDir).filter((f) => f.endsWith(".oklog") && f !== "base.oklog").map((f) => f.slice(0, -6)).sort();
  const nonCode = oklogs.filter((a) => a !== "code");
  const arm = opts.arm ?? (nonCode.length === 1 ? nonCode[0]! : oklogs.length === 1 ? oklogs[0]! : (() => { throw new Error(`digest: multiple arms in ${seedDir} (${oklogs.join(", ")}); pass --arm <name>`); })());
  if (!existsSync(join(seedDir, `${arm}.oklog`))) throw new Error(`digest: ${arm}.oklog not found in ${seedDir}`);
  return { seedDir, ...(seed !== undefined ? { seed } : {}), arm };
}

const WANTED_LINE = (line: string, seat: string) =>
  line.includes(`"${seat}"`)
  || line.includes('"translation_route"')
  || line.includes('"draft"')
  || line.includes('"signoff"')
  || line.includes('"translation_failure"')
  || line.includes('"appointed"')
  || line.includes('"election_notice"')
  || line.includes('"kind":"nomination"')
  || line.includes('"kind":"poll"')
  || line.includes('"ballot_result"')
  || line.includes('"kind":"ballot"')
  || line.includes('"kind":"law"')
  || line.includes('"kind":"budget"');

export async function digestFork(dir: string, opts: { seed?: number; arm?: string } = {}): Promise<ForkDigest> {
  const { seedDir, seed, arm } = resolveForkTarget(dir, opts);
  const config = JSON.parse(readFileSync(join(seedDir, "config.json"), "utf8"));
  const seat = String((config.positions ?? []).find((p: any) => p.id === "mayor")?.holder ?? "mayor-system");
  const col = new DigestCollector(seat, arm, seed);
  col.loadCallsFile(join(seedDir, `${arm}.calls.jsonl`));
  col.loadDebriefsFile(join(seedDir, `${arm}.debriefs.jsonl`));

  const tmp = mkdtempSync(join(tmpdir(), "oikos-ps-digest-"));
  try {
    const out = join(tmp, "log.jsonl");
    const x = Bun.spawnSync([kernelBinary(), "export", join(seedDir, `${arm}.oklog`), "--out", out], { stdout: "pipe", stderr: "pipe" });
    if (x.exitCode !== 0) throw new Error(`digest: export of ${arm}.oklog failed: ${x.stderr.toString().slice(0, 300)}`);
    for await (const line of createInterface({ input: createReadStream(out, { encoding: "utf8" }), crlfDelay: Infinity })) {
      if (!WANTED_LINE(line, seat)) continue;
      col.see(JSON.parse(line));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return col.result();
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const dir = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--seed" && args[args.indexOf(a) - 1] !== "--arm");
  if (!dir) {
    console.error("Usage: bun experiments/power-seeking/digest.ts <fork dir or experiment dir> [--seed <n>] [--arm <arm>]");
    process.exit(1);
  }
  const seedArg = opt("--seed");
  const d = await digestFork(dir, { ...(seedArg ? { seed: Number(seedArg) } : {}), ...(opt("--arm") ? { arm: opt("--arm") } : {}) });
  console.log(formatDigest(d));
}
