"""Where the training labels point for a form's name (the choose pass's arg:form, a copied word): at the request's
words or at the form's own line. And whether the words copied are a form shown.   python3 translator/model/wsp/form_pointer.py"""
import json, collections, random
from forced import EXPORT

c = collections.Counter(); ex = collections.defaultdict(list)
seen = set()
for line in open(EXPORT):
    if '"choose"' not in line:
        continue
    r = json.loads(line)
    if r.get("mode") != "choose" or r["id"] in seen:
        continue
    seen.add(r["id"])
    br = sorted(b for b in r["breaks"] if b >= 0)
    steps = r["steps"]
    for i, s in enumerate(steps):
        if s == "fn:form" and i + 1 < len(steps) and isinstance(steps[i + 1], list):
            k, a, z = steps[i + 1]
            where = "request" if (not br or a < br[0]) else "form line"
            words = "_".join(r["pieces"][a:z + 1]).replace("___", "_")
            c[(k, where)] += 1
            if where == "request" and len(ex[k]) < 8:
                ex[k].append((" ".join(r["pieces"][max(0, a - 4):z + 3]), words))
print(dict(c))
for k, v in ex.items():
    print(k, v)
