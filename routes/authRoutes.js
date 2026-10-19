
const express = require("express");
const router = express.Router();

const {
  login,
  verifyOtp,
  resendOtp,
  sendRegistrationOtp,
  verifyRegistrationOtp,
  switchRole,
  getUserSocieties,
  switchSociety,
  registerResident,
  checkApprovalStatus,
  checkEmailAvailability,
} = require("../controllers/authControllers");

const auth = require("../middlewares/authMiddleware");

/* Public routes */
router.post("/login",             login);
router.post("/verify-otp",        verifyOtp);
router.post("/resend-otp",        resendOtp);
router.post("/send-registration-otp",    sendRegistrationOtp);
router.post("/verify-registration-otp",  verifyRegistrationOtp);
router.get("/check-email",        checkEmailAvailability);
router.post("/check-email",       checkEmailAvailability);
router.post("/register",          registerResident);
router.get("/approval-status/:id", checkApprovalStatus);

/* Protected — requires a valid access token */
router.post("/switch-role", auth, switchRole);
router.get("/societies", auth, getUserSocieties);
router.post("/switch-society", auth, switchSociety);

module.exports = router;