/* --------------------------------------------------------------
   IMPORTS: FIREBASE CDN
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


/* --------------------------------------------------------------
   GAME STATE
-------------------------------------------------------------- */

let player;
let enemies = [];
let killEffects = [];

let kills = 0;
let lastSpawn = 0;
let lastTime = 0;

let running = false;
let gamePaused = false;
let pageHidden = false;

let anim = null;

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

const MAX_HEALTH = 3;
const INVULN_TIME = 800;

let playerHealth = MAX_HEALTH;
let showHealthBar = false;
let playerInvuln = 0;


/* --------------------------------------------------------------
   ENEMY SETTINGS
-------------------------------------------------------------- */

const NORMAL_ENEMY_SPAWN_INTERVAL = 1200;
const GERM_ENEMY_SPAWN_INTERVAL = 1500;

const NORMAL_ENEMY_SIZE = 24;
const NORMAL_ENEMY_SPEED = 1.6;

const GERM_START_SIZE = 28;
const GERM_MAX_SIZE = 90;
const GERM_START_SPEED = 1.35;
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
   KING NPC
-------------------------------------------------------------- */

const king = {
  x: 0,
  y: 0,
  w: 40,
  h: 60,

  emoji: "🤴",

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
  } catch (error) {
    console.warn("Failed to write play session:", error);
  }
}


/* --------------------------------------------------------------
   FIREBASE: FETCH TOP 3
-------------------------------------------------------------- */

async function fetchTop3() {
  try {
    const scoresQuery = query(
      scoresCol,
      orderBy("score", "desc"),
      limit(3)
    );

    const snapshot = await getDocs(scoresQuery);
    const list = [];

    snapshot.forEach((scoreDocument) => {
      const data = scoreDocument.data();

      list.push({
        name: data.name,
        score: data.score
      });
    });

    return list;
  } catch (error) {
    console.warn("Failed to fetch leaderboard:", error);
    return [];
  }
}


/* --------------------------------------------------------------
   FIREBASE: UPDATE LEADERBOARD
-------------------------------------------------------------- */

async function refreshLeaderboard() {
  const topPlayers = await fetchTop3();
  const leaderboard = document.getElementById("topList");

  if (!leaderboard) return;

  leaderboard.innerHTML = "";

  topPlayers.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = `${entry.name}: ${entry.score}`;
    leaderboard.appendChild(item);
  });
}


/* --------------------------------------------------------------
   PLAYER NAME
-------------------------------------------------------------- */

function askForName() {
  const storedName = localStorage.getItem("survivalPlayerName");

  if (storedName) {
    playerName = storedName;
  } else {
    let enteredName = "";

    while (!enteredName.trim()) {
      enteredName = prompt(
        "Enter your name. It will appear on the global leaderboard."
      ) || "";
    }

    playerName = enteredName.trim();

    localStorage.setItem(
      "survivalPlayerName",
      playerName
    );
  }

  const playerNameElement = document.getElementById("playerName");

  if (playerNameElement) {
    playerNameElement.textContent = playerName;
  }
}


/* --------------------------------------------------------------
   COLLISION HELPER
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
   RANDOM SPAWN POSITION
-------------------------------------------------------------- */

function getEdgeSpawnPosition(size) {
  const side = Math.floor(Math.random() * 4);

  let x = 0;
  let y = 0;

  if (side === 0) {
    x = Math.random() * Math.max(1, canvas.width - size);
    y = -size;
  }

  if (side === 1) {
    x = canvas.width + size;
    y = Math.random() * Math.max(1, canvas.height - size);
  }

  if (side === 2) {
    x = Math.random() * Math.max(1, canvas.width - size);
    y = canvas.height + size;
  }

  if (side === 3) {
    x = -size;
    y = Math.random() * Math.max(1, canvas.height - size);
  }

  return { x, y };
}


/* --------------------------------------------------------------
   SPAWN NORMAL ENEMY
-------------------------------------------------------------- */

function spawnEnemy() {
  const position = getEdgeSpawnPosition(
    NORMAL_ENEMY_SIZE
  );

  enemies.push({
    type: "normal",

    x: position.x,
    y: position.y,

    w: NORMAL_ENEMY_SIZE,
    h: NORMAL_ENEMY_SIZE,

    s: NORMAL_ENEMY_SPEED
  });
}


/* --------------------------------------------------------------
   SPAWN GERM ENEMY
-------------------------------------------------------------- */

