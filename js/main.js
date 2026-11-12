/* ==============================================================
   MAIN.JS – Hungry Reds (player ↔ monster sprite swap)
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
-------------------------------------------------------------- */
const spriteAnimations = {
  /* ---- PLAYER ANIMATION SET (now uses the old MONSTER graphics) ---- */
  player: {
    down:  [46, 47, 48, 49],
    up:    [52, 53, 54, 55],   // same frame for up
    left:  [46, 47, 48, 49],   // will be mirrored for left
    right: [46, 47, 48, 49]    // same frame for right
  },

  /* ---- MONSTER ANIMATION SET (now uses the old PLAYER graphics) ---- */
  monster: {
    down:  [0, 1, 2, 3],
    up:    [4, 5, 6, 7],
    left:  [8, 9,10,11],
    right: [12,13,14,15]
  },

  king:   { down: [23] },
  virus:  { down: [69,70,71,72] }
};

/* --------------------------------------------------------------
   SPRITE LOADING
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
  if (Array.isArray(entry)) return entry;               // backward‑compat
  return entry[dir] || entry["down"];                  // fallback
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
   GAME STATE
-------------------------------------------------------------- */
let player, enemies = [], killEffects = [];
let kills = 0, lastSpawn = 0, lastTime = 0;
let running = false, gamePaused = false, pageHidden = false;
let anim = null, playerName = "", dlgBtn = null;

/* --------------------------------------------------------------
   BUILDING STATE
-------------------------------------------------------------- */
let buildingCAdded = false, buildingDAdded = false;

/* --------------------------------------------------------------
   PLAYER HEALTH
-------------------------------------------------------------- */
const MAX_HEALTH = 3, INVULN_TIME = 800;
let playerHealth = MAX_HEALTH, showHealthBar = false, playerInvuln = 0;

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
   ENEMY SPAWNING (normal enemies now use the **player** sprite set)
-------------------------------------------------------------- */
function spawnEnemy() {
  const pos = getEdgeSpawnPosition(NORMAL_ENEMY_SIZE);
  enemies.push({
    type:"normal",
    x:pos.x, y:pos.y,
    w:NORMAL_ENEMY_SIZE, h:NORMAL_ENEMY_SIZE,
    s:NORMAL_ENEMY_SPEED,
    animTimer:0, animFrame:0, animFps:6,
    animFrames:getAnimationFrameCount("monster")   // monster = old player graphics (4‑frame walk)
  });
}

/* Germs stay unchanged */
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
-------------------------------------------------------------- */
const rooms = {
  world:{
    name:"World", bg:"#4caf50",
    doors:[
      {id:"buildingA", x:30,  y:540, w:80, h:80, target:"buildingA", emoji:"🏠"},
      {id:"buildingB", x:380, y:20,  w:80, h:80, target:"buildingB", emoji:"🏢"}
    ],
    spawnEnemy(){}
  },

  buildingA:{
    name:"Building A", bg:"#8b4513",
    doors:[{x:200, y:660, w:80, h:80, target:"world", emoji:"🚪"}],
    spawnEnemy(){},
    decor:[
      {x:150, y:300, emoji:"🪑"},
      {x:230, y:300, emoji:"🪑"},
      {x:190, y:460, emoji:"🛏️"}
    ]
  },

  buildingB:{
    name:"Building B", bg:"#3b5998",
    doors:[{x:200, y:20, w:80, h:80, target:"world", emoji:"🚪", lockedEmoji:"🔒", requiredKills:10, showLock:true}],
    spawnEnemy(){ spawnEnemy(); }   // always uses the swapped sprite set
  },

  buildingC:{
    name:"Building C", bg:"#d1e8f0",
    doors:[{x:200, y:660, w:80, h:80, target:"world", emoji:"🚪"}],
    spawnEnemy(){}
  },

  buildingD:{
    name:"Building D", bg:"#403050",
    doors:[{x:200, y:660, w:80, h:80, target:"world", emoji:"🚪"}],
    spawnEnemy(){ spawnGermEnemy(); }
  }
};
let currentRoom = rooms.world;

