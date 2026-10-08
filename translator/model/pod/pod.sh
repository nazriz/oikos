#!/bin/zsh
# A batch of training runs on a rented GPU, non-interactively: the hand-run scripts (start.sh, the queueing by ssh, pull.sh,
# watchdog.sh, stop.sh in runs/translator-model/runpod/ on the run server) as one command, with the data folder and the list
# of runs as arguments. The translator pipeline calls it (orchestrator/src/pipeline.ts); it can be run by hand as well.
#
#   pod.sh run DATA NAME:ENCODER:SEED[:EXTRA FLAGS] ...
#       DATA is an exported data folder (translator/model/export.ts). Rents a pod (unless a live one of this state folder is
#       there to be used again), sets it up, sends the trainer and DATA, queues the runs, then waits here, bringing each run
#       home as it ends (its folder, without the checkpoint) and scoring it on this machine, where the tests never leave
#       (`oikos translator-eval --model decide/NAME --real`). When all are home it ends the pod. Exit 0 if every run came
#       home; 1 if a run ended on the pod with no report (the others are home).
#   pod.sh stop        ends the pod named in the state folder.
#   pod.sh watchdog    (started by run) ends the pod when `done` appears there, or at the deadline: a lost session can't leave one running.
#
# The environment names where things are: OIKOS_POD_STATE (the pod's id, address, deadline, logs: a folder of this batch's own),
# OIKOS_POD_MODELS (where runs come home, one folder each: NAME), OIKOS_REPO (the checkout the trainer and the scoring come from;
# default: the one this script is in), SECONDS_LIMIT (the deadline, in seconds from the start of the pod; 6 hours if absent).
# Needs ~/.zshenv to set RUNPOD_API_KEY, and the key pair ~/.ssh/oikos_runpod(.pub). The first hand-run batches are in docs/decisions.md.
source ~/.zshenv
SELF=${0:A}
W=${OIKOS_REPO:-${SELF:h:h:h:h}}
S=${OIKOS_POD_STATE:?OIKOS_POD_STATE is a folder for this batch}; M=${OIKOS_POD_MODELS:?OIKOS_POD_MODELS is where runs come home}
mkdir -p $S $M
api() { curl -s -m 60 -X POST https://api.runpod.io/graphql -H 'Content-Type: application/json' -H "Authorization: Bearer $RUNPOD_API_KEY" -d "$1"; }
ssh_opts() { set -- $(cat $S/ssh-address); echo "ssh -i $HOME/.ssh/oikos_runpod -p $2 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$S/known_hosts -o ConnectTimeout=20 -o ServerAliveInterval=30"; }
host() { set -- $(cat $S/ssh-address); echo $1; }

stop() {
  # Ends the pod named in pod-id (terminate: nothing is kept there, so nothing is billed after).
  [ -f $S/pod-id ] || return 0
  local P=$(cat $S/pod-id)
  curl -s -m 60 -X POST https://api.runpod.io/graphql -H 'Content-Type: application/json' -H "Authorization: Bearer $RUNPOD_API_KEY" -d "{\"query\":\"mutation { podTerminate(input:{podId:\\\"$P\\\"}) }\"}"
  echo " terminated $P at $(date)"
}

watchdog() {
  while [ ! -f $S/done ] && [ $(date +%s) -lt $(cat $S/deadline) ]; do sleep 60; done
  stop >> $S/watchdog.log 2>&1
}

# A pod with a reachable SSH port (the first of the kinds below that is free), the trainer's libraries at this machine's versions,
# the trainer and the data folder sent over, the watchdog set.
start() {
  local DATA=$1 PK=$(cat ~/.ssh/oikos_runpod.pub) ID="" G
  for G in "NVIDIA GeForce RTX 4090" "NVIDIA GeForce RTX 5080" "NVIDIA RTX A6000" "NVIDIA GeForce RTX 3090" "NVIDIA RTX A5000" "NVIDIA GeForce RTX 5090"; do
    ID=$(api "{\"query\":\"mutation { podFindAndDeployOnDemand(input:{cloudType:COMMUNITY, supportPublicIp:true, gpuCount:1, volumeInGb:0, containerDiskInGb:40, minVcpuCount:4, minMemoryInGb:16, gpuTypeId:\\\"$G\\\", name:\\\"oikos-translator\\\", imageName:\\\"runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04\\\", ports:\\\"22/tcp\\\", env:[{key:\\\"PUBLIC_KEY\\\", value:\\\"$PK\\\"}]}) { id costPerHr } }\"}" | sed -n 's/.*"id":"\([a-z0-9]*\)".*/\1/p')
    [ -n "$ID" ] && { echo "pod $ID ($G)"; break; }
  done
  [ -z "$ID" ] && { echo "no pod could be had"; return 1; }
  echo $ID > $S/pod-id; rm -f $S/done; echo $(( $(date +%s) + ${SECONDS_LIMIT:-21600} )) > $S/deadline
  (nohup $SELF watchdog > /dev/null 2>&1 < /dev/null &)
  local n=0
  until api "{\"query\":\"query { pod(input:{podId:\\\"$ID\\\"}) { runtime { ports { ip isIpPublic privatePort publicPort } } } }\"}" > $S/ports.json && grep -q '"privatePort":22,' $S/ports.json; do n=$((n+1)); [ $n -gt 60 ] && { echo "no SSH port: ending it"; stop; return 1; }; sleep 5; done
  bun -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).data.pod.runtime.ports.find(p=>p.privatePort===22);console.log(r.ip,r.publicPort)' $S/ports.json > $S/ssh-address
  local SSH=$(ssh_opts) H=$(host)
  n=0; until ${=SSH} root@$H true < /dev/null 2>/dev/null; do n=$((n+1)); [ $n -gt 30 ] && { echo "SSH never answered: ending it"; stop; return 1; }; sleep 5; done
  ${=SSH} root@$H 'mkdir -p /work/py /work/data /work/runs && pip install -q uv 2>&1 | tail -1; cd /work && uv venv -q --python 3.11 .venv && . .venv/bin/activate && uv pip install -q torch --index-url https://download.pytorch.org/whl/cu128 && uv pip install -q transformers==5.18.0 tokenizers==0.23.2 safetensors sentencepiece protobuf tiktoken && (apt-get update -qq && apt-get install -y -qq rsync) > /tmp/apt.log 2>&1; python -c "import torch;x=torch.randn(1000,1000,device=\"cuda\");print(\"gpu ok\",torch.__version__,torch.cuda.get_device_name(0))"' < /dev/null || { echo "setting up failed: ending it"; stop; return 1; }
  ${=SSH} root@$H 'cat > /work/run.sh <<"X"
#!/bin/sh
# One training run: name, reader, seed, data, extra flags. Its log in its folder; resumed if cut short.
N=$1; E=$2; S=$3; D=$4; shift 4
. /work/.venv/bin/activate; cd /work/py; mkdir -p /work/runs/$N
for try in 1 2 3; do
  python train.py /work/data/$D /work/runs/$N --encoder $E --seed $S --epochs 4 --validate-every 2 --renumber 0.8 --forms 0.7 --device cuda --resume "$@" >> /work/runs/$N/train.log 2>&1 && break
  echo "try $try was cut short" >> /work/runs/$N/train.log
done
X
chmod +x /work/run.sh' < /dev/null
  echo "ready: $(cat $S/ssh-address)"
}

