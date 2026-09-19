'use strict';
const { json } = require('../lib/common');
const { reports, reportReasons } = require('../lib/reports-store');

function parseBody(req) {
  try {
    return JSON.parse(req.body || '{}');
  } catch (error) {
    return {};
  }
}

module.exports = async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Endast POST.' });
  const body = parseBody(req);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const videoId = typeof body.videoId === 'string' ? body.videoId.trim().slice(0, 80) : 'unknown';
  const details = typeof body.details === 'string' ? body.details.trim().slice(0, 500) : '';

  if (!reportReasons.has(reason)) {
    return json(400, { error: 'Ogiltig rapportanledning.' });
  }

  const report = {
    id: `RPT-${1043 + reports.length}`,
    category: reason,
    detail: `${details || 'Rapport från användare'} · video #${videoId}`,
    priority: reason === 'Sexuellt eller exploaterande innehåll' || reason === 'Olämplig kontakt' ? 'critical' : 'high',
    time: 'Nu',
    status: 'new',
  };
  reports.unshift(report);
  return json(201, { ok: true, reportId: report.id });
};
