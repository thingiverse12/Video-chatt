'use strict';
/* Jämför JS-inferensen mot PyTorch-logiterna från test_crosscheck.py. */
const fs = require('fs');
const { loadModel, logitsFor } = require('./vygen-node');

const { prompt, ref } = JSON.parse(fs.readFileSync('/tmp/test-vygen-ref.json', 'utf-8'));
const model = loadModel('/tmp/test-vygen.bin');
const got = logitsFor(model, prompt);

if (!got || got.length !== ref.length) {
  console.error('FAIL: fel storlek', got && got.length, ref.length);
  process.exit(1);
}

let maxDiff = 0;
for (let i = 0; i < ref.length; i++) maxDiff = Math.max(maxDiff, Math.abs(got[i] - ref[i]));
const argmax = (a) => a.reduce((best, v, i) => (v > a[best] ? i : best), 0);

console.log('max abs diff:', maxDiff.toExponential(3));
console.log('argmax pytorch:', argmax(ref), 'argmax js:', argmax(got));
if (maxDiff > 1e-3 || argmax(got) !== argmax(ref)) {
  console.error('FAIL: logiterna stämmer inte överens');
  process.exit(1);
}
console.log('OK: JS och PyTorch ger samma resultat');
