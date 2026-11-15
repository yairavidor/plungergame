// The AR game screen: camera + lock on him + 2 m rule + head start button + bow duel.
import * as V from './vision.js';
import { drawPlunger, drawBow, BOW, PL_LEN, rr, txt, pill, brackets } from './draw.js';
import { sfx, unlockAudio } from './sound.js';
import { profile, settings, saveSettings, targetName } from './store.js';

const TOL = 0.5;          // m — how close the launch distance must be to his distance
const VW = 270;           // virtual width used for the bow / HUD layout
const MIN_D = 2;          // the 2-metre rule
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => document.getElementById(id);

export class Game {
  constructor({ video, canvas, cam, me, names, practice, cb }) {
    Object.assign(this, { video, canvas, cam, me, names, practice, cb });
    this.G = { phase: 'position', scores: [0, 0], ready: [false, false], winner: -1, stuck: null, round: 0, rep: [{}, {}] };
    this.tracker = new V.Tracker(profile, { backLock: settings.backLock, lookThr: settings.lookThr });
    this.vs = { locked: false, cands: [], rejects: [], info: {} };
    this.pl = { st: 'none', t: 0, power: 0, drawY: 0, snapT: 0 };
    this.flights = []; this.toastO = null; this.lastLock = 0; this.lastRep = 0;
    this.phaseAt = performance.now(); this.myStuck = null; this.stuckAt = 0; this.cdShown = null; this.ui = {};
    this._down = e => this.down(e); this._move = e => this.move(e); this._up = () => this.up();
  }

  start() {
    this.running = true;
    const cv = this.canvas;
    cv.addEventListener('pointerdown', this._down); cv.addEventListener('pointermove', this._move);
    cv.addEventListener('pointerup', this._up); cv.addEventListener('pointercancel', this._up);
    $('gCal').onclick = () => this.calibrate();
    $('gRematch').onclick = () => { unlockAudio(); this.cb.rematch(); };
    const z = $('gZoom');
    if (this.cam.canZoom) {
      const zc = this.cam.caps.zoom; z.min = zc.min; z.max = Math.min(zc.max, zc.min * 5); z.step = 0.1; z.value = this.cam.zoom;
      z.oninput = () => this.cam.setZoom(+z.value); $('gZoomWrap').hidden = false;
    } else $('gZoomWrap').hidden = true;
    this.visionLoop();
    this._frame = () => this.frame(); requestAnimationFrame(this._frame);
  }
  stop() {
    this.running = false;
    const cv = this.canvas;
    cv.removeEventListener('pointerdown', this._down); cv.removeEventListener('pointermove', this._move);
    cv.removeEventListener('pointerup', this._up); cv.removeEventListener('pointercancel', this._up);
  }

  async visionLoop() {
    while (this.running) {
      if (this.video.readyState >= 2) {
        try {
          this.vs = await this.tracker.step(this.video, { fov: settings.fov, zoom: this.cam.zoomFactor, k: settings.distK });
          if (this.vs.locked && !this.wasLocked) sfx.lock();
          if (!this.vs.locked && this.wasLocked && this.vs.info.msg === 'notHim') sfx.nope();
          this.wasLocked = this.vs.locked;
        } catch (e) { console.warn(e); }
      }
      await sleep(8);
    }
  }

  setState(G) {
    const prev = this.G.phase, prevRound = this.G.round; this.G = G;
    if (G.phase === prev && G.round === prevRound) return;
    this.phaseAt = performance.now();
    if (G.phase === 'duel') { this.pl.st = 'none'; this.flights = []; this.myStuck = null; sfx.beep(true); }
    if (G.phase === 'win') { this.stuckAt = performance.now(); this.pl.st = 'none'; G.winner === this.me ? sfx.win() : sfx.lose(); }
    if (G.phase === 'position' || G.phase === 'start') { this.pl.st = 'none'; this.flights = []; this.myStuck = null; }
  }

