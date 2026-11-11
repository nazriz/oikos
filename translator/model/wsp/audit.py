"""What the served model has learned, decision by decision (the audit beside the edits): every decision of the label,
teacher-forced, on the generated validation side and the real one (validation-real, in the model's own language); by
slot and kind of copy: how many, how often the head is wrong, how often it is wrong when it is sure (p >= 0.999), and
how sure it is when wrong. Then, from the greedy answers on every scored set (decisions.pt), which decision is the
least sure in answers kept under the cut-off and in wrong ones above it.
  uv run --project translator/model/py python translator/model/wsp/audit.py      (writes audit.json)"""
import json, collections
import numpy as np
import torch
import torch.nn.functional as F
from harness import load
from forced import train_rows, forced_states
from model import POINTERS

OUT = "/Users/clawd/oikos/runs/translator-weight-edit-2026-11-11"
VAL = "/Users/clawd/oikos/runs/translator-v4-r3-2026-11-08/data-v4c-export/validation.jsonl"
REAL = "/Users/clawd/oikos/runs/translator-v4-r3-2026-11-08/data-v4c-export/validation-real.jsonl"
m, tok = load()


def group(slot, kind):
    s = slot if not slot.startswith("arg:") or slot in ("arg:form", "arg:to", "arg:for", "arg:amount", "arg:text", "arg:basis") else "arg:(other)"
    return f"{s} {kind}"


@torch.no_grad()
def table(path):
    t = collections.defaultdict(lambda: {"n": 0, "wrong": 0, "sure": 0, "sure_wrong": 0, "p_when_wrong": []})
    for f in forced_states(m, tok, train_rows(lambda r: True, None, path=path)):
        st = f["state"]
        allowed = torch.stack([m.masks_.rows[k] for k in f["mask"]])
        lp = F.log_softmax(m.choose(st).masked_fill(~allowed, float("-inf")), -1)
        for i, c in enumerate(f["choice"]):
            h = int(lp[i].argmax()); p = float(lp[i, h].exp())
            rows = [(group(f["slot"][i], "choice"), p, h != c)]
            if h == c and c >= m.first_pointer:
                k = torch.tensor([[c - m.first_pointer]])
                ps = F.log_softmax(m.start_scores(st[i:i + 1].unsqueeze(0), k, f["read"], f["pad"])[0, 0], -1)
                pe = F.log_softmax(m.end_scores(st[i:i + 1].unsqueeze(0), k, torch.tensor([[f["start"][i]]]), f["read"], f["pad"])[0, 0], -1)
                kind = POINTERS[c - m.first_pointer]
                rows.append((group(f["slot"][i], kind + " start"), float(ps.max().exp()), int(ps.argmax()) != f["start"][i]))
                rows.append((group(f["slot"][i], kind + " end"), float(pe.max().exp()), int(pe.argmax()) != f["end"][i]))
            for g, p, w in rows:
                x = t[g]; x["n"] += 1; x["wrong"] += w; x["sure"] += p >= 0.999; x["sure_wrong"] += w and p >= 0.999
                if w: x["p_when_wrong"].append(p)
    for x in t.values():
        x["median_p_when_wrong"] = round(float(np.median(x.pop("p_when_wrong"))), 4) if x["wrong"] else None
    return dict(sorted(t.items(), key=lambda kv: -kv[1]["n"]))


rep = {"generated": table(VAL), "real": table(REAL)}
dec = torch.load(f"{OUT}/decisions.pt")
cases = {c["id"]: c for c in json.load(open(f"{OUT}/cases.json"))}
CUT = 0.999613299097851
least = {"under the cut": collections.Counter(), "wrong above the cut": collections.Counter(), "right above the cut": collections.Counter()}
for cid, d in dec.items():
    if not d["decisions"] or d["too_long"]:
        continue
    c = cases[cid]
    w = min(d["decisions"], key=lambda x: min(x["lp"], x.get("start", (0, 0))[1], x.get("end", (0, 0))[1]))
    which = "start" if w.get("start") and w["start"][1] < w["lp"] else "end" if w.get("end") and w["end"][1] < w["lp"] else "choice"
    g = group(w["slot"], which)
    least["under the cut" if c["sure"] < CUT else "right above the cut" if c["ok"] else "wrong above the cut"][g] += 1
rep["least_sure_decision"] = {k: dict(v.most_common(12)) for k, v in least.items()}
json.dump(rep, open(f"{OUT}/audit.json", "w"), indent=1)
for side in ("generated", "real"):
    print(f"== {side}: slot, decisions, wrong, sure (p>=0.999), wrong when sure, median p when wrong")
    for g, x in rep[side].items():
        if x["n"] >= 20:
            print(f"  {g:<28} {x['n']:>6} {x['wrong']:>5} ({100*x['wrong']/x['n']:5.2f}%) {x['sure']:>6} {x['sure_wrong']:>4} ({100*x['sure_wrong']/max(1,x['sure']):5.2f}%) {x['median_p_when_wrong']}")
print(json.dumps(rep["least_sure_decision"], indent=1))
