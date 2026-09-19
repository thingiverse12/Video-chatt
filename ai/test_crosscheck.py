"""Tvärvalidering: JS-inferensen måste ge samma log-odds som PyTorch.

Skapar en miniatyrmodell med slumpvikt, exporterar den i VYGEN1-format och
sparar referens-logiterna. test-vygen-node.js jämför sedan.
"""

import json
import struct
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).parent))
from vygen import VyGen  # noqa: E402


def main() -> None:
    torch.manual_seed(7)
    cfg = {'d_model': 32, 'n_heads': 2, 'n_layers': 2, 'd_ff': 64, 'ctx': 40}
    vocab = sorted(set('abcdefghijklmnopqrstuvwxyz åäö ÅÄÖ ,.!?'))
    model = VyGen(len(vocab), cfg)
    prompt = 'hej världen åäö, vad är du?'

    with torch.no_grad():
        logits = model(torch.tensor([[vocab.index(c) for c in prompt]]))[0, -1]
    ref = logits.tolist()

    # Export i VYGEN1-format (samma layout som export_model.py).
    d = cfg['d_model']
    order = [('tok.weight', (len(vocab), d)), ('pos.weight', (cfg['ctx'], d))]
    for L in range(cfg['n_layers']):
        order += [
            (f'blocks.{L}.ln1.weight', (d,)), (f'blocks.{L}.ln1.bias', (d,)),
            (f'blocks.{L}.attn.w_qkv.weight', (3 * d, d)), (f'blocks.{L}.attn.w_qkv.bias', (3 * d,)),
            (f'blocks.{L}.attn.w_out.weight', (d, d)),
            (f'blocks.{L}.ln2.weight', (d,)), (f'blocks.{L}.ln2.bias', (d,)),
            (f'blocks.{L}.w1.weight', (cfg['d_ff'], d)), (f'blocks.{L}.w1.bias', (cfg['d_ff'],)),
            (f'blocks.{L}.w2.weight', (d, cfg['d_ff'])),
        ]
    order += [('ln_f.weight', (d,)), ('ln_f.bias', (d,))]

    header = {'magic': 'VYGEN1', 'vocab': vocab, 'config': cfg, 'param_order': order,
              'params': model.num_params(), 'corpus_chars': 0, 'best_dev_loss': 0.0}
    header_json = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    header_json += b'\x00' * ((-len(header_json)) % 4)

    out = Path('/tmp/test-vygen.bin')
    with open(out, 'wb') as f:
        f.write(b'VYGEN1')
        f.write(struct.pack('<I', len(header_json) - ((-len(header_json)) % 4)))
        f.write(header_json)
        for name, _ in order:
            f.write(model.state_dict()[name].detach().numpy().tobytes())

    Path('/tmp/test-vygen-ref.json').write_text(json.dumps({'prompt': prompt, 'ref': ref}))
    print('OK: /tmp/test-vygen.bin + ref-logits (argmax', int(logits.argmax()), ')')


if __name__ == '__main__':
    main()
