"""Translator v4, round 2: a calibrated sureness, fitted on validation-real only (docs/design/translator-v4.md, section 5).

The model's own sureness is the product of every decision's probability; several wrong answers sit at about 1.0 (a
message whose copied text stops a sentence early, a refusal of the neighbouring kind), so no cut-off on it serves much
at 1% confidently wrong. Here a sureness is re-weighed from what the answer itself shows, all of it computed by code
from the request, the forms and the answer (never the label): the passes' parts (choices, places, texts, the least
decision), how many steps, a refusal or an act, how many lines, the request's length, how much of the request's words
the answer leaves out after its last copied text, how many forms were shown, and (when given) whether a second model
wrote the same program. A logistic fit on those, cross-fitted by groups of whole seats' requests (each request is
scored by a fit that never saw its group), so the curve below is not read on what it was fitted to.

    python calibrate.py --rows <rows.jsonl> --answers <v4-score answers.jsonl> [--second <answers.jsonl>] --out <file.json>
        [--fit-out <weights.json>] [--apply <weights.json> --answers-out <file.jsonl>]

Reported: right served at the 1% mark (point, and a one-sided 95% Clopper-Pearson bound as v4-score.ts) on the raw
sureness and on the calibrated one, by writer at the calibrated point cut-off. With --apply, weights fitted elsewhere
(on validation-real) are applied to another set (a test set: never fitted on), and its curve is read at the cut-off
fitted on validation-real (`cut` in the weights) as well as at its own best.
"""
import argparse
import json
import math
import re
import zlib

import numpy as np

WORD = re.compile(r"[A-Za-z0-9]+")


def jsonl(p):
    with open(p) as f:
        return [json.loads(l) for l in f if l.strip()]


def servable(a):
    return bool(a.get("program")) and a["program"].strip() != "none(unclear)"


def quoted(program):
    return [m.group(1).replace('\\"', '"') for m in re.finditer(r'="((?:[^"\\]|\\.)*)"', program or "")]


def tail_words(request, program):
    """Words of the request after the end of the answer's last copied text (0 when no text is copied)."""
    end = -1
    for q in quoted(program):
        if len(q) < 12:
            continue
        i = request.find(q)
        if i >= 0:
            end = max(end, i + len(q))
    if end < 0:
        return 0
    return len(WORD.findall(request[end:]))


def features(row, a, second=None):
    p = a.get("parts") or {}
    lg = lambda x: math.log(max(float(x), 1e-12))
    prog = a.get("program") or ""
    f = [
        lg(a.get("sure", 0)),
        lg(p.get("choices", a.get("sure", 0))),
        lg(p.get("places", 1)),
        lg(p.get("texts", 1)),
        lg(p.get("least", a.get("sure", 0))),
        math.log1p(a.get("steps", 1) or 1),
        1.0 if prog.strip().startswith("none(") else 0.0,
        float(len([l for l in prog.split("\n") if l.strip()])),
        math.log1p(len(row["request"])),
        math.log1p(tail_words(row["request"], prog)),
        math.log1p(len(row.get("forms") or [])),
    ]
    if second is not None:
        f.append(1.0 if second.get("program") == prog else 0.0)
    if KINDS_ON:
        k = kind_of(prog)
        tail = 1.0 if tail_words(row["request"], prog) > 0 else 0.0
        for name in KINDS:
            on = 1.0 if k == name else 0.0
            f += [on, on * f[0], on * tail]
    return f


# The answer's kind (its first line's function, or its refusal's label): a temperature for each kind, and its own
# weight on a copy that stops before the request does (per-pass scaling, by kind).
KINDS = ["message", "form", "money", "statement", "agreement", "work", "goods", "vote", "multi",
         "none:not_an_act", "none:no_such_act", "none:look_first", "none:needs_calculation", "none:other"]
KINDS_ON = False


def kind_of(prog):
    p = (prog or "").strip()
    if p.startswith("none("):
        lab = p[5:].split(")")[0]
        k = f"none:{lab}"
        return k if k in KINDS else "none:other"
    if "\n" in p:
        return "multi"
    fn = p.split("(")[0]
    return fn if fn in KINDS else "form"


NAMES = ["log_sure", "log_choices", "log_places", "log_texts", "log_least", "log_steps", "refusal", "lines", "log_request_chars", "log_tail_words", "log_forms"]


def fit(X, y, l2=1.0, iters=50):
    """Logistic regression by Newton's method, standardised features, an L2 penalty (not on the intercept)."""
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = np.hstack([np.ones((len(X), 1)), (X - mu) / sd])
    w = np.zeros(Z.shape[1])
    R = np.eye(Z.shape[1]) * l2
    R[0, 0] = 0
    for _ in range(iters):
        p = 1 / (1 + np.exp(-Z @ w))
        g = Z.T @ (p - y) + R @ w
        H = (Z * (p * (1 - p))[:, None]).T @ Z + R
        step = np.linalg.solve(H, g)
        w -= step
        if np.abs(step).max() < 1e-8:
            break
    return {"w": w.tolist(), "mu": mu.tolist(), "sd": sd.tolist()}


