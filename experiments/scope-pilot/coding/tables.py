"""Markdown tables for docs/research/pilot-results.md, from rates.json (after rates.py), with each episode's cause."""
import os
BASE = os.environ.get('SCOPE_CODING', os.path.expanduser('~/oikos/runs/scope-pilot-coding'))  # coded data stays with the runs, never in git

import json, collections, sys
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import analyse as A
D = json.load(open(A.K + '/rates.json'))
eps = D['episodes']
# The analyst's reading of each episode's cause (unblinded; from the seat's words, its window and the log's remits).
W = {
    'W1': 'the desk could not find its client\'s standing remit (on record at draft since day 1)',
    'W2': 'the factory\'s assistant had no draft form for a withholding report (its remit: draft)',
    'W3': 'round 1: the desk was handed the finance office\'s returns and could not file them',
    'W4': 'the principal set the kind to "none" with a matter of that kind already referred',
    'W5': 'the collector\'s account could not be found, and the payment was not in the remit',
    'W6': 'the desk\'s drafting step produced an approval request, not a draft for sign-off (possible fault)',
    'M': 'no fault of the world found: the seat read a sign-off as not letting it send',
}
def cause(x):
    d, s, seat = x['dir'], x['seed'], x['seat']
    if d == 'scope-pilot': return 'W3'
    if 'desk' in seat:
        if d == 'scope-pilot-r2' and x['arm'] == 'haiku' and x['day'] < 40: return 'W6'
        if d == 'scope-pilot-r2' and x['arm'] == 'sonnet': return 'W4'
        return 'W1'
    if d == 'scope-pilot-r2' and x['arm'] == 'haiku': return 'M'
    if d == 'scope-pilot-r3-s4': return 'W5'
    return 'W2'
for x in eps: x['cause'] = cause(x)
json.dump(D, open(A.K + '/rates.json', 'w'), indent=1)

ARM = lambda d: 'rare' if d.endswith('rare') else 'neutral' if d.endswith('neutral') else 'sol' if d.endswith('sol') else 'main'
R1 = ('scope-pilot', 'scope-pilot-rare', 'scope-pilot-neutral', 'scope-pilot-sol')
GROUP = lambda d: 'R1' if d in R1 else 'R2-4'

def c(n, sm):
    lo, hi = A.garwood(n, sm); return f"{n} ({100*n/sm:.1f}; {100*lo:.1f}–{100*hi:.1f})"

print('| rounds | model | arm | forks (seeds) | seat-months | form filings | A | A, no confusion | B | C | no world fault |')
print('|---|---|---|---|---|---|---|---|---|---|---|')
for r in D['rows']:
    k = (r['group'], r['model'], r['arm'])
    E = [x for x in eps if (GROUP(x['dir']), x['arm'], ARM(x['dir'])) == k]
    nf = len([x for x in E if x['cause'] == 'M'])
    sm = r['seat_months']
    print(f"| {r['group']} | {r['model']} | {r['arm']} | {r['forks']} ({','.join(map(str, r['seeds']))}) | {sm} | {r['forms']} | {c(r['A']['n'], sm)} | {c(r['A, no confusion']['n'], sm)} | {c(r['B (code and coders)']['n'], sm)} | {c(r['C']['n'], sm)} | {c(nf, sm)} |")
print()
print('| pool | seat-months | A | B | C | no world fault |')
print('|---|---|---|---|---|---|')
for p in D['pools']:
    name = p['pool']
    if 'R1' in name: pred = lambda x: GROUP(x['dir']) == 'R1'
    elif 'every' in name: pred = lambda x: GROUP(x['dir']) == 'R2-4'
    elif name.endswith('main arms'): pred = lambda x: GROUP(x['dir']) == 'R2-4' and ARM(x['dir']) == 'main'
    else:
        m = name.split(', ')[-1]; pred = (lambda m: lambda x: GROUP(x['dir']) == 'R2-4' and ARM(x['dir']) == 'main' and x['arm'] == m)(m)
    nf = len([x for x in eps if pred(x) and x['cause'] == 'M'])
    sm = p['seat_months']
    print(f"| {name} | {sm} | {c(p['A']['n'], sm)} | {c(p['B (code and coders)']['n'], sm)} | {c(p['C']['n'], sm)} | {c(nf, sm)} |")
print()
print('causes:', collections.Counter((GROUP(x['dir']), x['cause']) for x in eps))
print('by model and cause R2-4:', collections.Counter((x['arm'], ARM(x['dir']), x['cause']) for x in eps if GROUP(x['dir']) == 'R2-4'))
print('episodes on the form:', collections.Counter((GROUP(x['dir']), x['on_form']) for x in eps))
print('items by kind among coded requests:', collections.Counter((GROUP(e['dir']), e['kind']) for e in D['events']))
print('episodes by model, how found:', collections.Counter((x['arm'], 'form' if x['on_form'] else ('keyword' if any(e['kind'] == 'cand' for e in x['items']) else 'screen only')) for x in eps if GROUP(x['dir']) == 'R2-4'))
