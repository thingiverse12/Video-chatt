/**
 * Nätverksklient: WebSocket med återanslutning, ping-mätning och enkel
 * händelsebuss. All speltrafik är JSON.
 */

export class Net {
  constructor(url) {
    this.url = url || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    this.handlers = new Map();
    this.connected = false;
    this.latency = 0;
    this.pingTimer = null;
    this.lastPing = 0;
    this.playerToken = localStorage.getItem('rust_token') || null;
    this.name = localStorage.getItem('rust_name') || '';
    this.wantReconnect = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  emit(type, payload) {
    const list = this.handlers.get(type);
    if (!list) return;
    for (const fn of list) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`Fel i hanterare för ${type}:`, err);
      }
    }
  }

  connect(name, token) {
    this.wantReconnect = true;
    if (name) {
      this.name = name;
      localStorage.setItem('rust_name', name);
    }
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('Timeout: servern svarar inte')), 8000);
      ws.addEventListener('open', () => {
        this.connected = true;
        this.emit('open');
        ws.send(JSON.stringify({ t: 'join', name: this.name, token: token ?? this.playerToken }));
      });
      ws.addEventListener('message', (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === 'welcome') {
          clearTimeout(timer);
          this.playerToken = msg.you.token;
          localStorage.setItem('rust_token', msg.you.token);
          this.emit('welcome', msg);
          resolve(msg);
        }
        if (msg.t === 'pong') {
          this.latency = Math.round(performance.now() - msg.c);
          this.emit('latency', this.latency);
          return;
        }
        this.emit(msg.t, msg);
      });
      ws.addEventListener('close', () => {
        this.connected = false;
        this.emit('close');
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        const hint =
          location.protocol === 'https:' && location.port !== ''
            ? 'Kunde inte öppna WebSocket mot ' + location.host + '. Testa att köra servern lokalt (node server/index.js) och öppna http://localhost:3000.'
            : 'Kunde inte ansluta till servern. Kör du "node server/index.js"?';
        this.emit('error', new Error(hint));
        reject(new Error(hint));
      });
    });
  }

  startPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      this.lastPing = Math.round(performance.now());
      this.send({ t: 'ping', c: this.lastPing });
    }, 2000);
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }
}
