// Vision: camera, face identity (face-api), body/head tracking (MediaPipe Pose),
// appearance matching for the back of the head (MediaPipe Image Embedder).
import * as faceapi from '../vendor/face-api/face-api.esm.js';
import { FilesetResolver, PoseLandmarker, ImageEmbedder } from '../vendor/mediapipe/vision_bundle.mjs';

const BASE = new URL('../vendor/', import.meta.url).href;
export const FACE_OK = 0.5;    // face distance at/below this = it's him
export const FACE_BAD = 0.6;   // at/above this = definitely someone else

let pose = null, embedder = null;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------- models ----------------
export async function loadModels(onProgress = () => {}) {
  onProgress('טוען זיהוי פנים… (1/3)');
  try { await faceapi.tf.setBackend('webgl'); } catch (e) { /* falls back automatically */ }
  await faceapi.tf.ready();
  const m = BASE + 'face-api/model/';
  await faceapi.nets.tinyFaceDetector.loadFromUri(m);
  await faceapi.nets.faceLandmark68Net.loadFromUri(m);
  await faceapi.nets.faceRecognitionNet.loadFromUri(m);

  onProgress('טוען זיהוי גוף… (2/3)');
  // use our own copy of the MediaPipe engine; if a file is missing on the site, fall back to the public CDN copy
  let wasmBase = BASE + 'mediapipe/wasm';
  try {
    const ok = await Promise.all(['vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.wasm']
      .map(f => fetch(wasmBase + '/' + f, { method: 'HEAD' }).then(r => r.ok).catch(() => false)));
    if (!ok.every(Boolean)) { console.warn('local MediaPipe wasm missing, using CDN'); wasmBase = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'; }
  } catch (e) {}
  const fs = await FilesetResolver.forVisionTasks(wasmBase);
  const mkPose = (delegate) => PoseLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: BASE + 'models/pose_landmarker_lite.task', delegate },
    runningMode: 'VIDEO', numPoses: 3,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { pose = await mkPose('GPU'); } catch (e) { console.warn('pose GPU failed, using CPU', e); pose = await mkPose('CPU'); }

  onProgress('טוען זיהוי מראה… (3/3)');
  const mkEmb = (delegate) => ImageEmbedder.createFromOptions(fs, {
    baseOptions: { modelAssetPath: BASE + 'models/mobilenet_v3_small.tflite', delegate },
    runningMode: 'IMAGE', l2Normalize: true,
  });
  try { embedder = await mkEmb('GPU'); } catch (e) { console.warn('embedder GPU failed, using CPU', e); embedder = await mkEmb('CPU'); }
  onProgress('מוכן');
}

// ---------------- camera ----------------
export class Camera {
  constructor(video) { this.video = video; this.track = null; this.facing = 'environment'; this.zoom = 1; this.zoomBase = 1; this.caps = {}; }
  async start(facing = this.facing) {
    this.stop();
    this.facing = facing;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    const v = this.video;
    v.setAttribute('playsinline', ''); v.muted = true; v.srcObject = stream;
    await v.play().catch(() => {});
    if (!v.videoWidth) await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true }));
    this.track = stream.getVideoTracks()[0];
    this.caps = (this.track.getCapabilities && this.track.getCapabilities()) || {};
    if (this.caps.zoom) { this.zoomBase = this.caps.zoom.min || 1; this.zoom = this.zoomBase; }
    v.classList.toggle('mirror', facing === 'user');
  }
  stop() {
    const s = this.video.srcObject;
    if (s) { s.getTracks().forEach(t => t.stop()); this.video.srcObject = null; }
    this.track = null;
  }
  get running() { return !!this.track && this.track.readyState === 'live'; }
  get canZoom() { return !!this.caps.zoom; }
  async setZoom(z) {
    if (!this.caps.zoom) return;
    z = clamp(z, this.caps.zoom.min, this.caps.zoom.max);
    try { await this.track.applyConstraints({ advanced: [{ zoom: z }] }); this.zoom = z; } catch (e) { console.warn(e); }
  }
  get zoomFactor() { return this.caps.zoom ? this.zoom / (this.zoomBase || 1) : 1; }
}

