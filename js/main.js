// App shell: screens, scans, room/link connection, and the host's game referee.
import * as V from './vision.js';
import { faceScan, bodyScan } from './scan.js';
import { Game } from './game.js';
import { Net } from './net.js';
import { sfx, unlockAudio } from './sound.js';
import * as S from './store.js';

const $ = id => document.getElementById(id);
const video = $('video'), overlay = $('overlay'), cam = new V.Camera(video);
const clone = o => JSON.parse(JSON.stringify(o));

// ---------------- helpers ----------------
let toastT = 0;
function toast(t, ms = 2600) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, ms); }
function loading(on, t) { $('loading').hidden = !on; if (t) $('loadingText').textContent = t; }
let screen = 'home';
function show(id) {
  screen = id;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  $('stage').hidden = !(id === 'scan' || id === 'game');
  if (id !== 'scan' && id !== 'game') { const c = overlay.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, overlay.width, overlay.height); }
}
let wakeLock = null;
async function keepAwake(on) {
  try { if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; } } catch (e) {}
}

// ---------------- models ----------------
let modelsP = null, modelsReady = false;
function ensureModels() {
  if (!modelsP) {
    modelsP = V.loadModels(m => {
      $('modelStatus').textContent = m === 'מוכן' ? '✓ הזיהוי מוכן' : '⏳ ' + m;
      $('loadingText').textContent = m;
    }).then(() => { modelsReady = true; }).catch(e => { console.error(e); modelsP = null; $('modelStatus').textContent = '⚠️ טעינת הזיהוי נכשלה'; throw e; });
  }
  return modelsP;
}
async function withModels() {
  if (modelsReady) return true;
  loading(true, 'טוען את מודלי הזיהוי… (רק בפעם הראשונה זה לוקח קצת זמן)');
  try { await ensureModels(); return true; }
  catch (e) { toast('טעינת הזיהוי נכשלה. בדקו את החיבור לאינטרנט ונסו שוב'); return false; }
  finally { loading(false); }
}
async function startCam(facing = 'environment') {
  try { await cam.start(facing); return true; }
  catch (e) { console.warn(e); toast('אין גישה למצלמה. צריך לאשר הרשאת מצלמה בדפדפן'); return false; }
}

// ---------------- home ----------------
function renderHome() {
  $('inPlayer').value = S.settings.player || '';
  $('inTarget').value = S.profile.name || '';
  const f = S.hasFace(), l = S.hasLook();
  $('stFace').textContent = f ? '✓ נשמרה' : 'חסרה'; $('stFace').className = 'badge ' + (f ? 'ok' : 'no');
  $('stLook').textContent = l ? '✓ בוצעה היום' : 'עוד לא היום'; $('stLook').className = 'badge ' + (l ? 'ok' : 'no');
  $('btnFace').textContent = f ? 'סריקה מחדש' : 'סריקה';
  $('btnLook').textContent = l ? 'סריקה מחדש' : 'סריקה';
}
$('inPlayer').addEventListener('input', e => { S.settings.player = e.target.value.trim(); S.saveSettings(); });
$('inTarget').addEventListener('input', e => { S.profile.name = e.target.value.trim(); S.saveProfile(); });
$('inTarget').addEventListener('change', () => sendHello());

// ---------------- scans ----------------
let curScan = null, scanBack = 'home';
async function runScan(kind) {
  unlockAudio();
  if (kind === 'look' && !S.hasFace()) { toast('קודם צריך טביעת פנים, ורק אחריה סריקת 360°'); return; }
  if (!await withModels()) return;
  scanBack = screen;
  $('scanTitle').textContent = kind === 'face' ? '🙂 טביעת פנים' : '🔄 סריקת 360°';
  $('scanTip').textContent = kind === 'face'
    ? 'תאורה טובה, בלי כובע ובלי משקפי שמש. מחזיקים את הטלפון בגובה הפנים שלו, בערך חצי מטר ממנו.'
    : 'הכי קל: הוא יושב על כיסא מסתובב ומסתובב לאט סיבוב שלם. עומדים בערך 2 מ\' ממנו, הטלפון בגובה הראש, וכל הראש והכתפיים בתוך הפריים.';
  $('scanText').textContent = ''; $('scanBar').style.width = '0%';
  show('scan');
  if (!await startCam('environment')) { show(scanBack); return; }
  keepAwake(true);
  const ui = { video, canvas: overlay, cam, cancelled: false, setText: t => { $('scanText').textContent = t; }, setProgress: p => { $('scanBar').style.width = Math.round(p * 100) + '%'; } };
  curScan = ui;
  let res = null;
  try { res = kind === 'face' ? await faceScan(ui) : await bodyScan(ui); } catch (e) { console.error(e); toast('הסריקה נכשלה: ' + e.message); }
  curScan = null; cam.stop(); keepAwake(false);
  if (res) {
    kind === 'face' ? S.setFace(res) : S.setLook(res);
    sfx.win(); toast(kind === 'face' ? '✓ טביעת הפנים נשמרה' : '✓ סריקת 360° נשמרה להיום');
    pushProfile();
  }
  show(scanBack); renderHome(); renderLobby();
}
$('btnFace').onclick = () => runScan('face');
$('btnLook').onclick = () => runScan('look');
$('lbFace').onclick = () => runScan('face');
$('lbLook').onclick = () => runScan('look');
$('scanClose').onclick = () => { if (curScan) curScan.cancelled = true; };
$('scanFlip').onclick = () => cam.start(cam.facing === 'user' ? 'environment' : 'user').catch(() => {});

