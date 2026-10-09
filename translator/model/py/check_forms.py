"""A check of the trainer's forms augmentation (train.py `with_forms`), run by hand: uv run python check_forms.py

A form that goes to an office the request names is never added beside it: a direction to that office is that form
filled in where the form is known, so a letter to the office shown beside the office's own form would be taught
wrong. Every other form may be added, as before."""
import random
import re

from train import Line, names_office, office_of, with_forms


def pieces(s: str) -> list[str]:
    return re.findall(r"[^\W_]+|[^\w\s]|_", s)


def line(s: str) -> Line:
    out = Line(pieces(s))
    out.at = []
    return out


works = line("- works_staffing, to=works, id form-works-works-staffing: fields posts (count), recruit (one of yes | no)")
council = line("- council_proposal, to=city, id form-council-proposal: fields kind (one of law | budget | other, required), proposal (text, required)")
post = line("- hall_register, to=pos.302, id form-pos.302-hall-register: fields members (list, required), starts (date)")
clerk = line("- minutes_order, to=council-clerk, id form-council-clerk-minutes-order: fields copies (count)")
assert office_of(works) == ["works"] and office_of(council) == ["city"] and office_of(post) == ["pos", ".", "302"] and office_of(clerk) == ["council", "-", "clerk"]


def named(request: str, form: Line) -> bool:
    ps = pieces(request)
    return names_office(ps, len(ps), office_of(form))


assert named("Direct works to stop recruiting until the budget is adopted.", works)
assert named("Tell the works office [works] to pause the filling of the post.", works)
assert named("Have pos.302 keep the register open.", post)
assert named("Ask council-clerk to send me the minutes.", clerk)
assert named("Write to works.", works)
# Part of a longer id, or of another word, is not the office.
assert not named("Stop recruiting new works-crew for the town.", works)
assert not named("Pay acc-works 500 from acc-city.", works)
assert not named("Pay acc-city 500.", council)
assert not named("Have pos.3021 keep the register open.", post)
assert not named("Ask the clerk to send me the minutes.", clerk)
assert not named("Cancel rec.302.", post)

# Over many draws: the office's own form is never added beside a letter to it; the others are; nothing the steps
# point at moves.
letter = pieces("Direct works to stop recruiting until the budget is adopted.")
row = {"pieces": letter, "breaks": [], "steps": ["fn:message", "arg:text", ["text", 3, 10], "arg:to", ["id", 1, 1], ")", "eos"]}
rand = random.Random(3)
seen = set()
for _ in range(400):
    r = with_forms(row, [works, council, post, clerk], rand)
    assert r["pieces"][:len(letter)] == letter and r["steps"] == row["steps"]
    cuts = r["breaks"] + [len(r["pieces"])]
    for a, b in zip(cuts, cuts[1:]):
        seen.add(" ".join(r["pieces"][a:b]))
assert " ".join(works) not in seen
assert {" ".join(council), " ".join(post), " ".join(clerk)} <= seen
# A request that names no office is given any of them.
other = dict(row, pieces=pieces("Pay acc-works 500 from acc-city."))
seen = set()
for _ in range(400):
    r = with_forms(other, [works, council], rand)
    seen.update(" ".join(r["pieces"][a:b]) for a, b in zip(r["breaks"], r["breaks"][1:] + [len(r["pieces"])]))
assert {" ".join(works), " ".join(council)} <= seen
print("ok")
