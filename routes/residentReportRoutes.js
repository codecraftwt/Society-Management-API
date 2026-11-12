const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

const {
  getMyComplaints,
  getMyVisitors,
  getMyBills
} = require("../controllers/residentReportControllers");

/* === RESIDENT REPORT ROUTES === */

router.get(
  "/my-complaints",
  auth,
  role("RESIDENT", "FAMILY_MEMBER"),
  getMyComplaints
);

router.get(
  "/my-visitors",
  auth,
  role("RESIDENT", "FAMILY_MEMBER"),
  getMyVisitors
);

router.get(
  "/my-bills",
  auth,
  role("RESIDENT", "FAMILY_MEMBER"),
  getMyBills
);

module.exports = router;
