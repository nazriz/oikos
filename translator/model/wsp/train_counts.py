"""How often the served model's training data has several acts of one kind in one request (candidate 1's shape).
  python3 translator/model/wsp/train_counts.py"""
import json, collections, re
T = "/Users/clawd/oikos/runs/translator-v4-r3-2026-11-08/joined-v4c/train.jsonl"
c = collections.Counter(); ex = collections.defaultdict(list)
for l in open(T):
    r = json.loads(l); p = r["program"]
    ls = [x for x in p.split("\n") if x.strip()]
    n = len(ls); c[("lines", min(n, 6))] += 1
    if n > 1:
        kinds = {(re.match(r"\s*(?:\w+\s*=\s*)?(\w+)\(", x) or [None, x])[1] + str(re.findall(r"form=([\w.-]+)", x)) for x in ls}
        if len(kinds) == 1:
            c[("same", min(n, 6), "form" if "form(" in p else "other")] += 1
            ex[(min(n, 6), "form" if "form(" in p else "other")].append(r["request"][:160])
for k in sorted(c, key=str): print(k, c[k])
for k in ex:
    print(k, ex[k][:3])
