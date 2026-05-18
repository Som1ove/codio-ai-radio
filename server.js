import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const CACHE_DIR = path.join(__dirname, "cache", "audio");
const DB_FILE = path.join(DATA_DIR, "state.json");

const defaultState = {
  profile: {
    name: "Codio Listener",
    location: "New York",
    dailyMood: "focused",
    apiKeys: {
      music: "",
      weather: "",
      tts: "",
      llm: ""
    },
    voice: "warm-night-radio",
    musicPreference: "late-night mandopop, mellow electronic, soft indie",
    autoPlaySchedule: {
      enabled: true,
      morning: "07:00",
      evening: "22:00"
    }
  },
  now: {
    id: "local-001",
    title: "Midnight Signal",
    artist: "Codio AI Radio",
    album: "Local Session",
    cover: "/assets/cover.svg",
    duration: 214,
    position: 42,
    playing: false,
    volume: 72,
    lyrics: [
      "Neon on the window, rain against the line",
      "A small voice in the static says the evening will be kind",
      "Keep the city low, let the heartbeat climb",
      "We will find the tempo in our own time"
    ],
    aiMessage: "今晚适合低亮度、慢节拍。我先放一首不抢注意力的歌，然后慢慢把能量推上去。"
  },
  queue: [
    {
      id: "local-002",
      title: "Soft Forecast",
      artist: "Weather Room",
      album: "Morning Hooks",
      cover: "/assets/cover-2.svg",
      duration: 188
    },
    {
      id: "local-003",
      title: "Glass Elevator",
      artist: "North Loop",
      album: "City Lights",
      cover: "/assets/cover-3.svg",
      duration: 232
    }
  ],
  taste: {
    genres: ["Mandopop", "Chillwave", "Indie Pop", "Ambient"],
    energy: "medium-low",
    avoid: ["harsh treble", "overly busy intros"],
    notes: "Prefers warm vocals, clean percussion, and gentle late-night pacing."
  },
  planToday: [
    { time: "07:00", intent: "Wake-up", sound: "light acoustic, weather brief" },
    { time: "14:00", intent: "Focus", sound: "instrumental electronic, no vocals" },
    { time: "22:00", intent: "Wind down", sound: "soft vocals, low tempo" }
  ],
  history: [],
  cache: {
    audioDir: CACHE_DIR,
    items: []
  },
  messages: []
};

let state = structuredClone(defaultState);
const sockets = new Set();

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    state = mergeState(defaultState, JSON.parse(raw));
  } catch {
    await saveState();
  }
}

