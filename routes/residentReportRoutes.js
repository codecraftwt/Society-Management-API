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
  role("RESIDENT"),
  getMyComplaints
);

router.get(
  "/my-visitors",
  auth,
  role("RESIDENT"),
  getMyVisitors
);

router.get(
  "/my-bills",
  auth,
  role("RESIDENT"),
  getMyBills
);

module.exports = router;
