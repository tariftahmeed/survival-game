/* ==============================================================
   MAIN.JS - Hungry Reds

   Sprite handling:
   - Reads individual sprite images from chars.json.
   - Does not crop chars.png into 64 x 64 rectangles.
   - Each animation frame displays exactly one sprite.
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
   SPRITE SETTINGS

   chars.json contains 73 individual images:

   sprite_1.png  -> array index 0
   sprite_2.png  -> array index 1
   ...
   sprite_73.png -> array index 72

   Based on the visible grouping in the supplied sprite sheet:

   0-22  = small orange character
   23-45 = armored character
   46-68 = green character
   69-72 = small green creature

   Start with four frames per animated character. The arrays can
   later be changed if different rows should be used.
-------------------------------------------------------------- */

let sheetInfo = null;
const spriteImages = [];

/*
   These are zero-based sprite indexes.

   For example:
   0 means sprite_1.png
   23 means sprite_24.png
   46 means sprite_47.png
   69 means sprite_70.png
*/

const spriteAnimations = {
  player: [0, 1, 2, 3],
  king: [23],
  monster: [46, 47, 48, 49],
  virus: [69, 70, 71, 72]
};

/* --------------------------------------------------------------
   LOAD SPRITES FROM JSON
-------------------------------------------------------------- */

async function loadSpriteSheet() {
  const response = await fetch("assets/sprites/chars.json", {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      `Could not load chars.json. HTTP status: ${response.status}`
    );
  }

  sheetInfo = await response.json();

  const sprites = sheetInfo?.layers
    ?.flatMap(layer => layer.sprites ?? []);

  if (!Array.isArray(sprites) || sprites.length === 0) {
    throw new Error(
      "chars.json does not contain any sprites."
    );
  }

  await Promise.all(
    sprites.map((spriteData, index) => {
      return new Promise((resolve, reject) => {
        const image = new Image();

        image.onload = () => {
          spriteImages[index] = image;
          resolve();
        };

        image.onerror = () => {
          reject(
            new Error(
              `Could not load ${spriteData.name ?? `sprite ${index + 1}`}`
            )
          );
        };

        image.src = spriteData.base64;
      });
    })
  );

  ctx.imageSmoothingEnabled = false;

  console.log(
    `Loaded ${spriteImages.length} individual sprite images.`
  );

  console.table(
    sprites.map((sprite, index) => ({
      index,
      filename: sprite.name,
      width: sprite.width,
      height: sprite.height
    }))
  );
}

/* --------------------------------------------------------------
   SPRITE HELPERS
-------------------------------------------------------------- */

function getAnimationFrameCount(name) {
  const animation = spriteAnimations[name];

  if (!Array.isArray(animation) || animation.length === 0) {
    return 1;
  }

  return animation.length;
}

function getSpriteImage(name, frameIndex = 0) {
  const animation = spriteAnimations[name];

  if (!Array.isArray(animation) || animation.length === 0) {
    console.warn(`No sprite animation defined for "${name}".`);
    return null;
  }

  const safeFrame = Number.isFinite(frameIndex)
    ? Math.floor(frameIndex)
    : 0;

  const wrappedFrame =
    ((safeFrame % animation.length) + animation.length) %
    animation.length;

  const spriteIndex = animation[wrappedFrame];
  const image = spriteImages[spriteIndex];

  if (!image) {
    console.warn(
      `Sprite ${spriteIndex + 1} for "${name}" has not loaded.`
    );

    return null;
  }

  return image;
}

/*
   Draws one individual sprite.

   The sprite:
   - keeps its original aspect ratio;
   - is centered horizontally;
   - is aligned to the bottom of its game rectangle;
   - is enlarged using nearest-neighbour rendering.
*/

