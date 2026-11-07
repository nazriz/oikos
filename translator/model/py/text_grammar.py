"""The text writer's constraint (translator v4, run C: docs/design/translator-v4.md, sections 2 and 4): whether a
program written so far, character by character, can still become a program this seat may be given. A decoder asks it
of each token it would write (`viable`) and of the end (`complete`), and writes the likeliest token that passes, so it
can no more write an id, a form, a field or an option it was not shown than the encoder can. Pure Python.

What it holds, all exact and in code:
- **the grammar of acts**: the call language as canonical text (calls.ts `programText`): lines `[vN = ]fn(arg=value, ...)`,
  arguments in name order, each once, the contract's functions and arguments (`grammar`, from the export) and its
  required ones, or one `none(label)` alone; values bare, quoted, a JSON list or object, or a call;
- **the forms shown**: `form=` names one of them, its fields are that form's, `to=` is its office; while the form is not
  yet written (a field's name may come first), the fields so far must all be one shown form's;
- **copying**: a quoted value is a run of the input's characters (the request and the cards), or a constant of the
  closed set (`vocabulary.json`, as the encoder's); a bare value is a run of the input, the same run as one word (lower
  case, spaces as `_`: encode.ts `asWord`), a constant, a name an earlier line bound, or a function's name;
- **field types** (slots.py `fits_type`): a field's value fits its type (a choice one of its options, a record an id, an
  amount a figure ...).

  python3 text_grammar.py <text dir> [vocabulary.json] [export.json]   checks every label of a text export: each must be
  complete and each of its prefixes viable (`misfit`, which must be none or nearly none).
"""
from __future__ import annotations

import json
import re
import sys

from slots import as_word, field_type, fits_type

FUNCTIONS = ["money", "goods", "work", "account", "structure", "occupancy", "entity", "claim", "agreement", "statement", "vote",
             "message", "form", "presence", "birth", "harm", "position", "system", "take"]
LABELS = ["not_yours", "needs_calculation", "too_much", "unclear", "unknown_form", "not_an_act", "no_such_act", "look_first"]
_ID_CHAR = re.compile(r"[A-Za-z0-9_.:/-]")
_FIELD = re.compile(r"([^\s,()]+) \(([^)]*)\)")


class Partial(Exception):
    """The text ended where more may follow: viable so far."""


class Fail(Exception):
    """No continuation of the text is a program this seat may be given."""


def forms_of(lines: list[str]) -> list[dict]:
    out = []
    for l in lines:
        m = re.match(r"^- ([^,]+), to=([^,]+), id ([^\s:(]+)", l)
        if not m:
            continue
        f = l.find(": fields ")
        fields = {}
        if f >= 0:
            for x in _FIELD.finditer(l[f + 9:]):
                fields[x.group(1)] = field_type(x.group(2))
        out.append({"name": m.group(1), "to": m.group(2), "id": m.group(3), "fields": fields})
    return out


class Situation:
    """One request with the cards its seat was shown, and the contract's grammar and closed set."""

    def __init__(self, request: str, forms: list[str], grammar: dict, vocabulary: list[str]):
        self.input = "\n".join([request, *forms])
        self.word = re.sub(r"[\s-]+", "_", self.input.lower())
        self.forms = forms_of(forms)
        self.grammar = grammar
        consts = [v[6:] for v in vocabulary if v.startswith("const:")]
        self.bare_consts = {c for c in consts if not c.startswith('"')}
        self.quoted_consts = {json.loads(c) for c in consts if c.startswith('"')}
        self.keys = {v[4:] for v in vocabulary if v.startswith("key:")}
        self.field_names = {k for f in self.forms for k in f["fields"]}

    # ---- copying
    @staticmethod
    def _whole_in(s: str, text: str) -> bool:
        """Whether `s` stands in `text` as a run of whole pieces (export.ts `pieces`: runs of letters and digits, and
        each other mark): not begun or ended inside a run of letters and digits."""
        j = text.find(s)
        while j >= 0:
            before = text[j - 1] if j > 0 else " "
            after = text[j + len(s)] if j + len(s) < len(text) else " "
            if not (s[0].isalnum() and before.isalnum()) and not (s[-1].isalnum() and after.isalnum()):
                return True
            j = text.find(s, j + 1)
        return False

    def bare_ok(self, s: str, whole: bool, bound: set[str]) -> bool:
        if whole:
            return s in self.bare_consts or s in bound or self._whole_in(s, self.input) or self._whole_in(s.lower(), self.word)
        return any(c.startswith(s) for c in self.bare_consts) or any(b.startswith(s) for b in bound) or s in self.input or s.lower() in self.word

    def quoted_ok(self, s: str, whole: bool) -> bool:
        return s in self.input or (s in self.quoted_consts if whole else any(c.startswith(s) for c in self.quoted_consts))

    # ---- the whole check
    def viable(self, text: str) -> bool:
        try:
            _Parse(self, text).program()
            return True
        except Partial:
            return True
        except Fail:
            return False

    def complete(self, text: str) -> bool:
        try:
            _Parse(self, text).program()
            return True
        except (Partial, Fail):
            return False


