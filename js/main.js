/*================================================================
   MAIN.JS – “Hungry Reds” (single‑file version)
   --------------------------------------------------------------
   FIXED:
   • Robust sprite‑sheet rectangle calculation – always returns a
     single cell even when the JSON descriptor is missing keys.
   • No more runtime error that stopped the whole game.
================================================================*/

/* --------------------------------------------------------------
   IMPORTS – Firebase CDN
-------------------------------------------------------------- */
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";

import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp
} from
  "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

/* --------------------------------------------------------------
   FIREBASE SETUP
-------------------------------------------------------------- */
const app   = initializeApp(firebaseConfig);
const db    = getFirestore(app);
const scoresCol = collection(db, "survivalScores");

/* --------------------------------------------------------------
   CANVAS & CONTEXT
-------------------------------------------------------------- */
const canvas = document.getElementById("game");
const ctx    = canvas.getContext("2d");

/* --------------------------------------------------------------
   SPRITE‑SHEET LOADER & FRAME HELPER
-------------------------------------------------------------- */
const spriteSheet = new Image();   // whole PNG
let sheetInfo = null;              // JSON descriptor (columns, cell size …)

/**
 * Load the PNG and its JSON description.
 * Call once (we do it at page load).
 */
async function loadSpriteSheet() {
  // 1️⃣ PNG
  spriteSheet.src = "assets/sprites/chars.png";

  // 2️⃣ JSON descriptor
  const resp = await fetch("assets/sprites/chars.json");
  sheetInfo = await resp.json();

  // 3️⃣ Wait for image to finish loading
  await new Promise((resolve, reject) => {
    spriteSheet.onload  = resolve;
    spriteSheet.onerror = reject;
  });

  // 4️⃣ Keep the canvas pixel‑perfect (no smoothing)
  ctx.imageSmoothingEnabled = false;
}

/**
 * Return the source rectangle for a given character + frame.
 *
 * @param {"king"|"player"|"monster"|"virus"} name
 * @param {number} frameIdx – zero‑based column (0 … columns‑1)
 * @returns {{sx:number, sy:number, w:number, h:number}}
 */
function getFrameRect(name, frameIdx = 0) {
  if (!sheetInfo) throw new Error("Sprite sheet not loaded yet");

  /* -------------------------------------------------------------
     Determine the cell size.
     The JSON may provide any of the following keys – we support
     them all and fall back to a safe 64 px square when nothing is
     found.
  ------------------------------------------------------------- */
  const cellW =
    sheetInfo.frameWidth ??
    sheetInfo.manualCellWidth ??
    sheetInfo.cellWidth ??
    sheetInfo.width ??
    64;                               // <- safe fallback

  const cellH =
    sheetInfo.frameHeight ??
    sheetInfo.manualCellHeight ??
    sheetInfo.cellHeight ??
    sheetInfo.height ??
    64;                               // <- safe fallback

  // -------------------------------------------------------------
  // Columns – use the JSON value if present; otherwise infer from
  // the image dimensions (only after the image has loaded).
  // -------------------------------------------------------------
  const columns = (function () {
    if (Number.isFinite(sheetInfo.columns) && sheetInfo.columns > 0) {
      return sheetInfo.columns;
    }
    // spriteSheet.width is now known because loadSpriteSheet() awaited onload
    const inferred = Math.floor(spriteSheet.width / cellW);
    return inferred > 0 ? inferred : 1;
  })();

  // -------------------------------------------------------------
  // Row mapping – the sheet order is fixed.
  // -------------------------------------------------------------
  const rowMap = {
    king:    0,
    player:  1,
    monster: 2,
    virus:   3
  };
  const row = rowMap[name];
  if (row === undefined) throw new Error(`Unknown sprite name "${name}"`);

  // Wrap column index safely.
  const col = ((frameIdx % columns) + columns) % columns;

  return {
    sx: col * cellW,
    sy: row * cellH,
    w : cellW,
    h : cellH
  };
}

/**
 * Draw a sprite frame.
 *
 * @param {string} name        – character name
 * @param {number} frameIdx    – zero‑based column
 * @param {number} dx, dy      – destination on canvas
 * @param {number} [dw],[dh]   – optional draw size (defaults to cell size)
 */
function drawSprite(name, frameIdx, dx, dy, dw = null, dh = null) {
  const src = getFrameRect(name, frameIdx);
  dw ??= src.w;
  dh ??= src.h;
  ctx.drawImage(
    spriteSheet,
    src.sx, src.sy, src.w, src.h,
    dx, dy, dw, dh
  );
}

/* --------------------------------------------------------------
   GAME STATE & GLOBALS
-------------------------------------------------------------- */
let player;                // will hold animation data as well
let enemies = [];          // each enemy gets its own anim data
let killEffects = [];

let kills = 0;
let lastSpawn = 0;
let lastTime = 0;

let running = false;
let gamePaused = false;
let pageHidden = false;