function spawnGermEnemy() {
  const position = getEdgeSpawnPosition(
    GERM_START_SIZE
  );

  enemies.push({
    type: "germ",

    x: position.x,
    y: position.y,

    w: GERM_START_SIZE,
    h: GERM_START_SIZE,

    s: GERM_START_SPEED,

    health: GERM_START_HEALTH,
    maxSize: GERM_MAX_SIZE
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
      {
        id: "buildingA",
        x: 30,
        y: 540,
        w: 80,
        h: 80,
        target: "buildingA",
        emoji: "🏠"
      },

      {
        id: "buildingB",
        x: 380,
        y: 20,
        w: 80,
        h: 80,
        target: "buildingB",
        emoji: "🏢"
      }
    ],

    spawnEnemy() {}
  },

  buildingA: {
    name: "Building A",
    bg: "#8b4513",

    doors: [
      {
        x: 200,
        y: 660,
        w: 80,
        h: 80,
        target: "world",
        emoji: "🚪"
      }
    ],

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

    spawnEnemy() {
      spawnEnemy();
    }
  },

  buildingC: {
    name: "Building C",
    bg: "#d1e8f0",

    doors: [
      {
        x: 200,
        y: 660,
        w: 80,
        h: 80,
        target: "world",
        emoji: "🚪"
      }
    ],

    spawnEnemy() {}
  },

  buildingD: {
    name: "Building D",
    bg: "#403050",

    doors: [
      {
        x: 200,
        y: 660,
        w: 80,
        h: 80,
        target: "world",
        emoji: "🚪"
      }
    ],

    spawnEnemy() {
      spawnGermEnemy();
    },
  }
};

let currentRoom = rooms.world;


/* --------------------------------------------------------------
   REMOVE DYNAMIC BUILDINGS FROM THE WORLD
-------------------------------------------------------------- */

function resetWorldBuildings() {
  rooms.world.doors = rooms.world.doors.filter((door) => {
    return (
      door.id !== "buildingC" &&
      door.id !== "buildingD"
    );
  });

  buildingCAdded = false;
  buildingDAdded = false;
}


/* --------------------------------------------------------------
   RESET GAME
-------------------------------------------------------------- */

function reset() {
  resetWorldBuildings();

  currentRoom = rooms.world;

  player = {
    x: 220,
    y: 330,
    w: 30,
    h: 30,
    speed: 4.5,
    flashTimer: 0
  };

  enemies = [];
  killEffects = [];

  kills = 0;

  playerHealth = MAX_HEALTH;
  showHealthBar = false;
  playerInvuln = 0;

  lastSpawn = 0;
  lastTime = 0;

  gamePaused = false;
  pageHidden = document.hidden;

  joystick.active = false;
  joystick.dx = 0;
  joystick.dy = 0;

  king.currentLine = 0;
  king.active = false;
  king.placed = false;
  king.talked = false;

  const dialogueBox = document.getElementById(
    "dialogueBox"
  );

  if (dialogueBox) {
    dialogueBox.style.display = "none";
  }

  const scoreElement = document.getElementById("score");

  if (scoreElement) {
    scoreElement.textContent = "0";
  }
}


/* --------------------------------------------------------------
   UPDATE PLAYER
-------------------------------------------------------------- */

function updatePlayer() {
  if (joystick.active) {
    const magnitude = Math.hypot(
      joystick.dx,
      joystick.dy
    );

    if (magnitude > 2) {
      player.x +=
        (joystick.dx / magnitude) * player.speed;

      player.y +=
        (joystick.dy / magnitude) * player.speed;
    }
  }

  player.x = Math.max(
    0,
    Math.min(canvas.width - player.w, player.x)
  );

  player.y = Math.max(
    0,
    Math.min(canvas.height - player.h, player.y)
  );
}


/* --------------------------------------------------------------
   UPDATE ENEMIES
-------------------------------------------------------------- */

function updateEnemies() {
  enemies.forEach((enemy) => {
    const enemyCenterX = enemy.x + enemy.w / 2;
    const enemyCenterY = enemy.y + enemy.h / 2;

    const playerCenterX = player.x + player.w / 2;
    const playerCenterY = player.y + player.h / 2;

    const dx = playerCenterX - enemyCenterX;
    const dy = playerCenterY - enemyCenterY;

    const distance = Math.hypot(dx, dy) || 1;

    enemy.x += (dx / distance) * enemy.s;
    enemy.y += (dy / distance) * enemy.s;
  });
}


/* --------------------------------------------------------------
   CREATE VISUAL EFFECT
-------------------------------------------------------------- */

