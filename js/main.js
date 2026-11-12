/*================================================================
   MAIN.JS – “Hungry Reds” (single‑file version – sprite‑sheet fix)
   --------------------------------------------------------------
   This version reads every cell from the JSON (`chars.json`),
   creates an Image for each, and draws the right one per character.
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
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const scoresCol = collection(db, "survivalScores");

/* --------------------------------------------------------------
   CANVAS & CONTEXT
-------------------------------------------------------------- */
const canvas = document.getElementById("game");
const ctx    = canvas.getContext("2d");

/* --------------------------------------------------------------
   SPRITE‑SHEET LOADER – creates a separate Image for each cell
-------------------------------------------------------------- */
let frameImages = [];          // array of Image objects (one per cell)
let sheetInfo   = null;        // whole JSON (we keep it for possible future use)

/**
 * Load the JSON, then turn every `base64` entry into an Image.
 * Returns a promise that resolves when **all** images are ready.
 */
async function loadSpriteSheet() {
  const resp = await fetch("assets/sprites/chars.json");
  sheetInfo = await resp.json();

  const sprites = sheetInfo.layers?.[0]?.sprites ?? [];
  const promises = sprites.map(spr => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = reject;
      img.src = spr.base64;            // data‑URL already in the JSON
    });
  });

  frameImages = await Promise.all(promises);
}

/**
 * Mapping: which frame indices belong to which character.
 * Adjust these arrays if the order of sprites in your JSON differs.
 *
 *   king    → frames 0‑3
 *   player  → frames 4‑7
 *   monster → frames 8‑11
 *   virus   → frames 12‑15
 *
 * (The indices are *zero‑based* positions in the `frameImages`
 *  array that we built from the JSON.)
 */
const charFrames = {
  king:    [0, 1, 2, 3],
  player:  [4, 5, 6, 7],
  monster: [8, 9, 10, 11],
  virus:   [12, 13, 14, 15]
};

/**
 * Draw a sprite for a character.
 *
 * @param {"king"|"player"|"monster"|"virus"} name
 * @param {number} frameIdx   – zero‑based column (will be wrapped)
 * @param {number} dx, dy      – destination on the canvas
 * @param {number} [dw],[dh]  – optional draw size (defaults to image size)
 */
function drawSprite(name, frameIdx, dx, dy, dw = null, dh = null) {
  const list = charFrames[name];
  if (!list) return;                       // unknown character

  const imgIdx = list[frameIdx % list.length];
  const img    = frameImages[imgIdx];
  if (!img) return;                        // safety

  const w = dw ?? img.width;
  const h = dh ?? img.height;
  ctx.drawImage(img, dx, dy, w, h);
}

/* --------------------------------------------------------------
   GAME STATE & GLOBALS
-------------------------------------------------------------- */
let player;                // will contain animation counters as well
let enemies = [];         // each enemy has its own anim counters
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

const NORMAL_ENEMY_SIZE  = 64;    // we draw everything at the cell size
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
   KING NPC (static portrait, dialogue)
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
   FIREBASE – RECORD PLAY SESSION
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
   FIREBASE – FETCH TOP‑3
-------------------------------------------------------------- */
async function fetchTop3() {
  try {
    const q = query(scoresCol, orderBy("score", "desc"), limit(3));
    const snap = await getDocs(q);
    const list = [];
    snap.forEach(doc => {
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
   FIREBASE – UPDATE LEADERBOARD UI
-------------------------------------------------------------- */
async function refreshLeaderboard() {
  const top = await fetchTop3();
  const ul = document.getElementById("topList");
  if (!ul) return;
  ul.innerHTML = "";
  top.forEach(e => {
    const li = document.createElement("li");
    li.textContent = `${e.name}: ${e.score}`;
    ul.appendChild(li);
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
   AABB COLLISION HELPER
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
  if (side === 0) {            // top
    x = Math.random() * Math.max(1, canvas.width - size);
    y = -size;
  }
  if (side === 1) {            // right
    x = canvas.width + size;
    y = Math.random() * Math.max(1, canvas.height - size);
  }
  if (side === 2) {            // bottom
    x = Math.random() * Math.max(1, canvas.width - size);
    y = canvas.height + size;
  }
  if (side === 3) {            // left
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

    // animation data
    animTimer: 0,
    animFrame: 0,
    animFps: 6,
    animFrames: charFrames.monster.length
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

    // animation data
    animTimer: 0,
    animFrame: 0,
    animFps: 8,
    animFrames: charFrames.virus.length
  });
}

/* --------------------------------------------------------------
   ROOM DEFINITIONS (unchanged)
-------------------------------------------------------------- */
const rooms = {
  world: {
    name: "World",
    bg: "#4caf50",
    doors: [
      { id: "buildingA", x: 30,  y: 540, w: 80, h: 80, target: "buildingA", emoji: "🏠" },
      { id: "buildingB", x: 380, y: 20,  w: 80, h: 80, target: "buildingB", emoji: "🏢" }
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
        x: 200, y: 20, w: 80, h: 80,
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
  rooms.world.doors = rooms.world.doors.filter(d => d.id !== "buildingC" && d.id !== "buildingD");
  buildingCAdded = false;
  buildingDAdded = false;
}

/* --------------------------------------------------------------
   FULL GAME RESET (new round)
-------------------------------------------------------------- */
function reset() {
  resetWorldBuildings();
  currentRoom = rooms.world;

  // ---------- PLAYER ----------
  player = {
    x: 220, y: 330,
    w: 64, h: 64,
    speed: 4.5,
    flashTimer: 0,

    // animation
    animTimer: 0,
    animFrame: 0,
    animFps: 8,
    animFrames: charFrames.player.length
 