let anim = null;          // requestAnimationFrame handle
let playerName = "";
let dlgBtn = null;

/* --------------------------------------------------------------
   BUILDING UNLOCK STATE
-------------------------------------------------------------- */
let buildingCAdded = false;
let buildingDAdded = false;

/* --------------------------------------------------------------
   PLAYER HEALTH SETTINGS
-------------------------------------------------------------- */
const MAX_HEALTH   = 3;
const INVULN_TIME = 800;

let playerHealth = MAX_HEALTH;
let showHealthBar = false;
let playerInvuln = 0;

/* --------------------------------------------------------------
   ENEMY SETTINGS
-------------------------------------------------------------- */
const NORMAL_ENEMY_SPAWN_INTERVAL = 1200;
const GERM_ENEMY_SPAWN_INTERVAL   = 1500;

const NORMAL_ENEMY_SIZE  = 64;    // all sprites draw at the cell size
const NORMAL_ENEMY_SPEED = 1.6;

const GERM_START_SIZE   = 64;
const GERM_MAX_SIZE     = 90;
const GERM_START_SPEED  = 1.35;
const GERM_START_HEALTH = 2;

/* --------------------------------------------------------------
   JOYSTICK
-------------------------------------------------------------- */
let joystick = {
  active: false,
  baseX: 0,
  baseY: 0,
  dx: 0,
  dy: 0,
  max: 60
};

/* --------------------------------------------------------------
   KING NPC (static portrait, optional dialogue)
-------------------------------------------------------------- */
const king = {
  x: 0,
  y: 0,
  w: 64,
  h: 64,

  dialogueLines: [
    "Your deeds have echoed across the realm.",
    "Take this gift and continue your quest.",
    "This castle will remain open for you.",
    "Come back whenever you need to recharge.",
    "If you disappoint, your journey shall start again."
  ],

  currentLine: 0,
  active: false,
  placed: false,
  talked: false
};

/* --------------------------------------------------------------
   FIREBASE: RECORD PLAY SESSION
-------------------------------------------------------------- */
async function recordPlaySession(name, score) {
  try {
    await addDoc(scoresCol, {
      name,
      score,
      playedAt: serverTimestamp()
    });
  } catch (e) {
    console.warn("Failed to write play session:", e);
  }
}

/* --------------------------------------------------------------
   FIREBASE: FETCH TOP‑3
-------------------------------------------------------------- */
async function fetchTop3() {
  try {
    const q = query(scoresCol, orderBy("score", "desc"), limit(3));
    const snapshot = await getDocs(q);
    const list = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      list.push({ name: d.name, score: d.score });
    });
    return list;
  } catch (e) {
    console.warn("Failed to fetch leaderboard:", e);
    return [];
  }
}

/* --------------------------------------------------------------
   FIREBASE: UPDATE LEADERBOARD UI
-------------------------------------------------------------- */
async function refreshLeaderboard() {
  const top = await fetchTop3();
  const leaderboard = document.getElementById("topList");
  if (!leaderboard) return;
  leaderboard.innerHTML = "";
  top.forEach(entry => {
    const li = document.createElement("li");
    li.textContent = `${entry.name}: ${entry.score}`;
    leaderboard.appendChild(li);
  });
}

/* --------------------------------------------------------------
   PLAYER NAME (local storage)
-------------------------------------------------------------- */
function askForName() {
  const stored = localStorage.getItem("survivalPlayerName");
  if (stored) {
    playerName = stored;
  } else {
    let entered = "";
    while (!entered.trim()) {
      entered = prompt(
        "Enter your name. It will appear on the global leaderboard."
      ) || "";
    }
    playerName = entered.trim();
    localStorage.setItem("survivalPlayerName", playerName);
  }
  const el = document.getElementById("playerName");
  if (el) el.textContent = playerName;
}

