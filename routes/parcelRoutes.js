const express = require("express");
const router = express.Router();
const { createParcel, getParcels, updateParcelStatus } = require("../controllers/parcelControllers");
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

// All routes must be authenticated
router.use(auth);

// Guard or Resident can create (committee/admin may log parcels too)
router.get("/", role("GUARD", "RESIDENT", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getParcels);
router.post("/", role("GUARD", "RESIDENT", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), createParcel);

// Guard sees all, Resident sees own (handle inside controller)


// Guard, society admin or committee can update status

router.put("/:id/status", role("GUARD", "RESIDENT", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), updateParcelStatus);

module.exports = router;
