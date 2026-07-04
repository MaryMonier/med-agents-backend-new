const router = require("express").Router();
const authMiddleware = require("../middleware/auth.middleware");
const adminMiddleware = require("../middleware/admin.middleware");
const {
  getMySubscription,
  renewSubscription,
  getDoctorsSubscriptions,
} = require("../controllers/subscription.controller");

router.get("/me", authMiddleware, getMySubscription);

router.patch(
  "/:doctorId/renew",
  authMiddleware,
  adminMiddleware,
  renewSubscription
);

router.get(
    "/doctors",
    authMiddleware,
    adminMiddleware,
    getDoctorsSubscriptions
);

module.exports = router;