function createEffect(x, y, emoji, duration = 250) {
  killEffects.push({
    x,
    y,
    emoji,
    ttl: duration,
    maxTtl: duration
  });
}


/* --------------------------------------------------------------
   UPDATE VISUAL EFFECTS
-------------------------------------------------------------- */

function updateKillEffects(delta) {
  killEffects.forEach((effect) => {
    effect.ttl -= delta;
  });

  killEffects = killEffects.filter((effect) => {
    return effect.ttl > 0;
  });
}


/* --------------------------------------------------------------
   DRAW VISUAL EFFECTS
-------------------------------------------------------------- */

function drawKillEffects() {
  ctx.save();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "32px Arial";

  killEffects.forEach((effect) => {
    ctx.globalAlpha = Math.max(
      0,
      effect.ttl / effect.maxTtl
    );

    ctx.fillText(
      effect.emoji || "⚔️",
      effect.x,
      effect.y
    );
  });

  ctx.restore();
}


/* --------------------------------------------------------------
   HANDLE ENEMY COLLISIONS
-------------------------------------------------------------- */

function handleEnemyCollisions() {
  const toRemove = new Set();

  for (let i = 0; i < enemies.length; i++) {
    if (toRemove.has(i)) continue;

    for (let j = i + 1; j < enemies.length; j++) {
      if (toRemove.has(j)) continue;

      const enemyA = enemies[i];
      const enemyB = enemies[j];

      if (!rectanglesTouch(enemyA, enemyB)) {
        continue;
      }

      /*
         NORMAL ENEMY + NORMAL ENEMY

         Both enemies are destroyed.
         The player receives one point.
      */

      if (
        enemyA.type === "normal" &&
        enemyB.type === "normal"
      ) {
        const effectX =
          (
            enemyA.x + enemyA.w / 2 +
            enemyB.x + enemyB.w / 2
          ) / 2;

        const effectY =
          (
            enemyA.y + enemyA.h / 2 +
            enemyB.y + enemyB.h / 2
          ) / 2;

        toRemove.add(i);
        toRemove.add(j);

        kills++;

        createEffect(
          effectX,
          effectY,
          "⚔️",
          250
        );

        break;
      }

      /*
         GERM + GERM

         The larger germ absorbs the smaller germ.
         If they are equal, enemyA absorbs enemyB.
      */

      if (
        enemyA.type === "germ" &&
        enemyB.type === "germ"
      ) {
        let absorber;
        let absorbed;
        let absorbedIndex;

        if (enemyA.w >= enemyB.w) {
          absorber = enemyA;
          absorbed = enemyB;
          absorbedIndex = j;
        } else {
          absorber = enemyB;
          absorbed = enemyA;
          absorbedIndex = i;
        }

        const centerX =
          absorber.x + absorber.w / 2;

        const centerY =
          absorber.y + absorber.h / 2;

        const growth = Math.max(
          5,
          absorbed.w * 0.28
        );

        const newSize = Math.min(
          absorber.maxSize,
          absorber.w + growth
        );

        absorber.w = newSize;
        absorber.h = newSize;

        absorber.x = centerX - newSize / 2;
        absorber.y = centerY - newSize / 2;

        absorber.health += Math.max(
          1,
          Math.ceil(absorbed.health * 0.5)
        );

        absorber.s = Math.max(
          0.65,
          GERM_START_SPEED -
            (newSize - GERM_START_SIZE) * 0.009
        );

        toRemove.add(absorbedIndex);

        createEffect(
          absorber.x + absorber.w / 2,
          absorber.y + absorber.h / 2,
          "🧬",
          300
        );

        if (absorbedIndex === i) {
          break;
        }
      }
    }
  }

  enemies = enemies.filter((enemy, index) => {
    return !toRemove.has(index);
  });
}


/* --------------------------------------------------------------
   DRAW HEALTH BAR
-------------------------------------------------------------- */

function drawHealthBar() {
  if (!showHealthBar) return;

  const barW = 200;
  const barH = 20;

  const x = (canvas.width - barW) / 2;
  const y = 12;

  const healthPercentage = Math.max(
    0,
    playerHealth / MAX_HEALTH
  );

  ctx.save();

  ctx.fillStyle = "#555";
  ctx.fillRect(x, y, barW, barH);

  ctx.fillStyle = "#00dd44";
  ctx.fillRect(
    x,
    y,
    barW * healthPercentage,
    barH
  );

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, barW, barH);

  ctx.font = "14px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";

  ctx.fillText(
    `${Math.max(0, playerHealth)} / ${MAX_HEALTH}`,
    canvas.width / 2,
    y + barH / 2
  );

  ctx.restore();
}