class _Parse:
    def __init__(self, s: Situation, text: str):
        self.s, self.t, self.i = s, text, 0
        self.bound: set[str] = set()

    def peek(self) -> str:
        if self.i >= len(self.t):
            raise Partial()
        return self.t[self.i]

    def eat(self, lit: str) -> None:
        for c in lit:
            if self.peek() != c:
                raise Fail()
            self.i += 1

    def ident(self, chars: re.Pattern) -> tuple[str, bool]:
        """A run of `chars`; whether it is whole (something else follows it)."""
        j = self.i
        while j < len(self.t) and chars.match(self.t[j]):
            j += 1
        out, self.i = self.t[self.i:j], j
        return out, j < len(self.t)

    # ---- program
    def program(self) -> None:
        if self.t.startswith("none(") or (len(self.t) < 5 and "none(".startswith(self.t) and self.t):
            if len(self.t) < 5 and not any(self.t == f[:len(self.t)] for f in FUNCTIONS):
                raise Partial()
            if self.t.startswith("none("):
                self.i = 5
                lab, whole = self.ident(re.compile(r"[a-z_]"))
                if not whole:
                    if any(l.startswith(lab) for l in LABELS):
                        raise Partial()
                    raise Fail()
                if lab not in LABELS:
                    raise Fail()
                self.eat(")")
                if self.i != len(self.t):
                    raise Fail()
                return
        n = 0
        while True:
            self.line(n)
            n += 1
            if self.i == len(self.t):
                return
            self.eat("\n")

    def line(self, n: int) -> None:
        start = self.i
        name, whole = self.ident(re.compile(r"[a-z0-9_]"))
        if not whole:
            if any(f.startswith(name) for f in FUNCTIONS) or re.fullmatch(r"v\d*", name) or (n == 0 and "none".startswith(name)):
                raise Partial()
            raise Fail()
        if self.t[self.i] == " ":
            if not re.fullmatch(r"v\d+", name) or name in self.bound:
                raise Fail()
            self.eat(" = ")
            fn, whole = self.ident(re.compile(r"[a-z]"))
            if not whole:
                if any(f.startswith(fn) for f in FUNCTIONS):
                    raise Partial()
                raise Fail()
            self.call(fn)
            self.bound.add(name)
            return
        if name not in FUNCTIONS:
            raise Fail()
        self.i = start + len(name)
        self.call(name)

    # ---- a call
    def call(self, fn: str) -> None:
        if fn not in FUNCTIONS:
            raise Fail()
        g = self.s.grammar.get(fn, {"args": [], "required": []})
        allowed = set(g["args"]) | (self.s.field_names if fn == "form" else set())
        self.eat("(")
        args: dict[str, tuple[str, str]] = {}
        prev = ""
        if self.peek() == ")":
            self.i += 1
        else:
            while True:
                key, whole = self.ident(re.compile(r"[a-z0-9_]"))
                if not whole:
                    if any(a.startswith(key) and a > prev for a in allowed):
                        raise Partial()
                    raise Fail()
                if key not in allowed or key <= prev:
                    raise Fail()
                self.eat("=")
                args[key] = self.value(fn, key, args)
                prev = key
                if fn == "form":
                    self.form_so_far(args)
                c = self.peek()
                if c == ")":
                    self.i += 1
                    break
                self.eat(", ")
        if any(r not in args for r in g["required"]):
            raise Fail()
        if fn == "form" and "form" not in args:
            raise Fail()

    def form_so_far(self, args: dict) -> None:
        """The shown forms the call can still be: each has every field written so far, each value fitting its type."""
        name = args.get("form")
        to = args.get("to")
        ok = []
        for f in self.s.forms:
            if name is not None and name[1] != f["name"]:
                continue
            if to is not None and to[1] != f["to"]:
                continue
            good = True
            for k, (kind, v) in args.items():
                if k in ("form", "to"):
                    continue
                if k not in f["fields"]:
                    good = False
                    break
                ftype, options = f["fields"][k]
                if kind in ("id", "text") and not fits_type(kind, v, ftype, options):
                    good = False
                    break
            if good:
                ok.append(f)
        if not ok:
            raise Fail()

    # ---- values
    def value(self, fn: str, key: str, args: dict) -> tuple[str, str]:
        c = self.peek()
        if c == '"':
            return "text", self.quoted()
        if c in "[{":
            self.json()
            return "json", ""
        start = self.i
        tok, whole = self.ident(_ID_CHAR)
        if not whole:
            if any(f.startswith(tok) for f in FUNCTIONS) or self.s.bare_ok(tok, False, self.bound):
                raise Partial()
            raise Fail()
        if self.t[self.i] == "(":
            self.i = start + len(tok)
            self.call(tok)
            return "call", tok
        if not tok or not self.s.bare_ok(tok, True, self.bound):
            raise Fail()
        if fn == "form" and key == "form" and tok not in {f["name"] for f in self.s.forms}:
            raise Fail()
        return "id", tok

    def quoted(self) -> str:
        self.eat('"')
        out = []
        while True:
            if self.i >= len(self.t):
                if self.s.quoted_ok("".join(out), False):
                    raise Partial()
                raise Fail()
            c = self.t[self.i]
            self.i += 1
            if c == '"':
                v = "".join(out)
                if not self.s.quoted_ok(v, True):
                    raise Fail()
                return v
            if c == "\\":
                e = self.peek()
                if e not in '"\\':
                    raise Fail()
                self.i += 1
                c = e
            out.append(c)
            if not self.s.quoted_ok("".join(out), False):
                raise Fail()

    def json(self) -> None:
        c = self.peek()
        if c == "[":
            self.i += 1
            if self.peek() == "]":
                self.i += 1
                return
            while True:
                self.json_value()
                c = self.peek()
                if c == "]":
                    self.i += 1
                    return
                self.eat(",")
        self.eat("{")
        if self.peek() == "}":
            self.i += 1
            return
        while True:
            self.eat('"')
            j = self.t.find('"', self.i)
            if j < 0:
                k = self.t[self.i:]
                if any(x.startswith(k) for x in self.s.keys) or k in self.s.input:
                    raise Partial()
                raise Fail()
            k = self.t[self.i:j]
            if k not in self.s.keys and k not in self.s.input:
                raise Fail()
            self.i = j + 1
            self.eat(":")
            self.json_value()
            c = self.peek()
            if c == "}":
                self.i += 1
                return
            self.eat(",")

    def json_value(self) -> None:
        c = self.peek()
        if c == '"':
            self.quoted()
        elif c in "[{":
            self.json()
        else:
            tok, whole = self.ident(re.compile(r"[A-Za-z0-9.-]"))
            if not whole:
                if tok in self.s.input or any(x.startswith(tok) for x in ("true", "false", "null")):
                    raise Partial()
                raise Fail()
            if tok not in ("true", "false", "null") and not (re.fullmatch(r"-?\d+", tok) and tok in self.s.input):
                raise Fail()


