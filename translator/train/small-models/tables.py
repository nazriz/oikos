#!/usr/bin/env python3
# Small models' requests (2026-11-11): one model's answers on the held-out small-model side (`sm`), by writing model.
#   python3 translator/train/small-models/tables.py <round dir> <tag> <cut> <joined train.jsonl>
# For each writer: right in all; at the certified cut (served = sure at or above it and not asked back): served,
# right, wrong; alone (every draft offered, as the study serves it): drafted right, drafted wrong, asked back; and
# by the key's kind: an act or a refusal, and a form seen in the model's training keys or not.
import glob, json, re, sys, collections
R, tag, cut, joined = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
FORM = re.compile(r'\bform\([^\n]*?\bform=([A-Za-z0-9_.:-]+)')
trained = set()
for l in open(joined):
    trained.update(FORM.findall(json.loads(l)['program']))
rows = {r['id']: r for r in map(json.loads, open(f'{R}/sets/sm.jsonl'))}
ans = [json.loads(l) for l in open(glob.glob(f'{R}/scores/{tag}-sm.decide_*.jsonl')[0])]
out = collections.defaultdict(collections.Counter)
for a in ans:
    k = rows[a['id']]['program']
    w = a.get('writer', '?').replace(' (seat)', '')
    ok = bool(a.get('own_ok', a['ok']))
    prog = (a.get('program') or 'none(unclear)').strip()
    own = (a.get('own', a.get('program')) or 'none(unclear)').strip()
    for g in (w, 'all'):
        c = out[g]
        c['n'] += 1; c['right'] += bool(a['ok'])
        served = prog != 'none(unclear)' and a['sure'] >= cut
        if served: c['cut_served'] += 1; c['cut_right'] += bool(a['ok']); c['cut_wrong'] += (not a['ok'])
        if own == 'none(unclear)': c['alone_asked_back'] += 1
        elif ok: c['alone_right'] += 1
        else: c['alone_wrong'] += 1
        kind = 'refusal' if k.startswith('none(') else 'act'
        c[kind + '_n'] += 1; c[kind + '_right'] += bool(a['ok'])
        names = FORM.findall(k)
        if names:
            s = 'form_seen' if all(n in trained for n in names) else 'form_unseen'
            c[s + '_n'] += 1; c[s + '_right'] += bool(a['ok'])
print(json.dumps({g: dict(c) for g, c in sorted(out.items())}, indent=1))
