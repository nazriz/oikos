"""Train the translator model from nothing on exported examples (translator/model/export.ts).

  uv run python train.py <DATA> <OUT> [--epochs N] [--width N] [--seed N]

Writes <OUT>/model.safetensors, config.json and report.json (each epoch's loss and how many validation programs come
out exactly right, step for step).
"""
from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import torch
from safetensors.torch import save_file

from model import Config, POINTERS, Translator, features


def load(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def prepare(rows: list[dict], model: Translator) -> list[dict]:
    index = {c: i for i, c in enumerate(model.choices)}
    out = []
    for r in rows:
        if len(r["pieces"]) > model.cfg.max_pieces or len(r["steps"]) > model.cfg.max_steps:
            continue
        choice, start, end = [], [], []
        for s in r["steps"]:
            if isinstance(s, str):
                choice.append(index[s]); start.append(0); end.append(0)
            else:
                choice.append(model.first_pointer + POINTERS.index(s[0])); start.append(s[1]); end.append(s[2])
        f = features(r["pieces"], r["breaks"], model.cfg)
        out.append({"row": r, "f": f, "choice": choice, "start": start, "end": end, "cfg": model.cfg})
    return out


def renumbered(pieces: list[str]) -> list[str]:
    """The same request with other numbers: every piece that has a digit gets other digits, the same piece the same
    ones throughout. The steps still hold (they point at places, not at characters), so this is a new example for
    nothing: the model can't learn an id or an amount by heart, only where such a thing stands."""
    new: dict[str, str] = {}
    out = []
    for p in pieces:
        if any(c.isdigit() for c in p):
            if p not in new:
                new[p] = "".join(random.choice("0123456789") if c.isdigit() else c for c in p)
            out.append(new[p])
        else:
            out.append(p)
    return out


def form_lines(rows: list[dict]) -> list[list[str]]:
    """Every form shown in these rows, each as its line's pieces, once."""
    seen: dict[str, list[str]] = {}
    for r in rows:
        cuts = r["breaks"] + [len(r["pieces"])]
        for a, b in zip(cuts, cuts[1:]):
            line = r["pieces"][a:b]
            seen.setdefault(" ".join(line), line)
    return list(seen.values())


def with_forms(row: dict, pool: list[list[str]], rand: random.Random) -> dict:
    """The same example as someone who knows of forms would ask it: a few forms it has nothing to do with are shown
    after what it was shown. A seat always knows of some forms, whatever it asks for, so a model that has only seen
    forms beside requests to fill one in fills one in whenever it sees any. Appended lines move nothing the steps
    point at. A request for a form nobody knows of is left as it is (another form might be the one it names)."""
    if not pool or row["steps"][0] == "none:unknown_form":
        return row
    pieces, breaks = list(row["pieces"]), list(row["breaks"])
    for line in rand.sample(pool, k=min(len(pool), rand.randint(1, 5))):
        breaks.append(len(pieces)); pieces.extend(line)
    return dict(row, pieces=pieces, breaks=breaks)


def collate(items: list[dict], device: torch.device, renumber: float = 0.0, forms: tuple[float, list] = (0.0, [])) -> dict[str, torch.Tensor]:
    if renumber > 0 or forms[0] > 0:
        new = []
        for i in items:
            row, changed = i["row"], False
            if forms[0] > 0 and random.random() < forms[0]:
                row, changed = with_forms(row, forms[1], random), True
            ps = row["pieces"]
            if renumber > 0 and random.random() < renumber:
                ps, changed = renumbered(ps), True
            if changed and len(ps) <= i["cfg"].max_pieces:
                i = dict(i, f=features(ps, row["breaks"], i["cfg"]))
            new.append(i)
        items = new
    n = max(i["f"]["shape"].shape[0] for i in items)
    t = max(len(i["choice"]) for i in items)
    b = len(items)
    batch = {
        "word": torch.zeros(b, n, 2, dtype=torch.long), "grams": torch.zeros(b, n, 8, dtype=torch.long), "gram_mask": torch.zeros(b, n, 8),
        "shape": torch.zeros(b, n, dtype=torch.long), "line": torch.zeros(b, n, dtype=torch.long), "pad": torch.ones(b, n, dtype=torch.bool),
        "choice": torch.full((b, t), -100, dtype=torch.long), "start": torch.zeros(b, t, dtype=torch.long), "end": torch.zeros(b, t, dtype=torch.long),
    }
    for k, i in enumerate(items):
        m = i["f"]["shape"].shape[0]
        for key in ("word", "grams", "gram_mask", "shape", "line"):
            batch[key][k, :m] = i["f"][key]
        batch["pad"][k, :m] = False
        s = len(i["choice"])
        batch["choice"][k, :s] = torch.tensor(i["choice"]); batch["start"][k, :s] = torch.tensor(i["start"]); batch["end"][k, :s] = torch.tensor(i["end"])
    return {k: v.to(device) for k, v in batch.items()}


def single(f: dict[str, torch.Tensor], device: torch.device) -> dict[str, torch.Tensor]:
    return {k: v.unsqueeze(0).to(device) for k, v in f.items()}


def score(model: Translator, items: list[dict], device: torch.device) -> dict:
    model.eval()
    right = {"positive": 0, "refusal": 0}
    total = {"positive": 0, "refusal": 0}
    results = []
    for i in items:
        steps, sure = model.translate(single(i["f"], device))
        ok = steps == i["row"]["steps"]
        kind = i["row"]["kind"]
        total[kind] += 1; right[kind] += ok
        results.append({"id": i["row"]["id"], "right": ok, "sure": sure, "steps": steps})
    return {"right": sum(right.values()), "of": len(items), "by_kind": {k: [right[k], total[k]] for k in total}, "results": results}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("data"); ap.add_argument("out")
    ap.add_argument("--epochs", type=int, default=40); ap.add_argument("--width", type=int, default=192)
    ap.add_argument("--batch", type=int, default=48); ap.add_argument("--lr", type=float, default=6e-4)
    ap.add_argument("--renumber", type=float, default=0.0); ap.add_argument("--forms", type=float, default=0.0); ap.add_argument("--dropout", type=float, default=0.1); ap.add_argument("--piece-dropout", type=float, default=0.0)
    ap.add_argument("--seed", type=int, default=1); ap.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    a = ap.parse_args()
    torch.manual_seed(a.seed); random.seed(a.seed)
    data, out = Path(a.data), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    cfg = Config(vocabulary=json.loads((data / "vocabulary.json").read_text()), width=a.width, feed=a.width * 8 // 3, dropout=a.dropout, piece_dropout=a.piece_dropout)
    device = torch.device(a.device)
    model = Translator(cfg).to(device)
    train_rows, val_rows = load(data / "train.jsonl"), load(data / "validation.jsonl")
    pool = form_lines(train_rows)
    train = prepare(train_rows, model)
    val = prepare(val_rows, model)
    # Validation twice: as exported, and as a seat would ask (other forms known too: validation's own, never training's).
    fixed = random.Random(7)
    val_pool = form_lines(val_rows)
    val_known = prepare([with_forms(r, val_pool, fixed) for r in val_rows], model)
    params = sum(p.numel() for p in model.parameters())
    print(f"{params / 1e6:.2f}M parameters; {len(train)} training and {len(val)} validation examples; {device}", flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=0.01)
    steps_total = a.epochs * ((len(train) + a.batch - 1) // a.batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=steps_total, pct_start=0.06)
    report = {"parameters": params, "config": {k: v for k, v in cfg.to_json().items() if k != "vocabulary"}, "seed": a.seed, "renumber": a.renumber, "forms": a.forms, "epochs": []}
    best = -1
    for epoch in range(1, a.epochs + 1):
        model.train()
        t0 = time.time()
        order = sorted(range(len(train)), key=lambda k: (len(train[k]["row"]["pieces"]) // 16, random.random()))
        batches = [order[k:k + a.batch] for k in range(0, len(order), a.batch)]
        random.shuffle(batches)
        seen, running = 0, 0.0
        for b in batches:
            loss = model.loss(collate([train[k] for k in b], device, a.renumber, (a.forms, pool)))
            opt.zero_grad(); loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step()
            running += float(loss.detach()) * len(b); seen += len(b)
        line = {"epoch": epoch, "loss": round(running / seen, 4), "seconds": round(time.time() - t0, 1)}
        if epoch % 5 == 0 or epoch == a.epochs:
            s = score(model, val, device)
            k = score(model, val_known, device)
            line.update({"validation_right": s["right"], "of": s["of"], "by_kind": s["by_kind"], "with_forms_known": k["right"]})
            if s["right"] + k["right"] > best:
                best = s["right"] + k["right"]
                (out / "validation-forms-known.jsonl").write_text("\n".join(json.dumps(r) for r in k["results"]) + "\n")
                save_file({k: v.detach().cpu() for k, v in model.state_dict().items()}, str(out / "model.safetensors"))
                (out / "config.json").write_text(json.dumps(cfg.to_json()))
                (out / "validation.jsonl").write_text("\n".join(json.dumps(r) for r in s["results"]) + "\n")
        report["epochs"].append(line)
        print(json.dumps(line), flush=True)
    report["best_validation_right"] = best
    (out / "report.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
