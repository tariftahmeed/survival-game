/* ==============================================================
   FURNITURE.JS – interior decoration for Hungry Reds
   Uses assets/tiles/interior_tileset.png

   Sheet:
   512 x 512 px
   16 columns
   32 x 32 px per source tile
   ============================================================== */

const TILE = 45;
const IN_SRC = 32;
const IN_COLS = 16;


/* --------------------------------------------------------------
   LOAD INTERIOR TILESET
-------------------------------------------------------------- */

const interiorSheet = new Image();

export function loadInteriorSheet() {
  return new Promise((resolve, reject) => {
    interiorSheet.onload = () => {
      console.log(
        "Interior tileset loaded:",
        interiorSheet.naturalWidth,
        "x",
        interiorSheet.naturalHeight
      );
      resolve();
    };

    interiorSheet.onerror = () => {
      reject(
        new Error(
          "Could not load assets/tiles/interior_tileset.png"
        )
      );
    };

    interiorSheet.src = "assets/tiles/interior_tileset.png";
  });
}


/* --------------------------------------------------------------
   FURNITURE CREATOR

   id    = first 32x32 tile in the furniture sprite
   w/h   = width/height in 32px source tiles
   c/r   = position in the room using the 45px world grid

   flags:
   s = solid
   f = floor
   o = overhead
-------------------------------------------------------------- */

function F(id, w, h, c, r, flags = "") {
  return {
    id: id,
    w: w,
    h: h,

    x: c * TILE,
    y: r * TILE,

    solid: flags.includes("s"),
    floor: flags.includes("f"),
    over: flags.includes("o")
  };
}


/* ==============================================================
   FURNITURE
============================================================== */

