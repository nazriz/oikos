#!/bin/zsh
# A batch of training runs on a rented GPU, non-interactively: the hand-run scripts (start.sh, the queueing by ssh, pull.sh,
# watchdog.sh, stop.sh in runs/translator-model/runpod/ on the run server) as one command, with the data folder and the list
# of runs as arguments. The translator pipeline calls it (orchestrator/src/pipeline.ts); it can be run by hand as well.
#
#   pod.sh run DATA NAME:ENCODER:SEED[:EXTRA FLAGS] ...
#       DATA is an exported data folder (translator/model/export.ts). For the runs that are not home yet it rents a pod, sets
#       it up, sends the trainer and DATA, queues the runs and waits, bringing each run home as it ends (its folder, without
#       the checkpoint). When all are home it ends the pod, and then scores each run on this machine, where the tests never
#       leave (`oikos translator-eval --model decide/NAME --real`). Runs that are home and not scored are scored with no pod.
#       Exit 0 if every run is home and scored; 1 if a run ended on the pod with no report, or was not scored (the others
#       are home); 3 if the pod was lost; 4 at the time limit; 5 if the pod could not be confirmed ended (look at once).
#   pod.sh stop        ends the pod named in the state folder, and any other pod of this batch's name.
#   pod.sh pods        the account's pods as the provider lists them: id, name, state, price an hour.
#   pod.sh watchdog ID PID   (started by run) ends pod ID when the run that rented it is over, has gone, or at the time limit.
#
# The pod is ended on every way out of `run`: when the runs are home, on a failure at any step, on a signal (INT, TERM, HUP),
# and at the time limit. Two things do it, so that neither is the only one: `run` itself on its way out, and the watchdog (a
# process of its own, which outlives a killed `run` and a lost session). Ended means asked of the provider and seen gone: the
# pod is no longer among the account's pods; until it is, ending is asked again. On the way out every pod carrying this
# batch's name is ended too (one rented whose id never reached us), and the log says what the provider then lists.
#
# The environment names where things are: OIKOS_POD_STATE (the pod's id, address, time limit, logs: a folder of this batch's
# own), OIKOS_POD_MODELS (where runs come home, one folder each: NAME), OIKOS_REPO (the checkout the trainer and the scoring
# come from; default: the one this script is in), SECONDS_LIMIT (the time limit, in seconds from the renting of the pod, after
# which it is ended whatever is going on; 6 hours if absent), OIKOS_POD_MAX_PER_HOUR (the dearest pod taken, the provider's
# price an hour; 1 if absent). Needs ~/.zshenv to set RUNPOD_API_KEY, and the key pair ~/.ssh/oikos_runpod(.pub). The key is
# never written anywhere, nor put on a command line. The first hand-run batches, and this script's first run, are in
# docs/decisions.md.
source ~/.zshenv
SELF=${0:A}
W=${OIKOS_REPO:-${SELF:h:h:h:h}}
S=${OIKOS_POD_STATE:?OIKOS_POD_STATE is a folder for this batch}; M=${OIKOS_POD_MODELS:?OIKOS_POD_MODELS is where runs come home}
mkdir -p $S $M
S=${S:A}; M=${M:A}
# The pod's name: this batch's alone (other batches, by hand or by other pipelines, may have pods of their own up).
NAME="oikos-translator-$(print -rn -- ${S:h:t} | tr -c 'A-Za-z0-9' '-' | cut -c1-28)-$(print -rn -- $S | shasum | cut -c1-6)"
say() { print -r -- "$(date '+%m-%d %H:%M:%S') $*" | tee -a $S/pod.log; }
# (The key goes to curl on its standard input, as a config line: a command line can be read by anyone on the machine.)
api() { print -r -- "header = \"Authorization: Bearer $RUNPOD_API_KEY\"" | curl -s -m 60 -K - -X POST https://api.runpod.io/graphql -H 'Content-Type: application/json' -d "$1"; }
ssh_opts() { set -- $(cat $S/ssh-address); echo "ssh -i $HOME/.ssh/oikos_runpod -p $2 -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$S/known_hosts -o ConnectTimeout=20 -o ServerAliveInterval=30 -o BatchMode=yes"; }
host() { set -- $(cat $S/ssh-address); echo $1; }

# The account's pods as the provider lists them, a line each: id, name, state, price an hour. Fails if it could not be asked.
pods() {
  api '{"query":"query { myself { pods { id name desiredStatus costPerHr } } }"}' | bun -e 'let s="";for await(const c of Bun.stdin.stream())s+=new TextDecoder().decode(c);for(const p of JSON.parse(s).data.myself.pods)console.log(p.id,p.name,p.desiredStatus,p.costPerHr)'
}
balance() { api '{"query":"query { myself { clientBalance } }"}' | sed -n 's/.*"clientBalance":\([0-9.]*\).*/\1/p'; }

# Ends pod $1 (terminate: nothing is kept there, so nothing is billed after) and sees it gone: asked again until the provider
# no longer lists it. 0 once it is gone; 1 if after ten minutes of asking it is still listed or the provider cannot be asked.
end_pod() {
  local P=$1 n list
  [ -n "$P" ] || return 0
  [ -f $S/ended-$P ] && return 0
  for n in {1..30}; do
    api "{\"query\":\"mutation { podTerminate(input:{podId:\\\"$P\\\"}) }\"}" > /dev/null
    sleep 2
    if list=$(pods); then
      if ! print -r -- "$list" | grep -q "^$P "; then
        date > $S/ended-$P
        say "pod $P is ended: the provider no longer lists it"
        return 0
      fi
    fi
    sleep 18
  done
  say "POD $P COULD NOT BE CONFIRMED ENDED after ten minutes of asking: end it by hand (pod.sh stop, or the provider's console)"
  return 1
}

# Ends every pod of this batch's name (the one in pod-id, and any whose id never reached us), then says what the provider
# lists. 0 if none of ours is left.
end_all() {
  local bad=0 id list
  [ -f $S/pod-id ] && { end_pod "$(cat $S/pod-id)" || bad=1; }
  if list=$(pods); then
    for id in $(print -r -- "$list" | awk -v n=$NAME '$2 == n { print $1 }'); do end_pod $id || bad=1; done
    list=$(pods) && say "the provider lists $(print -r -- "$list" | grep -c .) pods, $(print -r -- "$list" | awk -v n=$NAME '$2 == n' | grep -c .) of this batch ($NAME)" || bad=1
  else
    say "the provider could not be asked for its list of pods"; bad=1
  fi
  return $bad
}

# The second way a pod is ended: a process of its own, for pod $1 rented by the run with process id $2. It ends the pod when
# that run has ended it (nothing to do), when that run is gone without having ended it (killed, a lost session, a restart),
# or at the time limit in `deadline` (seconds since 1970; it can be rewritten to give a batch longer), whichever is first.
watchdog() {
  local P=$1 RUN=$2
  while [ ! -f $S/ended-$P ] && [ $(date +%s) -lt $(cat $S/deadline) ] && kill -0 $RUN 2>/dev/null; do sleep 15; done
  [ -f $S/ended-$P ] && return 0
  if kill -0 $RUN 2>/dev/null; then
    # At the time limit the pod is ended whatever the run is doing, and the run is then told to stop (it leaves with 4).
    say "watchdog: the time limit is reached: ending pod $P"
    date > $S/timed-out-$P
    end_pod $P; kill -TERM $RUN 2>/dev/null
  else
    say "watchdog: the run that rented pod $P is gone: ending pod $P"
    end_pod $P
  fi
}

# A pod with a reachable SSH port (the first of the kinds below that is free and within the price), the trainer's libraries
# at this machine's versions, the watchdog set before anything else is done with it.
start() {
  local PK=$(cat ~/.ssh/oikos_runpod.pub) ID="" G R price max=${OIKOS_POD_MAX_PER_HOUR:-1}
  say "balance before: $(balance)"
  for G in "NVIDIA GeForce RTX 4090" "NVIDIA GeForce RTX 5080" "NVIDIA RTX A6000" "NVIDIA GeForce RTX 3090" "NVIDIA RTX A5000" "NVIDIA GeForce RTX 5090"; do
    # (supportPublicIp: without it a pod can come with no SSH port that can be reached from here.)
    R=$(api "{\"query\":\"mutation { podFindAndDeployOnDemand(input:{cloudType:COMMUNITY, supportPublicIp:true, gpuCount:1, volumeInGb:0, containerDiskInGb:40, minVcpuCount:4, minMemoryInGb:16, gpuTypeId:\\\"$G\\\", name:\\\"$NAME\\\", imageName:\\\"runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04\\\", ports:\\\"22/tcp\\\", env:[{key:\\\"PUBLIC_KEY\\\", value:\\\"$PK\\\"}]}) { id costPerHr } }\"}")
    ID=$(print -r -- "$R" | sed -n 's/.*"id":"\([a-z0-9]*\)".*/\1/p')
    [ -n "$ID" ] || continue
    # From here the pod is billed: its id on file, its time limit, and the watchdog, before anything else.
    echo $ID > $S/pod-id; echo $(( $(date +%s) + ${SECONDS_LIMIT:-21600} )) > $S/deadline; date +%s > $S/started
    (nohup zsh $SELF watchdog $ID $$ > /dev/null 2>&1 < /dev/null &)
    price=$(print -r -- "$R" | sed -n 's/.*"costPerHr":\([0-9.]*\).*/\1/p'); echo ${price:-0} > $S/price
    say "pod $ID ($G) at ${price:-?} an hour, named $NAME; time limit $(( ${SECONDS_LIMIT:-21600} / 60 )) minutes"
    if [ -z "$price" ] || [ $(( price > max )) = 1 ]; then say "dearer than $max an hour (or no price given): ending it"; end_pod $ID || return 1; ID=""; continue; fi
    break
  done
  [ -z "$ID" ] && { say "no pod could be had"; return 1; }
  local n=0
  until api "{\"query\":\"query { pod(input:{podId:\\\"$ID\\\"}) { runtime { ports { ip isIpPublic privatePort publicPort } } } }\"}" > $S/ports.json && grep -q '"privatePort":22,' $S/ports.json; do n=$((n+1)); [ $n -gt 60 ] && { say "no SSH port after five minutes"; return 1; }; sleep 5; done
  bun -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).data.pod.runtime.ports.find(p=>p.privatePort===22);console.log(r.ip,r.publicPort)' $S/ports.json > $S/ssh-address
  local SSH=$(ssh_opts) H=$(host)
  n=0; until ${=SSH} root@$H true < /dev/null 2>/dev/null; do n=$((n+1)); [ $n -gt 30 ] && { say "SSH never answered"; return 1; }; sleep 5; done
  say "SSH answers at $(cat $S/ssh-address); setting up"
  # (The torch build is the cu128 one: recent cards are not served by the image's own.)
  ${=SSH} root@$H 'mkdir -p /work/py /work/data /work/runs && pip install -q uv 2>&1 | tail -1; cd /work && uv venv -q --python 3.11 .venv && . .venv/bin/activate && uv pip install -q torch --index-url https://download.pytorch.org/whl/cu128 && uv pip install -q transformers==5.18.0 tokenizers==0.23.2 safetensors sentencepiece protobuf tiktoken && (apt-get update -qq && apt-get install -y -qq rsync) > /tmp/apt.log 2>&1; nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1 > /work/gpu-mb; python -c "import torch;x=torch.randn(1000,1000,device=\"cuda\");print(\"gpu ok\",torch.__version__,torch.cuda.get_device_name(0))"; echo "card memory $(cat /work/gpu-mb) MiB"' < /dev/null 2>&1 | tee -a $S/pod.log | grep "^gpu ok" > /dev/null || { say "setting up failed"; return 1; }
  # (A card of 16 GB takes a step in smaller parts, --token-budget 4096: the loss is the same, taken in more parts. Extra
  # flags come after it, so a run that names its own budget has it.)
  ${=SSH} root@$H 'cat > /work/run.sh <<"X"
#!/bin/sh
# One training run: name, reader, seed, data, extra flags. Its log in its folder; resumed if cut short.
N=$1; E=$2; S=$3; D=$4; shift 4
. /work/.venv/bin/activate; cd /work/py; mkdir -p /work/runs/$N
TB=""; [ "$(cat /work/gpu-mb)" -lt 20000 ] && TB="--token-budget 4096"
for try in 1 2 3; do
  python train.py /work/data/$D /work/runs/$N --encoder $E --seed $S --epochs 4 --validate-every 2 --renumber 0.8 --forms 0.7 --device cuda --resume $TB "$@" >> /work/runs/$N/train.log 2>&1 && break
  echo "try $try was cut short" >> /work/runs/$N/train.log
done
X
chmod +x /work/run.sh' < /dev/null || return 1
  say "ready"
}