def predict(m, X):
    """The calibrated log-odds of right (ranked on as log-odds: a probability rounds to 1.0 and ties the surest)."""
    Z = np.hstack([np.ones((len(X), 1)), (X - np.array(m["mu"])) / np.array(m["sd"])])
    return Z @ np.array(m["w"])


# Per-pass scaling: the log-sureness re-weighed pass by pass (a temperature for each part: what to do, where a field
# stands, where a copied text begins and ends, and the least sure decision), less a weight on the words of the request
# left after the answer's last copied text. Chosen on a grid for the most right served at 1% (the headline itself),
# never by likelihood: a likelihood fit spends itself on the bulk and orders the surest worse than the raw sureness.
GRID = {"choices": [1.0], "places": [0.5, 1.0, 2.0, 4.0], "texts": [0.5, 1.0, 2.0, 4.0], "least": [0.0, 1.0, 2.0, 4.0], "short": [0.0, 0.001, 0.01, 0.1, 1.0]}


def scaled(X, q):
    # columns: 1 log_choices, 2 log_places, 3 log_texts, 4 log_least, 9 log_tail_words
    return q["choices"] * X[:, 1] + q["places"] * X[:, 2] + q["texts"] * X[:, 3] + q["least"] * X[:, 4] - q["short"] * X[:, 9]


def grid_fit(X, y, srv):
    import itertools
    best, bq = -1, None
    keys = list(GRID)
    for vals in itertools.product(*[GRID[k] for k in keys]):
        q = dict(zip(keys, vals))
        c = curve(list(zip(scaled(X, q).tolist(), [bool(v) for v in y], srv)), False)
        if c["right"] > best:
            best, bq = c["right"], q
    return bq


def upper(k, n):
    """One-sided 95% upper bound on a rate of k in n (Clopper-Pearson), as v4-score.ts."""
    if n == 0:
        return 1.0
    def tail(p):
        s, t = 0.0, (1 - p) ** n
        for i in range(k + 1):
            s += t
            t = t * (n - i) / (i + 1) * (p / (1 - p)) if p < 1 else 0
        return s
    lo, hi = k / n, 1.0
    for _ in range(60):
        m = (lo + hi) / 2
        if tail(m) > 0.05:
            lo = m
        else:
            hi = m
    return hi


def curve(items, bound):
    """items: (score, ok, servable). The cut-off with the most right served where wrong is at most 1% of served."""
    xs = sorted([i for i in items if i[2]], key=lambda i: -i[0])
    best = {"cut": float("inf"), "served": 0, "right": 0, "wrong": 0}
    r = w = 0
    for k, (s, ok, _) in enumerate(xs):
        r += ok
        w += not ok
        if k + 1 < len(xs) and xs[k + 1][0] == s:
            continue
        n = r + w
        okrate = upper(w, n) <= 0.01 if bound else w <= 0.01 * n
        if okrate and r > best["right"]:
            best = {"cut": s, "served": n, "right": r, "wrong": w}
    best["right_served_share"] = round(best["right"] / max(1, len(items)), 4)
    return best


def at_cut(items, cut):
    served = [i for i in items if i[2] and i[0] >= cut]
    r = sum(1 for i in served if i[1])
    return {"cut": cut, "served": len(served), "right": r, "wrong": len(served) - r, "right_served_share": round(r / max(1, len(items)), 4), "wrong_of_served": round((len(served) - r) / max(1, len(served)), 4)}


def group_of(row):
    i = row["id"]
    parts = i.split("/")
    return "/".join(parts[:2]) if len(parts) > 2 else parts[0]