/* --------------------------------------------------------------
   PUSH GERM AWAY FROM PLAYER
-------------------------------------------------------------- */

function pushGermAwayFromPlayer(germ) {
  const playerCenterX = player.x + player.w / 2;
  const playerCenterY = player.y + player.h / 2;

  const germCenterX = germ.x + germ.w / 2;
  const germCenterY = germ.y + germ.h / 2;

  let dx = germCenterX - playerCenterX;
  let dy = germCenterY - playerCenterY;

  let distance = Math.hypot(dx, dy);

  if (distance === 0) {
    dx = Math.random() - 0.5;
    dy = Math.random() - 0.5;
    distance = Math.hypot(dx, dy) || 1;
  }

  germ.x += (dx / distance) * 30;
  germ.y += (dy / distance) * 30;
}


/* --------------------------------------------------------------
   DAMAGE PLAYER AND GERM
-------------------------------------------------------------- */

function damagePlayer(delta) {
  if (!showHealthBar) return;

  if (playerInvuln > 0) {
    playerInvuln = Math.max(
      0,
      playerInvuln - delta
    );

    return;
  }

  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];

    if (!rectanglesTouch(player, enemy)) {
      continue;
    }

    playerHealth--;
    playerInvuln = INVULN_TIME;
    player.flashTimer = INVULN_TIME;

    /*
       Germ collisions damage both the player
       and the germ.
    */

    if (enemy.type === "germ") {
      enemy.health--;

      createEffect(
        enemy.x + enemy.w / 2,
        enemy.y + enemy.h / 2,
        "💥",
        220
      );
      
      if (enemy.h === enemy.maxSize) {
        const deathX = enemy.x + enemy.w / 2;
        const deathY = enemy.y + enemy.h / 2;

        enemies.splice(i, 1);
        kills+= 100;

        createEffect(
          deathX,
          deathY,
          "☠️",
          350
        );
      }
       
      else if (enemy.health <= 0) {
        const deathX = enemy.x + enemy.w / 2;
        const deathY = enemy.y + enemy.h / 2;

        enemies.splice(i, 1);
        kills+= 10;

        createEffect(
          deathX,
          deathY,
          "☠️",
          350
        );
      } else {
        pushGermAwayFromPlayer(enemy);
      }
    }

    /*
       Only one enemy can damage the player
       during each invulnerability period.
    */

    break;
  }
}


/* --------------------------------------------------------------
   INSTANT-DEATH COLLISION

   This is used before the player receives
   the health bar.
-------------------------------------------------------------- */

function collide() {
  return enemies.some((enemy) => {
    return rectanglesTouch(player, enemy);
  });
}


/* --------------------------------------------------------------
   BUILDING C UNLOCK
-------------------------------------------------------------- */

function maybeAddBuildingC() {
  if (buildingCAdded) return;
  if (kills < 10) return;

  rooms.world.doors.push({
    id: "buildingC",

    x: 200,
    y: 140,
    w: 80,
    h: 80,

    target: "buildingC",
    emoji: "🏰"
  });

  buildingCAdded = true;
}


/* --------------------------------------------------------------
   BUILDING D UNLOCK

   Building D appears only when:
   1. The player has at least 20 points.
   2. The player has received the health bar.
-------------------------------------------------------------- */

function maybeAddBuildingD() {
  if (buildingDAdded) return;
  if (!showHealthBar) return;

  rooms.world.doors.push({
    id: "buildingD",

    x: 350,
    y: 300,
    w: 80,
    h: 80,

    target: "buildingD",
    emoji: "🏥"
  });

  buildingDAdded = true;
}


/* --------------------------------------------------------------
   CHECK UNLOCKS
-------------------------------------------------------------- */

function updateBuildingUnlocks() {
  maybeAddBuildingC();
  maybeAddBuildingD();
}


/* --------------------------------------------------------------
   PLACE KING
-------------------------------------------------------------- */

function maybePlaceKing() {
  if (king.placed) return;

  king.x =
    canvas.width / 2 -
    king.w / 2;

  king.y =
    canvas.height / 2 -
    king.h / 2 -
    250;

  king.placed = true;
}


/* --------------------------------------------------------------
   CHANGE ROOM
-------------------------------------------------------------- */

