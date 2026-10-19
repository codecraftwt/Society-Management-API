const router = require("express").Router();

const {
  getSocieties,
  getBlocks,
  getFloors,
  getAvailableFlats,
  getAvailableFlatsByFloor,
} = require("../controllers/publicControllers");

/* PUBLIC ONBOARDING ROUTES */

router.get("/societies", getSocieties);
router.get("/societies/:societyId/blocks", getBlocks);
router.get("/blocks/:blockId/floors", getFloors);
router.get("/blocks/:blockId/flats", getAvailableFlats);
router.get("/floors/:floorId/flats", getAvailableFlatsByFloor);

module.exports = router;