// ---------------- room / connection ----------------
let net = null, role = null, me = 0;
const other = { name: '', meta: null, connected: false };
const myName = () => S.settings.player || (me === 0 ? 'שחקן 1' : 'שחקן 2');
function names() { const n = []; n[me] = myName(); n[1 - me] = other.name || (me === 0 ? 'שחקן 2' : 'שחקן 1'); return n; }

function sendHello() { if (net && net.connected) net.send({ t: 'hello', name: myName(), meta: S.meta() }); }
function sendProfile() {
  if (!net || !net.connected || !S.hasFace()) return;
  const p = S.profile;
  net.sendBig('profile', JSON.stringify({ name: p.name, face: p.face, faceAt: p.faceAt, look: S.hasLook() ? p.look : undefined, lookAt: p.lookAt, lookDay: p.lookDay }));
}
function pushProfile() { sendHello(); sendProfile(); }

function onStatus(s, detail) {
  if (s === 'connected') { other.connected = true; sfx.lock(); sendHello(); if (role === 'host' && G) broadcast(); }
  if (s === 'disconnected') { if (other.connected) toast('החבר התנתק. מנסים להתחבר מחדש…'); other.connected = false; }
  if (s === 'noroom') $('lbNote').textContent = 'לא מוצאים את החדר. ודאו שהטלפון של החבר עדיין פתוח על החדר. מנסים שוב…';
  if (s === 'error' && detail === 'network') $('lbNote').textContent = 'בעיית רשת. מנסים שוב…';
  renderLobby();
}
function onMessage(m) {
  switch (m.t) {
    case 'hello':
      other.name = m.name; other.meta = m.meta;
      if (!S.profile.name && m.meta && m.meta.name) { S.profile.name = m.meta.name; S.saveProfile(); renderHome(); }
      if (S.wantsFrom(m.meta || {})) net.send({ t: 'prof-req' });
      renderLobby(); if (game) game.names = names(); break;
    case 'prof-req': sendProfile(); break;
    case 'profile':
      try { if (S.mergeProfile(JSON.parse(m.data))) { toast(`✓ הסריקות של ${S.targetName()} הגיעו מהחבר`); renderHome(); sendHello(); } } catch (e) { console.warn(e); }
      renderLobby(); break;
    case 'full': toast('החדר כבר מלא (2 שחקנים)'); break;
    case 'report': if (role === 'host') rep[1] = { ...m, at: Date.now() }; break;
    case 'tap': if (role === 'host') hostTap(1); break;
    case 'hit': if (role === 'host') hostHit(1, m); break;
    case 'rematch': if (role === 'host') hostRematch(); break;
    case 'state': if (role === 'guest') { G = m.G; onState(); } break;
  }
}

