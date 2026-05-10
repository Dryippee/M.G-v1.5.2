import * as THREE from "https://unpkg.com/three@0.166.1/build/three.module.js";

const socket = io();

const canvas = document.getElementById("c");
const lobbyEl = document.getElementById("lobby");
const hudEl = document.getElementById("hud");
const lobbyStatusEl = document.getElementById("lobbyStatus");
const hostCodeEl = document.getElementById("hostCode");
const btnQuick = document.getElementById("btnQuick");
const btnCreate = document.getElementById("btnCreate");
const btnJoin = document.getElementById("btnJoin");
const btnCancelQueue = document.getElementById("btnCancelQueue");
const roomCodeInput = document.getElementById("roomCodeInput");
const statusEl = document.getElementById("status");
const buildModeEl = document.getElementById("buildModeDisplay");
const roomPillEl = document.getElementById("roomPill");
const youEl = document.getElementById("you");
const teamsEl = document.getElementById("teams");
const scoreEl = document.getElementById("score");
const toastEl = document.getElementById("toast");
const crosshairEl = document.getElementById("crosshair");
const hpFillEl = document.getElementById("hpFill");
const hpNumEl = document.getElementById("hpNum");
const killsNumEl = document.getElementById("killsNum");
const weaponNameEl = document.getElementById("weaponName");
const ammoReadoutEl = document.getElementById("ammoReadout");
const pauseOverlayEl = document.getElementById("pauseOverlay");
const pauseRoomCodeEl = document.getElementById("pauseRoomCode");
const btnResume = document.getElementById("btnResume");
const btnLeaveGame = document.getElementById("btnLeaveGame");
const btnLightPrev = document.getElementById("btnLightPrev");
const btnLightNext = document.getElementById("btnLightNext");
const pauseLightLabelEl = document.getElementById("pauseLightLabel");

const raycaster = new THREE.Raycaster();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d14);
scene.fog = new THREE.Fog(0x0a0d14, 45, 170);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 2.2, 6.5);

const hemi = new THREE.HemisphereLight(0x9fd5ff, 0x2a2f3b, 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.6);
sun.position.set(8, 14, -8);
scene.add(sun);

const floorGeo = new THREE.PlaneGeometry(420, 420, 20, 20);
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x131a24,
  metalness: 0.02,
  roughness: 0.96,
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(160, 80, 0x1d2a3d, 0x1a1f2a);
grid.position.y = 0.01;
scene.add(grid);

const ARENA_HALF = 80;
const WALL_H = 0.95;
const WALL_T = 0.45;
const arenaMat = new THREE.MeshStandardMaterial({
  color: 0x1c2838,
  metalness: 0.04,
  roughness: 0.88,
});
const pillarMat = new THREE.MeshStandardMaterial({
  color: 0x243447,
  metalness: 0.06,
  roughness: 0.82,
});
const riserMat = new THREE.MeshStandardMaterial({
  color: 0x17202c,
  metalness: 0.02,
  roughness: 0.94,
});

function addArenaBounds() {
  const g = new THREE.Group();
  const wallLen = ARENA_HALF * 2 + WALL_T;
  const wallGeoH = new THREE.BoxGeometry(wallLen, WALL_H, WALL_T);
  const wallGeoV = new THREE.BoxGeometry(WALL_T, WALL_H, wallLen);
  const zWall = new THREE.Mesh(wallGeoH, arenaMat);
  zWall.position.set(0, WALL_H / 2, ARENA_HALF + WALL_T / 2);
  const zWallN = zWall.clone();
  zWallN.position.z = -ARENA_HALF - WALL_T / 2;
  const xWall = new THREE.Mesh(wallGeoV, arenaMat);
  xWall.position.set(ARENA_HALF + WALL_T / 2, WALL_H / 2, 0);
  const xWallN = xWall.clone();
  xWallN.position.x = -ARENA_HALF - WALL_T / 2;
  g.add(zWall, zWallN, xWall, xWallN);

  const pillarGeo = new THREE.BoxGeometry(0.85, 3.2, 0.85);
  const ph = 1.6;
  const pc = ARENA_HALF - 0.35;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(sx * pc, ph, sz * pc);
      g.add(pillar);
    }
  }

  const riserGeo = new THREE.BoxGeometry(1.8, 0.14, 1.8);
  const ringR = 22;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const m = new THREE.Mesh(riserGeo, riserMat);
    m.position.set(Math.cos(a) * ringR, 0.07, Math.sin(a) * ringR);
    g.add(m);
  }

  scene.add(g);
}
addArenaBounds();

const RED_COLOR = 0xee4444;
const BLUE_COLOR = 0x4f82ff;

const CONTROLS_MODE_KEY = "arena_controls_v1";
let _controlsMode = "pc"; // "pc" or "mobile"

const state = {
  myId: null,
  players: {},
  builds: [],
  teamScores: { red: 0, blue: 0 },
  teamStatus: {
    red: { count: 0, alive: 0, totalHp: 0 },
    blue: { count: 0, alive: 0, totalHp: 0 },
  },
  meshes: new Map(),
  buildMeshes: new Map(),
  buildPreview: null,
  buildPreviewValid: false,
  controls: { w: false, a: false, s: false, d: false, shift: false, ctrl: false },
  mouseLookActive: false,
  yaw: 0,
  pitch: -0.22,
  velocity: new THREE.Vector3(),
  position: new THREE.Vector3(0, 1.4, 0),
  smoothFollow: new THREE.Vector3(0, 1.4, 0),
  camPos: new THREE.Vector3(),
  grounded: true,
  buildMode: "wall",
  lastNetSend: 0,
  lastToastAt: 0,
  lastRemoveAt: 0,
  roomId: null,
  inMatch: false,
  paused: false,
  coyoteMs: 0,
  lightingIndex: 0,
  muzzleFlash: null,
  nextShotReadyAtMs: 0,
  weapon: "pistol",
  weaponRig: null,
  weaponMeshes: {},
  weaponKick: 0,
  // Mobile touch state
  mobileTouch: { moveId: null, lookId: null, lookX: 0, lookY: 0, lookDragged: false },
  crouchHeight: 1.0,
  jumpRequested: false,
};

const LIGHTING_SESSION_KEY = "arena_lighting_v1";

/** Match server `WEAPONS` tuning (client display + local cooldown). */
const WEAPON_DEFS = {
  pistol: { id: "pistol", name: "Pistol", fireMs: 320, spread: 0.012, recoilPitch: 0.03 },
  ak47: { id: "ak47", name: "AK-47", fireMs: 105, spread: 0.048, recoilPitch: 0.021 },
};

const MOUSE_SENS_X = 0.002;
const MOUSE_SENS_Y = 0.002;
const PITCH_LIMIT = Math.PI / 2 - 0.02;

/** Reused for third-person camera orientation (avoid alloc per frame). */
const _worldUp = new THREE.Vector3(0, 1, 0);

function clearMovementControls() {
  state.controls.w = false;
  state.controls.a = false;
  state.controls.s = false;
  state.controls.d = false;
  state.controls.shift = false;
  state.controls.ctrl = false;
}

function pointerLockActive() {
  return document.pointerLockElement === canvas;
}