// maps video pixel coords <-> screen CSS px for a full-screen object-fit:cover video
export function coverMap(video, sw, sh, mirror = false) {
  const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
  const s = Math.max(sw / vw, sh / vh), ox = (sw - vw * s) / 2, oy = (sh - vh * s) / 2;
  return {
    s,
    toS: (x, y) => ({ x: mirror ? sw - (x * s + ox) : x * s + ox, y: y * s + oy }),
    toV: (x, y) => ({ x: ((mirror ? sw - x : x) - ox) / s, y: (y - oy) / s }),
  };
}

// ---------------- pose -> head / body boxes ----------------
let lastTs = 0;
export function detectPoses(video) {
  if (!pose || !video.videoWidth) return [];
  let ts = performance.now(); if (ts <= lastTs) ts = lastTs + 1; lastTs = ts;
  const r = pose.detectForVideo(video, ts);
  const W = video.videoWidth, H = video.videoHeight;
  return (r.landmarks || []).map((lm, i) => poseToPerson(lm, W, H, (r.worldLandmarks || [])[i])).filter(Boolean);
}

function poseToPerson(lm, W, H, wl) {
  const P = i => ({ x: lm[i].x * W, y: lm[i].y * H, v: lm[i].visibility ?? 1 });
  const nose = P(0), le = P(7), re = P(8), ls = P(11), rs = P(12), lh = P(23), rh = P(24);
  const shW = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (shW < 12) return null;
  const earW = Math.hypot(le.x - re.x, le.y - re.y);
  const earsOk = le.v > 0.25 && re.v > 0.25;
  const hw = Math.max(earsOk ? earW * 1.2 : 0, shW * 0.42);
  let cx, cy;
  if (earsOk) { cx = (le.x + re.x) / 2; cy = (le.y + re.y) / 2 - hw * 0.22; }
  else if (nose.v > 0.3) { cx = nose.x; cy = nose.y - hw * 0.3; }
  else { cx = (ls.x + rs.x) / 2; cy = Math.min(ls.y, rs.y) - shW * 0.75; }
  const hh = hw * 1.25;
  const shX = (ls.x + rs.x) / 2, shY = (ls.y + rs.y) / 2;
  const hipsOk = lh.v > 0.5 && rh.v > 0.5;
  const torso = hipsOk ? Math.hypot((lh.x + rh.x) / 2 - shX, (lh.y + rh.y) / 2 - shY) : 0;
  return {
    head: { cx, cy, w: hw, h: hh },
    body: { x: Math.min(cx - hw, shX - shW * 0.8), y: cy - hh * 0.75, x2: Math.max(cx + hw, shX + shW * 0.8), y2: shY + shW * 0.75 },
    shW, torso, noseVis: nose.v, basis: headBasis(wl),
  };
}

// 3D head orientation from the pose model's metric landmarks (ears + nose).
// Returned in a "screen" frame: x right, y up, z toward the viewer. Columns: side (his left), up, fwd (his face).
function headBasis(wl) {
  if (!wl || wl.length < 9) return null;
  const P = i => [wl[i].x, -wl[i].y, -wl[i].z];
  const L = P(7), R = P(8), N = P(0);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dotv = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const side = norm(sub(L, R));
  const mid = [(L[0] + R[0]) / 2, (L[1] + R[1]) / 2, (L[2] + R[2]) / 2];
  let f = sub(N, mid); const k = dotv(f, side); f = norm([f[0] - side[0] * k, f[1] - side[1] * k, f[2] - side[2] * k]);
  const up = norm([f[1] * side[2] - f[2] * side[1], f[2] * side[0] - f[0] * side[2], f[0] * side[1] - f[1] * side[0]]);
  return { side, up, fwd: f };
}

