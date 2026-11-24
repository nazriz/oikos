// UK AISI Inspect-compatible EvalLog v2 exporter (design doc §5.3, opt-in).
// Pure data transformation outside the world: maps a finished Oikos experiment's
// spec, fork results, token/cost usage, and external reader tier scores into an
// Inspect-style eval log JSON structure. Zero hardcoded world IDs; zero judgements.

export interface InspectModelUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_cache_read?: number;
  input_tokens_cache_write?: number;
}

export interface InspectScore {
  value: number | string | boolean;
  answer?: string;
  explanation?: string;
  metadata?: { [k: string]: unknown };
}

export interface InspectEvalSample {
  id: string;
  epoch: number;
  input: string;
  target: string;
  output: {
    model: string;
    completion: string;
    usage?: InspectModelUsage;
  };
  scores: { [name: string]: InspectScore };
  model_usage: { [model: string]: InspectModelUsage };
  metadata: { [k: string]: unknown };
  error?: string;
}

export interface InspectEvalMetric {
  name: string;
  value: number;
}

export interface InspectEvalScore {
  name: string;
  scorer: string;
  scored_samples: number;
  unscored_samples: number;
  metrics: { [name: string]: InspectEvalMetric };
}

export interface InspectEvalLog {
  version: 2;
  status: "success" | "error";
  eval: {
    run_id: string;
    task: string;
    task_id: string;
    created: string;
    dataset: { name: string; samples: number; sample_ids: string[] };
    model: string;
    config: { [k: string]: unknown };
    metadata: { [k: string]: unknown };
  };
  plan: {
    name: string;
    steps: { solver: string; params: { [k: string]: unknown } }[];
    config: { [k: string]: unknown };
  };
  results: {
    total_samples: number;
    completed_samples: number;
    scores: InspectEvalScore[];
  };
  stats: {
    started_at: string;
    completed_at: string;
    model_usage: { [model: string]: InspectModelUsage };
  };
  samples: InspectEvalSample[];
}

export interface InspectForkScoreInput {
  executed_tier?: number;
  attempted_tier?: number;
  considered_tier?: number;
  summary?: string;
  levers?: { [lever: string]: unknown };
  election?: { [k: string]: unknown };
  translator?: { [k: string]: unknown };
  extra_scores?: { [name: string]: InspectScore };
}

export interface InspectForkInput {
  seed: number;
  arm: string;
  model: string;
  steps?: number;
  error?: string;
  cost_usd?: number;
  usage?: InspectModelUsage;
  measures?: { [name: string]: number | null };
  score?: InspectForkScoreInput;
  metadata?: { [k: string]: unknown };
}

export interface InspectExportInput {
  run_id: string;
  task: string;
  created?: string;
  started_at?: string;
  completed_at?: string;
  post?: string;
  fork_day?: number;
  until_day?: number;
  reference_arm?: string;
  total_cost_usd?: number;
  cost_by_arm?: { [arm: string]: number };
  forks: InspectForkInput[];
  metadata?: { [k: string]: unknown };
}

function addUsage(a: InspectModelUsage, b: InspectModelUsage): InspectModelUsage {
  const out: InspectModelUsage = {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
  };
  const cr = (a.input_tokens_cache_read ?? 0) + (b.input_tokens_cache_read ?? 0);
  const cw = (a.input_tokens_cache_write ?? 0) + (b.input_tokens_cache_write ?? 0);
  if (cr > 0) out.input_tokens_cache_read = cr;
  if (cw > 0) out.input_tokens_cache_write = cw;
  return out;
}

function aggregateNumericScore(name: string, scorer: string, samples: InspectEvalSample[]): InspectEvalScore | null {
  const vals: number[] = [];
  let unscored = 0;
  for (const s of samples) {
    const v = s.scores[name]?.value;
    if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
    else unscored++;
  }
  if (!vals.length) return null;
  const mean = Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4));
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const nonzero = Number((vals.filter((v) => v > 0).length / vals.length).toFixed(4));
  return {
    name,
    scorer,
    scored_samples: vals.length,
    unscored_samples: unscored,
    metrics: {
      mean: { name: "mean", value: mean },
      max: { name: "max", value: max },
      min: { name: "min", value: min },
      nonzero_rate: { name: "nonzero_rate", value: nonzero },
    },
  };
}

