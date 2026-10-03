/**
 * HTTP-server (statiska filer + litet REST-API) och WebSocket-endpoint /ws.
 * Inga externa beroenden – kör med `node server.js`.
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Game, TICK_HZ, SNAPSHOT_EVERY } from './game.js';
import { attachWebSocket } from './ws.js';
import { loadSave, writeSave } from './persistence.js';
import { CONFIG } from '../shared/worldgen.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC = join(ROOT, 'public');
const SHARED = join(ROOT, 'shared');
const DATA = join(ROOT, 'data');
const SAVE_PATH = process.env.SAVE_PATH || join(DATA, 'save.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const AUTOSAVE_MS = 30000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

// ------------------------------------------------------------------ spelstart

const save = loadSave(SAVE_PATH);
const game = new Game({
  save,
  net: {
    send: (id, obj) => {
      const p = game.players.get(id);
      if (p && p.conn && p.conn.open) p.conn.send(obj);
    },
    broadcast: (obj) => {
      const str = JSON.stringify(obj);
      for (const p of game.players.values()) {
        if (p.connected && p.conn && p.conn.open) p.conn.send(str);
      }
    },
    broadcastExcept: (id, obj) => {
      const str = JSON.stringify(obj);
      for (const p of game.players.values()) {
        if (p.id !== id && p.connected && p.conn && p.conn.open) p.conn.send(str);
      }
    },
  },
});

// -------------------------------------------------------------------- HTTP

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      return handleApi(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      return res.end('Method Not Allowed');
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    // shared/ exponeras så att klienten kan importera samma spelkod som servern
    let filePath = rel.startsWith('/shared/')
      ? join(SHARED, rel.slice('/shared/'.length))
      : join(PUBLIC, rel);
    const resolved = resolve(filePath);
    const insideRoot = resolved === PUBLIC || resolved.startsWith(PUBLIC + sep) || resolved === SHARED || resolved.startsWith(SHARED + sep);
    if (!insideRoot) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (!existsSync(resolved)) {
      // SPA-fallback
      const idx = join(PUBLIC, 'index.html');
      if (!existsSync(idx)) {
        res.writeHead(404);
        return res.end('Not found');
      }
      filePath = idx;
    } else {
      filePath = resolved;
    }
    const info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = join(filePath, 'index.html');
    }
    const body = await readFile(filePath);
    const headers = {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': filePath.includes('/vendor/') ? 'public, max-age=86400' : 'no-cache',
    };
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    console.error('HTTP-fel:', err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
});

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw new Error('för stor');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/status') {
    let terrainHeight = null;
    return json(res, 200, {
      online: game.onlineCount,
      players: [...game.players.values()].map((p) => ({
        name: p.name,
        online: !!p.connected,
        sleeper: !!p.sleeper,
        kills: p.kills,
        deaths: p.deaths,
        playtime: Math.round(p.stats?.playtime || 0),
      })),
      buildings: game.index.size,
      bags: game.bags.size,
      tick: game.tickCount,
      day: +game.dayFraction.toFixed(3),
      time: +game.time.toFixed(1),
      seed: game.world.seed,
      nodes: game.world.nodes.length,
      savePath: SAVE_PATH,
    });
  }
  if (url.pathname === '/api/leaderboard') {
    const list = [...game.players.values()]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
      .slice(0, 20)
      .map((p) => ({ name: p.name, kills: p.kills, deaths: p.deaths, built: p.stats?.built || 0, gathered: Math.round(p.stats?.gathered || 0) }));
    return json(res, 200, { list });
  }
  if (url.pathname === '/api/register' && req.method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 16);
    if (name.length < 2) return json(res, 400, { error: 'Namnet måste vara minst 2 tecken' });
    const key = name.toLowerCase();
    const existing = game.tokens[key];
    if (existing && body.password && existing.password && existing.password !== String(body.password)) {
      return json(res, 409, { error: 'Namnet är upptaget' });
    }
    game.tokens[key] = { token: existing?.token || makeToken(), password: body.password ? String(body.password) : existing?.password || null };
    return json(res, 200, { ok: true, name });
  }
  if (url.pathname === '/api/save' && req.method === 'POST') {
    const ok = writeSave(SAVE_PATH, game.serialize());
    return json(res, ok ? 200 : 500, { ok, path: SAVE_PATH });
  }
  return json(res, 404, { error: 'Okänd endpoint' });
}

function makeToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// --------------------------------------------------------------- WebSocket

attachWebSocket(server, '/ws', (conn) => {
  conn.onMessage = (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!conn.data.playerId) {
      if (msg.t !== 'join') return;
      const name = String(msg.name || '').replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().slice(0, 16);
      if (name.length < 2) {
        conn.send({ t: 'error', msg: 'Välj ett namn med minst 2 tecken' });
        return;
      }
      const res = game.join(conn, { name, token: msg.token, password: msg.password });
      if (res.error) {
        conn.send({ t: 'error', msg: res.error });
        return;
      }
      const p = res.player;
      conn.send(game.welcome(p));
      game.net.broadcast({ t: 'roster', add: [{ id: p.id, name: p.name, sleeper: 0 }] }, );
      console.log(`${p.name} anslöt (${game.onlineCount} online)`);
      game.pushChat('Server', `${p.name} anslöt`, true);
      return;
    }
    try {
      game.handle(conn.data.playerId, msg);
    } catch (err) {
      console.error('Fel i meddelandehantering:', err);
    }
  };
  conn.onClose = () => {
    const id = conn.data.playerId;
    if (!id) return;
    const p = game.players.get(id);
    game.leave(id);
    if (p) {
      console.log(`${p.name} kopplade från (${game.onlineCount} online)`);
      game.pushChat('Server', `${p.name} kopplade från (sover vidare i världen)`, true);
      game.net.broadcast({ t: 'roster', upd: [{ id: p.id, sleeper: 1 }] });
    }
  };
  conn.onPong = () => {
    conn.isAlive = true;
  };
});

// ------------------------------------------------------------------- loopar

let last = process.hrtime.bigint();
let acc = 0;
const STEP = 1 / TICK_HZ;

setInterval(() => {
  const now = process.hrtime.bigint();
  let dt = Number(now - last) / 1e9;
  last = now;
  if (dt > 0.5) dt = STEP; // pausad/blockerad process – hoppa inte ikapp allt
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 5) {
    try {
      game.tick(STEP);
    } catch (err) {
      console.error('Fel i spelloopen:', err);
    }
    acc -= STEP;
    steps++;
  }
}, 1000 / TICK_HZ);

// ping var 20:e sekund, kasta döda anslutningar
setInterval(() => {
  for (const p of game.players.values()) {
    if (!p.connected || !p.conn) continue;
    if (!p.conn.isAlive) {
      p.conn.close(1001, 'ping timeout');
      continue;
    }
    p.conn.isAlive = false;
    p.conn.ping();
  }
}, 20000);

// autospara
setInterval(() => {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
  writeSave(SAVE_PATH, game.serialize());
}, AUTOSAVE_MS);

function shutdown() {
  console.log('\nSparar världen...');
  writeSave(SAVE_PATH, game.serialize());
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`RUST-MVP server kör på http://localhost:${PORT}`);
  console.log(`  seed ${game.world.seed}, ${game.world.nodes.length} resurspunkter, ${game.index.size} byggdelar i sparfilen`);
  console.log(`  sparfil: ${SAVE_PATH}`);
});

export { game, server };