const LIGHTING_PRESETS = [
  {
    name: "Day",
    bg: 0x87bfe8,
    fogColor: 0x9ec9f0,
    fogNear: 55,
    fogFar: 220,
    hemiSky: 0xb8dcff,
    hemiGnd: 0x4a5c48,
    hemiIntensity: 1.35,
    sunColor: 0xfff5e6,
    sunIntensity: 0.95,
    sunPos: [20, 28, -18],
  },
  {
    name: "Sunset",
    bg: 0x2a1810,
    fogColor: 0x3d2618,
    fogNear: 38,
    fogFar: 150,
    hemiSky: 0xff9a6b,
    hemiGnd: 0x2a1a2a,
    hemiIntensity: 1.05,
    sunColor: 0xff7a4a,
    sunIntensity: 1.05,
    sunPos: [-26, 12, 22],
  },
  {
    name: "Night",
    bg: 0x0a0d14,
    fogColor: 0x0a0d14,
    fogNear: 45,
    fogFar: 170,
    hemiSky: 0x9fd5ff,
    hemiGnd: 0x2a2f3b,
    hemiIntensity: 1.05,
    sunColor: 0xa8c8ff,
    sunIntensity: 0.35,
    sunPos: [8, 14, -8],
  },
];

try {
  const stored = sessionStorage.getItem(LIGHTING_SESSION_KEY);
  const idx = Number(stored);
  if (Number.isFinite(idx) && idx >= 0 && idx < LIGHTING_PRESETS.length) state.lightingIndex = idx;
} catch (_) {
  /* ignore */
}

function applyLightingMode(index) {
  const P = LIGHTING_PRESETS[Math.max(0, Math.min(LIGHTING_PRESETS.length - 1, index))];
  scene.background.setHex(P.bg);
  scene.fog.color.setHex(P.fogColor);
  scene.fog.near = P.fogNear;
  scene.fog.far = P.fogFar;
  hemi.color.setHex(P.hemiSky);
  hemi.groundColor.setHex(P.hemiGnd);
  hemi.intensity = P.hemiIntensity;
  sun.color.setHex(P.sunColor);
  sun.intensity = P.sunIntensity;
  sun.position.set(P.sunPos[0], P.sunPos[1], P.sunPos[2]);
}

applyLightingMode(state.lightingIndex);

state.smoothFollow.copy(state.position);
state.camPos.copy(camera.position);

function clampPitch(rad) {
  return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, rad));
}

function updatePauseLightLabel() {
  if (pauseLightLabelEl) pauseLightLabelEl.textContent = LIGHTING_PRESETS[state.lightingIndex]?.name ?? "";
}

function updatePauseRoomCode() {
  if (!pauseRoomCodeEl) return;
  const code = state.roomId;
  pauseRoomCodeEl.textContent = code ? `Room code: ${code}` : "Room code: —";
}

function cycleLighting(delta) {
  const n = LIGHTING_PRESETS.length;
  state.lightingIndex = (state.lightingIndex + delta + n) % n;
  applyLightingMode(state.lightingIndex);
  try {
    sessionStorage.setItem(LIGHTING_SESSION_KEY, String(state.lightingIndex));
  } catch (_) {
    /* ignore */
  }
  updatePauseLightLabel();
}

function setPaused(value) {
  state.paused = value;
  if (value) {
    if (_controlsMode !== "mobile") document.exitPointerLock?.();
    state.controls.w = false;
    state.controls.a = false;
    state.controls.s = false;
    state.controls.d = false;
    state.controls.shift = false;
    state.controls.ctrl = false;
    resetMoveStick();
    pauseOverlayEl?.classList.remove("hidden");
    pauseOverlayEl?.setAttribute("aria-hidden", "false");
    updatePauseRoomCode();
    updatePauseLightLabel();
  } else {
    pauseOverlayEl?.classList.add("hidden");
    pauseOverlayEl?.setAttribute("aria-hidden", "true");
  }
}

function togglePause() {
  if (!state.inMatch) return;
  setPaused(!state.paused);
}

const BUILD_DIMS = {
  wall: { hx: 1.2, hy: 1.2, hz: 0.1 },
  floor: { hx: 1.2, hy: 0.1, hz: 1.2 },
  ramp: { hx: 1.2, hy: 0.1, hz: 1.55 },
};
const RAMP_PITCH = -Math.PI * 0.16;
const PLAYER_COLLIDE_RADIUS = 0.44;
const PLAYER_COLLIDE_CENTER_Y = 0.82;

function rotXVec(v, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

function rotYVec(v, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

function buildWorldAabb(b) {
  const kind = b.type === "wall" || b.type === "floor" || b.type === "ramp" ? b.type : "wall";
  const { hx, hy, hz } = BUILD_DIMS[kind];
  const ry = Number.isFinite(b.rotY) ? b.rotY : 0;
  const useRampPitch = b.type === "ramp";
  let minx = Infinity;
  let miny = Infinity;
  let minz = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  let maxz = -Infinity;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        let v = { x: sx * hx, y: sy * hy, z: sz * hz };
        if (useRampPitch) v = rotXVec(v, RAMP_PITCH);
        v = rotYVec(v, ry);
        v.x += b.pos.x;
        v.y += b.pos.y;
        v.z += b.pos.z;
        minx = Math.min(minx, v.x);
        miny = Math.min(miny, v.y);
        minz = Math.min(minz, v.z);
        maxx = Math.max(maxx, v.x);
        maxy = Math.max(maxy, v.y);
        maxz = Math.max(maxz, v.z);
      }
    }
  }
  return { min: { x: minx, y: miny, z: minz }, max: { x: maxx, y: maxy, z: maxz } };
}

function closestPointOnAabb(p, box) {
  return {
    x: Math.max(box.min.x, Math.min(box.max.x, p.x)),
    y: Math.max(box.min.y, Math.min(box.max.y, p.y)),
    z: Math.max(box.min.z, Math.min(box.max.z, p.z)),
  };
}

function resolveLocalBuildCollisions(pos, builds) {
  const center = {
    x: pos.x,
    y: pos.y + PLAYER_COLLIDE_CENTER_Y,
    z: pos.z,
  };
  for (let pass = 0; pass < 4; pass++) {
    for (const b of builds) {
      if (!b?.pos) continue;
      const box = buildWorldAabb(b);
      const cp = closestPointOnAabb(center, box);
      const dx = center.x - cp.x;
      const dy = center.y - cp.y;
      const dz = center.z - cp.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-6 || d >= PLAYER_COLLIDE_RADIUS) continue;
      const push = (PLAYER_COLLIDE_RADIUS - d + 0.02) / d;
      center.x += dx * push;
      center.y += dy * push;
      center.z += dz * push;
    }
  }
  pos.x = Math.max(-200, Math.min(200, center.x));
  pos.y = Math.max(-10, Math.min(200, center.y - PLAYER_COLLIDE_CENTER_Y));
  pos.z = Math.max(-200, Math.min(200, center.z));
}

function spreadDirection(dir, maxRad) {
  const d = dir.clone().normalize();
  if (d.lengthSq() < 1e-12) d.set(0, 0, -1);
  let right = new THREE.Vector3(d.z, 0, -d.x);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(d, right);
  if (up.lengthSq() < 1e-6) up.set(0, 1, 0);
  else up.normalize();
  const u = (Math.random() - 0.5) * 2 * maxRad;
  const v = (Math.random() - 0.5) * 2 * maxRad;
  d.addScaledVector(right, u).addScaledVector(up, v).normalize();
  return d;
}

/**
 * Aim uses yaw (world Y) + pitch; `localForward()` is the view/shoot direction.
 * Camera orientation is applied via quaternion from a stable basis (see `applyThirdPersonCameraOrientation`).
 */

function rayAabbIntersectSegment(origin, dirUnit, tMax, box) {
  let t0 = 0;
  let t1 = tMax;
  for (const a of /** @type {const} */ (["x", "y", "z"])) {
    const o = origin[a];
    const d = dirUnit[a];
    const bn = box.min[a];
    const bx = box.max[a];
    if (Math.abs(d) < 1e-9) {
      if (o < bn || o > bx) return null;
      continue;
    }
    const inv = 1 / d;
    let tNear = (bn - o) * inv;
    let tFar = (bx - o) * inv;
    if (tNear > tFar) {
      const tmp = tNear;
      tNear = tFar;
      tFar = tmp;
    }
    t0 = Math.max(t0, tNear);
    t1 = Math.min(t1, tFar);
    if (t0 > t1) return null;
  }
  return t0 >= 0 ? t0 : null;
}

