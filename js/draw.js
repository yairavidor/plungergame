// Canvas drawing helpers: text, pills, plunger, bow.
export function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
export function txt(c, s, x, y, size, color, weight = 700, shadow = true, align = 'center') {
  c.font = `${weight} ${size}px Rubik, system-ui, sans-serif`; c.textAlign = align; c.direction = 'rtl'; c.textBaseline = 'middle';
  if (shadow) { c.lineJoin = 'round'; c.lineWidth = Math.max(2.5, size / 5); c.strokeStyle = 'rgba(0,0,0,.6)'; c.strokeText(s, x, y); }
  c.fillStyle = color; c.fillText(s, x, y);
}
export function pill(c, s, x, y, size, bg, fg) {
  c.font = `700 ${size}px Rubik, system-ui, sans-serif`; c.direction = 'rtl';
  const w = c.measureText(s).width + size * 1.4, h = size * 1.9;
  rr(c, x - w / 2, y - h / 2, w, h, h / 2); c.fillStyle = bg; c.fill();
  txt(c, s, x, y + 0.5, size, fg, 700, false);
}

// cup rim at (x,y); stick extends in direction `ang`. pxm = pixels per metre.
export function drawPlunger(c, x, y, ang, pxm, fore, faceOn, alpha = 1) {
  const cw = 0.11 * pxm, cd = 0.055 * pxm, L = 0.24 * pxm, sw = Math.max(1.6, 0.024 * pxm);
  c.save(); c.globalAlpha *= alpha; c.translate(x, y); c.rotate(ang);
  if (faceOn) {
    let g = c.createRadialGradient(-cw * 0.12, -cw * 0.12, cw * 0.05, 0, 0, cw / 2); g.addColorStop(0, '#ff6b6b'); g.addColorStop(1, '#991b1b');
    c.beginPath(); c.arc(0, 0, cw / 2, 0, 7); c.fillStyle = g; c.fill(); c.lineWidth = Math.max(1, cw * 0.05); c.strokeStyle = '#5c0f0f'; c.stroke();
    c.beginPath(); c.arc(0, 0, sw * 0.9, 0, 7); c.fillStyle = '#d9a56b'; c.fill(); c.strokeStyle = '#7a4f24'; c.lineWidth = 1; c.stroke();
  } else {
    c.scale(Math.max(fore, 0.3), 1);
    let g = c.createLinearGradient(0, -sw / 2, 0, sw / 2); g.addColorStop(0, '#e6b57e'); g.addColorStop(1, '#a8723d');
    rr(c, cd * 0.6, -sw / 2, L, sw, sw / 2); c.fillStyle = g; c.fill();
    c.fillStyle = '#6b4423'; rr(c, cd * 0.6 + L - sw * 1.2, -sw / 2, sw * 1.2, sw, sw / 2); c.fill();
    g = c.createLinearGradient(0, -cw / 2, 0, cw / 2); g.addColorStop(0, '#f87171'); g.addColorStop(0.55, '#dc2626'); g.addColorStop(1, '#7f1d1d');
    c.beginPath(); c.moveTo(0, -cw / 2); c.bezierCurveTo(cd * 1.4, -cw / 2, cd * 1.4, cw / 2, 0, cw / 2); c.closePath(); c.fillStyle = g; c.fill();
    c.lineWidth = Math.max(1, cw * 0.04); c.strokeStyle = '#5c0f0f'; c.stroke();
    c.beginPath(); c.ellipse(0, 0, Math.max(1, cw * 0.07), cw / 2, 0, 0, 7); c.fillStyle = '#450a0a'; c.fill();
  }
  c.restore();
}

// bow in a virtual 270-px-wide coordinate system
export const BOW = { span: 118, maxPull: 125, pxm: 480, fore: 0.9 };
export const PL_LEN = (0.055 * 0.6 + 0.24) * BOW.pxm * BOW.fore;
export function drawBow(c, CX, restY, pw, snap) {
  const grip = restY - 60, ny = restY + pw * BOW.maxPull;
  const lt = { x: CX - BOW.span + pw * 16, y: restY + 6 + pw * 10 }, rt = { x: CX + BOW.span - pw * 16, y: restY + 6 + pw * 10 };
  c.strokeStyle = 'rgba(245,245,245,.95)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(lt.x, lt.y);
  if (pw > 0) { c.lineTo(CX, ny); c.lineTo(rt.x, rt.y); } else c.quadraticCurveTo(CX, restY + snap, rt.x, rt.y);
  c.stroke();
  const g = c.createLinearGradient(0, grip - 30, 0, lt.y); g.addColorStop(0, '#8a5a2b'); g.addColorStop(1, '#5a3716');
  c.strokeStyle = g; c.lineCap = 'round'; c.lineWidth = 8; c.beginPath(); c.moveTo(lt.x, lt.y);
  c.bezierCurveTo(CX - BOW.span * 0.75, grip - 38 - pw * 6, CX + BOW.span * 0.75, grip - 38 - pw * 6, rt.x, rt.y); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 2; c.beginPath(); c.moveTo(lt.x + 2, lt.y - 4);
  c.bezierCurveTo(CX - BOW.span * 0.75, grip - 42 - pw * 6, CX + BOW.span * 0.75, grip - 42 - pw * 6, rt.x - 2, rt.y - 4); c.stroke();
  c.fillStyle = '#3b2410'; [lt, rt].forEach(t => { c.beginPath(); c.arc(t.x, t.y, 4.5, 0, 7); c.fill(); });
  const gy = grip - 10; c.fillStyle = '#2b1a0c'; rr(c, CX - 15, gy - 8, 30, 18, 6); c.fill();
  c.fillStyle = '#e0ac8a'; rr(c, CX - 24, gy - 2, 48, 26, 11); c.fill();
  c.strokeStyle = 'rgba(120,70,40,.35)'; c.lineWidth = 1.3;
  for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(CX - 24 + i * 12, gy + 2); c.lineTo(CX - 24 + i * 12, gy + 20); c.stroke(); }
}

export function brackets(c, x0, y0, x1, y1, color, lw = 2.5) {
  const l = Math.max(10, Math.min(x1 - x0, y1 - y0) * 0.25);
  c.strokeStyle = color; c.lineWidth = lw; c.lineCap = 'round';
  [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].forEach(([x, y, dx, dy]) => { c.beginPath(); c.moveTo(x + dx * l, y); c.lineTo(x, y); c.lineTo(x, y + dy * l); c.stroke(); });
}
