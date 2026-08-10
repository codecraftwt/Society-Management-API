const router = require("express").Router();
const authMiddleware = require("../middlewares/authMiddleware");

const {
  approveResident,
  rejectResident
} = require("../controllers/adminControllers");

router.put("/approve-resident/:userId", authMiddleware, approveResident);
router.put("/reject-resident/:userId", authMiddleware, rejectResident);

module.exports = router;