# Sends what the pod needs (the trainer, the data) and queues the runs one after another.
queue() {
  local DATA=$1; shift
  local SSH=$(ssh_opts) H=$(host) spec q=$S/queue.sh
  rsync -az -e "$SSH" $W/translator/model/py/model.py $W/translator/model/py/train.py $W/translator/model/py/tokens.py $W/translator/model/py/predict.py root@$H:/work/py/ || return 1
  rsync -az -e "$SSH" ${DATA:A} root@$H:/work/data/ || return 1
  { echo "#!/bin/sh"; for spec in "$@"; do
      local f=("${(@s/:/)spec}")
      echo "[ -f /work/runs/${f[1]}/report.json ] || /work/run.sh ${f[1]} ${f[2]} ${f[3]} ${DATA:t} ${f[4]:-}"
    done; echo "touch /work/ALL_DONE"; } > $q
  ${=SSH} root@$H 'cat > /work/queue.sh; rm -f /work/ALL_DONE' < $q || return 1
  # (Started, and seen started. The pod is this batch's own and new, so no queue is already going there; and asking the pod
  # whether one is, by its command line, finds the asking itself: the first run of this script sat idle for that.)
  ${=SSH} root@$H 'cd /work && (nohup sh /work/queue.sh > /work/queue.log 2>&1 < /dev/null & echo $! > /work/queue.pid); sleep 2; kill -0 $(cat /work/queue.pid)' < /dev/null || { say "the queue did not start on the pod"; return 1; }
  say "queued and started: $*"
}