# Sends what the pod needs (the trainer, the data) and queues the runs one after another; a run that has its report there is not queued again.
queue() {
  local DATA=$1; shift
  local SSH=$(ssh_opts) H=$(host) spec q=$S/queue.sh
  rsync -az -e "$SSH" $W/translator/model/py/model.py $W/translator/model/py/train.py $W/translator/model/py/tokens.py $W/translator/model/py/predict.py root@$H:/work/py/ || return 1
  rsync -az -e "$SSH" ${DATA:A} root@$H:/work/data/ || return 1
  { echo "#!/bin/sh"; for spec in "$@"; do
      local f=("${(@s/:/)spec}")
      echo "[ -f /work/runs/${f[1]}/report.json ] || /work/run.sh ${f[1]} ${f[2]} ${f[3]} ${DATA:t} ${f[4]:-}"
    done; echo "touch /work/ALL_DONE"; } > $q
  ${=SSH} root@$H 'cat > /work/queue.sh; rm -f /work/ALL_DONE' < $q
  ${=SSH} root@$H 'pgrep -f "sh /work/queue.sh" > /dev/null || (nohup sh /work/queue.sh > /work/queue.log 2>&1 < /dev/null &)' < /dev/null
}

# Brings each run home as it ends on the pod, scores it here (the tests never leave this machine), and when the pod says the batch
# is over and everything is home, writes `done`: the watchdog then ends the pod.
pull() {
  local SSH=$(ssh_opts) H=$(host) n over spec left failed
  local names=(); for spec in "$@"; do names+=("${spec%%:*}"); done
  score() { (cd $W && OIKOS_TRANSLATOR_MODELS=$M bun orchestrator/src/cli.ts translator-eval --model decide/$1 --real --jobs 1 --out $M/$1/eval.json > $M/$1/eval.log 2>&1) & local E=$!; until grep -q "^Real requests" $M/$1/eval.log 2>/dev/null; do sleep 15; kill -0 $E 2>/dev/null || break; done; sleep 5; kill $E 2>/dev/null; pkill -f "predict.py $M/$1"; }
  while true; do
    over=$(${=SSH} root@$H 'ls /work/ALL_DONE 2>/dev/null' < /dev/null)
    for n in $names; do
      if [ ! -f $M/$n/report.json ] && ${=SSH} root@$H "[ -f /work/runs/$n/report.json ]" < /dev/null; then
        rsync -az --exclude checkpoint.pt -e "$SSH" root@$H:/work/runs/$n/ $M/$n/ && echo "$(date +%H:%M) home: $n" >> $S/pull.log
      fi
      [ -f $M/$n/report.json ] && [ ! -f $M/$n/eval.json ] && { score $n; echo "$(date +%H:%M) $n: $(grep -hE '^(Translator test|Real requests)' $M/$n/eval.log | sed -E 's/ on decide[^:]*//; s/Cost.*//' | tr '\n' ' ')" >> $S/pull.log; }
    done
    if [ -n "$over" ]; then
      left=0; failed=()
      for n in $names; do [ -f $M/$n/report.json ] || { left=1; failed+=("$n"); }; done
      # (Over, and a run has no report: it failed there three times. Its log is brought home; the rest are home.)
      for n in $failed; do mkdir -p $M/$n; rsync -az --exclude checkpoint.pt -e "$SSH" root@$H:/work/runs/$n/ $M/$n/ 2>/dev/null; done
      ${=SSH} root@$H 'cat /work/runs/*/train.log' < /dev/null > $S/all-train.log 2>/dev/null
      touch $S/done; echo "$(date +%H:%M) all home${failed:+ but $failed}" >> $S/pull.log
      [ $left = 0 ] && return 0 || return 1
    fi
    sleep 120
  done
}

