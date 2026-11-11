"""The harness gives the served model's recorded answers: sureness on a sample of cases against round R3s2's scores.
  uv run --project translator/model/py python translator/model/wsp/check_harness.py [N] [ids...]"""
import json, random, sys, time
from harness import load, answer

cs = json.load(open("/Users/clawd/oikos/runs/translator-weight-edit-2026-11-11/cases.json"))
ids = set(sys.argv[2:])
pick = [c for c in cs if c["id"] in ids] if ids else random.Random(1).sample(cs, int(sys.argv[1]))
m, tok = load()
bad = 0
for c in pick:
    t = time.time()
    a = answer(m, tok, c["request"], c["forms"], keep_states=False)
    s = a.get("sure")
    same = a.get("too_long") or abs((s or 0) - c["sure"]) < 1e-4 * max(1, c["sure"])
    bad += not same
    seq = [(d["pass"][0], d["slot"]) for d in a.get("decisions", [])]
    print(c["set"], c["id"], "recorded", round(c["sure"], 6), "here", s if s is None else round(s, 6), "too_long" if a.get("too_long") else "", "ok" if same else "DIFF", f"{time.time()-t:.1f}s")
    if ids:
        print("  ", seq[:40])
print("differ:", bad, "of", len(pick))
