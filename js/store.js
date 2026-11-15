// Local storage for the target profile (face print + today's 360° scan) and settings.
// Everything stays on the phone. The other phone gets a copy over the direct phone-to-phone link.
const PK = 'pd_profile_v1', SK = 'pd_settings_v1';

export const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const q = a => Array.from(a, x => Math.round(x * 1e4) / 1e4);

export const profile = (() => { try { return JSON.parse(localStorage.getItem(PK)) || {}; } catch (e) { return {}; } })();
export function saveProfile() { try { localStorage.setItem(PK, JSON.stringify(profile)); return true; } catch (e) { console.warn(e); return false; } }
export function deleteProfile() { for (const k of Object.keys(profile)) delete profile[k]; try { localStorage.removeItem(PK); } catch (e) {} }
export function setFace(list) { profile.face = list.map(q); profile.faceAt = Date.now(); saveProfile(); }
export function setLook(list) { profile.look = list.map(q); profile.lookAt = Date.now(); profile.lookDay = today(); saveProfile(); }

export const hasFace = (p = profile) => Array.isArray(p.face) && p.face.length >= 5;
export const hasLook = (p = profile) => Array.isArray(p.look) && p.look.length >= 10 && p.lookDay === today();
export const targetName = () => profile.name || 'המטרה';

export function meta() { return { faceAt: hasFace() ? profile.faceAt : 0, lookAt: hasLook() ? profile.lookAt : 0, name: profile.name || '' }; }
// does the other phone have something newer than me?
export function wantsFrom(m) { return (m.faceAt || 0) > (hasFace() ? profile.faceAt : 0) || (m.lookAt || 0) > (hasLook() ? profile.lookAt : 0); }
export function mergeProfile(o) {
  let changed = false;
  if (hasFace(o) && (o.faceAt || 0) > (hasFace() ? profile.faceAt : 0)) { profile.face = o.face; profile.faceAt = o.faceAt; changed = true; }
  if (hasLook(o) && (o.lookAt || 0) > (hasLook() ? profile.lookAt : 0)) { profile.look = o.look; profile.lookAt = o.lookAt; profile.lookDay = o.lookDay; changed = true; }
  if (changed && o.name) profile.name = o.name;
  if (changed) saveProfile();
  return changed;
}

export const settings = Object.assign(
  { player: '', backLock: true, lookThr: 0.82, distK: 1, fov: 65, debug: false, sound: true },
  (() => { try { return JSON.parse(localStorage.getItem(SK)) || {}; } catch (e) { return {}; } })()
);
export function saveSettings() { try { localStorage.setItem(SK, JSON.stringify(settings)); } catch (e) {} }
