"""Candidate 2, before any edit: what the doubt readout (probe_doubt.py, fitted on the generated validation side) would
do to what is served, read offline. Each served answer's sureness becomes sure * prod over its decisions of
(1 - q_d)^lam, q_d the readout's probability that decision d is wrong (in the model's own greedy decisions, the states in
decisions.pt). Writes answer files under scores/ as tags doubtL<lam> (round R3s2's answers with only `sure` changed) and
base (unchanged), for summary.py.   uv run --project translator/model/py python translator/model/wsp/doubt_offline.py LAM..."""
import glob, json, os, sys
import numpy as np
import torch

OUT = "/Users/clawd/oikos/runs/translator-weight-edit-2026-11-11"
ROUND = "/Users/clawd/oikos/runs/translator-small-models-2026-11-11/round/scores"
r = torch.load(f"{OUT}/doubt-readout.pt", weights_only=False)
W, b, mu, sd = r["W"], r["b"], r["mu"], r["sd"]
dec = torch.load(f"{OUT}/decisions.pt")


PRIOR = 246 / 47464  # (wrong among sure decisions on the generated side, which the balanced fit set at one half)


def log1mq(states):
    z = ((states - mu) / sd) @ W + b
    logit = z[:, 1] - z[:, 0] + np.log(PRIOR / (1 - PRIOR))
    q = 1 / (1 + np.exp(-logit))
    return np.log(np.clip(1 - q, 1e-12, 1)).min() if os.environ.get("WSP_MAX") else np.log(np.clip(1 - q, 1e-12, 1)).sum()


pen = {}
for cid, d in dec.items():
    if d["decisions"]:
        pen[cid] = float(log1mq(np.stack([x["state"].float().numpy() for x in d["decisions"]])))
os.makedirs(f"{OUT}/scores", exist_ok=True)
for lam in ["base"] + sys.argv[1:]:
    tag = "base" if lam == "base" else f"doubtL{lam}"
    for s in ("vr", "vp", "nv", "tp", "uf", "sm"):
        src = glob.glob(f"{ROUND}/R3s2-{s}.decide_*.jsonl")[0]
        with open(f"{OUT}/scores/{tag}-{s}.decide_r3s2.jsonl", "w") as f:
            for l in open(src):
                a = json.loads(l)
                if lam != "base" and a["id"] in pen:
                    a["sure"] = a["sure"] * float(np.exp(float(lam) * pen[a["id"]]))
                f.write(json.dumps(a) + "\n")
    print("wrote", tag)
