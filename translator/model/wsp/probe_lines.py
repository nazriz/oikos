"""Candidate 1 (several acts of one kind in one request): is the number of acts in the writer's state at the `lines`
decision, where the head says one?   uv run --project translator/model/py python translator/model/wsp/probe_lines.py
A multinomial readout (lines 1..6+) fitted on teacher-forced training states, read on every scored case's own state
(decisions.pt), beside the head's own answer. Writes probe-lines.json to the run folder."""
import json, re
import numpy as np
import torch
from harness import load
from forced import train_rows, forced_states
from readout import fit

OUT = "/Users/clawd/oikos/runs/translator-weight-edit-2026-11-11"
K = 6
m, tok = load()
LINES = [m.choices.index(f"lines:{k}") if f"lines:{k}" in m.choices else None for k in range(1, K + 1)]
print("lines choices:", [c for c in m.choices if c.startswith("lines:")])


def cls(k):
    return min(k, K) - 1


rows = train_rows(lambda r: r.get("mode") == "choose" and r["steps"][:1] == ["program"])
multi = [r for r in rows if r["steps"][1] != "lines:1"]
single = [r for r in rows if r["steps"][1] == "lines:1"][:4000]
print("train rows: several", len(multi), "one", len(single), flush=True)
X, Y = [], []
for f in forced_states(m, tok, multi + single):
    assert f["slot"][1] == "lines"
    X.append(f["state"][1].numpy()); Y.append(cls(int(f["row"]["steps"][1][6:])))
X, Y = np.array(X), np.array(Y)
probe = fit(X, Y, K, l2=1e-3)

dec = torch.load(f"{OUT}/decisions.pt")
cases = {c["id"]: c for c in json.load(open(f"{OUT}/cases.json"))}
rep = {"train": {"n": len(Y), "by_class": np.bincount(Y, minlength=K).tolist()}, "held": {}, "cases": []}
H = {"several": {"n": 0, "head": 0, "probe": 0}, "one": {"n": 0, "head": 0, "probe": 0}}
for cid, d in dec.items():
    c = cases[cid]
    if c["key"].startswith("none("):
        continue
    ln = [x for x in d["decisions"] if x["slot"] == "lines"]
    if not ln:
        continue
    s = ln[0]["state"].float()
    with torch.no_grad():
        lo = m.choose(s.unsqueeze(0))[0]
    head_p = torch.softmax(lo[[i for i in LINES if i is not None]], -1).numpy()
    head = int(head_p.argmax())
    n = len([l for l in c["key"].split("\n") if l.strip()])
    pr = probe(s.numpy()[None])[0]
    g = "several" if n > 1 else "one"
    H[g]["n"] += 1; H[g]["head"] += head == cls(n); H[g]["probe"] += int(pr.argmax()) == cls(n)
    if n > 1 or head > 0 or int(pr.argmax()) > 0:
        rep["cases"].append({"id": cid, "set": c["set"], "key_lines": n, "head": head + 1, "head_p_true": round(float(head_p[cls(n)]), 4),
                             "probe": int(pr.argmax()) + 1, "probe_p_true": round(float(pr[cls(n)]), 4), "ok": c["ok"], "family": c["family"],
                             "request": c["request"][:140]})
rep["held"] = H
json.dump(rep, open(f"{OUT}/probe-lines.json", "w"), indent=1)
print(json.dumps(H, indent=1))
for x in rep["cases"]:
    if x["head"] != x["key_lines"] or x["probe"] != x["key_lines"]:
        print(x["set"], x["key_lines"], "head", x["head"], x["head_p_true"], "probe", x["probe"], x["probe_p_true"], x["family"], "|", x["request"][:90])
