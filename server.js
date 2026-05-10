import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
  transports: ["polling", "websocket"], // polling first — some school filters block WebSocket
  allowEIO3: true,
});

const PORT_RAW = process.env.PORT ? Number(process.env.PORT) : 8080;
const PORT = Number.isFinite(PORT_RAW) && PORT_RAW > 0 ? Math.min(65535, Math.floor(PORT_RAW)) : 8080;
const HOST = process.env.HOST || "0.0.0.0";

app.use(express.static("public", { extensions: ["html"] }));

/**
 * Server-authoritative hybrid: validates movement speed, resolves hits, build limits.
 * Original low-poly style only — no third-party game assets.
 */
const TICK_HZ = 20;
const TICK_MS = Math.round(1000 / TICK_HZ);
const BASE_MAX_SPEED = 11.2;
const SPRINT_MAX_SPEED = 15.8;
const CROUCH_SPEED_MULT = 0.52;
const MAX_SPEED = SPRINT_MAX_SPEED;
const MAX_POS_DELTA = (MAX_SPEED / TICK_HZ) * 1.38;
const RESPAWN_DELAY_MS = 1400;

/** @type {Record<string, { id: string, fireMs: number, damage: number, spread: number, range: number }>} */
const WEAPONS = {
  pistol: { id: "pistol", fireMs: 320, damage: 28, spread: 0.012, range: 96 },
  ak47: { id: "ak47", fireMs: 105, damage: 18, spread: 0.048, range: 128 },
};
const ROOM_MAX_PLAYERS = 2;
const BUILD_REMOVE_RANGE = 5.5;
const MAX_BUILDS_PER_ROOM = 400;

/** @type {string[]} */
const matchQueue = [];

/** @type {Map<string, { id: string, players: Map<string, any>, builds: any[], teamScores: { red: number, blue: number } }>} */
const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function roomChannel(roomId) {
  return `game:${roomId}`;
}

function createRoom() {
  let id = makeRoomCode();
  while (rooms.has(id)) id = makeRoomCode();
  const room = {
    id,
    players: new Map(),
    builds: [],
    teamScores: { red: 0, blue: 0 },
  };
  rooms.set(id, room);
  return room;
}

function destroyRoomIfEmpty(room) {
  if (room.players.size === 0) rooms.delete(room.id);
}

