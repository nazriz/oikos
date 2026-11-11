"""A few cases through the harness, as programs (the steps read back by encode.ts is the scorer's job; here the
decisions in order, with their probabilities).   uv run --project translator/model/py python translator/model/wsp/show.py ID...
(OIKOS_WSP_MODEL: another model folder.)"""
import json, os, sys
import torch
from harness import load, answer, allowed_logp, SERVED

cs = {c["id"]: c for c in json.load(open("/Users/clawd/oikos/runs/translator-weight-edit-2026-11-11/cases.json"))}
m, tok = load(os.environ.get("OIKOS_WSP_MODEL", SERVED))
for cid in sys.argv[1:]:
    c = cs[cid]
    a = answer(m, tok, c["request"], c["forms"])
    print("===", cid, "recorded sure", round(c["sure"], 6), "now", a.get("sure"), "too_long" if a.get("too_long") else "")
    print("KEY:", c["key"][:300].replace("\n", " // "))
    text = a["text"]
    for d, s in zip(a["decisions"], a.get("steps") or []):
        lp = allowed_logp(m, d)
        ch = m.choices[int(lp.argmax())]
        span = "" if isinstance(s, str) else f" [{s[0]}]"
        print(f"  {d['pass'][:2]} {d['slot']:<14} {ch:<22} p={float(lp.max().exp()):.5f}{span}")
