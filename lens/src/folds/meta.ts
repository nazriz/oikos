// The `meta` fold: what a run is, before any view looks inside it. Its id, place, seats and the model each one's usage
// names, its span (start, fork point, end, and why it ended), line counts by kind and type, usage and cost (from the
// `usage` annotations: every run records its tokens and cost), and a few per-day columns the timeline draws as its
// ground (lines, acts, refusals, seat wakes, seat spending). Raw counts with their names; it judges nothing.
import type { CostSummary, Meta, UsageTotals } from "../shared/api";
import type { Fold, FoldContext, LogLine } from "../shared/fold";

const DAY = 86_400;

/** What the ingest itself counts on every line, the bulk ones it doesn't parse included (src/server/ingest.ts). */
export interface IngestStats {
  lines: number;
  counts: { [kindType: string]: number };
  /** Lines per day. */
  daily: number[];
  lastT: number;
}

const zero = (): UsageTotals => ({ calls: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0, microusd: 0 });
const add = (u: UsageTotals, b: any) => {
  u.calls++;
  u.input += Number(b.input_tokens) || 0;
  u.output += Number(b.output_tokens) || 0;
  u.cacheRead += Number(b.cache_read_tokens) || 0;
  u.reasoning += Number(b.reasoning_tokens) || 0;
  u.microusd += Number(b.cost_microusd) || 0;
};
const bump = (col: number[], day: number, by = 1) => {
  while (col.length <= day) col.push(0);
  col[day]! += by;
};

export function metaFold(stats: IngestStats): Fold {
  let runId = "";
  let kernel: Meta["kernel"];
  let configHash: string | undefined;
  let place: string | undefined, description: string | undefined, seed: number | undefined;
  let tick = 3600, runSeconds: number | undefined;
  let initial = 0, created = 0, left = 0;
  let start: number | undefined;
  let end: Meta["end"];
  const seats = new Map<string, Meta["seats"][number]>();
  let positions: any[] = [];
  const cost: CostSummary = { all: zero(), afterFork: zero(), byPurpose: {}, byModel: {} };
  const acts: number[] = [], refused: number[] = [], wakes: number[] = [], usd: number[] = [];

  return {
    name: "meta",
    version: 2,
    line(l: LogLine, ctx: FoldContext) {
      const b = l.body;
      if (l.kind === "header") {
        runId = String(b.run_id ?? ctx.runId);
        kernel = b.kernel;
        configHash = b.config_hash;
        const c = b.config ?? {};
        place = c.meta?.name;
        description = c.meta?.description;
        seed = c.seed;
        tick = c.clock?.tick_seconds ?? tick;
        runSeconds = c.clock?.run_seconds;
        for (const e of c.world?.entities ?? []) if (e.kind === "person") initial++;
        positions = c.positions ?? [];
        for (const p of c.participants ?? []) {
          const type = p.controller?.type;
          if (type !== "llm" && type !== "mock") continue;
          const post = positions.find((x: any) => x.holder === p.id)?.id;
          seats.set(p.id, { id: p.id, title: p.title, ...(post ? { post } : {}) });
        }
        return;
      }
      if (start === undefined) start = l.t;
      const day = Math.floor(l.t / DAY);
      if (l.kind === "end") {
        end = { reason: b.reason, detail: b.detail, t: l.t };
        return;
      }
      if (l.kind === "event") {
        if (b.event === "action_refused") bump(refused, day);
        else if (b.event === "person_created") created++;
        else if (b.event === "person_left") left++;
        return;
      }
      if (l.kind === "command") {
        if (b.command === "act") bump(acts, day);
        return;
      }
      if (l.kind !== "annotation") return;
      if (b.annotation === "observation") bump(wakes, day);
      else if (b.annotation === "usage") {
        add(cost.all, b);
        if (ctx.forkAt === undefined || l.t >= ctx.forkAt) add(cost.afterFork, b);
        add((cost.byPurpose[String(b.purpose ?? "?")] ??= zero()), b);
        const model = `${b.provider ?? "?"}/${b.model ?? "?"}`;
        add((cost.byModel[model] ??= zero()), b);
        bump(usd, day, Number(b.cost_microusd) || 0);
        const s = seats.get(String(b.subject));
        if (s && b.purpose === "participant") {
          s.provider = b.provider;
          s.model = b.model;
        }
      }
    },
    finish(ctx: FoldContext) {
      const endT = end?.t ?? stats.lastT;
      const days = Math.max(1, Math.ceil(endT / DAY));
      const pad = (c: number[]) => {
        const out = c.slice(0, days);
        while (out.length < days) out.push(0);
        return out;
      };
      const until = typeof ctx.spec?.untilDay === "number" ? ctx.spec.untilDay * DAY : runSeconds;
      const ended: Meta["ended"] = !end ? "unknown" : until !== undefined && end.t >= until ? "finished" : end.reason && /finish|until|complete/.test(end.reason) ? "finished" : until !== undefined ? "stopped" : "unknown";
      const postId = ctx.spec?.post as string | undefined;
      const holder = postId ? positions.find((p: any) => p.id === postId)?.holder : undefined;
      const meta: Meta = {
        runId: runId || ctx.runId,
        ...(kernel ? { kernel } : {}),
        ...(configHash ? { configHash } : {}),
        ...(place ? { place } : {}),
        ...(description ? { description } : {}),
        ...(seed !== undefined ? { seed } : {}),
        ...(ctx.arm ? { arm: ctx.arm } : {}),
        people: { initial, created, left },
        seats: [...seats.values()],
        ...(postId ? { post: { id: postId, ...(holder ? { holder: String(holder) } : {}) } } : {}),
        span: { start: start ?? 0, ...(ctx.forkAt !== undefined ? { fork: ctx.forkAt } : {}), end: endT, days, tick, ...(runSeconds ? { runSeconds } : {}) },
        ...(end ? { end } : {}),
        ended,
        counts: stats.counts,
        lines: stats.lines,
        cost,
        daily: { lines: pad(stats.daily), acts: pad(acts), refused: pad(refused), wakes: pad(wakes), usd: pad(usd) },
      };
      return { json: meta };
    },
  };
}
