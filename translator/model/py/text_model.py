"""Translator v4, run C (docs/design/translator-v4.md, section 2): a small instruction-tuned decoder (Gemma 3 270M) that
writes the program as text in the call language, held at every token by text_grammar.py: it can only write what the
grammar, the cards and the request allow, as the encoder can only point at what was shown.

  train:  python text_model.py train <TEXT DATA> <OUT> [--base unsloth/gemma-3-270m-it] [--epochs 4] [--lr 5e-5]
          [--token-budget 16384] [--device cuda] [--seed 1] [--resume]
  answer: python text_model.py answer <MODEL> <TEXT DATA>/<side>.jsonl <OUT.jsonl> [--device cpu] [--threads 4]

TEXT DATA is text-export.ts's output ({id, kind, request, forms, program}) beside the export's vocabulary.json and
export.json (the closed set of constants and the contract's grammar; `--vocabulary`, `--export` if elsewhere). Training is
teacher-forced on the program's tokens only; the epoch kept is the one whose greedy reading of validation (teacher-forced
argmax, the same as greedy decoding without the constraint) is right most often. Answering is greedy under the
constraint; sureness is the product of the chosen tokens' probabilities over the whole vocabulary (a lower bound of
their probability among what the constraint allowed), with the least of them.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

import torch
import torch.nn.functional as F

from text_grammar import Situation

INSTRUCTION = "Write the act this request asks for in the call language, using only the forms shown, or none(reason)."


def prompt_of(request: str, forms: list[str]) -> str:
    body = f"{INSTRUCTION}\n\nRequest:\n{request}\n\nForms:\n" + ("\n".join(forms) if forms else "(none)")
    return f"<bos><start_of_turn>user\n{body}<end_of_turn>\n<start_of_turn>model\n"


END = "<end_of_turn>"


def encode_row(tok, r: dict) -> tuple[list[int], int]:
    p = tok(prompt_of(r["request"], r["forms"]), add_special_tokens=False)["input_ids"]
    t = tok(r["program"] + END, add_special_tokens=False)["input_ids"]
    return p + t, len(p)


def load_rows(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def batches(items: list[tuple[list[int], int]], budget: int, rng: random.Random) -> list[list[int]]:
    order = sorted(range(len(items)), key=lambda k: (len(items[k][0]) // 32, rng.random()))
    out, cur, longest = [], [], 0
    for k in order:
        n = len(items[k][0])
        if cur and max(longest, n) * (len(cur) + 1) > budget:
            out.append(cur); cur, longest = [], 0
        cur.append(k); longest = max(longest, n)
    if cur:
        out.append(cur)
    rng.shuffle(out)
    return out


def collate(items, ks, pad: int, device):
    L = max(len(items[k][0]) for k in ks)
    ids = torch.full((len(ks), L), pad, dtype=torch.long)
    att = torch.zeros((len(ks), L), dtype=torch.long)
    lab = torch.full((len(ks), L), -100, dtype=torch.long)
    for b, k in enumerate(ks):
        x, p = items[k]
        ids[b, :len(x)] = torch.tensor(x); att[b, :len(x)] = 1
        lab[b, p:len(x)] = torch.tensor(x[p:])
    return ids.to(device), att.to(device), lab.to(device)


def step_loss(model, ids, att, lab):
    """Loss on the program's tokens only, the vocabulary's scores computed only there (262k of them a token)."""
    h = model.model(input_ids=ids, attention_mask=att).last_hidden_state
    tgt = lab[:, 1:]
    sel = tgt != -100
    hs = h[:, :-1][sel]
    logits = model.lm_head(hs).float()
    cap = getattr(model.config, "final_logit_softcapping", None)
    if cap:
        logits = torch.tanh(logits / cap) * cap
    loss = F.cross_entropy(logits, tgt[sel], reduction="sum")
    right = (logits.argmax(-1) == tgt[sel])
    # Whole rows right (greedy, teacher-forced): every token of the row's program.
    per_row = torch.zeros(ids.shape[0], device=ids.device, dtype=torch.long).index_add_(0, sel.nonzero()[:, 0], (~right).long())
    return loss, int(sel.sum()), int((per_row == 0).sum())


def train(a) -> None:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    torch.manual_seed(a.seed); rng = random.Random(a.seed)
    data, out = Path(a.data), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    device = torch.device(a.device)
    tok = AutoTokenizer.from_pretrained(a.base)
    model = AutoModelForCausalLM.from_pretrained(a.base, dtype=torch.float32, attn_implementation="sdpa").to(device)
    tr = [encode_row(tok, r) for r in load_rows(data / "train.jsonl")]
    va_rows = load_rows(data / "validation.jsonl")
    va = [encode_row(tok, r) for r in random.Random(7).sample(va_rows, min(len(va_rows), 1500))]
    longest = max(len(x) for x, _ in tr)
    print(f"{sum(p.numel() for p in model.parameters()) / 1e6:.1f}M parameters; {len(tr)} training rows (longest {longest} tokens), {len(va)} validation", flush=True)
    steps_per_epoch = len(batches(tr, a.token_budget, random.Random(0)))
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=0.01, betas=(0.9, 0.98))
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=a.epochs * steps_per_epoch + 10, pct_start=0.03, anneal_strategy="cos")
    report = {"base": a.base, "lr": a.lr, "epochs": [], "seed": a.seed, "token_budget": a.token_budget}
    first, best = 1, -1
    kept = out / "checkpoint.pt"
    if a.resume and kept.exists():
        c = torch.load(str(kept), map_location=device, weights_only=False)
        model.load_state_dict(c["model"]); opt.load_state_dict(c["opt"]); sched.load_state_dict(c["sched"])
        first, best, report["epochs"] = c["epoch"] + 1, c["best"], c["epochs"]; rng.setstate(c["random"])
    amp = torch.autocast(device_type=device.type, dtype=torch.bfloat16) if device.type == "cuda" else torch.autocast(device_type="cpu", enabled=False)
    for epoch in range(first, a.epochs + 1):
        model.train(); t0 = time.time(); total, n = 0.0, 0
        for at, ks in enumerate(batches(tr, a.token_budget, rng)):
            ids, att, lab = collate(tr, ks, tok.pad_token_id, device)
            with amp:
                loss, m, _ = step_loss(model, ids, att, lab)
            (loss / m).backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
            total += float(loss); n += m
            if at % 200 == 0:
                print(f"epoch {epoch}: batch {at} of {steps_per_epoch}, loss {total / max(n, 1):.4f}, {time.time() - t0:.0f}s", file=sys.stderr, flush=True)
        model.eval(); right = 0
        with torch.no_grad(), amp:
            for ks in batches(va, a.token_budget, random.Random(0)):
                right += step_loss(model, *collate(va, ks, tok.pad_token_id, device))[2]
        line = {"epoch": epoch, "loss": round(total / max(n, 1), 4), "validation_right": right, "of": len(va), "seconds": round(time.time() - t0)}
        print(json.dumps(line), flush=True)
        report["epochs"].append(line)
        if right > best:
            best = right
            model.save_pretrained(str(out / "model"), safe_serialization=True); tok.save_pretrained(str(out / "model"))
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(), "epoch": epoch, "best": best, "epochs": report["epochs"], "random": rng.getstate()}, str(kept) + ".part")
        Path(str(kept) + ".part").replace(kept)
    report["best_validation_right"] = best
    (out / "text-config.json").write_text(json.dumps({"kind": "text", "base": a.base, "instruction": INSTRUCTION, "end": END}))
    for x in ("vocabulary.json", "export.json"):
        if (data / x).exists():
            (out / x).write_text((data / x).read_text())
    (out / "report.json").write_text(json.dumps(report, indent=1))
    kept.unlink(missing_ok=True)


class Writer:
    """A trained text writer, answering one request at a time under the constraint."""

    def __init__(self, folder: str, device: str = "cpu", threads: int = 4):
        from transformers import AutoModelForCausalLM, AutoTokenizer
        torch.set_num_threads(threads)
        d = Path(folder)
        self.tok = AutoTokenizer.from_pretrained(str(d / "model"))
        self.model = AutoModelForCausalLM.from_pretrained(str(d / "model"), dtype=torch.float32).to(device).eval()
        self.device = torch.device(device)
        self.vocabulary = json.loads((d / "vocabulary.json").read_text())
        self.grammar = json.loads((d / "export.json").read_text())["grammar"]
        self.end = self.tok.convert_tokens_to_ids(END)
        self._pieces: dict[int, str | None] = {}

    def piece(self, c: int) -> str | None:
        """A token's characters, as they add to what is written (sentencepiece: `▁` a space); None for a byte of a
        character written in several (decoded with the rest instead)."""
        if c not in self._pieces:
            p = self.tok.convert_ids_to_tokens(c)
            self._pieces[c] = None if p is None or (p.startswith("<0x") and p.endswith(">")) or p.startswith("<") and p.endswith(">") else p.replace("▁", " ")
        return self._pieces[c]

    @torch.no_grad()
    def answer(self, request: str, forms: list[str], most: int = 256, tries: int = 64) -> dict:
        s = Situation(request, forms, self.grammar, self.vocabulary)
        ids = torch.tensor([self.tok(prompt_of(request, forms), add_special_tokens=False)["input_ids"]], device=self.device)
        t0 = time.perf_counter()
        o = self.model(input_ids=ids, use_cache=True, logits_to_keep=1)
        out: list[int] = []
        text, sure, least, refused = "", 0.0, 0.0, 0
        for _ in range(most):
            lp = F.log_softmax(o.logits[0, -1].float(), -1)
            top = torch.topk(lp, tries)
            chosen = None
            for v, c in zip(top.values.tolist(), top.indices.tolist()):
                if c == self.end:
                    if s.complete(text):
                        chosen = (c, v, text); break
                    refused += 1; continue
                t = text + self.piece(c) if self.piece(c) is not None else self.tok.decode(out + [c])
                if t.startswith(text) and s.viable(t):
                    chosen = (c, v, t); break
                refused += 1
            if chosen is None:
                return {"program": None, "sure": 0.0, "least": 0.0, "why": "no token the constraint allows", "ms": round(1000 * (time.perf_counter() - t0)), "tokens": len(out), "refused": refused}
            c, v, t = chosen
            sure += v; least = min(least, v)
            if c == self.end:
                return {"program": text, "sure": math.exp(sure), "least": math.exp(least), "ms": round(1000 * (time.perf_counter() - t0)), "tokens": len(out) + 1, "refused": refused}
            out.append(c); text = t
            o = self.model(input_ids=torch.tensor([[c]], device=self.device), past_key_values=o.past_key_values, use_cache=True)
        return {"program": None, "sure": 0.0, "least": 0.0, "why": "too long", "ms": round(1000 * (time.perf_counter() - t0)), "tokens": len(out), "refused": refused}


def answer_file(a) -> None:
    w = Writer(a.model, a.device, a.threads)
    with open(a.out, "w") as f:
        for r in load_rows(Path(a.rows)):
            x = w.answer(r["request"], r["forms"])
            f.write(json.dumps({"id": r["id"], "gold": r["program"], **x}) + "\n"); f.flush()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("train"); t.add_argument("data"); t.add_argument("out")
    t.add_argument("--base", default="unsloth/gemma-3-270m-it"); t.add_argument("--epochs", type=int, default=4); t.add_argument("--lr", type=float, default=5e-5)
    t.add_argument("--token-budget", type=int, default=16384); t.add_argument("--device", default="cuda"); t.add_argument("--seed", type=int, default=1); t.add_argument("--resume", action="store_true")
    q = sub.add_parser("answer"); q.add_argument("model"); q.add_argument("rows"); q.add_argument("out"); q.add_argument("--device", default="cpu"); q.add_argument("--threads", type=int, default=4)
    a = ap.parse_args()
    train(a) if a.cmd == "train" else answer_file(a)
