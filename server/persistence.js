/**
 * Enkel persistens: hela världen sparas som JSON (atomiskt via temp-fil).
 * Räcker för en MVP-server med en process.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function loadSave(path) {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('Kunde inte läsa sparfilen:', err.message);
    return null;
  }
}

export function writeSave(path, data) {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = path + '.tmp';
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, path);
    return true;
  } catch (err) {
    console.error('Kunde inte skriva sparfilen:', err.message);
    return false;
  }
}
