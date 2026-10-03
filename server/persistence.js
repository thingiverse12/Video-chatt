// Enkel JSON-persistens (data/ är gitignorerad).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, '..', 'data');
const FILE = process.env.SAVE_FILE ? path.resolve(process.env.SAVE_FILE) : path.join(DIR, 'save.json');

export function loadSave() {
  try {
    if (!fs.existsSync(FILE)) return null;
    const raw = fs.readFileSync(FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[save] kunde inte läsa:', e.message);
    return null;
  }
}

export function writeSave(data) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, FILE);
    return true;
  } catch (e) {
    console.warn('[save] kunde inte spara:', e.message);
    return false;
  }
}
