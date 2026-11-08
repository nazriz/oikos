"""Translator v4, round 3: are the neighbouring refusals separable in the model's own state? (docs/design/translator-v4.md,
section 4: the linear readout as a standing diagnostic: a family that is linearly separable in the state is local, one
that is not is data or the labels.)

The writer's state at the first decision of the choose pass (where the model says whether it writes a program or which
refusal) is read for requests whose key is a program, none(not_an_act), none(no_such_act) or none(look_first). A
linear probe (multinomial logistic, L2) is fitted on training rows and read on held-out rows (validation-real, and
the pilot's validation side); its confusion between the three refusals is set beside the model's own head's on the
same states. If a probe fitted on far more of them separates them no better than the head, the kinds are not
separable in what the model reads (the state holds no more than the head uses), and serving should not rest on telling
them apart.

    python refusal_probe.py <model dir> <train export.jsonl> <held-out export.jsonl>... --out <file.json> [--per 600]
"""
import argparse
import json
import random
from pathlib import Path

import numpy as np
import torch

import train as T
from model import Config, Translator
from slots import Follow, Masks

CLASSES = ["program", "none:not_an_act", "none:no_such_act", "none:look_first"]


def load_model(d):
    from safetensors.torch import load_file
    from transformers import AutoTokenizer
    d = Path(d)
    cfg = Config(**json.loads((d / "config.json").read_text()))
    tok = AutoTokenizer.from_pretrained(str(d / "encoder"))
    m = Translator(cfg, encoder_from=str(d / "encoder"))
    m.load_state_dict(load_file(str(d / "model.safetensors")))
    m.masks = Masks(m.choices)
    m.eval()
    return m, tok


def first_of(row):
    s = row["steps"][0] if row.get("steps") else None
    return s if isinstance(s, str) else None


def rows_of(path, per=None, seed=5):
    by = {c: [] for c in CLASSES}
    with open(path) as f:
        for line in f:
            if '"choose"' not in line:
                continue
            r = json.loads(line)
            if r.get("mode") != "choose":
                continue
            k = first_of(r)
            if k in by:
                by[k].append(r)
    if per:
        rnd = random.Random(seed)
        for k in by:
            rnd.shuffle(by[k])
            by[k] = by[k][:per]
    return [r for k in CLASSES for r in by[k]]


def states(m, tok, rows):
    cap = []
    h = m.choose.register_forward_hook(lambda mod, inp, out: cap.append(inp[0][0, 0].detach().clone()))
    X, Y, head = [], [], []
    idx = [m.choices.index(c) for c in CLASSES]
    try:
        for it in T.prepare(rows, m, tok, {}):
            cap.clear()
            with torch.no_grad():
                m.translate_slots(T.single(it["f"], torch.device("cpu")), Follow(m.cfg.grammar, m.cfg.slots, m.masks, it["text"], it["tokens"], mode=it["row"].get("mode", "full")))
            if not cap:
                continue
            s = cap[0]
            with torch.no_grad():
                lo = m.choose(s.unsqueeze(0))[0][idx]
            X.append(s.numpy())
            Y.append(CLASSES.index(first_of(it["row"])))
            head.append(int(lo.argmax()))
    finally:
        h.remove()
    return np.array(X), np.array(Y), np.array(head)


def probe(X, Y, l2=1e-3, iters=400):
    mu, sd = X.mean(0), X.std(0) + 1e-6
    Z = torch.tensor((X - mu) / sd, dtype=torch.float32)
    y = torch.tensor(Y)
    W = torch.zeros(Z.shape[1], len(CLASSES), requires_grad=True)
    b = torch.zeros(len(CLASSES), requires_grad=True)
    opt = torch.optim.LBFGS([W, b], max_iter=iters, line_search_fn="strong_wolfe")
    def closure():
        opt.zero_grad()
        loss = torch.nn.functional.cross_entropy(Z @ W + b, y) + l2 * (W ** 2).sum()
        loss.backward()
        return loss
    opt.step(closure)
    return lambda X2: ((torch.tensor((X2 - mu) / sd, dtype=torch.float32) @ W + b).argmax(1)).numpy()


def confusion(Y, P):
    c = np.zeros((len(CLASSES), len(CLASSES)), dtype=int)
    for a, b in zip(Y, P):
        c[a, b] += 1
    return c.tolist()


def refusal_acc(Y, P):
    ix = Y > 0
    return round(float((Y[ix] == P[ix]).mean()), 4) if ix.any() else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("train")
    ap.add_argument("held", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--per", type=int, default=600)
    a = ap.parse_args()
    torch.set_num_threads(8)
    m, tok = load_model(a.model)
    Xt, Yt, Ht = states(m, tok, rows_of(a.train, a.per))
    # Cross-fitted on training rows (5 folds) and fitted on all of them for the held-out rows.
    fold = np.arange(len(Yt)) % 5
    rnd = np.random.RandomState(0)
    rnd.shuffle(fold)
    Pcv = np.zeros_like(Yt)
    for k in range(5):
        f = probe(Xt[fold != k], Yt[fold != k])
        Pcv[fold == k] = f(Xt[fold == k])
    f = probe(Xt, Yt)
    out = {"classes": CLASSES, "train": {"n": int(len(Yt)), "head": confusion(Yt, Ht), "head_refusal_acc": refusal_acc(Yt, Ht), "probe_crossfit": confusion(Yt, Pcv), "probe_refusal_acc": refusal_acc(Yt, Pcv)}}
    Xh, Yh, Hh = [], [], []
    for p in a.held:
        X, Y, H = states(m, tok, rows_of(p))
        Xh.append(X); Yh.append(Y); Hh.append(H)
    Xh, Yh, Hh = np.concatenate(Xh), np.concatenate(Yh), np.concatenate(Hh)
    Ph = f(Xh)
    out["held_out"] = {"n": int(len(Yh)), "head": confusion(Yh, Hh), "head_refusal_acc": refusal_acc(Yh, Hh), "probe": confusion(Yh, Ph), "probe_refusal_acc": refusal_acc(Yh, Ph)}
    Path(a.out).write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
