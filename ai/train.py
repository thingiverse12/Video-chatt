"""Tränar VY-Gen från grunden på korpus_sv.txt.

Kör:  .venv/bin/python ai/train.py
Sparar bästa checkpoint (efter valideringsförlust) till dist/vygen.pt
och skriver träningsstatistik till dist/training.json.
"""

import json
import math
import random
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).parent))
from vygen import DEFAULT_CONFIG, VyGen  # noqa: E402

HERE = Path(__file__).parent
DIST = HERE / 'dist'
CTX = DEFAULT_CONFIG['ctx']
BATCH = 8
EPOCHS = int(__import__('os').environ.get('VYGEN_EPOCHS', '4'))
DEV_CHARS = 40_000
LR = 3e-4
WARMUP = 120


def chunks(text: str, n: int, stride: int):
    for i in range(0, len(text) - n, stride):
        yield i, i + n


def make_batches(text: str, dev_chars: int = 0):
    """Delar texten i chunkar på CTX+1 (fråga + mål)."""
    train = text[:-dev_chars] if dev_chars else text
    dev = text[-dev_chars:] if dev_chars else ''
    train_items = [(i, i + CTX + 1) for i in range(0, len(train) - CTX, CTX)]
    dev_items = [(i, i + CTX + 1) for i in range(0, len(dev) - CTX, CTX)]
    return train, dev, train_items, dev_items


def build_vocab(text: str):
    vocab = sorted(set(text))
    return vocab, {ch: i for i, ch in enumerate(vocab)}


def to_ids(text: str, enc: dict) -> list[int]:
    return [enc[ch] for ch in text]


@torch.no_grad()
def evaluate(model, dev_items, text, enc, vocab) -> float:
    """Genomsnittlig förlust över alla valideringschunk."""
    model.eval()
    items = list(dev_items)
    random.shuffle(items)
    total, count = 0.0, 0
    for (i, j) in items:
        idx = [enc[ch] for ch in text[i:j]]
        x = torch.tensor(idx[:-1], dtype=torch.long).unsqueeze(0)
        y = torch.tensor(idx[1:], dtype=torch.long).unsqueeze(0)
        logits = model(x)
        loss = torch.nn.functional.cross_entropy(logits.transpose(1, 2), y)
        total += loss.item()
        count += 1
    model.train()
    return total / max(count, 1)


@torch.no_grad()
def generate(model, enc, vocab, prompt: str, max_new: int, temp: float, seed: int):
    model.eval()
    torch.manual_seed(seed)
    ids = [enc[ch] for ch in prompt]
    ctx_window = DEFAULT_CONFIG['ctx']
    out = []
    for step in range(max_new):
        window = ids[-ctx_window:]
        x = torch.tensor(window, dtype=torch.long).unsqueeze(0)
        logits = model(x)[0, -1] / temp
        top_vals, top_ids = torch.topk(logits, min(40, len(vocab)))
        probs = torch.softmax(top_vals, dim=0)
        next_id = int(top_ids[int(torch.multinomial(probs, 1).item())].item())
        ch = vocab[next_id]
        out.append(ch)
        ids.append(next_id)
        if ch == '\n' and step > 10:
            break
    model.train()
    return ''.join(out)


def main() -> None:
    DIST.mkdir(exist_ok=True)
    torch.set_num_threads(2)
    text = (HERE / 'corpus' / 'korpus_sv.txt').read_text(encoding='utf-8')
    vocab, enc = build_vocab(text)
    print(f'Korpus: {len(text)} tecken · ordförråd: {len(vocab)}')

    train, dev, train_items, dev_items = make_batches(text, DEV_CHARS)
    print(f'Träning: {len(train_items)} chunk · validering: {len(dev_items)} chunk')

    model = VyGen(len(vocab))
    n_params = model.num_params()
    print(f'Parametrar: {n_params:,}')

    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.1)

    def lr_for(step: int) -> float:
        if step < WARMUP:
            return LR * (step + 1) / WARMUP
        total = max(1, (len(train_items) // BATCH) * EPOCHS - WARMUP)
        progress = min(1.0, (step - WARMUP) / total)
        return LR * 0.3 * (1 + (1 + math.cos(math.pi * progress)) / 2) / 1.15

    best_dev, best_state = float('inf'), None
    history = []
    t0 = time.time()
    step = 0

    for epoch in range(EPOCHS):
        order = list(range(len(train_items)))
        random.shuffle(order)
        epoch_loss, n = 0.0, 0
        for b in range(0, len(order), BATCH):
            batch_ids = order[b:b + BATCH]
            xs = []
            for (i, j) in [train_items[k] for k in batch_ids]:
                ids = [enc[ch] for ch in text[i:j]]
                xs.append(ids)
            # liklängd genom att alla är CTX+1
            x = torch.tensor([row[:-1] for row in xs], dtype=torch.long)
            y = torch.tensor([row[1:] for row in xs], dtype=torch.long)
            logits = model(x)
            loss = torch.nn.functional.cross_entropy(logits.transpose(1, 2), y)
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            for group in optimizer.param_groups:
                group['lr'] = lr_for(step)
            optimizer.step()
            step += 1
            epoch_loss += loss.item() * x.numel()
            n += x.numel()
            if step % 200 == 0:
                print(f'ep {epoch + 1} step {step} loss {epoch_loss / n:.4f} lr {group["lr"]:.2e} ({time.time() - t0:.0f}s)')

        avg = epoch_loss / max(n, 1)
        dev_loss = evaluate(model, dev_items, text, enc, vocab)
        elapsed = time.time() - t0
        history.append({'epoch': epoch + 1, 'train': round(avg, 4), 'dev': round(dev_loss, 4), 'sec': round(elapsed, 1)})
        print(f'=== epoch {epoch + 1} train {avg:.4f} dev {dev_loss:.4f} ({elapsed:.0f}s)')
        if dev_loss < best_dev:
            best_dev = dev_loss
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
            torch.save(best_state, DIST / 'vygen.pt')
            print('*** ny bästa modell sparad')

    # Slutsamling för känsla
    print('\n--- Genererade prover ---')
    model.load_state_dict(best_state)
    prompts = [
        'ANVÄNDARE: hej\nVY-GEN:',
        'ANVÄNDARE: vad är du\nVY-GEN:',
        'ANVÄNDARE: varför är himlen blå\nVY-GEN:',
        'ANVÄNDARE: jag mår inte bra\nVY-GEN:',
        'ANVÄNDARE: vad är en AI\nVY-GEN:',
    ]
    for p in prompts:
        print(f'{p} {generate(model, enc, vocab, p, 120, 0.8, 42).strip()}\n')

    stats = {
        'params': n_params,
        'corpus_chars': len(text),
        'vocab_size': len(vocab),
        'best_dev_loss': round(best_dev, 4),
        'epochs': EPOCHS,
        'config': DEFAULT_CONFIG,
        'seconds': round(time.time() - t0, 1),
        'history': history,
    }
    (DIST / 'training.json').write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding='utf-8')
    print('\nKlart.')


if __name__ == '__main__':
    main()