def check(text_dir: str, vocabulary: str, export: str, sides=("train", "validation", "validation-real", "validation-uf"), every_prefix: int = 1) -> dict:
    from pathlib import Path
    voc = json.loads(Path(vocabulary).read_text())
    grammar = json.loads(Path(export).read_text())["grammar"]
    report = {}
    for side in sides:
        p = Path(text_dir) / f"{side}.jsonl"
        if not p.exists():
            continue
        n = bad = 0
        why: dict = {}
        for k, l in enumerate(p.read_text().splitlines()):
            if not l.strip() or k % every_prefix:
                continue
            r = json.loads(l)
            s = Situation(r["request"], r["forms"], grammar, voc)
            n += 1
            prog = r["program"]
            if not s.complete(prog) or not all(s.viable(prog[:j]) for j in range(1, len(prog))):
                bad += 1
                # (Where it first goes wrong, as the 20 characters before it: a check of the rule, never of a label.)
                at = next((j for j in range(1, len(prog) + 1) if not s.viable(prog[:j])), len(prog))
                key = prog[max(0, at - 20):at]
                why[key] = why.get(key, 0) + 1
        report[side] = {"labels": n, "misfit": bad, "first_wrong_at": dict(sorted(why.items(), key=lambda kv: -kv[1])[:15])}
    return report


if __name__ == "__main__":
    d = sys.argv[1]
    print(json.dumps(check(d, sys.argv[2], sys.argv[3], every_prefix=int(sys.argv[4]) if len(sys.argv) > 4 else 1), indent=1))
