// Nätverkslager mot socket.io (servern är auktoritativ).

const defaultFactory = () => {
  if (typeof window === 'undefined' || !window.io) throw new Error('socket.io saknas');
  return window.io({ transports: ['websocket', 'polling'], reconnectionAttempts: 6 });
};

export class Net {
  constructor(factory = defaultFactory) {
    this.factory = factory;
    this.handlers = new Map();
    this.socket = null;
    this.connected = false;
    this.queue = [];
    this.pingMs = 0;
    this._pingTimer = null;
  }

  connect() {
    this.socket = this.factory();
    this.socket.on('connect', () => {
      this.connected = true;
      const q = this.queue.splice(0, this.queue.length);
      for (const [ev, data] of q) this.socket.emit(ev, data);
      this._startPing();
      this._fire('connect');
    });
    this.socket.on('disconnect', () => { this.connected = false; this._fire('disconnect'); });
    this.socket.on('connect_error', (e) => this._fire('error', e && e.message));
    for (const [ev, list] of this.handlers) {
      this.socket.on(ev, (data) => { for (const cb of list) cb(data); });
    }
    return this.socket;
  }

  on(ev, cb) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, []);
    this.handlers.get(ev).push(cb);
    if (this.socket) this.socket.on(ev, (data) => cb(data));
    return this;
  }

  emit(ev, data) {
    if (this.socket && this.connected) { this.socket.emit(ev, data); return true; }
    if (this.queue.length < 32) this.queue.push([ev, data]);   // skickas vid anslutning
    return false;
  }

  _startPing() {
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      const t0 = performance.now();
      this.emit('ping', t0);
    }, 3000);
  }

  _fire(ev, data) {
    const list = this.handlers.get(ev);
    if (list) for (const cb of list) cb(data);
  }
}