function clipCameraThroughBuilds(origin, target, builds, minDist = 0.48) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-4) return target.clone();
  const o = { x: origin.x, y: origin.y, z: origin.z };
  const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
  let tMax = dist;
  for (const b of builds) {
    if (!b?.pos) continue;
    const box = buildWorldAabb(b);
    const tHit = rayAabbIntersectSegment(o, dir, tMax, box);
    if (tHit !== null && tHit < tMax - 1e-3) tMax = Math.max(minDist, tHit - 0.14);
  }
  return new THREE.Vector3(o.x + dir.x * tMax, o.y + dir.y * tMax, o.z + dir.z * tMax);
}

function buildWeaponMeshesIntoRig() {
  const rig = state.weaponRig;
  if (!rig) return;
  const gunMetal = new THREE.MeshStandardMaterial({
    color: 0x2a323f,
    metalness: 0.32,
    roughness: 0.48,
  });
  const wood = new THREE.MeshStandardMaterial({
    color: 0x5c3d2e,
    roughness: 0.88,
    metalness: 0.04,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: 0x4a5c6b,
    metalness: 0.22,
    roughness: 0.52,
  });

  const pistol = new THREE.Group();
  const pBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.22), gunMetal);
  const pBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.26, 8), accent);
  pBarrel.rotation.x = Math.PI / 2;
  pBarrel.position.set(0, 0.04, -0.2);
  const pGrip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.1), wood);
  pGrip.position.set(0, -0.11, 0.02);
  pistol.add(pBody, pBarrel, pGrip);

  const ak = new THREE.Group();
  const akRec = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.72), gunMetal);
  akRec.position.set(0, 0, -0.28);
  const akBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.42, 8), accent);
  akBarrel.rotation.x = Math.PI / 2;
  akBarrel.position.set(0, 0.05, -0.76);
  const akMag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.12), wood);
  akMag.position.set(0, -0.14, -0.02);
  const akStock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.28), wood);
  akStock.position.set(0, 0.02, 0.34);
  ak.add(akRec, akBarrel, akMag, akStock);

  pistol.visible = true;
  ak.visible = false;
  rig.add(pistol, ak);
  state.weaponMeshes.pistol = pistol;
  state.weaponMeshes.ak47 = ak;
}

function ensureLocalWeaponRig() {
  if (state.weaponRig) return;
  state.weaponRig = new THREE.Group();
  state.weaponRig.position.set(0.44, -0.48, -0.92);
  camera.add(state.weaponRig);
  buildWeaponMeshesIntoRig();
  syncWeaponVisual();
}

function syncWeaponVisual() {
  const w = state.weapon === "ak47" ? "ak47" : "pistol";
  if (state.weaponMeshes.pistol) state.weaponMeshes.pistol.visible = w === "pistol";
  if (state.weaponMeshes.ak47) state.weaponMeshes.ak47.visible = w === "ak47";
  if (weaponNameEl) weaponNameEl.textContent = WEAPON_DEFS[w].name;
}

function setWeapon(id) {
  const w = id === "ak47" ? "ak47" : "pistol";
  if (state.weapon === w) return;
  state.weapon = w;
  syncWeaponVisual();
  if (state.inMatch && socket.connected) socket.emit("weapon_set", { weapon: w });
}

function cycleWeapon(delta) {
  const order = ["pistol", "ak47"];
  const cur = state.weapon === "ak47" ? "ak47" : "pistol";
  const i = order.indexOf(cur);
  const n = order[(i + (delta > 0 ? 1 : -1) + order.length) % order.length];
  setWeapon(n);
}

function eyeOffsetY() {
  const h = state.controls.ctrl ? 0.36 : 0.54;
  return h * (state.crouchHeight ?? 1.0);
}

function spawnMuzzleFlash(origin, dir) {
  const now = performance.now();
  if (state.muzzleFlash?.mesh) {
    scene.remove(state.muzzleFlash.mesh);
    state.muzzleFlash.mesh.geometry?.dispose();
    state.muzzleFlash.mesh.material?.dispose();
  }
  const geo = new THREE.SphereGeometry(0.13, 8, 8);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffee88,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(origin).addScaledVector(dir, 0.22);
  scene.add(mesh);
  state.muzzleFlash = { mesh, until: now + 72 };
}

function spawnDamageNumber(amount) {
  const el = document.createElement("div");
  el.className = "damage-float";
  el.textContent = String(amount);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function enterMatchUi() {
  state.inMatch = true;
  ensureLocalWeaponRig();
  lobbyEl.classList.add("hidden");
  hudEl.classList.remove("hud-hidden");
  hostCodeEl.classList.add("hidden");
  btnCancelQueue.classList.add("hidden");
  lobbyStatusEl.textContent = "";
  // Show mobile controls if in mobile mode
  if (_controlsMode === "mobile") {
    mobileEl?.classList.remove("hidden");
    // Set active class on current build mode button
    mBuildOpts.forEach(el => {
      el.classList.toggle("active", el.dataset.mode === state.buildMode);
    });
  }
}

function exitMatchUi({ disconnected } = {}) {
  state.inMatch = false;
  state.myId = null;
  state.roomId = null;
  state.players = {};
  state.builds = [];
  state.controls.w = false;
  state.controls.a = false;
  state.controls.s = false;
  state.controls.d = false;
  state.controls.shift = false;
  state.controls.ctrl = false;
  state.nextShotReadyAtMs = 0;
  state.weaponKick = 0;
  crosshairEl?.classList.remove("cool", "hit");
  if (state.muzzleFlash?.mesh) {
    scene.remove(state.muzzleFlash.mesh);
    state.muzzleFlash.mesh.geometry?.dispose();
    state.muzzleFlash.mesh.material?.dispose();
  }
  state.muzzleFlash = null;
  resetMoveStick();
  setPaused(false);
  lobbyEl.classList.remove("hidden");
  hudEl.classList.add("hud-hidden");
  hostCodeEl.classList.add("hidden");
  btnCancelQueue.classList.add("hidden");
  mobileEl?.classList.add("hidden");
  if (disconnected) statusEl.textContent = "Disconnected";
  else if (socket.connected) statusEl.textContent = "Connected";
  for (const [, mesh] of state.meshes) scene.remove(mesh);
  state.meshes.clear();
  for (const [, mesh] of state.buildMeshes) scene.remove(mesh);
  state.buildMeshes.clear();
  updateHud();
}

function showToast(msg) {
  const now = performance.now();
  if (now - state.lastToastAt < 120) return;
  state.lastToastAt = now;
  toastEl.textContent = msg;
  toastEl.classList.add("on");
  setTimeout(() => toastEl.classList.remove("on"), 1200);
}

function playerColor(team) {
  return team === "red" ? RED_COLOR : BLUE_COLOR;
}

function applyTeamColorToGroup(group, team) {
  const hex = playerColor(team);
  group.traverse((o) => {
    if (o.isMesh && o.material?.color) o.material.color.setHex(hex);
  });
  group.userData.team = team;
}

function createHumanoidGroup(team) {
  const group = new THREE.Group();
  group.userData.kind = "humanoid";
  group.userData.team = team;
  const mat = new THREE.MeshStandardMaterial({
    color: playerColor(team),
    roughness: 0.72,
    metalness: 0.06,
  });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 12), mat);
  head.position.set(0, 0.74, 0);
  group.add(head);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.19), mat);
  torso.position.set(0, 0.4, 0);
  group.add(torso);

  const armGeo = new THREE.BoxGeometry(0.1, 0.34, 0.1);
  const armL = new THREE.Mesh(armGeo, mat);
  armL.position.set(-0.26, 0.42, 0);
  const armR = new THREE.Mesh(armGeo, mat);
  armR.position.set(0.26, 0.42, 0);
  group.add(armL, armR);

  const legGeo = new THREE.BoxGeometry(0.13, 0.38, 0.13);
  const legL = new THREE.Mesh(legGeo, mat);
  legL.position.set(-0.09, 0.19, 0);
  const legR = new THREE.Mesh(legGeo, mat);
  legR.position.set(0.09, 0.19, 0);
  group.add(legL, legR);

  const hitMat = mat.clone();
  hitMat.visible = false;
  const hitCapsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.55, 4, 8), hitMat);
  hitCapsule.position.set(0, 0.48, 0);
  hitCapsule.name = "hitProxy";
  group.add(hitCapsule);

  return group;
}

