"""Candidate 3: what a bias on the head's refusals (the simplest edit) would trade, read off probe-kind.json: at each
shift of the refusal logits, refusal keys now refused and act keys now refused, by set (sm by halves).
  python3 translator/model/wsp/kind_bias.py"""
import json, math, hashlib
OUT = "/Users/clawd/oikos/runs/translator-weight-edit-2026-11-11"
R = json.load(open(f"{OUT}/probe-kind.json"))["rows"]
half = lambda cid: "A" if int(hashlib.sha1(cid.encode()).hexdigest(), 16) % 2 == 0 else "B"
for shift in (0, 1, 2, 3, 4, 6):
    out = {}
    for r in R:
        p = min(max(r["head_p_refusal"], 1e-12), 1 - 1e-12)
        logit = math.log(p / (1 - p)) + shift
        s = r["set"] + (half(r["id"]) if r["set"] == "sm" else "")
        k = out.setdefault(s, [0, 0, 0, 0])
        if r["key_refusal"]:
            k[0] += 1; k[1] += logit > 0
        else:
            k[2] += 1; k[3] += logit > 0
    print(f"shift {shift}:", "  ".join(f"{s} ref {v[1]}/{v[0]} act-refused {v[3]}/{v[2]}" for s, v in sorted(out.items())))
