"""Candidate 2 (sure and wrong): the wrong answers the served model is surest of, with each one's weakest decisions.
  python3 translator/model/wsp/sure_wrong.py [MIN_SURE]   (reads cases.json)"""
import json, sys
OUT = "/Users/clawd/oikos/runs/translator-weight-edit-2026-11-11"
lo = float(sys.argv[1]) if len(sys.argv) > 1 else 0.999
cs = json.load(open(f"{OUT}/cases.json"))
w = sorted([c for c in cs if not c["ok"] and c["sure"] >= lo and not c["own"].startswith("none(unclear")], key=lambda c: -c["sure"])
r = [c for c in cs if c["ok"] and c["sure"] >= lo]
print(f"sure >= {lo}: wrong {len(w)}, right {len(r)}")
for c in w:
    print("---", c["set"], c["id"], round(c["sure"], 6), c["writer"], "served:", c["served"][:30].replace("\n", " "), {k: round(v, 5) for k, v in c["parts"].items()})
    print("REQ:", c["request"][:600])
    print("KEY:", c["key"][:500])
    print("OWN:", c["own"][:500])
