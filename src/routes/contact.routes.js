const router = require("express").Router();
const authMiddleware = require("../middleware/auth.middleware");
const adminMiddleware = require("../middleware/admin.middleware");
const {
  sendMessage,
  getMessages,
} = require("../controllers/contact.controller");

router.post("/", sendMessage);


router.get("/", authMiddleware, adminMiddleware, getMessages);

module.exports = router;
