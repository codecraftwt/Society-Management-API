const express = require("express");
const router = express.Router();
const { createParcel, getParcels, updateParcelStatus, getParcelById } = require("../controllers/parcelControllers");
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

// All routes must be authenticated
router.use(auth);

// Management can read parcels for oversight; gate staff and residents handle
// parcel entry. Accountants must never inherit management access here.
// SUPER_ADMIN is listed explicitly on every route so the platform role is
// never reliant on the roleMiddleware bypass alone.
router.get("/", role.strict("GUARD", "RESIDENT", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), getParcels);
router.get("/:id", role.strict("GUARD", "RESIDENT", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), getParcelById);
router.post("/", role.strict("GUARD", "RESIDENT", "SUPER_ADMIN"), createParcel);

// Guard sees all, Resident sees own (handle inside controller)


// Guard, society admin or committee can update status

router.put("/:id/status", role.strict("GUARD", "RESIDENT", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "SUPER_ADMIN"), updateParcelStatus);

module.exports = router;