function enterRoom(targetRoomName) {
  const targetRoom = rooms[targetRoomName];

  if (!targetRoom) return;

  currentRoom = targetRoom;

  enemies = [];
  lastSpawn = 0;

  player.x =
    canvas.width / 2 -
    player.w / 2;

  player.y =
    canvas.height / 2 -
    player.h / 2;

  joystick.active = false;
  joystick.dx = 0;
  joystick.dy = 0;

  if (currentRoom === rooms.buildingC) {
    maybePlaceKing();
  }

  if (currentRoom === rooms.world) {
    king.talked = false;
    updateBuildingUnlocks();
  }
}


/* --------------------------------------------------------------
   CHECK DOOR COLLISION
-------------------------------------------------------------- */

function checkDoorCollision() {
  for (const door of currentRoom.doors) {
    const unlocked =
      !door.requiredKills ||
      kills >= door.requiredKills;

    if (!unlocked) continue;

    if (rectanglesTouch(player, door)) {
      enterRoom(door.target);
      return;
    }
  }
}


/* --------------------------------------------------------------
   DETERMINE SPAWN INTERVAL
-------------------------------------------------------------- */

function getCurrentSpawnInterval() {
  if (currentRoom === rooms.buildingD) {
    return GERM_ENEMY_SPAWN_INTERVAL;
  }

  return NORMAL_ENEMY_SPAWN_INTERVAL;
}


/* --------------------------------------------------------------
   DRAW BACKGROUND GRID
-------------------------------------------------------------- */

function drawGrid() {
  ctx.save();

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;

  for (let x = 0; x < canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  for (let y = 0; y < canvas.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.restore();
}


/* --------------------------------------------------------------
   DRAW DOORS
-------------------------------------------------------------- */

function drawDoors() {
  currentRoom.doors.forEach((door) => {
    const unlocked =
      !door.requiredKills ||
      kills >= door.requiredKills;

    ctx.save();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (unlocked) {
      ctx.font = "48px Arial";
      ctx.fillStyle = "#ffffff";

      ctx.fillText(
        door.emoji || "🚪",
        door.x + door.w / 2,
        door.y + door.h / 2
      );
    } else {
      ctx.globalAlpha = 0.7;
      ctx.font = "48px Arial";

      ctx.fillText(
        door.lockedEmoji || "🔒",
        door.x + door.w / 2,
        door.y + door.h / 2
      );

      ctx.globalAlpha = 1;

      if (door.showLock) {
        ctx.font = "20px Arial";
        ctx.fillStyle = "#ffcc00";

        ctx.fillText(
          String(door.requiredKills),
          door.x + door.w / 2,
          door.y + door.h + 14
        );
      }
    }

    ctx.restore();
  });
}


/* --------------------------------------------------------------
   DRAW DECORATIONS
-------------------------------------------------------------- */

function drawDecor() {
  if (
    !currentRoom.decor ||
    currentRoom.decor.length === 0
  ) {
    return;
  }

  ctx.save();

  ctx.font = "36px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  currentRoom.decor.forEach((item) => {
    ctx.fillText(
      item.emoji,
      item.x,
      item.y
    );
  });

  ctx.restore();
}


/* --------------------------------------------------------------
   DRAW PLAYER
-------------------------------------------------------------- */

function drawPlayer() {
  ctx.save();

  ctx.font = "30px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  /*
     The emoji itself cannot receive a normal fill color,
     so opacity is used to create the damage flash.
  */

  if (player.flashTimer > 0) {
    const flashing =
      Math.floor(player.flashTimer / 100) % 2 === 0;

    ctx.globalAlpha = flashing ? 0.35 : 1;
  }

  ctx.fillText(
    "🧿",
    player.x + player.w / 2,
    player.y + player.h / 2
  );

  ctx.restore();
}


/* --------------------------------------------------------------
   DRAW KING
-------------------------------------------------------------- */

function drawKing() {
  if (currentRoom !== rooms.buildingC) {
    return;
  }

  ctx.save();

  ctx.font = "48px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillText(
    king.emoji,
    king.x + king.w / 2,
    king.y + king.h / 2
  );

  ctx.restore();
}


/* --------------------------------------------------------------
   DRAW ENEMIES
-------------------------------------------------------------- */

