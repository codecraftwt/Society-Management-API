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
  resetMemberPassword,
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
  role("RESIDENT", "FAMILY_MEMBER"),
  attachFlatId,
  addHouseholdMember
);

router.delete(
  "/:id",
  auth,
  role("RESIDENT", "FAMILY_MEMBER"),
  attachFlatId,
  removeHouseholdMember
);

router.patch(
  "/:id/toggle-admin",
  auth,
  role("RESIDENT", "FAMILY_MEMBER"),
  attachFlatId,
  toggleAdminAccess
);

// Update member (email/phone)
router.put("/:id", auth, role("RESIDENT", "FAMILY_MEMBER"), attachFlatId, updateHouseholdMember);

// Reset member password
router.patch("/:id/reset-password", auth, role("RESIDENT", "FAMILY_MEMBER"), attachFlatId, resetMemberPassword);


module.exports = router;


