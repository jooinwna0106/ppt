import express from "express";
import http from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const runtimeDataRoot = process.env.RENDER === "true" ? "/tmp/speed-quiz-show" : rootDir;
const uploadRoot = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(runtimeDataRoot, "uploads");
const dataRoot = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(runtimeDataRoot, "data");
const roomsFile = path.join(dataRoot, "rooms.json");
const distDir = path.join(rootDir, "dist");
const PORT = Number(process.env.PORT) || 4000;

ensureDirectory(uploadRoot, "업로드");
ensureDirectory(dataRoot, "방 저장");

const app = express();
const server = http.createServer(app);
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

const rooms = new Map();
loadRooms();

app.set("trust proxy", 1);
app.use(express.json());
app.use("/uploads", express.static(uploadRoot));
app.use(express.static(distDir));

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/rooms", (req, res) => {
  const summaries = [...rooms.values()]
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
    .map((room) => ({
      code: room.code,
      slideCount: room.slides.length,
      playerCount: room.players.length,
      currentSlide: room.currentSlide,
      ended: room.ended,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt || room.createdAt
    }));
  res.json({ rooms: summaries });
});

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const roomCode = sanitizeRoomCode(req.params.roomCode);
    const destination = path.join(uploadRoot, roomCode);
    fs.mkdirSync(destination, { recursive: true });
    cb(null, destination);
  },
  filename(req, file, cb) {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const safeName = path
      .basename(file.originalname || "slide", extension)
      .replace(/[^a-zA-Z0-9가-힣_-]/g, "-")
      .slice(0, 48);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 80
  },
  fileFilter(req, file, cb) {
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("PNG, JPG, WEBP, GIF 이미지만 업로드할 수 있습니다."));
  }
});

app.get("/api/rooms/:roomCode", (req, res) => {
  const room = rooms.get(sanitizeRoomCode(req.params.roomCode));
  if (!room) {
    res.status(404).json({ error: "방을 찾을 수 없습니다." });
    return;
  }
  res.json(toClientState(room));
});

app.post("/api/rooms/:roomCode/slides", upload.array("slides"), (req, res) => {
  const roomCode = sanitizeRoomCode(req.params.roomCode);
  const room = rooms.get(roomCode);
  if (!room) {
    res.status(404).json({ error: "방을 찾을 수 없습니다." });
    return;
  }

  const uploadedSlides = req.files.map((file, index) => ({
    id: `${Date.now()}-${index}-${file.filename}`,
    name: file.originalname,
    url: `/uploads/${roomCode}/${file.filename}`
  }));

  room.slides = uploadedSlides;
  room.currentSlide = uploadedSlides.length ? 0 : -1;
  room.buzzerActive = false;
  room.buzzes = [];
  room.activeBuzzIndex = 0;
  room.ended = false;
  room.lastJudgement = null;
  touchAndSave(room);
  broadcastRoom(roomCode);
  res.json(toClientState(room));
});

app.use((error, req, res, next) => {
  if (!error) return next();
  res.status(400).json({ error: error.message || "요청을 처리하지 못했습니다." });
});

app.use((req, res) => {
  const indexPath = path.join(distDir, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
    return;
  }
  res.status(404).send("개발 중에는 Vite 서버(5173)에서 화면을 열어주세요.");
});

