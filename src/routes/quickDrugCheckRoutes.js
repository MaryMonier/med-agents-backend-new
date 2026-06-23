const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
const { quickCheck } = require("../controllers/quickDrugCheckController");

router.post("/quick-check", authMiddleware, quickCheck);

module.exports = router;