function mergeState(base, saved) {
  if (!saved || typeof saved !== "object") return structuredClone(base);
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(saved)) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key]) {
      out[key] = mergeState(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function saveState() {
  await fs.writeFile(DB_FILE, JSON.stringify(state, null, 2));
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function notFound(res) {
  json(res, 404, { error: "Not found" });
}

function sendStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath === "/" ? "index.html" : safePath);
  const resolved = filePath.startsWith(PUBLIC_DIR) ? filePath : path.join(PUBLIC_DIR, "index.html");
  const ext = path.extname(resolved).toLowerCase();
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8"
  }[ext] || "application/octet-stream";

  const stream = createReadStream(resolved);
  stream.on("open", () => res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" }));
  stream.on("error", () => {
    if (path.extname(resolved)) {
      res.writeHead(404);
      res.end("Not found");
    } else {
      createReadStream(path.join(PUBLIC_DIR, "index.html")).pipe(res);
    }
  });
  stream.pipe(res);
}

async function musicApiNext() {
  state.history.unshift({ ...state.now, playedAt: new Date().toISOString() });
  const next = state.queue.shift() || defaultState.queue[0];
  state.now = {
    ...state.now,
    ...next,
    position: 0,
    playing: true,
    lyrics: [
      "A small spark in the speakers",
      "A softer road ahead",
      "Let the room get lighter",
      "Let the next song thread"
    ],
    aiMessage: await llmApiMessage(`Introduce ${next.title} by ${next.artist}`)
  };
  state.queue.push({
    id: `local-${Date.now()}`,
    title: ["Afterglow Routine", "Calendar Rain", "Quiet Drive"][Math.floor(Math.random() * 3)],
    artist: ["Codio AI Radio", "City Weather", "Local Cache"][Math.floor(Math.random() * 3)],
    album: "Generated Queue",
    cover: ["/assets/cover.svg", "/assets/cover-2.svg", "/assets/cover-3.svg"][Math.floor(Math.random() * 3)],
    duration: 180 + Math.floor(Math.random() * 70)
  });
  await saveState();
  broadcast("now", state.now);
  return state.now;
}

async function weatherApiBrief() {
  if (!state.profile.apiKeys.weather) return "Local weather connector is ready; add a key in Settings for live weather.";
  return "Weather API connected. Live weather can be folded into DJ planning.";
}

async function ttsApiCache(text) {
  const hash = crypto.createHash("sha1").update(text).digest("hex");
  const file = path.join(CACHE_DIR, `${hash}.txt`);
  await fs.writeFile(file, text);
  if (!state.cache.items.includes(file)) state.cache.items.push(file);
  return { cached: true, path: file };
}

async function llmApiMessage(prompt) {
  if (!state.profile.apiKeys.llm) {
    return `AI DJ: ${prompt}。我会按你的口味保持温暖、松弛、不过度打扰。`;
  }
  return `AI DJ connected: ${prompt}`;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/now") {
    return json(res, 200, state.now);
  }
  if (req.method === "GET" && url.pathname === "/api/next") {
    return json(res, 200, await musicApiNext());
  }
  if (req.method === "GET" && url.pathname === "/api/taste") {
    return json(res, 200, state.taste);
  }
  if (req.method === "GET" && url.pathname === "/api/plan/today") {
    const weather = await weatherApiBrief();
    return json(res, 200, { date: new Date().toISOString().slice(0, 10), weather, plan: state.planToday });
  }
  if (req.method === "GET" && url.pathname === "/api/profile") {
    return json(res, 200, state.profile);
  }
  if (req.method === "POST" && url.pathname === "/api/profile") {
    const body = await readJson(req);
    state.profile = mergeState(state.profile, body);
    await saveState();
    broadcast("profile", state.profile);
    return json(res, 200, state.profile);
  }
  if (req.method === "POST" && url.pathname === "/api/control") {
    const body = await readJson(req);
    if (body.action === "play") state.now.playing = true;
    if (body.action === "pause") state.now.playing = false;
    if (body.action === "previous" && state.history.length) state.now = { ...state.history.shift(), playing: true, position: 0 };
    if (body.action === "next") await musicApiNext();
    if (typeof body.volume === "number") state.now.volume = Math.max(0, Math.min(100, body.volume));
    await saveState();
    broadcast("now", state.now);
    return json(res, 200, state.now);
  }
  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJson(req);
    const userMessage = String(body.message || "").trim();
    const reply = await llmApiMessage(userMessage || "Give a short music update");
    const speech = await ttsApiCache(reply);
    const message = { id: crypto.randomUUID(), userMessage, reply, speech, createdAt: new Date().toISOString() };
    state.messages.unshift(message);
    state.now.aiMessage = reply;
    await saveState();
    broadcast("chat", message);
    broadcast("now", state.now);
    return json(res, 200, message);
  }

  return notFound(res);
}

function acceptWebSocket(req, socket) {
  const key = req.headers["sec-websocket-key"];
  if (!key) return socket.destroy();
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    ""
  ].join("\r\n"));
  sockets.add(socket);
  sendFrame(socket, { type: "hello", payload: { now: state.now, profile: state.profile } });
  socket.on("data", (buffer) => handleSocketData(socket, buffer));
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => sockets.delete(socket));
}

function handleSocketData(socket, buffer) {
  const text = decodeFrame(buffer);
  if (!text) return;
  try {
    const message = JSON.parse(text);
    if (message.type === "ping") sendFrame(socket, { type: "pong", payload: Date.now() });
  } catch {
    sendFrame(socket, { type: "error", payload: "Invalid message" });
  }
}

function decodeFrame(buffer) {
  const secondByte = buffer[1];
  let offset = 2;
  let length = secondByte & 0x7f;
  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  const masked = (secondByte & 0x80) === 0x80;
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += masked ? 4 : 0;
  const payload = buffer.subarray(offset, offset + length);
  if (!masked) return payload.toString("utf8");
  return Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4])).toString("utf8");
}

function sendFrame(socket, data) {
  if (socket.destroyed) return;
  const payload = Buffer.from(JSON.stringify(data));
  const header = payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  socket.write(Buffer.concat([header, payload]));
}

function broadcast(type, payload) {
  for (const socket of sockets) sendFrame(socket, { type, payload });
}

setInterval(async () => {
  if (state.now.playing) {
    state.now.position = Math.min(state.now.duration, state.now.position + 1);
    if (state.now.position >= state.now.duration) await musicApiNext();
    broadcast("tick", { position: state.now.position, duration: state.now.duration });
  }
}, 1000);

await ensureStorage();

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/api/")) {
    handleApi(req, res).catch((error) => json(res, 500, { error: error.message }));
  } else {
    sendStatic(req, res);
  }
});

server.on("upgrade", (req, socket) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname === "/stream") acceptWebSocket(req, socket);
  else socket.destroy();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`AI music assistant running at http://localhost:${PORT}`);
});