/* --------------------------------------------------------------
   COLLISION HELPER – AABB test
-------------------------------------------------------------- */
function rectanglesTouch(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/* --------------------------------------------------------------
   RANDOM EDGE SPAWN POSITION
-------------------------------------------------------------- */
function getEdgeSpawnPosition(size) {
  const side = Math.floor(Math.random() * 4);
  let x = 0, y = 0;
  if (side === 0) {                     // top
    x = Math.random() * Math.max(1, canvas.width - size);
    y = -size;
  }
  if (side === 1) {                     // right
    x = canvas.width + size;
    y = Math.random() * Math.max(1, canvas.height - size);
  }
  if (side === 2) {                     // bottom
    x = Math.random() * Math.max(1, canvas.width - size);
    y = canvas.height + size;
  }
  if (side === 3) {                     // left
    x = -size;
    y = Math.random() * Math.max(1, canvas.height - size);
  }
  return { x, y };
}

/* --------------------------------------------------------------
   SPAWN NORMAL ENEMY (monster sprite)
-------------------------------------------------------------- */
function spawnEnemy() {
  const pos = getEdgeSpawnPosition(NORMAL_ENEMY_SIZE);
  enemies.push({
    type: "normal",
    x: pos.x,
    y: pos.y,
    w: NORMAL_ENEMY_SIZE,
    h: NORMAL_ENEMY_SIZE,
    s: NORMAL_ENEMY_SPEED,

    // ---- animation data ---------------------------------------------
    animTimer: 0,
    animFrame: 0,
    animFps: 6,
    animFrames: sheetInfo ? (sheetInfo.columns ?? 1) : 4
  });
}

/* --------------------------------------------------------------
   SPAWN GERM ENEMY (virus sprite)
-------------------------------------------------------------- */
function spawnGermEnemy() {
  const pos = getEdgeSpawnPosition(GERM_START_SIZE);
  enemies.push({
    type: "germ",
    x: pos.x,
    y: pos.y,
    w: GERM_START_SIZE,
    h: GERM_START_SIZE,
    s: GERM_START_SPEED,

    health: GERM_START_HEALTH,
    maxSize: GERM_MAX_SIZE,

    // ---- animation data ---------------------------------------------
    animTimer: 0,
    animFrame: 0,
    animFps: 8,
    animFrames: sheetInfo ? (sheetInfo.columns ?? 1) : 4
  });
}

/* --------------------------------------------------------------
   ROOM DEFINITIONS
-------------------------------------------------------------- */
const rooms = {
  world: {
    name: "World",
    bg: "#4caf50",
    doors: [
      { id: "buildingA", x: 30, y: 540, w: 80, h: 80, target: "buildingA", emoji: "🏠" },
      { id: "buildingB", x: 380, y: 20, w: 80, h: 80, target: "buildingB", emoji: "🏢" }
    ],
    spawnEnemy() {}
  },

  buildingA: {
    name: "Building A",
    bg: "#8b4513",
    doors: [{ x: 200, y: 660, w: 80, h: 80, target: "world", emoji: "🚪" }],
    spawnEnemy() {},
    decor: [
      { x: 150, y: 300, emoji: "🪑" },
      { x: 230, y: 300, emoji: "🪑" },
      { x: 190, y: 460, emoji: "🛏️" }
    ]
  },

  buildingB: {
    name: "Building B",
    bg: "#3b5998",
    doors: [
      {
        x: 200,
        y: 20,
        w: 80,
        h: 80,
        target: "world",
        emoji: "🚪",
        lockedEmoji: "🔒",
        requiredKills: 10,
        showLock: true
      }
    ],
    spawnEnemy() { spawnEnemy(); }
  },

  buildingC: {
    name: "Building C",
    bg: "#d1e8f0",
    doors: [{ x: 200, y: 660, w: 80, h: 80, target: "world", emoji: "🚪" }],
    spawnEnemy() {}
  },

  buildingD: {
    name: "Building D",
    bg: "#403050",
    doors: [{ x: 200, y: 660, w: 80, h: 80, target: "world", emoji: "🚪" }],
    spawnEnemy() { spawnGermEnemy(); }
  }
};

let currentRoom = rooms.world;

/* --------------------------------------------------------------
   RESET WORLD BUILDINGS (remove dynamic doors)
-------------------------------------------------------------- */
function resetWorldBuildings() {
  rooms.world.doors = rooms.world.doors.filter(
    d => d.id !== "buildingC" && d.id !== "buildingD"
  );
  buildingCAdded = false;
  buildingDAdded = false;
}

/* --------------------------------------------------------------
   FULL GAME RESET (called on new game / retry)
-------------------------------------------------------------- */
function reset() {
  resetWorldBuildings();
  currentRoom = rooms.world;

  // ---------- PLAYER ----------
  player = {
    x: 220,
    y: 330,
    w: 64,
    h: 64,
    speed: 4.5,
    flashTimer: 0,

    // animation
    animTimer: 0,
    animFrame: 0,
    animFps: 8,
    animFrames: sheetInfo ? (sheetInfo.columns ?? 1) : 4
  };

  // ---------- ENEMIES ----------
  enemies = [];
  killEffects = [];

  // ---------- SCORE & HEALTH ----------
  kills = 0;
  playerHealth = MAX_HEALTH;
  showHealthBar = false;
  playerInvuln = 0;

  // ---------- TIMERS ----------
  lastSpawn = 0;
  lastTime = 0;

  // ---------- STATE ----------
  running = false;
  gamePaused = false;
  pageHidden = document.hidden;

  // ---------- JOYSTICK ----------
  joystick.active = false;
  joystick.dx = 0;
  joystick.dy = 0;

  // ---------- KING ----------
  king.currentLine = 0;
  king.active = false;
  king.placed = false;
  king.talked = false;

  const dlgBox = document.getElementById("dialogueBox");
  if (dlgBox) dlgBox.style.display = "none";

  const scoreEl = document.getElementById("score");
  if (scoreEl) scoreEl.textContent = "0";
}

/* --------------------------------------------------------------
   PLAYER UPDATE (movement + animation)
-------------------------------------------------------------- */
function updatePlayer(delta) {
  if (joystick.active) {
    const mag = Math.hypot(joystick.dx, joystick.dy);
    if (mag > 2) {
      player.x += (joystick.dx / mag) * player.speed;
      player.y += (joystick.dy / mag) * player.speed;

      // walk animation while moving
      player.animTimer += delta;
      const frameDur = 1000 / player.animFps;
      if (player.animTimer >= frameDur) {
        player.animTimer -= frameDur;
        player.animFrame = (player.animFrame + 1) % player.animFrames;
      }
    } else {
      player.animFrame = 0;
      player.animTimer = 0;
    }
  }

  // keep inside canvas
  player.x = Math.max(0, Math.min(canvas.width - player.w, player.x));
  player.y = Math.max(0, Math.min(canvas.height - player.h, player.y));
}

/* --------------------------------------------------------------
   ENEMIES UPDATE (chase + animation)
-------------------------------------------------------------- */
function updateEnemies(delta) {
  enemies.forEach(enemy => {
    const ecx = enemy.x + enemy.w / 2;
    const ecy = enemy.y + enemy.h / 2;
    const pcx = player.x + player.w / 2;
    const pcy = player.y + player.h / 2;
    const dx = pcx - ecx;
    const dy = pcy - ecy;
    const dist = Math.hypot(dx, dy) || 1;
    enemy.x += (dx / dist) * enemy.s;
    enemy.y += (dy / dist) * enemy.s;

    // animation tick
    enemy.animTimer += delta;
    const frameDur = 1000 / enemy.animFps;
    if (enemy.animTimer >= frameDur) {
      enemy.animTimer -= frameDur;
      enemy.animFrame = (enemy.animFrame + 1) % enemy.animFrames;
    }
  });
}

/* --------------------------------------------------------------
   CREATE / UPDATE / DRAW KILL‑EFFECTS (visual ✖️)
-------------------------------------------------------------- */
function createEffect(x, y, emoji, duration = 250) {
  killEffects.push({ x, y, emoji, ttl: duration, maxTtl: duration });
}
function updateKillEffects(delta) {
  for (let i = killEffects.length - 1; i >= 0; i--) {
    const e = killEffects[i];
    e.ttl -= delta;
    if (e.ttl <= 0) killEffects.splice(i, 1);
  }
}
function drawKillEffects() {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "32px Arial";
  killEffects.forEach(e => {
    ctx.globalAlpha = Math.max(0, e.ttl / e.maxTtl);
    ctx.fillText(e.emoji || "⚔️", e.x, e.y);
  });
  ctx.restore();
}

/* --------------------------------------------------------------
   ENEMY‑ENEMY COLLISIONS (kill‑swap logic)
-------------------------------------------------------------- */
function handleEnemyCollisions() {
  const toRemove = new Set();

  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const a = enemies[i];
      const b = enemies[j];
      if (!rectanglesTouch(a, b)) continue;

      // normal‑normal → both die
      if (a.type === "normal" && b.type === "normal") {
        const midX = (a.x + b.x) / 2 + a.w / 2;
        const midY = (a.y + b.y) / 2 + a.h / 2;
        toRemove.add(i);
        toRemove.add(j);
        kills++;
        createEffect(midX, midY, "⚔️", 250);
        continue;
      }

      // germ‑germ (absorption)
      if (a.type === "germ" && b.type === "germ") {
        let absorber, absorbed, absorbedIdx;
        if (a.w >= b.w) {
          absorber = a; absorbed = b; absorbedIdx = j;
        } else {
          absorber = b; absorbed = a; absorbedIdx = i;
        }

        const centerX = absorber.x + absorber.w / 2;
        const centerY = absorber.y + absorber.h / 2;
        const growth = Math.max(5, absorbed.w * 0.28);
        const newSize = Math.min(absorber.maxSize, absorber.w + growth);
        absorber.w = newSize;
        absorber.h = newSize;
        absorber.x = centerX - newSize / 2;
        absorber.y = centerY - newSize / 2;

        if (absorber.h === absorber.maxSize) {
          const deathX = absorber.x + absorber.w / 2;
          const deathY = absorber.y + absorber.h / 2;
          enemies.splice(i, 1);
          kills += 100;
          createEffect(deathX, deathY, "☠️", 350);
        } else {
          absorber.health += Math.max(1, Math.ceil(absorbed.health * 0.5));
        }

        absorber.s = Math.max(
          0.65,
          GERM_START_SPEED - (newSize - GERM_START_SIZE) * 0.009
        );
        toRemove.add(absorbedIdx);
        createEffect(absorber.x + absorber.w / 2, absorber.y + absorber.h / 2, "🧬", 300);
        continue;
      }
    }
  }

  enemies = enemies.filter((_, i) => !toRemove.has(i));
}

