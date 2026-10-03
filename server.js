// RUST-MVP – serverentry (Express + Socket.io + Three.js-klient).

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { attach } from './server/net.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 2e6,
  pingInterval: 10000,
  pingTimeout: 20000,
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '0' }));
app.use('/shared', express.static(path.join(__dirname, 'shared'), { maxAge: '0' }));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three'), { maxAge: '7d' }));

const game = attach(io);

app.get('/api/stats', (req, res) => res.json(game.stats()));
app.get('/healthz', (req, res) => res.send('ok'));

// Den gamla videochatten ligger kvar under /legacy/
app.get('/legacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'legacy', 'index.html')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  RUST-MVP server: http://0.0.0.0:${PORT}`);
  console.log(`  Statistik:       http://0.0.0.0:${PORT}/api/stats\n`);
});

let saved = false;
function shutdown() {
  if (saved) return;
  saved = true;
  try { game.save(); console.log('[save] världen sparad'); } catch (e) { console.error(e); }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (e) => { console.error('[uncaught]', e); });
process.on('unhandledRejection', (e) => { console.error('[unhandled]', e); });
