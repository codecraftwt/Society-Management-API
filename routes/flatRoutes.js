
// // // const express = require("express");
// // // const router = express.Router();
// // // const auth = require("../middlewares/authMiddleware");
// // // const role = require("../middlewares/roleMiddleware");

// // // const {
// // //   createFlat,
// // //   getALLFlats, // ✅ NEW UNIVERSAL API
// // //   assignResident,
// // //   getAllFlats,
// // //   unassignResident,
// // //   getAssignedFlats,
// // //   getUnassignedFlats,
// // //   getNeighbours,
// // //   deleteFlat
// // // } = require("../controllers/flatControllers");

// // // // ✅ Neighbours & Listings
// // // router.get("/neighbours", auth, role("RESIDENT", "FAMILY_MEMBER"), getNeighbours);
// // // router.get("/getall", auth, role("SOCIETY_ADMIN"), getAllFlats);
// // // router.get("/unassigned", auth, role("SOCIETY_ADMIN", "ACCOUNTANT"), getUnassignedFlats);
// // // router.get("/assigned", auth, role("SOCIETY_ADMIN", "RESIDENT", "GUARD", "ACCOUNTANT","FAMILY_MEMBER"), getAssignedFlats);

// // // // ✅ Create flat
// // // router.post("/", auth, role("SUPER_ADMIN"), createFlat);

// // // // ✅ UNIVERSAL ROUTE (Replaces /floor/:floorId and /:blockId)
// // // router.get("/list", auth, role("SOCIETY_ADMIN", "GUARD", "RESIDENT", "SUPER_ADMIN"), getFlats);

// // // // ✅ Assign / Unassign / Delete
// // // router.put("/assign/:flatId", auth, role("SOCIETY_ADMIN"), assignResident);
// // // router.put("/unassign/:flatId", auth, role("SOCIETY_ADMIN"), unassignResident);
// // // router.delete("/delete/:flatId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), deleteFlat);

// // // module.exports = router;


// // const express = require("express");
// // const router = express.Router();
// // const auth = require("../middlewares/authMiddleware");
// // const role = require("../middlewares/roleMiddleware");

// // const {
// //   createFlat,
// //   getFlatsByBlockAndFloor, // ✅ FIXED
// //   assignResident,
// //   unassignResident,
// //   getAssignedFlats,
// //   getUnassignedFlats,
// //   getNeighbours,
// //   deleteFlat,
// //   getAllFlats
// // } = require("../controllers/flatControllers");

// // // ✅ Neighbours & Listings
// // router.get("/neighbours", auth, role("RESIDENT", "FAMILY_MEMBER"), getNeighbours);
// // router.get("/getall", auth, role("SOCIETY_ADMIN"), getAllFlats);
// // router.get("/unassigned", auth, role("SOCIETY_ADMIN", "ACCOUNTANT"), getUnassignedFlats);
// // router.get("/assigned", auth, role("SOCIETY_ADMIN", "RESIDENT", "GUARD", "ACCOUNTANT","FAMILY_MEMBER"), getAssignedFlats);

// // // ✅ Create flat
// // router.post("/", auth, role("SUPER_ADMIN"), createFlat);

// // // ✅ FIXED: use getAllFlats instead of getFlats
// // router.get(
// //   "/list",
// //   auth,
// //   role("SOCIETY_ADMIN", "GUARD", "RESIDENT", "SUPER_ADMIN"),
// //   getFlatsByBlockAndFloor
// // );

// // // ✅ Assign / Unassign / Delete
// // router.put("/assign/:flatId", auth, role("SOCIETY_ADMIN"), assignResident);
// // router.put("/unassign/:flatId", auth, role("SOCIETY_ADMIN"), unassignResident);
// // router.delete("/delete/:flatId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), deleteFlat);

// // module.exports = router;

// const express = require("express");
// const router = express.Router();
// const auth = require("../middlewares/authMiddleware");
// const role = require("../middlewares/roleMiddleware");
// const {
//   createFlat,
//   getFlatsByFloor,
//   getUnassignedFlatsByFloor,
//   assignFlatToResident,
//   getAllFlats,
//   getAssignedFlats,
//   unassignResident,
//   assignResident,
//   getUnassignedFlats,
//   deleteFlat,
//   getNeighbours,
//   getFlatsByBlockAndFloor
// } = require("../controllers/flatControllers");

// // ✅ Add SUPER_ADMIN to these routes so they can populate the Block/Floor/Flat dropdowns
// router.get("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), getAllFlats);
// router.get("/unassigned", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getUnassignedFlats);
// router.get("/assigned", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getAssignedFlats);
// router.get("/neighbours", auth, role("RESIDENT", "FAMILY_MEMBER"), getNeighbours);
// router.get("/filter", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "GUARD"), getFlatsByBlockAndFloor);
// router.get("/:blockId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "GUARD"), getFlatsByBlockAndFloor);

// router.post("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), createFlat);
// router.get("/floor/:floorId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), getFlatsByFloor);
// router.get("/floor/:floorId/unassigned", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), getUnassignedFlatsByFloor);
// router.put("/assign/:flatId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), assignResident);
// router.put("/unassign/:flatId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), unassignResident);
// router.delete("/:flatId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), deleteFlat);

// module.exports = router;

const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware");
const role = require("../middlewares/roleMiddleware");
const {
  createFlat,
  getFlatsByFloor,
  getUnassignedFlatsByFloor,
  assignFlatToResident,
  getAllFlats,
  getAssignedFlats,
  unassignResident,
  assignResident,
  getUnassignedFlats,
  deleteFlat,
  getNeighbours,
  getFlatsByBlockAndFloor,
  updateFlat,
  bulkUpdateFlats,
} = require("../controllers/flatControllers");

// ✅ SPECIFIC routes FIRST — before any /:param routes
router.get("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getAllFlats);
router.get("/getall", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getAllFlats);
router.get("/unassigned", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER"), getUnassignedFlats);
router.get("/assigned", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "COMMITTEE_MEMBER", "GUARD","ACCOUNTANT"), getAssignedFlats);
router.get("/neighbours", auth, role("RESIDENT", "FAMILY_MEMBER"), getNeighbours);
router.get("/filter", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "GUARD"), getFlatsByBlockAndFloor);

// ✅ THIS WAS MISSING — frontend calls /flats/list?blockId=X
router.get("/list", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "GUARD", "RESIDENT"), getFlatsByBlockAndFloor);

router.get("/floor/:floorId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), getFlatsByFloor);
router.get("/floor/:floorId/unassigned", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), getUnassignedFlatsByFloor);

router.post("/", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), createFlat);
router.put("/assign/:flatId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), assignResident);
router.put("/unassign/:flatId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), unassignResident);
router.put("/update/:flatId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), updateFlat);
router.put("/bulk-update", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), bulkUpdateFlats);

// ✅ delete and /:blockId LAST — param routes always go at the bottom
router.delete("/delete/:flatId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN"), deleteFlat);
router.get("/:blockId", auth, role("SUPER_ADMIN", "SOCIETY_ADMIN", "GUARD"), getFlatsByBlockAndFloor);

module.exports = router;
