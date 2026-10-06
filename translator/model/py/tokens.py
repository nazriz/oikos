"""What the model was shown as a pretrained encoder's tokens, and back (the second arm: a reader that has read before).

The export gives an input as pieces with where each starts and ends in the input's characters. A pretrained encoder
has its own tokens, so a span of pieces becomes a span of tokens (the first and the last token that cover exactly
its characters) and, at an answer, a span of tokens becomes pieces again. A span is only ever whole pieces, so where
a token runs across the edge of a span (one token for "5," when the span ends at 5) the example can't be pointed at
exactly: `spans` returns None and whoever asked decides (training leaves the example out and counts it).
"""
from __future__ import annotations

from dataclasses import dataclass

import torch


def text_of(pieces: list[str], at: list[list[int]], breaks: list[int]) -> str:
    """The input again from its pieces: each where it stood, a new line before the piece that begins one, spaces
    between. (Whatever white space stood between two pieces, a tokenizer reads it as one space.)"""
    buf = [" "] * (at[-1][1] if at else 0)
    for p, (a, b) in zip(pieces, at):
        buf[a:b] = p
    for b in breaks:
        if 0 < b < len(at) and at[b][0] > 0:
            buf[at[b][0] - 1] = "\n"
    return "".join(buf)


@dataclass
class Tokens:
    ids: list[int]
    line: list[int]
    # Each token's characters, without the white space before it; (0, 0) for a token that is none of the input.
    span: list[tuple[int, int]]
    starts: dict[int, int]
    ends: dict[int, int]

    def features(self) -> dict[str, torch.Tensor]:
        return {"tokens": torch.tensor(self.ids, dtype=torch.long), "line": torch.tensor(self.line, dtype=torch.long)}


def tokenize(tokenizer, text: str, max_lines: int) -> Tokens:
    """Never cut short: a caller that has a limit looks at the length and decides."""
    e = tokenizer(text, return_offsets_mapping=True, add_special_tokens=True, truncation=False, verbose=False)
    span, line, starts, ends = [], [], {}, {}
    newlines = [k for k, c in enumerate(text) if c == "\n"]
    for i, (a, b) in enumerate(e["offset_mapping"]):
        while a < b and text[a].isspace():
            a += 1
        while b > a and text[b - 1].isspace():
            b -= 1
        span.append((a, b))
        if b > a:
            starts.setdefault(a, i)
            ends[b] = i
        line.append(min(sum(1 for n in newlines if n < a), max_lines - 1) if b > a else (line[-1] if line else 0))
    return Tokens(list(e["input_ids"]), line, span, starts, ends)


def spans(t: Tokens, at: list[list[int]], steps: list) -> list[tuple[int, int]] | None:
    """Each step's first and last token ((0, 0) for a choice); None if some span isn't exactly a run of tokens."""
    out = []
    for s in steps:
        if isinstance(s, str):
            out.append((0, 0))
            continue
        a, z = t.starts.get(at[s[1]][0]), t.ends.get(at[s[2]][1])
        if a is None or z is None or z < a:
            return None
        out.append((a, z))
    return out


def to_pieces(t: Tokens, at: list[list[int]], steps: list) -> list:
    """A model's steps over tokens as steps over pieces: a span is the pieces its tokens' characters touch. A span
    whose tokens are none of the input (the encoder's own marks) points at nothing: the piece index is -1, and no
    program is made of it."""
    def piece(c: int) -> int:
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
    out = []
    for s in steps:
        if isinstance(s, str):
            out.append(s)
            continue
        (a, a_end), (z_start, z) = t.span[s[1]], t.span[s[2]]
        out.append([s[0], piece(a) if a_end > a else -1, piece(z - 1) if z > z_start else -1])
    return out


def check(data: str, encoder: str) -> dict:
    """Over an exported set: how long inputs are in this encoder's tokens, and whether every span is exactly a run
    of tokens and comes back as the same pieces."""
    import json
    from pathlib import Path
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(encoder)
    report: dict = {"encoder": encoder}
    for side in ("train", "validation"):
        lengths, n_spans, inexact, not_back, examples_inexact, why = [], 0, 0, 0, 0, {}
        for l in (Path(data) / f"{side}.jsonl").read_text().splitlines():
            if not l.strip():
                continue
            r = json.loads(l)
            text = text_of(r["pieces"], r["at"], r["breaks"])
            t = tokenize(tokenizer, text, 12)
            lengths.append(len(t.ids))
            bad = False
            for s in r["steps"]:
                if isinstance(s, str):
                    continue
                n_spans += 1
                m = spans(t, r["at"], [s])
                if m is None:
                    inexact += 1; bad = True
                    a, z = r["at"][s[1]][0], r["at"][s[2]][1]
                    for x, y in t.span:
                        if y > x and x < z and y > a and (x < a or y > z):
                            why[text[x:y]] = why.get(text[x:y], 0) + 1
                elif to_pieces(t, r["at"], [[s[0], m[0][0], m[0][1]]]) != [s]:
                    not_back += 1; bad = True
            examples_inexact += bad
        lengths.sort()
        q = lambda p: lengths[min(len(lengths) - 1, int(p * len(lengths)))]
        report[side] = {"examples": len(lengths), "tokens": {"median": q(0.5), "p90": q(0.9), "p99": q(0.99), "p999": q(0.999), "longest": lengths[-1]},
                        "over": {str(k): sum(1 for x in lengths if x > k) for k in (256, 384, 512, 768, 1024)},
                        "spans": n_spans, "spans_not_exactly_tokens": inexact, "spans_not_back_as_the_same_pieces": not_back, "examples_with_such_a_span": examples_inexact,
                        "tokens_across_a_span_edge": dict(sorted(why.items(), key=lambda kv: -kv[1])[:20])}
    return report


if __name__ == "__main__":
    # uv run python tokens.py <DATA> [ENCODER]
    import json
    import sys
    print(json.dumps(check(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "microsoft/deberta-v3-xsmall"), indent=1, ensure_ascii=False))