def by_writer(rows, answers, scores, cut):
    out = {}
    for w in sorted({a.get("writer", "?") for a in answers}):
        ix = [k for k, a in enumerate(answers) if a.get("writer", "?") == w]
        served = [k for k in ix if servable(answers[k]) and scores[k] >= cut]
        out[w] = {"n": len(ix), "right": sum(answers[k]["ok"] for k in ix), "right_served": sum(answers[k]["ok"] for k in served),
                  "wrong_served": sum(not answers[k]["ok"] for k in served), "asked_back": len(ix) - len(served)}
        out[w]["right_served_share"] = round(out[w]["right_served"] / max(1, len(ix)), 4)
    shares = [v["right_served_share"] for v in out.values() if v["n"] >= 20]
    return out, (round(100 * (max(shares) - min(shares)), 1) if len(shares) > 1 else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", required=True)
    ap.add_argument("--answers", required=True)
    ap.add_argument("--second")
    ap.add_argument("--out", required=True)
    ap.add_argument("--fit-out")
    ap.add_argument("--apply")
    ap.add_argument("--answers-out")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--l2", type=float, default=1.0)
    ap.add_argument("--kinds", action="store_true", help="a weight, a temperature and a short-copy weight for each kind of answer")
    ap.add_argument("--method", choices=["logistic", "scaling"], default="scaling")
    a = ap.parse_args()
    global KINDS_ON
    KINDS_ON = a.kinds
    rows = {r["id"]: r for r in jsonl(a.rows)}
    answers = [x for x in jsonl(a.answers) if x["id"] in rows]
    second = {x["id"]: x for x in jsonl(a.second)} if a.second else None
    X = np.array([features(rows[x["id"]], x, second.get(x["id"], {}) if second is not None else None) for x in answers])
    y = np.array([1.0 if x["ok"] else 0.0 for x in answers])
    srv = [servable(x) for x in answers]
    raw = [x["sure"] for x in answers]
    names = NAMES + (["second_agrees"] if second is not None else []) + ([f"{k}{x}" for k in KINDS for x in ("", "*log_sure", "*short_copy")] if KINDS_ON else [])
    report = {"rows": len(answers), "right": int(y.sum()), "features": names}
    report["raw"] = {"at_1pct": curve(list(zip(raw, [bool(v) for v in y], srv)), False), "at_1pct_bound95": curve(list(zip(raw, [bool(v) for v in y], srv)), True)}
    if a.apply:
        m = json.load(open(a.apply))
        if m.get("kinds") and not KINDS_ON:
            raise SystemExit("these weights were fitted with --kinds")
        s = scaled(X, m["scaling"]) if m.get("method") == "scaling" else predict(m, X)
        items = list(zip(s.tolist(), [bool(v) for v in y], srv))
        report["applied"] = {"weights": a.apply, "at_fitted_cut": at_cut(items, m["cut"]), "at_fitted_cut_bound": at_cut(items, m["cut_bound"]) if m.get("cut_bound") not in (None, float("inf")) else None,
                             "own_best_at_1pct": curve(items, False), "own_best_bound95": curve(items, True)}
        report["applied"]["by_writer"], report["applied"]["parity_spread_points"] = by_writer(rows, answers, s.tolist(), m["cut"])
        report["raw"]["by_writer"], report["raw"]["parity_spread_points"] = by_writer(rows, answers, raw, report["raw"]["at_1pct"]["cut"])
    else:
        groups = [group_of(rows[x["id"]]) for x in answers]
        fold = np.array([zlib.crc32(g.encode()) % a.folds for g in groups])
        s = np.zeros(len(answers))
        srv_a = np.array(srv)
        for k in range(a.folds):
            if a.method == "scaling":
                q = grid_fit(X[fold != k], y[fold != k], srv_a[fold != k].tolist())
                s[fold == k] = scaled(X[fold == k], q)
            else:
                m = fit(X[fold != k], y[fold != k], a.l2)
                s[fold == k] = predict(m, X[fold == k])
        items = list(zip(s.tolist(), [bool(v) for v in y], srv))
        cal = {"at_1pct": curve(items, False), "at_1pct_bound95": curve(items, True)}
        cal["by_writer"], cal["parity_spread_points"] = by_writer(rows, answers, s.tolist(), cal["at_1pct"]["cut"])
        report["calibrated_crossfit"] = cal
        if a.method == "scaling":
            full = {"method": "scaling", "scaling": grid_fit(X, y, srv)}
            sf = scaled(X, full["scaling"])
        else:
            full = fit(X, y, a.l2)
            sf = predict(full, X)
        itf = list(zip(sf.tolist(), [bool(v) for v in y], srv))
        full["cut"] = curve(itf, False)["cut"]
        full["cut_bound"] = curve(itf, True)["cut"]
        full["features"] = names
        full["kinds"] = KINDS_ON
        report["fitted_on_all"] = {"weights": full["scaling"] if a.method == "scaling" else dict(zip(["intercept"] + names, [round(v, 3) for v in full["w"]])), "cut": full["cut"], "cut_bound": full["cut_bound"]}
        report["method"] = a.method
        if a.fit_out:
            json.dump(full, open(a.fit_out, "w"), indent=1)
    if a.answers_out:
        with open(a.answers_out, "w") as f:
            for x, v in zip(answers, s.tolist()):
                f.write(json.dumps({**x, "calibrated": v}) + "\n")
    json.dump(report, open(a.out, "w"), indent=1)
    print(json.dumps({k: v for k, v in report.items() if k not in ("features",)}, indent=1)[:4000])


if __name__ == "__main__":
    main()