function roomLink() { return location.origin + location.pathname + '?room=' + (net ? net.code : ''); }
function renderLobby() {
  if (!net && role !== 'practice') return;
  const code = net ? net.code : '';
  $('roomCode').textContent = code;
  $('roomLink').value = roomLink();
  $('btnWa').href = 'https://wa.me/?text=' + encodeURIComponent('בוא לדו-קרב פומפות 🪠🎯 ' + roomLink());
  $('shareCard').hidden = role !== 'host';
  $('lbMe').textContent = myName() + ' (אתה)';
  const mine = `${S.hasFace() ? '✓ פנים' : '✗ פנים'} · ${S.hasLook() ? '✓ 360°' : '○ 360°'}`;
  $('lbMeSt').textContent = mine;
  if (other.connected) {
    $('lbOther').textContent = other.name || 'החבר';
    const m = other.meta || {};
    $('lbOtherSt').textContent = `מחובר ✓ · ${m.faceAt ? '✓ פנים' : '✗ פנים'} · ${m.lookAt ? '✓ 360°' : '○ 360°'}`;
  } else {
    $('lbOther').textContent = role === 'host' ? 'מחכה לחבר…' : 'מתחבר לחדר…';
    $('lbOtherSt').textContent = '';
  }
  const ready = other.connected && S.hasFace() && other.meta && other.meta.faceAt;
  let note = '';
  if (!S.hasFace() && !(other.meta && other.meta.faceAt)) note = `צריך טביעת פנים של ${S.targetName()}. אחד מכם סורק, והיא עוברת לטלפון השני לבד.`;
  else if (other.connected && !ready) note = 'מעבירים את הסריקות בין הטלפונים…';
  else if (S.settings.backLock && !S.hasLook()) note = `טיפ: בלי סריקת 360° להיום יזהו את ${S.targetName()} רק כשרואים את הפנים שלו (ואז עוקבים אחריו).`;
  if (other.connected || role === 'host') $('lbNote').textContent = note;
  $('lbScanRow').hidden = false;
  $('btnStart').hidden = role !== 'host';
  $('btnStart').disabled = !ready;
  $('lbWait').hidden = role !== 'guest';
  $('btnBack').hidden = !(G && G.phase !== 'lobby' && !game);
}

$('btnHost').onclick = () => {
  unlockAudio(); ensureModels().catch(() => {});
  if (net) net.close();
  role = 'host'; me = 0; other.connected = false; other.meta = null; other.name = '';
  net = new Net({ onMessage, onStatus });
  net.host(); hostNew(); show('lobby'); renderLobby();
};
$('btnJoin').onclick = () => {
  unlockAudio(); ensureModels().catch(() => {});
  if (net) net.close();
  role = 'guest'; me = 1; other.connected = false; G = null;
  net = new Net({ onMessage, onStatus });
  net.join(inviteCode); show('lobby'); renderLobby();
};
$('btnPractice').onclick = async () => {
  unlockAudio();
  if (!S.hasFace()) { toast(`קודם סורקים את הפנים של ${S.profile.name || 'המטרה'}`); return; }
  if (net) { net.close(); net = null; }
  role = 'practice'; me = 0; hostNew(); hostSet('position');
};
$('btnStart').onclick = () => { unlockAudio(); if (role === 'host') hostSet('position'); };
$('btnBack').onclick = () => { unlockAudio(); userLeftGame = false; onState(); };
$('btnCopy').onclick = async () => { try { await navigator.clipboard.writeText(roomLink()); toast('✓ הקישור הועתק'); } catch (e) { $('roomLink').select(); toast('סמנו והעתיקו את הקישור'); } };
$('btnLeave').onclick = () => {
  if (net) net.close(); net = null; role = null; G = null;
  history.replaceState(null, '', location.pathname); $('invite').hidden = true;
  show('home'); renderHome();
};

// ---------------- referee (runs on the host phone, or alone in practice) ----------------
let G = null, rep = [{}, {}], lastBc = 0;
const isRef = () => role === 'host' || role === 'practice';
function hostNew() { G = { phase: 'lobby', scores: [0, 0], ready: [false, false], winner: -1, stuck: null, round: 0, rep: [{}, {}], at: Date.now() }; rep = [{}, {}]; }
function hostSet(ph) { G.phase = ph; G.at = Date.now(); if (ph === 'start') G.ready = [false, false]; broadcast(); }
function pub(i) {
  const r = rep[i] || {}, fresh = Date.now() - (r.at || 0) < 1500;
  return { locked: !!r.locked && fresh, dist: r.dist || 0, connected: i === 0 || role === 'practice' || other.connected };
}
function broadcast() {
  lastBc = Date.now(); G.rep = [pub(0), pub(1)];
  if (role === 'host' && net) net.send({ t: 'state', G });
  onState();
}
function okOf(i) {
  if (role === 'practice' && i === 1) return true;
  const r = rep[i]; if (!r || Date.now() - (r.at || 0) > 1500) return false;
  return r.locked && r.dist >= (G.phase === 'position' ? 2 : 1.9);
}
setInterval(() => {
  if (!isRef() || !G || G.phase === 'lobby') return;
  const both = okOf(0) && okOf(1);
  switch (G.phase) {
    case 'position': if (both) hostSet('start'); break;
    case 'start':
      if (!both) { hostSet('position'); break; }
      if (role === 'practice') G.ready[1] = true;
      if (G.ready[0] && G.ready[1]) hostSet('countdown');
      break;
    case 'countdown': if (Date.now() - G.at >= 3000) { G.round++; hostSet('duel'); } break;
  }
  if (Date.now() - lastBc > 400) broadcast();
}, 100);
function hostTap(i) { if (G && G.phase === 'start' && !G.ready[i]) { G.ready[i] = true; broadcast(); } }
function hostHit(i, h) {
  if (!G || G.phase !== 'duel' || h.round !== G.round) return;   // first hit of the round wins; later ones are ignored
  G.winner = i; G.scores[i]++; G.stuck = { owner: i, u: h.u, v: h.v }; hostSet('win');
}
function hostRematch() { if (G && G.phase === 'win') { G.stuck = null; G.winner = -1; hostSet('position'); } }

