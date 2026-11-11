"""Weight editing (2026-11-11): the served model answering a request exactly as predict.py does (two passes, cards),
with every decision recorded: which pass, which slot, the writer's state just before the head (`choose`'s input), the
head's allowed log-probabilities, what it chose, and for a copy its start and end log-probabilities.

  from harness import load, answer
  m, tok = load(MODEL_DIR)            # optionally edit m afterwards
  rec = answer(m, tok, request, forms)  # {'steps', 'sure', 'parts', 'decisions': [...]} or {'too_long': True}

Run with the translator's environment: uv run --project translator/model/py python translator/model/wsp/<script>.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "py"))

import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402
from safetensors.torch import load_file  # noqa: E402

import predict as P  # noqa: E402
import slots as S  # noqa: E402
from model import Config, Translator, POINTERS  # noqa: E402

torch.set_num_threads(4)
SERVED = "/Users/clawd/oikos/runs/translator-v4-r3-2026-11-08/models/v4r3-D-deberta-s2"


def load(d: str = SERVED):
    from transformers import AutoTokenizer
    d = Path(d)
    cfg = Config(**json.loads((d / "config.json").read_text()))
    tok = AutoTokenizer.from_pretrained(str(d / "encoder"))
    m = Translator(cfg, encoder_from=str(d / "encoder"))
    m.load_state_dict(load_file(str(d / "model.safetensors")))
    m.eval()
    m.masks_ = S.Masks(m.choices)
    return m, tok


def input_text(request: str, forms: list[str]) -> tuple[str, int]:
    """The input as the adapter builds it (inputOf, oneLine) and as predict.py reads it back (text_of: white space as
    spaces, a new line where a form begins, nothing after the last piece)."""
    req = re.sub(r"[\r\n]", " ", request)
    text = "\n".join([req] + forms)
    text = re.sub(r"[^\S\n]", " ", text).rstrip()
    return text, len(request)


class _Rec:
    """Records each decision while two_passes runs (the current Follow is the last one made)."""

    def __init__(self, m):
        self.m, self.follow, self.out, self.mode = m, None, [], None


def answer(m, tok, request: str, forms: list[str], keep_states: bool = True) -> dict:
    rec = _Rec(m)
    Base = S.Follow

    class Follow(Base):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            rec.follow, rec.mode = self, k.get("mode", "full")

    start_scores, end_scores = m.start_scores, m.end_scores

    def hook_choose(_mod, inp, logits):
        st = rec.follow.machine.state
        d = {"pass": rec.mode, "slot": st[0] if st else None, "key": st[2] if st else None,
             "taken": rec.follow.machine.taken, "logits": logits[0, 0].detach().clone()}
        if keep_states:
            d["state"] = inp[0][0, -1].detach().clone()
        rec.out.append(d)

    def hook_start(state, kind, read, pad):
        s = start_scores(state, kind, read, pad)
        if rec.out:
            rec.out[-1].setdefault("starts", []).append((int(kind[0, 0]), F.log_softmax(s[0, 0], -1).detach().clone()))
        return s

    def hook_end(state, kind, start, read, pad):
        e = end_scores(state, kind, start, read, pad)
        if rec.out:
            rec.out[-1].setdefault("ends", []).append((int(start[0, 0]), F.log_softmax(e[0, 0], -1).detach().clone()))
        return e

    h = m.choose.register_forward_hook(hook_choose)
    m.start_scores, m.end_scores = hook_start, hook_end
    P.Follow = Follow
    try:
        text, head = input_text(request, forms)
        a = P.two_passes(m, m.cfg, tok, m.masks_, text, head, _at(text))
    finally:
        h.remove()
        del m.start_scores, m.end_scores
        P.Follow = Base
    a["decisions"] = rec.out
    a["text"] = text
    return a


def _at(text: str) -> list:
    """Pieces' places: runs of non-space characters (enough for two_passes, which maps spans back by characters)."""
    return [[x.start(), x.end()] for x in re.finditer(r"\S+", text)]


def allowed_logp(m, d) -> torch.Tensor:
    """A decision's log-probabilities among what its slot allows (as translate_slots takes them)."""
    allowed = m.masks_.rows[m.masks_.of(d["key"])]
    return F.log_softmax(d["logits"].masked_fill(~allowed, float("-inf")), -1)
