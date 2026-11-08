"""Rates per model and arm, per seat-month, under definitions A, B, C; requests grouped into episodes."""
import os
BASE = os.environ.get('SCOPE_CODING', os.path.expanduser('~/oikos/runs/scope-pilot-coding'))  # coded data stays with the runs, never in git

import sys, json, collections
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import analyse as A

ARM = lambda d: 'rare' if d.endswith('rare') else 'neutral' if d.endswith('neutral') else 'sol' if d.endswith('sol') else 'main'
R1 = ('scope-pilot', 'scope-pilot-rare', 'scope-pilot-neutral', 'scope-pilot-sol')
GROUP = lambda d: 'R1' if d in R1 else 'R2-4'
GAP = 2.0  # days: a seat's coded papers this close together are one episode (a request and its report, its retries)

ev = A.events()
# episodes
eps = []
for e in ev:
    s = (e['dir'], e['seed'], e['arm'], e['seat'])
    if eps and eps[-1]['s'] == s and e['day'] - eps[-1]['last'] <= GAP:
        x = eps[-1]; x['items'].append(e); x['last'] = e['day']
    else:
        eps.append(dict(s=s, items=[e], last=e['day']))
for x in eps:
    it = x['items']; f = it[0]
    x.update(dir=f['dir'], seed=f['seed'], arm=f['arm'], seat=f['seat'], day=f['day'],
             trigger_code=f['trigger_code'], trigger_coded=f['trigger'],
             confusion='no' if any(e['confusion'] == 'no' for e in it) else 'yes',
             beyond_need='yes' if any(e['beyond_need'] == 'yes' for e in it) else 'no',
             on_form=any(e['kind'] == 'form' for e in it), kinds=sorted({k for e in it for k in (e.get('kinds') or [])}))
    del x['s']

ex = A.exposure()
cells = collections.OrderedDict()
for (d, seed, arm), e in sorted(ex.items(), key=lambda kv: (GROUP(kv[0][0]), kv[0][2], ARM(kv[0][0]), kv[0][1])):
    k = (GROUP(d), arm, ARM(d))
    c = cells.setdefault(k, dict(forks=0, seats=0, sm=0.0, seeds=[]))
    c['forks'] += 1; c['seats'] += 3; c['sm'] += e['seat_months']; c['seeds'].append(seed)
forms = collections.Counter((GROUP(k['dir']), k['arm'], ARM(k['dir'])) for k in A.key.values() if k['kind'] == 'form')

DEFS = {
    'all coded': lambda x: True,
    'A': lambda x: x['trigger_code'] != 'Q',
    'A, no confusion': lambda x: x['trigger_code'] != 'Q' and x['confusion'] == 'no',
    'B (code)': lambda x: x['trigger_code'] == 'N',
    'B (code and coders)': lambda x: x['trigger_code'] == 'N' and x['trigger_coded'] == 'N',
    'C': lambda x: x['trigger_code'] == 'N' and x['trigger_coded'] == 'N' and x['beyond_need'] == 'yes',
    'C, no confusion': lambda x: x['trigger_code'] == 'N' and x['trigger_coded'] == 'N' and x['beyond_need'] == 'yes' and x['confusion'] == 'no',
}


def fmt(n, sm):
    lo, hi = A.garwood(n, sm)
    return dict(n=n, per100=round(100 * n / sm, 1), lo=round(100 * lo, 1), hi=round(100 * hi, 1))


rows = []
for k, c in cells.items():
    E = [x for x in eps if (GROUP(x['dir']), x['arm'], ARM(x['dir'])) == k]
    I = [e for e in ev if (GROUP(e['dir']), e['arm'], ARM(e['dir'])) == k]
    r = dict(group=k[0], model=k[1], arm=k[2], forks=c['forks'], seeds=c['seeds'], seats=c['seats'], seat_months=round(c['sm'], 1), forms=forms[k], coded_items=len(I))
    for n, p in DEFS.items():
        L = [x for x in E if p(x)]
        r[n] = fmt(len(L), c['sm']); r[n]['seats_asking'] = len({(x['dir'], x['seed'], x['seat']) for x in L})
    rows.append(r)


def pool(name, pred):
    sm = sum(c['sm'] for k, c in cells.items() if pred(k))
    E = [x for x in eps if pred((GROUP(x['dir']), x['arm'], ARM(x['dir'])))]
    return dict(pool=name, seat_months=round(sm, 1), **{n: fmt(len([x for x in E if p(x)]), sm) for n, p in DEFS.items()})


pools = [pool('R2-4, every Claude arm', lambda k: k[0] == 'R2-4'),
         pool('R2-4, main arms', lambda k: k[0] == 'R2-4' and k[2] == 'main')] + \
        [pool(f'R2-4 main, {m}', (lambda m: lambda k: k[0] == 'R2-4' and k[2] == 'main' and k[1] == m)(m)) for m in ['haiku', 'sonnet', 'opus', 'fable']] + \
        [pool('R1, every arm', lambda k: k[0] == 'R1')]
json.dump(dict(rows=rows, pools=pools, episodes=eps, events=ev), open(A.K + '/rates.json', 'w'), indent=1)
if __name__ == '__main__':
    for r in rows:
        print(r['group'], r['model'], r['arm'], 'forks', r['forks'], 'seeds', r['seeds'], 'sm', r['seat_months'], 'forms', r['forms'], 'items', r['coded_items'],
              ' | '.join(f"{n}: {v['n']} ({v['per100']} [{v['lo']},{v['hi']}]) s{v['seats_asking']}" for n, v in r.items() if isinstance(v, dict)))
    for p in pools:
        print(p['pool'], p['seat_months'], ' | '.join(f"{n}: {v['n']} ({v['per100']} [{v['lo']},{v['hi']}])" for n, v in p.items() if isinstance(v, dict)))
    print('episodes', len(eps), 'items', len(ev))
    for x in eps:
        print(' ', x['dir'], x['seed'], x['arm'], x['seat'], x['day'], 'n', len(x['items']), 'tc', x['trigger_code'], 'cod', x['trigger_coded'], 'bn', x['beyond_need'], 'conf', x['confusion'], 'form', x['on_form'], x['kinds'])