function ensurePlayerMesh(id, player) {
  let mesh = state.meshes.get(id);
  if (!mesh || mesh.userData?.kind !== "humanoid") {
    if (mesh) {
      scene.remove(mesh);
      const matSet = new Set();
      mesh.traverse((o) => {
        o.geometry?.dispose();
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats) if (m) matSet.add(m);
      });
      for (const m of matSet) m.dispose();
    }
    mesh = createHumanoidGroup(player.team);
    scene.add(mesh);
    state.meshes.set(id, mesh);
  } else if (mesh.userData.team !== player.team) {
    applyTeamColorToGroup(mesh, player.team);
  }
  const px = Number(player.pos?.x);
  const py = Number(player.pos?.y);
  const pz = Number(player.pos?.z);
  mesh.position.set(
    Number.isFinite(px) ? px : 0,
    Number.isFinite(py) ? py : 0,
    Number.isFinite(pz) ? pz : 0
  );
  mesh.rotation.y = Number.isFinite(player.yaw) ? player.yaw : 0;
  mesh.visible = !!player.alive;
  return mesh;
}

function removeMissingMeshes(nextPlayers) {
  for (const [id, mesh] of state.meshes.entries()) {
    if (!nextPlayers[id]) {
      scene.remove(mesh);
      state.meshes.delete(id);
    }
  }
}

function buildPieceGeometry(type) {
  if (type === "wall") return new THREE.BoxGeometry(2.4, 2.4, 0.2);
  if (type === "floor") return new THREE.BoxGeometry(2.4, 0.2, 2.4);
  return new THREE.BoxGeometry(2.4, 0.2, 3.1); // ramp (scaled and tilted)
}

function applyBuildSnapshot(builds) {
  const seen = new Set();
  for (const b of builds) {
    seen.add(b.id);
    if (state.buildMeshes.has(b.id)) continue;
    const mesh = new THREE.Mesh(
      buildPieceGeometry(b.type),
      new THREE.MeshStandardMaterial({
        color: b.type === "wall" ? 0x6d7f99 : b.type === "floor" ? 0x5f8d77 : 0x9b7a5b,
      })
    );
    mesh.position.set(b.pos.x, b.pos.y, b.pos.z);
    mesh.rotation.y = b.rotY || 0;
    if (b.type === "ramp") mesh.rotation.x = -Math.PI * 0.16;
    mesh.userData.buildId = b.id;
    scene.add(mesh);
    state.buildMeshes.set(b.id, mesh);
  }
  for (const [id, mesh] of state.buildMeshes.entries()) {
    if (!seen.has(id)) {
      scene.remove(mesh);
      state.buildMeshes.delete(id);
    }
  }
}

function snapCoord(v, gridSize) {
  return Math.round(v / gridSize) * gridSize;
}

function computeBuildPlacement() {
  const fw = localForward();
  const origin = new THREE.Vector3(state.position.x, state.position.y + eyeOffsetY(), state.position.z);
  const far = origin.clone().add(fw.clone().multiplyScalar(12));

  // Raycast against builds and floor
  let bestHit = null;
  let bestDist = Infinity;

  // Check builds
  for (const b of state.builds) {
    if (!b?.pos) continue;
    const box = buildWorldAabb(b);
    const hit = rayAabbIntersectSegment(origin, fw, 12, box);
    if (hit !== null && hit < bestDist) {
      bestDist = hit;
      bestHit = { type: "build", point: origin.clone().add(fw.clone().multiplyScalar(hit)), normal: null };
    }
  }

  // Check floor plane
  const t = fw.y !== 0 ? -origin.y / fw.y : -1;
  if (t > 0 && t < bestDist) {
    const floorPoint = origin.clone().add(fw.clone().multiplyScalar(t));
    if (Math.abs(floorPoint.x) < 79 && Math.abs(floorPoint.z) < 79) {
      bestDist = t;
      bestHit = { type: "floor", point: floorPoint, normal: new THREE.Vector3(0, 1, 0) };
    }
  }

  if (!bestHit) {
    // Fallback: place in front of player
    const dist = 3;
    const p = origin.clone().add(fw.clone().multiplyScalar(dist));
    p.y = 0;
    bestHit = { type: "floor", point: p, normal: new THREE.Vector3(0, 1, 0) };
  }

  return bestHit;
}

function updateBuildPreview() {
  if (!state.inMatch || state.paused) {
    if (state.buildPreview) {
      scene.remove(state.buildPreview);
      state.buildPreview.geometry?.dispose();
      state.buildPreview.material?.dispose();
      state.buildPreview = null;
    }
    return;
  }

  const me = state.players[state.myId];
  if (!me || !me.alive) {
    if (state.buildPreview) {
      scene.remove(state.buildPreview);
      state.buildPreview = null;
    }
    return;
  }

  if (!state.buildPreview) {
    state.buildPreview = new THREE.Mesh(
      buildPieceGeometry(state.buildMode),
      new THREE.MeshStandardMaterial({
        color: 0x4ade80,
        transparent: true,
        opacity: 0.65,
      })
    );
    state.buildPreview.renderOrder = 999;
    scene.add(state.buildPreview);
  }

  const GRID = 0.6;
  const hit = computeBuildPlacement();
  let pos = { x: 0, y: 0, z: 0 };
  let valid = false;

  if (hit) {
    const sx = snapCoord(hit.point.x, GRID);
    const sz = snapCoord(hit.point.z, GRID);
    let sy = hit.point.y;

    if (state.buildMode === "wall") {
      pos = { x: sx, y: snapCoord(Math.max(sy, 0.6), 0.6), z: sz };
    } else if (state.buildMode === "floor") {
      pos = { x: sx, y: snapCoord(Math.max(sy, 0.05), 0.2), z: sz };
    } else {
      pos = { x: sx, y: snapCoord(Math.max(sy, 0.05), 0.2), z: sz };
    }

    // Clamp to valid range
    pos.x = Math.max(-78, Math.min(78, pos.x));
    pos.y = Math.max(0.05, Math.min(10, pos.y));
    pos.z = Math.max(-78, Math.min(78, pos.z));

    // Overlap check
    const testBuild = { type: state.buildMode, pos: { x: pos.x, y: pos.y, z: pos.z }, rotY: state.yaw };
    const testAabb = buildWorldAabb(testBuild);
    valid = true;
    for (const b of state.builds) {
      if (!b?.pos) continue;
      if (aabbsOverlap(testAabb, buildWorldAabb(b))) { valid = false; break; }
    }

    state.buildPreview.position.set(pos.x, pos.y, pos.z);
    state.buildPreview.rotation.y = state.yaw;
    if (state.buildMode === "ramp") state.buildPreview.rotation.x = -Math.PI * 0.16;
    else state.buildPreview.rotation.x = 0;
  }

  state.buildPreviewValid = valid;
  state.buildPreview.material.color.setHex(valid ? 0x4ade80 : 0xef4444);
  state.buildPreview.material.opacity = valid ? 0.65 : 0.35;
}

