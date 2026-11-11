#!/bin/zsh
# Translator v5 (2026-11-10, one right call): one deberta control-recipe run (round 3's: deberta-v3-small, 6 epochs,
# --forms 0) on a community pod of its own, on data-v5-fair (the taught language). Held to a spending cap for the round:
# before each try the balance is read, and a pod is rented only if what the round has spent so far (from the balance
# when the round began, in $R/balance-at-start) and this pod's most (price cap x time limit) stay within CAP.
#   translator/model/round5/train-one.sh <run name> <seed> <state name>
W=${0:A:h:h:h:h}
R=${OIKOS_RUNS:-/Users/clawd/oikos/runs}/translator-v5-2026-11-10
N=$1; SEED=$2; ST=$3
CAP=${CAP:-4.00}; PRICE=${PRICE:-0.30}; LIMIT=${LIMIT:-19800}
source ~/.zshenv
balance() { print -r -- "header = \"Authorization: Bearer $RUNPOD_API_KEY\"" | curl -s -m 60 -K - -X POST https://api.runpod.io/graphql -H 'Content-Type: application/json' -d '{"query":"query { myself { clientBalance } }"}' | sed -n 's/.*"clientBalance":\([0-9.]*\).*/\1/p'; }
mkdir -p $R/pods $R/models
cd $W
for k in 1 2 3 4 5 6; do
  start=$(cat $R/balance-at-start); now=$(balance)
  [[ -n $now ]] || { echo "$(date) balance unreadable: not renting"; exit 2; }
  # (Each pod up on the account may run to its limit: counted at its most, beside this one's.)
  others=$(print -r -- "header = \"Authorization: Bearer $RUNPOD_API_KEY\"" | curl -s -m 60 -K - -X POST https://api.runpod.io/graphql -H 'Content-Type: application/json' -d '{"query":"query { myself { pods { id } } }"}' | grep -o '"id"' | wc -l | tr -d ' ')
  if (( start - now + (1 + others) * PRICE * LIMIT / 3600.0 > CAP )); then echo "$(date) cap: spent $(( start - now )), a pod's most $(( PRICE * LIMIT / 3600.0 )), $others up: not renting"; exit 3; fi
  [[ -d $R/pods/$ST ]] && mv $R/pods/$ST $R/pods/$ST.try-$k-$(date +%H%M)
  OIKOS_POD_STATE=$R/pods/$ST OIKOS_POD_MODELS=$R/models OIKOS_POD_MAX_PER_HOUR=$PRICE SECONDS_LIMIT=$LIMIT OIKOS_POD_CLOUD=${CLOUD:-COMMUNITY} \
  OIKOS_POD_GPUS="NVIDIA RTX A4500,NVIDIA GeForce RTX 3090,NVIDIA RTX A5000,NVIDIA GeForce RTX 4090,NVIDIA GeForce RTX 3090 Ti,NVIDIA RTX A6000,NVIDIA A40,NVIDIA RTX 4000 Ada Generation" \
    zsh translator/model/pod/pod.sh run $R/data-v5-fair "$N:microsoft/deberta-v3-small:$SEED:--forms 0 --epochs 6" > $R/pod-$ST.out 2>&1
  echo "$(date) try $k: exit $?"
  grep -q "queued and started" $R/pods/$ST/pod.log && exit 0
  sleep 600
done
