const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const { quickCheck } = require("../controllers/quickDrugCheckController");
const checkSubscription = require("../middleware/checkSubscription.middleware");



router.post("/quick-check", authMiddleware, checkSubscription,quickCheck);

module.exports = router;
