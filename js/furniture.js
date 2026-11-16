/* ==============================================================
   FURNITURE.JS – interior decoration for Hungry Reds
   Uses assets/tiles/interior_tileset.png

   NEW TILESET VERSION
   -------------------
   The new furniture sheet is 512 x 512, but furniture is NOT
   arranged as uniform 32 x 32 cells.

   Each sprite therefore has an explicit source rectangle:
   { x, y, w, h }

   Room placement still uses the same 45px world grid as main.js.
   ============================================================== */

const TILE = 45;


/* ==============================================================
   LOAD INTERIOR TILESET
   ============================================================== */

const interiorSheet = new Image();

export function loadInteriorSheet() {
  return new Promise((resolve, reject) => {
    interiorSheet.onload = resolve;

    interiorSheet.onerror = () => {
      reject(
        new Error(
          "Could not load assets/tiles/interior_tileset.png"
        )
      );
    };

    interiorSheet.src =
      "assets/tiles/interior_tileset.png";
  });
}


/* ==============================================================
   SPRITE ATLAS

   x = source X position inside PNG
   y = source Y position inside PNG
   w = source width
   h = source height

   These are SOURCE PIXELS, not world tiles.
   ============================================================== */

const SPRITES = Object.freeze({

  /* ----------------------------------------------------------
     SMALL DECORATIONS – TOP ROW
     ---------------------------------------------------------- */

  lampTableCream: {
    x: 4,
    y: 3,
    w: 29,
    h: 38
  },

  lampTableGreen: {
    x: 34,
    y: 3,
    w: 29,
    h: 38
  },

  candle: {
    x: 72,
    y: 3,
    w: 20,
    h: 39
  },

  chandelier: {
    x: 98,
    y: 2,
    w: 26,
    h: 41
  },

  flowers: {
    x: 128,
    y: 2,
    w: 29,
    h: 41
  },

  basket: {
    x: 253,
    y: 4,
    w: 43,
    h: 37
  },

  crate: {
    x: 299,
    y: 4,
    w: 43,
    h: 37
  },

  barrel: {
    x: 344,
    y: 2,
    w: 38,
    h: 42
  },

  plantSmall: {
    x: 386,
    y: 2,
    w: 34,
    h: 41
  },

  plantBig: {
    x: 422,
    y: 1,
    w: 44,
    h: 44
  },


  /* ----------------------------------------------------------
     TALL OBJECTS
     ---------------------------------------------------------- */

  floorLampCream: {
    x: 2,
    y: 45,
    w: 31,
    h: 54
  },

  floorLampRed: {
    x: 35,
    y: 45,
    w: 29,
    h: 54
  },

  grandfatherClock: {
    x: 66,
    y: 45,
    w: 31,
    h: 54
  },

  coatRack: {
    x: 99,
    y: 44,
    w: 24,
    h: 56
  },

  doorWood: {
    x: 126,
    y: 45,
    w: 41,
    h: 55
  },

  doorDark: {
    x: 170,
    y: 45,
    w: 40,
    h: 55
  },

  windowDay: {
    x: 213,
    y: 45,
    w: 41,
    h: 55
  },

  windowNight: {
    x: 257,
    y: 45,
    w: 41,
    h: 55
  },

  standingMirror: {
    x: 301,
    y: 45,
    w: 41,
    h: 55
  },

  stairs: {
    x: 345,
    y: 45,
    w: 48,
    h: 55
  },

  ladder: {
    x: 395,
    y: 45,
    w: 29,
    h: 55
  },

  wardrobeWood: {
    x: 427,
    y: 45,
    w: 39,
    h: 55
  },

  wardrobeDark: {
    x: 468,
    y: 45,
    w: 40,
    h: 55
  },

  fridge: {
    x: 469,
    y: 46,
    w: 39,
    h: 54
  },


  /* ----------------------------------------------------------
     BEDS / SOFAS / FIREPLACE / TV
     ---------------------------------------------------------- */

  bedGreen: {
    x: 2,
    y: 104,
    w: 82,
    h: 54
  },

  bedRed: {
    x: 86,
    y: 104,
    w: 82,
    h: 54
  },

  bedBlue: {
    x: 170,
    y: 104,
    w: 40,
    h: 54
  },

  bedCream: {
    x: 214,
    y: 104,
    w: 40,
    h: 54
  },

  sofaRed: {
    x: 257,
    y: 104,
    w: 71,
    h: 54
  },

  sofaGreen: {
    x: 330,
    y: 104,
    w: 71,
    h: 54
  },

  fireplace: {
    x: 403,
    y: 101,
    w: 61,
    h: 66
  },

  television: {
    x: 466,
    y: 104,
    w: 46,
    h: 54
  },


  /* ----------------------------------------------------------
     TABLES / COUNTERS
     ---------------------------------------------------------- */

  benchWood: {
    x: 2,
    y: 171,
    w: 82,
    h: 27
  },

  benchRed: {
    x: 86,
    y: 171,
    w: 82,
    h: 27
  },

  desk: {
    x: 170,
    y: 171,
    w: 81,
    h: 37
  },

  dresser: {
    x: 253,
    y: 171,
    w: 42,
    h: 37
  },

  nightstandWood: {
    x: 297,
    y: 171,
    w: 42,
    h: 37
  },

  kitchenCounter: {
    x: 340,
    y: 171,
    w: 81,
    h: 37
  },

  counterSink: {
    x: 423,
    y: 171,
    w: 82,
    h: 37
  },

  stove: {
    x: 423,
    y: 171,
    w: 82,
    h: 37
  },


  /* ----------------------------------------------------------
     CHAIRS / SMALL FURNITURE
     ---------------------------------------------------------- */

  chairFront: {
    x: 3,
    y: 210,
    w: 29,
    h: 34
  },

  chairBack: {
    x: 36,
    y: 210,
    w: 29,
    h: 34
  },

  chairSide: {
    x: 69,
    y: 210,
    w: 29,
    h: 34
  },

  armchairRed: {
    x: 154,
    y: 210,
    w: 39,
    h: 34
  },

  roundTable: {
    x: 213,
    y: 210,
    w: 39,
    h: 34
  },

  smallDresser: {
    x: 254,
    y: 210,
    w: 39,
    h: 34
  },

  chest: {
    x: 394,
    y: 210,
    w: 42,
    h: 34
  },

  bathtub: {
    x: 451,
    y: 210,
    w: 41,
    h: 34
  },


  /* ----------------------------------------------------------
     WALL DECORATIONS
     ---------------------------------------------------------- */

  frameLandscape: {
    x: 2,
    y: 247,
    w: 81,
    h: 29
  },

  frameHouse: {
    x: 85,
    y: 247,
    w: 81,
    h: 29
  },

  frameNight: {
    x: 168,
    y: 247,
    w: 39,
    h: 29
  },

  clockRound: {
    x: 258,
    y: 247,
    w: 39,
    h: 29
  },

  bottlesShelf: {
    x: 299,
    y: 247,