  toast(text, color = '#fff') { this.toastO = { text, color, t0: performance.now() }; }

  calibrate() {
    if (!this.vs.locked || !this.vs.rawDist) { this.toast('קודם צריך להינעל עליו', '#fbbf24'); return; }
    settings.distK = 2 / this.vs.rawDist; saveSettings();
    this.toast("✓ כויל: עכשיו זה 2.0 מ'", '#4ade80');
  }

  // ---------- input ----------
  pt(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  down(e) {
    unlockAudio();
    const p = this.pt(e), G = this.G, hs = this.hs;
    if (G.phase === 'start' && !G.ready[this.me]) {
      if (hs) {
        const n = ((p.x - hs.x) / (hs.w * 0.6)) ** 2 + ((p.y - hs.y) / (hs.h * 0.6)) ** 2;
        if (n <= 1.6) { this.cb.tap(); sfx.tick(); this.toast('✓ מוכן', '#4ade80'); return; }
      }
      this.toast('לחצו על הראש שלו 👆', '#fbbf24');
    } else if (G.phase === 'duel' && this.pl.st === 'ready') {
      this.pl.st = 'drawing'; this.pl.drawY = p.y; this.pl.power = 0;
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    }
  }
  move(e) {
    if (this.pl.st !== 'drawing') return;
    const p = this.pt(e);
    this.pl.power = V.clamp((p.y - this.pl.drawY) / (BOW.maxPull * this.U), 0, 1);
  }
  up() { if (this.pl.st === 'drawing') this.release(); }

  release() {
    const now = performance.now(), pl = this.pl;
    if (pl.power < 0.04) { pl.st = 'ready'; pl.power = 0; return; }
    const power = pl.power; pl.power = 0; pl.snapT = now; sfx.twang(); sfx.whoosh();
    const range = 0.5 + power * 5.5, vs = this.vs, hs = this.hs, d = vs.dist || 3;
    const aim = { x: this.w / 2, y: this.h / 2 };
    let res, u = 0, v = 0;
    if (!(vs.locked && hs)) res = 'nolock';
    else {
      u = (aim.x - hs.x) / (hs.w / 2); v = (aim.y - hs.y) / (hs.h / 2);
      const on = u * u + v * v <= 1.1;
      if (d < MIN_D - 0.1) res = 'close';
      else if (on && Math.abs(range - d) <= TOL) res = 'hit';
      else if (range < d - TOL) res = 'short';
      else if (range > d + TOL) res = 'long';
      else res = 'wide';
    }
    this.flights.push({
      t0: now, dur: (0.35 + range * 0.1) * 1000, res, range, d, u, v, aimS: aim,
      rel: hs ? { du: (aim.x - hs.x) / hs.w, dv: (aim.y - hs.y) / hs.w } : null, pxmHead: hs ? hs.w / 0.16 : 60,
    });
    pl.st = 'flying'; pl.t = now;
  }

  land(fl) {
    const name = targetName();
    const T = { short: ['קצר מדי!', '#fbbf24'], long: ['חזק מדי!', '#fbbf24'], wide: ['פספוס!', '#fbbf24'], nolock: [`לא נעול על ${name}`, '#f87171'], close: ['קרוב מדי, לא נחשב', '#f87171'] };
    if (fl.res === 'hit') {
      this.myStuck = { u: fl.u, v: fl.v }; this.stuckAt = performance.now();
      this.toast('בול!! 🎯', '#4ade80'); sfx.thwop();
      this.cb.hit({ u: fl.u, v: fl.v, round: this.G.round });
    } else { this.toast(...T[fl.res]); sfx.boing(); }
  }

  // ---------- per frame ----------
  frame() {
    if (!this.running) return;
    requestAnimationFrame(this._frame);
    const now = performance.now(), cv = this.canvas;
    const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    this.w = w; this.h = h; this.U = w / VW; this.VH = h / this.U;
    const map = V.coverMap(this.video, w, h, this.cam.facing === 'user'); this.map = map;
    const vs = this.vs;
    this.hs = null;
    if (vs.locked && vs.head) { const a = map.toS(vs.head.cx, vs.head.cy); this.hs = { x: a.x, y: a.y, w: vs.head.w * map.s, h: vs.head.h * map.s }; this.lastLock = now; }
    const lockedOk = now - this.lastLock < 1000;
    if (now - this.lastRep > 200) { this.lastRep = now; this.cb.report({ locked: lockedOk, dist: lockedOk ? (vs.dist || 0) : 0 }); }

    // plunger life cycle
    const G = this.G, pl = this.pl;
    if (G.phase === 'duel') {
      if (pl.st === 'none' || (pl.st === 'cool' && now - pl.t > 350)) { pl.st = 'spawn'; pl.t = now; sfx.pop(); }
      if (pl.st === 'spawn' && now - pl.t > 500) pl.st = 'ready';
    }
    for (const fl of this.flights) {
      const k = (now - fl.t0) / fl.dur;
      if (k >= 1 && !fl.landed) { fl.landed = true; this.land(fl); if (fl.res === 'hit') fl.dead = true; }
      if (k >= 1.6) { fl.dead = true; }
      if (fl.dead && pl.st === 'flying' && G.phase === 'duel') { pl.st = 'cool'; pl.t = now; }
    }
    this.flights = this.flights.filter(f => !f.dead);
    if (G.phase === 'countdown') { const n = 3 - Math.floor((now - this.phaseAt) / 1000); if (n !== this.cdShown) { this.cdShown = n; if (n > 0) sfx.beep(false); } }

    this.draw(c, now);
    this.hud(now);
  }

  draw(c, now) {
    const { w, h, map, vs, hs, G } = this, U = this.U, name = targetName();
    // other people in frame
    for (const p of vs.cands) {
      if (vs.lockPerson === p) continue;
      const a = map.toS(p.head.cx - p.head.w / 2, p.head.cy - p.head.h / 2), b = map.toS(p.head.cx + p.head.w / 2, p.head.cy + p.head.h / 2);
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
      const rej = vs.rejects.some(r => Math.hypot(r.head.cx - p.head.cx, r.head.cy - p.head.cy) < Math.max(r.head.w, p.head.w));
      if (rej) { brackets(c, x0, a.y, x1, b.y, '#ef4444', 2.5); pill(c, '✋ לא הוא', (x0 + x1) / 2, a.y - 14, 11, 'rgba(239,68,68,.9)', '#fff'); }
      else { c.setLineDash([4, 4]); brackets(c, x0, a.y, x1, b.y, 'rgba(255,255,255,.7)', 1.5); c.setLineDash([]); txt(c, 'בודק…', (x0 + x1) / 2, a.y - 10, 10, '#fff', 500); }
    }
    if (hs) {
      const x0 = hs.x - hs.w * 0.72, x1 = hs.x + hs.w * 0.72, y0 = hs.y - hs.h * 0.7, y1 = hs.y + hs.h * 0.65;
      if (G.phase === 'start' && !G.ready[this.me]) {
        const pulse = 1 + 0.1 * Math.sin(now / 160), R = Math.max(hs.w, hs.h) * 0.8 * pulse;
        const g = c.createRadialGradient(hs.x, hs.y, R * 0.4, hs.x, hs.y, R * 1.5);
        g.addColorStop(0, 'rgba(34,197,94,0)'); g.addColorStop(0.6, 'rgba(34,197,94,.45)'); g.addColorStop(1, 'rgba(34,197,94,0)');
        c.fillStyle = g; c.beginPath(); c.arc(hs.x, hs.y, R * 1.5, 0, 7); c.fill();
        c.strokeStyle = '#4ade80'; c.lineWidth = 3; c.beginPath(); c.ellipse(hs.x, hs.y, hs.w * 0.62 * pulse, hs.h * 0.6 * pulse, 0, 0, 7); c.stroke();
        txt(c, 'התחל', hs.x, hs.y, Math.max(14, hs.w * 0.32), '#fff', 800);
        txt(c, '👆', hs.x + 8, y1 + 26 + Math.sin(now / 160) * 4, 24, '#fff', 400, false);
      } else brackets(c, x0, y0, x1, y1, vs.via === 'look' ? '#a3e635' : '#4ade80', 3);
      pill(c, '🎯 ' + name, hs.x, y0 - 16, 12, 'rgba(34,197,94,.92)', '#052611');
      if (vs.dist && G.phase !== 'win') { const ok = vs.dist >= MIN_D; pill(c, vs.dist.toFixed(1) + " מ'", hs.x, y1 + (G.phase === 'start' ? 56 : 16), 12, ok ? 'rgba(0,0,0,.55)' : 'rgba(239,68,68,.9)', '#fff'); }
      // stuck plunger(s)
      const st = G.stuck || (this.myStuck && G.phase === 'duel' ? { owner: this.me, ...this.myStuck } : null);
      if (st) {
        const pxm = hs.w / 0.16, age = (now - this.stuckAt) / 1000, wob = 0.2 * Math.sin(age * 22) * Math.exp(-age * 2.5);
        if (st.owner === this.me) {
          const ax = hs.x + st.u * hs.w * 0.42, ay = hs.y + st.v * hs.h * 0.42, r = Math.hypot(st.u, st.v);
          if (r < 0.35) drawPlunger(c, ax, ay, wob, pxm, 0, true);
          else drawPlunger(c, ax, ay, Math.atan2(st.v, st.u) + wob, pxm, 0.55 + 0.4 * Math.min(1, r), false);
        } else drawPlunger(c, hs.x + hs.w * 0.2, hs.y - hs.h * 0.4, -1.15 + wob, pxm, 0.95, false);
      }
    }
    // flights
    for (const fl of this.flights) this.drawFlight(c, fl, now);

    // ---- virtual-coordinate HUD (bow, power bar, crosshair, countdown, toast) ----
    c.save(); c.scale(U, U);
    const VH = this.VH, CX = VW / 2, CY = VH / 2, restY = VH - 112;
    if (G.phase === 'duel') {
      const on = hs && (((CX * U - hs.x) / (hs.w / 2)) ** 2 + ((CY * U - hs.y) / (hs.h / 2)) ** 2 <= 1.1);
      const col = on ? '#4ade80' : 'rgba(255,255,255,.95)';
      c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.arc(CX, CY, 11, 0, 7); c.stroke();
      [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => { c.beginPath(); c.moveTo(CX + dx * 15, CY + dy * 15); c.lineTo(CX + dx * 23, CY + dy * 23); c.stroke(); });
      c.fillStyle = col; c.beginPath(); c.arc(CX, CY, 2, 0, 7); c.fill();
      const pl = this.pl, pw = pl.st === 'drawing' ? pl.power : 0;
      let snap = 0; if (pl.snapT) { const e = (now - pl.snapT) / 1000; if (e < 0.35) snap = Math.sin(e * 90) * 10 * (1 - e / 0.35); }
      drawBow(c, CX, restY, pw, snap);
      if (pl.st === 'spawn' || pl.st === 'ready' || pl.st === 'drawing') {
        let yy = restY - PL_LEN, xx = CX;
        if (pl.st === 'spawn') { const e = Math.min(1, (now - pl.t) / 500); yy = -150 + (yy + 150) * (1 - Math.pow(1 - e, 3)); }
        if (pl.st === 'drawing') { yy += pw * BOW.maxPull; const sh = pw >= 1 ? 2.2 : pw * 1.2; xx += (Math.random() - 0.5) * sh; yy += (Math.random() - 0.5) * sh; }
        drawPlunger(c, xx, yy, Math.PI / 2, BOW.pxm, BOW.fore, false);
        if (pl.st === 'drawing') {
          const ny = restY + pw * BOW.maxPull;
          c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(xx + 2, ny + 5, 15, 12, 0, 0, 7); c.fill();
          c.fillStyle = '#e8b896'; c.beginPath(); c.ellipse(xx, ny + 2, 14, 12, 0, 0, 7); c.fill();
          if (pw >= 1) pill(c, 'מתיחה מלאה!', CX, restY - 122, 11, 'rgba(239,68,68,.9)', '#fff');
        } else if (pl.st === 'ready') { const bob = ((now / 700) % 1) * 26; txt(c, '👆', CX + 30, restY - 14 + bob, 20, '#fff', 400, false); }
      }
      // power bar with metres + green zone for his distance
      const bx = VW - 30, by = VH * 0.28, bh = VH * 0.36, bw = 14, d = this.vs.dist || 0;
      c.fillStyle = 'rgba(0,0,0,.5)'; rr(c, bx - 4, by - 24, bw + 8, bh + 32, 10); c.fill();
      txt(c, 'מתיחה', bx + bw / 2, by - 12, 9, '#fff', 600, false);
      c.fillStyle = 'rgba(255,255,255,.12)'; rr(c, bx, by, bw, bh, 6); c.fill();
      if (d) { const z0 = V.clamp((d - TOL - 0.5) / 5.5, 0, 1), z1 = V.clamp((d + TOL - 0.5) / 5.5, 0, 1); c.fillStyle = 'rgba(74,222,128,.4)'; c.fillRect(bx, by + bh * (1 - z1), bw, bh * (z1 - z0)); }
      const g = c.createLinearGradient(0, by + bh, 0, by); g.addColorStop(0, '#22c55e'); g.addColorStop(0.5, '#facc15'); g.addColorStop(1, '#ef4444');
      c.save(); rr(c, bx, by, bw, bh, 6); c.clip(); c.fillStyle = g; c.fillRect(bx, by + bh * (1 - pw), bw, bh * pw); c.restore();
      c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1;
      for (let m = 1; m <= 6; m++) { const yy = by + bh * (1 - (m - 0.5) / 5.5); c.beginPath(); c.moveTo(bx - 3, yy); c.lineTo(bx, yy); c.stroke(); txt(c, String(m), bx - 10, yy, 9, 'rgba(255,255,255,.8)', 500, false); }
    }
    if (G.phase === 'countdown') {
      const t = (now - this.phaseAt) / 1000, n = 3 - Math.floor(t), f = t % 1;
      if (n > 0) { c.save(); c.globalAlpha = 1 - f * 0.6; txt(c, String(n), CX, VH * 0.55, 96 - f * 30, '#fff', 800); c.restore(); }
    }
    if (this.toastO) {
      const e = (now - this.toastO.t0) / 1400;
      if (e > 1) this.toastO = null;
      else { c.save(); c.globalAlpha = 1 - Math.max(0, e - 0.6) / 0.4; txt(c, this.toastO.text, CX, VH * 0.3 - e * 20, 24, this.toastO.color, 800); c.restore(); }
    }
    c.restore();
  }

  drawFlight(c, fl, now) {
    const U = this.U, hs = this.hs, k = (now - fl.t0) / fl.dur;
    const alpha = k > 1 ? V.clamp(1 - (k - 1) / 0.6, 0, 1) : 1;
    const pxmHead = hs ? hs.w / 0.16 : fl.pxmHead, fS = pxmHead * fl.d;
    const T = fl.rel && hs ? { x: hs.x + fl.rel.du * hs.w, y: hs.y + fl.rel.dv * hs.w } : fl.aimS;   // anchored to his head
    const S0 = { x: (VW / 2) * U, y: (this.VH - 112 - PL_LEN) * U };
    const at = kk => {
      let z, fall = 0;
      if (kk <= 1) z = 0.25 + (fl.range - 0.25) * kk;
      else if (fl.res === 'short') { z = fl.range; fall = 900 * (kk - 1) ** 2 * U; }
      else z = fl.range + (kk - 1) * fl.range * 0.7;
      const kc = Math.min(kk, 1), arc = fS * 0.12 * fl.range * 4 * kc * (1 - kc) / z;
      return { x: T.x + (S0.x - T.x) * (0.25 / z), y: T.y + (S0.y - T.y) * (0.25 / z) - arc + fall, z };
    };
    const p = at(k), q = at(Math.max(0, k - 0.03));
    const ang = Math.atan2(q.y - p.y, q.x - p.x) || Math.PI / 2;
    const pxm = Math.min(BOW.pxm * U, fS / p.z);
    drawPlunger(c, p.x, p.y, ang, pxm, 0.6, false, alpha);
  }

  hud(now) {
    const G = this.G, vs = this.vs, name = targetName(), me = this.me, other = 1 - me;
    const set = (id, v) => { if (this.ui[id] !== v) { this.ui[id] = v; $(id).textContent = v; } };
    const show = (id, on) => { const k = id + ':v'; if (this.ui[k] !== on) { this.ui[k] = on; $(id).hidden = !on; } };
    set('gScore', `${this.names[me]} ${G.scores[me]} : ${G.scores[other]} ${this.names[other]}`);
    const PH = { position: '🎯 נעילה ו-2 מטר', start: '👆 הראש = כפתור התחלה', countdown: '⏱️ מתכוננים', duel: '🏹 דו-קרב!', win: '🏆 סוף סיבוב' };
    set('gPhase', PH[G.phase] || '');
    const d = vs.dist, locked = vs.locked;
    let msg = '';
    if (G.phase === 'position') {
      if (!locked) msg = vs.info.msg === 'notHim' ? `זה לא ${name} ✋ חפשו אותו` : `כוונו את המצלמה אל ${name}`;
      else if (d < MIN_D) msg = `התרחקו עוד ${(MIN_D - d).toFixed(1)} מ'`;
      else msg = '✓ מוכן. מחכים לשחקן השני';
    } else if (G.phase === 'start') msg = G.ready[me] ? 'מחכים שהשחקן השני ילחץ…' : `לחצו על הראש של ${name} כדי להתחיל`;
    else if (G.phase === 'duel') {
      if (!locked) msg = `איבדתם את ${name}. כוונו אליו`;
      else if (d < MIN_D - 0.1) msg = 'קרוב מדי! התרחקו';
      else if (this.pl.st === 'ready') msg = 'משכו את הפומפה אחורה ועזבו';
    } else if (G.phase === 'win') msg = G.winner === me ? '🏆 ניצחת! הפומפה שלך נדבקה' : `😅 ${this.names[G.winner] || 'היריב'} הדביק ראשון`;
    set('gMsg', msg); show('gMsg', !!msg);
    let partner = '';
    if (this.practice) partner = 'מצב אימון (טלפון אחד)';
    else if (G.phase === 'position' || G.phase === 'start') {
      const r = (G.rep || [])[other] || {};
      partner = `${this.names[other]}: ${r.connected === false ? 'מנותק ⚠️' : r.locked ? 'נעול ✓' : 'מחפש…'}${r.locked && r.dist ? ` · ${r.dist.toFixed(1)} מ'` : ''}${G.phase === 'start' && G.ready[other] ? ' · מוכן ✓' : ''}`;
    }
    set('gPartner', partner); show('gPartner', !!partner);
    show('gCal', (G.phase === 'position' || G.phase === 'start') && locked);
    show('gRematch', G.phase === 'win');
    if (settings.debug) {
      const i = vs.info;
      set('gDebug', `face ${i.face != null ? i.face.toFixed(2) : '-'} (≤${V.FACE_OK}) · look ${i.sim != null ? i.sim.toFixed(2) : '-'} (≥${settings.lookThr}) · via ${vs.via || '-'} · raw ${vs.rawDist ? vs.rawDist.toFixed(2) : '-'} · k ${settings.distK.toFixed(2)}`);
    }
    show('gDebug', settings.debug);
  }
}