function drawEnemies() {
  enemies.forEach((enemy) => {
    ctx.save();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (enemy.type === "germ") {
      const fontSize = Math.max(
        28,
        Math.round(enemy.w)
      );

      ctx.font = `${fontSize}px Arial`;

      ctx.fillText(
        "🦠",
        enemy.x + enemy.w / 2,
        enemy.y + enemy.h / 2
      );

      /*
         Small health indicator above each germ.
      */

      const germBarWidth = Math.max(
        24,
        Math.min(enemy.w, 70)
      );

      const healthDisplayMax = Math.max(
        GERM_START_HEALTH,
        enemy.health
      );

      const healthRatio = Math.min(
        1,
        enemy.health / healthDisplayMax
      );

      const germBarX =
        enemy.x +
        enemy.w / 2 -
        germBarWidth / 2;

      const germBarY =
        enemy.y - 8;

      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(
        germBarX,
        germBarY,
        germBarWidth,
        5
      );

      ctx.fillStyle = "#aaff55";
      ctx.fillRect(
        germBarX,
        germBarY,
        germBarWidth * healthRatio,
        5
      );
    } else {
      ctx.font = "28px Arial";

      ctx.fillText(
        "👾",
        enemy.x + enemy.w / 2,
        enemy.y + enemy.h / 2
      );
    }

    ctx.restore();
  });
}


/* --------------------------------------------------------------
   DRAW JOYSTICK
-------------------------------------------------------------- */

