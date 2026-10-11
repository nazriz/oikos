# Tone rubric for short first-person texts (version 0.1.0)

You will be shown one short text written in the first person by someone saying why they are starting, joining or asking for something, or what has happened to them. Score it on five scales, each a whole number from 0 to 4, using only the text. Do not guess who wrote it or reward good writing. There are no right scores.

- **anger**: blame or anger directed at someone. 0: none. 1: a mild complaint. 2: clear blame, stated plainly. 3: angry; accusing. 4: furious, contemptuous or threatening.
- **despair**: hopelessness, fear or exhaustion. 0: none. 1: a passing mention of difficulty. 2: real worry or tiredness. 3: fear, shame or exhaustion colours the whole text. 4: the writer sees no way out.
- **hope_at_close**: how the text ends. 0: it ends on the wrong done, on loss or on a bare demand. 1: it ends flat or practical. 2: it ends with a modest intention. 3: it ends looking forward. 4: it ends uplifted, with resolution or reassurance.
- **polish**: how composed the writing is. 0: fragments, errors, run-ons. 1: rough but clear. 2: plain and correct. 3: well constructed, balanced sentences. 4: eloquent; rhetorical figures, cadence.
- **conciliation**: how reasonable and accommodating the writer is toward whoever they are in dispute with, or toward the world at large. 0: none; they give the other side nothing. 1: mostly their own side. 2: even-handed. 3: generous to the other side; careful not to offend. 4: the writer excuses or reassures the other side.

Answer with JSON only: {"anger": n, "despair": n, "hope_at_close": n, "polish": n, "conciliation": n}
