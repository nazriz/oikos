#!/usr/bin/env python3
# Round 4 arrangements read offline (v4-serve.ts): the cut certified (one-sided 95% bound) on a validation set, then read
# at that cut on the test side, the parity set (all, and common situations) and unseen forms.
#   python3 translator/model/round4/serve.py <tag> <A tag> [<B tag>|-] <validation: old|mended|mended+new> [flags...]
# Moved into git from runs/translator-v4-r4-2026-11-08/scripts/serve.py on 2026-11-10.
import json, subprocess, sys, glob, os, pathlib
W = str(pathlib.Path(__file__).resolve().parents[3])  # the repo root
RUNS = os.environ.get('OIKOS_RUNS', '/Users/clawd/oikos/runs')
R = RUNS + '/translator-v4-r4-2026-11-08'
R3 = RUNS + '/translator-v4-r3-2026-11-08'
R2 = RUNS + '/translator-v4-r2-2026-11-08'
B1 = RUNS + '/translator-v4-2026-11-07'
tag, A, B, val, *flags = sys.argv[1:]
src = os.environ.get('SRC', R + '/scores')

def ans(t, s):
    g = glob.glob(f'{src}/{t}-{s}.decide_*.jsonl')
    assert len(g) == 1, (t, s, g)
    return g[0]

def ab(sets):
    out = []
    for s in sets:
        out += ['--a', ans(A, s)]
        if B != '-':
            out += ['--b', ans(B, s)]
    return out

rows = {'old': [R2 + '/keyed/validation-real-all.jsonl'], 'mended': [R + '/third/validation-real-all.jsonl'],
        'mended+new': [R + '/third/validation-real-all.jsonl', R + '/keyed/validation-real-pilot.jsonl'],
        'new': [R + '/keyed/validation-real-pilot.jsonl']}[val]
vsets = ['vr', 'vp'] + (['nv'] if 'new' in val else [])
if val == 'new': vsets = ['nv']
out = R + f'/serve/{tag}'
os.makedirs(R + '/serve', exist_ok=True)
def run(args):
    p = subprocess.run(['bun', 'translator/model/v4-serve.ts'] + args, cwd=W, capture_output=True, text=True)
    if p.returncode: print(p.stderr); sys.exit(1)
    return json.loads(p.stdout)
rr = sum((['--rows', r] for r in rows), [])
v = run(rr + ab(vsets) + flags + ['--out', out + '-val.json'])
cut = v['bound95']['cut']
res = {'val': {'rows': v['rows'], 'right': v['right'], 'asked_back_by': v['asked_back_by'], 'bound95': v['bound95'], 'at_1pct': v['at_1pct']}}
for s, r in [('tp', R2 + '/keyed/test-pilot.jsonl'), ('par', R3 + '/rewrites/parity.jsonl'), ('uf', B1 + '/v4a-text/validation-uf.jsonl')]:
    x = run(['--rows', r] + ab([s]) + flags + ['--cut', str(cut), '--out', out + f'-{s}.json'])
    full = json.load(open(out + f'-{s}.json'))
    res[s] = {'rows': x['rows'], 'right': x['right'], 'at_cut': {k: x['at_cut'][k] for k in ('served', 'right', 'wrong', 'right_served_share', 'wrong_bound95')}, 'by_writer': x['at_cut']['by_writer'], 'spread': full['at_cut']['parity_spread_points']}
x = run(['--rows', R3 + '/rewrites/parity.jsonl'] + ab(['par']) + flags + ['--cut', str(cut), '--common', '--out', out + '-par-common.json'])
res['par_common_spread'] = json.load(open(out + '-par-common.json'))['at_cut']['parity_spread_points']
res['par_common_by_writer'] = x['at_cut']['by_writer']
json.dump(res, open(out + '-summary.json', 'w'), indent=1)
v95 = res['val']['bound95']
print(f"{tag}: val {res['val']['rows']} right {res['val']['right']} | certified cut {cut:.6f}: served {v95['served']} right {v95['right']} wrong {v95['wrong']}")
for s in ('tp', 'par', 'uf'):
    a = res[s]['at_cut']
    print(f"   {s}: {res[s]['rows']} right-in-all {res[s]['right']} | served right {a['right']} ({100*a['right_served_share']:.1f}%) wrong {a['wrong']} bound {a['wrong_bound95']} | spread {res[s]['spread']}  {res[s]['by_writer'] if s!='uf' else ''}")
print(f"   par common spread {res['par_common_spread']} {res['par_common_by_writer']}")
