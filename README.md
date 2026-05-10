# Browser 1v1 arena (build + shoot)

Low-poly third-person arena with **real-time multiplayer** over Socket.IO: move, aim, place/remove builds, and server-validated hitscan shots. Geometry is **original primitives** (Three.js boxes/capsules/planes) — not copied from any commercial game.

## Run locally

```bash
npm install
npm run dev
```

- This machine: open `http://localhost:3000`
- **Another device on your LAN**: open `http://<this-computer-LAN-IP>:3000` (same Wi‑Fi/Ethernet)

The server binds to `0.0.0.0` by default so other devices can connect. If Windows Firewall prompts for Node.js, allow access on **private** networks.

Optional: `set PORT=4000` (PowerShell: `$env:PORT=4000`) or `set HOST=127.0.0.1` to bind only locally.

## Lobby (1v1)

1. **Quick match** — queues you until another player queues; you are paired into a private room (max 2).
2. **Create room** — you get a **6-character code** (shown in the HUD). Share it with a friend.
3. **Join** — type the code and join if there is a free slot.

Teams are automatic: first player in a room is **red**, second is **blue**. No friendly fire.

## Controls

- **WASD** — move; **Shift** — sprint; **Space** — jump  
- **Mouse** (click the game to capture pointer) — look  
- **Left click** — shoot  
- **1 / 2 / 3** — wall / ramp / floor  
- **F** — place piece; **G** — remove piece under crosshair (server checks range)  
- **R** — reset look pitch/yaw  

## Stack

- **Server**: Node.js, Express (static files), Socket.IO  
- **Client**: Three.js (ESM from CDN), plain HTML/CSS/JS in `/public`  

## Authority / fairness (MVP)

- **Hybrid**: client predicts movement; server clamps speed, step distance, and vertical bounds.  
- **Hits**: ray vs simplified “capsule” (two sphere checks) on the server; damage and score applied there.  
- **Builds**: server stores pieces per room, rate-limits place/remove, validates remove distance.  

This is not production anti-cheat: advanced spoofing is still possible, but obvious speed/teleport edits are reduced.

## Limitations

- No lag compensation; shots are best-effort at server tick.  
- No projectile visuals yet; hits are raycast/hitscan only.  
- World collisions are minimal (flat floor only); ramps/walls are visual + shoot-through unless extended.  
- Match is **1v1 per room**; no spectating or replays.

## Assets

All visuals are procedural primitives and simple materials in code — **no proprietary or scraped assets**.
