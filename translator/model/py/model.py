"""The translator as a model that decides and copies (docs/design/translator-and-resolver.md, 16.10).

It reads the request (and the forms the person knows of) as pieces, and writes a program as steps: each step is a
choice from a closed set (a function, an argument, a refusal label, ...) or a span of the pieces it read. It has no
way to write a word of its own.

Two readers, one writer. Trained from nothing: a piece is known by hashes of itself and of its letters, so there is
no word list to carry, and an id it has never seen is still something it can point at. Or (`Config.encoder`) the
reader is a small pretrained encoder, fine-tuned: it reads its own tokens (tokens.py maps spans of pieces to spans of
tokens and back), and the writer, the heads and the loss are the same.
"""
from __future__ import annotations

import math
import re
import zlib
from dataclasses import dataclass, asdict

import torch
import torch.nn as nn
import torch.nn.functional as F

POINTERS = ["id", "text", "word", "field"]
_DIGIT = re.compile(r"\d")
SHAPES = 8


@dataclass
class Config:
    vocabulary: list[str]
    width: int = 192
    heads: int = 4
    reader_layers: int = 4
    writer_layers: int = 3
    feed: int = 512
    buckets: int = 16384
    max_pieces: int = 640
    max_steps: int = 48
    max_lines: int = 12
    dropout: float = 0.1
    piece_dropout: float = 0.0
    # The second arm: a pretrained encoder's name (Hugging Face) in place of the hash reader, and the most tokens
    # of it an input may be (longer is asked back, never cut).
    encoder: str = ""
    max_tokens: int = 512

    def to_json(self) -> dict:
        return asdict(self)


def _hash(s: str, salt: int, buckets: int) -> int:
    return zlib.crc32(s.encode("utf-8"), salt) % buckets


def shape(piece: str) -> int:
    if piece.isdigit():
        return 0
    if piece.isalpha():
        if piece.islower():
            return 1
        if piece.isupper():
            return 2 if len(piece) > 1 else 3
        return 3 if piece[0].isupper() and piece[1:].islower() else 4
    if piece.isalnum():
        return 5
    return 6 if len(piece) == 1 else 7


def features(pieces: list[str], breaks: list[int], cfg: Config) -> dict[str, torch.Tensor]:
    """A request's pieces as numbers: two hashes of each piece, hashes of its letters three at a time, its shape,
    and which line of the input it is on (the request, then each form)."""
    n = min(len(pieces), cfg.max_pieces)
    word = torch.zeros(n, 2, dtype=torch.long)
    grams = torch.zeros(n, 8, dtype=torch.long)
    gram_mask = torch.zeros(n, 8)
    shp = torch.zeros(n, dtype=torch.long)
    line = torch.zeros(n, dtype=torch.long)
    cuts = sorted(b for b in breaks if b >= 0)
    for i in range(n):
        p = pieces[i]
        low = p.lower()
        word[i, 0] = _hash(low, 1, cfg.buckets)
        # The second is of the piece with every digit as 0: one id reads like another of its make ("c0412", "c0977").
        word[i, 1] = _hash(_DIGIT.sub("0", low), 2, cfg.buckets)
        padded = f"<{low}>"
        gs = [padded[k:k + 3] for k in range(max(1, len(padded) - 2))][:8]
        for k, g in enumerate(gs):
            grams[i, k] = _hash(g, 3, cfg.buckets)
            gram_mask[i, k] = 1.0
        shp[i] = shape(p)
        line[i] = min(sum(1 for c in cuts if c <= i), cfg.max_lines - 1)
    return {"word": word, "grams": grams, "gram_mask": gram_mask, "shape": shp, "line": line}


