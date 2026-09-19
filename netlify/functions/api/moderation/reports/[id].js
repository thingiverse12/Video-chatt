'use strict';
const { json } = require('../../../lib/common');
const { reports } = require('../../../lib/reports-store');

module.exports = async (req) => {
  if (req.method !== 'PATCH') return json(405, { error: 'Endast PATCH.' });
  const id = (req.pathParameters && req.pathParameters.id) || String(req.url || '').split('/').pop();
  const report = reports.find((entry) => entry.id === id);
  if (!report) return json(404, { error: 'Rapporten hittades inte.' });

  let body = {};
  try {
    body = JSON.parse(req.body || '{}');
  } catch (error) {
    body = {};
  }
  if (body.status === 'reviewed') report.status = 'reviewed';
  return json(200, report);
};
