"""Every scored case through the served model (harness.py), every decision kept: pass, slot, what was chosen, its
probability among what the slot allows, the runner-up's, the state before the head (float16), and for a copy its start
and end probabilities.   uv run --project translator/model/py python translator/model/wsp/collect.py [MODEL_DIR] [OUT]
Writes OUT (default: the run folder's decisions.pt): {id: {...}}."""
import json, sys, time
import torch
from harness import load, answer, allowed_logp, SERVED

OUTDIR = "/Users/clawd/oikos/runs/translator-weight-edit-2026-11-11"
model_dir = sys.argv[1] if len(sys.argv) > 1 else SERVED
out = sys.argv[2] if len(sys.argv) > 2 else f"{OUTDIR}/decisions.pt"
cs = json.load(open(f"{OUTDIR}/cases.json"))
m, tok = load(model_dir)
res = {}
t0 = time.time()
for i, c in enumerate(cs):
    a = answer(m, tok, c["request"], c["forms"])
    ds = []
    for d in a.get("decisions", []):
        lp = allowed_logp(m, d)
        top = torch.topk(lp, 2)
        e = {"pass": d["pass"], "slot": d["slot"], "key": d["key"], "c": int(top.indices[0]), "lp": float(top.values[0]),
             "c2": int(top.indices[1]), "lp2": float(top.values[1]), "state": d["state"].half()}
        if d.get("starts"):
            # (typed choice may try several; the last pair is what was taken)
            ps, pe = d["starts"][-1][1], d["ends"][-1][1]
            e["start"] = (int(ps.argmax()), float(ps.max()), float(torch.topk(ps, 2).values[1]))
            e["end"] = (int(pe.argmax()), float(pe.max()), float(torch.topk(pe, 2).values[1]))
        ds.append(e)
    res[c["id"]] = {"sure": a.get("sure"), "too_long": bool(a.get("too_long")), "decisions": ds, "parts": a.get("parts")}
    if i % 200 == 0:
        print(i, f"{time.time()-t0:.0f}s", flush=True)
torch.save(res, out)
print("saved", out, len(res))
