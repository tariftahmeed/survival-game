/* --------------------------------------------------------------
   IMPORTS – Firebase CDN (still works in a module)
-------------------------------------------------------------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

/* --------------------------------------------------------------
   OPTIONAL: import the config we stored separately
-------------------------------------------------------------- */
import { firebaseConfig } from "./firebase-config.js";

/* --------------------------------------------------------------
   GLOBALS
-------------------------------------------------------------- */
let dlgBtn;                     // will be set after the page loads
let gamePaused = false;         // pause while dialogue is shown

/* ---------- PLAYER & HEALTH SETTINGS ---------- */
const MAX_HEALTH   = 3;                 // you can raise this if you like
let playerHealth   = MAX_HEALTH;       // current HP (starts full but hidden)
let showHealthBar  = false;            // true → draw the bar
const INVULN_TIME = 800;               // ms of immunity after a hit
let playerInvuln   = 0;                 // counts down while immune

/* ---------- KING NPC (inside buildingC) ---------- */
let king = {
  x:0, y:0,
  w:40, h:60,
  emoji:'🤴',
  dialogueLines:[
    "Welcome, brave hero!",
    "Your deeds have echoed across the realm.",
    "Take this gift and continue your quest."
  ],
  currentLine:0,
  active:false,          // true while the UI is open
  placed:false,          // true after we have positioned the king
  talked:false           // have we already finished a conversation?
};

/* ---------- INITIALISE FIREBASE & FIRESTORE ---------- */
const app   = initializeApp(firebaseConfig);
const db    = getFirestore(app);
const scoresCol = collection(db, "survivalScores");

/* ---------- RECORD A PLAY SESSION (with timestamp) ---------- */
async function recordPlaySession(name, kills){
  try{
    await addDoc(scoresCol, {
      name,
      score: kills,
      playedAt: serverTimestamp()
    });
  }catch(e){
    console.warn('Failed to write play session:', e);
  }
}

/* ---------- FETCH TOP‑3 FOR LEADERBOARD ---------- */
async function fetchTop3(){
  const q    = query(scoresCol, orderBy("score","desc"), limit(3));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach(doc=>{
    const d = doc.data();
    list.push({name:d.name, score:d.score});
  });
  return list;
}

/* ---------- REFRESH LEADERBOARD UI ---------- */
async function refreshLeaderboard(){
  const top = await fetchTop3();
  const ol  = document.getElementById('topList');
  ol.innerHTML = "";
  top.forEach(entry=>{
    const li = document.createElement('li');
    li.textContent = `${entry.name}: ${entry.score}`;
    ol.appendChild(li);
  });
}

/* ---------- CANVAS & CONTEXT ---------- */
const canvas = document.getElementById('game');
const ctx    = canvas.getContext('2d');

/* ---------- GAME STATE ---------- */
let player, enemies = [], kills = 0, lastSpawn = 0, running = false, anim;
let playerName = '';
let joystick = {active:false, baseX:0, baseY:0, dx:0, dy:0, max:60};
let lastTime = 0;
let buildingCAdded = false;

/* ---------- PLAYER NAME (local storage) ---------- */
function askForName(){
  const stored = localStorage.getItem('survivalPlayerName');
  if (stored){
    playerName = stored;
  }else{
    let name = '';
    while(!name){
      name = prompt('Enter your name (will appear on the global leaderboard)');
    }
    playerName = name.trim();
    localStorage.setItem('survivalPlayerName', playerName);
  }
  document.getElementById('playerName').textContent = playerName;
}

/* ---------- BASIC GAME SETUP ---------- */
function reset(){
  player = {x:220, y:330, w:30, h:30, speed:4.5};
  enemies = [];
  kills   = 0;

  // health & UI reset
  playerHealth   = MAX_HEALTH;
  showHealthBar  = false;
  playerInvuln   = 0;
  player.flashTimer = 0;
}

