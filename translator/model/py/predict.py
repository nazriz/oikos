"""A trained model answering requests, one a line.

  uv run python predict.py <MODEL>

Reads lines of {"pieces": [...], "breaks": [...]} and writes for each a line {"steps": [...], "sure": p}: the steps
of the program (translator/model/encode.ts turns them into one) and how sure the model is of the whole. On the CPU,
greedily: the same input gives the same answer.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import torch
from safetensors.torch import load_file

from model import Config, Translator, features


def main() -> None:
    d = Path(sys.argv[1])
    cfg = Config(**json.loads((d / "config.json").read_text()))
    model = Translator(cfg)
    model.load_state_dict(load_file(str(d / "model.safetensors")))
    model.eval()
    torch.set_num_threads(4)
    print(json.dumps({"ready": True, "parameters": sum(p.numel() for p in model.parameters())}), flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        r = json.loads(line)
        t0 = time.perf_counter()
        if len(r["pieces"]) > cfg.max_pieces or not r["pieces"]:
            print(json.dumps({"steps": ["none:unclear", "eos"], "sure": 1.0, "ms": 0.0, "too_long": True}), flush=True)
            continue
        f = {k: v.unsqueeze(0) for k, v in features(r["pieces"], r.get("breaks", []), cfg).items()}
        steps, sure = model.translate(f)
        print(json.dumps({"steps": steps, "sure": sure, "ms": round(1000 * (time.perf_counter() - t0), 2)}), flush=True)


if __name__ == "__main__":
    main()