function aabbsOverlap(a, b) {
  return (
    a.min.x < b.max.x && a.max.x > b.min.x &&
    a.min.y < b.max.y && a.max.y > b.min.y &&
    a.min.z < b.max.z && a.max.z > b.min.z
  );
}

function updateHud() {
  roomPillEl.textContent = state.roomId ? `Room: ${state.roomId}` : "Room: —";
  const me = state.players[state.myId];
  if (!me) {
    youEl.textContent = "You: joining...";
    teamsEl.textContent = "Teams: loading...";
    scoreEl.textContent = "Score: loading...";
    if (hpFillEl) hpFillEl.style.transform = "scaleX(1)";
    if (hpNumEl) hpNumEl.textContent = "—";
    if (killsNumEl) killsNumEl.textContent = "—";
    if (ammoReadoutEl) ammoReadoutEl.textContent = "—";
    return;
  }
  const myTeam = me.team?.toUpperCase() || "?";
  youEl.textContent = `You: ${me.name} | Team ${myTeam} | ${me.alive ? "alive" : "down"}`;
  const rs = state.teamStatus.red;
  const bs = state.teamStatus.blue;
  const redAvg = rs.count ? Math.round(rs.totalHp / rs.count) : 0;
  const blueAvg = bs.count ? Math.round(bs.totalHp / bs.count) : 0;
  teamsEl.textContent = `Teams R/B: ${rs.count}/${bs.count} | Alive ${rs.alive}/${bs.alive} | Avg HP ${redAvg}/${blueAvg}`;
  scoreEl.textContent = `Score R:${state.teamScores.red} - B:${state.teamScores.blue}`;

  const hp = Math.max(0, Math.min(100, Number(me.hp) || 0));
  if (hpFillEl) hpFillEl.style.transform = `scaleX(${hp / 100})`;
  if (hpNumEl) hpNumEl.textContent = `${Math.round(hp)} HP`;
  if (killsNumEl) killsNumEl.textContent = String(me.kills ?? 0);

  const w = state.weapon === "ak47" ? "ak47" : "pistol";
  const W = WEAPON_DEFS[w];
  const now = performance.now();
  const cd = Math.max(0, state.nextShotReadyAtMs - now);
  if (ammoReadoutEl) {
    if (cd > 8) {
      const t = W.fireMs > 0 ? Math.min(1, cd / W.fireMs) : 0;
      ammoReadoutEl.textContent = `Cooldown ${Math.ceil(cd)}ms · ∞ ammo`;
      ammoReadoutEl.style.opacity = String(0.55 + (1 - t) * 0.45);
    } else {
      ammoReadoutEl.textContent = "Ready · ∞ ammo";
      ammoReadoutEl.style.opacity = "1";
    }
  }
  if (weaponNameEl && !state.weaponRig) weaponNameEl.textContent = W.name;
}

function localForward() {
  const cp = Math.cos(state.pitch);
  const v = new THREE.Vector3(
    Math.sin(state.yaw) * cp,
    Math.sin(state.pitch),
    Math.cos(state.yaw) * cp
  ).normalize();
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z) || v.lengthSq() < 1e-12) {
    v.set(0, 0, -1);
  }
  return v;
}

/**
 * Camera orientation from yaw/pitch using quaternions — no gimbal lock.
 * Yaw rotates around world Y, pitch rotates around local right vector.
 */
const _qYaw = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();
const _pitchAxis = new THREE.Vector3();
function applyThirdPersonCameraOrientation() {
  _qYaw.setFromAxisAngle(_worldUp, state.yaw);
  _pitchAxis.set(1, 0, 0).applyQuaternion(_qYaw);
  _qPitch.setFromAxisAngle(_pitchAxis, state.pitch);
  camera.quaternion.copy(_qYaw.multiply(_qPitch));
}

function placeBuild() {
  if (state.paused || !state.buildPreviewValid) return;
  const me = state.players[state.myId];
  if (!me || !me.alive) return;
  const pos = state.buildPreview.position;
  socket.emit("build_place", {
    type: state.buildMode,
    pos: { x: pos.x, y: pos.y, z: pos.z },
    rotY: state.yaw,
  });
}

function shoot() {
  if (state.paused) return;
  const me = state.players[state.myId];
  if (!me || !me.alive) return;
  const now = performance.now();
  if (now < state.nextShotReadyAtMs) return;
  const w = state.weapon === "ak47" ? "ak47" : "pistol";
  const W = WEAPON_DEFS[w];
  const dir = spreadDirection(localForward(), W.spread);
  const origin = new THREE.Vector3(state.position.x, state.position.y + eyeOffsetY(), state.position.z);
  const recoil = W.recoilPitch * (1 + Math.random() * 0.35);
  state.pitch = clampPitch(state.pitch - recoil);
  state.weaponKick = Math.min(0.16, state.weaponKick + (w === "ak47" ? 0.07 : 0.055));
  spawnMuzzleFlash(origin, dir);
  socket.emit("shoot", {
    origin: { x: origin.x, y: origin.y, z: origin.z },
    dir: { x: dir.x, y: dir.y, z: dir.z },
    weapon: w,
  });
  state.nextShotReadyAtMs = now + W.fireMs;
}

function tryRemoveBuild() {
  if (!state.inMatch || !socket.connected || state.paused) return;
  const me = state.players[state.myId];
  if (!me || !me.alive) return;
  const now = performance.now();
  if (now - state.lastRemoveAt < 160) return;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const targets = Array.from(state.buildMeshes.values());
  const hits = raycaster.intersectObjects(targets, false);
  const hit = hits.find((h) => h.object?.userData?.buildId);
  if (!hit) {
    showToast("No build piece in crosshair.");
    return;
  }
  state.lastRemoveAt = now;
  socket.emit("build_remove", { id: hit.object.userData.buildId });
}

btnQuick.addEventListener("click", () => {
  lobbyStatusEl.textContent = "Finding an opponent…";
  socket.emit("lobby:quick");
});

btnCreate.addEventListener("click", () => {
  lobbyStatusEl.textContent = "Creating room…";
  hostCodeEl.classList.add("hidden");
  socket.emit("lobby:create");
});

btnJoin.addEventListener("click", () => {
  lobbyStatusEl.textContent = "Joining…";
  socket.emit("lobby:join", { code: roomCodeInput.value });
});

btnCancelQueue.addEventListener("click", () => {
  socket.emit("lobby:cancel");
});

btnResume?.addEventListener("click", () => {
  setPaused(false);
  if (state.inMatch && _controlsMode !== "mobile") canvas.requestPointerLock?.();
});

btnLightPrev?.addEventListener("click", () => cycleLighting(-1));
btnLightNext?.addEventListener("click", () => cycleLighting(1));

btnLeaveGame?.addEventListener("click", () => {
  if (!state.inMatch) return;
  setPaused(false);
  document.exitPointerLock?.();
  socket.emit("leave_match");
  exitMatchUi();
  lobbyStatusEl.textContent = "Left the match — pick Quick Match or a room code.";
});

socket.on("connect", () => {
  lobbyStatusEl.textContent = "Connected — pick Quick Match or enter a code.";
  statusEl.textContent = "Connected";
});

socket.on("disconnect", () => {
  exitMatchUi({ disconnected: true });
  lobbyStatusEl.textContent = "Disconnected from server. Refresh to retry.";
});

