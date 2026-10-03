/**
 * Minimal WebSocket-server (RFC 6455) utan externa beroenden.
 * Klarar handskakning, text/binary-ramar, fragmentering, ping/pong och close.
 * Räcker gott för spelets JSON-protokoll.
 */

import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 1 << 20; // 1 MB
const MAX_BUFFER = 4 << 20;

const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BIN = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

export const STATUS_TEXT = {
  1000: 'Normal',
  1001: 'Going Away',
  1002: 'Protocol Error',
  1003: 'Unsupported Data',
  1008: 'Policy Violation',
  1009: 'Too Big',
  1011: 'Internal Error',
};

export class WebSocketConnection {
  constructor(socket, req) {
    this.socket = socket;
    this.req = req;
    this.open = true;
    this.isAlive = true;
    this._buf = Buffer.alloc(0);
    this._fragments = [];
    this._fragmentOp = 0;
    this.onMessage = null;
    this.onClose = null;
    this.onPong = null;
    this.data = {}; // fri plats för speldata
    this._sentBytes = 0;
    this._recvBytes = 0;

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', () => this.close(1011));
    socket.on('close', () => this._finish(1006));
    socket.setTimeout(0);
    socket.setNoDelay(true);
  }

  get bufferedAmount() {
    return this.socket.writableLength || 0;
  }

  _onData(chunk) {
    this._recvBytes += chunk.length;
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    if (this._buf.length > MAX_BUFFER) {
      this.close(1009);
      return;
    }
    try {
      this._parse();
    } catch (err) {
      console.error('WebSocket-protokollfel:', err.message);
      this.close(1002);
    }
  }

  _parse() {
    for (;;) {
      const buf = this._buf;
      if (buf.length < 2) return;
      const b0 = buf[0];
      const b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const rsv = b0 & 0x70;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (rsv !== 0) throw new Error('rsv');
      if (!masked) throw new Error('klienten måste maska');
      if (len === 126) {
        if (buf.length < offset + 2) return;
        len = buf.readUInt16BE(offset);
        offset += 2;
      } else if (len === 127) {
        if (buf.length < offset + 8) return;
        const big = buf.readBigUInt64BE(offset);
        if (big > BigInt(MAX_PAYLOAD)) throw new Error('för stor');
        len = Number(big);
        offset += 8;
      }
      if (len > MAX_PAYLOAD) throw new Error('för stor');
      if (buf.length < offset + 4) return;
      const mask = buf.subarray(offset, offset + 4);
      offset += 4;
      if (buf.length < offset + len) return;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = buf[offset + i] ^ mask[i & 3];
      this._buf = buf.subarray(offset + len);

      if (opcode === OP_PING) {
        this._sendFrame(OP_PONG, payload);
        continue;
      }
      if (opcode === OP_PONG) {
        this.isAlive = true;
        if (this.onPong) this.onPong();
        continue;
      }
      if (opcode === OP_CLOSE) {
        this.close(1000);
        return;
      }
      if (opcode === OP_CONT) {
        if (!this._fragmentOp) throw new Error('oväntad fortsättning');
        this._fragments.push(payload);
      } else if (opcode === OP_TEXT || opcode === OP_BIN) {
        if (this._fragmentOp) throw new Error('fragmenteringsfel');
        this._fragmentOp = opcode;
        this._fragments = [payload];
      } else {
        throw new Error('okänd opcode');
      }
      if (fin) {
        const full = this._fragments.length === 1 ? this._fragments[0] : Buffer.concat(this._fragments);
        const isBinary = this._fragmentOp === OP_BIN;
        this._fragments = [];
        this._fragmentOp = 0;
        if (this.onMessage) this.onMessage(isBinary ? full : full.toString('utf8'), isBinary);
      }
    }
  }

  _sendFrame(opcode, payload) {
    if (!this.open || this.socket.destroyed) return false;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    this._sentBytes += len + header.length;
    try {
      this.socket.write(header);
      return this.socket.write(payload);
    } catch (err) {
      this.close(1011);
      return false;
    }
  }

  send(data) {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    return this._sendFrame(OP_TEXT, Buffer.from(str, 'utf8'));
  }

  ping() {
    return this._sendFrame(OP_PING, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    this.open = false;
    const r = Buffer.from(reason, 'utf8');
    const payload = Buffer.allocUnsafe(2 + r.length);
    payload.writeUInt16BE(code, 0);
    r.copy(payload, 2);
    this._sendFrame(OP_CLOSE, payload);
    try {
      this.socket.end();
    } catch (err) {
      /* ignoreras */
    }
    this._finish(code);
  }

  _finish(code) {
    if (this._closed) return;
    this._closed = true;
    this.open = false;
    if (this.onClose) {
      const cb = this.onClose;
      this.onClose = null;
      cb(code);
    }
  }

  get bytesSent() {
    return this._sentBytes;
  }

  get bytesReceived() {
    return this._recvBytes;
  }
}

/** Koppla WebSocket-hantering till en http.Server */
export function attachWebSocket(server, path, onConnection) {
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== path) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers['sec-websocket-key'];
    const version = req.headers['sec-websocket-version'];
    const upgrade = String(req.headers['upgrade'] || '').toLowerCase();
    if (!key || version !== '13' || upgrade !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = createHash('sha1')
      .update(key + GUID)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    if (head && head.length) socket.unshift(head);
    const conn = new WebSocketConnection(socket, req);
    onConnection(conn, url);
  });
}