/* --------------------------------------------------------------
   RESET & INITIAL SETUP
-------------------------------------------------------------- */
function resetWorldBuildings(){
  rooms.world.doors = rooms.world.doors.filter(d=>d.id!=="buildingC" && d.id!=="buildingD");
  buildingCAdded = false; buildingDAdded = false;
}
function reset(){
  resetWorldBuildings();
  currentRoom = rooms.world;

  player = {
    x:220, y:330,
    w:64, h:64,
    speed:4.5,
    flashTimer:0,
    dir:"down",
    animTimer:0, animFrame:0, animFps:8,
    /* player now uses the MONSTER graphics (single frame) */
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
   PLAYER UPDATE (direction handling)
-------------------------------------------------------------- */
function updatePlayer(delta){
  let moving = false;
  if (joystick.active){
    const mag = Math.hypot(joystick.dx, joystick.dy);
    if (mag > 2){
      moving = true;
      const nx = joystick.dx / mag;
      const ny = joystick.dy / mag;

      // four‑way direction
      if (Math.abs(nx) > Math.abs(ny)) player.dir = nx > 0 ? "right" : "left";
      else                           player.dir = ny > 0 ? "down" : "up";

      player.x += nx * player.speed;
      player.y += ny * player.speed;
    }
  }

  if (moving){
    // player now uses the MONSTER sprite (single frame) – no need to recalc frames,
    // but the call is harmless
    updateAnimation(player, delta);
  }else{
    player.animFrame = 0; player.animTimer = 0;
  }

  player.x = Math.max(0, Math.min(canvas.width - player.w, player.x));
  player.y = Math.max(0, Math.min(canvas.height - player.h, player.y));
}

/* --------------------------------------------------------------
   ENEMY UPDATE (direction for optional flipping)
-------------------------------------------------------------- */
function updateEnemies(delta){
  enemies.forEach(e=>{
    const cx = e.x + e.w/2, cy = e.y + e.h/2;
    const px = player.x + player.w/2, py = player.y + player.h/2;
    const dx = px - cx, dy = py - cy;
    const dist = Math.hypot(dx, dy) || 1;

    e.x += (dx/dist) * e.s;
    e.y += (dy/dist) * e.s;

    // direction for flip
    if (Math.abs(dx) > Math.abs(dy)) e.dir = dx > 0 ? "right" : "left";
    else                           e.dir = dy > 0 ? "down" : "up";

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
   ENEMY COLLISIONS (unchanged)
-------------------------------------------------------------- */
function handleEnemyCollisions(){
  const remove = new Set();

  for (let i=0;i<enemies.length;i++){
    for (let j=i+1;j<enemies.length;j++){
      if (remove.has(i)||remove.has(j)) continue;
      const a=enemies[i], b=enemies[j];
      if (!rectanglesTouch(a,b)) continue;

      // normal enemies collide
      if (a.type==="normal" && b.type==="normal"){
        const ex=(a.x+b.x)/2 + a.w/2;
        const ey=(a.y+b.y)/2 + a.h/2;
        remove.add(i); remove.add(j);
        kills++;
        createEffect(ex,ey,"⚔️",250);
        continue;
      }

      // germs (absorption) – unchanged
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
   BUILDING UNLOCK LOGIC
-------------------------------------------------------------- */
function maybeAddBuildingC(){
  if (buildingCAdded || kills < 10) return;
  rooms.world.doors.push({id:"buildingC", x:200, y:140, w:80, h:80, target:"buildingC", emoji:"🏰"});
  buildingCAdded = true;
}
function maybeAddBuildingD(){
  if (buildingDAdded || !showHealthBar) return;
  rooms.world.doors.push({id:"buildingD", x:350, y:300, w:80, h:80, target:"buildingD", emoji:"🏥"});
  buildingDAdded = true;
}

/* --------------------------------------------------------------
   KING PLACEMENT & DIALOGUE
-------------------------------------------------------------- */
function maybePlaceKing(){
  if (king.placed) return;
  king.x = canvas.width/2 - king.w/2;
  king.y = canvas.height/2 - king.h/2 - 250;
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
    showHealthBar = true; playerHealth = MAX_HEALTH; playerInvuln = 0;
    maybeAddBuildingD();
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
  currentRoom = target;
  enemies = []; lastSpawn = 0;
  player.x = canvas.width/2 - player.w/2;
  player.y = canvas.height/2 - player.h/2;
  joystick.active = false; joystick.dx = 0; joystick.dy = 0;

  if (currentRoom===rooms.buildingC) maybePlaceKing();
  if (currentRoom===rooms.world){
    king.talked = false;
    maybeAddBuildingC(); maybeAddBuildingD();
  }
}
function checkDoorCollision(){
  for (const d of currentRoom.doors){
    const unlocked = !d.requiredKills || kills >= d.requiredKills;
    if (!unlocked) continue;
    if (rectanglesTouch(player,d)){
      enterRoom(d.target);
      return;
    }
  }
}
function getCurrentSpawnInterval(){
  return currentRoom===rooms.buildingD ? GERM_ENEMY_SPAWN_INTERVAL : NORMAL_ENEMY_SPAWN_INTERVAL;
}

/* --------------------------------------------------------------
   DRAW BACKGROUND / GRID / DOORS / DECOR
-------------------------------------------------------------- */
function drawGrid(){
  ctx.save(); ctx.strokeStyle="rgba(255,255,255,0.08)"; ctx.lineWidth=1;
  for (let x=0;x<canvas.width;x+=40){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
  for (let y=0;y<canvas.height;y+=40){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
  ctx.restore();
}
function drawDoors(){
  currentRoom.doors.forEach(d=>{
    const unlocked = !d.requiredKills || kills >= d.requiredKills;
    ctx.save(); ctx.textAlign="center"; ctx.textBaseline="middle";
    if (unlocked){
      ctx.font="48px Arial"; ctx.fillStyle="#fff";
      ctx.fillText(d.emoji||"🚪", d.x+d.w/2, d.y+d.h/2);
    }else{
      ctx.globalAlpha=0.7; ctx.font="48px Arial";
      ctx.fillText(d.lockedEmoji||"🔒", d.x+d.w/2, d.y+d.h/2);
      ctx.globalAlpha=1;
      if (d.showLock){
        ctx.font="20px Arial"; ctx.fillStyle="#ffcc00";
        ctx.fillText(String(d.requiredKills), d.x+d.w/2, d.y+d.h+14);
      }
    }
    ctx.restore();
  });
}
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

  /* ---- PLAYER now uses the MONSTER sprite set ---- */
  if (player.dir === "left"){
    ctx.translate(player.x+player.w, player.y);
    ctx.scale(-1,1);
    drawSprite("player","right",player.animFrame,0,0,player.w,player.h);
  }else{
    drawSprite("player",player.dir,player.animFrame,player.x,player.y,player.w,player.h);
  }
  ctx.restore();
}
function drawKing(){
  if (currentRoom!==rooms.buildingC) return;
  drawSprite("king","down",0,king.x,king.y,king.w,king.h);
}
function drawEnemies(){
  enemies.forEach(e=>{
    const spriteName = e.type==="germ" ? "virus" : "monster";   // normal enemies use the MONSTER sprite set (now player graphics)
    if (e.dir === "left"){
      ctx.save();
      ctx.translate(e.x+e.w, e.y);
      ctx.scale(-1,1);
      drawSprite(spriteName,"right",e.animFrame,0,0,e.w,e.h);
      ctx.restore();
    }else{
      drawSprite(spriteName,e.dir,e.animFrame,e.x,e.y,e.w,e.h);
    }

    // health bar for germs (unchanged)
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
  });
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
  ctx.fillText(currentRoom.name, 12, 42);
  ctx.restore();
}

/* --------------------------------------------------------------
   FULL DRAW CALL
-------------------------------------------------------------- */
function draw(){
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = currentRoom.bg;
  ctx.fillRect(0,0,canvas.width,canvas.height);
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

  maybeAddBuildingC(); maybeAddBuildingD();
  if (timestamp - lastSpawn > getCurrentSpawnInterval()){
    currentRoom.spawnEnemy();
    lastSpawn = timestamp;
  }

  updatePlayer(delta);
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
  const maxW = Math.min(window.innerWidth, 540);
  canvas.style.width  = `${maxW}px`;
  canvas.style.height = `${maxW * 1170 / 540}px`;
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", resize);
resize();

/* --------------------------------------------------------------
   DIALOGUE KEY CONTROL (E/e)
-------------------------------------------------------------- */
window.addEventListener("keydown", e=>{
  if (e.key.toLowerCase() !== "e") return;
  const dlg = document.getElementById("dialogueBox");
  if (dlg && dlg.style.display !== "none") advanceKingDialogue();
});

/* --------------------------------------------------------------
   PAGE INITIALISATION
-------------------------------------------------------------- */
window.addEventListener("load", async ()=>{
  try{
    await loadSpriteSheet();

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
    if (final) final.textContent = "The sprites could not be loaded. Open the browser console for details.";
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
