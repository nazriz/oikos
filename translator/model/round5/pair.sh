#!/bin/zsh
# Translator v5: two seeds served only where both write the same program (round 3's serving), the cut certified on
# validation (vr + vp + nv) and read on the test side and unseen forms (v4-serve.ts).   round5/pair.sh <A tag> <B tag>
W=${0:A:h:h:h:h}; R=${OIKOS_RUNS:-/Users/clawd/oikos/runs}/translator-v5-2026-11-10
A=$1; B=$2
cd $W
f() { print $R/scores/$1-$2.decide_*.jsonl; }
args=(); for s in vr vp nv; do args+=(--rows $R/sets/$s.jsonl --a $(f $A $s) --b $(f $B $s)); done
cut=$(bun translator/model/v4-serve.ts $args --out $R/scores/pair-$A-$B-val.json | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["bound95"]["cut"]);print(json.dumps(d["bound95"]),file=sys.stderr)')
for s in tp uf; do
  bun translator/model/v4-serve.ts --rows $R/sets/$s.jsonl --a $(f $A $s) --b $(f $B $s) --cut $cut --out $R/scores/pair-$A-$B-$s.json | python3 -c "import json,sys;d=json.load(sys.stdin);a=d['at_cut'];print('$s', d['rows'], 'right in all', d['right'], {k:a[k] for k in ('served','right','wrong','right_served_share')})"
done