/* --------------------------------------------------------------
   DRAW HEALTH BAR (shown after king dialogue)
-------------------------------------------------------------- */
function drawHealthBar() {
  if (!showHealthBar) return;
  const barW = 200,
        barH = 20;
  const x = (canvas.width - barW) / 2;
  const y = 12;
  const healthPct = Math.max(0, playerHealth / MAX_HEALTH);

  ctx.save();
  ctx.fillStyle = "#555";
  ctx.fillRect(x, y, barW, barH);
  ctx.fillStyle = "#0f0";
  ctx.fillRect(x, y, barW * healthPct, barH);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, barW, barH);
  ctx.font = "14px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText(`${Math.max(0, playerHealth)} / ${MAX_HEALTH}`, canvas.width / 2, y + barH / 2);
  ctx.restore();
}

/* --------------------------------------------------------------
   PUSH GERM AWAY FROM PLAYER (on hit)
-------------------------------------------------------------- */
function pushGermAwayFromPlayer(germ) {
  const pcx = player.x + player.w / 2;
  const pcy = player.y + player.h / 2;
  const gcx = germ.x + germ.w / 2;
  const gcy = germ.y + germ.h / 2;
  let dx = gcx - pcx;
  let dy = gcy - pcy;
  let d = Math.hypot(dx, dy);
  if (d === 0) {
    dx = Math.random() - 0.5;
    dy = Math.random() - 0.5;
    d = Math.hypot(dx, dy) || 1;
  }
  germ.x += (dx / d) * 30;
  germ.y += (dy / d) * 30;
}