// distance (m) from body size in the frame. fov = horizontal FOV of the long side of the video.
export function rawDistance(person, video, fovDeg, zoomFactor = 1) {
  const longSide = Math.max(video.videoWidth, video.videoHeight);
  const f = longSide / (2 * Math.tan((fovDeg * Math.PI / 180) / 2)) * zoomFactor;
  if (person.torso > 20) return 0.5 * f / person.torso;     // shoulder->hip ≈ 50 cm, doesn't shrink when he turns
  return 0.4 * f / Math.max(person.shW, 1);                  // shoulders ≈ 40 cm
}

// ---------------- face identity ----------------
const faceCanvas = document.createElement('canvas'); faceCanvas.width = faceCanvas.height = 256;
const faceCtx = faceCanvas.getContext('2d', { willReadFrequently: true });

export async function faceOnHead(video, head) {
  const s = Math.max(head.w, head.h) * 2.2, x = head.cx - s / 2, y = head.cy - s / 2;
  faceCtx.fillStyle = '#000'; faceCtx.fillRect(0, 0, 256, 256);
  faceCtx.drawImage(video, x, y, s, s, 0, 0, 256, 256);
  const r = await faceapi.detectSingleFace(faceCanvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 }))
    .withFaceLandmarks().withFaceDescriptor();
  return r ? { desc: r.descriptor, score: r.detection.score } : null;
}

export async function detectFaces(video) {
  const r = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
    .withFaceLandmarks().withFaceDescriptors();
  return r.map(f => ({ box: f.detection.box, desc: f.descriptor, score: f.detection.score, lm: f.landmarks }));
}

export const faceDist = (a, b) => faceapi.euclideanDistance(a, b);
export function minFaceDist(list, desc) { let m = 9; for (const f of list || []) { const d = faceapi.euclideanDistance(f, desc); if (d < m) m = d; } return m; }

// ---------------- appearance (back of the head) ----------------
const embCanvas = document.createElement('canvas'); embCanvas.width = embCanvas.height = 224;
const embCtx = embCanvas.getContext('2d');
export function embedBody(video, b) {
  if (!embedder) return null;
  const w = b.x2 - b.x, h = b.y2 - b.y, s = Math.max(w, h);
  const x = (b.x + b.x2) / 2 - s / 2, y = (b.y + b.y2) / 2 - s / 2;
  embCtx.fillStyle = '#808080'; embCtx.fillRect(0, 0, 224, 224);
  embCtx.drawImage(video, x, y, s, s, 0, 0, 224, 224);
  const r = embedder.embed(embCanvas);
  return r.embeddings[0].floatEmbedding;
}
export function dot(a, b) { let s = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; }
export function lookSim(gallery, e) { if (!e) return -1; let m = -1; for (const g of gallery || []) { const s = dot(g, e); if (s > m) m = s; } return m; }

// ---------------- tracker: lock on HIM only ----------------
function nearest(cands, head) {
  let best = null, bd = Math.max(head.w * 1.5, 40);
  for (const c of cands) { const d = Math.hypot(c.head.cx - head.cx, c.head.cy - head.cy); if (d < bd) { bd = d; best = c; } }
  return best;
}

export class Tracker {
  constructor(profile, opt) {
    this.prof = profile; this.opt = opt;
    this.lock = null; this.via = null; this.lastSeen = 0; this.lockedAt = 0;
    this.lastFaceT = 0; this.lastEmbT = 0; this.streak = 0; this.badLook = 0; this.rr = 0;
    this.rejects = []; this.cands = []; this.sm = null; this.dists = []; this.dist = null; this.rawDist = null;
    this.info = { face: null, sim: null, msg: '' };
  }
  isRejected(c) { return this.rejects.some(r => Math.hypot(r.head.cx - c.head.cx, r.head.cy - c.head.cy) < Math.max(r.head.w, c.head.w)); }
  setLock(c, via, now) { if (!this.lock) { this.lockedAt = now; this.dists = []; } this.lock = c; this.via = via; this.lastSeen = now; this.streak = 0; this.badLook = 0; }
  drop(why) { this.lock = null; this.via = null; this.sm = null; this.info.msg = why; }

