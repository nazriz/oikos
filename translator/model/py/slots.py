"""Slot-by-slot decoding (translator/model/encode.ts, "Slot by slot"): what there is to decide next, and what it may be.

The same rule as encode.ts in the other language. Code lists the decisions of a program: the kind of answer, how many
lines, and for each line whether its result is named, its function, and each slot of the function once, in a stated
order (a form: `form`, `to`, then the fields of that form's line as shown, in the line's order; any other function:
every argument the contract allows it, in the contract's order: `grammar`, from the export). The model only ever
answers "what is this slot": left out (`-`), a choice from the closed set, or a copied span. Nothing closes a call or
ends a program, so neither can end early; a slot the contract requires cannot be left out (a form's own required
field can: the request may not give it, and a value is never made up; the answer is then told back with what the form
lacks); a field the form's line does not list has no slot. Training and answering follow this one rule.

`Machine` is the rule over characters; `Follow` is a machine beside one input as a reader's tokens: for each decision,
the slot's number, where a field's name stands in tokens, and which choices are allowed.

  python3 slots.py < {"grammar": {...}, "cases": [{"input": "...", "steps": [...]}]}

follows each case's decisions (a span as [kind, first character, end]) and prints, a case a line, {"fits": whether
they are exactly the decisions the rule lists, "slots": the slot of each, "off": which of them the rule does not
allow}. Needs nothing but Python (translator/test/model-slots.test.ts holds the two languages to one rule with it).
"""
from __future__ import annotations

import json
import re

LEFT_OUT = "-"
PROGRAM = "program"
FORM_ARGS = ("form", "to")
_FIELD = re.compile(r"([^\s,()]+) \(([^)]*)\)")
_REQUIRED = re.compile(r"(^|, )required$")


NAMED_BEFORE = "Named before: "


def named_before(text: str) -> list[str]:
    """The names earlier lines gave their results, from a fill input's last line (encode.ts `fillInput`)."""
    last = text.rsplit("\n", 1)[-1] if "\n" in text else ""
    return [x for x in last[len(NAMED_BEFORE):].split(", ") if x] if last.startswith(NAMED_BEFORE) else []


def choose_line(line: str) -> str:
    """What the choose pass is shown of a form: its head, then its fields' names (encode.ts `chooseLine`)."""
    f = line.find(": fields ")
    if f < 0:
        return line
    names: list[str] = []
    for m in _FIELD.finditer(line[f + 9:]):
        if m.group(1) not in names:
            names.append(m.group(1))
    return f"{line[:f]}: has {', '.join(names)}"


def line_index(lines: list[str], form: str | None, to: str | None) -> int:
    """Which of the forms' lines a call fills (encode.ts `lineOf`): -1 if none."""
    if form is None:
        return -1
    mine = [k for k, l in enumerate(lines) if l.startswith(f"- {form},") or f"id {form}:" in l]
    if to is not None:
        for k in mine:
            f = lines[k].find(": fields ")
            head = lines[k] if f < 0 else lines[k][:f]
            if f", to={to}," in head or head.endswith(f", to={to}"):
                return k
    return mine[0] if mine else -1


def as_word(s: str) -> str:
    """A span's words as one word (encode.ts asWord)."""
    return re.sub(r"[\s-]+", "_", re.sub(r"^the\s+", "", s.strip().lower()))


def slot_names(grammar: dict) -> list[str]:
    """Every slot a decision can be for, in a fixed order: the model's slot numbers."""
    names = ["kind", "lines", "bind", "fn", "field"]
    for fn in grammar:
        for a in grammar[fn]["args"]:
            if f"arg:{a}" not in names:
                names.append(f"arg:{a}")
    return names


class Forms:
    """The forms shown in an input: every line after the first that begins `- `, each with its fields (name, whether
    it must be filled in, where the name stands in the input's characters)."""

    def __init__(self, text: str):
        self.lines: list[dict] = []
        nl = text.find("\n")
        while nl >= 0:
            nxt = text.find("\n", nl + 1)
            end = len(text) if nxt < 0 else nxt
            at = nl + 1
            while at < end and text[at].isspace():
                at += 1
            line = text[at:end]
            if line.startswith("- "):
                f = line.find(": fields ")
                fields, seen = [], set()
                if f >= 0:
                    for m in _FIELD.finditer(line[f + 9:]):
                        if m.group(1) in seen:
                            continue
                        seen.add(m.group(1))
                        a = at + f + 9 + m.start(1)
                        fields.append((m.group(1), bool(_REQUIRED.search(m.group(2))), a, a + len(m.group(1))))
                self.lines.append({"line": line, "head": line if f < 0 else line[:f], "fields": fields})
            nl = nxt

    def line_of(self, form: str | None, to: str | None) -> dict | None:
        """The line of the form a call fills: the first whose name or record id is `form`; of several, the first that
        goes to `to`."""
        if form is None:
            return None
        mine = [l for l in self.lines if l["line"].startswith(f"- {form},") or f"id {form}:" in l["line"]]
        if to is not None:
            for l in mine:
                if f", to={to}," in l["head"] or l["head"].endswith(f", to={to}"):
                    return l
        return mine[0] if mine else None


