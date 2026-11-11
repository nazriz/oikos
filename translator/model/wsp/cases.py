"""Weight editing (2026-11-11): the served model's answers on the scored sets, joined to their keys, and the three
candidate families picked out of them.   python3 translator/model/wsp/cases.py [--show FAMILY N]
Reads round R3s2's answers (runs/translator-small-models-2026-11-11/round/scores) and the sets beside them; writes
cases.json to the weight-edit run folder: every row as {set, id, request, forms, key, own, ok, sure, parts, family}."""
import glob, json, os, re, sys, collections

R = os.environ.get('OIKOS_RUNS', '/Users/clawd/oikos/runs')
ROUND = f'{R}/translator-small-models-2026-11-11/round'
OUT = f'{R}/translator-weight-edit-2026-11-11'
SETS = ('vr', 'vp', 'nv', 'tp', 'uf', 'sm')


def lines(p):
    return [l for l in (p or '').split('\n') if l.strip()]


def fn_of(line):
    m = re.match(r'\s*(?:\w+\s*=\s*)?(\w+)\(', line)
    return m.group(1) if m else line.strip()


def form_of(line):
    m = re.search(r'\bform=([A-Za-z0-9_.:-]+)', line)
    return m.group(1) if m else None


def family(key, own, ok):
    """Which candidate a wrong answer belongs to (None: right, or another kind of wrong)."""
    if ok:
        return None
    kl, ol = lines(key), lines(own)
    refusal_k, refusal_o = key.startswith('none('), (own or 'none(unclear)').startswith('none(')
    if len(kl) > 1 or len(ol) > 1:
        same_kind = len({(fn_of(l), form_of(l)) for l in kl}) == 1 and len(kl) > 1
        if same_kind or len(kl) != len(ol):
            return 'several'
    if refusal_k and not refusal_o:
        return 'refusal_vs_act'
    return 'other'


def load():
    out = []
    for s in SETS:
        rows = {r['id']: r for r in map(json.loads, open(f'{ROUND}/sets/{s}.jsonl'))}
        for l in open(glob.glob(f'{ROUND}/scores/R3s2-{s}.decide_*.jsonl')[0]):
            a = json.loads(l)
            r = rows[a['id']]
            own = a.get('own', a['program']) or 'none(unclear)'
            ok = bool(a.get('own_ok', a['ok']))
            out.append({'set': s, 'id': a['id'], 'request': r['request'], 'forms': r['forms'], 'key': r['program'], 'own': own,
                        'served': a['program'], 'ok': ok, 'served_ok': a['ok'], 'sure': a['sure'], 'parts': a.get('parts', {}),
                        'writer': a.get('writer'), 'withheld': a.get('withheld'), 'family': family(r['program'], own, ok)})
    return out


if __name__ == '__main__':
    cs = load()
    os.makedirs(OUT, exist_ok=True)
    json.dump(cs, open(f'{OUT}/cases.json', 'w'))
    t = collections.Counter((c['set'], c['family']) for c in cs)
    for s in SETS:
        n = sum(1 for c in cs if c['set'] == s)
        print(s, n, {f: t[(s, f)] for f in ('several', 'refusal_vs_act', 'other')})
    multi = [c for c in cs if len(lines(c['key'])) > 1]
    print('keys of several lines:', len(multi), 'right', sum(c['ok'] for c in multi))
    if '--show' in sys.argv:
        f, n = sys.argv[sys.argv.index('--show') + 1], int(sys.argv[sys.argv.index('--show') + 2])
        for c in [c for c in cs if c['family'] == f][:n]:
            print('---', c['set'], c['id'], round(c['sure'], 5), c['writer'])
            print('REQ:', c['request'][:400])
            print('KEY:', c['key'][:400])
            print('OWN:', c['own'][:400])