  async step(video, cam) {
    const now = performance.now();
    const cands = detectPoses(video); this.cands = cands;
    this.rejects = this.rejects.filter(r => now - r.t < 4000);

    if (this.lock) {
      const c = nearest(cands, this.lock.head);
      if (c) { this.lock = c; this.lastSeen = now; }
      else if (now - this.lastSeen > 800) this.drop('lost');
    }

    // 1) face check: confirms him or rejects anyone else
    const faces = this.prof.face;
    if (faces && faces.length && cands.length && now - this.lastFaceT > 350) {
      this.lastFaceT = now;
      let target = this.lock, sideCheck = false;
      const others = cands.filter(c => c !== this.lock);
      if (!target) { const free = others.filter(c => !this.isRejected(c)); if (free.length) target = free[this.rr++ % free.length]; }
      else if (others.length && (this.rr++ % 3 === 2)) { target = others[this.rr % others.length]; sideCheck = true; }  // keep marking other people as "not him"
      if (target) {
        const f = await faceOnHead(video, target.head);
        if (f) {
          const d = minFaceDist(faces, f.desc);
          if (!sideCheck) this.info.face = d;
          if (sideCheck) { if (d >= FACE_BAD) this.rejects.push({ head: { ...target.head }, t: now }); }
          else if (d <= FACE_OK) { this.setLock(target, 'face', now); this.lastFaceOk = now; this.info.msg = ''; }
          else if (d >= FACE_BAD) {
            if (this.lock === target) this.drop('notHim');
            this.rejects.push({ head: { ...target.head }, t: now });
          }
        }
      }
    }

    // 2) appearance check (lets you lock on him from behind)
    const look = this.prof.look;
    if (this.opt.backLock && look && look.length && cands.length && now - this.lastEmbT > (this.lock ? 900 : 400)) {
      this.lastEmbT = now;
      if (this.lock) {
        if (this.via === 'look') {
          const s = lookSim(look, embedBody(video, this.lock.body)); this.info.sim = s;
          if (s < this.opt.lookThr - 0.08) { if (++this.badLook >= 3) this.drop('lost'); } else this.badLook = 0;
        }
      } else {
        let best = null, bs = -1;
        for (const c of cands) { if (this.isRejected(c)) continue; const s = lookSim(look, embedBody(video, c.body)); if (s > bs) { bs = s; best = c; } }
        this.info.sim = bs;
        if (best && bs >= this.opt.lookThr) { if (++this.streak >= 3) this.setLock(best, 'look', now); } else this.streak = 0;
      }
    }

    if (this.lock) {
      const h = this.lock.head;
      if (!this.sm) this.sm = { ...h };
      else { const a = 0.5; this.sm.cx += (h.cx - this.sm.cx) * a; this.sm.cy += (h.cy - this.sm.cy) * a; this.sm.w += (h.w - this.sm.w) * a; this.sm.h += (h.h - this.sm.h) * a; }
      this.dists.push(rawDistance(this.lock, video, cam.fov, cam.zoom)); if (this.dists.length > 9) this.dists.shift();
      const sorted = [...this.dists].sort((a, b) => a - b); this.rawDist = sorted[sorted.length >> 1];
      this.dist = this.rawDist * cam.k;
    } else { this.dist = null; }
    return {
      locked: !!this.lock, via: this.via, head: this.sm, dist: this.dist, rawDist: this.rawDist,
      basis: this.lock ? this.lock.basis : null, faceSeen: now - (this.lastFaceOk || 0) < 1500,
      cands, rejects: this.rejects, info: this.info, lockPerson: this.lock,
    };
  }
}
