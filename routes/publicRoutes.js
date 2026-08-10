const router = require("express").Router();

const {
  getSocieties,
  getBlocks,
  getAvailableFlats
} = require("../controllers/publicControllers");

/* PUBLIC ONBOARDING ROUTES */

router.get("/societies", getSocieties);
router.get("/societies/:societyId/blocks", getBlocks);
router.get("/blocks/:blockId/flats", getAvailableFlats);

module.exports = router;
