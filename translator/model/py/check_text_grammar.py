"""The text writer's constraint (text_grammar.py) on a few requests, by rule: what it lets through and what it refuses.
Needs nothing but Python; translator/test/model-cards.test.ts runs it. Prints {"wrong": [...]} and exits 1 if any."""
import json
import sys

from text_grammar import Situation

GRAMMAR = {"form": {"args": ["form", "to"], "required": ["form"]}, "message": {"args": ["re", "text", "to"], "required": ["to", "text"]},
           "money": {"args": ["amount", "for", "from", "to"], "required": ["to", "amount"]}}
VOC = ["const:yes", 'const:"0 days"', "fn:form"]
permit = "- permit_licence_application, to=fenn-works, id form-fenn: fields attendees (count, required), record (record, required), urgent (one of yes | no)"
s = Situation("Please complete the permit licence application for [fenn-works]: attendees 7, record rec.11538, and tell ent.19 \"it is done\".", [permit], GRAMMAR, VOC)
cases = [
    # (text, whole, viable)
    ('form(attendees="7", form=permit_licence_application, record=rec.11538, to=fenn-works)', True, True),
    ('form(attendees="7", form=permit_licence_application, record=rec.11538, to=fenn-works)\nmessage(text="it is done", to=ent.19)', True, True),
    ("none(not_an_act)", True, True),
    ("none(not_an", False, True),
    ("form(attendees=", False, True),
    ('message(text="it is', False, True),
    ("form(form=permit_licence_application, urgent=yes)", True, True),          # an option, and a constant
    ("form(form=building_application)", False, False),                         # a form not shown
    ("form(form=permit_licence_application, to=city)", False, False),           # not that form's office
    ("form(attendees=rec.11538, form=permit_licence_application)", False, False),  # a count must be a figure
    ("form(record=\"rec.11538\", form=permit_licence_application)", False, False),  # a record's id is written bare
    ("form(form=permit_licence_application, urgent=maybe)", False, False),     # not one of its options
    ("form(storeys=\"7\", form=permit_licence_application)", False, False),     # not one of its fields
    ('message(text="it was done", to=ent.19)', False, False),                    # not the request's words
    ("message(text=\"it is done\", to=ent.20)", False, False),                   # an id the request does not have
    ('message(to=ent.19, text="it is done")', False, False),                     # out of name order
    ("message(to=ent.19)", False, False),
    ('message(text="it is done", to=ent.1)', False, False),                      # an id cut short is not one the request has                                        # the text is required
    ("none(not_an_act)\nmessage(", False, False),
    ("money(amount=\"0 days\", to=ent.19)", True, True),                          # a quoted constant of the closed set
]
wrong = [c[0] for c in cases if s.complete(c[0]) != c[1] or s.viable(c[0]) != c[2]]
print(json.dumps({"wrong": wrong}))
sys.exit(1 if wrong else 0)
