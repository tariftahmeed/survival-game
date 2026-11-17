/* ==============================================================
   WORLD.JS – tileset, town map, interior floor and buildings
   Uses assets/tiles/tilemap_packed.png (Kenney Tiny Town style,
   16x16 tiles, 12 columns x 11 rows)
   ============================================================== */

/* --------------------------------------------------------------
   SETTINGS
-------------------------------------------------------------- */
export const TILE = 45;      // tile size on screen (540 / 12 columns)
const SRC         = 16;      // tile size inside the image
const SHEET_COLS  = 12;      // tile columns in the sheet
export const MAP_COLS = 12;  // 12 * 45 = 540
export const MAP_ROWS = 26;  // 26 * 45 = 1170

/* --------------------------------------------------------------
   SETUP: main.js hands over the canvas context once
-------------------------------------------------------------- */
let ctx = null;
export function initWorld(context) {
  ctx = context;
}

/* --------------------------------------------------------------
   TILESET LOADING + DRAWING
-------------------------------------------------------------- */
const townSheet = new Image();
export function loadTownSheet() {
  return new Promise((resolve, reject) => {
    townSheet.onload  = resolve;
    townSheet.onerror = () => reject(new Error("Could not load assets/tiles/tilemap_packed.png"));
    townSheet.src = "assets/tiles/tilemap_packed.png";
  });
}

export function drawTile(id, dx, dy, dw = TILE, dh = TILE) {
  ctx.drawImage(
    townSheet,
    (id % SHEET_COLS) * SRC, Math.floor(id / SHEET_COLS) * SRC, SRC, SRC,
    dx, dy, dw, dh
  );
}

/* --------------------------------------------------------------
   WORLD MAP (ground + solid scenery)
   . grass   = path   T tree (solid)   b bush (solid)   = path
   12 columns x 26 rows
-------------------------------------------------------------- */
const legend = {
  ".": { id: 0 },
  "=": { id: 25 },
  "T": { id: 28, solid: true },
  "b": { id: 5,  solid: true }
};

const worldMap = [
  "TTTTTTTTTTTT",
  "T..........T",
  "T..T....b..T",
  "T..........T",
  "T.b......T.T",
  "T..........T",
  "T..........T",
  "T..........T",
  "T..........T",
  "T.=......=.T",
  "T==========T",
  "T....==....T",
  "T....==....T",
  "T....==....T",
  "T....==....T",
  "T....==....T",
  "T....==....T",
  "T....=====.T",
  "T....==....T",
  "T....==....T",
  "T....==....T",
  "T....==....T",
  "T....==....T",
  "T.=====....T",
  "T..........T",
  "TTTTTTTTTTTT"
];

export function drawWorldTiles() {
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const t = legend[worldMap[r][c]] ?? legend["."];
      const dx = c * TILE, dy = r * TILE;
      drawTile(0, dx, dy);                 // grass underneath everything
      if (t.id !== 0) drawTile(t.id, dx, dy);
    }
  }
}

/* True if the tile at (col,row) blocks movement (trees, bushes, off the map) */
export function isSolidTile(col, row) {
  const ch = worldMap[row]?.[col];
  return ch === undefined || !!legend[ch]?.solid;
}

/* --------------------------------------------------------------
   INTERIOR FLOOR: 9-slice of the framed stone floor, tinted per room
-------------------------------------------------------------- */
export function drawInteriorFloor(tint) {
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      const row = r === 0 ? 0 : (r === MAP_ROWS - 1 ? 2 : 1);
      const col = c === 0 ? 0 : (c === MAP_COLS - 1 ? 2 : 1);
      drawTile(96 + row * 12 + col, c * TILE, r * TILE);
    }
  }
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/* --------------------------------------------------------------
   BUILDINGS (made of tiles; solid body + door trigger)
   tiles = 3 columns x 3 rows. Middle column of the bottom row is the door.
-------------------------------------------------------------- */
const RED_ROOF  = [[52,53,54],[64,65,66]];
const GREY_ROOF = [[48,49,50],[60,61,62]];

function makeBuilding(target, tx, ty, tiles, appears = () => true) {
  const w = tiles[0].length * TILE;
  const h = tiles.length * TILE;
  return {
    target, tiles, appears,
    x: tx * TILE, y: ty * TILE, w, h,
    // solid part: everything except the top (roof) row, so the roof can overlap the player
    body: { ox: 0, oy: TILE, w, h: h - TILE },
    // door trigger: straddles the bottom edge of the door tile
    door: { ox: TILE, oy: h - TILE / 2, w: TILE, h: TILE }
  };
}

/* main.js passes in the rules for when the two late-game houses appear,
   so this file never needs to know about kills or the health bar. */
export function createBuildings({
  castleUnlocked   = () => true,
  germHouseUnlocked = () => true
} = {}) {
  return [
    // A – red house with a plain door
    makeBuilding("buildingA", 1, 6,  [...RED_ROOF,  [72,85,75]]),
    // B – red house with a window (monster arena)
    makeBuilding("buildingB", 8, 14, [...RED_ROOF,  [84,85,75]]),
    // C – grey castle house (the king)
    makeBuilding("buildingC", 1, 20, [...GREY_ROOF, [88,89,79]], castleUnlocked),
    // D – grey house (germs)
    makeBuilding("buildingD", 8, 6,  [...GREY_ROOF, [76,89,79]], germHouseUnlocked)
  ];
}

export const bodyRect = b => ({ x: b.x + b.body.ox, y: b.y + b.body.oy, w: b.body.w, h: b.body.h });
export const doorRect = b => ({ x: b.x + b.door.ox, y: b.y + b.door.oy, w: b.door.w, h: b.door.h });

export function drawBuilding(b) {
  b.tiles.forEach((row, r) => row.forEach((id, c) => {
    drawTile(id, b.x + c * TILE, b.y + r * TILE);
  }));
}