class Machine:
    """The decisions of one answer, one after another. `state` is what is to be decided now: (slot name, where a
    field's name stands in characters or None, what is allowed: a key for `allows`), or None when the answer is whole.
    `take(step, text)` gives it the decision (a choice's name, or [kind, first, last] with the characters it copies).

    `mode` (encode.ts, "Read twice"): `full`, slot by slot over the whole input; `choose`, a form's fields are not
    decided, and each form met is kept in `chosen` as (form, office, the names bound before its line, how many
    decisions had been taken when its office was); `fill`, the decisions are the fields of the one form shown, with the
    names in `bound` (the input's `Named before:` line) allowed as values."""

    def __init__(self, grammar: dict, forms: Forms, mode: str = "full", bound: list[str] | None = None):
        self.grammar, self.forms, self.mode = grammar, forms, mode
        self.bound: list[str] = list(bound or [])
        self.chosen: list[tuple] = []
        self.taken = 0
        self._run = self._fill() if mode == "fill" else self._program()
        try:
            self.state = next(self._run)
        except StopIteration:
            self.state = None

    def _fill(self):
        line = self.forms.lines[0] if self.forms.lines else None
        for name, _wanted, a, z in (line["fields"] if line else []):
            if name not in FORM_ARGS:
                yield from self._slot("field", (a, z), False)

    def take(self, step, text: str | None = None):
        self.taken += 1
        try:
            self.state = self._run.send((step, text))
        except StopIteration:
            self.state = None
        return self.state

    def _program(self):
        s, _ = yield ("kind", None, ("kind",))
        if s != PROGRAM:
            return
        s, _ = yield ("lines", None, ("lines",))
        n = int(s[6:])
        for i in range(n):
            bind = None
            if i < n - 1:
                s, _ = yield ("bind", None, ("bind", tuple(self.bound)))
                bind = None if s == LEFT_OUT else s[5:]
            s, _ = yield ("fn", None, ("fn",))
            yield from self._call(s[3:])
            if bind:
                self.bound.append(bind)

    def _call(self, fn: str):
        g = self.grammar[fn]
        if fn == "form":
            form = yield from self._slot("arg:form", None, True)
            to = yield from self._slot("arg:to", None, False)
            if self.mode == "choose":
                self.chosen.append((form, to, list(self.bound), self.taken))
                return
            line = self.forms.line_of(form, to)
            for name, _wanted, a, z in (line["fields"] if line else []):
                if name not in FORM_ARGS:
                    yield from self._slot("field", (a, z), False)
        else:
            for a in g["args"]:
                yield from self._slot(f"arg:{a}", None, a in g["required"])

    def _slot(self, slot: str, at, required: bool):
        """One slot: its value's decisions. Comes to the value as a word where it is one (a form's name, an office)."""
        s, text = yield (slot, at, ("value", required, tuple(self.bound)))
        if isinstance(s, str):
            if s.startswith("fn:"):
                yield from self._call(s[3:])
            elif s in ("[", "{"):
                yield from self._data(s, slot, at)
            elif s.startswith("const:"):
                return json.loads(s[6:]) if s[6:7] == '"' else s[6:]
            return None
        return as_word(text or "") if s[0] == "word" else text

    def _data(self, opened: str, slot: str, at):
        if opened == "[":
            while True:
                s, _ = yield (slot, at, ("item",))
                if s == "]":
                    return
                if s in ("[", "{"):
                    yield from self._data(s, slot, at)
        else:
            while True:
                s, _ = yield (slot, at, ("key",))
                if s == "}":
                    return
                s, _ = yield (slot, at, ("data",))
                if s in ("[", "{"):
                    yield from self._data(s, slot, at)