io.on("connection", (socket) => {
  socket.on("createRoom", (_, callback) => {
    const room = createRoom();
    leavePreviousRoom(socket, room.code);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.role = "host";
    callback?.({ ok: true, state: toClientState(room) });
    broadcastRoom(room.code);
  });

  socket.on("joinRoom", ({ roomCode, role }, callback) => {
    const code = sanitizeRoomCode(roomCode);
    const room = rooms.get(code);
    if (!room) {
      callback?.({ ok: false, error: "방 코드를 확인해 주세요." });
      return;
    }
    leavePreviousRoom(socket, code);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = role === "host" ? "host" : "viewer";
    callback?.({ ok: true, state: toClientState(room) });
    broadcastRoom(code);
  });

  socket.on("saveRoom", ({ roomCode }, callback) => {
    const room = rooms.get(sanitizeRoomCode(roomCode));
    if (!room) return callback?.({ ok: false, error: "방을 찾을 수 없습니다." });

    touchAndSave(room);
    callback?.({ ok: true, state: toClientState(room) });
  });

  socket.on("updatePlayers", ({ roomCode, players }, callback) => {
    const room = rooms.get(sanitizeRoomCode(roomCode));
    if (!room) return callback?.({ ok: false, error: "방을 찾을 수 없습니다." });

    const normalizedPlayers = normalizePlayers(players, room.players);
    const validation = validatePlayers(normalizedPlayers);
    if (!validation.ok) return callback?.(validation);

    room.players = normalizedPlayers;
    room.buzzes = room.buzzes.filter((buzz) => room.players.some((player) => player.id === buzz.playerId));
    room.activeBuzzIndex = Math.min(room.activeBuzzIndex, Math.max(room.buzzes.length - 1, 0));
    room.ended = false;
    touchAndSave(room);
    broadcastRoom(room.code);
    callback?.({ ok: true, state: toClientState(room) });
  });

  socket.on("goToSlide", ({ roomCode, index }, callback) => {
    const room = rooms.get(sanitizeRoomCode(roomCode));
    if (!room) return callback?.({ ok: false, error: "방을 찾을 수 없습니다." });

    if (!room.slides.length) {
      room.currentSlide = -1;
    } else {
      room.currentSlide = clamp(Number(index), 0, room.slides.length - 1);
    }
    resetBuzzer(room);
    touchAndSave(room);
    broadcastRoom(room.code);
    callback?.({ ok: true, state: toClientState(room) });
  });

  socket.on("setBuzzer", ({ roomCode, active }, callback) => {
    const room = rooms.get(sanitizeRoomCode(roomCode));
    if (!room) return callback?.({ ok: false, error: "방을 찾을 수 없습니다." });

    room.buzzerActive = Boolean(active);
    room.buzzes = [];
    room.activeBuzzIndex = 0;
    room.buzzerOpenedAt = room.buzzerActive ? Date.now() : null;
    room.ended = false;
    room.lastJudgement = null;
    broadcastRoom(room.code);
    callback?.({ ok: true, state: toClientState(room) });
  });

  socket.on("buzz", ({ roomCode, key, clientTime }, callback) => {
    const room = rooms.get(sanitizeRoomCode(roomCode));
    if (!room) return callback?.({ ok: false, error: "방을 찾을 수 없습니다." });
    if (!room.buzzerActive || room.ended) return callback?.({ ok: false, error: "버저가 아직 열리지 않았습니다." });

    const normalizedKey = normalizeKey(key);
    const player = room.players.find((entry) => entry.key === normalizedKey);
    if (!player) return callback?.({ ok: false, error: "배정되지 않은 키입니다." });
    if (room.buzzes.some((buzz) => buzz.playerId === player.id)) {
      callback?.({ ok: true, state: toClientState(room) });
      return;
    }

    const timestamp = Date.now();
    room.buzzes.push({
      id: `${timestamp}-${player.id}`,
      playerId: player.id,
      playerName: player.name,
      key: player.key,
      timestamp,
      clientTime: Number(clientTime) || null
    });
    room.buzzes.sort((a, b) => a.timestamp - b.timestamp);
    room.activeBuzzIndex = Math.min(room.activeBuzzIndex, Math.max(room.buzzes.length - 1, 0));
    broadcastRoom(room.code);
    callback?.({ ok: true, state: toClientState(room) });
  });

  socket.on("judge", ({ roomCode, correct }, callback) => {
    const room = rooms.get(sanitizeRoomCode(roomCode));
    if (!room) return callback?.({ ok: false, error: "방을 찾을 수 없습니다." });

    const currentBuzz = room.buzzes[room.activeBuzzIndex];
    if (!currentBuzz) return callback?.({ ok: false, error: "판정할 버저 기록이 없습니다." });

    const player = room.players.find((entry) => entry.id === currentBuzz.playerId);
    if (!player) return callback?.({ ok: false, error: "플레이어를 찾을 수 없습니다." });

    if (correct) {
      player.score += 1;
      room.buzzerActive = false;
      room.activeBuzzIndex = room.buzzes.findIndex((buzz) => buzz.playerId === player.id);
      room.lastJudgement = {
        playerId: player.id,
        playerName: player.name,
        key: player.key,
        rank: room.activeBuzzIndex + 1,
        correct: true,
        nextBuzz: null,
        at: Date.now()
      };
    } else {
      player.score -= 1;
      const currentRank = room.activeBuzzIndex + 1;
      const nextBuzz = room.buzzes[room.activeBuzzIndex + 1]
        ? { ...room.buzzes[room.activeBuzzIndex + 1], rank: room.activeBuzzIndex + 2 }
        : null;
      room.lastJudgement = {
        playerId: player.id,
        playerName: player.name,
        key: player.key,
        rank: currentRank,
        correct: false,
        nextBuzz,
        at: Date.now()
      };
      room.activeBuzzIndex += 1;
      if (room.activeBuzzIndex >= room.buzzes.length) {
        room.buzzerActive = false;
      }
    }

    touchAndSave(room);
    broadcastRoom(room.code);
    callback?.({ ok: true, state: toClientState(room) });
  });

  socket.on("endQuiz", ({ roomCode }, callback) => {
    const room = rooms.get(sanitizeRoomCode(roomCode));
    if (!room) return callback?.({ ok: false, error: "방을 찾을 수 없습니다." });

    room.ended = true;
    room.buzzerActive = false;
    room.buzzes = [];
    room.activeBuzzIndex = 0;
    room.lastJudgement = null;
    touchAndSave(room);
    broadcastRoom(room.code);
    callback?.({ ok: true, state: toClientState(room) });
  });

  socket.on("restartQuiz", ({ roomCode }, callback) => {
    const room = rooms.get(sanitizeRoomCode(roomCode));
    if (!room) return callback?.({ ok: false, error: "방을 찾을 수 없습니다." });

    room.players = room.players.map((player) => ({ ...player, score: 0 }));
    room.currentSlide = room.slides.length ? 0 : -1;
    resetBuzzer(room);
    touchAndSave(room);
    broadcastRoom(room.code);
    callback?.({ ok: true, state: toClientState(room) });
  });

  socket.on("resetScores", ({ roomCode }, callback) => {
    const room = rooms.get(sanitizeRoomCode(roomCode));
    if (!room) return callback?.({ ok: false, error: "방을 찾을 수 없습니다." });

    room.players = room.players.map((player) => ({ ...player, score: 0 }));
    room.ended = false;
    resetBuzzer(room);
    touchAndSave(room);
    broadcastRoom(room.code);
    callback?.({ ok: true, state: toClientState(room) });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Speed Quiz Show server running on http://0.0.0.0:${PORT}`);
});

function createRoom() {
  let code;
  do {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (rooms.has(code));

  const room = {
    code,
    slides: [],
    players: defaultPlayers(4),
    currentSlide: -1,
    buzzerActive: false,
    buzzerOpenedAt: null,
    buzzes: [],
    activeBuzzIndex: 0,
    ended: false,
    lastJudgement: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  rooms.set(code, room);
  saveRooms();
  return room;
}

function defaultPlayers(count) {
  const keys = ["Q", "P", "Z", "M", "A", "L", "S", "K"];
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    name: `플레이어 ${index + 1}`,
    key: keys[index],
    score: 0
  }));
}

function normalizePlayers(players, currentPlayers) {
  const safePlayers = Array.isArray(players) ? players.slice(0, 8) : [];
  return safePlayers.map((player, index) => {
    const existing = currentPlayers.find((entry) => entry.id === player.id);
    return {
      id: player.id || `p${index + 1}`,
      name: String(player.name || `플레이어 ${index + 1}`).trim().slice(0, 24),
      key: normalizeKey(player.key),
      score: Number.isFinite(Number(existing?.score ?? player.score)) ? Number(existing?.score ?? player.score) : 0
    };
  });
}

function validatePlayers(players) {
  if (players.length < 2 || players.length > 8) {
    return { ok: false, error: "참가자는 2명에서 8명까지 설정할 수 있습니다." };
  }
  const seenKeys = new Set();
  for (const player of players) {
    if (!player.name) return { ok: false, error: "플레이어 이름을 입력해 주세요." };
    if (!player.key) return { ok: false, error: `${player.name}의 키를 지정해 주세요.` };
    if (player.key.length > 1 && !["SPACE", "ENTER"].includes(player.key)) {
      return { ok: false, error: "키는 한 글자, Space, Enter만 사용할 수 있습니다." };
    }
    if (seenKeys.has(player.key)) {
      return { ok: false, error: `${player.key} 키가 중복되었습니다.` };
    }
    seenKeys.add(player.key);
  }
  return { ok: true };
}

function resetBuzzer(room) {
  room.buzzerActive = false;
  room.buzzerOpenedAt = null;
  room.buzzes = [];
  room.activeBuzzIndex = 0;
  room.lastJudgement = null;
  room.ended = false;
}

function touchAndSave(room) {
  room.updatedAt = Date.now();
  saveRooms();
}

function loadRooms() {
  try {
    if (!fs.existsSync(roomsFile)) return;

    const raw = JSON.parse(fs.readFileSync(roomsFile, "utf8"));
    const storedRooms = Array.isArray(raw.rooms) ? raw.rooms : [];
    for (const storedRoom of storedRooms) {
      const code = sanitizeRoomCode(storedRoom.code);
      if (!code) continue;

      rooms.set(code, {
        code,
        slides: Array.isArray(storedRoom.slides) ? storedRoom.slides : [],
        players: Array.isArray(storedRoom.players) && storedRoom.players.length
          ? normalizePlayers(storedRoom.players, storedRoom.players)
          : defaultPlayers(4),
        currentSlide: Number.isInteger(storedRoom.currentSlide) ? storedRoom.currentSlide : -1,
        buzzerActive: false,
        buzzerOpenedAt: null,
        buzzes: [],
        activeBuzzIndex: 0,
        ended: false,
        lastJudgement: null,
        createdAt: Number(storedRoom.createdAt) || Date.now(),
        updatedAt: Number(storedRoom.updatedAt) || Number(storedRoom.createdAt) || Date.now()
      });
    }
  } catch (error) {
    console.error("저장된 방 정보를 읽지 못했습니다.", error);
  }
}

function saveRooms() {
  try {
    ensureDirectory(dataRoot, "방 저장");
    const payload = {
      rooms: [...rooms.values()].map((room) => ({
        code: room.code,
        slides: room.slides,
        players: room.players,
        currentSlide: room.currentSlide,
        ended: room.ended,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt || room.createdAt
      }))
    };

    fs.writeFileSync(roomsFile, JSON.stringify(payload, null, 2), "utf8");
  } catch (error) {
    console.error("방 정보를 파일로 저장하지 못했습니다.", error);
  }
}

function ensureDirectory(directory, label) {
  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch (error) {
    console.error(`${label} 폴더를 준비하지 못했습니다: ${directory}`, error);
  }
}

function broadcastRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  io.to(roomCode).emit("roomState", toClientState(room));
}

function leavePreviousRoom(socket, nextRoomCode) {
  const previousRoomCode = socket.data.roomCode;
  if (previousRoomCode && previousRoomCode !== nextRoomCode) {
    socket.leave(previousRoomCode);
  }
}

function toClientState(room) {
  const rankedBuzzes = room.buzzes.map((buzz, index) => ({ ...buzz, rank: index + 1 }));
  const ranking = room.players
    .slice()
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ko"));
  return {
    code: room.code,
    slides: room.slides,
    players: room.players,
    currentSlide: room.currentSlide,
    buzzerActive: room.buzzerActive,
    buzzes: rankedBuzzes,
    activeBuzzIndex: room.activeBuzzIndex,
    activeBuzz: rankedBuzzes[room.activeBuzzIndex] || null,
    ended: room.ended,
    ranking,
    lastJudgement: room.lastJudgement
  };
}

function sanitizeRoomCode(value) {
  return String(value || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8);
}

function normalizeKey(key) {
  const raw = String(key || "").trim();
  if (!raw) return "";
  if (raw === " ") return "SPACE";
  const upper = raw.toUpperCase();
  if (upper === " ") return "SPACE";
  if (upper === "SPACE" || upper === "ENTER") return upper;
  return upper.slice(0, 1);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
