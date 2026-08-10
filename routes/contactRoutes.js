// const express = require("express");
// const router = express.Router();

// const { getSocietyContacts } = require("../controllers/contactController");
// const auth = require("../middlewares/authMiddleware");
// const role = require("../middlewares/roleMiddleware");

// // 🔐 All routes must be authenticated
// router.use(auth);

// // 📞 Only Guard & Resident can fetch contacts
// router.get("/", role("GUARD", "RESIDENT"), getSocietyContacts);

// module.exports = router;

// routes/contactRoutes.js
const express = require("express");
const router = express.Router();

const { getSocietyContacts } = require("../controllers/contactController");
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");

router.use(auth);

// Added SOCIETY_ADMIN temporarily to unblock testing
router.get("/", role("GUARD", "RESIDENT", "SOCIETY_ADMIN"), getSocietyContacts);

module.exports = router;