export const FURNITURE = {

  /* ============================================================
     BUILDING A
     Bedroom + living room + dining + kitchen
  ============================================================ */

  buildingA: [

    // Bedroom
    F(28, 1, 2, 1, 1, "s"),          // wardrobe wood
    F(16, 1, 2, 2, 1),               // floor lamp cream
    F(23, 1, 2, 4, 1),               // window day
    F(117, 1, 1, 5, 1),              // frame night
    F(23, 1, 2, 6, 1),               // window day

    F(104, 1, 1, 7, 2, "s"),         // nightstand
    F(48, 2, 2, 8, 1, "s"),          // double bed green
    F(104, 1, 1, 10, 2, "s"),        // nightstand

    // Living room
    F(160, 1, 2, 1, 3, "s"),         // bookshelf A
    F(161, 1, 2, 1, 5, "s"),         // bookshelf B
    F(13, 1, 1, 2, 3, "s"),          // plant
    F(60, 2, 2, 9, 4, "s"),          // fireplace

    F(142, 2, 2, 3, 7, "f"),         // round rug
    F(56, 2, 2, 3, 5, "s"),          // sofa red
    F(103, 1, 1, 3.5, 7.5, "s"),     // round table
    F(101, 1, 1, 7, 6, "s"),         // armchair red
    F(14, 1, 1, 10, 7, "s"),         // big plant

    // Dining area
    F(96, 1, 1, 4, 19, "s"),         // chair front
    F(96, 1, 1, 5, 19, "s"),         // chair front

    F(82, 2, 1, 4, 20, "s"),         // clothed table

    F(99, 1, 1, 4, 21, "s"),         // chair back
    F(99, 1, 1, 5, 21, "s"),         // chair back

    // Storage
    F(10, 1, 1, 1, 19, "s"),         // crate
    F(11, 1, 1, 10, 19, "s"),        // barrel
    F(13, 1, 1, 1, 18, "s"),         // plant

    // Kitchen
    F(88, 2, 1, 1, 23, "s"),         // counter
    F(90, 2, 1, 3, 23, "s"),         // sink
    F(92, 2, 1, 5, 23, "s"),         // stove

    F(30, 1, 2, 7, 22, "s"),         // fridge
    F(163, 1, 2, 8, 22, "s"),        // glass cupboard
    F(62, 2, 2, 9, 22, "s")          // bathtub
  ],


  /* ============================================================
     BUILDING B
     Study + lounge + dining + guest bedroom
  ============================================================ */

  buildingB: [

    // Library wall
    F(160, 1, 2, 1, 1, "s"),         // bookshelf A
    F(161, 1, 2, 2, 1, "s"),         // bookshelf B
    F(163, 1, 2, 3, 1, "s"),         // glass cupboard

    F(172, 1, 2, 7, 1, "s"),         // glass cupboard 2
    F(169, 1, 2, 8, 1, "s"),         // bookshelf C
    F(166, 1, 2, 9, 1, "s"),         // bottles shelf
    F(170, 1, 2, 10, 1, "s"),        // plates shelf

    // Study
    F(0, 1, 1, 8, 3),                // table lamp
    F(84, 2, 1, 8, 4, "s"),          // desk
    F(99, 1, 1, 8, 5, "s"),          // chair

    // Lounge
    F(16, 1, 2, 1, 3, "s"),          // floor lamp
    F(58, 2, 2, 1, 5, "s"),          // green sofa

    F(142, 2, 2, 3, 6, "f"),         // round rug
    F(103, 1, 1, 3.5, 6.5, "s"),     // round table

    F(17, 1, 2, 7, 3, "s"),          // red floor lamp
    F(60, 2, 2, 9, 7, "s"),          // fireplace
    F(14, 1, 1, 10, 5, "s"),         // big plant

    // Dining
    F(132, 2, 1, 2, 18, "o"),        // chandelier

    F(96, 1, 1, 2, 19, "s"),         // chair front
    F(96, 1, 1, 3, 19, "s"),         // chair front

    F(82, 2, 1, 2, 20, "s"),         // table

    F(99, 1, 1, 2, 21, "s"),         // chair back
    F(99, 1, 1, 3, 21, "s"),         // chair back

    // Storage
    F(11, 1, 1, 1, 23, "s"),         // barrel
    F(10, 1, 1, 2, 23, "s"),         // crate
    F(9, 1, 1, 3, 23, "s"),          // basket

    // Guest bedroom
    F(19, 1, 2, 5, 22, "s"),         // coat rack
    F(25, 1, 2, 7, 22, "s"),         // mirror
    F(29, 1, 2, 8, 22, "s"),         // wardrobe dark

    F(109, 1, 1, 9, 22, "s"),        // dresser
    F(52, 1, 2, 9, 19, "s"),         // single blue bed
    F(104, 1, 1, 10, 20, "s")        // nightstand
  ],


  /* ============================================================
     BUILDING C
     Throne hall
  ============================================================ */

  buildingC: [

    // Windows
    F(24, 1, 2, 3, 1),               // night window
    F(24, 1, 2, 8, 1),               // night window

    // Curtains
    F(128, 1, 2, 2, 1),              // red curtain
    F(128, 1, 2, 4, 1),              // red curtain
    F(128, 1, 2, 7, 1),              // red curtain
    F(128, 1, 2, 9, 1),              // red curtain

    // Fireplace
    F(60, 2, 2, 5, 1, "s"),          // fireplace

    // Cabinets
    F(160, 1, 2, 1, 1, "s"),         // bookshelf
    F(163, 1, 2, 10, 1, "s"),        // glass cupboard

    // Carpet
    F(152, 2, 1, 5, 8, "f"),         // yellow carpet

    F(136, 2, 1, 5, 9, "f"),
    F(136, 2, 1, 5, 10, "f"),
    F(136, 2, 1, 5, 11, "f"),
    F(136, 2, 1, 5, 12, "f"),
    F(136, 2, 1, 5, 13, "f"),
    F(136, 2, 1, 5, 14, "f"),
    F(136, 2, 1, 5, 15, "f"),
    F(136, 2, 1, 5, 16, "f"),

    // Throne
    F(101, 1, 1, 5.5, 5.55, "s"),    // red armchair / throne

    F(17, 1, 2, 4.2, 5),             // floor lamp
    F(17, 1, 2, 6.8, 5),             // floor lamp

    // Upper benches
    F(94, 2, 1, 1, 10, "s"),
    F(94, 2, 1, 9, 10, "s"),

    F(14, 1, 1, 2, 9, "s"),
    F(14, 1, 1, 9, 9, "s"),

    // Lower benches
    F(94, 2, 1, 1, 14, "s"),
    F(94, 2, 1, 9, 14, "s"),

    F(14, 1, 1, 2, 13, "s"),
    F(14, 1, 1, 9, 13, "s"),

    // Grandfather clocks
    F(18, 1, 2, 1, 17, "s"),
    F(18, 1, 2, 10, 17, "s"),

    // Lower bookshelves
    F(161, 1, 2, 1, 19, "s"),
    F(172, 1, 2, 10, 19, "s"),

    // Chests
    F(108, 1, 1, 2, 22, "s"),
    F(108, 1, 1, 9, 22, "s"),

    // Chandeliers
    F(132, 2, 1, 5, 11, "o"),
    F(134, 2, 1, 5, 19, "o")
  ]
};


/* --------------------------------------------------------------
   DRAW FURNITURE
-------------------------------------------------------------- */

export function drawFurn(ctx, f) {

  const srcX = (f.id % IN_COLS) * IN_SRC;
  const srcY = Math.floor(f.id / IN_COLS) * IN_SRC;

  const srcW = f.w * IN_SRC;
  const srcH = f.h * IN_SRC;

  const destX = Math.round(f.x);
  const destY = Math.round(f.y);

  const destW = Math.round(f.w * TILE);
  const destH = Math.round(f.h * TILE);

  ctx.save();

  ctx.imageSmoothingEnabled = false;

  ctx.drawImage(
    interiorSheet,
    srcX,
    srcY,
    srcW,
    srcH,
    destX,
    destY,
    destW,
    destH
  );

  ctx.restore();
}


/* --------------------------------------------------------------
   FURNITURE COLLISIONS

   Only the lower 60% of solid furniture blocks the player.
-------------------------------------------------------------- */

export function furnSolids(list) {

  return list
    .filter(f => f.solid)
    .map(f => {

      const w = f.w * TILE;
      const h = f.h * TILE;

      return {
        x: f.x + 4,
        y: f.y + h * 0.4,
        w: Math.max(0, w - 8),
        h: h * 0.6
      };

    });
}