socket.on("lobby_ready", () => {
  lobbyStatusEl.textContent = "Connected — pick Quick Match or enter a code.";
});

socket.on("lobby_queued", ({ position }) => {
  lobbyStatusEl.textContent = `In queue… waiting for another player (#${position}).`;
  btnCancelQueue.classList.remove("hidden");
});

socket.on("lobby_cancelled", () => {
  btnCancelQueue.classList.add("hidden");
  lobbyStatusEl.textContent = "Left the queue.";
});

socket.on("lobby_error", ({ message }) => {
  btnCancelQueue.classList.add("hidden");
  lobbyStatusEl.textContent = message || "Lobby error.";
  showToast(message || "Lobby error.");
});

socket.on("room_created", ({ roomId }) => {
  hostCodeEl.textContent = `Share this code: ${roomId}`;
  hostCodeEl.classList.remove("hidden");
  lobbyStatusEl.textContent = "Room ready — waiting for friend to join…";
});

socket.on("match_found", () => {
  btnCancelQueue.classList.add("hidden");
  lobbyStatusEl.textContent = "Match found — loading arena…";
});

socket.on("room_joined", () => {
  lobbyStatusEl.textContent = "Joined — loading arena…";
});

socket.on("server_full", (msg) => {
  statusEl.textContent = "Match full";
  showToast(msg?.message || "Server is full.");
});

socket.on("init", ({ id, snapshot }) => {
  state.myId = id;
  state.roomId = snapshot.roomId || null;
  state.players = snapshot.players || {};
  state.builds = snapshot.builds || [];
  state.teamScores = snapshot.teamScores || state.teamScores;
  state.teamStatus = snapshot.teamStatus || state.teamStatus;

  const me = state.players[state.myId];
  if (me) {
    state.position.set(me.pos.x, me.pos.y, me.pos.z);
    state.smoothFollow.copy(state.position);
    state.yaw = me.yaw || 0;
    if (Number.isFinite(me.pitch)) state.pitch = clampPitch(me.pitch);
    if (me.weapon === "pistol" || me.weapon === "ak47") state.weapon = me.weapon;
  }

  applyBuildSnapshot(state.builds);
  removeMissingMeshes(state.players);
  for (const [pid, p] of Object.entries(state.players)) ensurePlayerMesh(pid, p);
  setPaused(false);
  enterMatchUi();
  socket.emit("set_name", `Player-${Math.floor(Math.random() * 900 + 100)}`);
  updateHud();
  updatePauseRoomCode();
});

socket.on("snapshot", (snap) => {
  if (snap.roomId) state.roomId = snap.roomId;
  state.players = snap.players || {};
  state.builds = snap.builds || [];
  state.teamScores = snap.teamScores || state.teamScores;
  state.teamStatus = snap.teamStatus || state.teamStatus;

  applyBuildSnapshot(state.builds);
  removeMissingMeshes(state.players);
  for (const [pid, p] of Object.entries(state.players)) {
    ensurePlayerMesh(pid, p);
  }
  const meSnap = state.myId ? state.players[state.myId] : null;
  if (meSnap && (meSnap.weapon === "pistol" || meSnap.weapon === "ak47") && meSnap.weapon !== state.weapon) {
    state.weapon = meSnap.weapon;
    syncWeaponVisual();
  }
  if (state.paused && state.myId && state.players[state.myId]) {
    const me = state.players[state.myId];
    state.position.set(me.pos.x, me.pos.y, me.pos.z);
    state.smoothFollow.copy(state.position);
    if (me.vel) state.velocity.set(me.vel.x, me.vel.y, me.vel.z);
    state.yaw = me.yaw ?? state.yaw;
    if (Number.isFinite(me.pitch)) state.pitch = clampPitch(me.pitch);
  }
  updateHud();
  if (state.paused) updatePauseRoomCode();
});

socket.on("builds_update", ({ builds }) => {
  state.builds = builds || [];
  applyBuildSnapshot(state.builds);
});

socket.on("player_down", ({ id, by }) => {
  if (id === state.myId) showToast("You were eliminated. Respawning...");
  else if (by === state.myId) showToast("Elimination confirmed.");
});

socket.on("player_respawn", ({ id }) => {
  if (id === state.myId) showToast("Respawned.");
});

socket.on("hit", ({ by, victim, damage }) => {
  if (victim === state.myId) showToast("You were hit.");
  if (by === state.myId) {
    showToast("Hit confirmed.");
    crosshairEl?.classList.add("hit");
    setTimeout(() => crosshairEl?.classList.remove("hit"), 95);
    if (victim && victim !== state.myId) spawnDamageNumber(damage ?? 25);
  }
});

window.addEventListener("resize", () => {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();

  if (state.inMatch && k === "escape") {
    e.preventDefault();
    togglePause();
    return;
  }

  if (state.inMatch && k === "l") {
    cycleLighting(1);
    return;
  }

  if (state.inMatch && state.paused) return;

  if (!state.inMatch) return;

  if (_controlsMode === "mobile") {
    // Only allow essential keys in mobile mode
    if (k === "1") setWeapon("pistol");
    if (k === "2") setWeapon("ak47");
    if (k === "4") { state.buildMode = "wall"; buildModeEl.textContent = state.buildMode; }
    if (k === "5") { state.buildMode = "ramp"; buildModeEl.textContent = state.buildMode; }
    if (k === "6") { state.buildMode = "floor"; buildModeEl.textContent = state.buildMode; }
    return;
  }

  if (k === "w") state.controls.w = true;
  if (k === "a") state.controls.a = true;
  if (k === "s") state.controls.s = true;
  if (k === "d") state.controls.d = true;
  if (k === "shift") state.controls.shift = true;
  if (k === "control") state.controls.ctrl = true;
  if (k === " ") {
    state.jumpRequested = true;
  }
  if (k === "1") setWeapon("pistol");
  if (k === "2") setWeapon("ak47");
  if (k === "4") state.buildMode = "wall";
  if (k === "5") state.buildMode = "ramp";
  if (k === "6") state.buildMode = "floor";
  if (k === "q") state.yaw -= Math.PI / 8;
  if (k === "e") state.yaw += Math.PI / 8;
  if (k === "f") placeBuild();
  if (k === "g") tryRemoveBuild();
  if (k === "r") {
    state.yaw = 0;
    state.pitch = clampPitch(-0.22);
  }
  buildModeEl.textContent = state.buildMode;
});

window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (!state.inMatch) return;
  if (_controlsMode === "mobile") return;
  if (k === "w") state.controls.w = false;
  if (k === "a") state.controls.a = false;
  if (k === "s") state.controls.s = false;
  if (k === "d") state.controls.d = false;
  if (k === "shift") state.controls.shift = false;
  if (k === "control") state.controls.ctrl = false;
});

window.addEventListener("blur", () => {
  if (state.inMatch) clearMovementControls();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && state.inMatch) clearMovementControls();
});

document.addEventListener("pointerlockchange", () => {
  state.mouseLookActive = pointerLockActive();
});

window.addEventListener(
  "wheel",
  (e) => {
    if (!state.inMatch || state.paused) return;
    if (!pointerLockActive()) return;
    e.preventDefault();
    cycleWeapon(e.deltaY > 0 ? 1 : -1);
  },
  { passive: false }
);

window.addEventListener("mousedown", (e) => {
  if (_controlsMode === "mobile") return;
  if (!state.inMatch || state.paused) return;
  if (e.button !== 0) return;
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
  shoot();
});

window.addEventListener("mousemove", (e) => {
  if (!state.inMatch || state.paused) return;
  if (!pointerLockActive()) return;
  const mx = e.movementX;
  const my = e.movementY;
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
  state.yaw -= mx * MOUSE_SENS_X;
  state.pitch -= my * MOUSE_SENS_Y;
  state.pitch = clampPitch(state.pitch);
});

