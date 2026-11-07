"""Translator v4's length check, before training (docs/design/translator-v4.md, section 3, step 1): whether the training
choose inputs are as long, in an encoder's tokens, as the real ones (validation-real). Exits 1 when they are not:
the training median within a quarter of the real one, and the share past 512 tokens at least half the real share.

  uv run python length_check.py <EXPORT DIR> [TOKENIZER] [--sample 0.08]
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

from tokens import text_of


def lengths(path: Path, tokenizer, sample: float, rng: random.Random) -> list[int]:
    out = []
    for l in path.read_text().splitlines():
        if not l.strip() or (sample < 1 and rng.random() >= sample):
            continue
        r = json.loads(l)
        if r.get("mode", "choose") != "choose":
            continue
        out.append(len(tokenizer(text_of(r["pieces"], r["at"], r["breaks"]), add_special_tokens=True, truncation=False, verbose=False)["input_ids"]))
    return sorted(out)


def summary(xs: list[int]) -> dict:
    q = lambda p: xs[min(len(xs) - 1, int(p * len(xs)))]
    return {"n": len(xs), "median": q(0.5), "p90": q(0.9), "over_256": round(sum(x > 256 for x in xs) / len(xs), 3), "over_512": round(sum(x > 512 for x in xs) / len(xs), 3)}


def check(train: dict, real: dict) -> list[str]:
    bad = []
    if abs(train["median"] - real["median"]) > 0.25 * real["median"]:
        bad.append(f"median {train['median']} against real {real['median']}")
    if train["over_512"] < 0.5 * real["over_512"]:
        bad.append(f"share past 512 {train['over_512']} against real {real['over_512']}")
    return bad


if __name__ == "__main__":
    from transformers import AutoTokenizer
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    sample = float(sys.argv[sys.argv.index("--sample") + 1]) if "--sample" in sys.argv else 0.08
    args = [a for a in args if a != str(sample)]
    d = Path(args[0])
    tok = AutoTokenizer.from_pretrained(args[1] if len(args) > 1 else "microsoft/deberta-v3-small")
    rng = random.Random(7)
    report = {side: summary(lengths(d / f"{side}.jsonl", tok, sample if side == "train" else 1.0, rng)) for side in ("train", "validation", "validation-real")}
    report["failures"] = check(report["train"], report["validation-real"])
    print(json.dumps(report, indent=1))
    sys.exit(1 if report["failures"] else 0)
