"""Fair scoring: whether a model's decisions come to what the label's do, as the resolver would act on them.

Exact scoring (train.py `score`) counts an answer right only where every decision is the label's. Two kinds of
difference are not a difference in what is done, and the label itself is not consistent in them:

- **id or words for the same span.** A value copied as an id is passed on as written; the same span copied as words
  is read as a name among those the seat knows (kernel/crates/resolver `id_as`, `named`, `Knowledge::by_name`), and a
  name written as an id is found as that id. So `to=planning` and `to="planning"` are the same act wherever the
  argument is read as an id and the seat knows `planning`; where it does not, neither is carried out (physics refuses
  the one, the other is asked about). Where the argument is read as words (an amount, a length of time, a count, a
  date, a choice, a form's name: `str_`), the two are always the same. Where it is read only as a record's id (a
  payment's `per_request`), as data (`about`, `variables`, ...) or as an outcome (`we_do`), they differ.
  contracts/test/id-or-words.json holds the engine's resolver, this file and meaning.ts to each reading assumed here.
- **the edges of copied free text** (a letter's text, a statement's, a payment's purpose, a form's text field): the
  same text but for punctuation, or for at most `EDGE_WORDS` words around it that hold no figure or id. Three good
  readers give three extents of one letter (0.9.4's ruling A); a sentence more or less, or a figure, is a different
  letter and stays wrong.

Anything else that differs (another function, a form, a value, a span elsewhere, a decision more or less) is wrong.

  uv run python fair.py <validation.jsonl> <results.jsonl> [--grammar <model>/config.json] [--fixed <out.jsonl>]
  python3 fair.py --table contracts/test/id-or-words.json   (needs nothing but Python)

scores a model's per-row results (train.py's `results`, or wsp_eval.py's file) against the label fairly, and with
--fixed writes the label rows with the id-or-words decisions made one way (`canonical`).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from slots import Forms, Machine, as_word

EDGE_WORDS = 2
_TYPE = re.compile(r"([^\s,()]+) \(([^)]*)\)")

# How the resolver reads each argument of the call language (kernel/crates/resolver/src/resolve.rs). "words": as
# written (`str_`, amounts, lengths of time, counts, flags); "id": an id or a name the seat knows (`id`, `need`,
# `ids`, `basis`, `visible`); "free": copied free text (words, and its edges are a reader's); anything not listed is
# "strict" (a record's id only, data, an outcome): id and words differ there.
WORDS = {"amount", "price", "carrying", "every", "first", "until", "hours", "term", "our_notice", "their_notice", "age", "off",
         "quantity", "units", "leave", "carried", "choice", "template", "role", "title", "sex", "name", "rate", "meter", "op",
         "then", "formal", "form"}
IDS = {"to", "from", "at", "from_at", "basis", "visible", "holder", "against", "appoint", "transfer", "release", "retire",
       "remove", "vacate", "withdraw", "with", "notice", "sign", "settles", "line", "investigate", "survey", "taken_at", "on",
       "materials_at", "close", "in", "who", "ballot", "hold", "cells", "re", "task", "type", "for", "by", "kind",
       "position", "registry"}
FREE = {"text", "terms"}
# (Where one function reads an argument otherwise than the rest.)
BY_FN = {("money", "for"): "free", ("entity", "kind"): "words", ("statement", "kind"): "words", ("entity", "position"): "words",
         ("goods", "by"): "words", ("money", "per_request"): "strict"}
# A form's fields, by the type its line gives (resolve.rs `form`).
FIELD = {"amount": "words", "duration": "words", "count": "words", "date": "words", "choice": "words", "structure_type": "words",
         "text": "free", "list": "id", "space": "id"}


def reading(fn: str | None, arg: str | None, field_type: str | None = None) -> str:
    """How the resolver reads a value: "words", "id", "free" or "strict" (see above)."""
    if field_type is not None:
        return FIELD.get(field_type, "id")
    if (fn, arg) in BY_FN:
        return BY_FN[(fn, arg)]
    if arg in FREE:
        return "free"
    if arg in WORDS:
        return "words"
    if arg in IDS:
        return "id"
    return "strict"


def written_as_id(x: str) -> bool:
    """resolve.rs `written_as_id`: lowercase letters, digits and `_.:/-`."""
    return bool(x) and all(c.islower() and c.isascii() or c.isdigit() or c in "_.:/-" for c in x)


def as_found(x: str) -> str:
    """What a name comes to where the seat knows it as an id (Knowledge::by_name): as written, without `the`, without
    a closing word for a post (`job`, `post`, `position`, `office`)."""
    lower = x.strip().lower()
    bare = lower[4:].lstrip() if lower.startswith("the ") else lower
    for w in ("job", "post", "position", "office"):
        if bare.endswith(" " + w):
            post = bare[: -len(w)].rstrip()
            return post if written_as_id(post) else bare
    return bare


# Ids of things the seat knows by name (an organisation, a person, a post: `Knowledge::by_name` finds those, from its
# directory, its posts and the people its papers name) as against ids of things it never knows by a name: records,
# accounts, laws, forms, messages, places. A quoted `"rec.12"` is asked about where a bare `rec.12` is acted on.
_NOT_A_NAME = re.compile(r"^(rec|msg|str|cell|sp|draft)\.|^(acc|lot|law|form|house|apts|shop)-")


def named_thing(x: str) -> bool:
    return written_as_id(x) and not _NOT_A_NAME.search(x)


def text_of(pieces: list[str], at: list[list[int]], breaks: list[int]) -> str:
    """The input from its pieces (tokens.py `text_of`, kept here so that this file needs nothing but Python)."""
    buf = [" "] * (at[-1][1] if at else 0)
    for p, (a, b) in zip(pieces, at):
        buf[a:b] = p
    for b in breaks:
        if 0 < b < len(at) and at[b][0] > 0:
            buf[at[b][0] - 1] = "\n"
    return "".join(buf)


def value(kind: str, text: str, how: str):
    """A copied value as the resolver reads it, by its reading."""
    v = as_word(text) if kind == "word" else text
    if how == "words" or how == "free":
        return ("words", v)
    if how == "id":
        # (An id is written lowercase: one with a capital is a name, as if quoted. A name is found as the id of an
        # organisation, person or post the seat knows by it: the seat is taken to know those it writes. Never as a
        # record's, an account's or a place's id: those are not names.)
        if kind in ("id", "word") and written_as_id(v):
            return ("id", v)
        found = as_found(v)
        return ("id", found) if named_thing(found) else ("name", v.strip().lower())
    return (kind, v)


def field_types(line: str) -> dict[str, str]:
    f = line.find(": fields ")
    out: dict[str, str] = {}
    if f >= 0:
        for m in _TYPE.finditer(line[f + 9:]):
            t = m.group(2)
            out.setdefault(m.group(1), "choice" if t.startswith("one of ") else re.sub(r",\s*required$", "", t).strip())
    return out


class _Machine(Machine):
    """The rule's machine, also saying which function each decision is within."""

    def __init__(self, *a, **k):
        self.fns: list[str] = []
        super().__init__(*a, **k)

    def _call(self, fn: str):
        self.fns.append(fn)
        try:
            return (yield from super()._call(fn))
        finally:
            self.fns.pop()


