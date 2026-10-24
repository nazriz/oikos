"""Train the translator model on exported examples (translator/model/export.ts): from nothing, or (--encoder NAME)
with a small pretrained encoder as its reader, fine-tuned at a lower rate than the layers that are new.

  uv run python train.py <DATA> <OUT> [--epochs N] [--width N] [--seed N]
  uv run python train.py <DATA> <OUT> --encoder microsoft/deberta-v3-xsmall [--encoder-lr R] [--max-tokens N]

Writes <OUT>/model.safetensors, config.json and report.json (each epoch's loss and how many validation programs come
out exactly right, step for step).
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

import torch
from safetensors.torch import save_file

from model import Config, POINTERS, Translator, features
from limits import reader_pieces
from slots import Follow, Masks, slot_names
from tokens import spans, text_of, to_pieces, tokenize


def load(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def token_item(row: dict, model: Translator, tokenizer) -> dict | str:
    """An example for the pretrained reader: its tokens, and each span as its first and last token. Or why not:
    "long" (more tokens than the reader takes: such an input is asked back, never cut) or "inexact" (a span that
    isn't exactly a run of tokens)."""
    text = text_of(row["pieces"], row["at"], row["breaks"])
    t = tokenize(tokenizer, text, model.cfg.max_lines)
    if len(t.ids) > model.cfg.max_tokens:
        return "long"
    at = spans(t, row["at"], row["steps"])
    if at is None:
        return "inexact"
    index = {c: i for i, c in enumerate(model.choices)}
    choice = [index[s] if isinstance(s, str) else model.first_pointer + POINTERS.index(s[0]) for s in row["steps"]]
    item = {"row": row, "f": t.features(), "choice": choice, "start": [a for a, _ in at], "end": [z for _, z in at], "cfg": model.cfg, "tokens": t, "model": model, "tokenizer": tokenizer}
    if model.cfg.decoding in ("slots", "cards"):
        cols = slot_columns(row, model, t, text, choice)
        if isinstance(cols, str):
            return cols
        item.update(cols, text=text)
    return item


def slot_columns(row: dict, model: Translator, t, text: str, choice: list[int]) -> dict | str:
    """Slot by slot: for each decision of the label, which slot it is for, where a field's name stands, and what
    is allowed there (slots.py, following the label). Or why not: "misfit" (the label is not the decisions the rule
    lists for it: the two languages' rules differ, or the input was changed so that they no longer fit) or "inexact"
    (a field's name that isn't exactly a run of tokens). `off_rule`: the label makes a decision the rule would not
    allow an answer (none does in the data so far); the example is kept, and its label is always in the running."""
    follow = Follow(model.cfg.grammar, model.cfg.slots, model.masks, text, t, exact=True, mode=row.get("mode", "full"))
    slot, a, z, named, mask, off = [], [], [], [], [], False
    try:
        for s, c in zip(row["steps"], choice):
            now = follow.now
            if now is None:
                return "misfit"
            slot.append(now[0]); mask.append(now[2])
            a.append(now[1][0] if now[1] else 0); z.append(now[1][1] if now[1] else 0); named.append(1.0 if now[1] else 0.0)
            off = off or not bool(model.masks.rows[now[2]][c])
            if isinstance(s, str):
                follow.take_chars(s)
            else:
                follow.take_chars(s, row["at"][s[1]][0], row["at"][s[2]][1])
        if follow.now is not None:
            return "misfit"
    except Follow.Inexact:
        return "inexact"
    except (KeyError, ValueError, IndexError, TypeError):
        return "misfit"
    return {"slot": slot, "slot_start": a, "slot_end": z, "slot_named": named, "mask": mask, "off_rule": off}


def prepare(rows: list[dict], model: Translator, tokenizer=None, left_out: dict | None = None) -> list[dict]:
    index = {c: i for i, c in enumerate(model.choices)}
    out = []
    if tokenizer is not None:
        for r in rows:
            # (`old`: how many steps the example is in the other decoding, where the export says. With --old-steps-most
            # an example that a model of that decoding leaves out as too long is left out here too: the same examples.)
            fits = len(r["steps"]) <= model.cfg.max_steps and not (OLD_MOST and r.get("old", 0) > OLD_MOST)
            i = token_item(r, model, tokenizer) if fits else "long"
            if isinstance(i, str):
                if left_out is not None:
                    left_out[i] = left_out.get(i, 0) + 1
            else:
                if left_out is not None and i.get("off_rule"):
                    left_out["kept_though_label_off_rule"] = left_out.get("kept_though_label_off_rule", 0) + 1
                out.append(i)
        return out
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


class Line(list):
    """A form's line as its pieces, and where each stands counted from the line's first character."""
    at: list[list[int]]


def form_lines(rows: list[dict]) -> list[Line]:
    """Every form shown in these rows, each as its line's pieces, once. (Two passes: only the choose pass's rows are
    shown other forms, so only their lines are drawn on: a fill pass is shown the one form it fills.)"""
    seen: dict[str, Line] = {}
    for r in rows:
        if r.get("mode") == "fill":
            continue
        cuts = r["breaks"] + [len(r["pieces"])]
        for a, b in zip(cuts, cuts[1:]):
            line = Line(r["pieces"][a:b])
            line.at = [[x - r["at"][a][0], y - r["at"][a][0]] for x, y in r["at"][a:b]] if "at" in r else []
            seen.setdefault(" ".join(line), line)
    return list(seen.values())


_JOINS = {"-", "/", "_"}
# The most forms added beside an example (`--forms-most`; 5 unless given: what every model so far was trained with).
# A seat of the towns since 2026-10-09 knows of 13 to 18 forms, an office's own stationery among them.
FORMS_MOST = 5
# With slot-by-slot data: leave out the examples longer than this in the other decoding (0: none on that account).
OLD_MOST = 0


def office_of(line: list[str]) -> list[str]:
    """The office a form's line says it goes to (`to=...`), as pieces."""
    for i in range(len(line) - 2):
        if line[i] == "to" and line[i + 1] == "=":
            j = i + 2
            while j < len(line) and line[j] != ",":
                j += 1
            return list(line[i + 2:j])
    return []


def names_office(pieces: list[str], request: int, office: list[str]) -> bool:
    """Whether the request (the first `request` pieces) names this office by its id, whole: not as part of a longer
    id (acc-works, works-crew, works.3)."""
    k = len(office)
    if not k:
        return False
    joined = lambda i: 0 <= i < request and (pieces[i] in _JOINS or (pieces[i] == "." and i + 1 < request and any(c.isdigit() for c in pieces[i + 1])))
    for i in range(request - k + 1):
        if pieces[i:i + k] == office and not joined(i - 1) and not (i > 0 and pieces[i - 1] == "." and any(c.isdigit() for c in pieces[i])) and not joined(i + k):
            return True
    return False


def with_forms(row: dict, pool: list[list[str]], rand: random.Random) -> dict:
    """The same example as someone who knows of forms would ask it: a few forms it has nothing to do with are shown
    after what it was shown. A seat always knows of some forms, whatever it asks for, so a model that has only seen
    forms beside requests to fill one in fills one in whenever it sees any. Appended lines move nothing the steps
    point at. A request for a form nobody knows of is left as it is (another form might be the one it names).
    A form that goes to an office the request names is not one it has nothing to do with (since 2026-10-09 an office
    may have a form of its own for being directed, and a direction to it is then that form filled in, not a letter:
    the letter shown beside that form would be taught wrong), so such a form is never one of those added."""
    if not pool or row["steps"][0] == "none:unknown_form" or row.get("mode") == "fill":
        return row
    pieces, breaks = list(row["pieces"]), list(row["breaks"])
    at = list(row["at"]) if "at" in row else None
    request = breaks[0] if breaks else len(pieces)
    for line in rand.sample(pool, k=min(len(pool), rand.randint(1, FORMS_MOST))):
        if names_office(pieces, request, office_of(line)):
            continue
        breaks.append(len(pieces)); pieces.extend(line)
        if at is not None and line.at:
            # On a line of its own after what was shown, spaced as it was where it was seen.
            begin = (at[-1][1] if at else 0) + 1
            at.extend([begin + x, begin + y] for x, y in line.at)
    return dict(row, pieces=pieces, breaks=breaks) if at is None else dict(row, pieces=pieces, breaks=breaks, at=at)


def chunks(items: list[dict], budget: int) -> list[list[dict]]:
    """A batch of the pretrained reader's examples as parts, each no more than `budget` tokens once padded to its
    longest (attention's cost is the square of the length: 48 inputs of a thousand tokens don't fit a machine that
    takes 48 of two hundred with ease). Longest first; a part always has at least one example."""
    items = sorted(items, key=lambda i: -i["f"]["tokens"].shape[0])
    out, k = [], 0
    while k < len(items):
        n = max(1, budget // items[k]["f"]["tokens"].shape[0])
        out.append(items[k:k + n]); k += n
    return out


def collate(items: list[dict], device: torch.device, renumber: float = 0.0, forms: tuple[float, list] = (0.0, [])) -> dict[str, torch.Tensor]:
    return together(changed(items, renumber, forms), device)


def changed(items: list[dict], renumber: float, forms: tuple[float, list]) -> list[dict]:
    """Each example as it is seen this time: now and then with other digits, or with other forms known."""
    if renumber > 0 or forms[0] > 0:
        new = []
        for i in items:
            row, changed = i["row"], False
            if forms[0] > 0 and random.random() < forms[0]:
                row, changed = with_forms(row, forms[1], random), True
            ps = row["pieces"]
            if renumber > 0 and random.random() < renumber:
                ps, changed = renumbered(ps), True
            if changed and "tokens" in i:
                # Read again as tokens: other digits and more lines are other tokens, and the spans move with them.
                # Where the changed example is too long or a span no longer falls on tokens, it stays as it was.
                again = token_item(dict(row, pieces=ps), i["model"], i["tokenizer"])
                i = i if isinstance(again, str) else again
            elif changed and len(ps) <= i["cfg"].max_pieces:
                i = dict(i, f=features(ps, row["breaks"], i["cfg"]))
            new.append(i)
        items = new
    return items


def together(items: list[dict], device: torch.device) -> dict[str, torch.Tensor]:
    if "tokens" in items[0]:
        n, t, b = max(i["f"]["tokens"].shape[0] for i in items), max(len(i["choice"]) for i in items), len(items)
        batch = {"tokens": torch.zeros(b, n, dtype=torch.long), "line": torch.zeros(b, n, dtype=torch.long), "pad": torch.ones(b, n, dtype=torch.bool),
                 "choice": torch.full((b, t), -100, dtype=torch.long), "start": torch.zeros(b, t, dtype=torch.long), "end": torch.zeros(b, t, dtype=torch.long)}
        for k, i in enumerate(items):
            m, s = i["f"]["tokens"].shape[0], len(i["choice"])
            batch["tokens"][k, :m] = i["f"]["tokens"]; batch["line"][k, :m] = i["f"]["line"]; batch["pad"][k, :m] = False
            batch["choice"][k, :s] = torch.tensor(i["choice"]); batch["start"][k, :s] = torch.tensor(i["start"]); batch["end"][k, :s] = torch.tensor(i["end"])
        if "slot" in items[0]:
            # Slot by slot: which slot each decision is for, where a field's name stands, and what is allowed there
            # (everything where there is no decision; the label always).
            table = items[0]["model"].masks.table()
            batch.update({"slot": torch.zeros(b, t, dtype=torch.long), "slot_start": torch.zeros(b, t, dtype=torch.long), "slot_end": torch.zeros(b, t, dtype=torch.long),
                          "slot_named": torch.zeros(b, t), "allowed": torch.ones(b, t, table.shape[1], dtype=torch.bool)})
            for k, i in enumerate(items):
                s = len(i["choice"])
                batch["slot"][k, :s] = torch.tensor(i["slot"]); batch["slot_start"][k, :s] = torch.tensor(i["slot_start"]); batch["slot_end"][k, :s] = torch.tensor(i["slot_end"])
                batch["slot_named"][k, :s] = torch.tensor(i["slot_named"])
                batch["allowed"][k, :s] = table[torch.tensor(i["mask"])]
                batch["allowed"][k, torch.arange(s), torch.tensor(i["choice"])] = True
        return {k: v.to(device) for k, v in batch.items()}
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
    by_mode: dict = {}
    results = []
    for i in items:
        if "slot" in i:
            steps, sure, _ = model.translate_slots(single(i["f"], device), Follow(model.cfg.grammar, model.cfg.slots, model.masks, i["text"], i["tokens"], mode=i["row"].get("mode", "full")))
            steps = steps or []
        else:
            steps, sure, _ = model.translate(single(i["f"], device))
        if "tokens" in i:
            steps = to_pieces(i["tokens"], i["row"]["at"], steps)
        ok = steps == i["row"]["steps"]
        kind = i["row"]["kind"]
        total[kind] += 1; right[kind] += ok
        mode = i["row"].get("mode")
        if mode:
            by_mode.setdefault(mode, [0, 0]); by_mode[mode][0] += ok; by_mode[mode][1] += 1
        results.append({"id": i["row"]["id"], "right": ok, "sure": sure, "steps": steps, **({"mode": mode} if mode else {})})
    return {"right": sum(right.values()), "of": len(items), "by_kind": {k: [right[k], total[k]] for k in total}, **({"by_mode": by_mode} if by_mode else {}), "results": results}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("data"); ap.add_argument("out")
    ap.add_argument("--epochs", type=int, default=40); ap.add_argument("--width", type=int, default=None)
    ap.add_argument("--encoder", default=""); ap.add_argument("--encoder-lr", type=float, default=5e-5); ap.add_argument("--max-tokens", type=int, default=None)
    ap.add_argument("--validate-every", type=int, default=5); ap.add_argument("--token-budget", type=int, default=12288)
    ap.add_argument("--batch", type=int, default=48); ap.add_argument("--lr", type=float, default=6e-4)
    ap.add_argument("--renumber", type=float, default=0.0); ap.add_argument("--forms", type=float, default=0.0); ap.add_argument("--dropout", type=float, default=0.1); ap.add_argument("--piece-dropout", type=float, default=0.0)
    ap.add_argument("--forms-most", type=int, default=5)
    # The most pieces of an input a row may have (the reader length switch: 1024 or 2048; model.py's 640 where not given).
    # With an encoder this is what keeps a long input a training example: a row of more pieces is left out, as is a
    # row of more tokens than --max-tokens. Raise both together (docs/design/translator-round-3.md, section 4).
    ap.add_argument("--max-pieces", type=int, default=None)
    ap.add_argument("--max-steps", type=int, default=None); ap.add_argument("--old-steps-most", type=int, default=0)
    ap.add_argument("--resume", action="store_true"); ap.add_argument("--stop-after", type=int, default=0)
    ap.add_argument("--seed", type=int, default=1); ap.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    a = ap.parse_args()
    global FORMS_MOST, OLD_MOST
    FORMS_MOST = max(1, a.forms_most)
    OLD_MOST = a.old_steps_most
    torch.manual_seed(a.seed); random.seed(a.seed)
    data, out = Path(a.data), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    vocabulary = json.loads((data / "vocabulary.json").read_text())
    # How the data's steps were written (export.json): as steps, or slot by slot, with the contract's slots.
    export = json.loads((data / "export.json").read_text()) if (data / "export.json").exists() else {}
    how = {"decoding": export["decoding"], "grammar": export["grammar"], "slots": slot_names(export["grammar"])} if export.get("decoding") in ("slots", "cards") else {}
    if a.max_steps:
        how["max_steps"] = a.max_steps
    if a.max_pieces:
        how["max_pieces"] = reader_pieces(a.max_pieces)
    if how.get("decoding") in ("slots", "cards") and not a.encoder:
        sys.exit("slot-by-slot data needs a reader with tokens (--encoder)")
    device = torch.device(a.device)
    tokenizer, left_out = None, {"train": {}, "validation": {}, "validation_forms_known": {}}
    if a.encoder:
        from transformers import AutoConfig, AutoTokenizer
        made = AutoConfig.from_pretrained(a.encoder)
        tokenizer = AutoTokenizer.from_pretrained(a.encoder)
        width = a.width or made.hidden_size
        # An encoder that knows a token's place only by how far it is from another reads past the length it was
        # trained at; one that counts places from the start can't.
        relative = bool(getattr(made, "relative_attention", False)) and not getattr(made, "position_biased_input", True)
        limit = a.max_tokens or (1024 if relative else min(512, getattr(made, "max_position_embeddings", 512)))
        cfg = Config(vocabulary=vocabulary, width=width, heads=max(h for h in (1, 4, 6, 8) if width % h == 0), feed=width * 8 // 3, dropout=a.dropout, encoder=a.encoder, max_tokens=limit, **how)
        model = Translator(cfg, pretrained=True).to(device)
        model.masks = Masks(model.choices)
    else:
        width = a.width or 192
        cfg = Config(vocabulary=vocabulary, width=width, feed=width * 8 // 3, dropout=a.dropout, piece_dropout=a.piece_dropout, **how)
        model = Translator(cfg).to(device)
    train_rows, val_rows = load(data / "train.jsonl"), load(data / "validation.jsonl")
    pool = form_lines(train_rows)
    train = prepare(train_rows, model, tokenizer, left_out["train"])
    val = prepare(val_rows, model, tokenizer, left_out["validation"])
    # Validation twice: as exported, and as a seat would ask (other forms known too: validation's own, never training's).
    fixed = random.Random(7)
    val_pool = form_lines(val_rows)
    val_known = prepare([with_forms(r, val_pool, fixed) for r in val_rows], model, tokenizer, left_out["validation_forms_known"])
    # A second validation set where the data has one (validation-real.jsonl: requests written in real situations and
    # kept out of training): the first is all generated requests, and has risen while the tests fell.
    real = prepare(load(data / "validation-real.jsonl"), model, tokenizer, {}) if (data / "validation-real.jsonl").exists() else None
    params = sum(p.numel() for p in model.parameters())
    print(f"{params / 1e6:.2f}M parameters; {len(train)} training and {len(val)} validation examples; {device}", flush=True)
    steps_total = a.epochs * ((len(train) + a.batch - 1) // a.batch)
    if a.encoder:
        old = [p for n, p in model.named_parameters() if n.startswith("encoder.")]
        new = [p for n, p in model.named_parameters() if not n.startswith("encoder.")]
        print(f"the encoder {sum(p.numel() for p in old) / 1e6:.2f}M at {a.encoder_lr}, the new layers {sum(p.numel() for p in new) / 1e6:.2f}M at {a.lr}; at most {cfg.max_tokens} tokens; left out {left_out}", flush=True)
        opt = torch.optim.AdamW([{"params": old, "lr": a.encoder_lr}, {"params": new, "lr": a.lr}], weight_decay=0.01)
        sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=[a.encoder_lr, a.lr], total_steps=steps_total, pct_start=0.06)
        # What answering needs of the encoder besides its weights: its make and its tokenizer, beside the model.
        made.save_pretrained(str(out / "encoder")); tokenizer.save_pretrained(str(out / "encoder"))
    else:
        opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=0.01)
        sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=steps_total, pct_start=0.06)
    report = {"parameters": params, "config": {k: v for k, v in cfg.to_json().items() if k != "vocabulary"}, "seed": a.seed, "renumber": a.renumber, "forms": a.forms, "forms_most": FORMS_MOST, "old_steps_most": OLD_MOST, "epochs": []}
    if a.encoder:
        report.update({"encoder_lr": a.encoder_lr, "lr": a.lr, "left_out": left_out})
    best, first = -1, 1
    # A run that was cut short (the machine's memory, a restart) goes on from its last whole epoch: the weights, the
    # optimiser, the schedule and the draws (all but the graphics device's own, so the losses after differ a little).
    kept = out / "checkpoint.pt"
    if a.resume and kept.exists():
        c = torch.load(str(kept), map_location=device, weights_only=False)
        model.load_state_dict(c["model"]); opt.load_state_dict(c["opt"]); sched.load_state_dict(c["sched"])
        random.setstate(c["random"]); torch.set_rng_state(c["torch"].cpu())
        best, first, report["epochs"] = c["best"], c["epoch"] + 1, c["epochs"]
        print(f"resumed after epoch {c['epoch']}", flush=True)
    for epoch in range(first, a.epochs + 1):
        model.train()
        t0 = time.time()
        order = sorted(range(len(train)), key=lambda k: (len(train[k]["row"]["pieces"]) // 16, random.random()))
        batches = [order[k:k + a.batch] for k in range(0, len(order), a.batch)]
        random.shuffle(batches)
        seen, running = 0, 0.0
        for at, b in enumerate(batches):
            if a.encoder:
                # One step of a batch taken in parts that fit: each part's loss counts by its share of the batch's
                # steps, which is the batch's loss exactly.
                items = changed([train[k] for k in b], a.renumber, (a.forms, pool))
                steps = sum(len(i["choice"]) for i in items)
                opt.zero_grad(); loss = 0.0
                for part in chunks(items, a.token_budget):
                    l = model.loss(together(part, device)) * (sum(len(i["choice"]) for i in part) / steps)
                    l.backward(); loss += float(l.detach())
                if at % 50 == 0:
                    print(f"epoch {epoch}: batch {at} of {len(batches)}, {time.time() - t0:.0f}s", file=sys.stderr, flush=True)
            else:
                loss = model.loss(collate([train[k] for k in b], device, a.renumber, (a.forms, pool)))
                opt.zero_grad(); loss.backward()
                loss = float(loss.detach())
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step()
            running += loss * len(b); seen += len(b)
            # Batches of many shapes leave the graphics memory holding what it no longer needs, until it is full.
            if device.type == "mps" and at % 25 == 24:
                torch.mps.empty_cache()
        line = {"epoch": epoch, "loss": round(running / seen, 4), "seconds": round(time.time() - t0, 1)}
        if epoch % a.validate_every == 0 or epoch == a.epochs:
            s = score(model, val, device)
            k = score(model, val_known, device)
            line.update({"validation_right": s["right"], "of": s["of"], "by_kind": s["by_kind"], "with_forms_known": k["right"], **({"by_mode": s["by_mode"]} if "by_mode" in s else {})})
            if real is not None:
                r = score(model, real, device)
                line.update({"real_right": r["right"], "real_of": r["of"], "real_by_kind": r["by_kind"]})
                (out / "validation-real.jsonl").write_text("\n".join(json.dumps(x) for x in r["results"]) + "\n")
            if s["right"] + k["right"] > best:
                best = s["right"] + k["right"]
                (out / "validation-forms-known.jsonl").write_text("\n".join(json.dumps(r) for r in k["results"]) + "\n")
                save_file({k: v.detach().cpu() for k, v in model.state_dict().items()}, str(out / "model.safetensors"))
                (out / "config.json").write_text(json.dumps(cfg.to_json()))
                (out / "validation.jsonl").write_text("\n".join(json.dumps(r) for r in s["results"]) + "\n")
        report["epochs"].append(line)
        print(json.dumps(line), flush=True)
        torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(), "random": random.getstate(), "torch": torch.get_rng_state(), "best": best, "epoch": epoch, "epochs": report["epochs"]}, str(kept) + ".part")
        (Path(str(kept) + ".part")).replace(kept)
        if epoch == a.stop_after:
            return
    report["best_validation_right"] = best
    (out / "report.json").write_text(json.dumps(report, indent=1))
    kept.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
