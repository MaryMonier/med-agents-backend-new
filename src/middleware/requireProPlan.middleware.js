const User = require("../models/User");

const requireProPlan = async (req, res, next) => {
  try {
    if (req.user.role === "admin") {
      return next();
    }

    const user = await User.findById(req.user.id).select("subscription");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.subscription.status === "trial") {
      return next();
    }

    if (user.subscription.plan !== "Pro") {
      return res.status(403).json({
        error: "PRO_PLAN_REQUIRED",
        message: "This feature is only available on the Pro plan. Please upgrade to continue.",
      });
    }

    return next();
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = requireProPlan;