/* ---------- ENEMY SPAWN ---------- */
function spawnEnemy(){
  const side = Math.floor(Math.random()*4);
  let x,y;
  if (side===0){ x=Math.random()*canvas.width;  y=-30; }
  if (side===1){ x=canvas.width+30;            y=Math.random()*canvas.height; }
  if (side===2){ x=Math.random()*canvas.width; y=canvas.height+30; }
  if (side===3){ x=-30;                       y=Math.random()*canvas.height; }
  enemies.push({x,y,w:24,h:24,s:1.6});
}

/* ---------- UPDATE PLAYER (joystick) ---------- */
function updatePlayer(){
  if (joystick.active){
    const mag = Math.hypot(joystick.dx, joystick.dy);
    if (mag>2){
      player.x += (joystick.dx/mag) * player.speed;
      player.y += (joystick.dy/mag) * player.speed;
    }
  }
  // keep inside canvas
  player.x = Math.max(0, Math.min(canvas.width-player.w, player.x));
  player.y = Math.max(0, Math.min(canvas.height-player.h, player.y));
}

/* ---------- UPDATE ENEMIES (chase player) ---------- */
function updateEnemies(){
  enemies.forEach(e=>{
    const dx = player.x - e.x,
          dy = player.y - e.y,
          d  = Math.hypot(dx,dy) || 1;
    e.x += (dx/d) * e.s;
    e.y += (dy/d) * e.s;
  });
}

/* ---------- ENEMY‑ENEMY COLLISIONS & KILL EFFECT ---------- */
function handleEnemyCollisions(){
  const toRemove = new Set();
  for (let i=0;i<enemies.length;i++){
    for (let j=i+1;j<enemies.length;j++){
      const a=enemies[i], b=enemies[j];
      if (a.x < b.x+b.w && a.x+a.w > b.x &&
          a.y < b.y+b.h && a.y+a.h > b.y){
        toRemove.add(i); toRemove.add(j);
        const midX = (a.x + b.x) / 2 + a.w / 2;
        const midY = (a.y + b.y) / 2 + a.h / 2;
        killEffects.push({x:midX, y:midY, ttl:200});
      }
    }
  }
  kills += Math.floor(toRemove.size/2);
  enemies = enemies.filter((_,i)=>!toRemove.has(i));
}

/* ---------- KILL‑EFFECTS (flashing ⚔️) ---------- */
let killEffects = [];  // {x,y,ttl}
function updateKillEffects(delta){
  killEffects.forEach(e=> e.ttl -= delta);
  killEffects = killEffects.filter(e=> e.ttl>0);
}
function drawKillEffects(){
  ctx.font = '32px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ff4444';
  killEffects.forEach(e=>{
    ctx.globalAlpha = Math.max(0, e.ttl/200);
    ctx.fillText('⚔️', e.x, e.y);
  });
  ctx.globalAlpha = 1;
}

/* ---------- DRAW HEALTH BAR ---------- */
function drawHealthBar(){
  if (!showHealthBar) return;
  const barW = 200, barH = 20;
  const x = (canvas.width - barW) / 2;
  const y = 12;

  // background
  ctx.fillStyle = '#555';
  ctx.fillRect(x, y, barW, barH);

  // current health
  const curW = (playerHealth / MAX_HEALTH) * barW;
  ctx.fillStyle = '#0f0';
  ctx.fillRect(x, y, curW, barH);

  // border
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, barW, barH);
}

/* ---------- DAMAGE CHECK (after health bar appears) ---------- */
function damagePlayer(delta){
  if (!showHealthBar) return;        // nothing before the bar appears
  if (playerInvuln > 0){              // immunity timer
    playerInvuln -= delta;
    return;
  }

  // collision → lose 1 HP, start immunity, flash red
  for (const e of enemies){
    if (player.x < e.x+e.w && player.x+player.w > e.x &&
        player.y < e.y+e.h && player.y+player.h > e.y){
      playerHealth--;
      playerInvuln   = INVULN_TIME;
      player.flashTimer = INVULN_TIME;   // visual flash
      break;                            // only one hit per frame
    }
  }
}

/* ---------- SIMPLE COLLIDE (instant death before health bar) ---------- */
function collide(){
  return enemies.some(e=>
    player.x < e.x+e.w && player.x+player.w > e.x &&
    player.y < e.y+e.h && player.y+player.h > e.y);
}

