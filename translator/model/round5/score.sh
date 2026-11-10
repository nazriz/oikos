#!/bin/zsh
# Translator v5: a model on every set of round5/sets.sh (each in the taught language), its answers beside its scores
# (v4-score.ts).   translator/model/round5/score.sh <name> <models dir> <tag> [--taught]
# --taught: a model trained before 2026-11-10, read as the host now serves it (what code sets left out).
W=${0:A:h:h:h:h}; R=${OIKOS_RUNS:-/Users/clawd/oikos/runs}/translator-v5-2026-11-10
N=$1; M=$2; T=$3; X=$4
cd $W
export OIKOS_TRANSLATOR_MODELS=$M
mkdir -p $R/scores
for s in vr vp nv tp uf; do
  [[ -f $R/scores/$T-$s.json ]] || bun translator/model/v4-score.ts --set $R/sets/$s.jsonl --model decide/$N --out $R/scores/$T-$s.json --answers $R/scores/$T-$s $X > /dev/null 2> $R/scores/$T-$s.log
done
echo done $T
