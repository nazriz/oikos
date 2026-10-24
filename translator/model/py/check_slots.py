"""Slot-by-slot data against the decoder's rule (slots.py), without a model:

  uv run python check_slots.py <DATA> [ENCODER or a folder with its tokenizer]

Every example's label is followed with the rule the decoder answers by, over the input as the encoder's tokens. Counts,
for each side: `misfit` (the label is not the decisions the rule lists: encode.ts and slots.py differ, and there must
be none), `inexact` (a span or a field's name that isn't exactly a run of tokens: left out of training), `long` (more
tokens than --max-tokens, 1024), `off_rule` (the label makes a decision an answer may not: there should be none), and
how many decisions an example is at most. Run before training on a new export.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from model import POINTERS
from slots import Follow, Masks, slot_names
from tokens import spans, text_of, tokenize


def check(data: str, encoder: str, max_tokens: int = 1024) -> dict:
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(encoder)
    d = Path(data)
    export = json.loads((d / "export.json").read_text())
    if export.get("decoding") not in ("slots", "cards"):
        sys.exit("not slot-by-slot data")
    grammar, names = export["grammar"], slot_names(export["grammar"])
    choices = json.loads((d / "vocabulary.json").read_text()) + [f"<{p}>" for p in POINTERS]
    index = {c: i for i, c in enumerate(choices)}
    masks = Masks(choices)
    report: dict = {"encoder": encoder, "slots": len(names), "choices": len(choices)}
    for side in ("train", "validation", "validation-real", "validation-uf"):
        if not (d / f"{side}.jsonl").exists():
            continue
        n = {"examples": 0, "misfit": 0, "inexact": 0, "long": 0, "off_rule": 0, "most_decisions": 0}
        for l in (d / f"{side}.jsonl").read_text().splitlines():
            if not l.strip():
                continue
            r = json.loads(l)
            n["examples"] += 1
            text = text_of(r["pieces"], r["at"], r["breaks"])
            t = tokenize(tokenizer, text, 12)
            if len(t.ids) > max_tokens:
                n["long"] += 1
                continue
            if spans(t, r["at"], r["steps"]) is None:
                n["inexact"] += 1
                continue
            follow = Follow(grammar, names, masks, text, t, exact=True, mode=r.get("mode", "full"))
            off, bad = False, ""
            try:
                for s in r["steps"]:
                    now = follow.now
                    if now is None:
                        bad = "misfit"
                        break
                    c = index.get(s, -1) if isinstance(s, str) else index[f"<{s[0]}>"]
                    off = off or c < 0 or not bool(masks.rows[now[2]][c])
                    follow.take_chars(s) if isinstance(s, str) else follow.take_chars(s, r["at"][s[1]][0], r["at"][s[2]][1])
                if not bad and follow.now is not None:
                    bad = "misfit"
            except Follow.Inexact:
                bad = "inexact"
            except (KeyError, ValueError, IndexError, TypeError):
                bad = "misfit"
            if bad:
                n[bad] += 1
                if bad == "misfit" and n["misfit"] <= 3:
                    print(f"misfit: {side} {r['id']}", file=sys.stderr)
                continue
            n["off_rule"] += off
            n["most_decisions"] = max(n["most_decisions"], len(r["steps"]))
        report[side] = n
    report["kinds_of_decision"] = len(masks.rows)
    return report


if __name__ == "__main__":
    print(json.dumps(check(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "microsoft/deberta-v3-small"), indent=1))
