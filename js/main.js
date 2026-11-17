/* ==============================================================
   MAIN.JS – Hungry Reds (tilemap town + enterable buildings + NPCs)
   ============================================================== */

/* --------------------------------------------------------------
   FIREBASE IMPORTS
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
import { loadInteriorSheet, FURNITURE, drawFurn, furnSolids } from "./furniture.js";
import {
  TILE, initWorld, loadTownSheet, drawTile, drawWorldTiles, drawInteriorFloor,
  isSolidTile, createBuildings, bodyRect, doorRect, drawBuilding
} from "./world.js";

/* --------------------------------------------------------------
   FIREBASE SETUP
-------------------------------------------------------------- */
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const scoresCol = collection(db, "survivalScores");

/* --------------------------------------------------------------
   CANVAS
-------------------------------------------------------------- */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

/* --------------------------------------------------------------
   SPRITE ANIMATION TABLE (direction aware)
   assets/sprites/chars.json: 14 rows, 24x24 sprites.
   Every character has 4 directions x 4 walk frames (16 sprites):
   down, up, left, right. The virus has 4 frames and only "down".
-------------------------------------------------------------- */
const spriteAnimations = {
  player: { down: [0, 1, 2, 3],
    up:   [4, 5, 6, 7],
    left: [8, 9, 10, 11],
    right:[12, 13, 14, 15] },
  king: { down: [16, 17, 18, 19],
    up:   [20, 21, 22, 23],
    left: [24, 25, 26, 27],
    right:[28, 29, 30, 31] },
  villagerMan: { down: [32, 33, 34, 35],
    up:   [36, 37, 38, 39],
    left: [40, 41, 42, 43],
    right:[44, 45, 46, 47] },
  villagerWoman: { down: [48, 49, 50, 51],
    up:   [52, 53, 54, 55],
    left: [56, 57, 58, 59],
    right:[60, 61, 62, 63] },
  elder: { down: [64, 65, 66, 67],
    up:   [68, 69, 70, 71],
    left: [72, 73, 74, 75],
    right:[76, 77, 78, 79] },
  kid: { down: [80, 81, 82, 83],
    up:   [84, 85, 86, 87],
    left: [88, 89, 90, 91],
    right:[92, 93, 94, 95] },
  merchant: { down: [96, 97, 98, 99],
    up:   [100, 101, 102, 103],
    left: [104, 105, 106, 107],
    right:[108, 109, 110, 111] },
  guard: { down: [112, 113, 114, 115],
    up:   [116, 117, 118, 119],
    left: [120, 121, 122, 123],
    right:[124, 125, 126, 127] },
  farmer: { down: [128, 129, 130, 131],
    up:   [132, 133, 134, 135],
    left: [136, 137, 138, 139],
    right:[140, 141, 142, 143] },
  doctor: { down: [144, 145, 146, 147],
    up:   [148, 149, 150, 151],
    left: [152, 153, 154, 155],
    right:[156, 157, 158, 159] },
  chef: { down: [160, 161, 162, 163],
    up:   [164, 165, 166, 167],
    left: [168, 169, 170, 171],
    right:[172, 173, 174, 175] },
  wizard: { down: [176, 177, 178, 179],
    up:   [180, 181, 182, 183],
    left: [184, 185, 186, 187],
    right:[188, 189, 190, 191] },
  monster: { down: [192, 193, 194, 195],
    up:   [196, 197, 198, 199],
    left: [200, 201, 202, 203],
    right:[204, 205, 206, 207] },
  virus: { down: [208, 209, 210, 211] }
};

/* --------------------------------------------------------------
   SPRITE LOADING (characters)
-------------------------------------------------------------- */
let sheetInfo = null;
const spriteImages = [];

