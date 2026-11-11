#!/bin/zsh
# Weight editing (2026-11-11): a model (edited or not) on every scored set, as served (v4-score.ts, read in the taught
# language with --taught as round 3's seed 2 is), answers beside scores in the run folder's scores/.
#   translator/model/wsp/score.sh <models dir> <name> <tag>      (env passes through, e.g. OIKOS_DECIDE_FORM_NAMES=1)
W=${0:A:h:h:h:h}; R=${OIKOS_RUNS:-/Users/clawd/oikos/runs}
SETS_DIR=$R/translator-small-models-2026-11-11/round/sets; OUT=$R/translator-weight-edit-2026-11-11/scores
M=$1; N=$2; T=$3
cd $W
export OIKOS_TRANSLATOR_MODELS=$M
mkdir -p $OUT
for s in ${=SETS:-vr vp nv tp uf sm}; do
  [[ -f $OUT/$T-$s.json ]] || bun translator/model/v4-score.ts --set $SETS_DIR/$s.jsonl --model decide/$N --out $OUT/$T-$s.json --answers $OUT/$T-$s --taught > /dev/null 2> $OUT/$T-$s.log
done
echo done $T
