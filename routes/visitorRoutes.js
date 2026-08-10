const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const { addVisitor, markExit, getSocietyVisitors, getResidentVisitors, getSocietyBlocksForGuard, respondToGateRequest } = require("../controllers/visitorControllers");
const dailyHelpController = require('../controllers/dailyHelpControllers');

// Guard — add visitor & mark exit
router.post("/", auth, role("GUARD"), addVisitor);
router.put("/exit/:id", auth, role("GUARD"), markExit);

// Admin / Guard — view all society visitors
router.get("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "GUARD"), getSocietyVisitors);

// ✅ FAMILY_MEMBER can view their own visitors (read only)
router.get("/resident", auth, role("RESIDENT", "FAMILY_MEMBER"), getResidentVisitors);

// Guard — get blocks
router.get("/block", auth, role("SUPER_ADMIN", "GUARD"), getSocietyBlocksForGuard);



// ====
// NEW: DAILY HELP ROUTES (GUARD & ADMIN)
// ====

// Guard / Admin — view daily help directory grouped by phone
router.get("/daily-help/directory", auth, role("SUPER_ADMIN", "GUARD", "SOCIETY_ADMIN", "RESIDENT", "FAMILY_MEMBER"), dailyHelpController.getSocietyDailyHelps);
router.get('/resident/attendance/:phone', auth, role("RESIDENT", "FAMILY_MEMBER"), dailyHelpController.getResidentHelperAttendance);

// Guard — check in daily help (creates multiple visitor logs simultaneously)
router.post("/daily-help/entry", auth, role("GUARD"), dailyHelpController.markDailyHelpEntry);

// Guard — check out daily help (updates multiple visitor logs simultaneously)
router.put("/daily-help/exit", auth, role("GUARD"), dailyHelpController.markDailyHelpExit);

router.post("/action/:id", auth, role("RESIDENT", "FAMILY_MEMBER"), respondToGateRequest);


module.exports = router;