/* --------------------------------------------------------------
   DAMAGE PLAYER & GERM COLLISIONS
-------------------------------------------------------------- */
function damagePlayer(delta) {
  if (!showHealthBar) return;

  if (playerInvuln > 0) {
    playerInvuln = Math.max(0, playerInvuln - delta);
    return;
  }

  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    if (!rectanglesTouch(player, enemy)) continue;

    // player hit
    playerHealth--;
    playerInvuln   = INVULN_TIME;
    player.flashTimer = INVULN_TIME;

    // extra logic if the enemy is a germ
    if (enemy.type === "germ") {
      enemy.health--;
      createEffect(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, "💥", 220);
      if (enemy.health <= 0) {
        const deathX = enemy.x + enemy.w / 2;
        const deathY = enemy.y + enemy.h / 2;
        enemies.splice(i, 1);
        kills += 10;
        createEffect(deathX, deathY, "☠️", 350);
      } else {
        pushGermAwayFromPlayer(enemy);
      }
    }

    // only one enemy damages the player per invulnerability period
    break;
  }
}

/* --------------------------------------------------------------
   INSTANT‑DEATH COLLISION (used before health bar appears)
-------------------------------------------------------------- */
function collide() {
  return enemies.some(e => rectanglesTouch(player, e));
}

/* --------------------------------------------------------------
   BUILDING UNLOCK LOGIC
-------------------------------------------------------------- */
function maybeAddBuildingC() {
  if (buildingCAdded) return;
  if (kills < 10) return;
  rooms.world.doors.push({
    id: "buildingC",
    x: 200, y: 140, w: 80, h: 80,
    target: "buildingC",
    emoji: "🏰"
  });
  buildingCAdded = true;
}
function maybeAddBuildingD() {
  if (buildingDAdded) return;
  if (!showHealthBar) return;
  rooms.world.doors.push({
    id: "buildingD",
    x: 350, y: 300, w: 80, h: 80,
    target: "buildingD",
    emoji: "🏥"
  });
  buildingDAdded = true;
}

/* --------------------------------------------------------------
   PLACE KING (once when entering building C)
-------------------------------------------------------------- */
function maybePlaceKing() {
  if (king.placed) return;
  king.x = canvas.width / 2 - king.w / 2;
  king.y = canvas.height / 2 - king.h / 2 - 250;
  king.placed = true;
}

/* --------------------------------------------------------------
   CHANGE ROOM (door entry)
-------------------------------------------------------------- */
function enterRoom(targetRoomName) {
  const targetRoom = rooms[targetRoomName];
  if (!targetRoom) return;

  currentRoom = targetRoom;
  enemies = [];
  lastSpawn = 0;

  player.x = canvas.width / 2 - player.w / 2;
  player.y = canvas.height / 2 - player.h / 2;

  joystick.active = false;
  joystick.dx = 0;
  joystick.dy = 0;

  if (currentRoom === rooms.buildingC) maybePlaceKing();
  if (currentRoom === rooms.world) {
    king.talked = false;
    maybeAddBuildingC();
    maybeAddBuildingD();
  }
}

/* --------------------------------------------------------------
   DOOR COLLISION CHECK
-------------------------------------------------------------- */
function checkDoorCollision() {
  for (const door of currentRoom.doors) {
    const unlocked = !door.requiredKills || kills >= door.requiredKills;
    if (!unlocked) continue;
    if (rectanglesTouch(player, door)) {
      enterRoom(door.target);
      return;
    }
  }
}

