"""Teacher-forced states on training rows (the export's steps): one forward pass gives the writer's state before every
decision of the label, as in training (Translator.loss). For fitting readouts on what the model was taught.
  from forced import train_items, forced_states"""
import json, random
from pathlib import Path

import torch
import harness  # noqa: F401  (sys.path)
import train as T

EXPORT = "/Users/clawd/oikos/runs/translator-v4-r3-2026-11-08/data-v4c-export/train.jsonl"


def train_rows(pick, n_cap=None, seed=7, path=EXPORT):
    """Rows of the training export for which pick(row) is true, one per id, shuffled, at most n_cap."""
    seen, out = set(), []
    with open(path) as f:
        for line in f:
            r = json.loads(line)
            if r["id"] + r.get("mode", "") in seen or not pick(r):
                continue
            seen.add(r["id"] + r.get("mode", ""))
            out.append(r)
    random.Random(seed).shuffle(out)
    return out[:n_cap] if n_cap else out


@torch.no_grad()
def forced_states(m, tok, rows):
    """For each row that can be read: (row, states [T, d], choice ids [T], slot names [T], ps/pe per span step)."""
    m.masks = m.masks_
    out = []
    for it in T.prepare(rows, m, tok, {}):
        b = T.together([it], torch.device("cpu"))
        read = m.read(b, b["pad"])
        choice, start, end = b["choice"], b["start"], b["end"]
        bos = torch.full_like(choice[:, :1], m.n_choices)
        zero = torch.zeros_like(start[:, :1])
        inputs = m.step_inputs(read, torch.cat([bos, choice[:, :-1].clamp(min=0)], 1), torch.cat([zero, start[:, :-1]], 1), torch.cat([zero, end[:, :-1]], 1))
        inputs = inputs + m.slot_inputs(read, b["slot"], b["slot_start"], b["slot_end"], b["slot_named"])
        state = m.write(read, b["pad"], inputs)[0]
        out.append({"row": it["row"], "state": state, "choice": it["choice"], "slot": [m.cfg.slots[s] for s in it["slot"]],
                    "mask": it["mask"], "start": it["start"], "end": it["end"], "read": read, "pad": b["pad"]})
    return out