# Brings each run home as it ends on the pod. 0 when the pod says the batch is over and every run is home; 1 if it is over
# and a run has no report (it failed there three times: its log is brought home), or if the queue stopped there without
# finishing; 3 if the pod stopped answering for ten minutes; 4 at the time limit.
pull() {
  local SSH=$(ssh_opts) H=$(host) n state spec failed lost=0
  local names=(); for spec in "$@"; do names+=("${spec%%:*}"); done
  while true; do
    [ $(date +%s) -ge $(cat $S/deadline) ] && { say "the time limit is reached with runs still out"; return 4; }
    state=$(${=SSH} root@$H 'ls /work/ALL_DONE 2>/dev/null; kill -0 $(cat /work/queue.pid) 2>/dev/null && echo going; echo answering' < /dev/null 2>/dev/null)
    if [[ $state != *answering* ]]; then
      lost=$((lost+1)); [ $lost -ge 20 ] && { say "the pod has not answered for ten minutes"; return 3; }
      sleep 30; continue
    fi
    lost=0
    # (A pod that answers with nothing going on it and nothing finished would be paid for until the time limit.)
    [[ $state != *ALL_DONE* && $state != *going* ]] && { say "the queue is not going on the pod and did not finish"; return 1; }
    for n in $names; do
      if [ ! -f $M/$n/report.json ] && ${=SSH} root@$H "[ -f /work/runs/$n/report.json ]" < /dev/null; then
        rsync -az --exclude checkpoint.pt -e "$SSH" root@$H:/work/runs/$n/ $M/$n/ && say "home: $n"
      fi
    done
    if [[ $state == *ALL_DONE* ]]; then
      failed=(); for n in $names; do [ -f $M/$n/report.json ] || failed+=("$n"); done
      for n in $failed; do mkdir -p $M/$n; rsync -az --exclude checkpoint.pt -e "$SSH" root@$H:/work/runs/$n/ $M/$n/ 2>/dev/null; done
      ${=SSH} root@$H 'cat /work/runs/*/train.log' < /dev/null > $S/all-train.log 2>/dev/null
      say "all home${failed:+ but $failed}"
      [ ${#failed} = 0 ] && return 0 || return 1
    fi
    sleep 30
  done
}

# A run that is home, scored here (the tests never leave this machine). The scoring's own process does not end by itself
# (the model's process stays up for further questions): it is ended once the last line of the report is out, or after 40 minutes.
score() {
  local n=$1 E t=0
  (cd $W && OIKOS_TRANSLATOR_MODELS=$M exec bun orchestrator/src/cli.ts translator-eval --model decide/$n --real --jobs 1 --out $M/$n/eval.json > $M/$n/eval.log 2>&1) &
  E=$!
  until grep -q "^Real requests" $M/$n/eval.log 2>/dev/null; do sleep 15; t=$((t+15)); kill -0 $E 2>/dev/null || break; [ $t -gt 2400 ] && break; done
  sleep 5; kill $E 2>/dev/null; pkill -f "predict.py $M/$n" 2>/dev/null
  [ -f $M/$n/eval.json ] || { say "$n: not scored (see $M/$n/eval.log)"; return 1; }
  say "$n: $(grep -hE '^(Translator test|Real requests)' $M/$n/eval.log | sed -E 's/ on decide[^:]*//; s/Cost.*//' | tr '\n' ' ')"
}

# What `run` does, as a process of its own, so that the one that started it can be told to stop at any moment.
work() {
  local DATA=$1; shift
  local spec n code=0 need=() up
  for spec in "$@"; do [ -f $M/${spec%%:*}/report.json ] || need+=("$spec"); done
  if [ ${#need} -gt 0 ]; then
    start && queue $DATA $need && pull $need; code=$?
    [ -f $S/pod-id ] && [ -f $S/started ] && { up=$(( $(date +%s) - $(cat $S/started) )); }
    end_all || code=5
    [ -n "$up" ] && say "the pod was up about $(( (up + 59) / 60 )) minutes at $(cat $S/price 2>/dev/null) an hour; balance after: $(balance)"
    [ $code -ge 3 ] && return $code
  fi
  for spec in "$@"; do
    n=${spec%%:*}
    [ -f $M/$n/report.json ] || { code=1; continue; }
    [ -f $M/$n/eval.json ] || score $n || code=1
  done
  return $code
}

case ${1:-} in
  run)
    DATA=$2; shift 2
    [ -d "$DATA" ] && [ $# -gt 0 ] || { echo "usage: pod.sh run DATA NAME:ENCODER:SEED ..."; exit 2; }
    WORK=""
    # Every way out goes through here: the work is stopped, and every pod of this batch ended and seen gone.
    finish() {
      local code=$?
      trap - EXIT INT TERM HUP
      [ -n "$WORK" ] && kill -0 $WORK 2>/dev/null && { say "stopping (code $code)"; pkill -P $WORK 2>/dev/null; kill $WORK 2>/dev/null; sleep 5; }
      [ -f $S/pod-id ] && [ -f $S/timed-out-$(cat $S/pod-id) ] && code=4
      if [ -f $S/pod-id ] || [ -n "$WORK" ]; then end_all || code=5; fi
      exit $code
    }
    trap finish EXIT; trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 129' HUP
    ( trap - EXIT INT TERM HUP; work $DATA "$@" ) &
    WORK=$!
    wait $WORK; code=$?
    WORK=""
    exit $code ;;
  stop) end_all ;;
  pods) pods ;;
  watchdog) watchdog $2 $3 ;;
  *) echo "usage: pod.sh run DATA NAME:ENCODER:SEED[:EXTRA FLAGS] ... | stop | pods | watchdog ID PID"; exit 2 ;;
esac
