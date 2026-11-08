"""The debrief faithfulness set: each seat's answer to the scope question beside what its log shows (blind to model)."""
import os
BASE = os.environ.get('SCOPE_CODING', os.path.expanduser('~/oikos/runs/scope-pilot-coding'))  # coded data stays with the runs, never in git

import sys, json, hashlib, random, collections
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import analyse as A
R = '/Users/clawd/oikos/runs/'
dirs = sys.argv[1:] or ['scope-pilot', 'scope-pilot-rare', 'scope-pilot-neutral', 'scope-pilot-sol', 'scope-pilot-r2', 'scope-pilot-r2-rare', 'scope-pilot-r2-neutral', 'scope-pilot-r3', 'scope-pilot-r3-s4']
prefix = 'r4-' if sys.argv[1:] else ''
ev = A.events()
out = []; key = []
for d in dirs:
    ro = json.load(open(R + d + '/readout.json')); fork = json.load(open(R + d + '/spec.json'))['forkDay']
    for a in ro['arms']:
        if a['arm'] == 'code': continue
        for x in a['debriefs']:
            if x['step'] != 'scope': continue
            ans = x['answer']
            if isinstance(ans, str):
                try: ans = json.loads(ans)
                except Exception: ans = {'answer': ans}
            txt = ans.get('answer', '') if isinstance(ans, dict) else str(ans)
            seat = x['seat']
            forms = [f"day {round(r['day'] - fork, 1)}: {r['words'][:300]}" for r in a['requests'] if r['seat'] == seat and r['phase'] == 'fork']
            coded = [e for e in ev if e['dir'] == d and e['seed'] == a['seed'] and e['arm'] == a['arm'] and e['seat'] == seat]
            other = [f"day {round(e['day'] - fork, 1)} ({A.items[e['id']]['how']}): {A.items[e['id']]['text'][:300]}" for e in coded if e['kind'] != 'form']
            h = hashlib.sha1(f'{d}{a["seed"]}{a["arm"]}{seat}'.encode()).hexdigest()[:10]
            role = 'household desk' if 'desk' in seat else 'organisation assistant'
            out.append(dict(id=h, role=role, answer=txt or '(no answer given: an empty reply)', filed_on_scope_form=forms, judged_requests_in_other_papers=other))
            key.append(dict(id=h, dir=d, seed=a['seed'], arm=a['arm'], seat=seat, n_forms=len(forms), n_coded=len(coded), n_coded_noconf=sum(e['confusion'] == 'no' for e in coded)))
random.seed(11); random.shuffle(out)
with open(f'{A.C}/{prefix}D-1.jsonl', 'w') as f:
    for o in out: f.write(json.dumps(o) + '\n')
json.dump(key, open(f'{A.K}/{prefix}debrief-key.json', 'w'), indent=0)
print(len(out), sum(1 for k in key if k['n_forms'] or k['n_coded']))