/* ==================== MOBILE CONTROLS ==================== */
const mobileEl = document.getElementById("mobileControls");
const moveStickEl = document.getElementById("mobileMoveStick");
const moveKnobEl = document.getElementById("moveKnob");
const lookAreaEl = document.getElementById("mobileLookArea");
const mbtnShoot = document.getElementById("mbtnShoot");
const mbtnJump = document.getElementById("mbtnJump");
const mbtnBuild = document.getElementById("mbtnBuild");
const mbtnRemove = document.getElementById("mbtnRemove");
const mBuildOpts = document.querySelectorAll(".m-build-opt");
const pauseTabGame = document.getElementById("pauseTabGame");
const pauseTabControls = document.getElementById("pauseTabControls");
const pauseTabs = document.querySelectorAll(".pause-tab");
const btnCtrlPC = document.getElementById("btnCtrlPC");
const btnCtrlMobile = document.getElementById("btnCtrlMobile");

const MOBILE_SENS = 0.004;
const STICK_DEAD_ZONE = 0.08;
const STICK_RADIUS = 48;

function setControlsMode(mode) {
  _controlsMode = mode;
  const isMobile = mode === "mobile";
  mobileEl?.classList.toggle("hidden", !isMobile);
  btnCtrlPC?.classList.toggle("active", !isMobile);
  btnCtrlMobile?.classList.toggle("active", isMobile);
  const hintEl = document.querySelector(".controls-hint");
  if (hintEl) {
    hintEl.textContent = isMobile ? "Left stick move · Right side look · Tap to shoot" : "WASD · Click to shoot · F/G build";
  }
  const bi = document.getElementById("buildIndicator");
  if (bi) bi.classList.toggle("mobile", isMobile);
  if (!isMobile) {
    state.controls.w = false;
    state.controls.a = false;
    state.controls.s = false;
    state.controls.d = false;
  }
  try { sessionStorage.setItem(CONTROLS_MODE_KEY, mode); } catch (_) {}
}

// Pause tab switching
pauseTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    pauseTabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.tab;
    pauseTabGame?.classList.toggle("hidden", target !== "game");
    pauseTabControls?.classList.toggle("hidden", target !== "controls");
  });
});

btnCtrlPC?.addEventListener("click", () => setControlsMode("pc"));
btnCtrlMobile?.addEventListener("click", () => setControlsMode("mobile"));

// Restore saved controls mode
try {
  const saved = sessionStorage.getItem(CONTROLS_MODE_KEY);
  if (saved === "mobile" || saved === "pc") setControlsMode(saved);
} catch (_) {}

// Mobile build mode buttons
mBuildOpts.forEach(el => {
  el.addEventListener("touchstart", (e) => {
    e.preventDefault();
    state.buildMode = el.dataset.mode;
    mBuildOpts.forEach(o => o.classList.remove("active"));
    el.classList.add("active");
    buildModeEl.textContent = state.buildMode;
  });
  el.addEventListener("mousedown", (e) => {
    if (_controlsMode === "mobile") return;
    state.buildMode = el.dataset.mode;
    mBuildOpts.forEach(o => o.classList.remove("active"));
    el.classList.add("active");
    buildModeEl.textContent = state.buildMode;
  });
});

// Mobile left stick - movement
moveStickEl.addEventListener("touchstart", (e) => {
  e.preventDefault();
  const t = e.changedTouches[0];
  state.mobileTouch.moveId = t.identifier;
  updateMoveStick(t);
}, { passive: false });

moveStickEl.addEventListener("touchmove", (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === state.mobileTouch.moveId) updateMoveStick(t);
  }
}, { passive: false });

moveStickEl.addEventListener("touchend", (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === state.mobileTouch.moveId) {
      state.mobileTouch.moveId = null;
      resetMoveStick();
    }
  }
});

moveStickEl.addEventListener("touchcancel", () => {
  state.mobileTouch.moveId = null;
  resetMoveStick();
});

function updateMoveStick(touch) {
  const rect = moveStickEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = touch.clientX - cx;
  const dy = touch.clientY - cy;
  const dist = Math.hypot(dx, dy);
  const clamped = Math.min(dist, STICK_RADIUS);
  const angle = Math.atan2(dy, dx);
  const kx = clamped / STICK_RADIUS;
  const ky = clamped / STICK_RADIUS;

  moveKnobEl.style.left = `calc(50% + ${Math.cos(angle) * clamped}px)`;
  moveKnobEl.style.top = `calc(50% + ${Math.sin(angle) * clamped}px)`;

  let nx = Math.cos(angle) * kx;
  let nz = Math.sin(angle) * ky;

  if (Math.abs(nx) < STICK_DEAD_ZONE) nx = 0;
  if (Math.abs(nz) < STICK_DEAD_ZONE) nz = 0;

  // Map stick to WASD controls
  state.controls.w = nz < -0.3;
  state.controls.s = nz > 0.3;
  state.controls.a = nx < -0.3;
  state.controls.d = nx > 0.3;
}

function resetMoveStick() {
  moveKnobEl.style.left = "50%";
  moveKnobEl.style.top = "50%";
  state.controls.w = false;
  state.controls.a = false;
  state.controls.s = false;
  state.controls.d = false;
}

// Mobile look area - camera control
lookAreaEl.addEventListener("touchstart", (e) => {
  e.preventDefault();
  const t = e.changedTouches[0];
  state.mobileTouch.lookId = t.identifier;
  state.mobileTouch.lookX = t.clientX;
  state.mobileTouch.lookY = t.clientY;
  state.mobileTouch.lookDragged = false;
}, { passive: false });

lookAreaEl.addEventListener("touchmove", (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === state.mobileTouch.lookId) {
      const dx = t.clientX - state.mobileTouch.lookX;
      const dy = t.clientY - state.mobileTouch.lookY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) state.mobileTouch.lookDragged = true;
      state.yaw -= dx * MOBILE_SENS;
      state.pitch -= dy * MOBILE_SENS;
      state.pitch = clampPitch(state.pitch);
      state.mobileTouch.lookX = t.clientX;
      state.mobileTouch.lookY = t.clientY;
    }
  }
}, { passive: false });

lookAreaEl.addEventListener("touchend", (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === state.mobileTouch.lookId) {
      state.mobileTouch.lookId = null;
      // Shoot on quick tap (no drag)
      if (!state.mobileTouch.lookDragged && state.inMatch && !state.paused) shoot();
    }
  }
});

lookAreaEl.addEventListener("touchcancel", () => {
  state.mobileTouch.lookId = null;
});

// Mobile action buttons
mbtnShoot.addEventListener("touchstart", (e) => { e.preventDefault(); shoot(); }, { passive: false });
mbtnJump.addEventListener("touchstart", (e) => { e.preventDefault(); state.jumpRequested = true; }, { passive: false });
mbtnBuild.addEventListener("touchstart", (e) => { e.preventDefault(); placeBuild(); }, { passive: false });
mbtnRemove.addEventListener("touchstart", (e) => { e.preventDefault(); tryRemoveBuild(); }, { passive: false });
mbtnShoot.addEventListener("mousedown", (e) => { if (_controlsMode === "mobile") return; shoot(); });
mbtnJump.addEventListener("mousedown", (e) => { if (_controlsMode === "mobile") return; state.jumpRequested = true; });
mbtnBuild.addEventListener("mousedown", (e) => { if (_controlsMode === "mobile") return; placeBuild(); });
mbtnRemove.addEventListener("mousedown", (e) => { if (_controlsMode === "mobile") return; tryRemoveBuild(); });