async function loadSpriteSheet() {
  const response = await fetch("assets/sprites/chars.json", {
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Could not load chars.json – HTTP ${response.status}`);
  sheetInfo = await response.json();

  const sprites = sheetInfo?.layers?.flatMap(l => l.sprites ?? []);
  if (!Array.isArray(sprites) || sprites.length === 0) {
    throw new Error("chars.json does not contain any sprites.");
  }

  await Promise.all(
    sprites.map((spr, i) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { spriteImages[i] = img; resolve(); };
      img.onerror = () => reject(new Error(`Could not load ${spr.name ?? `sprite ${i+1}`}`));
      img.src = spr.base64;
    }))
  );
}

/* --------------------------------------------------------------
   SPRITE HELPERS (direction aware)
-------------------------------------------------------------- */
function getAnimationFrames(name, dir = "down") {
  const entry = spriteAnimations[name];
  if (!entry) { console.warn(`No animation entry for "${name}"`); return [0]; }
  if (Array.isArray(entry)) return entry;
  return entry[dir] || entry["down"];
}
function getAnimationFrameCount(name, dir = "down") {
  return getAnimationFrames(name, dir).length || 1;
}
function getSpriteImage(name, dir, frameIndex = 0) {
  const frames = getAnimationFrames(name, dir);
  if (!frames.length) return null;
  const safe = Number.isFinite(frameIndex) ? Math.floor(frameIndex) : 0;
  const wrapped = ((safe % frames.length) + frames.length) % frames.length;
  const idx = frames[wrapped];
  const img = spriteImages[idx];
  if (!img) { console.warn(`Sprite ${idx+1} for "${name}" not loaded`); return null; }
  return img;
}
function drawSprite(name, dir, frameIdx, dx, dy, dw = 64, dh = 64) {
  const img = getSpriteImage(name, dir, frameIdx);
  if (!img) return;

  const sw = img.naturalWidth  || img.width;
  const sh = img.naturalHeight || img.height;
  if (sw <= 0 || sh <= 0) return;

  const scale = Math.min(dw / sw, dh / sh);
  const drawW = Math.max(1, Math.round(sw * scale));
  const drawH = Math.max(1, Math.round(sh * scale));
  const drawX = Math.round(dx + (dw - drawW) / 2);
  const drawY = Math.round(dy + dh - drawH);

  ctx.drawImage(img, 0, 0, sw, sh, drawX, drawY, drawW, drawH);
}

/* --------------------------------------------------------------
   WORLD (tileset, town map, interior floor, buildings) lives in world.js
-------------------------------------------------------------- */
initWorld(ctx);

let kills = 0;
let showHealthBar = false;

const buildings = createBuildings({
  castleUnlocked:    () => kills >= 5,          // building C (the king)
  germHouseUnlocked: () => showHealthBar        // building D (germs)
});

/* --------------------------------------------------------------
   GAME STATE
-------------------------------------------------------------- */
let player, enemies = [], killEffects = [];
let lastSpawn = 0, lastTime = 0;
let running = false, gamePaused = false, pageHidden = false;
let anim = null, playerName = "", dlgBtn = null;
let debugBoxes = false;

/* --------------------------------------------------------------
   PLAYER HEALTH
-------------------------------------------------------------- */
const MAX_HEALTH = 3, INVULN_TIME = 800;
let playerHealth = MAX_HEALTH, playerInvuln = 0;

/* --------------------------------------------------------------
   ENEMY SETTINGS
-------------------------------------------------------------- */
const NORMAL_ENEMY_SPAWN_INTERVAL = 1200,
      GERM_ENEMY_SPAWN_INTERVAL   = 1500;

const NORMAL_ENEMY_SIZE = 64, NORMAL_ENEMY_SPEED = 1.6;

const GERM_START_SIZE = 64, GERM_MAX_SIZE = 90,
      GERM_START_SPEED = 1.35, GERM_START_HEALTH = 2;

/* --------------------------------------------------------------
   JOYSTICK
-------------------------------------------------------------- */
const joystick = { active:false, baseX:0, baseY:0, dx:0, dy:0, max:60 };

/* --------------------------------------------------------------
   KING (building C)
-------------------------------------------------------------- */
const king = {
  x:0, y:0, w:64, h:64,
  dialogueLines:[
    "Your deeds have echoed across the realm.",
    "Take this gift and continue your quest.",
    "This castle will remain open for you.",
    "Come back whenever you need to recharge.",
    "If you disappoint, your journey shall start again."
  ],
  currentLine:0, active:false, placed:false, talked:false
};

/* Where the king stands (also used to keep the guards away from him) */
function kingHome() {
  return {
    x: canvas.width/2 - king.w/2,
    y: canvas.height/2 - king.h/2 - 250,
    w: king.w, h: king.h
  };
}

/* --------------------------------------------------------------
   FIREBASE HELPERS
-------------------------------------------------------------- */
async function recordPlaySession(name, score) {
  try { await addDoc(scoresCol, { name, score, playedAt: serverTimestamp() }); }
  catch (e) { console.warn("Failed to write play session:", e); }
}
async function fetchTop3() {
  try {
    const q = query(scoresCol, orderBy("score","desc"), limit(3));
    const snap = await getDocs(q);
    return snap.docs.map(d=>d.data());
  } catch (e) { console.warn("Failed to fetch leaderboard:", e); return []; }
}
async function refreshLeaderboard() {
  const top = await fetchTop3();
  const list = document.getElementById("topList");
  if (!list) return;
  list.innerHTML = "";
  top.forEach(p => {
    const li = document.createElement("li");
    li.textContent = `${p.name}: ${p.score}`;
    list.appendChild(li);
  });
}

/* --------------------------------------------------------------
   PLAYER NAME
-------------------------------------------------------------- */
function askForName() {
  const stored = localStorage.getItem("survivalPlayerName");
  if (stored) playerName = stored;
  else {
    let name = "";
    while (!name.trim())
      name = prompt("Enter your name. It will appear on the global leaderboard.") || "";
    playerName = name.trim();
    localStorage.setItem("survivalPlayerName", playerName);
  }
  const el = document.getElementById("playerName");
  if (el) el.textContent = playerName;
}

/* --------------------------------------------------------------
   COLLISION HELPERS
-------------------------------------------------------------- */
function rectanglesTouch(a,b){
  return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
}
function inflate(r, p){
  return { x:r.x - p, y:r.y - p, w:r.w + p*2, h:r.h + p*2 };
}

/* Smaller "feet" box used for walls and doors */
function hitbox() {
  return { x: player.x + 14, y: player.y + 36, w: player.w - 28, h: player.h - 40 };
}

/* Same feet box, for any 64x64 character standing at (x, y) */
function feetAt(x, y) {
  return { x: x + 14, y: y + 36, w: 36, h: 24 };
}

/* Furniture of a room by name, regardless of whether it is currently visible */
function roomFurniture(roomName) {
  return rooms[roomName]?.furniture || [];
}

/* Furniture that is currently visible in the room the player is in */
function activeFurniture() {
  const f = currentRoom.furniture;
  return (f && currentRoom.showFurniture !== false) ? f : [];
}

/* True if the player's feet box is inside a solid tile, a building body (world),
   or a solid piece of furniture (interiors) */
function blockedAt() {
  if (currentRoom !== rooms.world) {
    const fb = hitbox();
    return furnSolids(activeFurniture()).some(r => rectanglesTouch(fb, r));
  }
  const hb = hitbox();

  const c0 = Math.floor(hb.x / TILE), c1 = Math.floor((hb.x + hb.w) / TILE);
  const r0 = Math.floor(hb.y / TILE), r1 = Math.floor((hb.y + hb.h) / TILE);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (isSolidTile(c, r)) return true;
    }
  }

  return buildings.some(b => b.appears() && rectanglesTouch(hb, bodyRect(b)));
}

/* --------------------------------------------------------------
   RANDOM EDGE SPAWN POSITION
-------------------------------------------------------------- */
function getEdgeSpawnPosition(size){
  const side = Math.floor(Math.random()*4);
  let x=0,y=0;
  if (side===0){ x=Math.random()*Math.max(1,canvas.width-size); y=-size; }
  else if (side===1){ x=canvas.width+size; y=Math.random()*Math.max(1,canvas.height-size); }
  else if (side===2){ x=Math.random()*Math.max(1,canvas.width-size); y=canvas.height+size; }
  else { x=-size; y=Math.random()*Math.max(1,canvas.height-size); }
  return {x,y};
}

/* --------------------------------------------------------------
   ENEMY SPAWNING
-------------------------------------------------------------- */
function spawnEnemy() {
  const pos = getEdgeSpawnPosition(NORMAL_ENEMY_SIZE);
  enemies.push({
    type:"normal",
    x:pos.x, y:pos.y,
    w:NORMAL_ENEMY_SIZE, h:NORMAL_ENEMY_SIZE,
    s:NORMAL_ENEMY_SPEED,
    animTimer:0, animFrame:0, animFps:6,
    animFrames:getAnimationFrameCount("monster")
  });
}

function spawnGermEnemy() {
  const pos = getEdgeSpawnPosition(GERM_START_SIZE);
  enemies.push({
    type:"germ",
    x:pos.x, y:pos.y,
    w:GERM_START_SIZE, h:GERM_START_SIZE,
    s:GERM_START_SPEED,
    health:GERM_START_HEALTH, initialHealth:GERM_START_HEALTH, maxSize:GERM_MAX_SIZE,
    animTimer:0, animFrame:0, animFps:8,
    animFrames:getAnimationFrameCount("virus")
  });
}

/* --------------------------------------------------------------
   ROOMS & DOORS
   World doors are generated from the buildings above.
   Interior doors keep their old positions; doorTile is the tile drawn.

   furniture      = list from furniture.js (drawn from interior_tileset.png)
   showFurniture  = set to false to hide it; furnishedWhen() is re-checked
                    every time the player enters the room
-------------------------------------------------------------- */
const rooms = {
  world:{
    name:"World", bg:"#4caf50",
    get doors(){
      return buildings
        .filter(b => b.appears())
        .map(b => ({ ...doorRect(b), target:b.target, hidden:true }));
    },
    spawnEnemy(){}
  },

  buildingA:{
    name:"Building A", bg:"#8b4513",
    doors:[{x:200, y:1100, w:80, h:80, target:"world", doorTile:85}],
    spawnEnemy(){},
    furniture: FURNITURE.buildingA
  },

  buildingB:{
    name:"Building B", bg:"#3b5998",
    doors:[{x:200, y:1100, w:80, h:80, target:"world", doorTile:85, requiredKills:5, showLock:true}],
    // furniture only appears once the health bar is unlocked AND enemies have
    // stopped spawning (kills > 5), checked each time you walk in
    furniture: FURNITURE.buildingB,
    showFurniture: false,
    furnishedWhen: () => showHealthBar && kills > 5,
    spawnEnemy(){
      if (kills <= 5) spawnEnemy();
    }
  },

  buildingC:{
    name:"Building C", bg:"#d1e8f0",
    doors:[{x:200, y:1100, w:80, h:80, target:"world", doorTile:89}],
    furniture: FURNITURE.buildingC,
    spawnEnemy(){}
  },

  buildingD:{
    name:"Building D", bg:"#403050",
    doors:[{x:200, y:1100, w:80, h:80, target:"world", doorTile:89}],
    spawnEnemy(){ spawnGermEnemy(); }
  }
};
let currentRoom = rooms.world;

/* ==============================================================
   NPCs
   --------------------------------------------------------------
   i)   Building A : a villager man + a villager woman (standing)
   ii)  World      : an elder, a kid and a merchant wander slowly
   iii) Building B : villager woman, kid and elder (only once the
                     room is furnished, i.e. after the monsters are gone)
   iv)  Building C : guards in the corners (never on top of furniture)
   v)   World      : a doctor beside building D once it appears

   Interior size (used for keeping NPCs inside the floor area).
   If your interiors are a different size, change these numbers.
============================================================== */
const ROOM_SIZE = {
  buildingA: { w: 540, h: 740 },
  buildingB: { w: 540, h: 740 },
  buildingC: { w: 540, h: 740 },
  buildingD: { w: 540, h: 740 }
};

const NPC_WANDER_SPEED  = 0.55;   // player is 4.5, so this is really slow
const NPC_WANDER_RADIUS = 220;    // how far from its start point a wanderer roams
const NPC_FACE_DISTANCE = 110;    // standing NPCs turn toward the player inside this range

let npcs = [];

function roomSize(roomName) {
  if (roomName === "world") return { w: canvas.width, h: canvas.height };
  return ROOM_SIZE[roomName] || { w: canvas.width, h: 740 };
}

/* Can a 64x64 character stand with its top-left at (x, y)?
   - world:     not on solid tiles, not in any building body (even ones that
                have not appeared yet), and not blocking any door
   - interiors: inside the floor, not on furniture, not blocking the door,
                not next to the king
   `others` (optional) = NPCs that must not overlap */
function spotFree(roomName, x, y, others = null) {
  const feet = feetAt(x, y);
  const { w, h } = roomSize(roomName);

  if (roomName === "world") {
    if (x < 0 || y < 0 || x + 64 > w || y + 64 > h) return false;

    const c0 = Math.floor(feet.x / TILE), c1 = Math.floor((feet.x + feet.w) / TILE);
    const r0 = Math.floor(feet.y / TILE), r1 = Math.floor((feet.y + feet.h) / TILE);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        if (isSolidTile(c, r)) return false;

    for (const b of buildings) {
      if (rectanglesTouch(feet, inflate(bodyRect(b), 4))) return false;
      if (rectanglesTouch(feet, inflate(doorRect(b), 24))) return false;
    }
  } else {
    const m = TILE;
    if (feet.x < m || feet.x + feet.w > w - m) return false;
    if (feet.y < m + 20 || feet.y + feet.h > h - m) return false;

    if (furnSolids(roomFurniture(roomName)).some(r => rectanglesTouch(feet, inflate(r, 4)))) return false;
    if ((rooms[roomName].doors || []).some(d => rectanglesTouch(feet, inflate(d, 16)))) return false;
    if (roomName === "buildingC" && rectanglesTouch(feet, inflate(kingHome(), 36))) return false;
  }

  if (others) {
    for (const o of others) {
      if (Math.hypot(o.x - x, o.y - y) < 64) return false;
    }
  }
  return true;
}

/* Nearest free spot to an anchor point (grid search, closest first) */
function findSpot(roomName, ax, ay, others = null, maxR = 700) {
  const { w, h } = roomSize(roomName);
  const cand = [];
  for (let y = 0; y <= h - 64; y += 8) {
    for (let x = 0; x <= w - 64; x += 8) {
      const d = Math.hypot(x - ax, y - ay);
      if (d <= maxR) cand.push({ x, y, d });
    }
  }
  cand.sort((a, b) => a.d - b.d);
  for (const p of cand) if (spotFree(roomName, p.x, p.y, others)) return p;
  return null;
}

function addNpc(sprite, roomName, ax, ay, opts = {}) {
  const same = npcs.filter(n => n.room === roomName);
  const pos = findSpot(roomName, ax, ay, same);
  if (!pos) { console.warn(`No free spot for ${sprite} in ${roomName}`); return null; }

  const dir = opts.dir || "down";
  const n = {
    sprite, room: roomName,
    x: pos.x, y: pos.y, w: 64, h: 64,
    dir, defaultDir: dir,
    wander: !!opts.wander,
    speed: opts.speed || NPC_WANDER_SPEED,
    homeX: pos.x, homeY: pos.y,
    target: null,
    pause: 500 + Math.random() * 2500,
    animTimer: 0, animFrame: 0, animFps: 5,
    animFrames: getAnimationFrameCount(sprite, "down"),
    visibleWhen: opts.visibleWhen || null
  };
  npcs.push(n);
  return n;
}

/* NPCs that are in the room the player is in (and currently visible) */
function npcsHere() {
  return npcs.filter(n => rooms[n.room] === currentRoom && (!n.visibleWhen || n.visibleWhen()));
}

function setupNpcs() {
  npcs = [];

  // i) Building A – villagers standing around
  addNpc("villagerMan",   "buildingA", 130, 260, { dir: "down" });
  addNpc("villagerWoman", "buildingA", 380, 260, { dir: "down" });

  // ii) World – slow wanderers
  addNpc("elder",    "world", 200, 520, { wander: true });
  addNpc("kid",      "world", 200, 100, { wander: true, speed: NPC_WANDER_SPEED * 1.2 });
  addNpc("merchant", "world", 250, 860, { wander: true });

  // iii) Building B – only after the room is furnished
  const furnished = () => rooms.buildingB.showFurniture;
  addNpc("villagerWoman", "buildingB", 120, 300, { visibleWhen: furnished });
  addNpc("kid",           "buildingB", 200, 300, { visibleWhen: furnished });
  addNpc("elder",         "buildingB", 260, 480, { visibleWhen: furnished });

  // iv) Building C – one guard per corner (nearest free spot, so never on furniture)
  const gm = TILE, { w: cw, h: ch } = roomSize("buildingC");
  addNpc("guard", "buildingC", gm,           gm,           { dir: "down" });
  addNpc("guard", "buildingC", cw - 64 - gm, gm,           { dir: "down" });
  addNpc("guard", "buildingC", gm,           ch - 64 - gm, { dir: "up" });
  addNpc("guard", "buildingC", cw - 64 - gm, ch - 64 - gm, { dir: "up" });

  // v) Doctor – stands beside building D once it appears
  const bD = buildings.find(b => b.target === "buildingD");
  if (bD) {
    const d = doorRect(bD);
    addNpc("doctor", "world", d.x + d.w + 40, d.y + d.h - 30, {
      dir: "down",
      visibleWhen: () => bD.appears()
    });
  }
}

/* --------------------------------------------------------------
   NPC UPDATE
-------------------------------------------------------------- */
function faceToward(n, tx, ty) {
  const dx = tx - (n.x + n.w/2), dy = ty - (n.y + n.h/2);
  n.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
}

function wanderNpc(n, delta) {
  const pcx = player.x + player.w/2, pcy = player.y + player.h/2;
  const ncx = n.x + n.w/2,           ncy = n.y + n.h/2;

  // stop and look at the player when they walk up close
  if (Math.hypot(pcx - ncx, pcy - ncy) < 80) {
    faceToward(n, pcx, pcy);
    n.animFrame = 0; n.animTimer = 0;
    return;
  }

  if (n.pause > 0) {
    n.pause -= delta;
    n.animFrame = 0; n.animTimer = 0;
    return;
  }

  if (!n.target) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * NPC_WANDER_RADIUS;
    n.target = {
      x: n.homeX + Math.cos(ang) * Math.min(dist, NPC_WANDER_RADIUS),
      y: n.homeY + Math.sin(ang) * Math.min(dist, NPC_WANDER_RADIUS)
    };
  }

  const dx = n.target.x - n.x, dy = n.target.y - n.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 3) {
    n.target = null;
    n.pause = 1500 + Math.random() * 3500;
    n.animFrame = 0;
    return;
  }

  const step = Math.min(dist, n.speed * delta / 16.67);
  const mx = dx / dist * step, my = dy / dist * step;

  let moved = false;
  if (spotFree("world", n.x + mx, n.y)) { n.x += mx; moved = true; }
  if (spotFree("world", n.x, n.y + my)) { n.y += my; moved = true; }

  if (!moved) {                          // bumped into something – rest, then pick a new target
    n.target = null;
    n.pause = 400 + Math.random() * 800;
    n.animFrame = 0;
    return;
  }

  n.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
  updateAnimation(n, delta);
}

function updateNpcs(delta) {
  const pcx = player.x + player.w/2, pcy = player.y + player.h/2;

  npcsHere().forEach(n => {
    if (n.wander) { wanderNpc(n, delta); return; }

    // standing NPCs: look at the player when close, otherwise go back to default facing
    const d = Math.hypot(pcx - (n.x + n.w/2), pcy - (n.y + n.h/2));
    if (d < NPC_FACE_DISTANCE) faceToward(n, pcx, pcy);
    else n.dir = n.defaultDir;
    n.animFrame = 0;
  });
}

function drawNpc(n) {
  drawSprite(n.sprite, n.dir, n.animFrame, n.x, n.y, n.w, n.h);
}

/* --------------------------------------------------------------
   RESET & INITIAL SETUP
-------------------------------------------------------------- */
function reset(){
  currentRoom = rooms.world;
  rooms.buildingB.showFurniture = false;

  player = {
    x:220, y:330,
    w:64, h:64,
    speed:4.5,
    flashTimer:0,
    dir:"down",
    animTimer:0, animFrame:0, animFps:8,
    animFrames:getAnimationFrameCount("player","down")
  };

  enemies = []; killEffects = []; kills = 0;
  playerHealth = MAX_HEALTH; showHealthBar = false; playerInvuln = 0;
  lastSpawn = 0; lastTime = 0;
  running = false; gamePaused = false; pageHidden = document.hidden;
  joystick.active = false; joystick.dx = 0; joystick.dy = 0;
  king.currentLine = 0; king.active = false; king.placed = false; king.talked = false;
  const dlg = document.getElementById("dialogueBox");
  if (dlg) dlg.style.display = "none";
  const score = document.getElementById("score");
  if (score) score.textContent = "0";

  setupNpcs();
}

/* --------------------------------------------------------------
   ANIMATION UPDATE HELPER
-------------------------------------------------------------- */
function updateAnimation(entity, delta){
  if (!entity || entity.animFrames <= 1 || entity.animFps <= 0) {
    if (entity) entity.animFrame = 0;
    return;
  }
  entity.animTimer += delta;
  const frameDur = 1000 / entity.animFps;
  while (entity.animTimer >= frameDur){
    entity.animTimer -= frameDur;
    entity.animFrame = (entity.animFrame + 1) % entity.animFrames;
  }
}

/* --------------------------------------------------------------
   PLAYER UPDATE (direction + collisions)
-------------------------------------------------------------- */
function updatePlayer(delta){
  let moving = false;

  // input: keyboard (WASD / arrows) wins if a key is held, otherwise the touch joystick
  let nx = 0, ny = 0, hasInput = false;
  const kv = keyboardVector();
  if (kv){
    nx = kv.x; ny = kv.y; hasInput = true;
  } else if (joystick.active){
    const mag = Math.hypot(joystick.dx, joystick.dy);
    if (mag > 2){ nx = joystick.dx / mag; ny = joystick.dy / mag; hasInput = true; }
  }

  if (hasInput){
    moving = true;

    if (Math.abs(nx) > Math.abs(ny)) player.dir = nx > 0 ? "right" : "left";
    else if (Math.abs(ny) > Math.abs(nx)) player.dir = ny > 0 ? "down" : "up";
    // (perfect diagonals keep the current facing)

    // move one axis at a time so the player slides along walls
    const sx = nx * player.speed, sy = ny * player.speed;
    player.x += sx; if (blockedAt()) player.x -= sx;
    player.y += sy; if (blockedAt()) player.y -= sy;
  }

  if (moving) updateAnimation(player, delta);
  else { player.animFrame = 0; player.animTimer = 0; }

  player.x = Math.max(0, Math.min(canvas.width - player.w, player.x));
  player.y = Math.max(0, Math.min(canvas.height - player.h, player.y));
}

/* --------------------------------------------------------------
   ENEMY UPDATE
-------------------------------------------------------------- */
function updateEnemies(delta){
  enemies.forEach(e=>{
    const cx = e.x + e.w/2, cy = e.y + e.h/2;
    const px = player.x + player.w/2, py = player.y + player.h/2;
    const dx = px - cx, dy = py - cy;
    const dist = Math.hypot(dx, dy) || 1;

    e.x += (dx/dist) * e.s;
    e.y += (dy/dist) * e.s;

    if (Math.abs(dx) > Math.abs(dy)) e.dir = dx > 0 ? "right" : "left";
    else                             e.dir = dy > 0 ? "down" : "up";

    updateAnimation(e, delta);
  });
}

/* --------------------------------------------------------------
   VISUAL EFFECTS (kill sparks)
-------------------------------------------------------------- */
function createEffect(x,y,emoji,dur=250){
  killEffects.push({x,y,emoji,ttl:dur,maxTtl:dur});
}
function updateKillEffects(delta){
  for (let i=killEffects.length-1;i>=0;--i){
    killEffects[i].ttl -= delta;
    if (killEffects[i].ttl <= 0) killEffects.splice(i,1);
  }
}
function drawKillEffects(){
  ctx.save();
  ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.font="32px Arial";
  killEffects.forEach(e=>{
    ctx.globalAlpha = Math.max(0, e.ttl/e.maxTtl);
    ctx.fillText(e.emoji||"⚔️", e.x, e.y);
  });
  ctx.restore();
}

/* --------------------------------------------------------------
   ENEMY COLLISIONS
-------------------------------------------------------------- */
function handleEnemyCollisions(){
  const remove = new Set();

  for (let i=0;i<enemies.length;i++){
    for (let j=i+1;j<enemies.length;j++){
      if (remove.has(i)||remove.has(j)) continue;
      const a=enemies[i], b=enemies[j];
      if (!rectanglesTouch(a,b)) continue;

      if (a.type==="normal" && b.type==="normal"){
        const ex=(a.x+b.x)/2 + a.w/2;
        const ey=(a.y+b.y)/2 + a.h/2;
        remove.add(i); remove.add(j);
        kills++;
        createEffect(ex,ey,"⚔️",250);
        continue;
      }

      if (a.type==="germ" && b.type==="germ"){
        let absorber, absorbed, absorbedIdx;
        if (a.w >= b.w){ absorber=a; absorbed=b; absorbedIdx=j; }
        else { absorber=b; absorbed=a; absorbedIdx=i; }

        const cx = absorber.x + absorber.w/2;
        const cy = absorber.y + absorber.h/2;
        const growth = Math.max(5, absorbed.w*0.28);
        const newSize = Math.min(absorber.maxSize, absorber.w + growth);

        absorber.w = absorber.h = newSize;
        absorber.x = cx - newSize/2;
        absorber.y = cy - newSize/2;

        if (newSize >= absorber.maxSize){
          remove.add(enemies.indexOf(absorber));
          kills += 100;
          createEffect(cx,cy,"☠️",350);
        }else{
          absorber.health += Math.max(1, Math.ceil(absorbed.health*0.5));
        }
        absorber.s = Math.max(0.65, GERM_START_SPEED - (newSize - GERM_START_SIZE) * 0.009);
        remove.add(absorbedIdx);
        createEffect(absorber.x+absorber.w/2, absorber.y+absorber.h/2,"🧬",300);
      }
    }
  }
  enemies = enemies.filter((_,i)=>!remove.has(i));
}

/* --------------------------------------------------------------
   HEALTH & DAMAGE
-------------------------------------------------------------- */
function drawHealthBar(){
  if (!showHealthBar) return;
  const barW = 200, barH = 20;
  const x = (canvas.width - barW)/2, y = 12;
  const percent = Math.max(0, playerHealth / MAX_HEALTH);
  ctx.save();
  ctx.fillStyle="#555"; ctx.fillRect(x,y,barW,barH);
  ctx.fillStyle="#00ff00"; ctx.fillRect(x,y,barW*percent,barH);
  ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.strokeRect(x,y,barW,barH);
  ctx.font="14px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.fillStyle="#fff";
  ctx.fillText(`${Math.max(0,playerHealth)} / ${MAX_HEALTH}`, canvas.width/2, y+barH/2);
  ctx.restore();
}
function pushGermAwayFromPlayer(g){
  const pcx = player.x + player.w/2, pcy = player.y + player.h/2;
  const gcx = g.x + g.w/2, gcy = g.y + g.h/2;
  let dx = gcx - pcx, dy = gcy - pcy;
  let dist = Math.hypot(dx, dy);
  if (dist===0){ dx = Math.random()-0.5; dy = Math.random()-0.5; dist = Math.hypot(dx,dy)||1; }
  g.x += (dx/dist)*30; g.y += (dy/dist)*30;
}
function damagePlayer(delta){
  if (!showHealthBar) return;
  if (playerInvuln>0){ playerInvuln = Math.max(0, playerInvuln-delta); return; }

  for (let i=enemies.length-1;i>=0;i--){
    const e = enemies[i];
    if (!rectanglesTouch(player,e)) continue;

    playerHealth--; playerInvuln = INVULN_TIME; player.flashTimer = INVULN_TIME;
    if (e.type==="germ"){
      e.health--;
      createEffect(e.x+e.w/2, e.y+e.h/2, "💥", 220);
      if (e.health <= 0){
        const cx = e.x+e.w/2, cy = e.y+e.h/2;
        enemies.splice(i,1);
        kills += 10;
        createEffect(cx,cy,"☠️",350);
      }else{
        pushGermAwayFromPlayer(e);
      }
    }
    break;
  }
}
function collide(){ return enemies.some(e=>rectanglesTouch(player,e)); }

/* --------------------------------------------------------------
   KING PLACEMENT & DIALOGUE
-------------------------------------------------------------- */
function maybePlaceKing(){
  if (king.placed) return;
  const h = kingHome();
  king.x = h.x;
  king.y = h.y;
  king.placed = true;
}
function startKingDialogue(){
  const dlgBox = document.getElementById("dialogueBox");
  const dlgLine = document.getElementById("dialogueLine");
  if (!dlgBox||!dlgLine||!dlgBtn) return;
  king.currentLine = 0; king.active = true; king.talked = true;
  dlgLine.textContent = king.dialogueLines[0];
  dlgBox.style.display = "flex";
  dlgBtn.textContent = "Next";
  gamePaused = true;
  joystick.active = false; joystick.dx = 0; joystick.dy = 0;
}
function advanceKingDialogue(){
  if (!king.active) return;
  const dlgBox = document.getElementById("dialogueBox");
  const dlgLine = document.getElementById("dialogueLine");
  if (!dlgBox||!dlgLine) return;

  king.currentLine++;
  if (king.currentLine >= king.dialogueLines.length){
    dlgBox.style.display = "none";
    gamePaused = false; king.active = false;
    dlgBtn.textContent = "Next";
    showHealthBar = true; playerHealth = MAX_HEALTH; playerInvuln = 0;   // building D now appears
    lastTime = performance.now();
    return;
  }
  dlgLine.textContent = king.dialogueLines[king.currentLine];
  dlgBtn.textContent = king.currentLine===king.dialogueLines.length-1 ? "Close" : "Next";
}
function checkKingProximity(){
  if (currentRoom!==rooms.buildingC || king.active) return;
  const kcx = king.x + king.w/2, kcy = king.y + king.h/2;
  const pcx = player.x + player.w/2, pcy = player.y + player.h/2;
  const dist = Math.hypot(kcx-pcx, kcy-pcy);
  if (dist < 80 && !king.talked) startKingDialogue();
  if (dist >= 80) king.talked = false;
}

/* --------------------------------------------------------------
   GAME OVER
-------------------------------------------------------------- */
function endGame(message){
  running = false;
  if (anim!==null){ cancelAnimationFrame(anim); anim=null; }
  joystick.active = false; joystick.dx = 0; joystick.dy = 0;
  const final = document.getElementById("final");
  const overlay = document.getElementById("overlay");
  if (final) final.innerHTML = message;
  if (overlay) overlay.style.display = "flex";
}
function processGameOver(){
  const score = kills;
  endGame(`You scored ${score}.<br>Hint: You need certain points to proceed.`);
  recordPlaySession(playerName, score);
  refreshLeaderboard();
}

/* --------------------------------------------------------------
   ROOM TRANSITIONS
-------------------------------------------------------------- */
function enterRoom(targetName){
  const target = rooms[targetName];
  if (!target) return;
  const cameFrom = currentRoom;
  currentRoom = target;

  // rooms like Building B only get furnished if their condition is met right now
  if (target.furnishedWhen) target.showFurniture = target.furnishedWhen();

  enemies = []; lastSpawn = 0;
  player.x = canvas.width/2 - player.w/2;
  player.y = canvas.height/2 - player.h/2;

  // coming back outside: stand just below the door of the building we left
  if (target === rooms.world) {
    const b = buildings.find(b => rooms[b.target] === cameFrom);
    if (b) {
      const d = doorRect(b);
      player.x = d.x + d.w/2 - player.w/2;
      player.y = d.y + d.h - 30;
    }
    king.talked = false;
  }

  joystick.active = false; joystick.dx = 0; joystick.dy = 0;
  if (currentRoom===rooms.buildingC) maybePlaceKing();
}
function checkDoorCollision(){
  const hb = hitbox();
  for (const d of currentRoom.doors){
    const unlocked = !d.requiredKills || kills >= d.requiredKills;
    if (!unlocked) continue;
    if (rectanglesTouch(hb,d)){
      enterRoom(d.target);
      return;
    }
  }
}
function getCurrentSpawnInterval(){
  return currentRoom===rooms.buildingD ? GERM_ENEMY_SPAWN_INTERVAL : NORMAL_ENEMY_SPAWN_INTERVAL;
}

/* --------------------------------------------------------------
   DRAW BACKGROUND / DOORS / DECOR
-------------------------------------------------------------- */
function drawBackground(){
  if (currentRoom === rooms.world) drawWorldTiles();
  else drawInteriorFloor(currentRoom.bg);
}

/* Interior exit doors (the town's doors are part of the building tiles) */
function drawDoors(){
  if (currentRoom === rooms.world) return;
  currentRoom.doors.forEach(d=>{
    const unlocked = !d.requiredKills || kills >= d.requiredKills;
    ctx.save();
    ctx.globalAlpha = unlocked ? 1 : 0.6;
    drawTile(d.doorTile || 85, d.x, d.y, d.w, d.h);
    ctx.globalAlpha = 1;
    if (!unlocked){
      ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.font="40px Arial"; ctx.fillStyle="#fff";
      ctx.fillText("🔒", d.x+d.w/2, d.y+d.h/2);
      if (d.showLock){
        ctx.font="20px Arial"; ctx.fillStyle="#ffcc00";
        ctx.fillText(String(d.requiredKills), d.x+d.w/2, d.y+d.h+14);
      }
    }
    ctx.restore();
  });
}

/* Optional emoji decor (rooms without a furniture list can still use `decor`) */
function drawDecor(){
  if (!currentRoom.decor) return;
  ctx.save(); ctx.font="36px Arial"; ctx.textAlign="center"; ctx.textBaseline="middle";
  currentRoom.decor.forEach(i=>ctx.fillText(i.emoji, i.x, i.y));
  ctx.restore();
}

/* --------------------------------------------------------------
   DRAW ENTITIES (PLAYER, KING, ENEMIES)
-------------------------------------------------------------- */
function drawPlayer(){
  ctx.save();
  if (player.flashTimer>0){
    const flashing = Math.floor(player.flashTimer/100)%2===0;
    ctx.globalAlpha = flashing ? 0.35 : 1;
  }
  // every direction has its own sprites now (down / up / left / right)
  drawSprite("player",player.dir,player.animFrame,player.x,player.y,player.w,player.h);
  ctx.restore();
}
function drawKing(){
  if (currentRoom!==rooms.buildingC) return;
  drawSprite("king","down",0,king.x,king.y,king.w,king.h);
}
function drawEnemy(e){
  const spriteName = e.type==="germ" ? "virus" : "monster";
  drawSprite(spriteName,e.dir,e.animFrame,e.x,e.y,e.w,e.h);

  if (e.type==="germ"){
    const barW = Math.max(24, Math.min(e.w,70));
    const maxH = Math.max(e.initialHealth, e.health);
    const ratio = Math.max(0, Math.min(1, e.health / maxH));
    const barX = e.x + e.w/2 - barW/2;
    const barY = e.y - 8;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(barX, barY, barW, 5);
    ctx.fillStyle = "#aaff55";
    ctx.fillRect(barX, barY, barW*ratio, 5);
  }
}

/* --------------------------------------------------------------
   JOYSTICK VISUAL
-------------------------------------------------------------- */
function drawJoystick(){
  if (!joystick.active) return;
  ctx.save();
  ctx.strokeStyle="rgba(255,255,255,0.4)"; ctx.lineWidth=3;
  ctx.beginPath(); ctx.arc(joystick.baseX, joystick.baseY, 40, 0, Math.PI*2); ctx.stroke();
  ctx.fillStyle="rgba(255,255,255,0.5)";
  ctx.beginPath(); ctx.arc(joystick.baseX+joystick.dx, joystick.baseY+joystick.dy, 20, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

/* --------------------------------------------------------------
   ROOM NAME DISPLAY
-------------------------------------------------------------- */
function drawRoomName(){
  ctx.save(); ctx.font="18px Arial"; ctx.textAlign="left"; ctx.textBaseline="top";
  ctx.fillStyle="rgba(255,255,255,0.9)";
  ctx.strokeStyle="rgba(0,0,0,0.6)"; ctx.lineWidth=3;
  ctx.strokeText(currentRoom.name, 12, 42);
  ctx.fillText(currentRoom.name, 12, 42);
  ctx.restore();
}

/* Press "B" to show collision boxes
   world: red = building body, blue = door, yellow = feet, orange = NPC feet
   interiors: green = solid furniture, yellow = feet, orange = NPC feet */
function drawDebugBoxes(){
  if (!debugBoxes) return;
  ctx.save(); ctx.lineWidth = 2;
  if (currentRoom === rooms.world){
    buildings.filter(b => b.appears()).forEach(b => {
      let r = bodyRect(b); ctx.strokeStyle = "red";  ctx.strokeRect(r.x, r.y, r.w, r.h);
      r = doorRect(b);     ctx.strokeStyle = "blue"; ctx.strokeRect(r.x, r.y, r.w, r.h);
    });
  } else {
    ctx.strokeStyle = "lime";
    furnSolids(activeFurniture()).forEach(r => ctx.strokeRect(r.x, r.y, r.w, r.h));
    ctx.strokeStyle = "blue";
    currentRoom.doors.forEach(d => ctx.strokeRect(d.x, d.y, d.w, d.h));
  }
  ctx.strokeStyle = "orange";
  npcsHere().forEach(n => { const r = feetAt(n.x, n.y); ctx.strokeRect(r.x, r.y, r.w, r.h); });
  const hb = hitbox(); ctx.strokeStyle = "yellow"; ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
  ctx.restore();
}

/* --------------------------------------------------------------
   FULL DRAW CALL
   Everything that stands on the ground is depth-sorted by its feet:
   buildings (world), furniture (interiors), NPCs, king, enemies, player.
   Rugs ("floor") are drawn under everything, chandeliers ("over") on top.
-------------------------------------------------------------- */
function draw(){
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawBackground();

  const furn = activeFurniture();
  furn.filter(f => f.floor).forEach(f => drawFurn(ctx, f));          // rugs

  drawDoors();
  drawDecor();

  const inWorld = currentRoom === rooms.world;
  const feet = player.y + player.h;
  const base = f => f.y + f.h * TILE;

  const items = [];

  if (inWorld) {
    buildings.filter(b => b.appears())
      .forEach(b => items.push({ y: b.y + b.h, draw: () => drawBuilding(b) }));
  }

  furn.filter(f => !f.floor && !f.over)
    .forEach(f => items.push({ y: base(f), draw: () => drawFurn(ctx, f) }));

  npcsHere().forEach(n => items.push({ y: n.y + n.h, draw: () => drawNpc(n) }));

  if (currentRoom === rooms.buildingC)
    items.push({ y: king.y + king.h, draw: drawKing });

  enemies.forEach(e => items.push({ y: e.y + e.h, draw: () => drawEnemy(e) }));

  items.push({ y: feet + 0.01, draw: drawPlayer });

  items.sort((a, b) => a.y - b.y);
  items.forEach(it => it.draw());

  furn.filter(f => f.over).forEach(f => drawFurn(ctx, f));                 // chandeliers

  drawDebugBoxes();
  drawJoystick();
  drawKillEffects();
  drawRoomName();
  drawHealthBar();
}

/* --------------------------------------------------------------
   GAME LOOP
-------------------------------------------------------------- */
function loop(timestamp){
  if (!running) return;
  if (gamePaused || pageHidden){ lastTime = timestamp; anim=requestAnimationFrame(loop); return; }

  if (!lastTime) lastTime = timestamp;
  const delta = Math.min(timestamp - lastTime, 50);
  lastTime = timestamp;

  if (player.flashTimer>0) player.flashTimer = Math.max(0, player.flashTimer - delta);

  const scoreEl = document.getElementById("score");
  if (scoreEl) scoreEl.textContent = String(kills);

  if (timestamp - lastSpawn > getCurrentSpawnInterval()){
    currentRoom.spawnEnemy();
    lastSpawn = timestamp;
  }

  updatePlayer(delta);
  updateNpcs(delta);
  updateEnemies(delta);
  handleEnemyCollisions();
  updateKillEffects(delta);
  checkDoorCollision();

  if (showHealthBar) damagePlayer(delta);
  else if (collide()){ processGameOver(); return; }

  checkKingProximity();
  if (showHealthBar && playerHealth <= 0){ processGameOver(); return; }

  draw();
  anim = requestAnimationFrame(loop);
}

/* --------------------------------------------------------------
   START / RESTART
-------------------------------------------------------------- */
function startGame(){
  if (!playerName) askForName();

  const overlay = document.getElementById("overlay");
  if (overlay) overlay.style.display = "none";

  if (anim!==null){ cancelAnimationFrame(anim); anim=null; }

  reset();
  running = true;
  lastTime = performance.now();
  lastSpawn = lastTime;
  draw();
  anim = requestAnimationFrame(loop);
}

/* --------------------------------------------------------------
   POINTER HELPERS (joystick)
-------------------------------------------------------------- */
function getPointerPosition(event){
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width  / rect.width,
    y: (event.clientY - rect.top)  * canvas.height / rect.height
  };
}
canvas.addEventListener("pointerdown", e=>{
  if (!running || gamePaused || pageHidden) return;
  e.preventDefault();
  const pos = getPointerPosition(e);
  joystick.active = true;
  joystick.baseX = pos.x; joystick.baseY = pos.y;
  joystick.dx = joystick.dy = 0;
  if (canvas.setPointerCapture) try{ canvas.setPointerCapture(e.pointerId); }catch{}
});
canvas.addEventListener("pointermove", e=>{
  if (!joystick.active) return;
  e.preventDefault();
  const pos = getPointerPosition(e);
  let dx = pos.x - joystick.baseX;
  let dy = pos.y - joystick.baseY;
  const dist = Math.hypot(dx,dy);
  if (dist > joystick.max){
    dx = (dx/dist) * joystick.max;
    dy = (dy/dist) * joystick.max;
  }
  joystick.dx = dx; joystick.dy = dy;
});
function stopJoystick(e){ if (e) e.preventDefault(); joystick.active = false; joystick.dx=0; joystick.dy=0; }
canvas.addEventListener("pointerup", stopJoystick);
canvas.addEventListener("pointercancel", stopJoystick);
canvas.addEventListener("pointerleave", e=>{ if (e.buttons===0 || e.pointerType==="mouse") stopJoystick(e); });

/* --------------------------------------------------------------
   PAGE VISIBILITY (pause when hidden)
-------------------------------------------------------------- */
document.addEventListener("visibilitychange", ()=>{
  pageHidden = document.hidden;
  joystick.active = false; joystick.dx=0; joystick.dy=0;
  if (!pageHidden){ lastTime = performance.now(); lastSpawn = lastTime; }
});
window.addEventListener("blur", ()=>{
  pageHidden = true;
  joystick.active = false; joystick.dx=0; joystick.dy=0;
});
window.addEventListener("focus", ()=>{
  pageHidden = document.hidden;
  lastTime = performance.now(); lastSpawn = lastTime;
});

/* --------------------------------------------------------------
   RESPONSIVE CANVAS SIZING
-------------------------------------------------------------- */
function resize(){
  // fit the whole 540x1170 game into the visible screen (width AND height)
  const vw = window.visualViewport?.width  ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;
  const docTop = canvas.getBoundingClientRect().top + window.scrollY;  // space used above the canvas
  const availH = Math.max(200, vh - docTop);
  const scale = Math.min(vw / 540, availH / 1170, 1);

  canvas.style.width  = `${Math.floor(540  * scale)}px`;
  canvas.style.height = `${Math.floor(1170 * scale)}px`;
  canvas.style.display = "block";
  canvas.style.margin  = "0 auto";
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", resize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
resize();

/* --------------------------------------------------------------
   KEYS: WASD / arrow keys = move, E = advance dialogue,
         B = toggle collision-box debug view
-------------------------------------------------------------- */
const heldKeys = new Set();

// physical key codes (so WASD works on any keyboard layout)
const MOVE_KEYS = {
  KeyW:"up",    ArrowUp:"up",
  KeyS:"down",  ArrowDown:"down",
  KeyA:"left",  ArrowLeft:"left",
  KeyD:"right", ArrowRight:"right"
};

/* Returns a normalised {x, y} direction from the held keys, or null if none */
function keyboardVector() {
  let x = 0, y = 0;
  if (heldKeys.has("left"))  x -= 1;
  if (heldKeys.has("right")) x += 1;
  if (heldKeys.has("up"))    y -= 1;
  if (heldKeys.has("down"))  y += 1;
  if (x === 0 && y === 0) return null;
  const mag = Math.hypot(x, y);
  return { x: x / mag, y: y / mag };   // diagonals are not faster
}

window.addEventListener("keydown", e=>{
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const move = MOVE_KEYS[e.code];
  if (move){
    heldKeys.add(move);
    if (e.code.startsWith("Arrow")) e.preventDefault();   // don't scroll the page
    return;
  }

  const k = e.key.toLowerCase();
  if (k === "b"){ debugBoxes = !debugBoxes; return; }
  if (k !== "e") return;
  const dlg = document.getElementById("dialogueBox");
  if (dlg && dlg.style.display !== "none") advanceKingDialogue();
});

window.addEventListener("keyup", e=>{
  const move = MOVE_KEYS[e.code];
  if (move) heldKeys.delete(move);
});

// don't get stuck walking if the window loses focus while a key is down
window.addEventListener("blur", ()=> heldKeys.clear());
document.addEventListener("visibilitychange", ()=>{ if (document.hidden) heldKeys.clear(); });

/* --------------------------------------------------------------
   PAGE INITIALISATION
-------------------------------------------------------------- */
window.addEventListener("load", async ()=>{
  try{
    await loadSpriteSheet();
    await loadTownSheet();
    await loadInteriorSheet();

    const stored = localStorage.getItem("survivalPlayerName");
    if (stored){ playerName = stored; const pn = document.getElementById("playerName"); if (pn) pn.textContent = playerName; }

    const dlgBox = document.getElementById("dialogueBox");
    if (dlgBox) dlgBox.style.display = "none";

    dlgBtn = document.getElementById("dialogueNext");
    if (dlgBtn) dlgBtn.addEventListener("click", advanceKingDialogue);

    const retry = document.getElementById("retry");
    if (retry) retry.addEventListener("click", startGame);

    await refreshLeaderboard();
    startGame();
  }catch(err){
    console.error("Game init failed:", err);
    const final = document.getElementById("final");
    const overlay = document.getElementById("overlay");
    if (final) final.textContent = "Some images could not be loaded. Open the browser console for details.";
    if (overlay) overlay.style.display = "flex";
  }
});

/* --------------------------------------------------------------
   SERVICE WORKER (optional)
-------------------------------------------------------------- */
if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").catch(e=>console.warn("SW registration failed:", e));
}

/* --------------------------------------------------------------
   DEBUG EXPORTS
-------------------------------------------------------------- */
window.startGame = startGame;
window.advanceKingDialogue = advanceKingDialogue;
window.spriteImages = spriteImages;
window.spriteAnimations = spriteAnimations;
window.getNpcs = () => npcs;
