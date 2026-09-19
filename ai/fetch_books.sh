#!/usr/bin/env bash
# Hämtar de svenska projekt-gutenberg-böcker korpuset bygger på.
# Kör (kräver nätverksåtkomst till github.com) innan build_corpus.py
# om böckerna inte redan finns i /tmp/books:
set -e
mkdir -p /tmp/books && cd /tmp/books
for repo in \
  "G-sta-Berling_36225" \
  "Svenska-folk-sagor-och-afventyr-Forsta-delen-hafte-1-och-hafte-2_57357" \
  "Roda-rummet-Skildringar-ur-artist-och-forfattarlivet_57052" \
  "Bannlyst_39147" \
  "Kultasydan_74028"
do
  [ -d "$repo" ] || git clone --depth 1 -q "https://github.com/GITenberg/$repo.git"
done
echo "Böcker ligger i /tmp/books"
