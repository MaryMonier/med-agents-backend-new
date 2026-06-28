const express = require("express");
const authMiddleware = require("../middleware/auth.middleware");

const {
  createFollowup,
  getFollowups,
  getFollowupById,
  updateFollowup,
  deleteFollowup,
} = require("../controllers/followupController");
const checkSubscription = require("../middleware/checkSubscription.middleware");

const router = express.Router();

router.use(authMiddleware);
router.use(checkSubscription);
router.route("/").post(createFollowup).get(getFollowups);

router
  .route("/:id")
  .get(getFollowupById)
  .put(updateFollowup)
  .delete(deleteFollowup);

module.exports = router;
