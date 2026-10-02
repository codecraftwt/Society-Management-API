const express = require("express");
const router = express.Router();
const { createParcel, getParcels, updateParcelStatus, getParcelById } = require("../controllers/parcelControllers");
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

// All routes must be authenticated
router.use(auth);

// Guard or Resident can create (committee/admin may log parcels too)
// SUPER_ADMIN is listed explicitly on every route so the platform role is
// never reliant on the roleMiddleware bypass alone.
router.get("/", role("GUARD", "RESIDENT", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), getParcels);
router.get("/:id", role("GUARD", "RESIDENT", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), getParcelById);
router.post("/", role("GUARD", "RESIDENT", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), createParcel);

// Guard sees all, Resident sees own (handle inside controller)


// Guard, society admin or committee can update status

router.put("/:id/status", role("GUARD", "RESIDENT", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), updateParcelStatus);

module.exports = router;