case ${1:-} in
  run)
    DATA=$2; shift 2
    [ -d "$DATA" ] && [ $# -gt 0 ] || { echo "usage: pod.sh run DATA NAME:ENCODER:SEED ..."; exit 2; }
    # Everything already home and scored: nothing to rent.
    todo=0; for spec in "$@"; do n=${spec%%:*}; [ -f $M/$n/report.json ] && [ -f $M/$n/eval.json ] || todo=1; done
    [ $todo = 0 ] && { echo "all runs are home"; exit 0; }
    # A pod of this batch that is still up (a resumed pipeline) is used again; else a new one.
    if [ -f $S/pod-id ] && [ ! -f $S/done ] && [ -f $S/ssh-address ] && ${=$(ssh_opts)} root@$(host) true < /dev/null 2>/dev/null; then echo "using pod $(cat $S/pod-id)"; else start $DATA || exit 1; fi
    queue $DATA "$@" || { stop; exit 1; }
    pull "$@"; code=$?
    stop >> $S/watchdog.log 2>&1
    exit $code ;;
  stop) stop ;;
  watchdog) watchdog ;;
  *) echo "usage: pod.sh run DATA NAME:ENCODER:SEED[:EXTRA FLAGS] ... | stop | watchdog"; exit 2 ;;
esac
