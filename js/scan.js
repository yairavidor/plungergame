// Enrollment: (1) one-time face print, (2) daily 360° look scan. Both lock on HIM only.
import * as V from './vision.js';
import { brackets, txt, pill } from './draw.js';
import { sfx } from './sound.js';
import { profile, settings, targetName } from './store.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fit(canvas) {
  const dpr = Math.min(2, devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h); return { c, w, h };
}
function ring(c, x, y, r, p, col) {
  c.lineWidth = 6; c.lineCap = 'round';
  c.strokeStyle = 'rgba(255,255,255,.2)'; c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke();
  c.strokeStyle = col; c.beginPath(); c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); c.stroke();
}

// ---------- 1) FACE PRINT ----------
const FACE_STEPS = [
  [4, 'מבט ישר למצלמה 🙂'], [7, 'עכשיו לסובב את הראש קצת שמאלה'], [10, 'עכשיו קצת ימינה'],
  [12, 'להרים קצת את הסנטר'], [14, 'להוריד קצת את הסנטר'],
];
export async function faceScan(ui) {
  const { video, canvas, cam } = ui;
  const samples = []; let last = 0;
  while (!ui.cancelled && samples.length < 14) {
    const faces = await V.detectFaces(video);
    const { c, w, h } = fit(canvas), map = V.coverMap(video, w, h, cam.facing === 'user');
    let msg = '', ok = false;
    if (!faces.length) msg = `כוונו את המצלמה לפנים של ${targetName()}`;
    else if (faces.length > 1) msg = 'רק הוא צריך להיות בפריים';
    else {
      const f = faces[0], rel = f.box.width / video.videoWidth;
      if (rel < 0.16) msg = 'להתקרב (בערך חצי מטר)';
      else if (samples.length >= 3 && Math.min(...samples.slice(0, 3).map(s => V.faceDist(s, f.desc))) > 0.6) msg = 'זה מישהו אחר? רק הוא, בבקשה';
      else {
        ok = true; const now = performance.now();
        const novel = !samples.length || Math.min(...samples.map(s => V.faceDist(s, f.desc))) > 0.07;
        if (novel && now - last > 280) { samples.push(Array.from(f.desc)); last = now; sfx.tick(); }
        msg = (FACE_STEPS.find(s => samples.length < s[0]) || FACE_STEPS[4])[1];
      }
    }
    for (const f of faces) {
      const a = map.toS(f.box.x, f.box.y), b = map.toS(f.box.x + f.box.width, f.box.y + f.box.height);
      brackets(c, Math.min(a.x, b.x), a.y, Math.max(a.x, b.x), b.y, ok ? '#4ade80' : '#fbbf24', 3);
    }
    ring(c, w / 2, h * 0.16, 30, samples.length / 14, '#4ade80');
    txt(c, `${samples.length}/14`, w / 2, h * 0.16, 14, '#fff', 700, false);
    ui.setText(msg); ui.setProgress(samples.length / 14);
    await sleep(60);
  }
  return ui.cancelled ? null : samples;
}