// ---------------- game screen ----------------
let game = null, entering = false;
const gameCb = {
  report: r => { if (isRef()) rep[0] = { ...r, at: Date.now() }; else if (net) net.send({ t: 'report', ...r }); },
  tap: () => { if (isRef()) hostTap(me); else if (net) net.send({ t: 'tap' }); },
  hit: h => { if (isRef()) hostHit(me, h); else if (net) net.send({ t: 'hit', ...h }); },
  rematch: () => { if (isRef()) hostRematch(); else if (net) net.send({ t: 'rematch' }); },
};
function onState() {
  if (!G) return;
  if (G.phase === 'lobby') { if (game) leaveGame(false); renderLobby(); return; }
  if (game) game.setState(clone(G));
  else if (screen !== 'game' && !userLeftGame) enterGame();
  renderLobby();
}
let userLeftGame = false;
async function enterGame() {
  if (game || entering) return;
  if (!S.hasFace()) { toast(`חסרה טביעת פנים של ${S.targetName()}`); return; }
  entering = true;
  try {
    if (!await withModels()) return;
    show('game');
    if (!await startCam('environment')) { show(role === 'practice' ? 'home' : 'lobby'); return; }
    keepAwake(true);
    game = new Game({ video, canvas: overlay, cam, me, names: names(), practice: role === 'practice', cb: gameCb });
    game.start(); game.setState(clone(G));
  } finally { entering = false; }
}
function leaveGame(byUser) {
  if (game) { game.stop(); game = null; }
  cam.stop(); keepAwake(false);
  if (role === 'practice') { role = null; G = null; show('home'); renderHome(); return; }
  if (byUser && role === 'host' && G) { G.phase = 'lobby'; broadcast(); }
  show(role ? 'lobby' : 'home'); renderLobby();
}
$('gExit').onclick = () => { if (confirm('לצאת מהמשחק?')) { userLeftGame = role === 'guest'; leaveGame(true); } };

// ---------------- settings ----------------
function renderSettings() {
  const s = S.settings;
  $('setBack').checked = s.backLock; $('setThr').value = s.lookThr; $('setThrV').textContent = s.lookThr.toFixed(2);
  $('setFov').value = s.fov; $('setFovV').textContent = s.fov + '°';
  $('setSound').checked = s.sound; $('setDebug').checked = s.debug;
  $('setCalV').textContent = s.distK === 1 ? 'לא כויל' : '×' + s.distK.toFixed(2);
}
$('btnSettings').onclick = () => { renderSettings(); $('settings').hidden = false; };
$('setClose').onclick = () => { $('settings').hidden = true; renderLobby(); };
$('setBack').onchange = e => { S.settings.backLock = e.target.checked; S.saveSettings(); };
$('setThr').oninput = e => { S.settings.lookThr = +e.target.value; $('setThrV').textContent = (+e.target.value).toFixed(2); S.saveSettings(); };
$('setFov').oninput = e => { S.settings.fov = +e.target.value; $('setFovV').textContent = e.target.value + '°'; S.saveSettings(); };
$('setSound').onchange = e => { S.settings.sound = e.target.checked; S.saveSettings(); };
$('setDebug').onchange = e => { S.settings.debug = e.target.checked; S.saveSettings(); };
$('setResetCal').onclick = () => { S.settings.distK = 1; S.saveSettings(); renderSettings(); toast('הכיול אופס'); };
$('setDelete').onclick = () => { if (confirm(`למחוק מהטלפון את טביעת הפנים ואת סריקת ה-360° של ${S.targetName()}?`)) { S.deleteProfile(); renderHome(); renderSettings(); toast('✓ הנתונים נמחקו מהטלפון'); } };

// ---------------- boot ----------------
const inviteCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
if (inviteCode) { $('invite').hidden = false; $('inviteCode').textContent = inviteCode; }
if (!window.isSecureContext) toast('המשחק חייב לרוץ בכתובת https (למשל GitHub Pages) כדי לקבל גישה למצלמה', 6000);
renderHome(); show('home');
// start downloading the recognition models in the background
setTimeout(() => ensureModels().catch(() => {}), 300);
window.__pd = { S, get G() { return G; }, get game() { return game; } };   // handy for debugging in the console
