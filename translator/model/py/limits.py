"""The reader's length switch (train.py `--max-pieces`): the most pieces of an input a row may have and the model reads.

Pure Python, so that it is checked without torch (translator/test/model-limits.test.ts). The default stays model.py's 640
(every model so far); the third round's two lengths are 1024 (the control) and 2048 (the candidate, with --max-tokens
2048): docs/design/translator-round-3.md, section 4. DeBERTa-v3 reads by relative position, so neither needs a new
position table."""

DEFAULT = 640
ALLOWED = (DEFAULT, 1024, 2048)


def reader_pieces(n: int) -> int:
    if n not in ALLOWED:
        raise SystemExit(f"--max-pieces {n}: one of {', '.join(str(x) for x in ALLOWED)} (the default is {DEFAULT})")
    return n
