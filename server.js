const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const publicDir = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.json());
app.use(express.static(publicDir));

// This endpoint powers the UI only. A real VPN tunnel still requires a native
// client and an actual VPN gateway (for example, a WireGuard server).
app.get('/api/config', (req, res) => {
  res.json({
    app: 'NOVA',
    mode: 'prototype',
    onlineLocations: 24,
    tunnelAvailable: false,
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'nova-private-browser' });
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
  console.log(`NOVA lyssnar på port ${PORT}`);
});
