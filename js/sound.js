import { settings } from './store.js?v=4';
let AC = null;
export function unlockAudio() { ac(); }
function ac() {
  if (!settings.sound) return null;
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(f, dur, type = 'sine', vol = 0.15, f2 = null, delay = 0) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + delay;
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, vol, f1, f2) {
  const a = ac(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur), b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = a.createBufferSource(); s.buffer = b;
  const fl = a.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = 1.2;
  const t = a.currentTime; fl.frequency.setValueAtTime(f1, t); fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl).connect(g).connect(a.destination); s.start();
}
export const sfx = {
  whoosh() { noise(0.35, 0.25, 600, 2800); },
  twang() { tone(140, 0.25, 'triangle', 0.18, 90); },
  thwop() { tone(220, 0.2, 'sine', 0.4, 55); tone(1100, 0.07, 'square', 0.06, 300, 0.02); },
  boing() { tone(380, 0.35, 'triangle', 0.13, 140); },
  beep(h) { tone(h ? 900 : 520, h ? 0.3 : 0.14, 'square', 0.07); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.28, 'triangle', 0.14, null, i * 0.12)); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'triangle', 0.12, null, i * 0.15)); },
  lock() { tone(660, 0.1, 'sine', 0.12); tone(990, 0.18, 'sine', 0.12, null, 0.1); },
  tick() { tone(1300, 0.05, 'square', 0.05); },
  pop() { tone(500, 0.08, 'sine', 0.1, 900); },
  nope() { tone(200, 0.2, 'square', 0.06, 150); },
};
