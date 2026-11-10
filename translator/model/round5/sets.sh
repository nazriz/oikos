#!/bin/zsh
# Translator v5 (2026-11-10, one right call): the sets scored on, each in the taught language (relabel.ts taught-file).
# vr: validation-real (round 1's 615); vp, nv: the scope pilot's validation sides (rounds 1-3, 4-5); tp: its test side
# (never trained on, never tuned on); uf: unseen forms (824).   translator/model/round5/sets.sh [runs folder]
set -e
W=${0:A:h:h:h:h}; R=${OIKOS_RUNS:-/Users/clawd/oikos/runs}
V=${1:-$R/translator-v5-2026-11-10}/sets
mkdir -p $V
cd $W
typeset -A SETS
SETS=(vr $R/translator-v4-2026-11-07/v4a-text/validation-real.jsonl vp $R/translator-v4-r2-2026-11-08/keyed/validation-real-pilot.jsonl tp $R/translator-v4-r2-2026-11-08/keyed/test-pilot.jsonl nv $R/translator-v4-r4-2026-11-08/keyed/validation-real-pilot.jsonl uf $R/translator-v4-2026-11-07/v4a-text/validation-uf.jsonl)
for s f in ${(kv)SETS}; do bun translator/model/relabel.ts taught-file $f $V/$s.jsonl; done
