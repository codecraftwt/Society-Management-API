const express = require("express");
const router = express.Router();
const { createParcel, getParcels, updateParcelStatus } = require("../controllers/parcelControllers");
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

// All routes must be authenticated
router.use(auth);

// Guard or Resident can create
router.get("/", role("GUARD", "RESIDENT","SOCIETY_ADMIN"), getParcels);
router.post("/", role("GUARD", "RESIDENT"), createParcel);

// Guard sees all, Resident sees own (handle inside controller)


// Only Guard can update status

router.put("/:id/status", role("GUARD", "RESIDENT"), updateParcelStatus);

module.exports = router;
