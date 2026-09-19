"""Sätt kvaliteten på den tränade modellen.

Kör:  .venv/bin/python ai/probe.py
Testar ett gäng promptar i det tränade chattformatet och skriver ut
vad modellen genererar. Använd efter varje omträning.
"""

import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).parent))
from vygen import VyGen  # noqa: E402

HERE = Path(__file__).parent

PROMPTS = [
    "ANVÄNDARE: hej\nVY-GEN: ",
    "ANVÄNDARE: vad är du\nVY-GEN: ",
    "ANVÄNDARE: vem är du\nVY-GEN: ",
    "ANVÄNDARE: vad kan du\nVY-GEN: ",
    "ANVÄNDARE: vad är VY\nVY-GEN: ",
    "ANVÄNDARE: varför finns det ingen DM i VY\nVY-GEN: ",
    "ANVÄNDARE: hur rapporterar jag något\nVY-GEN: ",
    "ANVÄNDARE: vad är en AI\nVY-GEN: ",
    "ANVÄNDARE: varför är himlen blå\nVY-GEN: ",
    "ANVÄNDARE: berätta en fakta\nVY-GEN: ",
    "ANVÄNDARE: jag mår inte bra\nVY-GEN: ",
    "ANVÄNDARE: vad ska jag göra om jag blir mobbad\nVY-GEN: ",
    "ANVÄNDARE: vad är två plus två\nVY-GEN: ",
    "ANVÄNDARE: säg ett skämt\nVY-GEN: ",
]


@torch.no_grad()
def generate(model, enc, vocab, prompt: str, max_new: int = 160, temp: float = 0.7, seed: int = 7) -> str:
    model.eval()
    torch.manual_seed(seed)
    ids = [enc[ch] for ch in prompt]
    out = []
    for step in range(max_new):
        window = ids[-256:]
        x = torch.tensor(window).unsqueeze(0)
        logits = model(x)[0, -1] / temp
        top_vals, top_ids = torch.topk(logits, min(40, len(vocab)))
        probs = torch.softmax(top_vals, 0)
        nid = int(top_ids[int(torch.multinomial(probs, 1))].item())
        ch = vocab[nid]
        out.append(ch)
        ids.append(nid)
        text_so_far = ''.join(out)
        if step > 15 and text_so_far.endswith('\n\n'):
            break
        if '\nANVÄNDARE:' in text_so_far:
            break
    return ''.join(out).strip()


def main() -> None:
    text = (HERE / 'corpus' / 'korpus_sv.txt').read_text(encoding='utf-8')
    vocab = sorted(set(text))
    enc = {ch: i for i, ch in enumerate(vocab)}
    model = VyGen(len(vocab))
    state = torch.load(HERE / 'dist' / 'vygen.pt', map_location='cpu')
    model.load_state_dict(state)
    for prompt in PROMPTS:
        reply = generate(model, enc, vocab, prompt)
        print(f'Q: {prompt.replace("ANVÄNDARE: ", "").strip()}\nA: {reply[:200]}\n')


if __name__ == '__main__':
    main()
