const express = require("express");
const router = express.Router();

const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

const {
  getSocietyBills,
  getPayments,
  monthlyCollection,
  getDashboardStats,
} = require("../controllers/accountantControllers");

const {
  createAccountant,
  appointResidentAccountant,
  getEligibleAccountantResidents,
  getAccountant,
  updateAccountant,
  toggleAccountantStatus,
  deleteAccountant,
} = require("../controllers/userControllers");

// Resolve the accountant's society for :id based routes
const resolveSocietyFromAccountant = async (req, res, next) => {
  try {
    const { User, AccountantAssignment } = require("../models");
    let acc = await User.findByPk(req.params.id);
    if (!acc) {
      const assignment = await AccountantAssignment.findByPk(req.params.id);
      if (assignment) {
        req.resolvedSocietyId = assignment.society_id;
        return next();
      }
      return res.status(404).json({ message: "Accountant not found" });
    }
    req.resolvedSocietyId = acc.society_id;
    next();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

router.get("/dashboard-stats", auth, role("ACCOUNTANT"), getDashboardStats);
router.get("/bills", auth, role("ACCOUNTANT"), getSocietyBills);
router.get("/payments", auth, role("ACCOUNTANT"), getPayments);
router.get("/payments/summary", auth, role("ACCOUNTANT"), monthlyCollection);

// Appoint resident as accountant
router.post("/appoint-resident", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), appointResidentAccountant);

// Eligible residents dropdown
router.get("/eligible-residents", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), getEligibleAccountantResidents);

// Accountant CRUD (Super Admin list / Society Admin list / Committee Member view)
router.post("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), createAccountant);
router.get("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "RESIDENT", "COMMITTEE_MEMBER"), getAccountant);

// Super Admin global list
router.get("/all", auth, role("SUPER_ADMIN"), (req, res, next) => {
  req.query.society_id = undefined;
  next();
}, getAccountant);

// Super Admin / Society Admin / Committee Member filtered single society
router.get("/society/:id", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), (req, res, next) => {
  req.query.society_id = req.params.id;
  next();
}, getAccountant);

// Current user's society accountant
router.get("/me", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "RESIDENT", "COMMITTEE_MEMBER"), (req, res, next) => {
  req.query.society_id = undefined;
  next();
}, getAccountant);

// Toggle status (Disable / Inactive / Activate)
router.patch(
  "/:id/status",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN"),
  toggleAccountantStatus
);
router.put(
  "/:id/status",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN"),
  toggleAccountantStatus
);

router.put(
  "/:id",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN"),
  resolveSocietyFromAccountant,
  (req, res, next) => {
    req.body.society_id = req.body.society_id || req.resolvedSocietyId;
    next();
  },
  updateAccountant
);
router.delete(
  "/:id",
  auth,
  role("SUPER_ADMIN", "SOCIETY_ADMIN"),
  resolveSocietyFromAccountant,
  (req, res, next) => {
    req.query.society_id = req.query.society_id || req.resolvedSocietyId;
    next();
  },
  deleteAccountant
);

module.exports = router;