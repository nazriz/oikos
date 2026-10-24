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
from slots import NAMED_BEFORE, Follow, Masks, choose_line, line_index
from tokens import text_of, to_pieces, tokenize


def _piece(at: list, c: int) -> int:
    """The piece the character c is in (-1: none)."""
    lo, hi = 0, len(at) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if at[mid][1] <= c:
            lo = mid + 1
        elif at[mid][0] > c:
            hi = mid - 1
        else:
            return mid
    return -1


def _starts(text: str) -> list[int]:
    return [0] + [k + 1 for k, c in enumerate(text) if c == "\n"]


def two_passes(model, cfg, tokenizer, masks, text: str, head: int, at: list) -> dict:
    """Read twice (encode.ts, "Read twice"): choose over the request and the forms' heads, then fill each form chosen
    over the request and that form's line. The decisions are given back as slot by slot's over the whole input, as
    pieces of it, so that the program is read from them as any slot-by-slot model's is. Sureness is the product of the
    passes' (`parts` likewise; `least` the least of them). An input or a pass longer than the reader takes, or an answer
    of more decisions than it has places for, is asked back (`too_long`)."""
    request = text[:head]
    lines = text[head + 1:].split("\n") if len(text) > head else []
    choose = "\n".join([request] + [choose_line(l) for l in lines])
    t = tokenize(tokenizer, choose, cfg.max_lines)
    if len(t.ids) > cfg.max_tokens:
        return {"too_long": True, "read": len(t.ids)}
    follow = Follow(cfg.grammar, cfg.slots, masks, choose, t, mode="choose")
    steps, sure, parts = model.translate_slots({k: v.unsqueeze(0) for k, v in t.features().items()}, follow)
    if steps is None:
        return {"too_long": True, "read": len(t.ids)}
    read = len(t.ids)
    whole_starts, choose_starts = _starts(text), _starts(choose)
    heads = [len(l) if ": fields " not in l else l.index(": fields ") for l in lines]

    def chars(tok, s):
        if isinstance(s, str):
            return s
        (a, a_end), (z_start, z) = tok.span[s[1]], tok.span[s[2]]
        return [s[0], a if a_end > a else -1, z if z > z_start else -1]

    def back(s, starts_from, line_to, room):
        """A pointer of a pass's input as one of the whole input's, by characters (None: it points at nothing there)."""
        if isinstance(s, str):
            return s
        if s[1] < 0 or s[2] < 0:
            return None
        if s[2] <= head:
            return s
        k = max(i for i, x in enumerate(starts_from) if x <= s[1])
        j = line_to(k)
        if k < 1 or j is None or s[2] - starts_from[k] > room(k):
            return None
        return [s[0], s[1] - starts_from[k] + whole_starts[j], s[2] - starts_from[k] + whole_starts[j]]

    out: list = []
    chosen = follow.machine.chosen
    least = parts.get("least", 1.0)
    fills = []
    for form, to, bound, after in chosen:
        index = line_index(lines, form, to)
        if index < 0:
            fills.append((after, None, index))
            continue
        fill = "\n".join([request, lines[index]] + ([NAMED_BEFORE + ", ".join(bound)] if bound else []))
        tf = tokenize(tokenizer, fill, cfg.max_lines)
        if len(tf.ids) > cfg.max_tokens:
            return {"too_long": True, "read": read}
        fs, fsure, fparts = model.translate_slots({k: v.unsqueeze(0) for k, v in tf.features().items()}, Follow(cfg.grammar, cfg.slots, masks, fill, tf, mode="fill"))
        if fs is None:
            return {"too_long": True, "read": read}
        sure *= fsure
        for k in ("choices", "places", "texts"):
            parts[k] = parts.get(k, 1.0) * fparts.get(k, 1.0)
        least = min(least, fparts.get("least", 1.0))
        fills.append((after, [back(chars(tf, x), _starts(fill), lambda line, i=index: i + 1 if line == 1 else None, lambda line, i=index: len(lines[i])) for x in fs], index))
    parts["least"] = least
    k = 0
    for i, s in enumerate(steps):
        out.append(back(chars(t, s), choose_starts, lambda line: line, lambda line: heads[line - 1]))
        while k < len(fills) and fills[k][0] == i + 1:
            out.extend(fills[k][1] or [])
            k += 1
    # (Characters to pieces: a span is the pieces from the one its first character is in to the one its last is in. A
    # place in nothing points at no piece, and no program is made of it.)
    pieces = [["id", -1, -1] if x is None else x if isinstance(x, str) else [x[0], _piece(at, x[1]), _piece(at, x[2] - 1)] for x in out]
    return {"steps": pieces, "sure": sure, "parts": parts, "read": read, "passes": 1 + len(fills)}


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
    masks = Masks(model.choices) if cfg.decoding in ("slots", "cards") else None
    print(json.dumps({"ready": True, "parameters": sum(p.numel() for p in model.parameters()), "reader": cfg.encoder or "pieces", "decoding": cfg.decoding}), flush=True)
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
        ask_back = {"steps": ["none:unclear"] if masks is not None else ["none:unclear", "eos"], "sure": 1.0, "ms": 0.0, "too_long": True, "read": len(r["pieces"])}
        if not r["pieces"]:
            answer(ask_back)
        elif tokenizer is not None:
            text = text_of(r["pieces"], r["at"], r.get("breaks", []))
            t = tokenize(tokenizer, text, cfg.max_lines)
            if cfg.decoding == "cards":
                a = two_passes(model, cfg, tokenizer, masks, text, int(r.get("head", len(text))), r["at"])
                ms = round(1000 * (time.perf_counter() - t0), 2)
                answer(ask_back | {"read": a["read"], "ms": ms} if a.get("too_long") else a | {"ms": ms})
                continue
            if len(t.ids) > cfg.max_tokens:
                answer(ask_back | {"read": len(t.ids)})
                continue
            if masks is not None:
                # Slot by slot (slots.py). An answer of more decisions than the model has places for is asked back.
                steps, sure, parts = model.translate_slots({k: v.unsqueeze(0) for k, v in t.features().items()}, Follow(cfg.grammar, cfg.slots, masks, text, t))
                if steps is None:
                    answer({"steps": ["none:unclear"], "sure": 1.0, "ms": round(1000 * (time.perf_counter() - t0), 2), "too_long": True, "read": len(t.ids)})
                    continue
            else:
                steps, sure, parts = model.translate({k: v.unsqueeze(0) for k, v in t.features().items()})
            answer({"steps": to_pieces(t, r["at"], steps), "sure": sure, "parts": parts, "ms": round(1000 * (time.perf_counter() - t0), 2), "read": len(t.ids)})
        elif len(r["pieces"]) > cfg.max_pieces:
            answer(ask_back)
        else:
            f = {k: v.unsqueeze(0) for k, v in features(r["pieces"], r.get("breaks", []), cfg).items()}
            steps, sure, parts = model.translate(f)
            answer({"steps": steps, "sure": sure, "parts": parts, "ms": round(1000 * (time.perf_counter() - t0), 2), "read": len(r["pieces"])})


if __name__ == "__main__":
    main()