function drawJoystick() {
  if (!joystick.active) return;

  ctx.save();

  ctx.beginPath();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 3;

  ctx.arc(
    joystick.baseX,
    joystick.baseY,
    40,
    0,
    Math.PI * 2
  );

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
   DRAW ROOM NAME
-------------------------------------------------------------- */

function drawRoomName() {
  ctx.save();

  ctx.font = "18px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255,255,255,0.9)";

  ctx.fillText(
    currentRoom.name,
    12,
    42
  );

  ctx.restore();
}


/* --------------------------------------------------------------
   DRAW EVERYTHING
-------------------------------------------------------------- */

function draw() {
  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  ctx.fillStyle = currentRoom.bg;

  ctx.fillRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

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
   START KING DIALOGUE
-------------------------------------------------------------- */

function startKingDialogue() {
  const dialogueBox =
    document.getElementById("dialogueBox");

  const dialogueLine =
    document.getElementById("dialogueLine");

  if (!dialogueBox || !dialogueLine || !dlgBtn) {
    return;
  }

  king.currentLine = 0;
  king.active = true;
  king.talked = true;

  dialogueLine.textContent =
    king.dialogueLines[0];

  dialogueBox.style.display = "flex";

  dlgBtn.textContent = "Next";

  gamePaused = true;

  joystick.active = false;
  joystick.dx = 0;
  joystick.dy = 0;
}


/* --------------------------------------------------------------
   ADVANCE KING DIALOGUE
-------------------------------------------------------------- */

function advanceKingDialogue() {
  if (!king.active) return;

  king.currentLine++;

  const dialogueBox =
    document.getElementById("dialogueBox");

  const dialogueLine =
    document.getElementById("dialogueLine");

  if (
    king.currentLine >=
    king.dialogueLines.length
  ) {
    if (dialogueBox) {
      dialogueBox.style.display = "none";
    }

    gamePaused = false;
    king.active = false;

    if (dlgBtn) {
      dlgBtn.textContent = "Next";
    }

    showHealthBar = true;
    playerHealth = MAX_HEALTH;
    playerInvuln = 0;

    /*
       This check matters if the player already has
       20 points when receiving the health bar.
    */

    updateBuildingUnlocks();

    /*
       Reset timing so dialogue time is not counted
       as game time.
    */

    lastTime = performance.now();

    return;
  }

  if (dialogueLine) {
    dialogueLine.textContent =
      king.dialogueLines[king.currentLine];
  }

  if (dlgBtn) {
    const isLastLine =
      king.currentLine ===
      king.dialogueLines.length - 1;

    dlgBtn.textContent =
      isLastLine ? "Close" : "Next";
  }
}


/* --------------------------------------------------------------
   CHECK KING PROXIMITY
-------------------------------------------------------------- */

function checkKingProximity() {
  if (currentRoom !== rooms.buildingC) {
    return;
  }

  if (king.active) return;

  const kingCenterX =
    king.x + king.w / 2;

  const kingCenterY =
    king.y + king.h / 2;

  const playerCenterX =
    player.x + player.w / 2;

  const playerCenterY =
    player.y + player.h / 2;

  const distance = Math.hypot(
    kingCenterX - playerCenterX,
    kingCenterY - playerCenterY
  );

  const talkRange = 80;

  if (
    distance < talkRange &&
    !king.talked
  ) {
    startKingDialogue();
  }

  if (distance >= talkRange) {
    king.talked = false;
  }
}


/* --------------------------------------------------------------
   END GAME
-------------------------------------------------------------- */

function endGame(message) {
  running = false;

  if (anim !== null) {
    cancelAnimationFrame(anim);
    anim = null;
  }

  joystick.active = false;
  joystick.dx = 0;
  joystick.dy = 0;

  const finalElement =
    document.getElementById("final");

  const overlay =
    document.getElementById("overlay");

  if (finalElement) {
    finalElement.innerHTML = message;
  }

  if (overlay) {
    overlay.style.display = "flex";
  }
}


/* --------------------------------------------------------------
   PROCESS GAME OVER
-------------------------------------------------------------- */

function processGameOver() {
  const finalScore = kills;

  endGame(
    `You scored ${finalScore}.<br>` +
    "Hint: You need certain points to proceed in the game."
  );

  recordPlaySession(
    playerName,
    finalScore
  );

  refreshLeaderboard();
}


/* --------------------------------------------------------------
   MAIN GAME LOOP
-------------------------------------------------------------- */

function loop(timestamp) {
  if (!running) return;

  /*
     Freeze everything while dialogue is open
     or the browser tab is hidden.
  */

  if (gamePaused || pageHidden) {
    lastTime = timestamp;
    anim = requestAnimationFrame(loop);
    return;
  }

  /*
     Avoid a huge delta on the first frame.
  */

  if (!lastTime) {
    lastTime = timestamp;
  }

  /*
     Cap delta so returning from a slow frame
     does not instantly remove timers.
  */

  const delta = Math.min(
    timestamp - lastTime,
    50
  );

  lastTime = timestamp;

  if (player.flashTimer > 0) {
    player.flashTimer = Math.max(
      0,
      player.flashTimer - delta
    );
  }

  const scoreElement =
    document.getElementById("score");

  if (scoreElement) {
    scoreElement.textContent = String(kills);
  }

  updateBuildingUnlocks();

  const spawnInterval =
    getCurrentSpawnInterval();

  if (timestamp - lastSpawn > spawnInterval) {
    currentRoom.spawnEnemy();
    lastSpawn = timestamp;
  }

  updatePlayer();
  updateEnemies();
  handleEnemyCollisions();
  updateKillEffects(delta);
  checkDoorCollision();

  /*
     Damage handling
  */

  if (showHealthBar) {
    damagePlayer(delta);
  } else if (collide()) {
    processGameOver();
    return;
  }

  checkKingProximity();

  if (
    showHealthBar &&
    playerHealth <= 0
  ) {
    processGameOver();
    return;
  }

  draw();

  anim = requestAnimationFrame(loop);
}


/* --------------------------------------------------------------
   START OR RESTART GAME
-------------------------------------------------------------- */

function startGame() {
  if (!playerName) {
    askForName();
  }

  const overlay =
    document.getElementById("overlay");

  if (overlay) {
    overlay.style.display = "none";
  }

  if (anim !== null) {
    cancelAnimationFrame(anim);
    anim = null;
  }

  reset();

  running = true;

  /*
     performance.now() and requestAnimationFrame timestamps
     use the same timing system.
  */

  lastTime = performance.now();
  lastSpawn = lastTime;

  draw();

  anim = requestAnimationFrame(loop);
}


/* --------------------------------------------------------------
   POINTER POSITION
-------------------------------------------------------------- */

function getPointerPosition(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x:
      (event.clientX - rect.left) *
      canvas.width /
      rect.width,

    y:
      (event.clientY - rect.top) *
      canvas.height /
      rect.height
  };
}


/* --------------------------------------------------------------
   JOYSTICK POINTER DOWN
-------------------------------------------------------------- */

canvas.addEventListener(
  "pointerdown",
  (event) => {
    if (
      !running ||
      gamePaused ||
      pageHidden
    ) {
      return;
    }

    event.preventDefault();

    const position =
      getPointerPosition(event);

    joystick.active = true;

    joystick.baseX = position.x;
    joystick.baseY = position.y;

    joystick.dx = 0;
    joystick.dy = 0;

    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(
          event.pointerId
        );
      } catch (error) {
        console.warn(
          "Pointer capture failed:",
          error
        );
      }
    }
  }
);


/* --------------------------------------------------------------
   JOYSTICK POINTER MOVE
-------------------------------------------------------------- */

