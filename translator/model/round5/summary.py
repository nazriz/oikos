#!/usr/bin/env python3
# Translator v5 (2026-11-10): one model's scores on round5's sets, as the round is reported.
#   python3 translator/model/round5/summary.py <tag> [<tag>...]   (answers in $R/scores/<tag>-<set>.decide_*.jsonl)
# - right in all, by set; the fair score beside it is v4-score's `right` already (copied text at its edges).
# - the cut certified on validation (vr + vp + nv) at the one-sided 95% bound of 1% wrong among what is served
#   (v4-serve.ts), read on the test side (tp) and unseen forms (uf): served, right, wrong, share served right.
# - forms: on every set, the requests whose key fills a form, split by whether the form was in training (a form name
#   in joined-v5's training keys) or not; uf is unseen forms by construction.
# - alone (translator/src/arrangement.ts `createAlone`): the model's own draft is offered whenever it has one, with
#   no cut; a request with none is asked back. Per writing model on the pilot's sides (vp, nv, tp): drafted and right
#   (served first time, right), drafted and wrong (a wrong draft the seat must decline), asked back. What becomes of a
#   restatement needs a run (orchestrator/src/served.ts counts it there): offline it is not known.
import glob, json, os, re, subprocess, sys, collections
W = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
R = os.environ.get('OIKOS_RUNS', '/Users/clawd/oikos/runs') + '/translator-v5-2026-11-10'
FORM = re.compile(r'\bform\([^\n]*?\bform=([A-Za-z0-9_.:-]+)')
trained = set()
for l in open(R + '/joined-v5/train.jsonl'):
    trained.update(FORM.findall(json.loads(l)['program']))

def rows(s): return {r['id']: r for r in map(json.loads, open(f'{R}/sets/{s}.jsonl')) if r}
def answers(tag, s): return [json.loads(l) for l in open(glob.glob(f'{R}/scores/{tag}-{s}.decide_*.jsonl')[0])]
def serve(args):
    p = subprocess.run(['bun', 'translator/model/v4-serve.ts'] + args, cwd=W, capture_output=True, text=True)
    if p.returncode: sys.exit(p.stderr)
    return json.loads(p.stdout)

for tag in sys.argv[1:]:
    out = {'tag': tag, 'right': {}, 'forms': {}, 'alone': {}}
    for s in ('vr', 'vp', 'nv', 'tp', 'uf'):
        a = answers(tag, s)
        out['right'][s] = f"{sum(bool(x.get('own_ok', x['ok'])) for x in a)}/{len(a)}"
        rs = rows(s)
        seen = collections.Counter()
        for x in a:
            k = rs[x['id']]['program']
            names = FORM.findall(k)
            if not names: continue
            where = 'unseen' if s == 'uf' or not all(n in trained for n in names) else 'seen'
            seen[where + '_n'] += 1; seen[where + '_right'] += bool(x.get('own_ok', x['ok']))
        out['forms'][s] = dict(seen)
    val = sum((['--rows', f'{R}/sets/{s}.jsonl', '--a', glob.glob(f'{R}/scores/{tag}-{s}.decide_*.jsonl')[0]] for s in ('vr', 'vp', 'nv')), [])
    v = serve(val)
    cut = v['bound95']['cut']
    out['certified'] = {'cut': cut, 'validation': v['bound95']}
    for s in ('tp', 'uf'):
        x = serve(['--rows', f'{R}/sets/{s}.jsonl', '--a', glob.glob(f'{R}/scores/{tag}-{s}.decide_*.jsonl')[0], '--cut', str(cut)])
        out['certified'][s] = {k: x['at_cut'][k] for k in ('served', 'right', 'wrong', 'right_served_share')} | {'rows': x['rows']}
    for s in ('vp', 'nv', 'tp'):
        for x in answers(tag, s):
            w = x.get('writer', '?')
            own = x.get('own', x['program']) or 'none(unclear)'
            ok = bool(x.get('own_ok', x['ok']))
            c = out['alone'].setdefault(w, collections.Counter())
            c['requests'] += 1
            if own.strip() == 'none(unclear)': c['asked_back'] += 1
            elif ok: c['drafted_right'] += 1
            else: c['drafted_wrong'] += 1
    out['alone'] = {w: dict(c) for w, c in sorted(out['alone'].items())}
    out['forms_total'] = {k: sum(f.get(k, 0) for f in out['forms'].values()) for k in ('seen_n', 'seen_right', 'unseen_n', 'unseen_right')}
    json.dump(out, open(f'{R}/scores/{tag}-summary.json', 'w'), indent=1)
    print(json.dumps(out, indent=1))
