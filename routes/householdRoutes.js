const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const attachFlatId = require("../middlewares/flatAccessMiddleware");

const {
  getMyHousehold,
  addHouseholdMember,
  removeHouseholdMember,
  toggleAdminAccess,
  updateHouseholdMember
} = require("../controllers/householdControllers");

router.get(
  "/",
  auth,
  role("RESIDENT","FAMILY_MEMBER"),
  attachFlatId,
  getMyHousehold
);

router.post(
  "/add",
  auth,
  role("RESIDENT"),
  attachFlatId,
  addHouseholdMember
);

router.delete(
  "/:id",
  auth,
  role("RESIDENT"),
  attachFlatId,
  removeHouseholdMember
);

router.patch(
  "/:id/toggle-admin",
  auth,
  role("RESIDENT"),
  attachFlatId,
  toggleAdminAccess
);

// Update member (email/phone)
router.put("/:id", auth, role("RESIDENT"), attachFlatId, updateHouseholdMember);


module.exports = router;


