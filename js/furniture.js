/* ==============================================================
   FURNITURE.JS – interior decoration for Hungry Reds
   Uses assets/tiles/interior_tileset.png (16 x 16 tiles of 32px)
   ============================================================== */

const TILE   = 45;   // on-screen tile size (same as main.js)
const IN_SRC = 32;   // tile size inside interior_tileset.png
const IN_COLS = 16;  // tiles per row in the sheet

const interiorSheet = new Image();
export function loadInteriorSheet() {
  return new Promise((resolve, reject) => {
    interiorSheet.onload  = resolve;
    interiorSheet.onerror = () => reject(new Error("Could not load assets/tiles/interior_tileset.png"));
    interiorSheet.src = "assets/tiles/interior_tileset.png";
  });
}

/* F(tileId, widthInTiles, heightInTiles, col, row, flags)
   col/row are in 45px screen tiles (decimals allowed).
   flags: "s" = solid (blocks the player), "f" = floor layer (rugs, drawn under everything),
          "o" = overhead layer (chandeliers, drawn over the player) */
function F(id, w, h, c, r, flags = "") {
  return {
    id, w, h, x: c * TILE, y: r * TILE,
    solid: flags.includes("s"),
    floor: flags.includes("f"),
    over:  flags.includes("o")
  };
}