/* --------------------------------------------------------------
   SPAWN INTERVAL HELPERS
-------------------------------------------------------------- */
function getCurrentSpawnInterval() {
  return currentRoom === rooms.buildingD ? GERM_ENEMY_SPAWN_INTERVAL
                                        : NORMAL_ENEMY_SPAWN_INTERVAL;
}

/* --------------------------------------------------------------
   DRAW BACKGROUND GRID (debug)
-------------------------------------------------------------- */
function drawGrid() {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  ctx.restore();
}

/* --------------------------------------------------------------
   DRAW DOORS (still using emoji – replace later if you add sprites)
-------------------------------------------------------------- */
function drawDoors() {
  currentRoom.doors.forEach(door => {
    const unlocked = !door.requiredKills || kills >= door.requiredKills;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (unlocked) {
      ctx.font = "48px Arial";
      ctx.fillStyle = "#fff";
      ctx.fillText(door.emoji || "🚪", door.x + door.w / 2, door.y + door.h / 2);
    } else {
      ctx.globalAlpha = 0.7;
      ctx.font = "48px Arial";
      ctx.fillText(door.lockedEmoji || "🔒", door.x + door.w / 2, door.y + door.h / 2);
      ctx.globalAlpha = 1;
      if (door.showLock) {
        ctx.font = "20px Arial";
        ctx.fillStyle = "#ffcc00";
        ctx.fillText(String(door.requiredKills), door.x + door.w / 2, door.y + door.h + 14);
      }
    }
    ctx.restore();
  });
}

/* --------------------------------------------------------------
   DRAW DECORATIONS (still emoji)
-------------------------------------------------------------- */
function drawDecor() {
  if (!currentRoom.decor) return;
  ctx.save();
  ctx.font = "36px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  currentRoom.decor.forEach(item => ctx.fillText(item.emoji, item.x, item.y));
  ctx.restore();
}

/* --------------------------------------------------------------
   DRAW PLAYER (sprite)
-------------------------------------------------------------- */
function drawPlayer() {
  ctx.save();
  if (player.flashTimer > 0) {
    const flashing = Math.floor(player.flashTimer / 100) % 2 === 0;
    ctx.globalAlpha = flashing ? 0.35 : 1;
  }

  drawSprite(
    "player",
    player.animFrame,
    player.x,
    player.y,
    player.w,
    player.h
  );
  ctx.restore();
}

/* --------------------------------------------------------------
   DRAW KING (static portrait)
-------------------------------------------------------------- */
function drawKing() {
  if (currentRoom !== rooms.buildingC) return;
  ctx.save();
  drawSprite("king", 0, king.x, king.y, king.w, king.h);
  ctx.restore();
}

/* --------------------------------------------------------------
   DRAW ENEMIES (monster or virus sprite + health bar for germs)
-------------------------------------------------------------- */
function drawEnemies() {
  enemies.forEach(enemy => {
    ctx.save();
    const spriteName = enemy.type === "germ" ? "virus" : "monster";
    drawSprite(spriteName, enemy.animFrame, enemy.x, enemy.y, enemy.w, enemy.h);

    // health bar for germs
    if (enemy.type === "germ") {
      const barW = Math.max(24, Math.min(enemy.w, 70));
      const maxHealth = Math.max(GERM_START_HEALTH, enemy.health);
      const ratio = Math.min(1, enemy.health / maxHealth);
      const barX = enemy.x + enemy.w / 2 - barW / 2;
      const barY = enemy.y - 8;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(barX, barY, barW, 5);
      ctx.fillStyle = "#aaff55";
      ctx.fillRect(barX, barY, barW * ratio, 5);
    }
    ctx.restore();
  });
}

