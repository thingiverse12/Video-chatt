"""Bygger VY-Gens träningskorpus, balanserat för chatt.

Källor:
  1. Skrivna dialoger (corpus/dialog_*.txt) — personan, kunskap och
     trygghetston. Vikts upp kraftigt: modellen ska i första hand lära sig
     chatt-formatet "ANVÄNDARE: ... / VY-GEN: ...".
  2. Offentliga domän-böcker på svenska (Projekt Gutenberg, GITenberg) —
     allmänt språk och ordförråd. Stickprovssamplas så att den gamla
     litterära stilen inte tar över.

Allt samlas i corpus/korpus_sv.txt, den sträng modellen tränas på.
"""

import random
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
CORPUS = HERE / 'corpus'
BOOKS = Path('/tmp/books')

DIALOG_REPEAT = 48     # dialogen ska styra beteendet
BOOK_FRACTION = 0.0    # 0 = ren dialogträning (böckerna kontaminerar chattformatet)
SEED = 13


def clean_book(text: str) -> str:
    """Tar bort Project Gutenberg-rapport och normaliserar."""
    m = re.search(r'\*\*\* START OF THIS PROJECT GUTENBERG EBOOK.*?\*\*\* END OF THE PROJECT GUTENBERG LICENSE', text, re.S)
    if m:
        text = text[: m.start()] + text[m.end():]
    m = re.search(r'\*\*\* START OF THE PROJECT GUTENBERG LICENSE.*?\*\*\* END OF THIS PROJECT GUTENBERG EBOOK', text, re.S)
    if m:
        text = text[: m.start()] + text[m.end():]
    text = re.sub(r'\s*\n\s*\n\s*\n+', '\n\n', text)
    text = re.sub(r'[ \t]+\n', '\n', text)
    return text.strip()


def sample_chunks(text: str, fraction: float, chunk: int = 4000, seed: int = SEED) -> str:
    """Slumpar ut ~fraction av texten i större stycken (behåller flyt)."""
    if fraction <= 0.0:
        return ''
    if fraction >= 1.0:
        return text
    rng = random.Random(seed)
    parts = [text[i:i + chunk] for i in range(0, len(text) - chunk, chunk)]
    keep = max(1, int(len(parts) * fraction))
    picked = rng.sample(parts, keep)
    # Behåll origination inom varje utvald del; blandar var de hamnar.
    rng.shuffle(picked)
    return ''.join(picked)


def main() -> None:
    CORPUS.mkdir(exist_ok=True)

    # 1. Böcker (stickprov)
    book_parts = []
    if BOOKS.exists():
        for txt in sorted(BOOKS.glob('*/*.txt')):
            content = clean_book(txt.read_text(encoding='utf-8', errors='ignore'))
            if len(content) > 5000:
                book_parts.append(f'### BOK: {txt.parent.name}\n\n{content}')
                print(f'{txt.parent.name}: {len(content)} tecken')
    books = sample_chunks('\n\n'.join(book_parts), BOOK_FRACTION)
    (CORPUS / 'books_sv.txt').write_text(books, encoding='utf-8')
    print(f'Böcker efter stickprov: {len(books)} tecken')

    # 2. Dialoger (viktas upp — dom ska styra chatt-beteendet)
    dialogs = []
    for f in sorted(CORPUS.glob('dialog_*.txt')):
        dialogs.append(f.read_text(encoding='utf-8').strip())
        print(f'{f.name}: {len(dialogs[-1])} tecken')
    dialog_block = '\n\n'.join(dialogs * DIALOG_REPEAT)
    print(f'Dialog (x{DIALOG_REPEAT}): {len(dialog_block)} tecken')

    # Blanda: dialogen först (dominerar träningens början), sedan böcker.
    mixed = dialog_block + '\n\n' + books
    out = CORPUS / 'korpus_sv.txt'
    out.write_text(mixed, encoding='utf-8')
    print(f'Korpus: {len(mixed)} tecken -> {out.name}')
    print('Unika tecken:', len(set(mixed)))


if __name__ == '__main__':
    sys.exit(main())
