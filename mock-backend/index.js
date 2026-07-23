const express = require("express");
const { WebSocketServer } = require("ws");
const http = require("http");
const { AccessToken } = require("livekit-server-sdk");

const LK_API_KEY = "devkey";
const LK_API_SECRET = "secret";
const LK_URL = "ws://localhost:7880";

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Users (the only valid accounts)
// ---------------------------------------------------------------------------

const USERS = [
  { id: "user_alice",   email: "alice@pulse.gg",   password: "pulse123", display_name: "Alice"   },
  { id: "user_bob",     email: "bob@pulse.gg",     password: "pulse123", display_name: "Bob"     },
  { id: "user_charlie", email: "charlie@pulse.gg", password: "pulse123", display_name: "Charlie" },
  { id: "user_diana",   email: "diana@pulse.gg",   password: "pulse123", display_name: "Diana"   },
  { id: "user_evan",    email: "evan@pulse.gg",    password: "pulse123", display_name: "Evan"    },
  { id: "user_fiona",   email: "fiona@pulse.gg",   password: "pulse123", display_name: "Fiona"   },
];

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function makeToken(userId) {
  return Buffer.from(userId + ":" + Date.now()).toString("base64");
}
function makeRefreshToken(userId) {
  return Buffer.from("refresh:" + userId + ":" + Date.now()).toString("base64");
}
function extractUserId(token) {
  try { return Buffer.from(token, "base64").toString("utf8").split(":")[0]; }
  catch { return null; }
}
function extractUserIdFromBearer(req) {
  const header = req.headers["authorization"] ?? "";
  if (!header.startsWith("Bearer ")) return null;
  return extractUserId(header.slice(7));
}
function makeTokenPair(userId) {
  return { access_token: makeToken(userId), refresh_token: makeRefreshToken(userId), expires_in: 3600 };
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

// userId → { ws, status, game, display_name, lastPong }
const sessions = new Map();

// userId → Set<userId> of blocked user ids
const blockList = new Map();
for (const u of USERS) blockList.set(u.id, new Set());

// ---------------------------------------------------------------------------
// Presence helpers
// ---------------------------------------------------------------------------

// Broadcast one user's current presence to all OTHER connected clients.
function broadcastUserPresence(userId, status, displayName, game, excludeSelf = true) {
  const payload = JSON.stringify({
    type: "presence_update",
    data: { id: userId, status, display_name: displayName, game: game ?? null },
  });
  for (const [uid, s] of sessions) {
    if (excludeSelf && uid === userId) continue;
    if (s.ws.readyState === 1) s.ws.send(payload);
  }
}

// Broadcast ALL online users' statuses to one specific client (on connect).
function broadcastAllPresenceTo(ws, excludeUserId) {
  for (const [userId, s] of sessions) {
    if (userId === excludeUserId) continue;
    if (s.ws.readyState !== 1) continue;
    ws.send(JSON.stringify({
      type: "presence_update",
      data: { id: userId, status: s.status, display_name: s.display_name, game: s.game },
    }));
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body ?? {};
  const user = USERS.find((u) => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password" });
  console.log(`[pulse-mock] Login: ${user.display_name} (${user.id})`);
  res.json({
    user: { id: user.id, email: user.email, display_name: user.display_name, avatar_url: null },
    ...makeTokenPair(user.id),
  });
});

app.post("/auth/refresh", (req, res) => {
  const { refresh_token } = req.body ?? {};
  if (!refresh_token) return res.status(401).json({ error: "REFRESH_FAILED" });
  const userId = extractUserId(refresh_token);
  const user = USERS.find((u) => u.id === userId);
  if (!user) return res.status(401).json({ error: "REFRESH_FAILED" });
  res.json({
    user: { id: user.id, email: user.email, display_name: user.display_name, avatar_url: null },
    ...makeTokenPair(user.id),
  });
});

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

app.get("/friends", (req, res) => {
  const userId = extractUserIdFromBearer(req);
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  const myBlocked = blockList.get(userId) ?? new Set();
  const friends = USERS
    .filter((u) => {
      if (u.id === userId) return false;
      if (myBlocked.has(u.id)) return false;
      if ((blockList.get(u.id) ?? new Set()).has(userId)) return false;
      return true;
    })
    .map((u) => {
      const s = sessions.get(u.id);
      return { id: u.id, user_id: u.id, display_name: u.display_name, avatar_url: null,
               status: s?.status ?? "Offline", game: s?.game ?? null, is_friend: true };
    });
  res.json(friends);
});

app.post("/friends/add", (req, res) => {
  const userId = extractUserIdFromBearer(req);
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  const { user_id } = req.body ?? {};
  if (user_id) blockList.get(userId)?.delete(user_id);
  res.json({ success: true });
});

app.delete("/friends/:id", (req, res) => {
  const userId = extractUserIdFromBearer(req);
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  res.json({ success: true });
});

app.post("/friends/block", (req, res) => {
  const userId = extractUserIdFromBearer(req);
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  const { user_id } = req.body ?? {};
  if (!user_id) return res.status(400).json({ error: "missing user_id" });
  blockList.get(userId)?.add(user_id);
  res.json({ success: true });
});

app.post("/friends/unblock", (req, res) => {
  const userId = extractUserIdFromBearer(req);
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  const { user_id } = req.body ?? {};
  if (!user_id) return res.status(400).json({ error: "missing user_id" });
  blockList.get(userId)?.delete(user_id);
  res.json({ success: true });
});

app.get("/friends/blocked", (req, res) => {
  const userId = extractUserIdFromBearer(req);
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  const blocked = [...(blockList.get(userId) ?? [])].map((bid) => {
    const u = USERS.find((x) => x.id === bid);
    return u ? { id: u.id, display_name: u.display_name, avatar_url: null } : null;
  }).filter(Boolean);
  res.json(blocked);
});

app.post("/friends/accept", (_req, res) => res.json({ success: true }));
app.post("/friends/reject", (_req, res) => res.json({ success: true }));

// ---------------------------------------------------------------------------
// User status  (broadcasts to ALL clients including the caller)
// ---------------------------------------------------------------------------

app.put("/user/status", (req, res) => {
  const userId = extractUserIdFromBearer(req);
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  const { status, game } = req.body ?? {};
  if (!["Online", "InGame", "DND"].includes(status)) return res.status(400).json({ error: "invalid_status" });
  const session = sessions.get(userId);
  if (session) {
    session.status = status;
    session.game = status === "InGame" ? (game ?? null) : null;
    const displayName = session.display_name;
    console.log(`[pulse-mock] Status update: ${displayName} → ${status}${session.game ? ` (${session.game})` : ""}`);
    // Broadcast to ALL clients (including caller so their own UI can confirm)
    broadcastUserPresence(userId, session.status, displayName, session.game, false);
  }
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Call signaling
// ---------------------------------------------------------------------------

app.post("/call/invite", (req, res) => {
  const userId = extractUserIdFromBearer(req);
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  const { target_user_id, room_name } = req.body ?? {};
  if (!target_user_id || !room_name) return res.status(400).json({ error: "missing fields" });

  // Check friendship: caller must not have blocked target AND target must not have blocked caller
  const callerBlocked = blockList.get(userId) ?? new Set();
  const targetBlocked = blockList.get(target_user_id) ?? new Set();
  if (callerBlocked.has(target_user_id) || targetBlocked.has(userId)) {
    return res.status(403).json({ error: "NOT_FRIENDS", message: "You are not friends with this user and cannot call them" });
  }

  const targetSession = sessions.get(target_user_id);
  if (!targetSession) return res.status(404).json({ error: "USER_OFFLINE" });
  if (targetSession.status === "DND") return res.status(403).json({ error: "USER_DND" });

  const callerSession = sessions.get(userId);
  const fromDisplayName = callerSession?.display_name ?? userId;
  console.log(`[pulse-mock] Call invite: ${fromDisplayName} → ${targetSession.display_name} (${room_name})`);

  if (targetSession.ws.readyState === 1) {
    targetSession.ws.send(JSON.stringify({
      type: "call_invite",
      data: { from_user_id: userId, from_display_name: fromDisplayName, room_name },
    }));
  }
  res.json({ success: true });
});

app.post("/call/respond", (req, res) => {
  const userId = extractUserIdFromBearer(req);
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  const { accepted, room_name, caller_user_id } = req.body ?? {};

  const callerSession = sessions.get(caller_user_id);
  const respondentName = sessions.get(userId)?.display_name ?? userId;

  if (callerSession?.ws.readyState === 1) {
    if (accepted) {
      console.log(`[pulse-mock] Call accepted: ${respondentName} → ${callerSession.display_name}`);
      callerSession.ws.send(JSON.stringify({
        type: "call_accepted",
        data: { room_name, from_user_id: userId },
      }));
    } else {
      console.log(`[pulse-mock] Call declined: ${respondentName} → ${callerSession.display_name}`);
      callerSession.ws.send(JSON.stringify({
        type: "call_declined",
        data: { from_user_id: userId },
      }));
    }
  }
  res.json({ success: true });
});

app.post("/call/cancel", (req, res) => {
  const userId = extractUserIdFromBearer(req);
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  const { target_user_id } = req.body ?? {};

  const targetSession = sessions.get(target_user_id);
  if (targetSession?.ws.readyState === 1) {
    targetSession.ws.send(JSON.stringify({
      type: "call_cancelled",
      data: { from_user_id: userId },
    }));
  }
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// LiveKit (mock)
// ---------------------------------------------------------------------------

app.post("/livekit/token", async (req, res) => {
  const userId = extractUserIdFromBearer(req);
  if (!userId) return res.status(401).json({ error: "UNAUTHORIZED" });
  const { room_name } = req.body ?? {};
  console.log(`[pulse-mock] LiveKit token request: user=${userId} room=${room_name}`);
  if (!room_name) return res.status(400).json({ error: "missing room_name" });
  const user = USERS.find((u) => u.id === userId);
  const at = new AccessToken(LK_API_KEY, LK_API_SECRET, {
    identity: userId,
    name: user?.display_name ?? userId,
  });
  at.addGrant({ roomJoin: true, room: room_name, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();
  res.json({ token, room_name: room_name, url: "ws://localhost:7880" });
});

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(app);
server.listen(3000, () => console.log("[pulse-mock] HTTP  → http://localhost:3000"));

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ port: 3001 });
console.log("[pulse-mock] WS    → ws://localhost:3001");

const WS_OPEN = 1; // WebSocket.OPEN

wss.on("connection", (ws) => {
  let authed = false;
  let clientUserId = null;

  // Disconnect unauthenticated clients after 10 seconds
  const authTimeout = setTimeout(() => { if (!authed) ws.close(); }, 10_000);

  // Server-side ping every 15s; close connection if no pong within 20s
  const pingInterval = setInterval(() => {
    if (!authed || !clientUserId) return;
    const session = sessions.get(clientUserId);
    if (!session) return;
    if (Date.now() - session.lastPong > 20_000) {
      console.log(`[pulse-mock] WS ping timeout: ${session.display_name}`);
      ws.close();
      return;
    }
    if (session.ws.readyState === WS_OPEN) {
      session.ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 15_000);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (!authed) {
      if (msg.type !== "auth") return;
      const userId = extractUserId(msg.token ?? "");
      const user = USERS.find((u) => u.id === userId);
      if (!user) {
        ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
        ws.close();
        return;
      }
      clearTimeout(authTimeout);
      authed = true;
      clientUserId = userId;
      sessions.set(userId, {
        ws, status: "Online", game: null,
        display_name: user.display_name, lastPong: Date.now(),
      });
      ws.send(JSON.stringify({ type: "auth_ok", user_id: userId }));
      // Send this user's Online status to all other clients
      broadcastUserPresence(userId, "Online", user.display_name, null);
      // Send all other online users' statuses to this client
      broadcastAllPresenceTo(ws, userId);
      console.log(`[pulse-mock] WS auth OK: ${user.display_name}`);
      return;
    }

    if (msg.type === "pong") {
      const session = sessions.get(clientUserId);
      if (session) session.lastPong = Date.now();
      return;
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  });

  ws.on("close", () => {
    clearTimeout(authTimeout);
    clearInterval(pingInterval);
    if (clientUserId) {
      const session = sessions.get(clientUserId);
      const displayName = session?.display_name ?? clientUserId;
      sessions.delete(clientUserId);
      // Broadcast this user's Offline status to all remaining clients
      broadcastUserPresence(clientUserId, "Offline", displayName, null);
      console.log(`[pulse-mock] WS disconnected: ${displayName}`);
    }
  });

  ws.on("error", () => { /* close event follows */ });
});

// ---------------------------------------------------------------------------
// Session health check every 5 seconds — remove dead connections
// ---------------------------------------------------------------------------

setInterval(() => {
  for (const [userId, session] of sessions) {
    if (session.ws.readyState !== WS_OPEN) {
      const displayName = session.display_name;
      sessions.delete(userId);
      broadcastUserPresence(userId, "Offline", displayName, null);
      console.log(`[pulse-mock] WS cleaned up dead session: ${displayName}`);
    }
  }
}, 5_000);
