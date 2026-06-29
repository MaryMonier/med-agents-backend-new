const User = require("../models/User")

const getMySubscription = async (req, res) => {
  const user = await User.findById(req.user.id).select("subscription");

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

if (!user.subscription) {
  return res.status(404).json({
    success: false,
    message: "Subscription not found",
  });
}

  const { subscription } = user;
if (
  subscription.status === "trial" &&
  new Date() > subscription.trialEnd
) {
  subscription.status = "expired";
  await user.save();
}
  let daysLeft = 0;

  if (subscription.status === "trial") {
    daysLeft = Math.max(
      0,
      Math.ceil(
        (new Date(subscription.trialEnd) - new Date()) /
          (1000 * 60 * 60 * 24)
      )
    );
  }

  if (subscription.status === "active" && subscription.subscriptionEnd) {
    daysLeft = Math.max(
      0,
      Math.ceil(
        (new Date(subscription.subscriptionEnd) - new Date()) /
          (1000 * 60 * 60 * 24)
      )
    );
  }

  res.json({
    success: true,
    data: {
status: subscription.status,
plan: subscription.plan,
trialStart: subscription.trialStart,
trialEnd: subscription.trialEnd,
subscriptionStart: subscription.subscriptionStart,
subscriptionEnd: subscription.subscriptionEnd,
daysLeft
    },
  });
};
const renewSubscription = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { plan, months } = req.body;

    const user = await User.findById(doctorId);

    if (!user || user.role !== "doctor") {
      return res.status(404).json({
        success: false,
        message: "Doctor not found",
      });
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + months);

    user.subscription.status = "active";
    user.subscription.plan = plan;
    user.subscription.subscriptionStart = startDate;
    user.subscription.subscriptionEnd = endDate;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Subscription renewed successfully",
      data: user.subscription,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
const getDoctorsSubscriptions = async (req, res) => {
  try {
    const doctors = await User.find(
      { role: "doctor" },
      "name email specialty subscription createdAt"
    ).sort({ createdAt: -1 });

    const doctorsWithDaysLeft = doctors.map((doctor) => {
      const subscription = doctor.subscription;

      let daysLeft = 0;

      if (subscription?.status === "trial") {
        daysLeft = Math.max(
          0,
          Math.ceil(
            (new Date(subscription.trialEnd) - new Date()) /
              (1000 * 60 * 60 * 24)
          )
        );
      }

      if (subscription?.status === "active" &&  subscription.subscriptionEnd) {
        daysLeft = Math.max(
          0,
          Math.ceil(
            (new Date(subscription.subscriptionEnd) - new Date()) /
              (1000 * 60 * 60 * 24)
          )
        );
      }

      return {
        ...doctor.toObject(),
        daysLeft,
      };
    });

    return res.status(200).json({
      success: true,
      data: doctorsWithDaysLeft,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  getMySubscription,
  renewSubscription
  ,getDoctorsSubscriptions
};