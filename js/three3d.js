// Real 3D plungers (three.js) drawn over the camera.
// A stuck plunger is attached to HIS head's 3D frame, so it turns with him,
// and both phones place it on the same spot of his head, each from its own angle.
import * as THREE from '../vendor/three/three.module.min.js?v=4';

const HEAD = { a: 0.08, b: 0.105, c: 0.095 };   // head half-size in metres: side, up, front
const HEAD_W = 0.17;                            // width of the tracked head box in metres (ear to ear + a bit)

function makePlunger() {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xd42828, roughness: 0.32, metalness: 0, side: THREE.DoubleSide, transparent: true });
  const rimM = new THREE.MeshStandardMaterial({ color: 0x8a1212, roughness: 0.4, transparent: true });
  const wood = new THREE.MeshStandardMaterial({ color: 0xc8915a, roughness: 0.55, transparent: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4a2e15, roughness: 0.6, transparent: true });
  // rubber cup: open rim at y=0, dome rising to the handle
  const pts = [];
  for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI / 2; pts.push(new THREE.Vector2(0.014 + 0.041 * Math.cos(a), 0.062 * Math.sin(a))); }
  const cup = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), red);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.0065, 12, 48), rimM); rim.rotation.x = Math.PI / 2;
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 20), wood); stick.position.y = 0.055 + 0.13;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.0145, 0.022, 20), dark); cap.position.y = 0.055 + 0.26;
  g.add(cup, rim, stick, cap);
  g.userData.mats = [red, rimM, wood, dark];
  return g;
}
function setAlpha(g, a) { for (const m of g.userData.mats) { m.opacity = a; m.depthWrite = a > 0.98; } }

export class Plungers3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: false });
    this.r.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000); this.cam.position.z = 3000;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a48, 1.4));
    const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(0.6, 1, 1.2); this.scene.add(d);
    // his head: an invisible shape that hides plunger parts behind it
    this.head = new THREE.Group(); this.scene.add(this.head);
    const occ = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshBasicMaterial({ colorWrite: false }));
    occ.scale.set(HEAD.a, HEAD.b, HEAD.c); occ.renderOrder = -1; this.head.add(occ);
    this.stuck = [];
    this.hand = makePlunger(); this.scene.add(this.hand);
    this.flights = [makePlunger(), makePlunger(), makePlunger()]; this.flights.forEach(f => this.scene.add(f));
    this.q = new THREE.Quaternion(); this.hasQ = false;
    this._m = new THREE.Matrix4(); this._tq = new THREE.Quaternion(); this._v = new THREE.Vector3();
  }

  resize(w, h) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (this.w !== w || this.h !== h) {
      this.w = w; this.h = h; this.r.setPixelRatio(dpr); this.r.setSize(w, h, false);
      Object.assign(this.cam, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 }); this.cam.updateProjectionMatrix();
    }
  }
  S(x, y, z = 0) { return [x - this.w / 2, this.h / 2 - y, z]; }

  // smooth 3D orientation of his head
  updateHeadPose(basis, faceSeen, noseVis) {
    if (!basis) return;
    let { side, up, fwd } = basis;
    // the pose model can't always tell front from back: trust the face check
    const looksAtUs = fwd[2] > 0.3, looksAway = fwd[2] < -0.3;
    if ((looksAtUs && !faceSeen && noseVis < 0.4) || (looksAway && faceSeen)) { side = side.map(v => -v); fwd = fwd.map(v => -v); }
    this._m.makeBasis(new THREE.Vector3(...side), new THREE.Vector3(...up), new THREE.Vector3(...fwd));
    this._tq.setFromRotationMatrix(this._m);
    if (!this.hasQ) { this.q.copy(this._tq); this.hasQ = true; } else this.q.slerp(this._tq, 0.35);
  }
  resetHead() { this.hasQ = false; this.q.identity(); }

  // aim point on his face/head ellipse (u,v in -1..1, screen y down) -> direction in HIS head frame
  toHeadLocal(u, v) {
    let l = Math.hypot(u, v); if (l > 0.95) { u *= 0.95 / l; v *= 0.95 / l; }
    const c = new THREE.Vector3(u, -v, Math.sqrt(Math.max(0, 1 - u * u - v * v)));
    c.applyQuaternion(this.q.clone().invert()).normalize();
    return [c.x, c.y, c.z];
  }

  setStuck(list) {
    const key = JSON.stringify(list.map(s => s.l));
    if (key === this.stuckKey) return; this.stuckKey = key;
    for (const s of this.stuck) this.head.remove(s);
    this.stuck = list.map(s => {
      const g = makePlunger(), [x, y, z] = s.l;
      const k = 1 / Math.sqrt((x / HEAD.a) ** 2 + (y / HEAD.b) ** 2 + (z / HEAD.c) ** 2);
      const p = new THREE.Vector3(x * k, y * k, z * k);
      const n = new THREE.Vector3(x / HEAD.a ** 2, y / HEAD.b ** 2, z / HEAD.c ** 2).normalize();
      g.position.copy(p).addScaledVector(n, -0.008);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      g.userData.base = g.quaternion.clone(); g.userData.n = n; g.userData.t0 = s.t0;
      this.head.add(g); return g;
    });
  }

  render({ hs, hand, flights, now }) {
    // head anchor
    if (hs) {
      const pxm = hs.w / HEAD_W;
      this.head.visible = true; this.head.position.set(...this.S(hs.x, hs.y, 0)); this.head.scale.setScalar(pxm);
      this.head.quaternion.copy(this.q);
      for (const g of this.stuck) {   // little wobble right after it sticks
        const age = (now - g.userData.t0) / 1000, wob = 0.3 * Math.sin(age * 22) * Math.exp(-age * 2.5);
        const axis = new THREE.Vector3(1, 0, 0).cross(g.userData.n); if (axis.lengthSq() < 1e-4) axis.set(0, 0, 1);
        g.quaternion.copy(g.userData.base).premultiply(new THREE.Quaternion().setFromAxisAngle(axis.normalize(), wob));
      }
    } else this.head.visible = false;
    // plunger loaded on the bow
    this.hand.visible = !!hand;
    if (hand) {
      this.hand.position.set(...this.S(hand.x, hand.y, 900)); this.hand.scale.setScalar(hand.pxm);
      this.hand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0.5).normalize());
      setAlpha(this.hand, 1);
    }
    // flying plungers
    this.flights.forEach((g, i) => {
      const f = flights[i]; g.visible = !!f;
      if (!f) return;
      g.position.set(...this.S(f.x, f.y, f.z)); g.scale.setScalar(f.pxm);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...f.dir).normalize());
      setAlpha(g, f.alpha);
    });
    this.r.render(this.scene, this.cam);
  }
  clear() { this.head.visible = false; this.hand.visible = false; this.flights.forEach(g => { g.visible = false; }); this.r.render(this.scene, this.cam); }
}