/* ---------- DOOR / ROOM SWITCHING ---------- */
function checkDoorCollision(){
  for (const d of currentRoom.doors){
    const unlocked = (!d.requiredKills) || (kills >= d.requiredKills);
    if (!unlocked) continue;

    const inside = (
      player.x < d.x+d.w && player.x+player.w > d.x &&
      player.y < d.y+d.h && player.y+player.h > d.y
    );

    if (inside){
      const targetRoom = rooms[d.target];
      // centre player in the new room
      player.x = canvas.width/2 - player.w/2;
      player.y = canvas.height/2 - player.h/2;
      enemies = []; lastSpawn = 0;
      currentRoom = targetRoom;

      if (currentRoom === rooms.buildingC) maybePlaceKing();
      if (currentRoom === rooms.world) maybeAddBuildingC();

      // when we go back to the world the king can be talked to again
      if (currentRoom === rooms.world) king.talked = false;

      return;
    }
  }
}

/* ---------- BUILDING C (castle) UNLOCK ---------- */
function maybeAddBuildingC(){
  if (buildingCAdded) return;
  if (kills < 10) return;
  rooms.world.doors.push({
    x:200, y:140, w:80, h:80,
    target:"buildingC",
    emoji:"🏰"
  });
  buildingCAdded = true;
}

/* ---------- POSITION THE KING (first time you enter the castle) ---------- */
function maybePlaceKing(){
  if (king.placed) return;
  // Fixed coordinates – feel free to tweak them
  king.x = canvas.width/2 - king.w/2;          // centre horizontally
  king.y = canvas.height/2 - king.h/2 - 250;   // a bit above centre
  king.placed = true;
}

/* ---------- ROOMS DEFINITION ---------- */
const rooms = {
  world:{
    name:"World",
    bg:"#4caf50",
    doors:[
      {x:30,  y:540, w:80, h:80, target:"buildingA", emoji:"🏠"},
      {x:380, y:20,  w:80, h:80, target:"buildingB", emoji:"🏢"}
    ],
    spawnEnemy(){ }
  },

  buildingA:{
    name:"Building A",
    bg:"#8b4513",
    doors:[
      {x:200, y:660, w:80, h:80, target:"world", emoji:"🚪"}
    ],
    spawnEnemy(){},
    decor:[
      {x:150, y:300, emoji:"🪑"},
      {x:230, y:300, emoji:"🪑"},
      {x:190, y:460, emoji:"🛏️"}
    ]
  },

  buildingB:{
    name:"Building B",
    bg:"#3b5998",
    doors:[
      {x:200, y:20, w:80, h:80, target:"world", emoji:"🚪",
       lockedEmoji:"🔒", requiredKills:10, showLock:true}
    ],
    spawnEnemy(){ spawnEnemy(); }
  },

  buildingC:{
    name:"Building C",
    bg:"#d1e8f0",
    doors:[
      {x:200, y:660, w:80, h:80, target:"world", emoji:"🚪"}
    ],
    spawnEnemy(){ }
  }
};

let currentRoom = rooms.world;

