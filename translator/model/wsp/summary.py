#!/usr/bin/env python3
"""Weight editing (2026-11-11): tags side by side, as round 5 reports a model: right in all by set; the cut certified
on validation (vr + vp + nv, the one-sided 95% bound of 1% wrong among what is served; v4-serve.ts), read on the test
side (tp), unseen forms (uf) and the small models' held-out side (sm): served, right, wrong; and every case whose own
answer went from right to wrong, or was served right and no longer is, against the first tag.
  python3 translator/model/wsp/summary.py <base tag> <tag>... [--ids FILE] [--cut X]   (--ids: score only those ids, a
  checking half; --cut: read at this cut-off, e.g. the whole validation's, where a half is too small to certify one)"""
import glob, json, os, subprocess, sys, tempfile
W = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
R = os.environ.get('OIKOS_RUNS', '/Users/clawd/oikos/runs')
SETS = f'{R}/translator-small-models-2026-11-11/round/sets'
SC = f'{R}/translator-weight-edit-2026-11-11/scores'
args = sys.argv[1:]
only = None
if '--ids' in args:
    i = args.index('--ids'); only = set(json.load(open(args[i + 1]))); args = args[:i] + args[i + 2:]
fixed = None
if '--cut' in args:
    i = args.index('--cut'); fixed = float(args[i + 1]); args = args[:i] + args[i + 2:]
tags = args


def ans(tag, s):
    a = [json.loads(l) for l in open(glob.glob(f'{SC}/{tag}-{s}.decide_*.jsonl')[0])]
    return [x for x in a if only is None or f'{s}:{x["id"]}' in only]


def serve(pairs, cut=None):
    tmp = []
    a = []
    for s, xs in pairs:
        rows = [l for l in open(f'{SETS}/{s}.jsonl') if only is None or f'{s}:{json.loads(l)["id"]}' in only]
        fr = tempfile.NamedTemporaryFile('w', suffix='.jsonl', delete=False); fr.writelines(rows); fr.close()
        fa = tempfile.NamedTemporaryFile('w', suffix='.jsonl', delete=False); fa.writelines(json.dumps(x) + '\n' for x in xs); fa.close()
        a += ['--rows', fr.name, '--a', fa.name]; tmp += [fr.name, fa.name]
    p = subprocess.run(['bun', 'translator/model/v4-serve.ts'] + a + (['--cut', str(cut)] if cut is not None else []), cwd=W, capture_output=True, text=True)
    for t in tmp: os.unlink(t)
    if p.returncode: sys.exit(p.stderr)
    return json.loads(p.stdout)


out = {}
for tag in tags:
    o = {'right': {}}
    for s in ('vr', 'vp', 'nv', 'tp', 'uf', 'sm'):
        a = ans(tag, s)
        o['right'][s] = [sum(bool(x.get('own_ok', x['ok'])) for x in a), len(a)]
    v = serve([(s, ans(tag, s)) for s in ('vr', 'vp', 'nv')])
    cut = v['bound95']['cut'] if fixed is None else fixed
    o['cut'] = cut
    if fixed is not None:
        v = serve([(s, ans(tag, s)) for s in ('vr', 'vp', 'nv')], cut); v['bound95'] = v['at_cut']
    o['validation'] = {k: v['bound95'][k] for k in ('served', 'right', 'wrong')}
    for s in ('tp', 'uf', 'sm'):
        x = serve([(s, ans(tag, s))], cut)['at_cut']
        o[s] = {k: x[k] for k in ('served', 'right', 'wrong')}
    out[tag] = o
print(f"{'tag':<14}" + ''.join(f"{s+' right':>11}" for s in ('vr', 'vp', 'nv', 'tp', 'uf', 'sm')) + f"{'cut':>10}{'val s/r/w':>13}" + ''.join(f"{s+' s/r/w':>13}" for s in ('tp', 'uf', 'sm')))
for tag, o in out.items():
    print(f"{tag:<14}" + ''.join(f"{o['right'][s][0]:>7}/{o['right'][s][1]:<3}" for s in ('vr', 'vp', 'nv', 'tp', 'uf', 'sm')) + f"{o['cut']:>10.6f}" +
          ''.join(f"{'/'.join(str(o[k][x]) for x in ('served', 'right', 'wrong')):>13}" for k in ('validation', 'tp', 'uf', 'sm')))
base = tags[0]
for tag in tags[1:]:
    cut0, cut1 = out[base]['cut'], out[tag]['cut']
    print(f'--- {tag} against {base}: own answers changed')
    for s in ('vr', 'vp', 'nv', 'tp', 'uf', 'sm'):
        a0 = {x['id']: x for x in ans(base, s)}
        for x in ans(tag, s):
            y = a0.get(x['id'])
            if y is None: continue
            o0, o1 = bool(y.get('own_ok', y['ok'])), bool(x.get('own_ok', x['ok']))
            p0, p1 = y.get('own', y['program']), x.get('own', x['program'])
            if p0 != p1 or o0 != o1:
                print(f"  {s} {x['id'][:50]:<50} {'right' if o0 else 'wrong'}->{'right' if o1 else 'wrong'} sure {y['sure']:.6f}->{x['sure']:.6f}")
json.dump(out, open(f'{SC}/summary-{"-".join(tags)}{"-ids" if only else ""}.json', 'w'), indent=1)
