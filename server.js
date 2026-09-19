const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const publicDir = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.static(publicDir));

// The API is intentionally small and in-memory for the UI prototype. A real
// service needs authentication, role-based access, a database, encryption,
// retention rules and a verified moderation workflow before launch.
const reports = [
  { id: 'RPT-1042', category: 'Olämplig kontakt', detail: 'Rapport från 13–17-profil · video #aurora', priority: 'critical', time: '12:42', status: 'new' },
  { id: 'RPT-1041', category: 'Kommentarfilter', detail: 'Externa kontaktuppgifter · video #garden', priority: 'high', time: '12:18', status: 'new' },
  { id: 'RPT-1038', category: 'Farlig utmaning', detail: 'Automatisk flaggning · väntar på granskning', priority: 'low', time: '11:55', status: 'reviewed' },
];

const reportReasons = new Set([
  'Olämplig kontakt',
  'Sexuellt eller exploaterande innehåll',
  'Hot, hat eller mobbning',
  'Farlig utmaning eller självskada',
  'Annat som känns fel',
]);

app.get('/api/config', (req, res) => {
  res.json({
    app: 'VY',
    mode: 'prototype',
    ageMinimum: 13,
    directMessages: false,
    moderationEnabled: true,
    legalReviewRequired: true,
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'vy-safe-short-video' });
});

// VY-Gen: VY:s helt egna AI. Egen transformer-arkitektur, tränad från
// grunden i sandboxen — ingen extern API. Modellen laddas en gång i
// minnet; inferensen körs i denna process (ai/vygen-node.js).
let vygen = null;
let vygenLoadError = null;
try {
  const { loadModel } = require('./ai/vygen-node');
  vygen = loadModel(path.join(__dirname, 'ai', 'dist', 'vygen.bin'));
  console.log('VY-Gen klar:', vygen.nLayers, 'lager,', vygen.d, 'bredd, ~', (vygen.config.ctx), 'tecken kontext');
} catch (error) {
  vygenLoadError = error.message;
  console.warn('VY-Gen kunde inte laddas:', error.message);
}

app.get('/api/ai/status', (req, res) => {
  if (!vygen) {
    return res.json({ ready: false, name: 'VY-Gen', error: vygenLoadError });
  }
  let info = {};
  try {
    info = JSON.parse(require('fs').readFileSync(path.join(__dirname, 'ai', 'dist', 'model-info.json'), 'utf-8'));
  } catch (error) {
    info = {};
  }
  const { params, trainedChars } = info;
  res.json({
    ready: true,
    name: 'VY-Gen',
    params,
    trainedChars,
    ctx: vygen.config.ctx,
    dModel: vygen.config.d_model,
    layers: vygen.config.nLayers,
  });
});

app.post('/api/ai/chat', (req, res) => {
  if (!vygen) {
    return res.status(503).json({ error: 'VY-Gen är inte redo ännu — modellen tränas.' });
  }
  const message = typeof req.body?.message === 'string' ? req.body.message.slice(0, 300) : '';
  if (!message.trim()) {
    return res.status(400).json({ error: 'Skriv ett meddelande till VY-Gen.' });
  }
  const startedAt = Date.now();
  let reply;
  try {
    reply = require('./ai/vygen-node').chat(vygen, message);
  } catch (error) {
    console.error('VY-Gen inferens misslyckades:', error);
    return res.status(500).json({ error: 'VY-Gen fastnade. Prova igen.' });
  }
  return res.json({ reply, ms: Date.now() - startedAt });
});

app.get('/api/moderation/reports', (req, res) => {
  res.json(reports);
});

app.post('/api/reports', (req, res) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const videoId = typeof req.body?.videoId === 'string' ? req.body.videoId.trim().slice(0, 80) : 'unknown';
  const details = typeof req.body?.details === 'string' ? req.body.details.trim().slice(0, 500) : '';

  if (!reportReasons.has(reason)) {
    return res.status(400).json({ error: 'Ogiltig rapportanledning.' });
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
  return res.status(201).json({ ok: true, reportId: report.id });
});

app.patch('/api/moderation/reports/:id', (req, res) => {
  const report = reports.find((entry) => entry.id === req.params.id);
  if (!report) return res.status(404).json({ error: 'Rapporten hittades inte.' });
  report.status = req.body?.status === 'reviewed' ? 'reviewed' : report.status;
  return res.json(report);
});

// Keep the original WebRTC signalling channel available for the existing
// video-chat experiment in this repository.
io.on('connection', (socket) => {
  console.log('Användare ansluten:', socket.id);

  socket.on('offer', (data) => socket.broadcast.emit('offer', data));
  socket.on('answer', (data) => socket.broadcast.emit('answer', data));
  socket.on('candidate', (data) => socket.broadcast.emit('candidate', data));

  socket.on('disconnect', () => {
    console.log('Användare kopplad från:', socket.id);
  });
});

// Allow the single-page app to work when a preview route is refreshed.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`VY lyssnar på port ${PORT}`);
});