class Translator(nn.Module):
    def __init__(self, cfg: Config, encoder_from: str | None = None, pretrained: bool = False):
        """`encoder_from`: where the encoder's make is read from (its name, or a folder saved beside a trained
        model); `pretrained`: begin from its published weights (training), or leave them to be loaded (answering)."""
        super().__init__()
        self.cfg = cfg
        d = cfg.width
        self.choices = cfg.vocabulary + [f"<{p}>" for p in POINTERS]
        self.n_choices = len(self.choices)
        self.first_pointer = len(cfg.vocabulary)
        if cfg.encoder:
            from transformers import AutoConfig, AutoModel
            source = encoder_from or cfg.encoder
            self.encoder = AutoModel.from_pretrained(source, dtype=torch.float32) if pretrained else AutoModel.from_config(AutoConfig.from_pretrained(source))
            self.encoder.float()
            hidden = self.encoder.config.hidden_size
            # Which line a token is on, added to what the encoder is given. It starts as nothing, so the first
            # step of training is from the encoder exactly as it was published.
            self.line = nn.Embedding(cfg.max_lines, hidden)
            nn.init.zeros_(self.line.weight)
            self.fit = nn.Linear(hidden, d) if hidden != d else nn.Identity()
        else:
            self.word = nn.Embedding(cfg.buckets, d)
            self.gram = nn.Embedding(cfg.buckets, d)
            self.shape = nn.Embedding(SHAPES, d)
            self.line = nn.Embedding(cfg.max_lines, d)
            self.place = nn.Embedding(cfg.max_pieces, d)
            self.read_norm = nn.LayerNorm(d)
            layer = nn.TransformerEncoderLayer(d, cfg.heads, cfg.feed, cfg.dropout, batch_first=True, norm_first=True)
            self.reader = nn.TransformerEncoder(layer, cfg.reader_layers, enable_nested_tensor=False)
        self.step = nn.Embedding(self.n_choices + 1, d)  # the last is the start of a program
        self.step_place = nn.Embedding(cfg.max_steps + 1, d)
        self.span = nn.Linear(2 * d, d)
        wl = nn.TransformerDecoderLayer(d, cfg.heads, cfg.feed, cfg.dropout, batch_first=True, norm_first=True)
        self.writer = nn.TransformerDecoder(wl, cfg.writer_layers)
        self.write_norm = nn.LayerNorm(d)
        self.choose = nn.Linear(d, self.n_choices)
        self.kind = nn.Embedding(len(POINTERS), d)
        self.start_q = nn.Linear(2 * d, d)
        self.end_q = nn.Linear(3 * d, d)
        self.start_k = nn.Linear(d, d)
        self.end_k = nn.Linear(d, d)

    # ---- reading
    def read(self, f: dict[str, torch.Tensor], pad: torch.Tensor) -> torch.Tensor:
        """f: batched features; pad: True where there is no piece."""
        if self.cfg.encoder:
            x = self.encoder.get_input_embeddings()(f["tokens"]) + self.line(f["line"])
            return self.fit(self.encoder(inputs_embeds=x, attention_mask=(~pad).long()).last_hidden_state)
        g = (self.gram(f["grams"]) * f["gram_mask"].unsqueeze(-1)).sum(2) / f["gram_mask"].sum(2, keepdim=True).clamp(min=1)
        w = self.word(f["word"])
        if self.training and self.cfg.piece_dropout > 0:
            # Now and then a piece is known only by its letters, its shape and its neighbours: not by itself.
            keep = (torch.rand(w.shape[:2], device=w.device) >= self.cfg.piece_dropout).unsqueeze(-1)
            w = torch.stack([w[:, :, 0] * keep, w[:, :, 1]], 2)
        x = w.sum(2) + g + self.shape(f["shape"]) + self.line(f["line"])
        x = x + self.place(torch.arange(x.shape[1], device=x.device)).unsqueeze(0)
        return self.reader(self.read_norm(x), src_key_padding_mask=pad)

    # ---- writing
    def step_inputs(self, read: torch.Tensor, prev: torch.Tensor, prev_start: torch.Tensor, prev_end: torch.Tensor) -> torch.Tensor:
        """What the writer is told of the steps so far: the choice, and for a span, what it pointed at."""
        x = self.step(prev)
        is_span = (prev >= self.first_pointer) & (prev < self.n_choices)
        b = torch.arange(read.shape[0], device=read.device).unsqueeze(1)
        pointed = self.span(torch.cat([read[b, prev_start], read[b, prev_end]], -1))
        x = x + pointed * is_span.unsqueeze(-1)
        return x + self.step_place(torch.arange(x.shape[1], device=x.device)).unsqueeze(0)

    def write(self, read: torch.Tensor, pad: torch.Tensor, inputs: torch.Tensor) -> torch.Tensor:
        t = inputs.shape[1]
        causal = torch.triu(torch.ones(t, t, dtype=torch.bool, device=inputs.device), 1)
        return self.write_norm(self.writer(inputs, read, tgt_mask=causal, memory_key_padding_mask=pad))

    def start_scores(self, state: torch.Tensor, kind: torch.Tensor, read: torch.Tensor, pad: torch.Tensor) -> torch.Tensor:
        q = self.start_q(torch.cat([state, self.kind(kind)], -1))
        s = torch.einsum("btd,bnd->btn", q, self.start_k(read)) / math.sqrt(q.shape[-1])
        return s.masked_fill(pad.unsqueeze(1), float("-inf"))

    def end_scores(self, state: torch.Tensor, kind: torch.Tensor, start: torch.Tensor, read: torch.Tensor, pad: torch.Tensor) -> torch.Tensor:
        b = torch.arange(read.shape[0], device=read.device).unsqueeze(1)
        q = self.end_q(torch.cat([state, self.kind(kind), read[b, start]], -1))
        s = torch.einsum("btd,bnd->btn", q, self.end_k(read)) / math.sqrt(q.shape[-1])
        n = read.shape[1]
        before = torch.arange(n, device=read.device).view(1, 1, n) < start.unsqueeze(-1)
        return s.masked_fill(pad.unsqueeze(1) | before, float("-inf"))

    def loss(self, batch: dict[str, torch.Tensor]) -> torch.Tensor:
        """Teacher-forced: the loss of each step's choice, and of a span's first and last piece."""
        read = self.read(batch, batch["pad"])
        choice, start, end = batch["choice"], batch["start"], batch["end"]
        bos = torch.full_like(choice[:, :1], self.n_choices)
        zero = torch.zeros_like(start[:, :1])
        inputs = self.step_inputs(read, torch.cat([bos, choice[:, :-1].clamp(min=0)], 1), torch.cat([zero, start[:, :-1]], 1), torch.cat([zero, end[:, :-1]], 1))
        state = self.write(read, batch["pad"], inputs)
        total = F.cross_entropy(self.choose(state).transpose(1, 2), choice, ignore_index=-100, reduction="sum")
        is_span = choice >= self.first_pointer
        if is_span.any():
            kind = (choice - self.first_pointer).clamp(min=0)
            s = self.start_scores(state, kind, read, batch["pad"])
            e = self.end_scores(state, kind, start, read, batch["pad"])
            total = total + F.cross_entropy(s[is_span], start[is_span], reduction="sum") + F.cross_entropy(e[is_span], end[is_span], reduction="sum")
        return total / (choice != -100).sum()

    @torch.no_grad()
    def translate(self, f: dict[str, torch.Tensor]) -> tuple[list, float, dict]:
        """One request, greedily: its steps (a choice's name, or [kind, first piece, last piece]), how sure the
        model is of the whole (the product of every decision's probability), and that sureness in its parts: of what
        it chose (`choices`: the function, each argument, where the call closes), of where each copied id, word or
        field stands (`places`), of where each copied text begins and ends (`texts`), and its least sure decision."""
        pad = torch.zeros(1, f["line"].shape[1], dtype=torch.bool, device=f["line"].device)
        read = self.read(f, pad)
        prev, starts, ends = [self.n_choices], [0], [0]
        steps: list = []
        sure = 0.0
        parts = {"choices": 0.0, "places": 0.0, "texts": 0.0}
        least = 0.0
        for _ in range(self.cfg.max_steps):
            dev = read.device
            inputs = self.step_inputs(read, torch.tensor([prev], device=dev), torch.tensor([starts], device=dev), torch.tensor([ends], device=dev))
            state = self.write(read, pad, inputs)[:, -1:]
            p = F.log_softmax(self.choose(state)[0, 0], -1)
            c = int(p.argmax())
            sure += float(p[c])
            parts["choices"] += float(p[c])
            least = min(least, float(p[c]))
            if c >= self.first_pointer:
                kind = torch.tensor([[c - self.first_pointer]], device=dev)
                ps = F.log_softmax(self.start_scores(state, kind, read, pad)[0, 0], -1)
                a = int(ps.argmax())
                pe = F.log_softmax(self.end_scores(state, kind, torch.tensor([[a]], device=dev), read, pad)[0, 0], -1)
                z = int(pe.argmax())
                sure += float(ps[a]) + float(pe[z])
                parts["texts" if POINTERS[c - self.first_pointer] == "text" else "places"] += float(ps[a]) + float(pe[z])
                least = min(least, float(ps[a]), float(pe[z]))
                steps.append([POINTERS[c - self.first_pointer], a, z])
                prev, starts, ends = prev + [c], starts + [a], ends + [z]
            else:
                name = self.choices[c]
                steps.append(name)
                prev, starts, ends = prev + [c], starts + [0], ends + [0]
                if name == "eos" or name.startswith("none:"):
                    if name.startswith("none:"):
                        steps.append("eos")
                    break
        return steps, math.exp(sure), {**{k: math.exp(v) for k, v in parts.items()}, "least": math.exp(least)}