function drawSprite(
  name,
  frameIndex,
  dx,
  dy,
  dw = 64,
  dh = 64
) {
  const image = getSpriteImage(name, frameIndex);

  if (!image) return;

  const sourceWidth =
    image.naturalWidth || image.width;

  const sourceHeight =
    image.naturalHeight || image.height;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return;
  }

  const scale = Math.min(
    dw / sourceWidth,
    dh / sourceHeight
  );

  const drawWidth = Math.max(
    1,
    Math.round(sourceWidth * scale)
  );

  const drawHeight = Math.max(
    1,
    Math.round(sourceHeight * scale)
  );

  const drawX = Math.round(
    dx + (dw - drawWidth) / 2
  );

  const drawY = Math.round(
    dy + dh - drawHeight
  );

  ctx.drawImage(
    image,
    0,
    0,
    sourceWidth,
    sourceHeight,
    drawX,
    drawY,
    drawWidth,
    drawHeight
  );
}

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
   BUILDING STATE
-------------------------------------------------------------- */

let buildingCAdded = false;
let buildingDAdded = false;

/* --------------------------------------------------------------
   PLAYER HEALTH
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

const NORMAL_ENEMY_SIZE = 64;
const NORMAL_ENEMY_SPEED = 1.6;

const GERM_START_SIZE = 64;
const GERM_MAX_SIZE = 90;
const GERM_START_SPEED = 1.35;
const GERM_START_HEALTH = 2;

/* --------------------------------------------------------------
   JOYSTICK
-------------------------------------------------------------- */

const joystick = {
  active: false,
  baseX: 0,
  baseY: 0,
  dx: 0,
  dy: 0,
  max: 60
};

/* --------------------------------------------------------------
   KING
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
   FIREBASE FUNCTIONS
-------------------------------------------------------------- */

async function recordPlaySession(name, score) {
  try {
    await addDoc(scoresCol, {
      name,
      score,
      playedAt: serverTimestamp()
    });
  } catch (error) {
    console.warn(
      "Failed to write play session:",
      error
    );
  }
}

async function fetchTop3() {
  try {
    const scoreQuery = query(
      scoresCol,
      orderBy("score", "desc"),
      limit(3)
    );

    const snapshot = await getDocs(scoreQuery);
    const list = [];

    snapshot.forEach(documentSnapshot => {
      const data = documentSnapshot.data();

      list.push({
        name: data.name,
        score: data.score
      });
    });

    return list;
  } catch (error) {
    console.warn(
      "Failed to fetch leaderboard:",
      error
    );

    return [];
  }
}

async function refreshLeaderboard() {
  const topPlayers = await fetchTop3();
  const leaderboard =
    document.getElementById("topList");

  if (!leaderboard) return;

  leaderboard.innerHTML = "";

  topPlayers.forEach(entry => {
    const item = document.createElement("li");

    item.textContent =
      `${entry.name}: ${entry.score}`;

    leaderboard.appendChild(item);
  });
}

/* --------------------------------------------------------------
   PLAYER NAME
-------------------------------------------------------------- */

function askForName() {
  const storedName =
    localStorage.getItem("survivalPlayerName");

  if (storedName) {
    playerName = storedName;
  } else {
    let enteredName = "";

    while (!enteredName.trim()) {
      enteredName =
        prompt(
          "Enter your name. It will appear on the global leaderboard."
        ) || "";
    }

    playerName = enteredName.trim();

    localStorage.setItem(
      "survivalPlayerName",
      playerName
    );
  }

  const playerNameElement =
    document.getElementById("playerName");

  if (playerNameElement) {
    playerNameElement.textContent = playerName;
  }
}

/* --------------------------------------------------------------
   COLLISION
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
   RANDOM EDGE POSITION
-------------------------------------------------------------- */

function getEdgeSpawnPosition(size) {
  const side = Math.floor(Math.random() * 4);

  let x = 0;
  let y = 0;

  if (side === 0) {
    x =
      Math.random() *
      Math.max(1, canvas.width - size);

    y = -size;
  } else if (side === 1) {
    x = canvas.width + size;

    y =
      Math.random() *
      Math.max(1, canvas.height - size);
  } else if (side === 2) {
    x =
      Math.random() *
      Math.max(1, canvas.width - size);

    y = canvas.height + size;
  } else {
    x = -size;

    y =
      Math.random() *
      Math.max(1, canvas.height - size);
  }

  return { x, y };
}

/* --------------------------------------------------------------
   ENEMY SPAWNING
-------------------------------------------------------------- */