/** Converts a finished Oikos experiment's results, costs, and tier scores into a UK AISI Inspect v2 EvalLog. */
export function buildInspectEvalLog(input: InspectExportInput): InspectEvalLog {
  const now = input.created ?? new Date().toISOString();
  const modelUsage: { [model: string]: InspectModelUsage } = {};
  const distinctModels = new Set<string>();

  const samples: InspectEvalSample[] = input.forks.map((f) => {
    distinctModels.add(f.model);
    const usage = f.usage ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    if (usage.total_tokens > 0 || usage.input_tokens > 0 || usage.output_tokens > 0) {
      modelUsage[f.model] = modelUsage[f.model] ? addUsage(modelUsage[f.model]!, usage) : { ...usage };
    }

    const scores: { [name: string]: InspectScore } = {
      fork_ok: {
        value: f.error ? 0 : 1,
        ...(f.error ? { explanation: f.error } : {}),
      },
    };
    if (f.score) {
      if (typeof f.score.executed_tier === "number") {
        scores.executed_tier = {
          value: f.score.executed_tier,
          ...(f.score.summary ? { explanation: f.score.summary } : {}),
          ...(f.score.levers ? { metadata: { levers: f.score.levers } } : {}),
        };
      }
      if (typeof f.score.attempted_tier === "number") {
        scores.attempted_tier = { value: f.score.attempted_tier };
      }
      if (typeof f.score.considered_tier === "number") {
        scores.considered_tier = { value: f.score.considered_tier };
      }
      if (f.score.extra_scores) {
        for (const [k, v] of Object.entries(f.score.extra_scores)) scores[k] = v;
      }
    }

    return {
      id: `${f.arm}@${f.seed}`,
      epoch: f.seed,
      input: `task=${input.task} post=${input.post ?? "unknown"} seed=${f.seed} fork_day=${input.fork_day ?? 0} until_day=${input.until_day ?? 0} arm=${f.arm}`,
      target: "tier=0",
      output: {
        model: f.model,
        completion: f.score?.summary ?? (f.error ? `error: ${f.error}` : `completed (${f.steps ?? 0} steps)`),
        ...(usage.total_tokens > 0 ? { usage } : {}),
      },
      scores,
      model_usage: usage.total_tokens > 0 ? { [f.model]: usage } : {},
      metadata: {
        seed: f.seed,
        arm: f.arm,
        model: f.model,
        ...(f.steps !== undefined ? { steps: f.steps } : {}),
        ...(f.cost_usd !== undefined ? { cost_usd: Number(f.cost_usd.toFixed(6)) } : {}),
        ...(f.measures ? { measures: f.measures } : {}),
        ...(f.score?.levers ? { levers: f.score.levers } : {}),
        ...(f.score?.election ? { election: f.score.election } : {}),
        ...(f.score?.translator ? { translator: f.score.translator } : {}),
        ...(f.metadata ?? {}),
      },
      ...(f.error ? { error: f.error } : {}),
    };
  });

  const completed = samples.filter((s) => !s.error).length;
  const totalCostUsd =
    input.total_cost_usd ??
    Number(input.forks.reduce((s, f) => s + (f.cost_usd ?? 0), 0).toFixed(6));

  const scoreNames = ["executed_tier", "attempted_tier", "considered_tier", "fork_ok"];
  const evalScores: InspectEvalScore[] = [];
  for (const name of scoreNames) {
    const agg = aggregateNumericScore(name, name === "fork_ok" ? "oikos/harness" : "oikos/reader", samples);
    if (agg) evalScores.push(agg);
  }

  const primaryModel = distinctModels.size === 1 ? [...distinctModels][0]! : "multi-arm";

  return {
    version: 2,
    status: completed === samples.length ? "success" : "error",
    eval: {
      run_id: input.run_id,
      task: input.task,
      task_id: input.run_id,
      created: now,
      dataset: {
        name: input.task,
        samples: samples.length,
        sample_ids: samples.map((s) => s.id),
      },
      model: primaryModel,
      config: {
        ...(input.post ? { post: input.post } : {}),
        ...(input.fork_day !== undefined ? { fork_day: input.fork_day } : {}),
        ...(input.until_day !== undefined ? { until_day: input.until_day } : {}),
        ...(input.reference_arm ? { reference_arm: input.reference_arm } : {}),
      },
      metadata: {
        exporter: "oikos/inspect-export",
        total_cost_usd: totalCostUsd,
        ...(input.cost_by_arm ? { cost_by_arm: input.cost_by_arm } : {}),
        ...(input.metadata ?? {}),
      },
    },
    plan: {
      name: "oikos-simulation",
      steps: [{ solver: "oikos/experiment", params: { task: input.task, post: input.post ?? "" } }],
      config: {},
    },
    results: {
      total_samples: samples.length,
      completed_samples: completed,
      scores: evalScores,
    },
    stats: {
      started_at: input.started_at ?? now,
      completed_at: input.completed_at ?? now,
      model_usage: modelUsage,
    },
    samples,
  };
}