const CLOCK = new THREE.Clock();
function frame() {
  const dt = Math.min(CLOCK.getDelta(), 0.05);
  const now = performance.now();

  if (state.muzzleFlash?.mesh && now > state.muzzleFlash.until) {
    scene.remove(state.muzzleFlash.mesh);
    state.muzzleFlash.mesh.geometry?.dispose();
    state.muzzleFlash.mesh.material?.dispose();
    state.muzzleFlash = null;
  } else if (state.muzzleFlash?.mesh) {
    const mat = state.muzzleFlash.mesh.material;
    const t = Math.max(0, (state.muzzleFlash.until - now) / 72);
    if (mat) mat.opacity = 0.92 * t;
  }

  if (crosshairEl) {
    if (now < state.nextShotReadyAtMs) crosshairEl.classList.add("cool");
    else crosshairEl.classList.remove("cool");
  }

  if (state.weaponRig) {
    state.weaponKick *= Math.exp(-17 * dt);
    state.weaponRig.rotation.x = state.weaponKick;
  }

  if (!state.paused) {
    const BASE_MOVE = 9.0;
    const SPRINT_MULT = 1.6;
    const CROUCH_MULT = 0.45;
    const JUMP_SPEED = 8.5;
    const GRAVITY = 28.0;
    const TERMINAL_VEL = -20.0;
    const GROUND_ACCEL = 85;
    const GROUND_FRICTION = 75;
    const AIR_ACCEL = 35;
    const AIR_CONTROL = 0.55;

    const crouching = state.controls.ctrl;
    const sprinting = state.controls.shift && !crouching;

    // Lerp crouch eye height smoothly
    const targetHeight = crouching ? 0.65 : 1.0;
    state.crouchHeight = state.crouchHeight || 1.0;
    state.crouchHeight += (targetHeight - state.crouchHeight) * Math.min(1, 12 * dt);

    const forward = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw)).normalize();
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const input = new THREE.Vector3();
    if (state.controls.w) input.add(forward);
    if (state.controls.s) input.sub(forward);
    if (state.controls.a) input.sub(right);
    if (state.controls.d) input.add(right);
    const hasInput = input.lengthSq() > 0;
    if (hasInput) input.normalize();

    const maxSpeed = BASE_MOVE * (sprinting ? SPRINT_MULT : 1) * (crouching ? CROUCH_MULT : 1);
    const targetVelX = input.x * maxSpeed;
    const targetVelZ = input.z * maxSpeed;

    // Ground detection via short downward ray against builds and floor
    const feetY = 0.05;
    const rayLen = 0.2;
    const origin = new THREE.Vector3(state.position.x, state.position.y + 0.01, state.position.z);
    const down = new THREE.Vector3(0, -1, 0);
    let onSurface = false;
    for (const b of state.builds) {
      if (!b?.pos) continue;
      const box = buildWorldAabb(b);
      const hit = rayAabbIntersectSegment(origin, down, rayLen, box);
      if (hit !== null) { onSurface = true; break; }
    }
    if (!onSurface && state.position.y <= feetY + 0.01) onSurface = true;

    const wasGrounded = state.grounded;
    state.grounded = onSurface && state.velocity.y <= 0.05;

    if (state.grounded) {
      state.coyoteMs = 100;
      state.position.y = Math.max(state.position.y, feetY);
      state.velocity.y = Math.max(state.velocity.y, 0);
    } else {
      state.coyoteMs = Math.max(0, state.coyoteMs - dt * 1000);
    }

    // Ground acceleration/friction
    if (state.grounded) {
      const accel = hasInput ? GROUND_ACCEL : GROUND_FRICTION;
      const k = 1 - Math.exp(-accel * dt);
      state.velocity.x += (targetVelX - state.velocity.x) * k;
      state.velocity.z += (targetVelZ - state.velocity.z) * k;
    } else {
      // Air acceleration with control
      const k = 1 - Math.exp(-AIR_ACCEL * dt);
      state.velocity.x += (targetVelX - state.velocity.x) * (k * AIR_CONTROL);
      state.velocity.z += (targetVelZ - state.velocity.z) * (k * AIR_CONTROL);
    }

    // Gravity
    state.velocity.y = Math.max(TERMINAL_VEL, state.velocity.y - GRAVITY * dt);

    // Jump
    if (state.jumpRequested && (state.grounded || state.coyoteMs > 0)) {
      state.velocity.y = JUMP_SPEED;
      state.grounded = false;
      state.coyoteMs = 0;
    }
    state.jumpRequested = false;

    // Integrate position
    state.position.x += state.velocity.x * dt;
    state.position.y += state.velocity.y * dt;
    state.position.z += state.velocity.z * dt;

    // Arena bounds
    state.position.x = Math.max(-79, Math.min(79, state.position.x));
    state.position.z = Math.max(-79, Math.min(79, state.position.z));

    resolveLocalBuildCollisions(state.position, state.builds);

    // Smooth follow with dynamic lerp
    const followSpeed = state.grounded ? 16 : 10;
    state.smoothFollow.lerp(state.position, 1 - Math.exp(-followSpeed * dt));
  }

  const pivotY = 0.6 + (state.crouchHeight ?? 1.0) * 0.92;
  const pivot = state.smoothFollow.clone().add(new THREE.Vector3(0, pivotY, 0));
  const back = new THREE.Vector3(
    -Math.sin(state.yaw) * Math.cos(state.pitch),
    -Math.sin(state.pitch),
    -Math.cos(state.yaw) * Math.cos(state.pitch)
  ).normalize();
  const rightCam = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const camDist = 5.35;
  const shoulder = 0.66;
  const desiredCam = pivot
    .clone()
    .add(back.clone().multiplyScalar(camDist))
    .add(rightCam.multiplyScalar(shoulder));

  // Improved camera clipping with better bounds checking
  const camOrigin = pivot.clone().add(new THREE.Vector3(0, 0.18, 0));
  const clipped = clipCameraThroughBuilds(camOrigin, desiredCam, state.builds, 0.52);

  // Smoother camera interpolation with velocity-based damping
  const camLerp = state.grounded ? 1 - Math.exp(-11 * dt) : 1 - Math.exp(-8 * dt);
  state.camPos.lerp(clipped, camLerp);

  // Ensure camera doesn't get too close to player
  const toPlayer = state.camPos.clone().sub(pivot);
  const minDist = 2.0;
  if (toPlayer.lengthSq() < minDist * minDist) {
    toPlayer.normalize().multiplyScalar(minDist);
    state.camPos.copy(pivot).add(toPlayer);
  }

  camera.position.copy(state.camPos);

  camera.up.set(0, 1, 0);
  applyThirdPersonCameraOrientation();

  const me = state.players[state.myId];
  if (me) {
    if (!state.paused) {
      me.pos = { x: state.position.x, y: state.position.y, z: state.position.z };
      me.vel = { x: state.velocity.x, y: state.velocity.y, z: state.velocity.z };
      me.yaw = state.yaw;
      me.pitch = state.pitch;
    }
    ensurePlayerMesh(state.myId, me).visible = false; // hide local body in third-person
  }

  if (state.inMatch && socket.connected && state.myId && !state.paused && now - state.lastNetSend > 45) {
    state.lastNetSend = now;
    socket.emit("state", {
      pos: { x: state.position.x, y: state.position.y, z: state.position.z },
      vel: { x: state.velocity.x, y: state.velocity.y, z: state.velocity.z },
      yaw: state.yaw,
      pitch: state.pitch,
      sprint: !!(state.controls.shift && !state.controls.ctrl),
      crouch: !!state.controls.ctrl,
    });
  }

  updateBuildPreview();

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