/* ---------- DRAW EVERYTHING ---------- */
function draw(){
  // background
  ctx.fillStyle = currentRoom.bg;
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // optional grid (debug)
  ctx.strokeStyle='rgba(255,255,255,.08)';
  for(let x=0;x<canvas.width;x+=40){
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
  }
  for(let y=0;y<canvas.height;y+=40){
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
  }

  // doors
  ctx.font='48px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#000';
  currentRoom.doors.forEach(d=>{
    const unlocked = (!d.requiredKills) || (kills >= d.requiredKills);
    if (unlocked){
      ctx.fillText(d.emoji||'🚪', d.x+d.w/2, d.y+d.h/2);
    }else{
      const lock = d.lockedEmoji||'🔒';
      ctx.globalAlpha = 0.7;
      ctx.fillText(lock, d.x+d.w/2, d.y+d.h/2);
      ctx.globalAlpha = 1;
      if (d.showLock){
        ctx.font='20px Arial'; ctx.fillStyle='#ffcc00';
        ctx.fillText(`${d.requiredKills}`, d.x+d.w/2, d.y+d.h+14);
        ctx.font='48px Arial'; ctx.fillStyle='#fff';
      }
    }
  });

  // room‑specific decor (tables, chairs, bed)
  if (currentRoom.decor && currentRoom.decor.length){
    ctx.font='36px Arial'; ctx.fillStyle='#fff';
    currentRoom.decor.forEach(item=> ctx.fillText(item.emoji, item.x, item.y));
  }

  // player (flashes red while damage cooldown)
  ctx.font='30px Arial';
  ctx.fillStyle = (player.flashTimer > 0) ? '#f44' : '#fff';
  ctx.fillText('🧿', player.x+player.w/2, player.y+player.h/2);

  // king – only visible inside the castle
  if (currentRoom === rooms.buildingC){
    ctx.font='48px Arial'; ctx.fillStyle='#ffde59';
    ctx.fillText(king.emoji, king.x+king.w/2, king.y+king.h/2);
  }

  // enemies
  ctx.font='28px Arial';
  enemies.forEach(e=> ctx.fillText('👾', e.x+e.w/2, e.y+e.h/2));

  // joystick visual aid
  if (joystick.active){
    ctx.beginPath(); ctx.strokeStyle='rgba(255,255,255,.4)'; ctx.lineWidth=3;
    ctx.arc(joystick.baseX, joystick.baseY, 40, 0, Math.PI*2); ctx.stroke();

    ctx.beginPath(); ctx.fillStyle='rgba(255,255,255,.5)';
    ctx.arc(joystick.baseX+joystick.dx, joystick.baseY+joystick.dy, 20, 0, Math.PI*2);
    ctx.fill();
  }

  // health bar – drawn last, so it’s on top
  drawHealthBar();
}

/* ---------- MAIN LOOP ---------- */
function loop(timestamp){
  if (!running) return;

  if (gamePaused){
    anim = requestAnimationFrame(loop);
    return;
  }

  const delta = timestamp - lastTime;
  lastTime = timestamp;

  // flash timer decay (so draw() can just read the value)
  if (player.flashTimer > 0) player.flashTimer -= delta;

  document.getElementById('score').textContent = kills;

  if (timestamp - lastSpawn > 1200){
    currentRoom.spawnEnemy();
    lastSpawn = timestamp;
  }

  updatePlayer();
  updateEnemies();
  handleEnemyCollisions();
  updateKillEffects(delta);
  checkDoorCollision();

  // ---------- DAMAGE handling ----------
  if (showHealthBar){
    // health‑based damage after the king’s dialogue
    damagePlayer(delta);
  }else{
    // instant death before the health bar appears
    if (collide()){
      // --- GAME OVER (pre‑king) ---------------------------------
      endGame(`You scored ${kills}. <br>Hint: You need certain points to proceed in the game.`);
      recordPlaySession(playerName, kills);
      return;
    }
  }

  draw();
  drawKillEffects();

  // ---------- KING PROXIMITY (to start dialogue) ----------
  if (currentRoom === rooms.buildingC && !king.active){
    const talkRange = 80;
    const cx = king.x + king.w/2;
    const cy = king.y + king.h/2;
    const px = player.x + player.w/2;
    const py = player.y + player.h/2;
    const dist = Math.hypot(cx-px, cy-py);

    if (dist < talkRange && !king.talked){
      king.active = true;
      startKingDialogue();
    }

    // Reset “talked” flag when the player steps away so they can talk again later
    if (dist >= talkRange) king.talked = false;
  }

  // ---------- END‑OF‑GAME (health‑based) ----------
  if (showHealthBar && playerHealth <= 0){
    endGame(`You scored ${kills}. <br>Hint: You need certain points to proceed in the game.`);
    recordPlaySession(playerName, kills);
    // hide UI & clear timers
    showHealthBar = false;
    playerInvuln = 0;
    return;
  }

  anim = requestAnimationFrame(loop);
}

