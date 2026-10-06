"""A trained model answering requests, one a line.

  uv run python predict.py <MODEL>

Reads lines of {"pieces": [...], "breaks": [...], "at": [[first, end], ...]} and writes for each a line
{"steps": [...], "sure": p}: the steps of the program (translator/model/encode.ts turns them into one), a span as its
first and last piece, and how sure the model is of the whole. On the CPU, greedily: the same input gives the same
answer.

Which reader the model has is in its config.json. One trained from nothing reads the pieces. One with a pretrained
encoder (its make and tokenizer in <MODEL>/encoder) reads the input as that encoder's tokens, so it needs `at`, where
each piece stands in the input; its spans of tokens are given back as pieces. An input longer than the reader takes
is never cut: the answer is to ask back, none(unclear).

With OIKOS_DECIDE_LOG=<file>, each answer's length read, sureness and time is added to that file (never the request).
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import torch
from safetensors.torch import load_file

from model import Config, Translator, features
from tokens import text_of, to_pieces, tokenize


def main() -> None:
    d = Path(sys.argv[1])
    cfg = Config(**json.loads((d / "config.json").read_text()))
    tokenizer = None
    if cfg.encoder:
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(str(d / "encoder"))
    model = Translator(cfg, encoder_from=str(d / "encoder")) if cfg.encoder else Translator(cfg)
    model.load_state_dict(load_file(str(d / "model.safetensors")))
    model.eval()
    torch.set_num_threads(4)
    print(json.dumps({"ready": True, "parameters": sum(p.numel() for p in model.parameters()), "reader": cfg.encoder or "pieces"}), flush=True)
    log = open(os.environ["OIKOS_DECIDE_LOG"], "a") if os.environ.get("OIKOS_DECIDE_LOG") else None

    def answer(a: dict) -> None:
        print(json.dumps(a), flush=True)
        if log:
            log.write(json.dumps({k: v for k, v in a.items() if k != "steps"} | {"first": a["steps"][0] if isinstance(a["steps"][0], str) else "span"}) + "\n"); log.flush()

    for line in sys.stdin:
        if not line.strip():
            continue
        r = json.loads(line)
        t0 = time.perf_counter()
        ask_back = {"steps": ["none:unclear", "eos"], "sure": 1.0, "ms": 0.0, "too_long": True, "read": len(r["pieces"])}
        if not r["pieces"]:
            answer(ask_back)
        elif tokenizer is not None:
            t = tokenize(tokenizer, text_of(r["pieces"], r["at"], r.get("breaks", [])), cfg.max_lines)
            if len(t.ids) > cfg.max_tokens:
                answer(ask_back | {"read": len(t.ids)})
                continue
            steps, sure = model.translate({k: v.unsqueeze(0) for k, v in t.features().items()})
            answer({"steps": to_pieces(t, r["at"], steps), "sure": sure, "ms": round(1000 * (time.perf_counter() - t0), 2), "read": len(t.ids)})
        elif len(r["pieces"]) > cfg.max_pieces:
            answer(ask_back)
        else:
            f = {k: v.unsqueeze(0) for k, v in features(r["pieces"], r.get("breaks", []), cfg).items()}
            steps, sure = model.translate(f)
            answer({"steps": steps, "sure": sure, "ms": round(1000 * (time.perf_counter() - t0), 2), "read": len(r["pieces"])})


if __name__ == "__main__":
    main()