def contexts(row: dict, grammar: dict) -> tuple[str, list[tuple]] | None:
    """The input's text and, for each of the label's decisions, (function, argument or field, field type or None, what
    is decided: `value` for the argument's own value, `item` or `data` within a list or data)."""
    text = text_of(row["pieces"], row["at"], row["breaks"])
    forms = Forms(text)
    m = _Machine(grammar, forms, row.get("mode", "full"), None)
    out = []
    line_types = {l["line"]: field_types(l["line"]) for l in forms.lines}
    try:
        for s in row["steps"]:
            if m.state is None:
                return None
            slot, at, key = m.state
            if slot == "field":
                name = text[at[0]:at[1]]
                line = next((l["line"] for l in forms.lines if any(f[2] == at[0] for f in l["fields"])), "")
                out.append(("form", name, line_types.get(line, {}).get(name, "text"), key[0]))
            else:
                out.append((m.fns[-1] if m.fns else None, slot[4:] if slot.startswith("arg:") else slot, None, key[0]))
            m.take(s, None if isinstance(s, str) else text[row["at"][s[1]][0]:row["at"][s[2]][1]])
    except (KeyError, ValueError, IndexError, TypeError):
        return None
    return text, out


def _piece_words(pieces: list[str]) -> list[str]:
    return [p for p in pieces if any(c.isalnum() for c in p)]


def edges_only(row: dict, a: list, b: list) -> bool:
    """Two copied texts that are one text but for punctuation, or for at most EDGE_WORDS words around it holding no
    figure (an id's pieces have digits)."""
    x, y = set(range(a[1], a[2] + 1)), set(range(b[1], b[2] + 1))
    if not (x <= y or y <= x):
        return False
    extra = [row["pieces"][i] for i in sorted(x ^ y)]
    words = _piece_words(extra)
    return len(words) <= EDGE_WORDS and not any(any(c.isdigit() for c in w) for w in words)


def compare(row: dict, got: list, grammar: dict) -> tuple[bool, str]:
    """Whether the decisions `got` come to the label's as the resolver acts on them, and why not (or how)."""
    want = row["steps"]
    if got == want:
        return True, "exact"
    if len(got) != len(want):
        return False, "decisions"
    ctx = contexts(row, grammar)
    if ctx is None:
        return False, "label_misfit"
    text, cs = ctx
    how = set()
    for x, y, (fn, arg, ftype, _) in zip(got, want, cs):
        if x == y:
            continue
        if not (isinstance(x, list) and isinstance(y, list)):
            return False, "choice"
        r = reading(fn, arg, ftype)
        tx, ty = (text[row["at"][s[1]][0]:row["at"][s[2]][1]] for s in (x, y))
        if r == "strict":
            return False, "span" if x[1:] != y[1:] else "id_or_words:strict"
        # (The same value copied from elsewhere in the input, an option from the form's line rather than the request,
        # is the same value.)
        if value(x[0], tx, r) == value(y[0], ty, r):
            how.add("id_or_words" if x[0] != y[0] else "same_value")
            continue
        if r == "free" and edges_only(row, x, y):
            how.add("edges")
            continue
        return False, "span"
    return True, "+".join(sorted(how))


