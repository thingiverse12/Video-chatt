"""Exporterar tränad VY-Gen till en binärfil som Node.js kan ladda.

Format (VYGEN1):
  byte 0-5    : 'VYGEN1'
  byte 6-9    : längden på JSON-huvudet (little-endian u32)
  byte 10-... : JSON-huvud {vocab, config, param_order}
  sedan       : float32-matriser i param_order-ordning (flata)

Kör:  .venv/bin/python ai/export_model.py
"""

import json
import struct
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).parent))
from vygen import DEFAULT_CONFIG  # noqa: E402

HERE = Path(__file__).parent
DIST = HERE / 'dist'


def main() -> None:
    state = torch.load(DIST / 'vygen.pt', map_location='cpu')
    stats = json.loads((DIST / 'training.json').read_text(encoding='utf-8'))
    text = (HERE / 'corpus' / 'korpus_sv.txt').read_text(encoding='utf-8')
    vocab = sorted(set(text))
    cfg = stats['config']

    # Fast, känd parameterradning så att Node kan bygga samma matriser.
    order = []
    d = cfg['d_model']
    order.append(('tok.weight', (len(vocab), d)))
    order.append(('pos.weight', (cfg['ctx'], d)))
    for L in range(cfg['n_layers']):
        order.append((f'blocks.{L}.ln1.weight', (d,)))
        order.append((f'blocks.{L}.ln1.bias', (d,)))
        order.append((f'blocks.{L}.attn.w_qkv.weight', (3 * d, d)))
        order.append((f'blocks.{L}.attn.w_qkv.bias', (3 * d,)))
        order.append((f'blocks.{L}.attn.w_out.weight', (d, d)))
        order.append((f'blocks.{L}.ln2.weight', (d,)))
        order.append((f'blocks.{L}.ln2.bias', (d,)))
        order.append((f'blocks.{L}.w1.weight', (cfg['d_ff'], d)))
        order.append((f'blocks.{L}.w1.bias', (cfg['d_ff'],)))
        order.append((f'blocks.{L}.w2.weight', (d, cfg['d_ff'])))
    order.append(('ln_f.weight', (d,)))
    order.append(('ln_f.bias', (d,)))

    flat = []
    for name, shape in order:
        tensor = state[name].detach().reshape(-1).contiguous()
        expected = 1
        for dim in shape:
            expected *= dim
        assert tensor.numel() == expected, (name, shape, tensor.shape)
        flat.append(tensor)

    header = {
        'magic': 'VYGEN1',
        'vocab': vocab,
        'config': cfg,
        'param_order': order,
        'params': stats['params'],
        'corpus_chars': stats['corpus_chars'],
        'best_dev_loss': stats['best_dev_loss'],
    }
    header_json = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    # Upplaga till 4-byte så att float32-delen hamnar på bra adress.
    pad = (-len(header_json)) % 4
    header_padded = header_json + b'\x00' * pad

    out = DIST / 'vygen.bin'
    with open(out, 'wb') as f:
        f.write(b'VYGEN1')
        f.write(struct.pack('<I', len(header_json)))
        f.write(header_padded)
        for tensor in flat:
            f.write(tensor.numpy().tobytes())
    (DIST / 'model-info.json').write_text(
        json.dumps({'params': stats['params'], 'trainedChars': stats['corpus_chars']}, ensure_ascii=False),
        encoding='utf-8',
    )
    size_mb = out.stat().st_size / 1e6
    print(f'Export: {out.name} ({size_mb:.1f} MB) · {stats["params"]:,} parametrar · dev {stats["best_dev_loss"]}')


if __name__ == '__main__':
    main()
