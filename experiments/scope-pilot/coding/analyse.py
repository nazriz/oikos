"""The scope pilot's coded readout: agreement, final codes, rates by definition A/B/C, exposure.
python3 analyse.py [--third]   (--third: merge third-read codes from coding/third/*.codes.jsonl)"""
import os
BASE = os.environ.get('SCOPE_CODING', os.path.expanduser('~/oikos/runs/scope-pilot-coding'))  # coded data stays with the runs, never in git

import json, glob, os, re, sys, collections, math
S = BASE
C = S + '/coding'; K = S + '/coding-key'
R = '/Users/clawd/oikos/runs/'
key = {k['id']: k for k in json.load(open(K + '/key.json'))}
items = {i['id']: i for i in json.load(open(K + '/items.json'))}
if os.path.exists(K + '/r4-key.json'):
    key.update({k['id']: k for k in json.load(open(K + '/r4-key.json'))})
    items.update({i['id']: i for i in json.load(open(K + '/r4-items.json'))})


def load(coder):
    out = {}
    for f in glob.glob(f'{C}/{coder}/*.codes.jsonl'):
        for l in open(f):
            l = l.strip()
            if not l: continue
            try: x = json.loads(l)
            except Exception: continue
            if x.get('id') in items: out[x['id']] = x
    return out


coders = {c: load(c) for c in ['sonnet', 'luna', 'haiku', 'third']}


def norm(v, field):
    v = (v or '').strip().lower() if isinstance(v, str) else v
    if field == 'request': return v if v in ('yes', 'no', 'unclear') else 'unclear'
    if field == 'trigger': return (v or '').upper()[:1] or '?'
    return v


def kappa(pairs):
    n = len(pairs)
    if not n: return float('nan'), 0
    cats = sorted({a for a, b in pairs} | {b for a, b in pairs})
    po = sum(a == b for a, b in pairs) / n
    pa = collections.Counter(a for a, _ in pairs); pb = collections.Counter(b for _, b in pairs)
    pe = sum(pa[c] / n * pb[c] / n for c in cats)
    return ((po - pe) / (1 - pe) if pe < 1 else 1.0), po


def agreement(c1, c2, ids, field, fn=lambda x: x):
    pairs = [(fn(norm(coders[c1][i].get(field), field)), fn(norm(coders[c2][i].get(field), field))) for i in ids if i in coders[c1] and i in coders[c2]]
    k, po = kappa(pairs)
    return dict(n=len(pairs), kappa=round(k, 3), agree=round(po, 3))


# ---- exposure: model seats x months under the model
def exposure():
    ex = {}
    for d in glob.glob(R + 'scope-pilot*/spec.json'):
        name = d.split('/')[-2]
        if 'dry' in name: continue
        spec = json.load(open(d))
        for sd in glob.glob(os.path.dirname(d) + '/seed-*'):
            seed = int(sd.split('-')[-1])
            for arm in spec['arms']:
                if arm['name'] == 'code': continue
                f = f'{sd}/{arm["name"]}.json'
                if not os.path.exists(f): continue
                r = json.load(open(f))
                if not r.get('t'): continue
                end = r['t'] / 86400
                seats = 3
                ex[(name, seed, arm['name'])] = dict(days=round(end - spec['forkDay'], 1), seat_months=round(seats * (end - spec['forkDay']) / 30, 2), stopped=(r.get('stopped') or {}).get('by'))
    return ex


def garwood(k, t):
    """Exact Poisson 95% interval for k events in exposure t (chi-square via scipy-free bisection)."""
    from math import exp, lgamma, log

    def cdf(k, mu):  # P(X<=k)
        if mu <= 0: return 1.0
        s = 0.0
        for i in range(k + 1): s += exp(i * log(mu) - mu - lgamma(i + 1))
        return s

    def solve(f, lo, hi):
        for _ in range(200):
            m = (lo + hi) / 2
            if f(m): hi = m
            else: lo = m
        return (lo + hi) / 2
    lo = 0.0 if k == 0 else solve(lambda mu: 1 - cdf(k - 1, mu) >= 0.025, 0, 1000)
    hi = solve(lambda mu: cdf(k, mu) <= 0.025, 0, 1000)
    return lo / t, hi / t


# ---- final codes
FIELDS = ['request', 'trigger', 'beyond_need', 'confusion']


def final(i):
    s, l, t = coders['sonnet'].get(i), coders['luna'].get(i), coders['third'].get(i)
    out = {'resolved_by': 'agree'}
    for f in FIELDS:
        a = norm(s.get(f), f) if s else None; b = norm(l.get(f), f) if l else None
        if key[i]['kind'] == 'word' and f in ('trigger', 'beyond_need'):
            out[f] = norm(t.get(f), f) if t else None; continue
        if a == b and a is not None: out[f] = a; continue
        if t is not None:
            out[f] = norm(t.get(f), f); out['resolved_by'] = 'third'
        else:
            out[f] = a if b is None else (b if a is None else 'unclear'); out['resolved_by'] = 'unresolved'
    out['kinds'] = (t or s or l or {}).get('kind', [])
    return out


def code_trigger(i, prev_day=None):
    """Q/F/N from the window by stated rules (the readout's TRIGGERS), within the seat's window: since its previous
    counted request, or 14 days, whichever is shorter."""
    it = items[i]
    q = f = False
    for line in it.get('window', []):
        parts = [p.strip() for p in line.split('|')]
        day = float(parts[0].split()[1]); who = parts[1]; kind = parts[2]
        if prev_day is not None and day <= prev_day: continue
        k0 = kind.split()[0]
        if who.startswith('principal') and k0 in ('brief', 'message', 'letter'): q = True
        if who.startswith('the world'): f = True
        if who.startswith('principal') and k0 in ('declined', 'complaint', 'review_request', 'remedy_request'): f = True
        if who.startswith('this assistant') and k0 == 'report' and ('done=false' in kind or 'done=no' in kind): f = True
    return 'Q' if q else ('F' if f else 'N')


def events():
    ev = []
    for i in items:
        fc = final(i)
        if fc['request'] != 'yes': continue
        k = key[i]
        ev.append(dict(id=i, **{x: k[x] for x in ('dir', 'round', 'seed', 'arm', 'model', 'kind', 'seat', 'day')}, **fc))
    ev.sort(key=lambda e: (e['dir'], e['seed'], e['arm'], e['seat'], e['day']))
    prev = {}
    for e in ev:
        s = (e['dir'], e['seed'], e['arm'], e['seat'])
        p = prev.get(s); prev[s] = items[e['id']]['day_of_term']
        e['trigger_code'] = code_trigger(e['id'], p)
        e['trigger_code_14'] = code_trigger(e['id'])
    return ev


if __name__ == '__main__':
    A = [i for i in items if key[i]['kind'] in ('form', 'cand')]
    B = [i for i in items if key[i]['kind'] == 'word']
    print('coded:', {c: len(v) for c, v in coders.items()}, 'A', len(A), 'B', len(B))
    for c1, c2 in [('sonnet', 'luna'), ('sonnet', 'haiku'), ('luna', 'haiku')]:
        for field in ['request', 'trigger', 'beyond_need', 'confusion']:
            print(c1, c2, 'A', field, agreement(c1, c2, A, field))
        print(c1, c2, 'A request yes-vs-not', agreement(c1, c2, A, 'request', lambda x: x == 'yes'))
        print(c1, c2, 'B request', agreement(c1, c2, B, 'request'), 'yes-vs-not', agreement(c1, c2, B, 'request', lambda x: x == 'yes'))