/* --------------------------------------------------------------
   DRAW JOYSTICK (visual aid)
-------------------------------------------------------------- */
function drawJoystick() {
  if (!joystick.active) return;
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 3;
  ctx.arc(joystick.baseX, joystick.baseY, 40, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.arc(
    joystick.baseX + joystick.dx,
    joystick.baseY + joystick.dy,
    20,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.restore();
}

/* --------------------------------------------------------------
   DRAW ROOM NAME (debug)
-------------------------------------------------------------- */
function drawRoomName() {
  ctx.save();
  ctx.font = "18px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText(currentRoom.name, 12, 42);
  ctx.restore();
}

/* --------------------------------------------------------------
   DRAW EVERYTHING (order matters)
-------------------------------------------------------------- */
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = currentRoom.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawGrid();
  drawDoors();
  drawDecor();
  drawKing();
  drawEnemies();
  drawPlayer();
  drawJoystick();
  drawKillEffects();
  drawRoomName();
  drawHealthBar();
}

/* --------------------------------------------------------------
   KING DIALOGUE (opens UI, pauses game)
-------------------------------------------------------------- */
function startKingDialogue() {
  const dlgBox  = document.getElementById("dialogueBox");
  const line    = document.getElementById("dialogueLine");
  if (!dlgBox || !line || !dlgBtn) return;

  king.currentLine = 0;
  king.active = true;
  king.talked = true;

  line.textContent = king.dialogueLines[0];
  dlgBox.style.display = "flex";
  dlgBtn.textContent = "Next";

  gamePaused = true;
  joystick.active = false;
  joystick.dx = 0;
  joystick.dy = 0;
}

/* --------------------------------------------------------------
   ADVANCE KING DIALOGUE (called by the button)
-------------------------------------------------------------- */
function advanceKingDialogue() {
  if (!king.active) return;
  king.currentLine++;

  const dlgBox = document.getElementById("dialogueBox");
  const line   = document.getElementById("dialogueLine");
  if (king.currentLine >= king.dialogueLines.length) {
    dlgBox.style.display = "none";
    gamePaused = false;
    king.active = false;
    dlgBtn.textContent = "Next";

    showHealthBar = true;
    playerHealth = MAX_HEALTH;
    playerInvuln = 0;

    maybeAddBuildingD();

    lastTime = performance.now();
    return;
  }

  line.textContent = king.dialogueLines[king.currentLine];
  dlgBtn.textContent = (king.currentLine === king.dialogueLines.length - 1) ? "Close" : "Next";
}

/* --------------------------------------------------------------
   CHECK KING PROXIMITY (opens dialogue automatically)
-------------------------------------------------------------- */
function checkKingProximity() {
  if (currentRoom !== rooms.buildingC) return;
  if (king.active) return;

  const kcx = king.x + king.w / 2;
  const kcy = king.y + king.h / 2;
  const pcx = player.x + player.w / 2;
  const pcy = player.y + player.h / 2;
  const dist = Math.hypot(kcx - pcx, kcy - pcy);
  const talkRange = 80;

  if (dist < talkRange && !king.talked) {
    startKingDialogue();
  }
  if (dist >= talkRange) king.talked = false;
}

/* --------------------------------------------------------------
   END GAME (show overlay)
-------------------------------------------------------------- */
function endGame(message) {
  running = false;
  if (anim !== null) { cancelAnimationFrame(anim); anim = null; }

  joystick.active = false;
  joystick.dx = 0;
  joystick.dy = 0;

  const finalEl = document.getElementById("final");
  const overlay = document.getElementById("overlay");
  if (finalEl) finalEl.innerHTML = message;
  if (overlay) overlay.style.display = "flex";
}

/* --------------------------------------------------------------
   PROCESS GAME OVER (record & leaderboard)
-------------------------------------------------------------- */
function processGameOver() {
  const finalScore = kills;
  endGame(`You scored ${finalScore}.<br>Hint: You need certain points to proceed in the game.`);
  recordPlaySession(playerName, finalScore);
  refreshLeaderboard();
}

/* --------------------------------------------------------------
   MAIN GAME LOOP (requestAnimationFrame)
-------------------------------------------------------------- */
function loop(timestamp) {
  if (!running) return;

  // frozen while dialogue UI is open or page is hidden
  if (gamePaused || pageHidden) {
    lastTime = timestamp;
    anim = requestAnimationFrame(loop);
    return;
  }

  if (!lastTime) lastTime = timestamp;
  const delta = Math.min(timestamp - lastTime, 50);
  lastTime = timestamp;

  // flash‑timer decay
  if (player.flashTimer > 0) player.flashTimer = Math.max(0, player.flashTimer - delta);

  // UI score update
  const scoreEl = document.getElementById("score");
  if (scoreEl) scoreEl.textContent = String(kills);

  // 1️⃣ UNLOCKS
  maybeAddBuildingC();
  maybeAddBuildingD();

  // 2️⃣ SPAWN ENEMIES
  if (timestamp - lastSpawn > getCurrentSpawnInterval()) {
    currentRoom.spawnEnemy();
    lastSpawn = timestamp;
  }

  // 3️⃣ UPDATE LOGIC
  updatePlayer(delta);
  updateEnemies(delta);
  handleEnemyCollisions();
  updateKillEffects(delta);
  checkDoorCollision();

  // 4️⃣ DAMAGE / DEATH
  if (showHealthBar) {
    damagePlayer(delta);
  } else if (collide()) {
    processGameOver();
    return;
  }

  // 5️⃣ KING PROXIMITY
  checkKingProximity();

  // 6️⃣ END‑OF‑GAME (health reaches 0)
  if (showHealthBar && playerHealth <= 0) {
    processGameOver();
    return;
  }

  // 7️⃣ DRAW
  draw();

  anim = requestAnimationFrame(loop);
}

/* --------------------------------------------------------------
   START / RESTART GAME
-------------------------------------------------------------- */
function startGame() {
  if (!playerName) askForName();

  const overlay = document.getElementById("overlay");
  if (overlay) overlay.style.display = "none";

  if (anim !== null) { cancelAnimationFrame(anim); anim = null; }

  reset();
  running = true;

  lastTime = performance.now();
  lastSpawn = lastTime;

  draw();                     // immediate first frame
  anim = requestAnimationFrame(loop);
}

/* --------------------------------------------------------------
   POINTER POSITION (helper for joystick)
-------------------------------------------------------------- */
function getPointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width  / rect.width,
    y: (event.clientY - rect.top)  * canvas.height / rect.height
  };
}