export const FURNITURE = {
  /* A – cosy home: bedroom (top), living room, dining + kitchen (bottom) */
  buildingA: [
  F(28,1,2,1,1,"s"), // wardrobe wood
  F(16,1,2,2,1), // floor lamp cream
  F(23,1,2,4,1), // window day
  F(117,1,1,5,1), // frame night
  F(23,1,2,6,1), // window day
  F(104,1,1,7,2,"s"), // nightstand wood
  F(48,2,2,8,1,"s"), // double bed green
  F(104,1,1,10,2,"s"), // nightstand wood
  F(160,1,2,1,3,"s"), // bookshelf A
  F(161,1,2,1,5,"s"), // bookshelf B
  F(13,1,1,2,3,"s"), // plant
  F(60,2,2,9,4,"s"), // fireplace
  F(142,2,2,3,7,"f"), // round rug
  F(56,2,2,3,5,"s"), // sofa red
  F(103,1,1,3.5,7.5,"s"), // round table
  F(101,1,1,7,6,"s"), // armchair red
  F(14,1,1,10,7,"s"), // plant big
  F(96,1,1,4,19,"s"), // chair front
  F(96,1,1,5,19,"s"), // chair front
  F(82,2,1,4,20,"s"), // clothed table
  F(99,1,1,4,21,"s"), // chair back
  F(99,1,1,5,21,"s"), // chair back
  F(10,1,1,1,19,"s"), // crate
  F(11,1,1,10,19,"s"), // barrel
  F(13,1,1,1,18,"s"), // plant
  F(88,2,1,1,23,"s"), // kitchen counter
  F(90,2,1,3,23,"s"), // counter+sink
  F(92,2,1,5,23,"s"), // stove
  F(30,1,2,7,22,"s"), // fridge
  F(163,1,2,8,22,"s"), // glass cupboard
  F(62,2,2,9,22,"s"), // bathtub
  ],

  /* B – study / lounge / guest bed (only shown after the health bar + enemies stop) */
  buildingB: [
  F(160,1,2,1,1,"s"), // bookshelf A
  F(161,1,2,2,1,"s"), // bookshelf B
  F(163,1,2,3,1,"s"), // glass cupboard
  F(172,1,2,7,1,"s"), // glass cupboard 2
  F(169,1,2,8,1,"s"), // bookshelf C
  F(166,1,2,9,1,"s"), // bottles shelf
  F(170,1,2,10,1,"s"), // plates shelf 2
  F(0,1,1,8,3), // lamp cream
  F(84,2,1,8,4,"s"), // desk
  F(99,1,1,8,5,"s"), // chair back
  F(16,1,2,1,3,"s"), // floor lamp cream
  F(58,2,2,1,5,"s"), // sofa green
  F(142,2,2,3,6,"f"), // round rug
  F(103,1,1,3.5,6.5,"s"), // round table
  F(17,1,2,7,3,"s"), // floor lamp red
  F(60,2,2,9,7,"s"), // fireplace
  F(14,1,1,10,5,"s"), // plant big
  F(132,2,1,2,18,"o"), // chandelier gold A
  F(96,1,1,2,19,"s"), // chair front
  F(96,1,1,3,19,"s"), // chair front
  F(82,2,1,2,20,"s"), // clothed table
  F(99,1,1,2,21,"s"), // chair back
  F(99,1,1,3,21,"s"), // chair back
  F(11,1,1,1,23,"s"), // barrel
  F(10,1,1,2,23,"s"), // crate
  F(9,1,1,3,23,"s"), // basket
  F(19,1,2,5,22,"s"), // coat rack
  F(25,1,2,7,22,"s"), // standing mirror
  F(29,1,2,8,22,"s"), // wardrobe dark
  F(109,1,1,9,22,"s"), // small dresser
  F(52,1,2,9,19,"s"), // single bed blue
  F(104,1,1,10,20,"s"), // nightstand wood
  ],

  /* C – throne hall: red carpet, throne, benches, clocks, chandeliers */
  buildingC: [
  F(24,1,2,3,1), // window night
  F(24,1,2,8,1), // window night
  F(128,1,2,2,1), // curtain red
  F(128,1,2,4,1), // curtain red
  F(128,1,2,7,1), // curtain red
  F(128,1,2,9,1), // curtain red
  F(60,2,2,5,1,"s"), // fireplace
  F(160,1,2,1,1,"s"), // bookshelf A
  F(163,1,2,10,1,"s"), // glass cupboard
  F(152,2,1,5,8,"f"), // rug yellow
  F(136,2,1,5,9,"f"), // rug red
  F(136,2,1,5,10,"f"), // rug red
  F(136,2,1,5,11,"f"), // rug red
  F(136,2,1,5,12,"f"), // rug red
  F(136,2,1,5,13,"f"), // rug red
  F(136,2,1,5,14,"f"), // rug red
  F(136,2,1,5,15,"f"), // rug red
  F(136,2,1,5,16,"f"), // rug red
  F(101,1,1,5.5,5.55,"s"), // armchair red
  F(17,1,2,4.2,5), // floor lamp red
  F(17,1,2,6.8,5), // floor lamp red
  F(94,2,1,1,10,"s"), // bench
  F(94,2,1,9,10,"s"), // bench
  F(14,1,1,2,9,"s"), // plant big
  F(14,1,1,9,9,"s"), // plant big
  F(94,2,1,1,14,"s"), // bench
  F(94,2,1,9,14,"s"), // bench
  F(14,1,1,2,13,"s"), // plant big
  F(14,1,1,9,13,"s"), // plant big
  F(18,1,2,1,17,"s"), // grandfather clock
  F(18,1,2,10,17,"s"), // grandfather clock
  F(161,1,2,1,19,"s"), // bookshelf B
  F(172,1,2,10,19,"s"), // glass cupboard 2
  F(108,1,1,2,22,"s"), // chest
  F(108,1,1,9,22,"s"), // chest
  F(132,2,1,5,11,"o"), // chandelier gold A
  F(134,2,1,5,19,"o"), // chandelier gold B
  ]
};

/* Draw one piece of furniture */
export function drawFurn(ctx, f) {
  ctx.drawImage(
    interiorSheet,
    (f.id % IN_COLS) * IN_SRC, Math.floor(f.id / IN_COLS) * IN_SRC, f.w * IN_SRC, f.h * IN_SRC,
    Math.round(f.x), Math.round(f.y), Math.round(f.w * TILE), Math.round(f.h * TILE)
  );
}

/* Collision rectangle: the lower 60% of the sprite (so you can walk "behind" the top) */
export function furnSolids(list) {
  return list.filter(f => f.solid).map(f => {
    const w = f.w * TILE, h = f.h * TILE;
    return { x: f.x + 4, y: f.y + h * 0.4, w: w - 8, h: h * 0.6 };
  });
}
