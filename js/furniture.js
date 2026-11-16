/* ==============================================================
   FURNITURE.JS – interior decoration for Hungry Reds

   Uses:
   assets/tiles/interior_tileset.png

   Interior tileset:
   512 x 512 px
   16 columns x 16 rows
   32 x 32 px per tile

   TILE = 45px is the on-screen/world tile size used by main.js.
   ============================================================== */


/* --------------------------------------------------------------
   SETTINGS
-------------------------------------------------------------- */

const TILE = 45;      // on-screen tile size
const IN_SRC = 32;    // source tile size inside interior_tileset.png
const IN_COLS = 16;   // 512 / 32 = 16 columns


/* --------------------------------------------------------------
   INTERIOR TILESET LOADING
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


    interiorSheet.src =
      "assets/tiles/interior_tileset.png";

  });

}


/* --------------------------------------------------------------
   FURNITURE OBJECT CREATOR

   F(
     tileId,
     widthInTiles,
     heightInTiles,
     column,
     row,
     flags
   )

   column / row:
   Position inside the ROOM using the 45px world grid.

   flags:

   "s" = solid
         Player cannot walk through the lower part.

   "f" = floor
         Rugs etc. are drawn underneath the player.

   "o" = overhead
         Chandeliers etc. are drawn over the player.
-------------------------------------------------------------- */

function F(id, w, h, c, r, flags = "") {

  return {

    id,

    w,
    h,

    x: c * TILE,
    y: r * TILE,

    solid: flags.includes("s"),
    floor: flags.includes("f"),
    over: flags.includes("o")

  };

}


/* ==============================================================
   FURNITURE LAYOUTS
============================================================== */

export const FURNITURE = {


  /* ============================================================
     BUILDING A
     Cosy home

     Bedroom
     Living room
     Dining room
     Kitchen
  ============================================================ */

  buildingA: [


    /* ----------------------------------------------------------
       BEDROOM
    ---------------------------------------------------------- */

    F(
      28,
      1, 2,
      1, 1,
      "s"
    ), // wardrobe wood


    F(
      16,
      1, 2,
      2, 1
    ), // floor lamp cream


    F(
      23,
      1, 2,
      4, 1
    ), // window day


    F(
      117,
      1, 1,
      5, 1
    ), // frame night


    F(
      23,
      1, 2,
      6, 1
    ), // window day


    F(
      104,
      1, 1,
      7, 2,
      "s"
    ), // nightstand wood


    F(
      48,
      2, 2,
      8, 1,
      "s"
    ), // double bed green


    F(
      104,
      1, 1,
      10, 2,
      "s"
    ), // nightstand wood



    /* ----------------------------------------------------------
       LIVING ROOM
    ---------------------------------------------------------- */

    F(
      160,
      1, 2,
      1, 3,
      "s"
    ), // bookshelf A


    F(
      161,
      1, 2,
      1, 5,
      "s"
    ), // bookshelf B


    F(
      13,
      1, 1,
      2, 3,
      "s"
    ), // small plant


    F(
      60,
      2, 2,
      9, 4,
      "s"
    ), // fireplace


    F(
      142,
      2, 2,
      3, 7,
      "f"
    ), // round rug


    F(
      56,
      2, 2,
      3, 5,
      "s"
    ), // sofa red


    F(
      103,
      1, 1,
      3.5, 7.5,
      "s"
    ), // round table


    F(
      101,
      1, 1,
      7, 6,
      "s"
    ), // armchair red


    F(
      14,
      1, 1,
      10, 7,
      "s"
    ), // large plant



    /* ----------------------------------------------------------
       DINING ROOM
    ---------------------------------------------------------- */

    F(
      96,
      1, 1,
      4, 19,
      "s"
    ), // chair front


    F(
      96,
      1, 1,
      5, 19,
      "s"
    ), // chair front


    F(
      82,
      2, 1,
      4, 20,
      "s"
    ), // clothed table


    F(
      99,
      1, 1,
      4, 21,
      "s"
    ), // chair back


    F(
      99,
      1, 1,
      5
