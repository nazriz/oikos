#!/bin/zsh
# Translator v4's data, from a joined folder to what batch 1 trains on (docs/design/translator-v4.md, section 3):
#   translator/model/v4-data.sh <joined dir> <out prefix>
# writes <prefix>-export (the two passes' rows), <prefix>-fair (labels made one way: what D and A train on), <prefix>-text
# (the same labels as program text, with the closed set and grammar beside: what C trains on), and checks the length
# of the training choose inputs against validation-real's (length_check.py; exit 1 if off).
set -e
J=${1:A}; P=${2:A}
R=${0:A:h:h:h}
PY=${OIKOS_PY:-$R/translator/model/py/.venv/bin/python}
cd $R
bun translator/model/export.ts $J $P-export --decoding cards
(cd translator/model/py && $PY fair.py --canonical $P-export $P-fair)
bun translator/model/text-export.ts $J $P-fair $P-text
cp $P-fair/vocabulary.json $P-fair/export.json $P-text/
(cd translator/model/py && $PY text_grammar.py $P-text $P-text/vocabulary.json $P-text/export.json 10 > $P-text/grammar-check.json)
(cd translator/model/py && $PY length_check.py $P-fair > $P-fair/length-check.json)
echo done