canvas.addEventListener(
  "pointermove",
  (event) => {
    if (!joystick.active) return;

    event.preventDefault();

    const position =
      getPointerPosition(event);

    let dx =
      position.x - joystick.baseX;

    let dy =
      position.y - joystick.baseY;

    const distance =
      Math.hypot(dx, dy);

    if (distance > joystick.max) {
      dx =
        (dx / distance) *
        joystick.max;

      dy =
        (dy / distance) *
        joystick.max;
    }

    joystick.dx = dx;
    joystick.dy = dy;
  }
);


/* --------------------------------------------------------------
   STOP JOYSTICK
-------------------------------------------------------------- */

function stopJoystick(event) {
  if (event) {
    event.preventDefault();
  }

  joystick.active = false;
  joystick.dx = 0;
  joystick.dy = 0;
}

canvas.addEventListener(
  "pointerup",
  stopJoystick
);

canvas.addEventListener(
  "pointercancel",
  stopJoystick
);

canvas.addEventListener(
  "pointerleave",
  (event) => {
    if (
      event.buttons === 0 ||
      event.pointerType === "mouse"
    ) {
      stopJoystick(event);
    }
  }
);


/* --------------------------------------------------------------
   FREEZE GAME WHEN TAB OR BROWSER IS HIDDEN

   This fixes the mobile-browser problem where
   the game freezes visually but timers keep moving.
-------------------------------------------------------------- */

document.addEventListener(
  "visibilitychange",
  () => {
    pageHidden = document.hidden;

    joystick.active = false;
    joystick.dx = 0;
    joystick.dy = 0;

    /*
       Reset lastTime on return so hidden time
       is not included in delta.
    */

    if (!pageHidden) {
      lastTime = performance.now();
      lastSpawn = lastTime;
    }
  }
);


/* --------------------------------------------------------------
   HANDLE WINDOW BLUR AND FOCUS
-------------------------------------------------------------- */

window.addEventListener(
  "blur",
  () => {
    pageHidden = true;

    joystick.active = false;
    joystick.dx = 0;
    joystick.dy = 0;
  }
);

window.addEventListener(
  "focus",
  () => {
    pageHidden = document.hidden;

    lastTime = performance.now();
    lastSpawn = lastTime;
  }
);


/* --------------------------------------------------------------
   KEEP CANVAS ASPECT RATIO
-------------------------------------------------------------- */

function resize() {
  const maxWidth = Math.min(
    window.innerWidth,
    540
  );

  canvas.style.width =
    `${maxWidth}px`;

  canvas.style.height =
    `${maxWidth * 1170 / 540}px`;
}

window.addEventListener(
  "resize",
  resize
);

resize();


/* --------------------------------------------------------------
   KEYBOARD FALLBACK FOR DIALOGUE
-------------------------------------------------------------- */

window.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key !== "e" &&
      event.key !== "E"
    ) {
      return;
    }

    const dialogueBox =
      document.getElementById("dialogueBox");

    if (
      dialogueBox &&
      dialogueBox.style.display !== "none"
    ) {
      advanceKingDialogue();
    }
  }
);


/* --------------------------------------------------------------
   PAGE LOAD
-------------------------------------------------------------- */

window.addEventListener(
  "load",
  async () => {
    const storedName =
      localStorage.getItem(
        "survivalPlayerName"
      );

    if (storedName) {
      playerName = storedName;

      const playerNameElement =
        document.getElementById(
          "playerName"
        );

      if (playerNameElement) {
        playerNameElement.textContent =
          playerName;
      }
    }

    const dialogueBox =
      document.getElementById(
        "dialogueBox"
      );

    if (dialogueBox) {
      dialogueBox.style.display = "none";
    }

    dlgBtn =
      document.getElementById(
        "dialogueNext"
      );

    if (dlgBtn) {
      dlgBtn.addEventListener(
        "click",
        advanceKingDialogue
      );
    }

    const retryButton =
      document.getElementById("retry");

    if (retryButton) {
      retryButton.addEventListener(
        "click",
        startGame
      );
    }

    await refreshLeaderboard();

    startGame();
  }
);


/* --------------------------------------------------------------
   SERVICE WORKER
-------------------------------------------------------------- */

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .catch((error) => {
      console.warn(
        "Service worker registration failed:",
        error
      );
    });
}


/* --------------------------------------------------------------
   OPTIONAL HTML ACCESS
-------------------------------------------------------------- */

window.startGame = startGame;
window.advanceKingDialogue = advanceKingDialogue;
