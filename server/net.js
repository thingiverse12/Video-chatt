// Socket.io-gränssnittet mot spelet.

import { Game } from './game.js';

export function attach(io) {
  const game = new Game(io);

  io.on('connection', (socket) => {
    socket.on('join', (data) => {
      try { game.join(socket, data || {}); } catch (e) { console.error('[join]', e); }
    });

    socket.on('input', (d) => { try { game.setInput(socket.id, d); } catch (e) { /* ignorera */ } });

    socket.on('attack', (d) => { try { game.attack(socket.id, d); } catch (e) { console.error('[attack]', e); } });
    socket.on('interact', (d) => { try { game.interact(socket.id, d); } catch (e) { console.error('[interact]', e); } });
    socket.on('respawn', () => {
      try {
        const p = game.players.get(socket.id);
        if (p && p.dead) game.respawn(p);
      } catch (e) { console.error('[respawn]', e); }
    });

    socket.on('craft', (d) => { try { game.craft(socket.id, d || {}); } catch (e) { console.error('[craft]', e); } });
    socket.on('place', (d) => { try { game.place(socket.id, d || {}); } catch (e) { console.error('[place]', e); } });
    socket.on('demolish', (d) => { try { game.demolish(socket.id, d); } catch (e) { console.error('[demolish]', e); } });
    socket.on('upgrade', (d) => { try { game.upgrade(socket.id, d); } catch (e) { console.error('[upgrade]', e); } });

    socket.on('inv:move', (d) => { try { game.invMove(socket.id, d || {}); } catch (e) { console.error('[inv:move]', e); } });
    socket.on('inv:use', (d) => { try { game.invUse(socket.id, d || {}); } catch (e) { console.error('[inv:use]', e); } });
    socket.on('inv:drop', (d) => { try { game.dropItem(socket.id, d || {}); } catch (e) { console.error('[inv:drop]', e); } });
    socket.on('hotbar', (d) => { try { game.hotbar(socket.id, d || {}); } catch (e) { console.error('[hotbar]', e); } });

    socket.on('box:xfer', (d) => { try { game.boxXfer(socket.id, d || {}); } catch (e) { console.error('[box:xfer]', e); } });
    socket.on('box:close', () => { try { game.closeBox(socket.id); } catch (e) { /* ignorera */ } });

    socket.on('chat', (d) => { try { game.chat(socket.id, d && d.text); } catch (e) { /* ignorera */ } });
    socket.on('ping', (t) => socket.emit('pong', t));

    // Legacy WebRTC-signalering för den gamla videochatten på /legacy
    for (const ev of ['offer', 'answer', 'candidate']) {
      socket.on(ev, (data) => socket.broadcast.emit(ev, data));
    }

    // Felsökning: klienten rapporterar sina fel hit
    socket.on('clientError', (msg) => console.warn('[klientfel]', String(msg).slice(0, 400)));

    socket.on('disconnect', () => { try { game.leave(socket); } catch (e) { console.error('[leave]', e); } });
  });

  return game;
}
