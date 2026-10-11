const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || "*" }
});
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const MAX_PLAYERS = 2;
const START_MONEY = 100;
const SHOP_ITEMS = { tree: 35, flower: 15, bench: 50 };
const HOUSE_UPGRADE_COST = 180;
const MAX_HOUSE_LEVEL = 3;
const MAX_DECORATIONS = 100;
const CHARACTER_TYPES = ["male", "female"];
const OUTFITS = {
  lavender: "#8b5cf6",
  pink: "#f472b6",
  blue: "#38bdf8",
  green: "#34d399",
  sunshine: "#facc15"
};

function makeRoomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
function safeName(value) {
  if (typeof value !== "string") return "Visitante";
  return value.trim().replace(/[<>]/g, "").slice(0, 18) || "Visitante";
}
function publicRoom(room) {
  return {
    code: room.code,
    items: room.items,
    houseLevel: room.houseLevel,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, x: p.x, z: p.z, money: p.money,
      color: p.color, taskCount: p.taskCount,
      characterType: p.characterType, outfit: p.outfit
    }))
  };
}
function broadcastRoom(code) {
  const room = rooms.get(code);
  if (room) io.to(code).emit("room-state", publicRoom(room));
}

io.on("connection", socket => {
  socket.on("create-room", ({ name, characterType, outfit } = {}, reply = () => {}) => {
    let code = makeRoomCode();
    while (rooms.has(code)) code = makeRoomCode();
    const room = { code, players: new Map(), items: [], houseLevel: 0, createdAt: Date.now() };
    rooms.set(code, room);
    joinRoom(socket, room, name, reply, characterType, outfit);
  });

  socket.on("join-room", ({ code, name, characterType, outfit } = {}, reply = () => {}) => {
    const normalized = String(code || "").trim().toUpperCase();
    const room = rooms.get(normalized);
    if (!room) return reply({ ok: false, error: "Essa sala não existe. Peça um novo link ao criador." });
    if (room.players.size >= MAX_PLAYERS && !room.players.has(socket.id)) {
      return reply({ ok: false, error: "Essa sala já está cheia. O jogo aceita duas pessoas." });
    }
    joinRoom(socket, room, name, reply, characterType, outfit);
  });

  function joinRoom(socket, room, name, reply, characterType, outfit) {
    // Remove this socket from any previous room.
    for (const [code, existing] of rooms) {
      if (existing.players.has(socket.id)) {
        existing.players.delete(socket.id);
        socket.leave(code);
        broadcastRoom(code);
        if (existing.players.size === 0) rooms.delete(code);
      }
    }
    const colors = ["#8b5cf6", "#f472b6"];
    const player = {
      id: socket.id, name: safeName(name), x: room.players.size === 0 ? -1.2 : 1.2,
      z: 4.2, money: START_MONEY, color: colors[room.players.size % colors.length],
      taskCount: 0, lastMoveAt: 0,
      characterType: CHARACTER_TYPES.includes(characterType) ? characterType : "male",
      outfit: Object.prototype.hasOwnProperty.call(OUTFITS, outfit) ? outfit : "lavender"
    };
    room.players.set(socket.id, player);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    reply({ ok: true, code: room.code, playerId: socket.id });
    broadcastRoom(room.code);
  }

  socket.on("update-appearance", (payload, reply = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    const player = room?.players.get(socket.id);
    if (!player) return reply({ ok: false, error: "Entre em uma sala primeiro." });

    const characterType = payload?.characterType;
    const outfit = payload?.outfit;
    if (!CHARACTER_TYPES.includes(characterType) || !Object.prototype.hasOwnProperty.call(OUTFITS, outfit)) {
      return reply({ ok: false, error: "Escolha um personagem e uma roupa válidos." });
    }

    player.characterType = characterType;
    player.outfit = outfit;
    broadcastRoom(code);
    reply({ ok: true });
  });

  socket.on("move", payload => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    const player = room?.players.get(socket.id);
    if (!player || !payload) return;
    // Basic server-side bounds and rate limiting.
    const now = Date.now();
    if (now - player.lastMoveAt < 35) return;
    player.lastMoveAt = now;
    const x = Number(payload.x), z = Number(payload.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    player.x = Math.max(-12, Math.min(12, x));
    player.z = Math.max(-12, Math.min(12, z));
    socket.to(code).emit("player-moved", { id: socket.id, x: player.x, z: player.z });
  });

  socket.on("do-task", (payload, reply = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    const player = room?.players.get(socket.id);
    if (!player) return reply({ ok: false, error: "Entre em uma sala primeiro." });
    const task = String(payload?.task || "");
    const rewards = { garden: 20, tidy: 15, cook: 25 };
    if (!Object.prototype.hasOwnProperty.call(rewards, task)) {
      return reply({ ok: false, error: "Tarefa inválida." });
    }
    player.money += rewards[task];
    player.taskCount += 1;
    broadcastRoom(code);
    reply({ ok: true, money: player.money, taskCount: player.taskCount, reward: rewards[task] });
  });

  socket.on("place-item", (payload, reply = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    const player = room?.players.get(socket.id);
    if (!player) return reply({ ok: false, error: "Entre em uma sala primeiro." });

    const itemType = String(payload?.itemType || "");
    const cost = Object.prototype.hasOwnProperty.call(SHOP_ITEMS, itemType) ? SHOP_ITEMS[itemType] : null;
    const x = Number(payload?.x), z = Number(payload?.z);
    if (!cost) return reply({ ok: false, error: "Esse item não está na loja." });
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 12 || Math.abs(z) > 12) {
      return reply({ ok: false, error: "Escolha um lugar dentro do quintal." });
    }
    const overlapsMainHouse = Math.abs(x) < 4.5 && Math.abs(z) < 3.5;
    const overlapsLeftWing = room.houseLevel >= 1 && x > -7 && x < -3.4 && Math.abs(z) < 2.3;
    const overlapsRightWing = room.houseLevel >= 2 && x > 3.4 && x < 7 && Math.abs(z) < 2.3;
    const overlapsRearWing = room.houseLevel >= 3 && Math.abs(x) < 3.6 && z > -5.9 && z < -2.2;
    if (overlapsMainHouse || overlapsLeftWing || overlapsRightWing || overlapsRearWing) {
      return reply({ ok: false, error: "Deixe um espacinho livre ao redor da casa." });
    }
    if (room.items.length >= MAX_DECORATIONS) {
      return reply({ ok: false, error: "O quintal já está cheio de decorações." });
    }
    if (player.money < cost) return reply({ ok: false, error: "Você ainda não tem moedas suficientes." });
    if (room.items.some(item => Math.hypot(item.x - x, item.z - z) < 1.1)) {
      return reply({ ok: false, error: "Esse lugar está muito perto de outra decoração." });
    }

    player.money -= cost;
    room.items.push({
      id: crypto.randomUUID(),
      type: itemType,
      x,
      z,
      rotation: Number.isFinite(Number(payload.rotation)) ? Number(payload.rotation) : 0
    });
    broadcastRoom(code);
    reply({ ok: true, money: player.money });
  });

  socket.on("upgrade-house", (reply = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    const player = room?.players.get(socket.id);
    if (!player) return reply({ ok: false, error: "Entre em uma sala primeiro." });
    if (room.houseLevel >= MAX_HOUSE_LEVEL) {
      return reply({ ok: false, error: "A casa já está no maior tamanho por enquanto." });
    }
    if (player.money < HOUSE_UPGRADE_COST) {
      return reply({ ok: false, error: "Você ainda não tem moedas suficientes." });
    }

    player.money -= HOUSE_UPGRADE_COST;
    room.houseLevel += 1;
    broadcastRoom(code);
    reply({ ok: true, money: player.money, houseLevel: room.houseLevel });
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    room.players.delete(socket.id);
    socket.to(code).emit("player-left");
    if (room.players.size === 0) rooms.delete(code);
    else broadcastRoom(code);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`DuoVerse rodando na porta ${PORT}`);
});