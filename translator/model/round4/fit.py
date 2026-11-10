#!/usr/bin/env python3
# The style-blind calibrator (round 4): a temperature for each pass's sureness (choices^c places^p texts^t), the same for
# every writer, chosen on validation alone (mended keys + the new validation side) for the most right served at the cut
# certified there by the one-sided bound. Nothing of the writer or wording enters it.
#   python3 translator/model/round4/fit.py <A tag> [<B tag>|-] [flags...]
# Moved into git from runs/translator-v4-r4-2026-11-08/scripts/fit.py on 2026-11-10.
import json, subprocess, sys, glob, itertools, os, pathlib
W = str(pathlib.Path(__file__).resolve().parents[3])  # the repo root
RUNS = os.environ.get('OIKOS_RUNS', '/Users/clawd/oikos/runs')
R = RUNS + '/translator-v4-r4-2026-11-08'
A, B, *flags = sys.argv[1:]
def ans(t, s): return glob.glob(f'{R}/scores/{t}-{s}.decide_*.jsonl')[0]
args = ['--rows', R + '/third/validation-real-all.jsonl', '--rows', R + '/keyed/validation-real-pilot.jsonl']
for s in ('vr', 'vp', 'nv'):
    args += ['--a', ans(A, s)] + (['--b', ans(B, s)] if B != '-' else [])
best = []
for c, p, t in itertools.product([0.5, 0.75, 1, 1.5, 2, 3], [0.5, 1, 2], [0.25, 0.5, 1, 2]):
    out = subprocess.run(['bun', 'translator/model/v4-serve.ts'] + args + flags + ['--pow', f'{c},{p},{t}'], cwd=W, capture_output=True, text=True)
    v = json.loads(out.stdout)['bound95']
    best.append((v['right'], c, p, t, v['served'], v['wrong']))
best.sort(reverse=True)
for b in best[:5]: print(b)
base = [b for b in best if b[1:4] == (1, 1, 1)][0]
print('pow 1,1,1:', base)