// ---------- 2) 360° LOOK SCAN (today) ----------
export async function bodyScan(ui) {
  const { video, canvas, cam } = ui;
  const faces = profile.face;
  const samples = [];
  let track = null, lastSeen = 0, lastFaceOk = 0, lastFaceT = 0, lastEmb = 0, lastAdd = 0, startAt = 0;
  let backSeen = false, frontAgain = false, warn = '', warnT = 0, backSamples = 0;
  const NEED = 30;
  while (!ui.cancelled) {
    const now = performance.now();
    const cands = V.detectPoses(video);
    if (track) {
      let best = null, bd = Math.max(track.head.w * 1.5, 40);
      for (const p of cands) { const d = Math.hypot(p.head.cx - track.head.cx, p.head.cy - track.head.cy); if (d < bd) { bd = d; best = p; } }
      if (best) { track = best; lastSeen = now; }
      else if (now - lastSeen > 1000) { track = null; warn = 'איבדתי אותו. כוונו שוב לפנים שלו'; warnT = now; sfx.nope(); }
    }
    if (!track) {
      if (cands.length && now - lastFaceT > 250) {
        lastFaceT = now;
        const c = cands.reduce((a, b) => (b.head.w > a.head.w ? b : a));
        const f = await V.faceOnHead(video, c.head);
        if (f) {
          const d = V.minFaceDist(faces, f.desc);
          if (d <= V.FACE_OK) { track = c; lastSeen = now; lastFaceOk = now; if (!startAt) startAt = now; sfx.lock(); warn = ''; }
          else if (d >= V.FACE_BAD) { warn = 'זה לא הוא ✋'; warnT = now; }
        }
      }
    } else {
      if (now - lastFaceT > 300) {
        lastFaceT = now;
        const f = await V.faceOnHead(video, track.head);
        if (f) {
          const d = V.minFaceDist(faces, f.desc);
          if (d <= V.FACE_OK) { lastFaceOk = now; if (backSeen && samples.length >= 18) frontAgain = true; }
          else if (d >= V.FACE_BAD) { track = null; warn = 'זה לא הוא ✋'; warnT = now; sfx.nope(); }
        }
      }
      if (track && now - lastEmb > 250 && samples.length < 48) {
        lastEmb = now;
        const e = V.embedBody(video, track.body);
        if (e) {
          const novel = !samples.length || Math.max(...samples.map(s => V.dot(s, e))) < 0.965;
          if (novel || now - lastAdd > 900) {
            samples.push(Array.from(e)); lastAdd = now;
            // counts as 'his back' only after a good while with no face visible, and with real samples taken then
            if (now - lastFaceOk > 2000 && ++backSamples >= 8) backSeen = true;
          }
        }
      }
    }
    // draw
    const { c, w, h } = fit(canvas), map = V.coverMap(video, w, h, cam.facing === 'user');
    for (const p of cands) {
      const a = map.toS(p.head.cx - p.head.w / 2, p.head.cy - p.head.h / 2), b = map.toS(p.head.cx + p.head.w / 2, p.head.cy + p.head.h / 2);
      const me = track && p === track;
      brackets(c, Math.min(a.x, b.x), a.y, Math.max(a.x, b.x), b.y, me ? '#4ade80' : 'rgba(255,255,255,.6)', me ? 3 : 2);
      if (me) {
        pill(c, '🎯 ' + targetName(), (a.x + b.x) / 2, a.y - 16, 12, 'rgba(34,197,94,.92)', '#052611');
        const d = V.rawDistance(p, video, settings.fov, cam.zoomFactor) * settings.distK;
        txt(c, d.toFixed(1) + " מ'", (a.x + b.x) / 2, b.y + 16, 13, '#fff', 700);
      }
    }
    const prog = Math.min(1, samples.length / NEED) * 0.7 + (backSeen ? 0.15 : 0) + (frontAgain ? 0.15 : 0);
    ring(c, w / 2, h * 0.16, 30, prog, '#4ade80');
    txt(c, Math.round(prog * 100) + '%', w / 2, h * 0.16, 14, '#fff', 700, false);
    const checks = [['פנים', !!track || startAt > 0], ['גב', backSeen], ['סיבוב שלם', frontAgain]];
    checks.forEach(([l, ok], i) => pill(c, (ok ? '✓ ' : '○ ') + l, w / 2 + (1 - i) * 92, h * 0.16 + 52, 12, ok ? 'rgba(34,197,94,.9)' : 'rgba(0,0,0,.55)', ok ? '#052611' : '#fff'));
    let msg;
    if (warn && now - warnT < 1800) msg = warn;
    else if (!track) msg = `כוונו את המצלמה לפנים של ${targetName()} כדי להתחיל`;
    else if (!backSeen) msg = 'מעולה! עכשיו שיסתובב לאט (או שתקיפו אותו) עד שרואים את הגב';
    else if (!frontAgain) msg = 'ממשיכים להסתובב עד שהפנים חוזרות למצלמה';
    else msg = 'עוד כמה שניות…';
    ui.setText(msg); ui.setProgress(prog);
    if (samples.length >= NEED && backSeen && frontAgain && now - startAt > 12000) break;
    await sleep(30);
  }
  return ui.cancelled ? null : samples;
}