/* --------------------------------------------------------------
   JOYSTICK – POINTER HANDLERS
-------------------------------------------------------------- */
canvas.addEventListener("pointerdown", e => {
  if (!running || gamePaused || pageHidden) return;
  e.preventDefault();
  const pos = getPointerPosition(e);
  joystick.active = true;
  joystick.baseX = pos.x;
  joystick.baseY = pos.y;
  joystick.dx = 0;
  joystick.dy = 0;
  if (canvas.setPointerCapture) {
    try { canvas.setPointerCapture(e.pointerId); }
    catch (err) { console.warn("setPointerCapture failed:", err); }
  }
});

canvas.addEventListener("pointermove", e => {
  if (!joystick.active) return;
  e.preventDefault();
  const pos = getPointerPosition(e);
  let dx = pos.x - joystick.baseX;
  let dy = pos.y - joystick.baseY;
  const d = Math.hypot(dx, dy);
  if (d > joystick.max) {
    dx = (dx / d) * joystick.max;
    dy = (dy / d) * joystick.max;
  }
  joystick.dx = dx;
  joystick.dy = dy;
});

function stopJoystick(e) {
  if (e) e.preventDefault();
  joystick.active = false;
  joystick.dx = 0;
  joystick.dy = 0;
}
canvas.addEventListener("pointerup",      stopJoystick);
canvas.addEventListener("pointercancel", stopJoystick);
canvas.addEventListener("pointerleave", e => {
  if (e.buttons === 0 || e.pointerType === "mouse") stopJoystick(e);
});

/* --------------------------------------------------------------
   PAGE VISIBILITY – pause when tab hidden
-------------------------------------------------------------- */
document.addEventListener("visibilitychange", () => {
  pageHidden = document.hidden;
  joystick.active = false;
  joystick.dx = 0;
  joystick.dy = 0;
  if (!pageHidden) {
    lastTime = performance.now();
    lastSpawn = lastTime;
  }
});
window.addEventListener("blur", () => {
  pageHidden = true;
  joystick.active = false;
  joystick.dx = 0;
  joystick.dy = 0;
});
window.addEventListener("focus", () => {
  pageHidden = document.hidden;
  lastTime = performance.now();
  lastSpawn = lastTime;
});

/* --------------------------------------------------------------
   KEEP CANVAS ASPECT RATIO (responsive)
-------------------------------------------------------------- */
function resize() {
  const maxW = Math.min(window.innerWidth, 540);
  canvas.style.width  = `${maxW}px`;
  canvas.style.height = `${maxW * 1170 / 540}px`;
}
window.addEventListener("resize", resize);
resize();

/* --------------------------------------------------------------
   KEYBOARD FALLBACK (E key to advance dialog)
-------------------------------------------------------------- */
window.addEventListener("keydown", e => {
  if ((e.key !== "e" && e.key !== "E")) return;
  const dlgBox = document.getElementById("dialogueBox");
  if (dlgBox && dlgBox.style.display !== "none") advanceKingDialogue();
});

/* --------------------------------------------------------------
   PAGE LOAD – initialise everything
-------------------------------------------------------------- */
window.addEventListener("load", async () => {
  // 1️⃣ Load sprite‑sheet (must happen before any draw)
  await loadSpriteSheet();

  // 2️⃣ Restore stored player name (if any)
  const stored = localStorage.getItem("survivalPlayerName");
  if (stored) {
    playerName = stored;
    const el = document.getElementById("playerName");
    if (el) el.textContent = playerName;
  }

  // 3️⃣ Hide dialogue box and hook its button
  const dlgBox = document.getElementById("dialogueBox");
  if (dlgBox) dlgBox.style.display = "none";

  dlgBtn = document.getElementById("dialogueNext");
  if (dlgBtn) dlgBtn.addEventListener("click", advanceKingDialogue);

  // 4️⃣ Hook retry button
  const retry = document.getElementById("retry");
  if (retry) retry.addEventListener("click", startGame);

  // 5️⃣ Populate leaderboard and start the first game
  await refreshLeaderboard();
  startGame();
});

/* --------------------------------------------------------------
   SERVICE WORKER (optional)
-------------------------------------------------------------- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .catch(e => console.warn("Service worker registration failed:", e));
}

/* --------------------------------------------------------------
   OPTIONAL – expose functions for debugging (e.g. console)
-------------------------------------------------------------- */
window.startGame = startGame;
window.advanceKingDialogue = advanceKingDialogue;