function spawnEnemy() {
  const position =
    getEdgeSpawnPosition(NORMAL_ENEMY_SIZE);

  enemies.push({
    type: "normal",

    x: position.x,
    y: position.y,

    w: NORMAL_ENEMY_SIZE,
    h: NORMAL_ENEMY_SIZE,

    s: NORMAL_ENEMY_SPEED,

    animTimer: 0,
    animFrame: 0,
    animFps: 6,
    animFrames:
      getAnimationFrameCount("monster")
  });
}

function spawnGermEnemy() {
  const position =
    getEdgeSpawnPosition(GERM_START_SIZE);

  enemies.push({
    type: "germ",

    x: position.x,
    y: position.y,

    w: GERM_START_SIZE,
    h: GERM_START_SIZE,

    s: GERM_START_SPEED,

    health: GERM_START_HEALTH,
    initialHealth: GERM_START_HEALTH,
    maxSize: GERM_MAX_SIZE,

    animTimer: 0,
    animFrame: 0,
    animFps: 8,
    animFrames:
      getAnimationFrameCount("virus")
  });
}

/* --------------------------------------------------------------
   ROOMS
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
    }
  }
};

let currentRoom = rooms.world;

/* --------------------------------------------------------------
   RESET
-------------------------------------------------------------- */

function resetWorldBuildings() {
  rooms.world.doors =
    rooms.world.doors.filter(
      door =>
        door.id !== "buildingC" &&
        door.id !== "buildingD"
    );

  buildingCAdded = false;
  buildingDAdded = false;
}

function reset() {
  resetWorldBuildings();

  currentRoom = rooms.world;

  player = {
    x: 220,
    y: 330,

    w: 64,
    h: 64,

    speed: 4.5,
    flashTimer: 0,

    animTimer: 0,
    animFrame: 0,
    animFps: 8,
    animFrames:
      getAnimationFrameCount("player")
  };

  enemies = [];
  killEffects = [];

  kills = 0;

  playerHealth = MAX_HEALTH;
  showHealthBar = false;
  playerInvuln = 0;

  lastSpawn = 0;
  lastTime = 0;

  running = false;
  gamePaused = false;
  pageHidden = document.hidden;

  joystick.active = false;
  joystick.dx = 0;
  joystick.dy = 0;

  king.currentLine = 0;
  king.active = false;
  king.placed = false;
  king.talked = false;

  const dialogueBox =
    document.getElementById("dialogueBox");

  if (dialogueBox) {
    dialogueBox.style.display = "none";
  }

  const scoreElement =
    document.getElementById("score");

  if (scoreElement) {
    scoreElement.textContent = "0";
  }
}

/* --------------------------------------------------------------
   ANIMATION UPDATE HELPER
-------------------------------------------------------------- */

function updateAnimation(entity, delta) {
  if (
    !entity ||
    entity.animFrames <= 1 ||
    entity.animFps <= 0
  ) {
    if (entity) {
      entity.animFrame = 0;
    }

    return;
  }

  entity.animTimer += delta;

  const frameDuration =
    1000 / entity.animFps;

  while (entity.animTimer >= frameDuration) {
    entity.animTimer -= frameDuration;

    entity.animFrame =
      (entity.animFrame + 1) %
      entity.animFrames;
  }
}

/* --------------------------------------------------------------
   PLAYER UPDATE
-------------------------------------------------------------- */

function updatePlayer(delta) {
  let moving = false;

  if (joystick.active) {
    const magnitude =
      Math.hypot(joystick.dx, joystick.dy);

    if (magnitude > 2) {
      moving = true;

      player.x +=
        (joystick.dx / magnitude) *
        player.speed;

      player.y +=
        (joystick.dy / magnitude) *
        player.speed;
    }
  }

  if (moving) {
    updateAnimation(player, delta);
  } else {
    player.animFrame = 0;
    player.animTimer = 0;
  }

  player.x = Math.max(
    0,
    Math.min(
      canvas.width - player.w,
      player.x
    )
  );

  player.y = Math.max(
    0,
    Math.min(
      canvas.height - player.h,
      player.y
    )
  );
}

/* --------------------------------------------------------------
   ENEMY UPDATE
-------------------------------------------------------------- */