/* ---------- END‑OF‑GAME helper (overlay) ---------- */
function endGame(message){
  running = false;
  cancelAnimationFrame(anim);
  document.getElementById('final').innerHTML = message;
  document.getElementById('overlay').style.display = 'flex';
}

/* ---------- START / RESTART ---------- */
function startGame(){
  if (!playerName) askForName();
  document.getElementById('overlay').style.display = 'none';
  reset();
  running = true;
  requestAnimationFrame(loop);
}

/* ---------- DIALOGUE HELPERS ---------- */
function startKingDialogue(){
  document.getElementById('dialogueLine').textContent = king.dialogueLines[0];
  king.currentLine = 0;
  document.getElementById('dialogueBox').style.display = 'flex';
  dlgBtn.textContent = 'Next';
  gamePaused = true;
  king.talked = true;       // we have just started a conv.
}
function advanceKingDialogue(){
  king.currentLine++;

  // conversation finished → close UI & give player health
  if (king.currentLine >= king.dialogueLines.length){
    document.getElementById('dialogueBox').style.display = 'none';
    gamePaused = false;
    king.active = false;
    dlgBtn.textContent = 'Next';

    showHealthBar = true;
    playerHealth  = MAX_HEALTH;   // full health again
    return;
  }

  // otherwise show the next line
  document.getElementById('dialogueLine').textContent = king.dialogueLines[king.currentLine];
  dlgBtn.textContent = (king.currentLine === king.dialogueLines.length-1) ? 'Close' : 'Next';
}

/* ---------- JOYSTICK INPUT ---------- */
function pos(e){
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * canvas.width / r.width,
    y: (e.clientY - r.top)  * canvas.height/ r.height
  };
}
canvas.addEventListener('pointerdown', e=>{
  const p = pos(e);
  joystick.active = true;
  joystick.baseX = p.x; joystick.baseY = p.y;
  joystick.dx = joystick.dy = 0;
});
canvas.addEventListener('pointermove', e=>{
  if (!joystick.active) return;
  const p = pos(e);
  let dx = p.x - joystick.baseX,
      dy = p.y - joystick.baseY;
  const d = Math.hypot(dx,dy);
  if (d > joystick.max){ dx = dx/d * joystick.max; dy = dy/d * joystick.max; }
  joystick.dx = dx; joystick.dy = dy;
});
canvas.addEventListener('pointerup',   ()=>{ joystick.active=false; joystick.dx=0; joystick.dy=0; });
canvas.addEventListener('pointercancel',()=>{ joystick.active=false; });

/* ---------- KEEP CANVAS ASPECT RATIO ---------- */
function resize(){
  const maxW = Math.min(window.innerWidth,540);
  canvas.style.width  = maxW + 'px';
  canvas.style.height = (maxW * 1170 / 540) + 'px';
}
window.addEventListener('resize', resize);
resize();

/* ---------- PAGE LOAD ---------- */
window.addEventListener('load', async ()=>{
  const stored = localStorage.getItem('survivalPlayerName');
  if (stored){
    playerName = stored;
    document.getElementById('playerName').textContent = playerName;
  }
  await refreshLeaderboard();

  // hide the dialogue box (it’s already in the DOM) and hook the button
  document.getElementById('dialogueBox').style.display = 'none';
  dlgBtn = document.getElementById('dialogueNext');
  dlgBtn.addEventListener('click', advanceKingDialogue);

  startGame();
});

/* ---------- OPTIONAL SERVICE‑WORKER ---------- */
if ('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js')
    .catch(e=>console.warn('SW registration failed',e));
}

/* ---------- PLAY AGAIN BUTTON ---------- */
document.getElementById('retry').addEventListener('click', startGame);

/* ---------- OPTIONAL: “E” key as a fallback for dialogue ---------- */
window.addEventListener('keydown', e=>{
  if ((e.key === 'e' || e.key === 'E') &&
      document.getElementById('dialogueBox').style.display !== 'none'){
    advanceKingDialogue();
  }
});

/* --------------------------------------------------------------
   If you ever need to call a function from plain HTML (e.g.
   <button onclick="someFn()">) expose it:
   window.someFn = () => {...};
-------------------------------------------------------------- */