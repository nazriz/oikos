"""Candidate 3 (a refusal against an act): is "this asks for nothing the forms can do" in the writer's state at the
first decision (kind), where the head commits to a program?   uv run --project translator/model/py python translator/model/wsp/probe_kind.py
A binary readout (act or refusal) fitted on teacher-forced training states, read on every scored case's own state,
beside the head; reported over all sets and on the small models' set by halves (ids hashed: A diagnoses, B checks).
Writes probe-kind.json and kind-readout.pt (the readout, for an edit) to the run folder."""
import json, hashlib
import numpy as np
import torch
from harness import load
from forced import train_rows, forced_states
from readout import fit

OUT = "/Users/clawd/oikos/runs/translator-weight-edit-2026-11-11"
m, tok = load()
REF = [i for i, c in enumerate(m.choices) if c.startswith("none:")]
PROG = m.choices.index("program")
half = lambda cid: "A" if int(hashlib.sha1(cid.encode()).hexdigest(), 16) % 2 == 0 else "B"

rows = train_rows(lambda r: r.get("mode") == "choose")
acts = [r for r in rows if r["steps"][0] == "program"][:4000]
refs = [r for r in rows if r["steps"][0] != "program"][:4000]
print("train rows: acts", len(acts), "refusals", len(refs), flush=True)
X, Y = [], []
for f in forced_states(m, tok, acts + refs):
    assert f["slot"][0] == "kind"
    X.append(f["state"][0].numpy()); Y.append(0 if f["row"]["steps"][0] == "program" else 1)
X, Y = np.array(X), np.array(Y)
probe = fit(X, Y, 2, l2=1e-3)
torch.save({"W": probe.W, "b": probe.b, "mu": probe.mu, "sd": probe.sd}, f"{OUT}/kind-readout.pt")

dec = torch.load(f"{OUT}/decisions.pt")
cases = {c["id"]: c for c in json.load(open(f"{OUT}/cases.json"))}
tab, rows_out = {}, []
for cid, d in dec.items():
    c = cases[cid]
    kd = [x for x in d["decisions"] if x["slot"] == "kind"]
    if not kd:
        continue
    s = kd[0]["state"].float()
    with torch.no_grad():
        lp = torch.log_softmax(m.choose(s.unsqueeze(0))[0][[PROG] + REF], -1)
    head_ref = float(1 - lp[0].exp())
    pr = float(probe(s.numpy()[None])[0, 1])
    key_ref = c["key"].startswith("none(")
    g = (c["set"] if c["set"] != "sm" else "sm" + half(cid), "refusal key" if key_ref else "act key")
    t = tab.setdefault(" ".join(g), {"n": 0, "head_says_refusal": 0, "probe_says_refusal": 0})
    t["n"] += 1; t["head_says_refusal"] += head_ref > 0.5; t["probe_says_refusal"] += pr > 0.5
    rows_out.append({"id": cid, "set": c["set"], "key_refusal": key_ref, "head_p_refusal": head_ref, "probe_p_refusal": pr, "ok": c["ok"]})
json.dump({"train_n": len(Y), "table": tab, "rows": rows_out}, open(f"{OUT}/probe-kind.json", "w"), indent=1)
for k in sorted(tab):
    print(k, tab[k])
# Ranking: on each set, how well each separates refusal keys from act keys (AUC).
def auc(pos, neg):
    if not pos or not neg: return None
    pos, neg = np.array(pos), np.array(neg)
    return float(((pos[:, None] > neg[None, :]).mean() + 0.5 * (pos[:, None] == neg[None, :]).mean()))
for s in ("vr", "vp", "nv", "tp", "uf", "sm"):
    R = [r for r in rows_out if r["set"] == s]
    print(s, "AUC head", auc([r["head_p_refusal"] for r in R if r["key_refusal"]], [r["head_p_refusal"] for r in R if not r["key_refusal"]]),
          "probe", auc([r["probe_p_refusal"] for r in R if r["key_refusal"]], [r["probe_p_refusal"] for r in R if not r["key_refusal"]]))
