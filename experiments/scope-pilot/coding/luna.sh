#!/bin/zsh
# Codex gpt-6-luna as an independent coder: each file in turn, two at a time.
D=${SCOPE_CODING:-$HOME/oikos/runs/scope-pilot-coding}/coding
mkdir -p $D/luna
run() {
  f=$1; s=${f%%-*}
  [ -s $D/luna/$f.codes.jsonl ] && return
  codex exec -m gpt-6-luna --skip-git-repo-check -s workspace-write -C $D \
    "Read codebook.md in this folder: it is your coding instructions. Then code every item in $f.jsonl as set $s, following the codebook exactly, reading every item yourself (do not write a program or keyword rules to code them; judge each item). Write the output, one JSON object per line, every id exactly once, to luna/$f.codes.jsonl. Do not read any other file in this folder." \
    > $D/luna/$f.log 2>&1
}
for pair in "A-1 A-2" "A-3 A-4" "B-1 B-2" "B-3 B-4" "B-5 B-6"; do
  for f in ${=pair}; do run $f & done
  wait
done
echo done > $D/luna/DONE