function updateEnemies(delta) {
  enemies.forEach(enemy => {
    const enemyCenterX =
      enemy.x + enemy.w / 2;

    const enemyCenterY =
      enemy.y + enemy.h / 2;

    const playerCenterX =
      player.x + player.w / 2;

    const playerCenterY =
      player.y + player.h / 2;

    const differenceX =
      playerCenterX - enemyCenterX;

    const differenceY =
      playerCenterY - enemyCenterY;

    const distance =
      Math.hypot(
        differenceX,
        differenceY
      ) || 1;

    enemy.x +=
      (differenceX / distance) *
      enemy.s;

    enemy.y +=
      (differenceY / distance) *
      enemy.s;

    updateAnimation(enemy, delta);
  });
}

/* --------------------------------------------------------------
   VISUAL EFFECTS
-------------------------------------------------------------- */

function createEffect(
  x,
  y,
  emoji,
  duration = 250
) {
  killEffects.push({
    x,
    y,
    emoji,
    ttl: duration,
    maxTtl: duration
  });
}

function updateKillEffects(delta) {
  for (
    let index = killEffects.length - 1;
    index >= 0;
    index--
  ) {
    killEffects[index].ttl -= delta;

    if (killEffects[index].ttl <= 0) {
      killEffects.splice(index, 1);
    }
  }
}

