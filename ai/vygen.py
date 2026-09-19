"""VY-Gen — en helt egen liten språkmodell.

Egna transformer-arkitektur, egen kod, tränad från grunden i VY:s sandbox.
Char-level (varje tecken är en token) — inga externa tokenizer, inga APIs.

Modellen är medvetet liten (ryms i serverminnet och kör på CPU) men den
följer samma grundprincip som de stora modellerna: inbäddningar,
uppmärksamhet (attention), positioner och ett språkhuvud (LM head) som
delar vikter med inbäddningarna.
"""

import math

import torch
import torch.nn as nn
import torch.nn.functional as F

DEFAULT_CONFIG = {
    'd_model': 256,
    'n_heads': 4,
    'n_layers': 4,
    'd_ff': 1024,
    'ctx': 256,
}


def gelu(x: torch.Tensor) -> torch.Tensor:
    return 0.5 * x * (1.0 + torch.erf(x / math.sqrt(2.0)))


class VYAttention(nn.Module):
    def __init__(self, d_model: int, n_heads: int):
        super().__init__()
        assert d_model % n_heads == 0
        self.n_heads = n_heads
        self.head_dim = d_model // n_heads
        # En enda matris för Q, K och V (sparar parametrar).
        self.w_qkv = nn.Linear(d_model, 3 * d_model)
        self.w_out = nn.Linear(d_model, d_model, bias=False)

    def qkv(self, x: torch.Tensor):
        """Delar upp i (q, k, v) med form (batch, heads, seq, head_dim)."""
        b, t, d = x.shape
        q, k, v = self.w_qkv(x).chunk(3, dim=2)
        shape = (b, t, self.n_heads, self.head_dim)
        return q.view(shape).transpose(1, 2), k.view(shape).transpose(1, 2), v.view(shape).transpose(1, 2)

    def forward(self, x: torch.Tensor, k_cache=None, v_cache=None):
        """x: (b, t, d). k_cache/v_cache: (b, heads, p, head_dim) eller None."""
        b, t, d = x.shape
        q, k, v = self.qkv(x)
        if k_cache is not None:
            k = torch.cat([k_cache, k], dim=2)
            v = torch.cat([v_cache, v], dim=2)
        p = k.size(2)  # total nyckellängd (prefix + nytt)
        base = p - t  # absolut position för det första nya tokenet

        logits = q @ k.transpose(-2, -1) / math.sqrt(self.head_dim)
        i = torch.arange(base, base + t, device=x.device).view(-1, 1)
        j = torch.arange(p, device=x.device).view(1, -1)
        mask = i >= j  # True där frågan får se nyckeln (kausal)
        logits = logits.masked_fill(~mask[None, None], float('-inf'))
        attn = F.softmax(logits, dim=-1)
        out = (attn @ v).transpose(1, 2).reshape(b, t, d)
        return self.w_out(out), k, v


class VYBlock(nn.Module):
    def __init__(self, d_model: int, n_heads: int, d_ff: int):
        super().__init__()
        self.ln1 = nn.LayerNorm(d_model)
        self.attn = VYAttention(d_model, n_heads)
        self.ln2 = nn.LayerNorm(d_model)
        self.w1 = nn.Linear(d_model, d_ff)
        self.w2 = nn.Linear(d_ff, d_model, bias=False)

    def forward(self, x: torch.Tensor, caches=None):
        h = self.ln1(x)
        a, k, v = self.attn(h, caches[0] if caches else None, caches[1] if caches else None)
        x = x + a
        h = self.w1(self.ln2(x))
        x = x + self.w2(gelu(h))
        return x, (k, v)


class VyGen(nn.Module):
    """Liten char-level GPT med delat språkhuvud."""

    def __init__(self, vocab_size: int, config: dict | None = None):
        super().__init__()
        cfg = {**DEFAULT_CONFIG, **(config or {})}
        self.config = cfg
        d, ctx = cfg['d_model'], cfg['ctx']
        self.tok = nn.Embedding(vocab_size, d)
        self.pos = nn.Embedding(ctx, d)
        # Små inledande vikter (som GPT-2) — annars blir logiterna enorma
        # i början av träningen.
        nn.init.normal_(self.tok.weight, std=0.02)
        nn.init.normal_(self.pos.weight, std=0.02)
        self.blocks = nn.ModuleList([VYBlock(d, cfg['n_heads'], cfg['d_ff']) for _ in range(cfg['n_layers'])])
        self.ln_f = nn.LayerNorm(d)

    def num_params(self) -> int:
        return sum(p.numel() for p in self.parameters())

    def forward(self, x: torch.Tensor, start_pos: int = 0, caches=None) -> torch.Tensor:
        """x: (batch, seq_len) med teckenindex. Returnerar log-odds (b, t, vocab)."""
        b, t = x.shape
        offs = torch.arange(start_pos, start_pos + t, device=x.device)
        h = self.tok(x) + self.pos(offs)
        new_caches = []
        for i, block in enumerate(self.blocks):
            h, kv = block(h, caches[i] if caches else None)
            new_caches.append(kv)
        logits = self.ln_f(h) @ self.tok.weight.t()  # delat språkhuvud
        if caches is not None:
            return logits, new_caches
        return logits