def allows(key: tuple, choice: str) -> bool:
    """Whether a choice (a closed-set name, or `<id>`, `<text>`, `<word>`, `<field>` for a copied span) may be the
    decision where `key` says what is being decided."""
    what = key[0]
    if what == "kind":
        return choice == PROGRAM or choice.startswith("none:")
    if what == "lines":
        return choice.startswith("lines:")
    if what == "bind":
        return choice == LEFT_OUT or (choice.startswith("bind:") and choice[5:] not in key[1])
    if what == "fn":
        return choice.startswith("fn:")
    if what == "value":
        if choice == LEFT_OUT:
            return not key[1]
        if choice.startswith("var:"):
            return choice[4:] in key[2]
        return choice in ("<id>", "<text>", "<word>", "[", "{") or choice.startswith("const:") or choice.startswith("fn:")
    if what in ("item", "data"):
        return choice in ("<text>", "[", "{") or choice.startswith("const:") or (what == "item" and choice == "]")
    if what == "key":
        return choice == "}" or choice.startswith("key:")
    return False


class Masks:
    """Each kind of decision's allowed choices as a row of a table (made as they are first met)."""

    def __init__(self, choices: list[str]):
        self.choices = choices
        self.index: dict[tuple, int] = {}
        self.rows: list = []

    def of(self, key: tuple) -> int:
        import torch
        if key not in self.index:
            self.index[key] = len(self.rows)
            self.rows.append(torch.tensor([allows(key, c) for c in self.choices], dtype=torch.bool))
        return self.index[key]

    def table(self):
        import torch
        return torch.stack(self.rows)


def covering(t, a: int, z: int) -> tuple[int, int] | None:
    """The first and last token that touch the characters a..z (exactly them where they are a run of tokens)."""
    first = t.starts.get(a)
    last = t.ends.get(z)
    if first is not None and last is not None and last >= first:
        return first, last
    touch = [i for i, (x, y) in enumerate(t.span) if y > x and x < z and y > a]
    return (touch[0], touch[-1]) if touch else None


class Follow:
    """A machine beside one input read as tokens. `now` is None when the answer is whole, else (slot number, first
    and last token of a field's name or None, the allowed choices' row in `masks`). `exact`: a field's name must be
    exactly a run of tokens (training: else `now` raises Inexact); otherwise the tokens that touch it serve."""

    class Inexact(Exception):
        pass

    def __init__(self, grammar: dict, slots: list[str], masks: Masks, text: str, t, exact: bool = False, mode: str = "full"):
        self.slots = {s: i for i, s in enumerate(slots)}
        self.masks, self.text, self.t, self.exact = masks, text, t, exact
        self.machine = Machine(grammar, Forms(text), mode, named_before(text) if mode == "fill" else None)

    @property
    def now(self):
        state = self.machine.state
        if state is None:
            return None
        slot, at, key = state
        span = None
        if at is not None:
            if self.exact:
                a, z = self.t.starts.get(at[0]), self.t.ends.get(at[1])
                if a is None or z is None or z < a:
                    raise Follow.Inexact()
                span = (a, z)
            else:
                span = covering(self.t, at[0], at[1])
        return self.slots[slot], span, self.masks.of(key)

    def take_tokens(self, step) -> None:
        """A decision whose span is in tokens (a model's own answer)."""
        if isinstance(step, str):
            self.machine.take(step)
        else:
            a, z = self.t.span[step[1]][0], self.t.span[step[2]][1]
            self.machine.take(step, self.text[a:z] if z > a else "")

    def take_chars(self, step, a: int = 0, z: int = 0) -> None:
        """A decision whose span is the characters a..z (a label's)."""
        self.machine.take(step, None if isinstance(step, str) else self.text[a:z])


if __name__ == "__main__":
    import sys
    asked = json.loads(sys.stdin.read())
    for case in asked["cases"]:
        mode = case.get("mode", "full")
        m = Machine(asked["grammar"], Forms(case["input"]), mode, named_before(case["input"]) if mode == "fill" else None)
        slots, off, fits = [], [], True
        try:
            for i, s in enumerate(case["steps"]):
                if m.state is None:
                    fits = False
                    break
                slot, at, key = m.state
                slots.append(slot if at is None else f"field:{case['input'][at[0]:at[1]]}")
                if not allows(key, s if isinstance(s, str) else f"<{s[0]}>"):
                    off.append(i)
                m.take(s, None if isinstance(s, str) else case["input"][s[1]:s[2]])
            fits = fits and m.state is None
        except (KeyError, ValueError, IndexError, TypeError):
            fits = False
        print(json.dumps({"fits": fits, "slots": slots, "off": off, **({"chosen": [list(c) for c in m.chosen]} if m.mode == "choose" else {})}))
