'use strict';
const fs = require('fs');
const path = require('path');
const { json } = require('../../lib/common');

let cached = null;
function info() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'model-info.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    cached = { ready: true, name: 'VY-Gen', ...parsed, ctx: 256, dModel: 256 };
  } catch (error) {
    cached = { ready: false, name: 'VY-Gen' };
  }
  return cached;
}

module.exports = () => json(200, info());