_NUMBER = re.compile(r"^[\d.,]+$")


def canonical(row: dict, grammar: dict) -> tuple[dict, int]:
    """The label with each copied value written bare or quoted one way, where the key wrote the same kind of value both
    ways: read as an id, bare where it is written as an id (a quoted record's id is asked about; a quoted name's id is
    the same as bare), else quoted; read as words, a number quoted (as the key mostly writes counts and amounts), a
    word written as an id bare (as it mostly writes an option, a kind or a template), else quoted. Free text, values
    read `strict`, and items of a list or of data are left as labelled. Returns the row and how many decisions changed."""
    ctx = contexts(row, grammar)
    if ctx is None:
        return row, 0
    text, cs = ctx
    steps, changed = [], 0
    for s, (fn, arg, ftype, where) in zip(row["steps"], cs):
        if isinstance(s, list) and s[0] in ("id", "text") and where == "value":
            r = reading(fn, arg, ftype)
            t = text[row["at"][s[1]][0]:row["at"][s[2]][1]]
            k = s[0]
            if r == "id":
                k = "id" if written_as_id(t) else "text"
            elif r == "words":
                k = "text" if _NUMBER.match(t) or not written_as_id(t) else "id"
            if k != s[0]:
                changed += 1
                s = [k, s[1], s[2]]
        steps.append(s)
    return ({**row, "steps": steps} if changed else row), changed


def table_check(path: str) -> list[str]:
    """Each case of contracts/test/id-or-words.json that this file's readings get otherwise than the resolver."""
    wrong = []
    for c in json.loads(Path(path).read_text())["cases"]:
        r = reading(c["fn"], c.get("arg"), c.get("type"))
        same = c["a"] == c["b"] if r == "strict" else value(*c["a"], r) == value(*c["b"], r)
        if same != c["same"]:
            wrong.append(c["name"])
    return wrong


def main() -> None:
    args = sys.argv[1:]
    if args[:1] == ["--table"]:
        wrong = table_check(args[1])
        print(json.dumps({"wrong": wrong}))
        sys.exit(1 if wrong else 0)
    if args[:1] == ["--canonical"]:
        # fair.py --canonical <export dir> <out dir>: every side's labels made one way (translator v4 trains on these),
        # export.json and vocabulary.json copied beside them.
        import shutil
        src, dst = Path(args[1]), Path(args[2])
        dst.mkdir(parents=True, exist_ok=True)
        grammar = json.loads((src / "export.json").read_text())["grammar"]
        made = {}
        for side in sorted(src.glob("*.jsonl")):
            n = 0
            with open(dst / side.name, "w") as f:
                for l in side.read_text().splitlines():
                    if l.strip():
                        c, k = canonical(json.loads(l), grammar); n += k
                        f.write(json.dumps(c) + "\n")
            made[side.stem] = n
        for x in ("export.json", "vocabulary.json"):
            shutil.copy(src / x, dst / x)
        print(json.dumps({"label_decisions_made_one_way": made}))
        return
    def flag(name):
        if name in args:
            i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
        return None
    grammar_file, fixed = flag("--grammar"), flag("--fixed")
    gold_file, results_file = args
    grammar = json.loads(Path(grammar_file).read_text())["grammar"] if grammar_file else json.loads((Path(gold_file).parent / "export.json").read_text())["grammar"]
    rows = [json.loads(l) for l in Path(gold_file).read_text().splitlines() if l.strip()]
    queue: dict = {}
    for r in rows:
        queue.setdefault((r["id"], r.get("mode")), []).append(r)
    taken: dict = {}
    tally: dict = {}
    exact = fair = n = 0
    for l in Path(results_file).read_text().splitlines():
        if not l.strip():
            continue
        o = json.loads(l)
        k = (o["id"], o.get("mode"))
        r = queue[k][taken.get(k, 0)]; taken[k] = taken.get(k, 0) + 1
        ok, why = compare(r, o["steps"], grammar)
        n += 1; exact += why == "exact"; fair += ok
        tally[why] = tally.get(why, 0) + 1
    print(json.dumps({"of": n, "exact": exact, "fair": fair, "why": dict(sorted(tally.items(), key=lambda kv: -kv[1]))}))
    if fixed:
        total = 0
        with open(fixed, "w") as f:
            for r in rows:
                c, k = canonical(r, grammar); total += k
                f.write(json.dumps(c) + "\n")
        print(json.dumps({"label_decisions_made_one_way": total}), file=sys.stderr)


if __name__ == "__main__":
    main()