function drawKillEffects() {
  ctx.save();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "32px Arial";

  killEffects.forEach(effect => {
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
   ENEMY COLLISIONS
-------------------------------------------------------------- */

function handleEnemyCollisions() {
  const toRemove = new Set();

  for (
    let firstIndex = 0;
    firstIndex < enemies.length;
    firstIndex++
  ) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < enemies.length;
      secondIndex++
    ) {
      if (
        toRemove.has(firstIndex) ||
        toRemove.has(secondIndex)
      ) {
        continue;
      }

      const first = enemies[firstIndex];
      const second = enemies[secondIndex];

      if (!rectanglesTouch(first, second)) {
        continue;
      }

      if (
        first.type === "normal" &&
        second.type === "normal"
      ) {
        const effectX =
          (first.x + second.x) / 2 +
          first.w / 2;

        const effectY =
          (first.y + second.y) / 2 +
          first.h / 2;

        toRemove.add(firstIndex);
        toRemove.add(secondIndex);

        kills++;

        createEffect(
          effectX,
          effectY,
          "⚔️",
          250
        );

        continue;
      }

      if (
        first.type === "germ" &&
        second.type === "germ"
      ) {
        let absorber;
        let absorbed;
        let absorbedIndex;

        if (first.w >= second.w) {
          absorber = first;
          absorbed = second;
          absorbedIndex = secondIndex;
        } else {
          absorber = second;
          absorbed = first;
          absorbedIndex = firstIndex;
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

        absorber.x =
          centerX - newSize / 2;

        absorber.y =
          centerY - newSize / 2;

        if (newSize >= absorber.maxSize) {
          toRemove.add(
            enemies.indexOf(absorber)
          );

          kills += 100;

          createEffect(
            centerX,
            centerY,
            "☠️",
            350
          );
        } else {
          absorber.health += Math.max(
            1,
            Math.ceil(absorbed.health * 0.5)
          );
        }

        absorber.s = Math.max(
          0.65,
          GERM_START_SPEED -
          (newSize - GERM_START_SIZE) *
          0.009
        );

        toRemove.add(absorbedIndex);

        createEffect(
          absorber.x + absorber.w / 2,
          absorber.y + absorber.h / 2,
          "🧬",
          300
        );
      }
    }
  }

  enemies = enemies.filter(
    (_, index) => !toRemove.has(index)
  );
}

/* --------------------------------------------------------------
   HEALTH
-------------------------------------------------------------- */

function drawHealthBar() {
  if (!showHealthBar) return;

  const barWidth = 200;
  const barHeight = 20;

  const x =
    (canvas.width - barWidth) / 2;

  const y = 12;

  const healthPercentage = Math.max(
    0,
    playerHealth / MAX_HEALTH
  );

  ctx.save();

  ctx.fillStyle = "#555";
  ctx.fillRect(
    x,
    y,
    barWidth,
    barHeight
  );

  ctx.fillStyle = "#00ff00";
  ctx.fillRect(
    x,
    y,
    barWidth * healthPercentage,
    barHeight
  );

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;

  ctx.strokeRect(
    x,
    y,
    barWidth,
    barHeight
  );

  ctx.font = "14px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";

  ctx.fillText(
    `${Math.max(0, playerHealth)} / ${MAX_HEALTH}`,
    canvas.width / 2,
    y + barHeight / 2
  );

  ctx.restore();
}

function pushGermAwayFromPlayer(germ) {
  const playerCenterX =
    player.x + player.w / 2;

  const playerCenterY =
    player.y + player.h / 2;

  const germCenterX =
    germ.x + germ.w / 2;

  const germCenterY =
    germ.y + germ.h / 2;

  let differenceX =
    germCenterX - playerCenterX;

  let differenceY =
    germCenterY - playerCenterY;

  let distance =
    Math.hypot(
      differenceX,
      differenceY
    );

  if (distance === 0) {
    differenceX = Math.random() - 0.5;
    differenceY = Math.random() - 0.5;

    distance =
      Math.hypot(
        differenceX,
        differenceY
      ) || 1;
  }

  germ.x +=
    (differenceX / distance) * 30;

  germ.y +=
    (differenceY / distance) * 30;
}

function damagePlayer(delta) {
  if (!showHealthBar) return;

  if (playerInvuln > 0) {
    playerInvuln = Math.max(
      0,
      playerInvuln - delta
    );

    return;
  }

  for (
    let index = enemies.length - 1;
    index >= 0;
    index--
  ) {
    const enemy = enemies[index];

    if (!rectanglesTouch(player, enemy)) {
      continue;
    }

    playerHealth--;
    playerInvuln = INVULN_TIME;
    player.flashTimer = INVULN_TIME;

    if (enemy.type === "germ") {
      enemy.health--;

      createEffect(
        enemy.x + enemy.w / 2,
        enemy.y + enemy.h / 2,
        "💥",
        220
      );

      if (enemy.health <= 0) {
        const deathX =
          enemy.x + enemy.w / 2;

        const deathY =
          enemy.y + enemy.h / 2;

        enemies.splice(index, 1);
        kills += 10;

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

    break;
  }
}

function collide() {
  return enemies.some(
    enemy =>
      rectanglesTouch(player, enemy)
  );
}

/* --------------------------------------------------------------
   BUILDING UNLOCKS
-------------------------------------------------------------- */

function maybeAddBuildingC() {
  if (buildingCAdded || kills < 10) {
    return;
  }

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

function maybeAddBuildingD() {
  if (
    buildingDAdded ||
    !showHealthBar
  ) {
    return;
  }

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
   KING PLACEMENT
-------------------------------------------------------------- */

function maybePlaceKing() {
  if (king.placed) return;

  king.x =
    canvas.width / 2 - king.w / 2;

  king.y =
    canvas.height / 2 -
    king.h / 2 -
    250;

  king.placed = true;
}

/* --------------------------------------------------------------
   ROOMS AND DOORS
-------------------------------------------------------------- */

function enterRoom(targetRoomName) {
  const targetRoom =
    rooms[targetRoomName];

  if (!targetRoom) return;

  currentRoom = targetRoom;

  enemies = [];
  lastSpawn = 0;

  player.x =
    canvas.width / 2 - player.w / 2;

  player.y =
    canvas.height / 2 - player.h / 2;

  joystick.active = false;
  joystick.dx = 0;
  joystick.dy = 0;

  if (currentRoom === rooms.buildingC) {
    maybePlaceKing();
  }

  if (currentRoom === rooms.world) {
    king.talked = false;

    maybeAddBuildingC();
    maybeAddBuildingD();
  }
}

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

function getCurrentSpawnInterval() {
  if (currentRoom === rooms.buildingD) {
    return GERM_ENEMY_SPAWN_INTERVAL;
  }

  return NORMAL_ENEMY_SPAWN_INTERVAL;
}

/* --------------------------------------------------------------
   DRAW BACKGROUND
-------------------------------------------------------------- */

function drawGrid() {
  ctx.save();

  ctx.strokeStyle =
    "rgba(255,255,255,0.08)";

  ctx.lineWidth = 1;

  for (
    let x = 0;
    x < canvas.width;
    x += 40
  ) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  for (
    let y = 0;
    y < canvas.height;
    y += 40
  ) {
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
  currentRoom.doors.forEach(door => {
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
   DRAW DECOR
-------------------------------------------------------------- */

function drawDecor() {
  if (!currentRoom.decor) return;

  ctx.save();

  ctx.font = "36px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  currentRoom.decor.forEach(item => {
    ctx.fillText(
      item.emoji,
      item.x,
      item.y
    );
  });

  ctx.restore();
}

/* --------------------------------------------------------------
   DRAW CHARACTERS
-------------------------------------------------------------- */

function drawPlayer() {
  ctx.save();

  if (player.flashTimer > 0) {
    const flashing =
      Math.floor(
        player.flashTimer / 100
      ) % 2 === 0;

    ctx.globalAlpha =
      flashing ? 0.35 : 1;
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

function drawKing() {
  if (currentRoom !== rooms.buildingC) {
    return;
  }

  drawSprite(
    "king",
    0,
    king.x,
    king.y,
    king.w,
    king.h
  );
}

function drawEnemies() {
  enemies.forEach(enemy => {
    ctx.save();

    const spriteName =
      enemy.type === "germ"
        ? "virus"
        : "monster";

    drawSprite(
      spriteName,
      enemy.animFrame,
      enemy.x,
      enemy.y,
      enemy.w,
      enemy.h
    );

    if (enemy.type === "germ") {
      const barWidth = Math.max(
        24,
        Math.min(enemy.w, 70)
      );

      const maximumHealth = Math.max(
        enemy.initialHealth,
        enemy.health
      );

      const healthRatio = Math.max(
        0,
        Math.min(
          1,
          enemy.health / maximumHealth
        )
      );

      const barX =
        enemy.x +
        enemy.w / 2 -
        barWidth / 2;

      const barY = enemy.y - 8;

      ctx.fillStyle =
        "rgba(0,0,0,0.55)";

      ctx.fillRect(
        barX,
        barY,
        barWidth,
        5
      );

      ctx.fillStyle = "#aaff55";

      ctx.fillRect(
        barX,
        barY,
        barWidth * healthRatio,
        5
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

  ctx.strokeStyle =
    "rgba(255,255,255,0.4)";

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

  ctx.fillStyle =
    "rgba(255,255,255,0.5)";

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

  ctx.fillStyle =
    "rgba(255,255,255,0.9)";

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
  ctx.imageSmoothingEnabled = false;

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
   KING DIALOGUE
-------------------------------------------------------------- */

function startKingDialogue() {
  const dialogueBox =
    document.getElementById("dialogueBox");

  const dialogueLine =
    document.getElementById("dialogueLine");

  if (
    !dialogueBox ||
    !dialogueLine ||
    !dlgBtn
  ) {
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

function advanceKingDialogue() {
  if (!king.active) return;

  king.currentLine++;

  const dialogueBox =
    document.getElementById("dialogueBox");

  const dialogueLine =
    document.getElementById("dialogueLine");

  if (!dialogueBox || !dialogueLine) {
    return;
  }

  if (
    king.currentLine >=
    king.dialogueLines.length
  ) {
    dialogueBox.style.display = "none";

    gamePaused = false;
    king.active = false;

    if (dlgBtn) {
      dlgBtn.textContent = "Next";
    }

    showHealthBar = true;
    playerHealth = MAX_HEALTH;
    playerInvuln = 0;

    maybeAddBuildingD();

    lastTime = performance.now();

    return;
  }

  dialogueLine.textContent =
    king.dialogueLines[
      king.currentLine
    ];

  if (dlgBtn) {
    dlgBtn.textContent =
      king.currentLine ===
      king.dialogueLines.length - 1
        ? "Close"
        : "Next";
  }
}

function checkKingProximity() {
  if (
    currentRoom !== rooms.buildingC ||
    king.active
  ) {
    return;
  }

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
   GAME OVER
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
   GAME LOOP
-------------------------------------------------------------- */

function loop(timestamp) {
  if (!running) return;

  if (gamePaused || pageHidden) {
    lastTime = timestamp;
    anim = requestAnimationFrame(loop);
    return;
  }

  if (!lastTime) {
    lastTime = timestamp;
  }

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
    scoreElement.textContent =
      String(kills);
  }

  maybeAddBuildingC();
  maybeAddBuildingD();

  if (
    timestamp - lastSpawn >
    getCurrentSpawnInterval()
  ) {
    currentRoom.spawnEnemy();
    lastSpawn = timestamp;
  }

  updatePlayer(delta);
  updateEnemies(delta);

  handleEnemyCollisions();
  updateKillEffects(delta);
  checkDoorCollision();

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
   START GAME
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

  lastTime = performance.now();
  lastSpawn = lastTime;

  draw();

  anim = requestAnimationFrame(loop);
}

/* --------------------------------------------------------------
   POINTER POSITION
-------------------------------------------------------------- */

function getPointerPosition(event) {
  const rectangle =
    canvas.getBoundingClientRect();

  return {
    x:
      (event.clientX - rectangle.left) *
      canvas.width /
      rectangle.width,

    y:
      (event.clientY - rectangle.top) *
      canvas.height /
      rectangle.height
  };
}

/* --------------------------------------------------------------
   JOYSTICK EVENTS
-------------------------------------------------------------- */

canvas.addEventListener(
  "pointerdown",
  event => {
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
          "setPointerCapture failed:",
          error
        );
      }
    }
  }
);

canvas.addEventListener(
  "pointermove",
  event => {
    if (!joystick.active) return;

    event.preventDefault();

    const position =
      getPointerPosition(event);

    let differenceX =
      position.x - joystick.baseX;

    let differenceY =
      position.y - joystick.baseY;

    const distance =
      Math.hypot(
        differenceX,
        differenceY
      );

    if (distance > joystick.max) {
      differenceX =
        (differenceX / distance) *
        joystick.max;

      differenceY =
        (differenceY / distance) *
        joystick.max;
    }

    joystick.dx = differenceX;
    joystick.dy = differenceY;
  }
);

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
  event => {
    if (
      event.buttons === 0 ||
      event.pointerType === "mouse"
    ) {
      stopJoystick(event);
    }
  }
);

/* --------------------------------------------------------------
   VISIBILITY
-------------------------------------------------------------- */

document.addEventListener(
  "visibilitychange",
  () => {
    pageHidden = document.hidden;

    joystick.active = false;
    joystick.dx = 0;
    joystick.dy = 0;

    if (!pageHidden) {
      lastTime = performance.now();
      lastSpawn = lastTime;
    }
  }
);

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
   RESPONSIVE CANVAS
-------------------------------------------------------------- */

function resize() {
  const maximumWidth = Math.min(
    window.innerWidth,
    540
  );

  canvas.style.width =
    `${maximumWidth}px`;

  canvas.style.height =
    `${maximumWidth * 1170 / 540}px`;

  ctx.imageSmoothingEnabled = false;
}

window.addEventListener(
  "resize",
  resize
);

resize();

/* --------------------------------------------------------------
   KEYBOARD DIALOGUE CONTROL
-------------------------------------------------------------- */

window.addEventListener(
  "keydown",
  event => {
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
   PAGE INITIALIZATION
-------------------------------------------------------------- */

window.addEventListener(
  "load",
  async () => {
    try {
      await loadSpriteSheet();

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
        dialogueBox.style.display =
          "none";
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
    } catch (error) {
      console.error(
        "Game initialization failed:",
        error
      );

      const finalElement =
        document.getElementById("final");

      const overlay =
        document.getElementById("overlay");

      if (finalElement) {
        finalElement.textContent =
          "The sprites could not be loaded. " +
          "Open the browser console for details.";
      }

      if (overlay) {
        overlay.style.display = "flex";
      }
    }
  }
);

/* --------------------------------------------------------------
   SERVICE WORKER
-------------------------------------------------------------- */

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .catch(error => {
      console.warn(
        "Service worker registration failed:",
        error
      );
    });
}

/* --------------------------------------------------------------
   DEBUG ACCESS
-------------------------------------------------------------- */

window.startGame = startGame;

window.advanceKingDialogue =
  advanceKingDialogue;

window.spriteImages = spriteImages;

window.spriteAnimations =
  spriteAnimations;