function nowMs() {
  return Date.now();
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function len3(x, y, z) {
  return Math.hypot(x, y, z);
}

function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function normalize3(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add3(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function mul3(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

/**
 * @param {{ x: number, y: number, z: number }} dir
 * @param {number} maxRad
 */
function spreadDirection(dir, maxRad) {
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
  let x = dir.x / l;
  let y = dir.y / l;
  let z = dir.z / l;
  let rx = z;
  let ry = 0;
  let rz = -x;
  const rlen = Math.hypot(rx, ry, rz);
  if (rlen < 1e-6) {
    rx = 1;
    ry = 0;
    rz = 0;
  } else {
    rx /= rlen;
    rz /= rlen;
  }
  let ux = y * rz - z * ry;
  let uy = z * rx - x * rz;
  let uz = x * ry - y * rx;
  const ulen = Math.hypot(ux, uy, uz);
  if (ulen < 1e-6) {
    ux = 0;
    uy = 1;
    uz = 0;
  } else {
    ux /= ulen;
    uy /= ulen;
    uz /= ulen;
  }
  const u = (Math.random() - 0.5) * 2 * maxRad;
  const v = (Math.random() - 0.5) * 2 * maxRad;
  x += rx * u + ux * v;
  y += ry * u + uy * v;
  z += rz * u + uz * v;
  const nl = Math.hypot(x, y, z) || 1;
  return { x: x / nl, y: y / nl, z: z / nl };
}

const BUILD_DIMS = {
  wall: { hx: 1.2, hy: 1.2, hz: 0.1 },
  floor: { hx: 1.2, hy: 0.1, hz: 1.2 },
  ramp: { hx: 1.2, hy: 0.1, hz: 1.55 },
};
const RAMP_PITCH = -Math.PI * 0.16;

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

/**
 * @param {{ type: string, pos: { x: number, y: number, z: number }, rotY?: number }} b
 */
function buildWorldAabb(b) {
  const dim = BUILD_DIMS[b.type === "wall" || b.type === "floor" || b.type === "ramp" ? b.type : "wall"];
  const { hx, hy, hz } = dim;
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
    x: clamp(p.x, box.min.x, box.max.x),
    y: clamp(p.y, box.min.y, box.max.y),
    z: clamp(p.z, box.min.z, box.max.z),
  };
}

/**
 * @param {{ x: number, y: number, z: number }} origin
 * @param {{ x: number, y: number, z: number }} dir unit
 */
function rayAabbIntersect(origin, dir, tMax, box) {
  let t0 = 0;
  let t1 = tMax;
  const axes = /** @type {const} */ (["x", "y", "z"]);
  for (let i = 0; i < 3; i++) {
    const a = axes[i];
    const o = origin[a];
    const d = dir[a];
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

const PLAYER_COLLIDE_RADIUS = 0.44;
const PLAYER_COLLIDE_CENTER_Y = 0.82;

/**
 * @param {{ pos: { x: number, y: number, z: number } }} p
 * @param {any[]} builds
 */
function resolvePlayerBuildCollision(p, builds) {
  const center = {
    x: p.pos.x,
    y: p.pos.y + PLAYER_COLLIDE_CENTER_Y,
    z: p.pos.z,
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
      const push = (PLAYER_COLLIDE_RADIUS - d + 0.02) / (d || 1);
      center.x += dx * push;
      center.y += dy * push;
      center.z += dz * push;
    }
  }
  p.pos.x = clamp(center.x, -200, 200);
  p.pos.y = clamp(center.y - PLAYER_COLLIDE_CENTER_Y, -10, 200);
  p.pos.z = clamp(center.z, -200, 200);
}

function randomSpawn(team = "red") {
  const r = 18;
  const side = team === "red" ? -1 : 1;
  const base = side > 0 ? 0 : Math.PI;
  const angle = base + (Math.random() - 0.5) * 0.8;
  return { x: Math.cos(angle) * r, y: 1.4, z: Math.sin(angle) * r };
}

function respawn(p) {
  p.pos = randomSpawn(p.team);
  p.vel = { x: 0, y: 0, z: 0 };
  p.hp = 100;
  p.lastDamagedAt = 0;
  p.alive = true;
  p.sprint = false;
  p.crouch = false;
}

/**
 * @param {ReturnType<typeof createRoom>} room
 */
function snapshotRoom(room) {
  const ps = {};
  const teamStatus = {
    red: { count: 0, alive: 0, totalHp: 0 },
    blue: { count: 0, alive: 0, totalHp: 0 },
  };

  for (const [id, p] of room.players.entries()) {
    ps[id] = {
      id,
      name: p.name,
      team: p.team,
      pos: p.pos,
      vel: p.vel,
      yaw: p.yaw,
      pitch: p.pitch,
      hp: p.hp,
      alive: p.alive,
      weapon: p.weapon,
      kills: p.kills,
      crouch: !!p.crouch,
    };
    const t = teamStatus[p.team];
    t.count += 1;
    if (p.alive) t.alive += 1;
    t.totalHp += p.hp;
  }
  return {
    roomId: room.id,
    t: nowMs(),
    players: ps,
    builds: room.builds,
    teamScores: room.teamScores,
    teamStatus,
  };
}

/**
 * @param {ReturnType<typeof createRoom>} room
 */
function chooseTeam(room) {
  if (room.players.size >= ROOM_MAX_PLAYERS) return null;
  let reds = 0;
  for (const p of room.players.values()) if (p.team === "red") reds += 1;
  return reds === 0 ? "red" : "blue";
}

function removeFromQueue(socketId) {
  const i = matchQueue.indexOf(socketId);
  if (i !== -1) matchQueue.splice(i, 1);
}

/**
 * @param {import("socket.io").Socket} socket
 * @param {ReturnType<typeof createRoom>} room
 */
function spawnPlayerInRoom(socket, room) {
  const team = chooseTeam(room);
  if (!team) {
    socket.emit("lobby_error", { message: "Room is full." });
    return false;
  }

  const id = socket.id;
  const p = {
    id,
    name: `Player ${id.slice(0, 4)}`,
    team,
    pos: randomSpawn(team),
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    hp: 100,
    alive: true,
    weapon: "pistol",
    kills: 0,
    sprint: false,
    crouch: false,
    lastUpdateAt: nowMs(),
    lastShotAt: 0,
    lastBuildAt: 0,
    lastRemoveAt: 0,
    lastDamagedAt: 0,
  };
  room.players.set(id, p);
  socket.join(roomChannel(room.id));
  socket.data.roomId = room.id;

  socket.emit("init", { id, snapshot: snapshotRoom(room) });
  io.to(roomChannel(room.id)).emit("player_joined", { id, player: p });
  return true;
}

/**
 * @param {import("socket.io").Socket} socket
 */
function leaveGame(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  socket.leave(roomChannel(roomId));
  delete socket.data.roomId;
  if (!room) return;
  room.players.delete(socket.id);
  io.to(roomChannel(roomId)).emit("player_left", { id: socket.id });
  destroyRoomIfEmpty(room);
}

io.on("connection", (socket) => {
  socket.data.roomId = undefined;
  socket.emit("lobby_ready", { message: "Choose Quick Match or a room code." });

  socket.on("lobby:cancel", () => {
    removeFromQueue(socket.id);
    socket.emit("lobby_cancelled", {});
  });

  socket.on("leave_match", () => {
    removeFromQueue(socket.id);
    leaveGame(socket);
  });

  socket.on("lobby:quick", () => {
    if (socket.data.roomId) return;
    removeFromQueue(socket.id);
    if (matchQueue.includes(socket.id)) return;

    if (matchQueue.length > 0) {
      const otherId = matchQueue.shift();
      const other = io.sockets.sockets.get(otherId);
      if (!other || other.data.roomId) {
        matchQueue.push(socket.id);
        socket.emit("lobby_queued", { position: matchQueue.length });
        return;
      }
      const room = createRoom();
      spawnPlayerInRoom(other, room);
      spawnPlayerInRoom(socket, room);
      socket.emit("match_found", { roomId: room.id });
      other.emit("match_found", { roomId: room.id });
      return;
    }

    matchQueue.push(socket.id);
    socket.emit("lobby_queued", { position: 1 });
  });

  socket.on("lobby:create", () => {
    if (socket.data.roomId) return;
    removeFromQueue(socket.id);
    const room = createRoom();
    if (!spawnPlayerInRoom(socket, room)) {
      rooms.delete(room.id);
      return;
    }
    socket.emit("room_created", { roomId: room.id });
  });

  socket.on("lobby:join", (payload) => {
    if (socket.data.roomId) return;
    removeFromQueue(socket.id);
    const code = String(payload?.code ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6);
    if (code.length !== 6) {
      socket.emit("lobby_error", { message: "Enter a 6-character room code." });
      return;
    }
    const room = rooms.get(code);
    if (!room) {
      socket.emit("lobby_error", { message: "Room not found." });
      return;
    }
    if (room.players.size >= ROOM_MAX_PLAYERS) {
      socket.emit("lobby_error", { message: "Room is full." });
      return;
    }
    if (!spawnPlayerInRoom(socket, room)) return;
    socket.emit("room_joined", { roomId: room.id });
  });

  socket.on("set_name", (name) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    const p = room?.players.get(socket.id);
    if (!p) return;
    p.name = String(name ?? "").slice(0, 20) || p.name;
  });

  socket.on("weapon_set", (payload) => {
    const roomId = socket.data.roomId;
    const room = roomId ? rooms.get(roomId) : null;
    const p = room?.players.get(socket.id);
    if (!room || !p || !p.alive) return;
    const w = String(payload?.weapon ?? "");
    if (w !== "pistol" && w !== "ak47") return;
    p.weapon = w;
  });

  socket.on("state", (state) => {
    const roomId = socket.data.roomId;
    const room = roomId ? rooms.get(roomId) : null;
    const p = room?.players.get(socket.id);
    if (!room || !p) return;
    if (!state || typeof state !== "object") return;
    if (!p.alive) return;

    const t = nowMs();
    const dtMs = clamp(t - p.lastUpdateAt, 1, 250);
    const dt = dtMs / 1000;

    const nextPos = state.pos;
    const nextVel = state.vel;
    const nextYaw = state.yaw;
    const nextPitch = state.pitch;
    if (!nextPos || !nextVel) return;

    p.sprint = !!state.sprint;
    p.crouch = !!state.crouch;

    const delta = dist3(nextPos, p.pos);
    const maxDelta = MAX_POS_DELTA * (dt * TICK_HZ);
    if (delta > maxDelta) {
      const dir = normalize3(sub3(nextPos, p.pos));
      p.pos = add3(p.pos, mul3(dir, maxDelta));
    } else {
      p.pos = {
        x: clamp(Number(nextPos.x) || 0, -200, 200),
        y: clamp(Number(nextPos.y) || 0, -10, 200),
        z: clamp(Number(nextPos.z) || 0, -200, 200),
      };
    }

    let cap = p.crouch ? BASE_MAX_SPEED * CROUCH_SPEED_MULT : p.sprint ? SPRINT_MAX_SPEED : BASE_MAX_SPEED;
    if (p.crouch && p.sprint) cap = BASE_MAX_SPEED * CROUCH_SPEED_MULT;
    cap = clamp(cap, 0.5, SPRINT_MAX_SPEED);

    const vx = Number(nextVel.x) || 0;
    const vy = Number(nextVel.y) || 0;
    const vz = Number(nextVel.z) || 0;
    const horiz = Math.hypot(vx, vz);
    let sx = vx;
    let sz = vz;
    if (horiz > cap) {
      const s = cap / (horiz || 1);
      sx *= s;
      sz *= s;
    }
    p.vel = {
      x: sx,
      y: clamp(vy, -40, 40),
      z: sz,
    };
    p.yaw = Number.isFinite(nextYaw) ? Number(nextYaw) : p.yaw;
    if (Number.isFinite(nextPitch)) {
      const lim = Math.PI / 2 - 0.02;
      p.pitch = clamp(Number(nextPitch), -lim, lim);
    }
    p.lastUpdateAt = t;
    resolvePlayerBuildCollision(p, room.builds);
  });

  socket.on("build_place", (payload) => {
    const roomId = socket.data.roomId;
    const room = roomId ? rooms.get(roomId) : null;
    const p = room?.players.get(socket.id);
    if (!room || !p) return;
    if (!payload || typeof payload !== "object") return;
    if (!p.alive) return;
    const t = nowMs();
    if (t - p.lastBuildAt < 120) return;
    p.lastBuildAt = t;

    const type = String(payload.type || "");
    if (!["wall", "ramp", "floor"].includes(type)) return;
    const pos = payload.pos;
    if (!pos) return;

    const piece = {
      id: `${t}-${Math.random().toString(16).slice(2)}`,
      type,
      pos: {
        x: clamp(Number(pos.x) || 0, -200, 200),
        y: clamp(Number(pos.y) || 0, -10, 200),
        z: clamp(Number(pos.z) || 0, -200, 200),
      },
      rotY: Number.isFinite(payload.rotY) ? Number(payload.rotY) : 0,
    };
    if (room.builds.length > MAX_BUILDS_PER_ROOM) room.builds.splice(0, room.builds.length - MAX_BUILDS_PER_ROOM);
    room.builds.push(piece);
    io.to(roomChannel(room.id)).emit("builds_update", { builds: room.builds });
  });

  socket.on("build_remove", (payload) => {
    const roomId = socket.data.roomId;
    const room = roomId ? rooms.get(roomId) : null;
    const p = room?.players.get(socket.id);
    if (!room || !p) return;
    if (!p.alive) return;
    const t = nowMs();
    if (t - p.lastRemoveAt < 140) return;
    p.lastRemoveAt = t;

    const buildId = String(payload?.id ?? "");
    if (!buildId) return;
    const idx = room.builds.findIndex((b) => b.id === buildId);
    if (idx === -1) return;
    const b = room.builds[idx];
    if (dist3(p.pos, b.pos) > BUILD_REMOVE_RANGE) return;
    room.builds.splice(idx, 1);
    io.to(roomChannel(room.id)).emit("builds_update", { builds: room.builds });
  });

  socket.on("shoot", (payload) => {
    const roomId = socket.data.roomId;
    const room = roomId ? rooms.get(roomId) : null;
    const p = room?.players.get(socket.id);
    if (!room || !p) return;
    if (!payload || typeof payload !== "object") return;
    if (!p.alive) return;

    const t = nowMs();
    const weaponId = p.weapon === "ak47" ? "ak47" : "pistol";
    const W = WEAPONS[weaponId];
    if (t - p.lastShotAt < W.fireMs - 8) return;
    p.lastShotAt = t;

    const origin = payload.origin;
    const dir = payload.dir;
    if (!origin || !dir) return;

    const ox = Number(origin.x);
    const oy = Number(origin.y);
    const oz = Number(origin.z);
    if (![ox, oy, oz].every(Number.isFinite)) return;
    const o = {
      x: clamp(ox, -250, 250),
      y: clamp(oy, -10, 250),
      z: clamp(oz, -250, 250),
    };
    const rawDx = Number(dir.x);
    const rawDy = Number(dir.y);
    const rawDz = Number(dir.z);
    if (![rawDx, rawDy, rawDz].every(Number.isFinite)) return;
    const d0 = normalize3({ x: rawDx, y: rawDy, z: rawDz });
    if (Math.hypot(d0.x, d0.y, d0.z) < 1e-6) return;
    const d = spreadDirection(d0, W.spread);

    const HIT_DIST = 0.55;
    const MAX_RANGE = W.range;
    let blockDist = Infinity;
    for (const piece of room.builds) {
      if (!piece?.pos) continue;
      const box = buildWorldAabb(piece);
      const tHit = rayAabbIntersect(o, d, MAX_RANGE, box);
      if (tHit !== null && tHit < blockDist) blockDist = tHit;
    }

    let hitId = null;
    let hitDist = Infinity;

    for (const [oid, op] of room.players.entries()) {
      if (oid === socket.id) continue;
      if (!op.alive) continue;
      if (op.team === p.team) continue;

      const headY = op.crouch ? 0.52 : 0.74;
      const bodyY = op.crouch ? 0.26 : 0.4;
      const head = add3(op.pos, { x: 0, y: headY, z: 0 });
      const body = add3(op.pos, { x: 0, y: bodyY, z: 0 });
      for (const target of [head, body]) {
        const toTarget = sub3(target, o);
        const proj = dot3(toTarget, d);
        if (proj < 0 || proj > MAX_RANGE) continue;
        const closest = add3(o, mul3(d, proj));
        const miss = dist3(closest, target);
        if (miss <= HIT_DIST && proj < hitDist && proj < blockDist) {
          hitId = oid;
          hitDist = proj;
        }
      }
    }

    if (hitId) {
      const victim = room.players.get(hitId);
      if (victim && victim.alive) {
        victim.hp = clamp(victim.hp - W.damage, 0, 100);
        victim.lastDamagedAt = t;
        if (victim.hp <= 0) {
          victim.alive = false;
          room.teamScores[p.team] += 1;
          p.kills = (p.kills || 0) + 1;
          io.to(roomChannel(room.id)).emit("player_down", { id: hitId, by: socket.id });
          setTimeout(() => {
            const r = rooms.get(roomId);
            if (!r) return;
            const v = r.players.get(hitId);
            if (!v) return;
            respawn(v);
            io.to(roomChannel(r.id)).emit("player_respawn", { id: hitId, player: v });
          }, RESPAWN_DELAY_MS);
        }
      }
      io.to(roomChannel(room.id)).emit("hit", {
        by: socket.id,
        victim: hitId,
        damage: W.damage,
        weapon: weaponId,
      });
    }
  });

  socket.on("disconnect", () => {
    removeFromQueue(socket.id);
    leaveGame(socket);
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    io.to(roomChannel(room.id)).emit("snapshot", snapshotRoom(room));
  }
}, TICK_MS);

server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT} (bind ${HOST})`);
});
