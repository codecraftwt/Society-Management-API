
const express = require("express");
const router = express.Router();

const {
  login,
  verifyOtp,
  resendOtp,
  switchRole,
  registerResident,
  checkApprovalStatus,
} = require("../controllers/authControllers");

const auth = require("../middlewares/authMiddleware");

/* Public routes */
router.post("/login",             login);
router.post("/verify-otp",        verifyOtp);
router.post("/resend-otp",        resendOtp);
router.post("/register",          registerResident);
router.get("/approval-status/:id", checkApprovalStatus);

/* Protected — requires a valid access token */
router.post("/switch-role", auth, switchRole);

module.exports = router;