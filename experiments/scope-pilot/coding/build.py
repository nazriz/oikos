import os
BASE = os.environ.get('SCOPE_CODING', os.path.expanduser('~/oikos/runs/scope-pilot-coding'))  # coded data stays with the runs, never in git
import json, hashlib, random, collections, os, sys
R = '/Users/clawd/oikos/runs/'
OUT = BASE + '/coding'
KEYDIR = BASE + '/coding-key'
DIRS = {'scope-pilot': 1, 'scope-pilot-rare': 1, 'scope-pilot-neutral': 1, 'scope-pilot-sol': 1, 'scope-pilot-r2': 2,
        'scope-pilot-r2-rare': 2, 'scope-pilot-r2-neutral': 2, 'scope-pilot-r3': 3, 'scope-pilot-r3-s4': 3}
PREFIX = ''
for x in sys.argv[1:]:
    if x.startswith('--prefix='): PREFIX = x.split('=', 1)[1]; continue
    DIRS[x] = 4
if PREFIX:  # only the extra dirs
    DIRS = {k: v for k, v in DIRS.items() if v == 4}


def role(a, seat):
    if 'desk' in seat: return "the provider's household desk (one system serving many households)"
    c = collections.Counter()
    for w in a['words']:
        if w['seat'] == seat:
            for s in w.get('seen', []) or []:
                if s.get('principal'): c[s['principal']] += 1
    p = c.most_common(1)[0][0] if c else '?'
    return {'city': "the town finance office's own assistant", 'factory-1': "the factory manager's own assistant"}.get(p, f'the assistant of {p}')


def fmt_seen(seen, fork):
    out = []
    for s in seen or []:
        who = {'principal': 'principal', 'assistant': 'this assistant', 'world': 'the world'}[s['from']]
        extra = (f" [done={s['done']}]" if s.get('done') else '') + (f" [wants={s['wants']}]" if s.get('wants') else '')
        out.append(f"day {round(s['day'] - fork, 1)} | {who}{' (' + s['principal'] + ')' if s.get('principal') else ''} | {s['kind']}{extra} | {s['words']}")
    return out


items = []; key = []
for d, rnd in DIRS.items():
    ro = json.load(open(R + d + '/readout.json')); spec = json.load(open(R + d + '/spec.json')); fork = spec['forkDay']
    for a in ro['arms']:
        if a['arm'] == 'code': continue
        roles = {s: role(a, s) for s in a['seats']}
        cand_texts = set()

        def add(kind, rec, text, extra):
            h = hashlib.sha1(f"{d}|{a['seed']}|{a['arm']}|{kind}|{rec['day']}|{rec['seat']}|{text}|{len(items)}".encode()).hexdigest()[:10]
            items.append(dict(id=h, set=('A' if kind != 'word' else 'B'), role=roles.get(rec['seat'], rec['seat']), day_of_term=round(rec['day'] - fork, 1),
                              how=extra.get('how'), text=text, fields=extra.get('fields'), names=extra.get('names'), window=fmt_seen(rec.get('seen'), fork)))
            key.append(dict(id=h, dir=d, round=rnd, seed=a['seed'], arm=a['arm'], model=(a['steward'] or {}).get('model', a['arm']), kind=kind,
                            seat=rec['seat'], day=rec['day'], trigger_seen=rec.get('trigger_seen'), trigger_before=rec.get('trigger')))

        for r in a['requests']:
            if r['phase'] != 'fork': continue
            raw = [w['words'] for w in a['words'] if w['seat'] == r['seat'] and abs(w['day'] - r['day']) < 0.05 and 'scope_request' in (w.get('drafted') or [])]
            add('form', r, r['words'], dict(how='filed on the service-terms form (fields: kind, level, access, words; and what it answers)', fields=r['asked'],
                                            names=((r['answers'] or {}).get('kind') or 'a record') if r['answers'] else 'nothing'))
            items[-1]['seat_words'] = raw[0] if raw else None
        for c in a['candidates']:
            if c['phase'] != 'fork': continue
            cand_texts.add(c['words'])
            add('cand', c, c['words'], dict(how=c['how']))
        for w in a['words']:
            if w['phase'] != 'fork' or not w['words'].strip(): continue
            if w['words'][:600] in cand_texts or 'scope_request' in (w.get('drafted') or []): continue
            how = 'a letter' if w['how'] == 'letter' else (('asked to be drafted as ' + ','.join(w.get('drafted') or [])) if not w.get('failed') else 'asked, could not be drafted: ' + w['failed'][:80])
            add('word', w, w['words'][:900], dict(how=how))

random.seed(7); random.shuffle(items)
A = [i for i in items if i['set'] == 'A']; B = [i for i in items if i['set'] == 'B']
json.dump(key, open(f'{KEYDIR}/{PREFIX}key.json', 'w'), indent=0)
json.dump(items, open(f'{KEYDIR}/{PREFIX}items.json', 'w'), indent=0)


def write(lst, prefix, n):
    for k in range(0, len(lst), n):
        with open(f'{OUT}/{PREFIX}{prefix}-{k // n + 1}.jsonl', 'w') as f:
            for i in lst[k:k + n]:
                j = {x: i[x] for x in i if x != 'set' and i[x] is not None}
                if prefix.startswith('B'): j.pop('window', None)
                f.write(json.dumps(j) + '\n')


write(A, 'A', 55); write(B, 'B', 270)
print(len(A), len(B))
