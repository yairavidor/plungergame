// Phone-to-phone connection with PeerJS (WebRTC). The host phone opens a room;
// the friend opens the link with ?room=CODE and connects straight to it.
const PREFIX = 'plunger-duel-v1-';
const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];
const CHUNK = 12000;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

export class Net {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage; this.onStatus = onStatus;
    this.peer = null; this.conn = null; this.isHost = false; this.code = null; this.parts = {}; this.closed = false; this.tries = 0;
  }
  _peer(id) { return new window.Peer(id, { config: { iceServers: ICE }, debug: 1 }); }

  host(code = newCode()) {
    this.isHost = true; this.code = code;
    this.peer = this._peer(PREFIX + code);
    this.onStatus('opening');
    this.peer.on('open', () => this.onStatus('waiting'));
    this.peer.on('connection', c => {
      if (this.conn && this.conn.open) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); }); return; }
      this._attach(c);
    });
    this.peer.on('disconnected', () => { if (!this.closed) try { this.peer.reconnect(); } catch (e) {} });
    this.peer.on('error', e => {
      if (e.type === 'unavailable-id') { this.peer.destroy(); this.host(newCode()); return; }
      console.warn('peer error', e.type, e); this.onStatus('error', e.type);
    });
    return code;
  }

  join(code) {
    this.isHost = false; this.code = code;
    const go = () => {
      if (this.closed) return;
      if (this.peer) try { this.peer.destroy(); } catch (e) {}
      this.peer = this._peer();
      this.onStatus('connecting');
      this.peer.on('open', () => this._attach(this.peer.connect(PREFIX + code, { reliable: true, serialization: 'json' })));
      this.peer.on('error', e => {
        console.warn('peer error', e.type, e);
        if (e.type === 'peer-unavailable') this.onStatus('noroom'); else this.onStatus('error', e.type);
        this._retry(go);
      });
    };
    this._go = go; go();
  }
  _retry(go) { if (this.closed || this.tries++ > 30) return; clearTimeout(this._rt); this._rt = setTimeout(go, 2500); }

  _attach(c) {
    this.conn = c;
    c.on('open', () => { this.tries = 0; this.onStatus('connected'); });
    c.on('data', d => this._data(d));
    c.on('close', () => {
      if (this.conn === c) this.conn = null;
      this.onStatus('disconnected');
      if (!this.isHost && this._go) this._retry(this._go);
    });
    c.on('error', e => console.warn('conn error', e));
  }
  get connected() { return !!(this.conn && this.conn.open); }
  send(o) { if (this.connected) try { this.conn.send(o); } catch (e) { console.warn(e); } }
  sendBig(type, str) {
    const id = Math.random().toString(36).slice(2, 9), n = Math.ceil(str.length / CHUNK);
    for (let i = 0; i < n; i++) this.send({ t: 'chunk', type, id, i, n, s: str.slice(i * CHUNK, (i + 1) * CHUNK) });
  }
  _data(d) {
    if (d && d.t === 'chunk') {
      const b = this.parts[d.id] || (this.parts[d.id] = { n: d.n, got: 0, s: [] });
      if (b.s[d.i] === undefined) { b.s[d.i] = d.s; b.got++; }
      if (b.got === b.n) { delete this.parts[d.id]; this.onMessage({ t: d.type, data: b.s.join('') }); }
      return;
    }
    this.onMessage(d);
  }
  close() { this.closed = true; clearTimeout(this._rt); try { this.conn && this.conn.close(); } catch (e) {} try { this.peer && this.peer.destroy(); } catch (e) {} }
}
