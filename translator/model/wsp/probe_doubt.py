"""Candidate 2 (sure and wrong): at a decision the model is very sure of, does its state say it is wrong better than its
own probability does?   uv run --project translator/model/py python translator/model/wsp/probe_doubt.py
Every decision of the label, teacher-forced (the state the model is in when everything before was right): the head's
choice against the label's, and for a copy its start and end against the label's. A readout of "wrong here" is fitted
on the generated validation side (validation.jsonl, never a scored set) and read on the real one (validation-real,
in the model's own language), beside the head's own probability of what it chose. Only decisions of probability
0.99 or more are compared: where the cut-off (0.9996) works. Writes probe-doubt.json and doubt-readout.pt."""
import json
import numpy as np
import torch
import torch.nn.functional as F
from harness import load
from forced import train_rows, forced_states
from readout import fit
from model import POINTERS

OUT = "/Users/clawd/oikos/runs/translator-weight-edit-2026-11-11"
VAL = "/Users/clawd/oikos/runs/translator-v4-r3-2026-11-08/data-v4c-export/validation.jsonl"
REAL = "/Users/clawd/oikos/runs/translator-v4-r3-2026-11-08/data-v4c-export/validation-real.jsonl"
m, tok = load()


@torch.no_grad()
def decisions(path, cap=None):
    out = []
    for f in forced_states(m, tok, train_rows(lambda r: True, cap, path=path)):
        st = f["state"]
        allowed = torch.stack([m.masks_.rows[k] for k in f["mask"]])
        lp = F.log_softmax(m.choose(st).masked_fill(~allowed, float("-inf")), -1)
        for t, c in enumerate(f["choice"]):
            h = int(lp[t].argmax()); p = float(lp[t, h])
            wrong = h != c
            kind = "choice"
            if not wrong and c >= m.first_pointer:
                k = torch.tensor([[c - m.first_pointer]])
                ps = F.log_softmax(m.start_scores(st[t:t + 1].unsqueeze(0), k, f["read"], f["pad"])[0, 0], -1)
                a = f["start"][t]
                pe = F.log_softmax(m.end_scores(st[t:t + 1].unsqueeze(0), k, torch.tensor([[a]]), f["read"], f["pad"])[0, 0], -1)
                wrong = int(ps.argmax()) != a or int(pe.argmax()) != f["end"][t]
                p += float(ps.max()) + float(pe.max())
                kind = POINTERS[c - m.first_pointer]
            out.append({"state": st[t].numpy(), "p": float(np.exp(p)), "wrong": wrong, "kind": kind, "slot": f["slot"][t], "id": f["row"]["id"], "mode": f["row"].get("mode")})
    return out


def auc(score, y):
    y = np.array(y, bool); s = np.array(score)
    if y.all() or not y.any(): return None
    pos, neg = s[y], s[~y]
    return float((pos[:, None] > neg[None, :]).mean() + 0.5 * (pos[:, None] == neg[None, :]).mean())


tr = decisions(VAL)
te = decisions(REAL)
sure = lambda D: [d for d in D if d["p"] >= 0.99]
trs, tes = sure(tr), sure(te)
print("generated validation: decisions", len(tr), "sure", len(trs), "wrong among sure", sum(d["wrong"] for d in trs))
print("real validation: decisions", len(te), "sure", len(tes), "wrong among sure", sum(d["wrong"] for d in tes), flush=True)
X = np.array([d["state"] for d in trs]); Y = np.array([int(d["wrong"]) for d in trs])
probe = fit(X, Y, 2, l2=1e-2)
torch.save({"W": probe.W, "b": probe.b, "mu": probe.mu, "sd": probe.sd}, f"{OUT}/doubt-readout.pt")
rep = {}
for name, D in (("generated (fitted on)", trs), ("real (held out)", tes)):
    y = [d["wrong"] for d in D]
    ps = probe(np.array([d["state"] for d in D]))[:, 1]
    rep[name] = {"n": len(D), "wrong": int(sum(y)), "auc_head": auc([-d["p"] for d in D], y), "auc_readout": auc(ps, y)}
    for k in ("choice", "text", "id", "word", "field"):
        sub = [i for i, d in enumerate(D) if d["kind"] == k]
        if sub:
            rep[name][k] = {"n": len(sub), "wrong": int(sum(y[i] for i in sub)), "auc_head": auc([-D[i]["p"] for i in sub], [y[i] for i in sub]), "auc_readout": auc(ps[sub], [y[i] for i in sub])}
    # The surest wrong: where they rank under each.
    wr = sorted([(D[i]["p"], float(ps[i]), D[i]["slot"], D[i]["kind"], D[i]["id"][:60]) for i in range(len(D)) if y[i]], reverse=True)[:15]
    rep[name]["surest_wrong"] = [{"p": a, "readout": b, "rank_of_readout": float((ps >= b).mean()), "slot": s, "kind": k, "id": i} for a, b, s, k, i in wr]
json.dump(rep, open(f"{OUT}/probe-doubt.json", "w"), indent=1)
print(json.dumps(rep, indent=1))
