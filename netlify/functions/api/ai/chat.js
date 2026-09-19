'use strict';
const fs = require('fs');
const path = require('path');
const { json } = require('../../lib/common');

// Modellen laddas en gång per function-instans (cold start ~100 ms).
let model = null;
let loadError = null;

function getModel() {
  if (!model && !loadError) {
    try {
      const { loadModel } = require('../../lib/vygen-node');
      model = loadModel(path.join(__dirname, 'vygen.bin'));
    } catch (error) {
      loadError = error.message;
    }
  }
  return model;
}

module.exports = async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Endast POST.' });
  const m = getModel();
  if (!m) {
    return json(503, { error: 'VY-Gen är inte redo ännu — modellen tränas.' });
  }

  let body = {};
  try {
    body = JSON.parse(req.body || '{}');
  } catch (error) {
    body = {};
  }
  const message = typeof body.message === 'string' ? body.message.slice(0, 300) : '';
  if (!message.trim()) {
    return json(400, { error: 'Skriv ett meddelande till VY-Gen.' });
  }

  const startedAt = Date.now();
  try {
    const { chat } = require('../../lib/vygen-node');
    const reply = chat(m, message);
    return json(200, { reply, ms: Date.now() - startedAt });
  } catch (error) {
    return json(500, { error: 'VY-Gen fastnade. Prova igen.' });
  }
};
