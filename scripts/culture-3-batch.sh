#!/bin/sh
# The one measurement of culture-3 (docs/decisions.md, 2026-10-13, "Culture: the gap, where people start, ordinary talk"): a year, dial off and on,
# the 1,000-person town in three profiles (five seeds) and the 3,000-person town in two (three seeds). Nothing is changed after it.
# usage: scripts/culture-3-batch.sh <outdir>   (run detached, under caffeinate; heavy: goes through the slots)
set -u
OUT=${1:-runs/culture-3}
COMMON="--until 31536000 --set living.initiative_bps=10000 --set opening_caseload=true --set living.friction_bps=30000 --log lean"
go() { # size world profile seeds parallel mode
  d="$OUT/$1/$3-$6"; [ -d "$d" ] && return
  extra=""; [ "$6" = on ] && extra="--set living.culture=true"
  bun scripts/slots.ts --weight "$5" --what "culture-3 $1 $3 $6" -- bun orchestrator/src/cli.ts run "$2" --seeds "$4" --parallel "$5" --set profile="$3" $COMMON $extra --out "$d" > "$OUT/$1-$3-$6.txt" 2>&1
}
mkdir -p "$OUT/1000" "$OUT/3000"
for p in au-vic-2026 gb-eng-2026 ke-nakuru-2026; do for m in off on; do go 1000 worlds/town-1000.yaml $p 5 5 $m; done; done
for p in gb-eng-2026 ke-nakuru-2026; do for m in off on; do go 3000 worlds/town-3000.yaml $p 3 3 $m; done; done
echo finished > "$OUT/FINISHED"
