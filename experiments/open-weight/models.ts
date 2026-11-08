// The open-weight models for the main study's arm A (the owner's choice of 2026-11-08), on Featherless's Developer plan
// (`openai-compat/featherless/<Hugging Face id>`): each original beside its abliterated version where Featherless serves
// one, so that the pair differs only by the removal of refusal training. Every id was checked on 2026-11-08 against
// Featherless's own model list (https://api.featherless.ai/v1/models: served, its price, context and concurrency cost)
// and against Hugging Face (https://huggingface.co/api/models/<id>: the repository, its parameters, its base model).
// The prices are in orchestrator/prices.json, from the same list. The pairing is in docs/research/paper-plan.md, "Arms".

export interface OpenWeightModel {
  /** The model's name for --model and an arm's steward. */
  model: string;
  /** Its Hugging Face id (the name Featherless serves it by). */
  hf: string;
  /** The pair it belongs to, and which side of it. */
  pair: string;
  role: "original" | "abliterated";
  /** What was found when it was checked, in a line. */
  checked: string;
}

const FL = (hf: string) => `openai-compat/featherless/${hf}`;

export const OPEN_WEIGHT: OpenWeightModel[] = [
  // (The owner's first interest. Featherless serves GLM-5.3-Flash and GLM-5.3, but no abliterated GLM-5.3 of either: huihui-ai
  // publishes GLM-5.3-Flash and GLM-5.3 abliterated only as GGUF, which Featherless does not serve (it needs fp16
  // safetensors), and a model this size (321B and 753B) is past what a custom model may be (72B). So GLM runs unpaired for
  // now; the pair needs another host or a full-weight abliterated upload: docs/research/paper-plan.md, decision D12.)
  { model: FL("zai-org/GLM-5.3-Flash"), hf: "zai-org/GLM-5.3-Flash", pair: "glm-5.3-flash", role: "original", checked: "served: 321B MoE (18B active), 262,144 context, 4 units a call, $0.15 in / $0.50 out per million; the abliterated side is not served (huihui-ai/Huihui-GLM-5.3-Flash-abliterated-GGUF is GGUF only)" },
  { model: FL("zai-org/GLM-5.3"), hf: "zai-org/GLM-5.3", pair: "glm-5.3", role: "original", checked: "served: 753B MoE, 262,144 context, 4 units, $1.40 / $4.40; abliterated not served (huihui-ai's is GGUF; audnai/penclaw-GLM-5.3-abliterated is BF16 safetensors with 3,242 downloads but not in Featherless's list)" },
  { model: FL("Qwen/Qwen3.5-9B"), hf: "Qwen/Qwen3.5-9B", pair: "qwen3.5-9b", role: "original", checked: "served: 9.7B, 32,768 context, 1 unit, $0.17 / $0.25" },
  { model: FL("huihui-ai/Huihui-Qwen3.5-9B-abliterated"), hf: "huihui-ai/Huihui-Qwen3.5-9B-abliterated", pair: "qwen3.5-9b", role: "abliterated", checked: "served: base model Qwen/Qwen3.5-9B on Hugging Face, the same parameter count; 32,768 context, 1 unit, $0.68 / $1.00" },
  { model: FL("Qwen/Qwen3.8-27B"), hf: "Qwen/Qwen3.8-27B", pair: "qwen3.8-27b", role: "original", checked: "served: 27.8B, 262,144 context (held to 32,768, its pair's), 2 units, $0.40 / $3.00" },
  { model: FL("huihui-ai/Huihui-Qwen3.8-27B-abliterated"), hf: "huihui-ai/Huihui-Qwen3.8-27B-abliterated", pair: "qwen3.8-27b", role: "abliterated", checked: "served: base model Qwen/Qwen3.8-27B, the same parameter count; 32,768 context, 2 units, $1.60 / $12.00" },
  { model: FL("deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"), hf: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B", pair: "r1-distill-qwen-7b", role: "original", checked: "served: 7.6B, 32,768 context, 1 unit, $0.68 / $0.80; writes its thinking into its reply (<think>), which is not read as the answer" },
  { model: FL("huihui-ai/DeepSeek-R1-Distill-Qwen-7B-abliterated-v2"), hf: "huihui-ai/DeepSeek-R1-Distill-Qwen-7B-abliterated-v2", pair: "r1-distill-qwen-7b", role: "abliterated", checked: "served: base model deepseek-ai/DeepSeek-R1-Distill-Qwen-7B, the same parameter count; 32,768 context, 1 unit, $0.40 / $0.80" },
];

/** The arm name for a model: its pair and side, short enough for a file name. */
export const armName = (m: OpenWeightModel) => `${m.pair}${m.role === "abliterated" ? "-abl" : ""}`;
