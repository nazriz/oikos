#!/usr/bin/env bash
# Two kernel builds run in turn on the same configs, so a cost of a percent or two is told from the machine's load
# (docs/design/performance.md, "How the cost was told"). For each round and each config: A, then B, a line each with the
# final state hash, the digest of its log (scripts/same-results.ts logDigest: all of it but the build and the hash chain), wall and user seconds, the run's own thread's CPU and the peak resident memory.
# Started from a shell, not from Bun: on Linux a process's peak resident set is carried across exec, so a kernel
# started by a large process would report that process's size as its floor.
#
#   scripts/pair.sh <kernel A> <kernel B> <rounds> <days> <threads> <config.json>...
set -eu
A=$1 B=$2 ROUNDS=$3 DAYS=$4 THREADS=$5
shift 5
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
# (Each build copied afresh, so both start with their whole file in the page cache: a binary whose pages have been
# partly dropped maps fewer of them per fault, and reads up to 10 MB lower in resident memory for no change of its own.)
cp "$A" "$out/A" && cp "$B" "$out/B"
A=$out/A B=$out/B
r=1
while [ "$r" -le "$ROUNDS" ]; do
  for c in "$@"; do
    for k in A B; do
      if [ "$k" = A ]; then bin=$A; else bin=$B; fi
      rm -rf "$out/run"; mkdir -p "$out/run"
      TIMEFORMAT='%R %U'
      { time OIKOS_ENGINE_THREADS=$THREADS "$bin" world "$c" --out "$out/run" --run-id r --until $((DAYS * 86400)) \
        --threads "$THREADS" >"$out/stdout" 2>"$out/stderr" || { tail -20 "$out/stderr"; exit 1; }; } 2>"$out/time"
      hash=$(sed -n 's/.*"state_hash":"\([0-9a-f]*\)".*/\1/p' "$out/stdout")
      log=$(bun "$(dirname "$0")/same-results.ts" --digest "$out/run/r.jsonl" | cut -c1-16)
      main=$(sed -n 's/main thread cpu \([0-9]*\) ms/\1/p' "$out/stderr")
      peak=$(sed -n 's/peak resident \([0-9]*\) bytes/\1/p' "$out/stderr")
      read -r wall user <"$out/time"
      printf '%-22s %s %s %s wall %6.1f user %6.1f main %6.1f peak %d MB\n' "$(basename "$c")" "$k" "$hash" "$log" \
        "$wall" "$user" "$(echo "$main / 1000" | bc -l)" $((peak / 1000000))
    done
  done
  r=$((r + 1))
done
